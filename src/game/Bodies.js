/**
 * SABER — procedural bodies.
 *
 * Every character is generated in code and hung off a bone hierarchy, one
 * limb-mesh per bone. That is not an aesthetic choice — it is what makes
 * "cut anywhere" tractable: a limb is a tapered tube with a known length, so
 * severing it at 62 % is a matter of rebuilding two tubes and capping both.
 */

import * as THREE from 'three';
import { Rig, humanoidSkeleton, walkerSkeleton } from './Rig.js';
import { clothMaps, armorMaps, metalMaps } from '../engine/Textures.js';
import { makeRng, lerp, clamp } from '../engine/MathUtil.js';

const rng = makeRng(5150);

/* ── geometry helpers ────────────────────────────────────────────────── */

/** A tapered capsule spanning y ∈ [0, len] in bone space. */
export function limbGeo(len, r0, r1, seg = 10, cap = true) {
  // lathe profile: [radius, y], rounded at both ends
  const profile = [];
  const capN = cap ? 4 : 0;
  for (let i = capN; i > 0; i--) {
    const a = (i / capN) * Math.PI * 0.5;
    profile.push(new THREE.Vector2(Math.sin(a) * r0 * 0.999, -Math.cos(a) * r0 * 0.62));
  }
  profile.push(new THREE.Vector2(r0, 0));
  profile.push(new THREE.Vector2(lerp(r0, r1, 0.5) * 1.04, len * 0.5));
  profile.push(new THREE.Vector2(r1, len));
  for (let i = 1; i <= capN; i++) {
    const a = (i / capN) * Math.PI * 0.5;
    profile.push(new THREE.Vector2(Math.cos(a) * r1 * 0.999, len + Math.sin(a) * r1 * 0.62));
  }
  const g = new THREE.LatheGeometry(profile, seg);
  g.computeVertexNormals();
  return g;
}

/** A rounded slab — armour plates, boxes, panels. */
export function plateGeo(w, h, d, r = 0.012, seg = 2) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position;
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const cx = clamp(v.x, -hw, hw), cy = clamp(v.y, -hh, hh), cz = clamp(v.z, -hd, hd);
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    const l = Math.hypot(dx, dy, dz);
    if (l > 1e-6) {
      const s = r / l;
      pos.setXYZ(i, cx + dx * s, cy + dy * s, cz + dz * s);
    }
  }
  g.computeVertexNormals();
  return g;
}

function mesh(geo, mat, parentObj, pos, rot, scale) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) Array.isArray(scale) ? m.scale.set(scale[0], scale[1], scale[2]) : m.scale.setScalar(scale);
  m.castShadow = true;
  m.receiveShadow = true;
  parentObj.add(m);
  return m;
}

/* ── material palettes ───────────────────────────────────────────────── */

export const ROBE_COLORS = [
  { name: 'Sand',    outer: 0x9d8567, inner: 0xd8c9a8, trim: 0x5d4b34 },
  { name: 'Umber',   outer: 0x5a4530, inner: 0xa08a68, trim: 0x33261a },
  { name: 'Ash',     outer: 0x54585f, inner: 0x9aa0a8, trim: 0x2b2e33 },
  { name: 'Ivory',   outer: 0xcfc4ac, inner: 0xece4d2, trim: 0x8a7d64 },
  { name: 'Night',   outer: 0x22242b, inner: 0x3a3d45, trim: 0x101116 },
  { name: 'Ochre',   outer: 0x8a6a34, inner: 0xc4a86a, trim: 0x4a3718 },
];

