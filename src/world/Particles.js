/**
 * SABER — particles, chips, decals.
 *
 * Three tiers, chosen by what each effect has to be able to do.
 *
 *   ParticlePool   Simulation lives entirely in the vertex shader: the CPU only
 *                  writes a spawn record. That keeps sand storms and spark
 *                  showers essentially free and lets one draw call carry twenty
 *                  thousand of them. Sparks skitter and die on the ground,
 *                  smoke and embers shear in the shared wind, and everything is
 *                  fogged — additively blended pools by ATTENUATION, because
 *                  blending a spark toward the fog colour makes it brighter.
 *
 *   ChipField      Debris that has to behave: real integration, real bounces,
 *                  real angular velocity, lit and shadowed like the world it
 *                  landed in. A few hundred, recycled through a free list.
 *
 *   DecalField     Marks that outlive the event — scorch, scuff, skid, and the
 *                  molten line a blade leaves in the dirt, cooling from orange
 *                  to char over the first couple of seconds.
 */

import * as THREE from 'three';
import { sparkSprite, smokeSprite, radialSprite, scorchSprite } from '../engine/Textures.js';
import { makeRng, clamp, TAU } from '../engine/MathUtil.js';
import { WIND_GLSL, windUniforms, syncWind, ground, wind } from './Scenery.js';

const rng = makeRng(2718);

const VERT = /* glsl */`
  precision highp float;
  #include <common>
  #include <fog_pars_vertex>
  ${WIND_GLSL}

  attribute vec3 aSpawn;
  attribute vec3 aVel;
  attribute vec4 aParams;   // life, size, drag, gravity
  attribute vec4 aColor;    // rgb + alpha scale
  attribute vec3 aExtra;    // floor y, seed, start time
  uniform float uTime;
  uniform float uStretch;
  uniform float uGrow;
  uniform float uSpin;
  uniform float uFadeIn;
  uniform float uWindK;     // how hard the wind carries this pool
  uniform float uCurl;      // how much it tumbles as it goes
  uniform float uBounce;    // 0 = settle, >0 = skitter and die
  uniform float uThin;      // how far a stretched billboard narrows across
  uniform float uStretchMax;
  uniform vec3 uSunDir;     // world-space direction TO the key light
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vLife;
  varying vec3 vSun;        // the key light in the billboard's own frame

  void main(){
    float t = uTime - aExtra.z;
    float life = aParams.x;
    vLife = t / life;
    if(t < 0.0 || t > life){
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // cull off-screen
      vColor = vec4(0.0);
      vUv = uv;
      vSun = vec3(0.0, 0.0, 1.0);
      #ifdef USE_FOG
        vFogDepth = 0.0;
      #endif
      return;
    }

    float k = max(aParams.z, 0.0001);
    float e = (1.0 - exp(-k * t)) / k;
    float accel = (t / k - e) / k;             // the integral of a constant force
    vec3 pos = aSpawn + aVel * e + vec3(0.0, -aParams.w, 0.0) * accel;

    // ── carried by the same wind the grass is leaning in.
    // Drag pulls a particle toward the air's velocity, and the displacement
    // that produces is w·(t − e): it starts at nothing and approaches moving
    // WITH the wind. Treating wind as a constant force instead gives a drift
    // that keeps accelerating, and smoke that shoots sideways off the screen.
    if(uWindK > 0.0){
      vec3 w = windAt(aSpawn.xz);
      pos += w * (uWindK * (t - e));
      if(uCurl > 0.0){
        float ph = aExtra.y * 6.2831;
        pos += vec3(sin(ph + t * 1.7), sin(ph * 1.7 + t * 0.9) * 0.35, cos(ph + t * 1.3))
               * (uCurl * t * length(w.xz) * 0.35);
      }
    }

    // ── the ground captured at spawn time
    float floorY = aExtra.x;
    float over = floorY - pos.y;
    float grounded = 0.0;
    if(over > 0.0){
      grounded = 1.0;
      if(uBounce > 0.0){
        // A spark below the floor has overshot it. How far below stands in for
        // how long ago it landed, so folding that depth through a decaying
        // oscillation gives a few shrinking hops and then a skid — which is
        // what a spark does, without the shader having to solve for the exact
        // moment of contact under drag.
        float s = sqrt(over);
        pos.y = floorY + abs(sin(s * uBounce)) * exp(-s * 2.1) * (0.30 * s + 0.015);
      } else {
        pos.y = floorY + min(over * 0.16, 0.05);
      }
    }

    float grow = 1.0 + uGrow * vLife;
    float fade = smoothstep(1.0, 0.72, vLife) * smoothstep(0.0, uFadeIn, vLife);
    if(uBounce > 0.0) fade *= exp(-max(over, 0.0) * 1.1);   // spent sparks go out
    float size = aParams.y * grow;

    // billboard, optionally stretched along the velocity direction
    vec3 camRight = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
    vec3 camUp    = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);

    vec2 q = position.xy;
    float sp = uSpin * (aExtra.y * 6.2831 + t * (aExtra.y - 0.5) * 3.0);
    float cs = cos(sp), sn = sin(sp);
    q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);

    vec3 offset;
    if(uStretch > 0.001){
      vec3 v = aVel + vec3(0.0, -aParams.w * t, 0.0);
      float vl = length(v);
      vec3 dir = vl > 0.001 ? v / vl : vec3(0.0,1.0,0.0);
      vec3 side = normalize(cross(dir, normalize(cameraPosition - pos)) + vec3(1e-5));
      float stretch = 1.0 + min(vl * uStretch, uStretchMax) * (1.0 - grounded * 0.8);
      // A spark is not a glowing pea. Stretching a billboard along its
      // velocity without narrowing it across gives a lozenge that gets FATTER
      // the faster it goes; narrowing by the same factor turns it into the
      // hairline streak an incandescent particle actually is.
      float narrow = 1.0 / (1.0 + (stretch - 1.0) * uThin);
      offset = dir * q.y * size * stretch + side * q.x * size * narrow;
    } else {
      offset = camRight * q.x * size + camUp * q.y * size;
    }

    #ifdef LIT_POOL
      // The key light in the billboard's own frame, with the spin undone so the
      // fragment shader can read its sphere normal straight off the uv.
      vec3 camFwd = vec3(modelViewMatrix[0][2], modelViewMatrix[1][2], modelViewMatrix[2][2]);
      vec3 sl = vec3(dot(uSunDir, camRight), dot(uSunDir, camUp), dot(uSunDir, camFwd));
      vSun = vec3(sl.x * cs + sl.y * sn, -sl.x * sn + sl.y * cs, sl.z);
    #else
      vSun = vec3(0.0, 0.0, 1.0);
    #endif

    vec4 mv = modelViewMatrix * vec4(pos + offset, 1.0);
    vec4 mvPosition = mv;
    #include <fog_vertex>
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vColor = vec4(aColor.rgb, aColor.a * fade);
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  #include <common>
  #include <fog_pars_fragment>
  uniform sampler2D uMap;
  uniform vec3 uColorEnd;
  uniform float uColorShift;
  uniform vec3 uShadeSun;   // tint+level on the lit side of a puff
  uniform vec3 uShadeSky;   // tint+level on the shadowed side
  uniform float uWrap;      // how far the light wraps round it
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vLife;
  varying vec3 vSun;
  void main(){
    vec4 tex = texture2D(uMap, vUv);
    vec3 c = mix(vColor.rgb, uColorEnd, vLife * uColorShift);
    float a = tex.a * vColor.a;
    if(a < 0.004) discard;

    /* Smoke and dust are the only things in the frame with volume and no
     * lighting, which is exactly why they read as grey stickers. Each billboard
     * is shaded as the sphere it is standing in for: a hemisphere normal off
     * the quad's own uv, wrapped diffuse against the level's key light. The two
     * shade colours average to 1, so this only ever adds FORM — it cannot
     * silently rebalance how bright the smoke in a level is. */
    #ifdef LIT_POOL
      vec2 q = vUv - 0.5;
      float r2 = dot(q, q) * 4.0;
      float nz = sqrt(max(0.0, 1.0 - r2));
      float ndl = dot(vec3(q * 2.0, nz), vSun);
      float wrapd = clamp((ndl + uWrap) / (1.0 + uWrap), 0.0, 1.0);
      c *= mix(uShadeSky, uShadeSun, wrapd * wrapd * (3.0 - 2.0 * wrapd));
    #endif

    gl_FragColor = vec4(c * tex.rgb, a);

    // Fog, done by hand because the stock chunk is wrong for additive blending:
    // mixing an ember toward a bright fog colour makes distant sparks GLOW.
    // What distance does to an emitter is take light away from it.
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      #ifdef EMISSIVE_POOL
        gl_FragColor.rgb *= (1.0 - fogFactor);
      #else
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
      #endif
    #endif
  }
`;

