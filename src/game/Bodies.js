/**
 * SABER — procedural bodies.
 *
 * Every character is generated in code and hung off a bone hierarchy, one
 * limb-mesh per bone. That is not an aesthetic choice — it is what makes
 * "cut anywhere" tractable: a limb is a tapered tube with a known length, so
 * severing it at 62 % is a matter of rebuilding two tubes and capping both.
 *
 * The tension in that design is that a tapered tube is also the easiest thing
 * in the world to make look like a length of pipe. Anatomy therefore comes
 * from three places: the radii (measured against a 1.78 m figure, not guessed),
 * a single swell placed along each shaft — bicep, forearm flexors, calf — and
 * a small number of extra masses that a lathe cannot express at all, chiefly
 * the deltoid and the hand. Those extras are merged down to one geometry each
 * so a hand with nineteen pieces in it still costs one draw call.
 */

import * as THREE from 'three';
import { Rig, humanoidSkeleton, walkerSkeleton } from './Rig.js';
import { clothMaps, armorMaps, metalMaps } from '../engine/Textures.js';
import { makeRng, lerp, clamp } from '../engine/MathUtil.js';

const rng = makeRng(5150);

/* ── geometry helpers ────────────────────────────────────────────────── */

/**
 * A tapered capsule spanning y ∈ [0, len] in bone space.
 *
 * opts.rings   — how many rings the shaft is built from (3 = the old cone)
 * opts.bulge   — height of a single smooth swell, as a fraction of the radius
 * opts.bulgeAt — where along the shaft that swell peaks (0.32 ≈ a bicep)
 * opts.capY0/1 — how far the end caps dome out, ×r. 0.62 is a hemisphere-ish
 *                ball joint; the top of a chest wants ~0.2 or the shoulders
 *                swallow the neck whole.
 */
export function limbGeo(len, r0, r1, seg = 10, cap = true, opts = {}) {
  // lathe profile: [radius, y], rounded at both ends
  const profile = [];
  const capN = cap ? (opts.capN ?? 4) : 0;
  const capY0 = opts.capY0 ?? 0.62;
  const capY1 = opts.capY1 ?? 0.62;
  const rings = Math.max(2, Math.round(opts.rings ?? 3));
  const bulge = opts.bulge ?? 0.04;
  const bulgeAt = clamp(opts.bulgeAt ?? 0.5, 0.04, 0.96);
  // The taper, times one hump that falls to zero at both ends so the shaft
  // still meets its caps at exactly r0 and r1 — otherwise the cut/rebuild path
  // in Ragdoll produces a stub that does not line up with what it came from.
  const rAt = (t) => {
    const u = t < bulgeAt ? t / bulgeAt : (1 - t) / (1 - bulgeAt);
    return lerp(r0, r1, t) * (1 + bulge * Math.sin(clamp(u, 0, 1) * Math.PI * 0.5));
  };

  // Ascending, starting AT the pole. Counting down from capN skipped i = 0
  // entirely — so the cap was left open with a hole of radius 0.38*r0 — and
  // then jumped from the last ring back out to the equator, revolving an
  // inverted cone through the cap it had just built.
  for (let i = 0; i < capN; i++) {
    const a = (i / capN) * Math.PI * 0.5;
    profile.push(new THREE.Vector2(Math.sin(a) * r0 * 0.999, -Math.cos(a) * r0 * capY0));
  }
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    profile.push(new THREE.Vector2(rAt(t), t * len));
  }
  for (let i = 1; i <= capN; i++) {
    const a = (i / capN) * Math.PI * 0.5;
    profile.push(new THREE.Vector2(Math.cos(a) * r1 * 0.999, len + Math.sin(a) * r1 * capY1));
  }
  // NB: normalizeNormals(), NOT computeVertexNormals(). The lathe already emits
  // analytically correct, seam-consistent normals; re-deriving them from face
  // normals averages per index, and since the lathe duplicates the seam column
  // each seam vertex only sees the faces on its own side — a lighting crease
  // running the full length of every arm, leg, torso and neck. The lathe does
  // leave the final profile vertex's normal unnormalized (three quirk), so
  // rescale in place without touching the directions.
  const g = new THREE.LatheGeometry(profile, seg);
  g.normalizeNormals();
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

/**
 * A closed band with a rolled edge — belts, collars, cuffs, sleeve hems.
 * Revolved about +Y, spanning y ∈ [0, h]; the inner wall is left open because
 * the limb it is worn on always fills it.
 */
