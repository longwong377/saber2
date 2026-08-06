/**
 * SABER — renderer, HDR pipeline, post stack.
 *
 * Scene renders into a multisampled half-float target so the blade and the
 * bolts stay bright above 1.0 and bloom picks them up honestly; ACES filmic
 * tonemapping brings it back down at the end. The composite pass is where the
 * frame gets its character — grain, chromatic aberration, vignette, heat haze
 * off the blade, and the desaturated pull of Force Sense.
 *
 * Two things here are load-bearing for whether the frame reads as photographed:
 *
 *   1. THE SKY IS ACTUAL RADIANCE. three's Preetham sky ships display-referred:
 *      its last line is pow(texColor, 1/2.4), which is a gamma curve applied to
 *      a value we then consume as LINEAR light. Measured on the dune atmosphere,
 *      the true sky spans 100:1 from zenith (0.23) to the horizon glow beside
 *      the sun (21.7); that pow flattens it to 7:1, and ACES then squeezes the
 *      remainder into a fifty-value band. That is the entire reason the sky was
 *      a flat wash, why nothing in it bloomed, and why the image-based light
 *      baked from it had no direction. `_linearSky` undoes it.
 *
 *   2. FOG IS AERIAL PERSPECTIVE, not a wash. `_installAerialPerspective`
 *      replaces three's fog chunk with height-stratified extinction plus sun
 *      inscattering, so distance separates into layers and haze glows toward
 *      the sun. It reaches every material in the game — terrain, grass, water,
 *      props — without any of them knowing, because it is the stock chunk.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { SkyDome } from './SkyDome.js';
import { noiseTexture } from './Textures.js';
import { clamp, damp } from './MathUtil.js';

export const QUALITY = {
  // shadowDist is the radius of the one cascade. It is also the distance at
  // which the world visibly stops being lit: past it a colonnade throws
  // nothing, and a landscape with no shadows in the middle distance reads as a
  // painted backdrop. Widened at every tier — the texel cost is linear
  // (2·d/res: 5.7 cm at medium, up from 4.5) and buys a third more depth.
  low:    { shadow: 1024, msaa: 0, pixelRatio: 1.0,  bloom: true,  grass: 0.25, particles: 0.4, shadowDist: 42, viewDist: 380 },
  medium: { shadow: 2048, msaa: 2, pixelRatio: 1.0,  bloom: true,  grass: 0.55, particles: 0.7, shadowDist: 58, viewDist: 520 },
  high:   { shadow: 3072, msaa: 4, pixelRatio: 1.25, bloom: true,  grass: 1.0,  particles: 1.0, shadowDist: 76, viewDist: 700 },
  ultra:  { shadow: 4096, msaa: 4, pixelRatio: 1.5,  bloom: true,  grass: 1.5,  particles: 1.35, shadowDist: 96, viewDist: 900 },
};

/* ── aerial perspective ──────────────────────────────────────────────────
 *
 * three's fog is one colour mixed in by distance. That is not what distance
 * does. Distance does two things, and the frame reads flat without both:
 *
 *   • EXTINCTION IS STRATIFIED. Haze is a fluid sitting in a gravity well, so
 *     it is dense at the valley floor and thin on the ridge tops. A ridge two
 *     hundred metres away therefore has a hazy base and a clear crest, which is
 *     the layering that makes a landscape read as deep. Uniform fog gives every
 *     surface at 200m exactly the same veil and flattens the whole range into
 *     one card.
 *   • THE HAZE IS LIT. It scatters sunlight forward hard, so looking toward the
 *     sun it glows and looking away it goes cool and blue. That single gradient
 *     across the frame is most of what "photographed" means outdoors.
 *
 * Both are computed here, and it reaches EVERY material in the game — terrain,
 * grass, water, props, characters, the hand-written shaders in Scenery.js —
 * because it *is* the stock chunk. Nothing else has to know.
 *
 * The uniforms travel by a deliberate trick: three's UniformsUtils.clone copies
 * a uniform value by reference unless it is a Color/Vector/Matrix/Texture/Array.
 * A plain {x,y,z,w} is none of those, so every material that clones the fog
 * uniforms ends up pointing at THE SAME object, and one write per frame updates
 * the entire scene. The GL uniform setters accept it because they only ever ask
 * for .x/.y/.z/.w.
 *
 * If any of it fails to arrive — a shader that never merged UniformsLib.fog, a
 * material compiled before install — the uniforms read as zero and the chunk
 * falls through to exactly three's stock behaviour rather than to black.
 */

export const AERIAL = {
  // x: 1/scale-height, y: base height, z: unused, w: extinction multiplier
  shape: { x: 0, y: 0, z: 0, w: 1 },
  // xyz: sun direction, w: inscatter strength (0 disables)
  sun: { x: 0, y: 1, z: 0, w: 0 },
  // rgb: inscatter colour, w: phase anisotropy
  tint: { x: 0, y: 0, z: 0, w: 0.7 },
};