function clothMat(color, rough = 0.92) {
  const maps = clothMaps(2.2);
  return new THREE.MeshStandardMaterial({
    color, map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0, normalScale: new THREE.Vector2(0.85, 0.85),
  });
}
function armorMat(color, metal = 0.1, rough = 0.42) {
  const maps = armorMaps(1.6);
  return new THREE.MeshStandardMaterial({
    color, map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: metal, normalScale: new THREE.Vector2(0.9, 0.9),
  });
}
function metalMat(color, rough = 0.38) {
  const maps = metalMaps(2.4);
  return new THREE.MeshStandardMaterial({
    color, map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0.95, normalScale: new THREE.Vector2(0.8, 0.8),
  });
}
function skinMat(color = 0xc79a76) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.66, metalness: 0 });
}
function emissiveMat(color, intensity = 3) {
  return new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.2,
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Humanoid assembly                                                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Attach limb meshes to every bone of a humanoid rig.
 * `style` supplies materials and per-slot radii, plus optional extra dressing.
 */
export function dressHumanoid(rig, style) {
  const S = style.scale ?? 1;
  const P = style.parts || {};

  const addLimb = (boneName, r0, r1, mat, opts = {}) => {
    const b = rig.get(boneName);
    if (!b) return null;
    const geo = limbGeo(b.length, r0 * S, r1 * S, opts.seg ?? 10, opts.cap !== false);
    const m = mesh(geo, mat, b.obj);
    m.userData.limb = { r0: r0 * S, r1: r1 * S, seg: opts.seg ?? 10 };
    b.parts.push(m);
    b.radius = Math.max(r0, r1) * S;
    b.primary = m;
    return m;
  };

  // torso
  addLimb('hips', P.hipR ?? 0.135, P.waistR ?? 0.125, style.body);
  addLimb('spine', P.waistR ?? 0.125, P.chestR ?? 0.155, style.body);
  addLimb('chest', P.chestR ?? 0.155, P.shoulderR ?? 0.135, style.body);
  addLimb('neck', 0.055, 0.058, style.skin || style.body, { seg: 8 });

  // head
  const head = rig.get('head');
  if (head) {
    const hg = new THREE.SphereGeometry(0.105 * S, 16, 14);
    hg.scale(0.94, 1.16, 1.03);
    hg.translate(0, 0.10 * S, 0);
    const hm = mesh(hg, style.head || style.skin || style.body, head.obj);
    head.parts.push(hm); head.primary = hm; head.radius = 0.12 * S;
    if (style.buildHead) style.buildHead(head.obj, S);
  }

  // arms
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    addLimb('clav' + side, 0.075, 0.062, style.body, { seg: 8 });
    addLimb('arm' + side, P.armR ?? 0.058, (P.armR ?? 0.058) * 0.88, style.arm || style.body);
    addLimb('fore' + side, (P.armR ?? 0.058) * 0.86, (P.armR ?? 0.058) * 0.7, style.arm || style.body);
    const hand = rig.get('hand' + side);
    if (hand) {
      const g = plateGeo(0.055 * S, 0.10 * S, 0.085 * S, 0.02 * S);
      g.translate(0, 0.045 * S, 0);
      const m = mesh(g, style.hand || style.arm || style.body, hand.obj);
      hand.parts.push(m); hand.primary = m; hand.radius = 0.05 * S;
    }
  }

  // legs
  for (const side of ['L', 'R']) {
    addLimb('thigh' + side, P.thighR ?? 0.088, (P.thighR ?? 0.088) * 0.82, style.leg || style.body);
    addLimb('shin' + side, (P.thighR ?? 0.088) * 0.78, (P.thighR ?? 0.088) * 0.56, style.leg || style.body);
    const foot = rig.get('foot' + side);
    if (foot) {
      const g = plateGeo(0.088 * S, 0.20 * S, 0.10 * S, 0.024 * S);
      g.translate(0, 0.09 * S, 0.012 * S);
      const m = mesh(g, style.boot || style.leg || style.body, foot.obj);
      foot.parts.push(m); foot.primary = m; foot.radius = 0.06 * S;
    }
  }

  if (style.dress) style.dress(rig, S);
  return rig;
}

/* ── Jedi ────────────────────────────────────────────────────────────── */

