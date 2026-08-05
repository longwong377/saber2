/**
 * SABER — props, architecture and the blast door.
 *
 * Anything you can see, you can hit; most of it you can cut. Props carry a
 * toughness and a cut budget, so a fruit crate parts instantly, a durasteel
 * pillar takes a deliberate push, and a blast door takes twenty seconds of
 * held blade and a river of slag.
 */

import * as THREE from 'three';
import { Body, LAYER, boxSpheres, capsuleSpheres } from '../physics/Physics.js';
import { sliceGeometry, recenterGeometry, spheresForGeometry } from './Slice.js';
import { metalMaps, duracreteMaps, rockMaps, armorMaps } from '../engine/Textures.js';
import { plateGeo } from '../game/Bodies.js';
import { makeCapMaterial } from '../game/Ragdoll.js';
import { TOUGHNESS } from '../game/Combat.js';
import { clamp, lerp, makeRng } from '../engine/MathUtil.js';

const rng = makeRng(9091);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _m1 = new THREE.Matrix4();

let _propId = 1;

/* ── shared materials ────────────────────────────────────────────────── */

let MATS = null;
export function propMaterials() {
  if (MATS) return MATS;
  const metal = metalMaps(2);
  const crete = duracreteMaps(2);
  const rock = rockMaps(2);
  const armor = armorMaps(2);
  const mk = (maps, color, rough, metalness) => new THREE.MeshStandardMaterial({
    color, map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness,
  });
  MATS = {
    crate: mk(metal, 0x8a7a5c, 0.62, 0.35),
    crateDark: mk(metal, 0x4a4740, 0.55, 0.7),
    barrel: mk(metal, 0x7d5a34, 0.5, 0.75),
    duracrete: mk(crete, 0x9a9184, 0.94, 0.02),
    stone: mk(rock, 0x7d6f5c, 0.92, 0.02),
    steel: mk(metal, 0x767c85, 0.34, 0.98),
    darkSteel: mk(metal, 0x3a3e45, 0.42, 0.95),
    hull: mk(armor, 0x6a707a, 0.42, 0.85),
    glass: new THREE.MeshStandardMaterial({ color: 0x8fd8ff, roughness: 0.06, metalness: 0.1,
      transparent: true, opacity: 0.32 }),
    emissive: new THREE.MeshStandardMaterial({ color: 0x111318, emissive: 0x60d8ff, emissiveIntensity: 2.2,
      roughness: 0.4, metalness: 0.3 }),
    wood: mk(crete, 0x6a4c2c, 0.88, 0.02),
  };
  return MATS;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Prop                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

export class Prop {
  constructor(world, opts) {
    this.id = 'p' + (_propId++);
    this.world = world;
    this.kind = opts.kind || 'crate';
    this.toughness = opts.toughness ?? TOUGHNESS.plastoid;
    this.hp = opts.hp ?? 40;
    this.maxHp = this.hp;
    this.explosive = !!opts.explosive;
    this.generation = opts.generation ?? 0;
    this.dead = false;
    this.grippable = opts.grippable !== false;
    this.bladeColor = opts.bladeColor ?? 0x57c9ff;

    this.mesh = opts.mesh;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    world.scene.add(this.mesh);

    const spheres = opts.spheres || spheresForGeometry(this.mesh.geometry, 8);
    this.body = new Body({
      position: opts.position, quaternion: opts.quaternion,
      spheres, mass: opts.mass ?? 24,
      friction: opts.friction ?? 0.72, restitution: opts.restitution ?? 0.08,
      layer: LAYER.PROP,
      mask: LAYER.WORLD | LAYER.PROP | LAYER.DEBRIS | LAYER.RAGDOLL | LAYER.ENEMY | LAYER.PLAYER,
      linearDamping: 0.05, angularDamping: 0.1,
    });
    this.body.userData.prop = this;
    world.physics.add(this.body);
    this._syncMesh();
  }

  _syncMesh() {
    this.mesh.position.copy(this.body.position);
    this.mesh.quaternion.copy(this.body.quaternion);
  }

  /** World-space capsules the blade solver tests against. */
  capsules(out = []) {
    out.length = 0;
    const s = this.body.spheres;
    for (let i = 0; i < s.length; i++) {
      _v1.copy(s[i].c).applyQuaternion(this.body.quaternion).add(this.body.position);
      out.push({
        name: 'c' + i, p0: _v1.clone(), p1: _v1.clone(), r: s[i].r * 1.05,
        toughness: this.toughness, prop: this,
      });
    }
    return out;
  }

  update(dt) { this._syncMesh(); }

  /**
   * Cut the prop on a world-space plane. Returns the two halves, or null when
   * the geometry could not be split (in which case the caller shatters it).
   */
  cut(planePoint, planeNormal, impulse) {
    if (this.generation >= 2 || this.dead) return null;

    // move the plane into geometry space
    _m1.copy(this.mesh.matrixWorld).invert();
    const lp = _v1.copy(planePoint).applyMatrix4(_m1);
    _q1.copy(this.body.quaternion).invert();
    const ln = _v2.copy(planeNormal).applyQuaternion(_q1).normalize();

    const res = sliceGeometry(this.mesh.geometry, lp, ln);
    if (!res) return null;

    const halves = [];
    for (const [geo, sign] of [[res.front, 1], [res.back, -1]]) {
      const off = recenterGeometry(geo);
      const worldOff = off.clone().applyQuaternion(this.body.quaternion).add(this.body.position);
      const mesh = new THREE.Mesh(geo, this.mesh.material);
      const spheres = spheresForGeometry(geo, 6);
      const volScale = clamp(geo.boundingSphere.radius / (this.mesh.geometry.boundingSphere?.radius || 1), 0.12, 1);
      const half = new Prop(this.world, {
        kind: this.kind, mesh, position: worldOff, quaternion: this.body.quaternion,
        spheres, mass: Math.max(1.2, this.body.mass * volScale),
        toughness: this.toughness, hp: this.hp * volScale,
        explosive: false, generation: this.generation + 1, bladeColor: this.bladeColor,
      });
      half.body.velocity.copy(this.body.velocity);
      half.body.angularVelocity.copy(this.body.angularVelocity);
      if (impulse) {
        half.body.applyImpulse(_v3.copy(impulse).multiplyScalar(half.body.mass * 0.22 * sign), planePoint);
        half.body.applyImpulse(_v3.copy(planeNormal).multiplyScalar(half.body.mass * 1.1 * sign), planePoint);
      }
      // molten face
      const cap = new THREE.Mesh(new THREE.CircleGeometry(Math.sqrt(res.area / Math.PI) * 0.98, 16),
        makeCapMaterial(this.bladeColor));
      cap.position.copy(res.centroid).sub(off);
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ln.clone().multiplyScalar(sign));
      cap.renderOrder = 2;
      mesh.add(cap);
      halves.push(half);
    }

    this.destroy(false);
    return halves;
  }

  damage(amount, point, dir) {
    this.hp -= amount;
    if (this.hp <= 0) { this.shatter(dir, point); return true; }
    return false;
  }

  /** Break into chunks — used when the prop can't be cleanly sliced. */
  shatter(dir, point) {
    if (this.dead) return;
    const centre = this.body.position.clone();
    if (this.explosive && this.world.onExplosion) {
      this.world.onExplosion(centre, 1.35);
    } else if (this.world.particles) {
      this.world.particles.sparkBurst(centre, null, 16, { speed: 7 });
      this.world.particles.smoke.spawn(centre, _v1.set(0, 1.2, 0), { life: 1.4, size: 0.6, drag: 1.6, gravity: -1, color: 0x4a4a4e, alpha: 0.4 });
    }
    const n = this.generation >= 1 ? 3 : 6;
    const geo = this.mesh.geometry;
    geo.computeBoundingBox();
    const size = new THREE.Vector3(); geo.boundingBox.getSize(size);
    for (let i = 0; i < n; i++) {
      const s = size.clone().multiplyScalar(0.24 + rng() * 0.22);
      const g = plateGeo(s.x, s.y, s.z, Math.min(s.x, s.y, s.z) * 0.18);
      const m = new THREE.Mesh(g, this.mesh.material);
      m.castShadow = true;
      const pos = centre.clone().add(_v1.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiply(size).multiplyScalar(0.6));
      this.world.spawnDebris(m, pos, new THREE.Vector3(
        (rng() - 0.5) * 6 + (dir ? dir.x * 4 : 0),
        rng() * 5 + 2,
        (rng() - 0.5) * 6 + (dir ? dir.z * 4 : 0)), s);
    }
    this.destroy(false);
  }

  destroy(disposeGeo = true) {
    if (this.dead) return;
    this.dead = true;
    this.world.physics.remove(this.body);
    this.world.scene.remove(this.mesh);
    if (disposeGeo) this.mesh.geometry.dispose();
    const i = this.world.props.indexOf(this);
    if (i >= 0) this.world.props.splice(i, 1);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Factories                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

export function makeCrate(world, pos, size = 0.7, opts = {}) {
  const M = propMaterials();
  const s = size * (0.85 + rng() * 0.35);
  const geo = plateGeo(s, s * 0.9, s, s * 0.06, 1);
  const mesh = new THREE.Mesh(geo, rng() < 0.35 ? M.crateDark : M.crate);
  // ribs
  const rib = new THREE.Mesh(plateGeo(s * 1.02, s * 0.08, s * 1.02, s * 0.02, 1), M.crateDark);
  rib.position.y = s * 0.3; mesh.add(rib);
  const rib2 = rib.clone(); rib2.position.y = -s * 0.3; mesh.add(rib2);
  return new Prop(world, {
    kind: 'crate', mesh, position: pos,
    quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28),
    mass: 22 * s, toughness: TOUGHNESS.plastoid, hp: 34,
    spheres: boxSpheres(s / 2, s * 0.45, s / 2), ...opts,
  });
}

export function makeBarrel(world, pos, opts = {}) {
  const M = propMaterials();
  const r = 0.32, h = 0.92;
  const geo = new THREE.CylinderGeometry(r, r, h, 14, 1);
  const mesh = new THREE.Mesh(geo, M.barrel);
  for (const y of [-0.26, 0.26]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.03, 0.022, 6, 16), M.darkSteel);
    ring.rotation.x = Math.PI / 2; ring.position.y = y; mesh.add(ring);
  }
  const hazard = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, 0.16, 14, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0x552200, emissiveIntensity: 0.5, roughness: 0.6 }));
  mesh.add(hazard);
  return new Prop(world, {
    kind: 'barrel', mesh, position: pos, mass: 30,
    toughness: TOUGHNESS.plastoid, hp: 22, explosive: true,
    spheres: capsuleSpheres(h / 2 - r * 0.6, r, 'y', 2), ...opts,
  });
}

