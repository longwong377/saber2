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
const _v2 = new THREE.Vector3();
const _col = new THREE.Color();
const _rc2 = new THREE.Color();
const _rc3 = new THREE.Color();

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
/* How thick a squall is allowed to get the air, as an exp2 density.
 *
 * This used to be 0.0098, and the number had nothing to do with weather:
 * Terrain._syncAtmosphere tested `fog.density > 0.01` every frame to decide
 * whether it was indoors, so anything past that line switched the ground's
 * aerial term off mid-storm. The cap kept the fog under it — and cost the
 * effect. Measured: a FULL-STRENGTH squall moved the arena's median frame
 * luminance from 0.2856 to 0.2711. Five per cent. A dust storm you have to be
 * told about is not a dust storm.
 *
 * Terrain now tests the density the LEVEL authored rather than the one the
 * frame is running, so this is free to be what it should always have been: a
 * bound on the physics rather than a workaround. 0.030 is a half-light range
 * of 28 m, thicker than anything the levels ask for at their peak (dunes
 * 0.0193 → 43 m, canyon 0.0229 → 36 m, arena 0.0097 → 86 m), so it constrains
 * a runaway and nothing else. */
const FOG_STORM_LIMIT = 0.030;

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
      Math.min(FOG_STORM_LIMIT, baseDensity * (1 + this.fogGain * this.intensity)));
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
/** GLSL's smoothstep, in the same argument order, for the fields JS and the
 *  shaders both have to agree about. */
function smoothstep(lo, hi, v) { return hi === lo ? (v < lo ? 0 : 1) : smooth01((v - lo) / (hi - lo)); }
/** A stable seed from a preset name, so two levels on one preset match. */
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h ^ (h >>> 15)) >>> 0;
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

  /* THE DRAWN SKY, over bearing and elevation, as SkyDome baked it:
   * { az, el, top, rgb: Float32Array(az * el * 3) }. Published by
   * SkyDome.configure and read here by the far ranges.
   *
   * The DATA is shared rather than the function that makes it, and that is
   * deliberate twice over. The ranges and the dome's own painted skyline meet
   * along the same line of the frame, so if they derived the sky separately
   * and ever disagreed the disagreement would be a visible seam right where
   * the eye is already looking. And Scenery cannot import Engine: Engine
   * rewrites three's fog ShaderChunks as a module side effect, and a static
   * edge from here pulls it into tools/verify.mjs's static import graph, where
   * `three` resolves out of node_modules while everything loaded dynamically
   * resolves out of vendor/. The patch would land on the wrong copy of three
   * and the aerial-perspective checks would go quietly red. */
  skyBand: null,

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
  uniform float uCut;

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
      if(a < uCut) discard;
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

/* ── contact ───────────────────────────────────────────────────────────
 *
 * NOTHING IN THE FRAME TOUCHED THE GROUND. Measured on a dune tuft, the sand
 * 5 px from a blade base and the sand 40 px away differed by 1.6% luminance:
 * the whole field stood on sand of exactly its own value right up to each
 * blade, which is the loudest single tell that a scene was assembled rather
 * than lit.
 *
 * Grass cannot go in the shadow map to fix it. Ten thousand alpha-tested blades
 * is the most expensive thing that could possibly be in a depth pass, the
 * cascade is 42-96 m and the field is 42 m, and the result at any sane map
 * resolution is a grey smear rather than a contact. So the contact is BAKED:
 * one quad per TUFT, lying on the ground under it, multiplied into whatever the
 * terrain shaded itself.
 *
 * Per tuft, not per blade — 540 + 1200 quads for a 9000-blade field instead of
 * 9000 — because the thing that darkens the ground is the CLUMP. A single blade
 * occludes a slit; ten standing in a 26 cm circle occlude most of the sky over
 * the patch they share, which is why real grass has a dark base and isolated
 * spikes do not.
 *
 * Tilted to the ground normal rather than laid flat: at the 0.55 slope the
 * scatter still plants on, a flat 0.4 m disc rises 22 cm out of the hill it is
 * supposed to be lying on.
 */
/** How much light a full clump keeps off the ground directly under it, and how
 *  far out it does it as a multiple of the tuft's own spread.
 *
 *  Both measured against the reading rather than picked: at 0.52 over 1.7×
 *  spread the contact was plainly there in an A/B of the same frame, but the
 *  art director's own metric — sand 5 px from a base against sand 40 px away —
 *  came out at a 9.8% median, because a disc that wide puts the 40 px reference
 *  INSIDE the same shadow half the time and the sand's own ripples are already
 *  worth 5.6% of that reading on their own. Narrower and deeper moves the
 *  gradient rather than the average: the ground keeps a third of its open value
 *  under a clump and is back to full by 32 cm. The card ring is three
 *  billboards rather than ten blades, so it occludes less and wider. */
const SHADE_CORE = 0.68, SHADE_SPAN = 1.25;
const SHADE_CARD = 0.78, SHADE_CARD_SPAN = 0.80;

const SHADE_VERT = /* glsl */`
  precision highp float;
  attribute vec4 aShade;     // world x, ground y, world z, radius
  attribute vec4 aShadeN;    // ground normal xyz, darkness at the centre
  uniform vec3 uCenter;
  uniform float uFar;
  varying vec2 vLocal;
  varying float vDark;

  void main(){
    vec3 base = aShade.xyz;
    vDark = aShadeN.w;
    if (aShade.w <= 0.0001 || vDark <= 0.001) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vLocal = vec2(2.0); vDark = 0.0; return;
    }
    // Gone by the edge of the ring it belongs to, so the field does not end in
    // a ring of stains on bare ground.
    float d = distance(base.xz, uCenter.xz);
    vDark *= 1.0 - smoothstep(uFar * 0.72, uFar * 0.98, d);

    vec3 n = normalize(aShadeN.xyz);
    // any tangent that is not parallel to the normal; the disc is radially
    // symmetric so which one does not matter
    // any axis that is not parallel to the normal; the disc is radially
    // symmetric, so which one it is does not matter. step() rather than a
    // ternary on a vec3 — that form is not portable across GLSL ES versions.
    vec3 ref = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), step(0.9, abs(n.y)));
    vec3 t = normalize(cross(n, ref));
    vec3 b = cross(n, t);
    vLocal = position.xy * 2.0;                 // unit quad spans -0.5..0.5
    vec3 world = base + (t * position.x + b * position.y) * (aShade.w * 2.0)
               + n * 0.015;                     // off the surface, not into it
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const SHADE_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vLocal;
  varying float vDark;
  void main(){
    float r = dot(vLocal, vLocal);
    if (r > 1.0 || vDark <= 0.001) discard;
    // Squared falloff with a hot core: a clump's occlusion is nearly total
    // right under it and gone by the skirt, and a linear ramp reads as an
    // airbrushed blob rather than as something standing on the ground.
    float k = 1.0 - r;
    gl_FragColor = vec4(vec3(1.0 - vDark * k * k), 1.0);
  }
`;

/* ══════════════════════════════════════════════════════════════════════ */
/*  Where anything grows                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE COVER FIELD — one function that decides, for every square metre of a
 * level, whether ground cover grows there.
 *
 * It exists because three separate systems were each inventing their own
 * answer and none of them agreed: the terrain shader masked its cover tint
 * with a 30 m value noise, the grass scatter clumped off a 36 m fbm, and the
 * prop scatter used none at all. So the ground could be painted green where
 * there was no grass and bare where there was, and no measurement of "how
 * much of this level is covered" could mean anything.
 *
 * Two properties are the whole design:
 *
 *  · It is a PURE FUNCTION OF WORLD POSITION. Nothing about the player, the
 *    camera or the order things were built enters into it, so a patch of
 *    grass is the same patch after you walk away and come back — which the
 *    old field, re-rolled off a module-global rng every 13.8 m of walking,
 *    emphatically was not.
 *
 *  · Its THRESHOLD IS SOLVED, not authored. A caller says what fraction of
 *    the ground should be covered; the field samples itself, sorts, and takes
 *    that quantile. A hand-picked threshold on an fbm means nothing — change
 *    the frequency and the same number covers a different amount of ground.
 *
 * The shape it produces is deliberately BIMODAL: a wide swathe scale carrying
 * a finer grain, pushed through a narrow smoothstep so most ground is either
 * covered or bare and only the margins are in between. Uniform sprinkling is
 * what makes a landscape read as dusted rather than as grown; composition
 * needs the empty parts empty.
 */