export function buildJedi(opts = {}) {
  const S = opts.scale ?? 1;
  const robe = ROBE_COLORS[opts.robeIndex ?? 0] || ROBE_COLORS[0];
  const rig = new Rig(humanoidSkeleton(S), { scale: S });

  const tunic = clothMat(robe.inner);
  const outer = clothMat(robe.outer);
  const trim = clothMat(robe.trim, 0.85);
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.55, metalness: 0.05 });
  const skin = skinMat(opts.skinColor ?? 0xc79a76);
  const hair = new THREE.MeshStandardMaterial({ color: opts.hairColor ?? 0x2a1d14, roughness: 0.78 });

  dressHumanoid(rig, {
    scale: S,
    body: outer, arm: tunic, leg: outer, hand: leather, boot: leather,
    head: skin, skin,
    parts: { chestR: 0.162, shoulderR: 0.142, hipR: 0.138, waistR: 0.122, armR: 0.055, thighR: 0.09 },
    buildHead(headObj, s) {
      // brow, jaw, eyes, hair — small pieces, but they carry the silhouette
      const jaw = new THREE.SphereGeometry(0.082 * s, 12, 10);
      jaw.scale(0.92, 0.74, 1.06); jaw.translate(0, 0.048 * s, 0.012 * s);
      mesh(jaw, skin, headObj);
      for (const sx of [-1, 1]) {
        mesh(new THREE.SphereGeometry(0.0165 * s, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.28 }),
          headObj, [sx * 0.035 * s, 0.105 * s, 0.079 * s]);
        mesh(new THREE.SphereGeometry(0.0082 * s, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2c1d12, roughness: 0.2 }),
          headObj, [sx * 0.036 * s, 0.104 * s, 0.090 * s]);
        mesh(plateGeo(0.034 * s, 0.007 * s, 0.012 * s, 0.003 * s), hair,
          headObj, [sx * 0.036 * s, 0.128 * s, 0.082 * s], [0.2, 0, sx * 0.12]);
        // ears
        mesh(new THREE.SphereGeometry(0.019 * s, 8, 6), skin, headObj, [sx * 0.098 * s, 0.095 * s, 0.0], null, [0.5, 1, 0.8]);
      }
      // nose
      mesh(new THREE.ConeGeometry(0.018 * s, 0.045 * s, 8), skin, headObj, [0, 0.088 * s, 0.085 * s], [Math.PI / 2.1, 0, 0]);
      // hair cap
      const cap = new THREE.SphereGeometry(0.112 * s, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
      cap.scale(1, 1.12, 1.04); cap.translate(0, 0.105 * s, -0.004 * s);
      mesh(cap, hair, headObj);
      // a short braid, because of course
      const braid = new THREE.Group(); headObj.add(braid);
      braid.position.set(0.085 * s, 0.09 * s, 0.02 * s);
      for (let i = 0; i < 5; i++) {
        mesh(new THREE.SphereGeometry(0.011 * s, 8, 6), hair, braid, [0, -i * 0.026 * s, 0], null, [1, 1.25, 1]);
      }
    },
    dress(r, s) {
      const chest = r.get('chest').obj;
      const hips = r.get('hips').obj;

      // tabards over the shoulders
      for (const sx of [-1, 1]) {
        const tab = plateGeo(0.085 * s, 0.40 * s, 0.028 * s, 0.012 * s);
        mesh(tab, outer, chest, [sx * 0.062 * s, 0.055 * s, 0.10 * s], [0.14, sx * 0.06, sx * 0.05]);
        const tabBack = plateGeo(0.10 * s, 0.34 * s, 0.026 * s, 0.012 * s);
        mesh(tabBack, outer, chest, [sx * 0.055 * s, 0.06 * s, -0.10 * s], [-0.1, 0, sx * 0.04]);
      }
      // the V of the crossed tunic
      for (const sx of [-1, 1]) {
        mesh(plateGeo(0.13 * s, 0.24 * s, 0.02 * s, 0.01 * s), trim, chest,
          [sx * 0.045 * s, 0.09 * s, 0.115 * s], [0.1, 0, sx * 0.38]);
      }
      // obi / belt
      const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.142 * s, 0.138 * s, 0.10 * s, 20, 1, true), trim);
      belt.position.y = 0.075 * s; belt.castShadow = true; hips.add(belt);
      const buckle = mesh(plateGeo(0.062 * s, 0.05 * s, 0.02 * s, 0.008 * s), metalMat(0x9a8a6a), hips,
        [0, 0.075 * s, 0.135 * s]);
      // pouches
      for (const sx of [-1, 1]) mesh(plateGeo(0.05 * s, 0.055 * s, 0.035 * s, 0.01 * s), leather, hips,
        [sx * 0.105 * s, 0.055 * s, 0.09 * s]);
      // skirt panels of the robe
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const panel = plateGeo(0.13 * s, 0.42 * s, 0.022 * s, 0.01 * s);
        const m = mesh(panel, outer, hips,
          [Math.sin(a) * 0.115 * s, -0.13 * s, Math.cos(a) * 0.115 * s], [0.06, a, 0]);
        m.userData.skirt = { angle: a, index: i };
      }
      // boots
      for (const side of ['L', 'R']) {
        const sh = r.get('shin' + side);
        if (sh) mesh(new THREE.CylinderGeometry(0.078 * s, 0.070 * s, 0.20 * s, 12), leather, sh.obj, [0, 0.30 * s, 0]);
      }
      // bracers
      for (const side of ['L', 'R']) {
        const f = r.get('fore' + side);
        if (f) mesh(new THREE.CylinderGeometry(0.055 * s, 0.05 * s, 0.13 * s, 12), leather, f.obj, [0, 0.16 * s, 0]);
      }
    },
  });

  return { rig, palette: { robe, tunic, outer, trim, leather, skin } };
}

/* ── B1 battle droid ─────────────────────────────────────────────────── */

