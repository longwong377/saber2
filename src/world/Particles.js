/**
 * SABER — particles.
 *
 * Simulation runs entirely in the vertex shader: the CPU only ever writes a
 * spawn record (position, velocity, life, colour, and the ground height under
 * the spawn point). That keeps sand storms, spark showers and smoke columns
 * essentially free, and lets a single draw call carry twenty thousand of them.
 */

import * as THREE from 'three';
import { sparkSprite, smokeSprite, radialSprite } from '../engine/Textures.js';
import { makeRng } from '../engine/MathUtil.js';

const rng = makeRng(2718);

const VERT = /* glsl */`
  precision highp float;
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
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vLife;

  void main(){
    float t = uTime - aExtra.z;
    float life = aParams.x;
    vLife = t / life;
    if(t < 0.0 || t > life){
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // cull off-screen
      vColor = vec4(0.0);
      vUv = uv;
      return;
    }

    float k = max(aParams.z, 0.0001);
    float e = (1.0 - exp(-k * t)) / k;
    vec3 pos = aSpawn + aVel * e + vec3(0.0, -aParams.w, 0.0) * (t / k - e) / k;

    // settle on the ground captured at spawn time
    float floorY = aExtra.x;
    if(pos.y < floorY){
      float over = floorY - pos.y;
      pos.y = floorY + min(over * 0.16, 0.05);
    }

    float grow = 1.0 + uGrow * vLife;
    float fade = smoothstep(1.0, 0.72, vLife) * smoothstep(0.0, uFadeIn, vLife);
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
      float stretch = 1.0 + min(vl * uStretch, 6.0);
      offset = dir * q.y * size * stretch + side * q.x * size;
    } else {
      offset = camRight * q.x * size + camUp * q.y * size;
    }

    vec4 mv = modelViewMatrix * vec4(pos + offset, 1.0);
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vColor = vec4(aColor.rgb, aColor.a * fade);
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uMap;
  uniform vec3 uColorEnd;
  uniform float uColorShift;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vLife;
  void main(){
    vec4 tex = texture2D(uMap, vUv);
    vec3 c = mix(vColor.rgb, uColorEnd, vLife * uColorShift);
    float a = tex.a * vColor.a;
    if(a < 0.004) discard;
    gl_FragColor = vec4(c * tex.rgb, a);
  }
`;

export class ParticlePool {
  constructor(scene, opts = {}) {
    this.max = opts.max ?? 3000;
    this.head = 0;
    this.time = 0;

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

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: opts.map },
        uStretch: { value: opts.stretch ?? 0 },
        uGrow: { value: opts.grow ?? 0 },
        uSpin: { value: opts.spin ?? 0 },
        uFadeIn: { value: opts.fadeIn ?? 0.05 },
        uColorEnd: { value: new THREE.Color(opts.colorEnd ?? 0xffffff) },
        uColorShift: { value: opts.colorShift ?? 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
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
   */
  spawn(pos, vel, { life = 1, size = 0.1, drag = 1.2, gravity = 9, color = 0xffffff, alpha = 1, floor = -999 } = {}) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const i3 = i * 3, i4 = i * 4;
    this.aSpawn.array[i3] = pos.x; this.aSpawn.array[i3 + 1] = pos.y; this.aSpawn.array[i3 + 2] = pos.z;
    this.aVel.array[i3] = vel.x; this.aVel.array[i3 + 1] = vel.y; this.aVel.array[i3 + 2] = vel.z;
    this.aParams.array[i4] = life; this.aParams.array[i4 + 1] = size;
    this.aParams.array[i4 + 2] = drag; this.aParams.array[i4 + 3] = gravity;
    const c = _col.set(color);
    this.aColor.array[i4] = c.r; this.aColor.array[i4 + 1] = c.g;
    this.aColor.array[i4 + 2] = c.b; this.aColor.array[i4 + 3] = alpha;
    this.aExtra.array[i3] = floor; this.aExtra.array[i3 + 1] = rng();
    this.aExtra.array[i3 + 2] = this.time;
    this._dirty = true;
  }

