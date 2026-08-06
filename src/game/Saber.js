/**
 * SABER — the weapon.
 *
 * A hilt pose in, a swept blade volume out. Everything downstream — deflection,
 * cutting, the arm IK, the hum — reads from the sweep this produces, so the
 * blade is the single source of truth about where the weapon has been this
 * frame and how fast each point along it was moving when it got there.
 */

import * as THREE from 'three';
import { clamp, lerp } from '../engine/MathUtil.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

export const SABER_COLORS = [
  { name: 'Cerulean',  hex: 0x3ba7ff, glow: 0x8fd8ff, key: 'blue' },
  { name: 'Verdant',   hex: 0x37f07a, glow: 0xa6ffc8, key: 'green' },
  { name: 'Amethyst',  hex: 0xa459ff, glow: 0xd7b0ff, key: 'purple' },
  { name: 'Sunfire',   hex: 0xffb02e, glow: 0xffe0a0, key: 'amber' },
  { name: 'Crimson',   hex: 0xff2d2d, glow: 0xff9a90, key: 'red' },
  { name: 'Ivory',     hex: 0xf2f6ff, glow: 0xffffff, key: 'white' },
  { name: 'Bronze',    hex: 0xff7a1a, glow: 0xffc888, key: 'orange' },
  { name: 'Cyanite',   hex: 0x21f0e0, glow: 0xa8fff8, key: 'cyan' },
  { name: 'Rose',      hex: 0xff5fae, glow: 0xffc0e0, key: 'rose' },
  { name: 'Void',      hex: 0x241a3a, glow: 0x7a4fd0, key: 'black' },
];

export const HILT_STYLES = ['Graflex', 'Guardian', 'Sentinel', 'Consular', 'Crossguard'];

/* ── shaders ─────────────────────────────────────────────────────────── */

/**
 * THE BLADE.
 *
 * One camera-facing quad spanning the blade axis, and an emission profile
 * evaluated analytically against the distance to that axis. Everything that
 * makes plasma read as plasma is in that profile:
 *
 *   • it is ONE colour at THREE amplitudes, spanning nearly two orders of
 *     magnitude. The centre is the crystal's own hue pushed so far past white
 *     that every channel saturates — which is exactly why an over-exposed
 *     emitter photographs as a white core with a coloured halo, and it is the
 *     only way to get a coloured bloom out of a tonemapped renderer. A blade
 *     built the other way round — a white core mesh with a tinted shell over
 *     it — can only ever be a white stick, because the white is authored, not
 *     earned, and the tint sits UNDER it.
 *   • the falloff is Gaussian, so there is no silhouette anywhere. The old
 *     build was four nested cylinders: a hard-edged solid core capsule and
 *     three shells whose alpha came from the facing angle of a 14-sided tube,
 *     so the blade had a polygonal edge, banded where the shells crossed, and
 *     lost its coloured shell entirely at any distance.
 *   • the field is a CAPSULE, not a tube, so the tip is a proper rounded cap
 *     for free and from every angle, including end-on where the blade should
 *     collapse to a bright disc rather than disappear.
 *   • it is one draw call and two triangles.
 */