export function buildB1(opts = {}) {
  const S = opts.scale ?? 1.02;
  const rig = new Rig(humanoidSkeleton(S, { armLen: 1.06 }), { scale: S });
  const shell = armorMat(opts.color ?? 0xb9a077, 0.25, 0.62);
  const joint = new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 0.7, metalness: 0.5 });
  const eye = emissiveMat(opts.eyeColor ?? 0xff3020, 4);

  dressHumanoid(rig, {
    scale: S,
    body: shell, arm: joint, leg: joint, hand: joint, boot: shell, head: shell,
    parts: { chestR: 0.115, shoulderR: 0.085, hipR: 0.075, waistR: 0.062, armR: 0.030, thighR: 0.046 },
    buildHead(headObj, s) {
      // the long snout
      const snout = new THREE.CylinderGeometry(0.038 * s, 0.055 * s, 0.30 * s, 10);
      snout.translate(0, 0.10 * s, 0.03 * s);
      snout.rotateX(0.30);
      mesh(snout, shell, headObj);
      const dome = new THREE.SphereGeometry(0.062 * s, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
      mesh(dome, shell, headObj, [0, 0.10 * s, -0.02 * s]);
      for (const sx of [-1, 1]) {
        mesh(new THREE.SphereGeometry(0.014 * s, 8, 6), eye, headObj, [sx * 0.028 * s, 0.145 * s, 0.055 * s]);
        // ear vanes
        mesh(plateGeo(0.012 * s, 0.075 * s, 0.03 * s, 0.005 * s), shell, headObj,
          [sx * 0.055 * s, 0.10 * s, -0.01 * s], [0, 0, sx * 0.2]);
      }
      mesh(new THREE.CylinderGeometry(0.02 * s, 0.02 * s, 0.03 * s, 8), joint, headObj, [0, -0.01 * s, 0]);
    },
    dress(r, s) {
      const chest = r.get('chest').obj;
      // the thin chest plate and the backpack
      mesh(plateGeo(0.19 * s, 0.22 * s, 0.075 * s, 0.02 * s), shell, chest, [0, 0.09 * s, 0.02 * s]);
      mesh(plateGeo(0.15 * s, 0.15 * s, 0.075 * s, 0.02 * s), joint, chest, [0, 0.10 * s, -0.075 * s]);
      for (const sx of [-1, 1]) {
        mesh(new THREE.SphereGeometry(0.042 * s, 10, 8), shell, r.get('clav' + (sx > 0 ? 'L' : 'R')).obj, [0.04 * s * sx, 0, 0]);
      }
      const hips = r.get('hips').obj;
      mesh(plateGeo(0.13 * s, 0.11 * s, 0.09 * s, 0.02 * s), shell, hips, [0, 0.03 * s, 0]);
    },
  });
  return { rig, palette: { shell, joint, eye } };
}

/* ── B2 super battle droid ───────────────────────────────────────────── */

export function buildB2(opts = {}) {
  const S = opts.scale ?? 1.18;
  const rig = new Rig(humanoidSkeleton(S, { armLen: 1.0 }), { scale: S });
  const shell = armorMat(opts.color ?? 0x7d7266, 0.55, 0.48);
  const dark = new THREE.MeshStandardMaterial({ color: 0x33302b, roughness: 0.6, metalness: 0.7 });
  const eye = emissiveMat(0xff5522, 3);

  dressHumanoid(rig, {
    scale: S,
    body: shell, arm: shell, leg: shell, hand: dark, boot: dark, head: shell,
    parts: { chestR: 0.21, shoulderR: 0.18, hipR: 0.14, waistR: 0.125, armR: 0.075, thighR: 0.095 },
    buildHead(headObj, s) {
      const g = plateGeo(0.14 * s, 0.15 * s, 0.16 * s, 0.03 * s);
      g.translate(0, 0.08 * s, 0);
      mesh(g, shell, headObj);
      mesh(plateGeo(0.10 * s, 0.03 * s, 0.02 * s, 0.008 * s), eye, headObj, [0, 0.095 * s, 0.082 * s]);
      mesh(plateGeo(0.05 * s, 0.09 * s, 0.03 * s, 0.01 * s), dark, headObj, [0, 0.10 * s, -0.08 * s]);
    },
    dress(r, s) {
      const chest = r.get('chest').obj;
      mesh(plateGeo(0.34 * s, 0.28 * s, 0.20 * s, 0.045 * s), shell, chest, [0, 0.10 * s, 0]);
      mesh(plateGeo(0.20 * s, 0.13 * s, 0.12 * s, 0.03 * s), dark, chest, [0, 0.22 * s, -0.05 * s]);
      for (const sx of [-1, 1]) {
        const clav = r.get('clav' + (sx > 0 ? 'L' : 'R')).obj;
        mesh(plateGeo(0.14 * s, 0.15 * s, 0.16 * s, 0.035 * s), shell, clav, [sx * 0.05 * s, 0.0, 0]);
      }
      // wrist cannon on the right arm
      const fore = r.get('foreR');
      if (fore) {
        mesh(new THREE.CylinderGeometry(0.035 * s, 0.042 * s, 0.16 * s, 10), dark, fore.obj, [0, 0.2 * s, 0.055 * s]);
        const muzzle = mesh(new THREE.CylinderGeometry(0.022 * s, 0.028 * s, 0.05 * s, 8), emissiveMat(0xff4020, 1.2),
          fore.obj, [0, 0.29 * s, 0.055 * s]);
        fore.muzzle = muzzle;
      }
      const hips = r.get('hips').obj;
      mesh(plateGeo(0.26 * s, 0.16 * s, 0.18 * s, 0.035 * s), shell, hips, [0, 0.04 * s, 0]);
    },
  });
  return { rig, palette: { shell, dark, eye } };
}