  update(dt) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
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
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/* ══════════════════════════════════════════════════════════════════════ */
/*  Manager — named emitters used across the game                         */
/* ══════════════════════════════════════════════════════════════════════ */

export class Particles {
  constructor(scene, scale = 1) {
    this.scale = scale;
    const s = (n) => Math.max(120, Math.floor(n * scale));
    const spark = sparkSprite(64);
    const smoke = smokeSprite(128);
    const soft = radialSprite(128, '#ffffff', 'rgba(255,255,255,0)', 2.4);

    this.sparks = new ParticlePool(scene, { max: s(4200), map: spark, additive: true, stretch: 0.055,
      colorEnd: 0xff4400, colorShift: 0.9, fadeIn: 0.02, renderOrder: 12 });
    this.embers = new ParticlePool(scene, { max: s(1400), map: soft, additive: true,
      colorEnd: 0x882200, colorShift: 1.0, grow: -0.4, renderOrder: 12 });
    this.plasma = new ParticlePool(scene, { max: s(1800), map: soft, additive: true, grow: 1.6,
      colorShift: 0.6, renderOrder: 12 });
    this.smoke = new ParticlePool(scene, { max: s(1600), map: smoke, additive: false, grow: 2.6,
      spin: 1, colorEnd: 0x2a2a2e, colorShift: 0.8, fadeIn: 0.12, renderOrder: 9 });
    this.dust = new ParticlePool(scene, { max: s(5200), map: smoke, additive: false, grow: 2.0,
      spin: 0.6, colorEnd: 0xa08050, colorShift: 0.35, fadeIn: 0.08, renderOrder: 8 });
    this.grit = new ParticlePool(scene, { max: s(3600), map: soft, additive: false, grow: -0.2, renderOrder: 8 });
    this.water = new ParticlePool(scene, { max: s(2000), map: soft, additive: false, grow: 0.4,
      colorEnd: 0x9fd8ff, colorShift: 0.5, renderOrder: 9 });
    this.pools = [this.sparks, this.embers, this.plasma, this.smoke, this.dust, this.grit, this.water];
  }

  update(dt) { for (const p of this.pools) p.update(dt); }

  /* ── recipes ───────────────────────────────────────────────────────── */

  sparkBurst(pos, normal, count = 18, opts = {}) {
    const n = Math.max(1, Math.round(count * this.scale));
    const speed = opts.speed ?? 9;
    const color = opts.color ?? 0xffd9a0;
    for (let i = 0; i < n; i++) {
      _v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      if (normal) _v.lerp(normal, 0.45).normalize();
      _v.multiplyScalar(speed * (0.35 + rng() * 1.0));
      this.sparks.spawn(pos, _v, {
        life: 0.35 + rng() * 0.55, size: 0.035 + rng() * 0.05,
        drag: 1.6, gravity: 16, color, alpha: 1, floor: opts.floor ?? -999,
      });
    }
    if (opts.embers !== false) {
      for (let i = 0; i < n * 0.3; i++) {
        _v.set(rng() * 2 - 1, rng() * 1.4, rng() * 2 - 1).normalize().multiplyScalar(speed * 0.35 * rng());
        this.embers.spawn(pos, _v, { life: 0.9 + rng(), size: 0.05 + rng() * 0.06, drag: 2.4,
          gravity: -1.2, color: 0xff9040, alpha: 0.85, floor: -999 });
      }
    }
  }

  /** The cauterised flare when a blade parts something. */
  cutFlare(pos, dir, color = 0x57c9ff, count = 26) {
    const n = Math.max(2, Math.round(count * this.scale));
    for (let i = 0; i < n; i++) {
      _v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize()
        .multiplyScalar(2 + rng() * 7);
      if (dir) _v.addScaledVector(dir, 3 * rng());
      this.sparks.spawn(pos, _v, { life: 0.3 + rng() * 0.5, size: 0.03 + rng() * 0.05,
        drag: 2.2, gravity: 14, color: i % 3 === 0 ? color : 0xfff0c0, alpha: 1 });
    }
    for (let i = 0; i < n * 0.25; i++) {
      _v.set(rng() * 2 - 1, rng() * 1.5 + 0.3, rng() * 2 - 1).normalize().multiplyScalar(0.7 + rng());
      this.smoke.spawn(pos, _v, { life: 1.4 + rng() * 1.2, size: 0.12 + rng() * 0.12,
        drag: 1.4, gravity: -0.5, color: 0x555a60, alpha: 0.34 });
    }
    this.plasma.spawn(pos, _v2.set(0, 0, 0), { life: 0.18, size: 0.55, drag: 1, gravity: 0, color, alpha: 0.9 });
  }