let _aerialInstalled = false;
function installAerialPerspective(THREE_) {
  if (_aerialInstalled) return false;
  _aerialInstalled = true;
  const C = THREE_.ShaderChunk;

  // The world-space offset from the camera, without needing `worldPosition`
  // (which three only defines for envmap/shadow/transmission builds) and
  // without touching any shader's own code. v * mat3(M) is transpose(M) * v,
  // and the view matrix is rigid, so that is exactly the inverse rotation.
  C.fog_pars_vertex = [
    '#ifdef USE_FOG',
    '  varying float vFogDepth;',
    '  varying vec3 vFogRay;',
    '#endif',
  ].join('\n');

  C.fog_vertex = [
    '#ifdef USE_FOG',
    '  vFogDepth = - mvPosition.z;',
    '  vFogRay = mvPosition.xyz * mat3( viewMatrix );',
    '#endif',
  ].join('\n');

  C.fog_pars_fragment = [
    '#ifdef USE_FOG',
    '  uniform vec3 fogColor;',
    '  varying float vFogDepth;',
    '  varying vec3 vFogRay;',
    '  uniform vec4 uAerialShape;',
    '  uniform vec4 uAerialSun;',
    '  uniform vec4 uAerialTint;',
    '  #ifdef FOG_EXP2',
    '    uniform float fogDensity;',
    '  #else',
    '    uniform float fogNear;',
    '    uniform float fogFar;',
    '  #endif',
    '#endif',
  ].join('\n');

  C.fog_fragment = [
    '#ifdef USE_FOG',
    '  float fogRadial = length( vFogRay );',
    '  float fogPath = vFogDepth;',
    '  if ( uAerialShape.x > 0.0 ) {',
    // Analytic integral of exp(-h/H) along the view ray: the whole point is
    // that a ray climbing out of the haze accumulates far less than one
    // crossing the valley floor at the same length.
    '    float y0 = clamp( cameraPosition.y - uAerialShape.y, -40.0, 600.0 );',
    '    float k = vFogRay.y * uAerialShape.x;',
    '    float t0 = exp( - y0 * uAerialShape.x );',
    '    float m = abs( k ) < 1.0e-3 ? t0 : t0 * ( 1.0 - exp( - k ) ) / k;',
    '    fogPath = fogRadial * clamp( m, 0.0, 6.0 ) * uAerialShape.w;',
    '  }',
    '  #ifdef FOG_EXP2',
    '    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogPath * fogPath );',
    '  #else',
    '    float fogFactor = smoothstep( fogNear, fogFar, fogPath );',
    '  #endif',
    '  vec3 fogTone = fogColor;',
    '  if ( uAerialSun.w > 0.0 ) {',
    '    vec3 fogDir = vFogRay / max( fogRadial, 1.0e-4 );',
    '    float fogCos = dot( fogDir, uAerialSun.xyz );',
    '    float g = uAerialTint.w;',
    '    float g2 = g * g;',
    '    float phase = ( 1.0 - g2 ) / pow( max( 1.0 + g2 - 2.0 * g * fogCos, 1.0e-4 ), 1.5 );',
    // Rayleigh-ish backscatter keeps the anti-sun side from going dead flat.
    '    float back = 0.75 * ( 1.0 + fogCos * fogCos );',
    '    fogTone += uAerialTint.xyz * uAerialSun.w * ( phase + back * 0.16 );',
    '  }',
    '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTone, fogFactor );',
    '#endif',
  ].join('\n');

  // Publish the shared uniforms everywhere a fogged material can pick them up.
  const extra = () => ({
    uAerialShape: { value: AERIAL.shape },
    uAerialSun: { value: AERIAL.sun },
    uAerialTint: { value: AERIAL.tint },
  });
  Object.assign(THREE_.UniformsLib.fog, extra());
  for (const key of Object.keys(THREE_.ShaderLib)) {
    const u = THREE_.ShaderLib[key].uniforms;
    if (u && u.fogColor) Object.assign(u, extra());
  }
  return true;
}

installAerialPerspective(THREE);

const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color(), _c4 = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

/**
 * The frame is exposed for the highlights and graded for contrast, which is
 * the order a camera does it in. ACES has a long shoulder; a scene pushed up
 * against it comes out with no separation left in the top half, so exposure is
 * pulled down and the job of making the image contrasty is handed to the grade,
 * where a black point and an S-curve can do it without destroying highlights.
 *
 * EXPOSURE is the trim for interiors, which have no atmosphere to meter — their
 * light comes from lamps this cannot see. Outdoors, exposure is METERED (see
 * `atmosphereMeter`): the authored value becomes a ± bias about a measured key
 * instead of an absolute. It has to be. The authored numbers span 0.86 to 0.94
 * across three levels whose actual ground irradiance spans 2.2 to 5.2 — a stop
 * and a quarter of real difference against a 5% nominal one — so the canyon
 * shipped nearly a stop underexposed and the arena nearly a stop over, and no
 * amount of grading fixes a frame that is simply metered wrong.
 */
const EXPOSURE = 0.92;

/** Radiance a mid-grey horizontal surface should land on. Calibrated so the
 *  dune sea, the one level that was correctly exposed, does not move. */
const KEY = 0.191;

/** How much of the environment probe is allowed to count as light. */
const ENV_INTENSITY = 0.38;

/** The hemisphere light is a floor under the probe, not a second ambient. */
const HEMI_TRIM = 0.45;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _sv1 = new THREE.Vector3(), _sv2 = new THREE.Vector3();
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

/* ── the sky, evaluated on the CPU ───────────────────────────────────────
 *
 * The same Preetham model the dome runs, in JS, so the things that have to
 * agree with the sky can be derived from it instead of guessed at: the haze
 * distance dissolves into, and the colour that haze glows when it is between
 * you and the sun. Guessing those is how a level ends up with fog the same
 * colour as its own sand — 50% fog at two hundred metres that changes nothing,
 * and a horizon where the land meets the sky at a hard edge.
 *
 * Transcribed from vendor/three/objects/Sky.js. tools/checks/lighting.mjs pins
 * it against the shader's own constants.
 */
const SKY = {
  betaR: [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5],
  mieConst: [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14],
  cutoff: 1.6110731556870734, steepness: 1.5, EE: 1000,
  rayleighZenith: 8.4e3, mieZenith: 1.25e3,
};