const BLADE_VERT = /* glsl */`
  #include <common>
  #include <fog_pars_vertex>
  uniform float uLen;        // blade length, metres, from the emitter
  uniform float uRadius;     // how far out the quad has to reach
  attribute vec2 aQuad;      // x across in [-1,1], y along in [0,1]
  varying vec2 vP;           // (across, along) in view-space metres
  varying float vLen;
  void main(){
    vec3 B = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 T = (modelViewMatrix * vec4(0.0, uLen, 0.0, 1.0)).xyz;
    vec3 ax = T - B;
    float L = length(ax);
    vec3 A = L > 1e-5 ? ax / L : vec3(0.0, 1.0, 0.0);
    // Any scale on the way down the hierarchy has to reach the radius too, or
    // a scaled saber gets a full-sized halo around a small blade.
    float sc = L / max(uLen, 1e-4);
    float R = uRadius * sc;
    // Billboard about the blade's own axis: the quad turns to face the camera
    // but never leaves the axis, so the blade is where it says it is.
    vec3 V = normalize(-(B + T) * 0.5);
    vec3 S = cross(A, V);
    float sl = length(S);
    // End-on the cross product vanishes; any perpendicular will do, because the
    // capsule field below collapses to a disc there anyway.
    S = sl > 1e-4 ? S / sl : normalize(cross(A, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
    // The quad reaches a full radius past the TIP, because the tip is a round
    // cap, but barely past the emitter, because the emitter is a hole in a
    // piece of machined steel. Symmetrical bounds put a 30 cm ball of light
    // around the hilt.
    float along = mix(-0.055 * sc, L + R, aQuad.y);
    vec3 p = B + A * along + S * (aQuad.x * R);
    vP = vec2(aQuad.x * R, along);
    vLen = L;
    vec4 mvPosition = vec4(p, 1.0);
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;
const BLADE_FRAG = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uHue;         // the crystal, normalised so its peak channel is 1
  uniform vec3 uWidth;       // gaussian sigma: core, glow, halo
  uniform vec3 uAmp;         // amplitude:      core, glow, halo
  uniform float uRadius;
  uniform float uFlicker;
  uniform float uTime;
  uniform float uSurge;      // ignition front
  varying vec2 vP;
  varying float vLen;
  void main(){
    float a = vP.y;
    // Distance to the segment [0, vLen] — a capsule field, so the tip is round
    // for free from every angle. The emitter end is compressed rather than
    // capped: plasma comes OUT of the shroud, it does not pool around it.
    float dy = a < 0.0 ? a * 3.2 : (a > vLen ? a - vLen : 0.0);
    float d = length(vec2(vP.x, dy));
    float t = clamp(a / max(vLen, 1e-4), 0.0, 1.0);

    // The plasma leaves the emitter wide and hot and closes toward the tip,
    // which brightens as it narrows.
    float w = 1.0 + 0.30 * exp(-a * 26.0) - 0.09 * smoothstep(0.5, 1.0, t);
    // Standing instability: three incommensurate waves crawling along the
    // blade. Small — 6% — but it is the difference between a lamp and a
    // contained arc, and it is the only thing on the blade that moves.
    float n = sin(a * 57.0 - uTime * 8.0)
            + sin(a * 23.0 + uTime * 5.3) * 0.7
            + sin(a * 127.0 + uTime * 17.0) * 0.3;
    float amp = uFlicker * (1.0 + n * 0.030) * (1.0 + 0.22 * smoothstep(0.86, 1.0, t));
    // the ignition front burns hotter than the blade behind it
    amp *= 1.0 + uSurge * exp(-(1.0 - t) * 7.0);

    /* A 2 cm blade at 20 m is a fifth of a pixel wide, and a gaussian narrower
     * than the sample grid is a line of aliased dots that mostly misses. So no
     * lobe is allowed to be thinner than about a pixel, and whatever is
     * widened has its amplitude cut by the same factor — the LINE INTEGRAL of
     * a gaussian is amp·sigma, so holding that product constant keeps the
     * blade's total light identical while it stops being sub-pixel. This is
     * the difference between a blade that carries across a battlefield and one
     * that shimmers out at ten metres. */
    float px = max(fwidth(vP.x), 1e-7);
    vec3 wid = uWidth * w;
    vec3 we = max(wid, vec3(px * 0.62));
    vec3 keep = wid / we;
    vec3 dd = vec3(d) / we;
    float core = exp(-dd.x * dd.x) * keep.x;
    float glow = exp(-dd.y * dd.y) * keep.y;
    // a longer tail than a gaussian on the outermost lobe — this is the wash
    // that lands on walls and faces, and it has to reach
    float halo = exp(-pow(dd.z, 1.4)) * keep.z;
    float e = (uAmp.x * core + uAmp.y * glow + uAmp.z * halo) * amp;
    // guarantee it is exactly zero at the quad's edge
    e *= smoothstep(uRadius, uRadius * 0.55, d);
    if(e < 0.002) discard;

    vec3 c = uHue * e;
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      // Haze takes light AWAY from an emitter. Mixing toward the fog colour —
      // what the stock chunk does — makes a distant blade brighter than a near
      // one, which is how you get a glowing stick on the horizon.
      c *= 1.0 - fogFactor;
    #endif
    // Additive blending ignores alpha, but the canvas does not: the menu
    // preview composites over the page, and emitting alpha 1 across the whole
    // quad painted a 60 cm opaque black rectangle behind the blade.
    gl_FragColor = vec4(c, clamp(max(max(c.r, c.g), c.b), 0.0, 1.0));
  }
`;

/**
 * THE TRAIL.
 *
 * The swept volume of the blade over the last fraction of a second, as three
 * parallel sheets offset along the sweep's own normal. The thickness is what
 * stops a chop swung nearly in the view plane — where the swept surface turns
 * edge-on — from collapsing to nothing, which a zero-thickness ribbon does.
 */
