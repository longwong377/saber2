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
import { Rig, humanoidSkeleton, walkerSkeleton, aimY } from './Rig.js';
import { clothMaps, armorMaps, metalMaps, duracreteMaps, skinMaps, MEAN_ALBEDO } from '../engine/Textures.js';
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
  if (opts.section) reshape(g, opts.section, len);
  return g;
}

/**
 * Bend a lathe's circular plan into a real cross-section.
 *
 * A body of revolution is a barrel, and a barrel is most of what still read as
 * "not a person" once the radii were right: a ribcage is a rounded rectangle
 * about 32cm across and 22 deep, a shin is flat down the front of the tibia and
 * carries the whole calf behind it, and a forearm is an oval. Squashing the
 * mesh on Z — which is what the torsos did — only ever gets you an ellipse,
 * whichever way you scale it.
 *
 * `sect(theta, t)` returns a radius multiplier, theta measured from +Z (front,
 * the way the character faces) and t running 0→1 up the shaft.
 *
 * The normals are transported through the deformation analytically rather than
 * recomputed. computeVertexNormals() would average per index, and the lathe
 * duplicates its seam column, so every seam vertex would only see the faces on
 * its own side — a lighting crease down the front of every torso. In the
 * cylindrical frame the map is r' = s(θ)·r, so the Jacobian is [[s, s'],[0, s]]
 * on (radial, tangential) and the normal picks up the off-diagonal term:
 * wherever the section changes width the surface tilts, which is precisely
 * what makes a flat back read as flat instead of as a dark side of a cylinder.
 */
function reshape(g, sect, len) {
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const h = 1e-3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-9) continue;                 // the cap poles stay on the axis
    const th = Math.atan2(x, z);
    const t = len > 1e-9 ? clamp(y / len, 0, 1) : 0;
    const s = sect(th, t);
    pos.setXYZ(i, x * s, y, z * s);
    const ds = (sect(th + h, t) - sect(th - h, t)) / (2 * h);
    const erx = x / r, erz = z / r;         // radial unit
    const eux = erz, euz = -erx;            // tangential unit, dθ increasing
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    const nr = nx * erx + nz * erz, nu = nx * eux + nz * euz;
    const nr2 = nr / s, nu2 = -nr * ds / (s * s) + nu / s;
    const ox = nr2 * erx + nu2 * eux, oz = nr2 * erz + nu2 * euz;
    const l = Math.hypot(ox, ny, oz) || 1;
    nrm.setXYZ(i, ox / l, ny / l, oz / l);
  }
  pos.needsUpdate = true; nrm.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/**
 * The plan section of a torso: a rounded rectangle, not an ellipse.
 *
 * `n` is the superellipse exponent — 2 is the circle the lathe already makes,
 * 3 fills the corners out about 9% while leaving the width and the depth
 * exactly where they were, which is what a ribcage or a chest plate does.
 * `back` flattens the rear half (a spine is a groove between two erector
 * masses, not the front of the chest mirrored) and `keel` is the sternum or
 * chest-plate crown that catches the light down the centre line.
 */
function bodySection(o = {}) {
  const n0 = o.n0 ?? 2.2, n1 = o.n1 ?? 3.0;
  const back = o.back ?? 0.05, keel = o.keel ?? 0.02;
  const waist = o.waist ?? 0;              // flank pinch, peaking mid-shaft
  return (th, t) => {
    const n = lerp(n0, n1, t);
    const si = Math.abs(Math.sin(th)), co = Math.abs(Math.cos(th));
    let r = Math.pow(Math.pow(si, n) + Math.pow(co, n), -1 / n);
    const c = Math.cos(th);                 // +1 dead ahead, -1 behind
    if (back) r *= 1 - back * Math.max(0, -c) ** 1.6;
    if (keel) r *= 1 + keel * Math.max(0, c) ** 3;
    if (waist) r *= 1 - waist * si ** 2 * Math.sin(clamp(t, 0, 1) * Math.PI);
    return r;
  };
}

/**
 * The plan section of a lower leg. The tibia's front edge is a hard flat ridge
 * you can feel through the skin; everything behind it is calf. Without this a
 * shin is a cone, which is what the troopers' legs read as from thirty metres —
 * two black pipes with a white cuff.
 */
function calfSection(o = {}) {
  const flat = o.flat ?? 0.10, mass = o.mass ?? 0.26, at = o.at ?? 0.30;
  return (th, t) => {
    const c = Math.cos(th);
    const u = (clamp(t, 0, 1) - at) / 0.34;
    const swell = Math.exp(-(u * u));
    return (1 - flat * Math.max(0, c) ** 2) * (1 + mass * Math.max(0, -c) ** 1.4 * swell);
  };
}

/** An oval limb — forearms, and any sleeve that has to match one. */
function ovalSection(depth = 0.86, n = 2.4) {
  return (th) => {
    const si = Math.abs(Math.sin(th)), co = Math.abs(Math.cos(th));
    const r = Math.pow(Math.pow(si, n) + Math.pow(co, n), -1 / n);
    return r * (depth + (1 - depth) * si * si);
  };
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

/* ── greebles ────────────────────────────────────────────────────────── */

// A domed rivet is eight triangles as an octahedron and thirty-six as a
// sphere, and at the ranges these are read at nobody can tell the two apart.
// They are built once and re-used from the matrix stack, so a shoulder with
// twenty fasteners on it costs 160 triangles and no extra allocation.
const _rivetGeo = new THREE.OctahedronGeometry(1, 0);

/** A domed fastener head, radius r, standing h proud of whatever it is on. */
function rivet(r, h = r * 0.55) {
  const g = _rivetGeo.clone();
  g.scale(r, h, r);
  return g;
}

/** A hex-headed bolt — for the pieces the camera actually gets close to. */
function boltGeo(r, h) {
  return new THREE.CylinderGeometry(r, r * 1.06, h, 6);
}

/**
 * A hydraulic ram: a fat housing with a thin polished rod sliding out of it.
 * Returned as two geometries so the rod can take the bright metal.
 */
function ramGeo(len, rBody, rRod, ext = 0.45) {
  const bodyLen = len * (1 - ext);
  const body = new THREE.CylinderGeometry(rBody, rBody * 1.12, bodyLen, 8);
  body.translate(0, bodyLen * 0.5 - len * 0.5, 0);
  const rod = new THREE.CylinderGeometry(rRod, rRod, len * ext * 1.12, 6);
  rod.translate(0, len * 0.5 - len * ext * 0.5, 0);
  return { body, rod };
}

/**
 * A louvred vent: n slats standing proud of a recessed backing plate, spanning
 * w across and h up. The slats are what read; the backing is what stops you
 * seeing into the hull through them.
 */
function ventGeo(w, h, d, n = 4) {
  const parts = [];
  const back = plateGeo(w, h, d * 0.5, d * 0.12, 1);
  parts.push({ geo: back, matrix: new THREE.Matrix4().makeTranslation(0, 0, -d * 0.28) });
  const pitch = h / n;
  for (let i = 0; i < n; i++) {
    const g = plateGeo(w * 0.94, pitch * 0.46, d, d * 0.2, 1);
    parts.push({ geo: g, matrix: new THREE.Matrix4().makeTranslation(0, (i + 0.5) * pitch - h * 0.5, 0) });
  }
  return mergeGeos(parts);
}

/**
 * A curved armour plate: an arc of a tapered sleeve with real thickness.
 *
 * A flat slab laid on a round limb reads as a strip of gaffer tape, which is
 * exactly what every droid's knee and elbow armour looked like. This wraps.
 * It spans y ∈ [0, h] and φ ∈ [-arc/2, +arc/2] about +Z, so the plate faces
 * forward at φ = 0; r0/r1 are the inner radii at the bottom and the top.
 *
 * Six faces, all closed, 8·seg + 4 triangles — 52 at seg 6.
 */
function arcGeo(r0, r1, h, arc, thick = 0.01, seg = 6) {
  const n = Math.max(2, Math.round(seg));
  // cross-section corners as [radial offset, height fraction], anticlockwise
  const corner = [[0, 0], [thick, 0], [thick, 1], [0, 1]];
  const pos = [], uv = [], idx = [];
  const P = (i, k) => {
    const a = -arc / 2 + (i / n) * arc;
    const r = lerp(r0, r1, corner[k][1]) + corner[k][0];
    return [Math.sin(a) * r, corner[k][1] * h, Math.cos(a) * r];
  };
  let base = 0;
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    for (let i = 0; i <= n; i++) {
      pos.push(...P(i, k), ...P(i, k2));
      uv.push(i / n, 0, i / n, 1);
    }
    for (let i = 0; i < n; i++) {
      const o = base + i * 2;
      idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
    base += (n + 1) * 2;
  }
  // the two ends of the arc, wound opposite ways so both face outward
  for (const [i, near] of [[0, true], [n, false]]) {
    for (let k = 0; k < 4; k++) { pos.push(...P(i, k)); uv.push(k & 1 ? 1 : 0, k > 1 ? 1 : 0); }
    if (near) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    base += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A claw, tusk or mandible: a tapered tube swept along an arc so it curves
 * instead of pointing. `bend` is the total turn in radians over its length.
 */
function clawGeo(len, r0, r1, bend, seg = 6, rings = 5) {
  const parts = [];
  const step = len / rings;
  const m = new THREE.Matrix4();
  const cur = new THREE.Matrix4();
  for (let i = 0; i < rings; i++) {
    const t0 = i / rings, t1 = (i + 1) / rings;
    const g = limbGeo(step * 1.06, lerp(r0, r1, t0), lerp(r0, r1, t1), seg, i === rings - 1,
      { rings: 2, bulge: 0, capN: 2, capY0: 0, capY1: 0.9 });
    parts.push({ geo: g, matrix: cur.clone() });
    cur.multiply(m.makeTranslation(0, step, 0)).multiply(m.makeRotationX(bend / rings));
  }
  return mergeGeos(parts);
}

/* ── build-time surface probing ──────────────────────────────────────── */

const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3();
const _pe1 = new THREE.Vector3(), _pe2 = new THREE.Vector3();
const _pp = new THREE.Vector3(), _pt = new THREE.Vector3(), _pq = new THREE.Vector3();
const _ZERO = new THREE.Vector3();

/**
 * Where a ray leaves a shell.
 *
 * Every feature that has ever gone missing in this file went missing the same
 * way: an offset was eyeballed against a scaled, translated ellipsoid and
 * landed a centimetre inside it — the player's whole face, the trooper's
 * T-visor, the acolyte's eye bar. This answers the question outright. Fire a
 * ray from the shell's centre and get the point where it exits, so visors,
 * photoreceptors, grilles and vents sit ON the surface by construction rather
 * than by arithmetic nobody checks.
 *
 * Möller–Trumbore, both faces. `far` picks the LAST exit rather than the
 * first, which is the difference between "where does this piece end" and
 * "where does the whole head end". A head shell is a union of overlapping
 * ellipsoids and boxes, and a ray leaving a point inside three of them exits
 * the smallest one first: probed with the nearest hit, the player's eyes,
 * brows and lips all seated on the inside wall of the nose, 5cm behind the
 * face. Anything seating a feature on the outside of an assembly wants `far`;
 * onLimb, which probes a single closed lathe, does not care.
 *
 * It runs over a few hundred triangles at build time and costs nothing at
 * runtime.
 */
export function surfacePoint(geo, dir, origin = _ZERO, out = new THREE.Vector3(), far = false) {
  const pos = geo.attributes.position, idx = geo.index;
  const n = idx ? idx.count : pos.count;
  const d = _pp.copy(dir).normalize();
  let best = far ? -Infinity : Infinity;
  for (let i = 0; i + 2 < n; i += 3) {
    _pa.fromBufferAttribute(pos, idx ? idx.getX(i) : i);
    _pb.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1);
    _pc.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2);
    _pe1.subVectors(_pb, _pa); _pe2.subVectors(_pc, _pa);
    _pq.crossVectors(d, _pe2);
    const det = _pe1.dot(_pq);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    _pt.subVectors(origin, _pa);
    const u = _pt.dot(_pq) * inv;
    if (u < 0 || u > 1) continue;
    _pq.crossVectors(_pt, _pe1);
    const v = d.dot(_pq) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = _pe2.dot(_pq) * inv;
    if (t > 1e-6 && (far ? t > best : t < best)) best = t;
  }
  if (!isFinite(best)) return null;
  return out.copy(origin).addScaledVector(d, best);
}

/**
 * Seat a feature on a shell: returns [x, y, z] for the point `dir` degrees
 * around from the shell's centre, pushed `sink` metres back along the ray so
 * the feature is set INTO the surface rather than floating over it. Negative
 * sink stands it proud.
 */
function onSurface(geo, dir, sink = 0, origin = _ZERO) {
  const p = surfacePoint(geo, dir, origin, new THREE.Vector3(), true);
  if (!p) return [origin.x, origin.y, origin.z];
  const d = _pp.copy(dir).normalize();
  return [p.x - d.x * sink, p.y - d.y * sink, p.z - d.z * sink];
}

const _olD = new THREE.Vector3(), _olO = new THREE.Vector3(), _olP = new THREE.Vector3();

/**
 * Seat a part on a bone's own limb tube, `sink` metres into it.
 *
 * A torso lathe is revolved circular and then squashed on Z by the mesh's
 * scale, so "the surface is at chestR" is wrong by up to four centimetres
 * depending on which way you are looking — which is exactly how chest plates,
 * backpacks and tabards keep ending up inside the ribcage with only their
 * corners showing. This rays the real geometry in the real frame: the ray is
 * pushed through the inverse of the mesh scale, and the hit is pushed back
 * out through it.
 */
function onLimb(bone, y, dir, sink = 0) {
  const m = bone && bone.primary;
  if (!m || !m.geometry) return [0, y, 0];
  const sx = m.scale.x || 1, sy = m.scale.y || 1, sz = m.scale.z || 1;
  _olD.set(dir[0] / sx, dir[1] / sy, dir[2] / sz).normalize();
  _olO.set(0, y / sy, 0);
  const p = surfacePoint(m.geometry, _olD, _olO, _olP);
  if (!p) return [0, y, 0];
  const px = p.x * sx, py = p.y * sy, pz = p.z * sz;
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return [px - dir[0] / l * sink, py - dir[1] / l * sink, pz - dir[2] / l * sink];
}

/**
 * An armour plate sized off the limb it is worn on.
 *
 * Radii are sampled from the bone's own tube at both ends and pushed out by
 * `gap`, so a greave can never end up inside the shin it is strapped to —
 * which is what happens every single time the radius is typed in by hand
 * against a limb that tapers and bulges.
 *
 * Returns the geometry; the caller places it at y0.
 */
function limbPlate(bone, y0, y1, arc, opts = {}) {
  const gap = opts.gap ?? 0.004;
  const r0 = onLimb(bone, y0, [1, 0, 0], -gap)[0];
  const r1 = onLimb(bone, y1, [1, 0, 0], -gap)[0];
  return arcGeo(r0, r1, y1 - y0, arc, opts.thick ?? 0.012, opts.seg ?? 8);
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

/* ── the detail kit ──────────────────────────────────────────────────── */

const _kitP = new THREE.Vector3(), _kitQ = new THREE.Quaternion();
const _kitE = new THREE.Euler(), _kitS = new THREE.Vector3();

/**
 * A per-material accumulator for everything that is not a cuttable limb.
 *
 * Detail is what makes a droid look mass-produced — panel lines, fasteners,
 * actuators, vents, unit flashes — and detail is also how a character quietly
 * acquires two hundred draw calls. Twenty of these are on screen at once, so
 * every greeble goes through here and comes back out as one merged mesh per
 * material per bone. A shoulder with thirty rivets in it is one draw call.
 *
 * Geometries may be handed in more than once: mergeGeos reads before it
 * disposes, and dispose() only releases GPU handles these never had.
 */
class Kit {
  constructor() { this.buckets = new Map(); }

  /** Same signature as mesh(), minus the parent — rotation is XYZ Euler. */
  add(mat, geo, pos, rot, scale) {
    _kitP.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0);
    _kitE.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
    _kitQ.setFromEuler(_kitE);
    if (scale == null) _kitS.set(1, 1, 1);
    else if (Array.isArray(scale)) _kitS.set(scale[0], scale[1], scale[2]);
    else _kitS.set(scale, scale, scale);
    let arr = this.buckets.get(mat);
    if (!arr) this.buckets.set(mat, arr = []);
    arr.push({ geo, matrix: new THREE.Matrix4().compose(_kitP, _kitQ, _kitS) });
    return this;
  }

  /**
   * The same part on both sides of the centreline. `fn(sx)` is called with +1
   * and -1; mirroring by scale would invert the winding of every triangle in
   * it, so each side is authored rather than reflected.
   */
  pair(fn) { fn(1); fn(-1); return this; }

  /** A row of n copies laid out by `fn(i, t)` with t running 0→1. */
  row(n, fn) { for (let i = 0; i < n; i++) fn(i, n === 1 ? 0.5 : i / (n - 1)); return this; }

  /**
   * Place a part with its local +Y along `dir`. Paired with onSurface() this
   * is how anything seated on a shell — a photoreceptor, a vent, a visor —
   * gets both its position and its orientation from the shell itself instead
   * of from a guess.
   *
   * `ref` biases the roll, and the default matters: aimY falls back to +X,
   * which for a forward-facing normal puts the part's local X straight DOWN.
   * A visor authored 12cm wide and 3cm tall came out 12cm tall and 3cm wide —
   * a vertical bar down the middle of the helmet. World up is the reference a
   * face feature actually wants.
   */
  aim(mat, geo, pos, dir, scale, ref) {
    // dir may be a Vector3 or a plain [x,y,z] — Vector3.copy() of an array
    // silently yields NaN, and a NaN quaternion takes the whole merged
    // geometry's bounding sphere with it.
    if (Array.isArray(dir)) _kitD.set(dir[0], dir[1], dir[2]); else _kitD.copy(dir);
    aimY(_kitD.normalize(), ref || _kitUP, _kitQ);
    _kitE.setFromQuaternion(_kitQ, 'XYZ');
    return this.add(mat, geo, pos, [_kitE.x, _kitE.y, _kitE.z], scale);
  }

  /**
   * Place a flat panel ON a surface: local +Z along `dir`, local +X across it
   * horizontally, local +Y up the surface.
   *
   * This is the frame plateGeo and ventGeo are authored in — width, height,
   * then thickness — and aim() is not: aim() puts local +Y along the normal,
   * so a vent authored 3.4cm wide, 5.6cm tall and 1cm thick came out 5.6cm
   * THICK, a black wedge standing two inches out of the side of a trooper's
   * helmet. Panels want this; cylinders, rivets and domes want aim().
   */
  face(mat, geo, pos, dir, scale) {
    if (Array.isArray(dir)) _kitD.set(dir[0], dir[1], dir[2]); else _kitD.copy(dir);
    _kitD.normalize();
    _kitX.crossVectors(_kitUP, _kitD);
    if (_kitX.lengthSq() < 1e-8) _kitX.set(1, 0, 0);
    _kitX.normalize();
    _kitY.crossVectors(_kitD, _kitX).normalize();
    _kitM.makeBasis(_kitX, _kitY, _kitD);
    _kitE.setFromRotationMatrix(_kitM, 'XYZ');
    return this.add(mat, geo, pos, [_kitE.x, _kitE.y, _kitE.z], scale);
  }

  /** Take one bucket away as a single geometry, for single-material assemblies. */
  merge(mat) {
    const parts = this.buckets.get(mat);
    this.buckets.delete(mat);
    return mergeGeos(parts || []);
  }

  /** Merge each bucket down and hang the results on `parent`. */
  bake(parent) {
    const out = [];
    for (const [mat, parts] of this.buckets) {
      // Same reason as assemble(): after the merge nothing can tell that a
      // chest plate is inside its own ribcage. This is the last moment the
      // parts are separable, and the parent is here too, so the probe can
      // check them against the limb they are bolted to.
      if (_probe) _probe('kit:' + (parent.name || 'part'), parts, parent);
      out.push(mesh(mergeGeos(parts), mat, parent));
    }
    this.buckets.clear();
    return out;
  }
}
const _kitD = new THREE.Vector3();
const _kitX = new THREE.Vector3(), _kitY = new THREE.Vector3();
const _kitM = new THREE.Matrix4();
const _kitUP = new THREE.Vector3(0, 1, 0);
const ONE = Symbol('assembly');

/**
 * Merge a single-material assembly given as [geo, pos, rot, scale] tuples.
 * Head shells and hands are built this way: many pieces, one geometry, one
 * mesh, and — crucially for the cut path — still a plain Mesh at the end.
 *
 * `tag` names the assembly for the probe below.
 */
function assemble(list, tag) {
  const k = new Kit();
  for (const t of list) k.add(ONE, t[0], t[1], t[2], t[3]);
  const parts = k.buckets.get(ONE);
  if (_probe && parts) _probe(tag || 'assembly', parts);
  return k.merge(ONE);
}

let _probe = null;
/**
 * Dev hook: called with every assembly's parts *before* they are merged.
 *
 * Once a helmet is one geometry, nothing downstream can tell that its brow,
 * cheeks and chin are all sitting inside its own cranium — which is precisely
 * how the trooper ended up as a smooth white egg. This is the only seam at
 * which those pieces are still separable, so the burial check hooks in here.
 * Null in the game; costs one comparison per assembly at build time.
 */
export function setAssemblyProbe(fn) { _probe = fn; }

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

/**
 * A tint that survives its own texture.
 *
 * MeshStandardMaterial multiplies `color` by `map`, so the number you type is
 * never the colour you get — it is the colour times whatever that bake's mean
 * albedo happens to be. The rock bake means 0.110/0.080/0.059 because rock is
 * dark, so the beast's carapace, authored at 0x8f7a63, was rendering at a
 * linear 0.030/0.016/0.008: **eleven times darker than it was written**, which
 * is why an animal made out of it read as a hole in the desert.
 *
 * `lit` divides the tint through by the bake's own measured mean and records
 * what it was aiming at, so tools/checks/characters.mjs can hold every body
 * material to the colour it was named for. Where the correction would need a
 * multiplier above 1 the map is simply too dark to carry that colour and the
 * material says so by clamping — which the check reports rather than hides.
 */
function lit(color, mean, mat) {
  const want = new THREE.Color(color);
  const c = new THREE.Color(
    Math.min(1, want.r / mean[0]), Math.min(1, want.g / mean[1]), Math.min(1, want.b / mean[2]));
  mat.color.copy(c);
  mat.userData.authored = [want.r, want.g, want.b];
  mat.userData.mapMean = mean;
  return mat;
}
/**
 * The same bookkeeping without the correction, for the hard-surface families.
 * armour and metal are not carriers — their bakes are the paint and the
 * machined steel, and every tint in this file was picked looking at the result,
 * so dividing them out now would turn a whole legion of white plastoid a
 * quarter brighter for nothing. Recorded so the check can pin what they do
 * render as and catch the bake drifting under them.
 */
function note(color, mean, mat) {
  const c = new THREE.Color(color);
  mat.color.copy(c);
  mat.userData.authored = [c.r, c.g, c.b];
  mat.userData.mapMean = mean;
  return mat;
}

function clothMat(color, rough = 0.92) {
  const maps = clothMaps(2.2);
  return lit(color, MEAN_ALBEDO.cloth, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0, normalScale: new THREE.Vector2(0.85, 0.85),
  }));
}
// `repeat` is additive: at the shipped 1.6 the scuff bake tiles about once per
// 40cm, which on a droid's flat tan panels reads as chipboard rather than as
// paint. Machinery wants it three times finer; cloth and skin do not.
function armorMat(color, metal = 0.1, rough = 0.42, repeat = 1.6) {
  const maps = armorMaps(repeat);
  return note(color, MEAN_ALBEDO.armor, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: metal, normalScale: new THREE.Vector2(0.9, 0.9),
  }));
}
/**
 * Machined metal. `lit` rather than `note`: for a metal the base colour is the
 * specular F0, not a diffuse tint, and the metal bake means 0.318/0.353/0.416
 * — so a mask authored as 0x767b87 grey steel was reflecting at a linear
 * 0.058, which is charcoal. Every droid joint, every frame member and the one
 * mask the player duels nose-to-nose was three times too dark.
 */
