/**
 * SABER — clouds and the far horizon.
 *
 * A Preetham sky is a gradient. It is physically reasonable and completely
 * empty, and an empty sky over an empty horizon is most of what makes a scene
 * read as a diorama rather than a place: there is nothing at distance for the
 * eye to measure the world against.
 *
 * This adds the two things that fix that, in ONE draw call:
 *
 *   1. A cloud deck. Clouds do more work than any other single element for
 *      "this is a real sky" — they give the dome scale, they move, and they
 *      catch the sun. Two layers: cumulus with real internal density, and thin
 *      cirrus high above drifting faster.
 *
 *   2. A horizon silhouette. Distant landforms sitting on the skyline, washed
 *      out by aerial perspective. Without this the world visibly ends where the
 *      terrain mesh stops, and no amount of fog hides that the edge is a circle.
 *
 * Both are generated from view direction alone — no geometry, no raymarching
 * through a volume, no texture fetches. The dome is a single inverted sphere
 * drawn behind everything with depth writes off.
 *
 * WHAT MAKES A CLOUD LOOK LIKE A CLOUD is not the noise. It is:
 *
 *   • self-shadowing. Light entering the top is absorbed on the way down, so a
 *     cumulus is brilliant on top and slate grey underneath. A deck shaded by
 *     `mix(dark, lit, dot(view, sun))` has no such gradient and reads as paper
 *     cut-outs — which is exactly what this used to look like.
 *   • the powder term. Near a lit edge the light has not travelled far enough
 *     to scatter back out, so thin rims go DARKER than the body, not brighter.
 *   • forward scattering. Water droplets throw light forward hard (g≈0.75), so
 *     a cloud between you and the sun has a blazing rim and a bright interior.
 *   • parallax. Clouds are hundreds of metres thick; their tops are visibly
 *     displaced from their bases as you look across the deck.
 *
 * All four are here, and all four are one or two lines each.
 *
 * AND THE LEVEL HAS TO COME FROM THE LIGHT, NOT FROM A SWATCH. This is the
 * fault that made the deck read as smoke. cloudLit/cloudDark were authored as
 * sRGB colours and used as absolute radiance, so the arena's 0xa89880 pinned
 * the shadowed side at linear (0.39, 0.31, 0.22) — brown — and the shading
 * terms took it DOWN from there: measured, a thick core came out at linear
 * 0.145 against a sky behind it at 1.49 and a skyline at 3.19. A cloud an
 * order of magnitude darker than the sky it hangs in is not a cloud, it is a
 * hole, and a brown one is a smoke smear. A cumulus is a white body with an
 * albedo near 0.9; its sunlit face is the sun's own irradiance over pi and its
 * base is what the sky and the ground throw back up at it. Those two numbers
 * arrive as uCloudSun and uCloudAmb, in the same radiance units as the rest of
 * the frame, and the authored swatches are demoted to what they always were —
 * a HUE, normalised to unit luminance and pulled most of the way to white,
 * because whatever colour a white body has comes from the light on it.
 */

import * as THREE from 'three';
import { ground } from '../world/Scenery.js';

const _lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const _WHITE = new THREE.Color(1, 1, 1);
const _scratch = new THREE.Color();

/**
 * An authored swatch, demoted to a tint: renormalised to unit luminance so it
 * can only ever say WHAT COLOUR and never HOW BRIGHT, then pulled toward white
 * by (1 - keep). A cumulus is a white body; the arena's 0xa89880 underside is
 * 0.45 saturated as authored, and a cloud base that saturated is a mud smear
 * whatever its level, because the only chroma a white body has is the chroma
 * of the light landing on it — which arrives separately, as uSkyAmb.
 */
function tint(c, keep) {
  return unitLum(c).lerp(_WHITE, 1 - keep);
}

/**
 * No floor on the divisor. A floor is the usual guard against dividing by a
 * black swatch, and it silently breaks the guarantee tint() exists for: with a
 * 0.02 floor, 0x101014 came out at 0.78 luminance instead of 1, so an author
 * picking a very dark cloud colour was still setting the deck's LEVEL through
 * the back door. Only literal black needs handling.
 */