export function skyRadiance(dir, sunDir, a, out = new THREE.Color()) {
  const turbidity = a.turbidity ?? 6, rayleigh = a.rayleigh ?? 2.2;
  const mieCoefficient = a.mie ?? 0.008, g = a.mieG ?? 0.82;
  // Private scratch. Callers routinely pass _v1/_v2 in as `dir`, so borrowing
  // them here would clobber the caller's own vector between two calls.
  const d = _sv1.copy(dir).normalize(), s = _sv2.copy(sunDir).normalize();
  const sunE = SKY.EE * Math.max(0, 1 - Math.exp(-((SKY.cutoff - Math.acos(clamp(s.y, -1, 1))) / SKY.steepness)));
  // vSunfade uses the raw sunPosition.y, which the engine always feeds as a
  // unit vector, so exp(y/450000) is 1 to eleven places and this is 1.
  const rc = rayleigh;
  const zen = Math.acos(Math.max(0, d.y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  const sR = SKY.rayleighZenith * inv, sM = SKY.mieZenith * inv;
  const cosT = d.dot(s);
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g2 = g * g;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(Math.max(1 - 2 * g * cosT + g2, 1e-6), 1.5));
  const mie = 0.434 * (0.2 * turbidity) * 10e-18;
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const bR = SKY.betaR[i] * rc, bM = SKY.mieConst[i] * mie * mieCoefficient;
    const Fex = Math.exp(-(bR * sR + bM * sM));
    const ratio = (bR * rPhase + bM * mPhase) / (bR + bM);
    let Lin = Math.pow(sunE * ratio * (1 - Fex), 1.5);
    const k = clamp(Math.pow(1 - s.y, 5), 0, 1);
    Lin *= 1 + (Math.sqrt(sunE * ratio * Fex) - 1) * k;
    c[i] = (Lin + 0.1 * Fex) * 0.04;
  }
  return out.setRGB(c[0] + 0, c[1] + 0.0003, c[2] + 0.00075, THREE.LinearSRGBColorSpace);
}

/** The shoulder _linearSky bakes into the dome, so the CPU side agrees with it. */
export function skyShoulder(c, knee = 2.4, ceil = 9.5) {
  const span = Math.max(ceil - knee, 0.001);
  const f = (v) => Math.min(v, knee) + span * (1 - Math.exp(-Math.max(v - knee, 0) / span));
  return c.setRGB(f(c.r), f(c.g), f(c.b), THREE.LinearSRGBColorSpace);
}

/** Where the sun is, from an atmosphere block. */
export function sunDirection(a, out = new THREE.Vector3()) {
  return out.setFromSphericalCoords(1,
    THREE.MathUtils.degToRad(90 - (a.elevation ?? 22)),
    THREE.MathUtils.degToRad(a.azimuth ?? 140));
}

/**
 * The light meter, and the ambient budget that goes with it. Pure function of
 * an atmosphere block so it can be checked without a GL context.
 *
 * Integrates the whole sky, cosine-weighted, for the irradiance it actually
 * lands on a horizontal surface. Two things come out of that:
 *
 *   • HOW MUCH INDIRECT LIGHT TO ALLOW. Preetham's sky is bright relative to
 *     the sun intensities the levels author, and a scene whose indirect light
 *     rivals its direct light has no shape in it — every surface reads the same
 *     whichever way it faces. Measured: the arena's sky puts 2.34 on the ground
 *     against 2.74 from its sun, and it looked like a white-out. Capping
 *     indirect at 55% of direct is the difference between a lit scene and a
 *     lightbox, and it is about where a real daylit scene sits anyway.
 *   • WHAT EXPOSURE PUTS A MID-GREY ON THE CURVE. The authored exposures span
 *     5% across three levels whose real ground irradiance spans 140%, so the
 *     canyon shipped the best part of a stop under and the arena a stop over.
 *     The authored number becomes a ± bias about the measured key.
 */
export function atmosphereMeter(a) {
  const sunPos = sunDirection(a, new THREE.Vector3());
  const sunI = a.sunIntensity ?? 3.6;
  const outdoor = a.sky !== false;
  const hemiI = (a.ambient ?? 0.85) * (outdoor ? HEMI_TRIM : 1);
  const fillI = a.fillIntensity ?? 0.25;
  const hemiIrr = hemiI * lum(_c2.set(a.skyColor ?? 0xbcd8ff));
  const fillIrr = fillI * lum(_c2.set(a.fillColor ?? 0x9fc4ff)) * 0.5;
  // A landscape is not a flat plate, so only part of it takes the sun square
  // on; 0.7 is about the average of cos over gently rolling ground.
  const direct = outdoor ? sunI * Math.max(sunPos.y, 0) * 0.7 : sunI * 0.7;

  if (!outdoor) {
    // No atmosphere to meter — an interior is lit by lamps this cannot see.
    return { sunPos, outdoor, direct, skyFull: 0, envI: ENV_INTENSITY,
      irradiance: direct + hemiIrr + fillIrr, key: null,
      exposure: (a.exposure ?? 1.05) * EXPOSURE };
  }

  let e = 0, w = 0;
  for (let ring = 0; ring < 4; ring++) {
    const el = ((ring + 0.5) / 4) * (Math.PI / 2);
    const s = Math.sin(el), c = Math.cos(el);
    for (let k = 0; k < 6; k++) {
      const az = ((k + 0.5) / 6) * Math.PI * 2;
      _v1.set(s * Math.cos(az), c, s * Math.sin(az));
      e += lum(skyShoulder(skyRadiance(_v1, sunPos, a, _c1))) * c * s;
      w += c * s;
    }
  }
  const skyFull = Math.PI * (e / Math.max(w, 1e-6)) * ENV_INTENSITY;
  const envI = ENV_INTENSITY * clamp(0.55 * direct / Math.max(skyFull, 1e-4), 0.45, 1);
  const irradiance = direct + skyFull * (envI / ENV_INTENSITY) + hemiIrr + fillIrr;
  const key = irradiance * 0.18 / Math.PI;
  return { sunPos, outdoor, direct, skyFull, envI, irradiance, key,
    exposure: clamp((a.exposure ?? 1.05) * KEY / Math.max(key, 1e-4), 0.2, 3.0) };
}