function metalMat(color, rough = 0.38, metal = 0.95, repeat = 2.4) {
  const maps = metalMaps(repeat);
  return lit(color, MEAN_ALBEDO.metal, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: metal, normalScale: new THREE.Vector2(0.8, 0.8),
  }));
}
/**
 * Skin.
 *
 * This was a bare MeshStandardMaterial — one flat colour with no pores, no
 * creases and no specular break-up — on the face, the neck and both hands of
 * the character the player looks at from forty centimetres in first person,
 * while skinMaps() sat baked and unused in the foundry. The map is a
 * near-white carrier (mean 0.78/0.70/0.66), so the tint is divided through by
 * it and the caller still names the colour the skin should BE.
 *
 * roughness 0.95 against a map that means about 0.64 lands the surface at
 * ~0.60: skin, not the wet 0.43 the raw multiply would have given.
 */
function skinMat(color = 0xc79a76, repeat = 3.0) {
  const maps = skinMaps(repeat);
  return lit(color, MEAN_ALBEDO.skin, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: 0.95, metalness: 0, normalScale: new THREE.Vector2(0.5, 0.5),
  }));
}
/**
 * Battle damage. Cauterised carbon over paint: near-black, matte, and it
 * kills the specular the plate around it still has, which is what makes a
 * scorch read as a burn rather than as a sticker.
 */
function scorchMat() {
  const maps = armorMaps(6.0);
  return note(0x14120f, MEAN_ALBEDO.armor, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: 0.94, metalness: 0.04, normalScale: new THREE.Vector2(1.1, 1.1),
  }));
}

/**
 * Splash n scorch patches over a bone's own surface, between two heights.
 * The rng is the module's, so consecutive units in a wave are marked
 * differently without anything having to be stored per unit — and because
 * they all land in one material bucket, a unit's whole battle history costs
 * one draw call.
 */
function scorchBone(kit, mat, bone, n, y0, y1, size) {
  if (!bone) return;
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const y = lerp(y0, y1, rng());
    const w = size * (0.55 + rng() * 0.9);
    const d = [Math.sin(a), 0, Math.cos(a)];
    kit.aim(mat, plateGeo(w, 0.006, w * (0.5 + rng() * 0.7), 0.002, 1),
      onLimb(bone, y, d, -0.002), [d[0], 0.06, d[2]]);
  }
}

/**
 * Leather, rubber, webbing: the bits of a soldier that are neither cloth nor
 * plate. Untextured these read as vinyl toys — armour maps at a tight tiling
 * give the grain without the panel seams reading as stitching.
 */
function leatherMat(color, rough = 0.66) {
  const maps = armorMaps(4.5);
  return note(color, MEAN_ALBEDO.armor, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0.04, normalScale: new THREE.Vector2(0.7, 0.7),
  }));
}
/** Visor glass, sensor lenses — scratched, dark and nearly specular. */
function glassMat(color, rough = 0.14) {
  const maps = metalMaps(3.4);
  return lit(color, MEAN_ALBEDO.metal, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0.62, normalScale: new THREE.Vector2(0.22, 0.22),
  }));
}
/**
 * Chitin and bone. This was on the rock bake, whose mean albedo is 0.110 —
 * because rock, in this game, is nearly black. A carapace authored as a warm
 * tan came out at a linear 0.030/0.016/0.008 and the boss was a silhouette
 * with legs. Duracrete's aggregate carries the same pebbled cell structure at
 * three times the albedo, so the tint can actually be corrected onto it.
 */
function chitinMat(color, rough = 0.46) {
  const maps = duracreteMaps(4.2);
  return lit(color, MEAN_ALBEDO.duracrete, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0.05, normalScale: new THREE.Vector2(1.0, 1.0),
  }));
}
/**
 * Tooth, tusk and bare bone. Not chitin: the duracrete bake means 0.332, and
 * a tooth is authored at a linear 0.69 — it simply cannot carry that colour,
 * so a beast's fangs came out mid-grey. The armour bake means 0.668 and can.
 */
function boneMat(color, rough = 0.34) {
  const maps = armorMaps(5.0);
  return lit(color, MEAN_ALBEDO.armor, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0.02, normalScale: new THREE.Vector2(0.5, 0.5),
  }));
}
/** Pebbled animal hide — duracrete's aggregate at a tight tiling. */
function hideMat(color, rough = 0.9) {
  const maps = duracreteMaps(5.5);
  return lit(color, MEAN_ALBEDO.duracrete, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0, normalScale: new THREE.Vector2(0.75, 0.75),
  }));
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
 * Cross-sections for a body of flesh: a rounded-rectangle ribcage, a pelvis
 * block, oval arms and a shin with a calf behind it. Keyed by bone name with
 * the L/R suffix dropped; an archetype replaces the whole table via
 * `style.sections`, or one entry by putting `section` in its `limbOpts`.
 */
const FLESH_SECTIONS = {
  hips:  bodySection({ n0: 2.7, n1: 2.4, back: 0.05, keel: 0 }),
  spine: bodySection({ n0: 2.4, n1: 2.8, back: 0.07, keel: 0.02, waist: 0.055 }),
  chest: bodySection({ n0: 2.8, n1: 3.3, back: 0.085, keel: 0.035 }),
  arm:   ovalSection(0.93, 2.3),
  fore:  ovalSection(0.86, 2.4),
  shin:  calfSection({ flat: 0.10, mass: 0.28, at: 0.28 }),
};

/** The same idea for a machine: squarer plate, a flatter back, no muscle. */
const CHASSIS_SECTIONS = {
  hips:  bodySection({ n0: 3.2, n1: 3.0, back: 0.04, keel: 0 }),
  spine: bodySection({ n0: 2.8, n1: 3.2, back: 0.05, keel: 0.02 }),
  chest: bodySection({ n0: 3.2, n1: 3.6, back: 0.06, keel: 0.03 }),
  arm:   ovalSection(0.92, 2.8),
  fore:  ovalSection(0.88, 2.8),
  shin:  calfSection({ flat: 0.12, mass: 0.16, at: 0.24 }),
};

/**
 * Attach limb meshes to every bone of a humanoid rig.
 * `style` supplies materials and per-slot radii, plus optional extra dressing.
 */