function unitLum(c) {
  const L = _lum(c);
  if (L > 1e-5) c.multiplyScalar(1 / L); else c.copy(_WHITE);
  return c;
}

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    // The dome is centred on the camera, so the local position IS the view
    // direction — no matrix round-trip and no parallax as the player walks.
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Pin to the far plane, exactly as three's own Sky does. The camera's far
    // is only 380-900 depending on quality, so a dome at any believable sky
    // radius is otherwise clipped away entirely and never renders at all.
    gl_Position.z = gl_Position.w;
  }
`;

const FRAG = /* glsl */`
  precision highp float;

  uniform vec3  uSunDir;
  uniform float uTime;
  uniform float uCoverage;     // 0 = clear, 1 = overcast
  uniform vec3  uCloudLit;     // hue of the sunlit face, unit luminance
  uniform vec3  uCloudDark;    // hue of the shadowed underside, unit luminance
  uniform vec3  uHazeColor;    // what distance dissolves into
  uniform float uHorizonAmt;   // 0 = flat empty horizon, 1 = full range
  uniform float uHorizonScale; // angular size of the landforms
  uniform vec3  uHorizonColor;
  uniform float uWindDir;
  uniform float uWindSpeed;
  uniform float uOpacity;
  uniform float uHdr;          // radiance scale, matched to the linear sky
  uniform float uCloudSun;     // radiance of a white cloud face square to the sun
  uniform float uCloudAmb;     // radiance of a white cloud face lit by sky + ground
  uniform vec3  uSkyAmb;       // colour of the skylight falling on the deck
  uniform float uStorm;        // 0 clear .. 1 the front is on top of you

  varying vec3 vDir;

  // ── value noise + fbm. Cheap, and clouds do not need gradient noise.
  float hash(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  // Rotating each octave stops the layers lining up into visible grain.
  const mat2 R2 = mat2(0.80, 0.60, -0.60, 0.80);
  float fbm3(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = R2 * p * 2.03; a *= 0.5; }
    return s;
  }
  float fbm5(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = R2 * p * 2.03; a *= 0.5; }
    return s;
  }

  // Henyey–Greenstein. Water droplets scatter forward hard; this is why a
  // cloud in front of the sun is brighter than the sky beside it.
  float hg(float c, float g) {
    float g2 = g * g;
    return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5);
  }

  // ── the deck's density field, in deck-plane coordinates.
  // thr is the coverage threshold; the return is signed "thickness".
  float deck(vec2 p, float thr, vec2 wind) {
    // A slow domain warp is what turns fbm's isotropic mush into billows that
    // curl. Without it every cloud is the same blob at a different size.
    vec2 w = vec2(fbm3(p * 0.45 + wind * 0.004),
                  fbm3(p * 0.45 + wind * 0.004 + 31.7)) - 0.5;
    float shape = fbm5(p + w * 0.75 + wind * 0.012);
    return shape - thr;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float el = dir.y;

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // ── horizon silhouette ────────────────────────────────────────────
    // A ridge line as a function of compass bearing, sitting just above the
    // true horizon and fading into haze. FOUR scales, because three is not
    // enough to read as ranges: what the eye counts is not ridges, it is
    // OVERLAPS — each range has to be seen crossing in front of the one behind
    // it, and with three layers there are only two such crossings anywhere in
    // the frame. The fourth sits highest, hazes hardest and moves least, which
    // is what a range twenty kilometres out actually does.
    //
    // Scenery.js now puts REAL ridges at 170/250/340 m with real parallax.
    // These are what stands behind those, so they are deliberately pushed
    // further toward the haze than they used to be: the near end of the
    // distance is geometry's job now, and a painted range competing with a
    // solid one at the same tone is what makes a backdrop look like a backdrop.
    if (uHorizonAmt > 0.001) {
      float bearing = atan(dir.z, dir.x);
      float vfar = fbm3(vec2(bearing * 1.4 + 21.0, 6.5));
      float far  = fbm3(vec2(bearing * 2.1, 0.0));
      float mid  = fbm3(vec2(bearing * 3.4 + 5.0, 1.5));
      float near = fbm3(vec2(bearing * 5.3 + 11.0, 3.0));

      float ridgeVF   = (vfar - 0.28) * 0.38 * uHorizonScale * uHorizonAmt;
      float ridgeFar  = (far  - 0.30) * 0.30 * uHorizonScale * uHorizonAmt;
      float ridgeMid  = (mid  - 0.32) * 0.24 * uHorizonScale * uHorizonAmt;
      float ridgeNear = (near - 0.34) * 0.19 * uHorizonScale * uHorizonAmt;

      // The far range is hazier and higher; the near one is darker and lower.
      float aaF = fwidth(el) * 1.5 + 0.0006;
      float mV = smoothstep(ridgeVF + aaF, ridgeVF - aaF, el);
      float mF = smoothstep(ridgeFar + aaF, ridgeFar - aaF, el);
      float mM = smoothstep(ridgeMid + aaF, ridgeMid - aaF, el);
      float mN = smoothstep(ridgeNear + aaF, ridgeNear - aaF, el);
      // only below the skyline, and only just above it
      float win = smoothstep(-0.05, 0.01, el);
      mV *= win; mF *= win; mM *= win; mN *= win;

      vec3 cVFar = mix(uHazeColor, uHorizonColor, 0.08);
      vec3 cFar  = mix(uHazeColor, uHorizonColor, 0.18);
      vec3 cMid  = mix(uHazeColor, uHorizonColor, 0.32);
      vec3 cNear = mix(uHazeColor, uHorizonColor, 0.50);
      // sun side catches a little light on the facing slopes
      float lit = clamp(dot(normalize(vec3(dir.x, 0.0, dir.z)),
                            normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0);
      lit = lit * lit;
      cVFar *= 1.0 + lit * 0.18;
      cFar  *= 1.0 + lit * 0.16;
      cMid  *= 1.0 + lit * 0.14;
      cNear *= 1.0 + lit * 0.12;

      col = mix(col, cVFar, mV);  alpha = max(alpha, mV * 0.80);
      col = mix(col, cFar, mF);   alpha = max(alpha, mF * 0.88);
      col = mix(col, cMid, mM);   alpha = max(alpha, mM * 0.93);
      col = mix(col, cNear, mN);  alpha = max(alpha, mN * 0.96);

      // A front takes the distance out. This is the term that makes a squall
      // change what the level IS rather than just what is floating in it: the
      // ranges go first, from the bottom up, and come back as it passes.
      float eaten = uStorm * (1.0 - smoothstep(0.0, 0.16, el));
      col = mix(col, uHazeColor, clamp(eaten * 1.25, 0.0, 1.0));
    }

    // ── clouds ────────────────────────────────────────────────────────
    // Skip everything below the horizon; there is nothing to draw there.
    if (el > 0.004) {
      // Project the view ray onto a flat deck. The 1/el term is what gives
      // clouds their perspective — they crowd together toward the horizon
      // exactly as a real deck does.
      float t = 1.0 / max(el, 0.018);
      vec2 base = dir.xz * t;
      vec2 wind = vec2(cos(uWindDir), sin(uWindDir)) * uWindSpeed * uTime;

      // NB: base only spans ~2 units across the whole visible sky, so a scale
      // near 0.05 samples a SINGLE noise cell — a flat, cloudless wash. At 1.5
      // the deck spans a few cells, the right apparent size for cloud a
      // kilometre up.
      vec2 p = base * 1.5;

      // Coverage as a threshold on density: raising it does not just fade the
      // clouds in, it grows them, which is how a sky actually clouds over.
      // The constants are measured, not guessed: this warped fbm runs p05 0.29
      // to p95 0.70 about a median of 0.50, so 0.60→0.30 walks the sky from 22%
      // covered to 95% as uCoverage goes 0→1. tools/checks/lighting.mjs ports
      // the field and pins those numbers.
      float thr = mix(0.60, 0.30, uCoverage);

      // — parallax. A cumulus is as tall as it is wide, so its top is visibly
      // displaced from its base along the view ray. One cheap iteration: read
      // the density, then re-read it shifted "up" through the deck by that
      // much. Flat noise becomes something with a lit top and a shaded flank.
      float d0 = deck(p, thr, wind);
      vec2  up = -p * 0.16;                       // toward the zenith on the deck
      float d  = deck(p + up * clamp(d0 * 4.0, 0.0, 1.0), thr, wind);

      // — erosion. The outline of a cumulus is not the level set of a smooth
      // field; it is torn by turbulence an order of magnitude finer than the
      // billow it sits on. A high-frequency field subtracted at the RIM only —
      // weighted out by the time the density is 0.22 above threshold, so the
      // core is untouched — eats the silhouette into fringes and wisps. Kept
      // OUT of deck() on purpose: the coverage statistics in
      // tools/checks/lighting.mjs port that function, and this term has zero
      // mean, so it must not be allowed to move the threshold calibration.
      float fine = fbm3(p * 6.3 + wind * 0.028) - 0.5;
      d -= fine * 0.075 * (1.0 - smoothstep(0.0, 0.22, d));

      // Thickness in optical units. d tops out near 0.40, so ×3.4 puts a solid
      // cloud around 1 and a wisp around 0.15.
      float h = clamp(d * 3.4, 0.0, 1.3);
      // Coverage mask. The ramp is 0.085 wide because that is where this field
      // actually lives — at the 0.30 the eye wants, EVERY cloud is a 40%
      // translucent smear and the deck disappears.
      float cum = smoothstep(0.0, 0.085, d);
      // thin toward the horizon so the deck ends in haze, not a line
      cum *= smoothstep(0.0, 0.05, el);

      // — self-shadowing. March toward the sun THROUGH the deck: the sun's
      // direction projected onto the deck plane, divided by its elevation, is
      // exactly the horizontal distance light travels per unit of height.
      // Absorb along it. This is the entire reason a cloud has a bright
      // shoulder and a slate flank, and no amount of noise substitutes for it.
      vec2 sstep = uSunDir.xz / max(uSunDir.y, 0.25) * 0.085;
      float od = clamp(deck(p + sstep,       thr, wind) * 3.4, 0.0, 1.3) * 1.00
               + clamp(deck(p + sstep * 2.3, thr, wind) * 3.4, 0.0, 1.3) * 0.72
               + clamp(deck(p + sstep * 4.2, thr, wind) * 3.4, 0.0, 1.3) * 0.44;
      float trans = exp(-od * 0.85);

      // — powder. Light has not scattered back out of a thin edge yet, so rims
      // facing the sun read DARKER than the body. Without it clouds glow at
      // the edges like neon and the illusion collapses.
      float powder = 1.0 - exp(-h * 3.0);

      // — phase. Forward scattering gives the rim in front of the sun its
      // blaze and the backlit interior its glow. Capped, or a cloud crossing
      // the sun becomes a white hole.
      //
      // NORMALISED so a face the sun reaches square-on returns about 1. The
      // old constants peaked at 0.68 across the side-lit majority of the deck,
      // which quietly took a third off every lit shoulder in the sky — a white
      // body cannot return less light than falls on it and then still read as
      // white. The forward lobe is what is meant to be big here, not the
      // baseline.
      float cosT = dot(dir, uSunDir);
      float phase = min(0.88 + 0.30 * hg(cosT, 0.72), 2.4);

      float sun = trans * mix(0.42, 1.0, powder) * phase;
      // ambient: the underside is not black, it is lit by the whole dome and
      // by everything the ground throws back up, more so where the cloud is
      // thin. The floor is 0.55 rather than 0.30 because uCloudAmb already
      // carries the multiple-scattering term — light that has bounced twice
      // INSIDE the deck is most of what makes a fair-weather base grey instead
      // of the storm-black a single-scatter model gives you.
      float amb = mix(0.95, 0.55, clamp(h, 0.0, 1.0));

      // The shaded part of a cloud is not "a darker cloud colour" — it is a
      // white surface lit by the BLUE SKY. Multiplying the authored underside
      // by the sky's own chroma is what turns a deck of tan paper cut-outs
      // into cumulus with cold bellies and warm shoulders. The LEVEL of both
      // faces comes from uCloudSun / uCloudAmb; the swatches only tint.
      vec3 cloud = (uCloudDark * uSkyAmb * uCloudAmb * amb
                  + uCloudLit * uCloudSun * sun) * uHdr;
      // a touch of extra silver right on the sunward rim
      cloud += uCloudLit * uCloudSun * uHdr
             * pow(max(cosT, 0.0), 12.0) * (1.0 - clamp(h, 0.0, 1.0)) * cum * 0.35;

      // — cirrus: stretched, faster, much fainter, and high enough that it
      // does not fight the cumulus for the same piece of sky.
      vec2 q = base * vec2(0.50, 2.4) + wind * 0.030;
      float cir = smoothstep(0.50, 0.80, fbm3(q)) * smoothstep(0.03, 0.32, el);
      // Ice, not water: cirrus is thin enough that essentially all of it is
      // lit, so it sits at the deck's own sunlit level rather than below it.
      vec3 cirrusCol = uCloudLit * uCloudSun * uHdr * (0.62 + 0.55 * pow(max(cosT, 0.0), 6.0));

      float ca = clamp(cum, 0.0, 1.0);
      col = mix(col, cloud, ca);
      alpha = max(alpha, ca);
      // cirrus sits over whatever is already there, additively weighted
      float cw = cir * 0.34 * (1.0 - ca * 0.7);
      col = mix(col, cirrusCol, cw);
      alpha = max(alpha, cw);

      // and a wash of haze right at the skyline so the deck, the silhouette
      // and the sky all meet in the same colour. A front lifts that band a long
      // way up the dome — dust does not stay near the ground, and a storm that
      // only fogs the bottom four degrees of the sky reads as a bug in the fog.
      float bandTop = mix(0.10, 0.62, uStorm);
      float band = (1.0 - smoothstep(0.0, bandTop, el));
      band *= band;
      float wash = band * mix(0.92, 1.0, uStorm);
      col = mix(col, uHazeColor, wash);
      alpha = max(alpha, band * 0.86);
    }

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, alpha * uOpacity);
  }