/* ── composite shader ────────────────────────────────────────────────── */

const CompositeShader = {
  uniforms: {
    tDiffuse:    { value: null },
    tNoise:      { value: null },
    uTime:       { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGrain:      { value: 0.045 },
    uVignette:   { value: 0.22 },
    uAberration: { value: 0.30 },
    uSaturation: { value: 1.06 },
    uContrast:   { value: 1.04 },
    uLift:       { value: new THREE.Vector3(0.004, 0.006, 0.012) },
    uGain:       { value: new THREE.Vector3(1.02, 1.0, 0.98) },
    uSense:      { value: 0 },      // Force Sense 0..1
    uHurt:       { value: 0 },      // damage flash 0..1
    uHeat:       { value: [] },     // vec4 x,y,radius,strength (screen space)
    uHeatCount:  { value: 0 },
    uRadial:     { value: 0 },      // radial blur amount
    uSharpen:    { value: 0.12 },
    uFlash:      { value: 0 },
    uBlack:      { value: 0.018 },  // where black actually is
    uCurve:      { value: 0.32 },   // filmic S, applied in display space
    uShadowTint: { value: new THREE.Vector3(0.955, 0.985, 1.070) },
    uHighTint:   { value: new THREE.Vector3(1.035, 1.000, 0.955) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse, tNoise;
    uniform vec2 uResolution;
    uniform float uTime, uGrain, uVignette, uAberration, uSaturation, uContrast;
    uniform float uSense, uHurt, uRadial, uSharpen, uFlash;
    uniform float uBlack, uCurve;
    uniform vec3 uLift, uGain, uShadowTint, uHighTint;
    uniform vec4 uHeat[6];
    uniform int uHeatCount;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }

    // One place that knows how to read the frame, so the radial blur cannot be
    // silently dropped by a later channel-wise fetch.
    vec3 sampleScene(vec2 uv){
      if(uRadial <= 0.001) return texture2D(tDiffuse, uv).rgb;
      vec3 acc = vec3(0.0);
      for(int i=0;i<6;i++){
        float t = float(i)/5.0;
        acc += texture2D(tDiffuse, mix(uv, vec2(0.5), t * uRadial * 0.16)).rgb;
      }
      return acc / 6.0;
    }

    void main(){
      vec2 uv = vUv;
      vec2 centred = uv - 0.5;
      float r2 = dot(centred, centred);

      // — heat haze: refractive wobble around hot emitters
      vec2 warp = vec2(0.0);
      for(int i=0;i<6;i++){
        if(i >= uHeatCount) break;
        vec4 h = uHeat[i];
        vec2 d = uv - h.xy;
        d.x *= uResolution.x / uResolution.y;
        float dist = length(d);
        float fall = smoothstep(h.z, 0.0, dist);
        if(fall <= 0.0) continue;
        float n1 = texture2D(tNoise, uv*3.0 + vec2(uTime*0.31, uTime*0.47)).r - 0.5;
        float n2 = texture2D(tNoise, uv*4.7 - vec2(uTime*0.23, uTime*0.19)).g - 0.5;
        warp += vec2(n1, n2) * fall * h.w * 0.028;
      }
      uv += warp;

      // — radial blur (Force Sense / impacts)
      vec3 col = sampleScene(uv);

      // — chromatic aberration, stronger toward the corners
      // ~1px of R/B separation at the corners, not seven. The old falloff had
      // a constant term, so even dead centre was fringing.
      float ca = uAberration * (0.0002 + r2 * 0.0035) * (1.0 + uHurt*0.6);
      if(ca > 0.00001){
        // NB: sample through the same path col came from. Reading tDiffuse
        // directly here discarded the radial blur in R and B, so Force Sense
        // blurred the green channel only and the screen looked broken.
        col.r = sampleScene(uv + centred * ca).r;
        col.b = sampleScene(uv - centred * ca).b;
      }

      // — unsharp mask for micro contrast
      if(uSharpen > 0.001){
        vec2 tx = 1.0 / uResolution;
        vec3 blur = texture2D(tDiffuse, uv + vec2(tx.x,0.0)).rgb
                  + texture2D(tDiffuse, uv - vec2(tx.x,0.0)).rgb
                  + texture2D(tDiffuse, uv + vec2(0.0,tx.y)).rgb
                  + texture2D(tDiffuse, uv - vec2(0.0,tx.y)).rgb;
        col += (col - blur * 0.25) * uSharpen;
      }

      // — grade
      //
      // The scene arrives already through ACES, and ACES has a long shoulder.
      // A sunlit desert sits ON that shoulder: measured, sand at 0.90 linear
      // and the haze behind it at 1.20 — a third brighter — came out six 8-bit
      // values apart. Every bit of aerial perspective, every dune face turning
      // away from the sun, every bit of modelling in the highlights was being
      // compressed into nothing. Exposure now leaves the ground lower on the
      // curve and the contrast is put back HERE, where it can be shaped.

      // black point: something in the frame has to actually be black
      col = max(col - uBlack, 0.0) / (1.0 - uBlack);

      // filmic S about the midtones. smoothstep is a hermite S — steeper in
      // the middle, gentle at both ends — so it adds bite without clipping.
      col = mix(col, col * col * (3.0 - 2.0 * col), uCurve);
      col = (col - 0.5) * uContrast + 0.5;
      col = col * uGain + uLift;

      float luma = dot(col, vec3(0.2126,0.7152,0.0722));
      // Split tone. Daylight is two lights — a warm sun and a cold sky — and
      // separating them by colour as well as by value is most of why a
      // photographed frame reads as lit rather than shaded.
      col *= mix(uShadowTint, uHighTint, smoothstep(0.12, 0.72, luma));
      // Film desaturates as it approaches white; digital does not, which is
      // what makes bright CG look like paint.
      col = mix(vec3(luma), col, uSaturation * mix(1.0, 0.70, smoothstep(0.62, 1.0, luma)));

      // — Force Sense: cool, desaturated, silvered highlights
      if(uSense > 0.001){
        vec3 sense = mix(vec3(luma), col, 0.34);
        sense *= vec3(0.82, 0.94, 1.22);
        sense += pow(max(luma-0.55,0.0), 1.6) * vec3(0.35,0.5,0.75);
        col = mix(col, sense, uSense);
      }

      // — damage
      if(uHurt > 0.001){
        col = mix(col, col*vec3(1.5,0.28,0.3), uHurt*0.5);
      }
      col += uFlash;

      // — vignette
      vec2 vc = centred * vec2(uResolution.x / uResolution.y, 1.0);
      float vig = 1.0 - uVignette * smoothstep(0.16, 0.86, dot(vc, vc) * 1.6);
      col *= vig;

      // — grain, gently animated, scaled by darkness so highlights stay clean
      float g = hash(gl_FragCoord.xy + fract(uTime)*vec2(311.0,271.0)) - 0.5;
      col += g * uGrain * (1.0 - smoothstep(0.15, 0.95, luma));
      // The grain above is deliberately absent in the highlights, which is
      // exactly where an 8-bit framebuffer bands — the sky was stepping. A
      // triangular dither of one LSB underneath fixes it and is invisible.
      col += (hash(gl_FragCoord.xy + 17.0) - hash(gl_FragCoord.xy + 71.0)) * (1.0/255.0);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

/* ══════════════════════════════════════════════════════════════════════ */

export class Engine {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.quality = QUALITY[quality] ? quality : 'high';
    const q = QUALITY[this.quality];

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance',
      stencil: false, depth: true, alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    // NB: three's `fov` is VERTICAL. 78 vertical at 16:9 is 111 horizontal —
    // fisheye, which stretched everything at the edges and pushed more of the
    // frame into the region where vignette and aberration are strongest.
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.15, q.viewDist);
    this.scene.add(this.camera);

    this.resolutionScale = 1;
    // The shared aerial-perspective uniforms, reachable from the instance so
    // they can be inspected and driven from a console or a harness.
    this.aerial = AERIAL;
    this._setupLights();
    this._setupComposer();

    this.clock = new THREE.Clock();
    this.time = 0;
    this.heatSources = [];
    this._flash = 0;
    this._hurt = 0;
    this._sense = 0;
    this._radial = 0;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  _setupLights() {
    this.sun = new THREE.DirectionalLight(0xfff0d8, 3.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(QUALITY[this.quality].shadow, QUALITY[this.quality].shadow);
    // Ortho shadow depth is linear, so -0.0006 NDC over a 250-unit frustum was
    // ~7.5cm of world bias — feet detached from their own shadows.
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 260;
    // NB `radius` does NOTHING here, and the comment that used to say it did
    // was wrong. Read three's shadowmap_pars_fragment: the SHADOWMAP_TYPE_PCF
    // branch scales its nine taps by shadowRadius, but SHADOWMAP_TYPE_PCF_SOFT
    // — which is what this rig uses — builds a bilinear-weighted 3×3 at exactly
    // one texel and never mentions shadowRadius at all. It only reaches point
    // lights, and nothing in the game casts one. The penumbra is therefore set
    // by shadow map texel size alone: 5.7 cm at medium, which is about right
    // for a sun. Left at 1 so nobody tunes a number that is not connected.
    this.sun.shadow.radius = 1;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Was 0.85, which alone put a shadowed pixel at over half the brightness of
    // a lit one. Sun and sky IBL do the lighting now; this is only a floor.
    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x60482e, 0.30);
    this.scene.add(this.hemi);

    this.fill = new THREE.DirectionalLight(0x9fc4ff, 0.45);
    this.fill.position.set(-1, 0.6, -0.8);
    this.scene.add(this.fill);

    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this._linearSky();
    this.scene.add(this.sky);
    // Clouds and a distant skyline, composited over the Preetham gradient. One
    // draw call, and it is most of what stops the world reading as a diorama.
    this.skyDome = new SkyDome(this.scene);

    // The lower half of the environment probe. Baking the sky alone leaves the
    // ground hemisphere filled with whatever Preetham returns below the horizon
    // — a flat wash with none of the level's own colour in it — so every
    // upward-facing crevice and every underside is lit by the wrong thing. A
    // sunlit desert throws a great deal of warm light back up; this is it.
    this._bounce = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
      new THREE.MeshBasicMaterial({ color: 0x6b543a, side: THREE.BackSide, fog: false, toneMapped: false }));
    this._bounce.scale.setScalar(4000);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /**
   * three's Preetham sky ends with `pow(texColor, 1/2.4)` — a display transform
   * baked into a value this renderer then treats as linear radiance. Measured
   * on the dune atmosphere the real sky runs 0.23 at the zenith to 21.7 in the
   * glow beside the sun; that pow returns 0.52 … 3.60. A hundred to one becomes
   * seven to one, and after exposure and ACES the entire sky lands inside fifty
   * 8-bit values. That is not a stylistic choice, it is a unit error, and it is
   * why the sky was a flat card, why the sun never bloomed, and why the image
   * based light baked out of it carried no direction at all.
   *
   * Undo it. The disc has to be clamped on the way out: Preetham's solar term
   * reaches ~7e5, and the scene target is half-float, where anything past 65504
   * is Infinity and takes bloom to NaN with it.
   */
  _linearSky() {
    const m = this.sky.material;
    const grade = 'vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );';
    const disc = 'L0 += ( vSunE * 19000.0 * Fex ) * sundisk;';
    const size = 'float sundisk = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta );';
    if (m.fragmentShader.indexOf(grade) < 0 || m.fragmentShader.indexOf(disc) < 0
        || m.fragmentShader.indexOf(size) < 0) {
      console.warn('SABER: Sky shader changed shape — sky is still display-referred');
      this.skyLinear = false;
      return;
    }
    m.uniforms.uSkyScale = { value: 1 };
    // Knee and ceiling for the sky's own soft shoulder. Preetham's horizon
    // beside a 26° sun measures 21.7 and its solar term reaches 7e5; a
    // half-float target turns anything past 65504 into Infinity and takes
    // bloom to NaN with it, and long before that a quarter of the frame is a
    // single blown white shape with no drawing in it at all.
    m.uniforms.uSkyKnee = { value: 2.4 };
    m.uniforms.uSkyCeil = { value: 9.5 };
    // The disc, separated out so it is not compressed along with the aureole
    // it sits in — it is the one thing in the sky that SHOULD read as a hole
    // punched through the exposure.
    m.uniforms.uSkyDisc = { value: new THREE.Vector3(34, 32, 29) };
    m.uniforms.uSkyDiscCos = { value: new THREE.Vector2(0.99993, 0.99998) };
    // Only ever anything but 1 while the environment probe is being baked, see
    // refreshEnvironment.
    m.uniforms.uSkySat = { value: 1 };
    m.fragmentShader = ([
      'uniform float uSkyScale, uSkyKnee, uSkyCeil, uSkySat;',
      'uniform vec3 uSkyDisc;',
      'uniform vec2 uSkyDiscCos;',
      // Exponential shoulder: identity below the knee, asymptotic to the
      // ceiling above it. Keeps the horizon glow bright without letting it
      // become a flat white plate.
      'vec3 skyShoulder( vec3 c ) {',
      '  vec3 over = max( c - uSkyKnee, 0.0 );',
      '  float span = max( uSkyCeil - uSkyKnee, 0.001 );',
      '  return min( c, vec3( uSkyKnee ) ) + span * ( 1.0 - exp( - over / span ) );',
      '}',
      m.fragmentShader,
    ].join('\n'))
      .replace(size, 'float sundisk = smoothstep( uSkyDiscCos.x, uSkyDiscCos.y, cosTheta );')
      .replace(disc, '')
      .replace(grade, [
        'vec3 retColor = skyShoulder( texColor * uSkyScale ) + uSkyDisc * sundisk;',
        'retColor = mix( vec3( dot( retColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ), retColor, uSkySat );',
      ].join('\n'));
    m.needsUpdate = true;
    this.skyLinear = true;
  }

  /** Configure sky + sun + fog for a level mood. */
  applyAtmosphere(a) {
    const u = this.sky.material.uniforms;
    u.turbidity.value = a.turbidity ?? 6;
    u.rayleigh.value = a.rayleigh ?? 2.2;
    u.mieCoefficient.value = a.mie ?? 0.008;
    u.mieDirectionalG.value = a.mieG ?? 0.82;

    const phi = THREE.MathUtils.degToRad(90 - (a.elevation ?? 22));
    const theta = THREE.MathUtils.degToRad(a.azimuth ?? 140);
    const sunPos = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sunPos);
    this.sunDir = sunPos.clone();

    this.sun.position.copy(sunPos).multiplyScalar(90);
    this.sun.color.set(a.sunColor ?? 0xfff0d8);
    this.sun.intensity = a.sunIntensity ?? 3.6;
    this.hemi.color.set(a.skyColor ?? 0xbcd8ff);
    this.hemi.groundColor.set(a.groundColor ?? 0x60482e);
    // The probe is doing this job properly now, so the hand-rolled hemisphere
    // is trimmed to a floor rather than run alongside it at full strength.
    this.hemi.intensity = (a.ambient ?? 0.85) * (this.skyLinear && a.sky !== false ? HEMI_TRIM : 1);
    this.fill.color.set(a.fillColor ?? 0x9fc4ff);
    this.fill.intensity = a.fillIntensity ?? 0.25;
    // Sky bounce from the shadow side. Pinned to a fixed direction it was
    // nearly co-directional with the arena's sun (doing nothing) and opposed to
    // the canyon's (fighting it).
    this.fill.position.copy(sunPos).multiplyScalar(-1).setY(0.5).normalize().multiplyScalar(60);
    this.sky.visible = a.sky !== false;

    const sunI = a.sunIntensity ?? 3.6;
    const outdoor = a.sky !== false;
    // Everything about level, ambient budget and exposure comes off the meter.
    const meter = atmosphereMeter(a);
    this.meter = meter;

    // What the sky is doing at the skyline, away from the sun and toward it,
    // and what it is throwing down on everything the sun cannot reach.
    // Everything about distance and everything about shade derives from these.
    const side = _v1.copy(sunPos).setY(0).normalize().cross(_v2.set(0, 1, 0)).setY(0.02).normalize();
    const flat = _v2.copy(sunPos).setY(0.03).normalize();
    const hazeSide = skyShoulder(skyRadiance(side, sunPos, a, _c2));
    const hazeSun = skyShoulder(skyRadiance(flat, sunPos, a, _c3));
    const ambient = skyRadiance(_v1.set(-sunPos.x, 1.6, -sunPos.z).normalize(), sunPos, a, _c4);
    ambient.multiplyScalar(1 / Math.max(0.02, lum(ambient))).lerp(WHITE, 0.35);

    this.skyDome.configure(a);
    this.skyDome.setSun(sunPos);
    // Clouds are lit by the same sun as everything else and hang in the same
    // sky, so they are scaled into the same radiance units the linear Preetham
    // dome now works in. Left at 1.0 against a display-referred sky they read
    // as bright paper stuck to a flat card, which is precisely what they were.
    this.skyDome.setRadiance(this.skyLinear ? 0.95 : 1,
      clamp(sunI / 6.5, 0.35, 1.5), ambient);

    if (a.fog !== false) {
      // Haze is LIT, and it is lit by the sky it is part of. Authored fog
      // colours are albedo-ish sRGB swatches; used raw they dissolve distance
      // into something DARKER than the horizon it meets, which is a hard
      // silhouette where there should be a merge, and — when the swatch is the
      // same tan as the sand, which it was — 50% fog at 200m that changes
      // nothing at all. Keep the authored hue, take the level from the sky.
      const fog = new THREE.FogExp2(a.fogColor ?? 0xc9b391, a.fogDensity ?? 0.0035);
      if (outdoor) {
        // Half the HUE comes from the sky too. In a bright desert the haze is
        // barely brighter than the sand — 1.2 against 0.9 — so what actually
        // reads as distance is losing SATURATION into the sky, and a fog swatch
        // authored the same tan as the sand it hides takes no saturation from
        // anything. Keep enough of the author's dust to keep the mood.
        const n = _c1.copy(hazeSide).multiplyScalar(1 / Math.max(0.02, lum(hazeSide)));
        fog.color.lerp(n, 0.55);
        const want = clamp(lum(hazeSide), 0.25, 3.2);
        fog.color.multiplyScalar(clamp(want / Math.max(0.02, lum(fog.color)), 0.9, 4.5));
      }
      this.scene.fog = fog;
      this.skyDome.setHaze(fog.color, _c1.set(a.horizonColor ?? 0x6d6152)
        .multiplyScalar(clamp(sunI * Math.max(0.12, sunPos.y) / Math.PI, 0.05, 8)));
    } else { this.scene.fog = null; }
    this.scene.background = a.sky === false ? new THREE.Color(a.bgColor ?? 0x0b0e14) : null;

    // Aerial perspective. Interiors get neither term — a hangar has no sun to
    // scatter and no gravity well of haze to stratify, and faking either there
    // reads immediately as a bug.
    AERIAL.shape.x = outdoor ? 1 / (a.fogHeight ?? 38) : 0;
    AERIAL.shape.y = a.fogBase ?? 0;
    AERIAL.shape.w = 1;
    AERIAL.sun.x = sunPos.x; AERIAL.sun.y = sunPos.y; AERIAL.sun.z = sunPos.z;
    // How much brighter the skyline gets as it swings toward the sun, spread
    // over the phase lobe. Straight out of the model rather than a taste knob.
    const gain = clamp(lum(hazeSun) - lum(hazeSide), 0, 12);
    AERIAL.sun.w = outdoor ? (a.inscatter ?? gain * 0.028) : 0;
    const sl = Math.max(0.02, lum(hazeSun));
    AERIAL.tint.x = hazeSun.r / sl; AERIAL.tint.y = hazeSun.g / sl; AERIAL.tint.z = hazeSun.b / sl;
    AERIAL.tint.w = 0.50;

    this._envI = this.skyLinear ? meter.envI : 0.30;
    this.renderer.toneMappingExposure = this.skyLinear
      ? meter.exposure : (a.exposure ?? 1.05);
    this.composite.uniforms.uLift.value.set(...(a.lift ?? [0.004, 0.006, 0.012]));
    this.composite.uniforms.uGain.value.set(...(a.gain ?? [1.02, 1.0, 0.98]));
    this.composite.uniforms.uSaturation.value = a.saturation ?? 1.06;
    this.bloom.strength = a.bloom ?? 0.5;

    // What the ground throws back up, for the probe: albedo × the irradiance
    // actually landing on it. A 26° sun over pale sand is a genuine second
    // light source and it is the only thing that puts colour under a chin.
    this._bounce.material.color.set(a.groundColor ?? 0x60482e)
      .multiplyScalar(clamp(sunI * Math.max(0.12, sunPos.y) / Math.PI, 0.02, 6));
    this.refreshEnvironment();
  }

  /** Bake the current sky into an IBL probe. */
  refreshEnvironment() {
    if (this._envRT) this._envRT.dispose();
    const tmp = new THREE.Scene();
    const skyClone = this.sky.clone();
    if (this.scene.background instanceof THREE.Color) tmp.background = this.scene.background;
    if (this.sky.visible) { tmp.add(skyClone); tmp.add(this._bounce); }
    else tmp.background = new THREE.Color(0x11151d);
    // The probe is the ONLY indirect light in the game, so it has to stand in
    // for everything bouncing around out there, not just the sky. Real bounce
    // has been through two or three surfaces and is much less saturated than
    // Preetham's blue; baked at full chroma every shadowed face turns cyan.
    const sat = this.sky.material.uniforms.uSkySat;
    if (sat) sat.value = 0.6;
    this._envRT = this.pmrem.fromScene(tmp, 0.04);
    if (sat) sat.value = 1;
    this.scene.environment = this._envRT.texture;
    // With the sky linearised the probe is in the same units as the sun, so
    // this is 1.0 — the physical answer — instead of a fudge factor cancelling
    // a gamma curve. The hemisphere light below is trimmed to match: the probe
    // now does the job it was faking, and running both at full strength put a
    // shadowed pixel at over half the brightness of a lit one, which is why
    // nothing had shape and there was nothing dark for a blade to glow against.
    this.scene.environmentIntensity = this._envI ?? (this.skyLinear ? ENV_INTENSITY : 0.30);
  }

  _setupComposer() {
    const q = QUALITY[this.quality];
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const rt = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), {
      type: THREE.HalfFloatType,
      samples: q.msaa,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: true,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Threshold is in LINEAR HDR, and the Preetham sky sits at 0.7-1.5 there — at
    // 0.92 the sky bloomed harder than the lightsaber did, which is the milky
    // smear across the top of every outdoor frame. Above 1.8 only the blade,
    // bolts and molten cuts qualify.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 1.8);
    this.composer.addPass(this.bloom);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.composite = new ShaderPass(CompositeShader);
    this.composite.material.uniforms.tNoise.value = noiseTexture(256);
    this.composite.material.uniforms.uHeat.value = Array.from({ length: 6 }, () => new THREE.Vector4());
    this.composite.renderToScreen = true;
    this.composer.addPass(this.composite);
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.quality) return;
    this.quality = name;
    const q = QUALITY[name];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio) * this.resolutionScale);
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.camera.far = q.viewDist;
    this.camera.updateProjectionMatrix();
    this.resize();
  }

  setResolutionScale(s) {
    this.resolutionScale = clamp(s, 0.4, 2);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[this.quality].pixelRatio) * this.resolutionScale);
    this.resize();
  }

  setBloom(on) { this.bloom.enabled = !!on; }

  /** 0..1 — how hard time is being bent. Drives the Focus grade. */
  setFocus(v) { this._focusTarget = v; }
  setGrain(on) { this.composite.uniforms.uGrain.value = on ? 0.045 : 0; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    // Must precede setSize: EffectComposer multiplies by its own stored ratio,
    // and a stale one leaves its targets smaller than the drawing buffer, so
    // the final full-screen quad upscales and the whole frame goes soft.
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    this.composite.uniforms.uResolution.value.set(size.x, size.y);
    this.bloom.resolution.set(size.x, size.y);
  }

  /** Keep the shadow frustum tight around the action. */
  fitShadows(center) {
    const d = QUALITY[this.quality].shadowDist;
    const cam = this.sun.shadow.camera;
    cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
    cam.near = 1; cam.far = d * 4.2;
    // snap to texel grid so shadows don't shimmer while walking
    const texel = (d * 2) / QUALITY[this.quality].shadow;
    const sx = Math.round(center.x / texel) * texel;
    const sz = Math.round(center.z / texel) * texel;
    this.sun.target.position.set(sx, center.y, sz);
    this.sun.position.copy(this.sunDir || new THREE.Vector3(0.5, 0.8, 0.3))
      .multiplyScalar(d * 2.2).add(this.sun.target.position);
    this.sun.target.updateMatrixWorld();
    cam.updateProjectionMatrix();
  }

  addHeat(screenX, screenY, radius, strength) {
    if (this.heatSources.length < 6) this.heatSources.push([screenX, screenY, radius, strength]);
  }

  flash(v) { this._flash = Math.max(this._flash, v); }
  hurt(v) { this._hurt = Math.max(this._hurt, v); }
  setSense(v) { this._senseTarget = v; }
  setRadial(v) { this._radialTarget = v; }

  render(dt) {
    const u = this.composite.uniforms;
    this.time += dt;
    u.uTime.value = this.time;
    this.skyDome?.update(dt, this.camera);

    this._flash = damp(this._flash, 0, 9, dt);
    this._hurt = damp(this._hurt, 0, 4.2, dt);
    this._sense = damp(this._sense, this._senseTarget || 0, 7, dt);
    this._radial = damp(this._radial, this._radialTarget || 0, 8, dt);
    u.uFlash.value = this._flash;
    u.uHurt.value = this._hurt;
    u.uSense.value = this._sense;
    // Focus reuses the Sense grade's cool desaturation at a fraction of its
    // strength, so the two read as the same family of ability.
    this._focus = damp(this._focus || 0, this._focusTarget || 0, 12, dt);
    if (this._focus > 0.002) u.uSense.value = Math.max(u.uSense.value, this._focus * 0.55);
    u.uRadial.value = this._radial;

    const heat = u.uHeat.value;
    for (let i = 0; i < 6; i++) {
      const h = this.heatSources[i];
      if (h) heat[i].set(h[0], h[1], h[2], h[3]); else heat[i].set(0, 0, 0, 0);
    }
    u.uHeatCount.value = Math.min(6, this.heatSources.length);
    this.heatSources.length = 0;

    this.renderer.info.reset();
    this.composer.render(dt);
  }

  dispose() {
    this.skyDome?.dispose();
    this._bounce?.geometry.dispose();
    this._bounce?.material.dispose();
    window.removeEventListener('resize', this._onResize);
    this.composer?.dispose?.();
    this.pmrem?.dispose();
    this._envRT?.dispose();
    this.renderer.dispose();
  }
}
