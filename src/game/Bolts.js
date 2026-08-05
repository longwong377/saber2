/**
 * SABER — blaster bolts.
 *
 * Bolts are swept segments, not points: every frame each bolt is tested as the
 * line it actually travelled, against the quad each blade actually swept. That
 * is what makes deflection honest — a fast blade and a fast bolt cannot pass
 * through each other because neither is ever sampled as a snapshot.
 */

import * as THREE from 'three';
import { segmentSegment } from '../physics/Physics.js';
import { clamp, makeRng } from '../engine/MathUtil.js';

const rng = makeRng(606);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export const BOLT_COLORS = {
  red:   0xff2a18,
  green: 0x4dff2a,
  blue:  0x35b0ff,
  gold:  0xffb020,
  white: 0xf0f4ff,
};

export class BoltPool {
  constructor(scene, max = 420) {
    this.max = max;
    this.bolts = [];
    for (let i = 0; i < max; i++) {
      this.bolts.push({
        active: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(),
        vel: new THREE.Vector3(), color: new THREE.Color(), life: 0, damage: 10,
        owner: null, team: 1, deflected: false, deflector: null, speed: 90,
        length: 1.1, radius: 0.05, homing: 0, target: null, big: false,
      });
    }
    this.head = 0;

    const geo = new THREE.CylinderGeometry(1, 1, 1, 7, 1);
    geo.rotateX(Math.PI / 2);       // along +Z
    // vertexColors turns on USE_COLOR, which multiplies by a `color` attribute
    // before instanceColor is applied — without it every bolt renders black.
    geo.setAttribute('color', new THREE.BufferAttribute(
      new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, opacity: 1,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);

    // soft halo around each bolt
    const hgeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    hgeo.rotateX(Math.PI / 2);
    const hmat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vC;
        attribute vec3 instanceColorH;
        void main(){ vec4 mv = modelViewMatrix * instanceMatrix * vec4(position,1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz);
          vC = instanceColorH; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vV; varying vec3 vC;
        void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          gl_FragColor = vec4(vC * f * 0.9, f * 0.55); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.halo = new THREE.InstancedMesh(hgeo, hmat, max);
    this.halo.geometry.setAttribute('instanceColorH',
      new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3));
    this.halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halo.frustumCulled = false;
    this.halo.count = 0;
    scene.add(this.halo);

    this.onDeflect = null;
    this.onImpact = null;
  }

  fire(origin, dir, opts = {}) {
    let b = null;
    for (let i = 0; i < this.max; i++) {
      const c = this.bolts[(this.head + i) % this.max];
      if (!c.active) { b = c; this.head = (this.head + i + 1) % this.max; break; }
    }
    if (!b) return null;
    b.active = true;
    b.pos.copy(origin); b.prev.copy(origin);
    b.speed = opts.speed ?? 88;
    b.vel.copy(dir).normalize().multiplyScalar(b.speed);
    b.color.set(opts.color ?? BOLT_COLORS.red);
    b.life = opts.life ?? 3.2;
    b.damage = opts.damage ?? 11;
    b.owner = opts.owner ?? null;
    b.team = opts.team ?? 1;
    b.deflected = false;
    b.deflector = null;
    b.big = !!opts.big;
    b.length = opts.length ?? (b.big ? 2.0 : 1.15);
    b.radius = opts.radius ?? (b.big ? 0.085 : 0.05);
    b.homing = opts.homing ?? 0;
    b.target = opts.target ?? null;
    return b;
  }

  /**
   * @param ctx.blades   [{ saber, owner, team }]
   * @param ctx.hitTest  (bolt, from, to) => { point, normal, victim, bone, t } | null
   */
  update(dt, ctx) {
    let n = 0;
    const colors = this.mesh.instanceColor.array;
    const hcolors = this.halo.geometry.attributes.instanceColorH.array;

    for (const b of this.bolts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; continue; }

      b.prev.copy(b.pos);
      if (b.homing > 0 && b.target) {
        _v1.subVectors(b.target, b.pos).normalize();
        b.vel.lerp(_v1.multiplyScalar(b.speed), clamp(b.homing * dt, 0, 1)).setLength(b.speed);
      }
      b.pos.addScaledVector(b.vel, dt);

      // ── blades first: a deflection has to beat a body hit
      let consumed = false;
      if (ctx.blades) {
        for (const entry of ctx.blades) {
          const sab = entry.saber;
          if (!sab || sab.ignition < 0.6) continue;
          if (b.deflector === entry.owner && b.deflected) continue;
          const hit = intersectBladeSweep(b.prev, b.pos, sab, _v4);
          if (!hit) continue;
          if (this.onDeflect) this.onDeflect(b, entry, hit, _v4.clone());
          consumed = true;
          break;
        }
      }
      if (!b.active) continue;

      // ── world / bodies (a bolt that just turned on a blade gets this frame free)
      if (!consumed && ctx.hitTest) {
        const res = ctx.hitTest(b, b.prev, b.pos);
        if (res) {
          if (this.onImpact) this.onImpact(b, res);
          b.active = false;
          continue;
        }
      }

      if (!b.active) continue;
      if (b.pos.lengthSq() > 900 * 900) { b.active = false; continue; }

      // ── draw
      if (n < this.max) {
        _v1.copy(b.vel).normalize();
        _q.setFromUnitVectors(_v3.set(0, 0, 1), _v1);
        _s.set(b.radius, b.radius, b.length);
        _m.compose(b.pos, _q, _s);
        this.mesh.setMatrixAt(n, _m);
        colors[n * 3] = b.color.r * 3.2; colors[n * 3 + 1] = b.color.g * 3.2; colors[n * 3 + 2] = b.color.b * 3.2;
        _s.set(b.radius * 3.4, b.radius * 3.4, b.length * 1.25);
        _m.compose(b.pos, _q, _s);
        this.halo.setMatrixAt(n, _m);
        hcolors[n * 3] = b.color.r; hcolors[n * 3 + 1] = b.color.g; hcolors[n * 3 + 2] = b.color.b;
        n++;
      }
    }

    this.mesh.count = n;
    this.halo.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
    this.halo.geometry.attributes.instanceColorH.needsUpdate = true;
  }

