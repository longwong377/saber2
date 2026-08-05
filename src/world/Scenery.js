/**
 * SABER — grass, ground cover, water and airborne dust.
 *
 * The grass field follows the player rather than covering the map, so a few
 * thousand instances read as a horizon of ground cover. Blades bend away from
 * everything that moves through them — that interaction is the whole reason to
 * have grass at all.
 */

import * as THREE from 'three';
import { grassSprite, smokeSprite } from '../engine/Textures.js';
import { makeRng, clamp, fbm2 } from '../engine/MathUtil.js';

const rng = makeRng(70707);
const _v1 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

/* ── grass ───────────────────────────────────────────────────────────── */

const GRASS_VERT = /* glsl */`
  precision highp float;
  attribute vec4 aInst;      // world x, y, z, scale
  attribute vec3 aTint;
  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uRadius;
  uniform vec4 uPushers[8];  // xyz + radius
  uniform int uPusherCount;
  uniform vec3 uWind;
  varying vec2 vUv;
  varying vec3 vTint;
  varying float vShade;

  void main(){
    vUv = uv;
    vTint = aTint;
    float h = uv.y;                       // 0 at root, 1 at tip
    vec3 base = aInst.xyz;
    float phase = fract(sin(base.x*12.9898 + base.z*78.233) * 43758.5453);

    // shrink to nothing at the edge of the field so the reshuffle never pops
    float fade = 1.0 - smoothstep(uRadius*0.68, uRadius*0.98, distance(base.xz, uCenter.xz));
    float scale = aInst.w * fade;
    if(scale <= 0.001){ gl_Position = vec4(2.0,2.0,2.0,1.0); vShade = 0.0; return; }

    // turn the card to face the viewer a little, so blades keep their width
    vec3 toCam = normalize(vec3(cameraPosition.x - base.x, 0.0, cameraPosition.z - base.z));
    vec3 side = normalize(vec3(-toCam.z, 0.0, toCam.x));
    vec3 p = side * (position.x * scale) + vec3(0.0, position.y * scale, 0.0);

    // wind: a travelling wave plus a slow gust
    float w = sin(uTime*1.7 + base.x*0.35 + base.z*0.27 + phase*6.283);
    float gust = sin(uTime*0.43 + base.x*0.07)*0.5 + 0.5;
    vec3 bend = uWind * (w*0.35 + gust*0.75) * h*h * scale;

    // push away from anything moving through the field
    for(int i=0;i<8;i++){
      if(i >= uPusherCount) break;
      vec3 d = base - uPushers[i].xyz;
      d.y = 0.0;
      float dist = length(d);
      float r = uPushers[i].w;
      if(dist < r && r > 0.0){
        float k = 1.0 - dist/r;
        bend += normalize(d + vec3(0.001,0.0,0.0)) * k*k * 1.35 * h * scale;
        bend.y -= k*k*0.45*h*scale;
      }
    }

    vec3 world = base + p + bend;
    vShade = 0.55 + h*0.6;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;
const GRASS_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uMap;
  uniform vec3 uSun;
  varying vec2 vUv; varying vec3 vTint; varying float vShade;
  void main(){
    vec4 t = texture2D(uMap, vUv);
    if(t.a < 0.35) discard;
    gl_FragColor = vec4(t.rgb * vTint * vShade * uSun, 1.0);
  }
`;

export class GrassField {
  constructor(scene, terrain, opts = {}) {
    this.terrain = terrain;
    this.radius = opts.radius ?? 42;
    this.count = Math.max(0, Math.floor((opts.count ?? 9000) * (opts.density ?? 1)));
    if (this.count === 0) { this.mesh = null; return; }

    const card = new THREE.PlaneGeometry(0.30, 0.44, 1, 3);
    card.translate(0, 0.22, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = card.index;
    geo.attributes.position = card.attributes.position;
    geo.attributes.uv = card.attributes.uv;
    geo.instanceCount = this.count;

    this.aInst = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 4), 4);
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 3), 3);
    this.aInst.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInst', this.aInst);
    geo.setAttribute('aTint', this.aTint);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: grassSprite(64) },
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uRadius: { value: this.radius },
        uPushers: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
        uPusherCount: { value: 0 },
        uWind: { value: new THREE.Vector3(0.16, 0, 0.09) },
        uSun: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG,
      side: THREE.DoubleSide, transparent: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);

    this.center = new THREE.Vector3(1e9, 0, 1e9);
    this.tintA = new THREE.Color(opts.tintA ?? 0x9aa860);
    this.tintB = new THREE.Color(opts.tintB ?? 0x5d6b34);
  }

  _scatter(center) {
    const a = this.aInst.array, t = this.aTint.array;
    const c = new THREE.Color();
    for (let i = 0; i < this.count; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * this.radius;
      const x = center.x + Math.cos(ang) * rad;
      const z = center.z + Math.sin(ang) * rad;
      // grass avoids steep slopes and clumps by low-frequency noise
      const slope = this.terrain.slopeAt(x, z);
      const density = clamp(1 - slope * 2.4, 0, 1) * clamp(fbm2(x * 0.03, z * 0.03, 3) + 0.5, 0, 1);
      const scale = density > 0.14 ? (0.6 + rng() * 0.9) * clamp(density * 1.7, 0.2, 1.5) : 0;
      a[i * 4] = x;
      a[i * 4 + 1] = this.terrain.height(x, z) - 0.02;
      a[i * 4 + 2] = z;
      a[i * 4 + 3] = scale;
      c.copy(this.tintA).lerp(this.tintB, rng() * 0.85);
      t[i * 3] = c.r; t[i * 3 + 1] = c.g; t[i * 3 + 2] = c.b;
    }
    this.aInst.needsUpdate = true;
    this.aTint.needsUpdate = true;
  }

  update(dt, center, pushers, sunColor) {
    if (!this.mesh) return;
    this.mat.uniforms.uTime.value += dt;
    if (sunColor) this.mat.uniforms.uSun.value.copy(sunColor);
    if (center.distanceToSquared(this.center) > this.radius * this.radius * 0.09) {
      this.center.copy(center);
      this._scatter(center);
      this.mat.uniforms.uCenter.value.copy(center);
    }
    const u = this.mat.uniforms.uPushers.value;
    const n = Math.min(8, pushers.length);
    for (let i = 0; i < 8; i++) {
      if (i < n) u[i].set(pushers[i].x, pushers[i].y, pushers[i].z, pushers[i].w || 1.1);
      else u[i].set(0, -9999, 0, 0);
    }
    this.mat.uniforms.uPusherCount.value = n;
  }

  dispose() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose(); this.mat.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