/* ── clone trooper ───────────────────────────────────────────────────── */

export function buildTrooper(opts = {}) {
  const S = opts.scale ?? 1.0;
  const rig = new Rig(humanoidSkeleton(S), { scale: S });
  const plate = armorMat(opts.color ?? 0xe8e9ec, 0.08, 0.34);
  const under = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.85, metalness: 0.05 });
  const accent = armorMat(opts.accent ?? 0x2f6fbe, 0.1, 0.34);
  const visor = new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.12, metalness: 0.6 });

  dressHumanoid(rig, {
    scale: S,
    body: under, arm: under, leg: under, hand: plate, boot: plate, head: under,
    parts: { chestR: 0.145, shoulderR: 0.13, hipR: 0.125, waistR: 0.112, armR: 0.052, thighR: 0.085 },
    buildHead(headObj, s) {
      const helm = new THREE.SphereGeometry(0.115 * s, 16, 14);
      helm.scale(0.95, 1.12, 1.06); helm.translate(0, 0.10 * s, 0);
      mesh(helm, plate, headObj);
      // the T-visor
      mesh(plateGeo(0.10 * s, 0.055 * s, 0.02 * s, 0.008 * s), visor, headObj, [0, 0.125 * s, 0.098 * s]);
      mesh(plateGeo(0.036 * s, 0.085 * s, 0.02 * s, 0.008 * s), visor, headObj, [0, 0.088 * s, 0.10 * s]);
      mesh(plateGeo(0.055 * s, 0.03 * s, 0.03 * s, 0.008 * s), accent, headObj, [0, 0.185 * s, 0.05 * s]);
      // breather vents
      for (const sx of [-1, 1]) mesh(new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.02 * s, 8), visor,
        headObj, [sx * 0.055 * s, 0.062 * s, 0.075 * s], [0, 0, Math.PI / 2]);
    },
    dress(r, s) {
      const chest = r.get('chest').obj;
      mesh(plateGeo(0.27 * s, 0.27 * s, 0.19 * s, 0.045 * s), plate, chest, [0, 0.10 * s, 0]);
      mesh(plateGeo(0.20 * s, 0.10 * s, 0.13 * s, 0.03 * s), accent, chest, [0, 0.20 * s, 0.01 * s]);
      const hips = r.get('hips').obj;
      mesh(plateGeo(0.24 * s, 0.13 * s, 0.17 * s, 0.035 * s), plate, hips, [0, 0.04 * s, 0]);
      mesh(plateGeo(0.13 * s, 0.20 * s, 0.04 * s, 0.015 * s), plate, hips, [0, -0.12 * s, 0.10 * s]);
      for (const side of ['L', 'R']) {
        const sx = side === 'L' ? 1 : -1;
        mesh(plateGeo(0.13 * s, 0.13 * s, 0.14 * s, 0.03 * s), plate, r.get('clav' + side).obj, [sx * 0.05 * s, 0, 0]);
        mesh(new THREE.CylinderGeometry(0.062 * s, 0.058 * s, 0.16 * s, 12), plate, r.get('arm' + side).obj, [0, 0.08 * s, 0]);
        mesh(new THREE.CylinderGeometry(0.056 * s, 0.05 * s, 0.15 * s, 12), plate, r.get('fore' + side).obj, [0, 0.14 * s, 0]);
        mesh(new THREE.CylinderGeometry(0.095 * s, 0.088 * s, 0.24 * s, 12), plate, r.get('thigh' + side).obj, [0, 0.16 * s, 0]);
        mesh(new THREE.CylinderGeometry(0.082 * s, 0.075 * s, 0.26 * s, 12), plate, r.get('shin' + side).obj, [0, 0.15 * s, 0]);
        mesh(plateGeo(0.08 * s, 0.05 * s, 0.05 * s, 0.012 * s), plate, r.get('shin' + side).obj, [0, 0.02 * s, 0.03 * s]);
      }
    },
  });
  return { rig, palette: { plate, under, accent, visor } };
}

/* ── sith acolyte (saber duelist) ────────────────────────────────────── */