export function makePillar(world, pos, height = 4.2, opts = {}) {
  const M = propMaterials();
  const r = 0.42;
  const geo = new THREE.CylinderGeometry(r * 0.86, r, height, 12, 1);
  const mesh = new THREE.Mesh(geo, M.duracrete);
  const cap = new THREE.Mesh(plateGeo(r * 2.4, 0.24, r * 2.4, 0.05, 1), M.stone);
  cap.position.y = height / 2 + 0.1; mesh.add(cap);
  const base = cap.clone(); base.position.y = -height / 2 - 0.1; mesh.add(base);
  return new Prop(world, {
    kind: 'pillar', mesh, position: pos, mass: 900,
    toughness: TOUGHNESS.armour, hp: 320, grippable: false,
    spheres: capsuleSpheres(height / 2 - r, r, 'y', Math.max(2, Math.round(height / 1.1))), ...opts,
  });
}

export function makeVaporator(world, pos, opts = {}) {
  const M = propMaterials();
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2.4, 12), M.steel);
  const geo = new THREE.CylinderGeometry(0.16, 0.22, 2.4, 12);
  const mesh = new THREE.Mesh(geo, M.steel);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const fin = new THREE.Mesh(plateGeo(0.09, 1.5, 0.5, 0.03, 1), M.darkSteel);
    fin.position.set(Math.sin(a) * 0.3, 0.6, Math.cos(a) * 0.3);
    fin.rotation.y = a; mesh.add(fin);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), M.hull);
  head.position.y = 1.35; mesh.add(head);
  return new Prop(world, {
    kind: 'vaporator', mesh, position: pos, mass: 180,
    toughness: TOUGHNESS.armour, hp: 120,
    spheres: capsuleSpheres(1.1, 0.26, 'y', 3), ...opts,
  });
}