export function makeCoverField(opts = {}) {
  const r = makeRng(opts.seed ?? 1337);
  // Perlin's table is global, so the only way two levels get different fields
  // is to look at different parts of the same one.
  const gx = r() * 4000 - 2000, gz = r() * 4000 - 2000;
  const f1 = 1 / Math.max(4, opts.patch ?? 54);
  const f2 = 1 / Math.max(2, opts.grain ?? 15);
  const base = (x, z) => fbm2(x * f1, z * f1, 3) * 0.74
                       + fbm2((x + gx) * f2, (z + gz) * f2, 2) * 0.26;

  const amount = clamp(opts.amount ?? 0.5, 0, 1);
  const extent = opts.extent ?? 280;
  /** Threshold and spread of `base` over a square of half-width `extent`
   *  centred on (cx, cz), given the fraction wanted above the midpoint. */
  const solve = (cx, cz) => {
    const N = 88, samples = new Float64Array(N * N);
    let k = 0, sum = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = cx + (i / (N - 1) - 0.5) * 2 * extent;
        const z = cz + (j / (N - 1) - 0.5) * 2 * extent;
        const v = base(x, z);
        samples[k++] = v; sum += v;
      }
    }
    const mean = sum / k;
    let vs = 0;
    for (let i = 0; i < k; i++) { const d = samples[i] - mean; vs += d * d; }
    const sd = Math.sqrt(vs / k) || 0.1;
    const sorted = Float64Array.from(samples).sort();
    const q = clamp(Math.round((1 - amount) * (k - 1)), 0, k - 1);
    return { t: sorted[q], sd };
  };

  /* WHERE THE LEVEL SITS IN THE FIELD is a choice, and leaving it to the seed
   * gets it wrong about half the time: the first three levels wired up this
   * way all spawned the player in a clearing, and a clearing at the spawn is
   * the one sample of the field every player is guaranteed to see. So the
   * offset is SEARCHED rather than drawn — candidates from the same stream,
   * keeping the first whose value at the origin is comfortably above the
   * threshold. It is still the same field; the level is just standing in a
   * thick part of it. A field asked to cover everything has no thin part to
   * avoid, so the search simply falls through. */
  let ox = 0, oz = 0;
  {
    const probe = solve(0, 0);
    const wantAt = probe.t + probe.sd * 0.45;
    for (let i = 0; i < 400; i++) {
      const cx = r() * 4000 - 2000, cz = r() * 4000 - 2000;
      if (base(cx, cz) >= wantAt) { ox = cx; oz = cz; break; }
      if (i === 399) { ox = r() * 4000 - 2000; oz = r() * 4000 - 2000; }
    }
  }
  const raw = (x, z) => base(x + ox, z + oz);

  const { t: thresh, sd } = solve(ox, oz);
  // The margin is a fraction of the field's OWN spread, so the edges stay the
  // same softness whatever frequency or amplitude the caller asked for.
  const edge = Math.max(1e-4, sd * (opts.edge ?? 0.62));
  const lo = thresh - edge * 0.5, hi = lo + edge;

  const field = {
    amount, patch: 1 / f1, grain: 1 / f2, extent, lo, hi, sd, ox, oz,
    /** 0 bare, 1 fully covered — the mask, with no slope or water in it. */
    at(x, z) { return smoothstep(lo, hi, raw(x, z)); },
    raw,
    /** The fraction of a disc of radius R that comes out covered. */
    fraction(R, step = 4) {
      let n = 0, c = 0;
      for (let z = -R; z <= R; z += step) for (let x = -R; x <= R; x += step) {
        if (x * x + z * z > R * R) continue;
        n++; c += field.at(x, z);
      }
      return n ? c / n : 0;
    },
    /**
     * The same mask as an 8-bit texture over a `size` square centred on the
     * origin, for the terrain shader — so the ground is toned as covered in
     * exactly the places the geometry grows, right out to the edge of the
     * heightfield where no instance budget could ever reach.
     */
    bake(res, size) {
      const d = new Uint8Array(res * res * 4);
      for (let j = 0; j < res; j++) {
        for (let i = 0; i < res; i++) {
          const x = ((i + 0.5) / res - 0.5) * size;
          const z = ((j + 0.5) / res - 0.5) * size;
          const v = Math.round(field.at(x, z) * 255);
          const o = (j * res + i) * 4;
          d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
        }
      }
      const tex = new THREE.DataTexture(d, res, res, THREE.RGBAFormat);
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      return tex;
    },
  };
  return field;
}

/**
 * THE LOD LADDER, and the arithmetic that sizes it.
 *
 * The field this replaces was a 46 m bubble. Beyond it there was no grass at
 * any quality on levels you can see 700 m across, and the bubble held 2.1% of
 * the dune sea's ground and 3.1% of the arena's. Extending it is not a matter
 * of spending more instances — the budget is 2,750 blades at `low` — it is a
 * matter of spending them on the right THING at each range, and the thing
 * changes because the GEOMETRY OF LOOKING changes:
 *
 *   at 5 m you are looking down at the ground and you see individual blades;
 *   at 100 m the ground is 1° below the horizon and a 0.4 m tuft hides the
 *   twenty-three metres of ground behind it;
 *   at 300 m it hides seventy.
 *
 * So near cover has to be paid for by area and far cover almost pays for
 * itself. `dens` is TUFTS PER SQUARE METRE OF COVERED GROUND — not of ground,
 * because a level whose cover field says 40% spends its whole budget on that
 * 40% and gets patches that are actually dense, instead of a thin wash over
 * everything. `per` is instances per tuft: blades in a clump, cards in a bush.
 *
 * Radii are quoted at the reference `radius` of 46 m and scale with it.
 */
const GRASS_TIERS = [
  /* Real blade geometry, eight to a clump. The only tier the player ever sees
   * as separate plants, so it is deliberately SMALL and DENSE — 6.5 m at
   * 27 blades per square metre — and it keeps shrinking every time a plate is
   * looked at, because a blade is a TERRIBLE way to cover ground: its
   * silhouette is 0.003 m² against a card's 0.37, so an instance spent here
   * buys a hundredth of the cover an instance spent one rung out does. What it
   * buys instead is the only thing a card cannot: a plant, seen as a plant,
   * where the player is standing. Widening this ring costs density as the
   * square of the radius and takes the budget straight out of the tier that is
   * actually covering the ground. */
  { name: 'blade', card: false, rIn: 0, rOut: 6.5, cell: 2.2, dens: 5.0, per: 8, spread: 0.25,
    width: 0.110, bend: 0.23, wave: 0.62, sheen: 0.30, trans: 0.90,
    base: 0.16, varies: 0.22, shade: true, cut: 0.42 },
  /* Cards: a billboard standing in for a bush, and 50× the silhouette per
   * instance that a blade is. Fades in at 3 m — UNDER the blades rather than
   * after them, so the handover is a thickening and not a boundary. */
  { name: 'clump', card: true, rIn: 2.5, rOut: 46, cell: 6.0, dens: 0.62, per: 3, spread: 0.80,
    width: 1.05, bend: 0.34, wave: 0.62, sheen: 0.55, trans: 0.55,
    base: 0.26, varies: 0.26, shade: true, cut: 0.42 },
  /* Swathes: one card per patch of ground, wide enough to close the gaps that
   * would otherwise read as bald spots at a hundred metres. */
  { name: 'swath', card: true, rIn: 42, rOut: 150, cell: 17, dens: 0.024, per: 2, spread: 3.2,
    width: 2.60, bend: 0.30, wave: 0.62, sheen: 0.62, trans: 0.45,
    base: 0.26, varies: 0.26, shade: false, cut: 0.36 },
  /* The far ground. Six-metre cards at a thousandth of the near tier's
   * density, which at that range is still most of what you see, because you
   * are looking ALONG the ground rather than down at it: from eye height a
   * 0.4 m tuft at 250 m hides the sixty metres of ground behind it. */
  { name: 'far', card: true, rIn: 140, rOut: 400, cell: 46, dens: 0.0026, per: 1, spread: 9.0,
    width: 6.0, bend: 0.22, wave: 0.55, sheen: 0.66, trans: 0.35,
    base: 0.26, varies: 0.26, shade: false, cut: 0.30 },
];