const TRAIL_VERT = /* glsl */`
  #include <common>
  #include <fog_pars_vertex>
  attribute float aAge;      // 0 = this frame, 1 = gone
  attribute float aSide;     // 0 at the emitter, ~1.05 past the tip
  attribute float aThick;    // -1, 0, +1 across the swept sheet
  attribute float aPunch;    // how fast the blade was moving when it was here
  varying float vAge; varying float vSide; varying float vThick; varying float vPunch;
  void main(){
    vAge = aAge; vSide = aSide; vThick = aThick; vPunch = aPunch;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;
const TRAIL_FRAG = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uHue; uniform float uGlow; uniform float uHot;
  varying float vAge; varying float vSide; varying float vThick; varying float vPunch;
  void main(){
    float fade = pow(clamp(1.0 - vAge, 0.0, 1.0), 1.5);
    // feathered at the emitter, carried a little past the tip
    float prof = smoothstep(0.0, 0.13, vSide) * (1.0 - smoothstep(0.99, 1.06, vSide));
    float th = exp(-vThick * vThick * 1.3);
    // The freshest slice is still at blade temperature and whites out; behind
    // it the smear cools to the crystal's own colour before it dies.
    float hot = pow(clamp(1.0 - vAge * 2.6, 0.0, 1.0), 2.0);
    float e = prof * th * vPunch * (uGlow * fade + uHot * hot);
    if(e < 0.002) discard;
    vec3 c = uHue * e;
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      c *= 1.0 - fogFactor;
    #endif
    gl_FragColor = vec4(c, clamp(max(max(c.r, c.g), c.b), 0.0, 1.0));
  }
`;

/* ══════════════════════════════════════════════════════════════════════ */

export class Saber {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.colorIndex = opts.colorIndex ?? 0;
    const c = SABER_COLORS[this.colorIndex] || SABER_COLORS[0];
    this.color = new THREE.Color(c.hex);
    this.glowColor = new THREE.Color(c.glow);
    this.hue = new THREE.Color(1, 1, 1);
    this.punch = 1;
    this.bladeLength = opts.bladeLength ?? 1.15;
    this.coreWidth = opts.coreWidth ?? 1;
    this.hiltStyle = opts.hiltStyle ?? 'Graflex';
    this.isDark = c.key === 'red' || c.key === 'black';

    this.root = new THREE.Group();
    this.root.matrixAutoUpdate = true;
    scene.add(this.root);

    this.lit = false;
    this.ignition = 0;            // 0..1 extension
    this.surge = 0;               // how fast that extension is changing
    this.throwState = 'held';     // held | flying | returning
    this.contactStrain = 0;

    // sweep state
    this.base = new THREE.Vector3();
    this.tip = new THREE.Vector3();
    this.prevBase = new THREE.Vector3();
    this.prevTip = new THREE.Vector3();
    this.axis = new THREE.Vector3(0, 1, 0);
    this.tipVelocity = new THREE.Vector3();
    this.baseVelocity = new THREE.Vector3();
    this.tipSpeed = 0;
    this.swingSpeed = 0;
    this.sweepNormal = new THREE.Vector3(1, 0, 0);
    this.sweepArea = 0;
    this.valid = false;

    this._buildHilt();
    this._buildBlade();
    this._buildTrail();

    // A metre of plasma is a LINE light, and the decay exponent is where that
    // gets said. An infinite line falls off as 1/r near it and only reaches
    // 1/r² far away, so `decay = 1` with the cutoff window doing the far end is
    // a better model of a blade than `decay = 2` is — and the difference is not
    // cosmetic. Measured on a blade held 24 cm off the sand, the old inverse
    // square put 35 units of irradiance on the ground directly under the tip
    // (the sun is 7) and clipped it to (1.00, 0.98, 0.91): the hue was
    // destroyed by the very brightness that was supposed to carry it, while
    // the wielder's chest a metre and a half away moved by 0.016. 1/r closes
    // that ratio by a factor of r: six times less light at the tip, the same at
    // the chest, twice as much three metres out.
    //
    // Two lights, not more, on purpose: every enemy in a wave carries one of
    // these, and NUM_POINT_LIGHTS is a per-fragment unrolled loop in every lit
    // material in the game.
    this.light = new THREE.PointLight(0xffffff, 0, 7, 1);
    this.light.castShadow = false;
    scene.add(this.light);
    this.tipLight = new THREE.PointLight(0xffffff, 0, 4.5, 1);
    this.tipLight.castShadow = false;
    scene.add(this.tipLight);

