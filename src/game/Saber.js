/**
 * SABER — the weapon.
 *
 * A hilt pose in, a swept blade volume out. Everything downstream — deflection,
 * cutting, the arm IK, the hum — reads from the sweep this produces, so the
 * blade is the single source of truth about where the weapon has been this
 * frame and how fast each point along it was moving when it got there.
 */

import * as THREE from 'three';
import { clamp, lerp, makeRng } from '../engine/MathUtil.js';

const rng = makeRng(88);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();

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

const GLOW_VERT = /* glsl */`
  varying vec3 vN; varying vec3 vV; varying float vY;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vY = uv.y;
    gl_Position = projectionMatrix * mv;
  }
`;
const GLOW_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uPower; uniform float uIntensity; uniform float uFlicker;
  varying vec3 vN; varying vec3 vV; varying float vY;
  void main(){
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float a = pow(facing, uPower) * uIntensity * uFlicker;
    // soften the very ends so the cap reads as rounded plasma
    a *= smoothstep(0.0, 0.035, vY) * smoothstep(1.0, 0.965, vY);
    gl_FragColor = vec4(uColor * a, a);
  }
`;

const TRAIL_VERT = /* glsl */`
  attribute float aAge;
  attribute float aSide;
  varying float vAge; varying float vSide;
  void main(){
    vAge = aAge; vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const TRAIL_FRAG = /* glsl */`
  uniform vec3 uColor; uniform vec3 uCore; uniform float uIntensity;
  varying float vAge; varying float vSide;
  void main(){
    float fade = pow(clamp(1.0 - vAge, 0.0, 1.0), 1.7);
    float across = 1.0 - abs(vSide * 2.0 - 1.0);
    vec3 c = mix(uColor, uCore, pow(across, 3.0) * fade);
    float a = fade * (0.25 + across * 0.75) * uIntensity;
    if(a < 0.003) discard;
    gl_FragColor = vec4(c * a, a);
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
    this.bladeLength = opts.bladeLength ?? 1.15;
    this.coreWidth = opts.coreWidth ?? 1;
    this.hiltStyle = opts.hiltStyle ?? 'Graflex';
    this.isDark = c.key === 'red' || c.key === 'black';

    this.root = new THREE.Group();
    this.root.matrixAutoUpdate = true;
    scene.add(this.root);

    this.lit = false;
    this.ignition = 0;            // 0..1 extension
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

    this.light = new THREE.PointLight(this.color.getHex(), 0, 9, 2);
    this.light.castShadow = false;
    scene.add(this.light);
    this.tipLight = new THREE.PointLight(this.color.getHex(), 0, 5, 2);
    scene.add(this.tipLight);
  }

  setColor(index) {
    this.colorIndex = index;
    const c = SABER_COLORS[index] || SABER_COLORS[0];
    this.color.setHex(c.hex);
    this.glowColor.setHex(c.glow);
    this.isDark = c.key === 'red' || c.key === 'black';
    for (const g of this.glowMeshes) g.material.uniforms.uColor.value.copy(this.color);
    this.trailMat.uniforms.uColor.value.copy(this.color);
    this.trailMat.uniforms.uCore.value.copy(this.glowColor);
    this.light.color.copy(this.color);
    this.tipLight.color.copy(this.color);
    this.core.material.color.copy(this._coreColour());
  }

  /**
   * The core's emissive colour: the pale end of the blade's palette, pushed
   * above 1.0 so it blooms. Bright enough to look white-hot down the middle,
   * tinted enough that the hue survives the clamp at the edges.
   */
  _coreColour(out = new THREE.Color()) {
    return out.copy(this.glowColor).multiplyScalar(1.75);
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

  _buildBlade() {
    this.bladeGroup = new THREE.Group();
    this.bladeGroup.position.y = this.emitterY;
    this.root.add(this.bladeGroup);

    const L = 1;   // unit length, scaled by ignition * bladeLength
    const seg = 1;
    const w = this.coreWidth;

    const mkGlow = (radius, power, intensity) => {
      const geo = new THREE.CylinderGeometry(radius, radius, L, 14, seg, true);
      geo.translate(0, L / 2, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: this.color.clone() },
          uPower: { value: power },
          uIntensity: { value: intensity },
          uFlicker: { value: 1 },
        },
        vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide, toneMapped: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      this.bladeGroup.add(m);
      return m;
    };

    // A hot core just over 1.0 so bloom bites, wrapped in a halo a few
    // centimetres wider. Any more and the blade stops reading as a blade and
    // becomes a smear of light with a person somewhere behind it.
    //
    // The core is tinted, NOT pure white. Everything above 1.0 clamps to white
    // on the way out, so a (2.2, 2.2, 2.2) core rendered every saber in the
    // game as an identical colourless stick — the chosen colour only ever
    // survived in the halo, which the core then sat on top of.
    const coreGeo = new THREE.CapsuleGeometry(0.0115 * w, L - 0.023 * w, 4, 12);
    coreGeo.translate(0, L / 2, 0);
    this.core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
      color: this._coreColour(), toneMapped: false, fog: false,
    }));
    this.core.frustumCulled = false;
    this.bladeGroup.add(this.core);

    // Each shell approximates the chord length through a tube of plasma, so it
    // is brightest on the axis and fades to nothing at its own silhouette.
    // They need to be wide and soft, or the colour hides under the core.
    this.glowMeshes = [
      mkGlow(0.028 * w, 0.95, 1.45),
      mkGlow(0.052 * w, 1.70, 0.80),
      mkGlow(0.098 * w, 2.70, 0.30),
    ];
    this.bladeGroup.scale.y = 0.0001;
    this.bladeGroup.visible = false;
  }

  _buildTrail() {
    this.trailSegments = 26;
    const n = this.trailSegments;
    const geo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(n * 2 * 3);
    this.trailAge = new Float32Array(n * 2);
    this.trailSide = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { this.trailSide[i * 2] = 0; this.trailSide[i * 2 + 1] = 1; }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAge', new THREE.BufferAttribute(this.trailAge, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(this.trailSide, 1));

    this.trailMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: this.color.clone() },
        uCore: { value: this.glowColor.clone() },
        uIntensity: { value: 1 },
      },
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, toneMapped: false,
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
    this.ignition += (target - this.ignition) * Math.min(1, dt * rate);
    if (this.ignition < 0.002 && !this.lit) { this.bladeGroup.visible = false; this.ignition = 0; }
    else if (this.ignition > 0.002) this.bladeGroup.visible = true;

    const len = this.bladeLength * this.ignition;
    this.bladeGroup.scale.y = Math.max(0.0001, len);
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
    for (const g of this.glowMeshes) g.material.uniforms.uFlicker.value = flick;
    this.core.material.color.copy(this._coreColour(_c)).multiplyScalar(flick);

    const on = this.ignition > 0.05;
    if (on) {
      this.pointAt(0.45, _v1);
      this.light.position.copy(_v1);
      this.light.intensity = 2.1 * this.ignition * (1 + this.contactStrain * 1.6) * flick;
      this.light.distance = 6 + len * 2.4;
      this.tipLight.position.copy(this.tip);
      this.tipLight.intensity = 0.9 * this.ignition * flick;
    } else {
      this.light.intensity = 0;
      this.tipLight.intensity = 0;
    }
    this.contactStrain *= Math.max(0, 1 - dt * 6);
  }

  _updateTrail(dt, len) {
    const n = this.trailSegments;
    const h = this.trailHistory;
    if (this.ignition > 0.4) {
      // On a slow frame the blade can cross a metre between samples, which
      // would leave the ribbon a fan of huge triangles. Fill in the gap so the
      // trail reads the same at 20 fps as it does at 144.
      const gap = this.tip.distanceTo(this.prevTip);
      const fill = Math.min(6, Math.floor(gap / 0.3));
      for (let i = fill; i >= 1; i--) {
        const k = i / (fill + 1);
        h.unshift({
          b: this.prevBase.clone().lerp(this.base, 1 - k),
          t: this.prevTip.clone().lerp(this.tip, 1 - k),
          age: dt * (1 / 0.13) * k,
        });
      }
      h.unshift({ b: this.base.clone(), t: this.tip.clone(), age: 0 });
    } else h.length = 0;
    while (h.length > n) h.pop();

    const decay = 1 / 0.13;   // trail lifetime in seconds
    for (const s of h) s.age += dt * decay;

    const pos = this.trailPos, age = this.trailAge;
    for (let i = 0; i < n; i++) {
      const s = h[Math.min(i, h.length - 1)];
      const i6 = i * 6;
      if (!s || s.age >= 1) {
        // collapse unused segments onto the hilt so they render nothing
        pos[i6] = pos[i6 + 3] = this.base.x;
        pos[i6 + 1] = pos[i6 + 4] = this.base.y;
        pos[i6 + 2] = pos[i6 + 5] = this.base.z;
        age[i * 2] = age[i * 2 + 1] = 1;
        continue;
      }
      pos[i6] = s.b.x; pos[i6 + 1] = s.b.y; pos[i6 + 2] = s.b.z;
      pos[i6 + 3] = s.t.x; pos[i6 + 4] = s.t.y; pos[i6 + 5] = s.t.z;
      age[i * 2] = age[i * 2 + 1] = s.age;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.aAge.needsUpdate = true;
    this.trailMat.uniforms.uIntensity.value = clamp(this.tipSpeed / 16, 0.08, 1.0) * this.ignition;
    this.trail.visible = this.ignition > 0.2;
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