export function dressHumanoid(rig, style) {
  const S = style.scale ?? 1;
  const P = style.parts || {};
  const SEG = style.seg || {};
  // Per-slot overrides for the lathe profile, keyed by bone name or by the
  // name with its L/R suffix dropped. Additive: an archetype that wants a
  // droid's straight strut instead of a bicep says so here without every other
  // archetype's proportions moving.
  const LIMB = style.limbOpts || {};
  const tune = (n) => LIMB[n] || LIMB[n.replace(/[LR]$/, '')] || null;
  const SECT = style.sections === false ? {} : (style.sections || FLESH_SECTIONS);

  const addLimb = (boneName, r0, r1, mat, opts = {}) => {
    const b = rig.get(boneName);
    if (!b) return null;
    const t = tune(boneName);
    const sect = SECT[boneName] || SECT[boneName.replace(/[LR]$/, '')];
    if (sect) opts = Object.assign({ section: sect }, opts);
    if (t) opts = Object.assign({}, opts, t);
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

  // Head. `headR` exists because the droids replace the skull with their own
  // shell: a B2's head is a box 17cm across, and the default 12cm ball was
  // engulfing it — a smooth sphere with an armour plate buried inside.
  // `headGeo` lets an archetype replace the skull outright rather than hide
  // its own helmet inside a sphere it did not ask for. A B1's head is a snout
  // and a B2's is a wedge; both used to carry a 468-triangle ball that was
  // never once visible.
  const head = rig.get('head');
  if (head) {
    let hg;
    if (style.headGeo) hg = style.headGeo(S);
    else {
      hg = new THREE.SphereGeometry((P.headR ?? 0.105) * S, 18, 14);
      hg.scale(0.94, 1.16, 1.03);
      hg.translate(0, 0.10 * S, 0);
    }
    const hm = mesh(hg, style.head || style.skin || style.body, head.obj);
    head.parts.push(hm); head.primary = hm; head.radius = (style.headRadius ?? 0.12) * S;
    if (style.buildHead) style.buildHead(head.obj, S, hg);
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
          [0, armR * 0.85 * S, 0], null,
          [armR * 1.32 * S, armR * 1.70 * S, armR * 1.16 * S]);
      }
    }

    const hand = rig.get('hand' + side);
    if (hand) {
      const geo = style.handGeo ? style.handGeo(side, S) : buildHand(side, S, style.hands || {});
      const m = mesh(geo, style.hand || style.arm || style.body, hand.obj);
      hand.parts.push(m); hand.primary = m; hand.radius = (style.handRadius ?? 0.05) * S;
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
      const geo = style.footGeo ? style.footGeo(S, side) : buildFoot(S, style.feet || {});
      const m = mesh(geo, style.boot || style.leg || style.body, foot.obj);
      foot.parts.push(m); foot.primary = m; foot.radius = 0.06 * S;
    }
  }

  // ── shoulder girdle ────────────────────────────────────────────────
  // The chest lathe ends in a flat disc with the neck coming straight out of
  // the middle of it, so there is no line from the ear to the point of the
  // shoulder — and that line is the first thing a human silhouette is read by.
  // It is also why the head looked bolted on however carefully the collar was
  // sized. One trapezius mass per side, positioned off the clavicle the rig
  // actually has rather than off a typed-in number, so it lands on the
  // acromion for every archetype's proportions.
  if (style.yoke) {
    const Y = style.yoke === true ? {} : style.yoke;
    const cb = rig.get('chest'), cl = rig.get('clavL');
    if (cb && cl) {
      const tip = new THREE.Vector3(0, cl.length, 0).applyQuaternion(cl.restQuat).add(cl.offset);
      const k = new Kit();
      const w = (Y.reach ?? 0.60) * tip.x, rise = (Y.rise ?? 0.030) * S;
      k.pair((sx) => k.add(style.yokeMat || style.body,
        (() => { const g = new THREE.SphereGeometry(1, 12, 8);
          g.scale(w, rise, (Y.depth ?? 0.062) * S); return g; })(),
        [sx * tip.x * (Y.at ?? 0.50), tip.y - (Y.drop ?? 0.014) * S, (Y.z ?? -0.018) * S],
        [0, 0, -sx * (Y.slope ?? 0.20)]));
      k.bake(cb.obj);
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
  // Was bare: the player's gloves, boots, bracers, belt pouches and obi clasp
  // — everything on the figure that is not cloth or skin — rendered as one
  // flat brown vinyl, and gloves are 20% of the first-person frame.
  const leather = leatherMat(0x53412f, 0.62);
  const skin = skinMat(opts.skinColor ?? 0xc79a76);
  // The cap is an open shell, so it has to be lit from the inside too. On the
  // cloth bake rather than bare: hair with no normal detail at all is a
  // moulded plastic wig, and it is 20cm from the camera in every menu shot.
  const hair = clothMat(opts.hairColor ?? 0x2a1d14, 0.76);
  hair.side = THREE.DoubleSide;

  dressHumanoid(rig, {
    scale: S,
    body: outer, arm: tunic, leg: outer, hand: leather, boot: leather,
    head: skin, skin,
    // armR is the humerus at the deltoid; everything else on the arm is derived
    // from it, so 0.045 lands the arm at 4.5→3.5cm and the forearm at 4.0→2.7cm.
    parts: { chestR: 0.162, shoulderR: 0.138, hipR: 0.138, waistR: 0.122,
             armR: 0.045, clavR: 0.062, thighR: 0.088, neckR: 0.060, torsoDepth: 0.76 },
    hands: { curl: 0.95 },
    headRadius: 0.098,
    yoke: { reach: 0.62, rise: 0.031, depth: 0.064, at: 0.50, drop: 0.014, z: -0.016, slope: 0.22 },
    yokeMat: outer,
    // The skull.
    //
    // What was here was a sphere of x-radius 9.9cm with a jaw ellipsoid inside
    // it: a head 22.6cm across and 28.2cm tall on a 1.69m body, which is 6.1
    // heads to the figure. An adult is seven and a half, and head breadth is
    // 15.5cm, not 22.6 — that single number is most of why the player read as
    // a toy. This is 15.1 × 21.0 × 19.6, which is a head.
    //
    // It is also one assembled shell rather than a loose pile of meshes, for
    // the reason every other archetype already is: `surfacePoint` can only
    // answer "where does the face actually end" if there is one thing to ask.
    headGeo: (s) => {
      const ball = (rx, ry, rz, w = 12, h = 9) => {
        const g = new THREE.SphereGeometry(1, w, h); g.scale(rx * s, ry * s, rz * s); return g;
      };
      return assemble([
        // cranium, then the face mass carried forward of it — a brow, a cheek
        // and a chin in profile instead of one ball with features drawn on
        [ball(0.0755, 0.0985, 0.0930, 18, 13), [0, 0.098 * s, -0.012 * s]],
        [ball(0.0680, 0.0700, 0.0780, 14, 10), [0, 0.062 * s, 0.014 * s]],
        [ball(0.0505, 0.0420, 0.0575, 12, 8),  [0, 0.024 * s, 0.030 * s]],
        // brow ridge and the bridge of the nose
        [ball(0.0575, 0.0165, 0.0300, 12, 6),  [0, 0.116 * s, 0.058 * s]],
        [ball(0.0130, 0.0330, 0.0210, 8, 6),   [0, 0.098 * s, 0.070 * s]],
        // the nose itself: a wedge running down off the bridge, not a cone
        [ball(0.0135, 0.0225, 0.0195, 8, 6),   [0, 0.070 * s, 0.078 * s]],
        [ball(0.0170, 0.0110, 0.0155, 8, 6),   [0, 0.056 * s, 0.077 * s]],
        // cheekbones, which is what stops the face being a smooth egg in
        // three-quarter light
        [ball(0.0250, 0.0190, 0.0260, 8, 6),   [0.0455 * s, 0.084 * s, 0.052 * s]],
        [ball(0.0250, 0.0190, 0.0260, 8, 6),   [-0.0455 * s, 0.084 * s, 0.052 * s]],
      ], 'head');
    },
    buildHead(headObj, s, hg) {
      // Every feature is raycast onto the assembled skull. Authored against a
      // nominal sphere radius they went missing four separate times — both
      // eyes, both pupils, both brows and the nose had literally never been
      // drawn — because the face mass reaches further forward than the cranium
      // at eye height, so clearing one still leaves you inside the other.
      const white = new THREE.MeshStandardMaterial({ color: 0xece7dd, roughness: 0.24 });
      const iris = new THREE.MeshStandardMaterial({ color: 0x2c1d12, roughness: 0.18 });
      const lip = new THREE.MeshStandardMaterial({ color: 0x9a6558, roughness: 0.70 });
      // Kit.aim's frame, which every offset below depends on: local +Y goes
      // along the normal, local +X is ref × normal and local +Z closes the
      // basis. For a sideways normal and world-up as the reference that puts
      // local X front-to-back and local Z straight DOWN — so an ear authored
      // as (thin, tall, deep) comes out (deep, thin, tall) and sticks 5cm out
      // of the skull, which is exactly what the first pass did.
      //
      // One Kit per side rather than one for the pair. Merging both eyes into
      // a single mesh puts that mesh's centre on the nose, which is neither
      // where it is nor anywhere a burial check can reason about.
      const eyeD = new THREE.Vector3(0, 0, 1);
      for (const sx of [-1, 1]) {
        const k = new Kit();
        // Probed straight forward from a point directly behind the eye. An
        // angled ray exits off the meridian and lands the eyeball on the side
        // of the nose, which is what the first pass did; forward, the exit is
        // by construction the frontmost point of the face at that x and y.
        const o = new THREE.Vector3(sx * 0.0335 * s, 0.100 * s, 0.010 * s);
        // A real eyeball is 12mm across and mostly buried; a ball sitting proud
        // of the skull reads as an insect. Set into the socket so the brow does
        // the work, with only the iris standing clear.
        k.aim(white, new THREE.SphereGeometry(1, 8, 6),
          onSurface(hg, eyeD, 0.0058 * s, o), eyeD,
          [0.0108 * s, 0.0082 * s, 0.0098 * s]);
        k.aim(iris, new THREE.SphereGeometry(1, 6, 5),
          onSurface(hg, eyeD, 0.0022 * s, o), eyeD,
          [0.0050 * s, 0.0050 * s, 0.0050 * s]);
        // brow, laid on the ridge above the eye and swept in toward the nose
        const b = new THREE.Vector3(sx * 0.13, 0.17, 0.98).normalize();
        k.aim(hair, plateGeo(0.030 * s, 0.005 * s, 0.010 * s, 0.002 * s, 1),
          onSurface(hg, b, -0.0026 * s, new THREE.Vector3(sx * 0.032 * s, 0.107 * s, 0.020 * s)), b);
        // ear, on the side of the cranium where the cranium actually is
        const e = new THREE.Vector3(sx, -0.05, -0.12).normalize();
        k.aim(skin, (() => { const g = new THREE.SphereGeometry(1, 8, 6);
          g.scale(0.0150 * s, 0.0080 * s, 0.0230 * s); return g; })(),
          onSurface(hg, e, 0.0035 * s, new THREE.Vector3(0, 0.086 * s, -0.012 * s)), e);
        k.bake(headObj);
      }
      // The mouth is a shallow crease with a lip over it. As a separate
      // coloured slab standing off the face it read as a sticker.
      const m = new THREE.Vector3(0, -0.05, 1).normalize();
      mesh(plateGeo(0.026 * s, 0.0050 * s, 0.006 * s, 0.002 * s, 1), lip, headObj,
        onSurface(hg, m, -0.0012 * s, new THREE.Vector3(0, 0.048 * s, 0.030 * s)),
        [0.06, 0, 0]);

      // Hair. The cap runs 95° down from the crown and is tipped forward about
      // its OWN centre — rotating the mesh instead swings the cap 2cm off the
      // skull. NB the sign: +0.38 tips the axis forward, which drags the rim
      // down over the eyes, the opposite of what is wanted.
      const cap = new THREE.SphereGeometry(0.0855 * s, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
      cap.scale(1.02, 1.30, 1.14);
      cap.rotateX(-0.34);
      cap.translate(0, 0.093 * s, -0.008 * s);
      mesh(cap, hair, headObj);
      // the mass at the nape, filling in under the cap's back edge
      mesh(new THREE.SphereGeometry(1, 8, 6), hair, headObj,
        [0, 0.052 * s, -0.056 * s], null, [0.058 * s, 0.050 * s, 0.052 * s]);
      // a short braid, because of course — one tapered strand rather than the
      // five spheres it used to be, which cost 400 triangles on their own
      const braid = new THREE.Group(); headObj.add(braid);
      braid.position.set(0.064 * s, 0.078 * s, 0.008 * s);
      braid.rotation.set(0.10, 0, 0.09);
      mesh(limbGeo(0.115 * s, 0.0080 * s, 0.0042 * s, 7, true, { rings: 6, bulge: 0.34, bulgeAt: 0.5, capN: 2 }),
        hair, braid, [0, -0.115 * s, 0]);
    },
    dress(r, s) {
      const chest = r.get('chest').obj;
      const hips = r.get('hips').obj;
      const neck = r.get('neck');

      // Tabards over the shoulders. The torso is an ellipse 0.76 as deep as it
      // is wide, so anything worn on the chest has to sit at z ≈ chestR·0.76
      // or it is simply inside the body — which is where the old z = 0.10
      // now puts it.
      for (const sx of [-1, 1]) {
        const tab = plateGeo(0.085 * s, 0.40 * s, 0.026 * s, 0.011 * s);
        mesh(tab, outer, chest, [sx * 0.058 * s, 0.055 * s, 0.112 * s], [0.10, sx * 0.06, sx * 0.05]);
        const tabBack = plateGeo(0.10 * s, 0.34 * s, 0.024 * s, 0.011 * s);
        mesh(tabBack, outer, chest, [sx * 0.052 * s, 0.06 * s, -0.110 * s], [-0.08, 0, sx * 0.04]);
      }
      // the V of the crossed tunic
      for (const sx of [-1, 1]) {
        mesh(plateGeo(0.13 * s, 0.24 * s, 0.02 * s, 0.01 * s), trim, chest,
          [sx * 0.042 * s, 0.09 * s, 0.114 * s], [0.1, 0, sx * 0.38]);
      }
      // collar — rides the neck so it clears the shoulder line and gives the
      // head something to sit in rather than on. Kept nearly straight: flared
      // hard it reads as a funnel round the throat, not a folded collar.
      if (neck) {
        mesh(bandGeo(0.058 * s, 0.070 * s, 0.064 * s, 0.084 * s, 0.058 * s, 14), trim, neck.obj,
          [0, -0.008 * s, 0], [0.08, 0, 0]);
      }
      // obi / belt — a rolled band, not an open cylinder you can see through
      mesh(bandGeo(0.126 * s, 0.146 * s, 0.124 * s, 0.142 * s, 0.105 * s, 18), trim, hips,
        [0, 0.022 * s, 0], null, [1, 1, 0.82]);
      mesh(plateGeo(0.062 * s, 0.05 * s, 0.022 * s, 0.008 * s), metalMat(0x9a8a6a), hips,
        [0, 0.075 * s, 0.126 * s]);
      // pouches
      for (const sx of [-1, 1]) mesh(plateGeo(0.05 * s, 0.055 * s, 0.035 * s, 0.01 * s), leather, hips,
        [sx * 0.102 * s, 0.055 * s, 0.098 * s]);
      // The robe's skirt.
      //
      // This used to be eight flat plates spaced evenly around a full circle.
      // Eight panels 0.15 wide is 1.2m of plate wrapped around a 0.63m
      // circumference, so they overlapped into a closed barrel with a vertical
      // ridge every 45 degrees — from any distance it read as a corrugated
      // cylinder or a screw thread hanging under the character, which is
      // exactly what it looked like.
      //
      // A skirt is a flared tube with a couple of overlapping panels for
      // depth, not a ring of boxes.
      const skirtH = 0.46 * s;
      const skirt = new THREE.CylinderGeometry(0.135 * s, 0.215 * s, skirtH, 16, 1, true);
      skirt.translate(0, -skirtH * 0.5 - 0.015 * s, 0);
      const skirtMat = outer.clone();
      skirtMat.side = THREE.DoubleSide;
      mesh(skirt, skirtMat, hips);
      // two front panels overlapping the tube, so the silhouette has a seam and
      // a bit of layering instead of being a perfect cone
      for (const sx of [-1, 1]) {
        const a = sx * 0.42;
        const panel = plateGeo(0.17 * s, 0.44 * s, 0.02 * s, 0.012 * s, 3);
        mesh(panel, outer, hips,
          [Math.sin(a) * 0.145 * s, -0.145 * s, Math.cos(a) * 0.145 * s], [0.05, a, 0]);
      }
      // boots — the shaft has to reach the ankle at y = shin.length, or a
      // stripe of bare leg shows between the boot top and the foot
      for (const side of ['L', 'R']) {
        const sh = r.get('shin' + side);
        if (sh) mesh(bandGeo(0.056 * s, 0.078 * s, 0.048 * s, 0.068 * s, sh.length - 0.185 * s, 12),
          leather, sh.obj, [0, 0.185 * s, 0]);
      }
      // bracers, and the hem of the robe's sleeve above them
      for (const side of ['L', 'R']) {
        const f = r.get('fore' + side);
        if (!f) continue;
        mesh(bandGeo(0.036 * s, 0.048 * s, 0.030 * s, 0.042 * s, 0.135 * s, 12), leather, f.obj, [0, 0.105 * s, 0]);
        mesh(bandGeo(0.040 * s, 0.048 * s, 0.042 * s, 0.064 * s, 0.055 * s, 12), tunic, f.obj, [0, 0.030 * s, 0]);
      }
    },
  });

  return { rig, palette: { robe, tunic, outer, trim, leather, skin } };
}

/* ── battle droids ───────────────────────────────────────────────────── */

/**
 * A droid hand: three long pincer digits on a slim frame, with the knuckle
 * pivots left visible. Cheaper than the five-fingered hand it replaces (276
 * triangles against 500) and it reads as a machine from across the arena,
 * which the soft mitten it used to wear never did.
 */
function droidHandGeo(side, S, o = {}) {
  const tw = side === 'L' ? 1 : -1;
  const w = (o.w ?? 0.048) * S, l = (o.l ?? 0.052) * S, t = (o.t ?? 0.020) * S;
  const digitL = (o.digitL ?? 0.062) * S, r = (o.r ?? 0.0072) * S;
  const seg = o.seg ?? 5;
  const g = new THREE.Group();
  const add = (geo, parent, pos, rot, scale) => {
    const m = new THREE.Mesh(geo);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    parent.add(m); return m;
  };
  // wrist swivel, then the palm frame
  add(new THREE.CylinderGeometry(r * 2.4, r * 2.6, t * 0.9, 8), g, [0, -t * 0.35, 0]);
  add(plateGeo(w, l, t, t * 0.26, 1), g, [0, l * 0.5, 0]);
  add(plateGeo(w * 0.62, l * 0.34, t * 1.5, t * 0.3, 1), g, [0, l * 0.92, t * 0.12]);
  // three digits, two phalanges each, plus an opposed thumb
  const table = [[0.30, 1.0], [0.0, 1.06], [-0.30, 1.0]];
  for (const [ox, lf] of table) {
    const root = new THREE.Group();
    root.position.set(tw * ox * w, l * 0.94, t * 0.16);
    root.rotation.set(1.10 * (o.curl ?? 1), 0, -tw * ox * 0.5);
    g.add(root);
    add(digitGeo(digitL * 0.56 * lf, r, r * 0.9, seg, false), root);
    const mid = new THREE.Group();
    mid.position.y = digitL * 0.53 * lf; mid.rotation.x = 0.95 * (o.curl ?? 1);
    root.add(mid);
    add(digitGeo(digitL * 0.5 * lf, r * 0.9, r * 0.62, seg, true), mid);
    // knuckle pivot, left proud so the joint reads
    add(new THREE.CylinderGeometry(r * 1.15, r * 1.15, w * 0.30, 6), root,
      [0, digitL * 0.53 * lf, 0], [0, 0, Math.PI / 2]);
  }
  const th = new THREE.Group();
  th.position.set(-tw * w * 0.44, l * 0.42, t * 0.16);
  th.rotation.set(0.7 * (o.curl ?? 1), 0, tw * 1.05);
  g.add(th);
  add(digitGeo(digitL * 0.46, r * 1.1, r * 0.94, seg, false), th);
  const th2 = new THREE.Group();
  th2.position.y = digitL * 0.44; th2.rotation.x = 0.9 * (o.curl ?? 1); th.add(th2);
  add(digitGeo(digitL * 0.4, r * 0.94, r * 0.66, seg, true), th2);
  return bakeTree(g);
}

/* ── B1 battle droid ─────────────────────────────────────────────────── */

/**
 * The B1 reads at range as three things: a snout, a backpack and a stick
 * figure. Everything below serves one of those. The limbs stay deliberately
 * thin — a B1 is a rack of struts, not a body — so the mechanical character
 * has to come from the joints: ball sockets at the shoulder and hip, an
 * actuator bridging every elbow and knee, and a cable run down the outside of
 * each arm. Panel lines, fasteners and a chipped edge on every painted plate
 * do the rest.
 */
export function buildB1(opts = {}) {
  const S = opts.scale ?? 1.02;
  const rig = new Rig(humanoidSkeleton(S, { armLen: 1.06 }), { scale: S });
  const shell = armorMat(opts.color ?? 0xb9a077, 0.25, 0.62, 5.0);
  // Was a bare MeshStandardMaterial on all four limbs, which renders as grey
  // plastic tubing. A B1's joints are bare machined steel and now look it —
  // metalness 0.62 rather than the helper's 0.95, because at 0.95 and this
  // value there is nothing but the environment probe to reflect and the parts
  // come out as flat black rectangles.
  const joint = metalMat(0x4b4438, 0.46, 0.62, 5.0);
  const mark = armorMat(opts.markColor ?? 0x9e3524, 0.08, 0.58, 5.0);
  const scorch = scorchMat();
  const eye = emissiveMat(opts.eyeColor ?? 0xff3020, 4);

  const riv = rivet(0.0055 * S);
  const bolt = boltGeo(0.008 * S, 0.008 * S);

  /** Cranium, snout, mandible and neck ring, as one geometry. */
  const headShell = (s) => assemble([
    [(() => { const g = new THREE.SphereGeometry(0.050 * s, 10, 8); g.scale(0.94, 1.14, 1.10); return g; })(),
      [0, 0.120 * s, -0.014 * s]],
    [plateGeo(0.068 * s, 0.070 * s, 0.048 * s, 0.010 * s, 1), [0, 0.116 * s, -0.058 * s]],
    [limbGeo(0.212 * s, 0.041 * s, 0.018 * s, 8, true,
      { rings: 3, bulge: 0.07, bulgeAt: 0.18, capN: 2, capY0: 0.35, capY1: 0.55 }),
      [0, 0.126 * s, 0.004 * s], [1.80, 0, 0]],
    [limbGeo(0.148 * s, 0.023 * s, 0.012 * s, 6, true,
      { rings: 2, bulge: 0, capN: 2, capY0: 0.3, capY1: 0.5 }),
      [0, 0.086 * s, 0.008 * s], [1.99, 0, 0]],
    [bandGeo(0.026 * s, 0.040 * s, 0.030 * s, 0.047 * s, 0.034 * s, 10), [0, -0.010 * s, 0]],
    // ear vanes: fixed coordinates, so they belong in the shell rather than in
    // a decoration bucket of their own
    [plateGeo(0.009 * s, 0.082 * s, 0.040 * s, 0.003 * s, 1), [0.052 * s, 0.108 * s, -0.014 * s], [0, 0, 0.18]],
    [plateGeo(0.009 * s, 0.082 * s, 0.040 * s, 0.003 * s, 1), [-0.052 * s, 0.108 * s, -0.014 * s], [0, 0, -0.18]],
  ], 'head');

  dressHumanoid(rig, {
    scale: S,
    // Tan struts with dark bands at every articulation — canonical, and it
    // means every limb bone carries exactly one extra draw call instead of two.
    body: shell, arm: shell, leg: shell, hand: joint, boot: joint, head: shell,
    // a B1 is a rack of struts — no muscle, and its own shoulder ball below
    deltoid: false,
    parts: { chestR: 0.112, shoulderR: 0.082, hipR: 0.074, waistR: 0.058,
             armR: 0.029, clavR: 0.038, thighR: 0.045, neckR: 0.032, torsoDepth: 0.64,
             shoulderDome: 0.35 },
    seg: { torso: 12, arm: 10, leg: 8, clav: 8, neck: 8 },
    // Straight struts with a machined step at the joint rather than a bicep.
    limbOpts: {
      hips: { capN: 3 }, spine: { capN: 3 }, chest: { capN: 3 },
      neck: { capN: 2 }, clav: { capN: 2 },
      arm: { rings: 3, bulge: 0.02, bulgeAt: 0.5, capN: 2 },
      fore: { rings: 3, bulge: 0.03, bulgeAt: 0.2, capN: 2 },
      thigh: { rings: 3, bulge: 0.03, bulgeAt: 0.3, capN: 2 },
      shin: { rings: 4, bulge: 0.05, bulgeAt: 0.16, capN: 2 },
    },
    headGeo: headShell,
    handGeo: (side, s) => droidHandGeo(side, s, { curl: 0.62 }),
    feet: { w: 0.068, len: 0.185, h: 0.078 },

    buildHead(headObj, s, hg) {
      const k = new Kit();
      // A point on the snout's axis a third of the way along it. The obvious
      // choice — the base of the snout — is also inside the cranium, and the
      // nearest exit from there is the back of the cranium's own wall, which
      // is where both photoreceptors ended up: 1.5cm from the centreline,
      // completely swallowed.
      const core = new THREE.Vector3(0, 0.103 * s, 0.101 * s);
      const d = new THREE.Vector3();
      k.pair((sx) => {
        // out and up from the snout's spine, roughly square to its axis
        d.set(sx * 0.76, 0.60, 0.24).normalize();
        const p = onSurface(hg, d, 0.009 * s, core);
        k.aim(joint, new THREE.CylinderGeometry(0.017 * s, 0.021 * s, 0.018 * s, 8), p, d);
        const q = onSurface(hg, d, -0.003 * s, core);
        k.aim(eye, new THREE.SphereGeometry(0.0115 * s, 7, 5), q, d, [1, 0.66, 1]);
        k.row(3, (i) => k.add(joint, plateGeo(0.013 * s, 0.007 * s, 0.044 * s, 0.002 * s, 1),
          [sx * 0.052 * s, (0.086 + i * 0.022) * s, -0.014 * s], [0, 0, sx * 0.18]));
        k.add(joint, riv, [sx * 0.038 * s, 0.070 * s, 0.052 * s], [1.2, 0, 0]);
      });
      // A single brow ridge over both lenses, laid on the snout's spine — the
      // per-eye hoods it replaces stood 12mm proud and read as mortarboards.
      const up = new THREE.Vector3(0, 0.94, 0.34).normalize();
      k.aim(joint, plateGeo(0.062 * s, 0.009 * s, 0.044 * s, 0.003 * s, 1),
        onSurface(hg, up, 0.003 * s, core), up);
      // crown vent stack and the seam down the snout
      k.add(joint, ventGeo(0.034 * s, 0.030 * s, 0.008 * s, 3), [0, 0.150 * s, -0.052 * s], [0.9, 0, 0]);
      k.add(joint, plateGeo(0.008 * s, 0.150 * s, 0.006 * s, 0.002 * s, 1), [0, 0.125 * s, 0.086 * s], [1.79, 0, 0]);
      k.add(joint, limbGeo(0.085 * s, 0.0035 * s, 0.0018 * s, 4, true, { rings: 2, capN: 1 }),
        [0, 0.150 * s, -0.058 * s], [-0.28, 0, 0]);
      k.row(4, (i) => k.add(joint, riv, [((i % 2) ? 1 : -1) * 0.030 * s, (0.096 + Math.floor(i / 2) * 0.030) * s, -0.062 * s], [1.5708, 0, 0]));
      k.bake(headObj);
    },

    dress(r, s) {
      /* ── torso ── */
      const chest = r.get('chest').obj;
      const k = new Kit();
      // chest plate: thin, with a raised sternum rib and a chipped lower edge
      k.add(shell, plateGeo(0.185 * s, 0.215 * s, 0.070 * s, 0.016 * s, 2), [0, 0.088 * s, 0.026 * s]);
      k.add(joint, plateGeo(0.170 * s, 0.009 * s, 0.076 * s, 0.003 * s, 1), [0, -0.014 * s, 0.026 * s]);
      k.add(joint, plateGeo(0.008 * s, 0.190 * s, 0.078 * s, 0.003 * s, 1), [0, 0.090 * s, 0.026 * s]);
      k.row(3, (i, t) => k.add(joint, plateGeo(0.130 * s, 0.006 * s, 0.076 * s, 0.002 * s, 1),
        [0, (0.020 + t * 0.135) * s, 0.028 * s]));
      k.pair((sx) => k.row(3, (i) => k.add(joint, riv,
        [sx * 0.078 * s, (0.020 + i * 0.062) * s, 0.062 * s], [1.5708, 0, 0])));
      k.add(mark, plateGeo(0.150 * s, 0.014 * s, 0.074 * s, 0.004 * s, 1), [0, 0.192 * s, 0.026 * s]);
      // blaster scoring — one draw call for the whole unit's battle damage
      scorchBone(k, scorch, r.get('chest'), 4, 0.01 * s, 0.20 * s, 0.075 * s);
      // Backpack — the other half of the B1 silhouette. Two power cells in a
      // cradle, a comms fin and the harness that straps it on.
      k.add(joint, plateGeo(0.150 * s, 0.230 * s, 0.062 * s, 0.012 * s, 2), [0, 0.108 * s, -0.094 * s]);
      k.pair((sx) => {
        k.add(shell, new THREE.CylinderGeometry(0.030 * s, 0.030 * s, 0.200 * s, 8),
          [sx * 0.042 * s, 0.108 * s, -0.136 * s]);
        k.add(joint, new THREE.CylinderGeometry(0.033 * s, 0.033 * s, 0.016 * s, 8),
          [sx * 0.042 * s, 0.206 * s, -0.136 * s]);
        k.add(joint, new THREE.CylinderGeometry(0.033 * s, 0.033 * s, 0.016 * s, 8),
          [sx * 0.042 * s, 0.010 * s, -0.136 * s]);
        // harness strap over the shoulder, laid along the ribcage's own flank
        k.add(joint, plateGeo(0.024 * s, 0.200 * s, 0.012 * s, 0.003 * s, 1),
          onLimb(r.get('chest'), 0.110 * s, [sx * 0.9, 0, 0.44], 0.004 * s), [0, sx * 0.5, sx * 0.06]);
      });
      k.add(joint, plateGeo(0.012 * s, 0.120 * s, 0.052 * s, 0.004 * s, 1), [0, 0.245 * s, -0.104 * s], [-0.3, 0, 0]);
      k.add(mark, plateGeo(0.080 * s, 0.012 * s, 0.064 * s, 0.003 * s, 1), [0, 0.196 * s, -0.096 * s]);
      k.bake(chest);

      /* ── exposed waist frame — the spine is a strut rack, not a barrel ── */
      const spineB = r.get('spine');
      const ks = new Kit();
      // Four struts and two ribs, each seated on the waist's real surface —
      // authored at a constant radius they vanished into the taper.
      ks.row(4, (i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const d = [Math.sin(a), 0, Math.cos(a)];
        // Seated at each strut's UPPER end: the waist widens as it rises, so a
        // strut hung off the surface at its own midpoint has its top half
        // swallowed by the taper above it.
        for (let j = 0; j < 3; j++) {
          const h = 0.062 * s, top = (0.030 + j * 0.062) * s;
          const p = onLimb(spineB, top, d, -0.004 * s);
          ks.add(joint, plateGeo(0.016 * s, h, 0.014 * s, 0.004 * s, 1),
            [p[0], top - h * 0.5, p[2]], [0, a, 0]);
        }
      });
      for (const y of [0.020 * s, 0.160 * s]) {
        const rr = onLimb(spineB, y, [1, 0, 0], 0.006 * s)[0];
        ks.add(joint, bandGeo(rr * 0.94, rr * 1.10, rr * 0.94, rr * 1.10, 0.016 * s, 10),
          [0, y - 0.008 * s, 0], null, [1, 1, 0.68]);
      }
      ks.bake(spineB.obj);

      const neck = r.get('neck');
      if (neck) {
        const kk = new Kit();
        const rr = onLimb(neck, 0.010 * s, [1, 0, 0], 0)[0];
        kk.add(joint, bandGeo(rr * 0.96, rr * 1.30, rr * 0.96, rr * 1.24, 0.024 * s, 10), [0, 0.004 * s, 0]);
        kk.bake(neck.obj);
      }

      /* ── pelvis ── */
      const hips = r.get('hips').obj;
      const kh = new Kit();
      kh.add(joint, plateGeo(0.130 * s, 0.030 * s, 0.086 * s, 0.008 * s, 1), [0, 0.070 * s, 0]);
      kh.add(joint, plateGeo(0.126 * s, 0.008 * s, 0.084 * s, 0.002 * s, 1), [0, -0.006 * s, 0]);
      kh.add(joint, plateGeo(0.010 * s, 0.100 * s, 0.020 * s, 0.003 * s, 1),
        onLimb(r.get('hips'), 0.030 * s, [0, 0, 1], -0.004 * s));
      kh.pair((sx) => {
        kh.add(joint, new THREE.CylinderGeometry(0.026 * s, 0.026 * s, 0.030 * s, 8),
          [sx * 0.070 * s, -0.008 * s, 0], [0, 0, 1.5708]);
        kh.add(joint, riv, [sx * 0.048 * s, 0.070 * s, 0.052 * s], [1.5708, 0, 0]);
      });
      kh.bake(hips);

      /* ── shoulders ── */
      for (const side of ['L', 'R']) {
        const sx = side === 'L' ? 1 : -1;
        const kc = new Kit();
        kc.add(joint, new THREE.SphereGeometry(0.038 * s, 8, 6), [sx * 0.038 * s, 0.026 * s, 0]);
        kc.add(joint, new THREE.CylinderGeometry(0.041 * s, 0.041 * s, 0.020 * s, 8),
          [sx * 0.038 * s, 0.026 * s, 0], [0, 0, 1.5708]);
        kc.add(joint, bolt, [sx * 0.038 * s, 0.026 * s, 0.040 * s], [1.5708, 0, 0]);
        kc.bake(r.get('clav' + side).obj);
      }

      /* ── arms: armour bands over the strut, an actuator across the elbow ── */
      for (const side of ['L', 'R']) {
        const arm = r.get('arm' + side), fore = r.get('fore' + side);
        if (arm) {
          const ka = new Kit();
          const L = arm.length;
          ka.add(joint, arcGeo(0.031 * s, 0.028 * s, 0.115 * s, 3.5, 0.010 * s, 6), [0, L * 0.24, 0]);
          ka.add(mark, arcGeo(0.0325 * s, 0.0325 * s, 0.022 * s, 3.2, 0.006 * s, 6), [0, L * 0.10, 0]);
          const ram = ramGeo(L * 0.52, 0.011 * s, 0.006 * s);
          ka.add(joint, ram.body, [0.030 * s, L * 0.62, 0.014 * s]);
          ka.add(joint, ram.rod, [0.030 * s, L * 0.62, 0.014 * s]);
          ka.add(joint, new THREE.CylinderGeometry(0.024 * s, 0.024 * s, 0.030 * s, 8), [0, L, 0], [0, 0, 1.5708]);
          ka.add(joint, riv, [0, L * 0.30, 0.048 * s], [1.5708, 0, 0]);
          ka.bake(arm.obj);
        }
        if (fore) {
          const kf = new Kit();
          const L = fore.length;
          kf.add(joint, arcGeo(0.027 * s, 0.021 * s, 0.140 * s, 3.6, 0.009 * s, 6), [0, L * 0.26, 0]);
          kf.add(joint, limbGeo(0.150 * s, 0.0045 * s, 0.0045 * s, 4, false, { rings: 2 }),
            [-0.026 * s, L * 0.30, 0.004 * s]);
          kf.add(joint, bandGeo(0.019 * s, 0.026 * s, 0.019 * s, 0.026 * s, 0.016 * s, 8), [0, L * 0.90, 0]);
          kf.bake(fore.obj);
        }
      }

      /* ── legs ── */
      for (const side of ['L', 'R']) {
        const thigh = r.get('thigh' + side), shin = r.get('shin' + side);
        if (thigh) {
          const kt = new Kit();
          const L = thigh.length;
          kt.add(joint, arcGeo(0.046 * s, 0.040 * s, 0.160 * s, 3.4, 0.011 * s, 6), [0, L * 0.28, 0]);
          kt.add(joint, new THREE.CylinderGeometry(0.034 * s, 0.034 * s, 0.048 * s, 8), [0, L, 0], [0, 0, 1.5708]);
          kt.bake(thigh.obj);
        }
        if (shin) {
          const kn = new Kit();
          const L = shin.length;
          // kneecap over the joint, then the shin's own ram down the back
          kn.add(joint, arcGeo(0.038 * s, 0.036 * s, 0.062 * s, 2.5, 0.016 * s, 6), [0, 0.006 * s, 0]);
          const ram = ramGeo(L * 0.55, 0.012 * s, 0.007 * s);
          kn.add(joint, ram.body, [0, L * 0.42, -0.030 * s]);
          kn.add(joint, ram.rod, [0, L * 0.42, -0.030 * s]);
          kn.add(joint, arcGeo(0.035 * s, 0.024 * s, 0.140 * s, 3.2, 0.009 * s, 6), [0, L * 0.30, 0]);
          kn.add(joint, bandGeo(0.020 * s, 0.028 * s, 0.020 * s, 0.028 * s, 0.020 * s, 8), [0, L * 0.90, 0]);
          kn.bake(shin.obj);
        }
      }
    },
  });
  return { rig, palette: { shell, joint, mark, scorch, eye } };
}

/* ── B2 super battle droid ───────────────────────────────────────────── */

/**
 * The B2 is the B1's silhouette inverted: no neck, no waist, all shoulder.
 * The read at range is a wedge of shoulders with a head sunk between them and
 * two arms hanging past the knee, so the pauldrons are deliberately oversized
 * and the head deliberately small. Up close it is armour over a visible
 * mechanism — ribbed actuators at every joint, a vented back, exhaust stacks
 * and a wrist blaster with a heat shroud.
 */
export function buildB2(opts = {}) {
  const S = opts.scale ?? 1.18;
  const rig = new Rig(humanoidSkeleton(S, { armLen: 1.0 }), { scale: S });
  const shell = armorMat(opts.color ?? 0x7d7266, 0.55, 0.48);
  // was bare: hands, boots and the whole backpack rendered as flat plastic
  const dark = metalMat(0x2f2c27, 0.5);
  const hot = emissiveMat(0xff7a2a, 1.1);
  const scorch = scorchMat();
  const eye = emissiveMat(0xff5522, 3);

  const riv = rivet(0.009 * S);
  const bolt = boltGeo(0.011 * S, 0.010 * S);

  /** A flat-topped wedge with a brow and a vented crown. */
  const headShell = (s) => assemble([
    [plateGeo(0.140 * s, 0.128 * s, 0.150 * s, 0.020 * s, 2), [0, 0.078 * s, 0.004 * s]],
    [plateGeo(0.148 * s, 0.044 * s, 0.056 * s, 0.012 * s, 1), [0, 0.118 * s, 0.052 * s], [-0.34, 0, 0]],
    [plateGeo(0.098 * s, 0.030 * s, 0.104 * s, 0.010 * s, 1), [0, 0.146 * s, -0.010 * s]],
    [plateGeo(0.118 * s, 0.050 * s, 0.040 * s, 0.010 * s, 1), [0, 0.036 * s, -0.070 * s], [0.4, 0, 0]],
  ], 'head');

  dressHumanoid(rig, {
    scale: S,
    body: shell, arm: shell, leg: shell, hand: dark, boot: dark, head: shell,
    parts: { chestR: 0.21, shoulderR: 0.175, hipR: 0.14, waistR: 0.125,
             armR: 0.072, clavR: 0.095, thighR: 0.095, neckR: 0.070, torsoDepth: 0.86,
             shoulderDome: 0.30 },
    seg: { torso: 12, arm: 12, leg: 10, clav: 8, neck: 8 },
    limbOpts: {
      hips: { capN: 3 }, spine: { capN: 3 }, chest: { capN: 3 },
      neck: { capN: 2 }, clav: { capN: 2 },
      arm: { rings: 4, bulge: 0.06, bulgeAt: 0.34, capN: 3 },
      fore: { rings: 4, bulge: 0.07, bulgeAt: 0.24, capN: 3 },
      thigh: { rings: 4, bulge: 0.05, bulgeAt: 0.30, capN: 3 },
      shin: { rings: 4, bulge: 0.09, bulgeAt: 0.20, capN: 3 },
    },
    headGeo: headShell,
    handGeo: (side, s) => droidHandGeo(side, s, {
      w: 0.088, l: 0.082, t: 0.038, digitL: 0.086, r: 0.0145, seg: 6, curl: 0.9 }),
    feet: { w: 0.098, len: 0.21, h: 0.115 },

    buildHead(headObj, s, hg) {
      const k = new Kit();
      const core = new THREE.Vector3(0, 0.085 * s, 0);
      const d = new THREE.Vector3(0, 0.24, 1).normalize();
      // the photoreceptor band, seated in the brow rather than hovering off it
      k.aim(eye, plateGeo(0.098 * s, 0.020 * s, 0.010 * s, 0.003 * s, 1),
        onSurface(hg, d, 0.003 * s, core), d);
      k.aim(dark, plateGeo(0.118 * s, 0.034 * s, 0.008 * s, 0.003 * s, 1),
        onSurface(hg, d, 0.008 * s, core), d);
      // three crown vents — the B2's tell from above and from the side
      k.row(3, (i, t) => k.add(dark, plateGeo(0.016 * s, 0.014 * s, 0.084 * s, 0.003 * s, 1),
        [(t - 0.5) * 0.062 * s, 0.160 * s, -0.008 * s]));
      k.pair((sx) => {
        k.add(dark, ventGeo(0.052 * s, 0.048 * s, 0.010 * s, 3),
          [sx * 0.074 * s, 0.080 * s, 0.010 * s], [0, sx * 1.5708, 0]);
        k.add(dark, riv, [sx * 0.050 * s, 0.140 * s, 0.062 * s], [0.4, 0, 0]);
      });
      k.bake(headObj);
    },

    dress(r, s) {
      const chest = r.get('chest').obj;
      const k = new Kit();
      // Chest armour: plates seated on the ribcage, not a box built round it.
      // The lathe is 25cm in radius at the sternum — the 34cm slab that used
      // to be here was inside its own body with four corners poking out.
      const chestB = r.get('chest');
      const D = 0.86;      // the torso's own z squash — the shells match it
      const at = (y, d, sink) => onLimb(chestB, y * s, d, sink * s);
      // Chest armour that WRAPS. What was here was a flat slab 30cm across
      // laid on a barrel 25cm in radius: dead flat across the front, and at
      // its own corners it stood five centimetres off the body it was bolted
      // to. From any angle but head-on it read as a board nailed to a drum.
      // These are arcs of the ribcage's own section, so the plate curves with
      // the chest and its edges land on it.
      k.add(shell, arcGeo(0.218 * s, 0.196 * s, 0.250 * s, 2.55, 0.030 * s, 10), [0, 0.002 * s, 0], null, [1, 1, D]);
      k.add(shell, arcGeo(0.212 * s, 0.192 * s, 0.150 * s, 0.80, 0.042 * s, 5), [0, 0.048 * s, 0], null, [1, 1, D]);
      k.add(shell, arcGeo(0.214 * s, 0.206 * s, 0.062 * s, 2.75, 0.034 * s, 10), [0, 0.216 * s, 0], null, [1, 1, D]);
      k.pair((sx) => {
        k.add(dark, ventGeo(0.070 * s, 0.110 * s, 0.026 * s, 4), at(0.108, [sx * 0.62, 0, 1], -0.014), [0, sx * 0.85, 0]);
        k.row(3, (i) => k.add(dark, riv, at(0.030 + i * 0.070, [sx, 0, 0.15], -0.050), [0, 0, -sx * 1.5708]));
        k.add(dark, bolt, at(0.234, [sx * 0.44, 0.2, 1], -0.030), [1.5708, 0, 0]);
        // flank plates, so the barrel does not read as a barrel from the side
        k.add(shell, arcGeo(0.216 * s, 0.196 * s, 0.230 * s, 1.05, 0.026 * s, 6),
          [0, 0.012 * s, 0], [0, sx * 1.5708, 0], [1, 1, D]);
      });
      scorchBone(k, scorch, chestB, 5, 0.02 * s, 0.24 * s, 0.115 * s);
      // Back: a vented dorsal block and two exhaust stacks, seated on the
      // ribcage's real back surface (it is 15cm deep here, not 5.8).
      const back = at;
      k.add(dark, arcGeo(0.212 * s, 0.196 * s, 0.170 * s, 1.70, 0.040 * s, 8),
        [0, 0.120 * s, 0], [0, Math.PI, 0], [1, 1, D]);
      k.pair((sx) => {
        const p = back(0.230, [sx * 0.34, 0, -1], 0.010);
        k.add(dark, new THREE.CylinderGeometry(0.030 * s, 0.034 * s, 0.150 * s, 8), [p[0], p[1], p[2]]);
        k.add(hot, new THREE.CylinderGeometry(0.023 * s, 0.026 * s, 0.014 * s, 8), [p[0], p[1] + 0.078 * s, p[2]]);
      });
      k.add(dark, ventGeo(0.170 * s, 0.090 * s, 0.020 * s, 4), back(0.070, [0, 0, -1], 0.004), [0, Math.PI, 0]);
      k.bake(chest);

      // Pelvis: an armoured girdle with hip actuators.
      const hips = r.get('hips').obj;
      const kh = new Kit();
      kh.add(shell, plateGeo(0.262 * s, 0.160 * s, 0.180 * s, 0.030 * s, 2), [0, 0.040 * s, 0]);
      kh.add(dark, plateGeo(0.240 * s, 0.010 * s, 0.186 * s, 0.003 * s, 1), [0, 0.108 * s, 0]);
      kh.pair((sx) => {
        kh.add(dark, new THREE.CylinderGeometry(0.044 * s, 0.044 * s, 0.056 * s, 8), [sx * 0.118 * s, -0.010 * s, 0], [0, 0, 1.5708]);
        kh.add(dark, riv, [sx * 0.070 * s, 0.096 * s, 0.092 * s], [1.5708, 0, 0]);
      });
      kh.bake(hips);

      // Arms: ribbed actuator sleeves at shoulder and elbow, armour over the
      // outside of the humerus, and the wrist blaster on the right.
      for (const side of ['L', 'R']) {
        const sx = side === 'L' ? 1 : -1;
        const arm = r.get('arm' + side), fore = r.get('fore' + side);
        if (arm) {
          const ka = new Kit();
          const L = arm.length;
          // Pauldron. On the humerus rather than the clavicle: it rolls with
          // the shoulder, and the clavicle's own tube is fatter than it is.
          // The sphere's pole is at +Y, so the cap is turned over to close at
          // the shoulder and flare down the arm.
          const cap = new THREE.SphereGeometry(0.128 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.60);
          cap.scale(1.0, 1.05, 1.14);
          ka.add(shell, cap, [0, 0.026 * s, 0], [Math.PI, 0, 0]);
          // rolled rim on the pauldron's real open edge — y = 0.068, radius
          // 0.122. The band was at y = 0.098 and outer 0.136, a hoop hanging
          // in mid-air three centimetres below the shell it was meant to close.
          ka.add(dark, bandGeo(0.112 * s, 0.1265 * s, 0.116 * s, 0.1265 * s, 0.036 * s, 14),
            [0, 0.042 * s, 0], null, [1, 1, 1.14]);
          // on the pauldron's own shell — its equator is at 12.8cm across and
          // 14.6 deep, so a ring at 11.8 was inside the dome it fastens
          ka.row(4, (i, t) => {
            const a = (t - 0.5) * 2.1;
            ka.add(dark, riv, [Math.sin(a) * 0.130 * s, 0.026 * s, Math.cos(a) * 0.148 * s],
              [Math.PI / 2, a, 0]);
          });
          ka.add(shell, plateGeo(0.130 * s, 0.190 * s, 0.120 * s, 0.022 * s, 1), [sx * 0.014 * s, L * 0.34, 0.006 * s]);
          ka.row(4, (i, t) => ka.add(dark, bandGeo(0.056 * s, 0.070 * s, 0.056 * s, 0.070 * s, 0.014 * s, 10),
            [0, L * (0.70 + t * 0.22), 0]));
          ka.add(dark, new THREE.CylinderGeometry(0.062 * s, 0.062 * s, 0.078 * s, 10), [0, L, 0], [0, 0, 1.5708]);
          ka.bake(arm.obj);
        }
        if (fore) {
          const kf = new Kit();
          const L = fore.length;
          kf.add(shell, plateGeo(0.115 * s, 0.210 * s, 0.108 * s, 0.020 * s, 1), [sx * 0.010 * s, L * 0.40, 0.004 * s]);
          kf.row(3, (i, t) => kf.add(dark, plateGeo(0.120 * s, 0.008 * s, 0.112 * s, 0.003 * s, 1),
            [0, L * (0.24 + t * 0.34), 0.004 * s]));
          kf.add(dark, bandGeo(0.044 * s, 0.056 * s, 0.044 * s, 0.056 * s, 0.024 * s, 10), [0, L * 0.94, 0]);
          if (side === 'R') {
            // twin-barrel wrist blaster under a finned heat shroud
            kf.add(dark, plateGeo(0.080 * s, 0.170 * s, 0.070 * s, 0.014 * s, 1), [0, L * 0.62, 0.070 * s]);
            kf.row(4, (i, t) => kf.add(dark, plateGeo(0.096 * s, 0.008 * s, 0.078 * s, 0.003 * s, 1),
              [0, L * (0.50 + t * 0.24), 0.070 * s]));
            kf.pair((bx) => kf.add(dark, new THREE.CylinderGeometry(0.014 * s, 0.016 * s, 0.130 * s, 8),
              [bx * 0.020 * s, L * 0.80, 0.070 * s]));
          }
          kf.bake(fore.obj);
          if (side === 'R') {
            const muzzle = mesh(new THREE.CylinderGeometry(0.026 * s, 0.032 * s, 0.040 * s, 8),
              emissiveMat(0xff4020, 1.2), fore.obj, [0, L * 0.90, 0.070 * s]);
            fore.muzzle = muzzle;
          }
        }
      }

      // Legs: armour shells with a knee housing and a calf actuator.
      for (const side of ['L', 'R']) {
        const thigh = r.get('thigh' + side), shin = r.get('shin' + side);
        if (thigh) {
          const kt = new Kit();
          const L = thigh.length;
          kt.add(shell, plateGeo(0.180 * s, 0.280 * s, 0.170 * s, 0.026 * s, 1), [0, L * 0.42, 0.006 * s]);
          kt.add(dark, plateGeo(0.164 * s, 0.010 * s, 0.176 * s, 0.003 * s, 1), [0, L * 0.62, 0.006 * s]);
          kt.add(dark, new THREE.CylinderGeometry(0.074 * s, 0.074 * s, 0.098 * s, 10), [0, L, 0], [0, 0, 1.5708]);
          kt.bake(thigh.obj);
        }
        if (shin) {
          const kn = new Kit();
          const L = shin.length;
          kn.add(shell, plateGeo(0.130 * s, 0.120 * s, 0.108 * s, 0.024 * s, 1), [0, 0.040 * s, 0.060 * s]);
          kn.add(shell, plateGeo(0.150 * s, 0.300 * s, 0.140 * s, 0.024 * s, 1), [0, L * 0.42, 0.008 * s]);
          const ram = ramGeo(L * 0.5, 0.026 * s, 0.014 * s);
          kn.add(dark, ram.body, [0, L * 0.40, -0.062 * s]);
          kn.add(shell, ram.rod, [0, L * 0.40, -0.062 * s]);
          kn.add(dark, bandGeo(0.046 * s, 0.062 * s, 0.046 * s, 0.062 * s, 0.030 * s, 10), [0, L * 0.92, 0]);
          kn.bake(shin.obj);
        }
      }
    },
  });
  return { rig, palette: { shell, dark, hot, scorch, eye } };
}

/* ── clone trooper ───────────────────────────────────────────────────── */

/**
 * The read at range is the helmet: a domed cranium, a hard brow, cheeks that
 * flare out and down, and a fin along the crown. Everything else is armour
 * that has to look like *separate plates over a bodysuit* rather than a white
 * paint job — so every plate is a curved shell standing a centimetre off the
 * black undersuit, with its own rim, its own rivets and a unit colour on the
 * pieces a squad actually paints: the crest, the shoulder bells, the knees.
 */
export function buildTrooper(opts = {}) {
  const S = opts.scale ?? 1.0;
  const rig = new Rig(humanoidSkeleton(S), { scale: S });
  const plate = armorMat(opts.color ?? 0xe8e9ec, 0.08, 0.34, 3.0);
  // The undersuit was a bare MeshStandardMaterial: flat black vinyl over the
  // entire figure, and it is what you see at every joint.
  const under = clothMat(0x191c21, 0.88);
  const accent = armorMat(opts.accent ?? 0x2f6fbe, 0.1, 0.34, 3.0);
  // and the visor was bare too — dark glass wants scratches and a specular
  const visor = glassMat(0x0a0d12, 0.13);
  const gear = leatherMat(0x25282e, 0.62);
  const scorch = scorchMat();

  const riv = rivet(0.005 * S);

  // The helmet.
  //
  // What was here measured 22.4cm across, 24.9 tall and 28.2 deep: WIDER than
  // it was tall, which is the one proportion a helmet can never be, and the
  // reason it read as a fridge with slots in it. A cranium 20.8cm across with
  // a 15.8cm brick bolted to the front of it will always read as two objects.
  //
  // This is 19.2 across, 26.4 tall, 28 deep. The dome is narrow and long
  // front-to-back, the face is a shallower mass that shares the dome's width
  // rather than sitting inside it, and the cheeks flare OUTBOARD and DOWN off
  // the dome's own widest point instead of standing beside it. The step from
  // brow to cheek is what a T-visor is read against.
  const headShell = (s) => assemble([
    // Cranium. A SPHERE was the problem, not the size of it: a ball is wider
    // than the face at every height, so however the faceplate is sized the
    // dome bulges out past it on both sides and the helmet reads as an egg
    // with a box stuck on the front. A heavily rounded block is the same
    // volume with the same soft top and a FLANK — the cheek can continue it
    // instead of interrupting it.
    [plateGeo(0.184 * s, 0.158 * s, 0.198 * s, 0.048 * s, 4), [0, 0.136 * s, -0.030 * s]],
    // faceplate: brow, cheekline and jaw in one forward mass, carried at very
    // nearly the cranium's own width so the join is a corner and not a step
    [plateGeo(0.170 * s, 0.152 * s, 0.124 * s, 0.044 * s, 3), [0, 0.096 * s, 0.044 * s], [-0.06, 0, 0]],
    // cheeks flaring outboard and down off the flank of the dome
    [plateGeo(0.032 * s, 0.104 * s, 0.126 * s, 0.015 * s, 1), [0.085 * s, 0.056 * s, 0.016 * s], [0, 0, 0.24]],
    [plateGeo(0.032 * s, 0.104 * s, 0.126 * s, 0.015 * s, 1), [-0.085 * s, 0.056 * s, 0.016 * s], [0, 0, -0.24]],
    // chin, rear flare and the dorsal fin
    [plateGeo(0.126 * s, 0.058 * s, 0.106 * s, 0.024 * s, 1), [0, 0.020 * s, 0.038 * s], [0.30, 0, 0]],
    [plateGeo(0.150 * s, 0.096 * s, 0.070 * s, 0.024 * s, 1), [0, 0.056 * s, -0.126 * s], [0.30, 0, 0]],
    [plateGeo(0.026 * s, 0.058 * s, 0.190 * s, 0.010 * s, 1), [0, 0.204 * s, -0.016 * s], [0.04, 0, 0]],
    [bandGeo(0.052 * s, 0.070 * s, 0.056 * s, 0.078 * s, 0.030 * s, 12), [0, -0.008 * s, 0]],
  ], 'head');

  dressHumanoid(rig, {
    scale: S,
    body: under, arm: under, leg: under, hand: plate, boot: gear, head: plate,
    // the shoulder bell does the deltoid's job and then some
    deltoid: false,
    // A soldier in full plate, and he has to read as one from thirty metres
    // against a Jedi and a Sith wearing the same skeleton. Measured in a shared
    // world frame the trooper's front silhouette overlapped the Jedi's 84%:
    // same height, same width, same everything but the colour. So the bulk is
    // real — a deeper ribcage, heavier arms and legs, a wider collarbone and a
    // shoulder bell 23% bigger — rather than a paint difference.
    parts: { chestR: 0.140, shoulderR: 0.124, hipR: 0.122, waistR: 0.108,
             armR: 0.057, clavR: 0.074, thighR: 0.100, neckR: 0.062, torsoDepth: 0.88 },
    seg: { torso: 16, arm: 12, leg: 12, clav: 10, neck: 10 },
    limbOpts: {
      hips: { capN: 3 }, spine: { capN: 3 }, chest: { capN: 3 },
      neck: { capN: 2 }, clav: { capN: 2 },
      arm: { capN: 3 }, fore: { capN: 3 }, thigh: { capN: 3 }, shin: { capN: 3 },
    },
    headGeo: headShell,
    yoke: { reach: 0.66, rise: 0.034, depth: 0.070, at: 0.50, drop: 0.012, z: -0.014, slope: 0.20 },
    yokeMat: under,
    // gauntlets: a little bulkier than bare hands, and firmly closed
    hands: { palmW: 0.098, palmL: 0.080, palmT: 0.038, fingerR: 0.0115, wristR: 0.034, curl: 0.95 },
    feet: { w: 0.104, len: 0.215, h: 0.118 },

    buildHead(headObj, s, hg) {
      const k = new Kit();
      // A point inside the FACE BLOCK and in front of the cranium's front wall
      // (z = 0.070). Probing from the head's centre instead would find the
      // inside of the dome first and seat the visor 3cm behind the face.
      const core = new THREE.Vector3(0, 0.104 * s, 0.086 * s);
      // The T. Every part of it used to be authored at z = 0.10 against a
      // helmet whose surface is at 0.122 — inside its own helmet, all of it.
      // Both bars are now raycast onto the brow and set into it, so the visor
      // is a recess rather than a sticker.
      // The T. Every part of it used to be authored at z = 0.10 against a
      // helmet whose surface is at 0.122 — inside its own helmet, all of it.
      // Both bars are raycast onto the brow and laid ON it with face(), whose
      // frame is the one plateGeo is authored in: width, height, thickness.
      // aim() puts the HEIGHT along the normal, which is how a visor authored
      // 4.8cm tall became a 4.8cm-deep slab bolted to the front of the face.
      const brow = new THREE.Vector3(0, 0.22, 1).normalize();
      k.face(visor, plateGeo(0.128 * s, 0.036 * s, 0.026 * s, 0.005 * s, 1),
        onSurface(hg, brow, 0.010 * s, new THREE.Vector3(0, 0.108 * s, 0.055 * s)), brow);
      const nose = new THREE.Vector3(0, -0.20, 1).normalize();
      k.face(visor, plateGeo(0.046 * s, 0.098 * s, 0.026 * s, 0.005 * s, 1),
        onSurface(hg, nose, 0.010 * s, new THREE.Vector3(0, 0.070 * s, 0.055 * s)), nose);
      // the frown line under the visor, and the mouth grille
      const frown = new THREE.Vector3(0, -0.34, 1).normalize();
      k.face(under, plateGeo(0.112 * s, 0.014 * s, 0.010 * s, 0.003 * s, 1),
        onSurface(hg, frown, 0.002 * s, new THREE.Vector3(0, 0.046 * s, 0.055 * s)), frown);
      const mouth = new THREE.Vector3(0, -0.56, 1).normalize();
      k.face(visor, ventGeo(0.052 * s, 0.026 * s, 0.008 * s, 3),
        onSurface(hg, mouth, 0.002 * s, new THREE.Vector3(0, 0.032 * s, 0.050 * s)), mouth);
      k.pair((sx) => {
        // breather cylinder, probed from inside the cheek flare
        const cheek = new THREE.Vector3(sx * 0.080 * s, 0.058 * s, 0.018 * s);
        const d = new THREE.Vector3(sx * 0.72, -0.34, 0.60).normalize();
        k.aim(visor, new THREE.CylinderGeometry(0.012 * s, 0.014 * s, 0.020 * s, 8),
          onSurface(hg, d, 0.006 * s, cheek), d);
        // ear vent, LAID ON the side of the helmet. As an aim() it stood 5.6cm
        // proud — a black wedge two inches out of the side of the head, which
        // is the single loudest thing in every close shot of a trooper.
        const e = new THREE.Vector3(sx * 0.98, 0.10, -0.14).normalize();
        k.face(under, ventGeo(0.048 * s, 0.062 * s, 0.008 * s, 3),
          onSurface(hg, e, 0.002 * s, cheek), e);
        const f = new THREE.Vector3(sx * 0.86, 0.48, 0.14).normalize();
        k.aim(plate, riv, onSurface(hg, f, -0.003 * s, new THREE.Vector3(0, 0.138 * s, -0.030 * s)), f);
      });
      // Crest: the fin along the crown, in unit colour, plus the stripes that
      // actually get painted on a helmet.
      k.add(accent, plateGeo(0.032 * s, 0.020 * s, 0.174 * s, 0.007 * s, 1), [0, 0.226 * s, -0.016 * s], [0.04, 0, 0]);
      k.pair((sx) => {
        // aim()'s local X is ref × dir, which for a crown normal runs
        // front-to-back, and its local Z runs across. Authored the other way
        // round, this stripe was 13cm WIDE and 2cm long: a blue slab on each
        // side of the helmet rather than a stripe over the crown.
        const d = new THREE.Vector3(sx * 0.50, 0.86, 0.10).normalize();
        k.aim(accent, plateGeo(0.130 * s, 0.006 * s, 0.022 * s, 0.002 * s, 1),
          onSurface(hg, d, 0.001 * s, new THREE.Vector3(0, 0.138 * s, -0.030 * s)), d);
      });
      k.bake(headObj);
    },

    dress(r, s) {
      const chestB = r.get('chest'), spineB = r.get('spine'), hipsB = r.get('hips');
      const D = 0.88;   // the torso's z squash — the plates have to match it

      /* ── torso: separate front, back and abdominal plates ── */
      const k = new Kit();
      k.add(plate, arcGeo(0.146 * s, 0.132 * s, 0.230 * s, 2.55, 0.020 * s, 9), [0, -0.008 * s, 0], null, [1, 1, D]);
      k.add(plate, arcGeo(0.146 * s, 0.128 * s, 0.220 * s, 2.30, 0.018 * s, 8), [0, 0.000 * s, 0], [0, Math.PI, 0], [1, 1, D]);
      // collar that the helmet sits into, and the shoulder straps
      k.add(plate, bandGeo(0.104 * s, 0.126 * s, 0.086 * s, 0.108 * s, 0.052 * s, 14), [0, 0.196 * s, 0], null, [1, 1, D + 0.1]);
      k.add(accent, arcGeo(0.150 * s, 0.150 * s, 0.028 * s, 2.4, 0.008 * s, 8), [0, 0.150 * s, 0], null, [1, 1, D]);
      k.pair((sx) => {
        k.add(gear, plateGeo(0.030 * s, 0.230 * s, 0.014 * s, 0.004 * s, 1),
          onLimb(chestB, 0.090 * s, [sx * 0.55, 0, 1], 0.002 * s), [0, -sx * 0.30, sx * 0.16]);
        k.row(3, (i) => k.add(gear, riv, onLimb(chestB, (0.030 + i * 0.070) * s, [sx * 0.62, 0, 1], -0.030 * s), [1.2, 0, 0]));
      });
      // a chest box: comlink, ammo, whatever a soldier hangs off the front
      k.add(gear, plateGeo(0.060 * s, 0.048 * s, 0.026 * s, 0.006 * s, 1),
        onLimb(chestB, 0.060 * s, [0, 0, 1], -0.010 * s));
      scorchBone(k, scorch, chestB, 3, 0.01 * s, 0.19 * s, 0.070 * s);
      k.bake(chestB.obj);

      /* ── abdomen: three overlapping bands, so the waist articulates ── */
      const ks = new Kit();
      ks.row(3, (i, t) => {
        const y = (0.020 + i * 0.062) * s;
        ks.add(plate, arcGeo(0.126 * s + i * 0.006 * s, 0.130 * s + i * 0.006 * s, 0.050 * s, 2.9, 0.014 * s, 8),
          [0, y, 0], null, [1, 1, D]);
        ks.add(plate, arcGeo(0.124 * s + i * 0.006 * s, 0.128 * s + i * 0.006 * s, 0.048 * s, 2.2, 0.012 * s, 7),
          [0, y, 0], [0, Math.PI, 0], [1, 1, D]);
      });
      ks.bake(spineB.obj);

      /* ── belt, codpiece and tassets ── */
      const kh = new Kit();
      kh.add(gear, bandGeo(0.118 * s, 0.136 * s, 0.118 * s, 0.136 * s, 0.056 * s, 16), [0, 0.056 * s, 0], null, [1, 1, D + 0.06]);
      kh.add(plate, plateGeo(0.052 * s, 0.046 * s, 0.024 * s, 0.006 * s, 1), onLimb(hipsB, 0.080 * s, [0, 0, 1], -0.008 * s));
      kh.add(plate, arcGeo(0.120 * s, 0.126 * s, 0.130 * s, 1.5, 0.016 * s, 6), [0, -0.062 * s, 0], null, [1, 1, D]);
      kh.add(plate, arcGeo(0.120 * s, 0.126 * s, 0.150 * s, 1.7, 0.016 * s, 6), [0, -0.076 * s, 0], [0, Math.PI, 0], [1, 1, D]);
      kh.pair((sx) => {
        kh.add(gear, plateGeo(0.052 * s, 0.058 * s, 0.036 * s, 0.010 * s, 1),
          onLimb(hipsB, 0.052 * s, [sx * 0.85, 0, 0.62], -0.016 * s), [0, -sx * 0.5, 0]);
        kh.add(plate, arcGeo(0.118 * s, 0.122 * s, 0.120 * s, 0.9, 0.014 * s, 5), [0, -0.058 * s, 0], [0, sx * 1.42, 0], [1, 1, D]);
      });
      kh.bake(hipsB.obj);

      /* ── shoulders, arms ── */
      for (const side of ['L', 'R']) {
        const arm = r.get('arm' + side), fore = r.get('fore' + side);
        if (arm) {
          const ka = new Kit();
          const L = arm.length;
          // Shoulder bell on the humerus, so it rolls with the shoulder. The
          // sphere's pole is +Y, i.e. down the arm, so it is turned over.
          const bell = new THREE.SphereGeometry(0.106 * s, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.56);
          bell.scale(1.0, 1.02, 1.06);
          ka.add(plate, bell, [0, 0.030 * s, 0], [Math.PI, 0, 0]);
          // The rolled rim, ON the bell's own open edge — which is at y =
          // 0.049 and radius 0.096, measured off the sphere rather than
          // guessed. The band that was here sat at y = 0.086 with an outer
          // radius of 0.100 around an arm of radius 0.048: a white hoop
          // floating four centimetres off the bicep, while the bell itself
          // stayed a zero-thickness shell you could see the inside of.
          ka.add(plate, bandGeo(0.0930 * s, 0.1095 * s, 0.0965 * s, 0.1095 * s, 0.032 * s, 14),
            [0, 0.030 * s, 0], null, [1, 1, 1.06]);
          ka.add(accent, arcGeo(0.1035 * s, 0.1035 * s, 0.028 * s, 1.9, 0.006 * s, 7), [0, 0.004 * s, 0], null, [1, 1, 1.06]);
          // biceps plate over the suit
          ka.add(plate, limbPlate(arm, L * 0.34, L * 0.78, 3.1, { thick: 0.012 * s, seg: 7, gap: 0.005 * s }),
            [0, L * 0.34, 0]);
          ka.bake(arm.obj);
        }
        if (fore) {
          const kf = new Kit();
          const L = fore.length;
          // vambrace: a near-full sleeve, open on the inside of the forearm
          kf.add(plate, limbPlate(fore, L * 0.16, L * 0.88, 4.9, { thick: 0.013 * s, seg: 9, gap: 0.006 * s }),
            [0, L * 0.16, 0]);
          kf.add(plate, bandGeo(0.033 * s, 0.046 * s, 0.033 * s, 0.046 * s, 0.020 * s, 12), [0, L * 0.86, 0]);
          if (side === 'L') {
            kf.add(gear, plateGeo(0.048 * s, 0.056 * s, 0.020 * s, 0.005 * s, 1), [0, L * 0.44, 0.048 * s], [0, 0, 0.2]);
            kf.add(accent, plateGeo(0.034 * s, 0.014 * s, 0.010 * s, 0.002 * s, 1), [0, L * 0.52, 0.060 * s]);
          }
          kf.bake(fore.obj);
        }
      }

      /* ── legs ── */
      for (const side of ['L', 'R']) {
        const thigh = r.get('thigh' + side), shin = r.get('shin' + side);
        if (thigh) {
          const kt = new Kit();
          const L = thigh.length;
          kt.add(plate, limbPlate(thigh, L * 0.14, L * 0.80, 3.4, { thick: 0.016 * s, seg: 8, gap: 0.006 * s }),
            [0, L * 0.14, 0]);
          kt.add(plate, limbPlate(thigh, L * 0.16, L * 0.50, 2.2, { thick: 0.012 * s, seg: 6, gap: 0.005 * s }),
            [0, L * 0.16, 0], [0, Math.PI, 0]);
          kt.bake(thigh.obj);
        }
        if (shin) {
          const kn = new Kit();
          const L = shin.length;
          // kneecap, then the greave
          // the kneecap's own pole points forward off the shin's real surface;
          // centred on the axis it was 94% inside the leg
          const kr = onLimb(shin, 0.034 * s, [0, 0, 1], 0)[2];
          const cap = new THREE.SphereGeometry(0.058 * s, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.58);
          cap.scale(1.02, 0.60, 0.92);
          // +1.45, not -1.45: rotating +Y about X by a NEGATIVE angle tips the
          // dome's pole to -Z, which put the kneecap on the back of the leg
          kn.add(plate, cap, [0, 0.034 * s, kr + 0.004 * s], [1.45, 0, 0]);
          // unit stripe on the greave, where it is read from, rather than on
          // the joint where the kneecap covers it
          kn.add(accent, limbPlate(shin, L * 0.30, L * 0.34, 2.0, { thick: 0.007 * s, seg: 6, gap: 0.021 * s }),
            [0, L * 0.30, 0]);
          kn.add(plate, limbPlate(shin, L * 0.22, L * 0.84, 3.7, { thick: 0.014 * s, seg: 8, gap: 0.006 * s }),
            [0, L * 0.22, 0]);
          kn.add(plate, bandGeo(0.042 * s, 0.056 * s, 0.042 * s, 0.056 * s, 0.028 * s, 12), [0, L * 0.86, 0]);
          kn.bake(shin.obj);
        }
      }
    },
  });
  return { rig, palette: { plate, under, accent, visor, gear, scorch } };
}

/* ── sith acolyte (saber duelist) ────────────────────────────────────── */

/**
 * The one enemy the player fights face to face, so it gets the most work.
 *
 * Silhouette: a hood over a mask, a mantle, and a coat that breaks at the
 * knee. Up close: a faceplate with sunken eye slits and a breathing grille —
 * measured onto the mask by raycast, because the eye bar this replaces was
 * authored inside the mask and only its corners ever showed — layered
 * pauldrons, a studded belt with hanging tassets, and bracers.
 */
export function buildAcolyte(opts = {}) {
  const S = opts.scale ?? 1.04;
  const rig = new Rig(humanoidSkeleton(S), { scale: S });
  const robe = clothMat(0x16171c, 0.94);
  const inner = clothMat(0x3a1a1e, 0.9);
  // leather was bare — pauldrons and belt rendered as black vinyl
  const leather = leatherMat(0x1c1c21, 0.52);
  const skin = skinMat(opts.skinColor ?? 0xb08a72);
  const maskMat = metalMat(0x767b87, 0.36, 0.45, 3.6);
  const trim = metalMat(0xb08f4c, 0.34, 0.80, 3.6);
  const eye = emissiveMat(0xff2a1a, 5.0);
  // the cowl is an open shell — it has to be lit from the inside too
  const hoodMat = clothMat(0x121317, 0.95);
  hoodMat.side = THREE.DoubleSide;

  const stud = rivet(0.006 * S);

  /** The mask itself is the head: a skull under it would never be seen. */
  // Skull pulled back so the faceplate is a mass, not a decal on a sphere.
  const headShell = (s) => assemble([
    [(() => { const g = new THREE.SphereGeometry(0.106 * s, 14, 11); g.scale(0.94, 1.14, 0.94); return g; })(),
      [0, 0.102 * s, -0.026 * s]],
    // faceplate, and the ridge down its centre line
    [plateGeo(0.132 * s, 0.166 * s, 0.105 * s, 0.028 * s, 3), [0, 0.100 * s, 0.046 * s], [-0.06, 0, 0]],
    [plateGeo(0.034 * s, 0.184 * s, 0.124 * s, 0.012 * s, 1), [0, 0.098 * s, 0.048 * s], [-0.06, 0, 0]],
    // the tapered respirator, and the nape
    [limbGeo(0.090 * s, 0.048 * s, 0.028 * s, 8, true, { rings: 2, capN: 2, capY0: 0.3, capY1: 0.6 }),
      [0, 0.042 * s, 0.046 * s], [1.36, 0, 0]],
    [plateGeo(0.106 * s, 0.092 * s, 0.056 * s, 0.014 * s, 1), [0, 0.048 * s, -0.114 * s], [0.34, 0, 0]],
  ], 'head');

  dressHumanoid(rig, {
    scale: S,
    body: robe, arm: inner, leg: robe, hand: leather, boot: leather, head: maskMat,
    deltoid: false,
    // Lean, where the trooper is heavy. These two and the Jedi share one
    // skeleton and one standing height, so the only thing that can separate
    // them at range is mass distribution: the acolyte is narrow through the
    // chest and the limbs and carries all of its width low, in a coat that
    // flares to 46cm at the hem.
    parts: { chestR: 0.146, shoulderR: 0.126, hipR: 0.124, waistR: 0.106,
             armR: 0.042, clavR: 0.056, thighR: 0.080, neckR: 0.055, torsoDepth: 0.72 },
    seg: { torso: 16, arm: 14, leg: 10, clav: 10, neck: 10 },
    limbOpts: {
      hips: { capN: 3 }, spine: { capN: 3 }, chest: { capN: 3 },
      neck: { capN: 2 }, clav: { capN: 2 },
      arm: { capN: 3 }, fore: { capN: 3 }, thigh: { capN: 3 }, shin: { capN: 3 },
    },
    headGeo: headShell,
    hands: { curl: 1.0 },

    buildHead(headObj, s, hg) {
      const k = new Kit();
      // inside the faceplate and clear of the skull's front wall at z = 0.074
      const core = new THREE.Vector3(0, 0.104 * s, 0.084 * s);
      // Eye slits: two bars swept down toward the nose, sunk 8mm into the
      // faceplate so they read as recesses. The single flat bar they replace
      // sat at z = 0.112 against a mask surface at 0.104 — a sticker with two
      // corners visible.
      // Each feature is probed from a point directly BEHIND where it belongs,
      // not from one shared origin. Firing outward at an angle from the mask's
      // centre line only travels a centimetre and a half before it exits, so
      // both eye slits landed 6mm off the nose, overlapping each other.
      k.pair((sx) => {
        const at = (x, y, z) => new THREE.Vector3(sx * x * s, y * s, z * s);
        const d = new THREE.Vector3(sx * 0.20, 0.10, 1).normalize();
        const o = at(0.044, 0.114, 0.062);
        k.aim(maskMat, plateGeo(0.068 * s, 0.030 * s, 0.026 * s, 0.005 * s, 1),
          onSurface(hg, d, 0.021 * s, o), d);
        k.aim(eye, plateGeo(0.054 * s, 0.015 * s, 0.013 * s, 0.003 * s, 1),
          onSurface(hg, d, 0.008 * s, o), d);
        // brow ridge over each slit, swept down toward the nose
        const b = new THREE.Vector3(sx * 0.22, 0.66, 0.72).normalize();
        k.aim(trim, plateGeo(0.070 * s, 0.011 * s, 0.022 * s, 0.003 * s, 1),
          onSurface(hg, b, 0.002 * s, at(0.042, 0.140, 0.060)), b);
        // cheek ridge running back toward the ear
        const c = new THREE.Vector3(sx * 0.96, -0.12, 0.26).normalize();
        k.aim(maskMat, plateGeo(0.088 * s, 0.020 * s, 0.026 * s, 0.004 * s, 1),
          onSurface(hg, c, -0.004 * s, at(0.030, 0.080, 0.040)), c);
      });
      // Breathing grille across the respirator, LAID ON it. aim() puts the
      // panel's height along the normal, so this stood 4.2cm proud of the mask
      // — a gold brick where the mouth should be.
      const m = new THREE.Vector3(0, -0.30, 1).normalize();
      k.face(trim, ventGeo(0.058 * s, 0.042 * s, 0.010 * s, 4),
        onSurface(hg, m, 0.002 * s, new THREE.Vector3(0, 0.050 * s, 0.060 * s)), m);
      // centre crest from the brow over the crown
      k.add(trim, plateGeo(0.016 * s, 0.060 * s, 0.150 * s, 0.005 * s, 1), [0, 0.192 * s, 0.010 * s], [0.16, 0, 0]);

      // Hood — an open cowl with a rolled rim and a peak, rather than a
      // hemisphere pulled over the skull like a swim cap. Three's sphere puts
      // phi=0 at -X and phi=π/2 at +Z, so the shell has to start at 0.8π for
      // the 72° opening to land on the face rather than over one ear.
      const cowl = new THREE.SphereGeometry(0.142 * s, 16, 12,
        Math.PI * 0.80, Math.PI * 1.40, 0, Math.PI * 0.72);
      cowl.scale(1.02, 1.10, 1.14);
      cowl.translate(0, 0.052 * s, -0.024 * s);
      mesh(cowl, hoodMat, headObj);
      // folds gathered at the back of the cowl, which is what stops it
      // reading as a moulded plastic shell
      const kc = new Kit();
      kc.row(3, (i, t) => {
        const a = (t - 0.5) * 1.5 + Math.PI;
        kc.add(hoodMat, limbGeo(0.145 * s, 0.020 * s, 0.008 * s, 5, true, { rings: 3, bulge: 0.2, capN: 2 }),
          [Math.sin(a) * 0.116 * s, 0.170 * s, Math.cos(a) * 0.126 * s], [-2.6, a, 0]);
      });
      kc.bake(headObj);
      // the rim of the opening, thickened so it reads as cloth
      mesh(new THREE.TorusGeometry(0.112 * s, 0.018 * s, 5, 16), hoodMat, headObj,
        [0, 0.100 * s, 0.020 * s], [-0.34, 0, 0]);
      k.bake(headObj);
    },

    dress(r, s) {
      const chestB = r.get('chest'), spineB = r.get('spine'), hipsB = r.get('hips');

      /* ── coat: an asymmetric wrap, right lapel over left ── */
      const k = new Kit();
      k.add(robe, arcGeo(0.140 * s, 0.130 * s, 0.250 * s, 3.4, 0.016 * s, 9), [0, -0.020 * s, 0], null, [1, 1, 0.74]);
      k.add(robe, arcGeo(0.142 * s, 0.132 * s, 0.240 * s, 2.0, 0.020 * s, 7), [0, -0.014 * s, 0], [0, 0.42, 0], [1, 1, 0.74]);
      k.add(inner, arcGeo(0.136 * s, 0.128 * s, 0.180 * s, 1.1, 0.010 * s, 5), [0, 0.030 * s, 0], [0, -0.30, 0], [1, 1, 0.74]);
      // Mantle across the shoulders — the cowl has to come from somewhere, and
      // it is the one place the acolyte is allowed to be wide.
      k.add(robe, bandGeo(0.112 * s, 0.196 * s, 0.082 * s, 0.120 * s, 0.170 * s, 18), [0, 0.084 * s, 0], null, [1, 1, 0.78]);
      k.add(leather, bandGeo(0.186 * s, 0.206 * s, 0.184 * s, 0.204 * s, 0.024 * s, 18), [0, 0.088 * s, 0], null, [1, 1, 0.78]);
      // studs on the collar band's own outer face — the band is 18.4cm across
      // and 14.7 deep after the torso squash, so a circle of 17.2 is inside it
      k.row(9, (i, t) => {
        const a = t * Math.PI * 2;
        k.add(trim, stud, [Math.sin(a) * 0.210 * s, 0.100 * s, Math.cos(a) * 0.164 * s], [1.5708, a, 0]);
      });
      k.bake(chestB.obj);

      /* ── sash across the ribs ── */
      const ks = new Kit();
      ks.add(inner, arcGeo(0.116 * s, 0.130 * s, 0.190 * s, 2.2, 0.012 * s, 7), [0, 0.010 * s, 0], [0, 0.5, 0], [1, 1, 0.74]);
      ks.bake(spineB.obj);

      /* ── belt, tassets, skirt ── */
      const kh = new Kit();
      kh.add(leather, bandGeo(0.118 * s, 0.140 * s, 0.118 * s, 0.140 * s, 0.078 * s, 18), [0, 0.028 * s, 0], null, [1, 1, 0.80]);
      kh.add(trim, plateGeo(0.070 * s, 0.056 * s, 0.028 * s, 0.008 * s, 2), onLimb(hipsB, 0.062 * s, [0, 0, 1], -0.008 * s));
      // on the belt's outer face (14.8cm across, 12.1 deep after the squash)
      kh.row(6, (i, t) => {
        const a = (t - 0.5) * 2.4;
        kh.add(trim, stud, [Math.sin(a) * 0.144 * s, 0.062 * s, Math.cos(a) * 0.116 * s], [1.5708, a, 0]);
      });
      // hanging tassets, longest at the front
      kh.row(5, (i, t) => {
        const a = (t - 0.5) * 2.0;
        kh.add(leather, plateGeo(0.052 * s, 0.200 * s - Math.abs(a) * 0.030 * s, 0.014 * s, 0.005 * s, 1),
          [Math.sin(a) * 0.122 * s, -0.082 * s, Math.cos(a) * 0.102 * s], [0.10, a, 0]);
      });
      // Skirt panels of the coat. Hung dead vertical they made a 24cm tube —
      // the same width as the hips, so from any distance the coat was invisible
      // and the acolyte was a Jedi in black. Raked out at 0.20 they open to a
      // 46cm hem, which is the shape that reads: narrow shoulders over a bell.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const m = mesh(plateGeo(0.150 * s, 0.58 * s, 0.020 * s, 0.010 * s, 1), robe, hipsB.obj,
          [Math.sin(a) * 0.116 * s, -0.196 * s, Math.cos(a) * 0.096 * s]);
        // YXZ, not the default XYZ. Yaw the panel to its station first and THEN
        // rake it outward about its own tangential axis; composed the other way
        // round the rake is applied about the pelvis's X for every panel, so
        // the two at the sides spin in their own plane and the skirt stays a
        // tube however far the rake is pushed.
        m.rotation.order = 'YXZ';
        m.rotation.set(0.22, a, 0);
        m.userData.skirt = { angle: a, index: i };
      }
      kh.bake(hipsB.obj);

      /* ── pauldrons and bracers ── */
      for (const side of ['L', 'R']) {
        const arm = r.get('arm' + side), fore = r.get('fore' + side);
        if (arm) {
          const ka = new Kit();
          const L = arm.length;
          // a heavy cap with two lames hanging off it — layered, not a box
          const cap = new THREE.SphereGeometry(0.104 * s, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.52);
          cap.scale(1.0, 1.06, 1.06);
          ka.add(leather, cap, [0, 0.026 * s, 0], [Math.PI, 0, 0]);
          // welted edge on the cap's own rim (y = 0.033, radius 0.104) — a
          // sphere section has no thickness, and a pauldron you can see the
          // inside of is a bowl on a shoulder
          ka.add(trim, bandGeo(0.098 * s, 0.1075 * s, 0.100 * s, 0.1075 * s, 0.022 * s, 14),
            [0, 0.018 * s, 0], null, [1, 1, 1.06]);
          ka.add(leather, limbPlate(arm, 0.070 * s, 0.132 * s, 3.6, { thick: 0.014 * s, seg: 8, gap: 0.040 * s }),
            [0, 0.070 * s, 0]);
          ka.add(leather, limbPlate(arm, 0.122 * s, 0.180 * s, 3.2, { thick: 0.014 * s, seg: 8, gap: 0.032 * s }),
            [0, 0.122 * s, 0]);
          ka.row(4, (i, t) => {
            const a = (t - 0.5) * 2.2;
            ka.add(trim, stud, [Math.sin(a) * 0.106 * s, 0.040 * s, Math.cos(a) * 0.112 * s], [1.5708, a, 0]);
          });
          // the sleeve of the coat over the humerus
          ka.add(robe, bandGeo(0.048 * s, 0.062 * s, 0.042 * s, 0.056 * s, L * 0.55, 12), [0, L * 0.40, 0]);
          ka.bake(arm.obj);
        }
        if (fore) {
          const kf = new Kit();
          const L = fore.length;
          kf.add(robe, bandGeo(0.042 * s, 0.052 * s, 0.046 * s, 0.076 * s, 0.062 * s, 12), [0, 0.020 * s, 0]);
          kf.add(leather, limbPlate(fore, L * 0.30, L * 0.88, 5.2, { thick: 0.012 * s, seg: 9, gap: 0.005 * s }),
            [0, L * 0.30, 0]);
          kf.add(trim, bandGeo(0.038 * s, 0.048 * s, 0.038 * s, 0.048 * s, 0.014 * s, 12), [0, L * 0.86, 0]);
          kf.row(3, (i, t) => {
            const a = (t - 0.5) * 1.4;
            const rr = onLimb(fore, L * 0.44, [1, 0, 0], -0.016 * s)[0];
            kf.add(trim, stud, [Math.sin(a) * rr, L * 0.44, Math.cos(a) * rr], [1.5708, a, 0]);
          });
          kf.bake(fore.obj);
        }
      }

      /* ── greaves ── */
      for (const side of ['L', 'R']) {
        const shin = r.get('shin' + side);
        if (!shin) continue;
        const kn = new Kit();
        const L = shin.length;
        kn.add(leather, limbPlate(shin, L * 0.24, L * 0.84, 3.6, { thick: 0.012 * s, seg: 8, gap: 0.005 * s }),
          [0, L * 0.24, 0]);
        kn.add(leather, bandGeo(0.042 * s, 0.056 * s, 0.042 * s, 0.056 * s, 0.026 * s, 12), [0, L * 0.86, 0]);
        kn.add(trim, limbPlate(shin, L * 0.30, L * 0.34, 2.0, { thick: 0.006 * s, seg: 6, gap: 0.019 * s }),
          [0, L * 0.30, 0]);
        kn.bake(shin.obj);
      }
    },
  });
  return { rig, palette: { robe, inner, leather, skin, trim, eye } };
}