/** A stable 32-bit hash of a cell coordinate. This is the whole of the fix. */
function cellHash(i, j, salt) {
  let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export class GrassField {
  constructor(scene, terrain, opts = {}) {
    this.scene = scene;
    this.terrain = terrain;
    if (terrain) ground.terrain = terrain;
    this.radius = opts.radius ?? 42;
    this.time = 0;
    this.meshes = [];
    this.tracker = new PusherTracker();

    const density = opts.density ?? 1;
    /* The budget and the COVERED FRACTION are two different questions and the
     * one number the World hands down has to answer both, because it is the
     * level's `grass` times the player's slider and neither can reach in here
     * separately. So the budget takes half its swing from the slider — a
     * Performance setting must still buy frames — and the covered fraction
     * takes the rest, saturating, because the difference between a level with
     * tussock in its troughs and one that is a meadow is not linear in a
     * density multiplier. `opts.cover` overrides it outright for tests. */
    /* And the budget itself is 2.2× what the caller names, because what the
     * caller names was sized for a 46 m bubble. The field reaches 400 m now —
     * seventy-five times the ground — in six draw calls and about 150k
     * triangles against the bubble's four and 70k.
     *
     * The number was set by looking rather than by arithmetic, and the plate
     * that set it is the magenta one: with the terrain's cover mask forced to
     * full magenta, the ground says "grass here" over a swathe the geometry
     * was filling about a sixth of. A mask and a field that disagree by that
     * much is worse than either alone — the ground reads as painted. */
    const total = Math.max(0, Math.floor((opts.count ?? 9000) * 2.2 * (0.5 + 0.5 * Math.min(density, 1.4))));
    this.count = total;
    this.density = density;
    if (total === 0) { this.mesh = null; return; }

    this.tintA = new THREE.Color(opts.tintA ?? 0x9aa860);
    this.tintB = new THREE.Color(opts.tintB ?? 0x5d6b34);
    this.dry = new THREE.Color(opts.dry ?? 0x6a6142);

    const half = terrain && terrain.half ? terrain.half : 280;
    this.cover = opts.field || makeCoverField({
      seed: opts.seed ?? (terrain && terrain.presetKey ? hashString(terrain.presetKey) : 1337),
      amount: opts.cover ?? clamp(0.24 + 0.72 * density, 0.12, 0.95),
      patch: opts.patch ?? 54, grain: opts.grain ?? 15,
      extent: half,
    });
    this.coverFrac = Math.max(0.05, this.cover.amount);

    // The ground has to know it is covered — and it has to know WHERE, or the
    // tint is a wash over ground the blades never reach and the two read as
    // different materials. Litter is the darker, browner end of the living
    // blade, never the blade colour itself: soil under grass is not green, it
    // is what green rots into.
    if (terrain && terrain.setGroundCover) {
      const litter = this.tintB.clone().lerp(this.dry, 0.55).multiplyScalar(0.46);
      this.coverTex = this.cover.bake(256, terrain.size || half * 2);
      terrain.setGroundCover(clamp(0.30 + 0.46 * density, 0, 0.86), litter, 30, this.coverTex);
    }

    this._buildTrail();

    /* SIZE EVERY TIER OFF THE SAME ARITHMETIC so the ladder cannot drift, and
     * size it against the ground the fill ACTUALLY KEEPS — which is one cell
     * wider at each end than the tier's own annulus, because the window snaps
     * to the cell grid while the shader's fade follows the camera. Sizing on
     * the annulus alone under-provisions the near tier by (11/8.5)², and an
     * under-provisioned near tier does not thin out: it stops, in a circle,
     * at whatever radius its capacity ran out.
     *
     * `hold` is how much cover a tier has to be ready for. A 400 m annulus
     * averages the whole level and can be sized on the level's own fraction; a
     * 8.5 m one sits entirely inside a single patch, and since the field is
     * anchored so the spawn IS a patch, it has to be sized for nearly full
     * cover or it clips exactly where the player is looking.
     *
     * Densities are then the authored ones times one shared factor, so the
     * ratio between the rungs is fixed by the table and only the overall
     * thickness moves with the budget. */
    const k = this.radius / 46;
    const tiers = GRASS_TIERS.map((T) => {
      const rIn = T.rIn * k, rOut = T.rOut * k, cell = T.cell * k;
      const oR = rOut + cell, iR = Math.max(0, rIn - cell);
      const hold = Math.min(1, this.coverFrac
        + (rOut < 15 ? 0.45 : rOut < 60 ? 0.22 : rOut < 250 ? 0.12 : 0));
      const area = Math.PI * (oR * oR - iR * iR) * hold;
      return { T, rIn, rOut, cell, area, hold, want: area * T.dens * T.per };
    });
    const wantAll = tiers.reduce((a, t) => a + t.want, 0) || 1;
    this.thickness = total / wantAll;
    let spent = 0;
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      t.cap = i === tiers.length - 1
        ? Math.max(1, total - spent)
        : Math.max(1, Math.round(total * t.want / wantAll));
      spent += t.cap;
    }

    this.nearRadius = tiers[0].rOut;      // where real blades stop
    this.reach = tiers[tiers.length - 1].rOut;
    this._cardMap = repeating(grassSprite(96));

    this.rings = tiers.map((t) => this._buildRing({
      count: t.cap, card: t.T.card,
      geometry: t.T.card ? new THREE.PlaneGeometry(1, 1, 1, 2) : bladeGeometry(4),
      near: t.rIn, far: t.rOut,
      width: t.T.width, bendGain: t.T.bend, waveGain: t.T.wave,
      sheen: t.T.sheen, translucency: t.T.trans, cut: t.T.cut,
      map: t.T.card ? this._cardMap : null,
      tier: t.T, cell: t.cell, spread: t.T.spread * k,
      // tufts per m² of covered ground: the table's rung times the one shared
      // factor, so a tier thins rather than stopping short when the budget does
      dens: t.T.dens * this.thickness,
      shade: t.T.shade,
    }));

    this.near = this.rings[0];            // the two names the checks and the
    this.far = this.rings[1];             // clippings path already know
    this.mesh = this.near.mesh;           // kept for anything that pokes at `.mesh`

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

  _buildRing({ count, card, geometry, near, far, width, bendGain, waveGain, sheen, translucency, map,
               cut, tier, cell, spread, dens, shade }) {
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
      // How far the laid-over crest is lifted above the blade's own value.
      // 1.7 read as fluorescent against sand once there was enough cover to
      // see a crest travel across; the wave is still legible at 1.4.
      uSheenLift: { value: 1.4 },
      uTranslucency: { value: translucency },
      /* The terrain the grass grows out of is lit by a sky probe as well as by
       * the hemisphere, and there is no probe here, so the hemisphere has to
       * stand in for both or grass in shadow reads as a different, much darker
       * material than the ground beside it.
       *
       * It was 4.0, and that overshot in the other direction — which only
       * became visible once the field stopped being a 46 m bubble and started
       * covering ground that is in shadow. Measured on a canyon plate, in the
       * shade of the west wall: the brightest blade pixels came back at 0.68
       * luminance over ground at 0.20, so the cover was glowing at three and a
       * half times the value of the ground it grows out of. A probe is worth
       * something like the hemisphere again, not three times it. */
      uAmbientBoost: { value: 2.4 },
      uDry: { value: this.dry.clone() },
      uTrail: { value: this.trailTex },
      uTrailCenter: { value: this.trailCenter },
      uTrailSize: { value: this.trailSize },
      // Where a card's alpha stops being grass. The far tiers cut lower: a
      // card 300 m out is two pixels tall, and a 0.42 cut on a mip that
      // averaged away most of the blade leaves nothing but holes.
      uCut: { value: cut ?? 0.42 },
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
    // Deliberately NOT a shadow caster — see SHADE_VERT. The contact comes from
    // the baked quads below, which cost 1/6th of the instances and land where
    // the cascade never reaches.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.meshes.push(mesh);

    /* Contact quads only where a contact resolves. Past the clump tier a tuft
     * is smaller than the pixel it lands in and its stain on the ground is a
     * second draw call for nothing. */
    const sh = shade ? this._buildShade(Math.ceil(count / Math.max(1, tier ? tier.per : (card ? 3 : 10))), far) : null;
    return {
      mesh, mat, geo, aInst, aOrient, aTint, count, near, far, card, shade: sh,
      tier, cell: cell ?? 4, spread: spread ?? (card ? 0.75 : 0.26), dens: dens ?? 0,
      per: tier ? tier.per : (card ? 3 : 10),
      salt: tier ? hashString(tier.name) : 7, ci: 1e9, cj: 1e9, live: 0, used: 0,
    };
  }

  /** The contact quads for one ring: one per tuft, multiplied into the ground. */
  _buildShade(tufts, far) {
    const geo = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    geo.index = q.index;
    geo.attributes.position = q.attributes.position;
    geo.instanceCount = tufts;
    const aShade = new THREE.InstancedBufferAttribute(new Float32Array(tufts * 4), 4);
    const aShadeN = new THREE.InstancedBufferAttribute(new Float32Array(tufts * 4), 4);
    for (const A of [aShade, aShadeN]) A.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aShade', aShade);
    geo.setAttribute('aShadeN', aShadeN);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uCenter: { value: new THREE.Vector3() }, uFar: { value: far } },
      vertexShader: SHADE_VERT,
      fragmentShader: SHADE_FRAG,
      // Multiply, so the quad darkens whatever the ground already worked out
      // for itself — its own albedo, its own sun, its own fog. An alpha-blended
      // grey would paint one tone over all three and go pale in the haze.
      blending: THREE.MultiplyBlending,
      transparent: true,
      depthWrite: false,
      // Sitting 1.5 cm off a surface is not enough on its own at 40 m, where the
      // depth buffer's own resolution is coarser than that.
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = mesh.receiveShadow = false;
    // Before the haze, the motes and the particles: this belongs to the ground,
    // and everything floating in the air belongs over it.
    mesh.renderOrder = -5;
    this.scene.add(mesh);
    this.meshes.push(mesh);
    q.dispose();
    return { mesh, mat, geo, aShade, aShadeN, tufts };
  }

  /**
   * FILL ONE TIER, and the reason this is a hash and not a scatter.
   *
   * The field this replaces re-rolled EVERY BLADE IN THE LEVEL off a
   * module-global generator whenever the centre moved more than 0.3 of its
   * radius — 13.8 metres of walking. Turn around after fourteen paces and the
   * tussock you just fought past was a different tussock. That is a
   * correctness bug before it is an art one: nothing about a place should
   * depend on how you arrived at it.
   *
   * So the world is cut into cells, and A CELL'S CONTENTS ARE A PURE FUNCTION
   * OF ITS INTEGER COORDINATE. Walk away, walk back, reload the level: the
   * same hash seeds the same generator and puts the same clump in the same
   * square metre with the same lean and the same tint. The buffer index a
   * tuft lands in changes as the window slides — that is all that changes.
   *
   * Cells are visited OUTWARD from the middle, so if a tier ever runs out of
   * capacity — which happens when the window sits over ground the cover field
   * says is unusually thick — what gets dropped is the far rim, where the
   * shader has already faded it to nothing, and never the ground at the
   * player's feet.
   */
  _fillTier(ring, center) {
    const a = ring.aInst.array, o = ring.aOrient.array, t = ring.aTint.array;
    const cell = ring.cell, spread = ring.spread, perTuft = ring.per;
    const waterLine = ground.water ? ground.water.level : null;
    const field = this.cover;
    // A margin of one cell at each end: the window is snapped to the cell grid
    // but the shader's fade follows the camera continuously, so the geometry
    // has to exist slightly beyond where the fade will ask for it.
    const rIn = Math.max(0, ring.near - cell), rOut = ring.far + cell;
    const rIn2 = rIn * rIn, rOut2 = rOut * rOut;
    const ci = ring.ci, cj = ring.cj;
    const K = Math.ceil(rOut / cell) + 1;
    const cap = ring.count;
    const sh = ring.shade;
    const sa = sh ? sh.aShade.array : null, sn = sh ? sh.aShadeN.array : null;
    const shCap = sh ? sh.tufts : 0;
    const nom = ring.dens * cell * cell;      // tufts per cell at full cover

    let i = 0, tuft = 0, live = 0;
    // Chebyshev rings outward: nearest ground first, and no sort.
    for (let k = 0; k <= K && i < cap; k++) {
      for (let e = 0; e < (k === 0 ? 1 : 8 * k) && i < cap; e++) {
        let di, dj;
        if (k === 0) { di = 0; dj = 0; }
        else if (e < 2 * k) { di = -k + e; dj = -k; }
        else if (e < 4 * k) { di = k; dj = -k + (e - 2 * k); }
        else if (e < 6 * k) { di = k - (e - 4 * k); dj = k; }
        else { di = -k; dj = k - (e - 6 * k); }
        const gi = ci + di, gj = cj + dj;
        // the cell's own square against the annulus, in the snapped frame
        const cxm = (gi + 0.5) * cell - (ci + 0.5) * cell;
        const czm = (gj + 0.5) * cell - (cj + 0.5) * cell;
        const d2 = cxm * cxm + czm * czm;
        const half = cell * 0.7072;
        if (d2 > (rOut + half) * (rOut + half)) continue;
        if (rIn > half && d2 < (rIn - half) * (rIn - half)) continue;

        const r = makeRng(cellHash(gi, gj, ring.salt));
        // How many tufts THIS cell holds. Deterministic, and proportional to
        // the cover field at its middle: a level whose field says 40% spends
        // its whole budget on that 40% instead of dusting everything.
        const cx0 = gi * cell, cz0 = gj * cell;
        const cw = field.at(cx0 + cell * 0.5, cz0 + cell * 0.5);
        const want = nom * cw;
        let n = Math.floor(want);
        if (r() < want - n) n++;
        for (let q = 0; q < n && i < cap; q++) {
          // Every tuft draws the SAME randoms in the SAME order whether or not
          // it survives, so one tuft failing its site cannot shift the ones
          // behind it in the cell.
          const jx = r(), jz = r(), lean0 = r(), phase = r(), yaw0 = r();
          const tx = cx0 + jx * cell, tz = cz0 + jz * cell;
          const dx = tx - center.x, dz = tz - center.z;
          const dr2 = dx * dx + dz * dz;
          if (dr2 > rOut2 || dr2 < rIn2) { for (let b = 0; b < perTuft * 5; b++) r(); continue; }

          const slope = this.terrain ? this.terrain.slopeAt(tx, tz) : 0;
          const y0 = this.terrain ? this.terrain.height(tx, tz) : 0;
          // Steep ground carries little, and water thins the cover rather than
          // cutting it dead: the interesting grass in a river wash is the reeds
          // standing in the shallows along the margin.
          const wet = waterLine === null ? 1 : clamp((y0 - (waterLine - 0.30)) / 0.45, 0, 1);
          const density = clamp(1 - slope * 1.7, 0, 1) * field.at(tx, tz) * wet;
          const alive = density > 0.14;
          /* A tuft leans TOGETHER, not per blade, and it leans a long way. At
           * 0.16-0.58 rad the field rendered as a bristle brush: every blade
           * within a few degrees of vertical, each one a separate hard-edged
           * needle against the sand. Real tussock arches — 0.3 to 1.05 rad of
           * curvature over the blade's length, which is the difference between
           * a clump reading as a plant and reading as a row of spikes. The
           * wind's own bend adds to this, and the whole thing is still capped
           * at 2 rad in the shader. */
          const lean = 0.30 + lean0 * 0.75;

          if (alive) live++;
          if (sh && tuft < shCap) {
            const o4 = tuft * 4;
            sa[o4] = tx; sa[o4 + 1] = y0; sa[o4 + 2] = tz;
            sa[o4 + 3] = alive ? spread * (ring.card ? SHADE_CARD_SPAN : SHADE_SPAN) : 0;
            if (this.terrain?.normalAt) this.terrain.normalAt(tx, tz, _v1); else _v1.set(0, 1, 0);
            sn[o4] = _v1.x; sn[o4 + 1] = _v1.y; sn[o4 + 2] = _v1.z;
            // A thin clump lets the sky through, so the darkness rides the same
            // density the blade count does rather than being a flat stamp.
            sn[o4 + 3] = alive
              ? (ring.card ? SHADE_CARD : SHADE_CORE) * clamp(density * 1.5, 0.35, 1) : 0;
          }
          tuft++;

          for (let b = 0; b < perTuft && i < cap; b++) {
            const rr = Math.sqrt(r()) * 0.5 * spread;
            const ra = r() * TAU;
            const hs = r(), fa = r(), tl = r();
            const x = tx + Math.cos(ra) * rr;
            const z = tz + Math.sin(ra) * rr;
            const y = this.terrain ? this.terrain.height(x, z) : 0;
            // Blade geometry spans v = 0..1, so these ARE metres, not a
            // multiplier. Pasture is ankle-to-knee; a 1.4 m blade beside a
            // 1.78 m character reads as scratchy weeds however many there are.
            const T = ring.tier;
            const base = T ? T.base : (ring.card ? 0.26 : 0.20);
            const varies = T ? T.varies : 0.26;
            // A third of every clump is sward: short blades filling the base,
            // which is the part the eye actually reads density from.
            const shortling = !ring.card && (b % 3) === 2 ? 0.48 : 1;
            const scale = alive
              ? (base + hs * varies) * clamp(density * 1.8, 0.5, 1.15) * shortling
              : 0;

            a[i * 4] = x; a[i * 4 + 1] = y - 0.02; a[i * 4 + 2] = z; a[i * 4 + 3] = scale;
            const fang = fa * TAU;
            o[i * 4] = Math.cos(fang);
            o[i * 4 + 1] = Math.sin(fang);
            o[i * 4 + 2] = lean * (0.6 + yaw0 * 0.8);
            o[i * 4 + 3] = phase;
            _col.copy(this.tintA).lerp(this.tintB, tl * 0.9);
            const v = 0.82 + ((tl * 7.13) % 1) * 0.36;   // per-blade value noise
            t[i * 3] = _col.r * v; t[i * 3 + 1] = _col.g * v; t[i * 3 + 2] = _col.b * v;
            i++;
          }
        }
      }
    }
    /* Anything the fill never reached this pass is not there. All four
     * components, not just the scale: a slot left holding the position it had
     * two windows ago is invisible either way, but it makes the buffer depend
     * on where the player has BEEN, and the whole point of this pass is that
     * nothing about the field does. */
    for (let z = i; z < cap; z++) { a[z * 4] = 0; a[z * 4 + 1] = 0; a[z * 4 + 2] = 0; a[z * 4 + 3] = 0; }
    for (let z = tuft; z < shCap; z++) { sa[z * 4 + 3] = 0; sn[z * 4 + 3] = 0; }
    ring.used = i; ring.live = live; ring.tufts = tuft;
    ring.aInst.needsUpdate = true;
    ring.aOrient.needsUpdate = true;
    ring.aTint.needsUpdate = true;
    if (sh) { sh.aShade.needsUpdate = true; sh.aShadeN.needsUpdate = true; }
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

    this.center.copy(center);
    /* Each tier follows its own cell grid, so the tier whose cells are 2.75 m
     * across refills every 2.75 m of walking and the one whose cells are 46 m
     * refills every 46 m. That is the point of snapping the window: the cost
     * of a refill scales with the tier's instance count, and the tiers that
     * hold the most instances are the ones you cross fastest, so pinning the
     * refill to a FRACTION OF THE RADIUS — as the whole-field re-roll this
     * replaces did — spent the most time on the least visible ground.
     *
     * The uCenter every ring fades against is the TRUE centre, updated every
     * frame, not the snapped one: a fade that jumps in cell steps is a ring
     * of grass appearing at the horizon every time you cross a line. */
    for (const ring of this.rings) {
      const ci = Math.floor(center.x / ring.cell), cj = Math.floor(center.z / ring.cell);
      if (ci !== ring.ci || cj !== ring.cj) {
        ring.ci = ci; ring.cj = cj;
        this._fillTier(ring, center);
      }
      const u = ring.mat.uniforms;
      u.uTime.value = this.time;
      u.uCenter.value.copy(center);
      if (ring.shade) ring.shade.mat.uniforms.uCenter.value.copy(center);
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
    // and hand the mask back, or the terrain keeps sampling a texture this
    // field is about to delete out from under it
    this.terrain?.setGroundCover?.(0, null, 30, null);
    if (!this.mesh) return;
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.material.dispose();
      m.parent?.remove(m);
    }
    this.meshes.length = 0;
    this.trailTex?.dispose();
    this._cardMap?.dispose();
    this.coverTex?.dispose();
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

/* Water's own absorption, 1/m, in linear RGB. Red is gone inside half a metre
 * and blue-green is still coming back at three; that difference IS why water
 * has a colour, and one scalar cannot express it. Lives here rather than as a
 * literal in the shader so the GL-free model of this shader and the shader
 * itself read the same three numbers. */
const WATER_EXT = [2.6, 0.85, 0.62];

/* How fast the bed stops being what you are looking at, 1/m. At the 1.5 this
 * replaces a running wash was legible to a metre and a half, which is not a
 * wash, it is an aquarium — and it is why two thirds of the canyon river was
 * reading as gravel with a wash of colour over it rather than as water. */
const BED_FADE = 2.8;

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
    uniform vec4 uField;                    // 1/size, half extent, depth range, gradient range
  #endif
  varying vec3 vW; varying vec2 vUv; varying float vWave;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
  #ifdef WATER_DEPTH
    // R is depth in metres; GB are its gradient, signed and centred on 0.5
    vec3 bedAt(vec2 xz){
      vec4 t = texture2D(uDepth, xz * uField.x + 0.5);
      return vec3(t.r * uField.z, (t.gb - 0.5) * 2.0 * uField.w);
    }
  #endif
  const vec3 WATER_EXT = vec3(${WATER_EXT.join(', ')});
  const float BED_FADE = ${BED_FADE.toFixed(2)};
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
    /* What is under the water, and where it climbs out of it.
     *
     * bedDepth is the depth along the REFRACTED ray rather than straight
     * down: the surface bends what you see through it, and offsetting the
     * lookup along the surface normal is what makes the bed swim under the
     * ripples instead of sitting behind them like a decal.
     *
     * climb is |grad depth| — how fast the bed rises, in metres per metre.
     * It is the difference between a shore and a shallow, and the lap below
     * needs it: measured on the canyon's own heightfield, 71% of the wet
     * surface is between 2.5 and 30 cm deep, so a lap keyed on depth alone is
     * a lap painted over the entire river. */
    float bedDepth = 4.0, climb = 0.0;
    vec3 bedN = vec3(0.0, 1.0, 0.0);

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

    /* The bed: ONE fetch, which is what the flat version cost.
     *
     * Depth and its gradient both come out of the same texel (see _bakeDepth),
     * and the refracted point is then a first-order step ALONG that gradient
     * rather than a second dependent read. A central difference in the shader
     * plus a separate refracted sample is six reads per water pixel on a 520 m
     * sheet that fills a third of the frame, which is enough to stop the canyon
     * booting at all under a software rasteriser — measured, by it not booting.
     * First order is plenty over the 20-30 cm the refraction offset reaches,
     * and it is still what makes the bed swim under the ripples instead of
     * sitting behind them like a decal. */
    vec2 grad = vec2(0.0);
    #ifdef WATER_DEPTH
      vec3 bedSample = bedAt(vW.xz);
      depth = bedSample.x;
      grad = bedSample.yz;
      // depth grows as the bed drops, so the bed's normal leans the way depth does
      bedN = normalize(vec3(grad.x, 1.0, grad.y));
      climb = length(grad);
      bedDepth = max(0.0, depth + dot(grad, N.xz * depth * 0.9));
    #endif
    vec3 L = normalize(uSunDir);

    /*
     * FRESNEL, THE REAL CURVE. pow(1-N·V, 3.2) folded into 0.62 of the mix
     * meant that at 3° — which is how a standing player always sees a river —
     * the surface came back 67% DIFFUSE. Water does not do that. Schlick with
     * water's own F0 = 0.02 puts a 3° facet at 0.77 reflective and a 45° one at
     * 0.02, and that swing IS the material: mirror along it, look into it.
     */
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(N,V),0.0,1.0), 5.0);

    /*
     * WHAT IS UNDER IT. Beer's law PER CHANNEL, which is the entire reason
     * water has a colour: red is gone in the first half-metre and blue-green is
     * still coming back at three. It is applied to the BED, which is the thing
     * the water is filtering — a stone under a foot of river goes blue-green
     * because that is the only light left to come back off it.
     *
     * It is deliberately NOT applied to uShallow/uDeep. Those swatches are the
     * colour the water SCATTERS, and they already carry the hue the extinction
     * would give them; weighting them per channel as well multiplies the hue in
     * twice and cancels it — the first cut of this did exactly that and turned
     * the authored teal green. The scalar 1-exp(-depth*1.5) still says how much
     * of what you see is water rather than bed, which is all a scalar is for.
     */
    vec3 bed = uBed * (0.34 + 0.66 * clamp(dot(bedN, L), 0.0, 1.0));
    vec3 trans = exp(-WATER_EXT * bedDepth);
    float dw = 1.0 - exp(-depth * 1.5);
    vec3 body = mix(uShallow, uDeep, 1.0 - exp(-bedDepth * 0.55));
    vec3 col = mix(body, bed * trans, exp(-bedDepth * BED_FADE));
    /*
     * What the surface mirrors, and it depends on WHERE THE MIRRORED RAY GOES.
     * Grazing, it leaves nearly level and lands on the far bank — in a gorge
     * that is a wall standing in its own shade, not sky. Steepen the view and
     * the ray clears the rim. The old code used a flatness term as a proxy for
     * that and then mirrored a 55/45 blend of haze and sky, which is two
     * chromas cancelling into grey: the sheet of milk was not the sky being too
     * bright, it was the reflection having no colour left to be.
     */
    vec3 R = reflect(-V, N);
    float facet = smoothstep(0.02, 0.34, clamp(R.y, 0.0, 1.0));
    // Blue, and DARK: 40% of the sky's own radiance, because what a level ray
    // finds over a canyon is distance, and distance in shade is not a light
    // source. Keeping the hue is what stopped it reading as paper.
    vec3 mirror = mix(uSky * 0.40, mix(uSky, fogColor, 0.16), facet);
    col = mix(col, mirror, fres * (0.55 + dw * 0.40));
    /*
     * Sun on water, in two lobes. The shipped shader had only the pinpoint one
     * at exponent 90, which lights a handful of pixels and reads as nothing;
     * what says "wet" from a standing eye is the BROAD sheen down the sun's
     * bearing. Both are gated by the Fresnel, so the sheen lives at grazing
     * angles where a real one does and never appears looking straight down.
     */
    float sd = max(dot(reflect(-L, N), V), 0.0);
    float spec = pow(sd, 90.0) * 1.9 + pow(sd, 8.0) * 0.34;
    col += vec3(1.0,0.96,0.88) * spec * fres * (0.35 + dw * 0.65);

    /*
     * The lap belongs at a SHORE, and a shore is where the bed climbs out of
     * the water — not merely where the water is shallow. On the canyon's own
     * heightfield 71% of the wet surface is 2.5-30 cm deep, so keying the lap
     * on depth alone laid 0.86 of linear white over a body colour of 0.14
     * across nearly the whole river. That, and not the sky, is what the white
     * sheet was. Gate it on climb as well and it goes back to the banks.
     */
    float shore = smoothstep(0.30, 0.03, depth) * smoothstep(0.0, 0.025, depth);
    float lapBand = shore * smoothstep(0.06, 0.30, climb);
    float lap = sin(depth * 26.0 - uTime * 1.9 + vnoise(vW.xz * 0.55) * 8.0) * 0.5 + 0.5;
    // and broken, because a solid band of foam is a painted line. n1 is the
    // ripple noise already computed at the top; a fourth vnoise here is four
    // more sin() per water pixel for a value this one already has.
    float broken = 0.30 + 0.70 * n1;
    // The long swell used to throw foam wherever it crested, which on a 580 m
    // sheet with a 20 m swell is white blobs the size of a barge. Ankle-deep
    // rivers do not have whitecaps; they have a lap at the edge.
    float foam = smoothstep(0.08, 0.15, abs(vWave)) * 0.045
               + clamp(foamRing, 0.0, 1.4) * 0.45
               + lapBand * (0.10 + lap * 0.30) * broken;
    col += foam;
    /*
     * WET GROUND, which is the other half of a shoreline and was missing
     * entirely. The last centimetres are not foam, they are the bed with a film
     * on it: darker and more saturated than the dry bank a hand's breadth away.
     * It carries its own alpha, or the sheet fades out before the film shows.
     */
    float wet = smoothstep(0.06, 0.0, depth) * smoothstep(0.0, 0.012, depth);
    col = mix(col, bed * 0.44, wet * 0.60 * (1.0 - lapBand));
    // and the edge itself is where the depth runs out, not where the sheet does
    float edge = smoothstep(0.0, 0.06, depth);
    gl_FragColor = vec4(col, clamp((0.34 + dw * 0.40 + fres*0.22 + foamRing*0.25 + lapBand * 0.22)
                                   * edge + wet * 0.34, 0.0, 1.0));
    #include <fog_fragment>
  }