export class ParticlePool {
  constructor(scene, opts = {}) {
    this.max = opts.max ?? 3000;
    this.head = 0;
    this.time = 0;
    this.live = 0;

    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    geo.instanceCount = this.max;

    this.aSpawn = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4);
    this.aExtra = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    for (const a of [this.aSpawn, this.aVel, this.aParams, this.aColor, this.aExtra]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSpawn', this.aSpawn);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aParams', this.aParams);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aExtra', this.aExtra);
    // start everything expired
    for (let i = 0; i < this.max; i++) this.aParams.array[i * 4] = -1;

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
    Object.assign(uniforms, windUniforms(), {
      uTime: { value: 0 },
      uMap: { value: opts.map },
      uStretch: { value: opts.stretch ?? 0 },
      uStretchMax: { value: opts.stretchMax ?? 6 },
      uThin: { value: opts.thin ?? 0 },
      uGrow: { value: opts.grow ?? 0 },
      uSpin: { value: opts.spin ?? 0 },
      uFadeIn: { value: opts.fadeIn ?? 0.05 },
      uWindK: { value: opts.windK ?? 0 },
      uCurl: { value: opts.curl ?? 0 },
      uBounce: { value: opts.bounce ?? 0 },
      uColorEnd: { value: new THREE.Color(opts.colorEnd ?? 0xffffff) },
      uColorShift: { value: opts.colorShift ?? 0 },
      uSunDir: { value: new THREE.Vector3(0.4, 0.82, 0.4).normalize() },
      uShadeSun: { value: new THREE.Vector3(1, 1, 1) },
      uShadeSky: { value: new THREE.Vector3(1, 1, 1) },
      uWrap: { value: opts.wrap ?? 0.45 },
    });

    const defines = {};
    if (opts.additive) defines.EMISSIVE_POOL = '';
    if (opts.lit) defines.LIT_POOL = '';
    this.lit = !!opts.lit;

    const mat = new THREE.ShaderMaterial({
      uniforms,
      defines,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 10;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
    this.mat = mat;
    this._dirty = false;
  }

  /**
   * @param {THREE.Vector3} pos
   * @param {THREE.Vector3} vel
   *
   * `hdr` multiplies the colour past 1. Nothing in this file used to: the
   * colour attribute was a plain 0..1 sRGB swatch and the fragment could not
   * emit more than 1.0, so not one spark, ember or muzzle flash in the game
   * ever crossed the bloom threshold (1.8 in linear luminance) — the blade was
   * the only thing that glowed, and every impact was a sticker beside it.
   */
  spawn(pos, vel, { life = 1, size = 0.1, drag = 1.2, gravity = 9, color = 0xffffff,
    alpha = 1, floor = -999, hdr = 1 } = {}) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    if (this.live < this.max) this.live++;
    const i3 = i * 3, i4 = i * 4;
    this.aSpawn.array[i3] = pos.x; this.aSpawn.array[i3 + 1] = pos.y; this.aSpawn.array[i3 + 2] = pos.z;
    this.aVel.array[i3] = vel.x; this.aVel.array[i3 + 1] = vel.y; this.aVel.array[i3 + 2] = vel.z;
    this.aParams.array[i4] = life; this.aParams.array[i4 + 1] = size;
    this.aParams.array[i4 + 2] = drag; this.aParams.array[i4 + 3] = gravity;
    const c = _col.set(color);
    this.aColor.array[i4] = c.r * hdr; this.aColor.array[i4 + 1] = c.g * hdr;
    this.aColor.array[i4 + 2] = c.b * hdr; this.aColor.array[i4 + 3] = alpha;
    this.aExtra.array[i3] = floor; this.aExtra.array[i3 + 1] = rng();
    this.aExtra.array[i3 + 2] = this.time;
    this._dirty = true;
    return i;
  }

  /**
   * Aim the fake volumetric shading at the level's key light. `sun` and `sky`
   * are unit-mean TINTS; the levels are derived here, from this pool's own
   * wrap, so that the shading averages to exactly 1 over all key directions.
   *
   * The mean of the wrapped-and-smoothed term over a uniformly distributed
   * key direction and the visible hemisphere of a puff is (1 + wrap)/4 — so
   * splitting the contrast about that point is what makes this add form
   * without ever changing how bright the smoke in a level is. A fixed split
   * would quietly brighten a tightly-wrapped pool and darken a loose one.
   */
  setKey(dir, sun, sky) {
    if (!this.lit) return;
    const u = this.mat.uniforms;
    u.uSunDir.value.copy(dir);
    const k = 0.25 * (1 + u.uWrap.value);
    const S = 0.78;                       // lit-to-shadow contrast across a puff
    u.uShadeSun.value.copy(sun).multiplyScalar(1 + (1 - k) * S);
    u.uShadeSky.value.copy(sky).multiplyScalar(1 - k * S);
  }