/* ── droideka ────────────────────────────────────────────────────────── */

/**
 * A tripod crab. The read at range is a domed carapace carried high on three
 * folded legs with a gun on each side — so the carapace is built as three
 * overlapping plates around a spine ridge rather than as one ball, the legs
 * get a real knee housing and a two-toed foot, and the guns get a shroud and
 * cooling fins so they are recognisably guns and not pipes.
 *
 * Everything a leg owns lives under `legs[i].leg`, because that is the object
 * the cut path detaches wholesale.
 */
export function buildDroideka(opts = {}) {
  const S = opts.scale ?? 1.5;
  const group = new THREE.Group();
  const shell = armorMat(opts.color ?? 0x93805f, 0.5, 0.5, 4.0);
  // was bare — every leg, every gun and the whole underside was flat plastic
  const dark = metalMat(0x2f2b25, 0.5, 0.7, 4.0);
  const eye = emissiveMat(0x44ff88, 3);
  const hot = emissiveMat(0x66ff99, 1.4);
  const scorch = scorchMat();

  const riv = rivet(0.010 * S);

  const core = new THREE.Group(); group.add(core);
  core.position.y = 0.60 * S;

  /* ── body: a shallow drum with a carapace over it ── */
  const kc = new Kit();
  const drum = new THREE.SphereGeometry(0.30 * S, 14, 10);
  drum.scale(1, 0.82, 1);
  kc.add(dark, drum);
  // three carapace plates, one above each leg, and the spine between them
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI;
    const cap = new THREE.SphereGeometry(0.33 * S, 8, 5, a - 1.15, 2.30, 0, Math.PI * 0.60);
    cap.scale(1.02, 0.72, 1.02);
    kc.add(shell, cap, [0, 0.02 * S, 0]);
    kc.add(dark, plateGeo(0.030 * S, 0.050 * S, 0.300 * S, 0.008 * S, 1),
      [Math.sin(a + 1.05) * 0.20 * S, 0.20 * S, Math.cos(a + 1.05) * 0.20 * S], [0, a + 1.05, 0]);
    // shield emitter node — the bubble has to come from somewhere
    kc.add(dark, new THREE.CylinderGeometry(0.030 * S, 0.038 * S, 0.075 * S, 6),
      [Math.sin(a) * 0.215 * S, 0.240 * S, Math.cos(a) * 0.215 * S]);
    kc.add(hot, new THREE.SphereGeometry(0.024 * S, 6, 4),
      [Math.sin(a) * 0.215 * S, 0.284 * S, Math.cos(a) * 0.215 * S]);
  }
  // the rim the legs hang off, and its fasteners
  kc.add(dark, bandGeo(0.288 * S, 0.322 * S, 0.288 * S, 0.322 * S, 0.055 * S, 18), [0, -0.10 * S, 0]);
  kc.row(9, (i, t) => {
    const a = t * Math.PI * 2;
    kc.add(shell, riv, [Math.sin(a) * 0.322 * S, -0.072 * S, Math.cos(a) * 0.322 * S], [1.5708, a, 0]);
  });
  // carbon scoring across the carapace
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2, e = 0.15 + rng() * 0.9;
    const rr = 0.335 * S * Math.cos(e * 0.9), yy = 0.02 * S + 0.30 * S * Math.sin(e * 0.9);
    const w = (0.07 + rng() * 0.09) * S;
    kc.aim(scorch, plateGeo(w, 0.005 * S, w * 0.7, 0.002 * S, 1),
      [Math.sin(a) * rr, yy, Math.cos(a) * rr], [Math.sin(a) * 0.8, 0.5, Math.cos(a) * 0.8]);
  }
  kc.bake(core);

  /* ── head pod ── */
  const headG = new THREE.Group(); core.add(headG); headG.position.set(0, 0.235 * S, 0.24 * S);
  // The pod has to project past the carapace: authored at z = 0.06 it was
  // 33cm inside a dome 50cm across and neither sensor was ever drawn.
  const kh = new Kit();
  kh.add(shell, plateGeo(0.20 * S, 0.15 * S, 0.20 * S, 0.045 * S, 2));
  kh.add(dark, new THREE.CylinderGeometry(0.070 * S, 0.085 * S, 0.16 * S, 8), [0, -0.02 * S, -0.14 * S], [1.5708, 0, 0]);
  kh.add(dark, plateGeo(0.15 * S, 0.055 * S, 0.030 * S, 0.010 * S, 1), [0, 0.010 * S, 0.098 * S]);
  // a three-lens sensor cluster in a dark recess
  kh.add(eye, new THREE.SphereGeometry(0.030 * S, 7, 5), [0, 0.012 * S, 0.104 * S], null, [1, 0.8, 0.6]);
  kh.pair((sx) => {
    kh.add(eye, new THREE.SphereGeometry(0.020 * S, 6, 5), [sx * 0.058 * S, 0.006 * S, 0.096 * S], null, [1, 0.8, 0.6]);
    kh.add(dark, plateGeo(0.020 * S, 0.090 * S, 0.110 * S, 0.006 * S, 1), [sx * 0.104 * S, 0.010 * S, -0.010 * S]);
  });
  // the comms fin sweeping back off the crown
  kh.add(shell, plateGeo(0.028 * S, 0.110 * S, 0.150 * S, 0.014 * S, 1), [0, 0.110 * S, -0.070 * S], [0.75, 0, 0]);
  kh.add(dark, ventGeo(0.100 * S, 0.060 * S, 0.014 * S, 3), [0, 0.020 * S, -0.100 * S], [0, Math.PI, 0]);
  kh.bake(headG);

  /* ── legs ── */
  // Geometry is laid out against the two joint positions rather than by eye:
  // hip at the origin, knee out and down at (0, -0.26, 0.24)·S, foot at
  // (0, -0.50, 0.10)·S, with local +Z pointing outward from the body. Each
  // strut is centred on its segment and rotated onto it, so the knee is a
  // real corner instead of two tubes that happen to overlap.
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI;
    const leg = new THREE.Group();
    leg.position.set(Math.sin(a) * 0.26 * S, 0.50 * S, Math.cos(a) * 0.26 * S);
    leg.rotation.y = a;
    group.add(leg);

    const kl = new Kit();
    kl.add(dark, new THREE.SphereGeometry(0.090 * S, 8, 6), [0, 0, 0.02 * S]);
    kl.add(shell, plateGeo(0.150 * S, 0.170 * S, 0.130 * S, 0.030 * S, 1), [0, -0.02 * S, 0.06 * S], [-0.74, 0, 0]);
    kl.add(dark, new THREE.CylinderGeometry(0.058 * S, 0.048 * S, 0.36 * S, 8), [0, -0.13 * S, 0.12 * S], [-0.744, 0, 0]);
    kl.add(shell, arcGeo(0.060 * S, 0.054 * S, 0.26 * S, 3.0, 0.020 * S, 6), [0, -0.03 * S, 0.03 * S], [-0.744 + Math.PI, 0, 0]);
    const ram = ramGeo(0.28 * S, 0.024 * S, 0.013 * S);
    kl.add(dark, ram.body, [0.096 * S, -0.13 * S, 0.12 * S], [-0.744, 0, 0]);
    kl.add(shell, ram.rod, [0.096 * S, -0.13 * S, 0.12 * S], [-0.744, 0, 0]);
    kl.add(dark, new THREE.CylinderGeometry(0.072 * S, 0.072 * S, 0.115 * S, 8), [0, -0.26 * S, 0.24 * S], [0, 0, 1.5708]);
    kl.bake(leg);

    const lower = new THREE.Group(); leg.add(lower);
    lower.position.set(0, -0.26 * S, 0.24 * S);
    const kw = new Kit();
    kw.add(dark, new THREE.CylinderGeometry(0.044 * S, 0.032 * S, 0.30 * S, 8), [0, -0.12 * S, -0.07 * S], [0.528, 0, 0]);
    kw.add(shell, arcGeo(0.046 * S, 0.038 * S, 0.22 * S, 3.2, 0.016 * S, 6), [0, -0.02 * S, -0.012 * S], [0.528, 0, 0]);
    // ankle and a three-toed foot, which is what makes it read as a walker
    kw.add(dark, new THREE.SphereGeometry(0.055 * S, 8, 6), [0, -0.50 * S, 0.10 * S]);
    kw.pair((sx) => kw.add(dark, clawGeo(0.15 * S, 0.028 * S, 0.010 * S, 0.9, 5, 3),
      [sx * 0.032 * S, -0.52 * S, 0.11 * S], [1.05, sx * 0.45, 0]));
    kw.add(dark, clawGeo(0.13 * S, 0.024 * S, 0.009 * S, 0.8, 5, 3), [0, -0.52 * S, 0.07 * S], [-2.0, 0, 0]);
    kw.bake(lower);

    legs.push({ leg, lower, angle: a });
  }

  /* ── guns ── */
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.30 * S, 0.66 * S, 0.02 * S);
    group.add(arm);
    const ka = new Kit();
    // yoke, receiver, a finned shroud and twin barrels, all along +Z so the
    // pitch the AI applies to the group swings the gun the way a gun swings
    ka.add(dark, new THREE.SphereGeometry(0.080 * S, 8, 6));
    ka.add(dark, new THREE.CylinderGeometry(0.062 * S, 0.052 * S, 0.20 * S, 10), [0, 0, 0.12 * S], [1.5708, 0, 0]);
    ka.add(shell, plateGeo(0.150 * S, 0.140 * S, 0.300 * S, 0.030 * S, 2), [0, 0, 0.34 * S]);
    ka.row(4, (i, t) => ka.add(dark, plateGeo(0.172 * S, 0.026 * S, 0.020 * S, 0.006 * S, 1),
      [0, 0.080 * S, (0.24 + t * 0.18) * S]));
    ka.add(dark, plateGeo(0.060 * S, 0.070 * S, 0.140 * S, 0.014 * S, 1), [0, -0.090 * S, 0.28 * S]);
    ka.pair((bx) => ka.add(dark, new THREE.CylinderGeometry(0.028 * S, 0.032 * S, 0.24 * S, 8),
      [bx * 0.042 * S, -0.012 * S, 0.60 * S], [1.5708, 0, 0]));
    ka.bake(arm);
    const muzzle = mesh(new THREE.CylinderGeometry(0.042 * S, 0.048 * S, 0.05 * S, 8), hot,
      arm, [0, -0.012 * S, 0.74 * S], [1.5708, 0, 0]);
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

  return { group, core, headG, legs, arms, shield, shieldMat, palette: { shell, dark, scorch, eye }, scale: S };
}