export function buildAcolyte(opts = {}) {
  const S = opts.scale ?? 1.04;
  const rig = new Rig(humanoidSkeleton(S), { scale: S });
  const robe = clothMat(0x16171c, 0.94);
  const inner = clothMat(0x2a1418, 0.9);
  const leather = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.5, metalness: 0.15 });
  const skin = skinMat(opts.skinColor ?? 0xb08a72);
  const maskMat = metalMat(0x3a3d44, 0.3);
  const eye = emissiveMat(0xff2a1a, 3.4);

  dressHumanoid(rig, {
    scale: S,
    body: robe, arm: inner, leg: robe, hand: leather, boot: leather, head: skin,
    parts: { chestR: 0.158, shoulderR: 0.14, hipR: 0.132, waistR: 0.118, armR: 0.055, thighR: 0.088 },
    buildHead(headObj, s) {
      const helm = new THREE.SphereGeometry(0.113 * s, 16, 14);
      helm.scale(0.95, 1.14, 1.02); helm.translate(0, 0.10 * s, 0);
      mesh(helm, maskMat, headObj);
      mesh(plateGeo(0.085 * s, 0.03 * s, 0.02 * s, 0.008 * s), eye, headObj, [0, 0.125 * s, 0.096 * s]);
      // hood
      const hood = new THREE.SphereGeometry(0.155 * s, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.68);
      hood.scale(1, 1.05, 1.1); hood.translate(0, 0.06 * s, -0.02 * s);
      const hm = mesh(hood, robe, headObj);
      hm.material = robe;
      mesh(new THREE.ConeGeometry(0.05 * s, 0.09 * s, 8), maskMat, headObj, [0, 0.055 * s, 0.075 * s], [Math.PI / 2.4, 0, 0]);
    },
    dress(r, s) {
      const chest = r.get('chest').obj;
      for (const sx of [-1, 1]) {
        mesh(plateGeo(0.10 * s, 0.44 * s, 0.03 * s, 0.012 * s), robe, chest, [sx * 0.07 * s, 0.02 * s, 0.10 * s], [0.1, 0, sx * 0.04]);
        mesh(plateGeo(0.16 * s, 0.16 * s, 0.14 * s, 0.03 * s), leather, r.get('clav' + (sx > 0 ? 'L' : 'R')).obj, [sx * 0.05 * s, 0, 0]);
      }
      const hips = r.get('hips').obj;
      const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * s, 0.136 * s, 0.09 * s, 18, 1, true), leather);
      belt.position.y = 0.07 * s; hips.add(belt);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        mesh(plateGeo(0.135 * s, 0.52 * s, 0.02 * s, 0.01 * s), robe, hips,
          [Math.sin(a) * 0.12 * s, -0.18 * s, Math.cos(a) * 0.12 * s], [0.05, a, 0]);
      }
    },
  });
  return { rig, palette: { robe, inner, leather, skin, eye } };
}

/* ── droideka ────────────────────────────────────────────────────────── */

export function buildDroideka(opts = {}) {
  const S = opts.scale ?? 1.5;
  const group = new THREE.Group();
  const shell = armorMat(0x8f7c5e, 0.5, 0.5);
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.6, metalness: 0.7 });
  const eye = emissiveMat(0x44ff88, 3);

  const core = new THREE.Group(); group.add(core);
  core.position.y = 0.55 * S;
  mesh(new THREE.SphereGeometry(0.30 * S, 16, 12), shell, core, [0, 0, 0], null, [1, 0.85, 1]);
  const headG = new THREE.Group(); core.add(headG); headG.position.set(0, 0.24 * S, 0.05 * S);
  mesh(new THREE.SphereGeometry(0.14 * S, 12, 10), shell, headG);
  for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(0.028 * S, 8, 6), eye, headG, [sx * 0.06 * S, 0.03 * S, 0.11 * S]);
  mesh(new THREE.ConeGeometry(0.10 * S, 0.2 * S, 10), shell, headG, [0, 0.15 * S, -0.03 * S]);

  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI;
    const leg = new THREE.Group();
    leg.position.set(Math.sin(a) * 0.26 * S, 0.5 * S, Math.cos(a) * 0.26 * S);
    leg.rotation.y = a;
    group.add(leg);
    mesh(new THREE.CylinderGeometry(0.055 * S, 0.045 * S, 0.42 * S, 8), dark, leg, [0, -0.1 * S, 0.06 * S], [0.5, 0, 0]);
    const lower = new THREE.Group(); leg.add(lower);
    lower.position.set(0, -0.28 * S, 0.24 * S);
    mesh(new THREE.CylinderGeometry(0.042 * S, 0.03 * S, 0.36 * S, 8), dark, lower, [0, -0.16 * S, -0.06 * S], [-0.35, 0, 0]);
    mesh(new THREE.SphereGeometry(0.05 * S, 8, 6), shell, lower, [0, -0.32 * S, -0.12 * S]);
    legs.push({ leg, lower, angle: a });
  }

  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.3 * S, 0.62 * S, 0.05 * S);
    group.add(arm);
    mesh(new THREE.CylinderGeometry(0.06 * S, 0.05 * S, 0.34 * S, 10), dark, arm, [0, -0.05 * S, 0.14 * S], [1.25, 0, 0]);
    const barrel = mesh(new THREE.CylinderGeometry(0.045 * S, 0.05 * S, 0.28 * S, 10), shell, arm, [0, -0.06 * S, 0.34 * S], [1.5708, 0, 0]);
    const muzzle = mesh(new THREE.CylinderGeometry(0.03 * S, 0.036 * S, 0.06 * S, 8), emissiveMat(0x66ff99, 1.4),
      arm, [0, -0.06 * S, 0.48 * S], [1.5708, 0, 0]);
    arms.push({ arm, muzzle, side: sx });
  }

  // deflector shield bubble
  const shieldGeo = new THREE.SphereGeometry(1.15 * S, 24, 18);
  const shieldMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x66ddff) }, uTime: { value: 0 }, uPower: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal);
        vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uPower;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float fres = pow(1.0-abs(dot(normalize(vN),normalize(vV))), 2.4);
        float hexes = sin(vP.x*26.0)*sin(vP.y*26.0)*sin(vP.z*26.0);
        float ripple = 0.5+0.5*sin(vP.y*14.0 - uTime*4.0);
        float a = (fres*0.85 + max(hexes,0.0)*0.14 + ripple*0.05) * uPower;
        gl_FragColor = vec4(uColor*(a*2.2), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const shield = new THREE.Mesh(shieldGeo, shieldMat);
  shield.position.y = 0.75 * S;
  shield.visible = false;
  group.add(shield);

  return { group, core, headG, legs, arms, shield, shieldMat, palette: { shell, dark, eye }, scale: S };
}