export function bandGeo(r0In, r0Out, r1In, r1Out, h, seg = 16) {
  const b = Math.min(h * 0.24, Math.abs(r0Out - r0In) * 0.45, h * 0.5);
  const profile = [
    new THREE.Vector2(r0In, 0),
    new THREE.Vector2(r0Out - b * 0.55, 0),
    new THREE.Vector2(r0Out, b),
    new THREE.Vector2(r1Out, h - b),
    new THREE.Vector2(r1Out - b * 0.55, h),
    new THREE.Vector2(r1In, h),
  ];
  const g = new THREE.LatheGeometry(profile, seg);
  g.normalizeNormals();
  return g;
}

/** One finger bone: a short tapered tube, optionally domed off at the tip. */
function digitGeo(len, r0, r1, seg = 6, tip = false) {
  const p = [
    new THREE.Vector2(r0, 0),
    new THREE.Vector2(lerp(r0, r1, 0.5) * 1.04, len * 0.5),
    new THREE.Vector2(r1, len),
  ];
  if (tip) {
    p.push(new THREE.Vector2(r1 * 0.86, len + r1 * 0.52));
    p.push(new THREE.Vector2(0, len + r1 * 0.95));
  }
  const g = new THREE.LatheGeometry(p, seg);
  g.normalizeNormals();
  return g;
}

/**
 * Concatenate a list of { geo, matrix } into one indexed geometry.
 * Hands and boots are assemblies of a dozen small pieces; merging them keeps
 * a character's mesh count — and therefore its shadow-pass draw calls —
 * roughly where it was before they existed.
 */
