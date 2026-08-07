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
import { grassSprite, smokeSprite } from '../engine/Textures.js';
import { makeRng, clamp, lerp, fbm2, ridged2, TAU } from '../engine/MathUtil.js';

const rng = makeRng(70707);
const _v1 = new THREE.Vector3();
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

/*
 * The SECOND scale, and the reason a grass field used to read as ten thousand
 * blades each wobbling on its own timer.
 *
 * The gust field above has fronts 114 m apart (2π/GUST_K). A grass ring is 46 m
 * across, so LESS THAN HALF A WAVELENGTH is ever on screen: the whole field
 * leans one way together and then the other, which is a slider being moved, not
 * wind crossing a meadow. What the eye actually reads as "wind on a field" is a
 * band of laid-over blades about fifteen metres wide travelling downwind at
 * roughly walking-to-jogging pace, several bands visible at once.
 *
 * So: the same wind, one octave finer. Same direction, same clock, same
 * downwind travel — it is the turbulent spectrum of the one wind, not a second
 * wind — at 2π/WAVE_K ≈ 15 m spacing moving at WAVE_W/WAVE_K ≈ 6.9 m/s, which
 * is slower than the 11 m/s gust fronts so the two scales beat against each
 * other instead of locking into one scrolling texture.
 *
 * `sin(a + sin(b) * 1.6)` rather than `sin(a) + sin(b)`: phase-modulating along
 * the crest BENDS it. Real wind waves are curved bands with ragged ends, and
 * additive cross terms give you a checkerboard instead.
 *
 * Duplicated verbatim in WIND_GLSL, same as the gust constants.
 */