/* ── spider walker (mini-boss) ───────────────────────────────────────── */

/**
 * Four legs, a hull and a turret. The thing that made the old one read as a
 * crate on sticks was that the legs were smooth tapered tubes with nothing at
 * the joints — so every joint now has a visible housing, every long segment
 * has a ram alongside it whose rod disappears into a cylinder, and each foot
 * is a three-toed claw. The hull gets a sloped glacis, side sponsons over the
 * hip sockets, exhaust stacks and a hull number.
 */
export function buildWalker(opts = {}) {
  const S = opts.scale ?? 2.4;
  const rig = new Rig(walkerSkeleton(S, 4), { scale: S });
  const shell = armorMat(0x77746c, 0.6, 0.45, 3.0);
  const dark = metalMat(0x2b2a27, 0.5, 0.72, 3.0);
  const mark = armorMat(0xa8621e, 0.1, 0.6, 3.0);
  const glass = glassMat(0x121a20, 0.16);
  const eye = emissiveMat(0xffaa22, 3);
  const hot = emissiveMat(0xff6622, 1.2);
  const scorch = scorchMat();

  const riv = rivet(0.022 * S);

  /* ── hull ── */
  const body = rig.get('body');
  const hull = assemble([
    // main tub, sloped glacis at the front, and the engine deck behind
    [plateGeo(1.06 * S, 0.46 * S, 1.30 * S, 0.10 * S, 2), [0, 0.10 * S, 0.02 * S]],
    [plateGeo(0.92 * S, 0.34 * S, 0.46 * S, 0.07 * S, 1), [0, 0.19 * S, 0.66 * S], [0.62, 0, 0]],
    [plateGeo(0.80 * S, 0.30 * S, 0.36 * S, 0.06 * S, 1), [0, -0.04 * S, 0.74 * S], [-0.5, 0, 0]],
    [plateGeo(0.86 * S, 0.34 * S, 0.52 * S, 0.08 * S, 1), [0, 0.34 * S, -0.22 * S]],
    [plateGeo(0.70 * S, 0.26 * S, 0.30 * S, 0.06 * S, 1), [0, 0.16 * S, -0.76 * S], [-0.4, 0, 0]],
  ], 'hull');
  const bm = mesh(hull, shell, body.obj);
  body.parts.push(bm); body.primary = bm; body.radius = 0.6 * S;

  const kb = new Kit();
  // sensor block and viewport at the nose
  kb.add(dark, plateGeo(0.54 * S, 0.16 * S, 0.10 * S, 0.02 * S, 1), [0, 0.20 * S, 0.86 * S], [0.62, 0, 0]);
  kb.add(glass, plateGeo(0.44 * S, 0.10 * S, 0.05 * S, 0.012 * S, 1), [0, 0.215 * S, 0.90 * S], [0.62, 0, 0]);
  kb.pair((sx) => {
    kb.add(eye, new THREE.SphereGeometry(0.045 * S, 7, 5), [sx * 0.34 * S, 0.14 * S, 0.87 * S], null, [1, 0.8, 0.6]);
    // sponsons over the hip sockets, and the fasteners along the flank
    kb.add(shell, plateGeo(0.18 * S, 0.30 * S, 0.86 * S, 0.05 * S, 1), [sx * 0.55 * S, 0.06 * S, 0]);
    kb.add(dark, ventGeo(0.34 * S, 0.20 * S, 0.05 * S, 4), [sx * 0.645 * S, 0.06 * S, -0.24 * S], [0, sx * 1.5708, 0]);
    kb.row(5, (i, t) => kb.add(dark, riv, [sx * 0.648 * S, 0.20 * S, (t - 0.5) * 1.10 * S], [0, 0, -sx * 1.5708]));
    // exhaust stacks off the engine deck
    kb.add(dark, new THREE.CylinderGeometry(0.070 * S, 0.080 * S, 0.34 * S, 8), [sx * 0.26 * S, 0.62 * S, -0.34 * S], [0.18, 0, 0]);
    kb.add(hot, new THREE.CylinderGeometry(0.055 * S, 0.062 * S, 0.05 * S, 8), [sx * 0.26 * S, 0.78 * S, -0.31 * S], [0.18, 0, 0]);
  });
  // dorsal spine and a hull number
  kb.add(dark, plateGeo(0.10 * S, 0.10 * S, 1.10 * S, 0.02 * S, 1), [0, 0.36 * S, 0.10 * S]);
  kb.add(mark, plateGeo(0.24 * S, 0.02 * S, 0.30 * S, 0.006 * S, 1), [0, 0.425 * S, 0.30 * S]);
  kb.pair((sx) => kb.add(mark, plateGeo(0.02 * S, 0.18 * S, 0.28 * S, 0.006 * S, 1), [sx * 0.652 * S, 0.10 * S, 0.26 * S]));
  kb.add(dark, ventGeo(0.60 * S, 0.28 * S, 0.06 * S, 5), [0, 0.34 * S, -0.50 * S], [0, Math.PI, 0]);
  // hull scoring: it has been shot at, and a boss should look like it
  for (let i = 0; i < 6; i++) {
    const sx = rng() < 0.5 ? -1 : 1;
    const w = (0.10 + rng() * 0.18) * S;
    kb.aim(scorch, plateGeo(w, 0.006 * S, w * 0.65, 0.002 * S, 1),
      [sx * 0.652 * S, (-0.02 + rng() * 0.28) * S, (rng() - 0.5) * 1.1 * S], [sx, 0.15, 0]);
  }
  kb.bake(body.obj);

  /* ── turret ── */
  const head = rig.get('head');
  const turret = assemble([
    [new THREE.CylinderGeometry(0.34 * S, 0.40 * S, 0.16 * S, 12), [0, 0.34 * S, 0]],
    [plateGeo(0.60 * S, 0.34 * S, 0.66 * S, 0.08 * S, 2), [0, 0.50 * S, 0.10 * S]],
    [plateGeo(0.50 * S, 0.22 * S, 0.24 * S, 0.05 * S, 1), [0, 0.60 * S, 0.40 * S], [-0.35, 0, 0]],
  ], 'turret');
  const hm = mesh(turret, shell, head.obj);
  head.primary = hm; head.parts.push(hm); head.radius = 0.34 * S;

  const kt = new Kit();
  kt.pair((sx) => {
    kt.add(eye, new THREE.SphereGeometry(0.055 * S, 7, 5), [sx * 0.15 * S, 0.60 * S, 0.51 * S], null, [1, 0.8, 0.6]);
    kt.add(dark, plateGeo(0.10 * S, 0.26 * S, 0.34 * S, 0.03 * S, 1), [sx * 0.32 * S, 0.50 * S, 0.06 * S]);
    kt.add(dark, riv, [sx * 0.20 * S, 0.678 * S, -0.10 * S], null);
  });
  kt.add(mark, plateGeo(0.20 * S, 0.02 * S, 0.20 * S, 0.006 * S, 1), [0, 0.678 * S, -0.10 * S]);
  kt.bake(head.obj);

  const cannons = [];
  for (const sx of [-1, 1]) {
    const kc = new Kit();
    // trunnion, jacketed barrel with cooling rings, muzzle brake
    kc.add(dark, new THREE.CylinderGeometry(0.090 * S, 0.090 * S, 0.16 * S, 8), [sx * 0.26 * S, 0.44 * S, 0.10 * S], [0, 0, 1.5708]);
    kc.add(dark, new THREE.CylinderGeometry(0.070 * S, 0.085 * S, 0.90 * S, 10), [sx * 0.26 * S, 0.44 * S, 0.36 * S], [1.5708, 0, 0]);
    kc.row(4, (i, t) => kc.add(shell, new THREE.CylinderGeometry(0.095 * S, 0.095 * S, 0.035 * S, 8),
      [sx * 0.26 * S, 0.44 * S, (0.08 + t * 0.30) * S], [1.5708, 0, 0]));
    kc.add(dark, new THREE.CylinderGeometry(0.085 * S, 0.075 * S, 0.12 * S, 8), [sx * 0.26 * S, 0.44 * S, 0.80 * S], [1.5708, 0, 0]);
    const meshes = kc.bake(head.obj);
    const m = mesh(new THREE.CylinderGeometry(0.050 * S, 0.062 * S, 0.10 * S, 8), hot, head.obj,
      [sx * 0.26 * S, 0.44 * S, 0.88 * S], [1.5708, 0, 0]);
    cannons.push({ barrel: meshes[0], muzzle: m });
  }

  /* ── legs ── */
  for (let i = 0; i < 4; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    for (const [name, r0, r1, bulge] of [[`hipL${i}`, 0.15, 0.12, 0.06], [`femur${i}`, 0.115, 0.085, 0.10],
                                          [`tibia${i}`, 0.088, 0.052, 0.08], [`tarsus${i}`, 0.055, 0.028, 0.04]]) {
      const b = rig.get(name);
      if (!b) continue;
      const m = mesh(limbGeo(b.length, r0 * S, r1 * S, 8, true, { rings: 4, bulge, bulgeAt: 0.28, capN: 3 }),
        name.startsWith('hip') ? shell : dark, b.obj);
      m.userData.limb = { r0: r0 * S, r1: r1 * S, seg: 8 };
      b.parts.push(m); b.primary = m; b.radius = r0 * S;
    }
    // hip socket: a housing that looks like it turns
    const hip = rig.get(`hipL${i}`);
    if (hip) {
      const k = new Kit();
      k.add(dark, new THREE.CylinderGeometry(0.185 * S, 0.185 * S, 0.20 * S, 10), [0, 0.02 * S, 0], [0, 0, 1.5708]);
      k.add(shell, plateGeo(0.22 * S, 0.20 * S, 0.30 * S, 0.04 * S, 1), [0, 0.10 * S, 0]);
      k.bake(hip.obj);
    }
    const femur = rig.get(`femur${i}`);
    if (femur) {
      const k = new Kit();
      const L = femur.length;
      k.add(shell, limbPlate(femur, L * 0.12, L * 0.78, 3.4, { thick: 0.030 * S, seg: 8, gap: 0.012 * S }), [0, L * 0.12, 0]);
      const ram = ramGeo(L * 0.60, 0.045 * S, 0.026 * S);
      k.add(dark, ram.body, [0, L * 0.44, -0.13 * S]);
      k.add(shell, ram.rod, [0, L * 0.44, -0.13 * S]);
      // the knee, which is where the leg has to look like it hinges
      k.add(dark, new THREE.CylinderGeometry(0.115 * S, 0.115 * S, 0.20 * S, 10), [0, L, 0], [0, 0, 1.5708]);
      k.add(shell, new THREE.CylinderGeometry(0.075 * S, 0.075 * S, 0.23 * S, 8), [0, L, 0], [0, 0, 1.5708]);
      k.bake(femur.obj);
    }
    const tibia = rig.get(`tibia${i}`);
    if (tibia) {
      const k = new Kit();
      const L = tibia.length;
      k.add(shell, limbPlate(tibia, L * 0.10, L * 0.72, 3.2, { thick: 0.024 * S, seg: 8, gap: 0.010 * S }), [0, L * 0.10, 0]);
      const ram = ramGeo(L * 0.52, 0.034 * S, 0.020 * S);
      k.add(dark, ram.body, [0, L * 0.40, 0.11 * S]);
      k.add(shell, ram.rod, [0, L * 0.40, 0.11 * S]);
      k.add(dark, new THREE.CylinderGeometry(0.075 * S, 0.075 * S, 0.15 * S, 8), [0, L, 0], [0, 0, 1.5708]);
      k.bake(tibia.obj);
    }
    const tarsus = rig.get(`tarsus${i}`);
    if (tarsus) {
      const k = new Kit();
      const L = tarsus.length;
      k.add(dark, new THREE.SphereGeometry(0.075 * S, 8, 6), [0, L * 0.94, 0]);
      // three toes, so the foot has a footprint instead of a point
      k.add(shell, clawGeo(0.30 * S, 0.052 * S, 0.018 * S, 1.0, 6, 4), [0, L * 0.94, 0], [-0.6, 0, 0]);
      k.pair((sx) => k.add(shell, clawGeo(0.26 * S, 0.046 * S, 0.016 * S, 1.0, 6, 4),
        [sx * 0.05 * S, L * 0.94, 0], [0.5, sx * 0.7, 0]));
      k.bake(tarsus.obj);
    }
  }
  return { rig, cannons, palette: { shell, dark, mark, scorch, eye }, scale: S };
}