  boltImpact(pos, normal, color = 0xff3a2a) {
    this.sparkBurst(pos, normal, 12, { speed: 7, color: 0xffe0b0 });
    this.plasma.spawn(pos, _v.set(0, 0, 0), { life: 0.14, size: 0.6, drag: 1, gravity: 0, color, alpha: 1 });
    for (let i = 0; i < 5 * this.scale; i++) {
      _v.copy(normal).multiplyScalar(1.2 + rng()).add(_v2.set(rng() - 0.5, rng() * 0.6, rng() - 0.5));
      this.smoke.spawn(pos, _v, { life: 0.8 + rng() * 0.6, size: 0.1, drag: 2, gravity: -0.6,
        color: 0x6a6a70, alpha: 0.28 });
    }
  }

  /** Sand thrown up by a footfall, a landing, or a body hitting the dune. */
  sandPuff(pos, power = 1, groundY = null, color = 0xd8c09a) {
    const n = Math.max(2, Math.round(10 * power * this.scale));
    const floor = groundY ?? pos.y;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = rng();
      _v.set(Math.cos(a) * r, rng() * 0.55 + 0.15, Math.sin(a) * r).multiplyScalar(1.4 + power * 2.4 * rng());
      this.dust.spawn(pos, _v, { life: 0.9 + rng() * 1.5, size: 0.18 + rng() * 0.3 * power,
        drag: 2.6, gravity: 1.1, color, alpha: 0.16 + 0.12 * rng(), floor });
    }
    for (let i = 0; i < n * 0.8; i++) {
      const a = rng() * Math.PI * 2;
      _v.set(Math.cos(a), rng() * 1.6 + 0.4, Math.sin(a)).multiplyScalar(2 + power * 4 * rng());
      this.grit.spawn(pos, _v, { life: 0.6 + rng() * 0.8, size: 0.02 + rng() * 0.03,
        drag: 0.9, gravity: 15, color, alpha: 0.75, floor });
    }
  }

  splash(pos, power = 1) {
    const n = Math.max(3, Math.round(16 * power * this.scale));
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = rng();
      _v.set(Math.cos(a) * r, rng() * 1.6 + 0.6, Math.sin(a) * r).multiplyScalar(2 + power * 4 * rng());
      this.water.spawn(pos, _v, { life: 0.5 + rng() * 0.7, size: 0.04 + rng() * 0.09,
        drag: 0.6, gravity: 16, color: 0xdff2ff, alpha: 0.75, floor: pos.y });
    }
    for (let i = 0; i < n * 0.4; i++) {
      _v.set(rng() - 0.5, rng() * 0.5 + 0.2, rng() - 0.5).multiplyScalar(1.6 * power);
      this.dust.spawn(pos, _v, { life: 0.8, size: 0.2 * power, drag: 3, gravity: 0.4,
        color: 0xcfe8ff, alpha: 0.2, floor: pos.y });
    }
  }

  explosion(pos, size = 1) {
    for (let i = 0; i < 26 * size * this.scale; i++) {
      _v.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize().multiplyScalar((3 + rng() * 12) * size);
      this.sparks.spawn(pos, _v, { life: 0.5 + rng() * 0.7, size: 0.05 * size, drag: 1.3, gravity: 13,
        color: 0xffd090, alpha: 1 });
    }
    for (let i = 0; i < 14 * size * this.scale; i++) {
      _v.set(rng() * 2 - 1, rng() * 1.4 + 0.2, rng() * 2 - 1).normalize().multiplyScalar((1.5 + rng() * 4) * size);
      this.smoke.spawn(pos, _v, { life: 1.6 + rng() * 1.6, size: 0.4 * size, drag: 1.6, gravity: -1.4,
        color: 0x3a3a40, alpha: 0.5 });
    }
    this.plasma.spawn(pos, _v.set(0, 0, 0), { life: 0.28, size: 3.4 * size, drag: 1, gravity: 0,
      color: 0xffc070, alpha: 1 });
  }

  /** Continuous molten slag while cutting through heavy plate. */
  slag(pos, normal, color = 0xffa030) {
    for (let i = 0; i < 3 * this.scale; i++) {
      _v.copy(normal).multiplyScalar(1 + rng() * 2.5);
      _v.x += rng() - 0.5; _v.z += rng() - 0.5; _v.y += rng() * 0.6;
      this.sparks.spawn(pos, _v, { life: 0.6 + rng() * 0.8, size: 0.03 + rng() * 0.04,
        drag: 1.0, gravity: 19, color, alpha: 1 });
    }
    if (rng() < 0.3) {
      _v.set(rng() - 0.5, 0.6 + rng() * 0.5, rng() - 0.5);
      this.smoke.spawn(pos, _v, { life: 1.2, size: 0.09, drag: 1.8, gravity: -0.8, color: 0x55585e, alpha: 0.3 });
    }
  }

  dispose() { for (const p of this.pools) p.dispose(); }
}