const WAVE_K = 0.42;       // 1/m along the wind — crests ≈ 15 m apart
const WAVE_W = 2.9;        // rad/s — crests travel at WAVE_W/WAVE_K ≈ 6.9 m/s
const WAVE_CROSS = 0.115;  // 1/m across the wind — crests bend every ~55 m

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

  /**
   * The fine scale, in [-1, 1]: the bands of laid-over cover that cross a field
   * every fifteen metres. Signed, so a crest lays the grass down and a trough
   * lets it stand back up.
   */
  wave(x, z, t = this.time) {
    const a = (x * this.dir.x + z * this.dir.y) * WAVE_K - t * WAVE_W;
    const b = (-x * this.dir.y + z * this.dir.x) * WAVE_CROSS;
    return Math.sin(a + Math.sin(b) * 1.6) * 0.62
         + Math.sin(a * 0.61 - b * 1.3 + 2.1) * 0.38;
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
  float windWave(vec2 p){
    vec2 D = uWind.xy;
    float a = dot(p, D) * ${WAVE_K.toFixed(6)} - uWind.w * ${WAVE_W.toFixed(6)};
    float b = dot(p, vec2(-D.y, D.x)) * ${WAVE_CROSS.toFixed(6)};
    return sin(a + sin(b) * 1.6) * 0.62
         + sin(a * 0.61 - b * 1.3 + 2.1) * 0.38;
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
  if (uniforms.uStorm) weather.writeUniform(uniforms.uStorm.value);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Weather                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Weather is an EVENT THAT ARRIVES, not a slider somebody left half-way up.
 *
 * A static particle field at a fixed density is the thing every procedural
 * outdoor scene does and the thing that reads, instantly, as decoration: it is
 * the same in the first second and the ten-thousandth, so the eye files it as
 * texture and stops seeing it. What makes weather read as weather is that it
 * has a BEFORE and an AFTER — the air goes still, then a line of dust comes up
 * out of the distance, the light goes flat and brown as it crosses you, the far
 * ridges disappear, and twenty seconds later they are back.
 *
 * So this is a scheduler, and everything else in the frame is downstream of it:
 *
 *   · the wind gets stronger and gustier, which drives the grass, the sand
 *     sheets, the smoke and the embers — all of them read the one WindField;
 *   · the fog thickens, which is what actually cuts visibility. Measured as the
 *     range at which half the light survives: the dune sea sits at 198 m calm
 *     and 47 m at the peak of a squall;
 *   · the sun loses half its punch and takes the colour of what is in the air,
 *     while the sky fill comes UP — a dust storm is not a dimmer, it is a
 *     conversion of direct light into ambient;
 *   · the dust layers thicken and the fog banks close in.
 *
 * And the front TRAVELS. `frontOffset` is the leading edge's position along the
 * wind axis relative to the camera, in metres: it starts well upwind, crosses
 * you at the wind's own front speed and carries on downwind. Anything that can
 * read a position asks `localAt` and gets a wall of dust that is somewhere
 * else, then here, then gone — rather than a global fade.
 */
const FRONT_SPEED = GUST_W / GUST_K;    // 11.3 m/s, the gust fronts' own speed
const FRONT_REACH = 300;                // metres up/downwind a squall is tracked over
const SQUALL_RISE = 0.24;               // share of a pass spent building; the rest is the tail
/* Terrain._syncAtmosphere reads `fog.density > 0.01` as "this is an interior"
 * and drops the ground's sky-blend haze to zero. Nothing may push the fog over
 * that line at runtime. See _applyWeather. */
const FOG_INDOOR_LIMIT = 0.0098;

export class Weather {
  constructor(opts = {}) {
    this.time = 0;
    this.configure(opts);
  }

  configure(opts = {}) {
    // A squall every two minutes, taking forty seconds to pass. Long enough
    // that calm is the normal state and the storm is an event; short enough
    // that a player sees one inside a wave or two.
    this.period = opts.period ?? 124;
    this.duration = opts.duration ?? 42;
    this.peak = clamp(opts.peak ?? 0, 0, 1);        // 0 = this level has no weather
    // The air is never perfectly still. A slow, bounded unrest keeps the calm
    // between fronts from being a flat line — which is its own kind of tell.
    this.unrest = clamp(opts.unrest ?? 0.14, 0, 0.6);
    // Where in the cycle the level starts. Not zero: loading straight into the
    // teeth of a storm is a worse first impression than loading into calm.
    this.phase = opts.phase ?? 0.55;
    this.span = opts.span ?? 85;                    // depth of the leading wall, metres
    // How much of each downstream quantity the peak of a squall is worth.
    this.fogGain = opts.fogGain ?? 3.2;             // × the level's own fog density
    this.windGain = opts.windGain ?? 2.4;           // × the level's own wind speed
    this.sunLoss = clamp(opts.sunLoss ?? 0.50, 0, 0.9);
    this.fillGain = opts.fillGain ?? 0.55;
    this.intensity = 0;
    this.frontOffset = -FRONT_REACH;
    return this;
  }

  /** Seconds into the current cycle. */
  _cycle() {
    const u = (this.time / this.period + this.phase) % 1;
    return (u < 0 ? u + 1 : u) * this.period;
  }

  /**
   * The envelope of one pass. Asymmetric on purpose: a squall line hits in a
   * few seconds and takes a long time to blow itself out, so the rise is a
   * quarter of the pass and the tail is the rest. A symmetric bump reads as a
   * fade-in/fade-out, which is a transition, not weather.
   */
  _envelope() {
    if (this.peak <= 0) return 0;
    const u = this._cycle();
    if (u > this.duration) return 0;
    const t = u / this.duration;
    return t < SQUALL_RISE
      ? smooth01(t / SQUALL_RISE)
      : 1 - smooth01((t - SQUALL_RISE) / (1 - SQUALL_RISE));
  }

  update(dt) {
    this.time += dt;
    const e = this._envelope();
    // unrest rides underneath, never on top: the peak of a squall is 1, not 1.14
    const calm = this.unrest * (0.5 + 0.5 * Math.sin(this.time * 0.061 + 1.9));
    this.intensity = this.peak * clamp(e + calm * (1 - e), 0, 1);
    /* The leading edge sweeps from upwind to downwind at the speed the gust
     * fronts travel — it IS a gust front, the one at the head of the squall.
     *
     * It is zeroed on the PEAK of the envelope, not on the start of the pass.
     * Anchored to the start, the wall reached the camera at u = 38.8 s of a 40 s
     * pass, by which time the envelope had decayed to 0.005: the storm blew
     * itself out before its own front arrived, so the wall was never once
     * visible over the player. Measured, and the reason this line has an
     * offset in it at all. */
    const u = this._cycle();
    this.frontOffset = clamp((u - this.duration * SQUALL_RISE) * FRONT_SPEED,
      -FRONT_REACH, FRONT_REACH);
    return this;
  }

  /**
   * How much dust is in the air at a point, relative to the camera. Ahead of
   * the leading edge the air is clear; behind it the wall has arrived. `span`
   * is how deep the leading wall is, so the transition takes span/FRONT_SPEED
   * ≈ 7.5 seconds to cross you.
   */
  localAt(dx, dz) {
    if (this.intensity <= 0) return 0;
    const s = dx * wind.dir.x + dz * wind.dir.y;
    // 1 well behind the front, 0 ahead of it
    const lead = 1 - smooth01((s - (this.frontOffset - this.span)) / this.span);
    return this.intensity * (0.25 + 0.75 * lead);
  }

  /**
   * Metres at which half the light from a surface survives the haze, given the
   * level's own base fog density. This is what "cuts visibility" MEANS, and it
   * is the number to quote — density is not legible on its own.
   */
  visibility(baseDensity) {
    const d = Math.max(baseDensity,
      Math.min(FOG_INDOOR_LIMIT, baseDensity * (1 + this.fogGain * this.intensity)));
    return Math.sqrt(Math.LN2) / Math.max(1e-6, d);
  }

  /** (intensity, frontOffset, wallSpan, time) for a shader that wants the wall. */
  writeUniform(v4) { return v4.set(this.intensity, this.frontOffset, this.span, this.time); }
}

/** The one weather every system reads. Import it; do not make another. */
export const weather = new Weather();

/**
 * GLSL twin of `Weather.localAt`. Needs `uWind` in scope (WIND_GLSL declares
 * it), and declares `uStorm` = (intensity, frontOffset, wallSpan, time).
 */
export const STORM_GLSL = /* glsl */`
  uniform vec4 uStorm;         // intensity, front offset (m), wall span (m), time
  float stormAt(vec2 rel){
    float s = dot(rel, uWind.xy);
    float lead = 1.0 - smoothstep(uStorm.y - uStorm.z, uStorm.y, s);
    return uStorm.x * (0.25 + 0.75 * lead);
  }
`;

/** Fresh uniform object for a material that includes STORM_GLSL. */
export function stormUniforms() {
  return { uStorm: { value: new THREE.Vector4(0, -FRONT_REACH, 85, 0) } };
}

function smooth01(t) {
  const x = t < 0 ? 0 : (t > 1 ? 1 : t);
  return x * x * (3 - 2 * x);
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
  weather,         // the one squall scheduler — read `.intensity`, never set it
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
  uniform float uWaveGain;
  uniform sampler2D uTrail;
  uniform vec2 uTrailCenter;
  uniform float uTrailSize;

  varying vec2 vUv;
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vCut;
  varying float vWave;

  void main(){
    vUv = uv;
    vTint = aTint;
    vWave = 0.0;
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
    // ── the wave. Fifteen-metre bands of the SAME wind, travelling downwind:
    // this is what turns ten thousand blades wobbling on their own timers into
    // a field the wind is crossing. The per-tuft factor spreads the crest over
    // a metre or so of ground so its edge is soft rather than a drawn line.
    float wv = windWave(base.xz) * (0.75 + aOrient.w * 0.5);
    vWave = wv;
    float lay = 1.0 + uWaveGain * wv;      // stays positive for uWaveGain < 0.8
    float flutter = sin(uTime * (5.0 + aOrient.w * 4.0) + aOrient.w * 6.2831) * 0.09
                  * (0.25 + wmag);

    vec2 bv = wdir * (uBendGain * wmag * lay + flutter)
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
  uniform float uWaveGain;
  uniform sampler2D uTrail;
  uniform vec2 uTrailCenter;
  uniform float uTrailSize;

  varying vec2 vUv;
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vCut;
  varying float vWave;

  void main(){
    // A tuft is many blades, so the sprite tiles across the card and each
    // instance starts at its own phase — otherwise every clump in the field is
    // visibly the same four blades.
    vUv = vec2(uv.x * 3.0 + aOrient.w * 4.0, uv.y);
    vTint = aTint;
    vWave = 0.0;
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
    // The far ring is where the wave earns its keep: it spans 46 m, which is
    // three crests of the fine scale, so several bands are visible at once and
    // you can watch one travel. The near ring only ever holds half of one.
    float wv = windWave(base.xz) * (0.75 + aOrient.w * 0.5);
    vWave = wv;
    float lay = 1.0 + uWaveGain * wv;
    vec2 bv = wdir * (uBendGain * wmag * 0.8 * lay
                      + sin(uTime * 2.2 + aOrient.w * 6.2831) * 0.06 * wmag)
            + shove * (press * 1.8);
    // CLAMPED, and the geometry ring's min(bend, 2.0) is the same guard for
    // the same reason. This term is linear in wind speed and the weather takes
    // the wind from 1.7 to 6.1 m/s: measured, the tip of a half-metre tuft went
    // from 0.33 m of lean (34°, fine) to 1.36 m — nearly three times its own
    // height, which is not a tuft leaning, it is a tuft being dragged along the
    // ground. 3.4 caps the tip at 1.7 × the height, i.e. 60° over.
    float bmag = length(bv);
    if(bmag > 3.4) bv *= 3.4 / bmag;
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
    float widen = 0.55 + 0.95 * (d / uFar);
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
  uniform float uSheen;
  uniform float uSheenLift;

  varying vec2 vUv;
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vCut;
  varying float vWave;

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

    // ── the wave, as LIGHT. Wind crossing a field is legible from a hundred
    // metres, and almost none of that is the motion: a band of blades laid over
    // shows you its pale underside and its sheen at the same moment, so the
    // wave travels as a bright ripple across the sward. Derived from the
    // blade's OWN colour — desaturated toward its luminance and lifted — so
    // per-blade variation survives instead of the crest going one flat silver.
    float lay = clamp(vWave * 0.5 + 0.5, 0.0, 1.0);
    vec3 silver = mix(albedo, vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722))), 0.45)
                * uSheenLift;
    albedo = mix(albedo, silver, lay * uSheen * smoothstep(0.10, 0.75, vHeight));

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
    this.nearRadius = Math.min(opts.nearRadius ?? 7.5, this.radius * 0.5);
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

    // The ground has to know it is covered. Litter is the darker, browner end
    // of the living blade, never the blade colour itself — soil under grass is
    // not green, it is what green rots into.
    if (terrain && terrain.setGroundCover) {
      const litter = this.tintB.clone().lerp(this.dry, 0.55).multiplyScalar(0.46);
      terrain.setGroundCover(clamp(0.62 * density, 0, 0.8), litter, 30);
    }

    this._buildTrail();

    // Most of the instances go to the near ring, which is deliberately small.
    // What decides whether a field reads as COVER or as spikes stuck in a beach
    // is the fraction of the ground its silhouette covers, and that is the
    // instance budget divided by the ring's area. At a 10 m ring and half the
    // budget the near field covered 6.8% of its own ground — nine parts bare
    // sand to one part grass, which no amount of blade detail can rescue.
    // Pulling the ring in to 7.5 m and taking 60% of the budget is 2.8× the
    // areal density for nothing; the card ring picks up where it stops.
    const nearCount = Math.max(1, Math.round(total * 0.6));
    const farCount = Math.max(1, total - nearCount);

    this.near = this._buildRing({
      count: nearCount, card: false,
      geometry: bladeGeometry(4),
      near: 0, far: this.nearRadius,
      // The near ring is 7.5 m across — half a wave crest — so a strong sheen
      // there is a band sliding over your boots rather than a field moving.
      // The bend still carries the full wave; only the light is held back.
      width: 0.070, bendGain: 0.23, waveGain: 0.62, sheen: 0.30, translucency: 0.9,
    });
    this.far = this._buildRing({
      count: farCount, card: true,
      geometry: new THREE.PlaneGeometry(1, 1, 1, 2),
      near: this.nearRadius * 0.66, far: this.radius,
      width: 1.05, bendGain: 0.34, waveGain: 0.62, sheen: 0.55, translucency: 0.55,
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

  _buildRing({ count, card, geometry, near, far, width, bendGain, waveGain, sheen, translucency, map }) {
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
      // How deep the wave modulates the bend. Below 0.8 `1 + gain·wave` cannot
      // go negative, which would flip the crest of every band upwind.
      uWaveGain: { value: waveGain ?? 0.62 },
      uSheen: { value: sheen ?? 0.5 },
      uSheenLift: { value: 1.7 },
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
    // Tuft ANCHORS go inside the annulus by half a tuft, so the blades that
    // scatter around them still land inside the ring their shader fades. A
    // blade outside its own ring is a blade the fade never reaches.
    const outer = Math.max(inner + 0.5, ring.far - (ring.card ? 0.75 : 0.26) * 0.5);
    const span = outer * outer - inner * inner;
    const waterLine = ground.water ? ground.water.level : null;
    // A tuft of six blades in a 11 cm circle, one every half metre, is exactly
    // what "isolated spikes" looks like from standing height. Ten blades over
    // 26 cm puts the tufts within touching distance of each other, which is
    // where a scatter stops reading as dots and starts reading as sward.
    const perTuft = ring.card ? 3 : 10;
    const spread = ring.card ? 0.75 : 0.26;

    let left = 0, tx = 0, tz = 0, density = 0, live = false, lean = 0, inTuft = 0;
    for (let i = 0; i < ring.count; i++) {
      if (left <= 0) {
        inTuft = 0;
        // Three tries at a site before giving up on the tuft. A third of the
        // far ring's budget used to be spent on instances that landed on a
        // cliff or in the river and rendered as nothing at all — the field paid
        // for them and the player never saw them. Retrying puts them where
        // grass would actually be, and three tries is few enough that ground
        // which is genuinely hostile still comes out bare.
        for (let attempt = 0; attempt < 3; attempt++) {
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
          if (live) break;
        }
        lean = 0.16 + rng() * 0.42;      // a tuft leans together, not per blade
        left = perTuft;
      }
      left--;
      inTuft++;

      // Blades crowd the middle of their tuft and thin out at its skirt, which
      // is what gives a clump a soft edge instead of a hard disc of spikes.
      const rr = Math.sqrt(rng()) * 0.5 * spread;
      const ra = rng() * TAU;
      const x = tx + Math.cos(ra) * rr;
      const z = tz + Math.sin(ra) * rr;
      const y = this.terrain ? this.terrain.height(x, z) : 0;
      // Height matters more than it looks. A 1.4m blade beside a 1.78m
      // character reads as scratchy weeds however many of them there are;
      // knee-high and packed reads as ground cover. Cap it well under the knee.
      // Blade geometry spans v = 0..1, so these ARE metres, not a multiplier.
      // At 0.30 + 0.34 the median blade stood 0.51m and the top 5% reached
      // 0.87m — thigh-high on a 1.78m character. Sparse AND that tall reads as
      // scratchy weeds rather than ground cover. Pasture is ankle-to-knee; the
      // wet margin still earns its taller reeds from the density term above.
      const base = ring.card ? 0.26 : 0.20;
      const varies = ring.card ? 0.26 : 0.26;
      // A third of every tuft is sward: short blades filling the base, which is
      // the part of a clump the eye actually reads density from. All blades the
      // same height gives a bristle brush.
      const shortling = !ring.card && (inTuft % 3) === 0 ? 0.48 : 1;
      const scale = live
        ? (base + rng() * varies) * clamp(density * 1.8, 0.5, 1.15) * shortling
        : 0;

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
    this.terrain?.setGroundCover?.(0);
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
  uniform vec3 uBed;                        // what the bed looks like through 10cm
  uniform vec4 uRipples[${MAX_RIPPLES}];    // world x, world z, start time, strength
  uniform float uRippleActive;
  #ifdef WATER_DEPTH
    uniform sampler2D uDepth;
    uniform vec3 uField;                    // 1/size, half extent, depth range (m)
  #endif
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

    /*
     * How deep the water is here, read off a byte-per-texel map of the bed.
     * Without it the river is one flat sheet that meets the sand along a hard
     * straight line, which is the single thing that gives away a water plane:
     * a real edge is where the depth goes to zero, so it wanders with the bed,
     * fades out instead of stopping, and has a lap of foam running along it.
     */
    float depth = 4.0;
    #ifdef WATER_DEPTH
      depth = texture2D(uDepth, vW.xz * uField.x + 0.5).r * uField.z;
    #endif

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
    // Beer's law, near enough: the colour is what is LEFT of the bed after the
    // water has taken its bite out of it, so an inch of river reads as wet
    // gravel and a metre reads as river.
    float dw = 1.0 - exp(-depth * 1.5);
    vec3 body = mix(uShallow, uDeep, 1.0 - exp(-depth * 0.55));
    vec3 col = mix(uBed, body, dw);
    /*
     * What the surface mirrors. Seen along the water — which is how you always
     * see a river — a level facet reflects the sky and a tilted one reflects
     * whatever is standing on the far bank, so a real river reads as bands of
     * bright and dark travelling with the ripples. Reflecting only the sky
     * gives one flat sheet of milk, which is what this was.
     */
    float facet = smoothstep(0.90, 0.999, N.y);
    // and what it mirrors along the water is the HORIZON, not the zenith: the
    // reflected ray at a grazing angle leaves nearly level and lands on the far
    // bank, so it comes back the colour of the distance. Reflecting the sky
    // tint made the whole river read 93% as bright as the sky — a sheet of
    // milk with a shoreline drawn on it.
    vec3 mirror = mix(uDeep * 1.35, mix(fogColor, uSky, 0.45), facet);
    // capped well under 1: a rough surface never mirrors cleanly, and leaving
    // a third of the body colour showing is what gives the channel a spine
    col = mix(col, mirror, fres * 0.62 * (0.45 + dw * 0.55));
    float spec = pow(max(dot(reflect(-normalize(uSunDir), N), V), 0.0), 90.0);
    col += vec3(1.0,0.95,0.85) * spec * 2.4 * (0.4 + dw * 0.6);

    // The lap: a band of broken water that follows the shoreline contour,
    // travelling up the beach and back. It is the thing that says "this is a
    // river running over that", and it costs one noise.
    float shore = smoothstep(0.30, 0.03, depth) * smoothstep(0.0, 0.025, depth);
    float lap = sin(depth * 26.0 - uTime * 1.9 + vnoise(vW.xz * 0.55) * 8.0) * 0.5 + 0.5;
    // The long swell used to throw foam wherever it crested, which on a 580 m
    // sheet with a 20 m swell is white blobs the size of a barge. Ankle-deep
    // rivers do not have whitecaps; they have a lap at the edge.
    float foam = smoothstep(0.08, 0.15, abs(vWave)) * 0.045
               + clamp(foamRing, 0.0, 1.4) * 0.5
               + shore * (0.26 + lap * 0.60);
    col += foam;
    // and the edge itself is where the depth runs out, not where the sheet does
    float edge = smoothstep(0.0, 0.06, depth);
    gl_FragColor = vec4(col, clamp((0.40 + dw * 0.46 + fres*0.14 + foamRing*0.25 + shore * 0.25)
                                   * edge, 0.0, 1.0));
    #include <fog_fragment>
  }
`;

/** Metres of water the depth map can describe. 3 m is a river, not an ocean. */
const WATER_DEPTH_RANGE = 3.0;
const WATER_DEPTH_RES = 256;

export class Water {
  constructor(scene, opts = {}) {
    const size = opts.size ?? 520;
    const geo = new THREE.PlaneGeometry(size, size, 96, 96);
    this.time = 0;
    this._ripple = 0;
    this.level = opts.level ?? 0;
    const ripples = [];
    for (let i = 0; i < MAX_RIPPLES; i++) ripples.push(new THREE.Vector4(0, 0, -99, 0));

    // The bed. Everything interesting about a river — where its edge is, how
    // the colour deepens, where the lap breaks — is a function of depth, and
    // depth is the terrain the sheet is lying on.
    const terrain = opts.terrain ?? ground.terrain;
    this._bakeDepth(terrain);

    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      defines: this.depthTex ? { WATER_DEPTH: '' } : {},
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: true,
    });
    Object.assign(this.mat.uniforms, {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(opts.shallow ?? 0x2f7f96) },
      uDeep: { value: new THREE.Color(opts.deep ?? 0x0c2a3c) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
      uSky: { value: new THREE.Color(opts.sky ?? 0x9fc4e4) },
      // what you see through an inch of it: the wet bed, not the water
      uBed: { value: new THREE.Color(opts.bed ?? 0x6b5a41) },
      uRipples: { value: ripples },
      uRippleActive: { value: 0 },
    });
    if (this.depthTex) {
      this.mat.uniforms.uDepth = { value: this.depthTex };
      this.mat.uniforms.uField = {
        value: new THREE.Vector3(1 / this._fieldSize, this._fieldSize * 0.5, WATER_DEPTH_RANGE),
      };
    }
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = this.level;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    ground.water = this;
  }

  /**
   * One byte per texel of "how deep is it here", clamped to 3 m. A byte is
   * 1.2 cm of resolution, which is finer than the shoreline band it is there
   * to draw, and it filters linearly — a packed float would not.
   *
   * Clamped at the edges on purpose: past the heightfield the map holds
   * whatever the rim held, so the river runs off the map instead of stopping
   * at a line.
   */
  _bakeDepth(terrain) {
    this.depthTex = null;
    if (!terrain || typeof terrain.height !== 'function' || !(terrain.size > 0)) return;
    const N = WATER_DEPTH_RES;
    this._fieldSize = terrain.size;
    const half = terrain.size / 2;
    const data = new Uint8Array(N * N);
    let wet = 0;
    // texel centres, so uv = world/size + 0.5 lands exactly on the sample
    for (let j = 0; j < N; j++) {
      const z = -half + ((j + 0.5) / N) * terrain.size;
      for (let i = 0; i < N; i++) {
        const x = -half + ((i + 0.5) / N) * terrain.size;
        const d = clamp((this.level - terrain.height(x, z)) / WATER_DEPTH_RANGE, 0, 1);
        data[j * N + i] = Math.round(d * 255);
        if (d > 0) wet++;
      }
    }
    // A sheet with no bed under it anywhere is a level whose "water" is a
    // decoration; leave it on the flat path rather than paying for a map.
    if (wet === 0) return;
    this.wetFraction = wet / (N * N);
    const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    this.depthTex = tex;
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
    this.depthTex?.dispose();
    this.depthTex = null;
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
 * Fog banks, and the wall of a dust storm — the same object, because they are
 * the same thing at two densities.
 *
 * `Haze` above is a ring of very soft cards parked at distance: it gives the
 * far field structure, but it never arrives, never leaves, and never gets
 * between you and anything. What a squall needs is banks that are IN the world:
 * big, low, drifting downwind at the wind's own speed, wrapping through a box
 * around the camera so one is always coming and one is always going, and dense
 * enough at the peak of a front to take the far ridges out entirely.
 *
 * The arrival is spatial, not a global fade — `stormAt` gives each bank the
 * dust load at its own position relative to the leading edge, so the wall comes
 * up out of the upwind distance, crosses you over about seven seconds, and
 * leaves the downwind side still clear behind it.
 */
class FogBank {
  constructor(scene, opts) {
    this.count = Math.max(0, Math.floor(opts.count ?? 0));
    if (this.count <= 0) { this.mesh = null; return; }
    this.span = opts.span ?? 220;
    const r = makeRng(opts.seed ?? 5150);

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    geo.instanceCount = this.count;

    const aHome = new Float32Array(this.count * 4);   // x, y, z, width
    const aSeed = new Float32Array(this.count * 4);   // seed, drift, aspect, calm share
    for (let i = 0; i < this.count; i++) {
      aHome[i * 4] = (r() - 0.5) * this.span;
      // Banks lie ON the ground. A fog bank whose centre is twenty metres up is
      // a cloud, and a cloud at eighty metres reads as a bug.
      aHome[i * 4 + 1] = 1.5 + r() * 9;
      aHome[i * 4 + 2] = (r() - 0.5) * this.span;
      aHome[i * 4 + 3] = 26 + r() * 52;
      aSeed[i * 4] = r();
      // The drift is a fraction of the wind: a bank is a body of air, so it
      // travels WITH the wind, a little slower than the sand skimming under it.
      aSeed[i * 4 + 1] = 0.35 + r() * 0.35;
      aSeed[i * 4 + 2] = 0.22 + r() * 0.20;          // height as a share of width
      // Only a third of the banks exist in fair weather; the rest are the storm.
      aSeed[i * 4 + 3] = i % 3 === 0 ? 1 : 0;
    }
    geo.setAttribute('aHome', new THREE.InstancedBufferAttribute(aHome, 4));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 4));

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
    Object.assign(uniforms, windUniforms(), stormUniforms(), {
      uMap: { value: opts.map || smokeSprite(128) },
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uSpan: { value: this.span },
      uColor: { value: new THREE.Color(opts.color ?? 0xc9b391) },
      uDust: { value: new THREE.Color(opts.dust ?? 0xc9b391) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
      uOpacity: { value: opts.opacity ?? 0.10 },
      uGround: { value: 0 },
    });

    this.mat = new THREE.ShaderMaterial({
      // Fogged like everything else. A fair-weather bank is already the haze's
      // own colour so the fog is a no-op on it, but a DUST wall is not — it is
      // the ground's colour, and a wall of it a hundred metres off has to lose
      // that colour to the air in front of it exactly as a wall of rock would.
      uniforms, fog: true,
      vertexShader: /* glsl */`
        #include <common>
        #include <fog_pars_vertex>
        ${WIND_GLSL}
        ${STORM_GLSL}
        attribute vec4 aHome; attribute vec4 aSeed;
        uniform float uTime; uniform vec3 uCenter; uniform float uSpan; uniform float uGround;
        uniform vec3 uSunDir;
        varying vec2 vUv; varying float vA; varying float vSun; varying float vDust;
        void main(){
          vUv = uv;
          vec3 home = aHome.xyz;
          vec3 w = windAt(home.xz + uCenter.xz);
          vec3 p = home;
          p.xz += w.xz * uTime * aSeed.y;
          // one box, wrapped, so a bank leaving downwind is the bank arriving upwind
          p.xz = mod(p.xz - uCenter.xz + uSpan * 0.5, uSpan) - uSpan * 0.5 + uCenter.xz;
          p.y = uGround + home.y;

          vec2 rel = p.xz - uCenter.xz;
          float storm = stormAt(rel);
          vDust = storm;
          // A bank is either fair-weather haze or storm dust; the fair ones stay
          // when the front has gone, the rest exist only while it is passing.
          float load = max(aSeed.w * 0.55, storm);
          if(load < 0.004){
            // Every vertex of an instance takes the same branch, so the whole
            // quad leaves the clip volume together and is never rasterised.
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vA = 0.0; vSun = 0.0;
            #ifdef USE_FOG
              vFogDepth = 0.0;
              vFogRay = vec3(0.0);
            #endif
            return;
          }

          // The wall is TALLER than the haze — that is most of what says storm.
          float wide = aHome.w * (1.0 + storm * 0.55);
          float tall = wide * aSeed.z * (1.0 + storm * 1.10);
          vec3 camRight = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
          vec3 camUp    = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
          p += camRight * (position.x * wide) + camUp * (position.y * tall);

          float dist = length(p.xz - uCenter.xz);
          // Nothing inside arm's reach: standing inside a 40 m billboard is a
          // grey screen, not fog. It has to hold off until it can be seen edge-on.
          // Nothing reaches full strength inside 34 m. That is the whole of
          // keeping a squall playable: the fight happens within about thirty
          // metres, so the wall closes the DISTANCE and leaves sword range
          // readable. A bank that can go opaque at 20 m is a grey screen.
          vA = load
             * smoothstep(8.0, 34.0, dist)
             * (1.0 - smoothstep(uSpan * 0.34, uSpan * 0.49, dist));
          vec3 toBank = normalize(vec3(rel.x, 0.3, rel.y));
          vSun = pow(clamp(dot(toBank, normalize(uSunDir)), 0.0, 1.0), 3.0);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          #include <fog_vertex>
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uMap; uniform vec3 uColor; uniform vec3 uDust;
        uniform vec3 uSunColor; uniform float uOpacity;
        varying vec2 vUv; varying float vA; varying float vSun; varying float vDust;
        void main(){
          float t = texture2D(uMap, vUv).a;
          float a = t * vA * uOpacity;
          if(a < 0.002) discard;
          // Fair-weather banks are the colour of the haze; a dust wall is the
          // colour of the ground it picked up, which is warmer and darker.
          vec3 c = mix(uColor, uDust, clamp(vDust, 0.0, 1.0));
          gl_FragColor = vec4(mix(c, uSunColor, vSun * 0.45) * (1.0 + vSun * 0.5), a);
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    // between the far haze ring (2) and the near motes (6): banks stand in
    // front of the distance and behind the dust in your face
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }
  update(t, center, sunColor, sunDir) {
    if (!this.mesh) return;
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uCenter.value.copy(center);
    u.uGround.value = center.y;
    if (sunColor) u.uSunColor.value.copy(sunColor);
    if (sunDir) u.uSunDir.value.copy(sunDir);
    syncWind(u);
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

/* ══════════════════════════════════════════════════════════════════════ */
/*  The land beyond the land                                              */
/* ══════════════════════════════════════════════════════════════════════ */

/*
 * The heightfield is 460–560 m across and the camera can see 520–900. So the
 * player CAN see the edge of the world, and no amount of fog on the terrain
 * itself hides it, because what gives the edge away is not brightness — it is
 * that past a certain range there is nothing with a silhouette. The sky dome
 * draws ridges, but they are painted at infinity: they do not move as you walk,
 * which the eye reads within about ten seconds.
 *
 * These are the same ridges as real geometry, at 170 / 250 / 340 m. That is
 * three things at once:
 *
 *   · PARALLAX. Walk fifty metres and the near range slides against the far
 *     one. That single cue is what separates "a world" from "a backdrop", and
 *     it is why this is geometry rather than another band on the dome.
 *   · LAYERS. Three ranges at three distances go through three different
 *     amounts of air, so the fog sorts them into three tones by itself. Nothing
 *     here paints that gradient by hand — it emerges, which means it stays
 *     right when a level changes its haze.
 *   · SCALE. The far range is 40–95 m tall. Nothing inside the play space is
 *     over 20 m, so it cannot be read as near, and something that cannot be
 *     read as near makes everything in front of it read as closer.
 *
 * One mesh per range, no colliders, no shadows, no physics: three draw calls
 * and about 2.3k triangles for the entire far distance.
 */
let _ridgeMat = null;
function ridgeMaterial() {
  if (_ridgeMat) return _ridgeMat;
  // Basic, not standard: this is terrain seen through a kilometre of air, and
  // at that range the only thing that survives is its mean radiance and the
  // haze in front of it. Lighting it properly would cost the same and change
  // nothing. `fog: true` picks up the engine's aerial-perspective chunk, which
  // is what does all the actual work here.
  _ridgeMat = new THREE.MeshBasicMaterial({
    vertexColors: true, fog: true, side: THREE.DoubleSide,
    // three feeds this to any geometry missing the attribute; without it a
    // vertexColors material renders black.
    depthWrite: true,
  });
  _ridgeMat.defaultAttributeValues = { color: [1, 1, 1] };
  return _ridgeMat;
}

/**
 * Build the far ranges. Pushes its meshes into `world.statics`, so the World's
 * own unload disposes them; the material is shared and cached, exactly as the
 * prop kit's are.
 *
 * @param {object} opts.layers   [{ radius, low, high, shade }]
 * @param {number} opts.seed
 */
export function addHorizon(world, opts = {}) {
  const scene = world.scene;
  const terrain = world.terrain;
  // The colour to converge on. scene.fog carries the engine's metered haze
  // RADIANCE, which is the only value in the frame in the right units — an
  // authored sRGB swatch used here would be a dark band under a bright sky,
  // which is the exact failure SkyDome.setHaze exists to avoid.
  const haze = fogColorOf(scene, new THREE.Color());
  const sun = opts.sunDir || sceneLights(scene).sun?.position || new THREE.Vector3(0.4, 0.7, 0.3);
  const sx = sun.x, sz = sun.z;
  const sl = Math.hypot(sx, sz) || 1;

  const layers = opts.layers || [
    { radius: 172, low: 13, high: 34, shade: 0.55 },
    { radius: 248, low: 24, high: 58, shade: 0.62 },
    { radius: 342, low: 40, high: 96, shade: 0.70 },
  ];
  const seed = opts.seed ?? 4400;
  const out = [];

  for (let L = 0; L < layers.length; L++) {
    const cfg = layers[L];
    const R = cfg.radius;
    // One vertex every ~2.4 m of arc: fine enough that a 40 m crest has a
    // dozen samples across it and coarse enough to stay under a thousand
    // triangles a range.
    const seg = Math.max(96, Math.min(256, Math.round((TAU * R) / 2.4)));
    const pos = new Float32Array((seg + 1) * 2 * 3);
    const col = new Float32Array((seg + 1) * 2 * 3);
    const idx = [];
    /* The noise is sampled at the ring's own WORLD position, so the profile
     * closes on itself seamlessly and no two ranges share a skyline.
     *
     * The frequency is set by how many peaks should go round the ring, not by a
     * fixed 1/metres — and that is a correction, not a nicety. A fixed
     * 0.0062/m put a 161 m feature on a 1055 m circumference: SIX AND A HALF
     * peaks around the entire horizon, each spanning 55° of bearing. On screen
     * that is a row of clean paper triangles, which is exactly what the first
     * screenshot showed. Fourteen to twenty-two peaks puts each one at 16-26°,
     * which is what a range actually subtends. */
    const peaks = 14 + L * 4;
    const f = peaks / (TAU * R);
    const off = seed * 0.37 + L * 91.3;

    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const cx = Math.cos(a), cz = Math.sin(a);
      const x = cx * R, z = cz * R;
      // Ridged noise, not fbm: mountains have sharp crests and broad saddles,
      // and fbm gives you rolling lumps that read as spoil heaps. But ridged
      // noise ALONE is a cone — the weights below keep the sum off its own
      // ceiling (at ×1.15 it clamped to 1 across whole peaks, which flat-tops
      // them) and two finer octaves tear the silhouette so no crest is a
      // straight line from saddle to summit.
      const rr = ridged2(x * f + off, z * f - off, 4);
      const fine = fbm2(x * f * 3.7 - off, z * f * 3.7 + off, 3);
      const rag = fbm2(x * f * 11.0 + off, z * f * 11.0 - off, 2);
      const h = lerp(cfg.low, cfg.high, clamp(rr * 0.90 + fine * 0.45 + rag * 0.16, 0, 1));
      const g = terrain ? terrain.height(x, z) : 0;
      const yb = g - 45;          // rooted deep, so nothing ever shows under it
      const yt = g + h;

      // Slopes facing the sun catch a little more of it. Squared, so it is a
      // side and not a gradient across the whole ring.
      const lit = Math.max(0, (cx * sx + cz * sz) / sl);
      const k = 1 + lit * lit * 0.16;
      // The FOOT of a distant range is paler than its crest: there is more of
      // the low haze between you and it. Everything else about the tonal
      // separation between ranges is left to the fog, which already knows how
      // far away each one is.
      //
      // Both are capped BELOW 1, and that is not a safety belt — it is the
      // physics. These are passive surfaces behind a scattering medium, so
      // they cannot hand back more light than the haze they are dissolving
      // into. Uncapped, the canyon's far range came out at 1.09 × the fog and
      // measured brighter than the sky standing over it.
      const cap = 0.95;
      const cTop = Math.min(cap, cfg.shade * k);
      const cBot = Math.min(cap, cfg.shade * 1.42 * k);
      for (let s = 0; s < 2; s++) {
        const v = (i * 2 + s) * 3;
        pos[v] = x; pos[v + 1] = s ? yt : yb; pos[v + 2] = z;
        const c = s ? cTop : cBot;
        col[v] = haze.r * c; col[v + 1] = haze.g * c; col[v + 2] = haze.b * c;
      }
      if (i < seg) {
        const b0 = i * 2, t0 = i * 2 + 1, b1 = b0 + 2, t1 = t0 + 2;
        idx.push(b0, b1, t0, t0, b1, t1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, ridgeMaterial());
    // The ring encloses the camera, so its bounding sphere can never be culled
    // — the test is pure cost. The matrix is identity and stays that way, but
    // it is composed once explicitly rather than relying on the default.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    // 170-340 m is far outside the shadow cascade (42-96 m depending on tier),
    // so neither casting nor receiving would do anything but cost.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Behind everything in the world and in front of the sky. Depth still
    // decides the actual order; this only keeps it out of the sorted-transparent
    // conversation it has no business being in.
    mesh.renderOrder = -10;
    scene.add(mesh);
    world.statics.push(mesh);
    out.push(mesh);
  }
  return out;
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

    /* The banks. Both numbers below were arrived at by measuring what actually
     * ends up in front of the camera, because the first attempt — 30 banks in
     * a 240 m box at 0.115 — looked entirely reasonable and rendered a squall
     * that was invisible.
     *
     * A bank is only visible between where it stops being a grey screen in
     * your face (20 m) and where it wraps out (span x 0.49). Over a 90-degree
     * view that shell held 4.2 banks stacking to 0.41 alpha at the peak of a
     * storm: a faint wash, not a wall. Pulling the box in to 190 m raises the
     * areal density by 60% for the same count, and the count and opacity go up
     * with it — 6.3 banks stacking to 0.67, which is a front you cannot see
     * through. The near fade is what keeps the fight readable: nothing thickens
     * inside 20 m, so an enemy at sword range is never lost in it. */
    this.banks = new FogBank(scene, {
      map: this.puff,
      count: outdoor ? Math.max(18, Math.floor(44 * density)) : 0,
      color: fog,
      // A dust wall is the ground in the air, so it takes the ground's colour,
      // not the haze's — that difference is what makes it read as dust rather
      // than as the fog getting thicker.
      dust: _col.copy(dust).multiplyScalar(0.72).clone(),
      opacity: 0.12, span: 190, seed: 5150,
    });

    /* ── the weather itself ────────────────────────────────────────────
     * Everything below this line is a CONSEQUENCE. The level says how hard its
     * weather gets and the scheduler decides when; wind, fog, sun and every
     * dust layer are then read off one number, which is the only way they can
     * possibly agree with each other. Two systems each deciding independently
     * how stormy it is right now is the thing that reads as fake. */
    this.weather = weather;
    weather.configure({ ...(opts.weather || {}), peak: outdoor ? (opts.weather?.peak ?? 0) : 0 });
    weather.time = 0;
    weather.update(0);
    // The level's own settings are the CALM baseline; every storm term is
    // relative to them, so restoring is exact and a level that never storms is
    // bit-for-bit what it was before there was weather at all.
    this._windBase = wind.baseHeading;
    this._windSpeed = wind.strength;
    this._gustBase = wind.gustiness;
    this._fog = scene.fog || null;
    this._fogBase = this._fog ? this._fog.density : 0;
    this._sunBase = this.sun ? this.sun.intensity : 0;
    this._sunTint = this.sun ? this.sun.color.clone() : null;
    this._hemiBase = this.hemi ? this.hemi.intensity : 0;
    this._dustTint = dust.clone();
    // What a storm is worth, remembered so `applyWeather` is pure arithmetic.
    this._moteOpacity = opts.opacity ?? 0.30;
    this._bankOpacity = 0.12;
    this._hazeOpacity = 0.075;

    this.parts = [this.motes, this.windborne, this.haze, this.shimmer, this.banks];
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

  /**
   * Push the current weather through everything downstream of it. Called
   * before the layers update so they all see the same frame's storm.
   *
   * Note what is NOT here: nothing decides independently how stormy it is.
   * There is one intensity, and wind speed, visibility, key light, fill light
   * and four dust layers are all functions of it.
   */
  _applyWeather() {
    const W = this.weather;
    const I = W.intensity;
    // ── one wind. Everything that reads `wind` — grass, sand sheets, embers,
    // smoke columns, the fog banks — leans harder because of this line alone.
    wind.strength = this._windSpeed * (1 + W.windGain * I);
    wind.gustiness = clamp(this._gustBase + 0.22 * I, 0, 0.95);
    /* ── visibility. This is the term that does the real work: it is what
     * makes the far ranges disappear and come back, and it is why a squall
     * changes what the level IS rather than just what is floating in it.
     *
     * CAPPED AT 0.0098, and that number is not taste. Terrain._syncAtmosphere
     * runs from flush() every frame and decides it is INDOORS when
     * `fog.density > 0.01`, at which point it sets the ground's sky-blend haze
     * to zero. Uncapped, all three outdoor levels sail past that: the dune sea
     * asks for 0.0193 at the peak. So every squall would have hard-switched
     * the terrain's aerial term off on the way in and back on on the way out —
     * a pop, on a threshold, in a system that has no idea weather exists.
     *
     * The cap costs real range (dunes 198 m → 85 m instead of 43 m), which is
     * why the fog banks carry more of the load than they otherwise would. */
    // The `max` is not belt and braces: a bare `min` against the cap DROPPED
    // the hangar's authored 0.016 to 0.0098 on a level with no weather at all,
    // which is the storm system quietly re-lighting an interior it is not even
    // running in. Weather may only ever ADD to what the level authored.
    if (this._fog) {
      this._fog.density = Math.max(this._fogBase,
        Math.min(FOG_INDOOR_LIMIT, this._fogBase * (1 + W.fogGain * I)));
    }
    // ── light. A dust storm is not a dimmer, it is a converter: it takes the
    // sun's beam apart and hands it back as sky. Direct falls, fill rises, and
    // what is left of the sun takes the colour of what it is coming through.
    if (this.sun) {
      this.sun.intensity = this._sunBase * (1 - W.sunLoss * I);
      if (this._sunTint) this.sun.color.copy(this._sunTint).lerp(this._dustTint, 0.6 * I);
    }
    if (this.hemi) this.hemi.intensity = this._hemiBase * (1 + W.fillGain * I);
    // ── and the layers thicken
    // The banks take the biggest multiplier of the three because the fog cap
    // above stops the scene fog doing the whole job: they are the part of the
    // visibility loss that is allowed to get as thick as a real dust wall.
    if (this.motes.mat) this.motes.mat.uniforms.uOpacity.value = this._moteOpacity * (1 + 1.9 * I);
    /* The banks are a SUM, not a multiplier, and the two terms are different
     * things: 0.12 is fair-weather haze structure and 0.85 is a dust wall. As
     * a multiplier off the calm value the peak came out at 0.60, and measured
     * against the calm frame that moved the mid distance by 1.9% luminance —
     * a squall you had to be told about. The blob sprite is soft (its mean
     * alpha is a fraction of its peak), so the number that reaches a pixel is
     * a long way under the uniform, which is exactly why this had to be
     * measured off a frame rather than reasoned about. */
    if (this.banks.mat) this.banks.mat.uniforms.uOpacity.value = this._bankOpacity + 0.85 * I;
    if (this.haze.mat) this.haze.mat.uniforms.uOpacity.value = this._hazeOpacity * (1 + 1.2 * I);
  }

  update(dt, center) {
    this.time += dt;
    wind.update(dt);
    this.weather.update(dt);
    this._applyWeather();
    this._readSun();
    this.motes.update(this.time, center, _col, this.sunDir);
    this.windborne.update(this.time, center);
    this.haze.update(this.time, center, _col, this.sunDir);
    this.shimmer.update(this.time, center);
    this.banks.update(this.time, center, _col, this.sunDir);
  }

  /** Legacy hook: point the shared wind with a world vector. */
  setWind(v) { wind.setFromVector(v); }

  dispose() {
    // Put back everything the weather borrowed. The next level re-authors all
    // of it anyway, but the main menu runs on whatever the last frame left
    // behind, and a menu lit by the tail of a dust storm is a bug report.
    if (this._fog) this._fog.density = this._fogBase;
    if (this.sun) {
      this.sun.intensity = this._sunBase;
      if (this._sunTint) this.sun.color.copy(this._sunTint);
    }
    if (this.hemi) this.hemi.intensity = this._hemiBase;
    wind.strength = this._windSpeed;
    wind.gustiness = this._gustBase;
    weather.configure({ peak: 0 });
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    this.puff?.dispose();
    this.puff = null;
    this.mesh = null;
  }
}