/* ── acklay-style beast (boss) ───────────────────────────────────────── */

/**
 * An animal, not a machine, and it has to read that way at forty metres: a
 * heavy ribbed carapace slung between six legs, a long neck carried forward
 * and up, and a narrow head with mandibles.
 *
 * The neck is the whole trick. walkerSkeleton hangs the head bone 0.6 units
 * BEHIND the body, which is why the old head was a sphere sitting entirely
 * inside the ribcage — invisible from every angle. The body is pulled back
 * and the neck built forward out of the head bone, so the skull clears the
 * shoulders and the AI's head tracking swings the whole neck with it.
 */
export function buildBeast(opts = {}) {
  const S = opts.scale ?? 2.9;
  const rig = new Rig(walkerSkeleton(S, 6), { scale: S });
  // both of these were bare MeshStandardMaterials: an animal rendered in clay
  const hide = hideMat(0x6d5a4a, 0.9);
  const chitin = chitinMat(0x8f7a63, 0.55);
  const belly = hideMat(0xa8907a, 0.92);
  const eye = emissiveMat(0xffdd44, 2.6);
  const tooth = boneMat(0xd8cdb4, 0.34);

  /* ── carapace ── */
  const body = rig.get('body');
  const carapace = assemble([
    [(() => { const g = new THREE.SphereGeometry(0.66 * S, 16, 12); g.scale(0.74, 0.86, 1.28); return g; })(),
      [0, 0.14 * S, -0.20 * S]],
    // shoulder mass at the front, haunch at the back
    [(() => { const g = new THREE.SphereGeometry(0.44 * S, 10, 8); g.scale(0.94, 0.92, 0.9); return g; })(),
      [0, 0.18 * S, 0.42 * S]],
    [(() => { const g = new THREE.SphereGeometry(0.46 * S, 10, 8); g.scale(0.90, 0.94, 1.0); return g; })(),
      [0, 0.12 * S, -0.86 * S]],
  ], 'carapace');
  const bm = mesh(carapace, chitin, body.obj);
  body.primary = bm; body.parts.push(bm); body.radius = 0.7 * S;

  const kb = new Kit();
  // segmented plates over the spine, biggest over the shoulders
  kb.row(7, (i, t) => {
    const z = (0.42 - t * 1.30) * S;
    const w = (0.60 - Math.abs(t - 0.35) * 0.34) * S;
    kb.add(chitin, plateGeo(w * 0.82, 0.10 * S, 0.20 * S, 0.03 * S, 1), [0, (0.70 - Math.abs(t - 0.4) * 0.26) * S, z], [0.1, 0, 0]);
    // a dorsal spine on each plate, tallest over the shoulder
    const h = (0.42 - Math.abs(t - 0.3) * 0.30) * S;
    kb.add(chitin, clawGeo(h, 0.075 * S, 0.012 * S, -0.5, 6, 3), [0, (0.72 - Math.abs(t - 0.4) * 0.26) * S, z], [0.5 - t * 0.5, 0, 0]);
  });
  // ribbed flanks and a soft underbelly
  kb.pair((sx) => {
    kb.row(5, (i, t) => kb.add(chitin, plateGeo(0.06 * S, 0.46 * S, 0.16 * S, 0.02 * S, 1),
      [sx * (0.48 - Math.abs(t - 0.5) * 0.08) * S, 0.06 * S, (0.30 - t * 1.10) * S], [0, 0, sx * 0.24]));
  });
  kb.add(belly, (() => { const g = new THREE.SphereGeometry(0.46 * S, 12, 8); g.scale(0.90, 0.44, 1.30); return g; })(),
    [0, -0.20 * S, -0.24 * S]);
  kb.bake(body.obj);

  /* ── neck and head ── */
  const head = rig.get('head');
  const neckParts = [];
  // four segments swept up and forward out of the bone's origin
  let x = 0, y = 0, z = 0, pitch = 0.55;
  for (let i = 0; i < 4; i++) {
    const len = (0.42 - i * 0.03) * S;
    const r0 = (0.30 - i * 0.045) * S, r1 = (0.26 - i * 0.045) * S;
    neckParts.push([limbGeo(len * 1.08, r0, r1, 10, true, { rings: 3, bulge: 0.06, capN: 2, capY0: 0.3, capY1: 0.3 }),
      [x, y, z], [pitch, 0, 0]]);
    x += 0; y += Math.cos(pitch) * len; z += Math.sin(pitch) * len;
    pitch += 0.30;
  }
  // skull at the end of it: a long wedge, jaw underneath, brow over the eyes
  const hx = 0, hy = y, hz = z;
  neckParts.push([(() => { const g = new THREE.SphereGeometry(0.28 * S, 12, 10); g.scale(0.80, 0.72, 1.55); return g; })(),
    [hx, hy + 0.02 * S, hz + 0.30 * S], [0.32, 0, 0]]);
  neckParts.push([plateGeo(0.30 * S, 0.14 * S, 0.44 * S, 0.05 * S, 1), [hx, hy - 0.12 * S, hz + 0.36 * S], [0.36, 0, 0]]);
  neckParts.push([plateGeo(0.36 * S, 0.10 * S, 0.26 * S, 0.03 * S, 1), [hx, hy + 0.16 * S, hz + 0.18 * S], [0.28, 0, 0]]);
  const skull = assemble(neckParts, 'skull');
  const hm = mesh(skull, hide, head.obj);
  head.primary = hm; head.parts.push(hm); head.radius = 0.6 * S;

  const kh = new Kit();
  kh.pair((sx) => {
    // eye set under the brow, and the horn above it
    kh.add(eye, new THREE.SphereGeometry(0.052 * S, 7, 6), [sx * 0.155 * S, hy + 0.14 * S, hz + 0.20 * S]);
    kh.add(chitin, clawGeo(0.30 * S, 0.050 * S, 0.010 * S, -0.7, 6, 3),
      [sx * 0.13 * S, hy + 0.20 * S, hz + 0.06 * S], [-0.5, sx * 0.25, 0]);
    // mandibles sweeping forward and in
    kh.add(chitin, clawGeo(0.52 * S, 0.070 * S, 0.014 * S, 0.85, 6, 4),
      [sx * 0.17 * S, hy - 0.13 * S, hz + 0.30 * S], [1.30, -sx * 0.30, 0]);
    // teeth along the jaw
    kh.row(4, (i, t) => kh.add(tooth, clawGeo(0.10 * S, 0.022 * S, 0.004 * S, 0.3, 4, 2),
      [sx * 0.115 * S, hy - 0.20 * S, hz + (0.22 + t * 0.34) * S], [0.5, 0, 0]));
    // the upper row hangs from the palate, below the skull's own shell — at
    // hy - 0.05 every one of these was inside the head
    kh.row(4, (i, t) => kh.add(tooth, clawGeo(0.09 * S, 0.020 * S, 0.004 * S, 0.3, 4, 2),
      [sx * 0.115 * S, hy - 0.09 * S, hz + (0.24 + t * 0.32) * S], [2.55, 0, 0]));
    // neck plates
    kh.row(3, (i, t) => kh.add(chitin, plateGeo(0.10 * S, 0.26 * S, 0.10 * S, 0.03 * S, 1),
      [sx * 0.24 * S, (0.18 + t * 0.52) * S, (0.10 + t * 0.34) * S], [0.6, 0, sx * 0.3]));
  });
  kh.bake(head.obj);

  /* ── legs ── */
  for (let i = 0; i < 6; i++) {
    for (const [name, r0, r1, mat, bulge] of [[`hipL${i}`, 0.13, 0.105, chitin, 0.08], [`femur${i}`, 0.12, 0.075, hide, 0.16],
                                              [`tibia${i}`, 0.078, 0.045, chitin, 0.12], [`tarsus${i}`, 0.048, 0.018, chitin, 0.05]]) {
      const b = rig.get(name);
      if (!b) continue;
      const m = mesh(limbGeo(b.length, r0 * S, r1 * S, 8, true, { rings: 4, bulge, bulgeAt: 0.26, capN: 3 }), mat, b.obj);
      m.userData.limb = { r0: r0 * S, r1: r1 * S, seg: 8 };
      b.parts.push(m); b.primary = m; b.radius = r0 * S;
    }
    const hip = rig.get(`hipL${i}`);
    if (hip) {
      const k = new Kit();
      k.add(chitin, new THREE.SphereGeometry(0.140 * S, 8, 6), [0, hip.length, 0]);
      k.bake(hip.obj);
    }
    const femur = rig.get(`femur${i}`);
    if (femur) {
      const k = new Kit();
      const L = femur.length;
      // a chitin plate over the outside of the thigh, and the knee spur
      k.add(chitin, limbPlate(femur, L * 0.10, L * 0.70, 2.6, { thick: 0.022 * S, seg: 7, gap: 0.008 * S }), [0, L * 0.10, 0]);
      k.add(chitin, clawGeo(0.30 * S, 0.055 * S, 0.012 * S, -0.55, 5, 3), [0, L * 0.96, 0], [-0.9, 0, 0]);
      k.bake(femur.obj);
    }
    const tibia = rig.get(`tibia${i}`);
    if (tibia) {
      const k = new Kit();
      const L = tibia.length;
      k.add(chitin, limbPlate(tibia, L * 0.08, L * 0.62, 2.4, { thick: 0.018 * S, seg: 7, gap: 0.006 * S }), [0, L * 0.08, 0]);
      k.bake(tibia.obj);
    }
    const tarsus = rig.get(`tarsus${i}`);
    if (tarsus) {
      const k = new Kit();
      const L = tarsus.length;
      // the hooked claw it actually walks on
      k.add(chitin, clawGeo(0.46 * S, 0.046 * S, 0.010 * S, 1.15, 6, 4), [0, L * 0.92, 0], [0.1, 0, 0]);
      k.add(chitin, clawGeo(0.16 * S, 0.030 * S, 0.008 * S, 0.7, 5, 3), [0, L * 0.88, 0], [-1.5, 0, 0]);
      k.bake(tarsus.obj);
    }
  }
  return { rig, palette: { hide, chitin, belly, eye }, scale: S };
}