/* ── spider walker (mini-boss) ───────────────────────────────────────── */

export function buildWalker(opts = {}) {
  const S = opts.scale ?? 2.4;
  const rig = new Rig(walkerSkeleton(S, 4), { scale: S });
  const shell = armorMat(0x6c6a63, 0.6, 0.45);
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2a27, roughness: 0.62, metalness: 0.8 });
  const eye = emissiveMat(0xffaa22, 3);

  const body = rig.get('body');
  const bodyGeo = plateGeo(1.1 * S, 0.5 * S, 1.5 * S, 0.12 * S);
  mesh(bodyGeo, shell, body.obj, [0, 0.1 * S, 0]);
  body.parts.push(body.obj.children[0]); body.primary = body.obj.children[0]; body.radius = 0.6 * S;
  mesh(plateGeo(0.7 * S, 0.34 * S, 0.5 * S, 0.08 * S), dark, body.obj, [0, 0.36 * S, -0.2 * S]);

  const head = rig.get('head');
  mesh(plateGeo(0.5 * S, 0.38 * S, 0.6 * S, 0.09 * S), shell, head.obj, [0, 0, 0.1 * S]);
  head.primary = head.obj.children[0]; head.parts.push(head.primary); head.radius = 0.3 * S;
  for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(0.06 * S, 8, 6), eye, head.obj, [sx * 0.14 * S, 0.05 * S, 0.32 * S]);
  const cannons = [];
  for (const sx of [-1, 1]) {
    const c = mesh(new THREE.CylinderGeometry(0.07 * S, 0.085 * S, 0.9 * S, 10), dark, head.obj,
      [sx * 0.26 * S, -0.08 * S, 0.3 * S], [1.5708, 0, 0]);
    const m = mesh(new THREE.CylinderGeometry(0.05 * S, 0.06 * S, 0.1 * S, 8), emissiveMat(0xff6622, 1.2), head.obj,
      [sx * 0.26 * S, -0.08 * S, 0.78 * S], [1.5708, 0, 0]);
    cannons.push({ barrel: c, muzzle: m });
  }

  for (let i = 0; i < 4; i++) {
    for (const [name, r0, r1] of [[`hipL${i}`, 0.13, 0.11], [`femur${i}`, 0.11, 0.085], [`tibia${i}`, 0.085, 0.055], [`tarsus${i}`, 0.055, 0.03]]) {
      const b = rig.get(name);
      if (!b) continue;
      const m = mesh(limbGeo(b.length, r0 * S, r1 * S, 8), name.startsWith('hip') ? shell : dark, b.obj);
      m.userData.limb = { r0: r0 * S, r1: r1 * S, seg: 8 };
      b.parts.push(m); b.primary = m; b.radius = r0 * S;
    }
  }
  return { rig, cannons, palette: { shell, dark, eye }, scale: S };
}

/* ── acklay-style beast (boss) ───────────────────────────────────────── */