    this._applyColour();
  }

  setColor(index) {
    this.colorIndex = index;
    const c = SABER_COLORS[index] || SABER_COLORS[0];
    this.color.setHex(c.hex);
    this.glowColor.setHex(c.glow);
    this.isDark = c.key === 'red' || c.key === 'black';
    this._applyColour();
  }

  /**
   * The blade emits ONE colour. Everything else about how it reads — white
   * core, coloured halo, coloured bloom — comes from the amplitude profile
   * running that colour from ~28 down to ~0.01 across four centimetres.
   *
   * So the hue is normalised to a peak channel of 1: a crystal is a hue, not a
   * brightness. `punch` then puts the brightness back, but only partly, so a
   * deliberately dim crystal (Void) stays moody instead of being renormalised
   * into a lamp.
   */
  _applyColour() {
    const c = this.color;
    const peak = Math.max(c.r, c.g, c.b, 1e-4);
    this.hue.copy(c).multiplyScalar(1 / peak);
    this.punch = 0.62 + 0.38 * Math.pow(peak, 0.6);
    // The light the blade throws is the crystal's hue, and very nearly ALL of
    // it. The old 22% lift toward white was reasoning about bounce — but bounce
    // through a surface is what multiplying by that surface's albedo already
    // does, so the lift was double-counting it, and on sand it was fatal:
    // sand's blue albedo is 0.109 against 0.51 in red, so a light of
    // (0.25, 0.52, 1.00) lands on it as (0.128, 0.146, 0.109) — RED-dominant.
    // The blade lit the ground with its own colour and the ground handed back
    // white. At the crystal's own (0.044, 0.386, 1.00) the same sand returns
    // (0.022, 0.108, 0.109): blue outruns red five to one and the hue survives
    // the trip. The 6% that is left is the plasma's own continuum, not a fudge.
    _c.copy(this.hue).lerp(WHITE, 0.06);
    this.light.color.copy(_c);
    this.tipLight.color.copy(_c);
    if (this.bladeMat) this.bladeMat.uniforms.uHue.value.copy(this.hue);
    if (this.trailMat) this.trailMat.uniforms.uHue.value.copy(this.hue);
    this.hiltAccent.emissive.copy(this.color);
  }

  /* ── construction ──────────────────────────────────────────────────── */

  _buildHilt() {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x8d939c, metalness: 1, roughness: 0.34 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f26, metalness: 0.75, roughness: 0.55 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0c0e12, metalness: 0.3, roughness: 0.82 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xb98b3e, metalness: 1, roughness: 0.28 });
    const accent = new THREE.MeshStandardMaterial({
      color: 0x2a2f38, metalness: 0.9, roughness: 0.3,
      emissive: this.color, emissiveIntensity: 0.9,
    });
    this.hiltAccent = accent;

    const R = 0.019;
    const add = (mesh, y) => { mesh.position.y = y; mesh.castShadow = true; g.add(mesh); return mesh; };

    // emitter shroud
    add(new THREE.Mesh(new THREE.CylinderGeometry(R * 1.24, R * 1.05, 0.035, 16, 1), steel), 0.132);
    add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.72, R * 0.72, 0.012, 14), black), 0.152);
    // neck rings
    for (let i = 0; i < 3; i++) add(new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.0035, 6, 18), gold), 0.104 - i * 0.014)
      .rotation.x = Math.PI / 2;
    // body
    add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.115, 18, 1), steel), 0.045);
    // grip section
    const grip = add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.97, R * 0.97, 0.062, 18, 1), black), -0.022);
    grip.scale.set(1, 1, 1);
    for (let i = 0; i < 7; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.99, 0.0026, 5, 16), dark);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.048 + i * 0.0092;
      g.add(ring);
    }
    // control box
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.012), dark);
    box.position.set(R * 0.92, 0.05, 0); box.castShadow = true; g.add(box);
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.006, 10), accent);
    stud.rotation.z = Math.PI / 2; stud.position.set(R * 1.35, 0.058, 0); g.add(stud);
    const stud2 = stud.clone(); stud2.position.y = 0.042; g.add(stud2);
    // pommel
    add(new THREE.Mesh(new THREE.CylinderGeometry(R * 1.12, R * 0.86, 0.026, 16, 1), steel), -0.066);
    add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.6, 12, 8), dark), -0.082);

    if (this.hiltStyle === 'Crossguard') {
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.62, R * 0.5, 0.055, 12), steel);
        arm.rotation.z = Math.PI / 2 * s;
        arm.position.set(0.032 * s, 0.128, 0);
        arm.castShadow = true; g.add(arm);
      }
    }
    if (this.hiltStyle === 'Consular') {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.08, R * 1.08, 0.052, 16), gold);
      sleeve.position.y = 0.012; g.add(sleeve);
    }
    if (this.hiltStyle === 'Sentinel') {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(R * 1.3, 0.03, 8, 1, true), dark);
      claw.position.y = 0.15; g.add(claw);
    }

    g.scale.setScalar(1.0);
    this.hilt = g;
    this.root.add(g);
    this.emitterY = 0.155;
  }

  /**
   * The emission profile, in metres of gaussian sigma and in linear radiance.
   *
   * These numbers are not taste. They were solved against the arena's actual
   * back end — exposure 0.68, ACES in its MATRIX form, the composite grade
   * (gain 1.04/1.00/0.95, saturation 1.06) — over the sand radiance measured
   * out of a real capture with the blade hidden, (0.73, 0.40, 0.156).
   *
   * The matrix is the whole reason a blade goes white, and it is not obvious:
   * ACES mixes 0.355·G + 0.048·B into the RED input channel before the curve.
   * A cerulean crystal has hue.r = 0.044, so per-channel arithmetic says its
   * core can never blow out red — and yet it does, because the green and blue
   * leak sideways. Solving that properly is what lets the core width be chosen
   * rather than discovered.
   *
   * What the old numbers (5.6/23/88 mm at 30/2.75/0.50) actually produced, at
   * a blade 227 px long — measured, not assumed:
   *
   *   fully clipped core   ±0.6 px   ~3 mm    — a hairline, i.e. "a white line"
   *   near-white core      ±1.2 px
   *   blue-dominant out to  5 px    ~25 mm
   *   over the bloom line   9 mm             — almost nothing for bloom to find
   *
   * and with these:
   *
   *   fully clipped core   ±2.3 px  ~12 mm    a 23 mm blown core: a real blade
   *   near-white core      ±3.4 px  ~17 mm
   *   blue-dominant out to 12 px    ~61 mm    five core widths of colour
   *   over the bloom line  25 mm              a coloured halo bloom can chew on
   *
   * The halo lobe is deliberately NOT allowed to clip: it tops out around 1.5,
   * which lands mid-curve where ACES still keeps chroma. The core is 39× that,
   * which is what buys the white.
   *
   * One thing this cannot fix, and it is worth writing down so nobody chases
   * it: over sunlit sand, screen B−R for an additive blue emitter maxes out at
   * 0.084 whatever the amplitude, because red is already at 0.73 radiance
   * before the blade adds anything. On the wielder's dark robe the same profile
   * reaches B−R = 0.53. Saturated halos live against dark, never against sun.
   */
  static PROFILE = {
    width: [0.0110, 0.0330, 0.105],
    amp:   [58.0,   6.50,   1.50],
    radius: 0.36,
  };

  /** The smear's amplitudes, tied to the blade's own lobes. See _buildTrail. */
  static TRAIL_HOT = Saber.PROFILE.amp[1] * 0.85;
  static TRAIL_GLOW = Saber.PROFILE.amp[2] * 1.5;

  _buildBlade() {
    this.bladeGroup = new THREE.Group();
    this.bladeGroup.position.y = this.emitterY;
    this.root.add(this.bladeGroup);

    const w = this.coreWidth;
    const P = Saber.PROFILE;

    // Two triangles. aQuad.x runs across the blade, aQuad.y along it.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('aQuad', new THREE.BufferAttribute(new Float32Array([
      -1, 0, 1, 0, 1, 1, -1, 1,
    ]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);

    this.bladeMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uHue: { value: new THREE.Color(1, 1, 1) },
        uWidth: { value: new THREE.Vector3(P.width[0] * w, P.width[1] * w, P.width[2] * w) },
        uAmp: { value: new THREE.Vector3(...P.amp) },
        uRadius: { value: P.radius * w },
        uLen: { value: 0.001 },
        uFlicker: { value: 1 },
        uTime: { value: 0 },
        uSurge: { value: 0 },
      }]),
      vertexShader: BLADE_VERT, fragmentShader: BLADE_FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending,
      // The shader emits vec4(c, 1.0) with the colour already carrying all of
      // its own weight, so the blend must be ONE/ONE. Without this flag three
      // uses SRC_ALPHA/ONE, which happens to be the same here — but only
      // because alpha is 1, and saying so keeps it that way.
      premultipliedAlpha: true,
      fog: true,
      side: THREE.DoubleSide, toneMapped: true,
    });
    this.blade = new THREE.Mesh(geo, this.bladeMat);
    this.blade.frustumCulled = false;
    this.blade.renderOrder = 12;
    this.bladeGroup.add(this.blade);
    this.bladeGroup.visible = false;
  }

  /**
   * The trail is SHEETS × SAMPLES quads. Three sheets, offset along the normal
   * of the surface the blade swept, so the smear has thickness: a vertical
   * chop puts the swept plane edge-on to the camera, and a zero-thickness
   * ribbon disappears completely in exactly the strike you most want to see.
   */
  _buildTrail() {
    this.trailSegments = 30;
    this.trailSheets = 3;
    // Half the thickness of the swept slab. It is the blade's own glow radius,
    // read off PROFILE rather than typed again, because a smear thinner than
    // the thing that made it reads as a decal stuck behind the blade.
    this.trailThickness = Saber.PROFILE.width[1] * 1.6 * this.coreWidth;
    const n = this.trailSegments, S = this.trailSheets;
    const verts = n * S * 2;
    const geo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(verts * 3);
    this.trailAge = new Float32Array(verts);
    this.trailPunch = new Float32Array(verts);
    const side = new Float32Array(verts);
    const thick = new Float32Array(verts);
    for (let i = 0; i < n; i++) {
      for (let s = 0; s < S; s++) {
        const v = (i * S + s) * 2;
        side[v] = 0; side[v + 1] = 1.05;      // carried a little past the tip
        thick[v] = thick[v + 1] = s - 1;      // -1, 0, +1
      }
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < S; s++) {
        const a = (i * S + s) * 2, b = a + 1;
        const c = ((i + 1) * S + s) * 2, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAge', new THREE.BufferAttribute(this.trailAge, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aPunch', new THREE.BufferAttribute(this.trailPunch, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aThick', new THREE.BufferAttribute(thick, 1));

    // The smear's two amplitudes are derived from the blade's own lobes so the
    // two cannot drift apart: the freshest slice runs at the GLOW lobe's
    // temperature (which puts it over the bloom line — luminance 2.3 for a
    // cerulean crystal against a threshold of 1.8, so a fast cut leaves a
    // glowing arc and not a coloured film), and the body of the smear settles
    // above the HALO lobe, where ACES still keeps its chroma.
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uHue: { value: new THREE.Color(1, 1, 1) },
        uGlow: { value: Saber.TRAIL_GLOW },
        uHot: { value: Saber.TRAIL_HOT },
      }]),
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      premultipliedAlpha: true,
      fog: true,
      side: THREE.DoubleSide, toneMapped: true,
    });
    this.trail = new THREE.Mesh(geo, this.trailMat);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 11;
    this.scene.add(this.trail);
    this.trailHistory = [];
    this._trailTimer = 0;
  }

  /* ── control ───────────────────────────────────────────────────────── */

  ignite() { if (this.lit) return; this.lit = true; this.bladeGroup.visible = true; }
  retract() { this.lit = false; }
  toggle() { this.lit ? this.retract() : this.ignite(); }

  setHiltPose(pos, quat) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
  }

  /** Blade tip in world space for a given extension fraction (0 = base). */
  pointAt(t, out = new THREE.Vector3()) {
    return out.lerpVectors(this.base, this.tip, t);
  }

  /** Speed of the blade at a fraction along its length, this frame. */
  speedAt(t) {
    return lerp(this.baseVelocity.length(), this.tipVelocity.length(), t);
  }

  /** Effective cut power at a point: fast tips sever, slow hilts shove. */
  cutPowerAt(t) {
    if (!this.lit || this.ignition < 0.85) return 0;
    return this.speedAt(t);
  }

  update(dt, time, carrierVel = null) {
    const target = this.lit ? 1 : 0;
    const rate = this.lit ? 6.5 : 8.5;
    const was = this.ignition;
    this.ignition += (target - this.ignition) * Math.min(1, dt * rate);
    // How fast the blade is growing, in blade-lengths per second. The plasma
    // front is hotter than the column behind it, which is the whole read of an
    // ignition — without it the blade simply appears, one length at a time.
    this.surge = dt > 0 ? clamp((this.ignition - was) / dt / 5.5, 0, 1) : 0;
    if (this.ignition < 0.002 && !this.lit) { this.bladeGroup.visible = false; this.ignition = 0; }
    else if (this.ignition > 0.002) this.bladeGroup.visible = true;

    const len = this.bladeLength * this.ignition;
    this.root.updateMatrixWorld(true);

    // sweep bookkeeping
    this.prevBase.copy(this.base);
    this.prevTip.copy(this.tip);
    this.base.set(0, this.emitterY, 0).applyMatrix4(this.root.matrixWorld);
    this.tip.set(0, this.emitterY + len, 0).applyMatrix4(this.root.matrixWorld);
    this.axis.subVectors(this.tip, this.base);
    const alen = this.axis.length();
    if (alen > 1e-5) this.axis.multiplyScalar(1 / alen); else this.axis.set(0, 1, 0);

    if (this.valid && dt > 0) {
      this.tipVelocity.subVectors(this.tip, this.prevTip).multiplyScalar(1 / dt);
      this.baseVelocity.subVectors(this.base, this.prevBase).multiplyScalar(1 / dt);
    } else {
      this.tipVelocity.set(0, 0, 0); this.baseVelocity.set(0, 0, 0);
      this.prevBase.copy(this.base); this.prevTip.copy(this.tip);
    }
    this.valid = true;
    this.tipSpeed = this.tipVelocity.length();

    // Swing speed is measured against the body that carries the blade, not the
    // world. Sprinting moves the tip at 7 m/s while the wrist is perfectly
    // still — read as world speed that is a swing, and the game whooshes,
    // burns stamina and blurs the screen just because you are walking.
    if (carrierVel) {
      this.swingSpeed = _v4.subVectors(this.tipVelocity, carrierVel).length();
    } else this.swingSpeed = this.tipSpeed;

    // plane the blade swept this frame — this is the cut plane
    _v1.subVectors(this.tip, this.base);
    _v2.subVectors(this.tip, this.prevTip);
    this.sweepArea = _v3.crossVectors(_v1, _v2).length();
    if (this.sweepArea > 1e-6) this.sweepNormal.copy(_v3).multiplyScalar(1 / this.sweepArea);

    this._updateVisuals(dt, time, len);
    this._updateTrail(dt, len);
  }

  _updateVisuals(dt, time, len) {
    const flick = 0.94 + Math.sin(time * 47.3) * 0.022 + Math.sin(time * 111.7) * 0.014
                  + this.contactStrain * 0.22 * Math.sin(time * 180);
    const u = this.bladeMat.uniforms;
    u.uLen.value = Math.max(0.001, len);
    u.uTime.value = time;
    // A blade under load runs hot: the amplitude rises and the instability with
    // it, so a bind or a bolt on the blade is visible on the blade itself.
    u.uFlicker.value = flick * this.punch * (1 + this.contactStrain * 0.5);
    u.uSurge.value = this.surge * 2.4;

    const on = this.ignition > 0.05;
    if (on) {
      // The wash is split along the blade rather than pinned to its middle, so
      // a blade held low lights the floor and a blade held high does not. The
      // second sample sits at 88% rather than ON the tip: a point light exactly
      // at the tip of a blade laid on the deck is a singularity sitting on the
      // deck, and no decay exponent saves you from that.
      this.pointAt(0.42, _v1);
      this.light.position.copy(_v1);
      // 5.4 and 2.4 candela. Under 1/r these cross the old inverse-square rig
      // at 0.95 m: closer than that the blade throws less light than it used to
      // (which is the point — 55 units of irradiance on sand 30 cm away was
      // what clipped the ground to white and threw the hue away), further out
      // it throws more, and at three metres it throws three times more.
      this.light.intensity = 5.4 * this.ignition * (1 + this.contactStrain * 1.6) * flick * this.punch;
      this.light.distance = 5.6 + len * 3.6;
      this.pointAt(0.88, _v1);
      this.tipLight.position.copy(_v1);
      this.tipLight.intensity = 2.4 * this.ignition * (1 + this.contactStrain * 0.9) * flick * this.punch;
      this.tipLight.distance = 3.8 + len * 2.2;
    } else {
      this.light.intensity = 0;
      this.tipLight.intensity = 0;
    }
    this.contactStrain *= Math.max(0, 1 - dt * 6);
  }

  /**
   * How hard this instant of the sweep smears, 0..1.
   *
   * Measured against the BODY, not the world: sprinting carries the tip at
   * 7 m/s with the wrist perfectly still, and read as world speed that lays a
   * full-strength trail down behind a player who is only jogging.
   *
   * And it reaches exactly zero below 2.6 m/s. A blade at rest has to leave a
   * clean frame; the old floor of 0.08 meant one never did, so every still
   * blade dragged a permanent ribbon behind it.
   */
  _trailPunch() {
    return clamp((this.swingSpeed - 2.6) / 13, 0, 1) * this.ignition;
  }

  _updateTrail(dt, len) {
    const n = this.trailSegments, S = this.trailSheets;
    const h = this.trailHistory;
    const LIFE = 0.17;
    const punch = this._trailPunch();

    if (this.ignition > 0.4) {
      const sample = (b, t, age, k) => {
        const s = { b: b.clone(), t: t.clone(), age, punch: k, n: new THREE.Vector3() };
        // The sheet normal is the normal of the surface the blade is sweeping:
        // blade axis × direction of travel. Degenerate when the blade is not
        // moving, which is also when nothing is drawn.
        _v1.subVectors(s.t, s.b);
        _v2.subVectors(s.t, this.prevTip);
        s.n.crossVectors(_v1, _v2);
        const nl = s.n.length();
        if (nl > 1e-6) s.n.multiplyScalar(1 / nl);
        else if (h.length) s.n.copy(h[0].n);
        else s.n.set(1, 0, 0);
        return s;
      };
      // On a slow frame the blade can cross a metre between samples, which
      // would leave the ribbon a fan of huge triangles. Fill in the gap so the
      // trail reads the same at 20 fps as it does at 144.
      const gap = this.tip.distanceTo(this.prevTip);
      const fill = Math.min(8, Math.floor(gap / 0.18));
      for (let i = fill; i >= 1; i--) {
        const k = i / (fill + 1);
        h.unshift(sample(_v3.lerpVectors(this.prevBase, this.base, 1 - k),
                         _v4.lerpVectors(this.prevTip, this.tip, 1 - k),
                         dt * (1 / LIFE) * k, punch));
      }
      h.unshift(sample(this.base, this.tip, 0, punch));
    } else h.length = 0;
    while (h.length > n) h.pop();

    for (const s of h) s.age += dt * (1 / LIFE);

    const pos = this.trailPos, age = this.trailAge, pun = this.trailPunch;
    const TH = this.trailThickness;
    let live = 0;
    for (let i = 0; i < n; i++) {
      const s = h[i];
      const dead = !s || s.age >= 1 || s.punch <= 0.001;
      if (!dead) live++;
      for (let k = 0; k < S; k++) {
        const v = (i * S + k) * 2, p = v * 3;
        if (dead) {
          // collapse unused segments onto the hilt so they rasterise nothing
          pos[p] = pos[p + 3] = this.base.x;
          pos[p + 1] = pos[p + 4] = this.base.y;
          pos[p + 2] = pos[p + 5] = this.base.z;
          age[v] = age[v + 1] = 1;
          pun[v] = pun[v + 1] = 0;
          continue;
        }
        const o = (k - 1) * TH;
        pos[p] = s.b.x + s.n.x * o; pos[p + 1] = s.b.y + s.n.y * o; pos[p + 2] = s.b.z + s.n.z * o;
        // carried 6% past the tip so the smear's leading edge is feathered
        pos[p + 3] = s.t.x + (s.t.x - s.b.x) * 0.06 + s.n.x * o;
        pos[p + 4] = s.t.y + (s.t.y - s.b.y) * 0.06 + s.n.y * o;
        pos[p + 5] = s.t.z + (s.t.z - s.b.z) * 0.06 + s.n.z * o;
        age[v] = age[v + 1] = s.age;
        pun[v] = pun[v + 1] = s.punch;
      }
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.aAge.needsUpdate = true;
    this.trail.geometry.attributes.aPunch.needsUpdate = true;
    this.trailMat.uniforms.uHot.value = Saber.TRAIL_HOT * this.punch;
    this.trailMat.uniforms.uGlow.value = Saber.TRAIL_GLOW * this.punch;
    this.trail.visible = this.ignition > 0.2 && live > 1;
  }

  /** Register a contact so the blade flares and the hum strains. */
  strain(amount) { this.contactStrain = Math.min(1.6, this.contactStrain + amount); }

  setVisible(v) {
    this.root.visible = v;
    this.trail.visible = v && this.ignition > 0.2;
    if (!v) { this.light.intensity = 0; this.tipLight.intensity = 0; }
  }

  dispose() {
    this.scene.remove(this.root, this.trail, this.light, this.tipLight);
    this.trail.geometry.dispose();
    this.trailMat.dispose();
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
  }
}