function mergeGeos(parts) {
  let vTotal = 0, iTotal = 0;
  for (const p of parts) {
    vTotal += p.geo.attributes.position.count;
    iTotal += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }
  const pos = new Float32Array(vTotal * 3);
  const nrm = new Float32Array(vTotal * 3);
  const uvs = new Float32Array(vTotal * 2);
  const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  let vo = 0, io = 0;
  for (const p of parts) {
    const g = p.geo;
    nm.getNormalMatrix(p.matrix);
    const gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
    for (let i = 0; i < gp.count; i++) {
      v.fromBufferAttribute(gp, i).applyMatrix4(p.matrix);
      pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
      if (gn) {
        v.fromBufferAttribute(gn, i).applyMatrix3(nm);
        if (v.lengthSq() > 1e-12) v.normalize(); else v.set(0, 1, 0);
        nrm[(vo + i) * 3] = v.x; nrm[(vo + i) * 3 + 1] = v.y; nrm[(vo + i) * 3 + 2] = v.z;
      }
      if (gu) { uvs[(vo + i) * 2] = gu.getX(i); uvs[(vo + i) * 2 + 1] = gu.getY(i); }
    }
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo; io += g.index.count; }
    else { for (let i = 0; i < gp.count; i++) idx[io + i] = vo + i; io += gp.count; }
    vo += gp.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** Flatten an authoring hierarchy of un-materialled meshes into one geometry. */
function bakeTree(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const parts = [];
  group.traverse((o) => {
    if (o.isMesh && o.geometry) {
      parts.push({ geo: o.geometry, matrix: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
    }
  });
  return mergeGeos(parts);
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

/* ── hands ───────────────────────────────────────────────────────────── */

// x across the palm (×palmW), knuckle height (×palmL), length ×, radius ×, fan
const FINGER_TABLE = {
  2: [[0.190, 1.00, 1.00, 1.00, 0.10], [-0.190, 0.96, 0.92, 0.96, -0.10]],
  3: [[0.265, 0.97, 0.96, 0.99, 0.13], [0.000, 1.00, 1.00, 1.00, 0.01], [-0.265, 0.94, 0.90, 0.94, -0.13]],
  4: [[0.310, 0.95, 0.93, 0.98, 0.14], [0.105, 1.00, 1.00, 1.00, 0.04],
      [-0.105, 0.96, 0.93, 0.95, -0.06], [-0.305, 0.87, 0.76, 0.85, -0.17]],
};

/**
 * A hand — palm, thenar mound, knuckle ridge, thumb and curled fingers —
 * baked into a single geometry.
 *
 * Built in hand-bone space: +Y runs wrist → knuckles, +Z is the way the palm
 * faces, and the thumb sits on the +X side for a left hand. Everything below
 * is in metres for a 1.78 m figure: a palm is about 8.6 cm across and 7.4 cm
 * from the wrist crease to the knuckles, and a middle finger is 7.7 cm long.
 *
 * The fingers are curled by default rather than splayed, because the only
 * thing either hand ever does is close around a hilt directly under the
 * first-person camera.
 */
export function buildHand(side, S, opts = {}) {
  const tw = side === 'L' ? 1 : -1;
  const palmW = (opts.palmW ?? 0.086) * S;
  const palmL = (opts.palmL ?? 0.074) * S;
  const palmT = (opts.palmT ?? 0.030) * S;
  const fingerL = (opts.fingerL ?? 0.077) * S;
  const fingerR = (opts.fingerR ?? 0.0097) * S;
  const wristR = (opts.wristR ?? 0.028) * S;
  const curl = opts.curl ?? 1;
  const seg = opts.seg ?? 6;
  const table = FINGER_TABLE[opts.fingers ?? 4] || FINGER_TABLE[4];
  const wristY = palmT * 0.42;

  const g = new THREE.Group();
  const add = (geo, parent, pos, rot, scale) => {
    const m = new THREE.Mesh(geo);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    parent.add(m);
    return m;
  };

  // wrist — carries the forearm's taper into the heel of the hand. A wrist is
  // an ellipse, ~6cm across and ~4cm through, not a circle.
  add(limbGeo(palmT * 1.1, wristR, wristR * 1.14, 12, false, { rings: 3, bulge: 0 }), g,
    [0, -palmT * 0.5, 0], null, [1.10, 1, 0.72]);

  // palm: a slab, plus the thumb mound and the pad under the little finger,
  // which is the difference between a hand and a playing card
  add(plateGeo(palmW, palmL, palmT, palmT * 0.42, 2), g, [0, wristY + palmL * 0.5, palmT * 0.02]);
  add(new THREE.SphereGeometry(1, 8, 6), g,
    [tw * palmW * 0.27, wristY + palmL * 0.32, palmT * 0.30],
    null, [palmW * 0.20, palmL * 0.36, palmT * 0.52]);
  add(plateGeo(palmW * 0.26, palmL * 0.66, palmT * 0.80, palmT * 0.18, 1), g,
    [-tw * palmW * 0.36, wristY + palmL * 0.46, palmT * 0.06]);
  // knuckle ridge
  add(plateGeo(palmW * 0.98, palmT * 0.66, palmT * 1.04, palmT * 0.24, 1), g,
    [0, wristY + palmL * 0.97, palmT * 0.10]);

  for (const [ox, hy, lf, rf, fan] of table) {
    const root = new THREE.Group();
    root.position.set(tw * ox * palmW, wristY + palmL * hy, palmT * 0.16);
    root.rotation.z = -tw * fan;
    root.rotation.x = 1.24 * curl;
    g.add(root);
    const L = fingerL * lf, R = fingerR * rf;
    const l1 = L * 0.42, l2 = L * 0.33, l3 = L * 0.25;
    add(digitGeo(l1, R, R * 0.94, seg, false), root);
    const mid = new THREE.Group();
    mid.position.y = l1 * 0.93; mid.rotation.x = 1.02 * curl; root.add(mid);
    add(digitGeo(l2, R * 0.95, R * 0.86, seg, false), mid);
    const dis = new THREE.Group();
    dis.position.y = l2 * 0.93; dis.rotation.x = 0.60 * curl; mid.add(dis);
    add(digitGeo(l3, R * 0.87, R * 0.74, seg, true), dis);
  }

  if (opts.thumb !== false) {
    const tr = fingerR * 1.34;
    const th1 = new THREE.Group();
    th1.position.set(tw * palmW * 0.38, wristY + palmL * 0.14, palmT * 0.14);
    th1.rotation.z = -tw * 0.66;
    th1.rotation.x = 0.30;
    g.add(th1);
    const th2 = new THREE.Group();
    th2.rotation.x = 0.55 * curl; th1.add(th2);
    const tl = fingerL * 0.50;
    add(digitGeo(tl, tr, tr * 0.90, seg, false), th2);
    const th3 = new THREE.Group();
    th3.position.y = tl * 0.93; th3.rotation.x = 0.80 * curl; th2.add(th3);
    add(digitGeo(fingerL * 0.40, tr * 0.90, tr * 0.72, seg, true), th3);
  }

  return bakeTree(g);
}

/* ── feet ────────────────────────────────────────────────────────────── */

/**
 * A boot.
 *
 * Beware the foot bone's frame: the gait solver aims it with world-up as the
 * roll reference, which lands local +Y forward along the foot and local +Z
 * pointing **down**. So the sole plane is z = +0.062·S — six centimetres
 * below the ankle, which is exactly the offset the animator plants the ankle
 * at. Anything that grows toward +Z past that sinks through the floor; the
 * instep and the ankle collar therefore live at negative z.
 */
function buildFoot(S, opts = {}) {
  const w = (opts.w ?? 0.088) * S;
  const len = (opts.len ?? 0.20) * S;
  const h = (opts.h ?? 0.10) * S;
  const g = new THREE.Group();
  const add = (geo, pos) => {
    const m = new THREE.Mesh(geo);
    m.position.set(pos[0], pos[1], pos[2]);
    g.add(m);
  };
  // the body of the boot — unchanged in extent, so the soles still land flat
  add(plateGeo(w, len, h, 0.024 * S, 2), [0, len * 0.45, h * 0.12]);
  // a flat sole. The body alone is a pillow rounded at r=0.024, so it met the
  // ground at a single point; this puts a hard, near-flat plate on the bottom.
  add(plateGeo(w * 0.99, len * 0.97, h * 0.18, 0.008 * S, 2), [0, len * 0.45, h * 0.53]);
  // ankle collar rising off the heel (negative z is up)
  add(plateGeo(w * 0.84, len * 0.38, h * 0.74, 0.016 * S, 1), [0, len * 0.11, -h * 0.24]);
  // toe box tapering off the front, and a heel counter
  add(plateGeo(w * 0.84, len * 0.26, h * 0.62, 0.014 * S, 1), [0, len * 0.86, h * 0.14]);
  add(plateGeo(w * 0.82, len * 0.24, h * 0.66, 0.012 * S, 1), [0, len * 0.05, h * 0.08]);
  return bakeTree(g);
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
  const SEG = style.seg || {};

  const addLimb = (boneName, r0, r1, mat, opts = {}) => {
    const b = rig.get(boneName);
    if (!b) return null;
    const seg = opts.seg ?? 10;
    const geo = limbGeo(b.length, r0 * S, r1 * S, seg, opts.cap !== false, opts);
    const m = mesh(geo, mat, b.obj);
    if (opts.squash) m.scale.set(1, 1, opts.squash);
    m.userData.limb = { r0: r0 * S, r1: r1 * S, seg };
    b.parts.push(m);
    b.radius = Math.max(r0, r1) * S;
    b.primary = m;
    return m;
  };

  // ── torso ──────────────────────────────────────────────────────────
  // A revolved torso is a barrel, and a barrel is most of what reads as
  // "not a person" at a glance: a real chest is about 32cm across and 22cm
  // deep. The lathe stays circular and the mesh is squashed on Z instead, so
  // the cut capsules (which take max(r0,r1)) are unaffected.
  const depth = P.torsoDepth ?? 0.76;
  const torsoSeg = SEG.torso ?? 14;
  addLimb('hips', P.hipR ?? 0.135, P.waistR ?? 0.125, style.body,
    { seg: torsoSeg, rings: 4, bulge: 0.05, bulgeAt: 0.25, squash: depth });
  addLimb('spine', P.waistR ?? 0.125, P.chestR ?? 0.155, style.body,
    { seg: torsoSeg, rings: 4, bulge: 0.03, bulgeAt: 0.7, squash: depth });
  // capY1: the chest's top cap is the shoulder line. Domed at the default 0.62
  // it stood 8.8cm proud of the shoulder joint — swallowing the entire neck and
  // meeting the underside of the skull, which is why the head looked bolted on.
  addLimb('chest', P.chestR ?? 0.155, P.shoulderR ?? 0.135, style.body,
    { seg: torsoSeg, rings: 4, bulge: 0.04, bulgeAt: 0.35, squash: depth, capY1: P.shoulderDome ?? 0.16 });
  addLimb('neck', P.neckR ?? 0.062, (P.neckR ?? 0.062) * 0.84, style.skin || style.body,
    { seg: SEG.neck ?? 12, rings: 3, bulge: 0 });

  // head
  const head = rig.get('head');
  if (head) {
    const hg = new THREE.SphereGeometry(0.105 * S, 18, 14);
    hg.scale(0.94, 1.16, 1.03);
    hg.translate(0, 0.10 * S, 0);
    const hm = mesh(hg, style.head || style.skin || style.body, head.obj);
    head.parts.push(hm); head.primary = hm; head.radius = 0.12 * S;
    if (style.buildHead) style.buildHead(head.obj, S);
  }

  // ── arms ───────────────────────────────────────────────────────────
  // Measured off a 1.78m figure: the upper arm is ~4.5cm at the deltoid and
  // ~3.5cm at the elbow, the forearm ~4cm below the elbow tapering to ~2.8cm
  // at the wrist. What was here before ran 5.5cm → 3.9cm in one near-constant
  // sweep with no elbow at all. The forearm's r0 being wider than the upper
  // arm's r1 is deliberate: that step, plus the two lathe caps meeting inside
  // it, is the elbow.
  const armR = P.armR ?? 0.046;
  const clavR = P.clavR ?? 0.062;
  const armSeg = SEG.arm ?? 16;
  for (const side of ['L', 'R']) {
    addLimb('clav' + side, clavR, clavR * 0.72, style.body, { seg: SEG.clav ?? 10, rings: 3, bulge: 0.02 });
    addLimb('arm' + side, armR, armR * 0.77, style.arm || style.body,
      { seg: armSeg, rings: 5, bulge: 0.10, bulgeAt: 0.30 });
    addLimb('fore' + side, armR * 0.89, armR * 0.61, style.arm || style.body,
      { seg: armSeg, rings: 5, bulge: 0.13, bulgeAt: 0.22 });

    // The deltoid rides the humerus, not the clavicle, so it rolls with the
    // shoulder the way it does on a body. It is also what puts the figure's
    // shoulders out past its ribcage — the clavicle bone only reaches 16cm.
    if (style.deltoid !== false) {
      const ab = rig.get('arm' + side);
      if (ab) {
        mesh(new THREE.SphereGeometry(1, 12, 8), style.arm || style.body, ab.obj,
          [0, armR * 0.78 * S, 0], null,
          [armR * 1.38 * S, armR * 1.55 * S, armR * 1.22 * S]);
      }
    }

    const hand = rig.get('hand' + side);
    if (hand) {
      const m = mesh(buildHand(side, S, style.hands || {}), style.hand || style.arm || style.body, hand.obj);
      hand.parts.push(m); hand.primary = m; hand.radius = 0.05 * S;
    }
  }

  // ── legs ───────────────────────────────────────────────────────────
  const thighR = P.thighR ?? 0.088;
  for (const side of ['L', 'R']) {
    addLimb('thigh' + side, thighR, thighR * 0.72, style.leg || style.body,
      { seg: SEG.leg ?? 10, rings: 4, bulge: 0.07, bulgeAt: 0.28 });
    addLimb('shin' + side, thighR * 0.82, thighR * 0.44, style.leg || style.body,
      { seg: SEG.leg ?? 10, rings: 5, bulge: 0.17, bulgeAt: 0.18 });
    const foot = rig.get('foot' + side);
    if (foot) {
      const m = mesh(buildFoot(S, style.feet || {}), style.boot || style.leg || style.body, foot.obj);
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
    // armR is the humerus at the deltoid; everything else on the arm is derived
    // from it, so 0.045 lands the arm at 4.5→3.5cm and the forearm at 4.0→2.7cm.
    parts: { chestR: 0.162, shoulderR: 0.138, hipR: 0.138, waistR: 0.122,
             armR: 0.045, clavR: 0.062, thighR: 0.088, neckR: 0.060, torsoDepth: 0.76 },
    hands: { curl: 0.95 },
    buildHead(headObj, s) {
      // brow, jaw, eyes, hair — small pieces, but they carry the silhouette
      const jaw = new THREE.SphereGeometry(0.082 * s, 12, 10);
      jaw.scale(0.92, 0.74, 1.06); jaw.translate(0, 0.048 * s, 0.012 * s);
      mesh(jaw, skin, headObj);
      for (const sx of [-1, 1]) {
        mesh(new THREE.SphereGeometry(0.0165 * s, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.28 }),
          headObj, [sx * 0.035 * s, 0.105 * s, 0.079 * s]);
        mesh(new THREE.SphereGeometry(0.0082 * s, 6, 5), new THREE.MeshStandardMaterial({ color: 0x2c1d12, roughness: 0.2 }),
          headObj, [sx * 0.036 * s, 0.104 * s, 0.090 * s]);
        mesh(plateGeo(0.034 * s, 0.007 * s, 0.012 * s, 0.003 * s, 1), hair,
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
      // a short braid, because of course — one tapered strand rather than the
      // five spheres it used to be, which cost 400 triangles on their own
      const braid = new THREE.Group(); headObj.add(braid);
      braid.position.set(0.085 * s, 0.09 * s, 0.02 * s);
      braid.rotation.set(0.12, 0, 0.16);
      mesh(limbGeo(0.115 * s, 0.013 * s, 0.008 * s, 7, true, { rings: 5, bulge: 0.22, bulgeAt: 0.5, capN: 2 }),
        hair, braid, [0, -0.115 * s, 0]);
    },
    dress(r, s) {
      const chest = r.get('chest').obj;
      const hips = r.get('hips').obj;
      const neck = r.get('neck');

      // tabards over the shoulders
      for (const sx of [-1, 1]) {
        const tab = plateGeo(0.085 * s, 0.40 * s, 0.028 * s, 0.012 * s);
        mesh(tab, outer, chest, [sx * 0.062 * s, 0.055 * s, 0.088 * s], [0.14, sx * 0.06, sx * 0.05]);
        const tabBack = plateGeo(0.10 * s, 0.34 * s, 0.026 * s, 0.012 * s);
        mesh(tabBack, outer, chest, [sx * 0.055 * s, 0.06 * s, -0.088 * s], [-0.1, 0, sx * 0.04]);
      }
      // the V of the crossed tunic
      for (const sx of [-1, 1]) {
        mesh(plateGeo(0.13 * s, 0.24 * s, 0.02 * s, 0.01 * s), trim, chest,
          [sx * 0.045 * s, 0.09 * s, 0.098 * s], [0.1, 0, sx * 0.38]);
      }
      // collar — rides the neck so it clears the shoulder line and gives the
      // head something to sit in rather than on
      if (neck) {
        mesh(bandGeo(0.058 * s, 0.064 * s, 0.072 * s, 0.100 * s, 0.062 * s, 14), trim, neck.obj,
          [0, -0.020 * s, 0], [0.10, 0, 0]);
      }
      // obi / belt — a rolled band, not an open cylinder you can see through
      mesh(bandGeo(0.126 * s, 0.146 * s, 0.124 * s, 0.142 * s, 0.105 * s, 18), trim, hips,
        [0, 0.022 * s, 0], null, [1, 1, 0.82]);
      mesh(plateGeo(0.062 * s, 0.05 * s, 0.02 * s, 0.008 * s), metalMat(0x9a8a6a), hips,
        [0, 0.075 * s, 0.115 * s]);
      // pouches
      for (const sx of [-1, 1]) mesh(plateGeo(0.05 * s, 0.055 * s, 0.035 * s, 0.01 * s), leather, hips,
        [sx * 0.105 * s, 0.055 * s, 0.075 * s]);
      // skirt panels of the robe
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const panel = plateGeo(0.13 * s, 0.42 * s, 0.022 * s, 0.01 * s);
        const m = mesh(panel, outer, hips,
          [Math.sin(a) * 0.108 * s, -0.13 * s, Math.cos(a) * 0.092 * s], [0.06, a, 0]);
        m.userData.skirt = { angle: a, index: i };
      }
      // boots
      for (const side of ['L', 'R']) {
        const sh = r.get('shin' + side);
        if (sh) mesh(bandGeo(0.055 * s, 0.080 * s, 0.050 * s, 0.070 * s, 0.20 * s, 12), leather, sh.obj, [0, 0.20 * s, 0]);
      }
      // bracers, and the hem of the robe's sleeve above them
      for (const side of ['L', 'R']) {
        const f = r.get('fore' + side);
        if (!f) continue;
        mesh(bandGeo(0.040 * s, 0.055 * s, 0.034 * s, 0.049 * s, 0.135 * s, 12), leather, f.obj, [0, 0.105 * s, 0]);
        mesh(bandGeo(0.040 * s, 0.050 * s, 0.044 * s, 0.070 * s, 0.055 * s, 12), tunic, f.obj, [0, 0.030 * s, 0]);
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
    // a B1 is a rack of struts — no muscle, and its own shoulder ball below
    deltoid: false,
    parts: { chestR: 0.115, shoulderR: 0.085, hipR: 0.075, waistR: 0.062,
             armR: 0.030, clavR: 0.040, thighR: 0.046, neckR: 0.034, torsoDepth: 0.72,
             shoulderDome: 0.35 },
    seg: { torso: 12, arm: 12, leg: 8, clav: 8, neck: 8 },
    hands: { fingers: 3, palmW: 0.050, palmL: 0.054, palmT: 0.019, fingerL: 0.060,
             fingerR: 0.0070, wristR: 0.019, curl: 0.55, seg: 5 },
    feet: { w: 0.070, len: 0.19, h: 0.085 },
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
        mesh(plateGeo(0.012 * s, 0.075 * s, 0.03 * s, 0.005 * s, 1), shell, headObj,
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
    parts: { chestR: 0.21, shoulderR: 0.175, hipR: 0.14, waistR: 0.125,
             armR: 0.072, clavR: 0.095, thighR: 0.095, neckR: 0.070, torsoDepth: 0.86,
             shoulderDome: 0.30 },
    seg: { torso: 12, arm: 12, leg: 10, clav: 8, neck: 8 },
    hands: { fingers: 3, palmW: 0.098, palmL: 0.086, palmT: 0.042, fingerL: 0.080,
             fingerR: 0.0155, wristR: 0.036, curl: 0.85, seg: 6 },
    feet: { w: 0.098, len: 0.21, h: 0.115 },
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
    parts: { chestR: 0.145, shoulderR: 0.128, hipR: 0.125, waistR: 0.112,
             armR: 0.050, clavR: 0.060, thighR: 0.088, neckR: 0.062, torsoDepth: 0.78 },
    // gauntlets: a little bulkier than bare hands, and firmly closed
    hands: { palmW: 0.092, palmL: 0.076, palmT: 0.034, fingerR: 0.0107, wristR: 0.031, curl: 0.95 },
    feet: { w: 0.094, len: 0.205, h: 0.11 },
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
      // neck seal, so the helmet is not floating over a gap
      const neck = r.get('neck');
      if (neck) mesh(bandGeo(0.056 * s, 0.070 * s, 0.062 * s, 0.082 * s, 0.062 * s, 12), plate, neck.obj, [0, -0.020 * s, 0]);
      const hips = r.get('hips').obj;
      mesh(plateGeo(0.24 * s, 0.13 * s, 0.17 * s, 0.035 * s), plate, hips, [0, 0.04 * s, 0]);
      mesh(plateGeo(0.13 * s, 0.20 * s, 0.04 * s, 0.015 * s), plate, hips, [0, -0.12 * s, 0.10 * s]);
      for (const side of ['L', 'R']) {
        mesh(plateGeo(0.13 * s, 0.13 * s, 0.14 * s, 0.03 * s), plate, r.get('clav' + side).obj, [0, 0.05 * s, 0]);
        // pauldron / rerebrace / vambrace as tapered shells rather than pipes
        mesh(bandGeo(0.050 * s, 0.066 * s, 0.043 * s, 0.058 * s, 0.17 * s, 12), plate, r.get('arm' + side).obj, [0, 0.02 * s, 0]);
        mesh(bandGeo(0.044 * s, 0.058 * s, 0.033 * s, 0.046 * s, 0.19 * s, 12), plate, r.get('fore' + side).obj, [0, 0.055 * s, 0]);
        mesh(bandGeo(0.082 * s, 0.100 * s, 0.070 * s, 0.086 * s, 0.26 * s, 12), plate, r.get('thigh' + side).obj, [0, 0.05 * s, 0]);
        mesh(bandGeo(0.062 * s, 0.082 * s, 0.048 * s, 0.066 * s, 0.28 * s, 12), plate, r.get('shin' + side).obj, [0, 0.04 * s, 0]);
        mesh(plateGeo(0.08 * s, 0.05 * s, 0.05 * s, 0.012 * s, 1), plate, r.get('shin' + side).obj, [0, 0.02 * s, 0.03 * s]);
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
  // the cowl is an open shell — it has to be lit from the inside too
  const hoodMat = clothMat(0x121317, 0.95);
  hoodMat.side = THREE.DoubleSide;

  dressHumanoid(rig, {
    scale: S,
    body: robe, arm: inner, leg: robe, hand: leather, boot: leather, head: skin,
    parts: { chestR: 0.158, shoulderR: 0.136, hipR: 0.132, waistR: 0.118,
             armR: 0.048, clavR: 0.062, thighR: 0.090, neckR: 0.060, torsoDepth: 0.76 },
    hands: { curl: 1.0 },
    buildHead(headObj, s) {
      const helm = new THREE.SphereGeometry(0.113 * s, 16, 14);
      helm.scale(0.95, 1.14, 1.02); helm.translate(0, 0.10 * s, 0);
      mesh(helm, maskMat, headObj);
      mesh(plateGeo(0.085 * s, 0.03 * s, 0.02 * s, 0.008 * s), eye, headObj, [0, 0.125 * s, 0.096 * s]);
      // Hood — an open cowl with a rolled rim and a peak, rather than a
      // hemisphere pulled over the skull like a swim cap. Three's sphere puts
      // phi=0 at -X and phi=π/2 at +Z, so the shell has to start at 0.8π for
      // the 72° opening to land on the face rather than over one ear.
      const cowl = new THREE.SphereGeometry(0.138 * s, 14, 11,
        Math.PI * 0.80, Math.PI * 1.40, 0, Math.PI * 0.70);
      cowl.scale(1.02, 1.08, 1.12);
      cowl.translate(0, 0.055 * s, -0.022 * s);
      mesh(cowl, hoodMat, headObj);
      // the rim of the opening, thickened so it reads as cloth
      mesh(new THREE.TorusGeometry(0.108 * s, 0.016 * s, 5, 16), hoodMat, headObj,
        [0, 0.100 * s, 0.022 * s], [-0.34, 0, 0]);
      // the peak that falls down the back
      mesh(limbGeo(0.125 * s, 0.072 * s, 0.020 * s, 10, true, { rings: 4, bulge: 0.14, capN: 2 }), hoodMat, headObj,
        [0, 0.140 * s, -0.068 * s], [-2.25, 0, 0]);
      mesh(new THREE.ConeGeometry(0.05 * s, 0.09 * s, 8), maskMat, headObj, [0, 0.055 * s, 0.075 * s], [Math.PI / 2.4, 0, 0]);
    },
    dress(r, s) {
      const chest = r.get('chest').obj;
      for (const sx of [-1, 1]) {
        mesh(plateGeo(0.10 * s, 0.44 * s, 0.03 * s, 0.012 * s), robe, chest, [sx * 0.07 * s, 0.02 * s, 0.090 * s], [0.1, 0, sx * 0.04]);
        mesh(plateGeo(0.16 * s, 0.16 * s, 0.14 * s, 0.03 * s), leather, r.get('clav' + (sx > 0 ? 'L' : 'R')).obj, [0, 0.05 * s, 0]);
      }
      // mantle across the shoulders — the cowl has to come from somewhere.
      // It rides the chest, since that is the only bone wide enough to carry
      // a shoulder line; on the neck it would have been swallowed whole.
      mesh(bandGeo(0.120 * s, 0.170 * s, 0.086 * s, 0.118 * s, 0.150 * s, 14), robe, chest,
        [0, 0.092 * s, 0], null, [1, 1, 0.80]);
      const hips = r.get('hips').obj;
      mesh(bandGeo(0.124 * s, 0.142 * s, 0.122 * s, 0.138 * s, 0.095 * s, 16), leather, hips,
        [0, 0.024 * s, 0], null, [1, 1, 0.82]);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        mesh(plateGeo(0.135 * s, 0.52 * s, 0.02 * s, 0.01 * s), robe, hips,
          [Math.sin(a) * 0.115 * s, -0.18 * s, Math.cos(a) * 0.096 * s], [0.05, a, 0]);
      }
      // sleeve hems
      for (const side of ['L', 'R']) {
        const f = r.get('fore' + side);
        if (f) mesh(bandGeo(0.040 * s, 0.050 * s, 0.044 * s, 0.072 * s, 0.060 * s, 12), robe, f.obj, [0, 0.024 * s, 0]);
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
    for (const [name, r0, r1, bulge] of [[`hipL${i}`, 0.13, 0.11, 0.06], [`femur${i}`, 0.11, 0.085, 0.10],
                                          [`tibia${i}`, 0.085, 0.055, 0.08], [`tarsus${i}`, 0.055, 0.03, 0.04]]) {
      const b = rig.get(name);
      if (!b) continue;
      const m = mesh(limbGeo(b.length, r0 * S, r1 * S, 8, true, { rings: 4, bulge, bulgeAt: 0.28 }),
        name.startsWith('hip') ? shell : dark, b.obj);
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
    for (const [name, r0, r1, mat, bulge] of [[`hipL${i}`, 0.12, 0.10, hideMat, 0.08], [`femur${i}`, 0.115, 0.08, hideMat, 0.14],
                                              [`tibia${i}`, 0.08, 0.05, shellMat, 0.10], [`tarsus${i}`, 0.05, 0.02, shellMat, 0.05]]) {
      const b = rig.get(name);
      if (!b) continue;
      const m = mesh(limbGeo(b.length, r0 * S, r1 * S, 8, true, { rings: 4, bulge, bulgeAt: 0.26 }), mat, b.obj);
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