`;

/**
 * WATER_FRAG's colour maths, on the CPU.
 *
 * The same arrangement WindField/WIND_GLSL already use, and for the same
 * reason: the only way to sweep a water constant otherwise is to boot the
 * canyon under SwiftShader, which is twenty minutes a look, and the round that
 * shipped the white river did exactly that and shipped it anyway. This costs
 * 40 microseconds, so tools/checks/terrain.mjs can hold the river to a
 * saturation and to "a grazing surface mirrors more than it scatters" instead
 * of to a regular expression over the shader text.
 *
 * Everything is LINEAR radiance in, linear radiance out. The tone curve is the
 * caller's business, because the caller is the only one who knows the level's
 * exposure and grade.
 *
 * `depth`/`bedDepth` in metres, `climb` in metres of bed rise per metre
 * travelled, `viewDeg` the elevation of the eye above the surface (3 degrees is
 * a standing player looking down a river; 45 is looking over the side of it),
 * `ny` the surface normal's y — the ripple noise holds it near 0.996.
 */
export function waterShade(o) {
  const dep = o.depth ?? 1, bedDep = o.bedDepth ?? dep, climb = o.climb ?? 0;
  const V = [Math.cos((o.viewDeg ?? 8) * Math.PI / 180), Math.sin((o.viewDeg ?? 8) * Math.PI / 180), 0];
  const ny = o.ny ?? 0.996, nxz = Math.sqrt(Math.max(0, 1 - ny * ny)) * Math.SQRT1_2;
  const N = [nxz, ny, nxz];
  const nl = Math.hypot(N[0], N[1], N[2]); for (let i = 0; i < 3; i++) N[i] /= nl;
  const L = o.sun || [0.4, 0.24, 0.3];
  const ll = Math.hypot(L[0], L[1], L[2]); const Ln = L.map((v) => v / ll);
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * (Array.isArray(t) ? t[i] : t));
  const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

  const NdotV = clamp(dot3(N, V), 0, 1);
  const fres = 0.02 + 0.98 * Math.pow(1 - NdotV, 5);

  // the bed, lit by its own relief; climb IS the slope, so it doubles as the tilt
  const bedN = [climb * Math.SQRT1_2, 1, climb * Math.SQRT1_2];
  const bl = Math.hypot(bedN[0], bedN[1], bedN[2]); for (let i = 0; i < 3; i++) bedN[i] /= bl;
  const bed = o.bed.map((v) => v * (0.34 + 0.66 * clamp(dot3(bedN, Ln), 0, 1)));
  const trans = WATER_EXT.map((k) => Math.exp(-k * bedDep));
  const dw = 1 - Math.exp(-dep * 1.5);
  const body = mix3(o.shallow, o.deep, 1 - Math.exp(-bedDep * 0.55));
  let col = mix3(body, bed.map((v, i) => v * trans[i]), Math.exp(-bedDep * BED_FADE));
  const diffuse = col.slice();

  // R.y for a surface that is essentially level is just the view elevation
  const Ry = clamp(2 * dot3(N, V) * N[1] - V[1], 0, 1);
  const facet = ss(0.02, 0.34, Ry);
  const mirror = mix3(o.sky.map((v) => v * 0.40), mix3(o.sky, o.fog, 0.16), facet);
  const mirrorK = fres * (0.55 + dw * 0.40);
  col = mix3(col, mirror, mirrorK);

  const Rl = [2 * dot3(N, Ln) * N[0] - Ln[0], 2 * dot3(N, Ln) * N[1] - Ln[1], 2 * dot3(N, Ln) * N[2] - Ln[2]];
  const sd = Math.max(dot3(Rl, V), 0);
  const spec = Math.pow(sd, 90) * 1.9 + Math.pow(sd, 8) * 0.34;
  const sheen = [1.0, 0.96, 0.88].map((v) => v * spec * fres * (0.35 + dw * 0.65));
  col = col.map((v, i) => v + sheen[i]);

  const shore = ss(0.30, 0.03, dep) * ss(0.0, 0.025, dep);
  const lapBand = shore * ss(0.06, 0.30, climb);
  const foam = ss(0.08, 0.15, Math.abs(o.wave ?? 0)) * 0.045
    + lapBand * (0.10 + (o.lap ?? 0.5) * 0.30) * (o.broken ?? 0.65);
  col = col.map((v) => v + foam);
  const wet = ss(0.06, 0.0, dep) * ss(0.0, 0.012, dep);
  col = mix3(col, bed.map((v) => v * 0.44), wet * 0.60 * (1 - lapBand));

  const edge = ss(0.0, 0.06, dep);
  const alpha = clamp((0.34 + dw * 0.40 + fres * 0.22 + lapBand * 0.22) * edge + wet * 0.34, 0, 1);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return {
    col, alpha, fres, mirrorK, foam, wet, climb,
    // what the two halves actually contribute, so "does a grazing surface
    // mirror more than it scatters" is a comparison and not an opinion
    reflected: lum(mirror) * mirrorK + lum(sheen),
    scattered: lum(diffuse) * (1 - mirrorK) + foam,
  };
}

/** Metres of water the depth map can describe. 3 m is a river, not an ocean. */
const WATER_DEPTH_RANGE = 3.0;
/** Metres of bed rise per metre travelled the map's gradient channels can hold.
 *  A 1:1 bank is 45 degrees; 2:1 is as steep as anything a river runs past. */
const WATER_GRAD_RANGE = 2.0;
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
        value: new THREE.Vector4(1 / this._fieldSize, this._fieldSize * 0.5,
          WATER_DEPTH_RANGE, WATER_GRAD_RANGE),
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
   * "How deep is it here, and how fast is the bed climbing" — one RGBA texel,
   * depth clamped to 3 m. A byte is 1.2 cm of depth, which is finer than the
   * shoreline band it is there to draw, and it filters linearly; a packed float
   * would not.
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
    /* R is the depth. GB are the GRADIENT of that depth — how fast the bed
     * climbs, in metres per metre, signed and centred on 0.5.
     *
     * It is baked rather than differenced in the shader because the shader
     * needs it twice (for the bed's own shading, and to tell a shore from a
     * shallow so the lap does not paint the whole river) and a central
     * difference costs four more DEPENDENT texture reads on a 520 m sheet that
     * fills a third of the frame. Six reads per water pixel is enough to stop
     * the canyon booting at all under a software rasteriser; this is one, which
     * is what the single-channel version cost. Three bytes a texel for it. */
    const data = new Uint8Array(N * N * 4);
    const depth = new Float32Array(N * N);
    let wet = 0;
    // texel centres, so uv = world/size + 0.5 lands exactly on the sample
    for (let j = 0; j < N; j++) {
      const z = -half + ((j + 0.5) / N) * terrain.size;
      for (let i = 0; i < N; i++) {
        const x = -half + ((i + 0.5) / N) * terrain.size;
        const d = clamp((this.level - terrain.height(x, z)) / WATER_DEPTH_RANGE, 0, 1);
        depth[j * N + i] = d;
        data[(j * N + i) * 4] = Math.round(d * 255);
        if (d > 0) wet++;
      }
    }
    // the gradient of the CLAMPED depth, so it is the gradient the shader would
    // have differenced for itself — central where there is room, one-sided at
    // the rim
    const texel = terrain.size / N;
    const at = (i, j) => depth[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const gx = (at(i + 1, j) - at(i - 1, j)) * WATER_DEPTH_RANGE / (2 * texel);
        const gz = (at(i, j + 1) - at(i, j - 1)) * WATER_DEPTH_RANGE / (2 * texel);
        const k = (j * N + i) * 4;
        data[k + 1] = Math.round(clamp(gx / WATER_GRAD_RANGE * 0.5 + 0.5, 0, 1) * 255);
        data[k + 2] = Math.round(clamp(gz / WATER_GRAD_RANGE * 0.5 + 0.5, 0, 1) * 255);
        data[k + 3] = 255;
      }
    }
    // A sheet with no bed under it anywhere is a level whose "water" is a
    // decoration; leave it on the flat path rather than paying for a map.
    if (wet === 0) return;
    this.wetFraction = wet / (N * N);
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
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
 *     amounts of air, so the extinction sorts them into three tones by itself.
 *     Nothing here paints that gradient by hand — it emerges, which means it
 *     stays right when a level changes its air.
 *   · SCALE. The far range is 40–95 m tall. Nothing inside the play space is
 *     over 20 m, so it cannot be read as near, and something that cannot be
 *     read as near makes everything in front of it read as closer.
 *
 * One mesh per range, no colliders, no shadows, no physics: three draw calls
 * and about 2.3k triangles for the entire far distance.
 */
/* ── the one relationship that makes distance read as distance ──────────
 *
 * A LANDFORM SEEN THROUGH 300 M OF THE SAME AIR CANNOT BE BRIGHTER THAN THE
 * SKY BEHIND IT. It was, and by a lot: measured on two dune frames, the cones
 * came out at 0.703 / 0.611 / 0.688 / 0.600 display luminance against sky
 * immediately beside them at 0.547 / 0.635 / 0.537 — ratios of 1.29, 1.12,
 * 1.08, 1.12 — at hue 36-37° against a sky at 160-198°. Flat white paper
 * triangles pasted onto a photograph, which is exactly how they read.
 *
 * The cause is not the shade constants and it is not the material. It is that
 * the ranges converged on `scene.fog`, and scene.fog IS A SINGLE COLOUR while
 * the sky is not. hazeRadiance anchors that colour to the skyline BESIDE THE
 * SUN, which is the brightest sky there is. Measured on the dune atmosphere,
 * drawn sky radiance at 8° elevation:
 *
 *     bearing from sun     20°    65°   110°   155°
 *     drawn sky           0.821  0.589  0.444  0.391
 *     scene.fog                    0.589 everywhere
 *
 * So on the shade half of the horizon the thing distance dissolved into was
 * ONE AND A HALF TIMES the sky it was dissolving into. No amount of shading
 * the vertices fixes that, because the fog chunk mixes back toward the same
 * bright constant however dark you start.
 *
 * So the ranges take their asymptote from the sky IN THEIR OWN DIRECTION,
 * sampled on the CPU off the engine's own Preetham derivation.
 *
 * ── AND THEN THAT FIX GREW THE SAME BUG ONE CHANNEL OVER ────────────────
 *
 * The asymptote was `sky × [0.62, 0.68, 0.84]`. That constant is CHROMATIC:
 * whatever colour the sky is, it hands back 1.35× as much blue per unit red,
 * so the thing a range dissolves into can never be the sky it is dissolving
 * into. Measured at every crest vertex of every outdoor level against the
 * engine's own sky, saturation of the asymptote over saturation of the sky
 * directly above it:
 *
 *     dunes  1.11 – 93.6×      arena  1.15 – 53.3×      canyon  1.37 – 89.5×
 *
 * Never once below 1. On canyon the sky at 8° is WARM (hue 46–199°) while the
 * asymptote is BLUE (210–222°) — 171° away on the wheel. Aerial perspective
 * drives luminance contrast AND chroma contrast to zero; this drove luminance
 * down and chroma UP, which is why the ranges read as saturated navy paper
 * triangles where they used to read as white paper ones. The previous pass
 * measured the symptom (luminance) and bounded that; the mechanism survived in
 * the channel nobody printed.
 *
 * So there is no per-channel constant left anywhere in here. A range's
 * asymptote at infinity IS the drawn sky in its own direction, unscaled, in
 * every channel, and "darker than the sky" comes from the only term that can
 * honestly produce it:
 *
 *   · the SURFACE is a passive reflector behind a scattering medium, so it
 *     cannot out-radiate the medium. Its LEVEL is the sky's own luminance in
 *     that direction times a scalar under 1 — never a per-channel factor, so
 *     the shortfall can only ever be in value.
 *   · its CHROMA is not the sky's. A ridge is lit by the whole hemisphere plus
 *     the sun, and that irradiance is far flatter than the radiance arriving
 *     from any one direction of it, so the surface carries at most
 *     RANGE_CHROMA of the sky's own saturation, tinted by a whisper of rock.
 *
 * Both bounds are enforced where they are defined rather than hoped for, and
 * the composite inherits them: for C = mix(near, sky, f), max(C) ≤ the same mix
 * of the maxima and min(C) ≥ the same mix of the minima, so min/max of C is a
 * mediant of the two ratios and sat(C) ≤ max(sat(near), sat(sky)) = sat(sky),
 * with equality only at f = 1. Darker than its sky, less saturated than its
 * sky, and converging on it as the air thickens — which is what distance is.
 */
/** The most of the sky's own saturation a range's surface may carry. */
const RANGE_CHROMA = 0.55;
/** How much of the ground's own hue survives 300 m of air, as HSV saturation.
 *  Not much: the 0.24 mix weight this replaces was worth 0.255 saturation laid
 *  over the sky in every direction, which is a swatch, not a whisper. */
const RANGE_ROCK = 0.12;
/** Crest and foot, as a share of the layer's own shade. The foot has more low
 *  air in front of it, so it is the paler of the two — the gradient every range
 *  has. `shade` itself is the per-layer scalar: every level already authors one
 *  per ring (0.48–0.76, rising with distance) and until now NOTHING READ IT. */
const RANGE_CREST = 0.72, RANGE_FOOT = 1.0;
/** Default shade if a caller hands layers without one. */
const RANGE_SHADE = [0.55, 0.63, 0.71];
/** How far the sun may push a face either side of the layer's shade. Now that
 *  the facing is a real surface normal it swings both ways, so a summit gets a
 *  lit flank AND a shaded one; the bound keeps shade × k under 1. */
const RANGE_LIT = 0.22;
/** How hard the along-crest slope rakes the face away from straight inward.
 *  1 means a flank falling at 45° along the ridge faces 45° off the radial. */
const RANGE_RAKE = 1.0;

/* The shared uniforms. One material, three meshes, and the storm arrives
 * through the same single scheduler everything else reads (`ground.weather`)
 * rather than through a second copy that could disagree with it. */
const _ridgeU = {
  // x: 1/scale-height, y: base height, z: calm density, w: the squall's gain
  uRidgeAir: { value: new THREE.Vector4(1 / 38, 0, 0.0042, 3.6) },
  uRidgeStorm: { value: 0 },
  uRidgeDust: { value: new THREE.Color(0.72, 0.68, 0.6) },
  // Same ceiling Weather holds scene.fog to, so the ranges and the ground in
  // front of them never disagree about how much air a squall put between you
  // and them — which would show up as the far distance clearing before the
  // middle distance did.
  uRidgeMax: { value: FOG_STORM_LIMIT },
};

const RIDGE_GLSL = {
  pars: /* glsl */`
  attribute vec3 aNear;      // the range's own surface, in drawn-sky radiance
  attribute vec3 aFar;       // what it dissolves into: the sky in ITS direction
  uniform vec4 uRidgeAir;
  uniform float uRidgeStorm, uRidgeMax;
  uniform vec3 uRidgeDust;
  varying vec3 vRidge;
  `,

  /* The extinction is computed here rather than baked, and that is not a
   * detail: it is the only reason walking toward a range darkens it. Same
   * height integral the engine's aerial-perspective chunk runs, so the ranges
   * and the ground in front of them agree about how much air there is. */
  body: /* glsl */`
  {
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 ray = wp - cameraPosition;
    float radial = length(ray);
    float y0 = clamp(cameraPosition.y - uRidgeAir.y, -40.0, 600.0);
    float k = ray.y * uRidgeAir.x;
    float t0 = exp(-y0 * uRidgeAir.x);
    float m = abs(k) < 1.0e-3 ? t0 : t0 * (1.0 - exp(-k)) / k;
    float path = radial * clamp(m, 0.0, 6.0);
    float dens = min(uRidgeAir.z * (1.0 + uRidgeAir.w * uRidgeStorm), uRidgeMax);
    float f = 1.0 - exp(-dens * dens * path * path);
    vec3 c = mix(aNear, aFar, f);
    // A front does not thin the ranges, it REPLACES them: what is between you
    // and the horizon stops being air and starts being sand. The extinction
    // term above already grows with the storm; this is the rest of the way, so
    // that at full strength there is nothing out there but the wall itself.
    vRidge = mix(c, uRidgeDust, clamp(uRidgeStorm * (0.30 + f * 1.5), 0.0, 1.0));
  }
  `,
};

let _ridgeMat = null;
function ridgeMaterial() {
  if (_ridgeMat) return _ridgeMat;
  // Basic, not standard: this is terrain seen through a kilometre of air, and
  // at that range the only thing that survives is its mean radiance and the
  // air in front of it. Lighting it properly would cost the same and change
  // nothing.
  //
  // `fog: false` and the aerial term done by hand, because three's fog — and
  // the engine's chunk on top of it — converges on ONE colour for the whole
  // sky. That is the entire bug this file was scored on. Injected into the
  // stock basic shader rather than written as a ShaderMaterial so tone
  // mapping, the output colour space and dithering all still happen: a raw
  // ShaderMaterial silently opts out of every one of them.
  _ridgeMat = new THREE.MeshBasicMaterial({
    fog: false, side: THREE.DoubleSide, depthWrite: true,
  });
  _ridgeMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, _ridgeU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${RIDGE_GLSL.pars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${RIDGE_GLSL.body}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRidge;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb = vRidge;');
  };
  return _ridgeMat;
}

/**
 * The dome as it is actually DRAWN, on the CPU: the same Preetham radiance the
 * sky mesh evaluates, through the same display shoulder. Not a transcription —
 * these are the engine's own exported functions, so a change to either lands
 * here in the same commit.
 */
function drawnSky(bearing, sinEl, out) {
  const B = ground.skyBand;
  // No dome in this scene — nothing has derived a sky, so there is nothing to
  // stand under. Falls back to the haze already loaded into the dust uniform,
  // pulled well down: still darker than any plausible sky, just not directional.
  if (!B) return out.copy(_ridgeU.uRidgeDust.value).multiplyScalar(0.62);
  const u = (bearing * 0.15915494367 + 0.5) * B.az - 0.5;
  const v = clamp((sinEl / B.top) * B.el - 0.5, 0, B.el - 1.001);
  const i0 = Math.floor(u), j0 = Math.floor(v);
  const fu = u - i0, fv = v - j0;
  // bearing wraps, elevation clamps
  const ia = ((i0 % B.az) + B.az) % B.az, ib = (ia + 1) % B.az;
  const ja = j0, jb = Math.min(j0 + 1, B.el - 1);
  const g = B.rgb;
  const pa = (ja * B.az + ia) * 3, pb = (ja * B.az + ib) * 3;
  const pc = (jb * B.az + ia) * 3, pd = (jb * B.az + ib) * 3;
  const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv;
  return out.setRGB(
    g[pa] * w00 + g[pb] * w10 + g[pc] * w01 + g[pd] * w11,
    g[pa + 1] * w00 + g[pb + 1] * w10 + g[pc + 1] * w01 + g[pd + 1] * w11,
    g[pa + 2] * w00 + g[pb + 2] * w10 + g[pc + 2] * w01 + g[pd + 2] * w11,
    THREE.LinearSRGBColorSpace);
}

const _rc = new THREE.Color();
/**
 * The sky a given piece of range dissolves into: ITS OWN DIRECTION for colour,
 * held down to the dimmest LEVEL that sky reaches anywhere the player could put
 * that crest.
 *
 * The two halves are separate on purpose, and getting them tangled is what the
 * last pass was scored for. The floor is what turns "usually darker" into
 * "darker": the player walks, and a range at 170 m swings a long way across the
 * compass when they do, so a value baked against the sky in one pose has to
 * survive every other one. But a floor taken as a COLOUR imports the chroma of
 * whatever bearing won, and 32° off the sun that is a completely different sky
 * — which is how an asymptote beside a sky at 0.006 saturation ended up at
 * 0.5. So the win is applied as a SCALAR on the sky in the crest's own
 * direction: same hue, same saturation, lower level. Both properties, one
 * value, and it stays continuous because a minimum of continuous samples is.
 */
function skyFloorAt(bearing, el, swing, out) {
  // the sky this crest actually stands against — the colour, unscaled
  drawnSky(bearing, Math.sin(el + 0.035), out);
  const own = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722;
  let floor = own;
  for (let i = -1; i <= 1; i++) {
    const b = bearing + i * swing;
    for (const de of [0.035, 0.122]) {        // +2° and +7° above the crest
      const c = drawnSky(b, Math.sin(el + de), _rc);
      floor = Math.min(floor, c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722);
    }
  }
  return out.multiplyScalar(floor / Math.max(1e-5, own));
}

/** HSV saturation — (max − min) / max. The plain one, because it is the one a
 *  picker shows and the one an art director reads off a swatch. */
function satOf(c) {
  const mx = Math.max(c.r, c.g, c.b);
  return mx <= 1e-6 ? 0 : (mx - Math.min(c.r, c.g, c.b)) / mx;
}

/**
 * Pull a colour toward its own luminance-grey until its saturation is at most
 * `maxSat`, leaving its luminance untouched.
 *
 * Closed form rather than a loop, and that matters: saturation along the pull
 * t ∈ [0,1] is s(t) = t·(mx−mn) / ((1−t)·g + t·mx), which is monotone with
 * s(0)=0 and s(1)= the colour's own saturation, so setting s(t) = maxSat and
 * solving gives exactly the pull that lands on the bound. Anything iterative
 * here would be a tolerance nobody could quote.
 */
function capChroma(c, maxSat) {
  const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
  if (mx <= 1e-6) return c;
  const s = (mx - mn) / mx;
  if (s <= maxSat) return c;
  const g = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  // The denominator is positive whenever s > maxSat: maxSat·(mx−g) < s·(mx−g)
  // ≤ s·mx = mx−mn, because mn ≤ g ≤ mx for any luminance-weighted mean.
  const t = clamp((maxSat * g) / ((mx - mn) - maxSat * (mx - g)), 0, 1);
  return c.setRGB(g + (c.r - g) * t, g + (c.g - g) * t, g + (c.b - g) * t,
    THREE.LinearSRGBColorSpace);
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
  // The level's own atmosphere block, which is what the sky is drawn from. It
  // is applied before dressing runs, so by here it is the live one.
  const atmo = opts.atmosphere || world.level?.atmosphere || {};
  // Read off the light the level hung rather than re-derived from the block:
  // Engine parks the key at sunPos × 90, so this IS the engine's own answer.
  const sun = opts.sunDir || sceneLights(scene).sun?.position || _v2.set(0.4, 0.7, 0.3);
  const sx = sun.x, sz = sun.z;
  const sl = Math.hypot(sx, sz) || 1;
  // What a squall replaces the distance with. scene.fog carries the engine's
  // metered haze RADIANCE — the only value in the frame in the right units.
  const haze = fogColorOf(scene, new THREE.Color());
  // The ground's hue, demoted to a hue: renormalised so it can only say WHAT
  // COLOUR and never HOW BRIGHT, then pulled most of the way to neutral. A
  // range 300 m off keeps a whisper of the rock it is made of and no more.
  const rock = new THREE.Color(atmo.groundColor ?? 0x60482e);
  const rl = rock.r * 0.2126 + rock.g * 0.7152 + rock.b * 0.0722;
  // Unit luminance, then held to a saturation rather than to a mix weight. A
  // mix weight is not a bound on anything the eye reads: 0.24 toward the dune
  // sea's own 0x8a6a44 came out at 0.255 saturation, which is a swatch laid
  // over every direction of the sky, not a whisper of rock.
  capChroma(rock.multiplyScalar(1 / Math.max(0.02, rl)), RANGE_ROCK);

  // Hand the shared material this level's air and its dust wall.
  _ridgeU.uRidgeAir.value.set(1 / (atmo.fogHeight ?? 38), atmo.fogBase ?? 0,
    atmo.fogDensity ?? 0.0035, world.level?.dust?.weather?.fogGain ?? 3.2);
  _ridgeU.uRidgeDust.value.copy(haze);

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
    /* RESOLUTION IS SET IN BEARING, NOT IN METRES, because the silhouette is
     * what the eye samples and the silhouette lives on the compass. The old
     * "one vertex every 2.4 m" ran straight into a 256 cap on every ring, which
     * is 1.4° a segment — and the profile's finest octave was authored at 22×
     * its base, i.e. a 6.7 m wavelength on an 8.2 m sampling. Everything above
     * the mesh's Nyquist came back as single-segment spikes, and a spike drawn
     * across two vertices IS a triangle with dead-straight sides. That is the
     * sawtooth in the shot, and no amount of extra noise would have fixed it.
     *
     * 512 puts a segment at 0.70°, ~13 px at 1280 wide, and every band below is
     * chosen so its own finest octave stays under seg/6 — six samples a period,
     * which is a shape rather than a spike. 1024 triangles a ring, ~3.1k for
     * the whole far distance. */
    const seg = 512;
    /* THREE ROWS, and the middle one is the whole reason. The mesh runs from
     * 45 m below grade (so no gap ever opens under it where the ground in front
     * dips) to the crest, and with two rows the asymptote was computed ONCE per
     * column, at the crest's own elevation, and then interpolated all the way
     * down. But the sky is not flat over that: the body of a range stands
     * against the horizon band, which is several times less saturated than the
     * sky a few degrees higher. Measured over the visible band — crest down to
     * grade — the range came out up to 0.336 of saturation ABOVE the sky
     * immediately beside it, which is the same failure as the constant, sourced
     * from the interpolation instead. A row at grade gives the visible band a
     * top and a bottom that each converge on their own piece of sky. */
    const rows = 3;
    const pos = new Float32Array((seg + 1) * rows * 3);
    const near = new Float32Array((seg + 1) * rows * 3);
    const far = new Float32Array((seg + 1) * rows * 3);
    const idx = [];
    /* How far round the compass a piece of this range can swing while the
     * player walks. asin(roam / radius): 90 m of roam puts the near ring at
     * 32° and the far one at 15°, and the sky floor is taken over that whole
     * window so the guarantee survives the walk rather than only the pose it
     * was baked at. */
    const swing = Math.asin(clamp(90 / R, 0, 0.9));
    const shade = cfg.shade ?? RANGE_SHADE[Math.min(L, RANGE_SHADE.length - 1)];
    const off = seed * 0.37 + L * 91.3;

    /* ── the profile, built in HARMONICS AROUND THE COMPASS ──────────────
     *
     * The noise is still sampled on a circle so the profile closes on itself
     * seamlessly, but the circle's radius is chosen in NOISE cells rather than
     * from the ring's own metres: value noise puts about one extremum in every
     * cell, so K features around the horizon wants a circle 2K cells around,
     * i.e. radius K/π. Saying it that way is the whole correction — it makes
     * the silhouette's content a property of the PICTURE (features per degree
     * of bearing) instead of a consequence of how far out the ring happens to
     * be, and it makes every band answerable to the mesh's Nyquist.
     *
     * Four bands, because a ridgeline has energy at every scale it can hold and
     * a cone has one:
     *   MASSIF  3-5 round the horizon — which range is high country and which
     *           is a low sill. Without it every peak stands on the same line.
     *   CREST   12-18 summits, 20-30° apart. Ridged, because mountains have
     *           sharp tops and broad saddles.
     *   SPUR    24-34 — the shoulders and notches that break a flank so it is
     *           not one straight run from saddle to summit.
     *   GRAIN   60-76, the finest thing the mesh can still draw as a shape.
     * The top harmonic any band reaches (GRAIN × fbm's own second octave, and
     * CREST × ridged's fourth) stays under seg/6, so nothing here is a spike. */
    const nrM = (3 + L) / Math.PI;
    const nrC = (12 + L * 3) / Math.PI;
    const nrS = (24 + L * 5) / Math.PI;
    const nrG = (30 + L * 4) / Math.PI;
    const prof = new Float64Array(seg + 1);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const cx = Math.cos(a), cz = Math.sin(a);
      // Octave counts are not taste: sampling on a circle 2K cells around puts
      // a band's own finest octave at K·lacunarity^(n−1) harmonics, so ridged's
      // four octaves would have asked for 106-160 — past the seg/6 the mesh can
      // draw as a shape, which is the fault this whole pass exists to undo.
      // Three puts it at 51-77, and every other band is a two-octave fbm.
      const massif = fbm2(cx * nrM + off, cz * nrM - off, 2);          // → 6-10
      const crest = ridged2(cx * nrC - off, cz * nrC + off, 3);        // → 51-77
      const spur = fbm2(cx * nrS + off * 1.7, cz * nrS - off * 1.7, 2); // → 49-69
      const grain = fbm2(cx * nrG - off * 2.3, cz * nrG + off * 2.3, 2); // → 61-77
      // Weighted so the sum lands inside [0,1] on its own. The old form leaned
      // on clamp() to hold it, and a clamped profile is a FLAT one: 4-11% of
      // every ring sat on the bottom rail, which is a dead-level saddle.
      const t = 0.30 + massif * 0.42 + crest * 0.62 + spur * 0.30 + grain * 0.13;
      prof[i] = clamp(t, 0, 1);
    }
    prof[seg] = prof[0];          // the ring closes on itself exactly

    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const cx = Math.cos(a), cz = Math.sin(a);
      const x = cx * R, z = cz * R;
      const h = lerp(cfg.low, cfg.high, prof[i]);
      const g = terrain ? terrain.height(x, z) : 0;
      // rooted deep, so nothing ever shows under it; grade is where the terrain
      // in front takes over, which is where the visible band ends
      const yRow = [g - 45, g, g + h];

      /* ── which way this piece of range is facing ────────────────────────
       * We stand INSIDE the ring, so what we see is its inward face, and the
       * sun lights the ranges on the far side of the compass from it while
       * back-lighting the ones standing in front of it. The old term used the
       * OUTWARD radial and so brightened exactly the contre-jour half — stand
       * in a bowl of mountains at dawn and it is the WESTERN wall that is gold.
       *
       * The along-crest slope then rakes that face peak by peak: a flank
       * climbing to the right presents a surface tilted back down-arc, which
       * is what gives a summit a lit side and a shaded side instead of the
       * whole ring having a bright half. dh/darc is taken across the two
       * neighbours, and the ring wraps, so there is no seam at bearing 0. */
      const im = (i - 1 + seg) % seg, ip = (i + 1) % seg;
      const slope = ((prof[ip] - prof[im]) * (cfg.high - cfg.low))
        / (2 * (TAU * R) / seg);
      const tanx = -cz, tanz = cx;
      let nx = -cx - tanx * slope * RANGE_RAKE;
      let nz = -cz - tanz * slope * RANGE_RAKE;
      const nl = Math.hypot(nx, nz) || 1;
      const il = (nx * sx + nz * sz) / (nl * sl);          // −1 back-lit … +1 lit
      const k = 1 + RANGE_LIT * il;

      /* ── and what it hands back ─────────────────────────────────────────
       * LEVEL: the sky's own luminance in THAT ROW'S direction times a scalar
       * under 1. `rock` carries unit luminance by construction, so the
       * shortfall from the asymptote is exactly that scalar — never a
       * per-channel one, which is the whole bug this replaces. The row at grade
       * is paler than the crest because there is more low haze in front of it,
       * and `shade` is the layer's own (every level authors one; nothing read
       * it until now), so three rings separate in tone because they are three
       * DEPTHS.
       *
       * CHROMA: at most RANGE_CHROMA of the sky's own saturation, and of the
       * saturation of the piece of sky THIS row stands against. A ridge is lit
       * by the whole hemisphere plus the sun, and that irradiance is far
       * flatter than the radiance arriving from any one direction of it — so
       * beside the sun, where the sky whites out to 0.006 saturation, the
       * surface goes neutral with it instead of staying a fixed navy. */
      const cRow = [Math.min(0.95, shade * RANGE_FOOT * k), 0,
        Math.min(0.95, shade * RANGE_CREST * k)];
      cRow[1] = cRow[0];                 // below grade is the grade row's tone
      for (let s = 0; s < rows; s++) {
        const v = (i * rows + s) * 3;
        pos[v] = x; pos[v + 1] = yRow[s]; pos[v + 2] = z;
        /* THE ASYMPTOTE, UNSCALED, IN EVERY CHANNEL. At infinity a landform IS
         * the sky in its own direction; anything multiplied onto it here is a
         * colour the range converges on that the sky never reaches. Held down
         * to the dimmest level that sky reaches anywhere the player can put
         * this crest — a scalar, so the colour stays the sky's own. */
        const el = Math.max(0.004, Math.atan2(yRow[Math.max(s, 1)] - 1.75, R));
        skyFloorAt(a, el, swing, _rc2);
        const skyLum = _rc2.r * 0.2126 + _rc2.g * 0.7152 + _rc2.b * 0.0722;
        const tint = capChroma(_rc3.copy(rock), RANGE_CHROMA * satOf(_rc2));
        const c = cRow[s] * skyLum;
        far[v] = _rc2.r; far[v + 1] = _rc2.g; far[v + 2] = _rc2.b;
        near[v] = tint.r * c; near[v + 1] = tint.g * c; near[v + 2] = tint.b * c;
      }
      if (i < seg) {
        const a0 = i * rows, b0 = (i + 1) * rows;
        for (let s = 0; s < rows - 1; s++) {
          idx.push(a0 + s, b0 + s, a0 + s + 1, a0 + s + 1, b0 + s, b0 + s + 1);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aNear', new THREE.BufferAttribute(near, 3));
    geo.setAttribute('aFar', new THREE.BufferAttribute(far, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, ridgeMaterial());
    // The storm arrives through the same single scheduler everything else
    // reads. Pulled per draw rather than pushed from Atmosphere so a level
    // that builds ranges without an Atmosphere still behaves.
    mesh.onBeforeRender = () => {
      _ridgeU.uRidgeStorm.value = ground.weather ? ground.weather.intensity : 0;
    };
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
     * This used to be held at 0.0098 by a threshold that had nothing to do
     * with weather — Terrain._syncAtmosphere's indoor test — and the cost was
     * the whole effect: the dune sea's squall took visibility to 85 m instead
     * of the 43 m its own numbers ask for, and a full-strength front moved the
     * arena's median frame luminance by five per cent. Terrain now tests the
     * density the level AUTHORED rather than the one the frame is running, so
     * the levels' own gains reach the frame: dunes 198 → 43 m, canyon 160 → 36
     * m, arena 245 → 86 m. FOG_STORM_LIMIT is a bound on a runaway now, not a
     * workaround, and nothing authored comes near it. */
    // The `max` is not belt and braces: a bare `min` against the cap DROPPED
    // the hangar's authored 0.016 to 0.0098 on a level with no weather at all,
    // which is the storm system quietly re-lighting an interior it is not even
    // running in. Weather may only ever ADD to what the level authored — and
    // Terrain's indoor test now depends on exactly that being true.
    if (this._fog) {
      this._fog.density = Math.max(this._fogBase,
        Math.min(FOG_STORM_LIMIT, this._fogBase * (1 + W.fogGain * I)));
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