  update(dt) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    syncWind(this.mat.uniforms);
    if (this._dirty) {
      this.aSpawn.needsUpdate = true; this.aVel.needsUpdate = true;
      this.aParams.needsUpdate = true; this.aColor.needsUpdate = true; this.aExtra.needsUpdate = true;
      this._dirty = false;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

const _col = new THREE.Color();
const _col2 = new THREE.Color();
const WHITE_C = new THREE.Color(1, 1, 1);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _scl = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _shadeA = new THREE.Vector3();
const _shadeB = new THREE.Vector3();

/* ══════════════════════════════════════════════════════════════════════ */
/*  What the surface under a strike is made of                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The albedo of whatever the ground is wearing at (x, z), as a hex.
 *
 * Read off the live terrain's own preset rather than passed in, because every
 * caller of a spark burst knows where the hit was and none of them knows what
 * the level's dirt is made of. Returns null with no terrain published, so the
 * recipes fall back to their own defaults instead of inventing a colour.
 */
export function surfaceTint(x, z) {
  const t = ground.terrain;
  if (!t || !t.preset) return null;
  const kind = t.surfaceAt ? t.surfaceAt(x, z) : 'sand';
  if (kind === 'water') return 0x9fd8ff;
  if (kind === 'stone') return t.preset.rockColor ?? t.preset.sandColor ?? null;
  if (kind === 'metal') return t.preset.sandColor ?? 0x9aa2ad;
  return t.preset.sandColor ?? null;
}

/**
 * What a piece of that surface looks like while it is still glowing.
 *
 * The surface's HUE, not its brightness: an albedo carries how dark a rock is,
 * and a spark thrown off it is not dark — it is incandescent. Normalising to a
 * peak of 1 first is the whole trick; without it a cut into basalt (albedo
 * 0.06) throws sparks twenty times dimmer than a cut into sand right beside it,
 * which is exactly the class of bug this codebase keeps producing. `heat` then
 * runs that hue toward white, because hot enough is white whatever it started
 * as, and a saber cut is hot enough that only a memory of the material is left.
 */
export function incandescent(surfaceHex, heat = 0.55) {
  _col2.set(surfaceHex);
  const peak = Math.max(_col2.r, _col2.g, _col2.b, 1e-4);
  _col2.multiplyScalar(1 / peak);
  return _col2.lerp(WHITE_C, clamp(heat, 0, 1)).getHex();
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Chips — debris with actual physics                                    */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A few hundred stone and metal chips that bounce, tumble, skid and settle.
 * They are a MeshStandardMaterial InstancedMesh, so they are lit, fogged and
 * shadowed by the same rig as everything else — which is the whole point: a
 * billboard chip always looks like a decal, a real one looks like rubble.
 *
 * Active chips are compacted into the front of the instance buffer each frame
 * and `mesh.count` is set to how many there are, so a quiet moment costs a
 * draw call with zero instances rather than a pass over the dead.
 */
export class ChipField {
  constructor(scene, opts = {}) {
    this.max = Math.max(8, Math.floor(opts.max ?? 240));
    const geo = new THREE.TetrahedronGeometry(1, 0);
    geo.scale(1, 0.62, 1);
    // Per-instance heat. Debris that has just been blown off a wall, or parted
    // by a blade, is GLOWING for the first second or two, and a black chip
    // tumbling out of a fireball is the single loudest thing in a frame that
    // says the explosion and the debris were authored by different people.
    this.aHeat = new THREE.InstancedBufferAttribute(new Float32Array(this.max), 1);
    this.aHeat.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aHeat', this.aHeat);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.88, metalness: 0.04, flatShading: true,
    });
    mat.onBeforeCompile = (s) => {
      s.vertexShader = 'attribute float aHeat;\nvarying float vHeat;\n' + s.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvHeat = aHeat;');
      s.fragmentShader = 'varying float vHeat;\n' + s.fragmentShader
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // a crude blackbody: dull red at the end of it, straw-white at the
          // start, and over 1.0 while it is hot so the bloom pass sees it
          totalEmissiveRadiance += mix(vec3(1.5, 0.20, 0.02), vec3(3.2, 2.0, 0.8),
            clamp(vHeat * 1.6 - 0.6, 0.0, 1.0)) * vHeat;`);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.matrixAutoUpdate = false;
    // seed instanceColor so the attribute exists before the first spawn
    for (let i = 0; i < this.max; i++) this.mesh.setColorAt(i, _col.setRGB(1, 1, 1));
    scene.add(this.mesh);
    this.material = mat;

    this.chips = [];
    this.free = [];
    for (let i = 0; i < this.max; i++) {
      this.chips.push({
        alive: false, age: 0, life: 1, scale: 0.05, rest: 0.3, floor: -999,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        spin: new THREE.Vector3(), quat: new THREE.Quaternion(),
        color: new THREE.Color(), sleep: 0, heat: 0, cool: 1.4,
      });
      this.free.push(i);
    }
    this._oldest = 0;
  }

  get liveCount() { return this.max - this.free.length; }

  /** Take a slot, recycling the oldest live chip when the pool is full. */
  _take() {
    if (this.free.length) return this.free.pop();
    const i = this._oldest;
    this._oldest = (this._oldest + 1) % this.max;
    return i;
  }

  spawn(pos, vel, { life = 6, size = 0.05, color = 0x9a8a72, floor = -999, restitution = 0.32,
    spin = 12, heat = 0, cool = 1.4 } = {}) {
    const i = this._take();
    const c = this.chips[i];
    c.alive = true; c.age = 0; c.life = life; c.scale = size; c.rest = restitution;
    c.floor = floor; c.sleep = 0; c.heat = heat; c.cool = cool;
    c.pos.copy(pos);
    c.vel.copy(vel);
    c.spin.set((rng() - 0.5) * spin, (rng() - 0.5) * spin, (rng() - 0.5) * spin);
    c.quat.setFromEuler(_eul.set(rng() * TAU, rng() * TAU, rng() * TAU));
    c.color.set(color);
    return i;
  }

  update(dt, gravity = 22) {
    if (dt <= 0) return;
    const step = Math.min(dt, 1 / 30);
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      const c = this.chips[i];
      if (!c.alive) continue;
      c.age += dt;
      if (c.age >= c.life) {
        c.alive = false;
        this.free.push(i);
        continue;
      }
      if (c.sleep < 1) {
        c.vel.y -= gravity * step;
        c.pos.addScaledVector(c.vel, step);
        // THE GROUND UNDER THE CHIP, not the ground under the burst.
        //
        // `c.floor` is captured once, at spawn, from one heightfield lookup per
        // burst — which is exactly right for the pooled particles, because a
        // shader cannot ask the terrain anything. A chip is a CPU body and can,
        // and it has to: it skitters, bounces and slides metres from where it
        // was thrown, and resting at the height the BURST happened at is a
        // faceted pebble hanging in mid-air over a dune, or standing on nothing
        // out over the canyon river. Measured over 60 hard landings per level
        // with the spawn floor frozen: mean |rest − ground| 0.09 m on the arena,
        // 0.45 m on the dunes, 2.60 m in the canyon, worst 30.2 m.
        //
        // Only AWAKE chips ask (a settled one already settled on the right
        // ground), and Terrain.height is a bilinear read, so the whole pool
        // costs less than the spark burst that threw it.
        const live = ground.heightAt(c.pos.x, c.pos.z);
        const floorY = live !== null ? live : (c.floor > -900 ? c.floor : -1e4);
        if (c.pos.y < floorY + c.scale * 0.5) {
          c.pos.y = floorY + c.scale * 0.5;
          if (c.vel.y < 0) c.vel.y = -c.vel.y * c.rest;
          // friction bleeds the slide off, and the tumble with it
          c.vel.x *= 0.72; c.vel.z *= 0.72;
          c.spin.multiplyScalar(0.62);
          if (c.vel.lengthSq() < 0.05) { c.sleep = 1; c.vel.set(0, 0, 0); c.spin.set(0, 0, 0); }
        }
        const s = c.spin.length();
        if (s > 1e-4) {
          _q2.setFromAxisAngle(_v3.copy(c.spin).multiplyScalar(1 / s), s * step);
          c.quat.premultiply(_q2).normalize();
        }
      }
      // shrink away over the last second rather than blinking out
      const k = clamp((c.life - c.age) / 0.8, 0, 1);
      _scl.setScalar(Math.max(1e-4, c.scale * k));
      _m.compose(c.pos, c.quat, _scl);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, c.color);
      // Newton's law of cooling is close enough, and a chip on the ground
      // sheds heat into it faster than one still in the air.
      this.aHeat.array[n] = c.heat > 0.002
        ? c.heat * Math.exp(-c.age / (c.cool * (c.sleep ? 0.55 : 1))) : 0;
      n++;
    }
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.aHeat.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    this.free.length = 0;
    for (let i = 0; i < this.max; i++) { this.chips[i].alive = false; this.free.push(i); }
    this.mesh.count = 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

const _eul = new THREE.Euler();

/* ══════════════════════════════════════════════════════════════════════ */
/*  Decals — the marks that stay                                          */
/* ══════════════════════════════════════════════════════════════════════ */

const DECAL_VERT = /* glsl */`
  precision highp float;
  #include <common>
  #include <fog_pars_vertex>
  attribute vec4 aPos;      // x, y, z, radius
  attribute vec4 aNrm;      // nx, ny, nz, spin
  attribute vec4 aParams;   // start time, life, heat, fade
  uniform float uTime;
  varying vec2 vUv;
  varying float vAge;
  varying float vHeat;
  varying float vFade;

  void main(){
    float t = uTime - aParams.x;
    if(aParams.y <= 0.0 || t < 0.0 || t > aParams.y){
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vUv = uv; vAge = 1.0; vHeat = 0.0; vFade = 0.0;
      #ifdef USE_FOG
        vFogDepth = 0.0;
      #endif
      return;
    }
    vAge = t;
    vHeat = aParams.z;
    // a fresh mark blooms open in a tenth of a second, then holds, then goes
    vFade = smoothstep(0.0, 0.09, t) * smoothstep(aParams.y, aParams.y * 0.62, t) * aParams.w;

    vec3 n = normalize(aNrm.xyz);
    vec3 ref = abs(n.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 side = normalize(cross(n, ref));
    vec3 up = cross(n, side);
    float cs = cos(aNrm.w), sn = sin(aNrm.w);
    vec3 r = side * cs + up * sn;
    vec3 u = side * -sn + up * cs;

    float grow = mix(0.55, 1.0, smoothstep(0.0, 0.14, t));
    vec3 p = aPos.xyz + n * 0.02
           + r * (position.x * aPos.w * 2.0 * grow)
           + u * (position.y * aPos.w * 2.0 * grow);
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const DECAL_FRAG = /* glsl */`
  precision highp float;
  #include <common>
  #include <fog_pars_fragment>
  uniform sampler2D uMap;
  uniform vec3 uChar;
  varying vec2 vUv;
  varying float vAge;
  varying float vHeat;
  varying float vFade;
  void main(){
    float a = texture2D(uMap, vUv).a * vFade;
    if(a < 0.004) discard;
    // Molten cools. The centre goes white-hot, then orange, then to char, and
    // it does it from the rim inward the way real slag does.
    float cool = exp(-vAge * 0.85) * vHeat;
    float rim = 1.0 - smoothstep(0.0, 0.62, length(vUv - 0.5) * 2.0);
    vec3 hot = mix(vec3(1.6, 0.42, 0.06), vec3(2.4, 1.5, 0.55), clamp(cool * 1.4 - 0.5, 0.0, 1.0));
    vec3 col = mix(uChar, hot, clamp(cool * rim * 1.6, 0.0, 1.0));
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }
`;

/** How far a ground mark's worst corner may stand off the ground it marks. */
export const DECAL_GROUND_TOL = 0.05;
/** Below this half-width a mark is a smudge and shrinking it further buys nothing. */
const DECAL_MIN_R = 0.10;
/** The eight bearings a corner can point along, whatever the mark's spin is. */
const _RING = [[1, 0], [0, 1], [-1, 0], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071], [0.7071, -0.7071]];
const _RING_H = new Float64Array(8);
const _fit = { x: 0, y: 0, z: 0, r: 0, nx: 0, ny: 1, nz: 0, standoff: 0, shrunk: 1 };

/**
 * Sit a ground mark ON the ground.
 *
 * A decal is ONE FLAT QUAD. Laid down at the height of the foot that made it,
 * with a fixed straight-up normal and a half-width of up to 1.6 m, its corners
 * stand off whatever the ground is actually doing — which is the pale plate
 * lying across a dune crest in the arena and the translucent grey
 * quadrilateral hanging off a boulder out over the canyon river. It is the
 * same bug as the chip that rests at the height of the burst, in the same
 * file: a flat thing pinned to a height sampled somewhere else.
 *
 * Three steps, cheapest first, because each one only exists to make the next
 * one smaller:
 *
 *   · the CENTRE goes to the mean of the ring of samples, so the quad
 *     straddles the slope instead of perching on its high side;
 *   · the NORMAL becomes the fitted plane's, from central differences across
 *     the mark's own footprint, so it lies ALONG the slope rather than
 *     across it;
 *   · the HALF-WIDTH shrinks until the worst remaining corner is inside
 *     DECAL_GROUND_TOL. A plane cannot follow a crest, and a plane the size of
 *     the crest is precisely the thing that ends up hanging in the air.
 *
 * Only for marks that claim to be ON the terrain: a normal more than ~40° off
 * vertical is a scorch on a wall or a droid, and a mark whose height is not
 * within a metre of the terrain is on a prop. Both are left exactly alone —
 * the terrain is not the surface they are stuck to and fitting them to it
 * would be a new lie in place of the old one.
 *
 * Returns a shared record; read it before the next call.
 */
export function conformToGround(pos, normal, radius) {
  _fit.x = pos.x; _fit.y = pos.y; _fit.z = pos.z; _fit.r = radius;
  _fit.nx = normal ? normal.x : 0;
  _fit.ny = normal ? normal.y : 1;
  _fit.nz = normal ? normal.z : 0;
  _fit.standoff = 0; _fit.shrunk = 1;

  const nl = Math.hypot(_fit.nx, _fit.ny, _fit.nz) || 1;
  if (_fit.ny / nl < 0.76) return _fit;                 // a wall, not a floor
  const h0 = ground.heightAt(pos.x, pos.z);
  if (h0 === null || Math.abs(pos.y - h0) > 1.0) return _fit;   // no terrain, or on a prop

  const lift = pos.y - h0;      // whatever clearance the caller asked for, kept
  let r = radius;
  for (let pass = 0; pass < 4; pass++) {
    // The quad is inscribed in a disc of radius r√2, so the corners are sampled
    // at r√2 and not at r — sampling the edge midpoints would fit a plane that
    // the corners then poke straight through.
    const R = r * Math.SQRT2;
    let sum = 0, dx = 0, dz = 0;
    for (let k = 0; k < 8; k++) {
      const h = ground.heightAt(pos.x + _RING[k][0] * R, pos.z + _RING[k][1] * R);
      _RING_H[k] = h === null ? h0 : h;
      sum += _RING_H[k];
      dx += _RING_H[k] * _RING[k][0];
      dz += _RING_H[k] * _RING[k][1];
    }
    // Least squares over the ring, which for these eight bearings is just the
    // projection over Σx² = Σz² = 4 — the ±x pair and the four diagonals each
    // carry x, with exactly the same weighting in the other axis.
    const gx = dx / (4 * R), gz = dz / (4 * R);
    const mean = sum / 8;
    let worst = 0;
    for (let k = 0; k < 8; k++) {
      const plane = mean + (gx * _RING[k][0] + gz * _RING[k][1]) * R;
      const e = Math.abs(_RING_H[k] - plane);
      if (e > worst) worst = e;
    }
    _fit.y = mean + lift;
    _fit.nx = -gx; _fit.ny = 1; _fit.nz = -gz;
    _fit.standoff = worst;
    _fit.r = r;
    if (worst <= DECAL_GROUND_TOL || r <= DECAL_MIN_R) break;
    // Relief across a patch grows roughly linearly with its width, so aiming
    // straight at the tolerance converges in one or two passes instead of
    // halving blindly down to the floor and throwing the mark away.
    r = Math.max(DECAL_MIN_R, r * Math.max(0.35, DECAL_GROUND_TOL / worst));
  }
  _fit.shrunk = _fit.r / radius;
  return _fit;
}

export class DecalField {
  constructor(scene, opts = {}) {
    this.max = Math.max(8, Math.floor(opts.max ?? 96));
    this.head = 0;
    this.time = 0;

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    geo.instanceCount = this.max;

    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4);
    this.aNrm = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4);
    for (const a of [this.aPos, this.aNrm, this.aParams]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aNrm', this.aNrm);
    geo.setAttribute('aParams', this.aParams);

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]);
    Object.assign(uniforms, {
      uTime: { value: 0 },
      uMap: { value: scorchSprite(128) },
      uChar: { value: new THREE.Color(opts.char ?? 0x14100c) },
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG,
      transparent: true, depthWrite: false, depthTest: true, fog: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this._dirty = false;
  }

  /**
   * @param {THREE.Vector3} pos     where it lands
   * @param {THREE.Vector3} normal  surface normal (defaults to straight up)
   */
  add(pos, normal, radius = 0.5, { life = 16, heat = 0, alpha = 1 } = {}) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const i4 = i * 4;
    const fit = conformToGround(pos, normal, Math.max(0.03, radius));
    this.aPos.array[i4] = fit.x; this.aPos.array[i4 + 1] = fit.y;
    this.aPos.array[i4 + 2] = fit.z; this.aPos.array[i4 + 3] = fit.r;
    const nl = Math.hypot(fit.nx, fit.ny, fit.nz) || 1;
    this.aNrm.array[i4] = fit.nx / nl; this.aNrm.array[i4 + 1] = fit.ny / nl;
    this.aNrm.array[i4 + 2] = fit.nz / nl; this.aNrm.array[i4 + 3] = rng() * TAU;
    this.aParams.array[i4] = this.time;
    this.aParams.array[i4 + 1] = life;
    this.aParams.array[i4 + 2] = heat;
    this.aParams.array[i4 + 3] = alpha;
    this._dirty = true;
    return i;
  }

  update(dt) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (this._dirty) {
      this.aPos.needsUpdate = true; this.aNrm.needsUpdate = true; this.aParams.needsUpdate = true;
      this._dirty = false;
    }
  }

  dispose() {
    this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Manager — named emitters used across the game                         */
/* ══════════════════════════════════════════════════════════════════════ */

export class Particles {
  /**
   * @param {number} scale        the `particleScale` setting, 0..1.5
   * @param {object} [opts]       opts.terrain lets chips and decals find the
   *                              ground; without one they settle where they
   *                              were thrown, which is close enough for the
   *                              impacts that produce them.
   */
  constructor(scene, scale = 1, opts = {}) {
    this.scale = scale;
    if (opts.terrain) ground.terrain = opts.terrain;
    const s = (n) => Math.max(120, Math.floor(n * scale));
    const spark = sparkSprite(64);
    const smoke = smokeSprite(128);
    const soft = radialSprite(128, '#ffffff', 'rgba(255,255,255,0)', 2.4);

    // windK is how completely the air owns each pool: 1 means it ends up
    // travelling with the wind, 0 means it is too heavy to care.
    //
    // stretch/thin are what make a spark a spark: at 12 m/s a spark here is
    // 3.6 cm long and 5 mm across. The old numbers gave a 5 cm blob stretched
    // to 7, which is what put glowing peas all over every impact.
    this.sparks = new ParticlePool(scene, { max: s(4200), map: spark, additive: true,
      stretch: 0.17, stretchMax: 14, thin: 0.9,
      colorEnd: 0xff3000, colorShift: 0.95, fadeIn: 0.015, renderOrder: 12,
      bounce: 5.5, windK: 0.05 });
    this.embers = new ParticlePool(scene, { max: s(1400), map: soft, additive: true,
      colorEnd: 0x882200, colorShift: 1.0, grow: -0.4, renderOrder: 12,
      windK: 0.95, curl: 0.5 });
    this.plasma = new ParticlePool(scene, { max: s(1800), map: soft, additive: true, grow: 1.6,
      colorShift: 0.6, renderOrder: 12 });
    this.smoke = new ParticlePool(scene, { max: s(1600), map: smoke, additive: false, grow: 2.6,
      spin: 1, colorEnd: 0x2a2a2e, colorShift: 0.8, fadeIn: 0.12, renderOrder: 9,
      windK: 1.0, curl: 0.55, lit: true, wrap: 0.55 });
    this.dust = new ParticlePool(scene, { max: s(5200), map: smoke, additive: false, grow: 2.0,
      spin: 0.6, colorEnd: 0xa08050, colorShift: 0.35, fadeIn: 0.08, renderOrder: 8,
      windK: 0.7, curl: 0.35, lit: true, wrap: 0.7 });
    this.grit = new ParticlePool(scene, { max: s(3600), map: soft, additive: false, grow: -0.2,
      renderOrder: 8, bounce: 4.0, windK: 0.12, lit: true, wrap: 0.35 });
    this.water = new ParticlePool(scene, { max: s(2000), map: soft, additive: false, grow: 0.4,
      colorEnd: 0x9fd8ff, colorShift: 0.5, renderOrder: 9, bounce: 3.2, windK: 0.1,
      lit: true, wrap: 0.3 });
    this.pools = [this.sparks, this.embers, this.plasma, this.smoke, this.dust, this.grit, this.water];

    this.chips = new ChipField(scene, { max: Math.max(48, Math.floor(260 * scale)) });
    this.decals = new DecalField(scene, { max: Math.max(24, Math.floor(110 * scale)) });

    // Recent footfalls, used to infer which way each runner is going. It has to
    // be a small set rather than one entry: the player and three droids are all
    // putting feet down, and a single "last step" turns two bodies two metres
    // apart into one impossibly fast runner.
    this._steps = Array.from({ length: 8 }, () => ({ x: 0, z: 0, t: -99 }));
    this._stepHead = 0;
    this._clock = 0;
    this._keyTimer = 99;
    this.scene = scene;
    ground.fx = this;
    this._syncKey();
  }

  /**
   * Find the level's key light and hand it to the pools that are lit by it.
   *
   * The lights are dug out of the scene rather than injected, for the same
   * reason Scenery does it: nothing that constructs a Particles knows about
   * the lighting rig, and a level can re-light itself at any time. Both tints
   * are normalised to unit mean, and setKey splits the levels about each
   * pool's own mean, so the shading can only ever add form — it can never
   * change how bright the smoke in a level is, which is the one thing a
   * change here must not do silently.
   */
  _syncKey() {
    let sun = null, hemi = null;
    for (const c of this.scene.children) {
      if (c.isDirectionalLight && (!sun || (c.castShadow && !sun.castShadow))) sun = c;
      else if (c.isHemisphereLight && !hemi) hemi = c;
    }
    const unit = (col, out) => {
      out.set(col ? col.r : 1, col ? col.g : 1, col ? col.b : 1);
      const m = (out.x + out.y + out.z) / 3;
      return m > 1e-4 ? out.multiplyScalar(1 / m) : out.set(1, 1, 1);
    };
    if (sun) {
      _dir.copy(sun.position);
      if (sun.target) _dir.sub(sun.target.position);
      if (_dir.lengthSq() < 1e-8) _dir.set(0.4, 0.9, 0.3);
      _dir.normalize();
    } else _dir.set(0.4, 0.82, 0.4).normalize();
    unit(sun && sun.color, _shadeA);
    unit(hemi && hemi.color, _shadeB);
    for (const p of this.pools) p.setKey(_dir, _shadeA, _shadeB);
  }

  update(dt) {
    this._clock += dt;
    // The rig can be re-hung at any moment (a level change, a night section),
    // and scanning a scene's top level twice a second costs nothing.
    this._keyTimer += dt;
    if (this._keyTimer > 0.5) { this._keyTimer = 0; this._syncKey(); }
    for (const p of this.pools) p.update(dt);
    this.chips.update(dt);
    this.decals.update(dt);
  }

  /**
   * Which way whoever just put a foot down here is travelling.
   *
   * Nothing that calls sandPuff passes a direction, but consecutive footfalls a
   * stride apart and a fraction of a second apart ARE the direction of travel.
   * Matching by proximity keeps four bodies on a field from being read as one.
   * Returns null when this is the first step of a run, or a jump, or a
   * teleport, all of which should throw dust straight up.
   */
  _stride(x, z, out) {
    let best = -1, bestD = 3.2 * 3.2;
    for (let i = 0; i < this._steps.length; i++) {
      const s = this._steps[i];
      if (this._clock - s.t > 0.75) continue;
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bestD && d > 0.18 * 0.18) { bestD = d; best = i; }
    }
    let slot = best;
    if (slot < 0) { slot = this._stepHead; this._stepHead = (this._stepHead + 1) % this._steps.length; }
    else {
      const s = this._steps[slot];
      const d = Math.sqrt(bestD);
      out.dirX = (x - s.x) / d;
      out.dirZ = (z - s.z) / d;
      out.stride = clamp(d / 1.4, 0, 1.4);
    }
    const s = this._steps[slot];
    s.x = x; s.z = z; s.t = this._clock;
    return best >= 0;
  }

  /** Pool occupancy, for the HUD and for the tests. */
  stats() {
    return {
      pools: this.pools.reduce((a, p) => a + p.max, 0),
      chips: this.chips.liveCount,
      chipMax: this.chips.max,
      decals: this.decals.max,
    };
  }

  /* ── recipes ───────────────────────────────────────────────────────── */

  /**
   * A shower of incandescent particles.
   *
   * Three populations, because one never reads as sparks: a dense spray of
   * fast hairline streaks, a few heavy ones that outlive the rest and skitter
   * on the ground, and slow embers that float off the top. All of them are
   * authored ABOVE 1.0 so the bloom pass sees them — an impact has to put
   * light into the frame, not decals.
   */
  sparkBurst(pos, normal, count = 18, opts = {}) {
    const n = Math.max(2, Math.round(count * 1.7 * this.scale));
    const speed = opts.speed ?? 9;
    const color = opts.color ?? 0xffd9a0;
    const hdr = opts.hdr ?? 3.4;
    // One heightfield lookup per burst, not per spark. Without it every spark
    // in the game falls through the world instead of skittering along it.
    const floor = opts.floor ?? (ground.heightAt(pos.x, pos.z) ?? -999);
    // What was struck, if the caller knows; the ground it was struck over if
    // not. Every second spark carries it, so a strike on red canyon rock and a
    // strike on grey plate throw visibly different showers.
    const surf = opts.surface ?? (floor > -900 && Math.abs(pos.y - floor) < 1.2
      ? surfaceTint(pos.x, pos.z) : null);
    const surfHot = surf !== null ? incandescent(surf, 0.5) : color;
    for (let i = 0; i < n; i++) {
      _v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      if (normal) _v.lerp(normal, 0.45).normalize();
      // A cubed roll: most sparks are ordinary, a few are the ones that carry
      // right across the frame. An even spread reads as a puff, not a strike.
      const r = rng();
      _v.multiplyScalar(speed * (0.3 + r * r * r * 2.6));
      this.sparks.spawn(pos, _v, {
        life: 0.3 + rng() * 0.5 + r * 0.5, size: 0.008 + rng() * 0.013,
        drag: 1.5, gravity: 15, color: i % 2 ? surfHot : color, alpha: 1, hdr, floor,
      });
    }
    // The flash. An impact is an event with a moment of light in it, not a
    // shower of dots: without this a deflection, a grind and a clash all put
    // sparks into the frame and nothing at all into the exposure. Kept to a
    // twentieth of a second and to real strikes only (a three-spark decorative
    // tick does not get one) so a continuous grind flickers rather than glares.
    if (opts.flash !== false && count >= 6) {
      this.plasma.spawn(pos, _v2.set(0, 0, 0), {
        life: 0.05, size: 0.10 + Math.min(count, 40) * 0.004, drag: 1, gravity: 0,
        color: 0xfff2dc, alpha: 1, hdr: 4.2,
      });
    }
    if (opts.embers !== false) {
      for (let i = 0; i < n * 0.22; i++) {
        _v.set(rng() * 2 - 1, rng() * 1.4, rng() * 2 - 1).normalize().multiplyScalar(speed * 0.35 * rng());
        this.embers.spawn(pos, _v, { life: 0.9 + rng(), size: 0.022 + rng() * 0.03, drag: 2.4,
          gravity: -1.2, color: 0xff9040, alpha: 0.9, hdr: 2.2, floor: -999 });
      }
    }
  }

  /**
   * Molten spatter: heavy, slow, long-lived droplets that arc, hit the deck
   * and cool there. Sparks alone are all one speed and one lifetime; this is
   * what makes a cut through metal look like it went through metal.
   */
  spatter(pos, dir, count = 5, color = 0xffb050, opts = {}) {
    const n = Math.max(1, Math.round(count * this.scale));
    const floor = opts.floor ?? (ground.heightAt(pos.x, pos.z) ?? -999);
    for (let i = 0; i < n; i++) {
      _v.set(rng() * 2 - 1, rng() * 0.9 + 0.35, rng() * 2 - 1).normalize()
        .multiplyScalar((opts.speed ?? 3.2) * (0.4 + rng()));
      if (dir) _v.addScaledVector(dir, (opts.speed ?? 3.2) * 0.5 * rng());
      this.sparks.spawn(pos, _v, {
        life: 1.1 + rng() * 1.0, size: 0.020 + rng() * 0.022,
        drag: 0.55, gravity: 20, color, alpha: 1, hdr: opts.hdr ?? 2.4, floor,
      });
    }
  }

  /** The cauterised flare when a blade parts something. */
  cutFlare(pos, dir, color = 0x57c9ff, count = 26, opts = {}) {
    const n = Math.max(3, Math.round(count * 1.6 * this.scale));
    const gh = ground.heightAt(pos.x, pos.z);
    const floor = gh ?? -999;
    // The material that was parted. Callers that know pass it; the rest get
    // the ground they are standing on, which is right for the overwhelming
    // majority of cuts and wrong in a way nobody can see for the others.
    const surf = opts.surface ?? (gh !== null && pos.y - gh < 1.6
      ? surfaceTint(pos.x, pos.z) : null);
    const surfHot = surf !== null ? incandescent(surf, 0.42) : 0xfff0c0;
    // A spark carrying the blade's own hue has to cross the bloom threshold
    // like every other spark, and a cerulean crystal carries 7% of its
    // luminance in blue: at the flat hdr of 4.2 this used to use, that spark
    // measured 1.50 against a threshold of 1.8. The one spark in three whose
    // whole job is to say "a lightsaber did this" was the only one in the
    // burst that did not glow. So solve for the amplitude instead of picking
    // it, and let a dim crystal pay for its own dimness.
    _col.set(color);
    const bladeHdr = clamp(2.8 / Math.max(0.10,
      _col.r * 0.2126 + _col.g * 0.7152 + _col.b * 0.0722), 3, 10);
    for (let i = 0; i < n; i++) {
      _v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const r = rng();
      _v.multiplyScalar(1.6 + r * r * 11);
      if (dir) _v.addScaledVector(dir, 3 * rng());
      // Every third spark carries the BLADE's colour, not the metal's: what
      // comes off a saber cut is partly the blade itself. Of the rest, half
      // are white-hot and half still remember what they were made of.
      this.sparks.spawn(pos, _v, { life: 0.26 + rng() * 0.5, size: 0.008 + rng() * 0.012,
        drag: 2.0, gravity: 14,
        color: i % 3 === 0 ? color : (i % 3 === 1 ? 0xfff0c0 : surfHot),
        alpha: 1, hdr: i % 3 === 0 ? bladeHdr : 3.6, floor });
    }
    this.spatter(pos, dir, Math.round(n * 0.16),
      surf !== null ? incandescent(surf, 0.30) : 0xffc070, { speed: 2.6, floor, hdr: 3.0 });
    for (let i = 0; i < n * 0.22; i++) {
      _v.set(rng() * 2 - 1, rng() * 1.5 + 0.3, rng() * 2 - 1).normalize().multiplyScalar(0.7 + rng());
      this.smoke.spawn(pos, _v, { life: 1.4 + rng() * 1.2, size: 0.12 + rng() * 0.12,
        drag: 1.4, gravity: -0.5, color: 0x6a6f76, alpha: 0.40 });
    }
    // The flash. Three lobes now: a pinpoint that is over in a thirtieth of a
    // second and is the thing that actually lands on the exposure, the
    // white-hot ball behind it, and a wide one in the blade's colour. The
    // pinpoint exists because the contact is the brightest instant in the
    // shot and a 90 ms lobe reads as a lamp being switched on, not as a strike.
    this.plasma.spawn(pos, _v2.set(0, 0, 0), { life: 0.035, size: 0.14, drag: 1, gravity: 0,
      color: 0xffffff, alpha: 1, hdr: 9.0 });
    this.plasma.spawn(pos, _v2.set(0, 0, 0), { life: 0.09, size: 0.32, drag: 1, gravity: 0,
      color: 0xfff4e0, alpha: 1, hdr: 5.5 });
    this.plasma.spawn(pos, _v2.set(0, 0, 0), { life: 0.22, size: 0.66, drag: 1, gravity: 0,
      color, alpha: 0.9, hdr: 2.8 });

    // The mark. A blade parts things by BURNING through them, so a cut that
    // happened against a surface has to leave one — cutFlare was the only
    // impact recipe in the file that left nothing behind, which is why saber
    // work on the ground read as sparks over undisturbed sand.
    if (opts.scorch !== false) {
      const nrm = opts.normal ?? (gh !== null && pos.y - gh < 0.45 ? UP : null);
      if (nrm) {
        const at = nrm === UP ? _v3.set(pos.x, gh + 0.02, pos.z) : pos;
        this.scorch(at, nrm, 0.10 + rng() * 0.10 + count * 0.002,
          { heat: 1, life: 15, alpha: 0.85 });
      }
    }

    // a blade parting something a hand's width off the deck takes the cover
    // with it — this is the only place the world hears about most saber swings
    if (opts.cover !== false && gh !== null && pos.y - gh < 1.1) {
      ground.disturb(pos.x, pos.z, 0.55, { cut: 0.85, press: 0.7 });
      this.grassClippings(pos, pos, opts.coverColor ?? 0x7d8c4a, 0.5);
    }
  }

  boltImpact(pos, normal, color = 0xff3a2a, opts = {}) {
    this.sparkBurst(pos, normal, 10, { speed: 7, color: 0xffe0b0 });
    this.plasma.spawn(pos, _v.set(0, 0, 0), { life: 0.07, size: 0.26, drag: 1, gravity: 0,
      color: 0xfff0dc, alpha: 1, hdr: 5.0 });
    this.plasma.spawn(pos, _v.set(0, 0, 0), { life: 0.17, size: 0.62, drag: 1, gravity: 0,
      color, alpha: 1, hdr: 2.4 });
    for (let i = 0; i < 5 * this.scale; i++) {
      _v.copy(normal).multiplyScalar(1.2 + rng()).add(_v2.set(rng() - 0.5, rng() * 0.6, rng() - 0.5));
      this.smoke.spawn(pos, _v, { life: 0.8 + rng() * 0.6, size: 0.1, drag: 2, gravity: -0.6,
        color: 0x7a7a82, alpha: 0.30 });
    }
    // Only scar things that will still be there in ten seconds. A mark left on
    // a droid that then walks away is a mark hanging in mid-air. A steeply
    // up-facing normal means the bolt found a floor, not a chest.
    const gh = ground.heightAt(pos.x, pos.z);
    const grounded = gh !== null ? Math.abs(pos.y - gh) < 0.4 : (normal && normal.y > 0.62);
    if (opts.surface === true || grounded) {
      this.scorch(pos, normal, 0.16 + rng() * 0.1, { heat: 0.8, life: 11 });
      // and the ground keeps the burn after the decal has faded: a deflected
      // bolt is the other way a lit blade marks the floor.
      if (grounded) ground.burn(pos.x, pos.z, 0.26, 0.85);
    }
  }

  /** A lasting mark: scorch, scuff, skid. `heat` makes it start molten. */
  scorch(pos, normal, radius = 0.4, opts = {}) {
    this.decals.add(pos, normal, radius, {
      life: opts.life ?? 16, heat: opts.heat ?? 0, alpha: opts.alpha ?? 1,
    });
  }

  /**
   * Sand thrown up by a footfall, a landing, or a body hitting the dune.
   * Dust leaving from under the ball of the foot goes BACKWARDS along the
   * direction of travel, which `_stride` recovers from the footfalls.
   */
  sandPuff(pos, power = 1, groundY = null, color = 0xd8c09a, opts = {}) {
    const n = Math.max(2, Math.round(10 * power * this.scale));
    const floor = groundY ?? pos.y;

    _gait.dirX = 0; _gait.dirZ = 0; _gait.stride = 0;
    if (opts.dir) {
      const m = Math.hypot(opts.dir.x, opts.dir.z) || 1;
      _gait.dirX = opts.dir.x / m;
      _gait.dirZ = opts.dir.z / m;
      _gait.stride = 1;
      this._stride(pos.x, pos.z, _gaitSpare);   // still record where the foot fell
    } else {
      this._stride(pos.x, pos.z, _gait);
    }
    const dirX = _gait.dirX, dirZ = _gait.dirZ, stride = _gait.stride;

    const kick = stride * clamp(power * 1.6, 0.2, 2.2);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, r = rng();
      _v.set(Math.cos(a) * r, rng() * 0.55 + 0.15, Math.sin(a) * r).multiplyScalar(1.4 + power * 2.4 * rng());
      // dust is thrown BEHIND a runner, not around them
      _v.x -= dirX * kick * (1 + rng()); _v.z -= dirZ * kick * (1 + rng());
      this.dust.spawn(pos, _v, { life: 0.9 + rng() * 1.5, size: 0.18 + rng() * 0.3 * power,
        drag: 2.6, gravity: 1.1, color, alpha: 0.16 + 0.12 * rng(), floor });
    }
    for (let i = 0; i < n * 0.8; i++) {
      const a = rng() * TAU;
      _v.set(Math.cos(a), rng() * 1.6 + 0.4, Math.sin(a)).multiplyScalar(2 + power * 4 * rng());
      _v.x -= dirX * kick * 2.4 * rng(); _v.z -= dirZ * kick * 2.4 * rng();
      this.grit.spawn(pos, _v, { life: 0.6 + rng() * 0.8, size: 0.02 + rng() * 0.03,
        drag: 0.9, gravity: 15, color, alpha: 0.75, floor });
    }

    // the cover gets walked through, and hard arrivals flatten a wide patch
    ground.disturb(pos.x, pos.z, 0.45 + power * 0.55, {
      press: clamp(0.45 + power * 0.4, 0, 1), dirX, dirZ,
    });

    /* AND THE GROUND ITSELF KEEPS IT.
     *
     * This one line is the whole of "the player and every enemy leave
     * footprints", and it needed no new call site anywhere: `sandPuff` is
     * already what Player._footstep and Enemy's animator.onFootstep call on
     * every planted foot, with the position, the power and — through
     * `_stride` — the direction of travel already recovered. The cover trail
     * above presses the GRASS; this presses the ground under it, which is the
     * half that was missing on every level that has no grass, i.e. every level
     * this was asked for.
     *
     * Depth rides `power`, which is `clamp(speed * 0.09, 0.12, 0.5)` for a
     * walking step and 1.9× the impact speed for a landing, so a sprint digs
     * in and a stroll does not. `Terrain.tread` then caps it by how much
     * material is lying at the point, so the same step is a hole in a drift
     * and a scuff on a scoured rib.
     */
    ground.tread(pos.x, pos.z, 0.17 + power * 0.10, 0.10 + power * 0.26, dirX, dirZ,
      { stretch: stride * clamp(power * 1.2, 0, 1.1) });

    if (power >= 1.05) this.landingRing(pos, power, floor, color);
    else if (power >= 0.5) {
      this.decals.add(_v3.set(pos.x, floor + 0.01, pos.z), UP, 0.22 + power * 0.3,
        { life: 9, heat: 0, alpha: 0.32 });
    }
  }

  /**
   * A hard landing: the ring of displaced ground going outward, a few real
   * chips of it thrown, and a scuff where the impact was.
   */
  landingRing(pos, power = 1.4, groundY = null, color = 0xd8c09a) {
    const floor = groundY ?? pos.y;
    const ring = Math.max(6, Math.round(16 * power * this.scale));
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * TAU + rng() * 0.3;
      const sp = (2.6 + rng() * 3.4) * power;
      _v.set(Math.cos(a) * sp, 0.5 + rng() * 0.8, Math.sin(a) * sp);
      _v2.set(pos.x + Math.cos(a) * 0.3, floor + 0.06, pos.z + Math.sin(a) * 0.3);
      this.dust.spawn(_v2, _v, { life: 1.1 + rng() * 0.9, size: 0.3 + 0.35 * power,
        drag: 2.3, gravity: 0.7, color, alpha: 0.20 + 0.1 * rng(), floor });
    }
    for (let i = 0; i < Math.round(7 * power * this.scale); i++) {
      const a = rng() * TAU, sp = (2.5 + rng() * 5) * power;
      _v.set(Math.cos(a) * sp, 3 + rng() * 5 * power, Math.sin(a) * sp);
      _v2.set(pos.x, floor + 0.1, pos.z);
      this.chips.spawn(_v2, _v, {
        life: 5 + rng() * 4, size: 0.035 + rng() * 0.055 * power,
        color: _col.set(color).multiplyScalar(0.72 + rng() * 0.4).getHex(),
        floor, restitution: 0.28,
      });
    }
    this.decals.add(_v3.set(pos.x, floor + 0.012, pos.z), UP, 0.55 + power * 0.75,
      { life: 14, heat: 0, alpha: 0.42 });
    ground.disturb(pos.x, pos.z, 1.1 + power * 0.9, { press: 1 });
    // A hard arrival craters the loose layer well outside the boot that made
    // it, with a real berm — that is what the ring of dust is dust OFF.
    ground.tread(pos.x, pos.z, 0.42 + power * 0.55, 0.16 + power * 0.30, 0, 0, { rim: 0.55 });
  }

  /** A skid: a smear of dust and grit dragged along the ground, plus its mark. */
  slide(pos, dir, power = 1, groundY = null, color = 0xd8c09a) {
    const floor = groundY ?? pos.y;
    const d = _v3.copy(dir).setY(0);
    const dl = d.length();
    if (dl > 1e-4) d.multiplyScalar(1 / dl); else d.set(0, 0, 1);
    const n = Math.max(2, Math.round(6 * power * this.scale));
    for (let i = 0; i < n; i++) {
      _v.copy(d).multiplyScalar(-(1.2 + rng() * 2.4) * power);
      _v.x += (rng() - 0.5) * 1.4; _v.z += (rng() - 0.5) * 1.4;
      _v.y = 0.4 + rng() * 1.1;
      this.dust.spawn(pos, _v, { life: 0.8 + rng() * 0.9, size: 0.18 + 0.22 * power,
        drag: 2.8, gravity: 0.9, color, alpha: 0.14 + 0.1 * rng(), floor });
    }
    for (let i = 0; i < n; i++) {
      _v.copy(d).multiplyScalar(-(2 + rng() * 5) * power);
      _v.y = 1.4 + rng() * 2.6;
      _v.x += (rng() - 0.5) * 2; _v.z += (rng() - 0.5) * 2;
      this.grit.spawn(pos, _v, { life: 0.5 + rng() * 0.6, size: 0.018 + rng() * 0.026,
        drag: 1.0, gravity: 16, color, alpha: 0.7, floor });
    }
    this.decals.add(_v2.set(pos.x, floor + 0.01, pos.z), UP, 0.20 + power * 0.28,
      { life: 11, heat: 0, alpha: 0.34 });
    ground.disturb(pos.x, pos.z, 0.5 + power * 0.4, {
      press: clamp(0.6 + power * 0.3, 0, 1), dirX: d.x, dirZ: d.z,
    });
    // A skid is a footfall smeared along its own direction: same bowl, drawn
    // out, with the berm piled at the back of it.
    ground.tread(pos.x, pos.z, 0.20 + power * 0.16, 0.09 + power * 0.20, d.x, d.z,
      { stretch: 1.1 + power * 0.9, rim: 0.5 });
  }

  /**
   * A blade dragged through the ground. Sand does not spark — it fuses, so this
   * is molten glass spitting out of a line that glows and then cools to a scar.
   */
  bladeScar(a, b, color = 0xffb040, opts = {}) {
    /* THE GROUND TAKES THE CUT, not just the decal field.
     *
     * This emitter shipped with no caller anywhere in src/ — the saber's
     * contact solver only ever tests enemies, props and doors, so a blade
     * dragged through the dune did nothing at all. Reaching it is
     * `ground.scar(a, b)`, which is what the one hook this needs should call;
     * everything downstream of that hook is here and is live.
     *
     * `ground.scar` calls the terrain side first and this second, so guard
     * against doing the trench twice when it is the caller.
     */
    if (opts.trench !== false) ground.terrain?.scar?.(a, b, opts);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 0.001;
    const steps = Math.min(10, Math.max(1, Math.round(len / 0.32)));
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      _v2.set(a.x + dx * t, a.y + dy * t, a.z + dz * t);
      const floor = ground.heightAt(_v2.x, _v2.z);
      if (floor !== null) _v2.y = floor + 0.02;
      // 9-16 cm, not 16-28: a stroke is ten of these laid end to end, and at
      // the old radius a two-metre cut came out as a half-metre-wide molten
      // snake lying on the snow. A saber kerf is a hand's width.
      this.decals.add(_v2, UP, 0.09 + rng() * 0.07, { life: 18, heat: 1, alpha: 0.9 });
      for (let i = 0; i < Math.max(2, Math.round(5 * this.scale)); i++) {
        _v.set((rng() - 0.5) * 3.5, 1.5 + rng() * 5.0, (rng() - 0.5) * 3.5);
        this.sparks.spawn(_v2, _v, { life: 0.5 + rng() * 0.7, size: 0.009 + rng() * 0.014,
          drag: 1.1, gravity: 18, color, alpha: 1, hdr: 3.2, floor: _v2.y });
      }
      // fused sand is glass, and glass runs before it sets
      if (rng() < 0.5) this.spatter(_v2, null, 1, 0xffcf90, { speed: 2.2, floor: _v2.y });
      if (rng() < 0.6) {
        _v.set((rng() - 0.5) * 0.8, 0.9 + rng() * 0.8, (rng() - 0.5) * 0.8);
        this.smoke.spawn(_v2, _v, { life: 1.3 + rng(), size: 0.1 + rng() * 0.1,
          drag: 1.7, gravity: -0.7, color: 0x6e6b62, alpha: 0.30 });
      }
    }
    if (opts.cover !== false) ground.grass?.cut(a, b, 0.35, { clippings: false });
  }