export function buildBeast(opts = {}) {
  const S = opts.scale ?? 2.9;
  const rig = new Rig(walkerSkeleton(S, 6), { scale: S });
  const hideMat = new THREE.MeshStandardMaterial({ color: 0x6d5a4a, roughness: 0.86, metalness: 0.02 });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x8a7460, roughness: 0.62, metalness: 0.05 });
  const eye = emissiveMat(0xffdd44, 2.2);

  const body = rig.get('body');
  const bg = new THREE.SphereGeometry(0.62 * S, 18, 14);
  bg.scale(1.0, 0.82, 1.5);
  const bm = mesh(bg, shellMat, body.obj, [0, 0.1 * S, 0]);
  body.primary = bm; body.parts.push(bm); body.radius = 0.7 * S;
  // dorsal spines
  for (let i = 0; i < 7; i++) {
    mesh(new THREE.ConeGeometry(0.08 * S, 0.34 * S * (1 - Math.abs(i - 3) * 0.15), 6), shellMat, body.obj,
      [0, 0.5 * S, (i - 3) * 0.22 * S], [0.2 * (i - 3) * 0.2, 0, 0]);
  }
  const head = rig.get('head');
  const hg = new THREE.SphereGeometry(0.34 * S, 14, 12); hg.scale(0.9, 0.78, 1.5);
  const hm = mesh(hg, hideMat, head.obj, [0, 0, 0.2 * S]);
  head.primary = hm; head.parts.push(hm); head.radius = 0.4 * S;
  for (const sx of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.06 * S, 8, 6), eye, head.obj, [sx * 0.16 * S, 0.14 * S, 0.42 * S]);
    // mandibles
    mesh(new THREE.ConeGeometry(0.07 * S, 0.42 * S, 6), shellMat, head.obj,
      [sx * 0.14 * S, -0.12 * S, 0.5 * S], [1.35, 0, sx * 0.25]);
  }
  for (let i = 0; i < 6; i++) {
    for (const [name, r0, r1, mat] of [[`hipL${i}`, 0.12, 0.10, hideMat], [`femur${i}`, 0.115, 0.08, hideMat],
                                        [`tibia${i}`, 0.08, 0.05, shellMat], [`tarsus${i}`, 0.05, 0.02, shellMat]]) {
      const b = rig.get(name);
      if (!b) continue;
      const m = mesh(limbGeo(b.length, r0 * S, r1 * S, 8), mat, b.obj);
      m.userData.limb = { r0: r0 * S, r1: r1 * S, seg: 8 };
      b.parts.push(m); b.primary = m; b.radius = r0 * S;
    }
  }
  return { rig, palette: { hideMat, shellMat, eye }, scale: S };
}

/* ── weapons ─────────────────────────────────────────────────────────── */

export function buildBlaster(kind = 'e5') {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x27292e, roughness: 0.52, metalness: 0.72 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.7, metalness: 0.3 });
  const glow = emissiveMat(0xff4422, 1.6);

  if (kind === 'e5') {
    mesh(new THREE.BoxGeometry(0.042, 0.058, 0.44), body, g, [0, 0, 0.06]);
    mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.30, 8), body, g, [0, 0.026, 0.16], [1.5708, 0, 0]);
    mesh(new THREE.BoxGeometry(0.03, 0.10, 0.05), dark, g, [0, -0.07, -0.05]);
    mesh(new THREE.BoxGeometry(0.026, 0.05, 0.13), dark, g, [0, -0.03, -0.16]);
    mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.03, 8), glow, g, [0, 0.026, 0.315], [1.5708, 0, 0]);
    g.userData.muzzle = new THREE.Vector3(0, 0.026, 0.335);
  } else if (kind === 'dc15') {
    mesh(new THREE.BoxGeometry(0.05, 0.07, 0.56), body, g, [0, 0, 0.08]);
    mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.36, 10), body, g, [0, 0.03, 0.24], [1.5708, 0, 0]);
    mesh(new THREE.BoxGeometry(0.035, 0.12, 0.06), dark, g, [0, -0.08, -0.04]);
    mesh(new THREE.BoxGeometry(0.03, 0.06, 0.18), dark, g, [0, -0.02, -0.22]);
    mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.04, 8), glow, g, [0, 0.03, 0.42], [1.5708, 0, 0]);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, 0.45);
  } else { // heavy repeater
    mesh(new THREE.BoxGeometry(0.07, 0.09, 0.6), body, g, [0, 0, 0.1]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.4, 8), body, g,
        [Math.sin(a) * 0.026, 0.03 + Math.cos(a) * 0.026, 0.3], [1.5708, 0, 0]);
    }
    mesh(new THREE.BoxGeometry(0.04, 0.14, 0.07), dark, g, [0, -0.09, -0.04]);
    g.userData.muzzle = new THREE.Vector3(0, 0.03, 0.52);
  }
  g.traverse(o => { o.castShadow = true; });
  return g;
}