/* ── weapons ─────────────────────────────────────────────────────────── */

/**
 * The three blasters. They are held a metre from a first-person camera, so
 * they get a receiver, a magazine, a stock, sights and cooling ribs rather
 * than the four boxes they used to be — and each one bakes down to two meshes
 * so an arena full of troopers does not cost a hundred draw calls in guns.
 */
export function buildBlaster(kind = 'e5') {
  const g = new THREE.Group();
  const body = metalMat(0x2c2f35, 0.48, 0.72, 6.0);
  const dark = leatherMat(0x15161a, 0.72);
  const glow = emissiveMat(0xff4422, 1.6);
  const k = new Kit();
  const rib = (n, x, y, z0, dz, w, h) => k.row(n, (i, t) =>
    k.add(dark, plateGeo(w, h, 0.008, 0.002, 1), [x, y, z0 + t * dz]));

  if (kind === 'e5') {
    // B1 carbine: slab receiver, straight magazine, skeleton stock
    k.add(body, plateGeo(0.040, 0.056, 0.30, 0.008, 1), [0, 0, 0.06]);
    k.add(body, plateGeo(0.030, 0.030, 0.34, 0.006, 1), [0, 0.030, 0.16]);
    k.add(body, new THREE.CylinderGeometry(0.011, 0.013, 0.26, 8), [0, 0.026, 0.20], [1.5708, 0, 0]);
    rib(4, 0, 0.026, 0.10, 0.10, 0.030, 0.030);
    k.add(dark, plateGeo(0.026, 0.11, 0.042, 0.008, 1), [0, -0.072, -0.03], [0.22, 0, 0]);
    k.add(dark, plateGeo(0.022, 0.048, 0.13, 0.006, 1), [0, -0.028, -0.15]);
    k.add(dark, plateGeo(0.030, 0.012, 0.12, 0.004, 1), [0, 0.036, -0.14]);
    k.add(dark, plateGeo(0.010, 0.024, 0.014, 0.003, 1), [0, 0.052, 0.28]);
    k.add(glow, new THREE.CylinderGeometry(0.010, 0.013, 0.03, 8), [0, 0.026, 0.325], [1.5708, 0, 0]);
    g.userData.muzzle = new THREE.Vector3(0, 0.026, 0.34);
  } else if (kind === 'dc15') {
    // clone rifle: heavier receiver, ribbed cooling shroud, scope, solid stock
    k.add(body, plateGeo(0.048, 0.068, 0.38, 0.010, 1), [0, 0, 0.08]);
    k.add(body, new THREE.CylinderGeometry(0.017, 0.020, 0.36, 10), [0, 0.030, 0.24], [1.5708, 0, 0]);
    rib(5, 0, 0.030, 0.14, 0.20, 0.052, 0.052);
    k.add(dark, new THREE.CylinderGeometry(0.013, 0.013, 0.11, 8), [0, 0.064, 0.03], [1.5708, 0, 0]);
    k.add(dark, plateGeo(0.020, 0.020, 0.030, 0.004, 1), [0, 0.064, -0.03]);
    k.add(dark, plateGeo(0.034, 0.125, 0.048, 0.010, 1), [0, -0.084, -0.02], [0.24, 0, 0]);
    k.add(dark, plateGeo(0.030, 0.062, 0.19, 0.010, 1), [0, -0.020, -0.20]);
    k.add(body, plateGeo(0.040, 0.026, 0.10, 0.006, 1), [0, -0.048, 0.08]);
    k.add(dark, plateGeo(0.010, 0.026, 0.014, 0.003, 1), [0, 0.056, 0.40]);
    k.add(glow, new THREE.CylinderGeometry(0.013, 0.016, 0.04, 8), [0, 0.030, 0.425], [1.5708, 0, 0]);
    g.userData.muzzle = new THREE.Vector3(0, 0.030, 0.45);
  } else {
    // heavy repeater: three barrels in a shroud, drum magazine, carry handle
    k.add(body, plateGeo(0.070, 0.088, 0.44, 0.014, 1), [0, 0, 0.10]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      k.add(body, new THREE.CylinderGeometry(0.014, 0.016, 0.42, 8),
        [Math.sin(a) * 0.026, 0.03 + Math.cos(a) * 0.026, 0.31], [1.5708, 0, 0]);
    }
    k.row(4, (i, t) => k.add(dark, new THREE.CylinderGeometry(0.050, 0.050, 0.014, 8),
      [0, 0.030, (0.16 + t * 0.26)], [1.5708, 0, 0]));
    k.add(dark, new THREE.CylinderGeometry(0.058, 0.058, 0.052, 10), [0, -0.058, 0.04], [0, 0, 1.5708]);
    k.add(dark, plateGeo(0.040, 0.140, 0.060, 0.012, 1), [0, -0.100, -0.06], [0.20, 0, 0]);
    k.add(dark, plateGeo(0.026, 0.034, 0.20, 0.008, 1), [0, 0.086, 0.06]);
    k.add(dark, plateGeo(0.034, 0.070, 0.16, 0.010, 1), [0, -0.020, -0.22]);
    k.add(glow, new THREE.CylinderGeometry(0.016, 0.020, 0.04, 8), [0, 0.030, 0.50], [1.5708, 0, 0]);
    g.userData.muzzle = new THREE.Vector3(0, 0.030, 0.53);
  }
  k.bake(g);
  g.traverse(o => { o.castShadow = true; });
  return g;
}