  /** Grass and leaf litter thrown by a cut. Cheap, short-lived, green. */
  grassClippings(a, b, color = 0x7d8c4a, amount = 1) {
    const n = Math.max(1, Math.round(10 * amount * this.scale));
    const dx = (b.x - a.x), dz = (b.z - a.z);
    const len = Math.hypot(dx, dz) || 1;
    for (let i = 0; i < n; i++) {
      const t = rng();
      _v2.set(a.x + dx * t, (a.y + (b.y - a.y) * t) + 0.1, a.z + dz * t);
      _v.set(dx / len * (1.4 + rng() * 3), 1.4 + rng() * 2.6, dz / len * (1.4 + rng() * 3));
      _v.x += (rng() - 0.5) * 2.2; _v.z += (rng() - 0.5) * 2.2;
      this.grit.spawn(_v2, _v, {
        life: 1.0 + rng() * 1.2, size: 0.022 + rng() * 0.03, drag: 2.6, gravity: 7,
        color: _col.set(color).multiplyScalar(0.7 + rng() * 0.6).getHex(),
        alpha: 0.9, floor: _v2.y - 0.1,
      });
    }
  }

  /** Chips of whatever just broke: real bodies, not billboards. */
  chipBurst(pos, dir, count = 8, opts = {}) {
    const n = Math.max(1, Math.round(count * this.scale));
    // With no terrain published, the height it was thrown from is the best
    // guess at where it lands — much better than letting it fall forever.
    const floor = opts.floor ?? (ground.heightAt(pos.x, pos.z) ?? pos.y);
    for (let i = 0; i < n; i++) {
      _v.set(rng() * 2 - 1, rng() * 1.6 + 0.2, rng() * 2 - 1).normalize()
        .multiplyScalar((opts.speed ?? 5) * (0.4 + rng()));
      if (dir) _v.addScaledVector(dir, (opts.speed ?? 5) * 0.5 * rng());
      this.chips.spawn(pos, _v, {
        life: opts.life ?? (4 + rng() * 5),
        size: (opts.size ?? 0.05) * (0.6 + rng() * 0.9),
        color: opts.color ?? 0x8a7c66,
        floor, restitution: opts.restitution ?? 0.32,
        heat: opts.heat ? opts.heat * (0.55 + rng() * 0.75) : 0,
        cool: opts.cool ?? 1.4,
      });
    }
  }