`;

export class SkyDome {
  constructor(scene, opts = {}) {
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir:       { value: new THREE.Vector3(0.3, 0.4, 0.85).normalize() },
        uTime:         { value: 0 },
        uCoverage:     { value: 0.42 },
        uCloudLit:     { value: new THREE.Color(0xfff6e6) },
        uCloudDark:    { value: new THREE.Color(0x9aa8bd) },
        uHazeColor:    { value: new THREE.Color(0xd8c8a4) },
        uHorizonAmt:   { value: 1 },
        uHorizonScale: { value: 1 },
        uHorizonColor: { value: new THREE.Color(0x6d6152) },
        uWindDir:      { value: 0.7 },
        uWindSpeed:    { value: 1 },
        uOpacity:      { value: 1 },
        uHdr:          { value: 1 },
        // Defaults are a fair-weather day at a 30° sun with a 0.9-albedo deck,
        // so a SkyDome built without an Engine still draws cloud rather than a
        // black cut-out.
        uCloudSun:     { value: 1.0 },
        uCloudAmb:     { value: 0.42 },
        uSkyAmb:       { value: new THREE.Color(1, 1, 1) },
        uStorm:        { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    // Behind everything, including the Preetham sky it is composited over.
    this.mesh.renderOrder = -900;
    this.mesh.scale.setScalar(opts.radius ?? 9000);
    scene.add(this.mesh);
    this.scene = scene;
  }

  /** Per-level mood. Keys mirror the atmosphere blocks in Levels.js. */
  configure(a = {}) {
    const u = this.mat.uniforms;
    u.uCoverage.value = a.cloudCover ?? 0.42;
    u.uOpacity.value = a.clouds === false ? 0 : (a.cloudOpacity ?? 1);
    // Hue only — see tint(). The lit face keeps more of its authored cast than
    // the shadowed one because the sun genuinely is coloured at low elevation,
    // whereas a base is lit by the whole hemisphere and averages out nearly
    // neutral whatever the level author had in mind.
    //
    // And the lit face is a white body under THE SUN, so the sun's own colour
    // belongs on it — pulled halfway to white, because a cumulus top is above
    // most of the dust that reddens the same sun down at ground level. Without
    // this the tops came out the same cold grey-blue as the bases, since the
    // level of the sunlit term is a scalar and carries no chroma at all.
    tint(u.uCloudLit.value.set(a.cloudLit ?? 0xfff6e6), 0.55)
      .multiply(tint(_scratch.set(a.sunColor ?? 0xfff0d8), 0.5));
    // the product of two unit-luminance tints is not unit luminance
    unitLum(u.uCloudLit.value);
    tint(u.uCloudDark.value.set(a.cloudDark ?? 0x9aa8bd), 0.30);
    u.uHazeColor.value.set(a.fogColor ?? 0xd8c8a4);
    u.uHorizonAmt.value = a.horizon === false ? 0 : (a.horizonAmount ?? 1);
    u.uHorizonScale.value = a.horizonScale ?? 1;
    u.uHorizonColor.value.set(a.horizonColor ?? 0x6d6152);
    u.uWindDir.value = a.cloudWindDir ?? 0.7;
    u.uWindSpeed.value = a.cloudWindSpeed ?? 1;
    this.mesh.visible = a.sky !== false && u.uOpacity.value > 0.001;
  }

  /**
   * Tie the deck to the sky it hangs in. The Preetham dome is consumed as
   * linear radiance, so the clouds have to be scaled into the same units or
   * they are either black paper or blown-out white paper against it.
   *
   * `cloudSun` and `cloudAmb` are the two numbers the whole deck's tonality
   * hangs off: the radiance of a white cloud face square to the sun, and the
   * radiance of one lit by nothing but the sky and the ground bounce. Engine
   * derives both from the level's own light, so a deck cannot come out darker
   * than the sky behind it however the level's swatches were authored.
   */
  setRadiance(hdr, cloudSun = 1, skyAmbient = null, cloudAmb = null) {
    this.mat.uniforms.uHdr.value = hdr;
    this.mat.uniforms.uCloudSun.value = cloudSun;
    if (cloudAmb != null) this.mat.uniforms.uCloudAmb.value = cloudAmb;
    if (skyAmbient) this.mat.uniforms.uSkyAmb.value.copy(skyAmbient);
  }

  /**
   * The haze the deck and the skyline dissolve into. It has to be the SAME
   * radiance the scene's fog dissolves into, or the world ends at a visible
   * seam where the terrain stops and the dome takes over — which is what an
   * sRGB swatch used raw against a linear sky gives you: a dark band under a
   * bright horizon. Engine hands us the value it gave the fog.
   */
  setHaze(color, land) {
    if (color) this.mat.uniforms.uHazeColor.value.copy(color);
    // The ranges are terrain seen through a great deal of air, so their colour
    // is the ground's own radiance — albedo times the light actually landing
    // on it — not an sRGB swatch read as light.
    if (land) this.mat.uniforms.uHorizonColor.value.copy(land);
  }

  setSun(dir) { this.mat.uniforms.uSunDir.value.copy(dir).normalize(); }

  /**
   * Keep the dome centred on the camera so it never has parallax, and read the
   * weather.
   *
   * The dome PULLS the storm rather than being pushed it, on purpose: there is
   * exactly one weather scheduler (Scenery's `ground.weather`) and everything
   * downstream of it reads the same number in the same frame. Handing the sky
   * its own copy through Engine would be a second place that could disagree,
   * and two systems each deciding independently how stormy it is is precisely
   * what reads as fake.
   */
  update(dt, camera) {
    this.mat.uniforms.uTime.value += dt;
    this.mat.uniforms.uStorm.value = ground.weather ? ground.weather.intensity : 0;
    if (camera) this.mesh.position.copy(camera.position);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
