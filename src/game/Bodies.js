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
 * opts.swells  — [[at, amp, width], …]: several NARROW swells instead of one
 *                broad one. A limb has more than one muscle on it and the
 *                single-hump form cannot express that: `bulge` decays over the
 *                whole remaining length of the shaft, so a deltoid at t=0.14
 *                and a bicep at t=0.40 smear into one sausage. Each entry here
 *                is a gaussian of half-width `width`, forced to exactly zero at
 *                both ends of the shaft (see below) so r0 and r1 are still the
 *                endpoint radii Ragdoll rebuilds a severed stub against.
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
  const swells = opts.swells || null;
  // A gaussian with its own endpoint values subtracted off linearly, so it is
  // identically zero at t=0 and t=1 whatever width it is given, and still peaks
  // at 1 where it is centred. Without that subtraction a deltoid swell 14% up
  // the humerus leaves 0.37 of itself sitting on the shoulder cap, and the cut
  // path — which rebuilds a stub from r0 and r1 alone — produces a tube that
  // does not line up with the limb it came out of.
  const hump = (t, at, w) => {
    const g = (x) => Math.exp(-(((x - at) / w) ** 2));
    const ped = lerp(g(0), g(1), t);
    const norm = 1 - lerp(g(0), g(1), at);
    return Math.max(0, g(t) - ped) / Math.max(1e-4, norm);
  };
  // The taper, times one hump that falls to zero at both ends so the shaft
  // still meets its caps at exactly r0 and r1 — otherwise the cut/rebuild path
  // in Ragdoll produces a stub that does not line up with what it came from.
  const rAt = (t) => {
    const base = lerp(r0, r1, t);
    if (swells) {
      let k = 1;
      for (let i = 0; i < swells.length; i++) k += swells[i][1] * hump(t, swells[i][0], swells[i][2]);
      return base * k;
    }
    const u = t < bulgeAt ? t / bulgeAt : (1 - t) / (1 - bulgeAt);
    return base * (1 + bulge * Math.sin(clamp(u, 0, 1) * Math.PI * 0.5));
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
  // Every limb carries a white vertex-colour channel whether or not anything
  // shades it. shadeAO() writes into this one, and the materials that read it
  // have `vertexColors: true` set once, for good — but Ragdoll rebuilds a
  // severed stub by calling straight back into limbGeo with no options at all,
  // and a mesh whose material declares vertex colours over a geometry that has
  // none renders BLACK. Handing every limb a neutral channel is what makes the
  // cut path survive shading it never asked for. Twelve bytes a vertex, and
  // three.js never uploads an attribute the bound program does not read.
  return white(g);
}

/** Attach (or reset) a neutral white vertex-colour channel. */
function white(g) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/**
 * Bake occlusion into a geometry's vertex colours.
 *
 * These characters are lit by one sun, one hemisphere fill and nothing else,
 * and a MeshStandardMaterial with no aoMap has no way to know that the inside
 * of an elbow sees a tenth of the sky the outside of it does. The result is
 * the thing the player kept calling "plastic": every surface at the same
 * brightness, so a neck reads as a tube stuck into a hole rather than as a
 * neck sitting in a collar. There is no second UV set to hang an aoMap on and
 * no room in the budget to bake one, but there IS a vertex per 2cm of surface,
 * which is enough to carry a crease.
 *
 * `fn(x, y, z, nx, ny, nz)` returns the multiplier for that vertex — 1 is open
 * sky, and the darkest anything gets is `floor` (0.34 by default: linear, so
 * it is a two-and-a-half stop drop, roughly what a real armpit measures).
 * Values are linear because three multiplies vertex colours into the diffuse
 * before tonemapping, so 0.5 here really is half the light.
 */