  splash(pos, power = 1, opts = {}) {
    const n = Math.max(3, Math.round(16 * power * this.scale));
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, r = rng();
      _v.set(Math.cos(a) * r, rng() * 1.6 + 0.6, Math.sin(a) * r).multiplyScalar(2 + power * 4 * rng());
      this.water.spawn(pos, _v, { life: 0.5 + rng() * 0.7, size: 0.04 + rng() * 0.09,
        drag: 0.6, gravity: 16, color: 0xdff2ff, alpha: 0.75, floor: pos.y });
    }
    // the crown: a tight vertical jet, which is what actually reads as "entry"
    for (let i = 0; i < n * 0.35; i++) {
      _v.set((rng() - 0.5) * 0.9, 3.4 + rng() * 3.6 * power, (rng() - 0.5) * 0.9);
      this.water.spawn(pos, _v, { life: 0.6 + rng() * 0.5, size: 0.05 + rng() * 0.07,
        drag: 0.4, gravity: 18, color: 0xeaf8ff, alpha: 0.85, floor: pos.y });
    }
    for (let i = 0; i < n * 0.4; i++) {
      _v.set(rng() - 0.5, rng() * 0.5 + 0.2, rng() - 0.5).multiplyScalar(1.6 * power);
      this.dust.spawn(pos, _v, { life: 0.8, size: 0.2 * power, drag: 3, gravity: 0.4,
        color: 0xcfe8ff, alpha: 0.2, floor: pos.y });
    }
    if (opts.ripple !== false) ground.ripple(pos.x, pos.z, power);
  }

  explosion(pos, size = 1) {
    const floor = ground.heightAt(pos.x, pos.z);
    const y = floor !== null ? floor : pos.y;
    for (let i = 0; i < 40 * size * this.scale; i++) {
      const r = rng();
      _v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize()
        .multiplyScalar((2.5 + r * r * 20) * size);
      this.sparks.spawn(pos, _v, { life: 0.5 + rng() * 0.9, size: (0.010 + rng() * 0.014) * size,
        drag: 1.3, gravity: 13, color: 0xffd090, alpha: 1, hdr: 3.6, floor: y });
    }
    this.spatter(pos, null, Math.round(8 * size), 0xffb060, { speed: 5 * size, floor: y });
    // A fireball is smoke lit from inside. The soot comes after it, and it is
    // the smoke that carries the scale of the thing.
    for (let i = 0; i < 10 * size * this.scale; i++) {
      _v.set(rng() * 2 - 1, rng() * 1.2 + 0.4, rng() * 2 - 1).normalize().multiplyScalar((2 + rng() * 5) * size);
      this.embers.spawn(pos, _v, { life: 0.30 + rng() * 0.25, size: (0.34 + rng() * 0.3) * size,
        drag: 3.4, gravity: -3, color: 0xffa040, alpha: 1, hdr: 2.8 });
    }
    for (let i = 0; i < 16 * size * this.scale; i++) {
      _v.set(rng() * 2 - 1, rng() * 1.4 + 0.2, rng() * 2 - 1).normalize().multiplyScalar((1.5 + rng() * 4) * size);
      this.smoke.spawn(pos, _v, { life: 1.6 + rng() * 1.6, size: 0.4 * size, drag: 1.6, gravity: -1.4,
        color: 0x5a5a62, alpha: 0.5 });
    }
    this.plasma.spawn(pos, _v.set(0, 0, 0), { life: 0.10, size: 1.3 * size, drag: 1, gravity: 0,
      color: 0xfff0d0, alpha: 1, hdr: 4.5 });
    this.plasma.spawn(pos, _v.set(0, 0, 0), { life: 0.30, size: 3.2 * size, drag: 1, gravity: 0,
      color: 0xffc070, alpha: 1, hdr: 1.9 });

    this.chipBurst(pos, null, Math.round(12 * size), { speed: 8 * size, size: 0.06 * size,
      floor: y, heat: 0.9, cool: 1.1 });
    this.decals.add(_v3.set(pos.x, y + 0.015, pos.z), UP, 1.1 * size,
      { life: 22, heat: 1, alpha: 0.95 });
    ground.disturb(pos.x, pos.z, 2.4 * size, { press: 1, cut: 0.55 });
  }

  /** Continuous molten slag while cutting through heavy plate. */
  slag(pos, normal, color = 0xffa030) {
    for (let i = 0; i < 5 * this.scale; i++) {
      _v.copy(normal).multiplyScalar(1.5 + rng() * 5);
      _v.x += (rng() - 0.5) * 2; _v.z += (rng() - 0.5) * 2; _v.y += rng() * 1.2;
      this.sparks.spawn(pos, _v, { life: 0.6 + rng() * 0.8, size: 0.008 + rng() * 0.012,
        drag: 1.0, gravity: 19, color, alpha: 1, hdr: 3.4 });
    }
    if (rng() < 0.45) this.spatter(pos, normal, 1, 0xffa838, { speed: 2.2 });
    if (rng() < 0.35) {
      this.plasma.spawn(pos, _v.set(0, 0, 0), { life: 0.07, size: 0.16, drag: 1, gravity: 0,
        color: 0xffe8c0, alpha: 1, hdr: 4.0 });
    }
    if (rng() < 0.3) {
      _v.set(rng() - 0.5, 0.6 + rng() * 0.5, rng() - 0.5);
      this.smoke.spawn(pos, _v, { life: 1.2, size: 0.09, drag: 1.8, gravity: -0.8, color: 0x6a6d74, alpha: 0.32 });
    }
    if (rng() < 0.12) {
      const gh = ground.heightAt(pos.x, pos.z);
      if (gh !== null && Math.abs(pos.y - gh) < 0.5) {
        this.scorch(_v2.set(pos.x, gh + 0.02, pos.z), UP, 0.12 + rng() * 0.1, { heat: 1, life: 14 });
      }
    }
    // Slag is molten metal running off a blade held against something. What it
    // lands on keeps it, whether or not a decal was spent this frame.
    const gy = ground.heightAt(pos.x, pos.z);
    if (gy !== null && Math.abs(pos.y - gy) < 0.6) ground.burn(pos.x, pos.z, 0.17, 1);
  }

  dispose() {
    if (ground.fx === this) ground.fx = null;
    for (const p of this.pools) p.dispose();
    this.chips.dispose();
    this.decals.dispose();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const _gait = { dirX: 0, dirZ: 0, stride: 0 };
const _gaitSpare = { dirX: 0, dirZ: 0, stride: 0 };

/** Re-exported so callers only have to know about one of these two files. */
export { wind, ground };