/* ── water ───────────────────────────────────────────────────────────── */

const WATER_VERT = /* glsl */`
  uniform float uTime;
  varying vec3 vW; varying vec2 vUv; varying float vWave;
  void main(){
    vUv = uv;
    vec3 p = position;
    float w = sin(p.x*0.55 + uTime*1.3) * 0.055
            + sin(p.y*0.71 - uTime*1.05) * 0.045
            + sin((p.x+p.y)*0.23 + uTime*0.6) * 0.09;
    p.z += w;
    vWave = w;
    vec4 wp = modelMatrix * vec4(p,1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const WATER_FRAG = /* glsl */`
  precision highp float;
  uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSunDir; uniform vec3 uSky;
  varying vec3 vW; varying vec2 vUv; varying float vWave;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
  void main(){
    vec3 V = normalize(cameraPosition - vW);
    // ripple normal
    vec2 q = vW.xz*1.6;
    float n1 = vnoise(q + vec2(uTime*0.35, uTime*0.21));
    float n2 = vnoise(q*2.3 - vec2(uTime*0.27, uTime*0.41));
    vec3 N = normalize(vec3((n1-n2)*0.55, 1.0, (n2-n1)*0.55));
    float fres = pow(1.0 - clamp(dot(N,V),0.0,1.0), 3.2);
    vec3 base = mix(uDeep, uShallow, clamp(vWave*3.0+0.5,0.0,1.0));
    vec3 col = mix(base, uSky, fres*0.86);
    float spec = pow(max(dot(reflect(-normalize(uSunDir), N), V), 0.0), 90.0);
    col += vec3(1.0,0.95,0.85) * spec * 2.4;
    float foam = smoothstep(0.06, 0.12, abs(vWave)) * 0.16;
    col += foam;
    gl_FragColor = vec4(col, 0.86 + fres*0.14);
  }
`;

export class Water {
  constructor(scene, opts = {}) {
    const size = opts.size ?? 520;
    const geo = new THREE.PlaneGeometry(size, size, 96, 96);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(opts.shallow ?? 0x2f7f96) },
        uDeep: { value: new THREE.Color(opts.deep ?? 0x0c2a3c) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) },
        uSky: { value: new THREE.Color(opts.sky ?? 0x9fc4e4) },
      },
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = opts.level ?? 0;
    this.mesh.renderOrder = 3;
    this.level = opts.level ?? 0;
    scene.add(this.mesh);
  }
  update(dt, sunDir, skyColor) {
    this.mat.uniforms.uTime.value += dt;
    if (sunDir) this.mat.uniforms.uSunDir.value.copy(sunDir);
    if (skyColor) this.mat.uniforms.uSky.value.copy(skyColor);
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh); }
}

/* ── airborne dust / sandstorm ───────────────────────────────────────── */

export class Atmosphere {
  constructor(scene, opts = {}) {
    this.count = Math.floor((opts.count ?? 900) * (opts.density ?? 1));
    if (this.count === 0) { this.mesh = null; return; }
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(this.count * 3);
    const seed = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      pos[i * 3] = (rng() - 0.5) * 90;
      pos[i * 3 + 1] = rng() * 22;
      pos[i * 3 + 2] = (rng() - 0.5) * 90;
      seed[i] = rng();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(opts.color ?? 0xd8c8a8) },
        uSize: { value: opts.size ?? 22 },
        uWind: { value: new THREE.Vector3(2.2, 0.1, 1.1) },
        uOpacity: { value: opts.opacity ?? 0.30 },
      },
      vertexShader: `
        attribute float aSeed;
        uniform float uTime; uniform vec3 uCenter; uniform float uSize; uniform vec3 uWind;
        varying float vA;
        void main(){
          vec3 p = position;
          p += uWind * (uTime + aSeed*40.0);
          p = mod(p - uCenter + vec3(45.0, 0.0, 45.0), vec3(90.0, 24.0, 90.0)) - vec3(45.0,0.0,45.0) + uCenter;
          p.y += sin(uTime*0.6 + aSeed*11.0)*0.6;
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          gl_PointSize = uSize * (1.0 + aSeed) / max(-mv.z, 1.0);
          vA = smoothstep(70.0, 12.0, -mv.z) * (0.4 + aSeed*0.6);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uOpacity; varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = 1.0 - clamp(length(c)*2.0, 0.0, 1.0);
          gl_FragColor = vec4(uColor, d*d*vA*uOpacity);
        }`,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Points(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }
  update(dt, center) {
    if (!this.mesh) return;
    this.mat.uniforms.uTime.value += dt;
    this.mat.uniforms.uCenter.value.copy(center);
  }
  setWind(v) { if (this.mesh) this.mat.uniforms.uWind.value.copy(v); }
  dispose() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.parent?.remove(this.mesh);
  }
}