  /** Bolts that will reach `point` soon — used by AI dodging and by assist. */
  threatsNear(point, radius, out = []) {
    out.length = 0;
    for (const b of this.bolts) {
      if (!b.active) continue;
      _v1.subVectors(point, b.pos);
      const along = _v1.dot(_v2.copy(b.vel).normalize());
      if (along < 0 || along > radius) continue;
      const perp = _v1.addScaledVector(_v2, -along).length();
      if (perp > 2.2) continue;
      out.push({ bolt: b, eta: along / b.speed, point: b.pos, dist: along, offset: perp });
    }
    out.sort((a, c) => a.eta - c.eta);
    return out;
  }

  clear() { for (const b of this.bolts) b.active = false; this.mesh.count = 0; this.halo.count = 0; }

  dispose() {
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this.halo.geometry.dispose(); this.halo.material.dispose();
    this.mesh.parent?.remove(this.mesh);
    this.halo.parent?.remove(this.halo);
  }
}

/* ── swept blade intersection ────────────────────────────────────────── */

const _a1 = new THREE.Vector3(), _b1 = new THREE.Vector3();

/**
 * Test a bolt's swept segment against the quad the blade swept this frame.
 * `bladeT` is the fraction along the blade (0 = emitter, 1 = tip); the caller
 * uses it to grade the deflection, because tips return bolts and hilts don't.
 */
export function intersectBladeSweep(from, to, saber, outPoint) {
  const r = 0.075 + saber.coreWidth * 0.05;
  // The blade moved from (prevBase→prevTip) to (base→tip). Sample the sweep at
  // a few slices so a fast blade is a surface, not a line.
  const SLICES = 3;
  let best = null;
  for (let i = 0; i <= SLICES; i++) {
    const k = i / SLICES;
    _v5.lerpVectors(saber.prevBase, saber.base, k);
    _v6.lerpVectors(saber.prevTip, saber.tip, k);
    const res = segmentSegment(from, to, _v5, _v6, _a1, _b1);
    if (res.distSq < r * r && (!best || res.s < best.boltT)) {
      best = { boltT: res.s, bladeT: res.t, point: _a1.clone(), bladePoint: _b1.clone(), slice: k };
    }
  }
  if (!best) return null;
  if (outPoint) outPoint.copy(best.bladePoint);
  return best;
}

/**
 * Test a segment against a capsule (used for bolt-vs-limb and blade-vs-limb).
 * Returns the fraction along the capsule axis, or null.
 */
export function segmentCapsule(p0, p1, c0, c1, radius) {
  const res = segmentSegment(p0, p1, c0, c1, _a1, _b1);
  if (res.distSq > radius * radius) return null;
  return { t: res.t, s: res.s, point: _b1.clone(), hitPoint: _a1.clone(), dist: Math.sqrt(res.distSq) };
}