function shadeAO(geo, fn, opts = {}) {
  const floor = opts.floor ?? 0.34;
  if (!geo.attributes.color) white(geo);
  const c = geo.attributes.color, p = geo.attributes.position, nr = geo.attributes.normal;
  for (let i = 0; i < c.count; i++) {
    const k = clamp(fn(p.getX(i), p.getY(i), p.getZ(i),
      nr ? nr.getX(i) : 0, nr ? nr.getY(i) : 1, nr ? nr.getZ(i) : 0), floor, 1);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  c.needsUpdate = true;
  return geo;
}

/**
 * A crease: everything within `r` of the point `p` darkens toward `k`, and
 * surfaces that FACE the crease darken hardest. Composable — call it once per
 * armpit, knee-back and waist fold and multiply the results together.
 */
function creaseAt(px, py, pz, r, k = 0.45, dirBias = 0.55) {
  const r2 = r * r;
  return (x, y, z, nx, ny, nz) => {
    const dx = px - x, dy = py - y, dz = pz - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) return 1;
    const d = Math.sqrt(d2) || 1e-6;
    const t = 1 - d / r;
    let f = t * t * (3 - 2 * t);
    // a surface with its back to the crease is not occluded by it
    const facing = (nx * dx + ny * dy + nz * dz) / d;
    f *= clamp((1 - dirBias) + dirBias * (0.5 + 0.5 * facing), 0, 1);
    return 1 - (1 - k) * f;
  };
}
/** Multiply a list of shaders into one. */
const ao = (...fns) => (x, y, z, nx, ny, nz) => {
  let v = 1;
  for (let i = 0; i < fns.length; i++) v *= fns[i](x, y, z, nx, ny, nz);
  return v;
};

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
  // The popliteal fossa: the hollow behind the knee. Without it the calf mass
  // runs straight up into the joint, and at 120° of knee flex — a sprint
  // stride, a kneel, a crouch — the top of the shin is drawn 12cm INSIDE the
  // thigh, which is a rigid-tube artefact no amount of soft-tissue hand-waving
  // covers. Scooping the back of the leg where a real one is scooped moves the
  // geometry out of the way and looks like a knee while it is at it.
  const hollow = o.hollow ?? 0, hollowAt = o.hollowAt ?? 0.06, hollowW = o.hollowW ?? 0.16;
  return (th, t) => {
    const c = Math.cos(th);
    const tc = clamp(t, 0, 1);
    const u = (tc - at) / 0.34;
    const swell = Math.exp(-(u * u));
    const back = Math.max(0, -c);
    let r = (1 - flat * Math.max(0, c) ** 2) * (1 + mass * back ** 1.4 * swell);
    if (hollow) {
      const v = (tc - hollowAt) / hollowW;
      r *= 1 - hollow * back ** 1.2 * Math.exp(-(v * v));
    }
    return r;
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

/**
 * A tube swept along a polyline — lekku, montrals, head tentacles, horns.
 *
 * `nodes` is [[x, y, z, r], …]: the spine of the tube and its radius at each
 * node, in the frame the tube is going to be parented into. Everything the
 * species pass hangs off a head is one of these, and they are all authored the
 * same way — by typing where the tip has to END UP rather than by composing a
 * chain of rotations, because "the left lek finishes 18cm below the shoulder
 * blade" is a thing that can be checked and "rotate 0.4 then 0.3 then 0.25" is
 * not.
 *
 * Two things make it worth having its own builder rather than reusing clawGeo:
 *
 *   · clawGeo merges one CAPPED limbGeo per segment, so a six-segment tail
 *     carries five pairs of end caps buried inside itself — 60% of its
 *     triangles are surface nobody can ever see, and on a 13k budget with 76
 *     spare that is the whole feature;
 *   · the frame is parallel-transported (rotation-minimising) rather than
 *     re-derived per node from world up. A lek that leaves the temple pointing
 *     down and finishes pointing back passes through horizontal, where the
 *     up-reference degenerates and the section corkscrews 90° in one step.
 *
 * The ring carries exactly `seg` vertices — no duplicated seam column — so
 * computeVertexNormals() is smooth the whole way round instead of leaving a
 * crease down the length of every tail. The price is that u wraps backwards
 * over one column in 8, which on a noise bake at this size is invisible.
 *
 * `opts.section(u, t)` scales the radius: u is the angle from the frame's own
 * +X, t runs 0→1 along the tube. Lekku are flattened, not round.
 */
export function tubeGeo(nodes, seg = 8, opts = {}) {
  const n = nodes.length;
  const sect = opts.section || null;
  const tipLen = opts.tip ?? 0.9;          // ×r, how far the point stands past the last node
  const capRoot = opts.capRoot !== false;
  const P = nodes.map(a => new THREE.Vector3(a[0], a[1], a[2]));
  const R = nodes.map(a => a[3]);
  // tangents: central differences, one-sided at the ends
  const T = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  // parallel transport: start from whichever world axis is least parallel to T0
  const N = [];
  {
    const t0 = T[0];
    const seed = Math.abs(t0.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    N.push(seed.projectOnPlane(t0).normalize());
    const q = new THREE.Quaternion();
    for (let i = 1; i < n; i++) {
      q.setFromUnitVectors(T[i - 1], T[i]);
      N.push(N[i - 1].clone().applyQuaternion(q).projectOnPlane(T[i]).normalize());
    }
  }
  const pos = [], uv = [], idx = [];
  const v = new THREE.Vector3(), bi = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    bi.crossVectors(T[i], N[i]);
    const t = n === 1 ? 0 : i / (n - 1);
    for (let j = 0; j < seg; j++) {
      const u = (j / seg) * Math.PI * 2;
      const r = R[i] * (sect ? sect(u, t) : 1);
      v.copy(P[i]).addScaledVector(N[i], Math.cos(u) * r).addScaledVector(bi, Math.sin(u) * r);
      pos.push(v.x, v.y, v.z);
      uv.push(j / seg, t);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + (j + 1) % seg;
      const c = a + seg, d = b + seg;
      // Winding, derived rather than guessed: (N, B, T) is right-handed, so the
      // outward normal of the quad is (b−a)×(c−a) = B×T = +N. The other order
      // gives −N and a tail that is lit from inside.
      idx.push(a, b, c, b, d, c);
    }
  }
  // the point, and a flat disc closing the root so a severed tail is not a pipe
  const apex = pos.length / 3;
  v.copy(P[n - 1]).addScaledVector(T[n - 1], R[n - 1] * tipLen);
  pos.push(v.x, v.y, v.z); uv.push(0.5, 1);
  for (let j = 0; j < seg; j++) idx.push((n - 1) * seg + j, (n - 1) * seg + (j + 1) % seg, apex);
  if (capRoot) {
    const hub = pos.length / 3;
    pos.push(P[0].x, P[0].y, P[0].z); uv.push(0.5, 0);
    for (let j = 0; j < seg; j++) idx.push(j, hub, (j + 1) % seg);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return white(g);
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
  // Only if something in the pile is actually shaded — a hand assembled from
  // nineteen unshaded pieces should not pay for a channel of solid white.
  let anyC = false;
  for (const p of parts) if (p.geo.attributes.color) { anyC = true; break; }
  const col = anyC ? new Float32Array(vTotal * 3).fill(1) : null;
  const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  let vo = 0, io = 0;
  for (const p of parts) {
    const g = p.geo;
    nm.getNormalMatrix(p.matrix);
    const gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
    const gc = col && g.attributes.color;
    if (gc) for (let i = 0; i < gp.count; i++) {
      col[(vo + i) * 3] = gc.getX(i); col[(vo + i) * 3 + 1] = gc.getY(i); col[(vo + i) * 3 + 2] = gc.getZ(i);
    }
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
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * Attach `target` to `base` as morph target 0.
 *
 * A baked geometry has no bones and no retained transform — which is exactly
 * why the hand could never open. But two builds that walk the SAME part list
 * in the same order differ only in the matrices bakeTree flattens, so vertex i
 * means the same vertex of the same part in both, and the difference between
 * them is a legal morph target. That gives one continuous shape parameter at
 * no CPU cost: the GPU interpolates, nothing here runs per frame.
 *
 * The guard below is the whole safety of the scheme and is not decoration — a
 * morph across mismatched topology is silent garbage, not an error, so the
 * vertex count AND the entire index buffer are compared. Colours come across
 * too: an AO set baked for the closed pose paints creases where the open pose
 * has nothing to cast them (measured: 75% of the 364 digit vertices carry a
 * darkening the open hand does not want, mean 0.775 against 0.976), so each
 * pose is shaded for itself and the difference rides along as morphAttributes.
 * `color` — supported by three r169 exactly like position and normal.
 */
export function addShapeMorph(base, target, name = 'morph') {
  const bp = base.attributes.position, tp = target.attributes.position;
  if (bp.count !== tp.count) {
    throw new Error(`morph "${name}": ${bp.count} vertices against ${tp.count} — not the same build`);
  }
  const bi = base.index, ti = target.index;
  if (!!bi !== !!ti || (bi && bi.count !== ti.count)) {
    throw new Error(`morph "${name}": the two builds do not share an index buffer`);
  }
  if (bi) for (let i = 0; i < bi.count; i++) {
    if (bi.getX(i) !== ti.getX(i)) throw new Error(`morph "${name}": index ${i} differs — vertex order is not the same`);
  }
  const delta = (a, b) => {
    const n = a.itemSize * a.count;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = b.array[i] - a.array[i];
    const attr = new THREE.BufferAttribute(out, a.itemSize);
    attr.name = name;
    return attr;
  };
  base.morphTargetsRelative = true;
  base.morphAttributes.position = [delta(bp, tp)];
  const bn = base.attributes.normal, tn = target.attributes.normal;
  if (bn && tn) base.morphAttributes.normal = [delta(bn, tn)];
  const bc = base.attributes.color, tc = target.attributes.color;
  if (bc && tc) base.morphAttributes.color = [delta(bc, tc)];
  // mergeGeos sized the bounding sphere around the closed pose; three widens it
  // to cover the morph targets, and an un-widened one culls an outstretched
  // hand at the edge of the frame.
  base.computeBoundingSphere();
  target.dispose();
  return base;
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
  // A material that declares `vertexColors` over a geometry that carries none
  // does not fall back to white — three leaves the attribute unbound and the
  // mesh renders BLACK. Every mesh in this file is created here, so this is
  // the one place that can guarantee the channel exists; anything shadeAO()
  // has already touched keeps what it was given.
  if (mat && mat.vertexColors && geo && geo.attributes && !geo.attributes.color) white(geo);
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
 *
 * `curl` (0 = straight, 1 = fist) and `splay` (a multiplier on the fan across
 * the knuckles) only ever set rotations on the authoring groups — no geometry
 * is built differently — so two builds that differ ONLY in those two numbers
 * are the same topology vertex for vertex, and addShapeMorph can turn the pair
 * into an open/close morph. Verified in tools/checks/body-parts.mjs rather
 * than asserted here.
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
  const splay = opts.splay ?? 1;
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
    root.rotation.z = -tw * fan * splay;
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
  /**
   * WHERE THE ANKLE SITS ALONG THE BOOT.
   *
   * Every offset below used to be written from the ankle with the boot in
   * front of it, and measured on the built figure that put the joint 14.5mm
   * behind a 214mm boot — 6.8% of the way back. The figure had no heel. The
   * animator plants its contact point directly under the ankle, so the whole
   * foot hung forward of the point it was standing on: the toe landed 20cm
   * ahead of where the gait thought the step went, the body balanced on the
   * extreme back edge of its own soles, and looking down in first person you
   * saw two long triangles with nothing behind them.
   *
   * On a human the malleolus sits about a quarter of the foot's length back.
   * Everything is therefore laid out FROM THE HEEL and the whole boot slid
   * back by `ankleAt`; at 0.05 the numbers below reproduce exactly what this
   * function used to return, which is how the shift was verified.
   */
  const back = (opts.ankleAt ?? 0.26) * len;
  /**
   * WHERE THE SOLE IS, relative to the ankle.
   *
   * Both plates' flat undersides land at z = 0.62·h, so the depth of the boot
   * decided how far below the ankle the ground was — and every archetype picks
   * its own h. BipedAnimator plants the ankle at a flat 0.072·scale above the
   * contact point regardless, so the two numbers only agreed by accident.
   * Measured, standing, over the built figures: trooper -6.9mm (sole buried in
   * the floor), B2 -5.7mm, jedi +2.2mm, acolyte +5.0mm, B1 +19.4mm — a droid
   * standing two centimetres off the ground.
   *
   * So the underside is placed against the animator's number instead of
   * falling out of the boot's thickness. 0.0705 rather than 0.072 leaves 1.5mm
   * of clearance, which is invisible and is never a sole through a floor.
   */
  const drop = (opts.sole ?? 0.0705) * S - h * 0.62;
  const g = new THREE.Group();
  const add = (geo, pos) => {
    const m = new THREE.Mesh(geo);
    m.position.set(pos[0], pos[1], pos[2] + drop);
    g.add(m);
  };
  // the body of the boot — unchanged in extent, so the soles still land flat
  add(plateGeo(w, len, h, 0.024 * S, 2), [0, len * 0.50 - back, h * 0.12]);
  // a flat sole. The body alone is a pillow rounded at r=0.024, so it met the
  // ground at a single point; this puts a hard, near-flat plate on the bottom.
  add(plateGeo(w * 0.99, len * 0.97, h * 0.18, 0.008 * S, 2), [0, len * 0.50 - back, h * 0.53]);
  // ankle collar rising off the heel (negative z is up)
  add(plateGeo(w * 0.84, len * 0.38, h * 0.74, 0.016 * S, 1), [0, len * 0.16 - back, -h * 0.24]);
  // toe box tapering off the front, and a heel counter
  add(plateGeo(w * 0.84, len * 0.26, h * 0.62, 0.014 * S, 1), [0, len * 0.91 - back, h * 0.14]);
  add(plateGeo(w * 0.82, len * 0.24, h * 0.66, 0.012 * S, 1), [0, len * 0.10 - back, h * 0.08]);
  // THE HEEL BLOCK. A boot's sole is not one slab: the heel is a thicker
  // block than the waist of the shoe, and the step off the back of it is right
  // where the eye looks for the ground contact. Its underside is at 0.62·h,
  // the SAME plane as the sole — a heel that hangs below the tread tips the
  // whole foot toe-up — so what it adds is height up the back, not depth.
  add(plateGeo(w * 0.90, len * 0.30, h * 0.26, 0.007 * S, 1), [0, len * 0.13 - back, h * 0.49]);
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

/**
 * Cloth.
 *
 * `o.repeat` is the weave's tiling — the shipped 2.2 puts a thread about every
 * 3mm on a torso, which is homespun; a fine tunic wants it tighter and a heavy
 * robe looser, and having all of it at one pitch is part of why the layers read
 * as one printed surface rather than as three garments.
 *
 * `o.sheen` swaps in a MeshPhysicalMaterial with a retroreflective sheen lobe.
 * That is what wool and heavy cotton actually do — they go BRIGHTER at grazing
 * angles, where a dielectric GGX lobe goes darker — and it is most of the
 * difference between cloth and painted plastic on a rounded limb. It is not
 * free (physical compiles a heavier fragment shader), so it is asked for by
 * name: the player, who is on screen for the whole game and four hundred
 * millimetres from the camera in first person, gets it; a wave of droids does
 * not.
 *
 * `o.vc` turns on the vertex-colour channel that shadeAO() writes the creases
 * into. mesh() guarantees every geometry handed such a material has one.
 */
function clothMat(color, rough = 0.92, o = {}) {
  const maps = clothMaps(o.repeat ?? 2.2);
  const spec = {
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0,
    normalScale: new THREE.Vector2(o.normal ?? 0.85, o.normal ?? 0.85),
    vertexColors: !!o.vc,
  };
  if (o.sheen) {
    spec.sheen = o.sheen;
    // The sheen tint is the colour of the light scattered off the fibre ends,
    // not of the cloth: warm and desaturated, or the robe picks up a coloured
    // rim that reads as a shader bug.
    spec.sheenColor = new THREE.Color(o.sheenColor ?? 0xd8cdbc);
    spec.sheenRoughness = o.sheenRough ?? 0.62;
    return lit(color, MEAN_ALBEDO.cloth, new THREE.MeshPhysicalMaterial(spec));
  }
  return lit(color, MEAN_ALBEDO.cloth, new THREE.MeshStandardMaterial(spec));
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
function skinMat(color = 0xc79a76, repeat = 3.0, o = {}) {
  const maps = skinMaps(repeat);
  return lit(color, MEAN_ALBEDO.skin, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: 0.95, metalness: 0, normalScale: new THREE.Vector2(0.5, 0.5),
    vertexColors: !!o.vc,
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
function leatherMat(color, rough = 0.66, o = {}) {
  const maps = armorMaps(o.repeat ?? 4.5);
  return note(color, MEAN_ALBEDO.armor, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0.04, normalScale: new THREE.Vector2(o.normal ?? 0.7, o.normal ?? 0.7),
    vertexColors: !!o.vc,
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
  // The deltoid.
  //
  // This was a squashed sphere parented to the humerus and dropped on top of
  // the arm tube. Measured on the built rig: 21% of its 168 triangles were
  // buried inside the arm and the rest stood 13.6mm proud of it, so what the
  // player actually saw was a ball welded onto a pipe with a hard intersection
  // line running right round the shoulder — the single loudest piece of the
  // "arms look like sphatti" complaint, and visible in every third-person shot.
  //
  // A deltoid is not a separate object; it is the top of the humerus being
  // thicker. It is now a swell in the arm's OWN lathe, which makes the surface
  // C1 by construction, kills the intersection line, and costs 168 triangles
  // per arm less than the ball did. `deltoid` may be false (a droid strut),
  // true, or [amp, at, width] to tune it.
  const delt = style.deltoid === false ? null
    : (Array.isArray(style.deltoid) ? style.deltoid : [0.30, 0.15, 0.17]);
  const armSwells = delt ? [[delt[1], delt[0], delt[2]], [0.42, 0.085, 0.20]] : null;
  for (const side of ['L', 'R']) {
    addLimb('clav' + side, clavR, clavR * 0.72, style.body, { seg: SEG.clav ?? 10, rings: 3, bulge: 0.02 });
    addLimb('arm' + side, P.armR0 ?? armR, P.armR1 ?? armR * 0.77, style.arm || style.body,
      armSwells ? { seg: armSeg, rings: 11, swells: armSwells }
                : { seg: armSeg, rings: 5, bulge: 0.10, bulgeAt: 0.30 });
    addLimb('fore' + side, P.foreR0 ?? armR * 0.89, P.foreR1 ?? armR * 0.61, style.arm || style.body,
      { seg: armSeg, rings: 5, bulge: 0.13, bulgeAt: 0.22 });

    const hand = rig.get('hand' + side);
    if (hand) {
      // `style.hands` reaches handGeo too. It used to reach only the default
      // branch, so an archetype that declared BOTH — the Jedi declared
      // `hands: { curl: 0.95 }` and a handGeo that hard-coded the same 0.95 —
      // had a hand-shape field that could be edited to no effect whatsoever.
      const geo = style.handGeo ? style.handGeo(side, S, style.hands || {})
                                : buildHand(side, S, style.hands || {});
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
      // 10×6 rather than 12×8: measured, 84% of this mesh's vertices sit inside
      // the ribcage it is blending into, so two thirds of the tessellation was
      // paying for surface nobody has ever seen. Only the 37mm that stands
      // proud of the chest is the trapezius.
      k.pair((sx) => k.add(style.yokeMat || style.body,
        (() => { const g = new THREE.SphereGeometry(1, 10, 6);
          g.scale(w, rise, (Y.depth ?? 0.062) * S); return g; })(),
        [sx * tip.x * (Y.at ?? 0.50), tip.y - (Y.drop ?? 0.014) * S, (Y.z ?? -0.018) * S],
        [0, 0, -sx * (Y.slope ?? 0.20)]));
      k.bake(cb.obj);
    }
  }

  if (style.dress) style.dress(rig, S);
  return rig;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The character creator — species, face, frame                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Three axes, one figure, and a budget of seventy-six triangles.
 *
 * Nothing here is an asset. `buildJedi` writes the whole person out in code, so
 * "let the player be a Togruta" is a parameter problem — but it is a parameter
 * problem inside a hard wall: tools/checks/characters.mjs caps an archetype at
 * 13 000 triangles and 76 meshes, and the Jedi as shipped measures **12 924
 * triangles in 66 meshes**. There are seventy-six triangles of headroom and ten
 * meshes. A lek is a hundred and twelve triangles.
 *
 * So the rule every non-human species obeys is: IT PAYS FOR ITSELF OUT OF THE
 * HAIR. The human hair — cap, fringe, ear masses, nape and braid — is 732
 * triangles in 2 meshes, and none of the five species below has human hair on
 * it. Each one gets that allowance and no more, which is why the numbers in the
 * tables are what they are rather than what would have been nicer.
 *
 * Three further constraints shaped this more than taste did:
 *
 *   · THE SKELETON IS SHARED AND FIXED. Rig.js is not this file's to edit and
 *     every body in the game is the same size, so a species is a head and a set
 *     of radii — never a new bone. Lekku, montrals and tentacles are therefore
 *     RIGID geometry hung off the head object, not simulated: Cloth.js belongs
 *     to another workstream, and a rigid tail that tracks the head is a thing
 *     that can be measured for torso penetration (it is, below) where a cloth
 *     one would need a solver this pass is not allowed to touch.
 *
 *   · EVERYTHING MUST STILL COME OFF. Actor.addBone() re-homes every child of a
 *     bone object that is not itself a bone, and makes it visible again on the
 *     way — so anything parented to `head.obj` is severed with the head by
 *     construction, and first person's `visible = false` on the head cannot
 *     leave a decapitation with no lekku on it. That is the whole reason these
 *     hang off the head object rather than off the rig root.
 *
 *   · A FACE HAS TO READ AT GAMEPLAY RANGE, NOT IN A PREVIEW. At 8 m through a
 *     60° vertical FOV on a 1080-line frame, one pixel is 8.6 mm and a whole
 *     head is 24 pixels tall. A 3 mm nose is a third of a pixel. The presets
 *     below are therefore built out of the two things that survive that: the
 *     OUTLINE of the cranium and jaw, which moves whole pixels, and the large
 *     shading masses — brow, cheekbone, eye socket — which move the mean
 *     luminance of a five-pixel patch. Everything is measured in
 *     tools/checks/body-parts.mjs at exactly that sampling density rather than
 *     asserted here.
 */

/** The eight numbers a face is. 0 is the face this file shipped with. */
const FACE_KEYS = ['skull', 'brow', 'cheek', 'jaw', 'chin', 'nose', 'eyes', 'mouth'];

/**
 * Six faces, not fifty sliders.
 *
 * Each preset moves several parameters together, because a face is a
 * correlated object — a heavy brow comes with a wide jaw and a low vault, and
 * moving one of the three on its own reads as a defect rather than as a person.
 * They are also deliberately BOLD: measured at the 8 m sampling density, a
 * preset that moves the skull by 4 mm is invisible, so the span between `broad`
 * and `fine` is 17 mm of head breadth — two pixels — and the brow term is worth
 * a fifth of the luminance of the eye band.
 */
export const FACE_PRESETS = [
  { id: 'even',  name: 'Even',  face: {} },
  { id: 'heavy', name: 'Heavy', face: { skull: -0.45, brow: 1.0, cheek: 0.30, jaw: 1.0, chin: 0.65, nose: 0.60, eyes: 0.15, mouth: 0.45 } },
  { id: 'fine',  name: 'Fine',  face: { skull: 0.55, brow: -0.80, cheek: 0.75, jaw: -0.95, chin: -0.35, nose: -0.70, eyes: 0.20, mouth: -0.30 } },
  { id: 'broad', name: 'Broad', face: { skull: -1.0, brow: 0.35, cheek: 1.0, jaw: 0.70, chin: -0.30, nose: 0.35, eyes: 0.95, mouth: 0.85 } },
  { id: 'gaunt', name: 'Gaunt', face: { skull: 0.70, brow: 0.75, cheek: 1.0, jaw: -0.85, chin: 0.90, nose: 0.75, eyes: -0.45, mouth: -0.20 } },
  { id: 'round', name: 'Round', face: { skull: -0.75, brow: -1.0, cheek: -0.65, jaw: -0.30, chin: -0.85, nose: -0.55, eyes: -0.35, mouth: -0.25 } },
];

/**
 * Resolve `face` — a preset id, a raw parameter object, or nothing — into the
 * eight numbers. Missing keys are ZERO, and zero has to mean *exactly* the face
 * this file already shipped: every use of these below is of the form
 * `x * (1 + k*F.jaw)` or `x + k*F.chin`, and `x * 1` and `x + 0` are the
 * identity in float. That is what lets buildJedi() with no arguments still
 * produce the byte-for-byte figure Player, Enemy and the menu preview expect.
 */
function faceOf(face) {
  const out = {};
  for (const k of FACE_KEYS) out[k] = 0;
  let src = face;
  if (typeof face === 'string') src = (FACE_PRESETS.find(p => p.id === face) || FACE_PRESETS[0]).face;
  if (src && typeof src === 'object') {
    for (const k of FACE_KEYS) if (typeof src[k] === 'number' && isFinite(src[k])) out[k] = clamp(src[k], -1, 1);
  }
  return out;
}

/**
 * FRAME IS A CONTINUUM, NOT TWO BOXES.
 *
 * The torso is already three lathes driven by chestR/waistR/hipR/shoulderR and
 * torsoDepth, and the limbs by armR/foreR/thighR, so the mechanism for a body
 * type was sitting in dressHumanoid the whole time with nothing feeding it. One
 * number in [0, 1] drives all of them at once, 0.5 being exactly the figure
 * this file shipped.
 *
 * It is one axis rather than a gender switch because one axis is both better
 * and less work: at 0 it produces a narrow-shouldered, thin-necked, light-limbed
 * figure whose waist is 23% narrower than its hips, and at 1 a heavy one whose
 * waist is 2% WIDER than its hips — the shoulder-to-hip and waist-to-hip ratios
 * are the sexually dimorphic measurements, and they are also the only ones that
 * survive being seen from thirty metres in a robe. Two hard-coded bodies would
 * have given the player those same two figures and nothing in between.
 *
 * BODY_TYPES names five points on it for a UI that would rather show cards than
 * a slider; BUILD_RANGE is the slider's own bounds.
 */
export const BUILD_RANGE = [0, 1];
export const BODY_TYPES = [
  { id: 'slight', name: 'Slight', build: 0.05 },
  { id: 'lean',   name: 'Lean',   build: 0.28 },
  { id: 'even',   name: 'Even',   build: 0.5 },
  { id: 'solid',  name: 'Solid',  build: 0.74 },
  { id: 'heavy',  name: 'Heavy',  build: 0.95 },
];

/**
 * `build` → the signed frame parameter k ∈ [-1, +1].
 *
 * Accepts the slider's number or a BODY_TYPES id. Undefined is 0.5, and
 * (0.5 - 0.5) * 2 is exactly 0, so every `1 + gain*k` below is exactly 1.
 */
function buildOf(build) {
  let t = build;
  if (typeof t === 'string') t = (BODY_TYPES.find(b => b.id === t) || { build: 0.5 }).build;
  if (typeof t !== 'number' || !isFinite(t)) t = 0.5;
  t = clamp(t, BUILD_RANGE[0], BUILD_RANGE[1]);
  return { t, k: (t - 0.5) * 2 };
}

/**
 * WHAT THE PLAYER CAN BE.
 *
 * Chosen for what could be built WELL on a shared skeleton out of a hair
 * allowance, not for length. Every one of the five non-human entries changes
 * the head's outline by something a player can see from across an arena; the
 * two that were cut — Mirialan and Chiss — could not, and the reasons are
 * recorded here rather than in a commit message, because they are the argument
 * for not adding them back:
 *
 *   MIRIALAN is a human with green skin and geometric facial tattooing, and the
 *   tattooing is the species. It was built and measured before it was cut. A
 *   diamond pattern painted as hard as the vertex-colour channel goes — 65%
 *   darkening, which is darker than any real tattoo — moves ELEVEN of the 676
 *   interior pixels of a head at 8 m past a 2% luminance threshold, and none of
 *   its outline. The parameters that were kept move 47 to 108. It is also at
 *   the mesh's Nyquist limit: the face carries 353 vertices at a 7.7 mm mean
 *   spacing and there is no second UV set to hang a texture on, so an 8 mm
 *   diamond cannot be drawn there at all. In the menu preview the same pattern
 *   is 1265 pixels, which is the whole finding: Mirialan is a species you can
 *   only see in the character creator. What survives into the game is the skin
 *   tone, so it is offered as one — see the human row's own `skinTones`.
 *
 *   CHISS is blue skin and red eyes on an otherwise human head: one material
 *   change and a 5 mm iris, which is smaller than the tattoo that already
 *   failed. Same verdict, same remedy — the blue is in the human tone list.
 *
 * `skinTones` overrides the menu's human swatch row for species whose skin is
 * not a human colour; `skin` is what the builder falls back to when nothing is
 * passed, so `buildJedi({ species: 'twilek' })` on its own is already green.
 * `eye`/`sclera` are the iris and the white. `hair: false` says the species
 * spends the human hair allowance on its own head instead.
 */
export const SPECIES = [
  {
    id: 'human', name: 'Human', hair: true, brows: true, eyes: true,
    skin: 0xc79a76, eye: 0x2c1d12, sclera: 0xece7dd,
    // Mirialan and Chiss live here rather than in the species list, for the
    // reason set out above: at gameplay range they ARE their skin.
    skinTones: [
      { name: 'Porcelain', hex: 0xf0cdb4 }, { name: 'Fair', hex: 0xe4b493 },
      { name: 'Warm', hex: 0xc79a76 }, { name: 'Olive', hex: 0xa87c52 },
      { name: 'Bronze', hex: 0x8c5f3c }, { name: 'Umber', hex: 0x6a462c },
      { name: 'Deep', hex: 0x4a2f1d }, { name: 'Ashen', hex: 0xbfae9c },
      { name: 'Mirialan', hex: 0x8fa86a }, { name: 'Chiss', hex: 0x6f8fbe },
    ],
  },
  {
    id: 'zabrak', name: 'Zabrak', hair: false, brows: true, eyes: true,
    // A crown of cranial horns on a shaven skull. The cheapest big silhouette
    // change in the list — ten cones at 36 triangles each — and the only one
    // that leaves the face itself entirely human, which is the point of it.
    skin: 0xb4463a, eye: 0xb08a30, sclera: 0xe8dfcd,
    skinTones: [
      { name: 'Iridonian', hex: 0xb4463a }, { name: 'Ember', hex: 0x8f3a2c },
      { name: 'Ochre', hex: 0xc08a45 }, { name: 'Bone', hex: 0xd9c3a4 },
      { name: 'Dathomiri', hex: 0xc02a22 }, { name: 'Umber', hex: 0x6a462c },
      { name: 'Ash', hex: 0x8b8578 }, { name: 'Warm', hex: 0xc79a76 },
    ],
    face: { brow: 0.35, skull: -0.15 },
  },
  {
    id: 'twilek', name: "Twi'lek", hair: false, brows: false, eyes: true,
    // Two lekku off the temples, down the back. The largest single change to a
    // human outline available on this skeleton: it adds 34 cm of body BELOW the
    // jaw that no other archetype in the game has.
    skin: 0x6f8f6a, eye: 0x8a3b52, sclera: 0xe8e2d6,
    skinTones: [
      { name: 'Rutian', hex: 0x5f7fa8 }, { name: 'Lethan', hex: 0xa33d3d },
      { name: 'Twi\'lek', hex: 0x6f8f6a }, { name: 'Pale jade', hex: 0x9dae8b },
      { name: 'Violet', hex: 0x7a5f96 }, { name: 'Ochre', hex: 0xc2a15c },
      { name: 'Deep indigo', hex: 0x3d4f86 }, { name: 'Ash', hex: 0x8b8578 },
    ],
    face: { cheek: 0.35, brow: -0.35, jaw: -0.25 },
  },
  {
    id: 'togruta', name: 'Togruta', hair: false, brows: false, eyes: true, ears: false,
    // Montrals UP and head-tails DOWN, which is what keeps it from reading as a
    // Twi'lek: the pair reaches 12 cm above the crown, so the figure is taller
    // in silhouette than anything else on the same skeleton. Striped, in vertex
    // colours — free, and the only marking in this list that survives 8 m,
    // because a montral band is 4 cm across rather than 8 mm.
    skin: 0xc4643c, eye: 0x8a5a20, sclera: 0xf0e7d8,
    skinTones: [
      { name: 'Shili red', hex: 0xc4643c }, { name: 'Rust', hex: 0xa14e2e },
      { name: 'Amber', hex: 0xd08a4a }, { name: 'Sunset', hex: 0xdc6a4a },
      { name: 'Blue', hex: 0x5f7fa8 }, { name: 'Green', hex: 0x6f8f6a },
      { name: 'Bone', hex: 0xd9c3a4 }, { name: 'Ash', hex: 0x8b8578 },
    ],
    face: { cheek: 0.55, jaw: -0.35, nose: -0.45, brow: -0.30 },
  },
  {
    id: 'nautolan', name: 'Nautolan', hair: false, brows: false, eyes: true, ears: false,
    // Eight head tentacles swept back off the crown — a wide, low fan, where
    // lekku are two heavy verticals. Solid black eyes with no visible sclera,
    // which is the one face change in the list that reads close up.
    skin: 0x4f7f6c, eye: 0x0a0c0d, sclera: 0x14181a,
    skinTones: [
      { name: 'Glee Anselm', hex: 0x4f7f6c }, { name: 'Deep teal', hex: 0x365f56 },
      { name: 'Sea green', hex: 0x6f9f7a }, { name: 'Slate', hex: 0x5a6f78 },
      { name: 'Rutian', hex: 0x5f7fa8 }, { name: 'Olive', hex: 0x7d8f5a },
      { name: 'Pale', hex: 0xa8bda6 }, { name: 'Ash', hex: 0x8b8578 },
    ],
    face: { skull: 0.35, brow: -0.55, cheek: 0.30, nose: -0.85, chin: -0.30 },
  },
  {
    id: 'keldor', name: 'Kel Dor', hair: false, brows: false, eyes: false, ears: false, mouth: false,
    // An antiox breath mask and two goggle discs over a tall, noseless skull.
    // The eyes, brows and lashes are not built at all — they are behind opaque
    // lenses — which is what pays for the mask: 464 triangles of face nobody
    // could see, spent on the two features that make the head unmistakable at
    // any range.
    skin: 0xc4552e, eye: 0x0d0f12, sclera: 0x0d0f12,
    skinTones: [
      { name: 'Dorin', hex: 0xc4552e }, { name: 'Rust', hex: 0x9e4526 },
      { name: 'Salmon', hex: 0xd97a52 }, { name: 'Deep red', hex: 0x8a2f24 },
      { name: 'Ochre', hex: 0xc08a45 }, { name: 'Grey', hex: 0x8b8578 },
      { name: 'Bone', hex: 0xd9c3a4 }, { name: 'Umber', hex: 0x6a462c },
    ],
    face: { skull: 0.85, brow: -0.70, cheek: 0.85, jaw: -0.55, nose: -1.0, chin: -0.20 },
  },
];

/**
 * A species row from its id, falling back to human. Exported because the menu
 * needs the row to swap its skin swatches, and an unknown id has to resolve to
 * something rather than to undefined — a player whose saved species was renamed
 * gets a human, not a crash on the character screen.
 */
export function speciesOf(id) {
  if (id && typeof id === 'object' && id.id) return id;
  return SPECIES.find(s => s.id === id) || SPECIES[0];
}

/**
 * The vault's three scale factors, shared by the skull and by anything worn
 * ON it.
 *
 * This exists because of a measured defect rather than for tidiness. The hair
 * is a separate assembly of seven shells sized against a fixed braincase, so
 * with the skull parameter driving the skull alone, `skull` moved the rendered
 * outline by TWO PIXELS at 8 m and nothing else — the hair, which is most of
 * the head's outline, sat exactly where it always had. Worse, at skull = -1 the
 * wider braincase pushed through the cap it was supposed to be under, which is
 * the poke-through the scalp bake exists to hide. Both the skull and the hair
 * are built through this, so they move together.
 *
 * `skull` +1 is a tall narrow braincase, -1 a low wide one; the face below it
 * follows at a third of the rate, because a narrow vault over an unchanged jaw
 * reads as a deformity rather than as a different person.
 */
function vaultOf(F) {
  return {
    w: 1 - 0.105 * F.skull,
    h: 1 + 0.085 * F.skull,
    d: 1 + 0.030 * F.skull,
    faceW: 1 - 0.035 * F.skull,
  };
}

/**
 * The skull, as twelve overlapping masses driven by the eight face numbers.
 *
 * This is the same union of ellipsoids buildJedi has always assembled — the
 * proportions in it (head breadth 15.1 cm, the eye line at half the head's
 * height, a jaw carried below the maxilla) were measured once and are not up
 * for negotiation. What is new is that every radius and offset now carries a
 * term, and every term is written so that ZERO IS THE IDENTITY: `r * (1 + g*p)`
 * with p = 0 is `r * 1`, and `y + g*p` is `y + 0`. buildJedi() with no face
 * argument therefore emits the same floats it always did, which is asserted
 * against the previous build rather than hoped for.
 *
 * Which terms are big and which are small is not styling. At 8 m one pixel is
 * 8.6 mm, so `skull` — the vault's breadth, worth ±8 mm a side — gets the
 * largest gain in the function, and `nose`, which can only ever be worth two
 * or three millimetres, gets a gain that makes it read in the menu preview and
 * nowhere else. That is an honest description of what a nose is.
 */
function skullGeo(s, F, sp) {
  const ball = (rx, ry, rz, w = 12, h = 9) => {
    const g = new THREE.SphereGeometry(1, w, h); g.scale(rx * s, ry * s, rz * s); return g;
  };
  const { w: vaultW, h: vaultH, d: vaultD, faceW } = vaultOf(F);
  const g = assemble([
    // braincase, and the occiput carried back off it
    [ball(0.0755 * vaultW, 0.0985 * vaultH, 0.0930 * vaultD, 14, 10), [0, 0.098 * s, -0.012 * s]],
    // the occiput's DEPTH follows the vault too, and that is not symmetry for
    // its own sake: left fixed, a wide-vault preset pushed the back of the
    // skull 1mm through the hair cap, which is one bare vertex of the 117
    // behind the hairline and exactly the poke-through this shape was rebuilt
    // to eliminate.
    [ball(0.0640 * vaultW, 0.0620 * vaultH, 0.0700 * vaultD, 8, 6),   [0, 0.104 * s, -0.048 * s]],
    // maxilla — the mid-face, forward of the braincase
    [ball(0.0705 * faceW * (1 + 0.055 * F.jaw + 0.045 * F.cheek), 0.0780, 0.0820 * (1 + 0.025 * F.nose), 12, 9),
      [0, 0.055 * s, 0.012 * s]],
    // the jaw, as ONE wide mass overlapping the maxilla by most of its own
    // height, then tapering forward and down to the chin
    [ball(0.0600 * faceW * (1 + 0.210 * F.jaw), 0.0560 * (1 + 0.10 * F.chin), 0.0690 * (1 + 0.085 * F.jaw), 12, 8),
      [0, 0.026 * s, 0.022 * s]],
    [ball(0.0455 * faceW * (1 + 0.250 * F.jaw), 0.0390 * (1 + 0.12 * F.chin), 0.0570 * (1 + 0.075 * F.chin), 10, 7),
      [0, 0.008 * s, 0.034 * s]],
    [ball(0.0250 * (1 + 0.230 * F.jaw), 0.0285 * (1 + 0.340 * F.chin), 0.0330 * (1 + 0.220 * F.chin), 8, 6),
      [0, (-0.006 - 0.0075 * F.chin) * s, (0.044 + 0.006 * F.chin) * s]],
    // brow ridge and the root of the nose. The brow's DEPTH is what shades the
    // eye band, so it carries the biggest gain on the face.
    [ball(0.0580 * faceW, 0.0210 * (1 + 0.420 * F.brow), 0.0330 * (1 + 0.400 * F.brow), 10, 5),
      [0, 0.101 * s, (0.055 + 0.006 * F.brow) * s]],
    [ball(0.0180 * (1 + 0.30 * F.nose), 0.0350 * (1 + 0.18 * F.nose), 0.0270 * (1 + 0.26 * F.nose), 8, 6),
      [0, 0.086 * s, 0.064 * s]],
    // the nose: a dorsum running down off the root, and a tip wide enough
    // to carry the wings without needing two more balls for them
    [ball(0.0175 * (1 + 0.32 * F.nose), 0.0280 * (1 + 0.20 * F.nose), 0.0270 * (1 + 0.28 * F.nose), 8, 6),
      [0, 0.065 * s, (0.074 + 0.005 * F.nose) * s]],
    [ball(0.0200 * (1 + 0.34 * F.nose), 0.0165 * (1 + 0.22 * F.nose), 0.0205 * (1 + 0.30 * F.nose), 8, 6),
      [0, 0.049 * s, (0.076 + 0.006 * F.nose) * s]],
    // cheekbones, which is what stops the face being a smooth egg in
    // three-quarter light
    [ball(0.0270 * (1 + 0.44 * F.cheek), 0.0250 * (1 + 0.20 * F.cheek), 0.0270 * (1 + 0.34 * F.cheek), 7, 5),
      [0.0390 * faceW * (1 + 0.10 * F.cheek) * s, (0.073 + 0.004 * F.cheek) * s, (0.0400 + 0.004 * F.cheek) * s]],
    [ball(0.0270 * (1 + 0.44 * F.cheek), 0.0250 * (1 + 0.20 * F.cheek), 0.0270 * (1 + 0.34 * F.cheek), 7, 5),
      [-0.0390 * faceW * (1 + 0.10 * F.cheek) * s, (0.073 + 0.004 * F.cheek) * s, (0.0400 + 0.004 * F.cheek) * s]],
  ], 'head');
  const eyeX = 0.0335 * (1 + 0.30 * F.eyes);
  // Occlusion, baked where a face has it: under the jaw and the cheekbones,
  // in the eye sockets, at the temples and at the wings of the nose. Skin
  // on a single sun with a hemisphere fill has no other way to know that
  // an eye socket is a hole, and a face with no sockets is a doll.
  //
  // THIS IS ALSO WHERE A FACE PRESET ACTUALLY GETS SEEN. Geometry that moves
  // 4 mm is a third of a pixel at gameplay range; the same 4 mm of brow
  // deepening the socket under it by a fifth moves the mean luminance of a
  // five-pixel band, and that is measurable from thirty metres. The two terms
  // that carry a preset are therefore the socket's depth and the hollow under
  // the cheekbone — and both are written with k = 1 at the neutral face, where
  // creaseAt returns exactly 1 and the whole term is a bit-for-bit no-op.
  return shadeAO(g, ao(
    // under the jaw and back under its angle — the deepest shadow on a head
    creaseAt(0, -0.008 * s, -0.006 * s, 0.080 * s, 0.42, 0.75),
    creaseAt(0.048 * s, 0.020 * s, -0.028 * s, 0.048 * s, 0.55, 0.7),
    creaseAt(-0.048 * s, 0.020 * s, -0.028 * s, 0.048 * s, 0.55, 0.7),
    // eye sockets. The eye line is at HALF the head's height — crown
    // 19.7cm, menton -3.5cm, so 8.4cm — not the 10.0 the features here
    // were laid out at, which gave a forehead a third too short and put
    // the whole face too high in the skull.
    creaseAt(eyeX * s, 0.084 * s, 0.048 * s, 0.030 * s, 0.50, 0.55),
    creaseAt(-eyeX * s, 0.084 * s, 0.048 * s, 0.030 * s, 0.50, 0.55),
    // the brow's own shadow, which only exists on a face that has a brow
    creaseAt(eyeX * s, 0.088 * s, 0.052 * s, 0.034 * s, 1 - 0.34 * Math.max(0, F.brow), 0.6),
    creaseAt(-eyeX * s, 0.088 * s, 0.052 * s, 0.034 * s, 1 - 0.34 * Math.max(0, F.brow), 0.6),
    // and the hollow UNDER the cheekbone, which is the only way a cheekbone
    // reads at all on a surface lit by one sun
    creaseAt(0.044 * s, 0.046 * s, 0.044 * s, 0.030 * s, 1 - 0.30 * Math.max(0, F.cheek), 0.5),
    creaseAt(-0.044 * s, 0.046 * s, 0.044 * s, 0.030 * s, 1 - 0.30 * Math.max(0, F.cheek), 0.5),
    // temples
    creaseAt(0.068 * s, 0.104 * s, 0.026 * s, 0.032 * s, 0.66, 0.6),
    creaseAt(-0.068 * s, 0.104 * s, 0.026 * s, 0.032 * s, 0.66, 0.6),
    // either side of the nose, and the crease under the lower lip
    creaseAt(0.020 * s, 0.052 * s, 0.066 * s, 0.019 * s, 0.62, 0.5),
    creaseAt(-0.020 * s, 0.052 * s, 0.066 * s, 0.019 * s, 0.62, 0.5),
    creaseAt(0, 0.022 * s, 0.064 * s, 0.019 * s, 0.66, 0.5),
    // THE SCALP.
    //
    // This is not subtle occlusion, it is insurance. The hair is a union of
    // seven low-poly shells over a low-poly braincase, and wherever a facet
    // of one sags inside a facet of the other a patch of skull shows
    // through — measured at luminance 0.80 against hair at 0.03 in the
    // head portrait, which is a cream pentagon stamped on the back of a
    // dark head and is impossible to miss. Everything above the ear line
    // and behind the hairline is driven to 0.28, so a poke-through reads
    // as a dark root rather than as bare bone.
    //
    // ONLY UNDER HAIR. A Twi'lek has no hair over the crown, and painting the
    // top two thirds of a bare head down to 0.28 is not insurance, it is a
    // black skullcap — which is exactly what the first pass at the species
    // shipped before this was gated.
    sp.hair
      ? (x, y, z) => {
        const above = clamp((y / s - 0.062) / 0.030, 0, 1);
        const face = clamp((z / s - 0.030) / 0.030, 0, 1) * clamp((0.112 - y / s) / 0.030, 0, 1);
        return 1 - 0.72 * above * (1 - face);
      }
      : (x, y, z) => {
        // A bare skull still has occlusion on it — the nape under the occiput
        // and the shadow a montral or a lek root throws — but it is a hint,
        // not a cap: a tenth of a stop at the back of the head and nothing at
        // all above the brow.
        const behind = clamp((-z / s - 0.030) / 0.050, 0, 1);
        const low = clamp((0.070 - y / s) / 0.050, 0, 1);
        return 1 - 0.22 * behind * low;
      },
  ), { floor: 0.30 });
}

/** The species' own face bias, plus whatever the player chose, clamped once. */
function faceFor(sp, face) {
  const chosen = faceOf(face);
  if (!sp.face) return chosen;
  const out = {};
  for (const k of FACE_KEYS) out[k] = clamp(chosen[k] + (sp.face[k] || 0), -1.2, 1.2);
  return out;
}


/* ── what a species puts on a head ───────────────────────────────────── */

/**
 * Everything a non-human species wears instead of hair.
 *
 * All of it is parented to `headObj` and merged to one mesh per material, for
 * three separate reasons that happen to agree:
 *
 *   · Actor.addBone() re-homes exactly the children of a bone object, so a
 *     head severed at the neck carries its lekku away with it and a first-person
 *     `visible = false` cannot leave the piece bald. Nothing else in the file
 *     has to know these exist.
 *   · one merged mesh per material is one draw call, doubled by the shadow
 *     pass, and twenty characters can be up at once.
 *   · the whole assembly is far bigger than half the head shell, which is what
 *     tells the "nothing on a head stands off it like a bolted-on slab" check
 *     that a lek is a garment rather than a stray vent.
 *
 * The budget is the human hair's: 732 triangles and 2 meshes. Every entry below
 * comes in under it, and the check that says so builds all six species.
 */
const SPECIES_HEADS = {
  /**
   * ZABRAK — a crown of cranial horns on a shaven skull.
   *
   * Twelve cones seated by raycasting the assembled skull, so the ring follows
   * whatever the face preset did to the vault instead of hovering off a narrow
   * one. Longest at the front, shortest at the nape, which is the arrangement
   * every reference has and is also what puts the jagged part of the outline
   * where a player looking at a face will see it.
   */
  zabrak(headObj, s, hg, { skin }) {
    const k = new Kit();
    const O = new THREE.Vector3(0, 0.098 * s, -0.012 * s);
    const dir = new THREE.Vector3();
    const N = 12;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      const el = 0.80 - 0.10 * Math.cos(th);            // tipped a little further back at the front
      dir.set(Math.sin(th) * Math.cos(el), Math.sin(el), Math.cos(th) * Math.cos(el)).normalize();
      const p = onSurface(hg, dir, 0.006 * s, O);
      const len = (0.030 + 0.011 * Math.cos(th)) * s;
      const r = 0.0078 * s;
      // the axis leans toward vertical, not straight out of the skull: a horn
      // normal to a sphere at 46 degrees points half sideways and reads as a
      // spike through the head rather than as a crown standing off it
      const ax = new THREE.Vector3(dir.x * 0.55, 1, dir.z * 0.55).normalize();
      k.add(skin, tubeGeo([
        [p[0], p[1], p[2], r],
        [p[0] + ax.x * len * 0.5, p[1] + ax.y * len * 0.5, p[2] + ax.z * len * 0.5, r * 0.56],
        [p[0] + ax.x * len, p[1] + ax.y * len, p[2] + ax.z * len, r * 0.17],
      ], 6, { tip: 1.1 }));
    }
    k.bake(headObj);
  },

  /**
   * TWI'LEK — two lekku off the temples, down the back.
   *
   * Rigid, and hung off the head bone, which means they track the head's yaw.
   * That is the honest trade for not owning Cloth.js this pass, and it is not
   * free: at the ±0.85 rad the player's head glance is clamped to, the tip of a
   * 42 cm lek travels 30 cm sideways. So the path is built to stay OUTSIDE the
   * shoulder line the whole way down — swung out to x = ±7.2 cm before it drops
   * — and the clearance to the torso is measured over the whole glance range in
   * tools/checks/body-parts.mjs rather than eyeballed here.
   *
   * The section is an oval with its long axis across the body, which is what a
   * lek is at the root; the frame is parallel-transported, so that oval stays
   * across the body all the way down instead of corkscrewing at the point where
   * the path passes through horizontal.
   */
  twilek(headObj, s, hg, { skin }) {
    const k = new Kit();
    const sect = (u) => 1 - 0.20 * Math.abs(Math.sin(u));
    // The path is not a drawing, it is a fit, against two measurements that
    // pull in opposite directions.
    //
    // BEHIND: the body under a lek reaches z = -0.104 at the shoulder and
    // -0.134 at the shoulder blade in head-local coordinates, so a lek 38 mm
    // thick has to keep its axis behind -0.17 from the collar down or it runs
    // through the back of the robe.
    //
    // BESIDE: routed straight back off the temple, the whole lek disappears
    // behind the shoulders from the front — and measured at 8 m, a Twi'lek and
    // a Nautolan head-on were 37 pixels apart out of an 1861-pixel head and
    // shoulders, which is two species that read as the same bald man. Between
    // y = +0.12 and y = -0.02 the lek therefore swings OUT to 8.4 cm off the
    // centre line, where the head is only 5.3 cm wide and the shoulders have
    // not started: 4.7 cm of lek stands clear of the skull on each side, and
    // the pair separates.
    //
    // Below y = -0.02 it dives back behind the robe, which is where the first
    // constraint takes over again.
    for (const sx of [-1, 1]) {
      k.add(skin, tubeGeo([
        [sx * 0.056, 0.116, -0.030, 0.034],
        [sx * 0.084, 0.054, -0.054, 0.040],
        [sx * 0.086, 0.008, -0.108, 0.039],
        [sx * 0.078, -0.060, -0.170, 0.034],
        [sx * 0.072, -0.144, -0.186, 0.027],
        [sx * 0.064, -0.224, -0.180, 0.018],
        [sx * 0.056, -0.290, -0.166, 0.009],
      ].map(a => [a[0] * s, a[1] * s, a[2] * s, a[3] * s]), 8, { section: sect, tip: 1.2 }));
    }
    k.bake(headObj);
  },

  /**
   * TOGRUTA — montrals up, head-tails down, and the stripes are free.
   *
   * The montrals are the point. They stand 11 cm above the crown, which makes
   * this the only figure on the shared skeleton that is TALLER than the others
   * — and height is the one silhouette cue that survives any range at all,
   * because it does not depend on resolving the head as a shape.
   *
   * The banding is painted into the vertex colour channel that shadeAO already
   * writes the occlusion into, so it costs nothing: no triangles, no second
   * material, no draw call. It is also the only marking in the whole species
   * pass that survives 8 m, and the reason is arithmetical — a montral band is
   * 40 mm across where a Mirialan tattoo diamond is 8, and one pixel is 8.6.
   */
  togruta(headObj, s, hg, { skin }) {
    const k = new Kit();
    // bands running across the part, spaced by height. Squared cosine rather
    // than a hard edge: at four vertices per band a step function aliases into
    // a stack of triangles.
    const bands = (pitch, phase, depth) => (x, y) => {
      const w = Math.cos((y / s) * Math.PI * 2 / pitch + phase);
      return 1 - depth * clamp(w * 1.6, 0, 1);
    };
    const stripe = (g, pitch, phase) => shadeAO(g, bands(pitch, phase, 0.42), { floor: 0.30 });
    for (const sx of [-1, 1]) {
      // montral: a hollow horn out of the top-side of the skull, swept out then up
      k.add(skin, stripe(tubeGeo([
        [sx * 0.050, 0.150, -0.008, 0.034],
        [sx * 0.073, 0.206, -0.022, 0.026],
        [sx * 0.087, 0.262, -0.034, 0.017],
        [sx * 0.094, 0.306, -0.042, 0.008],
      ].map(a => [a[0] * s, a[1] * s, a[2] * s, a[3] * s]), 8, { tip: 1.3 }), 0.062, 0.4));
      // the front head-tail, lying ON the chest rather than in it. Measured on
      // the standing figure: the tabard's front face is at z = +0.115 in
      // head-local coordinates at this height, so a 26 mm tail wants its axis
      // at +0.148 to rest a centimetre clear of the cloth. It stops at the
      // sternum, because a rigid tail is driven by the head and one that
      // reached the belt would sweep through the ribs on the first glance.
      k.add(skin, stripe(tubeGeo([
        [sx * 0.056, 0.090, -0.014, 0.030],
        [sx * 0.070, 0.040, 0.058, 0.032],
        [sx * 0.078, -0.030, 0.132, 0.029],
        [sx * 0.082, -0.104, 0.160, 0.022],
        [sx * 0.080, -0.166, 0.162, 0.011],
      ].map(a => [a[0] * s, a[1] * s, a[2] * s, a[3] * s]), 8, { tip: 1.2 }), 0.070, 1.1));
    }
    // and the long one down the back
    k.add(skin, stripe(tubeGeo([
      [0, 0.092, -0.072, 0.033],
      [0, 0.030, -0.126, 0.036],
      [0, -0.052, -0.176, 0.030],
      [0, -0.136, -0.190, 0.022],
      [0, -0.212, -0.184, 0.011],
    ].map(a => [a[0] * s, a[1] * s, a[2] * s, a[3] * s]), 8, { tip: 1.2 }), 0.074, 2.0));
    k.bake(headObj);
  },

  /**
   * NAUTOLAN — eight head tentacles in a fan swept back off the crown.
   *
   * Deliberately not lekku: two heavy verticals and eight light diagonals read
   * as different creatures at any range, and the whole point of picking six
   * species rather than eight was that each one is a different SHAPE and not a
   * different tint. The fan is wide (25 cm across at the tips) and low (the
   * tips finish level with the jaw), which is the opposite of the Togruta's
   * tall-and-narrow and of the Twi'lek's narrow-and-long.
   */
  nautolan(headObj, s, hg, { skin }) {
    const k = new Kit();
    for (let i = 0; i < 8; i++) {
      const u = (i + 0.5) / 8 - 0.5;                    // -0.44 … +0.44
      const th = u * 2.6;
      const rx = Math.sin(th) * 0.068, rz = -0.026 - Math.cos(th) * 0.048;
      const ry = 0.168 - 0.052 * Math.abs(u * 2);
      const sag = 0.9 + 0.5 * Math.abs(u * 2);          // the outer ones fall further
      // The tendrils ARCH over the crown before they fall, which is what makes
      // a Nautolan read head-on: eight lumps standing 2 cm above the skull
      // where a Twi'lek has a smooth bald dome. Without the arch the whole fan
      // is behind the head and the two species were 37 pixels apart at 8 m.
      k.add(skin, tubeGeo([
        [rx * 0.86, ry + 0.008, rz + 0.016, 0.015],
        [rx, ry + 0.016, rz, 0.017],
        [rx * 1.34, ry - 0.046 * sag, rz - 0.054, 0.017],
        [rx * 1.66, ry - 0.116 * sag, rz - 0.094, 0.014],
        [rx * 1.86, ry - 0.190 * sag, rz - 0.114, 0.0095],
        [rx * 1.96, ry - 0.252 * sag, rz - 0.118, 0.0048],
      ].map(a => [a[0] * s, a[1] * s, a[2] * s, a[3] * s]), 6, { tip: 1.2 }));
    }
    k.bake(headObj);
  },

  /**
   * KEL DOR — an antiox breath mask and two goggle discs.
   *
   * This is the species that pays for itself twice over: with the eyes behind
   * opaque lenses there is no reason to build a sclera, an iris, a lash or a
   * brow, and those four parts are 464 triangles of face that could never be
   * seen. The mask and the goggles cost less than that on their own, so a Kel
   * Dor is the cheapest head in the list AND the most recognisable one — two
   * hard discs and a dark muzzle survive being 24 pixels tall in a way that no
   * arrangement of a nose and a chin does.
   *
   * Everything is seated by raycasting the assembled skull, so a Kel Dor built
   * with the `broad` face preset gets its goggles on the wider cheekbones
   * rather than 6 mm inside them.
   */
  keldor(headObj, s, hg) {
    const rim = metalMat(0x6d6156, 0.44, 0.85, 3.0);
    const lens = glassMat(0x1b1f24, 0.12);
    const seal = leatherMat(0x2e2823, 0.72, { repeat: 5.0 });
    const k = new Kit();
    const eyeO = new THREE.Vector3(0, 0.086 * s, 0.010 * s);
    for (const sx of [-1, 1]) {
      const d = new THREE.Vector3(sx * 0.34, 0.10, 0.93).normalize();
      const p = onSurface(hg, d, 0.004 * s, eyeO);
      // Kit.aim puts local +Y along the normal, so a disc built about +Y comes
      // out facing the way it was seated — which is what a cylinder wants and
      // what a plate emphatically does not (see Kit.face).
      k.aim(rim, new THREE.CylinderGeometry(0.0245 * s, 0.0225 * s, 0.016 * s, 12), p, d);
      k.aim(lens, new THREE.CylinderGeometry(0.0198 * s, 0.0198 * s, 0.019 * s, 12), p, d);
    }
    // the bridge between the two lenses, and the strap round the temples
    const bd = new THREE.Vector3(0, 0.06, 1).normalize();
    k.aim(rim, plateGeo(0.030 * s, 0.010 * s, 0.011 * s, 0.003 * s, 1),
      onSurface(hg, bd, 0.002 * s, new THREE.Vector3(0, 0.090 * s, 0.010 * s)), bd);
    for (const sx of [-1, 1]) {
      const td = new THREE.Vector3(sx * 0.97, 0.16, 0.18).normalize();
      k.aim(seal, plateGeo(0.020 * s, 0.008 * s, 0.030 * s, 0.003 * s, 1),
        onSurface(hg, td, 0.004 * s, new THREE.Vector3(0, 0.090 * s, 0.010 * s)), td);
    }
    // ── the mask ─────────────────────────────────────────────────────────
    // A shell over the whole lower face from under the goggles to below the
    // chin, seated off the muzzle so it clears whatever the jaw preset did.
    const md = new THREE.Vector3(0, -0.12, 1).normalize();
    const mp = onSurface(hg, md, -0.004 * s, new THREE.Vector3(0, 0.040 * s, 0.010 * s));
    k.face(rim, plateGeo(0.078 * s, 0.082 * s, 0.030 * s, 0.014 * s, 2), mp, md);
    // a rubber seal round its edge, and the two intake canisters at the corners
    k.face(seal, plateGeo(0.086 * s, 0.090 * s, 0.018 * s, 0.010 * s, 1),
      [mp[0], mp[1], mp[2] - 0.012 * s], md);
    for (const sx of [-1, 1]) {
      const cd = new THREE.Vector3(sx * 0.72, -0.16, 0.68).normalize();
      k.aim(rim, new THREE.CylinderGeometry(0.0115 * s, 0.0115 * s, 0.036 * s, 8),
        onSurface(hg, cd, -0.008 * s, new THREE.Vector3(0, 0.030 * s, 0.010 * s)), cd);
    }
    // and the grille, three slats down the centre line where a mouth would be
    for (let i = 0; i < 3; i++) {
      k.face(seal, plateGeo(0.030 * s, 0.005 * s, 0.008 * s, 0.002 * s, 1),
        [mp[0], mp[1] - (i - 1) * 0.010 * s, mp[2] + 0.014 * s], md);
    }
    k.bake(headObj);
  },
};

function speciesHead(sp, headObj, s, hg, ctx) {
  const fn = SPECIES_HEADS[sp.id];
  if (fn) fn(headObj, s, hg, ctx);
}

/* ── Jedi ────────────────────────────────────────────────────────────── */

export function buildJedi(opts = {}) {
  const S = opts.scale ?? 1;
  const robe = ROBE_COLORS[opts.robeIndex ?? 0] || ROBE_COLORS[0];
  const rig = new Rig(humanoidSkeleton(S), { scale: S });
  /**
   * The three creator axes. `sp` is a row of SPECIES, `F` the eight face
   * numbers (the species' own bias folded in), and `k` the signed frame
   * parameter, -1 slight to +1 heavy.
   *
   * All three are written so that the DEFAULT IS THE IDENTITY: species human
   * carries no face bias, an absent face preset is eight zeros, an absent build
   * is exactly 0.5 and therefore k exactly 0, and every use below has the shape
   * `x * (1 + gain*k)` or `x + gain*k`. `x * 1` and `x + 0` are exact in IEEE
   * float, so buildJedi() with no arguments emits byte-for-byte the geometry it
   * emitted before any of this existed — which Player, Enemy, Net and the menu
   * preview all depend on, and which is asserted against the previous build
   * rather than assumed.
   */
  const sp = speciesOf(opts.species);
  const F = faceFor(sp, opts.face);
  const { k } = buildOf(opts.build);

  /**
   * Five cloth tones off a two-tone palette, not two.
   *
   * The figure had exactly one garment colour on the body and one on the arms,
   * and at any range past three metres that reads as a single painted
   * surface — a cone with tubes coming out of it. What sells layered cloth is
   * a TONAL ladder between the layers: the over-robe darker than the body, the
   * body darker than the sleeve, and the trim darker than all of them. Each
   * step is derived from the palette the player picked rather than typed, so
   * every robe colour in ROBE_COLORS gets the same reading.
   *
   * Each layer also gets its own weave pitch. A tabard woven at the same
   * threads-per-metre as the shirt under it is the same cloth, and the eye
   * knows it.
   */
  const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
  // sheen: wool goes BRIGHTER at grazing angles. Only the player pays for the
  // physical shader — see clothMat.
  const W = { vc: true, sheen: 0.40 };
  const tunic = clothMat(robe.inner, 0.90, { ...W, repeat: 3.6 });
  const outer = clothMat(robe.outer, 0.93, { ...W, repeat: 2.4 });
  const over = clothMat(mix(robe.outer, robe.trim, 0.46), 0.95,
    { ...W, repeat: 1.6, normal: 1.05, sheen: 0.30 });
  const sleeve = clothMat(mix(robe.outer, robe.inner, 0.44), 0.90, { ...W, repeat: 3.2 });
  const trim = clothMat(robe.trim, 0.84, { ...W, repeat: 4.6, sheen: 0.24 });
  // Was bare: the player's gloves, boots, bracers, belt pouches and obi clasp
  // — everything on the figure that is not cloth or skin — rendered as one
  // flat brown vinyl, and gloves are 20% of the first-person frame. Tighter
  // tiling than the default 4.5: leather grain is finer than plate scuffing.
  const leather = leatherMat(0x53412f, 0.58, { vc: true, repeat: 5.4 });
  // The species' own default tone when nothing is chosen, so
  // `buildJedi({ species: 'twilek' })` is already green rather than beige; the
  // human row's default is 0xc79a76, which is what this line always said.
  const skin = skinMat(opts.skinColor ?? sp.skin ?? 0xc79a76, 3.0, { vc: true });
  // The cap is an open shell, so it has to be lit from the inside too. On the
  // cloth bake rather than bare: hair with no normal detail at all is a
  // moulded plastic wig, and it is 20cm from the camera in every menu shot.
  // Tiled hard so the weave reads as strands rather than as burlap.
  const hair = clothMat(opts.hairColor ?? 0x2a1d14, 0.72,
    { vc: true, repeat: 8.0, normal: 1.25, sheen: 0.34, sheenColor: 0x6b5540, sheenRough: 0.58 });
  hair.side = THREE.DoubleSide;
  // Brows and lashes are two square centimetres of nearly-flat plate facing
  // the sun, and on the hair material's sheen lobe they rendered BRIGHTER than
  // the forehead behind them — a pale bar across the face, which is the
  // opposite of what a brow is for. Matte, and a third darker than the hair.
  const brow = clothMat(mix(opts.hairColor ?? 0x2a1d14, 0x000000, 0.32), 0.86,
    { vc: true, repeat: 9.0 });

  /* The torso lathe is circular and the mesh is squashed on Z, so a garment
   * revolved about the same axis follows the body EXACTLY when it is stretched
   * on X by the inverse of that squash — the two ellipses are then concentric
   * and similar. This one number is why the tabards can wrap instead of
   * standing off the flanks like a sandwich board. */
  // A heavier frame is a DEEPER torso as well as a wider one. Everything that
  // wraps the body — the tabards, the obi, the skirt — is derived from this one
  // number, so it has to be computed before any of them and not typed twice.
  const DEPTH = 0.76 * (1 + 0.055 * k), XK = 1 / DEPTH;
  /**
   * GARMENTS FOLLOW THE BODY UNDER THEM.
   *
   * The tabards are raycast onto the ribcage and look after themselves, but the
   * collar, the obi, the belt, both skirts, the boot shafts and the whole
   * sleeve-and-bracer stack are lathes at typed radii — and a typed radius on a
   * body that just grew 15% is a bracer inside its own forearm. Each of these
   * is the multiplier that was applied to the limb it is worn on, so the
   * relationship the numbers were tuned against holds all the way across the
   * slider. There is a check that walks every band on every build and measures
   * whether the limb is still inside it.
   */
  const KTOR = 1 + 0.105 * k;      // ribcage: tabard caps, the V of the tunic
  const KHIP = 1 + 0.030 * k;      // pelvis: both skirts and the front panels
  // The obi is a WAIST band, not a hip band, and the waist carries five times
  // the hip's gain — so scaling the belt group with the pelvis buried 15% more
  // of the obi at the heavy end than at the middle. Halfway between the two is
  // what actually keeps a belt on a waist while its skirt still covers a hip.
  const KBELT = 1 + 0.080 * k;     // obi, belt, buckle, pouches, hanging ends
  const KARM = 1 + 0.150 * k;      // humerus and forearm: mantle, hem, cuff, bracer
  const KLEG = 1 + 0.120 * k;      // shin: boot shaft, cuff, ankle strap
  const KNECK = 1 + 0.135 * k;     // collar

  /**
   * The outer layer of the robe below the belt — the over-skirt and the two
   * front over-panels — collected as it is built so the runtime can swap it for
   * simulated cloth. See attachSkirt() in Cloth.js and the note at the lathe.
   */
  const outerLayer = [];

  dressHumanoid(rig, {
    scale: S,
    body: outer, arm: sleeve, leg: outer, hand: leather, boot: leather,
    head: skin, skin,
    // The arm, measured over a sleeve rather than on bare skin: 5.2cm at the
    // shoulder joint, 3.9 at the elbow, 4.4 just below it where the flexor
    // mass sits, 3.0 at the wrist where the bracer closes on it. It used to
    // run one near-constant sweep at 4.5→3.5, which is a length of pipe.
    // THE FRAME, as eleven radii off one slider.
    //
    // The gains are not uniform, and which ones are large is the whole content
    // of the body-type feature. Shoulder and chest carry the most because the
    // shoulder-to-hip ratio is what a frame IS in silhouette; the hip goes the
    // OTHER WAY, so a slight build is 10.5% narrower in the shoulder and 5%
    // wider in the hip at once, which turns a 6% radius change into a 16%
    // change in the ratio a viewer actually reads. Waist tracks the chest, so
    // the slight end also gets the narrow-waisted profile and the heavy end a
    // waist 2% wider than its own hips.
    //
    // The pelvis barely moves and the WAIST carries the difference instead
    // (gain 0.135 against the hip's 0.025), for a reason that is structural
    // rather than anatomical: the belt, the obi and both skirts are lathes hung
    // off the pelvis at typed radii, and a pelvis that grows while they do not
    // stands outside its own robe. Waist-to-hip does the same work — it runs
    // 0.86 → 1.09 across the slider — and everything below the belt can then
    // follow one monotone factor.
    //
    // Measured across the range at the 8 m sampling density in
    // tools/checks/body-parts.mjs.
    parts: { chestR: 0.162 * (1 + 0.105 * k), shoulderR: 0.138 * (1 + 0.115 * k),
             hipR: 0.138 * (1 + 0.025 * k), waistR: 0.122 * (1 + 0.135 * k),
             armR: 0.045 * (1 + 0.150 * k), armR0: 0.052 * (1 + 0.165 * k),
             armR1: 0.039 * (1 + 0.130 * k), foreR0: 0.044 * (1 + 0.150 * k),
             foreR1: 0.030 * (1 + 0.110 * k),
             clavR: 0.062 * (1 + 0.100 * k), thighR: 0.090 * (1 + 0.120 * k),
             neckR: 0.058 * (1 + 0.135 * k), torsoDepth: DEPTH },
    // [amp, at, width]: the deltoid peaks 15% down the humerus and is spent by
    // 40%, which is where a deltoid inserts. Folded into the arm's own lathe
    // instead of bolted on as a ball — see dressHumanoid. Its amplitude is the
    // strongest single frame cue on a limb: a shoulder cap is either there or
    // it is not, and unlike a radius it changes the SHAPE of the outline.
    deltoid: [0.34 * (1 + 0.36 * k), 0.15, 0.155],
    seg: { torso: 14, arm: 14, leg: 12, neck: 12, clav: 8 },
    limbOpts: {
      // The thigh carries the quadriceps high and the condyles at the knee;
      // the shin carries the calf a THIRD of the way down (not a fifth, which
      // put the belly of it inside the knee joint) over a scooped popliteal
      // fossa. Both are what stop a leg being two cones with a ring between.
      thigh: { rings: 6, swells: [[0.26, 0.105, 0.24], [0.90, 0.055, 0.10]] },
      // Tuned, not chosen. Swept against the deepest knee the gait solver
      // actually produces (125° at a crouch-walk, measured) and against the
      // three shin tests in tools/checks: this lands the worst calf-into-
      // hamstring penetration at 16mm where the shipped shaping gave 31mm,
      // while carrying MORE calf (mass 0.36 against 0.28) rather than less.
      shin: { rings: 8, swells: [[0.33, 0.22, 0.16]],
              section: calfSection({ flat: 0.11, mass: 0.36, at: 0.33,
                                     hollow: 0.28, hollowAt: 0.03, hollowW: 0.25 }) },
    },
    // The boot is one merged geometry on one material, so a sole cannot be a
    // second colour without a second draw call — but it CAN be a second value.
    // Beware the foot bone's frame (see buildFoot): local +Z points DOWN, so
    // the sole plane is at +0.062·S and the instep is at negative z. Dropping
    // the tread to 0.42 and the welt to 0.66 is what turns a rounded pillow
    // into a boot with a sole under it.
    footGeo: (sc) => shadeAO(buildFoot(sc, { w: 0.092, len: 0.205, h: 0.104 }), ao(
      (x, y, z) => 1 - 0.58 * clamp((z / sc - 0.030) / 0.020, 0, 1),
      // and the crease where the toe box breaks over the ball of the foot.
      // 0.092, not the 0.135 this was authored at: the boot moved back under
      // the ankle (see buildFoot's ankleAt) and a crease that stays put is a
      // crease across the wrong part of the shoe.
      creaseAt(0, 0.092 * sc, 0.010 * sc, 0.028 * sc, 0.60, 0.4),
      // the heel breast — the step down off the back of the heel block, which
      // is the only thing at this range that says the sole is a separate piece
      creaseAt(0, -0.028 * sc, 0.026 * sc, 0.020 * sc, 0.62, 0.45),
    ), { floor: 0.34 }),
    // The glove is the largest single object in a first-person frame and it
    // was one flat value: a mitten. Hand-bone frame is +Y wrist→knuckles and
    // +Z the way the palm faces, so the shading below is the shadow the curled
    // fingers throw back onto the palm and the dark between each digit.
    //
    // Two builds, one geometry. The hand ships CLOSED — that is what it does
    // for all but a second at a time, and it is the pose the colliders, the cut
    // path and the bounding sphere are all read off — with the open pose
    // carried as morph target 0 (`open`). Player.js drives the influence off
    // GESTURES[].palm, which until now reached a quaternion and nothing else:
    // a Force push turned the wrist to face the target and presented a fist.
    //
    // The AO is baked TWICE, once per pose, because it is a positional field
    // and it travels with the vertex. The finger-shadow crease below has
    // nothing casting it once the fingers straighten; measured on the built
    // hand, carrying the closed bake onto the open pose leaves 272 of 364
    // digit vertices darker than 0.90 and a mean of 0.775 where the open hand
    // wants 0.976 — a fifth of the light missing off an extended hand. Only
    // the two terms that are true of any hand are shared.
    handGeo: (side, sc, o) => {
      const anyPose = [
        // the dark forward of the palm plane and between the digits
        (x, y, z) => 1 - 0.34 * clamp((z / sc - 0.016) / 0.026, 0, 1) * clamp((y / sc - 0.030) / 0.030, 0, 1),
        // the web at the base of the thumb
        creaseAt((side === 'L' ? 1 : -1) * 0.030 * sc, 0.028 * sc, 0.016 * sc, 0.024 * sc, 0.58, 0.4),
      ];
      return addShapeMorph(
        shadeAO(buildHand(side, sc, o), ao(
          // the shadow the curled fingers throw back onto the palm — a fist only
          creaseAt(0, 0.058 * sc, 0.030 * sc, 0.034 * sc, 0.52, 0.5), ...anyPose), { floor: 0.38 }),
        // Open: fingers all but straight and fanned nearly twice as wide, which
        // is a flat splayed palm rather than a plank.
        shadeAO(buildHand(side, sc, { ...o, curl: 0.08, splay: 1.9 }),
          ao(...anyPose), { floor: 0.38 }),
        'open');
    },
    hands: { curl: 0.95 },
    headRadius: 0.098,
    // The trapezius. A heavy frame carries the shoulder line higher and further
    // out from the neck; a slight one has a longer, thinner neck showing above
    // the collar, which is the cue the collar itself frames.
    yoke: { reach: 0.62 * (1 + 0.055 * k), rise: 0.031 * (1 + 0.30 * k), depth: 0.064 * (1 + 0.14 * k),
            at: 0.50, drop: 0.014, z: -0.016, slope: 0.22 },
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
    headGeo: (s) => skullGeo(s, F, sp),
    buildHead(headObj, s, hg) {
      // Every feature is raycast onto the assembled skull. Authored against a
      // nominal sphere radius they went missing four separate times — both
      // eyes, both pupils, both brows and the nose had literally never been
      // drawn — because the face mass reaches further forward than the cranium
      // at eye height, so clearing one still leaves you inside the other.
      const sclera = new THREE.MeshStandardMaterial({ color: sp.sclera ?? 0xece7dd, roughness: 0.24 });
      const iris = new THREE.MeshStandardMaterial({ color: sp.eye ?? 0x2c1d12, roughness: 0.18 });
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
      // Eye spacing is the one face parameter that moves a feature rather than
      // a mass, so it moves the PROBE ORIGIN: the eyeball, the iris, the lash
      // and the brow are all seated by raycasting the assembled skull from
      // behind the socket, so widening the eyes re-seats every one of them on
      // the surface that is actually there rather than sliding four parts
      // sideways off a face that curves away underneath them.
      const eyeX = 0.0335 * (1 + 0.30 * F.eyes);
      for (const sx of sp.eyes === false ? [] : [-1, 1]) {
        const k = new Kit();
        // Probed straight forward from a point directly behind the eye. An
        // angled ray exits off the meridian and lands the eyeball on the side
        // of the nose, which is what the first pass did; forward, the exit is
        // by construction the frontmost point of the face at that x and y.
        const o = new THREE.Vector3(sx * eyeX * s, 0.084 * s, 0.010 * s);
        // A real eyeball is 12mm across and mostly buried; a ball sitting proud
        // of the skull reads as an insect. Set into the socket so the brow does
        // the work, with only the iris standing clear.
        k.aim(sclera, new THREE.SphereGeometry(1, 8, 6),
          onSurface(hg, eyeD, 0.0058 * s, o), eyeD,
          [0.0108 * s, 0.0082 * s, 0.0098 * s]);
        k.aim(iris, new THREE.SphereGeometry(1, 6, 5),
          onSurface(hg, eyeD, 0.0022 * s, o), eyeD,
          [0.0050 * s, 0.0050 * s, 0.0050 * s]);
        // The lash line — the single feature that stops an eye being a bead in
        // a hole. On a real face the upper lid overhangs the cornea and lays a
        // hard dark edge across the top third of it; without one the eyeball is
        // a full sphere sitting in a socket and reads as a doll's, which is
        // exactly what the portrait showed. Two millimetres of geometry.
        //
        // Kit.aim's frame again: local +Y goes along the normal and local +Z
        // points DOWN, so a slab authored (w, h, d) comes out (across the
        // face, out of it, down it). Authored the other way round it is a
        // 5mm spike standing out of the eye.
        const ld = new THREE.Vector3(sx * 0.06, 0.30, 0.95).normalize();
        k.aim(brow, plateGeo(0.0200 * s, 0.0032 * s, 0.0036 * s, 0.0010 * s, 1),
          onSurface(hg, ld, 0.0018 * s, o), ld);
        // brow, laid on the ridge above the eye and swept in toward the nose.
        // Twi'lek, Togruta, Nautolan and Kel Dor have none — a species with no
        // hair on its scalp wearing two dark human eyebrows was the single
        // loudest thing wrong with the first pass at the head.
        if (sp.brows !== false) {
          const b = new THREE.Vector3(sx * 0.13, 0.17, 0.98).normalize();
          k.aim(brow, plateGeo(0.0265 * s, 0.0045 * s, 0.0085 * s, 0.0018 * s, 1),
            onSurface(hg, b, -0.0022 * s, new THREE.Vector3(sx * (eyeX - 0.0015) * s, 0.093 * s, 0.020 * s)), b);
        }
        // ear, on the side of the cranium where the cranium actually is.
        // A Togruta hears through its montrals and a Nautolan has none at all,
        // and on both of them the ear landed exactly where the species' own
        // geometry roots — a 15mm lump inside the base of a head-tail.
        if (sp.ears !== false) {
          const e = new THREE.Vector3(sx, -0.05, -0.12).normalize();
          k.aim(skin, (() => { const g = new THREE.SphereGeometry(1, 8, 6);
            g.scale(0.0150 * s, 0.0080 * s, 0.0230 * s); return g; })(),
            onSurface(hg, e, 0.0035 * s, new THREE.Vector3(0, 0.076 * s, -0.012 * s)), e);
        }
        k.bake(headObj);
      }
      // The mouth is a shallow crease with a lip over it. As a separate
      // coloured slab standing off the face it read as a sticker. Its width is
      // the `mouth` parameter and nothing else: a mouth is 26mm of geometry on
      // a head 24 pixels tall at gameplay range, so this is a preview-range
      // feature and the comment says so rather than pretending otherwise.
      if (sp.mouth !== false) {
        const m = new THREE.Vector3(0, -0.05, 1).normalize();
        mesh(plateGeo(0.026 * (1 + 0.30 * F.mouth) * s, 0.0050 * s, 0.006 * s, 0.002 * s, 1), lip, headObj,
          onSurface(hg, m, -0.0012 * s, new THREE.Vector3(0, 0.030 * s, 0.030 * s)),
          [0.06, 0, 0]);
      }

      // Everything the species puts on the head instead of hair — horns,
      // lekku, montrals, tentacles, a breath mask. It runs BEFORE the hair
      // block so that a species which keeps hair (Zabrak does not, but the
      // hook allows it) has the hair laid over its own crown rather than under
      // it, and every mesh it makes is a child of headObj, which is what makes
      // it come off with a severed head. See speciesHead().
      speciesHead(sp, headObj, s, hg, { skin, F });
      if (!sp.hair) return;

      // ── hair ─────────────────────────────────────────────────────────
      // What was here was one smooth spherical cap. A sphere sector laid on a
      // sphere is a swimming cap, and that is precisely what the portrait
      // showed: a dark, perfectly circular helmet with a hard rim. Hair is
      // read at silhouette range by its OUTLINE, and an outline needs to be
      // broken — a parting, a fringe with a corner in it, a mass over each
      // ear, a tail at the nape. Six pieces, still one geometry and one mesh.
      // The hair is most of the head's OUTLINE, so it is sized off the same
      // vault the braincase is — see vaultOf(). Sized against a fixed skull it
      // was a wig standing off a narrow head, or a cap with a wide one growing
      // through it, and `skull` moved the rendered silhouette by two pixels
      // instead of the seven it is worth.
      const V = vaultOf(F);
      const cap = new THREE.SphereGeometry(0.0890 * s, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
      // A hair of margin on the WIDE end only. Measured: at skull = -1 the
      // braincase grew through the cap at one vertex of 117 behind the hairline,
      // which the scalp bake would have rendered as a dark root rather than as
      // bare bone — but zero is cheaper than an excuse.
      cap.scale(1.02 * (V.w + 0.020 * Math.max(0, -F.skull)), 1.32 * V.h, 1.24 * V.d);
      // Tipped about its OWN centre — rotating the mesh instead swings the cap
      // 2cm off the skull. NB the sign: +0.38 tips the axis forward, which
      // drags the rim down over the eyes, the opposite of what is wanted.
      // Swept BACK 43 degrees, not 17. The sign and the size of this are both
      // measurable: the rim has to land above the brow at the front (0.130,
      // against a brow ridge topping out at 0.122 and an eye centred at 0.084 —
      // at -0.30 rad it came down to 0.081 and the fringe hung over both eyes,
      // which tools/verify caught as a face feature buried in the head) and
      // below the ear line at the sides (0.060). Measured across the whole
      // braincase behind the hairline, 0% of it is now left bare; the shape
      // this replaced left 0.5%, and every one of those patches rendered as a
      // cream pentagon at luminance 0.80 against hair at 0.03.
      cap.rotateX(-0.75);
      cap.translate(0, 0.092 * s, -0.010 * s);
      const lump = (rx, ry, rz, w = 8, h = 6) => {
        const g = new THREE.SphereGeometry(1, w, h); g.scale(rx * s, ry * s, rz * s); return g;
      };
      const hairGeo = assemble([
        [cap],
        // the swept fringe: a wedge over the brow, heavier on one side, which
        // is what puts an asymmetric corner in the outline
        [lump(0.052 * V.w, 0.026, 0.030, 8, 5),  [0.020 * V.w * s, 0.150 * V.h * s, 0.050 * s], [0.36, 0.22, -0.14]],
        [lump(0.030 * V.w, 0.021, 0.024, 7, 4),  [-0.040 * V.w * s, 0.143 * V.h * s, 0.042 * s], [0.30, -0.30, 0.20]],
        // a mass over each ear, covering the top of it the way hair does
        [lump(0.030, 0.050 * V.h, 0.054, 7, 5),  [0.066 * V.w * s, 0.092 * s, -0.012 * s], [0, 0, 0.16]],
        [lump(0.030, 0.050 * V.h, 0.054, 7, 5),  [-0.066 * V.w * s, 0.092 * s, -0.012 * s], [0, 0, -0.16]],
        // the nape, filling in under the cap's back edge and running down to
        // the collar rather than stopping in mid-air
        [lump(0.066 * V.w, 0.062, 0.062 * V.d, 8, 6),  [0, 0.056 * s, -0.052 * s]],
        [lump(0.042 * V.w, 0.034, 0.032, 7, 4),  [0, 0.014 * s, -0.058 * s], [0.35, 0, 0]],
      ], 'hair');
      // Hair is self-shadowing and nearly black at the roots: dark under the
      // fringe, dark at the nape, lit along the crown. On a single sun this is
      // the only thing that separates the strands from one another at all.
      shadeAO(hairGeo, ao(
        creaseAt(0, 0.040 * s, -0.050 * s, 0.070 * s, 0.46, 0.5),
        creaseAt(0.070 * s, 0.078 * s, -0.010 * s, 0.045 * s, 0.55, 0.5),
        creaseAt(-0.070 * s, 0.078 * s, -0.010 * s, 0.045 * s, 0.55, 0.5),
        (x, y) => 0.62 + 0.38 * clamp((y / s - 0.045) / 0.11, 0, 1),
      ), { floor: 0.26 });
      mesh(hairGeo, hair, headObj);
      // a short braid, because of course — one tapered strand rather than the
      // five spheres it used to be, which cost 400 triangles on their own.
      //
      // A DIRECT CHILD OF THE HEAD, not a mesh inside a positioning Group, and
      // that is a bug fix rather than tidying. Player._applyViewMode hides first
      // person's own head with `neck.obj.traverse(o => o.visible = !fp)`, which
      // reaches every descendant; Ragdoll's addBone() re-shows only the DIRECT
      // children of the bone it is re-homing. A mesh one level down inside a
      // Group is hidden by the first and missed by the second, so cutting your
      // own head off in first person produced a head with no braid on it.
      // Measured before this change: 13 of the severed head's 14 meshes came
      // back visible. Everything a species hangs on a head goes on through
      // Kit.bake(), which is already a direct child; this was the last one.
      //
      // The group's transform is composed into the mesh's own rather than
      // deleted, so the braid lands on exactly the matrix it always did.
      const braidRot = new THREE.Euler(0.10, 0, 0.09);
      const braidPos = new THREE.Vector3(0, -0.115 * s, 0).applyEuler(braidRot)
        .add(new THREE.Vector3(0.064 * V.w * s, 0.078 * s, 0.008 * s));
      mesh(limbGeo(0.115 * s, 0.0080 * s, 0.0042 * s, 7, true, { rings: 6, bulge: 0.34, bulgeAt: 0.5, capN: 2 }),
        hair, headObj, [braidPos.x, braidPos.y, braidPos.z], [braidRot.x, braidRot.y, braidRot.z]);
    },
    dress(r, s) {
      const chestB = r.get('chest'), chest = chestB.obj;
      const hipsB = r.get('hips'), hips = hipsB.obj;
      const neck = r.get('neck');

      /**
       * A garment panel that WRAPS the torso.
       *
       * arcGeo is authored about +Z with circular radii. The torso lathe is
       * also circular and its MESH is squashed on Z by DEPTH, so stretching
       * the panel on X by 1/DEPTH makes it a scaled copy of exactly the same
       * ellipse — concentric and similar, which is the only way an arc can
       * follow a squashed body all the way to the flank. The old tabards were
       * flat slabs, and measured on the built rig they stood 92mm off the
       * chest at the centre line while sinking into it at the edges: a
       * sandwich board, not a garment.
       *
       * The radius is not typed either — it is raycast against the ribcage in
       * the panel's own three extreme directions and the largest is taken, so
       * the panel clears the body it is worn on by `clear` everywhere along
       * its arc whatever the section under it is doing.
       */
      const wrap = (mat, bone, yLo, yHi, yaw, halfArc, clear, thick, capLo) => {
        // the stretch factors at the three extremes of the arc
        const Ls = [-halfArc, 0, halfArc].map((a) => {
          const th = yaw + a;
          return Math.hypot(XK * Math.sin(th), Math.cos(th));
        });
        const fit = (y) => {
          let need = 0;
          for (let i = 0; i < 3; i++) {
            const th = yaw + [-halfArc, 0, halfArc][i];
            const dx = XK * Math.sin(th) / Ls[i], dz = Math.cos(th) / Ls[i];
            const p = onLimb(bone, clamp(y, 0.004 * s, bone.length - 0.004 * s), [dx, 0, dz], 0);
            need = Math.max(need, (Math.hypot(p[0], p[2]) + clear * s) / Ls[i]);
          }
          return need;
        };
        // `capLo` is an absolute distance from the axis that the panel's OUTER
        // face may not exceed at its bottom edge — how a tabard is tucked
        // under an obi. Without it the panel is fitted against the ribcage all
        // the way down and ends up hanging 25mm outside the belt that is
        // supposed to be holding it.
        const rHi = fit(yHi);
        const rLo = capLo != null
          ? Math.min(fit(yLo), capLo * s / Math.max(...Ls) - thick * s)
          : fit(yLo);
        const g = arcGeo(rLo, rHi, yHi - yLo, halfArc * 2, thick * s, 9);
        g.rotateY(yaw);
        const m = mesh(g, mat, bone.obj, [0, yLo, 0]);
        m.scale.x = XK;
        return m;
      };

      // ── the tabard ─────────────────────────────────────────────────────
      // Two panels down the front with a gap between them, one across the
      // back, all hung from the shoulders and running past the belt. This is
      // the layer that gives the torso a second silhouette; without it the
      // figure is one smooth barrel from the collar to the obi.
      // The bottom edge runs down INSIDE the obi (whose outer face sits at
      // 0.124 from the axis at the panels' own bearing), so the belt reads as
      // holding the tabard rather than as a hoop in front of it.
      const tabTop = 0.185 * s, tabBot = -0.200 * s;
      const tabAO = ao(
        // the shoulders it folds over, and the shadow the belt casts up it
        (x, y) => 1 - 0.30 * clamp((y / s - 0.10) / 0.09, 0, 1),
        (x, y) => 1 - 0.36 * clamp(1 - Math.abs(y / s + 0.165) / 0.075, 0, 1),
      );
      for (const sx of [-1, 1]) {
        const m = wrap(over, chestB, tabBot, tabTop, sx * 0.315, 0.255, 0.013, 0.017, 0.108 * KBELT);
        shadeAO(m.geometry, tabAO, { floor: 0.45 });
      }
      const back = wrap(over, chestB, tabBot, tabTop, Math.PI, 0.42, 0.012, 0.015, 0.104 * KBELT);
      shadeAO(back.geometry, tabAO, { floor: 0.45 });
      // the V of the crossed tunic, showing between the two front panels.
      // It stands off the FRONT of the ribcage, so it has to follow both the
      // chest's radius and its depth — the two multiply. Measured on the
      // heaviest frame with the radius alone: 65% of the panel was inside the
      // chest against 22% on the lightest, which is a garment that quietly
      // disappears at one end of a slider.
      for (const sx of [-1, 1]) {
        mesh(plateGeo(0.115 * s, 0.215 * s, 0.018 * s, 0.009 * s), tunic, chest,
          [sx * 0.036 * s, 0.098 * s, 0.112 * KTOR * (DEPTH / 0.76) * s], [0.10, 0, sx * 0.42]);
      }
      // ── collar ─────────────────────────────────────────────────────────
      // Rides the neck so it clears the shoulder line and gives the head
      // something to sit IN rather than on. Kept nearly straight: flared hard
      // it reads as a funnel round the throat, not a folded collar. Two bands
      // now — the tunic's own standing collar inside the robe's fold-over,
      // because a single ring round a neck is a napkin holder.
      if (neck) {
        // The pale liner is 3cm tall, not 5: at 5 it stood a full 2.4cm proud
        // of the dark fold-over and the whole collar read as one cream ring —
        // a neck brace. The dark layer is the collar; the tunic is a hint of
        // lining at the top of it.
        mesh(bandGeo(0.056 * KNECK * s, 0.063 * KNECK * s, 0.058 * KNECK * s, 0.066 * KNECK * s, 0.030 * s, 12), tunic, neck.obj,
          [0, 0.010 * s, 0], [0.06, 0, 0]);
        const col = mesh(bandGeo(0.060 * KNECK * s, 0.076 * KNECK * s, 0.064 * KNECK * s, 0.086 * KNECK * s, 0.052 * s, 12), trim, neck.obj,
          [0, -0.014 * s, 0], [0.10, 0, 0]);
        shadeAO(col.geometry, (x, y) => 0.56 + 0.44 * clamp(y / (0.052 * s), 0, 1), { floor: 0.4 });
      }
      // ── belt ───────────────────────────────────────────────────────────
      // An obi with a utility belt buckled over it, a clasp, pouches, and two
      // ends hanging off the knot. The hanging ends are the point: a closed
      // ring round a waist is a hoop, and every reference for this character
      // has cloth falling off the front of the belt.
      const obi = mesh(bandGeo(0.126 * KBELT * s, 0.148 * KBELT * s, 0.124 * KBELT * s, 0.144 * KBELT * s, 0.108 * s, 18), trim, hips,
        [0, 0.020 * s, 0], null, [1, 1, DEPTH + 0.06]);
      shadeAO(obi.geometry, (x, y) => 0.66 + 0.34 * Math.sin(clamp(y / (0.108 * s), 0, 1) * Math.PI), { floor: 0.5 });
      mesh(bandGeo(0.140 * KBELT * s, 0.152 * KBELT * s, 0.140 * KBELT * s, 0.152 * KBELT * s, 0.038 * s, 18), leather, hips,
        [0, 0.036 * s, 0], null, [1, 1, DEPTH + 0.06]);
      mesh(plateGeo(0.058 * s, 0.044 * s, 0.020 * s, 0.007 * s), metalMat(0x9a8a6a), hips,
        [0, 0.055 * s, 0.121 * KBELT * s]);
      // pouches, and a capsule bar on the left hip
      for (const sx of [-1, 1]) mesh(plateGeo(0.048 * s, 0.056 * s, 0.034 * s, 0.010 * s), leather, hips,
        [sx * 0.104 * KBELT * s, 0.036 * s, 0.086 * KBELT * s], [0, sx * 0.35, 0]);
      mesh(plateGeo(0.070 * s, 0.024 * s, 0.026 * s, 0.008 * s), leather, hips,
        [-0.058 * s, 0.028 * s, -0.104 * KBELT * s], [0, 0.10, 0]);
      // The two ends: flattened straps hanging off the knot, lightly splayed.
      // limbGeo spans +Y, so they are turned over to hang.
      for (const [sx, len, lean] of [[1, 0.30, 0.10], [-1, 0.22, -0.07]]) {
        const g = limbGeo(len * s, 0.030 * s, 0.020 * s, 8, false,
          { rings: 5, swells: [[0.30, 0.06, 0.4]], section: ovalSection(0.30, 2.6) });
        shadeAO(g, (x, y) => 0.72 + 0.28 * clamp(y / (len * s), 0, 1), { floor: 0.55 });
        mesh(g, trim, hips, [sx * 0.052 * s, 0.024 * s, 0.104 * KBELT * s],
          [Math.PI - 0.14, 0, lean]);
      }

      // ── the robe's skirt ───────────────────────────────────────────────
      //
      // This used to be a 16-sided cone, and it read as exactly that: a smooth
      // featureless funnel that made up a third of the figure's silhouette.
      // Cloth hanging off a waist does not do that — it gathers into vertical
      // folds, and the folds are the whole reason a robe reads as cloth at
      // fifty metres.
      //
      // So the skirt is a lathe with an angular SECTION on it: three cosine
      // harmonics, all integer so the profile closes on itself exactly, and
      // all scaled by t^1.25 so the folds are nothing at the belt and ±2cm at
      // the hem, which is how gathered cloth actually behaves. reshape()
      // transports the normals through analytically, so the ridges light
      // correctly instead of showing a crease down every seam.
      // TWO HEMS, NOT ONE — this is what breaks the cone.
      //
      // Folds alone did not do it. Measured on the built figure, the front-view
      // outline from the hem at y=0.39 to the belt at y=0.89 was a single
      // monotone ramp that sat 8.1mm rms from a straight line: geometrically a
      // cone, whatever the surface detail on it was doing. One garment can only
      // ever produce one ramp. What a layered costume has is a STEP — a hem
      // line with a narrower garment continuing below it — and the eye reads
      // that break before it reads anything else about the shape.
      //
      // So: a long under-robe to mid-calf, and a shorter, wider over-skirt that
      // ends above the knee. The step between the two is 7cm of outline in the
      // space of one edge.
      //
      // The over-skirt also has to actually COVER the hips. It used to start at
      // r=0.140 while the thigh beneath it reached 0.185, so 26-58mm of bare
      // leg stood outside the robe on each side between y=0.84 and y=0.88 —
      // measured on a standing figure, in the coronal plane, and visible from
      // any angle. It is tucked at r=0.142 up inside the obi and bells over the
      // hip with a swell, which is both what covers the thigh and what puts a
      // non-monotone bulge in the profile.
      const skirtH = 0.44 * s;
      const foldAmt = (th) => 0.055 * Math.cos(7 * th + 0.4)
        + 0.030 * Math.cos(3 * th - 1.1) + 0.014 * Math.cos(11 * th + 2.3);
      const foldT = (t) => Math.pow(clamp(t, 0, 1), 1.25);
      // The last swell is NEGATIVE: the profile pinches 6% just short of the
      // hem and comes back out to r1 at it, which with a double-sided lathe is
      // a rolled edge. The first attempt at a hem was a separate horizontal
      // band and it read as a flying saucer round the character's ankles.
      // 28 segments, not 36. The tightest harmonic in the fold is the 11th and
      // 28 samples is 2.5 per period of it at an amplitude of 14mm — the two
      // skirts together were 316 triangles over the 13000 an archetype is
      // allowed, and this is the cheapest 200 of them that costs nothing you
      // can see.
      const skirtGeo = limbGeo(skirtH, 0.142 * KHIP * s, 0.262 * KHIP * s, 28, false, {
        rings: 9, bulge: 0, swells: [[0.22, 0.26, 0.20], [0.93, -0.065, 0.055]],
        section: (th, t) => 1 + foldT(t) * foldAmt(th),
      });
      // The valleys of those folds are in shadow and the ridges catch the sun.
      // Geometry alone would give a fold a lit side and a dark side; only the
      // occlusion term makes the bottom of a fold read as a fold rather than
      // as a facet. Plus the whole top under the belt and the tabard.
      shadeAO(skirtGeo, (x, y, z) => {
        const th = Math.atan2(x, z), t = clamp(y / skirtH, 0, 1);
        const valley = clamp(-foldAmt(th) / 0.075, 0, 1);
        return (1 - 0.46 * foldT(t) * valley) * (0.60 + 0.40 * clamp(t / 0.28, 0, 1));
      }, { floor: 0.30 });
      // The over-skirt is the DARKER cloth — the over-robe reads darker than
      // the body under it, which is the same tonal ladder the tabard uses. It
      // was the mid tone, which made it and the under-layer one garment.
      const skirtMat = over.clone();
      skirtMat.side = THREE.DoubleSide;
      // Turned over about Z, not X. Both flips hang the lathe downward, but a
      // flip about X also sends local +Z to the BACK — so anything with a
      // front to it (these panels have a lobe on the centre line) ends up
      // facing the wrong way, which is a mistake that costs an hour to find in
      // a screenshot. About Z the front stays the front.
      // Hung from +0.058 rather than -0.012: the top edge now sits up inside
      // the obi (which spans +0.020 to +0.128), so the belt holds the skirt
      // instead of floating above a 3cm ring of bare pelvis.
      /*
       * KEPT, AND HANDED OUT.
       *
       * This lathe and the two front panels below are the whole OUTER layer of
       * the robe under the belt, and every one of them is welded to the pelvis:
       * measured on a walking Jedi, a hem vertex of this mesh travels 0.000 mm
       * in the pelvis frame over seven seconds while the cape's hem travels
       * 217 mm beside it. That contrast is the jankiness — nothing is wrong
       * with the cape, it is hanging next to a cylinder.
       *
       * attachSkirt() replaces the three of them with a simulated tube and
       * hides these while it is live. They are not deleted, because the cloth
       * is switched off past lod > 1 exactly as the cape is, and a character at
       * range with no cloth and no lathe has a bare pelvis. `robeSkirt` is the
       * handle: pass it to attachSkirt as `rigid` and the LOD swap is one call.
       */
      outerLayer.push(mesh(skirtGeo, skirtMat, hips, [0, 0.058 * s, 0], [0, 0, Math.PI]));

      // ── the under-robe ─────────────────────────────────────────────────
      // The long layer, in the mid tone, running from the belt to the ankle and
      // showing for 32cm below the over-skirt's hem. Its own fold harmonics
      // are 5 and 3 against the over-skirt's 7, 3 and 11: cloth woven at the
      // same pitch as the cloth over it is the same cloth, and the eye knows.
      // The 230mm hem is also the only free differentiator left between this
      // figure and an armoured trooper — they share a skeleton, a stance and an
      // arm swing, and their whole-body silhouettes overlap 0.856 of a limit of
      // 0.86 without it. Cloth reaching where armour does not is what separates
      // them, and it costs no triangles.
      // Its top 60% is inside the over-skirt and is never drawn against the
      // sky, so it is tessellated for the 26cm of it that shows: 24 segments
      // and 7 rings against the over-skirt's 28 and 9.
      const underH = 0.72 * s;
      const underFold = (th) => 0.042 * Math.cos(5 * th - 0.7) + 0.020 * Math.cos(3 * th + 1.9);
      // The swell is centred at 0.45 and worth 20%, which is not a styling
      // choice: the over-skirt now ends ABOVE the knee, so this layer is the
      // only cloth the knee has to swing inside. At the knee's height the old
      // single skirt gave 219mm of radius and a plain taper here gave 186mm —
      // 33mm less room for a joint that travels, which buys a knee through the
      // front of the robe. With the swell it is 223mm, better than it was.
      const underGeo = limbGeo(underH, 0.132 * KHIP * s, 0.230 * KHIP * s, 24, false, {
        rings: 7, bulge: 0, swells: [[0.45, 0.20, 0.34], [0.94, -0.05, 0.05]],
        section: (th, t) => 1 + foldT(t) * underFold(th),
      });
      shadeAO(underGeo, (x, y, z) => {
        const th = Math.atan2(x, z), t = clamp(y / underH, 0, 1);
        const valley = clamp(-underFold(th) / 0.055, 0, 1);
        // dark for the whole length that the over-skirt hangs in front of, and
        // darkest right under its hem, which is what makes the hem read as an
        // edge with something behind it rather than as a change of colour
        return (1 - 0.42 * foldT(t) * valley)
          * (0.52 + 0.48 * clamp((t - 0.60) / 0.16, 0, 1));
      }, { floor: 0.28 });
      const underMat = outer.clone();
      underMat.side = THREE.DoubleSide;
      mesh(underGeo, underMat, hips, [0, 0.020 * s, 0], [0, 0, Math.PI]);
      // Two over-panels down the front in the darker cloth, so the layering
      // carries all the way down the figure instead of stopping at the belt.

      // A panel is a lathe with a LOBE in its section: full radius over a 70°
      // wedge on the centre line and a third of it everywhere else, so the
      // back three quarters of the tube is tucked inside the skirt and only
      // the wedge is ever drawn. That gets a curved, folded, correctly-lit
      // panel out of one lathe instead of out of a flat slab with hard edges,
      // which is what the two front plates here used to be.
      // Re-fitted against the new over-skirt rather than the old narrow one:
      // at r0=0.150 against a skirt that now bells to 0.21 over the hip they
      // would have spent their top third buried inside it. They also hang
      // PAST the over-skirt's hem, which is the third hem line down the
      // figure — three edges at three heights is the opposite of a cone.
      const lobe = (w) => (th) => 0.28 + 0.72 / (1 + (th / w) ** 6);
      for (const [sx, r0, r1, ln] of [[1, 0.212, 0.268, 0.52], [-1, 0.206, 0.248, 0.43]]) {
        const g = limbGeo(ln * s, r0 * KHIP * s, r1 * KHIP * s, 14, false,
          { rings: 4, bulge: 0, section: (th, t) => (1 + 0.05 * foldT(t) * Math.cos(5 * th)) * lobe(0.60)(th) });
        shadeAO(g, (x, y) => 0.62 + 0.38 * clamp(y / (ln * s), 0, 1), { floor: 0.40 });
        outerLayer.push(mesh(g, over, hips, [0, 0.040 * s, 0], [0, sx * 0.42, Math.PI]));
      }

      // ── boots ──────────────────────────────────────────────────────────
      // The shaft has to reach the ankle at y = shin.length or a stripe of
      // bare leg shows between the boot top and the foot. It gets a fold-over
      // cuff at the knee end: the old shaft simply stopped, which measured as
      // a 25mm step in the leg's outline with nothing to explain it.
      for (const side of ['L', 'R']) {
        const sh = r.get('shin' + side);
        if (!sh) continue;
        const shaftY = 0.170 * s;
        const shaft = mesh(bandGeo(0.058 * KLEG * s, 0.076 * KLEG * s, 0.048 * KLEG * s, 0.068 * KLEG * s, sh.length - shaftY, 14),
          leather, sh.obj, [0, shaftY, 0]);
        shadeAO(shaft.geometry, (x, y) => 0.62 + 0.38 * clamp((y - shaftY) / (0.10 * s), 0, 1), { floor: 0.45 });
        // the cuff, turned down over the top of the shaft
        mesh(bandGeo(0.070 * KLEG * s, 0.086 * KLEG * s, 0.062 * KLEG * s, 0.079 * KLEG * s, 0.048 * s, 12),
          leather, sh.obj, [0, shaftY - 0.006 * s, 0]);
        // a strap round the ankle end of the shaft. Sized off the shaft's own
        // taper, not off the shin: at this height the leather is already 70mm
        // out and a strap typed at 58 disappears inside the boot it is meant
        // to be buckling.
        mesh(bandGeo(0.066 * KLEG * s, 0.077 * KLEG * s, 0.065 * KLEG * s, 0.076 * KLEG * s, 0.020 * s, 10),
          trim, sh.obj, [0, sh.length - 0.055 * s, 0]);
      }

      // ── sleeve and bracer ──────────────────────────────────────────────
      // Three layers down the forearm and they have to read in that order:
      // the robe's sleeve ends in a flared hem just below the elbow, the
      // tunic's cuff shows under it, and a leather bracer closes over the
      // bottom two thirds. Before this the whole arm was one pale tube.
      for (const side of ['L', 'R']) {
        const f = r.get('fore' + side);
        const a = r.get('arm' + side);
        if (a) {
          // the mantle: a short cape of the over-cloth off the point of the
          // shoulder, which is what actually separates the arm from the torso
          // in silhouette
          // r0 is measured against the humerus at the height it starts, plus
           // 3mm of cloth: typed at 62mm it stood a full centimetre off a 52mm
           // arm and the gap between the two showed as a hole in the shoulder.
          const g = limbGeo(0.098 * s, 0.0555 * KARM * s, 0.0715 * KARM * s, 18, false,
            { rings: 4, bulge: 0, section: (th, t) => 1 + 0.030 * t * Math.cos(4 * th + 0.5) });
          shadeAO(g, (x, y) => 0.68 + 0.32 * clamp(y / (0.098 * s), 0, 1), { floor: 0.42 });
          mesh(g, over, a.obj, [0, 0.004 * s, 0]);
        }
        if (!f) continue;
        // the robe sleeve's flared hem, just below the elbow
        const hem = mesh(bandGeo(0.041 * KARM * s, 0.050 * KARM * s, 0.044 * KARM * s, 0.066 * KARM * s, 0.052 * s, 14),
          over, f.obj, [0, 0.020 * s, 0]);
        shadeAO(hem.geometry, (x, y) => 0.60 + 0.40 * clamp(y / (0.052 * s), 0, 1), { floor: 0.42 });
        // the tunic cuff under it
        // sized off the forearm's measured surface at that height (45.3mm),
        // not off its nominal taper — typed at 45 the cuff was 46% buried in
        // the arm it was supposed to be hanging off
        mesh(bandGeo(0.044 * KARM * s, 0.053 * KARM * s, 0.042 * KARM * s, 0.050 * KARM * s, 0.030 * s, 12), tunic, f.obj,
          [0, 0.072 * s, 0]);
        // the bracer, and a strap round each end of it
        const br = mesh(bandGeo(0.036 * KARM * s, 0.047 * KARM * s, 0.030 * KARM * s, 0.041 * KARM * s, 0.145 * s, 14),
          leather, f.obj, [0, 0.100 * s, 0]);
        shadeAO(br.geometry, (x, y) => 0.66 + 0.34 * clamp((y - 0.100 * s) / (0.05 * s), 0, 1), { floor: 0.45 });
        mesh(bandGeo(0.036 * KARM * s, 0.045 * KARM * s, 0.035 * KARM * s, 0.044 * KARM * s, 0.014 * s, 10),
          trim, f.obj, [0, 0.222 * s, 0]);
      }

      // ── occlusion on the body itself ───────────────────────────────────
      // Every limb here is a single lathe under a single sun with a hemisphere
      // fill, so nothing in the lighting knows that an armpit sees a tenth of
      // the sky a shoulder does. This is the difference between a figure made
      // of cloth and a figure made of plastic, and it is baked per vertex
      // because there is no second UV set to hang an aoMap on.
      //
      // Bone frames, which every offset below depends on: +Y runs along the
      // bone from its root, and local +Z is the FRONT of the character for
      // every bone in the humanoid skeleton (Rig builds the rest pose with -Z
      // as the roll reference). The geometry is pre-scale, so the torso's z
      // here is 1/0.76 of what is drawn.
      const R = (n) => r.get(n);
      const chestGeo = chestB.primary.geometry;
      shadeAO(chestGeo, ao(
        // armpits, the deepest crease on a dressed torso
        creaseAt(0.150 * s, 0.180 * s, -0.010 * s, 0.095 * s, 0.42, 0.7),
        creaseAt(-0.150 * s, 0.180 * s, -0.010 * s, 0.095 * s, 0.42, 0.7),
        // the hollows above the collarbones, and the sternum between the pecs
        creaseAt(0.060 * s, 0.205 * s, 0.090 * s, 0.055 * s, 0.60, 0.6),
        creaseAt(-0.060 * s, 0.205 * s, 0.090 * s, 0.055 * s, 0.60, 0.6),
        creaseAt(0, 0.120 * s, 0.215 * s, 0.055 * s, 0.62, 0.55),
        // the spinal groove
        creaseAt(0, 0.100 * s, -0.205 * s, 0.070 * s, 0.66, 0.55),
        // under the tabard panels, which hang over most of this
        (x, y, z) => (z > 0.03 * s && Math.abs(x) < 0.14 * s ? 0.72 : 1),
      ), { floor: 0.34 });
      const spineB = R('spine');
      if (spineB) shadeAO(spineB.primary.geometry, ao(
        creaseAt(0, 0.020 * s, 0.190 * s, 0.075 * s, 0.66, 0.5),
        creaseAt(0, 0.030 * s, -0.190 * s, 0.075 * s, 0.64, 0.5),
        // the whole waist is inside the obi
        (x, y) => 1 - 0.30 * clamp(1 - Math.abs(y / s - 0.02) / 0.075, 0, 1),
      ), { floor: 0.38 });
      shadeAO(hipsB.primary.geometry, ao(
        creaseAt(0, 0, 0.060 * s, 0.090 * s, 0.55, 0.5),
        // everything below the belt is under the skirt
        (x, y) => 0.52 + 0.48 * clamp(y / (0.09 * s), 0, 1),
      ), { floor: 0.34 });
      if (neck) shadeAO(neck.primary.geometry, ao(
        // down into the collar, and up under the jaw
        (x, y) => 0.44 + 0.56 * clamp(y / (0.045 * s), 0, 1),
        (x, y) => 1 - 0.34 * clamp((y / s - 0.045) / 0.03, 0, 1),
        creaseAt(0, 0.070 * s, -0.055 * s, 0.055 * s, 0.62, 0.5),
      ), { floor: 0.30 });
      for (const side of ['L', 'R']) {
        const a = R('arm' + side), f = R('fore' + side);
        const th = R('thigh' + side), sh = R('shin' + side);
        if (a) shadeAO(a.primary.geometry, ao(
          // the root of the shoulder, which is buried in the torso and the
          // mantle whichever way the arm is swinging
          (x, y) => 0.50 + 0.50 * clamp(y / (0.075 * s), 0, 1),
          // and the inside of the elbow, on the anterior (+Z) face
          (x, y, z) => 1 - 0.34 * clamp((y / s - 0.20) / 0.085, 0, 1) * clamp(z / (0.03 * s), 0, 1),
        ), { floor: 0.36 });
        if (f) shadeAO(f.primary.geometry, ao(
          (x, y, z) => 1 - 0.40 * (1 - clamp(y / (0.055 * s), 0, 1)) * clamp(z / (0.03 * s), 0, 1),
          // under the sleeve hem and inside the bracer
          (x, y) => 1 - 0.30 * clamp(1 - Math.abs(y / s - 0.055) / 0.045, 0, 1),
          (x, y) => 0.74 + 0.26 * clamp(1 - (y / s - 0.10) / 0.10, 0, 1),
        ), { floor: 0.36 });
        if (th) shadeAO(th.primary.geometry, ao(
          // the crotch
          creaseAt(0, 0.010 * s, 0.020 * s, 0.115 * s, 0.52, 0.45),
          // and the whole upper half, which the skirt hangs over
          (x, y) => 0.44 + 0.56 * clamp((y / s - 0.02) / 0.42, 0, 1),
        ), { floor: 0.30 });
        if (sh) shadeAO(sh.primary.geometry, ao(
          // the back of the knee, on the posterior (-Z) face
          (x, y, z) => 1 - 0.42 * (1 - clamp(y / (0.075 * s), 0, 1)) * clamp(-z / (0.035 * s), 0, 1),
          // and everything inside the boot shaft
          (x, y) => 0.66 + 0.34 * clamp(1 - (y / s - 0.10) / 0.09, 0, 1),
        ), { floor: 0.32 });
      }
    },
  });

  return { rig, robeSkirt: outerLayer,
           palette: { robe, tunic, outer, over, sleeve, trim, leather, skin } };
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
      // rings 12 on the humerus because the deltoid is a swell in the lathe
      // now rather than a ball bolted to it, and a two-hump profile needs
      // enough rings to resolve both humps — at the old 4 they smear into one.
      arm: { rings: 12, capN: 3 },
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