export function makeSpire(world, pos, height = 6, opts = {}) {
  const M = propMaterials();
  const geo = new THREE.ConeGeometry(0.65, height, 9, 3);
  const pos3 = geo.attributes.position;
  for (let i = 0; i < pos3.count; i++) {
    const y = pos3.getY(i);
    const t = (y + height / 2) / height;
    const bend = Math.sin(t * 2.2) * 0.5;
    pos3.setX(i, pos3.getX(i) * (1 - t * 0.35) + bend);
    pos3.setZ(i, pos3.getZ(i) * (1 - t * 0.35));
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, M.stone);
  return new Prop(world, {
    kind: 'spire', mesh, position: pos, mass: 500,
    toughness: TOUGHNESS.armour, hp: 200, grippable: false,
    spheres: capsuleSpheres(height / 2 - 0.6, 0.55, 'y', 4), ...opts,
  });
}

export function makeConsole(world, pos, opts = {}) {
  const M = propMaterials();
  const geo = plateGeo(1.1, 1.0, 0.6, 0.05, 1);
  const mesh = new THREE.Mesh(geo, M.hull);
  const screen = new THREE.Mesh(plateGeo(0.8, 0.5, 0.04, 0.02, 1), M.emissive);
  screen.position.set(0, 0.3, 0.31); screen.rotation.x = -0.32; mesh.add(screen);
  return new Prop(world, {
    kind: 'console', mesh, position: pos, mass: 90,
    toughness: TOUGHNESS.heavy, hp: 90,
    spheres: boxSpheres(0.55, 0.5, 0.3), ...opts,
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Blast door — the twenty-second cut                                    */
/* ══════════════════════════════════════════════════════════════════════ */

const KERF_VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main(){ vUv = uv; vN = normalize(normalMatrix*normal);
    vW = (modelMatrix*vec4(position,1.0)).xyz;
    gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
const KERF_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uKerf; uniform vec3 uBase; uniform vec3 uHot; uniform float uTime;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main(){
    vec4 k = texture2D(uKerf, vUv);
    float cut = k.r;              // 1 = fully melted through
    float heat = k.g;             // residual glow
    if(cut > 0.86) discard;       // the hole is a hole
    vec3 base = uBase * (0.72 + 0.4*vN.y);
    float rim = smoothstep(0.18, 0.86, cut);
    vec3 glow = mix(vec3(1.4,0.35,0.05), vec3(2.4,1.9,1.2), heat);
    vec3 c = mix(base, glow, clamp(rim*0.9 + heat*0.75, 0.0, 1.0));
    c += glow * heat * 0.6 * (0.85 + 0.15*sin(uTime*23.0 + vW.y*9.0));
    gl_FragColor = vec4(c, 1.0);
  }
`;

export class BlastDoor {
  constructor(world, opts = {}) {
    this.world = world;
    this.width = opts.width ?? 4.4;
    this.height = opts.height ?? 5.0;
    this.thickness = opts.thickness ?? 0.55;
    this.toughness = opts.toughness ?? TOUGHNESS.blastdoor;
    this.opened = false;
    this.onBreach = opts.onBreach || null;
    this.id = 'door' + (_propId++);

    const RES = 128;
    this.res = RES;
    this.kerfData = new Uint8Array(RES * RES * 4);
    this.kerfTex = new THREE.DataTexture(this.kerfData, RES, RES, THREE.RGBAFormat);
    this.kerfTex.needsUpdate = true;
    this.kerfTex.minFilter = THREE.LinearFilter;
    this.kerfTex.magFilter = THREE.LinearFilter;

    const geo = new THREE.BoxGeometry(this.width, this.height, this.thickness, 1, 1, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uKerf: { value: this.kerfTex },
        uBase: { value: new THREE.Color(opts.color ?? 0x6e747e) },
        uHot: { value: new THREE.Color(0xff8020) },
        uTime: { value: 0 },
      },
      vertexShader: KERF_VERT, fragmentShader: KERF_FRAG, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.copy(opts.position);
    if (opts.quaternion) this.mesh.quaternion.copy(opts.quaternion);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    world.scene.add(this.mesh);

    // frame
    const M = propMaterials();
    const frame = new THREE.Group();
    const t = 0.4;
    for (const [w, h, x, y] of [[this.width + t * 2, t, 0, this.height / 2 + t / 2],
                                [this.width + t * 2, t, 0, -this.height / 2 - t / 2],
                                [t, this.height + t * 2, this.width / 2 + t / 2, 0],
                                [t, this.height + t * 2, -this.width / 2 - t / 2, 0]]) {
      const b = new THREE.Mesh(plateGeo(w, h, this.thickness * 1.6, 0.05, 1), M.darkSteel);
      b.position.set(x, y, 0);
      b.castShadow = true; b.receiveShadow = true;
      frame.add(b);
    }
    frame.position.copy(this.mesh.position);
    frame.quaternion.copy(this.mesh.quaternion);
    world.scene.add(frame);
    this.frame = frame;

    this.collider = world.physics.addStaticBox(
      this.mesh.position.clone(),
      new THREE.Vector3(this.width / 2, this.height / 2, this.thickness / 2),
      this.mesh.quaternion.clone(),
      { friction: 0.5, userData: { door: this } });

    this.cutArea = 0;
    this.needsUpload = false;
    this._inv = new THREE.Matrix4();
  }

  /** World-space capsules so the blade solver treats it like anything else. */
  capsules(out = []) {
    out.length = 0;
    const hw = this.width / 2, hh = this.height / 2;
    const step = 0.55;
    for (let y = -hh + step / 2; y < hh; y += step) {
      _v1.set(-hw, y, 0).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
      _v2.set(hw, y, 0).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
      out.push({ name: 'd' + y.toFixed(2), p0: _v1.clone(), p1: _v2.clone(),
        r: this.thickness * 0.62, toughness: Infinity, door: this });
    }
    return out;
  }

  /** Burn the kerf where the blade is touching. Returns true when breached. */
  burn(worldPoint, power, dt) {
    if (this.opened) return false;
    this._inv.copy(this.mesh.matrixWorld).invert();
    _v1.copy(worldPoint).applyMatrix4(this._inv);
    const u = (_v1.x / this.width + 0.5);
    const v = (_v1.y / this.height + 0.5);
    if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) return false;

    const RES = this.res;
    const px = u * RES, py = (1 - v) * RES;
    const radius = RES * 0.030;
    const rate = clamp(power * dt * 0.55, 0, 1.0) * 255;

    const x0 = Math.max(0, Math.floor(px - radius)), x1 = Math.min(RES - 1, Math.ceil(px + radius));
    const y0 = Math.max(0, Math.floor(py - radius)), y1 = Math.min(RES - 1, Math.ceil(py + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - px, y - py) / radius;
        if (d > 1) continue;
        const i = (y * RES + x) * 4;
        const add = rate * (1 - d * d);
        const prev = this.kerfData[i];
        this.kerfData[i] = Math.min(255, prev + add);
        this.kerfData[i + 1] = 255;
        if (prev < 220 && this.kerfData[i] >= 220) this.cutArea++;
      }
    }
    this.needsUpload = true;

    // slag and sparks at the contact
    if (this.world.particles) {
      _v2.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
      if (_v2.dot(_v3.subVectors(worldPoint, this.mesh.position)) < 0) _v2.negate();
      this.world.particles.slag(worldPoint, _v2, 0xffa030);
    }

    const total = RES * RES;
    if (this.cutArea / total > (this.breachFraction ?? 0.055)) { this.breach(); return true; }
    return false;
  }

  breach() {
    if (this.opened) return;
    this.opened = true;
    this.collider.disabled = true;
    if (this.world.particles) {
      this.world.particles.explosion(this.mesh.position.clone(), 0.7);
    }
    // the slug falls out
    const M = propMaterials();
    const slug = new THREE.Mesh(plateGeo(this.width * 0.5, this.height * 0.45, this.thickness * 0.9, 0.05, 1), M.darkSteel);
    this.world.spawnDebris(slug, this.mesh.position.clone(),
      new THREE.Vector3((rng() - 0.5) * 2, 1, (rng() - 0.5) * 2 - 2),
      new THREE.Vector3(this.width * 0.5, this.height * 0.45, this.thickness));
    if (this.onBreach) this.onBreach(this);
  }

  update(dt) {
    this.mat.uniforms.uTime.value += dt;
    // heat bleeds away
    if (this.needsUpload) {
      const d = this.kerfData;
      for (let i = 1; i < d.length; i += 4) if (d[i] > 0) d[i] = Math.max(0, d[i] - 255 * dt * 0.55);
      this.kerfTex.needsUpdate = true;
      this.needsUpload = false;
    } else {
      const d = this.kerfData;
      let any = false;
      for (let i = 1; i < d.length; i += 4) if (d[i] > 0) { d[i] = Math.max(0, d[i] - 255 * dt * 0.55); any = true; }
      if (any) this.kerfTex.needsUpdate = true;
    }
  }

  dispose() {
    this.world.scene.remove(this.mesh, this.frame);
    this.mesh.geometry.dispose(); this.mat.dispose();
    this.kerfTex.dispose();
    this.world.physics.removeStaticBox(this.collider);
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Static architecture                                                   */
/* ══════════════════════════════════════════════════════════════════════ */

export function addWall(world, centre, size, quat = new THREE.Quaternion(), material = null) {
  const M = propMaterials();
  const geo = plateGeo(size.x, size.y, size.z, Math.min(size.x, size.y, size.z) * 0.03, 1);
  const mesh = new THREE.Mesh(geo, material || M.duracrete);
  mesh.position.copy(centre);
  mesh.quaternion.copy(quat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  world.scene.add(mesh);
  world.physics.addStaticBox(centre, size.clone().multiplyScalar(0.5), quat, { friction: 0.8 });
  world.statics.push(mesh);
  return mesh;
}
