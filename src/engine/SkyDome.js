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
 */

import * as THREE from 'three';

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
  uniform vec3  uCloudLit;     // sunlit face
  uniform vec3  uCloudDark;    // shadowed underside
  uniform vec3  uHazeColor;    // what distance dissolves into
  uniform float uHorizonAmt;   // 0 = flat empty horizon, 1 = full range
  uniform float uHorizonScale; // angular size of the landforms
  uniform vec3  uHorizonColor;
  uniform float uWindDir;
  uniform float uWindSpeed;
  uniform float uOpacity;
  uniform float uHdr;          // radiance scale, matched to the linear sky
  uniform float uSunPower;     // how hard the sun is driving the deck
  uniform vec3  uSkyAmb;       // colour of the skylight falling on the deck

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
    // true horizon and fading into haze. Three scales so it reads as ranges
    // behind ranges rather than one sawtooth.
    if (uHorizonAmt > 0.001) {
      float bearing = atan(dir.z, dir.x);
      float far  = fbm3(vec2(bearing * 2.1, 0.0));
      float mid  = fbm3(vec2(bearing * 3.4 + 5.0, 1.5));
      float near = fbm3(vec2(bearing * 5.3 + 11.0, 3.0));

      float ridgeFar  = (far  - 0.30) * 0.30 * uHorizonScale * uHorizonAmt;
      float ridgeMid  = (mid  - 0.32) * 0.24 * uHorizonScale * uHorizonAmt;
      float ridgeNear = (near - 0.34) * 0.19 * uHorizonScale * uHorizonAmt;

      // The far range is hazier and higher; the near one is darker and lower.
      float aaF = fwidth(el) * 1.5 + 0.0006;
      float mF = smoothstep(ridgeFar + aaF, ridgeFar - aaF, el);
      float mM = smoothstep(ridgeMid + aaF, ridgeMid - aaF, el);
      float mN = smoothstep(ridgeNear + aaF, ridgeNear - aaF, el);
      // only below the skyline, and only just above it
      float win = smoothstep(-0.05, 0.01, el);
      mF *= win; mM *= win; mN *= win;

      vec3 cFar  = mix(uHazeColor, uHorizonColor, 0.18);
      vec3 cMid  = mix(uHazeColor, uHorizonColor, 0.32);
      vec3 cNear = mix(uHazeColor, uHorizonColor, 0.50);
      // sun side catches a little light on the facing slopes
      float lit = clamp(dot(normalize(vec3(dir.x, 0.0, dir.z)),
                            normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0);
      lit = lit * lit;
      cFar  *= 1.0 + lit * 0.16;
      cMid  *= 1.0 + lit * 0.14;
      cNear *= 1.0 + lit * 0.12;

      col = mix(col, cFar, mF);   alpha = max(alpha, mF * 0.88);
      col = mix(col, cMid, mM);   alpha = max(alpha, mM * 0.93);
      col = mix(col, cNear, mN);  alpha = max(alpha, mN * 0.96);
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
      float cosT = dot(dir, uSunDir);
      float phase = min(0.62 + 0.22 * hg(cosT, 0.72), 3.0);

      float sun = trans * mix(0.35, 1.0, powder) * phase * uSunPower;
      // ambient from the sky: the underside is not black, it is lit by the
      // whole dome, more so where the cloud is thin.
      float amb = mix(0.85, 0.30, clamp(h, 0.0, 1.0));

      // The shaded part of a cloud is not "a darker cloud colour" — it is a
      // white surface lit by the BLUE SKY. Multiplying the authored underside
      // by the sky's own chroma is what turns a deck of tan paper cut-outs
      // into cumulus with cold bellies and warm shoulders.
      vec3 cloud = (uCloudDark * uSkyAmb * amb + uCloudLit * sun) * uHdr;
      // a touch of extra silver right on the sunward rim
      cloud += uCloudLit * uHdr * pow(max(cosT, 0.0), 12.0) * (1.0 - clamp(h, 0.0, 1.0)) * cum * 0.35;

      // — cirrus: stretched, faster, much fainter, and high enough that it
      // does not fight the cumulus for the same piece of sky.
      vec2 q = base * vec2(0.50, 2.4) + wind * 0.030;
      float cir = smoothstep(0.50, 0.80, fbm3(q)) * smoothstep(0.03, 0.32, el);
      vec3 cirrusCol = uCloudLit * uHdr * (0.55 + 0.55 * pow(max(cosT, 0.0), 6.0));

      float ca = clamp(cum, 0.0, 1.0);
      col = mix(col, cloud, ca);
      alpha = max(alpha, ca);
      // cirrus sits over whatever is already there, additively weighted
      float cw = cir * 0.34 * (1.0 - ca * 0.7);
      col = mix(col, cirrusCol, cw);
      alpha = max(alpha, cw);

      // and a wash of haze right at the skyline so the deck, the silhouette
      // and the sky all meet in the same colour
      float band = (1.0 - smoothstep(0.0, 0.10, el));
      band *= band;
      col = mix(col, uHazeColor, band * 0.92);
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
        uSunPower:     { value: 1 },
        uSkyAmb:       { value: new THREE.Color(1, 1, 1) },
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
    u.uCloudLit.value.set(a.cloudLit ?? 0xfff6e6);
    u.uCloudDark.value.set(a.cloudDark ?? 0x9aa8bd);
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
   */
  setRadiance(hdr, sunPower = 1, skyAmbient = null) {
    this.mat.uniforms.uHdr.value = hdr;
    this.mat.uniforms.uSunPower.value = sunPower;
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

  /** Keep the dome centred on the camera so it never has parallax. */
  update(dt, camera) {
    this.mat.uniforms.uTime.value += dt;
    if (camera) this.mesh.position.copy(camera.position);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
