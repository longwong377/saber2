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
 * Both are generated from view direction alone — no geometry, no raymarching,
 * no texture fetches. The dome is a single inverted sphere drawn behind
 * everything with depth writes off.
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
  float fbm(vec2 p, int oct) {
    float s = 0.0, a = 0.5;
    // Rotating each octave stops the layers lining up into visible grain.
    mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      s += a * vnoise(p);
      p = R * p * 2.02;
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float el = dir.y;

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    // ── horizon silhouette ────────────────────────────────────────────
    // A ridge line as a function of compass bearing, sitting just above the
    // true horizon and fading into haze. Two scales so it reads as ranges
    // behind ranges rather than one sawtooth.
    if (uHorizonAmt > 0.001) {
      float bearing = atan(dir.z, dir.x);
      float far  = fbm(vec2(bearing * 2.1, 0.0), 4);
      float near = fbm(vec2(bearing * 5.3 + 11.0, 3.0), 4);

      float ridgeFar  = (far  - 0.30) * 0.30 * uHorizonScale * uHorizonAmt;
      float ridgeNear = (near - 0.34) * 0.19 * uHorizonScale * uHorizonAmt;

      // The far range is hazier and higher; the near one is darker and lower.
      float aaF = fwidth(el) * 1.5 + 0.0006;
      float mF = smoothstep(ridgeFar + aaF, ridgeFar - aaF, el);
      float mN = smoothstep(ridgeNear + aaF, ridgeNear - aaF, el);
      // only below the skyline, and only just above it
      mF *= smoothstep(-0.05, 0.01, el);
      mN *= smoothstep(-0.05, 0.01, el);

      vec3 cFar  = mix(uHazeColor, uHorizonColor, 0.22);
      vec3 cNear = mix(uHazeColor, uHorizonColor, 0.46);
      // sun side catches a little light on the facing slopes
      float lit = clamp(dot(normalize(vec3(dir.x, 0.0, dir.z)),
                            normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0);
      cFar  += lit * 0.06;
      cNear += lit * 0.05;

      col = mix(col, cFar, mF);
      alpha = max(alpha, mF * 0.92);
      col = mix(col, cNear, mN);
      alpha = max(alpha, mN * 0.96);
    }

    // ── clouds ────────────────────────────────────────────────────────
    // Skip everything below the horizon; there is nothing to draw there.
    if (el > 0.005) {
      // Project the view ray onto a flat deck. The 1/el term is what gives
      // clouds their perspective — they crowd together toward the horizon
      // exactly as a real deck does.
      float t = 1.0 / max(el, 0.02);
      vec2 base = dir.xz * t;
      vec2 wind = vec2(cos(uWindDir), sin(uWindDir)) * uWindSpeed * uTime;

      // cumulus: coarse shape, then erode the edges with detail
      // NB: base only spans ~2 units across the whole visible sky, so the
      // old 0.055 scale sampled a SINGLE noise cell — a flat, cloudless wash.
      // At 1.6 the deck spans a few cells, which is the right apparent size for
      // clouds a kilometre up.
      vec2 p = base * 1.6 + wind * 0.012;
      float shape = fbm(p, 4);
      float detail = fbm(p * 3.1 + shape * 0.6, 4);
      float d = shape - detail * 0.28;

      // Coverage as a threshold on density: raising it does not just fade the
      // clouds in, it grows them, which is how a sky actually clouds over.
      float thr = mix(0.46, 0.13, uCoverage);
      float cum = smoothstep(thr, thr + 0.13, d);
      // thin out hard toward the horizon so the deck ends in haze, not a line
      cum *= smoothstep(0.0, 0.16, el);

      // cirrus: stretched, faster, much fainter
      vec2 q = base * vec2(0.55, 2.6) + wind * 0.03;
      float cir = smoothstep(0.55, 0.85, fbm(q, 4)) * 0.28 * smoothstep(0.02, 0.3, el);

      // Lighting. Density falls off toward the top of a cloud, so the gradient
      // of the density field points roughly along the surface normal; dotting
      // that with the sun gives the silver lining for free.
      float toSun = clamp(dot(dir, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
      float edge = 1.0 - smoothstep(thr, thr + 0.22, d);   // 1 at the rim
      float silver = pow(toSun, 6.0) * edge;
      vec3 cloud = mix(uCloudDark, uCloudLit, pow(toSun, 1.4) * 0.65 + edge * 0.35);
      cloud += silver * 0.55;

      float ca = clamp(cum * 0.95 + cir, 0.0, 1.0);
      col = mix(col, cloud, ca);
      alpha = max(alpha, ca);

      // and a wash of cirrus haze right at the skyline so the deck, the
      // silhouette and the sky all meet in the same colour
      float band = (1.0 - smoothstep(0.0, 0.085, el)) * 0.5;
      col = mix(col, uHazeColor, band * 0.85);
      alpha = max(alpha, band * 0.75);
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
