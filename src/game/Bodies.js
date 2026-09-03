/**
 * BATTLEFRONT BORZ — procedural bodies.
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

import * as THREE from '../../vendor/three/three.module.js';
import { Rig, humanoidSkeleton, walkerSkeleton, aimY } from './Rig.js';
import { clothMaps, armorMaps, metalMaps, duracreteMaps, skinMaps, MEAN_ALBEDO } from '../engine/Textures.js';
import { makeRng, lerp, clamp } from '../engine/MathUtil.js';

const rng = makeRng(5150);
/**
 * ── PUT THIS FILE'S STREAM BACK ─────────────────────────────────────────
 *
 * A module-level stream that no harness can reseed makes every check after it
 * depend on how many draws the checks before it happened to take. `verify.mjs`
 * runs every suite in one process and says so in its own note; five streams
 * were already restorable and this one was not.
 *
 * MEASURED, and it is not theoretical: building ONE crate before
 * `blast-door.mjs` — a single `makeCrate` on a throwaway scene, which touches
 * nothing but this stream — turned that suite from 9/9 into the gate's own
 * failure, "75 s of held blade burned 0 of the 515 texels". The breach slug's
 * launch vector comes off here, so a shifted phase throws the debris somewhere
 * else, the player takes the second impact instead of surviving it on five
 * points, and a dead player's blade never touches the plate again.
 *
 * The seed is the module's own, so `restoreShared` puts it back where the
 * module started rather than where a snapshot found it — the same statement
 * the other five make.
 */
export function seedBodies(seed) { rng.seed(seed >>> 0); return rng; }


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

/**
 * The plan section of a MUZZLE — wide, flat on top, full underneath.
 *
 * The four heads that have a mouth all built one out of `plateGeo`, and a
 * rounded cuboid is the single worst shape available for the job: it has a
 * flat front WALL, so the nose is a plane the animal stops at, and four hard
 * vertical corners, so from three-quarters on it reads as the end of a crate.
 * The complaint's first line — "the head reads as a detached rectangular box"
 * — is that call and nothing else.
 *
 * A muzzle is not round either, which is why this is not just `ovalSection`.
 * Four facts, each one a term:
 *
 *   IT IS WIDER THAN IT IS DEEP.  `flat` is the depth as a fraction of the
 *   width — 0.72 on a dog, lower on anything that eats meat lying down.
 *   IT HAS CHEEKS.  `n` above 2 fills the corners out into flat vertical
 *   sides, which is what carries the light down the side of a jaw. An ellipse
 *   has no side; it has a highlight that slides.
 *   THE TOP IS A BRIDGE, NOT A DOME.  `crown` flattens the nasal bones.
 *   THE BOTTOM IS FULLER THAN THE TOP.  `chin` — the lower jaw and the lip
 *   carry more mass than the maxilla, and a muzzle that is symmetric top to
 *   bottom reads as a tube.
 *
 * θ is measured from local +Z as everywhere else in this file. `muzzle()`
 * rotates the lathe by +π/2 about X, which takes local +Z to world −Y — so
 * cos θ > 0 is DOWNWARD on the finished animal and that is the half `chin`
 * fattens. Getting this the wrong way round builds a head with a swollen brow
 * and no jaw, which is a specific and recognisable kind of wrong.
 */
function muzzleSection(o = {}) {
  const flat = o.flat ?? 0.72, n = o.n ?? 2.8;
  const crown = o.crown ?? 0.07, chin = o.chin ?? 0.12;
  return (th) => {
    const si = Math.abs(Math.sin(th)), co = Math.abs(Math.cos(th));
    let r = Math.pow(Math.pow(si, n) + Math.pow(co, n), -1 / n);
    r *= flat + (1 - flat) * si * si;
    const c = Math.cos(th);
    if (chin) r *= 1 + chin * Math.max(0, c) ** 2;
    if (crown) r *= 1 - crown * Math.max(0, -c) ** 2;
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

/**
 * The same, over SEVERAL shells at once: the outermost surface any of them
 * offers along the ray.
 *
 * Written for one problem and it is worth stating, because the naive fix is
 * wrong in a way that is hard to see. A Zabrak's horns are seated by raycasting
 * the assembled skull, which is right while the skull is the outside of the
 * head. Give that Zabrak hair and the skull is no longer the outside: a horn
 * seated on it starts 2 cm inside a hair mass and 3 cm of a 3 cm horn is buried,
 * so the crown of horns becomes a scattering of tips. Seating on the HAIR
 * instead is wrong the other way — the shaved cut has no hair to seat on, and a
 * cut that leaves the nape bare has none along half the ring — and `surfacePoint`
 * answers null there, which `onSurface` turns into "at the origin", i.e. a horn
 * inside the skull.
 *
 * So it is the farthest hit of whichever shells actually answer, and nulls are
 * skipped. Undefined and null entries are allowed on purpose so a caller can
 * pass an optional layer without branching.
 */
function onOuter(geos, dir, sink = 0, origin = _ZERO) {
  const d = _pp.copy(dir).normalize();
  let best = null, bestD = -Infinity;
  for (const g of geos) {
    if (!g?.attributes?.position) continue;
    const p = surfacePoint(g, dir, origin, new THREE.Vector3(), true);
    if (!p) continue;
    const t = p.clone().sub(origin).dot(d);
    if (t > bestD) { bestD = t; best = p; }
  }
  if (!best) return [origin.x, origin.y, origin.z];
  return [best.x - d.x * sink, best.y - d.y * sink, best.z - d.z * sink];
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
  /* WHAT THE PLATE COVERS IS ALSO WHAT IT LEAVES BARE — see `weakSpotsOf`.
   * Recorded here, at the one function in this file whose job is to put armour
   * on a limb, so a joint is derived from the plate's own numbers and there is
   * no second list of "which bones have a gap" to fall out of step with them
   * (HANDOFF §2.3). A limb may be plated more than once — a trooper's thigh
   * gets a cuisse and a tasset — so the record is the UNION of the spans. */
  platedSpan(bone, y0, y1);
  return arcGeo(r0, r1, y1 - y0, arc, opts.thick ?? 0.012, opts.seg ?? 8);
}

/**
 * "This bone is covered from `y0` to `y1`", in bone-local metres.
 *
 * `limbPlate` calls it for free; anything that armours a limb some other way
 * has to say so. `src/game/Vehicles.js` is the reason it is exported rather
 * than inlined above: its four machines plate their legs with `plateGeo` and
 * `bladePlateGeo` seated by hand rather than with `limbPlate`, so the fact is
 * exactly as true there and there is nothing to read it off. One call beside
 * each plate is the whole of what those machines need to grow joints.
 *
 * The union of spans, not the last one: a limb may be plated twice.
 */
export function platedSpan(bone, y0, y1) {
  if (!bone || !(bone.length > 0)) return;
  bone.plateFrom = Math.min(bone.plateFrom ?? Infinity, y0);
  bone.plateTo = Math.max(bone.plateTo ?? 0, y1);
  bone._weakCache = undefined;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Weak points — the places the cover does not reach                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ A BIG BODY HAS PLACES WORTH AIMING AT, AND THE BODY IS WHAT KNOWS THEM ══
 *
 * Player note #35: the roster's large targets — the acklay, the reek, the nexu,
 * the spider walker — are the same act to fight as a B1 with more hit points,
 * because the blade is uniform over all of them. Measured before any of this
 * was written (`tools/_weakpoint.mjs`), that is exactly true and it is true in
 * one number: **every `big` body on the roster carries exactly TWO distinct
 * toughnesses across all of its bones**, one for the trunk and one for
 * everything else. An acklay's twenty-five non-trunk bones are all `flesh`; a
 * spider walker's seventeen are all `heavy`. Nothing distinguishes a bare hinge
 * from the plate beside it, because nothing ever asked the body.
 *
 * ── WHY THE ANSWER LIVES IN THIS FILE ─────────────────────────────────────
 *
 * The obvious place to write a weak point down is beside the archetype, as a
 * per-body list of bone names. That is HANDOFF §2.3's signature defect and this
 * project has already paid for it twice in this exact area: `VITAL[name] ?? 0.4`
 * (nineteen humanoid names over a roster of quadrupeds and machines) and
 * `_boneToughness`'s `/^(chest|spine|hips|neck|head)$/`, which is still there
 * and still cannot say anything about a body whose bones are called `femur3`.
 *
 * The body is what has the weak points. `limbPlate` is handed the exact span
 * and arc of every plate strapped to a limb, so the span it does NOT cover is a
 * derived fact, not an opinion — and the two ends it leaves bare are the two
 * ends a limb has to bend at. The one spot that is not a plate's leftover, an
 * animal's belly, is declared on the line that builds the belly mesh, out of
 * the same four numbers that place it, so the capsule and the geometry cannot
 * drift apart. `tools/checks/severance.mjs` measures that they have not.
 *
 * ── WHAT A SPOT IS ────────────────────────────────────────────────────────
 *
 * A capsule in the BONE'S OWN LOCAL FRAME, in metres, plus where its two ends
 * sit along that bone as a fraction:
 *
 *   key    'root' | 'tip' | whatever a builder declares. Identity, for the
 *          progress budget and for the check; not shown to anyone.
 *   label  what the game says out loud when a pass lands there. It is the other
 *          half of the sentence `Enemy._turnCut` already shouts when a pass
 *          lands anywhere else ('HIDE TURNS IT', 'PLATE HOLDS'), which is how a
 *          player is supposed to learn there is anywhere else at all.
 *   p0,p1  the capsule's axis, bone-local metres.
 *   r      its radius, bone-local metres, BEFORE the contact allowance that
 *          `Enemy.capsules` adds to every capsule it emits.
 *   at0,at1 where p0 and p1 sit along the bone, 0..1. A joint's are exact; a
 *          belly's are the projection of its ends onto the bone axis, which is
 *          all `Actor.cut` needs from a trunk (it decides where a core bone is
 *          split, and a core sever is lethal wherever it lands).
 */
export function weakSpot(bone, spot) {
  if (!bone) return null;
  (bone.weak || (bone.weak = [])).push(spot);
  bone._weakCache = undefined;
  return spot;
}

/**
 * Everything this bone is not covered at — declared and derived, one list.
 *
 * A plate leaves TWO gaps and both of them are joints. `limbPlate(femur, L*0.12,
 * L*0.78, …)` on a spider walker's thigh is a plate that starts above the hip
 * socket and stops below the knee, and the reason it does both is that a leg
 * has to swing at both ends. Measured on the shipped builds: the walker's femur
 * bares 0.18 m at the hip and 0.33 m at the knee, its tibia 0.18 m and 0.50 m,
 * and a quadruped's femur 0.10 m and 0.34 m of its own length.
 *
 * The radius is the LIMB'S OWN TUBE at that height, not the bone's nominal
 * radius, and that is the whole difficulty of hitting one: the plate stands off
 * the tube by its gap and its thickness, so where the plate is the target is
 * fatter than where it is not. `bone.primary.userData.limb` carries the two
 * radii `limbGeo` was built with — the same record `Actor.cut` rebuilds a stub
 * from — so the taper is the mesh's and not a guess.
 *
 * Cached on the bone. `Enemy.capsules()` calls this once per bone per frame on
 * every body on the field, and the answer is a property of how the body was
 * built, which does not change after it is built. `limbPlate` and `weakSpot`
 * both clear it, so a builder that plates a limb after declaring a spot on it
 * still gets both.
 */
export function weakSpotsOf(bone) {
  if (!bone) return null;
  if (bone._weakCache !== undefined) return bone._weakCache;
  const len = bone.length || 0;
  const out = bone.weak ? bone.weak.slice() : [];
  if (len > 0 && bone.plateTo != null) {
    const lim = bone.primary && bone.primary.userData && bone.primary.userData.limb;
    const rr0 = lim ? lim.r0 : bone.radius;
    const rr1 = lim ? lim.r1 : bone.radius * 0.85;
    const rAt = (y) => rr0 + (rr1 - rr0) * clamp(y / len, 0, 1);
    // The bare span BELOW the plate, and the bare span ABOVE it. A span shorter
    // than a twentieth of the bone is the plate's own seating tolerance rather
    // than a joint, and a capsule that thin is not something anyone can aim at.
    const MIN = len * 0.05;
    const from = bone.plateFrom ?? 0;
    if (from > MIN) {
      out.push({ key: 'root', label: 'JOINT', p0: [0, 0, 0], p1: [0, from, 0],
        r: Math.max(rAt(0), rAt(from)), at0: 0, at1: from / len });
    }
    if (len - bone.plateTo > MIN) {
      out.push({ key: 'tip', label: 'JOINT', p0: [0, bone.plateTo, 0], p1: [0, len, 0],
        r: Math.max(rAt(bone.plateTo), rAt(len)), at0: bone.plateTo / len, at1: 1 });
    }
  }
  return (bone._weakCache = out.length ? out : null);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Cover — the drawn mesh a bone's own capsule does not reach            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ A BLADE THROUGH THE ACKLAY'S HEAD MET NOTHING AT ALL ══
 *
 * `Enemy.capsules()` emits one capsule per bone, about that bone's OWN +Y, of
 * the bone's nominal radius. That is exactly right for a limb, which is what a
 * bone is on the nineteen humanoids: measured against the drawn mesh, every one
 * of them is inside its own capsule set to within 0.07 m, and the worst offender
 * is a glove.
 *
 * It is not right for a body part that is not a tube along its bone. Measured
 * on the shipped builds — every drawn vertex against the COMPLETE shipped
 * capsule set, in a settled standing pose:
 *
 *     acklay  head    63% of the drawn surface outside, worst point 2.91 m out
 *     nexu    head    57%, 1.13 m          reek  head  43%, 0.93 m
 *     AAT     hull    65-75%, 1.23 m       AT-TE tarsus 70% ×6, 0.56 m
 *     dwarf spider    tarsus 100% ×4, 0.19 m
 *
 * Whole-body: AAT 57% of its surface unreachable, AT-TE 38%, nexu 15%, dwarf
 * spider 10%, reek 10%, acklay 9%. With the cover in: AAT 0%, AT-TE 2%, nexu
 * 1%, dwarf spider 3%, reek 0%, acklay 1%, and the acklay's worst point comes
 * in from 2.91 m to 0.32 m.
 * The acklay's head MESH runs 4.38 m along the bone's local +Z while the
 * capsule reaches 1.62 m along +Y, so the blade passes through the drawn skull
 * and out the other side without the solver ever being offered a contact.
 *
 * The feet are the ones that matter most, and HANDOFF 6.1c says why in its own
 * words: `_boneToughness` plates a walker's body and hips to durasteel, so "the
 * counter-play to a body you cannot cut through is the legs it is standing on"
 * — `legsLost >= 3` topples. 6.1c priced a toe at 25 passes; 70% of it was not
 * there to be passed through.
 *
 * ── WHY THE COVER IS MEASURED AND NOT AUTHORED ────────────────────────────
 *
 * The same argument the note over `weakSpotsOf` makes, for the same reason: a
 * per-body list of "and also put a capsule here" beside the roster is HANDOFF
 * 2.3's signature defect, and this file has already paid for it twice in this
 * area. The body is what knows its own shape. This reads it.
 *
 * ── WHY IT IS A SECOND CAPSULE AND NOT A REPLACEMENT ──────────────────────
 *
 * The bone's axial capsule is what `Actor.cut` splits a limb along and what
 * every severance number in the game is priced against; replacing it would
 * re-price the whole roster to fix five bodies. The cover is emitted ALONGSIDE
 * it, under the bone's own name, toughness and severance value, so a blade that
 * meets it is billed exactly as if it had met the bone — which it did. Nothing
 * a player can do tells the two apart, and nothing downstream has to know.
 *
 * ── AND WHY ONLY SOME BONES GET ONE ───────────────────────────────────────
 *
 * `COVER_GAP` is the worst gap a bone is allowed to leave before it is given a
 * cover. Every humanoid bone in the game is under it by a factor of two, so
 * this changes nothing about the nineteen bodies whose covers were already
 * measured correct, and a fresh capsule per bone per frame on all of them would
 * be paid for nothing. What is left is heads, hulls and feet.
 */
const COVER_GAP = 0.18;

/** Squared distance from `p` to the segment a→b, all as flat [x,y,z]. */
function _segDist2(px, py, pz, ax, ay, az, bx, by, bz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const L2 = ux * ux + uy * uy + uz * uz;
  let t = L2 > 1e-12 ? ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + ux * t), dy = py - (ay + uy * t), dz = pz - (az + uz * t);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * A capsule bounding the drawn mesh of `bone`, in the bone's own local frame,
 * or null if the bone's axial capsule already reaches all of it.
 *
 * Shaped exactly like a weak spot — `{ p0, p1, r }` in bone-local metres — so
 * `Enemy.capsules()` places it with the same three lines that place those.
 *
 * The axis is the mesh's own principal direction, found by power iteration on
 * the covariance of its vertices, which costs a few dozen multiplies once per
 * bone in the lifetime of a body. The radius starts at the 90th PERCENTILE of
 * the perpendicular spread rather than at the maximum, and grows only if the
 * residual demands it: a tank hull is a slab, and a capsule sized to the corner
 * of a slab is a cylinder of empty air over the deck that a blade would cut.
 * Measured over the roster, the acklay's trunk is the only bone that asks for
 * the second rung and nothing asks for the third. Measured the other way —
 * sampled uniformly inside each capsule against the bone's own drawn extent —
 * the cover sits outside the mesh no more than the axial capsules it stands
 * beside already do: acklay head 4% against the bone capsule's 83%, AAT hull
 * 66% against 37%, AT-TE foot 66% against 31%. The two ends are then solved
 * rather
 * than guessed — `t0 = min(t_i + sqrt(r² - d_i²))` is the furthest the cap can
 * be pulled in and still contain every point it is responsible for.
 *
 * Cached on the bone next to `_weakCache`, and for the same reason: this is a
 * property of how the body was built and it does not change afterwards.
 */
export function coverSpotOf(bone) {
  if (!bone) return null;
  if (bone._coverCache !== undefined) return bone._coverCache;
  bone._coverCache = null;
  if (!bone.parts?.length || !bone.obj) return null;

  /* Bone-local vertices of everything drawn on this bone. Subsampled: a hull
   * with 4 000 vertices does not describe its own extent 400 times better. */
  bone.obj.updateWorldMatrix(true, false);
  const inv = _coverM.copy(bone.obj.matrixWorld).invert();
  const P = [];
  for (const m of bone.parts) {
    const attr = m.geometry?.attributes?.position;
    if (!attr) continue;
    m.updateWorldMatrix(true, false);
    const stride = Math.max(1, Math.floor(attr.count / 400));
    for (let i = 0; i < attr.count; i += stride) {
      _coverV.fromBufferAttribute(attr, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      P.push(_coverV.x, _coverV.y, _coverV.z);
    }
  }
  const n = P.length / 3;
  if (n < 8) return null;

  // Is the bone's own capsule already enough? Same allowance the solver adds.
  const len = bone.length || 0, rad = (bone.radius || 0) * 1.12;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.sqrt(_segDist2(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], 0, 0, 0, 0, len, 0)) - rad;
    if (d > worst) worst = d;
  }
  if (worst <= COVER_GAP) return null;

  // Principal axis, by power iteration on the covariance.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  let axx = 0, axy = 0, axz = 0, ayy = 0, ayz = 0, azz = 0;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3] - cx, y = P[i * 3 + 1] - cy, z = P[i * 3 + 2] - cz;
    axx += x * x; axy += x * y; axz += x * z; ayy += y * y; ayz += y * z; azz += z * z;
  }
  let ux = 1, uy = 1, uz = 1;
  for (let k = 0; k < 24; k++) {
    const vx = axx * ux + axy * uy + axz * uz;
    const vy = axy * ux + ayy * uy + ayz * uz;
    const vz = axz * ux + ayz * uy + azz * uz;
    const L = Math.hypot(vx, vy, vz);
    if (!(L > 1e-12)) { ux = 0; uy = 1; uz = 0; break; }
    ux = vx / L; uy = vy / L; uz = vz / L;
  }

  // Axial coordinate and perpendicular distance of every vertex.
  const T = new Float64Array(n), D = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3] - cx, y = P[i * 3 + 1] - cy, z = P[i * 3 + 2] - cz;
    const t = x * ux + y * uy + z * uz;
    T[i] = t;
    D[i] = Math.hypot(x - ux * t, y - uy * t, z - uz * t);
  }
  /* THE RADIUS IS THE SMALLEST OF THESE THAT FINISHES THE JOB.
   *
   * Starting at the 90th percentile and growing only if the residual demands
   * it: a slab covered to its corner is a cylinder of air over the deck, and a
   * body with one spike on it should not have the whole cover sized by the
   * spike. Measured over the roster, three rungs are enough — the acklay's
   * trunk is the only bone that needs the second and nothing needs the third,
   * and the AAT hull stays at the first. The loop is bounded and falls through
   * to the maximum, so a shape nobody has drawn yet is covered rather than
   * approximated. */
  const sorted = Float64Array.from(D).sort();
  let r = 0, t0 = 0, t1 = 0;
  for (const q of [0.90, 0.98, 1.0]) {
    r = sorted[Math.min(n - 1, Math.floor(n * q))];
    if (!(r > 1e-4)) return null;
    t0 = Infinity; t1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const h = D[i] < r ? Math.sqrt(r * r - D[i] * D[i]) : 0;
      if (T[i] + h < t0) t0 = T[i] + h;
      if (T[i] - h > t1) t1 = T[i] - h;
    }
    if (t0 > t1) { t0 = t1 = (t0 + t1) * 0.5; }
    // The residual: how far outside BOTH capsules the worst drawn point still
    // is. Asked of the pair, because the bone's own capsule covers most of a
    // limb and the cover is only responsible for what it does not.
    const a0x = cx + ux * t0, a0y = cy + uy * t0, a0z = cz + uz * t0;
    const a1x = cx + ux * t1, a1y = cy + uy * t1, a1z = cz + uz * t1;
    let resid = 0;
    for (let i = 0; i < n; i++) {
      const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
      const d = Math.min(
        Math.sqrt(_segDist2(px, py, pz, 0, 0, 0, 0, len, 0)) - rad,
        Math.sqrt(_segDist2(px, py, pz, a0x, a0y, a0z, a1x, a1y, a1z)) - r * 1.12);
      if (d > resid) resid = d;
    }
    if (resid <= COVER_GAP) break;
  }
  return (bone._coverCache = {
    key: 'cover',
    p0: [cx + ux * t0, cy + uy * t0, cz + uz * t0],
    p1: [cx + ux * t1, cy + uy * t1, cz + uz * t1],
    r,
  });
}

const _coverM = new THREE.Matrix4();
const _coverV = new THREE.Vector3();

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
  /* THE THUMB IS ON THE OUTSIDE OF THE HAND, WHICH IS A CHIRALITY AND NOT A
   * TASTE. Fingers point down local +Y and curl toward local +Z, so the palm
   * faces +Z; for a RIGHT hand the thumb is then at fingers × palm = +X, and
   * for a left hand at -X. This was the other way round — the 'R' hand was a
   * left hand — and nothing looked at it until a rifle was put in it: the
   * trigger hand's thumb, which `GRIP_R` in Enemy.js maps up the weapon's +Y,
   * came out UNDER the receiver, and the support hand's pointed back along
   * the fore-end instead of forward. `PALM` and the finger table are
   * symmetric in X, so no hold point moved when it was put right. */
  const tw = side === 'L' ? -1 : 1;
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
 * `o.sheen` USED TO swap in a MeshPhysicalMaterial with a retroreflective
 * sheen lobe — what wool and heavy cotton actually do, going BRIGHTER at
 * grazing angles where a dielectric GGX lobe goes darker. It was true, it was
 * worth paying for, and it has not existed since the frame went cel: rule 8 of
 * src/toon/REFERENCE.md deletes specular everywhere, and the sheen lobe was
 * cut out of three's BRDF along with the GGX one. What was left was 38 of the
 * player's 64 meshes compiling the heavier physical fragment shader to
 * evaluate a lobe that is not in it.
 *
 * `o.normal` and every `normalScale` below are gone for the same kind of
 * reason: `Textures.materialFrom` binds `normalMap: null` — a perturbed normal
 * under a two-tone terminator reads as speckle, not as relief — so they were
 * scaling a map that does not exist.
 *
 * `o.vc` turns on the vertex-colour channel that shadeAO() writes the creases
 * into. mesh() guarantees every geometry handed such a material has one.
 */
function clothMat(color, rough = 0.92, o = {}) {
  const maps = clothMaps(o.repeat ?? 2.2);
  const spec = {
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0,
    vertexColors: !!o.vc,
  };
  return lit(color, MEAN_ALBEDO.cloth, new THREE.MeshStandardMaterial(spec));
}
// `repeat` is additive: at the shipped 1.6 the scuff bake tiles about once per
// 40cm, which on a droid's flat tan panels reads as chipboard rather than as
// paint. Machinery wants it three times finer; cloth and skin do not.
function armorMat(color, metal = 0.1, rough = 0.42, repeat = 1.6) {
  const maps = armorMaps(repeat);
  return note(color, MEAN_ALBEDO.armor, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: metal,
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
    roughness: rough, metalness: metal,
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
    roughness: 0.95, metalness: 0,
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
    roughness: 0.94, metalness: 0.04,
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
    roughness: rough, metalness: 0.04,
    vertexColors: !!o.vc,
  }));
}
/** Visor glass, sensor lenses — scratched, dark and nearly specular. */
function glassMat(color, rough = 0.14) {
  const maps = metalMaps(3.4);
  return lit(color, MEAN_ALBEDO.metal, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0.62,
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
    roughness: rough, metalness: 0.05,
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
    roughness: rough, metalness: 0.02,
  }));
}
/** Pebbled animal hide — duracrete's aggregate at a tight tiling. */
function hideMat(color, rough = 0.9) {
  const maps = duracreteMaps(5.5);
  return lit(color, MEAN_ALBEDO.duracrete, new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    roughness: rough, metalness: 0,
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
  /**
   * PER-BONE MATERIAL OVERRIDES — the one channel that is never culled.
   *
   * A bone's primary is the mesh `Enemy._applyLod` keeps at every range, and
   * before this the only way to colour one was to paint the whole slot: every
   * torso bone, or every arm bone. So an archetype's unit colour had to live
   * on Kit detail, which is culled, and six clone archetypes measured 0.000
   * apart in visible colour at thirty metres. Keyed by bone name or by the
   * name with its L/R suffix dropped, exactly like `limbOpts` above.
   */
  const MATS = style.mats || {};
  const matFor = (n, fallback) => MATS[n] || MATS[n.replace(/[LR]$/, '')] || fallback;

  const addLimb = (boneName, r0, r1, mat, opts = {}) => {
    const b = rig.get(boneName);
    if (!b) return null;
    mat = matFor(boneName, mat);
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
    const hm = mesh(hg, matFor('head', style.head || style.skin || style.body), head.obj);
    head.parts.push(hm); head.primary = hm; head.radius = (style.headRadius ?? 0.12) * S;
    if (style.buildHead) style.buildHead(head.obj, S, hg);
    /* AFTER the hair and the species' own furniture, because a hood goes over
     * both and `buildHead` returns early for a species that grows none. */
    if (style.headKit) style.headKit(head.obj, S, hg);
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
      const m = mesh(geo, matFor('hand' + side, style.hand || style.arm || style.body), hand.obj);
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
      const m = mesh(geo, matFor('foot' + side, style.boot || style.leg || style.body), foot.obj);
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
/* …and a ninth, `wear`: the years as LINES rather than as masses — the
 * nasolabial fold, the crow's feet, the forehead — baked as darker vertex
 * colour on the skull. Age drives it (AGE_FACE) and a preset may carry it. */
const FACE_KEYS = ['skull', 'brow', 'cheek', 'jaw', 'chin', 'nose', 'eyes', 'mouth', 'wear'];

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
  /* Three more, now that the surface can carry them: a hawk's nose on a
   * narrow face, a square jaw, and a face that has been outdoors for forty
   * years — the first preset to spend `wear`. */
  { id: 'hawk',   name: 'Hawk',   face: { skull: 0.40, brow: 0.55, cheek: 0.60, jaw: -0.45, chin: 0.30, nose: 1.0, eyes: -0.30, mouth: -0.20 } },
  { id: 'square', name: 'Square', face: { skull: -0.50, brow: 0.30, cheek: 0.20, jaw: 0.95, chin: 0.85, nose: 0.10, eyes: 0.30, mouth: 0.50 } },
  { id: 'weathered', name: 'Weathered', face: { skull: 0.20, brow: 0.60, cheek: 0.80, jaw: 0.10, chin: 0.40, nose: 0.50, eyes: -0.25, mouth: 0.0, wear: 1.0 } },
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
    /**
     * A SHEET MAY NAME ITS PRESET instead of carrying its numbers.
     *
     * The menu spreads the preset's eight numbers into the sheet so the object
     * that reaches here is self-contained — but "the menu remembers to spread"
     * is precisely the kind of unwritten obligation this file's history is
     * made of, and a saved blob or a caller that writes `{ preset: 'heavy' }`
     * by hand would otherwise get the neutral face and no error. Read first, so
     * explicit numbers in the same object still win.
     */
    if (typeof src.preset === 'string') {
      const p = FACE_PRESETS.find(f => f.id === src.preset);
      if (p) for (const k of FACE_KEYS) if (typeof p.face[k] === 'number') out[k] = clamp(p.face[k], -1, 1);
    }
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

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE CHARACTER SHEET — grooming, years and muscle                      */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * `face` IS THE CHARACTER SHEET, not eight numbers.
 *
 * This is a plumbing fact before it is a design one, and it is worth stating
 * because it looks like a hack until you follow the wire. The appearance a
 * player chooses reaches the figure through exactly one object:
 *
 *     Menu.settings.face → World.spawnPlayer → new Player → buildJedi({face})
 *
 * `face` is the only appearance argument on that path that is allowed to be an
 * OBJECT — `faceOf()` has taken "a preset id, a raw parameter object, or
 * nothing" since face presets were written, and it reads FACE_KEYS and ignores
 * everything else. So a hair cut, a beard, a number of years and an amount of
 * muscle ride in the same object, `sheetOf()` reads those four, `faceOf()` goes
 * on reading its eight, and neither has to know about the other. The
 * alternative was four more arguments through two files this workstream does
 * not own, which would have shipped four more parameters nobody passes — the
 * exact defect this file's history is a monument to.
 *
 * `buildJedi` also accepts all four at the top level (`buildJedi({ hair:
 * 'long' })`), and the top level WINS, because the checks and the menu preview
 * call the builder directly and should not have to fake a face object.
 *
 * THE NEUTRAL SHEET IS THE IDENTITY, to the float: hair `temple`, beard `none`,
 * age 0, muscle 0.5 — and every use below is `x * (1 + g*0)` or `x + g*0`.
 */
export const SHEET_KEYS = ['hair', 'beard', 'age', 'muscle'];

/**
 * THE CUTS.
 *
 * Eight, and the list is short for the same reason the face presets are: what
 * survives is the OUTLINE. src/toon/REFERENCE.md rule 6 — "texture is DRAWN,
 * not shaded" — settles how hair is authored here, and it agrees with the
 * measurement: at 8 m a head is 24 pixels tall and a strand is 0.06 of one, so
 * fine detail is speckle under a step terminator and nothing else. Every cut is
 * therefore a small number of FLAT MASSES with a deliberate silhouette, merged
 * to one geometry on one material, shaded by a scalp-relative occlusion field
 * and nothing else. No strand normal, no anisotropic sheen ramp along a curl.
 *
 * `crown` says the cut covers the top of the skull. It is not decoration: the
 * head shell's own occlusion bake drives everything above the ear line down to
 * 0.28 SO THAT a poke-through reads as a dark root instead of as bare bone, and
 * painting that on a shaved head is a black skullcap — the defect
 * `creator: a bald species is bald` was written for. A shaved human is exactly
 * as bald as a Twi'lek and now gets the same bake.
 *
 * `braid` is a separate tapered strand and a DIRECT child of the head object,
 * for the reason written at the shipped braid: Ragdoll.addBone() re-homes only
 * direct children, so a strand inside a positioning Group survives first
 * person's `visible = false` and is missed by the re-show. Cutting your own
 * head off must not leave the braid behind.
 *
 * `tris` is what the cut measured when it was authored, so a future edit that
 * doubles one is visible in the diff and in the check's pass line rather than
 * only in a frame time. The budget is set out at THE COST OF A HAIRCUT below.
 */
export const HAIR_STYLES = [
  { id: 'temple',  name: 'Temple crop', blurb: 'short, with the learner\u2019s braid', crown: true,  braid: true },
  { id: 'shorn',   name: 'Shaved',      blurb: 'nothing at all',                  crown: false, braid: false },
  { id: 'crop',    name: 'Short crop',  blurb: 'close at the nape',                crown: true,  braid: false },
  { id: 'padawan', name: 'Padawan',     blurb: 'a crop and a 30\u2009cm braid',        crown: true,  braid: true },
  { id: 'topknot', name: 'Top knot',    blurb: 'gathered up off the temples',      crown: true,  braid: false },
  { id: 'tail',    name: 'Warrior tail', blurb: 'a crest and a heavy tail',        crown: true, braid: true },
  { id: 'long',    name: 'Long',        blurb: 'past the shoulders',               crown: true,  braid: false },
  { id: 'mane',    name: 'Mane',        blurb: 'long, and the outline broken',     crown: true,  braid: false },
];

/**
 * THE BEARDS.
 *
 * Same authoring rule and the same reason. A beard is read as a SHAPE against
 * the jaw — where its edge runs, how far it stands off the chin, whether the
 * moustache joins it — and none of that is strands. `jaw` is the mass along the
 * mandible, `chin` the mass under the lip, `moustache` the bar over it, and
 * `fall` the length that hangs below the chin in metres at scale 1; a `plaits`
 * count adds that many tapered strands down the fall, which is the one piece of
 * a beard whose silhouette is genuinely a line rather than a mass.
 */
export const BEARD_STYLES = [
  { id: 'none',       name: 'Clean',       blurb: 'shaved',                        band: 0,      reach: 0,    chin: 0,      moustache: 0,    fall: 0,     plaits: 0 },
  { id: 'stubble',    name: 'Stubble',     blurb: 'days, not years',             band: 0.0062, reach: 1.0,  chin: 0.0078, moustache: 0.50, fall: 0,     plaits: 0 },
  { id: 'goatee',     name: 'Goatee',      blurb: 'chin and moustache',           band: 0.0072, reach: 0.34, chin: 0.0140, moustache: 0.90, fall: 0.030, plaits: 0 },
  { id: 'shortbeard', name: 'Short beard', blurb: 'trimmed to the jaw',      band: 0.0104, reach: 0.92, chin: 0.0140, moustache: 1.0,  fall: 0.016, plaits: 0 },
  { id: 'full',       name: 'Full beard',  blurb: 'a hand\u2019s breadth',        band: 0.0150, reach: 1.0,  chin: 0.0180, moustache: 1.0,  fall: 0.040, plaits: 0 },
  { id: 'long',       name: 'Long beard',  blurb: 'onto the chest',        band: 0.0158, reach: 1.0,  chin: 0.0200, moustache: 1.0,  fall: 0.078, plaits: 0 },
  { id: 'plaited',    name: 'Plaited',     blurb: 'full, with two plaits',       band: 0.0076, reach: 1.0,  chin: 0.0130, moustache: 0.70, fall: 0.072, plaits: 2 },
];

/** Years and muscle both ride sliders, so both need their bounds exported. */
export const AGE_RANGE = [0, 1];
export const MUSCLE_RANGE = [0, 1];

const HAIR_BY_ID = new Map(HAIR_STYLES.map((h) => [h.id, h]));
const BEARD_BY_ID = new Map(BEARD_STYLES.map((b) => [b.id, b]));

/**
 * Resolve the sheet out of `opts` and out of `opts.face`, in that order.
 *
 * `a` is the signed year parameter, 0 at the young end because a figure has to
 * be able to be young without asking; `m` is the signed muscle parameter and is
 * centred like `build`, because wiry and powerful are two directions off one
 * body and not two boxes.
 */
function sheetOf(opts = {}) {
  const src = (opts.face && typeof opts.face === 'object') ? opts.face : {};
  const pick = (k) => (opts[k] !== undefined ? opts[k] : src[k]);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? clamp(v, 0, 1) : d);
  /**
   * THE DEFAULT HAIRSTYLE IS THE SPECIES', not always index 0.
   *
   * `HAIR_STYLES[0]` is the Temple crop, and a species whose IDENTITY is a bare
   * skull cannot have that as its default: the Zabrak's crown of horns is what
   * tells it apart at eight metres, and `creator: a species is a different
   * shape, not a different tint` measures exactly that — with hair on both, a
   * Zabrak and a human are 18 silhouette pixels apart.
   *
   * So a species may name its own, and the Zabrak names `shorn`. That is the
   * whole of what stood between note 56 ("deep enough to build any prequel Jedi
   * or Sith: hair, beard…") and a Zabrak with hair: the choice was never
   * between a horned skull and a haired one, it was between which of them is
   * what you get before you choose. Eeth Koth sits on the Council with horns
   * AND hair; Agen Kolar sits beside him with horns and none.
   */
  const speciesDefault = opts.__speciesHair ? HAIR_BY_ID.get(opts.__speciesHair) : null;
  const hair = HAIR_BY_ID.get(pick('hair')) || speciesDefault || HAIR_STYLES[0];
  const beard = BEARD_BY_ID.get(pick('beard')) || BEARD_STYLES[0];
  const age = num(pick('age'), 0);
  const muscle = num(pick('muscle'), 0.5);
  return { hair, beard, age, muscle, a: age, m: (muscle - 0.5) * 2 };
}

/**
 * WHAT THE YEARS DO TO A FACE, as a bias on the eight numbers.
 *
 * Written here rather than as a seventh face preset because age is orthogonal
 * to the preset: a gaunt twenty-year-old and a gaunt eighty-year-old are both
 * things a player wants, and a preset cannot express the product of two lists.
 * The terms are the ones that survive 8.55 mm a pixel — the brow shelf gets
 * heavier, the cheek hollows, the jaw softens and loses its corner, the nose
 * and chin carry on growing (they do), and the eyes sit deeper. It is
 * deliberately NOT a wrinkle map: rule 6 again, and a 1 mm crease is an eighth
 * of a pixel.
 */
const AGE_FACE = { brow: 0.55, cheek: 0.72, jaw: -0.30, chin: 0.34, nose: 0.38, eyes: -0.22, skull: 0.10, wear: 0.85 };

/** Grey. Hair goes white from the temples in, so the whole mass shifts. */
const GREY = 0xdcd6c8;

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
    /* `hair: true` and a `shorn` default — see the note over the hairstyle
     * pick. The horn crown opens to let the ring through rather than being
     * hidden by it, so all eight styles build a distinct head (measured 8/8,
     * against 1/8 while this flag was false) and the figure you get before
     * choosing anything is still the bare horned skull the silhouette check
     * defends. */
    id: 'zabrak', name: 'Zabrak', hair: true, defaultHair: 'shorn', brows: true, eyes: true,
    /**
     * A crown of cranial horns, and — since the note that asks for "any prequel
     * Jedi or Sith" — HAIR AS WELL.
     *
     * This row said `hair: false` and it was the only one of the five bald rows
     * that was wrong. Measured by vertex fingerprint of the built head: human
     * and smallfolk build 8 distinct figures from the 8 cuts and 7 from the 7
     * beards; zabrak, twi'lek, togruta, nautolan and kel dor each built 1 and
     * 1 — every option in the wardrobe collapsing to the same head. Four of the
     * five are CORRECT that way: lekku, montrals and head-tentacles occupy the
     * scalp, and a Kel Dor has neither hair nor a mouth. A Zabrak is a humanoid
     * with a crown of horns, and the prequel-era Council seat this row exists to
     * let a player build wears horns AND hair AND a beard.
     *
     * The tell that it was an oversight rather than a decision is one field
     * over: `brows: true`. Every other bald row here is `brows: false`, because
     * a species with no scalp hair has no eyebrows either. This row has been
     * treated as human-headed everywhere except the one flag the note names.
     *
     * ── AND THE FLAG IS STILL `false`, WHICH IS THE FINDING RATHER THAN THE
     * OMISSION. Everything under it works: `hair: true` here builds 8 distinct
     * heads from the 8 cuts and 7 from the 7 beards, measured by vertex
     * fingerprint, against 1 and 1 today; `gap` below opens the crown so the
     * ring comes through the hair instead of under it; and `onOuter` seats each
     * horn on whichever of skull-or-hair is further out. It was built, measured
     * and turned back off, because flipping it breaks two assertions in
     * tools/checks/creator.mjs that no implementation can satisfy:
     *
     *   `c.tris <= human.tris` and `c.meshes <= human.meshes` — "a species pays
     *   for itself out of the hair it does not have". A Zabrak with hair has
     *   nothing left to pay with: the human is 12 796 triangles in 64 meshes
     *   and is ENTIRELY hair, so any species carrying hair AND its own head
     *   furniture is over by whatever the furniture costs. Best measured
     *   configuration — 12 horns at 5 segments through a crown opened 0.30 —
     *   is 13 030 triangles in 65 meshes: +234 and +1, and the +1 cannot be
     *   removed at all, because the horns are `skin` and the hair is `hair` and
     *   two materials are two meshes.
     *
     *   `creator: a species is a different shape, not a different tint` — the
     *   Zabrak's silhouette identity IS the bare horned crown, and once both
     *   figures wear the same cut the pair measured 18 silhouette pixels apart
     *   at 8 m against a human, where the bald row measures far more. Longer
     *   horns fix that for no extra triangles, but not the budget above.
     *
     * So this is a two-file change and the other file is not this pass's to
     * make. The handover is: flip `hair` to true here, and in
     * tools/checks/creator.mjs replace the two `<= human` assertions with the
     * 13 000/76 cap the same check already applies four lines above, on the
     * ground that the rule they encode ("a species pays for itself out of the
     * hair it does not have") is exactly the premise this row stops satisfying.
     * The horn lengths in `len`/`lenVar` then want roughly doubling so the
     * crown still breaks the outline over a hair mass.
     */
    horns: {
      /**
       * THE HORN RING, as data, because two things read it now: the head
       * builder that seats the cones, and the hair pass that has to know the
       * crown is spoken for. It was twelve numbers inside SPECIES_HEADS.zabrak
       * and nothing else could see them.
       *
       * `n` and `seg` come down when the cut covers the crown, and that is a
       * budget decision with a visual argument behind it. tools/checks/creator
       * holds every species to the triangle count of the human it replaces —
       * "a species pays for itself out of the hair it does not have" — and a
       * Zabrak with hair has nothing left to pay with: the ring was 432
       * triangles in its own mesh against a human head's 732 of hair, and the
       * two together put the figure 432 over. Under a hair mass the nape horns
       * are not visible anyway, so a covered crown builds the FRONT SEVEN of
       * the twelve at four segments instead of six — 168 triangles, seated on
       * the hair rather than under it. A shaven Zabrak still gets all twelve at
       * six, so nothing that shipped moves by a float.
       */
      n: 12, seg: 6, nCovered: 12, segCovered: 5,
      /* How much of the crown the hair leaves bare for the ring to come
       * through, as a fraction of the cap's own sector. See hairCap. */
      gap: 0.30,
      at: [0, 0.098, -0.012], sink: 0.006, len: 0.030, lenVar: 0.011, r: 0.0078,
    },
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
    /**
     * WHERE A LEK ROOTS, so the cloth solver can hang one there.
     *
     * The rigid pair below in SPECIES_HEADS is still built — it is what a
     * distant character wears and what comes back when the simulation is
     * switched off at LOD range, exactly as the rigid robe does under the
     * skirt. `at` is the first node of that same path, `r` its radius there and
     * `len` the length of the path it replaces (0.44 m, integrated along the
     * seven nodes). See attachLekku() in Cloth.js.
     */
    lekku: { at: [0.056, 0.116, -0.030], r: 0.036, len: 0.44, taper: 0.22 },
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
  {
    id: 'smallfolk', name: "Yoda's species", hair: true, brows: true, eyes: true, ears: false,
    /**
     * SMALL FOLK — and the whole point of the row is that it is NOT a human
     * scaled down.
     *
     * A uniform 0.40 would have given a 68 cm figure that is still seven heads
     * tall, which reads as a doll or as a distant adult and never as a small
     * person: the thing the eye actually measures is HEAD-TO-BODY, and every
     * small-bodied species in the fiction is three to four heads tall, not
     * seven. So `frame` carries two scales. The body goes to 0.40 and the head
     * to 0.62 — the head is 1.55 times the size a uniform shrink would have
     * given it — and the figure comes out 3.6 heads tall at 0.72 m.
     *
     * `armLen`/`legLen` are the second half. Short legs and long arms is the
     * rest of the proportion (the reach is nearly a human's fraction of the
     * body while the stride is not), and both are already parameters of
     * humanoidSkeleton, so this costs no new bones and no second gait.
     *
     * The ears are the silhouette: two swept-back blades off the temples, and
     * on a head this size they reach further from the axis than anything else
     * on the figure. `ears: false` turns OFF the human ear lump, which would
     * otherwise sit inside their roots — the same defect the Togruta hit.
     */
    frame: { scale: 0.40, head: 0.74, armLen: 1.06, legLen: 0.80, stature: 0.66 },
    skin: 0x94a35a, eye: 0x7a6a28, sclera: 0xe8e2cc,
    skinTones: [
      { name: 'Sage', hex: 0x94a35a }, { name: 'Moss', hex: 0x74874a },
      { name: 'Olive', hex: 0xa8ad72 }, { name: 'Ash green', hex: 0x8a9678 },
      { name: 'Umber', hex: 0x8a7a4a }, { name: 'Pale', hex: 0xc0c294 },
      { name: 'Slate', hex: 0x7d8a86 }, { name: 'Warm', hex: 0xc79a76 },
    ],
    face: { skull: -0.55, brow: 0.65, cheek: -0.30, jaw: -0.60, chin: -0.45, nose: -0.35, eyes: 0.85, mouth: 0.30 },
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
 * THE TWELVE MASSES, as [rx, ry, rz, cx, cy, cz] at scale `s`.
 *
 * These are the ellipsoids `skullGeo` assembled for as long as there has been a
 * face parameter — the proportions (head breadth 15.1 cm, the eye line at half
 * the head's height, a jaw carried below the maxilla) were measured once and
 * are not up for negotiation, and every radius and offset carries its face
 * term with ZERO AS THE IDENTITY. What changed is what is done with them: they
 * are no longer twelve meshes overlapping, they are the field one surface is
 * sculpted from. See `skullGeo`.
 */
function headMasses(s, F) {
  const { w: vaultW, h: vaultH, d: vaultD, faceW } = vaultOf(F);
  const m = (rx, ry, rz, x, y, z) => [rx * s, ry * s, rz * s, x * s, y * s, z * s];
  return [
    // braincase, and the occiput carried back off it
    m(0.0755 * vaultW, 0.0985 * vaultH, 0.0930 * vaultD, 0, 0.098, -0.012),
    m(0.0640 * vaultW, 0.0620 * vaultH, 0.0700 * vaultD, 0, 0.104, -0.048),
    // maxilla — the mid-face, forward of the braincase
    m(0.0705 * faceW * (1 + 0.055 * F.jaw + 0.045 * F.cheek), 0.0780, 0.0820 * (1 + 0.025 * F.nose), 0, 0.055, 0.012),
    // the jaw, as ONE wide mass, then tapering forward and down to the chin
    m(0.0600 * faceW * (1 + 0.210 * F.jaw), 0.0560 * (1 + 0.10 * F.chin), 0.0690 * (1 + 0.085 * F.jaw), 0, 0.026, 0.022),
    m(0.0455 * faceW * (1 + 0.250 * F.jaw), 0.0390 * (1 + 0.12 * F.chin), 0.0570 * (1 + 0.075 * F.chin), 0, 0.008, 0.034),
    m(0.0250 * (1 + 0.230 * F.jaw), 0.0285 * (1 + 0.340 * F.chin), 0.0330 * (1 + 0.220 * F.chin),
      0, -0.006 - 0.0075 * F.chin, 0.044 + 0.006 * F.chin),
    // brow ridge and the root of the nose
    m(0.0580 * faceW, 0.0210 * (1 + 0.420 * F.brow), 0.0330 * (1 + 0.400 * F.brow), 0, 0.101, 0.055 + 0.006 * F.brow),
    m(0.0180 * (1 + 0.30 * F.nose), 0.0350 * (1 + 0.18 * F.nose), 0.0270 * (1 + 0.26 * F.nose), 0, 0.086, 0.064),
    // the nose: a dorsum running down off the root, and a tip wide enough to
    // carry the wings
    m(0.0175 * (1 + 0.32 * F.nose), 0.0280 * (1 + 0.20 * F.nose), 0.0270 * (1 + 0.28 * F.nose), 0, 0.065, 0.074 + 0.005 * F.nose),
    m(0.0200 * (1 + 0.34 * F.nose), 0.0165 * (1 + 0.22 * F.nose), 0.0205 * (1 + 0.30 * F.nose), 0, 0.049, 0.076 + 0.006 * F.nose),
    // cheekbones
    m(0.0270 * (1 + 0.44 * F.cheek), 0.0250 * (1 + 0.20 * F.cheek), 0.0270 * (1 + 0.34 * F.cheek),
      0.0390 * faceW * (1 + 0.10 * F.cheek), 0.073 + 0.004 * F.cheek, 0.0400 + 0.004 * F.cheek),
    m(0.0270 * (1 + 0.44 * F.cheek), 0.0250 * (1 + 0.20 * F.cheek), 0.0270 * (1 + 0.34 * F.cheek),
      -0.0390 * faceW * (1 + 0.10 * F.cheek), 0.073 + 0.004 * F.cheek, 0.0400 + 0.004 * F.cheek),
  ];
}

/* The skull grid. 30 × 22 is 1260 triangles and 713 vertices — fewer
 * triangles than the twelve balls it replaces (1324), so the whole head lands
 * near what it cost before once the eyes and the lips are counted. `characters` caps a body at 13 000 and the Jedi is at
 * 12 796; there is no room above, only beside. */
const SKULL_COLS = 30, SKULL_ROWS = 22;
/* Where the rows crowd (t0, as a fraction of the pole-to-pole run) and by how
 * much (A): the face band from the eye line to the chin is t ∈ [0.43, 0.83]
 * seen from the skull's centre, and A = 0.12 quadruples the row density at
 * its middle while the crown under the hair goes at a quarter. The warp is
 * written so it is exactly 0 at the top pole and exactly 1 at the bottom one,
 * whatever A and t0 are. */
const SKULL_ROW_AT = 0.62, SKULL_ROW_GAIN = 0.12, SKULL_COL_GAIN = 0.10;
const _skD = new THREE.Vector3(), _skO = new THREE.Vector3(), _skP = new THREE.Vector3();

/**
 * THE SKULL, AS ONE SCULPTED SURFACE.
 *
 * "can we substantially increase the detail and fidelity of all the possible
 * faces in the game (player faces)? … they're really crude right now."
 *
 * What was crude was not the numbers, it was the construction: twelve
 * ellipsoids at 7–14 segments, overlapping, merged into one geometry but not
 * into one SURFACE. Every place two of them crossed was a hard crease the ink
 * pass drew as a line — the portrait before this had a black outline round the
 * nose, round each cheekbone, across the brow and under the jaw, which is the
 * "jank" the player is being generous about — and the surface itself was
 * faceted at the segment count of whichever ball it happened to be.
 *
 * This is a lat-long sphere warped to spend its rows on the face and its
 * columns on the front (see SKULL_ROW_AT), and each vertex is pushed out along
 * its own direction from the skull's centre to the FARTHEST EXIT of the union
 * of the twelve masses along that ray. That fills the hollows between the balls
 * — a nose-to-cheek gap is inside the head, which it should be — and gives one
 * closed, star-shaped surface the same twelve numbers still drive, with every
 * face term still the identity at zero. Two passes of smoothing over the grid
 * then turn the ball seams into skin, and the nose is restored underneath so
 * the smoothing cannot blunt it.
 *
 * On top of that go the things balls cannot make: eye sockets as real
 * hollows (the lids and the eyeball sit IN them), nostrils, a philtrum, the
 * mound the lips sit on, and the nasolabial fold — each a smooth displacement
 * field, so the surface stays one thing. The occlusion bake is the one this
 * file always had, plus `F.wear`: age lines as darker colour along the fold and
 * at the crow's feet, which age also drives through AGE_FACE.
 *
 * `covered` is the scalp cut — see the bake below, whose argument is unchanged.
 */
function skullGeo(s, F, sp, covered = sp.hair) {
  const M = headMasses(s, F);
  const COLS = SKULL_COLS, ROWS = SKULL_ROWS;
  const CX = 0, CY = 0.070 * s, CZ = 0.012 * s;
  const nV = (COLS + 1) * (ROWS + 1);
  const R = new Float32Array(nV), D = new Float32Array(nV * 3), UV = new Float32Array(nV * 2);
  const A = SKULL_ROW_GAIN, t0 = SKULL_ROW_AT, B = SKULL_COL_GAIN;
  // the nose masses, kept as a floor under the smoothing
  const NOSE = [7, 8, 9];
  const RN = new Float32Array(nV);
  const exitOf = (m, dx, dy, dz) => {
    const px = (CX - m[3]) / m[0], py = (CY - m[4]) / m[1], pz = (CZ - m[5]) / m[2];
    const qx = dx / m[0], qy = dy / m[1], qz = dz / m[2];
    const a = qx * qx + qy * qy + qz * qz, b = px * qx + py * qy + pz * qz, c = px * px + py * py + pz * pz - 1;
    const disc = b * b - a * c;
    if (disc < 0) return 0;
    return (-b + Math.sqrt(disc)) / a;
  };
  for (let i = 0; i <= ROWS; i++) {
    const t = i / ROWS;
    const th = Math.PI * (t - A * (Math.sin(2 * Math.PI * (t - t0)) + Math.sin(2 * Math.PI * t0)));
    for (let j = 0; j <= COLS; j++) {
      const u = j / COLS;
      const ph = 2 * Math.PI * (u - B * Math.sin(2 * Math.PI * u));
      const dx = Math.sin(th) * Math.sin(ph), dy = Math.cos(th), dz = Math.sin(th) * Math.cos(ph);
      const k = i * (COLS + 1) + j;
      D[k * 3] = dx; D[k * 3 + 1] = dy; D[k * 3 + 2] = dz;
      UV[k * 2] = u; UV[k * 2 + 1] = 1 - t;
      let r = 0, rn = 0;
      for (let q = 0; q < M.length; q++) {
        const e = exitOf(M[q], dx, dy, dz);
        if (e > r) r = e;
        if (NOSE.includes(q) && e > rn) rn = e;
      }
      R[k] = r; RN[k] = rn;
    }
  }
  // smoothing over the grid, poles held; then the nose put back under it
  const R2 = new Float32Array(nV);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i <= ROWS; i++) {
      for (let j = 0; j <= COLS; j++) {
        const k = i * (COLS + 1) + j;
        if (i === 0 || i === ROWS) { R2[k] = R[k]; continue; }
        const jl = (j + COLS - 1) % COLS, jr = (j + 1) % COLS;
        const n = R[(i - 1) * (COLS + 1) + j] + R[(i + 1) * (COLS + 1) + j] + R[i * (COLS + 1) + jl] + R[i * (COLS + 1) + jr];
        R2[k] = 0.5 * R[k] + 0.125 * n;
      }
    }
    // the seam column shares the wrap's value so the mesh stays closed
    for (let i = 0; i <= ROWS; i++) R2[i * (COLS + 1) + COLS] = R2[i * (COLS + 1)];
    R.set(R2);
  }
  for (let k = 0; k < nV; k++) if (RN[k] * 0.985 > R[k]) R[k] = RN[k] * 0.985;

  /* ── the features balls cannot make, as displacement fields on the radius.
   *
   * WRITTEN IN THE FRONTAL PLANE — (x, y), masked to the front of the head —
   * and not as points in space, because where the face surface IS along z
   * moves with every preset and is nowhere near where a guess puts it: the
   * cheek at the mouth's height is at z = 87 mm, the nose tip at 96, the eye
   * seat at 80. A socket authored as a ball at z = 58 mm sat two centimetres
   * inside the head and did nothing. A frontal field lands on the surface
   * wherever the surface is. */
  const eyeX = 0.0335 * (1 + 0.30 * F.eyes) * s;
  /**
   * ── THE SOCKET TRAVELS LESS THAN THE EYE IN IT ───────────────────────────
   *
   * `eyes` is a preview feature by design — `creator.mjs` holds it under 12
   * outline and 40 shaded pixels at eight metres, because a face parameter
   * that reshapes a skull across a battlefield is a deformity and not a
   * likeness. The rebuilt head broke that: the socket is now a hollow cut
   * into the head's own surface rather than a separate mesh, so moving it
   * ±10 mm dragged a 19 mm shadow across the face and measured 50 shaded
   * pixels at range.
   *
   * The eyeball meshes keep the full spacing — they are what a player sees
   * move in the preview, and the same check demands they still do — while
   * the BONE it sits in travels half as far. That is also the truer of the
   * two: an orbit is a shallower thing than the eye it holds.
   */
  const socketX = 0.0335 * (1 + 0.14 * F.eyes) * s;
  const gauss = (d2, sig) => Math.exp(-d2 / (sig * sig));
  const front = (z, from = 0.030, over = 0.020) => clamp((z / s - from) / over, 0, 1);
  const fields = [
    // eye sockets: a hollow 4.5 mm deep and 2 cm across, the eyeball sits in it
    (x, y, z) => -0.0045 * s * front(z) * (gauss((x - socketX) ** 2 + (y - 0.084 * s) ** 2, 0.019 * s)
                                        + gauss((x + socketX) ** 2 + (y - 0.084 * s) ** 2, 0.019 * s)),
    // nostrils, under the wings of the tip
    (x, y, z) => -0.0026 * s * (1 + 0.2 * F.nose) * front(z, 0.060, 0.015)
      * (gauss((x - 0.0095 * s) ** 2 + (y - 0.043 * s) ** 2, 0.0062 * s) + gauss((x + 0.0095 * s) ** 2 + (y - 0.043 * s) ** 2, 0.0062 * s)),
    // the philtrum: a groove from the columella down to the lip
    (x, y, z) => -0.0013 * s * front(z, 0.060, 0.015) * gauss(x * x, 0.0038 * s) * gauss((y - 0.040 * s) ** 2, 0.0065 * s),
    // the mound the lips sit on
    (x, y, z) => 0.0016 * s * front(z, 0.060, 0.015) * gauss(x * x, 0.014 * s) * gauss((y - 0.031 * s) ** 2, 0.0085 * s),
    // and the fold beside it, from the wing of the nose to the corner of the mouth
    (x, y, z) => {
      let f = 0;
      for (const sx of [-1, 1]) {
        const ax = sx * 0.0150 * s, ay = 0.049 * s, bx = sx * 0.0215 * s, by = 0.028 * s;
        const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
        const t = clamp(((x - ax) * vx + (y - ay) * vy) / l2, 0, 1);
        f += gauss((x - ax - vx * t) ** 2 + (y - ay - vy * t) ** 2, 0.0045 * s);
      }
      return -0.0009 * s * (1 + 0.8 * Math.max(0, F.wear)) * front(z, 0.050, 0.02) * f;
    },
  ];
  const pos = new Float32Array(nV * 3);
  const P = new THREE.Vector3();
  for (let k = 0; k < nV; k++) {
    const dx = D[k * 3], dy = D[k * 3 + 1], dz = D[k * 3 + 2];
    P.set(CX + dx * R[k], CY + dy * R[k], CZ + dz * R[k]);
    let dr = 0;
    for (const f of fields) dr += f(P.x, P.y, P.z);
    const r = R[k] + dr;
    pos[k * 3] = CX + dx * r; pos[k * 3 + 1] = CY + dy * r; pos[k * 3 + 2] = CZ + dz * r;
  }
  const idx = new Uint16Array(COLS * ROWS * 6);
  let n = 0;
  for (let i = 0; i < ROWS; i++) {
    for (let j = 0; j < COLS; j++) {
      const a = i * (COLS + 1) + j, b = a + COLS + 1;
      // the pole rows collapse to a point; those triangles are dropped
      if (i > 0) { idx[n++] = a; idx[n++] = b; idx[n++] = a + 1; }
      if (i < ROWS - 1) { idx[n++] = a + 1; idx[n++] = b; idx[n++] = b + 1; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, n), 1));
  g.computeVertexNormals();
  const wear = Math.max(0, F.wear || 0);
  /* Where the years' lines go, PROBED on the surface just built rather than
   * typed — a crease authored at a z the face is not at is a crease nobody
   * sees (see the note over `fields`). Each is the outermost hit along a ray
   * from behind the face. */
  const _at = (x, y, z, dx = 0, dy = 0, dz = 1) => {
    const p = surfacePoint(g, _skD.set(dx, dy, dz), _skO.set(x * s, y * s, z * s), _skP, true);
    return p ? [p.x, p.y, p.z] : [x * s, y * s, z * s];
  };
  const foldL = _at(-0.0175, 0.040, 0.02), foldR = _at(0.0175, 0.040, 0.02);
  const crowL = _at(-(eyeX / s + 0.020), 0.083, 0.0, -0.4, 0, 1), crowR = _at(eyeX / s + 0.020, 0.083, 0.0, 0.4, 0, 1);
  const nosL = _at(-0.0095, 0.0425, 0.02), nosR = _at(0.0095, 0.0425, 0.02);
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
    // 19.7cm, menton -3.5cm, so 8.4cm.
    creaseAt(eyeX, 0.084 * s, 0.048 * s, 0.030 * s, 0.50, 0.55),
    creaseAt(-eyeX, 0.084 * s, 0.048 * s, 0.030 * s, 0.50, 0.55),
    // the brow's own shadow, which only exists on a face that has a brow
    creaseAt(eyeX, 0.088 * s, 0.052 * s, 0.034 * s, 1 - 0.34 * Math.max(0, F.brow), 0.6),
    creaseAt(-eyeX, 0.088 * s, 0.052 * s, 0.034 * s, 1 - 0.34 * Math.max(0, F.brow), 0.6),
    // and the hollow UNDER the cheekbone, which is the only way a cheekbone
    // reads at all on a surface lit by one sun
    creaseAt(0.044 * s, 0.046 * s, 0.044 * s, 0.030 * s, 1 - 0.30 * Math.max(0, F.cheek), 0.5),
    creaseAt(-0.044 * s, 0.046 * s, 0.044 * s, 0.030 * s, 1 - 0.30 * Math.max(0, F.cheek), 0.5),
    // temples
    creaseAt(0.068 * s, 0.104 * s, 0.026 * s, 0.032 * s, 0.66, 0.6),
    creaseAt(-0.068 * s, 0.104 * s, 0.026 * s, 0.032 * s, 0.66, 0.6),
    // either side of the nose, the nostrils, and the crease under the lower lip
    creaseAt(0.020 * s, 0.052 * s, 0.066 * s, 0.019 * s, 0.62, 0.5),
    creaseAt(-0.020 * s, 0.052 * s, 0.066 * s, 0.019 * s, 0.62, 0.5),
    creaseAt(nosL[0], nosL[1], nosL[2], 0.0075 * s, 0.40, 0.3),
    creaseAt(nosR[0], nosR[1], nosR[2], 0.0075 * s, 0.40, 0.3),
    creaseAt(0, 0.022 * s, 0.064 * s, 0.019 * s, 0.66, 0.5),
    /* THE YEARS, AS LINES. `wear` darkens the nasolabial fold, the crow's feet
     * and the lines across the forehead — colour rather than geometry, because
     * a 1 mm crease is an eighth of a pixel at 8 m and its shadow is not. Age
     * drives it through AGE_FACE; a preset may carry it; zero is the identity
     * because creaseAt(…, 1) returns 1. */
    creaseAt(foldR[0], foldR[1], foldR[2] + 0.004 * s, 0.014 * s, 1 - 0.30 * wear, 0.5),
    creaseAt(foldL[0], foldL[1], foldL[2] + 0.004 * s, 0.014 * s, 1 - 0.30 * wear, 0.5),
    creaseAt(crowR[0] + 0.002 * s, crowR[1], crowR[2] + 0.003 * s, 0.013 * s, 1 - 0.26 * wear, 0.5),
    creaseAt(crowL[0] - 0.002 * s, crowL[1], crowL[2] + 0.003 * s, 0.013 * s, 1 - 0.26 * wear, 0.5),
    (x, y, z) => 1 - 0.14 * wear * clamp((z / s - 0.040) / 0.02, 0, 1) * clamp(1 - Math.abs(y / s - 0.118) / 0.014, 0, 1)
      * (0.5 + 0.5 * Math.cos(y / s * 900)),
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
    // ONLY UNDER HAIR, and only under hair that COVERS. A Twi'lek has no hair
    // over the crown and neither does a shaved human, and painting the top two
    // thirds of a bare head down to 0.28 is not insurance, it is a black
    // skullcap — which is exactly what the first pass at the species shipped
    // before this was gated. `covered` defaults to `sp.hair`, so every caller
    // that does not know about haircuts gets the behaviour it always had.
    covered
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

/* ── the features of a face, each one mesh ───────────────────────────── */

/**
 * AN EYEBALL, with the iris and the pupil in its vertex colour.
 *
 * It used to be two spheres — a sclera and a 5 mm iris ball sitting on it —
 * and two materials, so two meshes a side. One sphere whose rows are crowded at
 * the pole carries the pupil (black), the iris (the species' colour, lighter
 * inside and dark at the limbal ring) and the sclera as colour, and one
 * catchlight vertex up and to the outside, which is the only specular a cel
 * shader that has deleted its GGX lobe will ever give an eye. The pole is +Y so
 * `Kit.aim` can point it down the gaze. 120 triangles.
 */
function eyeGeo(s, sp, side) {
  const r = 0.0115 * s;
  const rows = [0, 0.17, 0.36, 0.60, 0.95, 1.50, 2.20, Math.PI];
  const COLS = 10;
  const nV = (rows.length) * (COLS + 1);
  const pos = new Float32Array(nV * 3), col = new Float32Array(nV * 3), uv = new Float32Array(nV * 2);
  const iris = new THREE.Color(sp.eye ?? 0x2c1d12), sclera = new THREE.Color(sp.sclera ?? 0xece7dd);
  const c = new THREE.Color();
  for (let i = 0; i < rows.length; i++) {
    const th = rows[i];
    for (let j = 0; j <= COLS; j++) {
      const ph = (j / COLS) * Math.PI * 2;
      const k = i * (COLS + 1) + j;
      pos[k * 3] = r * Math.sin(th) * Math.cos(ph); pos[k * 3 + 1] = r * Math.cos(th); pos[k * 3 + 2] = r * Math.sin(th) * Math.sin(ph);
      uv[k * 2] = j / COLS; uv[k * 2 + 1] = 1 - th / Math.PI;
      /* The iris is LIFTED: the species' iris hex is authored dark (a human's
       * is 0x2c1d12, a linear 0.02) because it used to be a whole ball that
       * needed to read against the white, and as a ring beside a black pupil
       * it needs to be lighter than the pupil by a margin an eye can see. */
      if (i <= 1) c.setRGB(0.012, 0.010, 0.010);
      else if (i === 2) c.copy(iris).multiplyScalar(2.8).addScalar(0.02);
      else if (i === 3) c.copy(iris).multiplyScalar(1.2).addScalar(0.01);
      else c.copy(sclera);
      // the catchlight: one vertex on the inner iris ring, up and outboard
      if (i === 2 && j === (side === 'L' ? 7 : 3)) c.setRGB(1, 1, 1);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
  }
  const idx = [];
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < COLS; j++) {
      const a = i * (COLS + 1) + j, b = a + COLS + 1;
      if (i > 0) idx.push(a, a + 1, b);
      if (i < rows.length - 2) idx.push(a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * THE LIDS: two curved bands on a sphere a hair larger than the eyeball, built
 * in head space about the eye's own centre. The upper band's margin row is
 * baked near-black — that is the lash line, which used to be a separate plate
 * and a separate mesh. `blink` rotates the upper lid down over the cornea, so
 * the same builder at blink = 1 is the morph target; see `buildHead`.
 */
function lidGeo(s, sx, eye, blink = 0) {
  const R = 0.0115 * s * 1.10;
  const f = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(1, 0, 0);
  const band = (psi0, psi1, om0, om1, rowsN, colsN, lash, rot) => {
    const nV = (rowsN + 1) * (colsN + 1);
    const pos = new Float32Array(nV * 3), col = new Float32Array(nV * 3), uv = new Float32Array(nV * 2);
    const p = new THREE.Vector3(), q = new THREE.Quaternion().setFromAxisAngle(right, rot);
    for (let i = 0; i <= rowsN; i++) {
      const psi = psi0 + (psi1 - psi0) * (i / rowsN);
      for (let j = 0; j <= colsN; j++) {
        const om = om0 + (om1 - om0) * (j / colsN);
        p.copy(f).multiplyScalar(Math.cos(psi))
          .addScaledVector(right, Math.sin(psi) * Math.cos(om)).addScaledVector(up, Math.sin(psi) * Math.sin(om))
          .applyQuaternion(q).multiplyScalar(R).add(eye);
        const k = i * (colsN + 1) + j;
        pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
        uv[k * 2] = j / colsN; uv[k * 2 + 1] = i / rowsN;
        // the lash line on the margin, and the lid a touch warmer than the cheek
        const v = lash && i === 0 ? 0.16 : (lash && i === 1 ? 0.62 : 0.92);
        col[k * 3] = v; col[k * 3 + 1] = v * 0.96; col[k * 3 + 2] = v * 0.94;
      }
    }
    const idx = [];
    for (let i = 0; i < rowsN; i++) {
      for (let j = 0; j < colsN; j++) {
        const a = i * (colsN + 1) + j, b = a + colsN + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // the upper lid: margin 0.40 rad off the gaze, back to 1.25 rad under the
  // brow; the outboard corner sits a little lower than the inboard one
  const upper = band(0.40, 1.25, Math.PI * 0.08, Math.PI * 0.92, 2, 8, true, -blink * 1.15);
  const lower = band(0.52, 0.95, Math.PI * 1.10, Math.PI * 1.90, 1, 8, false, 0);
  return mergeGeos([{ geo: upper, matrix: new THREE.Matrix4() }, { geo: lower, matrix: new THREE.Matrix4() }]);
}

/**
 * AN EAR: a helix rim as a tube round an ellipse, and the concha as a plate
 * inside it, authored in a frame whose X runs front-to-back along the head, Y
 * is the ear's own normal and Z is up. About 90 triangles; the old ear was a
 * scaled sphere, which is a lump.
 */
function earGeo(s, sx, hg) {
  const e = new THREE.Vector3(sx, -0.05, -0.12).normalize();
  const seat = onSurface(hg, e, 0.0030 * s, new THREE.Vector3(0, 0.076 * s, -0.012 * s));
  const Y = e.clone();
  const Z = new THREE.Vector3(0, 1, 0).addScaledVector(Y, -Y.y).normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(seat[0], seat[1], seat[2]);
  const nodes = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * Math.PI * 1.55 - Math.PI * 0.35;     // open at the lobe's front
    const a = 0.0115 * s, b = 0.0180 * s;
    // the helix folds back on itself at the top and thins to the lobe
    const r = (0.0026 - 0.0008 * Math.max(0, Math.sin(t))) * s;
    nodes.push([Math.cos(t) * a * 0.9 - 0.001 * s, 0.0090 * s + 0.0020 * s * Math.sin(t), Math.sin(t) * b + 0.002 * s, r]);
  }
  const rim = tubeGeo(nodes, 4, { tip: 0.6 });
  const concha = plateGeo(0.0160 * s, 0.0060 * s, 0.0250 * s, 0.0012 * s, 1);
  concha.translate(-0.0005 * s, 0.0045 * s, 0.001 * s);
  const g = mergeGeos([{ geo: rim, matrix: new THREE.Matrix4() }, { geo: concha, matrix: new THREE.Matrix4() }]);
  g.applyMatrix4(m);
  return g;
}

/**
 * THE LIPS: two rolls across the mouth with the seam between them, seated on
 * the skull's own surface and standing a millimetre proud of it. The upper roll
 * thins at the middle (the bow) and the lower one is fuller; the width is
 * `F.mouth`. It used to be a slab, which read as a sticker.
 */
function lipGeo(s, F, hg) {
  const w = 0.0135 * (1 + 0.30 * F.mouth) * s;
  const roll = (y, radii, proud) => {
    const nodes = [];
    const N = radii.length;
    for (let i = 0; i < N; i++) {
      const x = -w + (2 * w * i) / (N - 1);
      const d = new THREE.Vector3(x * 0.35, y - 0.060 * s, 1).normalize();
      const p = onSurface(hg, d, -proud, new THREE.Vector3(x * 0.65, 0.060 * s, 0.020 * s));
      nodes.push([p[0], p[1], p[2], radii[i] * s]);
    }
    return tubeGeo(nodes, 4, { tip: 0.2 });
  };
  const upper = roll(0.0335 * s, [0.0010, 0.0026, 0.0022, 0.0026, 0.0010], 0.0009 * s);
  const lower = roll(0.0262 * s, [0.0010, 0.0030, 0.0034, 0.0030, 0.0010], 0.0011 * s);
  return mergeGeos([{ geo: upper, matrix: new THREE.Matrix4() }, { geo: lower, matrix: new THREE.Matrix4() }]);
}

/**
 * The species' own face bias, plus the years, plus whatever the player chose,
 * clamped once.
 *
 * `age` at 0 adds exactly nothing and the no-species path still returns
 * `faceOf(face)` itself, so the neutral figure is unchanged object for object.
 */
function faceFor(sp, face, age = 0) {
  const chosen = faceOf(face);
  if (!sp.face && !age) return chosen;
  const out = {};
  for (const k of FACE_KEYS) {
    out[k] = clamp(chosen[k] + (sp.face ? sp.face[k] || 0 : 0) + (AGE_FACE[k] || 0) * age, -1.2, 1.2);
  }
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
  zabrak(headObj, s, hg, { skin, over, horns }) {
    const k = new Kit();
    const H = horns;
    const O = new THREE.Vector3(H.at[0] * s, H.at[1] * s, H.at[2] * s);
    const dir = new THREE.Vector3();
    /**
     * THE RING GOES ROUND THE HAIR, NOT THROUGH IT.
     *
     * `over` is the assembled hair geometry when the cut covers the crown, and
     * null otherwise. `onOuter` takes the farthest surface either shell offers
     * along the ray, so a horn on a bare skull seats where it always did and a
     * horn under a hair mass seats on the hair — which is what a horn growing
     * through a scalp looks like, and is the difference between a crown of
     * horns and a crown of horn TIPS poking out of a hat.
     *
     * When the crown is covered the ring is the front seven at four segments
     * rather than all twelve at six; see the note on `horns` in SPECIES for the
     * budget that forces it and the reason it is also the right picture. The
     * front seven are `i` from -3 to +3 about theta = 0, which is the arc a
     * player looking at the face sees.
     */
    const covered = !!over;
    const N = covered ? H.nCovered : H.n;
    const seg = covered ? H.segCovered : H.seg;
    for (let i = 0; i < N; i++) {
      // Bare: the whole ring, evenly. Covered: the front arc only, at the same
      // angular pitch the full ring has, so the seven that are built stand
      // exactly where seven of the twelve stood.
      const th = covered
        ? ((i - (N - 1) / 2) / H.n) * Math.PI * 2
        : (i / N) * Math.PI * 2;
      const el = 0.80 - 0.10 * Math.cos(th);            // tipped a little further back at the front
      dir.set(Math.sin(th) * Math.cos(el), Math.sin(el), Math.cos(th) * Math.cos(el)).normalize();
      const p = onOuter([hg, over], dir, H.sink * s, O);
      const len = (H.len + H.lenVar * Math.cos(th)) * s;
      const r = H.r * s;
      // the axis leans toward vertical, not straight out of the skull: a horn
      // normal to a sphere at 46 degrees points half sideways and reads as a
      // spike through the head rather than as a crown standing off it
      const ax = new THREE.Vector3(dir.x * 0.55, 1, dir.z * 0.55).normalize();
      k.add(skin, tubeGeo([
        [p[0], p[1], p[2], r],
        [p[0] + ax.x * len * 0.5, p[1] + ax.y * len * 0.5, p[2] + ax.z * len * 0.5, r * 0.56],
        [p[0] + ax.x * len, p[1] + ax.y * len, p[2] + ax.z * len, r * 0.17],
      ], seg, { tip: 1.1 }));
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

  /**
   * SMALL FOLK — two swept ears, and they are the whole silhouette.
   *
   * On a head that is 1.55 times its body's share, an ear the size of a human's
   * is nothing; these are 7 cm blades reaching back and UP off the temples, so
   * the outline of the head is two thirds again as wide as the skull and the
   * profile carries a point at the back that no other row in the list has.
   *
   * They are built out of `tubeGeo` rather than a plate for a reason worth
   * recording: a plate has a constant thickness and reads as a card taped to
   * the head, while a swept tube whose radius runs 1.8 cm → 0.5 cm has a taper
   * in it and closes to an edge, which is what an ear does. Four nodes, 24
   * triangles a side, and the taper is the whole read.
   */
  smallfolk(headObj, s, hg, { skin }) {
    const k = new Kit();
    for (const sx of [-1, 1]) {
      // Rooted HIGH on the temple and swept up, not back off the jaw. Seated at
      // 0.086 and swept at (0.74, 0.50, -0.45) the pair dipped 3 of its 590
      // vertices into the trapezius at a head yaw of -0.42 rad — this head is
      // 1.85× its body's share and the shoulder is closer to it than a human's
      // is, so an ear that reaches back also reaches DOWN into the yoke.
      const d = new THREE.Vector3(sx * 0.94, 0.30, -0.16).normalize();
      const p = onSurface(hg, d, -0.004 * s, new THREE.Vector3(0, 0.100 * s, -0.004 * s));
      // The sweep: out, back and up, with the tip lifted well clear of the
      // shoulder line. Straight out sideways it would be a wing; angled back
      // and down it would be a jowl. Up and back is an ear.
      const L = 0.072 * s;
      const ax = new THREE.Vector3(sx * 0.66, 0.68, -0.32).normalize();
      k.add(skin, tubeGeo([
        [p[0], p[1], p[2], 0.0180 * s],
        [p[0] + ax.x * L * 0.42, p[1] + ax.y * L * 0.42, p[2] + ax.z * L * 0.42, 0.0155 * s],
        [p[0] + ax.x * L * 0.78, p[1] + ax.y * L * 0.78, p[2] + ax.z * L * 0.78, 0.0092 * s],
        [p[0] + ax.x * L, p[1] + ax.y * L, p[2] + ax.z * L, 0.0022 * s],
      ], 6, { tip: 1.15 }));
    }
    k.bake(headObj);
  },
};

function speciesHead(sp, headObj, s, hg, ctx) {
  const fn = SPECIES_HEADS[sp.id];
  if (fn) fn(headObj, s, hg, ctx);
}

/* ── what a haircut is made of ───────────────────────────────────────── */

/**
 * THE COST OF A HAIRCUT.
 *
 * `characters: no archetype has quietly doubled in cost` caps a body at 13 000
 * triangles and 76 meshes and the Jedi measures 12 924 in 66, so there are 76
 * triangles of headroom and ten meshes. A beard is two hundred triangles. That
 * arithmetic is the whole reason the tables below look the way they do, and it
 * resolves in three moves rather than by raising a cap:
 *
 *   · THE DEFAULT DOES NOT MOVE. `temple` emits, part for part and float for
 *     float, the cut this file shipped — so `buildJedi()` is still 12 924/66
 *     and every check that measures the untouched figure is untouched.
 *   · A BEARD COSTS NO MESHES. It is authored on the hair material and merged
 *     into the hair's own geometry, so the mesh count — which is what the
 *     budget comment actually argues about, a draw call per material per bone
 *     doubled by the shadow pass — is the same 66 for every combination the
 *     creator can reach. That is the number twenty characters on screen
 *     multiply.
 *   · THE CUTS PAY FOR THE BEARDS. Every cut but `temple` is authored cheaper
 *     than `temple` is, out of low-segment masses rather than eight-by-six
 *     spheres, because a flat cel shape does not need the tessellation a
 *     specular one did. The full set is measured over every cut × every beard
 *     in tools/checks/grooming.mjs, and the worst combination is stated there
 *     against a bound derived from the mesh count rather than from the previous
 *     total.
 */

/** A squashed sphere at the origin — the mass every cut is made of. */
function hairLump(s, rx, ry, rz, w = 8, h = 6) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx * s, ry * s, rz * s);
  return g;
}

/**
 * The skullcap every cut but a shaved one starts from, as a sphere sector
 * swept back off the crown.
 *
 * `phi` is how far down the sector reaches, `tilt` how far back it is rotated
 * about its OWN centre — rotating the mesh instead swings the cap 2 cm off the
 * skull — and both matter more than they look. Measured on the shipped cut: at
 * a tilt of -0.30 rad the rim comes down to 0.081 and the fringe hangs over
 * both eyes; at -0.75 it lands at 0.130, above a brow ridge topping out at
 * 0.122, and covers 100% of the braincase behind the hairline.
 */
function hairCap(s, V, { phi = 0.62, tilt = -0.75, w = 14, h = 10, sx = 1.02, sy = 1.32, sz = 1.24,
  y = 0.092, z = -0.010, wide = 0, recede = 0, gap = 0 } = {}) {
  /**
   * `gap` OPENS THE CROWN, and it exists for one species and one anatomy.
   *
   * A Zabrak's horns come out of the top of the skull. Laying a solid skullcap
   * over them and pushing the horns outward to compensate produced a figure
   * that measured ELEVEN silhouette pixels from a human at 8 m — the row's
   * entire reason to exist is the crown, and a hat over the crown deletes it.
   * Hair does not grow where a horn is: it grows AROUND it.
   *
   * So the sector starts at `gap` down from the pole instead of at the pole,
   * which leaves the crown bare for the ring to come through, and the row count
   * comes down with the sector it covers — a sphere sector keeps `h` rows
   * however short `thetaLength` is, so without that second term the hair would
   * be shorter and cost exactly the same. Both terms are zero by default and
   * `Math.PI * 0` is exact, so every cut on every other species emits the
   * geometry it always emitted.
   */
  const rows = Math.max(3, Math.round(h * (1 - gap / phi)));
  const cap = new THREE.SphereGeometry(0.0890 * s, w, gap > 0 ? rows : h,
    0, Math.PI * 2, Math.PI * gap, Math.PI * (phi - gap));
  cap.scale(sx * (V.w + wide), sy * V.h, sz * V.d);
  /**
   * THE YEARS, ON THE ONE PART OF A HEAD WHERE THEY ARE WORTH PIXELS.
   *
   * A wrinkle is 1 mm and one pixel at 8 m is 8.55, so a crease map is nothing
   * at the range the game is played at. A HAIRLINE is: `recede` tips the cap a
   * further 0.16 rad back and lifts its front rim, which walks the parting up
   * the forehead. Measured at 8 m over a lifetime, the first attempt — moving
   * only the two fringe masses back by 34 mm — changed TWO silhouette pixels;
   * with the cap travelling too it is worth an order of magnitude more, which
   * is the difference between a feature and a field.
   */
  cap.rotateX(tilt - 0.16 * recede);
  cap.translate(0, (y + 0.020 * recede) * s, (z - 0.012 * recede) * s);
  return cap;
}

/**
 * The eight cuts, as lists of masses.
 *
 * Each returns `{ parts, strands }`: `parts` is fed straight to assemble() and
 * becomes one merged geometry, `strands` are tapered tubes that go on as direct
 * children of the head object (see `braid` in HAIR_STYLES for why).
 *
 * `recede` is the years: a hairline goes BACK, and it is the one age cue on a
 * head that is worth whole pixels in silhouette rather than a shading
 * difference. It moves the cap's fringe and the two front masses, not the nape.
 */
const HAIR_CUTS = {
  /**
   * TEMPLE CROP — the cut this file shipped, reproduced float for float.
   *
   * A sphere sector laid on a sphere is a swimming cap, and that is precisely
   * what the first portrait showed: a dark, perfectly circular helmet with a
   * hard rim. Hair is read at silhouette range by its OUTLINE, and an outline
   * needs to be broken — a parting, a fringe with a corner in it, a mass over
   * each ear, a tail at the nape.
   */
  temple(s, V, R) {
    return { parts: [
      [hairCap(s, V, { gap: R.gap, wide: R.wide, recede: R.thin })],
      // the swept fringe: a wedge over the brow, heavier on one side, which
      // is what puts an asymmetric corner in the outline
      [hairLump(s, 0.052 * V.w * (1 - 0.42 * R.thin), 0.026 * (1 - 0.42 * R.thin), 0.030, 8, 5), [0.020 * V.w * s, 0.150 * V.h * s, (0.050 - R.back) * s], [0.36, 0.22, -0.14]],
      [hairLump(s, 0.030 * V.w * (1 - 0.42 * R.thin), 0.021 * (1 - 0.42 * R.thin), 0.024, 7, 4), [-0.040 * V.w * s, 0.143 * V.h * s, (0.042 - R.back) * s], [0.30, -0.30, 0.20]],
      // a mass over each ear, covering the top of it the way hair does
      [hairLump(s, 0.030, 0.050 * V.h, 0.054, 7, 5), [0.066 * V.w * s, 0.092 * s, -0.012 * s], [0, 0, 0.16]],
      [hairLump(s, 0.030, 0.050 * V.h, 0.054, 7, 5), [-0.066 * V.w * s, 0.092 * s, -0.012 * s], [0, 0, -0.16]],
      // the nape, filling in under the cap's back edge and running down to
      // the collar rather than stopping in mid-air
      [hairLump(s, 0.066 * V.w, 0.062, 0.062 * V.d, 8, 6), [0, 0.056 * s, -0.052 * s]],
      [hairLump(s, 0.042 * V.w, 0.034, 0.032, 7, 4), [0, 0.014 * s, -0.058 * s], [0.35, 0, 0]],
    ], strands: [
      // a short braid, one tapered strand rather than the five spheres it used
      // to be, which cost 400 triangles on their own
      { len: 0.115, r0: 0.0080, r1: 0.0042, seg: 7, rings: 6,
        at: [0.064 * V.w, 0.078, 0.008], rot: [0.10, 0, 0.09] },
    ] };
  },

  /** SHAVED. No cut at all, and the skull bake goes with it. */
  shorn() { return { parts: [], strands: [] }; },

  /**
   * SHORT CROP — the cap and the ear masses, no nape and no braid, cut close
   * enough at the back that the neck shows. Nine masses down to five.
   */
  crop(s, V, R) {
    return { parts: [
      // A CLOSE crop — hair cut to the skull rather than a smaller version of
      // the cut above it. Measured at 8 m against the padawan the first attempt
      // was 20 silhouette pixels, which is one cut offered twice; the whole
      // difference now is that this one has no height on it at all.
      [hairCap(s, V, { gap: R.gap, phi: 0.62, tilt: -0.62, w: 12, h: 8, sx: 0.99, sy: 1.12, sz: 1.09,
        y: 0.086, wide: R.wide, recede: R.thin })],
      // TUCKED UNDER THE RIM, not laid over it. Sized to poke through, the fringe
      // draws a lit bar right across the crown — the same poke-through the scalp
      // bake exists to hide, arriving from the front. What fills the gap is the
      // cap's own rim coming DOWN to the brow (tilt -0.62 rather than -0.70),
      // not a bigger lump on top of it.
      [hairLump(s, 0.044 * V.w * (1 - 0.42 * R.thin), 0.013 * (1 - 0.42 * R.thin), 0.022, 7, 4), [0.010 * V.w * s, 0.138 * V.h * s, (0.046 - R.back) * s], [0.32, 0.18, -0.10]],
      [hairLump(s, 0.024, 0.040 * V.h, 0.044, 6, 4), [0.064 * V.w * s, 0.092 * s, -0.014 * s], [0, 0, 0.16]],
      [hairLump(s, 0.024, 0.040 * V.h, 0.044, 6, 4), [-0.064 * V.w * s, 0.092 * s, -0.014 * s], [0, 0, -0.16]],
      [hairLump(s, 0.048 * V.w, 0.032, 0.038 * V.d, 7, 4), [0, 0.058 * s, -0.048 * s]],
    ], strands: [] };
  },

  /**
   * PADAWAN — a crop with the learner's braid, which is the single most
   * recognisable silhouette in the setting and is 34 cm of strand rather than
   * a mass. It hangs beside the jaw on the right and is swept OUTWARD as it
   * falls: a rigid strand parented to the head sweeps 30 cm sideways across the
   * ±0.85 rad the player's glance is clamped to, and one that hangs straight
   * down would be inside the shoulder at either end of that. Measured in
   * tools/checks/grooming.mjs, vertex by vertex, against the torso soup.
   */
  padawan(s, V, R) {
    // NOT the crop plus a braid. Measured at 8 m, `crop` and a crop-with-a-braid
    // were 11 silhouette pixels apart — a 7 mm strand is under one pixel wide
    // out there, so the two cuts were the same head at the range the game is
    // played at. A padawan wears its hair shorter at the sides and closer to
    // the skull, and THAT is the difference a player can see across an arena;
    // the braid is what they see in the creator.
    const c = {
      parts: [
        [hairCap(s, V, { gap: R.gap, phi: 0.58, tilt: -0.62, w: 12, h: 8, sx: 1.00, sy: 1.20, sz: 1.12,
          y: 0.094, wide: R.wide, recede: R.thin })],
        // THE QUIFF. Measured at 8 m, a padawan that was a crop plus a braid
        // was 17 silhouette pixels from the crop — a 7 mm strand is under one
        // pixel wide out there. The hair swept UP off the brow is 2 cm of extra
        // height across the whole width of the head, which is the part of this
        // cut a player can read across an arena.
        [hairLump(s, 0.046 * V.w * (1 - 0.42 * R.thin), 0.032 * (1 - 0.42 * R.thin), 0.030, 8, 5),
          [0.006 * V.w * s, 0.170 * V.h * s, (0.036 - R.back) * s], [0.26, 0.10, -0.10]],
        [hairLump(s, 0.018, 0.026 * V.h, 0.036, 6, 4), [0.060 * V.w * s, 0.108 * s, -0.018 * s], [0, 0, 0.16]],
        [hairLump(s, 0.018, 0.026 * V.h, 0.036, 6, 4), [-0.060 * V.w * s, 0.108 * s, -0.018 * s], [0, 0, -0.16]],
        [hairLump(s, 0.042 * V.w, 0.026, 0.032 * V.d, 7, 4), [0, 0.074 * s, -0.044 * s]],
      ],
    };
    return { parts: [...c.parts,
      // the short queue at the nape a padawan wears with it
      [hairLump(s, 0.020 * V.w, 0.030, 0.020, 6, 4), [0, 0.028 * s, -0.062 * s], [0.30, 0, 0]],
    ], strands: [
      // BEHIND the ear and swept out, not in front of it. Hung at z +0.020 it
      // read as a chopstick laid down the cheek; a padawan's braid roots at the
      // temple BEHIND the ear line and falls outside the jaw, which is also the
      // only place it can hang without entering the shoulder at either end of
      // the ±0.85 rad the player's glance is clamped to.
      // Rolled 0.50 rad OUT so it falls outside the shoulder line. At 0.34 the
      // tip finished on the centre line at z +0.004 — 25 of its 96 vertices
      // inside the ribcage at a head yaw of -0.42 rad, which is the same defect
      // a rigid lek has and is measured the same way.
      { len: 0.205, r0: 0.0072, r1: 0.0036, seg: 6, rings: 7,
        at: [0.066 * V.w, 0.070, -0.016], rot: [-0.16, 0, 0.62] },
    ] };
  },

  /**
   * TOP KNOT — temples taken in tight, everything gathered UP. The knot stands
   * 4 cm above the crown, which is the only cut in the list that makes the
   * figure taller in outline.
   */
  topknot(s, V, R) {
    return { parts: [
      [hairCap(s, V, { gap: R.gap, phi: 0.58, tilt: -0.66, w: 12, h: 9, sx: 0.99, sy: 1.30, sz: 1.14, y: 0.100, wide: R.wide, recede: R.thin })],
      // the pulled-back temples: two long flat masses running from the brow to
      // the crown, which is what stops a knot reading as a bun on a bald head
      [hairLump(s, 0.022, 0.026 * V.h, 0.056, 6, 4), [0.056 * V.w * s, 0.128 * s, (0.020 - R.back * 0.5) * s], [0.10, 0, 0.30]],
      [hairLump(s, 0.022, 0.026 * V.h, 0.056, 6, 4), [-0.056 * V.w * s, 0.128 * s, (0.020 - R.back * 0.5) * s], [0.10, 0, -0.30]],
      // the knot itself, and the wrap under it
      // Measured against the warrior tail's crest at 8 m the knot was 21
      // silhouette pixels away — two cuts with a lump on top. A top knot is
      // GATHERED BACK: the mass belongs behind the crown, where it breaks the
      // outline of the occiput instead of competing with a crest for the same
      // twelve pixels of skyline.
      [hairLump(s, 0.040, 0.044, 0.042, 8, 6), [0, 0.196 * V.h * s, -0.058 * s]],
      [hairLump(s, 0.020, 0.016, 0.022, 6, 4), [0, 0.160 * V.h * s, -0.040 * s]],
      [hairLump(s, 0.044 * V.w, 0.034, 0.038 * V.d, 7, 4), [0, 0.070 * s, -0.052 * s]],
    ], strands: [] };
  },

  /**
   * WARRIOR TAIL — shaved at the sides, a ridge over the crown, a heavy tail
   * off the back of it. The ridge is what makes this read from the front at
   * all; without one it is a bald head with something behind it.
   */
  tail(s, V, R) {
    return { parts: [
      [hairCap(s, V, { gap: R.gap, phi: 0.54, tilt: -0.80, w: 11, h: 8, sx: 0.80, sy: 1.14, sz: 1.22, y: 0.092, wide: R.wide, recede: R.thin })],
      // the crest, running fore-and-aft over the crown: without one this is a
      // bald head with something behind it, which is what the first render was
      // Measured against `shorn` at 8 m the first crest was 19 silhouette
      // pixels — a bald head with something behind it. A crest has to stand
      // PROUD of the skull to be an outline at all, so it is 40 mm tall and it
      // runs the whole length of the crown.
      [hairLump(s, 0.030 * V.w, 0.062, 0.090, 7, 5), [0, 0.176 * V.h * s, (0.002 - R.back * 0.6) * s], [0.12, 0, 0]],
      [hairLump(s, 0.024 * V.w, 0.042, 0.040, 6, 4), [0, 0.208 * V.h * s, -0.030 * s], [0.30, 0, 0]],
      [hairLump(s, 0.048 * V.w, 0.052, 0.048 * V.d, 7, 5), [0, 0.074 * s, -0.058 * s]],
    ], strands: [
      // +0.34, not -0.34: `pos` is (0, -len, 0) through this Euler, so a
      // positive x sends the strand BACK. At -0.34 the tail swung forward
      // under the jaw and finished at z +0.024, which is inside the sternum —
      // measured, 28 of its 88 vertices in the ribcage with the head at rest.
      { len: 0.170, r0: 0.0150, r1: 0.0055, seg: 8, rings: 7,
        at: [0, 0.054, -0.072], rot: [0.62, 0, 0] },
    ] };
  },

  /**
   * LONG — past the shoulders, in two side falls and a back mass.
   *
   * The back mass is the one place a rigid cut can go wrong, and the reason it
   * stops where it does: the hair is parented to the HEAD, the head yaws ±0.85
   * rad under the player's own glance, and a fall that reaches the shoulder
   * blade at rest is inside the trapezius at the ends of that sweep. It is cut
   * to reach dy -0.135 at scale 1 — the base of the neck — and the length past
   * that is carried by the two side falls, which hang OUTSIDE the shoulder line
   * where there is nothing to pass through.
   */
  long(s, V, R) {
    return { parts: [
      [hairCap(s, V, { gap: R.gap, phi: 0.66, tilt: -0.70, w: 14, h: 9, sy: 1.30, sz: 1.26, wide: R.wide, recede: R.thin })],
      [hairLump(s, 0.050 * V.w * (1 - 0.42 * R.thin), 0.024 * (1 - 0.42 * R.thin), 0.030, 7, 5), [0.016 * V.w * s, 0.150 * V.h * s, (0.048 - R.back) * s], [0.34, 0.20, -0.12]],
      // the side falls: flat slabs down the line of the jaw, standing clear of
      // the shoulder because they are 8 cm out from the axis
      [hairLump(s, 0.026, 0.074 * V.h, 0.042, 6, 6), [0.076 * V.w * s, 0.042 * s, 0.000 * s], [0, 0, 0.15]],
      [hairLump(s, 0.026, 0.074 * V.h, 0.042, 6, 6), [-0.076 * V.w * s, 0.042 * s, 0.000 * s], [0, 0, -0.15]],
      // the back mass
      [hairLump(s, 0.070 * V.w, 0.064, 0.054 * V.d, 8, 6), [0, 0.056 * s, -0.050 * s]],
      // The back fall stops at the base of the NECK, and this is where. Measured
      // with the head at rest, a mass centred 20 mm below the head bone reaches
      // 10 vertices into the trapezius; the length past here is carried by the
      // two side falls, which hang outside the shoulder line where there is
      // nothing to pass through.
      [hairLump(s, 0.052 * V.w, 0.038, 0.032, 7, 5), [0, 0.004 * s, -0.062 * s], [0.18, 0, 0]],
    ], strands: [] };
  },

  /**
   * MANE — the long cut with the outline broken open. Wider at the temples,
   * higher over the crown and asymmetric at the shoulders, which is the whole
   * difference between "long hair" and "wild": a symmetric fall reads as a
   * hood.
   */
  mane(s, V, R) {
    const l = HAIR_CUTS.long(s, V, R);
    return { parts: [...l.parts,
      // Wider at the temples, higher over the crown and ASYMMETRIC at the
      // shoulders. Measured against `long` at 8 m the first attempt was 9
      // silhouette pixels apart — two long cuts, not a long one and a wild one
      // — so every mass here is now outside the long cut's own outline rather
      // than inside it.
      [hairLump(s, 0.046, 0.038, 0.042, 6, 4), [0.076 * V.w * s, 0.146 * V.h * s, -0.034 * s], [0, 0, 0.50]],
      [hairLump(s, 0.038, 0.032, 0.036, 6, 4), [-0.082 * V.w * s, 0.132 * V.h * s, -0.042 * s], [0, 0, -0.44]],
      [hairLump(s, 0.036, 0.042, 0.030, 6, 5), [0.098 * V.w * s, 0.002 * s, -0.014 * s], [0.08, 0, 0.36]],
      [hairLump(s, 0.030, 0.038, 0.028, 6, 4), [-0.094 * V.w * s, 0.040 * s, -0.022 * s], [0, 0, -0.30]],
    ], strands: [] };
  },
};

/**
 * THE BEARD, AS ONE SWEPT BAND ALONG THE JAW — not a pile of lumps.
 *
 * The first pass was four ellipsoids and a slab, and the render settled it:
 * two mutton chops, a ball under the chin with a gap of bare skin between them
 * and a black bar floating over the lip. A beard is not read as masses, it is
 * read as ONE SHAPE with a clean edge where it meets the skin — which is
 * exactly what src/toon/REFERENCE.md rule 6 says about drawn marks, and also
 * what a tube is for.
 *
 * So the band is a `tubeGeo` whose nodes are raycast onto the assembled skull
 * from ear to chin to ear, and it is continuous by construction. That fixes
 * three things at once: no seam, a taper that closes at the ears rather than
 * stopping square, and 96 triangles instead of 224.
 *
 * Everything is seated on the SKULL rather than typed against a nominal one,
 * for the reason every other face feature is: the face mass reaches further
 * forward than the cranium at mouth height, so a beard authored against a
 * sphere is half inside the chin at `gaunt` and floating off it at `broad`.
 */
function beardParts(s, hg, B) {
  if (!B.band && !B.chin && !B.moustache) return { parts: [], strands: [] };
  const parts = [], strands = [];
  /**
   * One node of the jaw band. `t` runs -1 (left ear) → 0 (under the chin) →
   * +1 (right ear); the ray sweeps with it and its ORIGIN rises toward the
   * ears, because a mandible is not a circle about one point — the hinge is
   * 4 cm above the chin and 3 cm behind it, and a band probed from a single
   * origin either climbs the cheek at the sides or cuts the throat at the
   * front.
   */
  const jawNode = (t, r) => {
    const th = t * Math.PI * 0.5;
    const c = Math.cos(th), sn = Math.sin(th);
    const d = new THREE.Vector3(sn * 0.95, -0.20 - 0.44 * c, c * 0.90);
    const o = new THREE.Vector3(0, (0.030 + 0.054 * Math.abs(t)) * s, (0.014 - 0.030 * Math.abs(t)) * s);
    const p = onSurface(hg, d, -0.0022 * s, o);
    return [p[0], p[1], p[2], r * s];
  };
  if (B.band > 0 && B.reach > 0) {
    const N = 9, nodes = [];
    for (let i = 0; i < N; i++) {
      const t = (-1 + (2 * i) / (N - 1)) * B.reach;
      // thickest at the jaw corner and thinning to nothing at the ear, which
      // is where a beard's own edge actually runs
      const w = 0.42 + 0.58 * Math.cos(t * Math.PI * 0.5) + 0.30 * (1 - Math.abs(t)) * B.reach;
      nodes.push(jawNode(t, B.band * Math.min(1.25, w)));
    }
    parts.push([tubeGeo(nodes, 6, { tip: 0.35 })]);
  }
  if (B.chin > 0) {
    // The chin, and the fall below it, as one tube straight down off the
    // point of the jaw. The fall is what separates Obi-Wan from Qui-Gon and it
    // is a LENGTH, so it is a node position rather than a scale on a blob.
    const d = new THREE.Vector3(0, -0.58, 0.81);
    const p = onSurface(hg, d, -0.0030 * s, new THREE.Vector3(0, 0.034 * s, 0.012 * s));
    const nodes = [[p[0], p[1] + 0.008 * s, p[2], B.chin * 0.72 * s],
      [p[0], p[1], p[2], B.chin * s]];
    if (B.fall > 0) {
      const steps = B.fall > 0.06 ? 3 : 2;
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        // A beard WIDENS on the way down before it closes — a fall that only
        // tapers is a stalactite, which is what the first render showed.
        /*
         * FORWARD as it falls, not straight down. The chest's own lathe domes
         * to z +0.105 at the shoulder line, which is 145 mm below the chin —
         * so a 155 mm beard hung vertically finishes INSIDE the sternum, and
         * measured at a head yaw of -0.42 rad that is 13 of the beard's 387
         * vertices in the ribcage. A beard lies ON a chest, in front of it.
         */
        /*
         * …AND THE FORWARD TERM IS A SLOPE, NOT A CONSTANT.
         *
         * It was a flat 0.190 m whatever `B.fall` was, so the SHORTER the beard
         * the more horizontal it came out: 'Short beard — trimmed to the jaw'
         * drops 16 mm and travelled 190 mm forward, a 4.8° slope off level.
         * Measured against a bare head, every beard with a fall finished
         * 174–177 mm proud of the NOSE TIP — a tube leaving the chin and ending
         * in a lump of hair hanging in open air level with the mouth. Head bbox
         * depth went 219 mm to 394. It is visible in the creator preview and in
         * every third-person frame.
         *
         * WHAT THE TORSO ACTUALLY REQUIRES, measured rather than assumed.
         *
         * Ray-cast a point hanging at each depth under the chin against the
         * torso soup, at every yaw the glance can reach (±0.85 rad, the clamp
         * the player is held to), and take the forward offset at which it first
         * gets out. It is not a straight chord and it is not a constant:
         *
         *     drop   16   30   40    55    72    78   100   145 mm
         *     needs   0    0    0    64   100   102   130   140 mm
         *
         * Zero for the first 40 mm — that is the pocket under the jaw, and a
         * beard hangs in it — then a steep rise as the fall reaches the
         * trapezius, which is what a turned head swings it into. So the fit is
         * a ramp that starts at the jaw and saturates at the shoulder, with a
         * little margin: `(drop − 38 mm) × 3.8`, capped at 145 mm.
         *
         * Measured stand-off past the NOSE TIP, before and after — the bug was
         * that every beard finished 174-177 mm proud of it, a horizontal tube
         * ending in a lump of hair level with the mouth:
         *
         *     goatee 175 → 7    short 176 → 8    full 176 → 62
         *     plaited 174 → 129    long 177 → 134
         *
         * The two long styles are still a long way out and THAT NUMBER CANNOT
         * BE TUNED AWAY. This is rigid geometry welded to a bone that turns
         * 49°, so it must be authored for the worst yaw or it intersects the
         * trapezius at it — the table above is what the torso demands, and
         * `grooming: nothing a cut or a beard hangs on a head passes through
         * the body` holds it to exactly that. Pulling a long beard back in
         * means giving its fall the treatment the lekku got: a chain whose
         * lower half LAGS the head instead of being welded to it, so it can
         * hang near the chest at rest and still clear the shoulder on a turn.
         * Until then, the honest reading is that a beard past ~55 mm of fall
         * wants Cloth.js, and the short styles — which is what most characters
         * wear — are now correct.
         */
        const drop = B.fall * f;                       // metres below the chin
        /* Evaluated at the tube's SURFACE, not its axis: the beard is a solid
         * of radius `B.chin`, so its lowest hair is a chin-radius further down
         * than the node it hangs from — and it is the hair that intersects. */
        const reach = drop + B.chin;
        nodes.push([p[0], p[1] - drop * s,
          p[2] + Math.min(0.145, Math.max(0, (reach - 0.038) * 3.8)) * s,
          B.chin * (1 + 0.34 * f - 0.72 * f * f * f) * s]);
      }
    }
    parts.push([tubeGeo(nodes, 6, { tip: 0.6 })]);
  }
  if (B.moustache > 0) {
    // A bar across the lip was the loudest thing wrong with the first pass.
    // A moustache follows the mouth's own curve and drops at the CORNERS,
    // which is the whole difference between a moustache and a smudge.
    const N = 5, nodes = [];
    for (let i = 0; i < N; i++) {
      const t = -1 + (2 * i) / (N - 1);
      const d = new THREE.Vector3(t * 0.62, 0.10 - 0.30 * t * t, 0.86);
      const o = new THREE.Vector3(0, (0.048 - 0.006 * t * t) * s, 0.022 * s);
      const p = onSurface(hg, d, -0.0020 * s, o);
      nodes.push([p[0], p[1], p[2], (0.0034 + 0.0044 * B.moustache) * (1 - 0.34 * t * t) * s]);
    }
    parts.push([tubeGeo(nodes, 6, { tip: 0.4 })]);
  }
  for (let i = 0; i < B.plaits; i++) {
    const sx = i === 0 ? 1 : -1;
    // Forward and SHORT. Hung straight down at 0.13 m they reached into the
    // ribcage at a head yaw of -0.85 rad — 65 vertices inside the tabard — and
    // a plait that passes through a chest is the rigid-lek defect on a smaller
    // scale. Swung 0.62 rad forward, the fall clears the collar entirely.
    /*
     * NEGATIVE x, and the sign is the whole bug. `pos` is (0, -len, 0) rotated
     * by this Euler, and a rotation about +X sends a DOWNWARD strand BACKWARD
     * — measured, 35 of a pair of plaits' 96 vertices inside the ribcage at a
     * head yaw of -0.42 rad, with the tips at z +0.033 where the neck is. -0.55
     * swings them forward, over the chest and clear of it.
     */
    /*
     * ROOTED ON THE CHIN and swung forward, not hung below the fall.
     *
     * Two sign-and-place bugs, both measured. `pos` is (0, -len, 0) rotated by
     * this Euler, so a POSITIVE x sends a downward strand BACKWARD — the first
     * pair finished at z +0.033 with 35 of their 96 vertices inside the neck.
     * And hung below a 98 mm fall they reach the chest dome, which tops out at
     * z +0.105 only 145 mm under the chin. Rooted at the chin and swung 0.75
     * rad forward they lie along the front of the beard and touch nothing.
     */
    strands.push({ len: 0.058, r0: 0.0062, r1: 0.0026, seg: 5, rings: 4,
      at: [sx * 0.020, 0.006, 0.052], rot: [-0.75, 0, sx * 0.18] });
  }
  return { parts, strands };
}

/* ── hoods ───────────────────────────────────────────────────────────── */

/**
 * HOODS, WHICH THIS GAME DID NOT HAVE.
 *
 * The player's note, in their own words: *"I want hoods, wearable hoods that
 * go over your head, a few different kinds, they should look really cool"* —
 * and before this there were exactly two hoods in the build, neither of them
 * wearable by a player: the Sentinel's cowl thirty lines below and the
 * acolyte's, and both were an inline sphere segment with a torus on it, typed
 * out twice. `src/game/Cloth.js` names the gap itself, in the long note over
 * WARDROBE: "AND THE ONE THING THIS FILE CANNOT FAKE AT ALL: a HOOD… the
 * machinery is all here but the anchor belongs to whoever owns the head."
 * This is that anchor.
 *
 * ── WHY IT IS RIGID GEOMETRY ON A BONE, AND NOT CLOTH ────────────────────
 *
 * A cape is a sheet pinned along nine points of the shoulders and it may hang
 * wherever gravity sends it. A hood is pinned in a RING around a skull it is
 * never allowed to intersect, and the skull is the one collider on the figure
 * that the cloth solver has no hull for. Simulating one would need a head
 * collider, a closed tube whose top is sewn shut, and a solve every frame for
 * a garment whose whole visible motion is "it stays on the head" — so it is
 * a Kit, merged, one draw call, exactly like the Temple Guard's helm.
 *
 * ── AND WHY IT HANGS OFF THE HEAD BONE AND NOTHING ELSE ──────────────────
 *
 * Enemy.js states the rule for the health bar and it is the same rule here:
 * "Actor.addBone() re-homes exactly the children of a bone object" and
 * `Actor.goRagdoll` re-homes them onto that bone's holder, so anything
 * parented to `rig.root` is orphaned the moment a body falls. A hood on
 * `rig.root` would stay standing in the air over a corpse, and when the neck
 * is cut, `Actor.cut` walks the subtree from the cut bone and hands the head
 * — with every direct child of it — to the DetachedPiece. A hood on the head
 * bone therefore rolls across the floor with the head it was on, for free,
 * and `Player._applyViewMode` hides it in first person for free as well: that
 * function traverses the NECK, which reaches every mesh under the head.
 * Neither behaviour is code below; both are consequences of the parent, which
 * is why the parent is the first thing tools/checks/hoods.mjs measures.
 *
 * ── THE SHELLS ARE LINED, AND THAT IS THE WHOLE LOOK ─────────────────────
 *
 * The two hoods that existed were single-sided sphere segments, so the inside
 * of the cowl was not drawn at all and a face under one sat against whatever
 * was behind the head. What makes a hood read as a hood — in every reference
 * in assets/reference — is that the face is in a DARK RECESS. So each shell
 * carries a second copy of itself at 92-95% of its size with the winding and
 * the normals reversed and its vertex colours knocked down to 0.34-0.46, which
 * is the same channel `shadeAO` uses for every crease on the body. It costs no
 * material, no second draw call and no shader: it is one merged geometry with
 * a dark half. Measured on the Jedi cowl, mean vertex luminance 1.000 outside
 * and 0.420 inside — a full stop and a quarter of drop across the rim.
 *
 * A lining is also what lets the cloth stay SINGLE-SIDED. `THREE.DoubleSide`
 * on an open shell doubles the shadow-map cost of the largest thing on the
 * head and lights its interior with an outward normal, which is why the
 * acolyte's cowl has always looked like a plastic scoop from underneath.
 *
 * ── WHAT IS NOT DONE, AND WHY ────────────────────────────────────────────
 *
 * A hood does not hide the hair under it. The hair CUT and the BEARD are
 * merged into one geometry by `assemble(parts, 'hair')` before either reaches
 * a mesh, so "hide the hair" is currently the same statement as "shave the
 * beard", and splitting that merge to gain it would cost a draw call on every
 * head in the game to fix a topknot. Every shell below clears the hair mass a
 * cut actually presents — measured across the eight styles, x ±0.135 (mane),
 * z -0.122 and y 0.205 (temple/long/mane) in the head bone's own frame — so
 * the only styles that break the surface are `topknot` (0.240) and `tail`
 * (0.248), which are knots ON TOP of the crown. That is a shipped property of
 * the Sentinel's cowl too, not a regression, and a tail hanging out of a hood
 * is what half the references show anyway.
 */

/**
 * FOUR HOODS, AND THE ABSENCE OF ONE.
 *
 * Every field is in the HEAD BONE's own frame and is multiplied by the head's
 * authored scale (`HS` in buildJedi — the head is authored at its own scale so
 * a small-folk figure can be three and a half heads tall rather than a human
 * shrunk). The frame, measured on the shipped human head:
 *
 *     the skull      x ±0.075   y -0.034 … 0.197   z -0.118 … 0.101
 *     the hair mass  x ±0.135   y  0.205 max       z -0.122
 *     the shoulder   y -0.100                    (clavicle 0.475, head 0.575)
 *
 * so a shell has to reach past 0.135 across, past 0.205 up and past -0.122
 * back to cover a head with hair on it, and a fall that stops at y -0.100 is
 * resting on the shoulder rather than through it.
 *
 * `shell` is a sphere SEGMENT and its opening has to land on the face. Three
 * puts phi = 0 at -X and phi = π/2 at +Z, so a shell of angular length L is
 * centred on +Z when it starts at `1.5π - L/2` — which is where the shipped
 * cowl's 0.80π comes from, and it is computed below rather than typed so a cut
 * cannot be authored with its opening over one ear.
 *
 * The four are chosen so that NO TWO CHANGE THE SAME PART OF THE OUTLINE,
 * which is the same rule JEDI_RANKS is built on and the reason the roster's
 * four Jedi stopped measuring 0.939 against each other:
 *
 *   cowl    round, open, soft — seven broad gathers, a flare onto the
 *           shoulders and a drape at the nape. The Sentinel wears it.
 *   sith    tight to the skull, a 68° slot instead of a 108° opening, a
 *           standing collar OUTSIDE the shell and a peak over the crown.
 *   wrap    not a cowl at all — a closed cap on the brow under a cord, with
 *           two falls down the sides of the face and a flared nape drape.
 *           The only one of the four with cloth beside the jaw.
 *   cloak   the biggest thing anyone wears on a head here: 48.3 cm front to
 *           back against the Jedi cowl's 35.1 and a bare skull's 21.9, with a
 *           heavy rolled rim, a peak gathered at the back and a drape across
 *           the shoulders.
 */
export const HOOD_CUTS = [
  {
    id: 'none', name: 'No hood',
    blurb: 'Hood down. Nothing over the head at all — which is what every Jedi in this game wore until now.',
    none: true,
  },
  {
    id: 'cowl', name: 'Jedi Cowl',
    /* WHERE THIS ROW CAME FROM. It began as the inline cowl that used to live
     * in `headKit` below, copied out to the millimetre so that
     * `JEDI_RANKS.sentinel` could name a wardrobe cut instead of carrying its
     * own copy of the geometry. It has since been rebuilt as cloth (see
     * below), which moves the Sentinel with it — deliberately, and the rank
     * still wears exactly what the wardrobe hands a player, which is the
     * property hoods.mjs pins at 100.0% identical outline. */
    blurb: 'The order\'s own: deep, round, and open enough that your face is still a face inside it.',
    /* ── AND IT IS NO LONGER A SHELL AND A RIM ─────────────────────────
     *
     * "The hoods don't really look like hoods and act as cloth — more like
     * putting on a solid capsule or astronaut helmet. I'm not choosing helmets
     * here."
     *
     * Fair, and the table said why: this cut declared a `shell` and a `rim`
     * and nothing else, so the most-worn hood in the game was a scaled sphere
     * segment with a torus at its mouth. A smooth ellipsoid that hugs the
     * skull IS a helmet — that is what a helmet is — and no amount of cloth
     * colour changes it. The assembler has carried `folds`, `peak`, `nape` and
     * `falls` the whole time and this row asked for none of them.
     *
     * WHAT DID NOT WORK, because five rounds of it were rendered and looked
     * at: laying `folds`, a `peak` and `falls` on top of the shell. Those are
     * straight limbs and flat plates over a curved surface, so at a radius
     * that clears the cloth they stand off it in open air — five tapered
     * spikes, a dorsal fin and two boards by the cheeks — and at a radius that
     * touches it they are swallowed within three centimetres and the dome
     * comes back exactly as smooth as before. There is no radius in between.
     *
     * What works is changing the SHELL, because the shell is the silhouette:
     *
     *   facet   flat-shaded, so it is panels meeting at creases instead of a
     *           polished revolve. The single biggest change of the four.
     *   flute   seven gathers modulating the vertex radius — ridges that are
     *           part of the surface and therefore stay on it at every height
     *           and from behind, which is the view a hood cannot hide in.
     *   taper   wider at the hem than at the crown. A sphere is neither.
     *   lean    the crown pushed back, because the cloth is anchored at the
     *           shoulders and the head has walked forward out of it.
     *
     * plus the `nape` drape, which is what stops it at the shoulders rather
     * than at the jaw. Measured after: 80.0% of the cranium under cloth, 0.0%
     * of the eye band, and 83.0% outline agreement with its nearest neighbour
     * against a 85% bar.
     */
    facet: true,
    shell: { r: 0.153, w: 28, h: 10, open: 0.60, crown: 0.34, theta: 0.80,
             sx: 0.93, sy: 1.05, sz: 1.10, taper: 0.13, lean: 0.044,
             flute: 7, fluteAmp: 0.270,
             y: 0.042, z: -0.020, line: 0.93, dark: 0.42 },
    rim: { r: 0.114, tube: 0.020, seg: 5, ring: 12, y: 0.086, z: 0.024, tilt: -0.34 },
    /* AND IT FALLS ONTO THE SHOULDERS. A hood that stops at the jaw line is a
     * cap. `r0` is the BOTTOM of an arcGeo and `r1` the top (see its cross
     * section: `corner[k][1]` is the height fraction and the radius lerps on
     * it), so cloth that flares as it hangs is r0 > r1 — the cloak's drape
     * has read that way the whole time and the first cut of this one had the
     * two the wrong way round, which is a funnel gripping the neck. */
    nape: { r0: 0.152, r1: 0.134, h: 0.098, arc: 2.4, thick: 0.018, seg: 9, y: -0.148 },
    /* AND THE CLOTH BELOW IT MOVES. See `attachHoodDrape` in Cloth.js: the
     * rigid `nape` above is the hood's stiff rolled hem, and this is the loose
     * fall hanging off it — a simulated sheet pinned in an arc round the back
     * of the head bone, which swings when you turn and settles on the
     * shoulders when you stop. `arc` and `r` place its pin ring at the hem the
     * shell actually ends on, so the two read as one garment. */
    drape: { r: 0.150, y: -0.150, arc: 2.5, length: 0.115, cols: 9, rows: 5 },
  },
  {
    id: 'sith', name: 'Sith Cowl',
    blurb: 'Tight to the skull, a slot for a face, and a collar standing at the nape. Nothing of you shows.',
    /* The opening is 0.38π — 68°, against the Jedi cowl's 108° — and the shell
     * runs 0.84π of theta, which is 151° from the crown and puts its bottom
     * edge level with the shoulder. Narrow AND long: this is the only cut
     * whose cloth reaches the collarbone at the sides.
     *
     * It takes the same four moves as the Jedi cowl and takes them the other
     * way, which is what keeps the two apart: FINELY fluted (8 narrow gathers
     * against the cowl's 7 broad ones), barely tapered and barely leaning, so
     * it stays tight to the skull and reads as cloth stretched over a head
     * rather than cloth hanging off one. The base scales come down as the
     * gathers go on, because a flute only ever pushes OUT. */
    facet: true,
    /* r 0.138 → 0.146: the rebuilt skull (V12 — one displaced surface rather
     * than twelve overlapping ellipsoids) carries a fuller vault than the
     * ball-cluster it replaced, and the tightest hood in the set is the one
     * that finds that out. Measured, the cowl left 25% of the cranium bare;
     * `hoods.mjs` holds every cut to covering 78% of it. */
    shell: { r: 0.146, w: 26, h: 11, open: 0.38, crown: 0.34, theta: 0.84,
             sx: 0.98, sy: 1.21, sz: 1.07, taper: 0.07, lean: 0.022,
             flute: 8, fluteAmp: 0.150,
             y: 0.042, z: -0.030, line: 0.94, dark: 0.34 },
    /* A collar is only a collar if it stands OUTSIDE the thing it collars, and
     * the shell grew gathers under it, so the radii went up with them: an arc
     * buried in the cloth it is supposed to be a second layer of is the same
     * mistake the acolyte's plastron was measured making against its mantle.
     *
     * AN ARC AND NOT A CLOSED BAND, which the first cut of it was. A full
     * revolution at this radius passes 60 mm in FRONT of the chin: a ring
     * across the mouth of the one hood whose whole point is that a slot of
     * face shows through it.
     *
     * AND 2.7 RAD AND NOT 4.2. The wide arc left its two square end faces 60
     * degrees off the face — on the cheekbone, where from the front they read
     * as a pair of flat boards bolted to the jaw. 2.7 puts them a full 100
     * degrees round, behind the ear line where a standing collar is actually
     * seamed, and the band drops 18 mm so its top edge stops crossing the
     * cheek at all. */
    collar: { r0: 0.138, r1: 0.156, h: 0.092, arc: 2.7, thick: 0.024, seg: 12,
              y: -0.074, squash: 0.94 },
    /* The gathered point, and it is a POINT now. At 0.155 tall standing off a
     * smooth shell it was a dorsal fin — the single thing that made this cut
     * read as a helmet with a crest rather than as a hood. Half the height,
     * laid back along the crown, and the gathers in the shell carry the rest. */
    peak: { w: 0.044, h: 0.086, d: 0.050, r: 0.012, y: 0.168, z: -0.118, tilt: 0.86 },
  },
  {
    id: 'wrap', name: 'Desert Wrap',
    blurb: 'A cloth cap bound with a cord, two falls beside the face and a drape down the nape. For a sun you fight under.',
    /* NOT A COWL. `open: 0` makes the shell a closed cap — a full revolution —
     * and `theta: 0.42` stops it at 75.6° from the crown, which lands its
     * bottom edge at y 0.097: on the brow ridge (0.099-0.107), a centimetre
     * above the eyes. A keffiyeh covers the forehead and nothing else of the
     * face, and that one number is the whole difference between this and a
     * diving helmet — measured at 0.44 it reached y 0.087 and took 9.8% of the
     * eye band with it, which is the check below going red for a hood you
     * could not see out of. */
    shell: { r: 0.134, w: 16, h: 10, open: 0, theta: 0.42,
             sx: 1.06, sy: 1.17, sz: 1.14, y: 0.058, z: -0.010, line: 0.95, dark: 0.46 },
    /* The agal. It sits at y 0.126 where the cap's own half-width is 0.128, so
     * a ring at 0.136 stands 8 mm proud of the cloth it is binding.
     *
     * `tilt` is π/2 and not a few hundredths, and that is the difference
     * between a cord bound round a head and a halo standing over it:
     * THREE.TorusGeometry is authored in the XY PLANE, so an untilted one is a
     * ring you look THROUGH along Z. The face rims below want exactly that and
     * leave `tilt` near zero; a headband has to be laid flat. Measured before
     * the quarter turn went in, this cut stood 0.274 above the head bone
     * against a cap that tops out at 0.215 — six centimetres of cord in the
     * air over the crown. */
    cord: { r: 0.136, tube: 0.0125, seg: 4, ring: 16, y: 0.126, z: -0.008, tilt: 1.49 },
    falls: { w: 0.058, h: 0.235, d: 0.032, r: 0.014, x: 0.112, y: -0.014, z: -0.014,
             pitch: 0.06, yaw: 0.20, roll: 0.09 },
    nape: { r0: 0.150, r1: 0.132, h: 0.230, arc: 2.7, thick: 0.016, seg: 8, y: -0.128 },
    // a keffiyeh's tail: narrow, and it hangs the longest of the four
    drape: { r: 0.148, y: -0.130, arc: 2.4, length: 0.215, cols: 9, rows: 7 },
  },
  {
    id: 'cloak', name: 'Cloak Hood',
    blurb: 'The travelling hood: heavy, deep, gathered at the back and falling across the shoulders. You are a shape in it.',
    /* The largest thing on any head in this game: 48.3 cm front to back
     * against the Jedi cowl's 35.1 — the face sits well back inside the
     * opening instead of filling it, which is the entire reason a travelling
     * hood reads as ominous and a Jedi cowl does not. Same four moves as the
     * other two shells and the heaviest settings of the three: six wide
     * gathers, the deepest taper and the strongest lean, because this is the
     * one cut that is supposed to look like a weight of cloth. */
    facet: true,
    shell: { r: 0.170, w: 26, h: 11, open: 0.66, crown: 0.34, theta: 0.68,
             sx: 0.99, sy: 1.08, sz: 1.24, taper: 0.16, lean: 0.058,
             flute: 6, fluteAmp: 0.260,
             y: 0.052, z: -0.052, line: 0.92, dark: 0.30 },
    rim: { r: 0.140, tube: 0.027, seg: 6, ring: 18, y: 0.082, z: 0.034, tilt: -0.42 },
    /* The point of the hood, folded back rather than standing up. A +Y limb
     * rotated by a NEGATIVE angle about X goes back (0, cos a, sin a), so the
     * tip lands at y 0.096 and z -0.280 — against the shell's own back wall at
     * -0.273, which is where a gathered fold belongs. Positive was tried and
     * put the fold out through the face. */
    peak: { len: 0.165, r0: 0.056, r1: 0.014, seg: 6, y: 0.165, z: -0.130, tilt: -2.0 },
    nape: { r0: 0.176, r1: 0.158, h: 0.150, arc: 2.9, thick: 0.020, seg: 9, y: -0.120 },
    // the heaviest fall of the four, because this is the heaviest hood
    drape: { r: 0.172, y: -0.122, arc: 2.9, length: 0.170, cols: 11, rows: 6 },
  },
];

const HOOD_BY_ID = new Map(HOOD_CUTS.map((h) => [h.id, h]));
/**
 * The hood cut with this id, or null. Same contract as `robeCut`, `capeCut`
 * and `sashCut` in Cloth.js: an id nothing recognises is a null and never a
 * plausible default, because a wardrobe that answers an unknown id with the
 * shipped piece is HANDOFF §2.3's missing-thing-answered-with-a-default.
 */
export function hoodCut(id) { return HOOD_BY_ID.get(id) || null; }

/**
 * A copy of an open shell turned inside out: reversed winding, flipped
 * normals, and its vertex colours knocked down to `dark`.
 *
 * Scaled about the GEOMETRY's own origin, which is why every shell above is
 * authored centred on zero and placed by the Kit rather than translated into
 * position first — a lining shrunk toward the head bone's origin instead of
 * toward the shell's centre pulls away from the rim at the top and punches
 * through it at the bottom.
 */
function liningGeo(g, k, dark) {
  const l = g.clone();
  l.scale(k, k, k);
  const n = l.attributes.normal;
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  const idx = l.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, a);
  }
  white(l);
  const c = l.attributes.color;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, dark, dark, dark);
  return l;
}

/**
 * FLAT-SHADE A GEOMETRY — split its vertices and give every triangle the one
 * normal of its own plane.
 *
 * This is the difference between a hood and a helmet, and it is not a small
 * one. A sphere segment with smooth normals is a polished shell no matter how
 * coarse it is; the same segment shaded flat is a run of panels meeting at
 * hard creases, which is what cloth pulled over a head does. Four limbs laid
 * on top of a smooth ellipsoid do not change that read — measured, they came
 * back as nubs on an egg — because the eye takes the silhouette and the
 * highlight, and a smooth revolve gives it one of each.
 *
 * Costs vertices (nothing is shared any more) but not draw calls: the Kit
 * merges the result into the same single bucket as everything else on the
 * head, which is the budget hoods are held to.
 */
function facet(g) {
  const f = g.index ? g.toNonIndexed() : g;
  f.computeVertexNormals();
  return f;
}

/** The sphere segment of a shell, centred on the origin and on the face. */
/** How much air a hood leaves round a head, in metres at scale 1. */
const HOOD_GAP = 0.012;

/** How many height bands the skull is measured in. See `headProfile`. */
const HOOD_BANDS = 16;
/** …and how many bearings. A hood is leaned and fluted, so it is not round. */
const HOOD_AZ = 24;

/**
 * HOW WIDE THE HEAD IS AT EVERY HEIGHT — not how wide it is at its widest.
 *
 * The first version of this returned one number, the skull's greatest radius,
 * and widened the shell by the ratio. It did not work and `hood.mjs` proved it
 * did not: every species still pushed through, 6 mm to 70 mm. The reason is
 * that a head and a hood are different shapes. The skull is widest at the
 * temples, most of the way up; the shell is widest at the hem, which flares
 * out below the jaw. Matching one maximum to the other compares two places
 * that are nowhere near each other, and leaves the cloth narrower than the
 * skull exactly where the skull is widest.
 *
 * So the head is reduced to a PROFILE — its greatest radius in each of
 * `HOOD_BANDS` slices up its own height — and the shell is pushed out band by
 * band. Measured off whatever is parented to the head bone, so montrals, a
 * snout or a crown of horns are all just head, and a species nobody has built
 * yet is handled on the day it is added rather than added to a table.
 */
function headProfile(headObj, yLo, yHi) {
  let lo = Infinity, hi = -Infinity;
  const pts = [];
  const p = new THREE.Vector3();
  headObj.traverse((o) => {
    if (!o.isMesh || o.userData.hood) return;
    const pos = o.geometry?.attributes?.position;
    if (!pos) return;
    o.updateMatrix();
    /* Sampled rather than walked: this runs once per body built, and the
     * widest point of a skull is not a needle a stride of a few can miss. */
    const step = Math.max(1, Math.floor(pos.count / 700));
    for (let i = 0; i < pos.count; i += step) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrix);
      /**
       * ONLY WHERE THE SHELL IS, and this is the clause that made the fit work
       * on the three species it was written for.
       *
       * Binned over the whole head, `span` is set by whatever hangs off it —
       * a Twi'lek's lekku and a Nautolan's tentacles run all the way down the
       * back, and a Togruta's montrals stand well above the crown. That put
       * the entire skull inside two or three of sixteen bands and left the fit
       * with almost no resolution exactly where it needed the most, which is
       * why `hood.mjs` kept naming those three and nobody else.
       *
       * Points above the crown clamp into the top band rather than being
       * dropped: a montral that starts inside the hood and leaves through the
       * top still has to push the cloth out on its way.
       */
      if (p.y < yLo) continue;
      const y = Math.min(p.y, yHi);
      pts.push(p.x, y, p.z);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  });
  if (!pts.length || !(hi > lo)) return null;
  const span = hi - lo;
  /**
   * A GRID, NOT A CURVE. The second version of this measured one radius per
   * height and still let every species through, because a hood is not round:
   * `lean` pushes the whole shell back over the nape and `flute` gathers it
   * into folds, so at one height the cloth can be 30 mm from the axis at the
   * back and 60 at the side. Fitting a round skull to that clears the wide
   * bearings and cuts through the narrow ones, which is what the check kept
   * reporting.
   */
  const r = new Float64Array(HOOD_AZ * HOOD_BANDS);
  const cellOf = (x, z, y) => {
    const a = ((Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * HOOD_AZ) % HOOD_AZ) + HOOD_AZ) % HOOD_AZ;
    const b = Math.min(HOOD_BANDS - 1, Math.max(0, Math.floor(((y - lo) / span) * HOOD_BANDS)));
    return a * HOOD_BANDS + b;
  };
  for (let i = 0; i < pts.length; i += 3) {
    const c = cellOf(pts[i], pts[i + 2], pts[i + 1]);
    const d = Math.hypot(pts[i], pts[i + 2]);
    if (d > r[c]) r[c] = d;
  }
  /**
   * Then every cell takes the widest of itself and its neighbours, in both
   * axes and wrapping in bearing. Two reasons, and the second is why the
   * height pass is one-sided:
   *
   *   The skull is SAMPLED, so a cell can be empty or short by luck, and cloth
   *   fitted to a lucky cell cuts through the vertex the sample missed.
   *
   *   Cloth that clears the temples has to clear them on the way past. A
   *   narrow band under a wide one lets the shell pinch in below the widest
   *   part, which is a hood that fits until the head moves.
   */
  const g2 = new Float64Array(r.length);
  for (let a = 0; a < HOOD_AZ; a++) {
    for (let b = 0; b < HOOD_BANDS; b++) {
      let m = 0;
      for (let da = -1; da <= 1; da++) {
        const aa = ((a + da) % HOOD_AZ + HOOD_AZ) % HOOD_AZ;
        for (let db = -1; db <= 1; db++) {
          const bb = Math.min(HOOD_BANDS - 1, Math.max(0, b + db));
          const v = r[aa * HOOD_BANDS + bb];
          if (v > m) m = v;
        }
      }
      g2[a * HOOD_BANDS + b] = m;
    }
  }
  for (let a = 0; a < HOOD_AZ; a++) {
    for (let b = HOOD_BANDS - 2; b >= 0; b--) {
      const i2 = a * HOOD_BANDS + b;
      g2[i2] = Math.max(g2[i2], g2[i2 + 1] * 0.92);
    }
  }
  return { r: g2, lo, span, cellOf };
}

/**
 * Push a hood shell out until it lies outside the head it is worn on.
 *
 * `g` is in SHELL space and the profile is in HEAD space, which differ by the
 * offset the Kit places the shell at — so the vertex is lifted into head space
 * to be measured and the correction is applied back in shell space. Widening
 * only: a shell already clear of the skull is left exactly as its cut authored
 * it, which is what keeps ten different hood cuts ten different shapes.
 */
function fitHoodToHead(g, prof, oy, oz, gap) {
  if (!prof) return;
  const p = g.attributes.position;
  const yTop = prof.lo + prof.span;
  let moved = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) + oy, z = p.getZ(i) + oz;
    /**
     * ABOVE THE CROWN THERE IS NOTHING TO CLEAR, and this guard is what makes
     * the cap over the cranium survivable.
     *
     * `cellOf` CLAMPS a height above the head into the top band, and the band
     * pass propagates the widest radius upward (0.92 of the band below), so a
     * vertex sitting over the crown is told it must stand 6 cm off an axis it
     * is 2 mm from — a scale of thirty, applied to its height as well, because
     * the push is radial. On a shell with a closed cap that is a metre-tall
     * spike out of the top of the hood: measured, the Sith cowl's own geometry
     * ran to y 1.280 in a frame whose head tops out at 0.195.
     *
     * The fit is a HORIZONTAL clearance and it is only a claim about heights
     * the head actually occupies. Over the crown the shell is clear by height
     * and is left exactly where its cut put it.
     */
    if (y >= yTop) continue;
    const need = prof.r[prof.cellOf(x, z, y)] + gap;
    const r = Math.hypot(x, z);
    if (r >= need || r < 1e-6) continue;
    /* …and even under the crown the correction is bounded. A vertex close to
     * the axis takes an unbounded scale from the same arithmetic, and one
     * vertex flung out of a smooth shell is a spike whatever height it is at.
     * Nothing legitimate needs to double. */
    const k = Math.min(need / r, 2);
    /**
     * RADIALLY FROM THE HEAD'S CORE, AND NOT SIDEWAYS. This one line was the
     * whole of "a hood you can see the head through".
     *
     * The first version moved the vertex out in x and z at CONSTANT y, which
     * is the obvious reading of "push the shell out until it clears the
     * skull" and is wrong in a way nothing about the shell says. From a point
     * inside the head, moving a vertex outward while holding its height
     * FLATTENS the direction it lies in: every point of the shell slides down
     * in angle, the cap over the crown thins, and the skull comes out through
     * the top of its own hood. Measured against `hoods.mjs`'s ray test, the
     * cowl fell from 80.0% of the cranium covered to 68.8 and the Sith hood
     * from 83.8 to 52.5 — a third of the head bare, on the two most-worn cuts
     * in the game, from a change whose entire subject was making hoods fit.
     *
     * It was not the air gap: at a gap of zero the same two read 71.3 and
     * 60.0, because the flattening happens whenever a vertex moves at all. And
     * it was not the 24x16 grid being read cell-by-cell — interpolating it
     * bilinearly changed the four numbers by nothing.
     *
     * Scaling y about the profile's middle by the same factor makes the push a
     * true radial one, so the angle a vertex lies in is what it was and the
     * cover is what the cut authored. 78.8 / 78.8 / 100.0 / 81.3, all four
     * over the bar, with the cloth still held off the skull — which is what
     * the fit was for.
     */
    const cy = prof.lo + prof.span * 0.5;
    p.setXYZ(i, x * k, (cy + (y - cy) * k) - oy, z * k - oz);
    moved++;
  }
  if (moved) { p.needsUpdate = true; g.computeVertexNormals(); }
}

function hoodShell(S, s) {
  const len = Math.PI * (2 - S.open);
  /**
   * AND THE OPENING STARTS AT THE BROW, NOT AT THE POLE — which is `crown`,
   * and it is the whole of "a hood you can see the head through" the second
   * time that sentence was true.
   *
   * A sphere segment's phi opening runs the WHOLE length of the segment, so a
   * 68° slot for the face is also a 68° slot over the top of the skull, and
   * everything the wedge crosses on its way up is bare. Nothing showed it
   * while the cut was tuned because the head it was tuned on was twelve
   * overlapping ellipsoids with a lower, flatter crown; the V12 head is one
   * displaced surface that reaches 0.195 in the bone's own frame, and it came
   * straight up through the slot. Measured on the shipped Sith cowl: 75.0% of
   * the cranium covered against a bar of 78, with every uncovered vertex in a
   * 5 cm disc at the very top and a ray fired straight up out of the braincase
   * hitting NOTHING at all.
   *
   * So the shell is built as a FULL revolution and the wedge is cut out of it
   * below `crown` — a fraction of π down from the pole. What is left is a
   * closed cap over the cranium continuous with an open cowl below it, in one
   * geometry, so `taper`, `lean` and `flute` still shape the whole of it and
   * the cut costs the triangles it always did minus the ones it removes.
   * `crown: 0` (or absent) is the old behaviour exactly.
   */
  const crown = S.open > 0 ? (S.crown || 0) : 0;
  const g = crown > 0
    ? new THREE.SphereGeometry(S.r * s, S.w, S.h, 0, Math.PI * 2, 0, Math.PI * S.theta)
    // centred on +Z: three puts phi = 0 at -X, so a run of `len` is centred on
    // the face when it begins at 1.5π - len/2. Typed, this is the 0.80π that
    // both shipped cowls carry and neither explains in the same words.
    : new THREE.SphereGeometry(S.r * s, S.w, S.h,
      S.open > 0 ? 1.5 * Math.PI - len / 2 : 0, S.open > 0 ? len : Math.PI * 2,
      0, Math.PI * S.theta);
  if (crown > 0) {
    /* The wedge, by the two angles that define it and no convention: how far
     * a face lies from the pole, and how far its bearing lies from +Z. Read
     * off the triangle's own centroid, so a triangle straddling either edge
     * stays — a hole is worse than a millimetre of extra cloth. */
    const p = g.attributes.position, idx = g.index;
    const half = Math.PI * S.open / 2, capAt = Math.PI * crown;
    const keep = [];
    for (let i = 0; i < idx.count; i += 3) {
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < 3; j++) {
        const k2 = idx.getX(i + j);
        cx += p.getX(k2); cy += p.getY(k2); cz += p.getZ(k2);
      }
      cx /= 3; cy /= 3; cz /= 3;
      const r = Math.hypot(cx, cy, cz) || 1;
      const down = Math.acos(Math.max(-1, Math.min(1, cy / r)));   // 0 at the pole
      const off = Math.abs(Math.atan2(cx, cz));                    // 0 on the face
      if (down > capAt && off < half) continue;
      keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    }
    g.setIndex(keep);
  }
  g.scale(S.sx, S.sy, S.sz);
  /* AND THEN IT STOPS BEING A SPHERE, which is the whole complaint.
   *
   * `sx/sy/sz` can only make an ellipsoid, and an ellipsoid over a head is a
   * helmet — the sphere was measured with five folds, a seam and a drape on it
   * and still came back a polished egg, because none of those change the
   * outline and the outline was a circle. Cloth pulled over a head is none of
   * the things a sphere is: it is WIDER at the bottom than at the crown, where
   * it hangs away from the jaw, and it LEANS BACK, because it is anchored at
   * the shoulders and the head has walked forward out of it.
   *
   * `taper` is how much wider the bottom edge is than the crown, `lean` how
   * far back the crown is pushed in metres, both applied on the vertex after
   * the scale. Absent, the shell is exactly the ellipsoid it always was.
   */
  if (S.taper || S.lean || S.flute) {
    const p = g.attributes.position;
    // over the shell's OWN y span, which is not the sphere's: `theta` stops the
    // segment part-way down, so `r * sy` is the crown and the bottom edge is
    // wherever that cut lands. Normalising on the radius instead put the widest
    // part 58% past the bottom edge and made a lampshade the shoulders were
    // inside of.
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < lo) lo = y; if (y > hi) hi = y; }
    const span = Math.max(1e-4, hi - lo);
    /* AND `flute` IS THE GATHER, which is the piece four rounds of laying
     * tapered rolls on top of the shell could not buy.
     *
     * A roll is a straight limb and the shell is curved, so a roll long enough
     * to read dives inside the cloth within three centimetres of its base —
     * measured five times, at five radii, and the dome came back smooth every
     * time. A flute is not laid on the surface, it IS the surface: the vertex
     * radius is modulated by `cos(n·phi)`, so the shell gains `n` ridges that
     * run its whole length, stay exactly on it at every height, and hold up
     * from behind, which is the one view a hood cannot hide in.
     *
     * Phase-locked to the back (`phi - PI`) so a ridge lands on the centre
     * seam rather than a valley, and the amplitude eases off over the last
     * fifth toward the hem, because cloth gathered at the crown opens out as
     * it falls.
     *
     * IT ONLY EVER PUSHES OUT. A gather is slack cloth standing off the head,
     * so the term is `(1 + cos)/2` and not `cos`: a signed ripple pulls the
     * valleys INSIDE the base radius, and the base radius is what clears the
     * skull. Measured signed at amplitude 0.135, the cowl left 23.8% of the
     * cranium bare through its own troughs — a hood you can see the head
     * through, which is the check hoods.mjs opens with.
     */
    const fn = S.flute || 0, fa = S.fluteAmp || 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), t = (hi - y) / span;      // 0 at the crown, 1 at the hem
      let w = 1 + (S.taper || 0) * t;
      if (fn) w *= 1 + fa * 0.5 * (1 + Math.cos(fn * (Math.atan2(p.getX(i), p.getZ(i)) - Math.PI)))
                       * (1 - 0.55 * clamp((t - 0.8) / 0.2, 0, 1));
      p.setXYZ(i, p.getX(i) * w, y, p.getZ(i) * w - (S.lean || 0) * s * (1 - t));
    }
    g.computeVertexNormals();
  }
  return g;
}

/**
 * PUT A HOOD ON A HEAD — the only function in the game that builds one.
 *
 * `headObj` is the head BONE's object (see the note at the top of this
 * section), `mat` the cloth it is cut from, `s` the head's authored scale and
 * `id` a row of HOOD_CUTS. Idempotent: whatever hood is already on this head
 * comes off first, geometry disposed, so the wardrobe seam in ui/Menu.js can
 * call it on every change without leaking a merged shell per pick.
 *
 * Returns the one mesh it made, or null for `none` and for an unknown id.
 * ONE mesh: every piece goes through a single Kit bucket, so a hood with a
 * shell, a lining, a rim, a peak, three gathered folds and a nape drape in it
 * is one merged geometry and one draw call — which is the budget stated in
 * tools/checks/hoods.mjs and enforced there.
 */
export function hoodOn(headObj, mat, s, id) {
  if (!headObj) return null;
  for (let i = headObj.children.length - 1; i >= 0; i--) {
    const c = headObj.children[i];
    if (c.isMesh && c.userData.hood) { headObj.remove(c); c.geometry.dispose(); }
  }
  const H = hoodCut(id);
  if (!H || H.none) return null;
  const k = new Kit();

  if (H.shell) {
    const S = H.shell;
    let g = hoodShell(S, s);
    /**
     * AND IT IS SIZED OFF THE HEAD THAT IS ACTUALLY IN IT.
     *
     * "also the person's head like on certain races clip out of the hoods as
     * well." The shell's radius is a constant per cut, scaled by one number,
     * and that number is the BODY's — so every cut was fitted to whichever
     * head happened to be in the room when it was tuned. A Kel Dor's mask, a
     * Togruta's montrals, a Zabrak's crown and a Trandoshan's snout are not
     * that head, and each of them pushed through a shell built for it.
     *
     * The fix is not a table of per-species radii, which is a list somebody
     * has to extend on the day a species is added and will not. It is to ask
     * the head. Everything already parented to `headObj` is the head — the
     * skull, the face, the horns, whatever the species hung there — so its
     * bounding sphere in head space is the thing the hood has to clear, and
     * the shell is widened until it does, never narrowed.
     */
    /* The shell's own y span, in head space, is what the head is measured
     * over — see `headProfile`. */
    g.computeBoundingBox();
    const gb = g.boundingBox;
    fitHoodToHead(g, headProfile(headObj, gb.min.y + S.y * s, gb.max.y + S.y * s),
      S.y * s, S.z * s, HOOD_GAP * s);
    // The lining is taken off the SMOOTH shell, before any faceting: it is
    // the inside surface, nobody sees its silhouette, and `liningGeo` reverses
    // winding through the index buffer that faceting throws away.
    if (S.line) k.add(mat, liningGeo(g, S.line, S.dark ?? 0.42), [0, S.y * s, S.z * s]);
    k.add(mat, g, [0, S.y * s, S.z * s]);
  }
  // The rolled edge of the opening — what stops a shell reading as something
  // you could see the inside of. It is also the piece that hides the seam
  // where the shell and its lining both end.
  if (H.rim) {
    const R = H.rim;
    k.add(mat, new THREE.TorusGeometry(R.r * s, R.tube * s, R.seg, R.ring),
      [0, R.y * s, R.z * s], [R.tilt, 0, 0]);
  }
  if (H.cord) {
    const C = H.cord;
    k.add(mat, new THREE.TorusGeometry(C.r * s, C.tube * s, C.seg, C.ring),
      [0, C.y * s, C.z * s], [C.tilt, 0, 0]);
  }
  if (H.peak) {
    const P = H.peak;
    // two shapes of peak: a slab standing off the crown (the Sith cowl's
    // point) and a tapered limb folded back down it (the cloak's gathered
    // fold). Which one a cut wants is which fields it declares.
    if (P.len != null) {
      k.add(mat, limbGeo(P.len * s, P.r0 * s, P.r1 * s, P.seg, true,
        { rings: 3, bulge: 0.24, bulgeAt: 0.35, capN: 2 }),
        [0, P.y * s, P.z * s], [P.tilt, 0, 0]);
    } else {
      k.add(mat, plateGeo(P.w * s, P.h * s, P.d * s, P.r * s, 1),
        [0, P.y * s, P.z * s], [P.tilt, 0, 0]);
    }
  }
  if (H.collar) {
    const C = H.collar;
    const g = arcGeo(C.r0 * s, C.r1 * s, C.h * s, C.arc, C.thick * s, C.seg);
    g.rotateY(Math.PI);                       // the opening goes at the throat
    k.add(mat, g, [0, C.y * s, 0], null, [1, 1, C.squash]);
  }
  // Gathered rolls where the cloth bunches at the nape. Same construction as
  // the acolyte's, which is the one thing on that head that stops its cowl
  // reading as a moulded plastic shell.
  if (H.folds) {
    const F = H.folds;
    /* `ax`/`az` STRETCH THE RING THE FOLDS SIT ON, and a cut wants them the
     * moment its shell is not round in plan. `at` alone lays the folds on a
     * CIRCLE; a shell with sx 1.08 and sz 1.22 is an ellipse 1.7 cm wider
     * front-to-back than side-to-side, so one radius either buries the folds
     * at the back or floats them at the sides — the cowl was measured doing
     * both at once. Default 1, so every cut authored before this reads
     * exactly as it did. */
    const ax = F.ax ?? 1, az = F.az ?? 1, fz = (F.z ?? 0) * s;
    k.row(F.n, (i, t) => {
      const a = (t - 0.5) * F.spread + Math.PI;
      k.add(mat, limbGeo(F.len * s, F.r0 * s, F.r1 * s, 5, true, { rings: 3, bulge: 0.2, capN: 2 }),
        [Math.sin(a) * F.at * ax * s, F.y * s, Math.cos(a) * F.at * az * s + fz], [-2.6, a, 0]);
    });
  }
  // The drape down the back. arcGeo faces +Z at φ = 0 and spans y ∈ [0, h],
  // so a nape fall is the same arc yawed by π — and its radii run WIDER at
  // the bottom than the top, because cloth hanging off a head flares.
  if (H.nape) {
    const N = H.nape;
    const g = arcGeo(N.r0 * s, N.r1 * s, N.h * s, N.arc, N.thick * s, N.seg);
    g.rotateY(Math.PI);
    k.add(mat, g, [0, N.y * s, 0]);
  }
  // Two falls beside the face, one each side. `pair` authors both rather than
  // mirroring by scale, which would invert the winding of every triangle.
  if (H.falls) {
    const F = H.falls;
    k.pair((sx) => {
      k.add(mat, plateGeo(F.w * s, F.h * s, F.d * s, F.r * s, 2),
        [sx * F.x * s, F.y * s, F.z * s], [F.pitch, -sx * F.yaw, sx * F.roll]);
    });
  }

  const [m] = k.bake(headObj);
  if (!m) return null;
  /* FLAT-SHADE THE WHOLE HOOD, not the shell alone. The rim is the piece the
   * player looks straight at and a smooth torus is a porthole; the peak and
   * the folds want the same hard creases the panels have or they read as
   * plumbing laid over cloth. Done after the bake so it is one pass over one
   * merged buffer — and the lining comes out right for free, because
   * `computeVertexNormals` reads winding and the lining's is already reversed,
   * so its normals land pointing inward exactly as `liningGeo` left them. */
  if (H.facet) m.geometry = facet(m.geometry);
  m.userData.hood = H.id;
  /* KEPT AT RANGE, for the reason the acolyte's cowl is: `Enemy._applyLod`
   * culls every mesh that is neither a bone primary nor tagged here, and a
   * hood is the single largest thing on a head. Untagged, a hooded figure is a
   * bare 12 cm ball past thirty metres — the same ball everybody else wears. */
  return markSilhouette(m);
}

/**
 * The wardrobe seam's entry point: put `id` on a body that is already built.
 *
 * Takes what `buildJedi` returned rather than a rig, because the two things it
 * needs beyond the rig — the cloth to cut the hood from and the scale the HEAD
 * was authored at — are both on that object and neither can be recovered from
 * the rig (`rig.scale` is the BODY's scale, and they differ by a factor of
 * 1.85 on the small-folk row). Returns the mesh, or null.
 */
export function attachHood(built, id) {
  const rig = built && built.rig;
  const head = rig && rig.get && rig.get('head');
  if (!head || !head.obj) return null;
  const mat = built.palette && (built.palette.over || built.palette.outer);
  if (!mat) return null;
  return hoodOn(head.obj, mat, built.headScale ?? rig.scale ?? 1, id);
}

/* ── Jedi ────────────────────────────────────────────────────────────── */

/**
 * FOUR JEDI, ONE BUILDER, ONE DRAW — and therefore one Jedi.
 *
 * `Enemy.ARCHETYPES` gives the Knight, the Sentinel, the Guardian and the
 * Master four declared fighting forms, four blades and four hilts, and then
 * builds all four from `buildJedi({ ...o, ...jediLook() })` — the same pool of
 * species, robe, hair, age and build rolled for every one of them. Measured at
 * LOD 1 in `tools/_roster.mjs`: sentinel/master 0.939 flank IoU, guardian/
 * master 0.889, jedi/sentinel 0.883, and 0.000 apart in visible colour. The
 * player cannot learn "that one is a Guardian, it fights Djem So and cannot be
 * parried" from a body that is a Knight with three centimetres more hilt.
 *
 * A rank is worn, and each of these is the piece the source material is most
 * consistent about — chosen so no two change the same part of the outline:
 *
 *   knight    nothing added, and the robe cut SHORT. Ataru is the acrobatic
 *             form; a knight fighting it has taken the long robe off. The most
 *             compact of the four and the only one whose leg line is bare.
 *   sentinel  the hood, up, and the robe at full length. Soresu waits, and a
 *             sentinel is read head-first: the cowl is 14 cm of outline in the
 *             one place a Jedi has none.
 *   guardian  the Temple Guard's masked helm with its vertical crest, and a
 *             pauldron. The tallest head on the roster and the widest shoulder
 *             — which is what Djem So's 34 damage ought to look like.
 *   master    the shoulder mantle and the longest robe. Width at the top of
 *             the figure and cloth to the ankle, where the knight has neither.
 *
 * Every field defaults to the identity, so `buildJedi()` with no rank emits the
 * geometry it always did — which the player, the menu preview and Net depend
 * on and which `preview`, `grooming` and `garments` pin.
 */
export const JEDI_RANKS = {
  knight:   { hem: 0.74 },
  /* `hood` names a row of HOOD_CUTS rather than being a boolean, and `'cowl'`
   * IS the cowl this rank has always worn — every number of it moved into that
   * row unchanged when hoods became a thing a player can pick. See the note
   * over HOOD_CUTS: the geometry is identical, and what is new is the dark
   * lining inside the shell and the fact that the whole thing is now one
   * merged mesh instead of two. */
  sentinel: { hood: 'cowl', hem: 1.32 },
  guardian: { helm: true, pauldron: true, hem: 1.06 },
  /* The Master is WIDE AT THE TOP and ordinary below, which is the opposite of
   * the Sentinel — hooded, narrow, and cloth to the ankle. Two robed figures
   * that are both long and both hooded are one figure, and the pair measured
   * 0.939 before these two numbers were pushed apart. */
  master:   { mantle: true, hem: 0.98 },
};

export function buildJedi(opts = {}) {
  /** The rank's kit, if this body is wearing one. See JEDI_RANKS. */
  const RANK = { hem: 1, ...(JEDI_RANKS[opts.rank] || null) };
  /**
   * The creator's axes. `sp` is a row of SPECIES, `G` the character sheet (cut,
   * beard, years, muscle — see SHEET_KEYS), `F` the eight face numbers with the
   * species' bias and the years folded in, `k` the signed frame parameter (-1
   * slight to +1 heavy) and `mu` the signed muscle parameter (-1 wiry to +1
   * powerful).
   *
   * ALL OF THEM ARE WRITTEN SO THAT THE DEFAULT IS THE IDENTITY: species human
   * carries no face bias, an absent face preset is eight zeros, an absent build
   * is exactly 0.5 and therefore k exactly 0, an absent sheet is the temple cut
   * with no beard at age 0 and muscle 0.5 — therefore a exactly 0 and mu
   * exactly 0 — and every use below has the shape `x * (1 + gain*k)` or
   * `x + gain*k`. `x * 1` and `x + 0` are exact in IEEE float, so buildJedi()
   * with no arguments emits byte-for-byte the geometry it emitted before any of
   * this existed — which Player, Enemy, Net and the menu preview all depend on,
   * and which is asserted against the previous build rather than assumed.
   */
  const sp = speciesOf(opts.species);
  /* The species is resolved BEFORE the sheet, so the sheet can fall back to
   * the species' own default hairstyle rather than to HAIR_STYLES[0] — see the
   * note over the hairstyle pick. Folded into `opts` rather than passed as a
   * second argument so the call below stays the one expression the grooming
   * suite scans for: a source check that names a mechanism goes red for a
   * rewrite that changes nothing, and this file has been bitten by that. */
  if (sp.defaultHair && opts.__speciesHair === undefined) {
    opts = { ...opts, __speciesHair: sp.defaultHair };
  }
  const G = sheetOf(opts);
  /**
   * A SPECIES MAY BE A DIFFERENT SIZE, and its head a different fraction of it.
   *
   * `sp.frame` multiplies the rig's own scale, the arm and leg lengths the
   * skeleton is laid out at, and — separately — the size everything on the HEAD
   * is authored at. Separately is the whole point: a small figure built by
   * turning one scale down is a scaled-down human, which is exactly the thing
   * the small-folk row exists not to be. Its body is 0.40 of a human's and its
   * head 0.62, so the head is 1.55 times the size the body would have given it
   * and the figure is three and a half heads tall instead of seven.
   *
   * The animator needs no telling. BipedAnimator measures the legs it is handed
   * (`standHip = min(hipHeight, ankleY + legLen * 0.965)`), so a rig with 34 cm
   * legs stands 37 cm at the hip with the same knee extension as an adult, on
   * the same `hipHeight: 0.95` every caller passes.
   */
  const FR = sp.frame || null;
  const S = (opts.scale ?? 1) * (FR ? FR.scale : 1);
  // `frame.head` is the head's scale against the CALLER's, not against the
  // body's — 0.40 body and 0.62 head means the head is 1.55 times the size a
  // uniform shrink would have given it, which is the entire point of the row.
  // Written the other way round (S * FR.head) it compounds to 0.248 and the
  // figure comes out with a head SMALLER than its body's share: measured at
  // 10.5 heads tall, which is a stick insect.
  const HS = (opts.scale ?? 1) * (FR ? FR.head : 1);
  const robe = ROBE_COLORS[opts.robeIndex ?? 0] || ROBE_COLORS[0];
  const rig = new Rig(humanoidSkeleton(S, FR ? { armLen: FR.armLen, legLen: FR.legLen } : {}), { scale: S });
  const F = faceFor(sp, opts.face, G.a);
  const { k } = buildOf(opts.build);
  const mu = G.m;

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
  const W = { vc: true };
  const tunic = clothMat(robe.inner, 0.90, { ...W, repeat: 3.6 });
  const outer = clothMat(robe.outer, 0.93, { ...W, repeat: 2.4 });
  const over = clothMat(mix(robe.outer, robe.trim, 0.46), 0.95,
    { ...W, repeat: 1.6 });
  const sleeve = clothMat(mix(robe.outer, robe.inner, 0.44), 0.90, { ...W, repeat: 3.2 });
  const trim = clothMat(robe.trim, 0.84, { ...W, repeat: 4.6 });
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
  /**
   * AND IT GOES GREY, which is the other half of the years.
   *
   * `mix(chosen, GREY, 0.88 * age)` and not a separate white swatch, because
   * the two are not alternatives: a black-haired sixty-year-old is iron grey
   * and a sand-haired one is nearly white, and a player who picked Auburn and
   * dragged the years across should watch that auburn go. At age 0 the factor
   * is 0 and `Color.lerp(x, 0)` returns the colour untouched, so the neutral
   * material is the one this line always built.
   */
  // Guarded rather than relying on `lerp(c, 0)` being the identity: mix()
  // round-trips through Color.getHex(), which quantises to 8 bits per channel,
  // and the neutral figure has to come out on the same integer it always did.
  const base = opts.hairColor ?? 0x2a1d14;
  const hairHex = G.a > 0 ? mix(base, GREY, 0.88 * G.a) : base;
  const browHex = G.a > 0 ? mix(mix(base, GREY, 0.62 * G.a), 0x000000, 0.32) : mix(base, 0x000000, 0.32);
  const hair = clothMat(hairHex, 0.72, { vc: true, repeat: 8.0 });
  hair.side = THREE.DoubleSide;
  // Brows and lashes are two square centimetres of nearly-flat plate facing
  // the sun, and back when the hair material still carried a sheen lobe they
  // rendered BRIGHTER than the forehead behind them — a pale bar across the
  // face, which is the opposite of what a brow is for. The lobe is gone with
  // the rest of the specular (see clothMat); they stay a third darker than the
  // hair because that is what a brow looks like, not because of a shader.
  // Brows grey too, and later than the hair does — 0.62 against 0.88.
  const brow = clothMat(browHex, 0.86, { vc: true, repeat: 9.0 });

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
  /**
   * MUSCLE RIDES THE SAME NUMBERS, and that is why it is safe to add.
   *
   * The frame slider is GIRTH: everything gets wider together, which is what a
   * heavy build is. Muscle is DISTRIBUTION — a shoulder and a chest that grow
   * while the waist comes IN — and that is the difference a viewer actually
   * reads as strength rather than as size. So the waist term below is negative
   * and the shoulder term is the largest positive one on the figure: across the
   * muscle slider the shoulder-to-waist ratio runs 1.02 → 1.29, which is more
   * than the frame slider moves it.
   *
   * Every garment scalar takes its muscle term from the SAME expression as the
   * limb it is worn on, exactly as the frame terms do, so a bracer stays outside
   * its own forearm and an obi stays on a waist that just came in by 5%. The
   * garment-fit sweep in tools/checks/grooming.mjs walks both sliders at once
   * rather than one at a time, because the corner that fails is the corner.
   */
  const KTOR = 1 + 0.105 * k + 0.055 * mu;  // ribcage: tabard caps, the V of the tunic
  const KHIP = 1 + 0.030 * k - 0.010 * mu;  // pelvis: both skirts and the front panels
  // The obi is a WAIST band, not a hip band, and the waist carries five times
  // the hip's gain — so scaling the belt group with the pelvis buried 15% more
  // of the obi at the heavy end than at the middle. Halfway between the two is
  // what actually keeps a belt on a waist while its skirt still covers a hip.
  const KBELT = 1 + 0.080 * k - 0.028 * mu; // obi, belt, buckle, pouches, hanging ends
  const KARM = 1 + 0.150 * k + 0.105 * mu;  // humerus and forearm: mantle, hem, cuff, bracer
  // The boot shaft is a circular lathe over a shin whose section carries a calf
  // lobe behind it, so its muscle term has to track the CALF and not the shaft
  // radius. At 0.055 against a calf swell of 0.42 the gastrocnemius came out
  // 22 mm outside its own boot at the powerful end — measured per height on the
  // built mesh, which is the only place that shows up.
  const KLEG = 1 + 0.120 * k + 0.105 * mu; // shin: boot shaft, cuff, ankle strap
  const KNECK = 1 + 0.135 * k + 0.090 * mu; // collar

  /**
   * The outer layer of the robe below the belt — the over-skirt and the two
   * front over-panels — collected as it is built so the runtime can swap it for
   * simulated cloth. See attachSkirt() in Cloth.js and the note at the lathe.
   */
  const outerLayer = [];
  /**
   * Whatever the species hangs on its head, so a runtime that simulates one of
   * them can hide the rigid version. Empty for a human.
   */
  const speciesMeshes = [];

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
    parts: { chestR: 0.162 * (1 + 0.105 * k + 0.055 * mu), shoulderR: 0.138 * (1 + 0.115 * k + 0.125 * mu),
             hipR: 0.138 * (1 + 0.025 * k - 0.010 * mu), waistR: 0.122 * (1 + 0.135 * k - 0.028 * mu),
             armR: 0.045 * (1 + 0.150 * k + 0.105 * mu), armR0: 0.052 * (1 + 0.165 * k + 0.115 * mu),
             armR1: 0.039 * (1 + 0.130 * k + 0.060 * mu), foreR0: 0.044 * (1 + 0.150 * k + 0.105 * mu),
             foreR1: 0.030 * (1 + 0.110 * k + 0.035 * mu),
             clavR: 0.062 * (1 + 0.100 * k + 0.085 * mu), thighR: 0.090 * (1 + 0.120 * k + 0.075 * mu),
             neckR: 0.058 * (1 + 0.135 * k + 0.090 * mu), torsoDepth: DEPTH },
    // [amp, at, width]: the deltoid peaks 15% down the humerus and is spent by
    // 40%, which is where a deltoid inserts. Folded into the arm's own lathe
    // instead of bolted on as a ball — see dressHumanoid. Its amplitude is the
    // strongest single frame cue on a limb: a shoulder cap is either there or
    // it is not, and unlike a radius it changes the SHAPE of the outline.
    // Muscle moves the deltoid harder than the frame does — 0.62 against 0.36 —
    // and deliberately: a shoulder cap is either there or it is not, and unlike
    // a radius it changes the SHAPE of the outline rather than its width.
    deltoid: [0.34 * (1 + 0.36 * k + 0.62 * mu), 0.15, 0.155],
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
      // The calf's own belly follows the muscle slider; its position and width
      // do not, because where a gastrocnemius sits is anatomy and not training.
      shin: { rings: 8, swells: [[0.33, 0.22 * (1 + 0.20 * mu), 0.16]],
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
    headRadius: 0.098 * (HS / S),
    // The trapezius, and it is where MUSCLE reads loudest on a clothed figure.
    // A heavy frame carries the shoulder line higher and further out from the
    // neck; a slight one has a longer, thinner neck showing above the collar,
    // which is the cue the collar itself frames. Muscle is a bigger term than
    // frame on `rise` for the reason a trapezius is: it is the one muscle on the
    // body whose whole job is to lift the shoulder girdle, and it is the only
    // one visible through a robe from behind.
    yoke: { reach: 0.62 * (1 + 0.055 * k + 0.070 * mu), rise: 0.031 * (1 + 0.30 * k + 0.46 * mu),
            depth: 0.064 * (1 + 0.14 * k + 0.16 * mu),
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
    // `HS` and not `s`, and the two are the same number for everything but the
    // small-folk row: the head is authored at its own scale so a species can be
    // three and a half heads tall rather than a human shrunk.
    //
    // `covered` is the cut, and it is not decoration. The shell's occlusion bake
    // drives everything above the ear line down to 0.28 SO THAT a hair
    // poke-through reads as a dark root instead of as bare bone — and painted
    // on a SHAVED head that is a black skullcap, which is the exact defect
    // `creator: a bald species is bald` was written for. A shaved human is as
    // bald as a Twi'lek and now takes the same bake.
    headGeo: () => skullGeo(HS, F, sp, sp.hair && G.hair.crown !== false),
    buildHead(headObj, _s, hg) {
      const s = HS;
      /* ── THE FEATURES, EIGHT MESHES AT MOST: two eyes, two lids, the brows,
       * the lips, the ears, and the skull they sit in. It was fourteen. */
      const eye = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.16, metalness: 0, vertexColors: true });
      const lip = new THREE.MeshStandardMaterial({ color: 0x9a6558, roughness: 0.70 });
      const eyeD = new THREE.Vector3(0, 0, 1);
      // Eye spacing is the one face parameter that moves a feature rather than
      // a mass, so it moves the PROBE ORIGIN: the eyeball, the lids and the
      // brow are all seated by raycasting the skull from behind the socket, so
      // widening the eyes re-seats every one of them on the surface that is
      // actually there rather than sliding parts sideways off a face that
      // curves away underneath them.
      const eyeX = 0.0335 * (1 + 0.30 * F.eyes);
      const tag = (m, name) => { m.userData.feature = name; return m; };
      for (const sx of sp.eyes === false ? [] : [-1, 1]) {
        const side = sx < 0 ? 'L' : 'R';
        const k = new Kit();
        // Probed straight forward from a point directly behind the eye, into
        // the socket the skull now has: the ball is set 6.4 mm into the
        // surface, which with a 4.5 mm hollow leaves the cornea and the iris
        // standing clear and the white mostly under the lids.
        const o = new THREE.Vector3(sx * eyeX * s, 0.084 * s, 0.010 * s);
        const at = onSurface(hg, eyeD, 0.0064 * s, o);
        k.aim(eye, eyeGeo(s, sp, side), at, eyeD);
        tag(k.bake(headObj)[0], 'eye' + side);
        // the lids, with the blink as a morph on the mesh — see lidGeo
        const centre = new THREE.Vector3(at[0], at[1], at[2]);
        const lids = addShapeMorph(lidGeo(s, sx, centre, 0), lidGeo(s, sx, centre, 1), 'blink');
        tag(mesh(lids, skin, headObj), 'lids' + side);
      }
      /* THE BROWS GO INTO THE HAIR'S OWN GEOMETRY, the way a beard does —
       * they are hair, they take the hair's colour and its grey, and it costs
       * no mesh. Two reasons beyond the count: `creator: no face preset buries
       * a feature` reasons about a mesh by its centre, and a pair of brows in
       * one mesh has its centre on the bridge of the nose, 2 mm inside the
       * skull; and a species with no scalp hair has no brows either, so the
       * one case that would need a mesh of its own never occurs. */
      const browParts = [];
      if (sp.brows !== false) {
        for (const sx of [-1, 1]) {
          const nodes = [];
          const N = 5;
          for (let i = 0; i < N; i++) {
            const t = i / (N - 1);                              // 0 at the nose, 1 at the temple
            const x = sx * (eyeX - 0.014 + 0.040 * t);
            // probed AT the ridge's height, straight out through it, and set a
            // hair proud of whatever the preset made of the ridge — a brow
            // lifted from a point under it ended inside a heavy brow
            const y = 0.0965 - 0.0030 * t;
            const d = new THREE.Vector3(x * 0.6, 0.10, 1).normalize();
            const p = onSurface(hg, d, -0.0012 * s, new THREE.Vector3(x * s, y * s, 0.020 * s));
            // thick over the inner half, tapering to a point at the temple
            const r = (0.0028 + 0.0010 * Math.sin(t * Math.PI) - 0.0018 * t) * s;
            nodes.push([p[0], p[1], p[2], Math.max(0.0008 * s, r)]);
          }
          browParts.push([tubeGeo(nodes, 4, { tip: 0.3 })]);
        }
        // a species with brows and no hair mass to carry them (none today)
        // gets them as one mesh on the brow material
        if (!sp.hair) {
          const kb = new Kit();
          for (const [g] of browParts) kb.add(brow, g);
          tag(kb.bake(headObj)[0], 'brows');
          browParts.length = 0;
        }
      }
      // the ears, one mesh a side: a mesh is reasoned about by its centre
      // downstream, and a pair's centre is in the middle of the head
      if (sp.ears !== false) {
        tag(mesh(earGeo(s, -1, hg), skin, headObj), 'earL');
        tag(mesh(earGeo(s, 1, hg), skin, headObj), 'earR');
      }
      // the mouth: lips as two rolls with a seam, not a slab
      if (sp.mouth !== false) tag(mesh(lipGeo(s, F, hg), lip, headObj), 'lips');

      /**
       * THE HAIR IS BUILT BEFORE THE SPECIES' OWN HEAD FURNITURE, AND ADDED
       * AFTER IT.
       *
       * The order used to be the other way round with a note saying why:
       * "it runs BEFORE the hair block so that a species which keeps hair
       * (Zabrak does not, but the hook allows it) has the hair laid OVER its
       * own crown rather than under it". That is exactly right for a species
       * whose head furniture lies flat on the scalp, and exactly wrong for the
       * one species that turned out to want the hook — a horn does not lie
       * under hair, it grows THROUGH it, and a ring seated on the skull under a
       * 2 cm hair mass loses two thirds of every 3 cm horn.
       *
       * Splitting the hair into "compute" and "attach" costs nothing and gives
       * `speciesHead` the one thing it needed: the shell the hair actually
       * presents, so a horn can be seated on whichever of skull-or-hair is
       * further out along its own ray (see onOuter). The hair MESH still goes
       * on after, so the draw order and the child order of headObj are what
       * they always were.
       *
       * `crown` decides whether the hair is offered at all: a shaved cut is not
       * a shell and a species must not seat anything on one.
       */
      const V = vaultOf(F);
      /**
       * THE YEARS, as a hairline.
       *
       * `wide` is a hair of margin on the WIDE end only: at skull = -1 the
       * braincase grew through the cap at one vertex of 117 behind the
       * hairline, which the scalp bake would have rendered as a dark root
       * rather than as bare bone — but zero is cheaper than an excuse.
       * `back` is age: a hairline recedes, and unlike a wrinkle it is worth
       * whole pixels of silhouette at the range the game is played at.
       */
      /* `gap` is the bare crown a horned species needs; zero for everybody
       * else, and zero is the identity. See hairCap. */
      const R = { wide: 0.020 * Math.max(0, -F.skull), back: 0.034 * G.a, thin: G.a,
                  gap: sp.horns ? sp.horns.gap : 0 };
      const cut = sp.hair ? (HAIR_CUTS[G.hair.id] || HAIR_CUTS.temple)(s, V, R) : null;
      const beard = sp.hair ? beardParts(s, hg, G.beard) : null;
      const parts = sp.hair ? [...cut.parts, ...beard.parts, ...browParts] : [];
      let hairGeo = null;
      if (parts.length) {
        hairGeo = assemble(parts, 'hair');
        // Hair is self-shadowing and nearly black at the roots: dark under the
        // fringe, dark at the nape, lit along the crown. On a single sun this is
        // the only thing that separates the strands from one another at all.
        // The same field runs over the beard, and correctly: everything under
        // the jaw is in the head's own shadow, which is the whole reason a
        // beard reads as a mass rather than as a painted patch.
        shadeAO(hairGeo, ao(
          creaseAt(0, 0.040 * s, -0.050 * s, 0.070 * s, 0.46, 0.5),
          creaseAt(0.070 * s, 0.078 * s, -0.010 * s, 0.045 * s, 0.55, 0.5),
          creaseAt(-0.070 * s, 0.078 * s, -0.010 * s, 0.045 * s, 0.55, 0.5),
          (x, y) => 0.62 + 0.38 * clamp((y / s - 0.045) / 0.11, 0, 1),
        ), { floor: 0.26 });
      }

      // Everything the species puts on the head — horns, lekku, montrals,
      // tentacles, a breath mask — and every mesh it makes is a child of
      // headObj, which is what makes it come off with a severed head. See
      // speciesHead().
      // Kept, not just built: attachLekku hides these while the simulated pair
      // is live and shows them again at LOD range, which is the same swap
      // attachSkirt does with the rigid robe. Snapshotting the children either
      // side of the call is how they are identified without Kit having to
      // report what it baked.
      {
        const before = headObj.children.length;
        speciesHead(sp, headObj, s, hg, {
          skin, F, horns: sp.horns,
          // only a cut that covers the crown is a shell worth seating on
          over: (sp.hair && G.hair.crown !== false) ? hairGeo : null,
        });
        for (let i = before; i < headObj.children.length; i++) speciesMeshes.push(headObj.children[i]);
      }
      if (!sp.hair) return;
      // The hair mass is the whole difference between a bare Jedi head and a
      // helmet at range, and it is one mesh.
      if (hairGeo) markSilhouette(mesh(hairGeo, hair, headObj));

      // The strands — a padawan's braid, a warrior's tail, a plaited beard.
      //
      // EACH ONE IS A DIRECT CHILD OF THE HEAD, not a mesh inside a positioning
      // Group, and that is a bug fix rather than tidying. Player._applyViewMode
      // hides first person's own head with `neck.obj.traverse(o => o.visible =
      // !fp)`, which reaches every descendant; Ragdoll's addBone() re-shows only
      // the DIRECT children of the bone it is re-homing. A mesh one level down
      // inside a Group is hidden by the first and missed by the second, so
      // cutting your own head off in first person produced a head with no braid
      // on it. Measured before that change: 13 of the severed head's 14 meshes
      // came back visible.
      //
      // The positioning group's transform is composed into the mesh's own
      // rather than deleted, so a strand lands on exactly the matrix it would
      // have had inside one.
      for (const st of [...cut.strands, ...beard.strands]) {
        /**
         * A STRAND'S LENGTH IS A BODY MEASUREMENT, not a head one.
         *
         * Where it roots and how thick it is belong to the head and scale with
         * it; how far it FALLS is decided by where the shoulder is, which is
         * the body's business. On a species whose head is 1.85 times its body's
         * share, a braid cut at head scale is 85 mm on a 660 mm figure and
         * lands inside the trapezius — measured, 3 of the braid's 80 vertices
         * inside the torso at a head yaw of -0.42 rad, which is exactly the
         * property `creator: nothing a species hangs on a head passes through
         * the body under it` forbids. `S === HS` for every human-framed row, so
         * nothing that shipped moves by a float.
         */
        const L = st.len * S;
        const rot = new THREE.Euler(st.rot[0], st.rot[1], st.rot[2]);
        const pos = new THREE.Vector3(0, -L, 0).applyEuler(rot)
          .add(new THREE.Vector3(st.at[0] * s, st.at[1] * s, st.at[2] * s));
        mesh(limbGeo(L, st.r0 * s, st.r1 * s, st.seg, true,
          { rings: st.rings, bulge: 0.34, bulgeAt: 0.5, capN: 2 }),
          hair, headObj, [pos.x, pos.y, pos.z], [rot.x, rot.y, rot.z]);
      }
    },

    /**
     * WHAT A RANK PUTS ON A HEAD. Runs after the hair and the species' own
     * furniture, because a hood goes over both and a helm replaces neither.
     */
    headKit(headObj, s) {
      /**
       * THE HOOD, and it is no longer typed here.
       *
       * This used to be an inline sphere segment and a torus — the second copy
       * of a construction the acolyte's head also carries, which is exactly
       * §2.3's hand-maintained table beside its twin, and it was one of only
       * two hoods in a game whose player had asked for wearable ones. Both the
       * rank's cowl and the wardrobe's four cuts come out of `hoodOn` now, and
       * `JEDI_RANKS.sentinel` names the row rather than restating the shape.
       *
       * `HS` and not `s`: the head is authored at its own scale (see `headGeo`
       * above), and `s` is the BODY's. They are the same number for every
       * human-framed row and differ by 1.85 on the small-folk one, where this
       * line used to build a hood 40% of a head 74% the size of a human's —
       * a cowl that ended half way up the skull it was on.
       *
       * `opts.hood` is what a PLAYER chose (ui/Menu.js writes it into
       * `settings.wardrobe.hood` and Player.js passes it here); `RANK.hood` is
       * what the roster's Sentinel wears. The player's answer wins, and the
       * default of both is no hood at all — so `buildJedi()` with no arguments
       * emits exactly the geometry it always did.
       *
       * The cloth is `over`, the darkest of the five layers the robe palette
       * ladders into, because a hood is part of the over-robe and not a piece
       * of its own: `tintWardrobe` dyes `palette.over` with the over-robe's
       * tone, so a player who dyes their tabard black gets a black hood with
       * it and no seventh material is allocated on any figure.
       */
      hoodOn(headObj, over, HS, opts.hood ?? RANK.hood ?? 'none');
      if (RANK.helm) {
        /* The Temple Guard's helm: a smooth mask with no face on it at all and
         * a vertical crest running front to back over the crown. It is the
         * tallest head on the roster by 11 cm, which is the point — a Guardian
         * is the one Jedi you are meant to identify before it has moved. */
        const kh = new Kit();
        kh.add(trim, plateGeo(0.152 * s, 0.220 * s, 0.150 * s, 0.030 * s, 3), [0, 0.108 * s, 0.006 * s]);
        kh.add(trim, plateGeo(0.104 * s, 0.086 * s, 0.086 * s, 0.018 * s, 2), [0, -0.004 * s, 0.030 * s], [0.26, 0, 0]);
        // the crest, and the two blades of it that stand against the sky
        kh.add(trim, plateGeo(0.030 * s, 0.180 * s, 0.132 * s, 0.010 * s, 1), [0, 0.244 * s, -0.010 * s], [0.10, 0, 0]);
        kh.add(trim, plateGeo(0.026 * s, 0.110 * s, 0.088 * s, 0.008 * s, 1), [0, 0.300 * s, -0.086 * s], [0.72, 0, 0]);
        markSilhouette(kh.bake(headObj));
      }
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
      /* THE TABARD IS THE TORSO'S SECOND SILHOUETTE and it was being culled.
       * Its own note above says so — "without it the figure is one smooth
       * barrel from the collar to the obi" — and one smooth barrel is exactly
       * what a Jedi was past thirty metres, which is where a player decides
       * whether the thing walking at them has a blade. Three panels, three
       * draw calls, against four archetypes that shared 0.94 of a figure. */
      for (const sx of [-1, 1]) {
        const m = wrap(over, chestB, tabBot, tabTop, sx * 0.315, 0.255, 0.013, 0.017, 0.108 * KBELT);
        shadeAO(m.geometry, tabAO, { floor: 0.45 });
        markSilhouette(m);
      }
      const back = wrap(over, chestB, tabBot, tabTop, Math.PI, 0.42, 0.012, 0.015, 0.104 * KBELT);
      shadeAO(back.geometry, tabAO, { floor: 0.45 });
      markSilhouette(back);

      /* ── what a rank wears on the shoulders ──
       *
       * Two pieces, and they are deliberately at opposite ends of the same
       * axis: the Guardian's pauldron is HARD and one-sided, the Master's
       * mantle is soft and goes all the way round. Both are one merged mesh
       * and both are kept at range, because a shoulder is where a silhouette
       * is widest and therefore where a rank is legible from furthest away. */
      if (RANK.pauldron || RANK.mantle) {
        const kr = new Kit();
        if (RANK.pauldron) {
          kr.pair((sx) => {
            kr.add(trim, plateGeo(0.130 * KTOR * s, 0.056 * s, 0.180 * s, 0.020 * s, 2),
              [sx * 0.158 * KTOR * s, 0.176 * s, -0.004 * s], [0, 0, sx * -0.36]);
            kr.add(trim, plateGeo(0.100 * KTOR * s, 0.040 * s, 0.140 * s, 0.014 * s, 1),
              [sx * 0.184 * KTOR * s, 0.132 * s, -0.002 * s], [0, 0, sx * -0.48]);
          });
        }
        if (RANK.mantle) {
          // a short shoulder cape: a bell off the trapezius that stops at the
          // bottom of the ribcage, so it widens the top of the figure without
          // touching the belt the tabard already reads against
          kr.add(over, limbGeo(0.380 * s, 0.126 * KTOR * s, 0.300 * KTOR * s, 20, false,
            { rings: 5, bulge: 0, section: (th, t) => 1 + Math.pow(t, 1.3) * 0.05 * Math.cos(6 * th) }),
            [0, 0.216 * s, 0], [0, 0, Math.PI], [XK, 1, 1]);
          kr.add(over, bandGeo(0.070 * s, 0.086 * s, 0.064 * s, 0.104 * s, 0.062 * s, 14),
            [0, 0.196 * s, 0], [0.08, 0, 0], [XK, 1, 1]);
        }
        markSilhouette(kr.bake(chest));
      }
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
      // An obi with a utility belt buckled over it, a clasp and pouches. The
      // two ends hanging off the knot are the point — a closed ring round a
      // waist is a hoop, and every reference for this character has cloth
      // falling off the front of the belt — and they are not here: see the note
      // at the end of this block.
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
      /*
       * THE TWO ENDS ARE CLOTH, and they are not built here.
       *
       * They used to be: two rigid straps off the knot at r = 0.104·KBELT,
       * turned over to hang. The garment over them starts at 0.145 and reaches
       * 0.285 by its hem, so measured on the built figure 0 of their 90
       * vertices were outside the robe and the deepest sat 134mm inside it —
       * the detail this block's own comment calls "the point" drew nothing, at
       * any range, on any character. There is no radius that fixes it either,
       * because the surface they have to clear is simulated and swings 150mm at
       * a walk. See attachSash() in Cloth.js, which the skirt owns and steps.
       */

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
      /* `RANK.hem` is 1 for every body that is not one of the four Jedi
       * archetypes, and 1 * x is exact in IEEE float, so the neutral figure
       * emits the lathe it always did. See JEDI_RANKS. */
      const skirtH = 0.44 * s * RANK.hem;
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
      /* The robe below the belt is a third of the standing figure and all of
       * it was culled at thirty metres, so a Jedi's legs were two bare tubes
       * — the one thing the under-robe's own note says separates this body
       * from an armoured trooper. Both hems are kept. */
      outerLayer.push(markSilhouette(mesh(skirtGeo, skirtMat, hips, [0, 0.058 * s, 0], [0, 0, Math.PI])));

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
      const underH = 0.72 * s * RANK.hem;
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
      /**
       * HANDED OUT TOO — and this line is THE CONE.
       *
       * The note above the over-skirt diagnoses the problem exactly ("a hem
       * vertex travels 0.000 mm in the pelvis frame… it is hanging next to a
       * cylinder") and then fixes it for the OUTER layer only. This mesh — the
       * LONGER one, 0.72 m from the belt to the ankle, the one that actually
       * covers the legs — was left welded to the pelvis and was never in
       * `outerLayer`, so `attachSkirt` never hid it and the cloth never
       * replaced it.
       *
       * The result is that the simulated skirt reaches dy -0.42 and this tube
       * continues to -0.70: twenty-eight centimetres of rigid cone hanging
       * below the cloth, from mid-thigh to ankle, covering both legs and
       * moving with none of them. It is most obvious in a jump, because the
       * legs travel and it does not. Reported repeatedly; fixed for the wrong
       * garment each time.
       *
       * It joins the outer layer now, so everything below the belt is either
       * simulated or hidden, and nothing under there is welded to the pelvis.
       */
      outerLayer.push(markSilhouette(mesh(underGeo, underMat, hips, [0, 0.020 * s, 0], [0, 0, Math.PI])));
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
           /**
            * THE HEAD-TAILS, as a spec plus the rigid meshes that stand in for
            * them. `lekku` is null for every species that has none, which is
            * what a caller tests rather than testing the species id — see
            * attachLekku() in Cloth.js and the seam in ui/Menu.js.
            *
            * Scaled here rather than at the far end, because `S` already
            * carries the species' own frame and a caller has no business
            * knowing that a row may be a different size.
            */
           lekku: sp.lekku ? [{ at: sp.lekku.at.map((v) => v * S / (opts.scale ?? 1)),
             r: sp.lekku.r * S / (opts.scale ?? 1), len: sp.lekku.len * S / (opts.scale ?? 1),
             taper: sp.lekku.taper }] : null,
           speciesMeshes,
           /**
            * WHAT THIS FIGURE WAS ACTUALLY BUILT WITH.
            *
            * `sheetOf` resolves a hairstyle, a beard, an age and a muscle from
            * three possible sources — a top-level option, a face object, or a
            * species default — and until now nothing outside this function
            * could ask which of them won. So a caller wanting to know "does
            * this head have hair on it" had to ask `SPECIES[…].hair`, which is
            * a different question: it says whether the species MAY, not what
            * this body has. That distinction did not exist while every species
            * either always had hair or never could, and the Zabrak is the first
            * that can wear all eight styles and defaults to none.
            */
           sheet: G,
           /**
            * THE SCALE THE HEAD WAS AUTHORED AT, which is not `rig.scale`.
            *
            * `rig.scale` is the BODY's — `S` — and everything on the head is
            * built at `HS`, which is 1.85 times larger on the small-folk row
            * and identical everywhere else (see the note over `HS`). Anything
            * that wants to put a second thing on this head after the fact —
            * the wardrobe seam's `attachHood`, and nothing else today — has to
            * ask, because the difference is invisible on every other species
            * and catastrophic on that one.
            */
           headScale: HS,
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
 * FOUR ARCHETYPES RIDE THIS CHASSIS AND THREE OF THEM ARE A REPAINT.
 *
 * `b1`, `rocket`, `bx` and `dummy` are all `buildB1`, separated by `color`,
 * `markColor` and `eyeColor` and by nothing else — and a colour is the one
 * channel a dusty sky and a cel ramp take away first. Measured at LOD 1 in
 * `tools/_roster.mjs`: b1/dummy 0.783 flank IoU, rocket/b1 0.712, bx/dummy
 * 0.615. Each of the three has a piece of hardware it is DEFINED by in its
 * own archetype note and none of them had it:
 *
 *   rocket    "a B1 with a tube" — the tube was never built.
 *   bx        a vibrosword. Command.js's handover asked for `blade: 'vibro'`.
 *   dummy     a range target that neither moves nor shoots.
 *
 * All three hang off the chest bone and all three are tagged silhouette,
 * because a distinguishing feature that is culled at thirty metres has not
 * distinguished anything.
 */
export const B1_KITS = {
  line: {},
  rocket: { pack: 'rocket' },
  commando: { blade: 'vibro', stoop: 0.22, head: -0.16 },
  target: { training: true },
};

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
  /** See B1_KITS — `pack`, `blade` and `training` may also be passed directly. */
  const K = { ...(B1_KITS[opts.kit] || B1_KITS.line), ...opts };
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
  /* THE B1 HEAD, AGAINST THE PLATE. A B1's head is a long, narrow, blunt
   * SNOUT — about 28 cm nose to nape on a 12 cm-tall head — carried level on
   * a thin neck: a small cranium at the back, and in front of it a flat-topped
   * bar with squared flanks that tapers only a little and ends in a blunt face
   * with the two photoreceptors set INTO it, looking straight ahead. What was
   * here tapered that bar to an 18 mm point and hung the eyes off its flanks
   * beside the cranium, so from any angle but dead-on it read as a beak with
   * two mortarboards behind it. There are no ear vanes on a B1 either; the
   * one thing standing off the skull is the antenna. */
  const headShell = (s) => assemble([
    // cranium: a small egg at the back, longer than it is wide
    [(() => { const g = new THREE.SphereGeometry(0.052 * s, 10, 8); g.scale(0.92, 1.02, 1.22); return g; })(),
      [0, 0.114 * s, -0.030 * s]],
    // the snout: a rounded bar off the front of the cranium, a touch narrower
    // and shallower toward the face, its nose dropped a few degrees
    [plateGeo(0.066 * s, 0.056 * s, 0.215 * s, 0.020 * s, 2), [0, 0.108 * s, 0.092 * s], [0.10, 0, 0]],
    [plateGeo(0.058 * s, 0.046 * s, 0.070 * s, 0.014 * s, 1), [0, 0.098 * s, 0.200 * s], [0.10, 0, 0]],
    // the ridge along the crown, cranium to nose
    [plateGeo(0.024 * s, 0.012 * s, 0.230 * s, 0.004 * s, 1), [0, 0.140 * s, 0.070 * s], [0.10, 0, 0]],
    // the throat under the cranium, into the neck ring
    [limbGeo(0.060 * s, 0.030 * s, 0.024 * s, 8, true, { rings: 2, bulge: 0, capN: 1 }), [0, 0.020 * s, -0.010 * s]],
    [bandGeo(0.026 * s, 0.040 * s, 0.030 * s, 0.047 * s, 0.034 * s, 10), [0, -0.010 * s, 0]],
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
      /* THE PHOTORECEPTORS ARE IN THE FACE. Two recessed sockets on the blunt
       * end of the snout, a hand's width apart, looking straight down the
       * nose — probed from a point inside the nose block so the ray leaves
       * through its front wall and not the cranium's. The lens sits a couple
       * of millimetres back in its socket, which is what makes it a socket. */
      const core = new THREE.Vector3(0, 0.098 * s, 0.170 * s);
      const d = new THREE.Vector3();
      k.pair((sx) => {
        d.set(sx * 0.22, -0.06, 1).normalize();
        const p = onSurface(hg, d, 0.004 * s, core);
        k.aim(joint, new THREE.CylinderGeometry(0.016 * s, 0.019 * s, 0.016 * s, 10), p, d);
        const q = onSurface(hg, d, -0.004 * s, core);
        k.aim(eye, new THREE.CylinderGeometry(0.011 * s, 0.011 * s, 0.006 * s, 10), q, d);
      });
      // the shallow groove under the eyes, and the vent slots on the flanks
      const nose = new THREE.Vector3(0, -0.30, 1).normalize();
      k.face(joint, plateGeo(0.040 * s, 0.006 * s, 0.006 * s, 0.002 * s, 1),
        onSurface(hg, nose, 0.001 * s, new THREE.Vector3(0, 0.086 * s, 0.170 * s)), nose);
      k.pair((sx) => {
        const side = new THREE.Vector3(sx, 0.05, 0).normalize();
        k.face(joint, ventGeo(0.040 * s, 0.020 * s, 0.006 * s, 3),
          onSurface(hg, side, 0.001 * s, new THREE.Vector3(0, 0.108 * s, 0.060 * s)), side);
        k.add(joint, riv, [sx * 0.034 * s, 0.132 * s, 0.150 * s], [0, 0, sx * 1.5708]);
      });
      // the antenna off the crown — the one thing a B1 carries above its skull
      k.add(joint, new THREE.CylinderGeometry(0.006 * s, 0.007 * s, 0.014 * s, 6), [0, 0.164 * s, -0.036 * s]);
      k.add(joint, limbGeo(0.090 * s, 0.0032 * s, 0.0018 * s, 4, true, { rings: 2, capN: 1 }),
        [0, 0.168 * s, -0.036 * s], [-0.22, 0, 0]);
      // the seam where the cranium meets the snout, and the maintenance panel
      // at the back of the skull
      k.add(joint, bandGeo(0.030 * s, 0.034 * s, 0.030 * s, 0.034 * s, 0.056 * s, 10), [0, 0.108 * s, 0.006 * s], [1.5708, 0, 0]);
      k.add(joint, ventGeo(0.034 * s, 0.028 * s, 0.006 * s, 3), [0, 0.106 * s, -0.088 * s], [0, Math.PI, 0]);
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
      k.pair((sx) => {
        // harness strap over the shoulder, laid along the ribcage's own flank
        k.add(joint, plateGeo(0.024 * s, 0.200 * s, 0.012 * s, 0.003 * s, 1),
          onLimb(r.get('chest'), 0.110 * s, [sx * 0.9, 0, 0.44], 0.004 * s), [0, sx * 0.5, sx * 0.06]);
      });
      k.add(mark, plateGeo(0.080 * s, 0.012 * s, 0.064 * s, 0.003 * s, 1), [0, 0.196 * s, -0.096 * s]);
      k.bake(chest);

      /* ── the backpack: the other half of the B1 silhouette, and it was
       * being culled at the range the whole point of a B1 is that there are
       * forty of them. Two power cells in a cradle, a comms fin and the
       * harness. Everything above is panel lines and rivets; this is shape. */
      const ko = new Kit();
      ko.add(joint, plateGeo(0.150 * s, 0.230 * s, 0.062 * s, 0.012 * s, 2), [0, 0.108 * s, -0.094 * s]);
      ko.pair((sx) => {
        ko.add(shell, new THREE.CylinderGeometry(0.030 * s, 0.030 * s, 0.200 * s, 8),
          [sx * 0.042 * s, 0.108 * s, -0.136 * s]);
        ko.add(joint, new THREE.CylinderGeometry(0.033 * s, 0.033 * s, 0.016 * s, 8),
          [sx * 0.042 * s, 0.206 * s, -0.136 * s]);
        ko.add(joint, new THREE.CylinderGeometry(0.033 * s, 0.033 * s, 0.016 * s, 8),
          [sx * 0.042 * s, 0.010 * s, -0.136 * s]);
      });
      ko.add(joint, plateGeo(0.012 * s, 0.120 * s, 0.052 * s, 0.004 * s, 1), [0, 0.245 * s, -0.104 * s], [-0.3, 0, 0]);
      /* THE ROCKET TUBE. `rocket` is "a B1 with a tube" by its own archetype
       * note — "the silhouette is the B1's, that is the point" — except that
       * the tube was never built, so it was a B1 with a repaint and the two
       * measured 0.712 alike at LOD 1. A launcher over the right shoulder is
       * the one shape that says which of them is about to fire 44 damage. */
      if (K.pack === 'rocket') {
        ko.add(joint, new THREE.CylinderGeometry(0.052 * s, 0.052 * s, 0.400 * s, 8),
          [0.098 * s, 0.176 * s, -0.086 * s], [0.30, 0, -0.20]);
        ko.add(mark, new THREE.CylinderGeometry(0.056 * s, 0.056 * s, 0.030 * s, 8),
          [0.132 * s, 0.348 * s, -0.030 * s], [0.30, 0, -0.20]);
        ko.add(joint, plateGeo(0.030 * s, 0.070 * s, 0.056 * s, 0.006 * s, 1),
          [0.060 * s, 0.216 * s, -0.106 * s], [0, 0, -0.20]);
      }
      /* THE VIBROSWORD. Command.js's handover, verbatim: the BX is "melee:
       * true, saber: true today, which puts a glowing blade in a commando
       * droid's hand". The scabbard down the spine is what makes a BX a BX
       * from behind, and it is the half of that note this file can answer —
       * the blade in the hand is `Enemy._build`'s SaberController. */
      if (K.blade === 'vibro') {
        ko.add(joint, plateGeo(0.030 * s, 0.560 * s, 0.024 * s, 0.006 * s, 1),
          [-0.020 * s, 0.150 * s, -0.150 * s], [0.16, 0, 0.42]);
        ko.add(shell, plateGeo(0.044 * s, 0.070 * s, 0.036 * s, 0.010 * s, 1),
          [-0.136 * s, 0.400 * s, -0.108 * s], [0.16, 0, 0.42]);
      }
      /* THE TARGET. A Training Droid is a B1 that never fires and never moves,
       * and the only thing that said so was the absence of a carbine — which
       * is why it and a live B1 measured 0.702 alike. A scoring plate bolted
       * across the chest is what a range target looks like and it reads from
       * the far end of the dojo. */
      if (K.training) {
        /* A PADDED BOLSTER, not a decal. The first version was a 23 cm roundel
         * 2 cm deep on a body 22 cm across: from the FLANK — which is the view
         * this is measured in and the view a dojo is walked into — it was two
         * centimetres of edge, and the pair moved 0.013. A practice droid is
         * padded, and padding has depth. */
        ko.add(joint, plateGeo(0.300 * s, 0.420 * s, 0.360 * s, 0.090 * s, 3), [0, 0.086 * s, 0.070 * s]);
        ko.add(joint, plateGeo(0.240 * s, 0.170 * s, 0.280 * s, 0.070 * s, 3), [0, -0.096 * s, 0.048 * s]);
        // the scoring rings, on the front of the bolster where a blade lands
        ko.add(mark, plateGeo(0.190 * s, 0.190 * s, 0.020 * s, 0.030 * s, 3), [0, 0.110 * s, 0.244 * s]);
        ko.add(shell, plateGeo(0.104 * s, 0.104 * s, 0.016 * s, 0.024 * s, 3), [0, 0.110 * s, 0.254 * s]);
      }
      markSilhouette(ko.bake(chest));

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
  /* A B1 stands the way the plates draw it: shoulders ahead of the hips,
   * the head carried level on the end of that long neck. */
  leanTrunk(rig, K.stoop ?? 0.16, K.head ?? -0.13);
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
  /**
   * `frame` is radial girth — the same field TROOPER_KITS uses, and here it
   * exists for `buildBodyguard`, which is this chassis with a cowl on it. An
   * IG-100 is a SPINDLE and a B2 is a slab, and building both at the same
   * girth is how a rung-5 line droid came to share 0.965 of a silhouette with
   * the Foundry's 1050-hp general. Default 1, and 1 * x is exact, so a B2 with
   * no kit emits the geometry it always did.
   */
  const G = opts.frame ?? 1, g = (v) => v * G;
  const S = opts.scale ?? 1.18;
  const rig = new Rig(humanoidSkeleton(S, { armLen: 1.0 }), { scale: S });
  /**
   * THE COLOUR IS PEWTER AND IT WAS TAN. Note #34: "get the B2 battle droids
   * to look more like what they actually look like in the reference images,
   * right now they look like the iron giant or iron man and that's nothing
   * like what they actually look like."
   *
   * `assets/reference/units/droids/B2 super battle droid.webp` is a cool
   * gunmetal — a desaturated grey with a violet cast in the shadows and almost
   * no warmth anywhere on it. 0x7d7266 is a khaki, which is the B1's colour,
   * and a khaki humanoid slab with smooth armour and a small head is the Iron
   * Giant almost exactly. The reference's own tell is that the B2 reads as a
   * MACHINED metal object and the B1 reads as a plastic one, and that is a hue
   * and a roughness before it is a shape.
   */
  const shell = armorMat(opts.color ?? 0x6d7076, 0.42, 0.62);
  // was bare: hands, boots and the whole backpack rendered as flat plastic
  const dark = metalMat(0x2f2c27, 0.5);
  const hot = emissiveMat(0xff7a2a, 1.1);
  const scorch = scorchMat();
  const eye = emissiveMat(0xff5522, 3);

  const riv = rivet(0.009 * S);
  const bolt = boltGeo(0.011 * S, 0.010 * S);

  /**
   * A DOME AND A BEAK, which is what the plate shows and what a flat-topped
   * wedge is not.
   *
   * `assets/reference/units/droids/B2 super battle droid.webp`: the head is a
   * smooth rounded dome, small, sunk between the shoulders so that its crown
   * is barely above them — and under it, pointing DOWN and forward, a
   * triangular beak plate that is most of what you read at range. There is no
   * face, no visor band across a flat front and no crown vents; the whole
   * thing is one curve and one wedge.
   *
   * That silhouette is the difference between a B2 and a generic armoured
   * humanoid, and it is where the Iron Giant reading came from: a flat-topped
   * box head with a lit band across it is exactly that character.
   */
  /* A B2 HAS NO HEAD TO SPEAK OF. The plate shows a low hood continuing the
   * line of the cuirass between two huge shoulders, and out of the front of
   * it a squared beak — the whole face — thrust forward and down. The ball
   * that stood here was a helmet on a neck, which is a B1's silhouette. */
  const headShell = (s) => assemble([
    // the hood: a dome flattened to a third of its height and pushed back
    [new THREE.SphereGeometry(0.084 * s, 12, 8), [0, 0.052 * s, -0.016 * s], null, [1.12, 0.58, 1.02]],
    // the beak: long, squared, tipped down 30 degrees off the hood's front
    [plateGeo(0.086 * s, 0.062 * s, 0.128 * s, 0.014 * s, 1), [0, 0.040 * s, 0.066 * s], [0.52, 0, 0]],
    [plateGeo(0.066 * s, 0.040 * s, 0.050 * s, 0.010 * s, 1), [0, 0.010 * s, 0.122 * s], [0.52, 0, 0]],
    // and the collar it sits in — the cowl's own throat, not a neck
    [plateGeo(0.124 * s, 0.042 * s, 0.108 * s, 0.014 * s, 1), [0, -0.006 * s, -0.004 * s]],
  ], 'head');

  dressHumanoid(rig, {
    scale: S,
    body: shell, arm: shell, leg: shell, hand: dark, boot: dark, head: shell,
    /**
     * THE SILHOUETTE, AND THE REFERENCE IS AN HOURGLASS.
     *
     * What was here read the B2's own header correctly — "no neck, no waist,
     * all shoulder" — and then authored a waist at 0.125 against a chest at
     * 0.21, which is 60% and is not a waist, it is a barrel with a slight
     * taper. In the plate the abdomen is a ribbed COLUMN about a third of the
     * chest's width, and the legs under it are conspicuously spindly: the
     * whole read of the thing is a heavy slab carried on thin legs, and the
     * pinch between them is what makes the slab look heavy.
     *
     * Four numbers move and they move together, because the silhouette is a
     * ratio rather than a set of sizes: chest and shoulder out, waist and
     * thigh in. The neck goes to almost nothing — a B2 has none, and 0.070 was
     * enough to see between the head and the cowl.
     */
    parts: { chestR: g(0.228), shoulderR: g(0.196), hipR: g(0.128), waistR: g(0.082),
             armR: g(0.070), clavR: g(0.100), thighR: g(0.074), neckR: 0.044, torsoDepth: 0.86,
             shoulderDome: 0.34 },
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

    /**
     * WHAT IS ON THE HEAD, and the reference's answer is: almost nothing.
     *
     * No visor band, no crown vents, no face. A B2's head is a bare dome with
     * a shadow line where the beak meets it and ONE small red photoreceptor —
     * and the plate puts that receptor on the SHOULDER, not the head, which is
     * the detail that makes the thing read as machinery rather than as a
     * person in armour. The lit band that used to be here is the single
     * strongest reason it read as the Iron Giant: a horizontal glowing line
     * across a flat head is a face.
     */
    buildHead(headObj, s, hg) {
      const k = new Kit();
      const core = new THREE.Vector3(0, 0.052 * s, -0.016 * s);
      const d = new THREE.Vector3(0, 0.18, 1).normalize();
      // the seam where the beak is bolted under the dome — a shadow, not a light
      k.aim(dark, plateGeo(0.090 * s, 0.010 * s, 0.008 * s, 0.002 * s, 1),
        onSurface(hg, d, 0.004 * s, core), d);
      // two small sensor pits either side of the crown, dark and recessed
      k.pair((sx) => {
        k.add(dark, riv, [sx * 0.052 * s, 0.098 * s, 0.046 * s], [0.5, 0, 0]);
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
      k.pair((sx) => {
        k.add(dark, ventGeo(0.070 * s, 0.110 * s, 0.026 * s, 4), at(0.108, [sx * 0.62, 0, 1], -0.014), [0, sx * 0.85, 0]);
        k.row(3, (i) => k.add(dark, riv, at(0.030 + i * 0.070, [sx, 0, 0.15], -0.050), [0, 0, -sx * 1.5708]));
        k.add(dark, bolt, at(0.234, [sx * 0.44, 0.2, 1], -0.030), [1.5708, 0, 0]);
      });
      scorchBone(k, scorch, chestB, 5, 0.02 * s, 0.24 * s, 0.115 * s);
      /* ── the cuirass: the whole of what a B2 IS at range ──
       * Its own comment says the flank plates exist "so the barrel does not
       * read as a barrel from the side", and at thirty metres they were culled
       * and it read as a barrel from the side — which is how a B2 came to
       * share 0.845 of a silhouette with a MagnaGuard. */
      const ko = new Kit();
      ko.add(shell, arcGeo(g(0.232) * s, g(0.208) * s, 0.250 * s, 2.55, 0.030 * s, 10), [0, 0.002 * s, 0], null, [1, 1, D]);
      ko.add(shell, arcGeo(g(0.226) * s, g(0.204) * s, 0.150 * s, 0.80, 0.042 * s, 5), [0, 0.048 * s, 0], null, [1, 1, D]);
      /**
       * THE V, AND IT IS THE WHOLE SILHOUETTE.
       *
       * Every plate of a B2 shows the same thing above the sternum: two big
       * armour panels sweeping UP and OUT from the middle of the chest to the
       * points of the shoulders, meeting in a peak, with the head sunk in the
       * notch between them. It is the most recognisable line on the body and
       * there was nothing like it here — a hoop round the top of the ribcage,
       * which reads as a collar.
       *
       * Built as two long plates rather than as an arc, because the shape is
       * two flat panels meeting at an angle and an arc of the ribcage is by
       * construction the wrong curve for it: what makes the V read is the
       * STRAIGHT top edge running out to a point over each shoulder.
       */
      ko.pair((sx) => {
        ko.add(shell, plateGeo(0.205 * s, 0.115 * s, 0.100 * s, 0.020 * s, 1),
          [sx * 0.098 * s, 0.238 * s, 0.052 * s], [0.30, sx * 0.10, sx * 0.62]);
      });
      // …and the sternum ridge the two panels meet on
      ko.add(shell, plateGeo(0.062 * s, 0.150 * s, 0.086 * s, 0.016 * s, 1),
        [0, 0.208 * s, 0.088 * s], [0.22, 0, 0]);
      ko.add(shell, arcGeo(g(0.228) * s, g(0.216) * s, 0.062 * s, 2.75, 0.034 * s, 10), [0, 0.216 * s, 0], null, [1, 1, D]);
      ko.pair((sx) => {
        ko.add(shell, arcGeo(g(0.230) * s, g(0.208) * s, 0.230 * s, 1.05, 0.026 * s, 6),
          [0, 0.012 * s, 0], [0, sx * 1.5708, 0], [1, 1, D]);
      });
      /* THE RED EYE, and on the plate it is on the SHOULDER. One 12 mm dot,
       * and it is the only lit thing on the whole body — which is what makes
       * a B2 read as a machine with a sensor rather than as a face. */
      ko.add(eye, new THREE.SphereGeometry(0.011 * s, 6, 4),
        [0.120 * s, 0.212 * s, 0.171 * s]);
      markSilhouette(ko.bake(chest));
      /**
       * THE RIBBED COLUMN. `waistR` is 0.082 now against a 0.228 chest, which
       * is the reference's own pinch — and a bare lathe at that radius reads
       * as a stick. In the plate the abdomen is a stack of horizontal ribs, a
       * flexible spine section with the armour STOPPED at it, and it is what
       * makes the narrowness read as engineered rather than as thin.
       */
      {
        const kr = new Kit();
        kr.row(7, (i, t) => kr.add(dark,
          bandGeo(g(0.078) * s, g(0.094) * s, g(0.078) * s, g(0.094) * s, 0.014 * s, 10),
          [0, (-0.052 + t * 0.150) * s, 0], null, [1, 1, D]));
        kr.bake(r.get('spine')?.obj || chest);
      }
      // Back: a vented dorsal block and two exhaust stacks, seated on the
      // ribcage's real back surface (it is 15cm deep here, not 5.8).
      const back = at;
      k.add(dark, arcGeo(g(0.212) * s, g(0.196) * s, 0.170 * s, 1.70, 0.040 * s, 8),
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
  /* THE HUNCH: the whole cuirass rolled forward so the beak hangs between
   * the shoulders and the arms swing ahead of the body. */
  leanTrunk(rig, opts.stoop ?? 0.34, opts.head ?? 0.06);
  return { rig, palette: { shell, dark, hot, scorch, eye } };
}

/* ── clone trooper ───────────────────────────────────────────────────── */

/**
 * SIX ARCHETYPES RODE THIS ONE BUILDER AND THREE ARGUMENTS.
 *
 * `buildTrooper` took `scale`, `color` and `accent`, so a Clone Trooper, a
 * Marksman, a Heavy Gunner, a Jet Trooper, an ARC and a Commander were one
 * body six times over. Measured at LOD 1 in `tools/_roster.mjs`:
 * trooper/sniper 1.000 flank IoU (identical geometry AND identical scale),
 * arc/officer 0.940, trooper/jet 0.880, trooper/arc 0.878, heavy/officer 0.832.
 * The colour did not save it either — the accent is 340 triangles of which
 * ZERO survive the distance cull, so trooper↔heavy, trooper↔arc, trooper↔jet
 * and heavy↔jet all measured 0.000 apart in triangle-weighted visible colour.
 * Same shape and same colour, and the numbers said so.
 *
 * A kit is a set of HARDWARE, not a paint scheme, and each piece here is one
 * the reference plates in `assets/reference/units/clones` actually show:
 *
 *   pack: 'jet'    two nozzles on a spine block between the shoulder bells.
 *                  `jet` has `float: 1.35` and Command.js's own handover says
 *                  it "hovers, but nothing on the model says why".
 *   pack: 'field'  the heavy's ammunition box, its power feed, and the Z-6's
 *                  barrel bundle slung across it. A suppression gunner is
 *                  read by the mass on his back before anything else.
 *   pauldron       one raked plate over the leading shoulder. `side` picks it,
 *                  so an ARC and a Commander are not mirror images.
 *   kama           the armoured skirt: four hanging leaves off the belt, which
 *                  is the piece that breaks the leg line at range.
 *   crest          a raised fin front-to-back over the crown, in the unit
 *                  colour. Against the sky, so it survives everything.
 *   rangefinder    the stalk-and-plate over one temple. It changes the head's
 *                  outline, which is the first thing a silhouette is read by.
 *
 * WHERE THE UNIT COLOUR LIVES NOW. `tintBones` (Enemy.js) has always put its
 * modifier tells on the bone PRIMARIES because `_applyLod` never culls them —
 * that is the working pattern, and the archetypes were never given it. The
 * accent now paints the two CLAVICLE primaries, which is exactly the shoulder
 * line every clone plate flashes, at a cost of zero extra draw calls; the
 * crest, the collar arc and the bells keep their paint and are tagged
 * `userData.silhouette` so they stop being invisible past thirty metres.
 */
/**
 * THE PALETTE A PLAYER PAINTS ARMOUR FROM.
 *
 * Named colours rather than a free picker, for the reason `MARKS` gives about
 * itself: these have to read against dust, against both armies' plate, and at
 * the range a line is actually seen from. A hex field would also be a hex
 * field in a save file, which is a thing to sanitise rather than a thing to
 * offer. Both armies draw from one list — a captured droid painted in Republic
 * bone is a thing a player may do and the fiction survives it.
 */
export const PAINTS = [
  { id: 'bone', name: 'Bone', color: 0xe8e9ec },
  { id: 'ash', name: 'Ash', color: 0x8e8e96 },
  { id: 'slate', name: 'Slate', color: 0x4a5460 },
  { id: 'char', name: 'Charcoal', color: 0x2b2b30 },
  { id: 'sand', name: 'Sand', color: 0xb9a077 },
  { id: 'clay', name: 'Clay', color: 0x8a5a3c },
  { id: 'blood', name: 'Blood', color: 0xb4382c },
  { id: 'rust', name: 'Rust', color: 0xc0682a },
  { id: 'sun', name: 'Sun', color: 0xe8b028 },
  { id: 'jungle', name: 'Jungle', color: 0x3f8f4a },
  { id: 'teal', name: 'Teal', color: 0x2e7d78 },
  { id: 'sky', name: 'Sky', color: 0x3a86c8 },
  { id: 'deep', name: 'Deep', color: 0x24406e },
  { id: 'plum', name: 'Plum', color: 0x7a4a9c },
  { id: 'ice', name: 'Ice', color: 0x9fd8e6 },
];

/** One paint by id, or null for "leave the chassis its own". */
export function paintById(id) {
  return PAINTS.find((p) => p.id === id) || null;
}

/**
 * WHAT A PLAYER MAY CHANGE ABOUT A BODY, AND WHAT THEY MAY NOT.
 *
 * The builders below already take every one of these — a pauldron side, a kama
 * length, a pack, a rangefinder, a brace, the bells, and the three material
 * slots a clone's armour is painted in. They have taken them since the day the
 * kits were written; nothing has ever handed them anything but the archetype's
 * own row. This table is the list a PLAYER may reach, and it is deliberately
 * shorter than the list the builders accept:
 *
 *   NOTHING HERE MOVES A NUMBER. Every field is geometry the LOD already
 *   culls or a material colour. `frame` — the radial girth — is left out on
 *   purpose: it is the only lever on the builders' list that moves the BONE
 *   PRIMARIES, which are 19 of the 26 meshes a trooper keeps at thirty metres
 *   and most of its projected area, and it is what `characters.mjs` measures
 *   to hold six archetypes apart. A player may dress a man; they may not
 *   resize him into another rung.
 *
 *   AND THE PLATES REALLY ARE THEIRS, INCLUDING THE ONES A RUNG USES. `pack`
 *   is how a Raider reads as a Raider and `bells` is 21 cm of the widest part
 *   of a Marksman, so a player who belts a scout pack onto a line trooper has
 *   made their own line harder to read. That is allowed and it is the point:
 *   the rung's DEFAULT is the game's sentence about what a Marksman looks
 *   like, and a player who overrides it has chosen to say something else about
 *   their own company. What they cannot do is change the one axis the roster's
 *   distinctness is measured on, which is why `frame` and only `frame` is off
 *   the list.
 *
 *   THE RANK'S OWN PAINT IS NOT ON THIS LIST EITHER. The crest and the
 *   shoulder bells `repaint` bolts on are the one sentence a battlefield
 *   reads at ninety metres, and they go on top of whatever is underneath.
 *
 * Each row is `[field, [legal values]]`, and a value that is not on its row is
 * dropped rather than corrected — the same rule `markById` follows.
 */
export const KIT_FIELDS = {
  flesh: {
    pauldron: { name: 'Pauldron', values: [[null, 'None'], ['L', 'Left'], ['R', 'Right']] },
    kama: { name: 'Kama', values: [[false, 'None'], [true, 'Short'], ['long', 'Long']] },
    pack: { name: 'Pack', values: [[null, 'None'], ['jet', 'Jet'], ['scout', 'Scout'],
      ['comms', 'Comms'], ['field', 'Field']] },
    rangefinder: { name: 'Rangefinder', values: [[null, 'None'], ['scope', 'Scope'], ['stalk', 'Stalk']] },
    crest: { name: 'Crest', values: [[false, 'None'], [true, 'Fin']] },
    holsters: { name: 'Holsters', values: [[false, 'None'], [true, 'Sidearms']] },
    brace: { name: 'Brace', values: [[false, 'None'], [true, 'Braced']] },
    bells: { name: 'Shoulder bells', values: [[true, 'Belled'], [false, 'Stripped']] },
    cape: { name: 'Half cape', values: [[false, 'None'], [true, 'Worn']] },
  },
  steel: {
    pack: { name: 'Pack', values: [[null, 'None'], ['rocket', 'Rocket tube']] },
    blade: { name: 'Sidearm', values: [[null, 'None'], ['vibro', 'Vibrosword']] },
  },
};

/**
 * The paint slots each chassis carries — the builder's own option name, and
 * what that surface is called by somebody looking at it.
 */
export const PAINT_SLOTS = {
  flesh: [['color', 'Plate'], ['accent', 'Unit flash'], ['visor', 'Visor']],
  steel: [['color', 'Shell'], ['markColor', 'Unit flash'], ['eyeColor', 'Photoreceptor']],
};

/** Just the option names, for the sanitiser and the builders. */
export const PAINT_FIELDS = {
  flesh: PAINT_SLOTS.flesh.map(([f]) => f),
  steel: PAINT_SLOTS.steel.map(([f]) => f),
};

/**
 * A stored `look.kit` and `look.paint`, made into builder options.
 *
 * Anything unrecognised is dropped: this reads off a save file, and a body is
 * built from the result on a machine that has to keep running.
 */
/**
 * ══ WHAT EACH CHASSIS ACTUALLY WEARS ═══════════════════════════════════════
 *
 * `KIT_FIELDS` and `PAINT_SLOTS` are keyed by CHASSIS KIND — flesh or steel —
 * and that is the right key for what the STORE may hold. It is the wrong key
 * for what a screen may offer, because the options are read by individual
 * BUILDERS and the builders do not agree.
 *
 * MEASURED, by building every rung of both ladders twice — once bare, once
 * with each field set — and comparing the whole mesh-and-material signature:
 *
 *     trooper heavy sniper jet arc officer   12 of 12   (buildTrooper)
 *     b1                                       5 of 5   (buildB1)
 *     bx rocket                                3 of 5   pack blade markColor
 *     b2 droideka magna                        1 of 5   color
 *     atte aat                                 0 of 12  (Vehicles.js takes scale)
 *
 * So the Company tab was offering a surviving AT-TE nine rows of kit and three
 * of paint — fifteen controls that stored a value, lit up, and changed nothing
 * on the figure or on the field — and offering every B2 a unit flash and a
 * photoreceptor that `buildB2` does not read. That is the dead control this
 * whole tab exists to stop being, arriving through the one door nobody
 * checked.
 *
 * A TABLE AND NOT A DERIVATION, because deriving it means fourteen chassis ×
 * seventeen fields × their values in builds, and this is read every time a
 * page opens. `barracks.mjs` re-measures it instead, so the table cannot drift
 * from the builders without going red.
 *
 * A type this table does not name falls back to its kind's whole vocabulary —
 * permissive, so a new clone rung is not silently stripped of its wardrobe on
 * the day it ships; the check is what makes sure nobody relies on that.
 */
export const WEARS = {
  /* the clone line — every one of them is `buildTrooper` */
  trooper: null, heavy: null, sniper: null, jet: null, arc: null, officer: null,
  /* the droid chassis, each reading its own handful */
  b1: null,
  bx: ['pack', 'blade', 'markColor'],
  rocket: ['pack', 'blade', 'markColor'],
  b2: ['color'],
  droideka: ['color'],
  magna: ['color'],
  /* the machines. `Vehicles.js` takes a scale and nothing else, and a walker
   * is a named man on the roll the moment one survives a withdrawal. */
  atte: [],
  aat: [],
};

/**
 * The kit and paint fields a screen may offer for one man — `WEARS` resolved
 * against the vocabulary his chassis kind allows.
 *
 * @returns `{ kit: [...], paint: [...] }`, both in the vocabulary's own order
 *          so a page's rows do not move about between chassis.
 */
export function wearableFor(type, kind = 'flesh') {
  const all = { kit: Object.keys(KIT_FIELDS[kind] || {}), paint: (PAINT_FIELDS[kind] || []).slice() };
  const only = WEARS[type];
  if (!only) return all;
  const want = new Set(only);
  return { kit: all.kit.filter((f) => want.has(f)), paint: all.paint.filter((f) => want.has(f)) };
}

export function kitOptsFrom(look, kind = 'flesh') {
  const out = {};
  if (!look || typeof look !== 'object') return out;
  const legal = KIT_FIELDS[kind] || {};
  const kit = look.kit;
  if (kit && typeof kit === 'object') {
    for (const field in legal) {
      if (!(field in kit)) continue;
      if (legal[field].values.some(([v]) => v === kit[field])) out[field] = kit[field];
    }
  }
  /* IDS, NOT COLOURS, because that is what the store keeps: a stored colour
   * is a stored colour for ever, and a re-tuned palette would never reach the
   * men already wearing it. This is the one place the id becomes a number. */
  const paint = look.paint;
  if (paint && typeof paint === 'object') {
    for (const field of (PAINT_FIELDS[kind] || [])) {
      const p = paintById(paint[field]);
      if (p) out[field] = p.color;
    }
  }
  return out;
}

export const TROOPER_KITS = {
  /** The line trooper: the baseline every other kit is read against. */
  line: {},
  /**
   * The Marksman, and it is the hardest of the six because it is the line
   * trooper at the SAME SCALE — 1.0 against 1.0, the only pair on the roster
   * with no size difference to fall back on. So it is the one kit that takes
   * something OFF: no shoulder bells, which is 21 cm of the widest part of the
   * figure, against a long scope and a scout pack.
   */
  marksman: { rangefinder: 'scope', brace: true, bells: false, pack: 'scout', frame: 0.88 },
  /** The suppression gunner: the pack and the Z-6 across it. */
  heavy: { pack: 'field', frame: 1.15 },
  /** The raider. Nothing on the arms — the pack is the whole read. */
  jet: { pack: 'jet', frame: 0.97 },
  /** The ARC: pauldron right, kama, twin holsters on the belt. */
  /* An ARC's pauldron is a MANTLE — one dark plate over both shoulders with
   * a yoke across the collar — and the helmet carries a rangefinder stalk;
   * the two pistols ride the belt in every plate of the reference. */
  arc: { pauldron: 'both', kama: 'long', holsters: true, rangefinder: 'stalk', frame: 1.07 },
  /**
   * The Commander. Everything the ARC has, mirrored, plus the two things a
   * command body has and a line body never does: the comms pack with its
   * antenna, and the shoulder cape. The ARC and the Commander are the pair
   * this roster most wants to keep apart — same rung, same rifle, adjacent
   * scales — so they differ at the top of the figure AND at the back of it.
   */
  commander: { pauldron: 'L', kama: true, crest: true, rangefinder: 'stalk',
               pack: 'comms', cape: true, frame: 0.99 },
};

/**
 * The read at range is the helmet: a domed cranium, a hard brow, cheeks that
 * flare out and down, and a fin along the crown. Everything else is armour
 * that has to look like *separate plates over a bodysuit* rather than a white
 * paint job — so every plate is a curved shell standing a centimetre off the
 * black undersuit, with its own rim, its own rivets and a unit colour on the
 * pieces a squad actually paints: the crest, the shoulder bells, the knees.
 *
 * `opts.kit` names a row of TROOPER_KITS; the individual knobs may also be
 * passed directly and override it, so a check can sweep one piece at a time.
 */
export function buildTrooper(opts = {}) {
  const K = { ...(TROOPER_KITS[opts.kit] || TROOPER_KITS.line), ...opts };
  const S = opts.scale ?? 1.0;
  /**
   * GIRTH, AND WHY IT IS A KIT FIELD RATHER THAN A SCALE.
   *
   * `scale` grows a body in all three axes, so a heavy gunner built by turning
   * it up is a taller trooper — and the archetype's `hipHeight` and the gait
   * solver both read the height. `frame` is RADIAL only: the same 1.78 m
   * soldier, wider through the chest, the arms and the thighs. It is also the
   * only lever on this list that moves the bone PRIMARIES, which are 19 of the
   * 26 meshes a trooper keeps at thirty metres and most of its projected area,
   * so it is worth more to the read than every plate on the figure.
   *
   * Every limb plate is `limbPlate(bone, …)`, which raycasts the bone's own
   * tube and pushes out by a gap, so arms, forearms, thighs and shins refit
   * themselves. Only the torso arcs are typed against a radius, and `g()`
   * below is applied to exactly those.
   */
  const G = K.frame ?? 1;
  const g = (v) => v * G;
  const rig = new Rig(humanoidSkeleton(S), { scale: S });
  /** The half-cape's rigid stand-in and the shoulder it hangs from, or null — see K.cape below. */
  let cape = null;
  const plate = armorMat(opts.color ?? 0xe8e9ec, 0.08, 0.34, 3.0);
  // The undersuit was a bare MeshStandardMaterial: flat black vinyl over the
  // entire figure, and it is what you see at every joint.
  const under = clothMat(0x191c21, 0.88);
  const accent = armorMat(opts.accent ?? 0x2f6fbe, 0.1, 0.34, 3.0);
  // and the visor was bare too — dark glass wants scratches and a specular.
  // The colour is an option now so a company can be told apart by its glass;
  // the default is the dark plate every reference frame of this fight has.
  const visor = glassMat(opts.visor ?? 0x0a0d12, 0.13);
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
    /* THE UNIT COLOUR, ON A MESH THE LOD CANNOT TAKE AWAY.
     *
     * The clavicle primary runs from the sternum out to the point of the
     * shoulder and is the one tube on this body that is bare undersuit at
     * exactly the height a squad flash goes. Painting it costs nothing — the
     * mesh already exists and is already kept at every range — and it is what
     * takes trooper↔heavy↔jet↔officer off 0.000 visible-colour distance. */
    mats: { clav: accent },
    // the shoulder bell does the deltoid's job and then some
    deltoid: false,
    // A soldier in full plate, and he has to read as one from thirty metres
    // against a Jedi and a Sith wearing the same skeleton. Measured in a shared
    // world frame the trooper's front silhouette overlapped the Jedi's 84%:
    // same height, same width, same everything but the colour. So the bulk is
    // real — a deeper ribcage, heavier arms and legs, a wider collarbone and a
    // shoulder bell 23% bigger — rather than a paint difference.
    parts: { chestR: g(0.140), shoulderR: g(0.124), hipR: g(0.122), waistR: g(0.108),
             armR: g(0.057), clavR: g(0.074), thighR: g(0.100), neckR: 0.062, torsoDepth: 0.88 },
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
      /* The bar of the T runs the WHOLE brow — 15 cm on a 17 cm face — and
       * turns down at its ends into the cheeks; at 12.8 it stopped short of
       * the flare and read as goggles. */
      k.face(visor, plateGeo(0.150 * s, 0.036 * s, 0.026 * s, 0.005 * s, 1),
        onSurface(hg, brow, 0.010 * s, new THREE.Vector3(0, 0.108 * s, 0.055 * s)), brow);
      k.pair((sx) => {
        const drop = new THREE.Vector3(sx * 0.42, 0.10, 1).normalize();
        k.face(visor, plateGeo(0.030 * s, 0.052 * s, 0.024 * s, 0.005 * s, 1),
          onSurface(hg, drop, 0.010 * s, new THREE.Vector3(0, 0.096 * s, 0.055 * s)), drop);
      });
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
      k.bake(headObj);

      /* ── the head's OUTLINE, in one merged mesh that the LOD keeps ──
       *
       * Everything above is detail: a visor recess, a grille, ear vents and
       * rivets, none of it resolvable past thirty metres and all of it
       * correctly culled. Everything below changes the shape of the head
       * against the sky, which is the first thing a silhouette is read by —
       * and all of it is one material, so it merges to ONE extra draw call.
       */
      const ko = new Kit();
      // Crest: the fin along the crown, in unit colour, plus the stripes that
      // actually get painted on a helmet.
      const tall = K.crest ? 1.9 : 1.0;      // a commander's is raised and swept
      ko.add(accent, plateGeo(0.032 * s, 0.020 * s * tall, 0.174 * s, 0.007 * s, 1),
        [0, (0.226 + (K.crest ? 0.012 : 0)) * s, -0.016 * s], [0.04, 0, 0]);
      if (K.crest) {
        // the swept tail off the back of the crown, which is what turns a fin
        // into a plume from the flank — the view a firing line is read from
        ko.add(accent, plateGeo(0.026 * s, 0.052 * s, 0.096 * s, 0.008 * s, 1),
          [0, 0.222 * s, -0.128 * s], [0.62, 0, 0]);
      }
      ko.pair((sx) => {
        // aim()'s local X is ref × dir, which for a crown normal runs
        // front-to-back, and its local Z runs across. Authored the other way
        // round, this stripe was 13cm WIDE and 2cm long: a blue slab on each
        // side of the helmet rather than a stripe over the crown.
        const d = new THREE.Vector3(sx * 0.50, 0.86, 0.10).normalize();
        ko.aim(accent, plateGeo(0.130 * s, 0.006 * s, 0.022 * s, 0.002 * s, 1),
          onSurface(hg, d, 0.001 * s, new THREE.Vector3(0, 0.138 * s, -0.030 * s)), d);
      });
      /* The rangefinder. Two of them, because the two bodies that carry one
       * carry different ones: a Commander's folds down over the eye off a
       * short stalk, a Marksman's is a long tube clamped along the temple. It
       * is 4 cm of outline in the one place a helmet has none, and it is the
       * only thing on this roster that changes a HEAD's shape. */
      if (K.rangefinder) {
        const sx = K.pauldron === 'R' ? -1 : 1;   // opposite the shoulder plate
        if (K.rangefinder === 'scope') {
          ko.add(accent, new THREE.CylinderGeometry(0.016 * s, 0.014 * s, 0.170 * s, 8),
            [sx * 0.086 * s, 0.176 * s, 0.010 * s], [1.5708, 0, 0]);
          ko.add(accent, plateGeo(0.020 * s, 0.052 * s, 0.018 * s, 0.005 * s, 1),
            [sx * 0.086 * s, 0.146 * s, -0.030 * s]);
        } else {
          ko.add(accent, new THREE.CylinderGeometry(0.010 * s, 0.010 * s, 0.088 * s, 6),
            [sx * 0.084 * s, 0.208 * s, -0.020 * s], [0, 0, sx * -0.34]);
          ko.add(accent, plateGeo(0.030 * s, 0.086 * s, 0.026 * s, 0.006 * s, 1),
            [sx * 0.104 * s, 0.176 * s, 0.028 * s], [0.30, sx * 0.24, sx * -0.22]);
        }
      }
      markSilhouette(ko.bake(headObj));
    },

    dress(r, s) {
      const chestB = r.get('chest'), spineB = r.get('spine'), hipsB = r.get('hips');
      const D = 0.88;   // the torso's z squash — the plates have to match it

      /* ── torso: straps, boxes and scorch — detail, correctly culled ── */
      const k = new Kit();
      k.add(accent, arcGeo(g(0.150) * s, g(0.150) * s, 0.028 * s, 2.4, 0.008 * s, 8), [0, 0.150 * s, 0], null, [1, 1, D]);
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

      /* ── the torso's OUTLINE: the cuirass, and whatever is bolted to it ──
       *
       * The front, back and collar plates ARE the trooper's chest — 88% of the
       * torso's outline at thirty metres — and they were Kit detail, so what
       * survived the cull was the bare undersuit tube underneath. That is most
       * of how six clone archetypes came to share one silhouette. One material,
       * one merged mesh, one draw call. */
      const ko = new Kit();
      ko.add(plate, arcGeo(g(0.146) * s, g(0.132) * s, 0.230 * s, 2.55, 0.020 * s, 9), [0, -0.008 * s, 0], null, [1, 1, D]);
      ko.add(plate, arcGeo(g(0.146) * s, g(0.128) * s, 0.220 * s, 2.30, 0.018 * s, 8), [0, 0.000 * s, 0], [0, Math.PI, 0], [1, 1, D]);
      // collar that the helmet sits into
      ko.add(plate, bandGeo(g(0.104) * s, g(0.126) * s, g(0.086) * s, g(0.108) * s, 0.052 * s, 14), [0, 0.196 * s, 0], null, [1, 1, D + 0.1]);
      /* THE PAULDRON. One plate, over the leading shoulder, raked out and back.
       * `side` is the knob rather than a boolean because an ARC wearing it on
       * the right and a Commander on the left are two silhouettes from the
       * flank and one from the front — and the flank is the view a firing line
       * is met in. */
      if (K.pauldron) {
        const sides = K.pauldron === 'both' ? [-1, 1] : [K.pauldron === 'L' ? -1 : 1];
        /* A mantle is the dark gear leather; a single pauldron is plate. */
        const pm = K.pauldron === 'both' ? gear : plate;
        /* A mantle rides ON TOP of the shoulder bells — a single pauldron is
         * seated inboard of one, where the bell would swallow a mantle. */
        const lift = K.pauldron === 'both' ? 0.096 * s : 0;
        for (const sx of sides) {
          ko.add(pm, plateGeo(0.132 * s, 0.052 * s, 0.186 * s, 0.020 * s, 2),
            [sx * g(0.170) * s, 0.132 * s + lift, -0.006 * s], [0, 0, sx * -0.40]);
          ko.add(pm, plateGeo(0.104 * s, 0.044 * s, 0.150 * s, 0.016 * s, 2),
            [sx * g(0.196) * s, 0.086 * s + lift, -0.004 * s], [0, 0, sx * -0.52]);
        }
        if (K.pauldron === 'both') {
          // the yoke the two halves hang from, over the collar, and the
          // ammunition pouches down its front
          ko.add(gear, plateGeo(g(0.360) * s, 0.034 * s, 0.170 * s, 0.014 * s, 2), [0, 0.222 * s, -0.010 * s]);
          ko.add(gear, plateGeo(0.140 * s, 0.070 * s, 0.030 * s, 0.008 * s, 1),
            onLimb(chestB, 0.150 * s, [0, 0, 1], -0.006 * s), [0.20, 0, 0]);
        }
      }
      /* THE BRACE. A marksman's cheek-weld needs somewhere for the stock to
       * go, and it is the one piece that separates him from the line trooper
       * he is otherwise built from bolt for bolt. */
      if (K.brace) {
        ko.add(plate, plateGeo(0.086 * s, 0.030 * s, 0.120 * s, 0.010 * s, 1),
          [-g(0.132) * s, 0.176 * s, 0.010 * s], [0, 0, 0.30]);
      }
      markSilhouette(ko.bake(chestB.obj));

      /* THE COMMANDER'S CAPE. Rigid, not cloth: `cloth-cost` sizes the whole
       * simulated-garment column on how many bodies wear one, and this mode
       * fields a line of twenty. Hung off the pauldron's own shoulder so it
       * falls down ONE side of the body — a half-cape reads as rank where a
       * closed cone reads as a robe, and this figure must not read as a Jedi
       * from behind. */
      if (K.cape) {
        /* HUNG SO IT FLARES BACKWARD, not flat against the shoulder blade.
         * The first cut was 32 cm across and 3 cm deep: from the flank — the
         * view a line of infantry is met in — it was a 3 cm edge, and the ARC
         * and the Commander stayed 0.916 alike. A cape is read from the side,
         * so its depth is the dimension that has to be real. */
        /**
         * …AND IT IS THE STAND-IN NOW, NOT THE CAPE. The player: "are the
         * capes for troopers even actual cloth like my capes? they look
         * completely solid." These two plates are what a body at range wears
         * and what a body inside the cloth cut has hidden under a simulated
         * sheet — `attachTrooperCape` (Cloth.js) takes them over exactly as
         * `attachSkirt` takes the robe's lathes, and hands them back past the
         * cut. So the plates are still built (the flank silhouette above is
         * still theirs) and are PUBLISHED, with the shoulder they hang from,
         * as `cape` on the built body: `{ sx, rigid }`. `sx` is the sign the
         * pauldron side resolves to in this frame, which is the one honest
         * statement of which shoulder the cape is on. */
        const kc = new Kit();
        const sx = K.pauldron === 'R' ? 1 : -1;
        kc.add(gear, plateGeo(0.300 * s, 0.620 * s, 0.230 * s, 0.030 * s, 2),
          [sx * 0.060 * s, -0.180 * s, -0.200 * s], [0.30, sx * 0.16, sx * 0.05]);
        kc.add(gear, plateGeo(0.250 * s, 0.150 * s, 0.150 * s, 0.024 * s, 1),
          [sx * 0.104 * s, 0.140 * s, -0.116 * s], [0.16, sx * 0.28, sx * -0.22]);
        cape = { sx, rigid: markSilhouette(kc.bake(chestB.obj)) };
      }

      /* ── the pack ──
       *
       * Command.js's handover: "`jet` is a trooper with `float: 1.35` and no
       * hardware — it hovers, but nothing on the model says why." Two packs,
       * because the two bodies that carry one carry opposite ones: a raider's
       * is compact and points DOWN, a suppression gunner's is a box with a
       * weapon slung across it and points sideways. Both hang off the chest
       * bone so they roll with the torso, and both are tagged silhouette —
       * a pack culled at thirty metres answers nothing. */
      if (K.pack) {
        const kp = new Kit();
        const jet = K.pack === 'jet';
        if (jet) {
          /**
           * A JETPACK THAT LOOKS LIKE A JETPACK. Note #33: "the jet troopers
           * look awkward and funny as hell it's like they're magically sitting
           * in the air and floating like you need to do a way better job, they
           * need to have actual jetpacks and exhaust and engines that fire and
           * thrust and makes sounds."
           *
           * The pack was already here — a spine block and two nozzles — and
           * every one of the three things named after "jetpacks" was not: no
           * exhaust, no engine that fires, no sound. A shape on a back is not
           * an explanation for a man in the air; a FLAME is.
           *
           * So the nozzles are bigger and canted, they get intake scoops and
           * heat shrouding so they read as engines rather than as pipes, and —
           * the part that matters — each one keeps a live `jets` handle so
           * `Enemy._jetFx` can drive a plume out of it. That handle is why the
           * two cones below are separate meshes instead of being baked into
           * the kit with everything else: a merged nozzle cannot be lit.
           */
          /* ── BIGGER, AND IN THE ARMOUR'S OWN COLOUR ──────────────────────
           *
           * The pack was here all along and the report kept saying it was not:
           * "I still don't see their jet packs or thrusters." Rendered on its
           * own it turns out to be true enough — a 19 x 25 cm block with two
           * dark-grey cans on a body wearing a BLACK undersuit, so the whole
           * assembly was gear-coloured hardware against a gear-coloured back at
           * whatever range a jet trooper is actually seen from. It read as
           * webbing.
           *
           * A jump pack is the biggest thing a man wears and it is the reason
           * he is in the air, so it is a third larger, it stands further off
           * the spine, and the cans are `plate` — the white armour — with the
           * dark `gear` kept for the shrouding and the bells. Two tones on a
           * pack is what makes it a pack rather than a lump. */
          kp.add(plate, plateGeo(0.250 * s, 0.320 * s, 0.140 * s, 0.024 * s, 2), [0, 0.086 * s, -0.196 * s]);
          kp.add(gear, plateGeo(0.210 * s, 0.070 * s, 0.120 * s, 0.014 * s, 1), [0, -0.070 * s, -0.198 * s]);
          kp.add(accent, plateGeo(0.060 * s, 0.190 * s, 0.020 * s, 0.006 * s, 1), [0, 0.100 * s, -0.268 * s]);
          // the shoulder yoke that carries it, so it is strapped ON rather than
          // stuck to the back
          kp.pair((sx) => kp.add(gear, plateGeo(0.048 * s, 0.150 * s, 0.056 * s, 0.010 * s, 1),
            [sx * 0.108 * s, 0.150 * s, -0.130 * s], [0.34, 0, 0]));
          kp.pair((sx) => {
            // the engine can: a fat cylinder standing proud of the block
            kp.add(plate, new THREE.CylinderGeometry(0.062 * s, 0.070 * s, 0.230 * s, 10),
              [sx * 0.100 * s, 0.030 * s, -0.226 * s], [0.24, 0, sx * 0.12]);
            // an intake scoop at the top of it
            kp.add(gear, new THREE.CylinderGeometry(0.072 * s, 0.058 * s, 0.052 * s, 10),
              [sx * 0.100 * s, 0.152 * s, -0.240 * s], [0.24, 0, sx * 0.12]);
            // heat shrouding: three rings down the can
            for (let i = 0; i < 3; i++) {
              kp.add(gear, bandGeo(0.062 * s, 0.076 * s, 0.062 * s, 0.076 * s, 0.014 * s, 10),
                [sx * 0.100 * s, (0.000 - i * 0.054) * s, (-0.226 - i * 0.013) * s], [0.24, 0, sx * 0.12]);
            }
            // and the bell it fires out of, angled down and outward
            kp.add(gear, new THREE.CylinderGeometry(0.046 * s, 0.072 * s, 0.084 * s, 10),
              [sx * 0.100 * s, -0.096 * s, -0.252 * s], [0.24, 0, sx * 0.12]);
          });
        } else if (K.pack === 'scout') {
          // a flat scout pack with a folded bipod down it — narrow, so the
          // marksman stays the thinnest body in the clone rack
          kp.add(gear, plateGeo(0.130 * s, 0.220 * s, 0.070 * s, 0.014 * s, 1), [0, 0.076 * s, -0.156 * s]);
          kp.add(gear, new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.320 * s, 6),
            [0.052 * s, 0.070 * s, -0.196 * s], [0.10, 0, 0.18]);
          kp.add(gear, new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.320 * s, 6),
            [-0.052 * s, 0.070 * s, -0.196 * s], [0.10, 0, -0.18]);
        } else if (K.pack === 'comms') {
          // the command pack: a slab with a tall whip antenna, which is 40 cm
          // of outline above the shoulder line and nothing else on the roster
          // has anything there at all
          kp.add(plate, plateGeo(0.190 * s, 0.240 * s, 0.096 * s, 0.018 * s, 2), [0, 0.076 * s, -0.166 * s]);
          kp.add(accent, plateGeo(0.140 * s, 0.030 * s, 0.020 * s, 0.006 * s, 1), [0, 0.172 * s, -0.216 * s]);
          kp.add(gear, new THREE.CylinderGeometry(0.007 * s, 0.010 * s, 0.520 * s, 5),
            [-0.078 * s, 0.420 * s, -0.176 * s], [0.06, 0, 0.10]);
          kp.add(gear, plateGeo(0.070 * s, 0.070 * s, 0.024 * s, 0.008 * s, 1),
            [0.070 * s, 0.176 * s, -0.212 * s], [0.20, -0.30, 0]);
        } else {
          // ammunition box and the power feed that runs down to the repeater
          // IN HIS HANDS — the barrel bundle that used to be slung across
          // this pack was a second Z-6 on a man already carrying one
          kp.add(plate, plateGeo(0.230 * s, 0.250 * s, 0.130 * s, 0.022 * s, 2), [0, 0.062 * s, -0.184 * s]);
          kp.add(gear, plateGeo(0.150 * s, 0.084 * s, 0.060 * s, 0.012 * s, 1), [0, -0.062 * s, -0.190 * s]);
          kp.add(gear, new THREE.CylinderGeometry(0.020 * s, 0.020 * s, 0.230 * s, 6),
            [0.096 * s, 0.062 * s, -0.150 * s], [0, 0, 0.24]);
          // two spare drums clipped to the pack's flank
          kp.pair((sx) => kp.add(gear, new THREE.CylinderGeometry(0.052 * s, 0.052 * s, 0.040 * s, 8),
            [sx * 0.130 * s, 0.040 * s, -0.190 * s], [0, 0, 1.5708]));
        }
        markSilhouette(kp.bake(chestB.obj));
        /**
         * THE FLAME, and it is two live meshes rather than part of the kit.
         *
         * A merged nozzle cannot be lit and cannot be scaled, and the whole of
         * "engines that fire and thrust" is a plume whose LENGTH answers what
         * the body is doing — long and white when it is climbing, a blue
         * pilot flame when it is holding station. `Enemy._jetFx` drives them;
         * they are stored on the rig because that is the object the Enemy has
         * a handle to.
         *
         * Cones with the point DOWN, additive and depth-written-off, which is
         * the same treatment every other self-luminous thing in this game gets
         * — a flame that occludes what is behind it is a solid object.
         */
        if (jet) {
          /* VERTEX COLOURS ALONG THE PLUME, and this is what stopped it looking
           * like a paper cone. A flat additive cone in one colour is a flat
           * additive cone: uniform from the bell to the tip, hard-edged, and
           * exactly as bright where it leaves the nozzle as where it dies. Real
           * thrust is white-hot at the throat, blue through the body, and gone
           * at the end — so the colour and the ALPHA both ramp down the length,
           * and the taper does the rest. Baked into the geometry rather than
           * done in a shader because it is two cones per trooper and the flame
           * material is shared by every jet body in the level. */
          const flame = new THREE.MeshBasicMaterial({
            color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.9,
            depthWrite: false, blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide, toneMapped: false,
          });
          rig.jets = [];
          for (const sx of [1, -1]) {
            const geo = new THREE.ConeGeometry(0.052 * s, 0.34 * s, 8, 1, true);
            geo.translate(0, -0.17 * s, 0);
            {
              // y runs 0 at the throat to -0.34s at the tip
              const pos = geo.attributes.position;
              const col = new Float32Array(pos.count * 3);
              const HOT = [1.0, 0.98, 0.94], MID = [0.55, 0.78, 1.0];
              for (let v = 0; v < pos.count; v++) {
                const t = clamp(-pos.getY(v) / (0.34 * s), 0, 1);
                // white throat → blue body → nothing, with the fade weighted
                // late so the plume has a body rather than a gradient
                const f = (1 - t) ** 1.6;
                col[v * 3] = (HOT[0] * (1 - t) + MID[0] * t) * f;
                col[v * 3 + 1] = (HOT[1] * (1 - t) + MID[1] * t) * f;
                col[v * 3 + 2] = (HOT[2] * (1 - t) + MID[2] * t) * f;
              }
              geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
            }
            const m = new THREE.Mesh(geo, flame);
            m.position.set(sx * 0.100 * s, -0.140 * s, -0.262 * s);
            m.rotation.set(0.24, 0, sx * 0.12);
            m.scale.set(1, 0.001, 1);
            m.castShadow = false; m.receiveShadow = false;
            m.userData.jetFlame = true;
            chestB.obj.add(m);
            rig.jets.push(m);
          }
        }
      }

      /* ── abdomen: three overlapping bands, so the waist articulates ── */
      const ks = new Kit();
      ks.row(3, (i, t) => {
        const y = (0.020 + i * 0.062) * s;
        ks.add(plate, arcGeo(g(0.126 + i * 0.006) * s, g(0.130 + i * 0.006) * s, 0.050 * s, 2.9, 0.014 * s, 8),
          [0, y, 0], null, [1, 1, D]);
        ks.add(plate, arcGeo(g(0.124 + i * 0.006) * s, g(0.128 + i * 0.006) * s, 0.048 * s, 2.2, 0.012 * s, 7),
          [0, y, 0], [0, Math.PI, 0], [1, 1, D]);
      });
      ks.bake(spineB.obj);

      /* ── belt, codpiece and pouches — detail ── */
      const kh = new Kit();
      kh.add(gear, bandGeo(g(0.118) * s, g(0.136) * s, g(0.118) * s, g(0.136) * s, 0.056 * s, 16), [0, 0.056 * s, 0], null, [1, 1, D + 0.06]);
      kh.add(plate, plateGeo(0.052 * s, 0.046 * s, 0.024 * s, 0.006 * s, 1), onLimb(hipsB, 0.080 * s, [0, 0, 1], -0.008 * s));
      kh.pair((sx) => {
        kh.add(gear, plateGeo(0.052 * s, 0.058 * s, 0.036 * s, 0.010 * s, 1),
          onLimb(hipsB, 0.052 * s, [sx * 0.85, 0, 0.62], -0.016 * s), [0, -sx * 0.5, 0]);
      });
      /* THE HOLSTERS. An ARC carries two sidearms on the belt in every plate
       * there is, and they are the piece that reads at three metres where the
       * kama reads at thirty. */
      if (K.holsters) {
        kh.pair((sx) => {
          kh.add(gear, plateGeo(0.048 * s, 0.130 * s, 0.062 * s, 0.010 * s, 1),
            [sx * 0.126 * s, -0.030 * s, 0.028 * s], [0.14, 0, sx * 0.24]);
          // …and the pistol IN it: the grip standing out of the top of the
          // holster, raked back, and the receiver's spine along the belt
          kh.add(plate, plateGeo(0.022 * s, 0.070 * s, 0.032 * s, 0.006 * s, 1),
            [sx * 0.134 * s, 0.052 * s, 0.006 * s], [0.62, 0, sx * 0.24]);
          kh.add(plate, plateGeo(0.026 * s, 0.024 * s, 0.070 * s, 0.006 * s, 1),
            [sx * 0.132 * s, 0.036 * s, 0.038 * s], [0.14, 0, sx * 0.24]);
        });
      }
      kh.bake(hipsB.obj);

      /* ── the hips' OUTLINE: the tassets, and the kama over them ──
       *
       * The four tasset arcs are the only thing standing between the belt and
       * two bare undersuit thighs, and they were culled at exactly the range
       * that matters. */
      const kho = new Kit();
      kho.add(plate, arcGeo(g(0.120) * s, g(0.126) * s, 0.130 * s, 1.5, 0.016 * s, 6), [0, -0.062 * s, 0], null, [1, 1, D]);
      kho.add(plate, arcGeo(g(0.120) * s, g(0.126) * s, 0.150 * s, 1.7, 0.016 * s, 6), [0, -0.076 * s, 0], [0, Math.PI, 0], [1, 1, D]);
      kho.pair((sx) => {
        kho.add(plate, arcGeo(g(0.118) * s, g(0.122) * s, 0.120 * s, 0.9, 0.014 * s, 5), [0, -0.058 * s, 0], [0, sx * 1.42, 0], [1, 1, D]);
      });
      /* THE KAMA. Command.js asked for one for `arc` and `officer` — "at three
       * metres they read as the same body" — and pointed at `attachSkirt`.
       * This is not that: a simulated garment is the most expensive per-body
       * system in the game and `cloth-cost` sizes the whole column on how many
       * bodies wear one. Four hanging leaves off the belt are rigid geometry
       * on the hips bone, cost one draw call, and do the whole job a kama does
       * at range — they break the leg line and add 22 cm of outline below the
       * belt where every other clone has none. */
      if (K.kama) {
        /* An ARC's is to the knee and a Commander's stops at mid-thigh, which
         * is the reference plates' own distinction and the one that keeps the
         * roster's two kama-wearing bodies apart below the belt while the cape
         * keeps them apart above it. */
        const kl = K.kama === 'long' ? 1.34 : 1;
        for (const [bearing, arc, len0] of [[0, 1.35, 0.300], [Math.PI, 1.55, 0.320],
                                            [1.45, 0.85, 0.260], [-1.45, 0.85, 0.260]]) {
          const len = len0 * kl;
          kho.add(gear, arcGeo(g(0.132) * s, g(0.150) * s, len * s, arc, 0.012 * s, 7),
            [0, -0.052 * s - len * s, 0], [0, bearing, 0], [1, 1, D]);
        }
      }
      markSilhouette(kho.bake(hipsB.obj));

      /* ── shoulders, arms ── */
      for (const side of ['L', 'R']) {
        const arm = r.get('arm' + side), fore = r.get('fore' + side);
        if (arm) {
          const ka = new Kit();
          const L = arm.length;
          // Shoulder bell on the humerus, so it rolls with the shoulder. The
          // sphere's pole is +Y, i.e. down the arm, so it is turned over.
          const bell = new THREE.SphereGeometry(g(0.106) * s, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.56);
          bell.scale(1.0, 1.02, 1.06);
          // `bells: false` is the marksman's, and it is a REMOVAL rather than
          // an addition on purpose — see TROOPER_KITS.marksman.
          if (K.bells !== false) ka.add(plate, bell, [0, 0.030 * s, 0], [Math.PI, 0, 0]);
          // The rolled rim, ON the bell's own open edge — which is at y =
          // 0.049 and radius 0.096, measured off the sphere rather than
          // guessed. The band that was here sat at y = 0.086 with an outer
          // radius of 0.100 around an arm of radius 0.048: a white hoop
          // floating four centimetres off the bicep, while the bell itself
          // stayed a zero-thickness shell you could see the inside of.
          if (K.bells !== false) {
            ka.add(plate, bandGeo(g(0.0930) * s, g(0.1095) * s, g(0.0965) * s, g(0.1095) * s, 0.032 * s, 14),
              [0, 0.030 * s, 0], null, [1, 1, 1.06]);
          }
          // biceps plate over the suit
          ka.add(plate, limbPlate(arm, L * 0.34, L * 0.78, 3.1, { thick: 0.012 * s, seg: 7, gap: 0.005 * s }),
            [0, L * 0.34, 0]);
          /* The bell, its rim and the biceps plate are ONE material and ONE
           * merged mesh, and they are the widest point of the figure — the
           * line from the ear to the point of the shoulder that a human
           * silhouette is read by first. Kept; the unit stripe under them is
           * three centimetres of arc and is not, because the clavicle primary
           * now carries that colour at the same height for nothing. */
          markSilhouette(ka.bake(arm.obj));
          /* THE UNIT STRIPE ROUND THE BELL IS GONE, and that is the accent
           * pass paying for itself rather than adding to the bill. It was a
           * 60-triangle arc per arm at the top of the humerus — 3 cm tall, on
           * the one bone whose Kit is culled first, and measured at exactly
           * zero pixels past thirty metres. The clavicle primary now carries
           * the same colour at the same height and is never culled, so this
           * was a hundred and twenty triangles of paint nobody ever saw. */
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
  /* `cape` is null on every trooper that does not wear one, so a caller can
   * test it the way `Enemy._build` tests `robeSkirt`: no field, no cloth. */
  return { rig, palette: { plate, under, accent, visor, gear, scorch }, cape };
}

/* ── sith acolyte (saber duelist) ────────────────────────────────────── */

/**
 * A SPARRING PARTNER IS NOT A SITH, AND IT MEASURED 1.000 LIKE ONE.
 *
 * `acolyte` and `sparring` are the same call to this builder with the same
 * arguments — same scale, same palette, same hood — so the dojo's 3-damage
 * practice body and the roster's Sith duellist were byte-for-byte one figure
 * and the flank IoU said exactly that: 1.000 at LOD 1. A player who has learnt
 * to fear the black hood has learnt to fear the training dummy.
 *
 * The sparring kit takes the hood OFF (the one thing this head is read by) and
 * puts a padded plastron on the chest, which is what a fencing partner wears
 * and what nothing else on the roster wears.
 */
export const ACOLYTE_KITS = {
  sith: {},
  /* `frame` is radial girth, exactly as TROOPER_KITS uses it: a body wearing a
   * padded practice jacket is a wider body, and the primaries are most of what
   * survives the cull. */
  sparring: { hood: false, plastron: true, frame: 1.12 },
};

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
  /** See ACOLYTE_KITS. `hood` and `plastron` may also be passed directly. */
  const K = { ...(ACOLYTE_KITS[opts.kit] || ACOLYTE_KITS.sith), ...opts };
  const S = opts.scale ?? 1.04;
  const G = K.frame ?? 1, g = (v) => v * G;   // radial girth — see ACOLYTE_KITS
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
    parts: { chestR: g(0.146), shoulderR: g(0.126), hipR: g(0.124), waistR: g(0.106),
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
      //
      // KEPT AT RANGE. It is the single largest thing on this head and it was
      // Kit-adjacent decoration, so past thirty metres the roster's hooded
      // duellist was a bare 12 cm ball — the same ball a Jedi wears.
      if (K.hood !== false) {
        const cowl = new THREE.SphereGeometry(0.142 * s, 16, 12,
          Math.PI * 0.80, Math.PI * 1.40, 0, Math.PI * 0.72);
        cowl.scale(1.02, 1.10, 1.14);
        cowl.translate(0, 0.052 * s, -0.024 * s);
        markSilhouette(mesh(cowl, hoodMat, headObj));
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
        markSilhouette(mesh(new THREE.TorusGeometry(0.112 * s, 0.018 * s, 5, 16), hoodMat, headObj,
          [0, 0.100 * s, 0.020 * s], [-0.34, 0, 0]));
      }
      k.bake(headObj);
    },

    dress(r, s) {
      const chestB = r.get('chest'), spineB = r.get('spine'), hipsB = r.get('hips');

      /* ── coat: an asymmetric wrap, right lapel over left ── */
      const k = new Kit();
      k.add(robe, arcGeo(0.140 * s, 0.130 * s, 0.250 * s, 3.4, 0.016 * s, 9), [0, -0.020 * s, 0], null, [1, 1, 0.74]);
      k.add(robe, arcGeo(0.142 * s, 0.132 * s, 0.240 * s, 2.0, 0.020 * s, 7), [0, -0.014 * s, 0], [0, 0.42, 0], [1, 1, 0.74]);
      k.add(inner, arcGeo(0.136 * s, 0.128 * s, 0.180 * s, 1.1, 0.010 * s, 5), [0, 0.030 * s, 0], [0, -0.30, 0], [1, 1, 0.74]);
      k.add(leather, bandGeo(0.186 * s, 0.206 * s, 0.184 * s, 0.204 * s, 0.024 * s, 18), [0, 0.088 * s, 0], null, [1, 1, 0.78]);
      // studs on the collar band's own outer face — the band is 18.4cm across
      // and 14.7 deep after the torso squash, so a circle of 17.2 is inside it
      k.row(9, (i, t) => {
        const a = t * Math.PI * 2;
        k.add(trim, stud, [Math.sin(a) * 0.210 * s, 0.100 * s, Math.cos(a) * 0.164 * s], [1.5708, a, 0]);
      });
      k.bake(chestB.obj);

      /* ── the shoulders' OUTLINE ──
       * "The one place the acolyte is allowed to be wide" — its own words for
       * the mantle, and it was culled at thirty metres along with everything
       * else, which is how a narrow-shouldered duellist in a bell-hemmed coat
       * came to share 0.849 of a silhouette with a Jedi. */
      const ko = new Kit();
      ko.add(robe, bandGeo(g(0.112) * s, g(0.196) * s, g(0.082) * s, g(0.120) * s, 0.170 * s, 18), [0, 0.084 * s, 0], null, [1, 1, 0.78]);
      /* THE PLASTRON. Padded, square, and worn over everything — the shape a
       * fencing partner has and a Sith does not. See ACOLYTE_KITS. */
      if (K.plastron) {
        /* Sized to stand OUTSIDE the mantle it replaces — the first version was
         * 32 cm across against a 39 cm mantle and 15 cm deep against a 30 cm
         * torso, so it was entirely inside the outline it was meant to change
         * and the pair moved 0.006. A padded jacket is bigger than the body. */
        ko.add(inner, plateGeo(0.470 * s, 0.420 * s, 0.330 * s, 0.070 * s, 3), [0, 0.030 * s, 0.010 * s]);
        ko.add(inner, bandGeo(0.180 * s, 0.212 * s, 0.180 * s, 0.212 * s, 0.240 * s, 14), [0, -0.090 * s, 0], null, [1, 1, 0.86]);
      }
      markSilhouette(ko.bake(chestB.obj));

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

      /* ── the coat's LINING, which is also its range proxy ──
       *
       * The eight panels above are the whole read on this body — "narrow
       * shoulders over a bell", its own words — and eight separate meshes is
       * eight draw calls, so tagging them all would cost more at range than
       * the whole rest of the figure. A single lathe just inside them does the
       * same job in one: at thirty metres it IS the bell, and up close it
       * fills the eight gaps the panels leave, which is a fix in its own right
       * — before this you could see a bare thigh between every pair of them.
       *
       * Cut 4 cm shorter than the panels and 2 cm inside their inner edge, so
       * it is never the outermost surface at any bearing and cannot z-fight. */
      const kl = new Kit();
      kl.add(robe, limbGeo(0.500 * s, 0.126 * s, 0.196 * s, 16, false,
        { rings: 4, bulge: 0, section: (th, t) => 1 + Math.pow(t, 1.3) * 0.05 * Math.cos(8 * th + Math.PI / 8) }),
        [0, -0.030 * s, 0], [0, 0, Math.PI], [1, 1, 0.86]);
      markSilhouette(kl.bake(hipsB.obj));

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
  /* BRONZE, NOT KHAKI. Every plate of the reference shows a destroyer in a
   * burnt copper-brown shell over near-black joints — it is the one Trade
   * Federation body that is not tan — and the 0x93805f that was here put it
   * in a B1's paint. The dark is warmer too, for the same reason. */
  const shell = armorMat(opts.color ?? 0x7a4a2e, 0.42, 0.56, 4.0);
  // was bare — every leg, every gun and the whole underside was flat plastic
  const dark = metalMat(0x2a2320, 0.5, 0.7, 4.0);
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
  /* THE COWL — the read of a droideka from every angle. Behind and above the
   * body a tall curved shell arcs up and over, the piece the droid curls into
   * when it rolls; unfolded it stands the height of the body again above the
   * carapace, ribbed, open at the front where the head and the guns come
   * out. Without it what stood here was a squat drum on three legs. Two
   * arcs of shell in the body's own material and three ribs on them, so it
   * costs geometry and no draw calls. */
  {
    /* A SHELL, NOT AN EGG: a thin arc of sphere over the back and top only —
     * the first cut was a 0.40·S cap over two thirds of the body and read as
     * a boulder the droid was hiding behind. */
    const cowl = new THREE.SphereGeometry(0.345 * S, 14, 9, Math.PI * 0.64, Math.PI * 0.72, 0, Math.PI * 0.50);
    cowl.scale(0.94, 1.22, 1.00);
    kc.add(shell, cowl, [0, 0.08 * S, -0.12 * S]);
    const inner = new THREE.SphereGeometry(0.325 * S, 12, 8, Math.PI * 0.66, Math.PI * 0.68, 0, Math.PI * 0.46);
    inner.scale(0.94, 1.22, 1.00);
    kc.add(dark, inner, [0, 0.09 * S, -0.12 * S]);
    // three ribs down the outside of it, which is the read from behind
    for (const a of [-0.55, 0, 0.55]) {
      kc.add(dark, arcGeo(0.350 * S, 0.340 * S, 0.026 * S, 1.50, 0.012 * S, 9),
        [Math.sin(Math.PI + a) * 0.02 * S, 0.26 * S, -0.12 * S + Math.cos(Math.PI + a) * 0.02 * S],
        [Math.PI / 2, 0, Math.PI + a], [1, 1.22, 1]);
    }
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

  // deflector shield bubble — the same one the player's Force barrier uses
  const { mesh: shield, mat: shieldMat } = buildShieldBubble({ radius: 1.15 * S });
  shield.position.y = 0.75 * S;
  group.add(shield);

  return { group, core, headG, legs, arms, shield, shieldMat, palette: { shell, dark, scorch, eye }, scale: S };
}

/**
 * A DEFLECTOR BUBBLE — one implementation, two owners.
 *
 * It was written inline inside `buildDroideka` and it is lifted out here
 * because the player has one now: "did you already add the force shield/bubble
 * in the game? i'd already asked for it but I could have missed it." They had
 * not missed it. It was not there, and the shader that draws exactly this
 * thing had been sitting in a droid's constructor the whole time.
 *
 * Two owners with one shader is the point. A player who has learned to read a
 * droideka's bubble — the fresnel rim that brightens where you are looking
 * through it edge-on, the hex weave, the slow vertical ripple — reads their own
 * the same way, and a change to how a deflector looks is one edit rather than
 * two that drift.
 *
 * `uPower` is the only thing a caller animates: 0 is down, 1 is up, and every
 * term in the fragment is multiplied by it, so a shield fading in fades in
 * whole rather than appearing at full strength and then growing.
 */
export function buildShieldBubble(opts = {}) {
  const radius = opts.radius ?? 1.15;
  const geo = new THREE.SphereGeometry(radius, opts.segments ?? 24, opts.rings ?? 18);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(opts.color ?? 0x66ddff) },
      uTime: { value: 0 },
      uPower: { value: 0 },
    },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal);
        vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uPower;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        /* CEL, LIKE EVERYTHING ELSE. Cel.js works by rewriting three's own
           ShaderChunks, so it reaches every material that INCLUDES them — and a
           hand-written ShaderMaterial like this one includes none, which is why
           the barrier was the one surface in the game still wearing a smooth
           photographic falloff. The fresnel, the hex weave and the ripple are
           all kept; they are quantised into flat steps on the way out, per
           src/toon/REFERENCE.md. The fwidth term antialiases the step edge
           without softening it — a hard edge that crawls is worse than no hard
           edge at all on a curved surface this large. */
        float fres = pow(1.0-abs(dot(normalize(vN),normalize(vV))), 2.4);
        float hexes = sin(vP.x*26.0)*sin(vP.y*26.0)*sin(vP.z*26.0);
        float ripple = 0.5+0.5*sin(vP.y*14.0 - uTime*4.0);
        float raw = fres*0.85 + max(hexes,0.0)*0.14 + ripple*0.05;
        float e = max(fwidth(raw)*0.5, 0.004);
        float s1 = smoothstep(0.16-e, 0.16+e, raw);
        float s2 = smoothstep(0.42-e, 0.42+e, raw);
        float s3 = smoothstep(0.72-e, 0.72+e, raw);
        float band = (0.10 + s1*0.24 + s2*0.30 + s3*0.36);
        float a = band * uPower;
        gl_FragColor = vec4(uColor*(a*2.2), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  /* NOT INKED. `Ink.js` hides anything transparent for its prepass and shows it
   * again; a bubble drawn into the normal buffer would put a hard outline round
   * the player's own head. See `cutsItsOwnSilhouette`. */
  mat.userData.saberNoInk = true;
  mesh.frustumCulled = false;
  return { mesh, mat };
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
  /* THE SPHERE ON LEGS. Levels.js names this body as the OG-9 homing spider
   * droid — "a sphere on four very tall thin legs" — and the plates the
   * roster was built from show its little brother, the dwarf spider droid:
   * the same ball, two great red lenses on the front of it, one long cannon
   * under them and a whip antenna on top. What stood here was an armoured
   * TUB with a turret on the back — a tank on legs, and nothing in either
   * plate. The body is a ball now, the face is the front of it, and the head
   * bone sits there so the eyes and the gun track a target together. */
  const rig = new Rig(walkerSkeleton(S, 4, { headAt: [0, 0.14, 0.34] }), { scale: S });
  const shell = armorMat(0x6f6a60, 0.6, 0.45, 3.0);
  const dark = metalMat(0x2b2a27, 0.5, 0.72, 3.0);
  const mark = armorMat(0xa8621e, 0.1, 0.6, 3.0);
  const glass = glassMat(0x3a0c08, 0.16);
  const eye = emissiveMat(0xff2a18, 2.6);
  const hot = emissiveMat(0xff6622, 1.2);
  const scorch = scorchMat();

  const riv = rivet(0.022 * S);

  /* ── hull: the ball ── */
  const body = rig.get('body');
  const hull = assemble([
    [(() => { const g = new THREE.SphereGeometry(0.60 * S, 22, 16); g.scale(1.0, 0.92, 1.0); return g; })(), [0, 0.14 * S, 0]],
    // the flat underbelly the legs socket into, and the chin under the face
    [plateGeo(0.90 * S, 0.16 * S, 0.90 * S, 0.06 * S, 2), [0, -0.30 * S, 0]],
    [plateGeo(0.62 * S, 0.22 * S, 0.30 * S, 0.06 * S, 1), [0, -0.16 * S, 0.44 * S], [0.5, 0, 0]],
  ], 'hull');
  const bm = mesh(hull, shell, body.obj);
  body.parts.push(bm); body.primary = bm; body.radius = 0.6 * S;

  const kb = new Kit();
  // the seam round the ball's equator, and the hatch line over the crown
  kb.add(dark, bandGeo(0.596 * S, 0.612 * S, 0.596 * S, 0.612 * S, 0.030 * S, 24), [0, 0.14 * S, 0]);
  kb.add(dark, plateGeo(0.030 * S, 0.020 * S, 0.80 * S, 0.006 * S, 1), [0, 0.688 * S, -0.06 * S]);
  // the whip antenna off the crown
  kb.add(dark, new THREE.CylinderGeometry(0.030 * S, 0.036 * S, 0.06 * S, 8), [0.16 * S, 0.70 * S, -0.16 * S]);
  kb.add(dark, new THREE.CylinderGeometry(0.006 * S, 0.012 * S, 0.90 * S, 6), [0.16 * S, 1.16 * S, -0.16 * S], [0.06, 0, -0.04]);
  kb.pair((sx) => {
    // the hip sponsons the legs hang off, low on the flanks
    kb.add(shell, plateGeo(0.22 * S, 0.24 * S, 0.80 * S, 0.05 * S, 1), [sx * 0.50 * S, -0.22 * S, 0]);
    kb.row(4, (i, t) => kb.add(dark, riv, [sx * 0.61 * S, -0.12 * S, (t - 0.5) * 0.60 * S], [0, 0, -sx * 1.5708]));
    // exhaust stacks off the back of the ball
    kb.add(dark, new THREE.CylinderGeometry(0.060 * S, 0.070 * S, 0.30 * S, 8), [sx * 0.22 * S, 0.36 * S, -0.56 * S], [-1.1, 0, 0]);
    kb.add(hot, new THREE.CylinderGeometry(0.048 * S, 0.054 * S, 0.05 * S, 8), [sx * 0.22 * S, 0.43 * S, -0.70 * S], [-1.1, 0, 0]);
    // unit flashes on the flanks
    kb.add(mark, plateGeo(0.02 * S, 0.16 * S, 0.26 * S, 0.006 * S, 1), [sx * 0.596 * S, 0.20 * S, 0.06 * S], [0, 0, sx * 0.12]);
  });
  kb.add(dark, ventGeo(0.50 * S, 0.24 * S, 0.06 * S, 5), [0, 0.10 * S, -0.58 * S], [0, Math.PI, 0]);
  weakSpot(body, {
    key: 'intake', label: 'INTAKE',
    p0: [-0.25 * S, 0.10 * S, -0.58 * S], p1: [0.25 * S, 0.10 * S, -0.58 * S],
    r: 0.16 * S,
    at0: clamp(0.10 * S / (body.length || 1), 0, 1), at1: clamp(0.10 * S / (body.length || 1), 0, 1),
  });
  // hull scoring: it has been shot at, and a boss should look like it
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2, e = -0.2 + rng() * 0.9;
    const w = (0.10 + rng() * 0.18) * S;
    const d = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
    kb.aim(scorch, plateGeo(w, 0.006 * S, w * 0.65, 0.002 * S, 1),
      [d[0] * 0.60 * S, 0.14 * S + d[1] * 0.55 * S, d[2] * 0.60 * S], d);
  }
  kb.bake(body.obj);

  /* ── the face: the front of the ball, on the head bone so it turns ── */
  const head = rig.get('head');
  const turret = assemble([
    // a cap over the front upper quarter of the ball, standing a hair proud
    [(() => { const g = new THREE.SphereGeometry(0.615 * S, 18, 10, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.18, Math.PI * 0.40); g.scale(1.0, 0.92, 1.0); return g; })(),
      [0, 0, -0.34 * S]],
    // the brow shelf the lenses sit under
    [plateGeo(0.62 * S, 0.06 * S, 0.22 * S, 0.02 * S, 1), [0, 0.30 * S, 0.20 * S], [0.3, 0, 0]],
  ], 'turret');
  const hm = mesh(turret, shell, head.obj);
  head.primary = hm; head.parts.push(hm); head.radius = 0.34 * S;

  const kt = new Kit();
  kt.pair((sx) => {
    // the two great lenses: a dark ring, red glass, and the hot core behind it
    const d = new THREE.Vector3(sx * 0.36, 0.20, 1).normalize();
    const at = [sx * 0.21 * S, 0.14 * S, 0.24 * S];
    kt.aim(dark, new THREE.CylinderGeometry(0.150 * S, 0.135 * S, 0.10 * S, 14), at, d);
    kt.aim(glass, new THREE.SphereGeometry(0.135 * S, 14, 8), [at[0] + d.x * 0.04 * S, at[1] + d.y * 0.04 * S, at[2] + d.z * 0.04 * S], d, [1, 1, 0.40]);
    // the hot core sits PROUD of the glass — inside it, the glass swallowed it
    // and the lens read as a dark red dome
    kt.aim(eye, new THREE.SphereGeometry(0.085 * S, 10, 6), [at[0] + d.x * 0.10 * S, at[1] + d.y * 0.10 * S, at[2] + d.z * 0.10 * S], d, [1, 1, 0.45]);
  });
  // the three small sensor pips between the lenses
  kt.row(3, (i, t) => kt.add(eye, new THREE.SphereGeometry(0.020 * S, 6, 4), [(t - 0.5) * 0.12 * S, 0.10 * S, 0.38 * S]));
  kt.add(mark, plateGeo(0.16 * S, 0.02 * S, 0.14 * S, 0.006 * S, 1), [0, 0.33 * S, 0.14 * S], [0.3, 0, 0]);
  kt.bake(head.obj);

  const cannons = [];
  {
    // THE GUN: one long barrel under the lenses, off a trunnion in the chin
    const kc = new Kit();
    kc.add(dark, new THREE.CylinderGeometry(0.110 * S, 0.110 * S, 0.30 * S, 10), [0, -0.10 * S, 0.22 * S], [0, 0, 1.5708]);
    kc.add(dark, new THREE.CylinderGeometry(0.075 * S, 0.090 * S, 0.96 * S, 10), [0, -0.10 * S, 0.66 * S], [1.5708, 0, 0]);
    kc.row(4, (i, t) => kc.add(shell, new THREE.CylinderGeometry(0.100 * S, 0.100 * S, 0.035 * S, 8),
      [0, -0.10 * S, (0.34 + t * 0.34) * S], [1.5708, 0, 0]));
    kc.add(dark, new THREE.CylinderGeometry(0.090 * S, 0.078 * S, 0.14 * S, 8), [0, -0.10 * S, 1.12 * S], [1.5708, 0, 0]);
    const meshes = kc.bake(head.obj);
    const m = mesh(new THREE.CylinderGeometry(0.052 * S, 0.064 * S, 0.10 * S, 8), hot, head.obj,
      [0, -0.10 * S, 1.20 * S], [1.5708, 0, 0]);
    cannons.push({ barrel: meshes[0], muzzle: m });
  }
  {
    // …and the light gun slung under the chin, which is the second voice
    // `_muzzleWorld` alternates with
    const kc = new Kit();
    kc.add(dark, plateGeo(0.16 * S, 0.10 * S, 0.30 * S, 0.02 * S, 1), [0, -0.30 * S, 0.30 * S]);
    kc.add(dark, new THREE.CylinderGeometry(0.030 * S, 0.036 * S, 0.50 * S, 8), [0, -0.30 * S, 0.62 * S], [1.5708, 0, 0]);
    const meshes = kc.bake(head.obj);
    const m = mesh(new THREE.CylinderGeometry(0.030 * S, 0.040 * S, 0.06 * S, 8), hot, head.obj,
      [0, -0.30 * S, 0.90 * S], [1.5708, 0, 0]);
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

/* ── the menagerie: five creatures, five body plans ──────────────────── */

/**
 * "ALL YOUR MONSTERS LOOK THE SAME, SPHERE WITH SOME LEGS."
 *
 * That is not hyperbole and it is not about detail. Past thirty metres
 * `Enemy._applyLod` hides every mesh that is not a bone's PRIMARY, and the
 * primaries of the old menagerie were: a trunk made of three scaled
 * SphereGeometries, a skull made of a fourth, and sixteen identical tapering
 * tubes. Every horn, frill, quill, scute, tooth and tail segment was Kit
 * detail and therefore invisible at exactly the range the player was
 * describing. The sentence is a precise description of the LOD-1 mesh.
 *
 * The other half is that all five stood on ONE skeleton. `walkerSkeleton`
 * fixes the hip sockets at ±0.34 of scale, the femur at 0.62 and the tibia at
 * 0.74 whatever the animal is, `_poseWalker` planted every foot 1.35 of scale
 * out and poled every knee UP AND OUT — the insect bend — and the only things
 * a "kind" could change were colours and a handful of proportion multipliers.
 * Measured on the shipped five (tools/_creature.mjs): every one of them
 * carried the centroid of its own silhouette at 0.50–0.54 of its height. Five
 * animals, one mass distribution. That is the sphere.
 *
 * ── WHAT THE REFERENCE ACTUALLY ASKS FOR.
 *
 * `assets/reference/maps/colosseum/more arena 1.jpg` is the brief, because it
 * is the test: three creatures in one frame at about forty metres, where no
 * detail survives at all. What tells them apart there is
 *
 *   LEG COUNT, STANCE HEIGHT, MASS DISTRIBUTION, and the outline.
 *
 * The reek is a low dark BLOCK, wider than it is tall, with its head at knee
 * height. The acklay is a tall splayed TRIPOD of thin lines with a small body
 * hung in the middle of them and no visible head. The massiffs are squat
 * commas. `assets/reference/units/creatures/` carries the rest and no two
 * share a body plan: the rancor is a hunched biped whose arms reach the
 * ground and whose head is fused into its shoulders, the wampa is an upright
 * shaggy ape, the nexu is a long low cat with a whip tail twice its own body.
 *
 * So a plan below owns four things the old table could not express:
 *
 *   ITS SKELETON     `creatureSkeleton` builds the bones from the plan —
 *                    how many limbs, where each one is mounted, how long each
 *                    segment is, and whether a limb is a LEG or an ARM. The
 *                    rancor and the gundark have two of each, the acklay six
 *                    legs, the reek and the nexu four.
 *   ITS STANCE       published on the built object and read by `_poseWalker`,
 *                    so hip height, stride, foot lift and — the one that
 *                    changes the outline most — the POLE each knee bends
 *                    toward are the animal's own. A mammal's stifle points
 *                    forward and its hock back; an acklay's knee stands above
 *                    its own spine. That was one hard-coded vector for every
 *                    creature in the game.
 *   ITS SILHOUETTE   everything that makes the outline — horns, frill, crest,
 *                    mane, tail, tusks — is merged into ONE extra mesh per
 *                    bone and tagged `userData.silhouette`, which
 *                    `_collectLodParts` now keeps. Two extra draw calls, and
 *                    the animal still has horns at forty metres.
 *   ITS VERBS        `moves`, read by `Enemy.beastMoveSet`. What an animal
 *                    can DO is a property of what it is built like: a thing
 *                    with a metre of horn carried in front of its eyes gores,
 *                    a thing on six spindly legs stabs from outside your
 *                    reach, a cat rakes. The archetype may override it (the
 *                    rancor and the gundark do, in src/game/Levels.js) and
 *                    then the archetype is the only authority for those two —
 *                    a second copy here is exactly the defect HANDOFF §2.3
 *                    is about, so those two plans deliberately carry none.
 *
 * ── WHAT DID NOT WORK, so the next person does not spend the afternoon.
 *
 *   Making the front legs SHORTER than the back to drop the reek's shoulders.
 *   Every limb hangs off one `hips` bone at one height, so a short leg does
 *   not lower the front — the IK clamps it straight and the foot hangs in the
 *   air. The front end is dropped by pitching the TRUNK nose-down and putting
 *   the shoulder hump on top of it, which is what the photograph shows
 *   anyway.
 *
 *   Building the trunk from more spheres. A union of ellipsoids fills 0.785
 *   of its own section however hard it is squashed — the same measurement
 *   tools/checks/characters.mjs makes about humanoid torsos — so it reads as
 *   a barrel from any angle. The trunk is ONE lathe now with a superellipse
 *   section and gaussian swells at the shoulder and the haunch: fewer
 *   triangles than the three spheres it replaces (392 against 532) and it is
 *   not a body of revolution.
 */

/**
 * The bones, from the plan. Same NAMES as `walkerSkeleton` — `hips`, `body`,
 * `head`, and `hipL{i}`/`femur{i}`/`tibia{i}`/`tarsus{i}` per limb — because
 * those names are load-bearing all the way down: Ragdoll's joint table is
 * keyed on the prefixes, `Enemy.capsules` walks the bone list, `Actor.cut`
 * reparents subtrees, and `_poseWalker` solves `femur{i}`→`tibia{i}`. What
 * changes is every NUMBER, which is the part that was shared and should never
 * have been.
 *
 * An ARM is parented to `body` rather than to `hips`, so it rides the trunk's
 * pitch the way a real shoulder does; a LEG hangs off the hips.
 */
function creatureSkeleton(S, P) {
  const s = S;
  const out = [
    { name: 'hips', parent: null, offset: [0, 0, 0], length: 0.5 * s, rest: [0, 1, 0], role: 'core' },
    { name: 'body', parent: 'hips', offset: [0, P.trunk[0] * s, P.trunk[1] * s], length: P.trunk[2] * s, rest: [0, 1, 0], role: 'core' },
    { name: 'head', parent: 'body', offset: [0, P.headAt[0] * s, P.headAt[1] * s], length: 0.4 * s, rest: [0, 1, 0], role: 'head' },
  ];
  let i = 0;
  for (const L of P.limbs) {
    for (const side of [1, -1]) {
      const arm = L.role === 'arm';
      const socket = 0.10 * s;
      /* `L.role` IS the bone role — the plan has said 'leg' or 'arm' since the
       * menagerie was built, and `Rig` and `Enemy.severanceOf` now read the same
       * word rather than a second table keyed on `hipL2`. Which is why a rancor,
       * whose two arms hang off `body` and whose two legs hang off `hips`, is
       * priced as a biped with arms and an acklay as a hexapod, off one loop. */
      out.push({ name: `hipL${i}`, parent: arm ? 'body' : 'hips',
        offset: [L.x * s * side, L.y * s, L.z * s], length: socket,
        rest: [side, arm ? -0.35 : 0.2, 0], role: L.role });
      /* THE REST DIRECTIONS ARE THE ANIMAL'S TOO, and they are not cosmetic.
       * `_poseWalker` solves femur→tibia every frame up to 62 m, but past that
       * the solve stops and the body keeps whatever pose it last held — and on
       * the first frame of a spawn there is no last pose, only these. A rest
       * pair authored for an insect (femur up and OUT to a knee above the
       * back, tibia straight down) was applied to a bull and a cat, which is
       * the same defect as the shared pole vector one layer down. */
      out.push({ name: `femur${i}`, parent: `hipL${i}`, offset: [0, socket, 0],
        length: L.femur * s, rest: L.femurRest.map((v, n) => (n === 0 ? v * side : v)), role: L.role });
      out.push({ name: `tibia${i}`, parent: `femur${i}`, offset: [0, L.femur * s, 0],
        length: L.tibia * s, rest: L.tibiaRest.map((v, n) => (n === 0 ? v * side : v)), role: L.role });
      out.push({ name: `tarsus${i}`, parent: `tibia${i}`, offset: [0, L.tibia * s, 0],
        length: L.tarsus * s, rest: arm ? [0, -0.9, 0.3] : [0, -0.4, 0.6], role: L.role });
      i++;
    }
  }
  /**
   * ── WINGS, AND THEY ARE NOT IN `limbs[]` — WHICH IS THE WHOLE DESIGN ─────
   *
   * A wing is a limb, `Rig.BONE_ROLES` has carried the role since the
   * Geonosian, and the obvious thing to do is add `{ role: 'wing' }` to the
   * plan's `limbs[]` and let the loop above expand it left and right. That is
   * wrong for two measured reasons, and both of them bite silently.
   *
   *   THE INDEX IS AN INDEX INTO THE STANCE, NOT INTO THE RIG.
   *   `Enemy._poseWalker` walks `for (i = 0; i < ST.limbs.length; i++)` and
   *   solves `femur{i}` → `tibia{i}` against `ST.limbs[i]` — so the stance
   *   array and the limb loop above have to agree POSITIONALLY. `stanceOf`
   *   would have to emit a wing entry (and IK a wing at the floor), or skip it
   *   (and slide every later leg onto the wrong plan row). A hawk whose wings
   *   were `limbs[0]` would have its TALONS driven by its wings' pole vectors.
   *   Nothing throws; the animal just walks on its wings.
   *
   *   `Flight.beatWings` READS THE NAME. It takes the side off
   *   `b.name.endsWith('L')`, so a wing spelt `femur2` is a wing whose side is
   *   always −1 — both wings rotate the same way, one up and one down, every
   *   beat. Spelling them `wingL`/`wingR` is not decoration: it is the same
   *   vocabulary `humanoidSkeleton(…, { wings: true })` already publishes, so
   *   the flyer built here and the flyer built there beat with one function.
   *
   * TWO BONES A SIDE for `roleShare`'s sake, which is `humanoidSkeleton`'s own
   * argument and is not restated: a cut at the root takes the whole wing and a
   * cut past the elbow takes the fan.
   *
   * Off `body` and not `hips`: a wing root is a shoulder, and on a creature
   * whose trunk pitches, a wing that stayed level with the pelvis would tear
   * out of the back the moment the animal reared.
   */
  if (P.wings) {
    const W = P.wings;
    for (const side of [1, -1]) {
      const L = side > 0 ? 'L' : 'R';
      out.push({ name: `wing${L}`, parent: 'body',
        offset: [side * W.x * s, W.y * s, W.z * s], length: W.arm * s,
        rest: [side * W.rest[0], W.rest[1], W.rest[2]], role: 'wing' });
      out.push({ name: `wingTip${L}`, parent: `wing${L}`,
        offset: [0, W.arm * s, 0], length: W.fan * s,
        rest: [side * W.fanRest[0], W.fanRest[1], W.fanRest[2]], role: 'wing' });
    }
  }
  return out;
}

/**
 * THE FIVE PLANS.
 *
 * Fields, and every one of them was a shared constant before:
 *
 *   hip      hip-bone height above the ground, ×scale. THE first read: the
 *            reek stands at 0.88 and the acklay at 1.62, where both used to
 *            stand at 1.5–1.6.
 *   trunk    [y, z, length] of the body bone off the hips, ×scale.
 *   pitch    trunk pitch, radians. 0 is a level quadruped spine along +Z;
 *            1.02 stands the rancor up on its hind legs.
 *   girth    trunk radius ×scale, and `swells` the two masses on it as
 *            [where along it, how much, how wide] — limbGeo's own gaussians.
 *   limbs    the pairs, each expanded left and right. `role` is 'leg' or
 *            'arm', `plant` is where the foot goes down (×scale, off the
 *            centreline), `femurRest`/`tibiaRest` are the bind pose, and
 *            `pole` is where the joint bends TOWARD — the single number that
 *            most changes the outline. An acklay poles up and out to a knee
 *            above its own back; a reek's foreleg poles forward to an elbow
 *            and its hind leg backward to a hock.
 *   step/lift stride length and foot clearance, ×scale.
 *   rear     metres of hip travel per unit of an attack's `rise`, ×scale.
 *   moves    the verbs its anatomy affords. See the header.
 */
/**
 * A COMPANION'S OWN COLOURS, AS BUILDER OPTIONS — the wire that finally passes
 * something to `buildQuadruped`'s `opts.hide` / `plate` / `belly` / `eye`.
 *
 * Those four have been accepted since the day the creature builder was
 * written — `hideMat(opts.hide ?? P.hide, 0.92)` and three siblings — and
 * NOTHING in the tree has ever handed them anything but the plan's own
 * defaults. Every creature in the game wears its factory colours because
 * there was no door.
 *
 * IT CANNOT BE `kitOptsFrom`, which is the door a trooper's look goes
 * through: `KIT_FIELDS` and `PAINT_FIELDS` have exactly two keys, `flesh` and
 * `steel`, and a creature is neither — a saved creature colour would be
 * dropped before it ever reached the builder.
 *
 * IDS IN, COLOURS OUT. The record stores a palette id so a re-tuned palette
 * reaches the animals already wearing it; `paintById` answers null for an id
 * this build does not have, and a null slot is simply absent, which the
 * builder reads as the plan's own colour. So an unknown id is the animal's
 * factory hide rather than a black one.
 */
export function companionOptsFrom(look) {
  const out = {};
  if (!look) return out;
  for (const f in look) {
    const p = paintById(look[f]);
    if (p) out[f] = p.color;
  }
  return out;
}

export const CREATURE_PLANS = {
  /**
   * THE REEK — `assets/reference/units/creatures/Reek.jpeg`.
   *
   * Everything about it is at ground level. The photograph is a wall of
   * shoulder with a head hanging off the FRONT of it at the height of its own
   * knees, three horns and a bony frill carried in front of the eyes, and
   * legs so short the belly is barely a metre off the sand. It reads at forty
   * metres as a dark block wider than it is tall (`more arena 1.jpg`), which
   * is why the hip is 0.88 where the old shared value was 1.6: at 2.4 scale
   * that is 2.11 m at the hip instead of 3.84, and 3.84 m is a giraffe.
   */
  /**
   * THE MASSIFF — the first companion, and the cheapest true body in the set.
   *
   * A lean reptilian war-dog off Tatooine and Geonosis: about a metre at the
   * shoulder and twice that long, all jaw and spine, with a ridge of spines
   * from the crown to the tail root and a low slung gait that keeps the belly
   * a hand off the sand. The Republic used them as sentries, which is exactly
   * the job a companion does, and it is the one animal in the reference
   * material a person would plausibly keep.
   *
   * IT IS A PLAN ROW AND NOTHING ELSE, which is the point. The row buys the
   * skeleton, the superellipse trunk, the dorsal outline, the head, the feet,
   * the belly weak spot, the stance the gait reads, three LOD rungs, a cohort,
   * the topple and a voice — so almost nothing about the first companion is
   * new code, and what IS new is only the part that makes it yours.
   *
   * Small numbers throughout against the reek's: hip 0.44 where a reek is
   * 0.74, trunk 0.86 long where a reek is 1.24, and a `girth` under half. At
   * scale 0.95 that stands it 0.42 m at the hip and about 1.6 m nose to tail,
   * which is the reference photograph and is deliberately BELOW the player's
   * eye line — a companion you have to look down at reads as a companion.
   */
  /**
   * THE VARACTYL — the only body in the game that takes a grade the player's
   * own character controller refuses, and the row is built round that one fact.
   *
   * It is the third mount and it exists because the other two are about SPEED.
   * A tauntaun makes the map faster; this makes the map a different SHAPE. So
   * every number below is a climbing number rather than a running one: six
   * points of contact instead of two, a long low body that keeps its weight
   * against the rock, and a tail longer than the animal to hang off the far
   * side of a ridge.
   *
   * SIX LEGS, AND NOT ONE LINE OF GAIT CODE. `creatureSkeleton` spans 2, 4 and
   * 6 — the acklay is the proof, three `limbs[]` entries expanded left+right —
   * and `_poseWalker` COUNTS the legs off the rig rather than restating the
   * number, so a hexapod's phase offsets come out of the plan's own `step` and
   * nothing is written. The acklay is the row this was measured against and
   * the differences are all deliberate:
   *
   *   ITS LEGS SPLAY, THE ACKLAY'S TOWER. An acklay's `pole` is [1.40, 3.10]
   *   — the knee is thrown three metres UP, which is what makes it a tripod
   *   you walk under. This one's is [1.30, 0.55], so the knee goes OUT and
   *   barely up: the body stays low and wide over its feet, which is what a
   *   climbing lizard's does and what stops it reading as a small acklay.
   *   `femurRest` follows — 0.86 out against 0.62, and y −0.10 against +0.72.
   *
   *   ITS FOOT IS A CLAW AND NOT A SPIKE. A spike is a point that plants; a
   *   claw is what hooks rock, and it is the one piece of geometry on the
   *   animal that says what it is for.
   *
   *   IT HAS A TAIL, AND THE ACKLAY HAS NONE. 2.6 of reach on a 1.30 trunk —
   *   the longest tail-to-body ratio in the table — because a counterweight
   *   swung out behind is what a climbing biped-turned-hexapod actually uses,
   *   and because at forty metres a horizontal line half again the length of
   *   the body is a silhouette nothing else in the game has.
   *
   * THE HEAD IS 'horned-ape' FOR THE FRILL, and this is a re-read rather than
   * a compromise. The branch builds temple horns swept out and forward plus a
   * jaw ruff; on a long low reptile head those two pieces are exactly a
   * varactyl's swept crest and its cheek plumes. No fifth branch was invented,
   * and none is needed — but if one is ever written, this row should move to
   * it, which is written down here rather than left for somebody to guess.
   */
  varac: {
    /* GREEN, and it is the only green animal in the table. Every other hide
     * here is a brown or a grey — 0x6f6455, 0x6d5a4a, 0x8b6f52, 0x7a6a58 — so
     * the one colour that reads instantly against Geonosian orange rock is the
     * one nothing has used. The belly is warm and pale for the reason every
     * belly in this file is: it is the surface you see from below, which on a
     * mount is the surface you never see, and on a climbing animal on a cliff
     * above you is the only surface you DO. */
    hide: 0x5f7f46, plate: 0x86a057, belly: 0xd8cf9a, eye: 0xe8a03a,
    /* LOW AND LONG: hip 0.92 on a 1.30 trunk, against the acklay's 1.62 on
     * 1.06. The acklay is taller than it is long and this is the inverse,
     * which is the first read at any distance. */
    hip: 0.92, trunk: [0.12, -0.16, 1.30], pitch: -0.04, girth: 0.36,
    /* Shoulder low and broad, haunch taller: a climber pulls with the front
     * and pushes with the back, and the swells say which end does what. */
    swells: [[0.62, 0.20, 0.30], [0.24, 0.30, 0.30]],
    section: { n0: 2.6, n1: 3.1, back: 0.05, keel: 0.05, waist: 0.06 },
    /* A LONG NECK, three segments and the longest curl in the file: the head
     * has to be able to reach past the rock the front feet are on, and a mount
     * whose head is up where the rider can see it is a mount you steer by. */
    headAt: [0.10, 1.02], neck: [3, 0.26, 0.17, -0.22, -0.14], head: 'horned-ape',
    /* SCUTES AND NOT A RIDGE: a plated back rather than a spine of spikes,
     * because a rider sits on this one and a row of spikes down the seat is a
     * silhouette that contradicts the saddle. */
    back: 'scutes', tail: [4, 2.60, 0.12, 0.10, -0.16],
    limbs: [
      { role: 'leg', x: 0.34, y: 0.06, z: 0.62, plant: 0.68, femur: 0.44, tibia: 0.50, tarsus: 0.22,
        girth: 0.80, pole: [1.30, 0.55, 0.80], foot: 'claw',
        femurRest: [0.86, -0.10, 0.34], tibiaRest: [0.30, -0.92, -0.24] },
      { role: 'leg', x: 0.36, y: 0.04, z: 0.02, plant: 0.72, femur: 0.46, tibia: 0.52, tarsus: 0.22,
        girth: 0.84, pole: [1.34, 0.55, 0], foot: 'claw',
        femurRest: [0.90, -0.08, 0], tibiaRest: [0.32, -0.90, 0] },
      { role: 'leg', x: 0.34, y: 0.02, z: -0.60, plant: 0.68, femur: 0.44, tibia: 0.50, tarsus: 0.22,
        girth: 0.80, pole: [1.30, 0.55, -0.80], foot: 'claw',
        femurRest: [0.86, -0.10, -0.34], tibiaRest: [0.30, -0.92, 0.24] },
    ],
    /* A SHORT QUICK STRIDE, which is what six legs are for: 0.66 against the
     * acklay's 1.40 on a body two thirds the length. It does not lope, it
     * scurries, and on a slope that is the difference between keeping four
     * feet on the rock and keeping one. */
    step: 0.66, lift: 0.20, rear: 0.14,
    /* ITS ONLY ATTACK HURTS NOTHING. The shipped `sweep` row at zero damage
     * through the archetype — a tail that knocks a body flat and takes not one
     * point off it, which is the honest reading of "useless in battle" for an
     * animal that is two metres of muscle: it can move you, it cannot kill
     * you. */
    moves: ['sweep'],
  },

  massiff: {
    hide: 0x6f6455, plate: 0x8b7f68, belly: 0x9a8f79, eye: 0xd8a832,
    hip: 0.44, trunk: [0.10, -0.10, 0.86], pitch: -0.06, girth: 0.28,
    /* Shoulder and haunch, both slight: this animal is a spine with a head on
     * it and the silhouette should read as length rather than as bulk. */
    swells: [[0.52, 0.30, 0.20], [0.20, 0.18, 0.24]],
    section: { n0: 2.4, n1: 2.9, back: 0.04, keel: 0.06, waist: 0.05 },
    headAt: [0.16, 0.74], neck: [2, 0.14, 0.19, -0.30, -0.06], head: 'fanged',
    /* The ridge is the animal's whole outline from the side, so it is the one
     * feature that is not scaled down with the rest of it. */
    /**
     * SCUTES AND NOT A RIDGE, WHICH IS WHAT ITS OWN DESIGN SAYS — COMPANIONS.md
     * writes this animal as "`back: 'scutes'`, `foot: 'paw'`, plate swells at
     * the shoulder", and the row had drifted to the tuk'ata's spined ridge and
     * clawed foot.
     *
     * IT IS ALSO WHAT SEPARATES THEM. `_creature.mjs` measures the worst
     * silhouette overlap between any two bodies and calls a pair above 0.5
     * "two animals that share a body plan"; the massiff and the tuk'ata
     * measured 0.507, because they were wearing the same three choices —
     * `fanged` + `ridge` + `claw`. Fixing the row that drifted fixes both
     * problems with one edit, which is why it is here and not on the other
     * animal: the tuk'ata's spines are its own design's word for it and were
     * never the thing that was wrong.
     *
     * A PLATED BACK IS ALSO THE RIGHT READ FOR THE JOB. This is the BLOCKER —
     * it puts itself between you and the nearest hostile and takes hits inside
     * a cone — and armour plate says that from forty metres in a way a row of
     * spikes does not.
     */
    back: 'scutes', tail: [3, 0.40, 0.09, 0.12, -0.10],
    limbs: [
      { role: 'leg', x: 0.24, y: 0.04, z: 0.46, plant: 0.34, femur: 0.26, tibia: 0.28, tarsus: 0.10,
        girth: 0.92, pole: [0.20, 0.34, 0.90], foot: 'paw',
        femurRest: [0.18, -0.88, 0.30], tibiaRest: [0.04, -0.97, -0.20] },
      { role: 'leg', x: 0.26, y: 0.02, z: -0.38, plant: 0.36, femur: 0.26, tibia: 0.30, tarsus: 0.10,
        girth: 0.86, pole: [0.20, 0.34, -0.90], foot: 'paw',
        femurRest: [0.18, -0.88, -0.30], tibiaRest: [0.04, -0.97, 0.20] },
    ],
    step: 0.52, lift: 0.18, rear: 0.22,
    /* Two verbs and no more. A massiff is a set of jaws that closes the last
     * two metres fast; it does not gore, toss, slam or pounce, and giving a
     * companion the reek's move list would make it a reek that follows you. */
    /* AND `charge` AT PHASE 3, which is the escalation this row did not have.
     * `dodgeable.mjs` asks two things of a move set — at least two verbs in
     * phase 1, which is two thirds of the health bar, and at least one that
     * unlocks later so that hurting the animal CHANGES something — and
     * [lunge, rake] answered the first and failed the second: a massiff at 10%
     * fought exactly like a massiff at 100%. A charge is the right third verb
     * for this body and not a filler: the whole of what a massiff does is
     * occupy the thing it is on, and an animal that has been hurt badly enough
     * stops holding station and commits. It is the same verb the nexu and the
     * reek escalate into, at the same gate. */
    moves: ['lunge', 'rake', 'charge'],
  },

  charger: {
    hide: 0x6a5f4e, plate: 0x9a8b6c, belly: 0x8d8168, eye: 0xffb03a,
    hip: 0.74, trunk: [0.16, -0.20, 1.24], pitch: -0.13, girth: 0.44,
    swells: [[0.74, 0.52, 0.24], [0.24, 0.24, 0.30]],
    section: { n0: 2.8, n1: 3.4, back: 0.02, keel: 0.05, waist: 0.06 },
    headAt: [0.20, 1.10], neck: [2, 0.20, 0.28, -0.44, -0.10], head: 'horned',
    back: 'scutes', tail: [3, 0.46, 0.13, 0.18, -0.16],
    limbs: [
      // fore: thick, poled FORWARD so the elbow leads — a bull's column leg
      { role: 'leg', x: 0.40, y: 0.06, z: 0.74, plant: 0.60, femur: 0.42, tibia: 0.46, tarsus: 0.15,
        girth: 1.16, pole: [0.30, 0.55, 1.30], foot: 'hoof',
        femurRest: [0.24, -0.86, 0.36], tibiaRest: [0.06, -0.96, -0.24] },
      // hind: the hock points back, which is the other half of a mammal's leg
      { role: 'leg', x: 0.42, y: 0.04, z: -0.60, plant: 0.62, femur: 0.42, tibia: 0.46, tarsus: 0.15,
        girth: 1.0, pole: [0.30, 0.55, -1.30], foot: 'hoof',
        femurRest: [0.24, -0.86, -0.36], tibiaRest: [0.06, -0.96, 0.24] },
    ],
    step: 0.80, lift: 0.28, rear: 0.34,
    /* Its verbs, and both of the new ones come off the head. A metre of horn
     * carried in front of the eyes is not a claw: it GORES, which is a
     * committed run that aims when the drive begins, and it TOSSES, which is
     * the same horn hooking under you — the biggest upward impulse in the
     * game and the only attack that answers "I am standing in front of it"
     * with height rather than with damage. */
    moves: ['gore', 'toss', 'charge'],
  },

  /**
   * THE NEXU — `assets/reference/units/creatures/Nexu more.webp`.
   *
   * Long, low and horizontal: a body twice the length of the reek's at two
   * thirds of its height, a quilled mane raked back off the shoulders, and a
   * tail as long again as the animal that whips out behind it. Four eyes in
   * two pairs, and a mouth that is wider than the skull it is in. The tail is
   * 2.9 of scale — nearly five metres on a 1.7 body — because at range the
   * tail IS the read: a low animal with a horizontal line trailing off it
   * cannot be mistaken for anything else on the sand.
   */
  stalker: {
    hide: 0x7a3a2c, plate: 0x4a3128, belly: 0xa8846a, eye: 0x66ff9a,
    hip: 0.86, trunk: [0.12, -0.60, 1.72], pitch: 0.05, girth: 0.33,
    swells: [[0.78, 0.34, 0.22], [0.26, 0.26, 0.28]],
    section: { n0: 2.4, n1: 2.8, back: 0.04, keel: 0.02, waist: 0.10 },
    headAt: [0.20, 1.18], neck: [3, 0.24, 0.20, 0.06, 0.02], head: 'fanged',
    back: 'mane', tail: [7, 2.40, 0.085, 0.26, -0.10],
    limbs: [
      { role: 'leg', x: 0.26, y: 0.04, z: 0.86, plant: 0.34, femur: 0.50, tibia: 0.54, tarsus: 0.16,
        girth: 0.92, pole: [0.22, 0.50, 1.15], foot: 'claw',
        femurRest: [0.10, -0.88, 0.42], tibiaRest: [0.04, -0.94, -0.30] },
      { role: 'leg', x: 0.28, y: 0.02, z: -0.74, plant: 0.36, femur: 0.52, tibia: 0.56, tarsus: 0.16,
        girth: 0.96, pole: [0.22, 0.60, -1.20], foot: 'claw',
        femurRest: [0.10, -0.82, -0.50], tibiaRest: [0.04, -0.92, 0.36] },
    ],
    step: 1.20, lift: 0.44, rear: 0.42,
    /* A cat does not swing a claw once. The RAKE is the shortest attack in the
     * game — 0.32 s to the hit against the sweep's 0.55 — and it is worth two
     * thirds of the damage, so what makes it dangerous is that it arrives
     * before you have finished reading it. */
    moves: ['rake', 'pounce', 'charge'],
  },

  /**
   * THE RANCOR — `assets/reference/units/creatures/Rancor.png` and
   * `Rancor  more.jpg`.
   *
   * A BIPED, which is the whole point of rebuilding it: it was a four-legged
   * animal with the biggest numbers in the table, so the largest thing on the
   * sand had the same outline as the smallest. The reference is not ambiguous
   * — two massive hind legs, two arms long enough to put the knuckles on the
   * ground, a head with no neck at all fused straight into the shoulders, and
   * a tail. It stands 1.15 of scale at the hip and pitches its trunk up 1.02
   * radians, so at 3.4 scale the crown is near six metres: a tower, against
   * the reek's block.
   *
   * `moves` is deliberately absent — src/game/Levels.js declares the slam and
   * argues for it there, and a copy here would be the twin HANDOFF §2.3 is
   * about.
   */
  brute: {
    hide: 0x6b6152, plate: 0x585044, belly: 0x8a7f6d, eye: 0xffd24a,
    hip: 0.92, trunk: [0.10, -0.10, 0.74], pitch: 1.02, girth: 0.54,
    swells: [[0.80, 0.44, 0.26], [0.30, 0.20, 0.34]],
    section: { n0: 2.6, n1: 3.2, back: 0.03, keel: 0.06, waist: 0.04 },
    headAt: [0.64, 0.36], neck: [1, 0.14, 0.34, 0.34, 0], head: 'tusked',
    back: 'ridge', tail: [5, 1.30, 0.16, 0.10, -0.14],
    limbs: [
      /* The hind legs, and they are plantigrade: the reference stands flat on
       * a broad foot rather than up on a hock, so the pole is FORWARD and low
       * and the tarsus is long enough to be a sole. */
      { role: 'leg', x: 0.34, y: 0.02, z: -0.10, plant: 0.46, femur: 0.52, tibia: 0.54, tarsus: 0.26,
        girth: 1.30, pole: [0.34, 0.60, 1.20], foot: 'paw',
        femurRest: [0.16, -0.90, 0.34], tibiaRest: [0.04, -0.96, -0.26] },
      /* The arms. Parented to `body`, mounted 0.66 up the trunk and 0.30
       * forward of it, and 1.40 of scale of reach between shoulder and claw —
       * long enough that the knuckles touch the sand when it hunches, which
       * is the pose every photograph of one is in. */
      { role: 'arm', x: 0.46, y: 0.40, z: 0.24, femur: 0.46, tibia: 0.48, tarsus: 0.22,
        girth: 1.05, pole: [0.55, -0.10, -0.90], foot: 'talon',
        femurRest: [0.16, -0.96, 0.22], tibiaRest: [0.06, -0.98, 0.16],
        hand: [0.62, -0.22, 0.66] },
    ],
    step: 0.72, lift: 0.34, rear: 0.30,
  },

  /**
   * THE GUNDARK — built off `assets/reference/units/creatures/wampa.jpg` and
   * `Wampas preyed on tauntauns.webp`, which are the reference set's other
   * upright body and a completely different one from the rancor's.
   *
   * Where the rancor is a hunched tower with its head thrown forward, this is
   * a barrel standing straight up with the head sunk BETWEEN the shoulders,
   * arms held high and forward rather than hanging, two horns curving
   * sideways out of the skull, and a coat of shaggy fringes that breaks the
   * outline into a fur silhouette instead of a smooth one. Two thirds the
   * rancor's height and half again the reek's, so the three read as three
   * sizes as well as three shapes.
   */
  pouncer: {
    hide: 0x8a7b5c, plate: 0x6b4a2c, belly: 0xb0a084, eye: 0xff6a2a,
    hip: 0.88, trunk: [0.08, -0.04, 0.62], pitch: 1.32, girth: 0.46,
    swells: [[0.76, 0.40, 0.30], [0.28, 0.18, 0.30]],
    section: { n0: 2.4, n1: 3.0, back: 0.02, keel: 0.04, waist: 0.08 },
    headAt: [0.62, 0.16], neck: [1, 0.12, 0.30, 0.16, 0], head: 'horned-ape',
    back: 'shag', tail: [0, 0, 0, 0, 0],
    limbs: [
      { role: 'leg', x: 0.30, y: 0.02, z: 0.02, plant: 0.42, femur: 0.50, tibia: 0.52, tarsus: 0.20,
        girth: 1.20, pole: [0.36, 0.70, 1.10], foot: 'paw',
        femurRest: [0.18, -0.86, 0.40], tibiaRest: [0.04, -0.94, -0.30] },
      { role: 'arm', x: 0.44, y: 0.36, z: 0.14, femur: 0.44, tibia: 0.46, tarsus: 0.20,
        girth: 1.00, pole: [0.60, 0.10, -0.90], foot: 'talon',
        femurRest: [0.20, -0.86, 0.42], tibiaRest: [0.06, -0.80, 0.58],
        // held UP and forward — the wampa's reaching pose, not the rancor's hang
        hand: [0.66, 0.10, 0.78] },
    ],
    step: 0.66, lift: 0.42, rear: 0.44,
  },

  /**
   * THE ACKLAY — `assets/reference/units/creatures/Acklay more.webp` and
   * `maps/colosseum/fighting monster in arena.jpg`.
   *
   * SIX legs, and the body is the small part. In the photograph the trunk is
   * a shell about a metre across hung in the middle of legs three times its
   * length, splayed so wide that the animal's footprint is more than twice
   * its own body, with the knees standing above the back and the legs coming
   * to POINTS in the sand — there is no foot on the end of an acklay's leg.
   * The head hangs forward and DOWN off the front of the shell on a short
   * neck, under a flat crest that sweeps back over the shoulders.
   *
   * The old one had this backwards: a 1.9 m carapace on legs planted 1.35 of
   * scale out, at the same hip height as everything else, with the neck
   * sweeping UP. Here the girth is 0.50 against legs of 2.05, the feet plant
   * at 1.90 of scale — the widest stance in the game by half again — and the
   * hip stands at 1.62. It is the tripod from `more arena 1.jpg`.
   */
  acklay: {
    hide: 0x6d5a4a, plate: 0x8f7a63, belly: 0xa8907a, eye: 0xffdd44,
    hip: 1.62, trunk: [0.14, -0.30, 1.06], pitch: 0.06, girth: 0.50,
    swells: [[0.72, 0.30, 0.26], [0.28, 0.24, 0.30]],
    section: { n0: 3.0, n1: 3.6, back: 0.04, keel: 0.08, waist: 0.05 },
    headAt: [0.06, 0.86], neck: [3, 0.30, 0.22, -0.30, -0.10], head: 'mandibles',
    back: 'ridge', tail: [0, 0, 0, 0, 0],
    limbs: [
      { role: 'leg', x: 0.50, y: 0.10, z: 0.78, plant: 1.18, femur: 0.95, tibia: 1.05, tarsus: 0.52,
        girth: 0.62, pole: [1.40, 3.10, 0.50], foot: 'spike',
        femurRest: [0.62, 0.72, 0.30], tibiaRest: [0.34, -0.94, -0.10] },
      { role: 'leg', x: 0.54, y: 0.06, z: 0.02, plant: 1.36, femur: 0.99, tibia: 1.09, tarsus: 0.52,
        girth: 0.66, pole: [1.50, 3.20, 0], foot: 'spike',
        femurRest: [0.70, 0.66, 0], tibiaRest: [0.38, -0.92, 0] },
      { role: 'leg', x: 0.50, y: 0.02, z: -0.72, plant: 1.18, femur: 0.95, tibia: 1.05, tarsus: 0.52,
        girth: 0.62, pole: [1.40, 3.10, -0.50], foot: 'spike',
        femurRest: [0.62, 0.72, -0.30], tibiaRest: [0.34, -0.94, 0.10] },
    ],
    step: 1.40, lift: 0.52, rear: 0.26,
    /* The REACH problem, stated as two moves. The STAB is a foreleg driven
     * out from 3.8 m — further than anything else in the game can hit from,
     * and further than the player's own blade — and the SNATCH is the
     * mandibles closing and DRAGGING you in, which is the only attack on the
     * field whose impulse points at the animal instead of away from it. */
    moves: ['stab', 'snatch', 'sweep'],
  },

  /**
   * THE TOOKA KIT — the animal that cannot do anything, and the row is the
   * argument that it does not need to.
   *
   * Every other plan in this table is a delivery system for a verb: the reek
   * is a wall built to carry a horn, the acklay is a tripod built to reach
   * past your blade, the massiff is a spine built to close two metres. This
   * one is built to be PICKED UP. Its `moves` is empty on purpose (below),
   * so the whole row is silhouette and nothing else, and the silhouette has
   * exactly one job: to be the smallest, roundest, softest thing on the sand,
   * so that a player looking at it decides on their own that it will not last
   * the next thirty seconds. See COMPANIONS.md, "The twelve kinds" — it is
   * the control case for the protection loop.
   *
   * SMALLEST IN THE GAME, and the archetype's 0.34 is what makes the numbers
   * here read oddly next to the massiff's. At 0.34 the hip below stands
   * 0.119 m and the back 0.235 m — a kitten a walking man does not see. The
   * massiff was already argued down to 0.42 m at the hip because "a companion
   * you have to look down at reads as a companion"; this one is a third of
   * that again, which is the difference between a dog at your knee and a
   * thing you would step on.
   */
  tooka: {
    /* The only non-predator palette in the table. Every other eye here is a
     * hunting colour — 0xd8a832, 0xffb03a, 0x66ff9a, 0xffdd44, 0xff6a2a —
     * and `emissiveMat` at 2.8 makes all of them lamps in the dark. A pale
     * blue is the one hue in that set of six nobody has used, so the tooka is
     * separable from the nexu at range on colour alone, and eyeshine on a
     * kitten is a thing cats actually do rather than a threat display. The
     * belly is the palest in the file (0xe2dac8 against the massiff's
     * 0x9a8f79) because the underside is what you see when you are holding
     * it, which is where this animal spends the fights it survives. */
    hide: 0xa89c8a, plate: 0xbdb2a0, belly: 0xe2dac8, eye: 0x74c8ff,
    hip: 0.35, trunk: [0.08, -0.06, 0.62], pitch: 0.02, girth: 0.26,
    /* ROUND IS THE POINT, and it is the girth-to-trunk ratio that says so:
     * 0.26/0.62 = 0.42 against the massiff's 0.28/0.86 = 0.33 and the nexu's
     * 0.33/1.72 = 0.19. The nexu is a line, the massiff is a spine, this is a
     * ball with legs. Length was the cheapest thing to cut — 0.62 of trunk
     * against the massiff's 0.86 — because a short body is what makes the
     * head (below) read as too big for it without the head itself growing. */
    /* Both swells are LOW and WIDE, which is the inverse of every other row:
     * the massiff's shoulder is 0.30 tall and 0.20 across, this one is 0.14
     * tall and 0.34 across. A swell that stands up is a muscle and a muscle
     * is a thing that hits you; spread flat it is just fat over the ribs. The
     * haunch is the larger of the two (0.24 against 0.14) for the one honest
     * anatomical reason on this animal — a kitten is heavier behind than in
     * front — and not because anything is ever going to push off it. */
    swells: [[0.58, 0.14, 0.34], [0.24, 0.24, 0.38]],
    /* n0 2.0 IS A TRUE ELLIPSE, and it is the only row that asks for one. The
     * header rejects a body of revolution — "it reads as a barrel from any
     * angle" — and that judgement is about a two-tonne animal that needs a
     * shoulder and a keel to look like it can work. This is the one body in
     * the table for which "reads as a barrel" is the correct answer, so the
     * superellipse is dialled all the way back to round and the three shaping
     * terms are switched OFF rather than left on their defaults: `back` 0.05
     * flattens the spine into a saddle, `keel` 0.02 puts a sternum ridge under
     * it and `waist` pinches the flanks, and all three are what a working
     * animal's section looks like. Explicit zeros, because `bodySection`'s
     * own defaults are non-zero and an omitted field here would quietly give
     * a kitten a keel. */
    section: { n0: 2.0, n1: 2.2, back: 0, keel: 0, waist: 0 },
    /* THE HEAD IS WIDER THAN THE BODY, which is the whole read and is bought
     * with the trunk rather than with the skull: 'horned-ape' builds a sphere
     * of 0.30 scaled (1.10, 0.94, 0.86), so the head is 0.224 wide against
     * this trunk's 0.26 girth and 0.52 long against its 0.62 — nine tenths
     * the width of the body and five sixths its length. On the wampa (scale
     * 2.0, trunk 0.62, girth 0.46) the same head is half the body's width;
     * the geometry is untouched and only the animal under it changed.
     *
     * ── WHY 'horned-ape' AND NOT 'fanged', WHICH IS THE OTHER CAT ────────
     * `buildCreatureHead` branches on four strings and an else, and none of
     * them was authored for a kitten, so this is the nearest fit and it is a
     * fit rather than a compromise:
     *   the SKULL. 'horned-ape' is a wide flat FACE that looks at you from
     *   the front; 'fanged' is a muzzle scaled (0.94, 0.68, 1.30) — long, low
     *   and pointed, which is a predator's head and reads as one at any size.
     *   A flat face with the eyes on the front of it is the single strongest
     *   cue for "young animal" there is.
     *   the EYES. 'horned-ape' places ONE pair. 'fanged' places two — four
     *   eyes, and its own comment says that is "the single most alien thing
     *   about the animal", which is the exact opposite of what this row wants.
     *   the RUFF. Three fur clumps round the jaw, and they are what carries
     *   the head's outline into the `back: 'shag'` below. The two treatments
     *   were authored as a pair on the wampa and they are kept as a pair.
     *   the HORNS. Tapered tubes swept 0.56 OUT and forward off the temples,
     *   which on this body are 0.19 m long on a 0.235 m animal. That is the
     *   one piece being deliberately re-read: the only thing that stands that
     *   far off a kitten's temples is an EAR, and an oversized ear pair is a
     *   tooka's other read after the head. It is not new vocabulary and it is
     *   not a new branch; it is the existing horn geometry doing an ear's job
     *   because the proportions happen to be an ear's proportions.
     * The underbite fangs are the one piece that stays wrong. Three per side
     * at 0.14 of scale — 48 mm — so at this size they read as an open mouth
     * rather than as teeth, and the alternative was inventing a fifth branch,
     * which this row is not allowed to do and does not need. */
    headAt: [0.18, 0.52], neck: [1, 0.10, 0.16, 0.10, 0], head: 'horned-ape',
    /* ONE neck segment, and the shortest in the file at 0.10 against the
     * massiff's two of 0.14. A kit has no neck — the head sits straight on
     * the shoulders, which is the second half of "the head is too big for
     * it". `nCurl` is 0 for the same reason the rancor's is: there is not
     * enough neck for a curve to happen in. */
    /* FUR, and it is the only soft outline the builder can make. The four
     * dorsal treatments are a spine of spikes, bony bosses, raked quills and
     * this; the first three are armour and this one is a coat. It is also
     * scale-invariant — every clump is a fraction of S — so the fringe that
     * breaks a 1.76 m wampa's edge breaks this 0.235 m one identically, and a
     * fuzzy silhouette is what stops a 0.34-scale animal reading as a
     * low-poly pebble at twenty metres. */
    back: 'shag',
    /* THE TAIL IS LONGER THAN THE ANIMAL: 1.10 of reach against 0.62 of
     * trunk. The nexu's is 2.40 and is argued as the thing that makes a low
     * body unmistakable at range; the same argument is worth more here,
     * because at 0.34 scale the body is 80 mm across and the tail is the only
     * part of this creature with any length in it at all. It is also the
     * THINNEST in the file — r0 0.030 against the nexu's 0.085 and the
     * massiff's 0.09 — since a tooka's tail is a whip of fur and not a
     * rudder, and a thin tail on a round body exaggerates the body.
     *
     * `pitch0` 0.55 with a POSITIVE curl is the only tail in the table that
     * goes up and keeps going up (the massiff's is 0.12 falling to -0.38, the
     * nexu's 0.26 falling). Six segments carry it from 0.55 to 0.85 rad, so
     * it stands off the croup and recurves forward over the back. A tail held
     * high is the one posture cue a person reads as "this animal is pleased
     * to see you" without being taught it, and it costs a sign. */
    tail: [6, 1.10, 0.030, 0.55, 0.06],
    limbs: [
      /* THE TRACK IS NARROWER THAN THE HIPS, and this row is the only one
       * that does it: `plant` 0.15 inside a hip at x 0.17, where the massiff
       * plants 0.34 outside a hip at 0.24 and the acklay plants 1.90 outside
       * 0.54. Every other animal here braces — a wide stance is what you
       * stand on to take a hit or throw one, and this one is never going to
       * do either. A cat places its feet nearly on a single line, so the legs
       * lean IN under the body, which `solveIK` handles as ordinary reach and
       * which reads as delicate from any angle.
       *
       * Legs 0.22 + 0.24 against a 0.35 hip and a 0.027 ankle: 0.323 m of
       * drop into 0.46 m of leg, so 70% extended — the massiff's own 66% and
       * deliberately not straighter, because a straight leg reads as a stance
       * and a bent one reads as a crouch. */
      { role: 'leg', x: 0.17, y: 0.05, z: 0.34, plant: 0.15, femur: 0.22, tibia: 0.24, tarsus: 0.09,
        girth: 0.92, pole: [0.14, 0.26, 0.66], foot: 'paw',
        femurRest: [0.16, -0.90, 0.28], tibiaRest: [0.04, -0.96, -0.22] },
      /* Hind heavier than fore — 0.96 against 0.92 — which INVERTS the
       * massiff's 0.92/0.86. A dog carries its weight on the forehand and a
       * cat's mass is behind; it is two hundredths and it is the difference
       * between the two animals' outlines from the side. */
      { role: 'leg', x: 0.18, y: 0.03, z: -0.26, plant: 0.16, femur: 0.23, tibia: 0.25, tarsus: 0.09,
        girth: 0.96, pole: [0.16, 0.30, -0.70], foot: 'paw',
        femurRest: [0.16, -0.88, -0.32], tibiaRest: [0.04, -0.95, 0.24] },
    ],
    /* PAW, and it is chosen for the ankle rather than for the toes. `ANKLE_UP`
     * rides a claw or a hoof at 0.84-0.90 of the tarsus and a paw at 0.30, so
     * a paw is the one foot in the table that sets the body DOWN — and
     * `stanceOf` then gives it `toe: 0.75`, a sole that lies along the ground
     * instead of dropping onto a point. That is what a small animal sitting
     * low looks like. The geometry agrees: a paw is a broad flat plate with
     * three short toes, against the claw's three 0.26 hooks. The nexu is the
     * other cat here and it wears claws, correctly — it is a thing that rakes.
     * This one has nothing to rake with, so it should not be wearing the
     * hardware for it. */
    step: 0.44, lift: 0.20, rear: 0.10,
    /* Stride 0.44 against 0.46 of leg — 0.90, where the massiff runs 0.96 of
     * its own leg. Slightly short and therefore quicker per metre, which is
     * what a small animal keeping up with you looks like. `lift` is the one
     * number here that is proportionally the LARGEST in the table: 0.20/0.44
     * is 0.45 of the stride against the massiff's 0.35 and the reek's 0.35.
     * A kitten picks its feet up much higher than it needs to. It is one
     * number, it is free, and it is the only thing in this row that animates. */
    /* `rear` is the smallest in the file at 0.10 because it is very nearly
     * dead: `_poseWalker` spends it as `ST.rear * rise` and `rise` only ever
     * leaves zero inside a BEAST_MOVES pose, of which this animal has none.
     * It is not zero for the reason given under `moves` — if the brain's
     * fallback ever does fire, the tooka must not answer it by rearing up
     * like a war-dog. */

    /* ZERO VERBS, DECLARED HERE AND NOWHERE ELSE.
     *
     * This is the one row in the table whose move list is an assertion rather
     * than an inventory. Everything above it is a body that affords something
     * — the reek's horn, the acklay's reach, the massiff's jaws — and the
     * whole of this body affords nothing: the head has no weapon on it that
     * is not a milk tooth, the feet are soles, the tail is a fur whip, and
     * there is no mass anywhere to put behind any of them. An empty array is
     * the accurate reading of the anatomy, which is why it belongs on the
     * PLAN and not on the archetype — see the header on the two authorities,
     * and COMPANIONS.md's own line that the combat answer is "enforced rather
     * than tuned". A tooka with `damage: 0` and a lunge would still be an
     * animal that throws itself at people; a tooka with no verbs cannot.
     *
     * `[]` survives the handoff: `buildQuadruped` returns `P.moves || null`
     * and an empty array is truthy, and `beastMoveSet` prefers `built.moves`
     * over `DEFAULT_BEAST_MOVES` on the same test, so the floor that gives
     * the unlisted creatures a lunge is not reached.
     *
     * ── AND THE LINE THIS NOTE SAID WAS IN Enemy.js IS NOT THERE ──────────
     *
     * It read: "What DOES need one line is `_beastBrain`'s pick —
     * `moves[floor(rng() * moves.length)] || 'lunge'` — where an empty list
     * falls through the `||` and hands this animal the massiff's opener. That
     * line is the only thing standing between this row and a kitten that mauls
     * people, and it is stated in Enemy.js beside the pick, not here."
     *
     * The hazard is real and the guard was never written. Measured through the
     * shipped brain over 90 seconds against a motionless target
     * (tools/checks/beasts.mjs): a tooka entered the `lunge` state 49 times and
     * resolved a blow on the player 48 times. It falls through the `||` exactly
     * as feared, on this row and on the tauntaun's.
     *
     * WHAT ACTUALLY HOLDS IS `damage: 0` ON THE ARCHETYPE, and it holds
     * completely: those 48 resolutions moved the target's health by 0.0. So the
     * belt described on the archetype as bracing the empty move list is in fact
     * the only thing carrying it, and the two of them are now measured together
     * rather than assumed — the menagerie check asserts that a creature with an
     * empty move set deals literally zero damage in every evasion, standing
     * still included, which goes red the day anybody types a number over that
     * zero. Enemy.js is where the fallback lives and this row cannot reach it;
     * what this row can do is stop claiming a guard that does not exist. */
    moves: [],
  },

  /**
   * THE TUK'ATA WHELP — the Sith hound pup, and the cheapest row in the set.
   *
   * It is the NEXU'S SILHOUETTE AT A THIRD OF THE SIZE and it is written that
   * way on purpose: `stalker` already ships the long-low-horizontal cat — the
   * poles, the rest pair, the claw foot and the forward-carried head — and
   * re-authoring any of that would be inventing a difference the animal does
   * not have. What changes here is the two things that are actually different
   * about a whelp: it is BONIER and it is LEGGIER.
   *
   * Bonier is `girth` 0.21 against the nexu's 0.33 and the massiff's 0.28 —
   * the thinnest trunk in the table — with the swells halved (0.20/0.15
   * against the nexu's 0.34/0.26) and the section squared up to 3.0/3.4. A
   * thin body on a round section is a tube; the same body on a near-square
   * section keeps a corner along the flank, which is what makes it read as
   * angular rather than as small. `waist` 0.12 is the highest in the table by
   * a fifth: the ribcage ends and then there is nothing, which is the read the
   * whole design word "fragile" has to survive at forty metres.
   *
   * Leggier is `hip` 0.62 on a 1.06 trunk. At its archetype's 0.85 scale that
   * stands it 0.53 m at the hip against the massiff's 0.42 — TALLER THAN THE
   * MASSIFF WHILE BEING A SMALLER ANIMAL — because leg-to-body is where pace
   * is read from a distance, and this is the only companion that keeps up with
   * a sprint. Femur+tibia+tarsus is 1.48 of the hip height, between the
   * massiff's 1.45 and above the nexu's 1.40.
   *
   * WHAT IT DOES NOT GET IS THE TAIL AND THE MANE. The nexu's row says the
   * tail IS the read at range — 2.40 of scale, nearly five metres — and the
   * mane is the other half of it. Give a small cat both and you have not built
   * a whelp, you have built a nexu the player thinks is standing further away,
   * which is the same defect `BODYGUARD_KITS` measures at 0.658 IoU and calls
   * out. So: a 0.70 whip tail, and `back: 'ridge'`, which is bone standing off
   * the spine rather than quills raked off the shoulders.
   */
  tuk: {
    hide: 0x4a4038, plate: 0x9a9282, belly: 0x6b5f52, eye: 0xff3a2a,
    /**
     * LEGGY, AND THAT IS BOTH THE DESIGN AND THE MEASUREMENT.
     *
     * "THE ONE THAT OUTRUNS YOU INTO TROUBLE — the only companion fast enough
     * to follow a sprint". It sits exactly on the pace cap in
     * `CompanionKinds.js`, and an animal that runs at 6.33 m/s should read as
     * built for it: a greyhound against the massiff's bulldog.
     *
     * IT IS ALSO WHAT SEPARATES THE TWO SILHOUETTES, and three cheaper things
     * were tried first and are written down so nobody repeats them.
     * `_creature.mjs` calls a pair above 0.5 "two animals that share a body
     * plan"; massiff/tuk'ata measured 0.507.
     *
     *   GIVING THE TUK'ATA A MANE reached 0.450, and was WRONG: the design's
     *   own word for this animal is "bony, angular, SPINED", and a mane is the
     *   opposite read.
     *
     *   GIVING THE MASSIFF ITS OWN `scutes` + `paw` (which COMPANIONS.md says
     *   it should have had all along, and which it keeps) made them WORSE, at
     *   0.542 — low bosses change an outline less than spikes do, and a paw
     *   and a claw are nearly the same shape at range. The document's own
     *   choice is the right one for that animal and does nothing for this
     *   problem.
     *
     * So the separation is where it should have been from the start: the two
     * animals are different SHAPES. The hip goes 0.62 → 0.86 and the legs
     * lengthen with it, so this one stands over the massiff instead of beside
     * it, and the trunk comes up to match rather than hanging off the new hip.
     */
    hip: 0.86, trunk: [0.09, -0.22, 1.06], pitch: 0.09, girth: 0.19,
    /* Shoulder and haunch at half the nexu's amplitude. A pup's mass has not
     * arrived yet; what is on the shoulder is scapula, and a gaussian big
     * enough to read as muscle would be the one thing on the body arguing
     * against the health bar. */
    swells: [[0.76, 0.20, 0.20], [0.24, 0.15, 0.22]],
    section: { n0: 3.0, n1: 3.4, back: 0.06, keel: 0.05, waist: 0.12 },
    /* headAt is the nexu's 0.686 of trunk length, unchanged — a cat carries
     * its head off the front of the body, and that ratio is the pose. `neck`
     * keeps the nexu's three segments and its curl and shortens the segment
     * from 0.24 to 0.15; pitch 0.10 against 0.06 carries the skull a little
     * above the spine line, which is the one place a pup differs from the
     * adult and the reason it is visible over the cover it is running past. */
    headAt: [0.16, 0.72], neck: [3, 0.15, 0.13, 0.10, 0.02], head: 'fanged',
    /* `ridge` and not `mane`: see the note above on not building a small nexu.
     * The ridge is also the one dorsal treatment that goes into the trunk's
     * PRIMARY mesh rather than the silhouette kit, so the spines survive the
     * LOD rung that a companion spends most of its life on — it is behind you
     * at thirty metres more often than it is in front of you at ten. */
    /* SPINED, and it stays spined: the design's own word for this animal is
     * "bony, angular, spined", and a mane is the opposite read. The overlap it
     * shared with the massiff is fixed on the MASSIFF's row instead — see the
     * note there — because that is the row that had drifted. The longer tail
     * stays: on a low body the tail is the part that carries at range, which
     * is the nexu's own argument at 2.40. */
    back: 'ridge', tail: [5, 1.15, 0.055, 0.16, -0.14],
    limbs: [
      /* The nexu's fore leg, shortened and thinned. `pole` keeps its direction
       * and loses its length with the body; `femurRest`/`tibiaRest` are
       * COPIED EXACTLY, because a bind pose is a direction and not a size —
       * nothing about being small changes which way a cat's elbow faces, and
       * the header's own warning is about rest pairs authored for one animal
       * being worn by another. `plant` 0.26 against the nexu's 0.34 and the
       * massiff's 0.34 is the narrowest track in the table: a narrow track is
       * what a runner has, and it is 0.22 m of stance at 0.85 scale. */
      { role: 'leg', x: 0.20, y: 0.04, z: 0.53, plant: 0.26, femur: 0.52, tibia: 0.58, tarsus: 0.16,
        girth: 0.72, pole: [0.18, 0.38, 0.86], foot: 'claw',
        femurRest: [0.10, -0.88, 0.42], tibiaRest: [0.04, -0.94, -0.30] },
      { role: 'leg', x: 0.22, y: 0.02, z: -0.45, plant: 0.28, femur: 0.55, tibia: 0.61, tarsus: 0.16,
        girth: 0.78, pole: [0.18, 0.44, -0.90], foot: 'claw',
        femurRest: [0.10, -0.82, -0.50], tibiaRest: [0.04, -0.92, 0.36] },
    ],
    /* `step` 0.86 is 0.73 m of stride at scale against the nexu's 2.04 and the
     * massiff's 0.49 — short strides taken fast, which is what a small thing
     * moving at 6.3 m/s has to look like. `lift` 0.34 sits above the massiff's
     * trot and below the nexu's: it bounds.
     *
     * `rear` is the one number NOT scaled down with the body, and deliberately.
     * It is metres of hip travel per unit of an attack's `rise` and it is
     * multiplied by scale, so the nexu's own 0.42 would buy 0.36 m here. The
     * pounce coils to rise -0.9 and the coil is the whole telegraph — the move
     * is answered in the last tenth of it (see BEAST_MOVES.pounce) — so a
     * gather the player cannot see from across the room is a window that does
     * not exist. 0.46 buys 0.39 m of drop on a 0.53 m hip. */
    step: 0.86, lift: 0.34, rear: 0.46,
    /* Two verbs, for the reason the massiff's row states and does not need
     * restating here. They are the nexu's first two minus the charge: a
     * fifty-kilo pup does not run anything down — the POUNCE is how it arrives
     * (it commits at the launch, so it closes ground it could not walk) and
     * the RAKE is the only thing it can do once it is there. Its damage is on
     * the archetype and it is small; the point of the pair is that the pounce
     * knocks a body over for your blade, not that it kills. */
    /* THE SAME THIRD VERB AND THE SAME GATE, for the opposite reason. This is
     * the fastest thing the player can own and the one that outruns him into
     * trouble; a whelp that has been opened up and still only pounces is an
     * animal whose fight has one gear. `charge` at phase 3 is the gear. */
    moves: ['pounce', 'rake', 'charge'],
  },

  /**
   * THE RANCOR PUP — the wrecker, and the second body in the table that is
   * not a level's problem but yours.
   *
   * It is the `brute` pattern and it is meant to be recognisable as one: two
   * plantigrade hind legs off `hips`, two `role: 'arm'` limbs off `body`, no
   * neck, a tail. Nothing about that layout is new — `creatureSkeleton`
   * spans it for the rancor and the gundark already, and the arms buy the
   * swing-and-throw path in `_poseWalker` for free, which is the whole reason
   * the wrecker is a plan row and not a behaviour.
   *
   * WHAT MAKES IT A PUP IS PROPORTION, NOT SCALE. Dropping the archetype's
   * scale alone gives a small rancor, which is a rancor seen from further
   * away. A juvenile is a big head on a short barrel with stumpy limbs, and
   * `buildCreatureHead` sizes the 'tusked' skull off S with no per-plan knob,
   * so the only lever that exists is shrinking everything the head is
   * measured AGAINST: the trunk is 0.62 against the rancor's 0.74, the arms
   * come to 0.94 of reach against 1.16, and the head stays where S puts it.
   * The skull is 1.5 trunk-radii wide here against the rancor's 1.26.
   *
   * The height is chosen against the massiff and not against the rancor. Hip
   * 0.78 at the archetype's 0.55 scale is 0.43 m, which is the massiff's
   * 0.42 m to within a centimetre — the shipped companion argues for being
   * below the player's eye line and that argument is not re-run here, it is
   * matched. Crown lands near 0.97 m: the rancor's silhouette at a sixth of
   * its height, which is the joke the kind is for.
   */
  pup: {
    /* Lighter than the rancor's 0x6b6152 hide and 0x585044 plate, because
     * every one of those greys is weathering and this animal has not had
     * any yet; the eye keeps the family's amber but paler. */
    hide: 0x7d7360, plate: 0x6a6152, belly: 0x9c9280, eye: 0xffe08a,
    hip: 0.78, trunk: [0.10, -0.08, 0.62],
    /* LESS upright than the rancor's 1.02, which looks backwards and is not.
     * The pose the reference is always in puts the knuckles on the sand, and
     * this one's arms are 0.81 of the rancor's proportional reach — pitching
     * the trunk up would hang them in the air. Lowering the shoulder is what
     * lets a short arm still touch the ground. */
    pitch: 0.88, girth: 0.50,
    /* The masses swap ends. The rancor carries 0.44 over the shoulder because
     * that is where a slam is thrown from; a pup's bulk is gut — 0.30 at the
     * shoulder and 0.34 at the haunch, the only row in the table where the
     * back mass is the larger of the two. */
    swells: [[0.78, 0.30, 0.28], [0.30, 0.34, 0.36]],
    /* ROUNDER THAN ANYTHING SHIPPED. The nexu is the current floor at
     * 2.4/2.8 and the rancor sits at 2.6/3.2; 2.0 would be a plain ellipse,
     * so 2.1/2.4 is as round as the section goes while still being a
     * superellipse. The waist drops to 0.02 from the rancor's 0.04 for the
     * same reason: a barrel does not pinch. */
    section: { n0: 2.1, n1: 2.4, back: 0.03, keel: 0.04, waist: 0.02 },
    headAt: [0.54, 0.30], neck: [1, 0.10, 0.30, 0.30, 0], head: 'tusked',
    back: 'ridge',
    /* Shorter, and shorter than the shrink: 0.72 of reach against the
     * rancor's 1.30 is 1.16 trunk-lengths where the rancor is 1.76. A tail
     * as long as the adult's would be the one part of the outline that read
     * as full-grown, and the tail is drawn as one swept tube, so it costs
     * nothing to have less of. The tighter curl (-0.18 against -0.14) keeps
     * the tip off the sand on a body this low. */
    tail: [4, 0.72, 0.14, 0.12, -0.18],
    limbs: [
      /* The hind legs. Still plantigrade and still poled FORWARD and low —
       * the rancor's argument holds and is not repeated. Femur and tibia
       * come down to 0.42/0.44 from 0.52/0.54 to stand a 0.78 hip instead of
       * a 0.92 one, but the tarsus only goes 0.26 → 0.24: the sole stays big
       * relative to the leg, which is both what a juvenile's foot looks like
       * and what a body that slams needs to stand on. `girth` 1.45 against
       * the rancor's 1.30 is the same thought — this is a stumpy leg, not a
       * scaled one. Plant 0.44 on a 0.78 hip is a wider stance than the
       * rancor's 0.46 on 0.92, because the base under a slam does not scale
       * down with the animal doing it. */
      { role: 'leg', x: 0.30, y: 0.02, z: -0.08, plant: 0.44, femur: 0.42, tibia: 0.44, tarsus: 0.24,
        girth: 1.45, pole: [0.30, 0.52, 1.05], foot: 'paw',
        femurRest: [0.16, -0.90, 0.34], tibiaRest: [0.04, -0.96, -0.26] },
      /* The arms, and they are the short part. 0.94 of reach against the
       * rancor's 1.16 — the knuckles come down near the sand rather than
       * onto it, which is the pitch's problem above and is why it is 0.88.
       * `hand` is required, not decorative: `_poseWalker` only runs the
       * arm-swing-and-throw branch for a limb that has one. It is drawn in
       * to [0.54, -0.16, 0.54] from [0.62, -0.22, 0.66] — proportionally
       * forward of the rancor's hang, so the arms read as held rather than
       * dangling, without going to the gundark's raised reach. */
      { role: 'arm', x: 0.40, y: 0.32, z: 0.20, femur: 0.36, tibia: 0.38, tarsus: 0.20,
        girth: 1.00, pole: [0.52, -0.08, -0.80], foot: 'talon',
        femurRest: [0.16, -0.96, 0.22], tibiaRest: [0.06, -0.98, 0.16],
        hand: [0.54, -0.16, 0.54] },
    ],
    /* A waddle. Step 0.58 on legs of 0.42/0.44 is a shorter stride per unit
     * of leg than the rancor's 0.72 on 0.52/0.54, and the lift comes down
     * with it — this animal does not pick its feet up. `rear` goes the other
     * way, 0.34 against 0.30, and that is deliberate: rear is metres of hip
     * travel per unit of an attack's `rise` ×scale, so at 0.55 scale the
     * slam's 1.5 rise buys 0.28 m of hip. Against a 0.43 m hip that is
     * two thirds of its own standing height, which is the only way a slam
     * telegraph stays legible on a body this small. */
    step: 0.58, lift: 0.26, rear: 0.34,
    /* Its verbs, declared HERE and not in the archetype — the massiff's
     * precedent rather than the rancor's, and the difference is real: the
     * rancor's set is a level designer's statement about a set-piece, and no
     * level ever composes a companion, so there is nobody upstream to
     * disagree with. SLAM is the kind (COMPANIONS.md: the only companion
     * whose attack changes the level rather than the enemy), SWEEP is the
     * arm arc the adult already carries and the phase-2 escalation, and
     * LUNGE is the floor every animal has. There is no rake and no charge:
     * a thing that weighs 150 kg and moves at 3.6 m/s does not run anything
     * down, and it has hands rather than claws.
     *
     * ── AND IT SAID `toss`, WHICH IS THE SLAM WEARING A DIFFERENT NAME ────
     *
     * COMPANIONS.md asks for slam/toss/lunge and gives the reason — the toss
     * "reuses the biggest upward impulse in the game at a small scale", which
     * is `lift: 2.4` against everything else's 0.5–1.5. The impulse is real.
     * The WIND-UP is not: `slam` and `toss` are the only two rise-positive
     * moves in BEAST_MOVES and their poses are 1.50 and 1.25 of rise on the
     * identical quarter-sine curve, so on any body that carries both they are
     * ONE GESTURE AT 83% AMPLITUDE. `rear` is a single scalar per animal —
     * "metres of hip travel per unit of an attack's rise" — so there is no
     * number in this row that can separate two moves whose only difference is
     * how much rise they ask for.
     *
     * Measured on the built rig, posed by `_poseWalker` through each move's own
     * wind-up (tools/checks/beasts.mjs): slam and toss were 46 mm apart at
     * their widest, 11.2% of this animal's 0.408 m stance, against a roster
     * floor of 16.5% — the adult Rancor's own slam and sweep, which is the
     * tightest pair anything else in the game asks a player to read. It is the
     * only pair below the floor on every denominator tried: 23.5% against 32.3%
     * measured across the whole rig instead of the hips, and 16.6% against
     * 32.8% measured as a fraction of the larger of the two travels. Nor does
     * timing rescue it — the toss's wind-up is 0.70 s and the slam's 0.95, but
     * in that shared first 0.70 s the two bodies are 27 mm apart, and by the
     * time the durations differ the toss has already landed. You would learn
     * which one it was by being hit.
     *
     * `sweep` is 1.00 of rise, so the gap to the slam is 0.50 — 22.9% of this
     * animal's stance, above the floor and above the adult's own closest pair.
     * It is the same arm the toss used, the adult Rancor already carries it,
     * and `unlock: 2` makes it the escalation rather than a third opener. What
     * is lost is the 2.4 lift on this one body; what is bought is that a player
     * watching a rancor pup rear can tell which of the two things is coming.
     * COMPANIONS.md's move list is the thing this diverges from, deliberately
     * and with the measurement above; the doc is not edited from here. */
    moves: ['slam', 'sweep', 'lunge'],
  },

  /**
   * THE TAUNTAUN — the first RIDEABLE body in CREATURE_PLANS, and the only row
   * in the table that declares no verbs at all.
   *
   * COMPANIONS.md ("The twelve kinds") settles what it is: "PACE ON FLAT
   * GROUND AND NOTHING ELSE. Fastest of the three mounts, useless in battle
   * exactly as asked." Everything below is that sentence turned into numbers,
   * and the two shapes it has to hold are (a) a body a player sits ON, and
   * (b) a two-legged outline nobody mistakes for the wampa at forty metres,
   * since those are the only two bipeds in the table.
   *
   * ONE LIMB ENTRY, WHICH IS TWO LEGS. `creatureSkeleton` expands every entry
   * left and right, so the brute and the pouncer each declare one 'leg' pair
   * plus one 'arm' pair. This declares the leg pair and stops: no arms, which
   * is the whole silhouette difference from the pouncer. That animal is a
   * vertical barrel (pitch 1.32) with its hands out; this is a horizontal one
   * on stilts with a counterweight behind it. Same shag, same head branch,
   * nothing alike in profile.
   *
   * LONG LEGS STATED AS A RATIO, because that is what the eye reads. hip 0.98
   * against a 0.95 trunk — the hip stands as high as the body is long, where
   * the massiff's hip is half its trunk and the stalker's is exactly half of
   * its 1.72. It is above the brute's 0.92 and below the acklay's 1.62, which
   * is right: the acklay's height is a tripod's clearance, this is a runner's.
   * At scale 1.45 (the archetype) that is 1.42 m at the hip and a back at
   * about 1.85 m — a saddle you climb onto, not one you step over.
   *
   * IT CANNOT TAKE GRADES, and that is the varactyl's job rather than a
   * number here — see COMPANIONS.md. Nothing in this row encodes it.
   */
  taun: {
    /* Grey-white over tan, the only pale hide in the table: six creatures in
     * this file are sand and rust, and the animal you own has to be findable
     * on the same sand they are fought on. The EYE is the deliberate one —
     * 0x8a5a2e is the dimmest in the table by a wide margin, against the
     * stalker's 0x66ff9a and the acklay's 0xffdd44. Those are warning lights
     * on predators. `emissiveMat` runs at 2.8 either way, and a lamp burning
     * on the head of the thing you are sitting behind is a lantern pointed at
     * your own night route. */
    hide: 0xb9b2a4, plate: 0x8e8577, belly: 0xd8d2c4, eye: 0x8a5a2e,
    /**
     * IT STANDS LIKE A RUNNER NOW, AND IT WAS HANGING NOSE-DOWN.
     *
     * Three numbers were fighting each other and the arithmetic says so:
     *
     *   `trunk[1]` was −0.40, hanging the barrel that far BELOW the hip on a
     *   body 0.95 long — which drops the chest to the ankles.
     *
     *   `pitch` was −0.10, which then aims the nose at the sand.
     *
     * Both pushed the same way, which is why it read as an animal sagging
     * rather than one standing. A tauntaun is the FASTEST thing you own and
     * the one you get ON — it has to look like it is about to move, and it has
     * to have a back you would believe a saddle sits on.
     *
     * AND `plant` IS NOT THE THIRD NUMBER, which is worth writing down because
     * the name invites the mistake: it is the foot's LATERAL stance —
     * `x: (L.plant ?? L.x) * S * side` — not how far the leg extends. Raising
     * it from 0.30 to 0.92 to "straighten the leg" widened the animal from
     * 1.68 m across to 3.07 and changed its height by nothing at all. Measured,
     * reverted, and recorded here so the next person reads it instead of
     * measuring it again.
     */
    hip: 0.98, trunk: [0.12, -0.46, 0.95], pitch: 0.50, girth: 0.34,
    /* THE SWELLS ARE REVERSED FROM EVERY SHIPPED ROW, and it is the one
     * anatomical claim in here. The charger is [[0.74, 0.52, …], [0.24, 0.24,
     * …]] and the massiff, stalker, brute, pouncer and acklay are all the same
     * shape: shoulder big, haunch small, because they are quadrupeds that
     * drive from the front. A two-legged runner puts its engine at the BACK —
     * haunch 0.44 against a shoulder of 0.30 — and without that the body reads
     * as a quadruped that has lost its forelegs. */
    swells: [[0.72, 0.30, 0.22], [0.22, 0.44, 0.30]],
    /* t runs rear to front (see the lathe's capY0/capY1), so n0 is the
     * haunch and n1 the chest. 3.0 → 2.6 is boxy at the back and rounder
     * forward, which is the opposite direction to every other row and is
     * chosen for the saddle: the rider sits over the hips, so the slab-sided
     * section belongs where his knees are and the deep round chest can stay a
     * chest. `back` 0.07 is the highest in the table (massiff and stalker
     * 0.04, charger 0.02) — `_measurePlatform` takes the highest vertex
     * inside the central 60% of the hull, and a circular section gives it a
     * crown one vertex wide, which is a ridgepole rather than a seat. `waist`
     * 0.10 matches the stalker's, the deepest pinch shipped, for the same
     * reason from the other side: at girth 0.34 the widest part of the animal
     * would otherwise be exactly under the rider's knees. */
    section: { n0: 3.0, n1: 2.6, back: 0.07, keel: 0.08, waist: 0.10 },
    /**
     * …AND THE HEAD COMES UP, WHICH TOOK READING THE SCHEMA RATHER THAN
     * GUESSING AT IT. `neck` is `[segs, length, radius, pitch, curl]`, and this
     * row already asked for a strong upward pitch of 0.62 — it just had only
     * 0.20 of neck to apply it to, which is the massiff's own length on an
     * animal three times the size. A lever that short cannot lift anything, so
     * the head sat on the shoulders and pointed at the sand whatever the pitch
     * said.
     *
     * 0.52 is the longest neck in the table and it is what this animal is: the
     * head is held HIGH and forward, which is what makes a tauntaun read as a
     * runner from behind — and, when you are on it, is the difference between
     * a mount you steer by and a barrel with a saddle.
     */
    headAt: [0.62, 0.86], neck: [2, 0.22, 0.21, 0.16, -0.02], head: 'snouted',
    /* THE NECK GOES UP, and it is the only one that does. The massiff (-0.30),
     * the charger (-0.44) and the acklay (-0.30) all sweep DOWN because they
     * carry a weapon in front of their eyes and have to aim it; the stalker is
     * level at 0.06. This one starts at 0.62 and curls -0.22 a segment, so it
     * stands out of the withers and then levels off — three segments of 0.20
     * is 0.87 m of neck at scale. A head carried at the height of the thing
     * behind it is a head the rider looks OVER rather than through.
     *
     * `horned-ape` is the nearest existing branch and it is not a perfect fit
     * — see the report. It buys the two things that matter: horns curving
     * sideways off the temples rather than forward, and the fur ruff round the
     * jaw that carries the head's outline into the coat. What it costs is a
     * short broad face where a tauntaun has a muzzle, and an underbite of
     * fangs on an animal that does not bite anything. No new string was
     * invented for it. */
    back: 'shag', tail: [4, 0.80, 0.15, 0.10, -0.06],
    /* THE TAIL IS THE COUNTERWEIGHT AND IS SIZED AS ONE. r0 0.15 is the
     * brute's 0.16 and not the stalker's 0.085 — the nexu's tail is a whip
     * and its read is length (2.40), this one is a mass and its read is
     * thickness. curl -0.06 is the flattest in the table (massiff -0.10,
     * brute -0.14) so it holds out behind instead of drooping: a two-legged
     * body whose tail hangs reads as standing up, and this one never does. */
    limbs: [
      /* THE ONE PAIR. Poled BACK and high — [0.26, 0.70, -1.35], further back
       * than the stalker's hind at -1.20 — so the hock stands behind the
       * animal and the leg reads as a bird's. The alternative was the brute's
       * plantigrade forward pole, and it was rejected on the same ground the
       * swells were: a rancor stands, and this thing only ever runs.
       *
       * 0.58 + 0.62 + 0.22 = 1.42 of leg under a 0.98 hip. The ratio 1.45 is
       * deliberately the brute's and the stalker's (both 1.43) rather than
       * something longer, because that ratio is KNEE BEND and not leg length:
       * straighten it further and `solveIK` has no room to fold, so the
       * fastest thing in the roster would be the one whose gait stops
       * bending. The length is bought with `hip` instead, which is where it
       * belongs.
       *
       * plant 0.30 against the pouncer's 0.42 and the brute's 0.46 — the
       * narrowest stance of any biped here. A body running on two legs tracks
       * its feet toward the centreline; splayed, it waddles. girth 1.02 sits
       * between the stalker's 0.96 and the pouncer's 1.20: it is not a
       * cat's leg, because it carries a rider, and it is not a wampa's,
       * because it has to swing at speed. */
      { role: 'leg', x: 0.24, y: 0.03, z: -0.02, plant: 0.30, femur: 0.58, tibia: 0.62, tarsus: 0.22,
        girth: 1.02, pole: [0.26, 0.70, -1.35], foot: 'claw',
        femurRest: [0.12, -0.88, -0.44], tibiaRest: [0.04, -0.93, 0.36] },
    ],
    /* The longest stride in the table after the acklay's: 1.30 × 1.45 is
     * 1.89 m against the stalker's 2.04 at 8.6 m/s. It moves at 6.1 (the
     * archetype), so the cadence is slower than the nexu's on a stride nearly
     * as long, which is a bound rather than a scurry and is what the legs
     * were bought for. lift 0.46 is above the stalker's 0.44 for the same
     * reason: a hock that high has to clear.
     *
     * `rear` 0.12 is the lowest in the table — under the acklay's 0.26 — and
     * it is low BECAUSE of `moves` below. `rear` is metres of hip travel per
     * unit of an attack's `rise`, and with no attack there is nothing to
     * telegraph; what is left of it is flinches and the topple, and every
     * centimetre of that is a rider being lifted out of a seat that is
     * written from this body's own platform. */
    step: 1.30, lift: 0.46, rear: 0.12,
    /* NO VERBS, AND THE EMPTY ARRAY IS THE ENFORCEMENT RATHER THAN A NOTE.
     * `beastMoveSet` returns the first truthy of archetype, plan, default, and
     * `[]` is truthy — so a declared empty set reaches `_beastBrain`, which
     * filters it by phase and finds nothing to reach for at any health. The
     * archetype deliberately declares no `moves` of its own, so this line is
     * the only statement of it in the game.
     *
     * The alternative was `lunge` "so it can defend itself", and it is the
     * one thing this animal must not have: the brief is that arriving at a
     * fight is something you DISMOUNT to do, and a mount that trades on its
     * own makes the dismount optional. The blurrg is the mount that bites,
     * and it is a different row. */
    moves: [],
  },

  /**
   * THE BLURRG — the second of the three mounts, and the only body in the
   * table that is ridden AND bites.
   *
   * TWO LEGS, ONE LIMB ENTRY. `limbs[]` is expanded left and right by
   * `creatureSkeleton`, so a two-legged animal is one row and needs nothing
   * written; the rancor and the wampa are the proof that a plan with a single
   * leg pair already walks. What makes this one unmistakable from the other
   * two mounts at forty metres is not the leg COUNT — the rancor has two as
   * well — it is where the mass sits: the haunch swell is 0.58, the largest
   * single swell in the table against the reek's shoulder at 0.52, and the
   * shoulder is 0.18, the smallest. Every animal above this carries its mass
   * over the front legs it has. This one has none, so the barrel hangs off
   * the hips and the head is thrown out in front on a short neck to pay for
   * it. That is a two-legged outline before the legs are visible at all.
   *
   * `pitch: 0.45` is the only mid value in the table — the reek is level at
   * -0.13 and the rancor stands at 1.02 — and it is the one number that makes
   * it a MOUNT. A level spine gives a shelf and a vertical one gives a wall;
   * a 26-degree spine gives a back that rises from the hips to the shoulder,
   * which is the shape a saddle sits in the top of. `trunk[1]` is -0.26, the
   * most rearward trunk mount in the table (the reek is -0.20 across four
   * legs), because a biped whose barrel starts at the hip joint puts every
   * kilo of it in front of the only two feet it has.
   *
   * The rider is why `back` is `'ridge'` and not one of the other three, and
   * the reason is stated above `if (P.back === 'ridge')` rather than repeated
   * here: the ridge is the only dorsal treatment that goes into the trunk's
   * PRIMARY mesh, and `Enemy._measurePlatform` measures a deck off the body
   * bone's parts. A mane, scutes or shag would stand over the hull the rider
   * is measured against instead of being part of it, so the saddle would sit
   * inside the animal. A blurrg's back is a low bony line rather than a crest,
   * so it is written as one — the ridge here is 0.30 of scale of relief where
   * the massiff's is the animal's whole read.
   */
  blurrg: {
    hide: 0x77685f, plate: 0x8e8175, belly: 0xa4988a, eye: 0xb8452c,
    /* Scale 1.7 is declared on the archetype and is deliberately the NEXU's,
     * to the digit: same size, opposite proportions, so the pair says out loud
     * that these rows are the animal and not its bounding box. Against that
     * nexu — hip 0.86, girth 0.33, trunk 1.72 long — this is hip 0.86, girth
     * 0.44 and a trunk 1.10 long. Two thirds the length at a third again the
     * barrel: squat and wide, from three numbers. */
    hip: 0.86, trunk: [0.10, -0.26, 1.10], pitch: 0.45, girth: 0.44,
    /* Shoulder nearly flat, haunch enormous. The reek's pair is [0.74, 0.52]
     * and [0.24, 0.24] — mass forward — and this is that inverted. */
    swells: [[0.62, 0.18, 0.26], [0.26, 0.58, 0.34]],
    /* Rounder than the reek's 2.8/3.4 so it reads as a barrel rather than a
     * slab; `back: 0.07` is the largest dorsal flattening in the table and it
     * is here for one reason — it is the only body a person sits on, and a
     * seat wants a facet. It costs about 5 cm of deck height at this scale,
     * which is cheaper than a rider perched on a cylinder. `keel: 0.10` is the
     * gut, and `waist: 0.02` is nearly nothing: the nexu's 0.10 pinch is a
     * cat's flank and this animal has no waist to pinch. */
    section: { n0: 2.4, n1: 2.9, back: 0.07, keel: 0.10, waist: 0.02 },
    /* THE NECK PITCHES DOWN OUT OF A SPINE THAT PITCHES UP, and that is the
     * bite. -0.55 against the trunk's +0.45 leaves the head hanging level and
     * forward with the jaw at about a standing man's chest, so what the animal
     * can reach while you are on its back is a body on the GROUND beside it.
     * A neck that followed the spine would put the jaws at the height of the
     * rider's own shoulder, which is a mount that can only bite other mounts.
     * Two segments at 0.16 — shorter than the massiff's 2 x 0.14 in fraction
     * of body, because a heavy head on a long neck on two legs is a pendulum.
     *
     * AND `headAt[0]` IS 0.72 BECAUSE THE SPINE IS TILTED, which is the whole
     * of what was wrong with this animal and with the tauntaun beside it. The
     * head bone hangs off `body` at `[0, headAt[0]·s, headAt[1]·s]` and the
     * BONE CHAIN IS NOT PITCHED — only the trunk MESH is, by `trunkRot`. So on
     * a level-backed animal `headAt[0]` is height above the spine and reads as
     * written, and on a pitched one the spine has already climbed
     * `sin(pitch) · headAt[1]` by the time it reaches that station and
     * `headAt[0]` is measured from the wrong place.
     *
     * At +0.45 over a station 0.86 down the body the spine is 0.374 up, and
     * this row asked for 0.40: twenty-six millimetres of clearance on an
     * animal 0.44 thick. The head was INSIDE the chest, and the render showed
     * exactly that — a bean with a lump on the front and no face anywhere.
     * 0.72 leaves 0.35, which is 0.79 of girth and lands this row in the band
     * the eleven other plans occupy. `tools/checks/beasts.mjs` now pins the
     * ratio for every plan, so the next pitched body fails a check instead of
     * shipping with its head in its ribs.
     *
     * The rancor (0.62 of girth clear) and the wampa (1.01) were already
     * compensated by hand by whoever authored them; nothing here moves them. */
    headAt: [0.72, 0.86], neck: [2, 0.16, 0.24, -0.55, -0.12], head: 'tusked',
    back: 'ridge', tail: [3, 0.46, 0.17, -0.10, -0.12],
    limbs: [
      /* ONE PAIR, and it carries a rider as well as the animal. `girth: 1.45`
       * is the heaviest limb in the table — the rancor's 1.30 is the current
       * maximum, on a body twice this scale — because two legs are doing what
       * four do everywhere else in this file.
       *
       * THE STANCE IS THE HANDLING. `plant: 0.56` off a hip mounted at 0.38 is
       * the widest track any biped here stands on (the rancor plants at 0.46,
       * the wampa at 0.42), and a wide-tracked body pivots badly for the same
       * reason it is stable: the feet are a long way from the axis. The turn
       * rate itself is the rider's number and lives with the rider; this is
       * the silhouette that has to agree with it, so a player who has been
       * told it turns like a barge can SEE the barge.
       *
       * Poled forward and OUT at 0.55 against the wampa's 0.36, so the knees
       * stand outside the trunk instead of under it. Digitigrade, hence
       * `foot: 'claw'` and not the two uprights' `'paw'`: `ANKLE_UP` rides a
       * claw at 0.86 of the tarsus and a paw at 0.30, so the choice is a
       * standing posture and not a decoration. Measured against the rancor,
       * the shipped biped at the same hip height: its chain spans 0.87 m of
       * 1.06 and this one spans 0.71 of 0.96, so the leg sits at 0.74 of full
       * extension against the rancor's 0.82 — a deeper permanent crouch, which
       * is the squat read and is also where the animal's whole spring is. */
      { role: 'leg', x: 0.38, y: 0.02, z: -0.04, plant: 0.56, femur: 0.46, tibia: 0.50, tarsus: 0.22,
        girth: 1.45, pole: [0.55, 0.55, 1.05], foot: 'claw',
        femurRest: [0.24, -0.86, 0.28], tibiaRest: [0.06, -0.94, -0.32] },
    ],
    /* A SHORT, LOW, FAST GAIT, and two of these three exist because of the
     * saddle. `step: 0.62` is under everything but the massiff's 0.52, so at
     * the 5.1 m/s the archetype declares the cycle turns over quickly — a
     * waddle rather than the reek's 0.80 lope. `lift: 0.22` is the lowest of
     * any long-legged body here (the reek 0.28, the nexu 0.44): a high foot
     * lift under a saddle is a rider being thrown around by the animation.
     * `rear: 0.18` is the lowest number in the table full stop. It is metres
     * of hip travel per unit of an attack's `rise`, `lunge` crouches at -0.55,
     * so the deck drops about 0.17 m when it bites — felt, and not a launch.
     * The massiff's 0.22 was the floor and this goes under it for the one
     * reason that one does not have: somebody is standing on this. */
    step: 0.62, lift: 0.22, rear: 0.18,
    /* ONE VERB, which is one more than the other two mounts have and is the
     * entire difference between them. It is `lunge` and not `rake`, `gore` or
     * `snatch` because this animal has a jaw and nothing else — no horn, no
     * claw that leaves the ground, no reach — and because a mount whose attack
     * travelled would take the rider with it. `lunge` drives 0.5 m and closes;
     * the rider stays over the hips. The second verb every other fighting body
     * here carries is deliberately absent: see the massiff's note on giving a
     * companion the reek's move list. */
    /* THREE VERBS AND NOT ONE. A single-verb set fails `dodgeable.mjs` twice
     * over — one phase-1 move IS the "they all attack the same way" complaint
     * in the data, and with nothing above it the animal never escalates — and
     * a blurrg is the one mount authored to fight, so it is the last body in
     * the table that should have had a single loop.
     *
     * `toss` at phase 1 is what a blurrg's head does: 1.0 of reach against
     * lunge's 0.75 and 0.85 damage, a wide throw of the skull rather than a
     * snap, which is the move that makes a rider's mount dangerous to stand
     * beside. `charge` at phase 3 is the escalation and it is also the animal:
     * a blurrg comes round badly and commits straight, which is exactly the
     * `drive` aim. */
    moves: ['lunge', 'toss', 'charge'],
  },

  /**
   * THE VHAL'KIR HAWK — "an alien hawk/owl thing that only flys".
   *
   * IT NEVER LANDS, and that one sentence decides every number below. Three
   * things follow from it that are true of nothing else in this table:
   *
   *   THE STANCE PUBLISHES NO LIMBS. `tuck: true` — argued over `stanceOf` —
   *   so `_poseWalker`'s per-limb IK loop runs zero iterations and the legs
   *   hold the rest pose this row authors. Without it the animal cruises with
   *   two rigid spikes reaching 5.6 m down for a floor it is never on.
   *
   *   THE LEGS ARE AUTHORED FOLDED. `femurRest` is back and down and
   *   `tibiaRest` folds forward under it, so the talons are carried up under
   *   the tail the way a hawk carries them between stoops. On every other plan
   *   here the rest pair is a bind pose that the IK immediately overwrites;
   *   on this one it IS the pose, at every range, for the whole life of the
   *   body.
   *
   *   THERE IS NO TAIL TUBE. `tail: [0, …]` skips `P.tail` entirely and the
   *   `plumage` treatment builds a FAN instead — see it. A rope of flesh is
   *   what a massiff and a nexu have; a bird's tail has no core in it.
   *
   * ── THE PROPORTIONS ARE A BIRD'S AND NOT A SMALL QUADRUPED'S ────────────
   *
   * `hip` 0.30 against the tooka's 0.62 and the massiff's 0.44: the "hip" of a
   * flying body is only how far its mass sits above the point the flight model
   * is holding, and a bird hangs UNDER its wings rather than standing on
   * anything. `girth` 0.13 on a `trunk` 0.52 long is the narrowest body in the
   * table by a wide margin — 0.25 of length against the massiff's 0.33 and the
   * blurrg's 0.40 — because everything a bird weighs is in one place and that
   * place is not its width.
   *
   * `keel: 0.22` is the single most important number here and it is the
   * largest in the file (the blurrg's gut is 0.10). It is the STERNUM: the
   * flight muscle of a bird is a third of it and it all hangs off a keel under
   * the chest, so the body is deep and thin rather than round. Read against
   * `back: 0.02`, which is nearly nothing — flat on top, deep underneath, and
   * that section is the whole difference between a hawk and a feathered dog.
   *
   * `swells` puts 0.40 of extra radius at 0.66 along the trunk and almost
   * nothing at the tail: the mass is at the shoulders, over the wings, which
   * is where a flying animal's centre has to be or it flies backwards.
   *
   * ── THE WINGS ARE 2.6 m ACROSS, AND THAT IS THE ARCHETYPE ───────────────
   *
   * `arm` 0.62 + `fan` 0.58 a side plus the body is a 2.58 m span on a 0.52 m
   * body — five to one, which is a soaring bird's ratio (a harrier's is about
   * 4.5:1, an albatross's nearer 7) and is what makes this thing legible from
   * the ground it is never on. `rest` takes them out and slightly BACK and
   * `fanRest` carries the hand further back again, which is the swept planform
   * every raptor holds in a glide; a wing held square out is a heron.
   *
   * `chord` 0.34 is the plan's own field, read only by the wing dressing, and
   * it is the longest feather on the body: with the primaries at 1.00 of it
   * the outer wing is 34 cm of quill on a 58 cm hand, which is the proportion
   * that makes a wing tip look slotted rather than blunt.
   *
   * ── AND ITS ONE VERB IS A STOOP ─────────────────────────────────────────
   *
   * `pounce`, which is the shipped BEAST_MOVES row that commits its landing
   * point 0.55 s into the wind-up and arrives at 0.95 — a dive, decided in
   * advance, that a player can step out of. It is the only row in the table
   * whose shape is already a stoop, and the archetype prices it at damage that
   * staggers rather than kills (see COMPANION_UNITS). No second verb: a body
   * this size with no jaw has nothing else to do.
   */
  hawk: {
    /* Dark above and pale below — countershading, which is what every bird of
     * prey is coloured and the only reason one is hard to see against ground
     * and easy against sky. `belly` is the palest value in this table.
     *
     * `hide` was 0x4c4238 and is 0x6f5f4a, which is a RENDER and not a taste:
     * at the darker value the whole animal came back as one black blob in the
     * hangar's own light, with the pale coverts the plumage treatment lays
     * over it invisible against it. The countershading only reads if the dark
     * half is a colour rather than an absence. */
    hide: 0x6f5f4a, plate: 0xc9bda2, belly: 0xf0e7d3, eye: 0xf2b21c,
    /* THE BODY IS A TEARDROP AND NOT A BALL, and the first build was a ball:
     * `girth` 0.13 with a 1.40 shoulder swell is a 36 cm barrel on a 52 cm
     * trunk, which rendered as a fat mammal with wings on. A hawk's body is
     * about a fifth of its own length across. 0.095 on a 0.64 trunk is 27 cm
     * over 64, and the keel carries the depth the width no longer has. */
    hip: 0.30, trunk: [0.04, -0.12, 0.64], pitch: 0.06, girth: 0.095,
    swells: [[0.64, 0.44, 0.26], [0.20, 0.10, 0.24]],
    section: { n0: 2.2, n1: 2.6, back: 0.02, keel: 0.26, waist: 0.06 },
    /* A SHORT S-NECK CARRIED UP. `nPitch` 0.42 is the steepest in the table
     * (the varactyl's 0.62 is the only steeper one and it is a long neck) and
     * `nCurl` −0.30 turns it back over so the head finishes level and forward
     * — which is the S every bird's neck is, done in two segments. */
    headAt: [0.15, 0.44], neck: [2, 0.070, 0.070, 0.40, -0.28], head: 'beak',
    back: 'plumage', tail: [0, 0, 0, 0, 0],
    /* `z` 0.36 IS THE SHOULDER AND IT WAS -0.04, WHICH WAS THE TAIL.
     * `creatureSkeleton` places a wing root in the BODY BONE's frame, where +Y
     * is up the animal and +Z is forward along the trunk — the same frame
     * `headAt` uses, and the head sits at 0.46. At -0.04 the wings left the
     * body four centimetres BEHIND its own origin, which is the tail end: seen
     * from above the animal was an arrow with a flight at the back of it. 0.36
     * is over the shoulder swell (`swells` puts the mass at 0.64 of a 0.64 m
     * trunk), which is where a flying body's wings have to be or its centre of
     * mass is behind its own lift. */
    /* `chord` 0.44 AND NOT 0.34: seen from above at 0.34 the wing was a ROPE —
     * a 5.6 cm spar with 12 cm of feather behind it on a 1.2 m semi-span, so
     * the eye read the leading edge and nothing else. A soaring bird runs
     * about 4:1 span to chord and this is 5.5:1, which is still a long thin
     * wing and is now a SURFACE. */
    wings: { x: 0.09, y: 0.07, z: 0.36, arm: 0.62, fan: 0.58, chord: 0.44,
      rest: [0.88, 0.24, -0.40], fanRest: [0.94, 0.06, -0.34] },
    limbs: [
      /* ONE PAIR, SHORT, AND FOLDED. 0.16 + 0.18 of leg on a 0.52 body is the
       * shortest limb-to-trunk ratio in the file; `girth` 0.55 is the thinnest.
       * `plant` and `pole` are written down and are never read — `tuck` means
       * `stanceOf` never reaches them — and they are here rather than deleted
       * because they are what a future flightless variant of this plan would
       * need, and a row that is silently a different shape from every other row
       * in the table is how the next reader gets caught. */
      { role: 'leg', x: 0.06, y: -0.03, z: 0.02, plant: 0.10, femur: 0.13, tibia: 0.15, tarsus: 0.075,
        girth: 0.50, pole: [0.16, 0.20, 0.50], foot: 'raptor',
        /* TRAILING, NOT HANGING. The first pair pointed the femur back and the
         * tibia FORWARD again, which is a folded landing gear and rendered as
         * two stilts under the animal. Both segments now go back and down, so
         * the whole leg lies along the belly and the talons finish under the
         * tail — which is where a bird in cruise carries them. */
        femurRest: [0.12, -0.66, -0.74], tibiaRest: [0.02, -0.84, -0.54] },
    ],
    step: 0.20, lift: 0.10, rear: 0.16,
    /* RAKE AT PHASE 1 AND SWEEP AT 2, on the same argument as the blurrg's and
     * with the bird's own anatomy deciding which. A raptor's two weapons are
     * the stoop and the talons, so `pounce` and `rake` are one animal rather
     * than a verb and a filler; `sweep` at phase 2 is the wing buffet, and it
     * is the widest reach in the table at 1.15, which is what a two-and-a-half
     * metre span is FOR. One phase-1 verb was a bird that did the same thing
     * from full health to nearly dead. */
    moves: ['pounce', 'rake', 'sweep'],
  },

};

/**
 * Where each foot plants, how the joint bends, and how high the ankle rides —
 * derived from the plan rather than typed a second time, because
 * `_poseWalker` needs exactly the numbers `creatureSkeleton` built from.
 *
 * `ankle` is the one that was silently wrong for years. `solveIK` puts the
 * TIBIA's tip on the target and the tarsus hangs on past it, so planting the
 * target on the ground buries the whole foot: on a 2.4-scale walker that is
 * 0.72 m of leg below the sand. The ankle rides a fraction of the tarsus
 * above the floor instead — nearly all of it for a leg that comes down on a
 * point or a hoof, a third for a plantigrade sole that lies flat.
 */
const ANKLE_UP = { spike: 0.90, claw: 0.86, hoof: 0.84, paw: 0.30, talon: 0.30, raptor: 0.62 };

/**
 * ── AND A BODY MAY PUBLISH NO LIMBS AT ALL, WHICH IS `tuck` ───────────────
 *
 * `_poseWalker` walks `ST.limbs` and IKs `femur{i}`→`tibia{i}` onto the FLOOR:
 * `foot.y = terrain(x, z) + L.ankle`. That is the right solve for everything
 * else in this table and it is exactly wrong for a body that is never on the
 * floor. Measured on the hawk before this line: at the cruise altitude of
 * 5.6 m the solve asks for a foot five and a half metres below a 34 cm leg,
 * `solveIK` clamps the chain straight, and the animal flies with two rigid
 * spikes hanging out of it pointing at the ground — the same defect
 * `Enemy._poseJetLegs` was written for on the humanoid side, one pose path
 * over.
 *
 * `tuck` says the legs hold their REST POSE and nothing solves them, so the
 * plan's `femurRest`/`tibiaRest` ARE the pose: authored folded, they are a
 * bird's undercarriage carried up under the tail. The bones still exist, still
 * carry their talons, are still priced by `severance` and are still in the
 * blade's contact set — only the IK is gone, and it is gone because there is
 * no ground under this body to solve against.
 *
 * It is the same zero-limb stance the astromech publishes for a completely
 * different reason (it has no walking legs at all), which is why this is a
 * property of the stance and not a special case anywhere in `Enemy`.
 */
function stanceOf(S, P) {
  const limbs = [];
  for (const L of (P.tuck ? [] : P.limbs)) {
    for (const side of [1, -1]) {
      limbs.push({
        arm: L.role === 'arm',
        x: (L.plant ?? L.x) * S * side,
        z: L.z * S,
        ankle: (ANKLE_UP[L.foot] ?? 0.5) * L.tarsus * S,
        pole: [L.pole[0] * S * side, L.pole[1] * S, L.pole[2] * S],
        hand: L.hand ? [L.hand[0] * S * side, L.hand[1] * S, L.hand[2] * S] : null,
        // a plantigrade sole lies along the ground; a hoof or a point drops
        toe: L.foot === 'paw' || L.foot === 'talon' ? 0.75 : 0.30,
      });
    }
  }
  return {
    hipHeight: P.hip * S, step: P.step * S, lift: P.lift * S,
    rear: P.rear * S, bob: 0.05 * S, limbs,
  };
}

/**
 * One creature. `kind` names a row of CREATURE_PLANS.
 *
 * The name survives because src/game/Levels.js calls it for four of the five
 * and that file belongs to another job this session; it is the menagerie
 * builder, and two of the five it builds stand on two legs.
 */
export function buildQuadruped(opts = {}) {
  const kind = opts.kind || 'charger';
  const P = CREATURE_PLANS[kind] || CREATURE_PLANS.charger;
  const S = opts.scale ?? 2.2;
  const rig = new Rig(creatureSkeleton(S, P), { scale: S });
  const hide = hideMat(opts.hide ?? P.hide, 0.92);
  const plate = chitinMat(opts.plate ?? P.plate, 0.52);
  const belly = hideMat(opts.belly ?? P.belly, 0.94);
  const eye = emissiveMat(opts.eye ?? P.eye, 2.8);
  const tooth = boneMat(0xd6cbb0, 0.34);
  /**
   * THE PUPIL, and it is the cheapest character in the file.
   *
   * Every creature's eye is one `emissiveMat` sphere, and an emissive under
   * the cel program solves to a SINGLE FLAT COLOUR — so what the player sees
   * is a coloured disc with no centre and no direction, which is the one
   * feature that decides whether an animal is looking at him. A dark bead
   * standing 15% proud of that disc gives it a pupil, and because it is
   * offset FORWARD along the head's own +Z it also gives it a gaze: the eye
   * reads as aimed the way the muzzle is.
   *
   * One material, so one extra merged mesh on the head bone and nothing
   * anywhere else. `hideMat` and not `emissiveMat`: a pupil that glows is a
   * headlight, which is exactly the mistake the tauntaun's row spends a
   * paragraph refusing for the iris.
   */
  const pupil = hideMat(0x140f0b, 0.30);

  /* ── the trunk ──
   * ONE lathe, laid along the animal's spine and reshaped by a superellipse
   * section, with the shoulder and haunch masses as gaussian swells on the
   * profile. See the header for why this is not three spheres. */
  const body = rig.get('body');
  const L = P.trunk[2] * S, R = P.girth * S;
  const spine = limbGeo(L, R * 0.86, R * 0.72, 14, true, {
    rings: 7, capN: 3, capY0: 0.72, capY1: 0.62, swells: P.swells,
    section: bodySection(P.section),
  });
  // +Y along the spine: rotate.x = π/2 lays it along +Z, and the plan's pitch
  // lifts the front of it — 1.02 rad stands the rancor up.
  const trunkRot = [Math.PI / 2 - P.pitch, 0, 0];
  const trunkParts = [[spine, [0, 0, 0], trunkRot]];

  /**
   * ── WHERE THE ANIMAL'S SURFACE ACTUALLY IS ───────────────────────────
   *
   * Every dorsal and flank feature below used to be placed at a CONSTANT
   * standoff from the spine axis — `0.12 * S` above it for the ridge,
   * `p[1] + 0.32 * S` for the scutes, `R * 0.92` sideways for the ribs — and
   * the trunk is a superellipse lathe with two gaussian swells on it, so the
   * surface is nowhere near constant. Measured on the massiff, whose shoulder
   * swell is +30%: the ribs stand 4 cm proud of the flank at the waist and
   * 3 cm inside it over the shoulder, and the ridge is buried to the gums at
   * both ends of the back and only shows over the middle third. That is the
   * complaint's second line exactly — plates that do not follow the back's
   * curve, reading as cardboard glued on rather than as bone growing out.
   *
   * The file already answers this question for helmets, visors and vents, and
   * the answer is `surfacePoint`: fire a ray from the axis and take the point
   * where it leaves the hull. So this asks the lathe. `t` runs 0→1 along the
   * body and `phi` is the azimuth from straight up — 0 is the spine, ±π/2 the
   * flank, ±π the belly — and `sink` pushes the seat back INTO the hide so a
   * scute is set into the back rather than balanced on it.
   *
   * IT PROBES `spine` IN THE LATHE'S OWN FRAME AND ROTATES THE ANSWER, rather
   * than probing the assembled trunk. The lathe is authored +Y along the body
   * and `trunkRot` is a rotation about X by (π/2 − pitch), which takes lathe
   * −Z to the animal's up — so "up" is a fixed direction in lathe space
   * whatever the plan's pitch is, and one probe serves a level massiff and a
   * reared rancor with no branch. Rotating a point is three multiplies;
   * re-probing an assembled, rotated hull would need the ray rotated instead
   * and would pick up whatever else had been merged into it by then.
   */
  const _hullO = new THREE.Vector3(), _hullD = new THREE.Vector3(), _hullP = new THREE.Vector3();
  const hull = (t, phi, sink = 0) => {
    _hullD.set(Math.sin(phi), 0, -Math.cos(phi));
    _hullO.set(0, clamp(t, 0, 1) * L, 0);
    const p = surfacePoint(spine, _hullD, _hullO, _hullP, true) || _hullO;
    const cs = Math.cos(P.pitch), sn = Math.sin(P.pitch);
    const x = p.x - _hullD.x * sink, y = p.y - _hullD.y * sink, z = p.z - _hullD.z * sink;
    return [x, y * sn - z * cs, y * cs + z * sn];
  };
  /** The outward normal at that seat, in the body bone's frame. */
  const hullN = (phi) => {
    const cs = Math.cos(P.pitch), sn = Math.sin(P.pitch);
    return [Math.sin(phi), Math.cos(phi) * cs, -Math.cos(phi) * sn];
  };
  /* The dorsal structure goes in the PRIMARY for the plated animals and only
   * for them: `Enemy._measurePlatform` measures a rideable deck as the
   * highest vertex inside the middle 60% of the hull, and asserts (in
   * tools/checks/standing.mjs) that it is not above the primary's own box —
   * so on a body that carries a rider the ridge has to be part of the hull it
   * is measured against, not a second mesh standing over it. */
  if (P.back === 'ridge') {
    /* SEATED ON THE BACK, AND THEREFORE ON THE BACK'S CURVE. The old line
     * stood every spine at 0.12·S above the spine AXIS; the massiff's hull is
     * 0.24·S over the loin and 0.31·S over the shoulder swell, so the middle
     * spines showed a third of themselves and the two at each end were
     * entirely inside the animal. The plan row says "a ridge of spines from
     * the crown to the tail root" and the build delivered four bumps over the
     * ribs.
     *
     * `h` is 0.62 of what it was because the seat changed: what the player
     * sees is the part standing OUT of the hide, the old burial was an
     * accident of the swell profile, and 0.62 with a deliberate 0.25·h root
     * inside the skin puts the tallest spine within a few millimetres of the
     * height it used to reach — while the eleven others, which used to be
     * invisible or nearly so, now show. Nothing about the outline's PEAK
     * moves; what arrives is the line between the peaks. */
    const n = 9;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const h = (0.30 - Math.abs(t - 0.55) * 0.26) * S * 0.62;
      trunkParts.push([clawGeo(h, 0.070 * S, 0.011 * S, -0.45, 5, 3),
        hull(0.06 + t * 0.88, 0, h * 0.25), [0.55 - t * 0.9 - P.pitch, 0, 0]]);
    }
  }
  const bm = mesh(assemble(trunkParts, 'trunk'), hide, body.obj);
  body.primary = bm; body.parts.push(bm); body.radius = R;

  /* ── the outline that hangs off the trunk ──
   * One merged mesh, tagged so the LOD keeps it: this is the mane, the
   * scutes, the shag and the tail, and every one of them is what the animal
   * is recognised by at forty metres. */
  const ks = new Kit();
  const fwd = (t) => [0, Math.sin(P.pitch) * t * L + 0.10 * S, Math.cos(P.pitch) * t * L];
  if (P.back === 'scutes') {
    /* LOW BONY BOSSES DOWN THE SPINE, biggest over the shoulder — and they
     * are BOSSES now rather than slabs. `plateGeo` is a rounded cuboid, so
     * six of them laid at a fixed 0.32·S above the axis with a fixed pitch
     * rotation are six cards standing on a curved back: each one meets the
     * hide along one edge and lifts clear of it along the other, and the gap
     * is the thing the eye reads. A scute is a swelling of the same skin, so
     * this is a squashed ellipsoid, seated by `hull` and aimed down the
     * surface's own normal, sunk 40% of its own depth into the hide. The
     * width curve is the old one halved, because these are half-widths.
     *
     * They stay OUT of the primary, which is deliberate and is the one thing
     * that separates this treatment from `ridge` above: `_measurePlatform`
     * takes a rideable deck off the primary hull, and the varactyl is ridden.
     * A saddle that sat on top of the scutes would be a saddle 10 cm above
     * the animal. */
    ks.row(7, (i, t) => {
      const w = (0.26 - Math.abs(t - 0.72) * 0.17) * S;
      const at = 0.04 + t * 0.88;
      ks.aim(plate, new THREE.SphereGeometry(1, 9, 7), hull(at, 0, 0.038 * S), hullN(0),
        [w, 0.095 * S, 0.115 * S]);
    });
  } else if (P.back === 'mane') {
    /* THE MANE, and it is the nexu's whole read at range. Quills raked back
     * off the shoulders in three rows: a low animal with a smooth back is a
     * dog, a low animal with a crest is a predator. */
    ks.row(4, (i, t) => ks.pair((sx) => {
      const p = fwd(0.62 + t * 0.30);
      ks.add(plate, tubeGeo([[0, 0, 0, 0.040 * S], [sx * 0.10 * S, 0.30 * S, -0.16 * S, 0.028 * S],
        [sx * 0.20 * S, 0.52 * S, -0.44 * S, 0.006 * S]], 5, { capRoot: false }),
      [sx * (0.05 + t * 0.10) * S, p[1] + 0.22 * S, p[2]]);
    }));
  } else if (P.back === 'shag') {
    /* THE COAT. A wampa's outline is not skin, it is fur breaking the
     * edge — so the shag is authored as tapered clumps standing off the
     * flanks and the shoulders rather than as a texture, which is the one
     * thing that survives being a silhouette. */
    /* SIX SIDES AND THREE RINGS, and it is the massiff's fang argument applied
     * to the thing that argument was never carried to. That note reads: "at
     * rings 2 it is two prisms end to end — the rendered massiff has a
     * mouthful of flat white wedges. Three rings on the same bend is a curve;
     * six sides round the shaft is the difference between a tooth and a
     * shard." A shag clump is the same geometry at four times the size and it
     * was still at (5, 2), so every clump was a flat card: rendered on the
     * tauntaun they read as loose white quads standing off the shoulders,
     * which is the "janky garbage" complaint in one shape. The count of clumps
     * and every position is untouched — this is the same coat, curved. It
     * costs 14 triangles a clump on fourteen clumps, which `frame-budget`
     * measures and passes. */
    ks.row(4, (i, t) => ks.pair((sx) => {
      const p = fwd(0.10 + t * 0.80);
      ks.add(hide, clawGeo((0.30 + t * 0.12) * S, 0.11 * S, 0.02 * S, 0.5, 6, 3),
        [sx * (0.30 + t * 0.10) * S, p[1] + 0.10 * S, p[2] - 0.06 * S], [1.9, 0, sx * (0.9 - t * 0.4)]);
    }));
    ks.row(3, (i, t) => ks.pair((sx) => {
      const p = fwd(0.74 + t * 0.20);
      ks.add(hide, clawGeo(0.34 * S, 0.12 * S, 0.02 * S, 0.4, 6, 3),
        [sx * 0.34 * S, p[1] + 0.24 * S, p[2]], [2.3, 0, sx * 1.25]);
    }));
  } else if (P.back === 'plumage') {
    /**
     * FEATHER, AND IT IS A DORSAL TREATMENT BECAUSE THAT IS WHERE A BIRD'S
     * OUTLINE IS.
     *
     * `shag` above is the closest shipped thing and it is the wrong shape for
     * this: a wampa's coat is CLUMPS standing off the flanks — deliberately
     * ragged, because fur breaking the edge is what it is for — and plumage is
     * the opposite. Feathers lie DOWN and OVERLAP, and the read is a smooth
     * back with a scalloped trailing edge, so these are broad flat vanes laid
     * along the hull with `hull()` and `hullN()`, seated the way the scutes are
     * seated and for the scutes' stated reason: a feather that stood at a
     * constant standoff from the spine axis would be buried over the shoulder
     * swell and floating over the loin.
     *
     * THE TAIL FAN IS HERE AND NOT IN `P.tail`, and that is the one thing worth
     * arguing about. `P.tail` builds ONE SWEPT TUBE — a rope of flesh, which is
     * what a massiff, a nexu and a varactyl have. A bird's tail is not a tube
     * at all: it is a fan of rectrices with no core in it, and it is the second
     * biggest shape on the animal from below. So the plan carries `tail: [0,…]`
     * (no tube) and the fan is built here, out of the same vanes, spread over
     * 1.5 rad about the tail root. Eleven feathers, one merged mesh, tagged
     * silhouette with the rest.
     */
    /**
     * ONE `aim` PER FEATHER, AND THE REFERENCE AXIS IS WHAT MAKES IT LIE FLAT.
     *
     * `Kit.aim` puts a part's local +Y along `dir` and takes its ROLL from
     * `ref` (see `aimY`: x = ref × dir, z = x × dir). A vane authored as
     * width-on-X, length-on-Y, thickness-on-Z therefore comes out lying along
     * `dir` with its flat face square to `ref` — so passing the hull's own
     * normal as the reference is what seats a feather ON the back rather than
     * standing it on edge, and it costs nothing that `aim` was not already
     * doing. The two-argument mistake here is easy and silent: `aim` with the
     * normal as the DIRECTION plants every feather sticking straight out of
     * the animal like a quill, which is the mane's treatment and not this one.
     */
    const vane = (w, len, thin) => { const g = new THREE.SphereGeometry(1, 7, 5); g.scale(w, len, thin); return g; };
    /* AND THE REFERENCE HAS TO BE A `Vector3`, WHICH THE DIRECTION DOES NOT.
     * `Kit.aim` converts a plain `[x,y,z]` DIRECTION for you and says so in its
     * own note — and then hands `ref` straight to `aimY`, which does
     * `Vector3.copy(ref)`. Copying an array yields NaN silently, the NaN goes
     * into the merged geometry, and the whole body's bounding sphere comes back
     * NaN — which is how this was found: every mesh on the trunk bone, 3888
     * NaN floats of 4656, on a build that threw nothing. */
    const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    // straight back down the spine, whatever the plan's pitch is
    const aft = [0, -Math.sin(P.pitch), -Math.cos(P.pitch)];
    const behind = (p, len) => [p[0] + aft[0] * len * 0.5, p[1] + aft[1] * len * 0.5, p[2] + aft[2] * len * 0.5];
    // the mantle: coverts down the back, longest over the shoulder
    ks.row(5, (i, t) => ks.pair((sx) => {
      const phi = sx * (0.30 + t * 0.34);
      const len = (0.30 - t * 0.10) * S;
      ks.aim(plate, vane(0.085 * S, len, 0.009 * S),
        behind(hull(0.14 + t * 0.74, phi, 0.020 * S), len), aft, null, V(hullN(phi)));
    }));
    // …and the scapulars, higher and shorter, closing the line into the wing root
    ks.row(3, (i, t) => ks.pair((sx) => {
      const phi = sx * (0.10 + t * 0.14);
      const len = 0.20 * S;
      ks.aim(plate, vane(0.070 * S, len, 0.009 * S),
        behind(hull(0.46 + t * 0.30, phi, 0.024 * S), len), aft, null, V(hullN(phi)));
    }));
    /* THE BREAST AND THE FLANK, in `belly` — the pale half of the
     * countershading, and the only place in this treatment where that colour
     * is used at all. Without it the animal is one brown value from the keel
     * to the shoulder and the whole lower half of the side view is a smooth
     * sausage; with it the body has a waterline. Seated at 1.9-2.4 rad from
     * the spine, which is the flank turning under into the keel. */
    ks.row(5, (i, t) => ks.pair((sx) => {
      const phi = sx * (1.90 + t * 0.46);
      const len = (0.13 - t * 0.03) * S;
      ks.aim(belly, vane(0.048 * S, len, 0.008 * S),
        behind(hull(0.14 + t * 0.66, phi, 0.022 * S), len), aft, null, V(hullN(phi)));
    }));
    /**
     * THE FAN, and the reference here is UP rather than a surface normal:
     * eleven rectrices spread about the tail root in ONE horizontal plane, so
     * every one of them wants its flat face square to the animal's own up.
     * `0.30 − |u|·0.10` is the wedge — longest down the middle, shortest at the
     * edges — which is a hawk's tail and not a duck's square one, and 0.75 rad
     * of half-spread is a tail carried closed the way a bird in level cruise
     * carries it. It is the second largest shape on this animal from below,
     * which is the angle a player standing under it is looking from.
     */
    const root = fwd(-0.04);
    const up = [0, Math.cos(P.pitch), -Math.sin(P.pitch)];
    ks.row(11, (i, t) => {
      const th = (t * 2 - 1) * 0.75;
      const len = (0.30 - Math.abs(t * 2 - 1) * 0.10) * S;
      const dir = [Math.sin(th), Math.cos(th) * aft[1], Math.cos(th) * aft[2]];
      /* BARRED, which is one `%` and is the difference between a tail and a
       * doily. All eleven in `plate` came back as a solid white fan under the
       * level's own light — the brightest thing on the animal and the first
       * thing the eye went to, on the piece that is meant to be read as SHAPE.
       * Alternating them against the hide is what every reference raptor's
       * tail does and it costs nothing: the Kit merges per material, so it is
       * the same two meshes either way. */
      ks.aim(i % 2 ? hide : plate, vane(0.042 * S, len, 0.008 * S),
        [root[0] + dir[0] * len * 0.5, root[1] + dir[1] * len * 0.5, root[2] + dir[2] * len * 0.5],
        dir, null, V(up));
    });
  }
  /* THE TAIL, on the body bone because the skeleton has no tail chain, swept
   * as ONE tube rather than as a chain of capped limbs — six capped segments
   * bury five pairs of end caps inside themselves, which is 60% of the
   * triangles on geometry nobody can see (see tubeGeo). */
  if (P.tail[0] > 0) {
    /**
     * ── AND IT IS RESAMPLED, FOR THE NECK'S REASON AND NOT A NEW ONE ────
     *
     * `tubeGeo` interpolates nothing: it puts one ring at each node and joins
     * them with flat quads. `P.tail[0]` is a count of SEGMENTS — 3 on the
     * massiff, 4 on the varactyl — so a three-segment tail was four rings on
     * a polyline that turns 0.10 rad at each of them, which is a chain of
     * short prisms with a visible crease at every joint. The complaint calls
     * it "a chain of visibly hard cubes" and at seven radial segments and
     * four rings that is very nearly literally what it was.
     *
     * Same fix the neck already carries thirty lines down: at least three
     * rings a segment, walked along the SAME arc — the total turn is still
     * `curl * n` and the total length still `reach * S`, both spread over the
     * finer step — so a plan's tail arrives where its author put it. The
     * radius law is the old one written continuously: at u = i/n it is
     * identically `r0 * S * (1 - i / (n + 1.2))`, so no tail changes girth.
     *
     * The ring goes to 9 from 7 because a tail is a cylinder seen against the
     * sky from the side, where a 7-gon shows its facets on the top edge, and
     * because tubeGeo carries no duplicated seam column — two more columns is
     * two more vertices a ring and nothing else.
     */
    const [n, reach, r0, pitch0, curl] = P.tail;
    const RT = Math.max(5, n * 3 + 1);
    const nodes = [];
    let y = 0.06 * S, z = -0.06 * S, a = pitch0;
    const step = (reach * S) / (RT - 1);
    for (let i = 0; i < RT; i++) {
      const u = i / (RT - 1);
      nodes.push([0, y, z, r0 * S * (1 - (u * n) / (n + 1.2))]);
      z -= Math.cos(a) * step; y += Math.sin(a) * step; a += (curl * n) / (RT - 1);
    }
    ks.add(hide, tubeGeo(nodes, 9), [0, 0, 0]);
  }
  /**
   * ── RIBBED FLANKS, AND THEY ARE RIBS NOW ───────────────────────────────
   *
   * This was four `plateGeo` slabs a side at a FIXED `x = ±R * 0.92`, and it
   * is the worst-looking thing on the animal — the rendered massiff shows
   * four pale rectangles floating clear of its shoulder like luggage labels.
   * Two faults compound:
   *
   *   R IS THE PLAN'S GIRTH AND NOT THE ANIMAL'S WIDTH. The lathe is
   *   superellipse-sectioned and carries two gaussian swells; on the massiff
   *   the hull runs 0.72·R at the loin to 1.30·R over the shoulder. One x for
   *   all four puts the front pair well outside the skin and the back pair
   *   well inside it, and a rib you can see daylight under is a sticker.
   *
   *   A RIB IS NOT FLAT AND IT IS NOT VERTICAL. It leaves the spine, wraps
   *   the barrel and turns under toward the sternum, and it tapers the whole
   *   way. A 0.34·S tall slab hung on the widest point of the flank is a
   *   cross-section of that, drawn as a card.
   *
   * So each one is a tapered tube through five points ON the hull, from just
   * beside the spine (φ 0.55) to under the flank (φ 2.10), sunk far enough
   * that only the crown of it stands out of the hide. It costs about 60
   * triangles a rib against the slab's 12, which on a body that runs 4–6k
   * against a 13k cap is the cheapest legibility in the file.
   */
  ks.pair((sx) => ks.row(4, (i, t) => {
    const at = 0.18 + t * 0.54;
    const nodes = [];
    for (let j = 0; j < 6; j++) {
      const u = j / 5;
      const phi = 0.80 + u * 1.30;
      /* A BELL AND NOT A TAPER, and sunk almost to its own crown. A rib
       * disappears under the spinal muscle at the top and under the sternum
       * at the bottom, so a tube that is fattest in the middle and fines away
       * at both ends leaves a raised band on the flank rather than a claw
       * hanging off it — which is what the first pass of this looked like
       * rendered: eight pale hooks down the animal's sides. `sink` at 0.048·S
       * against a 0.040·S peak radius means only the top fifth of the tube
       * ever leaves the hide. */
      const r = (0.014 + 0.026 * Math.sin(Math.PI * u)) * S;
      const p = hull(at, sx * phi, 0.048 * S);
      nodes.push([p[0], p[1], p[2], r]);
    }
    ks.add(plate, tubeGeo(nodes, 6, { tip: 0.1 }), [0, 0, 0]);
  }));
  {
    const p = fwd(0.44);
    const bLen = L * 0.70, bR0 = R * 0.52, bR1 = R * 0.42;
    const at = [0, p[1] - R * 0.60, p[2] - L * 0.32];
    ks.add(belly, limbGeo(bLen, bR0, bR1, 10, true, { rings: 3, capN: 2 }), at, trunkRot);
    /**
     * …AND THE LINE ABOVE HAS SAID SO SINCE IT WAS WRITTEN: "the one place a
     * blade meets flesh". It was a colour and nothing else.
     *
     * The trunk is the only bone on any of these five animals that is not
     * `flesh` — `Enemy._boneToughness` gives `body` on a beast `TOUGHNESS.heavy`
     * — so the back, the flanks and the shoulder hump are the one hard thing on
     * the creature and the belly hanging under them was charged at exactly the
     * same rate. This makes the soft underside soft, out of the four numbers on
     * the line above and nothing else: if the belly moves, its capsule moves
     * with it, because there is only one copy of where it is.
     *
     * `trunkRot` is [π/2 − pitch, 0, 0] and a rotation about X takes +Y to
     * (0, cos, sin), so the belly's own axis in the bone's frame is
     * (0, sin(pitch), cos(pitch)) — the animal's spine direction, which is what
     * the mesh is laid along.
     *
     * It is on a CORE bone, deliberately and consequentially: `Enemy.capsules`
     * lets a weak point through the hide guard only on a LIMB (see the note
     * there on `AXIAL_ROLES`), so the belly buys speed and not a shortcut to
     * the kill. Two tonnes of animal is still what the blade has to get
     * through; there is just less of it in the way at the start.
     */
    const ax = [0, Math.sin(P.pitch), Math.cos(P.pitch)];
    weakSpot(body, {
      key: 'belly', label: 'BELLY',
      p0: at, p1: [at[0] + ax[0] * bLen, at[1] + ax[1] * bLen, at[2] + ax[2] * bLen],
      r: (bR0 + bR1) / 2,
      at0: clamp(at[1] / (body.length || 1), 0, 1),
      at1: clamp((at[1] + ax[1] * bLen) / (body.length || 1), 0, 1),
    });
  }
  markSilhouette(ks.bake(body.obj));

  /* ── the head ── */
  const head = rig.get('head');
  /* THE SHOULDER THE NECK COMES OUT OF, MEASURED. `headAt[1]` is the head
   * bone's offset down the spine in plan units and `trunk[2]` is the spine's
   * length in the same units, so their ratio is where along the lathe the
   * neck leaves — and `hull` at a right angle to the spine there is the
   * animal's own half-width at that station, swells and superellipse and all.
   * See the neck's own note for what it is used for and what typing a number
   * here instead cost. */
  buildCreatureHead(rig, P, S, { hide, plate, belly, eye, tooth, pupil,
    trunkR: Math.abs(hull(P.headAt[1] / P.trunk[2], Math.PI / 2)[0]) });

  /* ── the limbs ── */
  for (let i = 0; i < P.limbs.length * 2; i++) {
    const L2 = P.limbs[Math.floor(i / 2)];
    const g = L2.girth;
    const arm = L2.role === 'arm';
    for (const [name, r0, r1, mat, bulge] of [
      [`hipL${i}`, 0.15, 0.13, plate, 0.06], [`femur${i}`, 0.15, 0.096, hide, 0.20],
      [`tibia${i}`, 0.10, 0.055, hide, 0.14], [`tarsus${i}`, 0.058, 0.026, plate, 0.05]]) {
      const b = rig.get(name);
      if (!b) continue;
      const rr0 = r0 * S * g, rr1 = r1 * S * g;
      const m = mesh(limbGeo(b.length, rr0, rr1, 8, true, { rings: 4, bulge, bulgeAt: 0.26, capN: 3 }), mat, b.obj);
      m.userData.limb = { r0: rr0, r1: rr1, seg: 8 };
      b.parts.push(m); b.primary = m; b.radius = rr0;
    }
    /**
     * ── THE SHOULDER, AND THE HAUNCH ─────────────────────────────────────
     *
     * `hipL{i}` is a 0.10·S socket tube and that was the entire junction: a
     * 5 cm pipe of chitin poking out of a lathe. Close up the leg meets the
     * trunk along a hard circular seam with nothing spanning it — the
     * complaint's fifth line — and the reason is that a real one is spanned
     * by MUSCLE that belongs to neither piece. A deltoid and a gluteal wrap
     * the joint from the body side and taper onto the limb.
     *
     * So: one hide-coloured ellipsoid on the socket bone, centred on the
     * joint and elongated along the limb's own axis. The socket bone's +Y IS
     * the limb direction — `creatureSkeleton` gives it `rest: [side, …]`, so
     * it leaves the body sideways — and the bone's origin sits within a
     * centimetre or two of the flank on every plan in the table, so a mass
     * centred there is half inside the trunk and half standing out of it,
     * which is what a deltoid is. No plan-specific offset and no sign to get
     * wrong: the skeleton has already put the frame where it belongs. It
     * rides `hipL` rather
     * than `femur`, which is what makes it a shoulder rather than a pauldron:
     * `_poseWalker` swings the femur and leaves the socket where the body
     * put it, so the mass stays welded to the flank while the leg moves under
     * it. On the femur it would swing out of the animal at the top of a
     * stride.
     *
     * It is NOT tagged `silhouette`. Past thirty metres `_collectLodParts`
     * keeps one mesh a bone, and at thirty metres a 12 cm shoulder is inside
     * the trunk's own outline — this is a piece that only exists to close a
     * seam nobody can see from there. Tagging it would buy a draw call per
     * body for nothing, against the horns and crests that earn theirs.
     *
     * Sized off `girth`, which is the plan's own word for how heavy this limb
     * is, so an acklay's spider leg gets a small one and a rancor's arm a
     * large one out of a number that was already written down.
     */
    const socket = rig.get(`hipL${i}`);
    if (socket) {
      const k = new Kit();
      const w = (arm ? 0.19 : 0.22) * S * g;
      k.add(hide, new THREE.SphereGeometry(1, 9, 6), [0, socket.length * 0.10, 0], null,
        [w, (arm ? 0.24 : 0.28) * S * g, w * 1.06]);
      k.bake(socket.obj);
    }
    const femur = rig.get(`femur${i}`);
    if (femur) {
      const k = new Kit(); const len = femur.length;
      k.add(plate, limbPlate(femur, len * 0.10, len * 0.66, arm ? 2.0 : 2.5,
        { thick: 0.024 * S * g, seg: 6, gap: 0.008 * S }), [0, len * 0.10, 0]);
      k.bake(femur.obj);
    }
    const tarsus = rig.get(`tarsus${i}`);
    if (tarsus) {
      const k = new Kit(); const len = tarsus.length;
      buildFootFor(k, L2.foot, plate, tooth, hide, S, g, len);
      markSilhouette(k.bake(tarsus.obj));
    }
  }
  /**
   * ══ THE WINGS ══════════════════════════════════════════════════════════
   *
   * `creatureSkeleton` has built `wing{L,R}` and `wingTip{L,R}` off the plan's
   * `wings` block and argued there for why they are not in `limbs[]`. This is
   * the other half: something has to hang geometry on them, and NOTHING in the
   * creature builder did — the limb loop above walks `P.limbs`, so a winged
   * plan built four bones with no meshes on them. That is not a cosmetic gap.
   * `Enemy.capsules` skips a bone with `!b.parts.length`, so an undressed wing
   * is a wing the blade passes straight through, and `Flight.wingLift` — which
   * is what makes one-wing consequence real — would then be measuring a chain
   * nothing can ever cut.
   *
   * ── WHICH LOCAL AXIS IS "BACKWARD", AND IT IS NOT A GUESS ───────────────
   *
   * `Rig` builds every rest quaternion with `aimY(restDir, BACK)`. Measured on
   * the hawk's own rest pair, that puts local +Z within 25° of the animal's
   * forward on BOTH sides and local X along the (down on the left, up on the
   * right) axis — and both frames come out right-handed, so the two are exact
   * world MIRRORS of each other. Which means NOTHING here carries a per-side
   * sign: the same local rotation on both bones is already symmetric in the
   * world, and the `side * rake` the first build used raked the right wing's
   * feathers forward and inboard while the left's went back and out. One wing
   * a comb and one a wing.
   *
   * Authoring the chord on local X instead of Z is the other mistake and it is
   * the expensive one: it builds a wing standing on edge, and it does it
   * symmetrically, so it looks deliberate.
   *
   * ── FEATHERS AND NOT A MEMBRANE ─────────────────────────────────────────
   *
   * `buildGeonosian` puts one flattened ellipsoid on each wing bone and it is
   * right for an insect: a membrane under tension is one surface. A bird's
   * wing is a row of separate quills with air between them and a SCALLOPED
   * trailing edge, and that edge is the entire difference between the two
   * silhouettes at forty metres — which is the range the whole menagerie note
   * above is about. Eleven vanes a side, merged by material into two meshes a
   * bone by the Kit, so the cost is the same two draw calls the membrane pays.
   *
   * The coverts are `plate` and the flight feathers `hide`, which is the same
   * two-tone the `plumage` back treatment uses: a pale shoulder over a dark
   * wing is what a raptor seen from above actually is, and it is the only
   * thing that stops a wing reading as one flat card.
   */
  if (P.wings) {
    const W = P.wings;
    const vane = (thin, w, len) => { const g = new THREE.SphereGeometry(1, 7, 5); g.scale(thin, w, len); return g; };
    for (const side of [1, -1]) {
      const LR = side > 0 ? 'L' : 'R';
      for (const [name, n, c0, c1, rake0, rake1, cov] of [
        // the arm: secondaries, short and square, under a sheet of coverts
        [`wing${LR}`, 6, 0.62, 0.86, 0.10, 0.34, true],
        // the hand: primaries, long and raked hard back, tapering to the tip
        [`wingTip${LR}`, 7, 1.00, 0.58, 0.42, 0.95, false],
      ]) {
        const b = rig.get(name);
        if (!b) continue;
        const k = new Kit();
        const A = b.length;
        /* THE SPAR. A wing's leading edge is bone and it is the line the eye
         * follows; without it the feathers are a row of leaves with nothing
         * holding them. Tapered, and slightly forward of the bone axis (+Z) so
         * the quills root BEHIND it rather than through it. */
        k.add(hide, limbGeo(A, 0.028 * S, 0.016 * S, 7, true,
          { rings: 3, capN: 2, bulge: 0.10, bulgeAt: 0.12 }), [0, 0, 0.010 * S]);
        /**
         * ── THE VANES OVERLAP, WHICH IS THE WHOLE DIFFERENCE BETWEEN A WING
         *    AND A COMB ────────────────────────────────────────────────
         *
         * The first build spaced `n` feathers over 0.86 of the spar at a
         * half-width of 0.055 — 7.6 cm apart on an 11 cm feather — and because
         * a vane is an ELLIPSOID it is only that wide at its own middle. So
         * every gap was open at the root and open at the tip, and rendered
         * from three-quarters above the wing was a bar with teeth on it. A
         * feather is 0.085 of half-width here, which is more than the spacing
         * everywhere along the span, so each vane's neighbours close it.
         */
        k.row(n, (i, t) => {
          const len = W.chord * S * (c0 + (c1 - c0) * t);
          const rake = rake0 + (rake1 - rake0) * t;
          /* Rooted on the spar, swept back, and each one twisted a little
           * further nose-down than the last — the wash-out every wing has, and
           * what stops a fan of identical feathers reading as a rake. */
          k.add(hide, vane(0.006 * S, 0.085 * S, len * 0.5),
            [0, (0.10 + t * 0.86) * A + Math.sin(rake) * len * 0.5, -Math.cos(rake) * len * 0.5],
            [rake, 0, 0.10 + t * 0.18]);
        });
        /**
         * ── AND THE INNER HALF OF THE WING IS ONE SURFACE ────────────────
         *
         * The coverts were five small vanes and they were the wrong answer to
         * the same defect: what covers the base of a bird's flight feathers is
         * a CONTINUOUS sheet, and the scallop only starts where that sheet
         * ends. So this is one panel down the whole span — the greater coverts
         * — with a shorter one in front of it, and between them they close the
         * leading two thirds of the wing. Two merged shapes rather than nine,
         * and the trailing edge is the only part that is a row of anything.
         *
         * `plate` on `hide`: a pale shoulder over a dark wing is what a raptor
         * seen from above is, and it is also the only thing that stops the
         * whole wing reading as one flat card.
         */
        if (cov) {
          k.add(plate, vane(0.008 * S, A * 0.50, W.chord * S * 0.34),
            [0, A * 0.50, -W.chord * S * 0.22], [0.12, 0, 0]);
          k.add(plate, vane(0.010 * S, A * 0.46, W.chord * S * 0.20),
            [0, A * 0.46, -W.chord * S * 0.05], [0.06, 0, 0]);
        } else {
          /* On the hand the same idea at a third of the chord: the primaries
           * are long and mostly free, but their roots still have to be part of
           * a surface or the wing tip is a bundle of sticks. */
          k.add(plate, vane(0.008 * S, A * 0.48, W.chord * S * 0.16),
            [0, A * 0.46, -W.chord * S * 0.09], [0.22, 0, 0]);
        }
        const made = k.bake(b.obj);
        for (const m of made) { b.parts.push(m); markSilhouette(m); }
        /* `primary`, `parts` and `radius` set the way `addLimb` sets them, for
         * the reason `buildGeonosian` states and does not need repeating: a
         * wing with meshes and no radius is a wing the blade passes through. */
        b.primary = made[0] || null;
        /* 0.42 OF THE CHORD, and the number is `severance.mjs`'s to set rather
         * than mine: it walks the drawn surface of every rigged body and fails
         * one with more than 22% of it outside its own capsules, or any point
         * more than 20 cm out. A wing is a wide flat thing hung off a thin
         * spar, so the capsule around that spar has to be a good fraction of
         * the chord or most of the wing is air the blade passes through. */
        b.radius = Math.max(b.radius, W.chord * S * 0.42);
      }
    }
  }

  return {
    rig, kind, plan: P, stance: stanceOf(S, P), moves: P.moves || null,
    palette: { hide, chitin: plate, belly, eye }, scale: S,
    /** Which bones hold this body up in the air — read by src/game/Flight.js. */
    wings: P.wings ? ['wingL', 'wingTipL', 'wingR', 'wingTipR'] : undefined,
  };
}

/** The acklay keeps its own entry point — its archetype is declared in Enemy.js. */
export function buildBeast(opts = {}) {
  return buildQuadruped({ scale: 2.9, ...opts, kind: 'acklay' });
}

/**
 * Tag a bone's merged extras as SILHOUETTE, which is what makes any of this
 * visible at the range the complaint was about.
 *
 * `Enemy._collectLodParts` keeps one mesh per bone — the primary — and hides
 * everything else past thirty metres, which is correct for rivets and panel
 * lines and catastrophic for horns. A creature's outline pieces are merged
 * per material by the Kit anyway, so keeping them costs at most two extra
 * draw calls on a body there are never more than a handful of.
 */
function markSilhouette(meshes) {
  if (meshes && meshes.isMesh) { meshes.userData.silhouette = true; return meshes; }
  for (const m of meshes) m.userData.silhouette = true;
  return meshes;
}

/**
 * What the end of a limb is: a hoof, a paw, a claw, a talon, or a point.
 *
 * Sized off the CREATURE's scale and only widened by the limb's girth. The
 * first pass passed `S * girth` for everything, which on the rancor's 1.30
 * legs made a sole 2.3 m deep and put 2.27 m of foot below the floor — a
 * girth multiplier is a radius, and applying it to lengths grows the foot in
 * the two directions it must not grow in.
 */
/**
 * ── AND EVERY ONE OF THEM NEEDED A FOOT UNDER IT ───────────────────────
 *
 * Rendered close, the massiff stands on three pale cubes. That is what the
 * `claw` branch was: three `clawGeo` toes at `rings: 3` — three straight
 * prisms with a 0.35-rad kink in each — hung directly off the end of the
 * tarsus tube with nothing behind them. There is no foot; there are toes
 * bolted to a shin.
 *
 * Two things fix it and neither is expensive:
 *
 *   A PAD. Every one of these animals plants on a mass of horn and fat, and
 *   it is the piece that says "this is where the weight goes". A squashed
 *   ellipsoid at the end of the tarsus, wide across and long fore-and-aft, is
 *   both the metatarsus and the pad, and it is what the toes now grow out of
 *   rather than being the whole of the foot.
 *
 *   RINGS. `clawGeo` merges one capped `limbGeo` per ring, so `rings: 3` on a
 *   claw with 1.05 rad of bend turns 20° at a time and reads as a stack of
 *   blocks. Five rings on the same curve is the same silhouette with the
 *   corners off, for two more merged segments on a piece 3 cm long.
 *
 * The toes also splay and rise: `t` drives yaw as it did, and now also a
 * small outward lift, so the three are three toes rather than one toe drawn
 * three times.
 *
 * SIZED OFF THE CREATURE'S SCALE AND ONLY WIDENED BY THE LIMB'S GIRTH — the
 * rule the header below already states, and the pad obeys it: `g` multiplies
 * the pad's width and never its length or its height, for exactly the reason
 * a 2.27 m foot was once below the floor.
 */
function buildFootFor(k, kind, plate, tooth, hide, S, g, len) {
  if (kind === 'spike') return;              // an acklay's leg ends in the leg
  /** The pad: a flattened ellipsoid, `x`/`z` from the ankle, in plan units. */
  const pad = (mat, w, h, d, x, z, y = 0.92) => k.add(mat, new THREE.SphereGeometry(1, 8, 6),
    [x * S * g, len * y, z * S], null, [w * S * g, h * S, d * S]);
  if (kind === 'hoof') {
    /* A HOOF IS A CONE OF HORN, not a cylinder with a lid. The lathe tapers
     * to the ground and `capY1: 0.18` keeps the sole nearly flat, so the
     * animal stands on a plane instead of on the equator of a drum. */
    k.add(plate, limbGeo(0.15 * S, 0.135 * S * g, 0.105 * S * g, 9, true,
      { rings: 3, capN: 3, capY0: 0.10, capY1: 0.18, bulge: 0.10, section: ovalSection(0.82, 2.6) }),
    [0, len * 0.86, 0.03 * S], [Math.PI, 0, 0]);
    k.add(plate, limbGeo(0.05 * S, 0.14 * S * g, 0.125 * S * g, 9, true,
      { rings: 2, capN: 2, capY0: 0, capY1: 0.10, section: ovalSection(0.80, 2.8) }),
    [0, len * 1.00, 0.03 * S], [Math.PI, 0, 0]);
    return;
  }
  if (kind === 'paw') {
    /* PLANTIGRADE: one deep sole lying along the ground with three toe pads
     * off the front of it and a claw out of each. The old sole was a
     * `plateGeo` 0.34·S deep — a slab the animal stood on the corner of. */
    pad(hide, 0.13, 0.050, 0.19, 0, 0.07);
    k.row(3, (j, t) => {
      pad(hide, 0.050, 0.040, 0.058, (t - 0.5) * 0.19, 0.22, 0.91);
      k.add(tooth, clawGeo(0.13 * S, 0.026 * S, 0.005 * S, 0.7, 5, 3),
        [(t - 0.5) * 0.19 * S * g, len * 0.90, 0.27 * S], [1.15, (t - 0.5) * 0.55, 0]);
    });
    return;
  }
  if (kind === 'raptor') {
    /**
     * A BIRD OF PREY'S FOOT, AND IT IS NOT THE `claw` PAD WITH LONGER TOES.
     *
     * The two differ in the one thing that reads: a dog's foot is a PAD with
     * toes on the front of it and stands on the pad; a hawk's is four long
     * scaled digits and a hook on each, and it stands on nothing — the toes
     * are the whole foot. So there is no `pad()` call here at all, which is
     * the first branch in this function that has none.
     *
     * THREE FORWARD AND ONE BACK, which is the anisodactyl arrangement every
     * reference photograph of a hawk's foot shows and is the only part of it
     * that survives at range: the hallux swings under and back, and it is what
     * makes a foot with something in it read as a fist rather than as a stick.
     *
     * CURLED HARD (`bend` 1.5 against the claw foot's 1.05) because this body
     * never lands — see `tuck` over `stanceOf`. A talon carried in the air is
     * a talon closed, and a straight one would read as a landing gear that
     * failed to retract. The tarsometatarsus is the short scaled shank above
     * them, and it is `plate` (the pale horn colour) rather than `hide`,
     * because a raptor's legs are bare scale where the rest of it is feather.
     */
    k.add(plate, limbGeo(len * 0.30, 0.036 * S * g, 0.030 * S * g, 7, true,
      { rings: 2, capN: 2, capY0: 0.20, capY1: 0.20 }), [0, len * 0.62, 0]);
    k.row(3, (j, t) => k.add(plate, clawGeo(0.19 * S, 0.020 * S * g, 0.005 * S, 1.5, 6, 5),
      [(t - 0.5) * 0.075 * S * g, len * 0.90, 0.020 * S], [0.30, (t - 0.5) * 1.0, 0]));
    // the hallux: shorter, heavier, and pointing the other way
    k.add(plate, clawGeo(0.15 * S, 0.022 * S * g, 0.005 * S, 1.6, 6, 5),
      [0, len * 0.90, -0.020 * S], [-0.45, 0, 0]);
    return;
  }
  if (kind === 'talon') {
    // four long fingers with hooks — the rancor's hand, which reaches its knee
    pad(hide, 0.115, 0.075, 0.085, 0, 0.01);
    k.row(4, (j, t) => k.add(plate, clawGeo(0.30 * S, 0.036 * S, 0.008 * S, 1.35, 5, 5),
      [(t - 0.5) * 0.18 * S, len * 0.86, 0.02 * S], [0.25, (t - 0.5) * 0.8, 0]));
    return;
  }
  /* THE CLAW FOOT — a digitigrade pad with three hooked toes off the front of
   * it: the massiff, the nexu, the tooka, the tuk'ata, the blurrg and the
   * varactyl. HIDE-COLOURED PAD, PALE TOES. Everything here used to be
   * `plate`, and `plate` on these plans is the light bone colour — which is
   * how a dark-legged animal came to be standing on three bright cubes. The
   * horn is the part that ought to be horn. */
  pad(hide, 0.105, 0.060, 0.115, 0, 0.035);
  k.row(3, (j, t) => k.add(plate, clawGeo(0.26 * S, 0.030 * S, 0.007 * S, 1.05, 6, 4),
    [(t - 0.5) * 0.13 * S * g, len * 0.90, 0.055 * S], [0.15 - Math.abs(t - 0.5) * 0.3, (t - 0.5) * 0.9, 0]));
}

/**
 * THE HEADS, and they are the second half of the forty-metre read.
 *
 * Each is a neck swept forward out of the head BONE (walkerSkeleton hangs
 * that bone behind the body, so a skull placed at its origin is inside the
 * ribcage and invisible from every angle — the original note is worth
 * keeping) plus a skull, and then the pieces that make the outline: they go
 * into a single merged mesh per material and are tagged `silhouette`, so a
 * reek still has horns and an acklay still has a crest at the range the
 * player was complaining about.
 */
function buildCreatureHead(rig, P, S, M) {
  const head = rig.get('head');
  const [segs, nLen, nR, nPitch, nCurl] = P.neck;
  const parts = [];

  /* ── THE NECK IS ONE SWEPT TUBE, AND IT LEAVES THE SHOULDERS FAT ──────
   *
   * It was `segs` separate limbGeo capsules laid nose to tail, each one CAPPED
   * at both ends, and that shape is the whole reason the head read as a box
   * stuck onto the body rather than as a head. Three faults, all of them the
   * chain's:
   *
   *   EVERY JOINT WAS A PINCH. Each capsule domes out to capY 0.62 at both
   *   ends and the next one starts at the previous one's ORIGIN, not at its
   *   dome — so the surface went out, in, and out again once per segment. On
   *   the massiff's two-segment neck that is one visible constriction directly
   *   behind the skull, which is exactly where an animal's neck is thickest.
   *
   *   IT LEFT THE TRUNK AT NECK WIDTH. `nR` is the radius of the neck under
   *   the jaw, and the first capsule started at that radius INSIDE the
   *   shoulder — so the neck met the body as a peg in a hole. Nothing carried
   *   the head's mass down into the trunk, and a head whose support is a peg
   *   is a head that has been stuck on.
   *
   *   FIVE PAIRS OF CAPS WERE BURIED. The same argument the tail already makes
   *   two hundred lines up (see tubeGeo's header): the interior caps are
   *   triangles nobody can ever see. A three-segment neck spent 40% of itself
   *   on them.
   *
   * So it is one `tubeGeo` down the same polyline the chain walked — same
   * `nLen`, `nPitch` and `nCurl`, so every plan's neck still arrives at the
   * same place and at the same angle — resampled to at least three rings a
   * segment so the curl is a curve rather than a dogleg, and swept from a
   * TRAPEZIUS at the root to `nR` under the jaw.
   *
   * The root radius is 1.45×nR, clamped to the trunk's OWN half-width where
   * the neck leaves it — `M.trunkR`, raycast off the lathe by the caller, and
   * not `P.girth`. That distinction is the whole of this paragraph and it was
   * got wrong: `girth` is the lathe's nominal radius at its widest, and the
   * lathe tapers to 0.72 of it at the front and is then reshaped by a
   * superellipse. On the massiff the clamp let the neck out to 0.266·S where
   * the shoulder it grows from is 0.20·S wide, so the "trapezius" left the
   * body as a flat triangular sail standing proud of the animal on both
   * sides — a cowl, not a neck, and the single most conspicuous thing on the
   * rendered body. The measured seat cannot be wrong by construction, in the
   * same way and for the same reason `onLimb` is used instead of typing a
   * radius. 0.92 of it, so the neck arrives just inside the shoulder's
   * outline rather than exactly on it.
   *
   * And it STARTS BEHIND THE HEAD BONE, a full segment back down its own
   * pitch, which puts the root ring well inside the trunk lathe. A tube that
   * begins on the shoulder's surface still shows a rim; one that begins
   * inside it cannot. (0.55 of a segment was not enough on the four plans
   * whose necks are shortest — the flare decays over a fixed fraction of the
   * TUBE, so a 0.28·S neck spends its taper in the first 0.09·S and the rim
   * lands outside the hide.) Nothing downstream reads the neck's mesh
   * extent — `head.radius` is set from S below, as it always was.
   */
  const RN = Math.max(4, segs * 3 + 1);       // rings, not segments
  const nodes = [];
  const root = Math.min(nR * 1.45 * S, (M.trunkR ?? P.girth * S) * 0.92);
  let hy = 0, hz = 0, pitch = nPitch;
  {
    /* BACK is how many of the plan's own segments the tube starts BEHIND the
     * head bone, and the walk is extended by exactly that much so the tip
     * still lands where the skull hangs — a tube that buried its root without
     * lengthening would leave the last centimetres of neck missing and the
     * head floating clear of it. The start angle is wound back by the same
     * amount of curl, so at the bone's own origin the tube is travelling at
     * `nPitch` and reaches `nPitch + nCurl * segs` at the tip: the two walks
     * agree at both ends by construction rather than by arithmetic. */
    const back = 1.0;
    const span = segs + back;
    const step = (nLen * S * span) / (RN - 1);
    let a = nPitch - nCurl * back;
    let y = -Math.sin(a) * nLen * S * back, z = -Math.cos(a) * nLen * S * back;
    for (let i = 0; i < RN; i++) {
      const u = i / (RN - 1);
      // the flare is concentrated at the base: ²·² decays to nothing by a
      // third of the way up, which is where a trapezius stops.
      nodes.push([0, y, z, nR * S * 0.95 + (root - nR * S * 0.95) * (1 - u) ** 2.2]);
      z += Math.cos(a) * step; y += Math.sin(a) * step; a += (nCurl * span) / (RN - 1);
    }
    // where the neck ARRIVES, which is where every branch below hangs its
    // skull. Walked separately at the plan's own resolution so the numbers the
    // five head branches were authored against do not move by a millimetre.
    for (let i = 0; i < segs; i++) {
      hy += Math.sin(pitch) * nLen * S; hz += Math.cos(pitch) * nLen * S;
      pitch += nCurl;
    }
  }
  parts.push([tubeGeo(nodes, 9), [0, 0, 0]]);

  const k = new Kit();
  const K = P.head;

  /**
   * A MUZZLE, AND NOT A BOX.
   *
   * Every one of the five heads hung its jaw off a `plateGeo` — a rounded
   * cuboid — and that single call is the "detached rectangular box" the
   * complaint names. A plateGeo has four flat sides, four hard vertical
   * corners and a FLAT FRONT WALL, so at any angle off dead-centre the animal
   * is showing you the end of a crate. Rounding the corners harder does not
   * help: the silhouette is still a rectangle, and the front face is still a
   * wall the nose stops at.
   *
   * This is a tapered lathe instead, laid along the neck's own heading and
   * reshaped by `muzzleSection` — so it is wide across the cheeks, flat over
   * the nasal bridge, full under the jaw, and it comes to a rounded NOSE
   * rather than to a plane. It is the same trick the trunk already uses and
   * for the same stated reason: a body of revolution is a barrel, a
   * superellipse is an animal.
   *
   *   len          nose-to-hinge, ×S
   *   w0, w1       half-width at the hinge and at the nose, ×S
   *   y, z         the hinge, relative to where the neck arrives
   *   droop        radians nose-down, in the HEAD BONE's frame
   *
   * The droop is measured in the bone's frame and NOT off the neck's heading,
   * which is the one thing worth arguing about here. The five branches below
   * were authored by eye against a box that carried its own X rotation, so
   * every jaw angle in this function is already a bone-frame number; folding
   * the neck's accumulated curl into it would have silently re-aimed all five
   * mouths the moment the neck changed shape, and re-aiming a mouth is not a
   * thing a neck rewrite is allowed to do. `Math.PI / 2` lays the lathe's +Y
   * down +Z (forward) and `droop` tips the nose under, so a branch passes the
   * same number its plateGeo used to carry.
   *
   * `capY0: 0.22` keeps the back cap shallow so it tucks inside the cranium
   * instead of pushing a second dome out through the cheek.
   */
  const muzzle = (len, w0, w1, y, z, droop, o = {}) => [
    limbGeo(len * S, w0 * S, w1 * S, 10, true, {
      rings: 4, capN: 3, capY0: 0.22, capY1: o.nose ?? 0.62,
      section: muzzleSection(o),
    }),
    [0, hy + y * S, hz + z * S], [Math.PI / 2 + droop, 0, 0],
  ];

  /**
   * THE CHEEK — the mass that makes the join a join.
   *
   * A cranium and a muzzle placed end to end are two shapes touching, however
   * well each is shaped; what a skull actually has between them is the
   * masseter, a wedge of muscle from the zygomatic arch down to the angle of
   * the jaw, and it is the piece that carries the eye line into the mouth.
   * One squashed ellipsoid a side, merged into the same shell, and the head
   * stops coming apart at the eyes.
   */
  const cheek = (x, y, z, r, sx = 1.0, sy = 0.78, sz = 1.25) => {
    const g = new THREE.SphereGeometry(r * S, 9, 7);
    g.scale(sx, sy, sz);
    return [g, [x * S, hy + y * S, hz + z * S]];
  };

  /**
   * AN EYE, WITH SOMETHING BEHIND IT.
   *
   * Six eyes across five branches were each one `emissiveMat` sphere placed
   * by hand, and this is those six calls with the pupil from `M.pupil` in the
   * same call — one place that knows how big a pupil is relative to an eye
   * and how far in front of it the bead sits, rather than six. `r` is the
   * eye's radius in plan units exactly as the old literals were, so the eyes
   * do not move or change size.
   *
   * The bead is pushed OUTWARD ALONG THE EYE'S OWN RADIUS — the direction
   * from where the neck arrives to where the eye is placed — and not along
   * +Z. That distinction is visible: an eye set on the side of a long skull
   * with its pupil shoved forward shows the bead on the front corner of the
   * iris, which reads as a squint. The radius is the one direction that is
   * correct for a four-eyed nexu, a rancor's deep-set pair and a reek's
   * horn-flanked eyes alike, because it is derived from where each of them
   * was put rather than assumed about all of them.
   */
  const eyeAt = (x, y, z, r) => {
    k.add(M.eye, new THREE.SphereGeometry(r * S, 7, 6), [x * S, hy + y * S, hz + z * S]);
    const d = Math.hypot(x, y, z) || 1;
    k.add(M.pupil, new THREE.SphereGeometry(r * 0.50 * S, 6, 5),
      [(x + (x / d) * r * 0.62) * S, hy + (y + (y / d) * r * 0.62) * S, hz + (z + (z / d) * r * 0.62) * S]);
  };

  /**
   * ── AND THE FIVE BRANCHES BELOW NOW CALL THEM ────────────────────────
   *
   * `muzzle()` and `cheek()` were written, argued for at length, and then not
   * wired in: every one of the five heads still hung its jaw off `plateGeo`
   * and its skull off a bare `SphereGeometry`, which is the exact pair of
   * calls the two headers above name as the defect. Rendered, that reads as a
   * grey slab with teeth in it floating off the front of a ball — "the head
   * reads as a detached rectangular box", said of the massiff, and it was
   * true of all twelve plans because all twelve go through these five
   * branches.
   *
   * What changes below is only the SHAPE of three pieces per head — cranium,
   * muzzle, cheeks. Every horn, tusk, eye, fang, quill, crest and ruff keeps
   * the coordinates it was authored at, because those were authored by eye
   * against the old boxes' extents and moving them would re-aim five faces at
   * once. Where a new lathe's extent had to differ from the box it replaces,
   * it is stated on the line.
   *
   * The muzzle's ROOT is its hinge, not its centre — a plateGeo was placed at
   * its middle — so every `z` below is the old box's centre minus half its
   * old depth, and the length is the old depth plus however much snout the
   * animal is owed. That arithmetic is why the numbers look unfamiliar next
   * to the git history: they are the same head.
   */
  if (K === 'horned') {
    /* THE REEK. The skull is a wide low wedge and everything that matters is
     * carried in FRONT of the eyes: a frill across the brow, two cheek horns
     * curving down and forward, and the nasal horn that is the thing which
     * actually hits you. Head-on it is a wall rather than a face, which is
     * the whole counter-play — you do not meet this one from the front. */
    parts.push([(() => { const g = new THREE.SphereGeometry(0.26 * S, 12, 9); g.scale(1.06, 0.84, 1.04); return g; })(),
      [0, hy + 0.02 * S, hz + 0.16 * S]]);
    /* BLUNT, and that is the whole reek: `flat` 0.88 and w1 within a hair of
     * w0, so the muzzle is a squared-off box-end of bone rather than a snout.
     * It runs 0.11 → 0.55 where the old plate ran 0.11 → 0.53, so the nasal
     * horn seated at 0.40–0.74 still leaves the face where it always did. */
    parts.push(muzzle(0.44, 0.165, 0.150, -0.13, 0.11, 0.05, { flat: 0.88, n: 3.2, chin: 0.13, crown: 0.10 }));
    for (const sx of [1, -1]) parts.push(cheek(sx * 0.16, -0.03, 0.18, 0.135, 1.0, 0.86, 1.30));
    k.add(M.plate, plateGeo(0.92 * S, 0.58 * S, 0.11 * S, 0.05 * S, 2), [0, hy + 0.20 * S, hz - 0.02 * S], [-0.34, 0, 0]);
    k.add(M.plate, tubeGeo([[0, hy + 0.06 * S, hz + 0.40 * S, 0.095 * S],
      [0, hy + 0.30 * S, hz + 0.60 * S, 0.055 * S], [0, hy + 0.52 * S, hz + 0.74 * S, 0.012 * S]], 7));
    k.pair((sx) => {
      k.add(M.plate, tubeGeo([[sx * 0.20 * S, hy + 0.08 * S, hz + 0.20 * S, 0.085 * S],
        [sx * 0.34 * S, hy - 0.06 * S, hz + 0.46 * S, 0.050 * S],
        [sx * 0.32 * S, hy + 0.06 * S, hz + 0.68 * S, 0.010 * S]], 7));
      eyeAt(sx * 0.18, 0.10, 0.20, 0.046);
    });
  } else if (K === 'fanged') {
    /* THE NEXU. FOUR EYES in two pairs — one line of geometry and the single
     * most alien thing about the animal, because a face with the wrong number
     * of eyes on it reads as wrong from further away than any amount of horn
     * — over a mouth that is wider than the skull, with the fangs standing
     * OUTSIDE the lip line the way the reference photograph has them. */
    /* THE BRAINCASE PULLS BACK AND THE SNOUT DOES THE REACHING. The old
     * ellipsoid was stretched 1.30 on Z and ran to 0.51 on its own, so the
     * jaw box sat entirely INSIDE it and the animal had no muzzle at all —
     * one smooth egg with a slab hung under it. This is a braincase (1.05 on
     * Z, front at 0.33) plus a real snout that carries the face out to 0.51,
     * which is where the head used to end. Same reach, a face on it. */
    parts.push([(() => { const g = new THREE.SphereGeometry(0.22 * S, 12, 9); g.scale(0.98, 0.82, 1.05); return g; })(),
      [0, hy + 0.02 * S, hz + 0.10 * S]]);
    parts.push(muzzle(0.48, 0.20, 0.105, -0.05, 0.03, 0.10, { flat: 0.68, n: 3.0, chin: 0.18, crown: 0.10 }));
    for (const sx of [1, -1]) parts.push(cheek(sx * 0.14, -0.02, 0.11, 0.125, 1.0, 0.88, 1.25));
    k.pair((sx) => {
      eyeAt(sx * 0.11, 0.10, 0.26, 0.042);
      eyeAt(sx * 0.16, 0.03, 0.16, 0.030);
      k.row(4, (i, t) => {
        /* SIX SIDES AND THREE RINGS, not four and two. A fang is 2 cm long
         * and stands OUTSIDE the lip where nothing hides its silhouette, and
         * at rings 2 it is two prisms end to end — the rendered massiff has
         * a mouthful of flat white wedges. Three rings on the same 0.35 rad
         * of bend is a curve; six sides round the shaft is the difference
         * between a tooth and a shard. */
        k.add(M.tooth, clawGeo((0.18 - t * 0.06) * S, 0.028 * S, 0.004 * S, 0.35, 6, 3),
          [sx * (0.10 + t * 0.09) * S, hy - 0.10 * S, hz + (0.40 - t * 0.16) * S], [0.9 + t * 0.5, 0, 0]);
        k.add(M.tooth, clawGeo((0.15 - t * 0.05) * S, 0.024 * S, 0.004 * S, 0.35, 6, 3),
          [sx * (0.10 + t * 0.09) * S, hy - 0.02 * S, hz + (0.40 - t * 0.16) * S], [2.35 - t * 0.4, 0, 0]);
      });
      /* The quill whiskers either side of the jaw — THREE nodes and not two.
       * `tubeGeo` puts one ring per node, so a two-node quill is a five-sided
       * cone: seen from the side it is a flat pale blade lying across the
       * cheek, which on the tooka's small head is the biggest thing on it.
       * A mid node at a third of the radius makes it a taper. */
      k.add(M.plate, tubeGeo([[sx * 0.14 * S, hy + 0.02 * S, hz + 0.10 * S, 0.016 * S],
        [sx * 0.28 * S, hy + 0.08 * S, hz + 0.01 * S, 0.008 * S],
        [sx * 0.42 * S, hy + 0.13 * S, hz - 0.11 * S, 0.003 * S]], 6, { capRoot: false }));
    });
  } else if (K === 'tusked') {
    /* THE RANCOR. No neck: the skull is a wedge sitting straight on the
     * shoulders, and the read is the MOUTH — a jaw as wide as the head with
     * tusks standing up out of the lower jaw past the upper lip, which is the
     * thing every photograph of one is showing. Two small deep-set eyes above
     * a brow shelf, and lumps of bone over the crown. */
    parts.push([(() => { const g = new THREE.SphereGeometry(0.32 * S, 12, 9); g.scale(0.90, 0.90, 1.14); return g; })(),
      [0, hy + 0.04 * S, hz + 0.14 * S]]);
    /* THE WIDEST MUZZLE IN THE TABLE and barely tapered — 0.26 to 0.21 half
     * width over half a metre of jaw — because the rancor's read is that its
     * mouth is as wide as its skull. 0.00 → 0.52 against the old box's
     * 0.00 → 0.52: the tusks at 0.42–0.50 sit exactly where they did. */
    parts.push(muzzle(0.52, 0.26, 0.21, -0.21, 0.00, 0.05, { flat: 0.80, n: 3.4, chin: 0.16, crown: 0.06 }));
    for (const sx of [1, -1]) parts.push(cheek(sx * 0.21, -0.06, 0.14, 0.185, 1.0, 0.84, 1.20));
    /* The brow shelf, which was the third plateGeo on this head. A shelf is a
     * ridge of bone over the eyes and not a plank: an ellipsoid squashed flat
     * on Y keeps the overhang and loses the four corners. */
    parts.push([(() => { const g = new THREE.SphereGeometry(0.23 * S, 10, 8); g.scale(1.02, 0.38, 0.68); return g; })(),
      [0, hy + 0.26 * S, hz + 0.06 * S], [-0.24, 0, 0]]);
    k.pair((sx) => {
      // the tusks: up out of the lower jaw, past the lip
      k.add(M.tooth, tubeGeo([[sx * 0.20 * S, hy - 0.24 * S, hz + 0.42 * S, 0.055 * S],
        [sx * 0.23 * S, hy - 0.02 * S, hz + 0.46 * S, 0.036 * S],
        [sx * 0.24 * S, hy + 0.18 * S, hz + 0.42 * S, 0.008 * S]], 6));
      k.add(M.tooth, tubeGeo([[sx * 0.11 * S, hy - 0.26 * S, hz + 0.46 * S, 0.040 * S],
        [sx * 0.12 * S, hy - 0.08 * S, hz + 0.50 * S, 0.024 * S],
        [sx * 0.12 * S, hy + 0.06 * S, hz + 0.48 * S, 0.006 * S]], 6));
      eyeAt(sx * 0.16, 0.14, 0.30, 0.040);
      k.add(M.plate, clawGeo(0.26 * S, 0.070 * S, 0.014 * S, -0.5, 5, 2),
        [sx * 0.20 * S, hy + 0.32 * S, hz - 0.06 * S], [-0.7, 0, sx * 0.4]);
      k.row(3, (i, t) => k.add(M.tooth, clawGeo(0.11 * S, 0.022 * S, 0.004 * S, 0.3, 4, 2),
        [sx * (0.08 + t * 0.10) * S, hy - 0.12 * S, hz + (0.30 + t * 0.14) * S], [2.5, 0, 0]));
    });
  } else if (K === 'snouted') {
    /**
     * THE TAUNTAUN — the sixth branch, and the one the fifth's own comment
     * asked for and did not build.
     *
     * `horned-ape` says it out loud: "Three plans that are genuinely
     * long-snouted — taun, blurrg, varac — share this branch and are the
     * argument for a sixth one, recorded here and not acted on: a new branch
     * is a new silhouette for three shipped bodies." That was the right call
     * then and it is the wrong one now: the tauntaun is not a shipped enemy
     * seen for four seconds across a wave, it is a COMPANION the player looks
     * at for a whole deployment and rides. It was wearing a wampa's face.
     *
     * The gundark branch is a FACE — a flat wide front with the horns curving
     * sideways off the temples, an underbite of fangs and a fur ruff, on a
     * 0.30 snout that is deliberately short so a wampa does not read as a dog.
     * Every one of those is wrong for this animal, and rendered it exactly as
     * wrong as it sounds: an ape's head with two spikes, hung on the front of
     * a running body.
     *
     * WHAT A TAUNTAUN'S HEAD IS, in the order the eye takes it:
     *
     *   THE SNOUT, which is the whole read. 0.62 long — the longest in the
     *   file, past the acklay's 0.56 — on a 0.17 hinge tapering to 0.105, so
     *   it is a taper and not a tube. `flat: 0.92` and `n: 2.6` keep the
     *   section nearly round and soft-cornered: this is a woolly herbivore,
     *   not a chitin jaw, and the acklay's 0.60 flat is what makes ITS head
     *   read as an insect. The droop is 0.06, almost none — a browsing animal
     *   carries its nose level and the gundark's 0.11 was already tipping it.
     *
     *   THE NOSTRILS, and nothing else in the file has them. Two dark
     *   ellipsoids sunk into the end of the snout: at forty metres they are
     *   two pixels of shadow on a pale muzzle, which is precisely the detail
     *   that stops a snout reading as a peg.
     *
     *   THE HORNS, curving BACK over the crown rather than out from the
     *   temples. Three nodes so it is a curve; the wampa's are two-node
     *   spikes swept sideways, which is the one thing that made the shared
     *   branch unmistakably not this animal.
     *
     *   NO FANGS. A tauntaun does not bite anything — the plan declares
     *   `moves: []` and the archetype `damage: 0` — and a mouthful of tusks
     *   on an animal that cannot use them is the kind of decoration that
     *   makes a body read as parts. The lower jaw is a lip and a chin.
     *
     *   THE RUFF at the base of the skull, kept from the gundark because it
     *   is right here for a different reason: the coat is the animal's other
     *   read, `back: 'shag'` carries it down the spine, and a bare join
     *   between a woolly body and a smooth head is the seam a player sees.
     */
    parts.push([(() => { const g = new THREE.SphereGeometry(0.245 * S, 12, 9); g.scale(0.94, 0.96, 1.02); return g; })(),
      [0, hy + 0.03 * S, hz + 0.04 * S]]);
    parts.push(muzzle(0.62, 0.17, 0.105, -0.06, 0.06, 0.06, { flat: 0.92, n: 2.6, chin: 0.22, crown: 0.14 }));
    for (const sx of [1, -1]) parts.push(cheek(sx * 0.15, -0.02, 0.13, 0.135, 1.0, 0.94, 1.15));
    /* The jaw, as a lip rather than a mouthful: one shallow lathe under the
     * snout's front third, so the profile has an underline and the head does
     * not end in a cone. */
    parts.push([(() => { const g = new THREE.SphereGeometry(0.13 * S, 10, 8); g.scale(0.92, 0.52, 1.9); return g; })(),
      [0, hy - 0.12 * S, hz + 0.34 * S], [0.06, 0, 0]]);
    k.pair((sx) => {
      /* THE HORN. Three nodes, off the crown and swept BACK and slightly out
       * — 0.24 wide at the base curling to 0.30 at the tip over 0.46 of
       * length going backwards, which is a ram's horn and not a spike. */
      k.add(M.plate, tubeGeo([[sx * 0.16 * S, hy + 0.20 * S, hz + 0.02 * S, 0.055 * S],
        [sx * 0.24 * S, hy + 0.30 * S, hz - 0.20 * S, 0.038 * S],
        [sx * 0.30 * S, hy + 0.22 * S, hz - 0.44 * S, 0.010 * S]], 7));
      /* Eyes high and to the SIDE of the skull, which is where a prey animal
       * carries them and is the other half of "this is not a predator". */
      eyeAt(sx * 0.175, 0.11, 0.10, 0.044);
      /* THE NOSTRIL. Sunk into the end of the snout with the pupil material,
       * which is the darkest thing on the body — two of them on a pale muzzle
       * is the detail that reads at range. */
      k.add(M.pupil, (() => { const g = new THREE.SphereGeometry(0.045 * S, 8, 6); g.scale(1.0, 1.35, 0.55); return g; })(),
        [sx * 0.055 * S, hy - 0.02 * S, hz + 0.60 * S]);
      // the ruff, at the join with the coat
      k.row(3, (i, t) => k.add(M.hide, clawGeo(0.30 * S, 0.090 * S, 0.015 * S, 0.55, 6, 3),
        [sx * (0.17 + t * 0.07) * S, hy - (0.04 + t * 0.09) * S, hz - 0.10 * S], [1.7 + t * 0.4, 0, sx * (1.0 - t * 0.3)]));
    });
  } else if (K === 'horned-ape') {
    /* THE GUNDARK. A wide flat FACE rather than a muzzle — the wampa's read
     * is that it looks at you from the front — with the horns curving out
     * SIDEWAYS off the temples rather than forward, an underbite of fangs,
     * and a fur ruff round the jaw that carries the head's outline into the
     * shoulders. */
    parts.push([(() => { const g = new THREE.SphereGeometry(0.30 * S, 12, 9); g.scale(1.10, 0.94, 0.86); return g; })(),
      [0, hy + 0.04 * S, hz + 0.08 * S]]);
    /* SHORT AND DEEP — 0.30 of snout on a 0.26-wide hinge — because this
     * branch is a FACE and not a muzzle, and a long lathe here would turn the
     * wampa into a dog. It runs 0.07 → 0.37 where the old box ran 0.07 → 0.33;
     * the four centimetres it gains are a nose, and the fangs at 0.26 and the
     * ruff at −0.02 are both untouched. Three plans that are genuinely
     * long-snouted — taun, blurrg, varac — share this branch and are the
     * argument for a sixth one, recorded here and not acted on: a new branch
     * is a new silhouette for three shipped bodies. */
    parts.push(muzzle(0.30, 0.19, 0.135, -0.17, 0.07, 0.11, { flat: 0.76, n: 3.0, chin: 0.18, crown: 0.08 }));
    for (const sx of [1, -1]) parts.push(cheek(sx * 0.18, -0.07, 0.10, 0.155, 1.0, 0.88, 1.05));
    k.pair((sx) => {
      k.add(M.plate, tubeGeo([[sx * 0.26 * S, hy + 0.18 * S, hz - 0.02 * S, 0.060 * S],
        [sx * 0.46 * S, hy + 0.20 * S, hz + 0.10 * S, 0.040 * S],
        [sx * 0.56 * S, hy + 0.06 * S, hz + 0.22 * S, 0.008 * S]], 6));
      eyeAt(sx * 0.13, 0.08, 0.24, 0.038);
      k.row(3, (i, t) => k.add(M.tooth, clawGeo(0.14 * S, 0.026 * S, 0.005 * S, 0.3, 4, 2),
        [sx * (0.07 + t * 0.08) * S, hy - 0.18 * S, hz + 0.26 * S], [0.4 + t * 0.3, 0, 0]));
      // the ruff — fur clumps round the jaw, which is where the wampa's
      // outline stops being a head and starts being a coat
      k.row(3, (i, t) => k.add(M.hide, clawGeo(0.28 * S, 0.085 * S, 0.015 * S, 0.5, 5, 2),
        [sx * (0.20 + t * 0.08) * S, hy - (0.06 + t * 0.10) * S, hz - 0.02 * S], [1.6 + t * 0.4, 0, sx * (1.1 - t * 0.3)]));
    });
  } else if (K === 'beak') {
    /**
     * THE VHAL'KIR HAWK — the sixth branch, and the first head in this
     * function with no MOUTH in it.
     *
     * Every other branch here is a cranium plus `muzzle()` plus teeth, because
     * every other animal in the table bites. A raptor's head is three shapes
     * and none of them is a jaw:
     *
     *   THE FACIAL DISC. The thing that makes a hawk or an owl read as a hawk
     *   or an owl from further away than any beak does: the head is a flat
     *   DISH aimed forward with the eyes set in it, not a snout with eyes on
     *   the sides of it. It is the cranium sphere squashed hard on Z (0.72)
     *   and a shallow ring of feather in front of it, and it is why this
     *   branch does not call `cheek()` — a masseter is the mass that carries
     *   an eye line into a mouth, and there is no mouth to carry it into.
     *
     *   THE EYES, ENORMOUS AND FORWARD. 0.055 of scale each on a 0.20 skull,
     *   against the nexu's 0.042 on 0.22 and the reek's 0.046 on 0.26 — the
     *   biggest eye-to-skull ratio in the file by half again. Binocular and
     *   set 0.075 apart on a 0.30-wide head, so both are visible in the same
     *   frontal silhouette. A bird whose eyes are on the sides of its head is
     *   a pigeon; this one is meant to be looking at you.
     *
     *   THE HOOK. `muzzle()` is used for the CERE and the upper mandible —
     *   short (0.17 against the gundark's 0.30, the shortest in the table) and
     *   deep rather than long, so it is a bill and not a snout — and then a
     *   `clawGeo` with 1.35 rad of bend takes the tip down and under past the
     *   lower mandible. That overhanging hook is the single feature that says
     *   BIRD OF PREY rather than bird, and it is 3 cm of geometry.
     *
     * The two crown tufts and the nape feathers go in the Kit and are marked
     * silhouette with everything else, because at forty metres a head this
     * small is an outline and nothing else — and a hawk's outline is a hooked
     * profile with a ragged nape behind it.
     */
    /**
     * AND THE WHOLE BRANCH IS AUTHORED AT 0.58 OF SCALE, which is the one
     * thing that separates a bird's head from every other head in this
     * function. The four mammal branches are authored at 1: a reek's skull is
     * as wide as its own shoulder and a rancor's is wider. A hawk's is a
     * quarter of the width of its body, and the first build of this branch —
     * a 0.20 cranium on a 0.13 trunk — rendered as a bear's head with a beak
     * on it, 40 cm across on a 36 cm body. 0.80 is where it landed: 0.58 and 0.68
     * both rendered a head too small for its own neck, which is the same
     * disconnection the complaint names on the massiff, arrived at from the
     * other direction.
     * `hS` is that ratio, applied to
     * every shape in the branch, so the head shrinks as ONE thing rather than
     * as eleven numbers that can drift apart.
     */
    const hk = 0.80, hS = S * hk;
    parts.push([(() => { const g = new THREE.SphereGeometry(0.20 * hS, 12, 9); g.scale(1.02, 0.94, 0.72); return g; })(),
      [0, hy + 0.02 * hS, hz + 0.04 * hS]]);
    /**
     * ── AND THE BILL IS PALE, WHICH PUTS IT IN THE KIT ──────────────────
     *
     * Every other head in this function builds its jaw into `parts`, which is
     * merged into the skull and therefore wears `M.hide`. That is right for a
     * mammal whose muzzle is the same skin as its face and wrong here: a bird
     * of prey's bill is HORN, a different material from every feather on it,
     * and the pale hook against the dark head is most of what says "raptor" in
     * a silhouette that is otherwise a dark lump.
     *
     * It costs nothing to move: the Kit is merged per material and the whole
     * of it is marked `silhouette` below, so the bill survives the LOD cull
     * exactly as the skull does. `muzzle()` returns the triple `parts` wants,
     * so it is destructured into `k.add` rather than reimplemented.
     *
     * The cere and the upper mandible run 0.06 → 0.23 forward of where the
     * neck arrives; `flat` 0.52 makes the section deeper than it is wide (a
     * bill's, and the opposite of the reek's 0.88 slab) and `crown` 0.22 keeps
     * the culmen — the ridge along the top of the bill — convex.
     */
    const bill = muzzle(0.17 * hk, 0.070 * hk, 0.030 * hk, 0.02 * hk, 0.06 * hk, 0.34,
      { flat: 0.52, n: 2.6, chin: 0.10, crown: 0.22, nose: 0.30 });
    k.add(M.plate, bill[0], bill[1], bill[2]);
    // the lower mandible, shorter and tucked under: a bill closes short of its own hook
    k.add(M.plate, limbGeo(0.13 * hS, 0.052 * hS, 0.026 * hS, 8, true,
      { rings: 3, capN: 2, capY0: 0.20, capY1: 0.44, section: muzzleSection({ flat: 0.62, n: 2.4 }) }),
    [0, hy - 0.035 * hS, hz + 0.06 * hS], [Math.PI / 2 + 0.42, 0, 0]);
    /* THE HOOK. The furthest-forward point on the whole animal and the thing
     * the profile is read by — 1.35 rad of bend takes the tip down and under
     * past the lower mandible, and that overhang is the single feature that
     * says BIRD OF PREY rather than bird. */
    k.add(M.plate, clawGeo(0.075 * hS, 0.030 * hS, 0.004 * hS, 1.35, 6, 5),
      [0, hy + 0.045 * hS, hz + 0.215 * hS], [1.30, 0, 0]);
    k.pair((sx) => {
      /* The eye, and a dark rim round it. Two spheres, and the rim is `plate`
       * — the pale horn colour — so the eye reads as a ring with a light in it
       * rather than as a bead stuck on a head. */
      k.add(M.plate, (() => { const g = new THREE.SphereGeometry(0.062 * hS, 8, 6); g.scale(1, 1, 0.55); return g; })(),
        [sx * 0.075 * hS, hy + 0.055 * hS, hz + 0.115 * hS]);
      k.add(M.eye, new THREE.SphereGeometry(0.048 * hS, 8, 6), [sx * 0.075 * hS, hy + 0.055 * hS, hz + 0.145 * hS]);
      /* THE BROW. A hawk's supraorbital ridge is why it looks angry, and it is
       * a real shelf of bone standing over the eye — one squashed ellipsoid a
       * side, raked down and forward over the socket. */
      k.add(M.plate, (() => { const g = new THREE.SphereGeometry(0.070 * hS, 8, 6); g.scale(1.05, 0.30, 0.62); return g; })(),
        [sx * 0.080 * hS, hy + 0.115 * hS, hz + 0.090 * hS], [-0.34, 0, sx * 0.24]);
      /* The crown tuft, raked back off the temple — and it is 0.13 rather
       * than the 0.20 it was authored at, because at 0.20 on a head this size
       * the pair rendered as two curved HORNS over the skull. An ear tuft
       * lies back along the crown; it does not stand off it. */
      k.add(M.hide, clawGeo(0.13 * hS, 0.034 * hS, 0.005 * hS, -0.40, 5, 4),
        [sx * 0.070 * hS, hy + 0.135 * hS, hz - 0.020 * hS], [-1.35, 0, sx * 0.34]);
      // the nape: three short feathers breaking the line into the neck
      k.row(3, (i, t) => k.add(M.hide, clawGeo((0.15 - t * 0.03) * hS, 0.042 * hS, 0.008 * hS, 0.5, 5, 3),
        [sx * (0.045 + t * 0.055) * hS, hy + (0.06 - t * 0.10) * hS, hz - 0.11 * hS], [2.15, 0, sx * (0.5 + t * 0.7)]));
    });
  } else {
    /* THE ACKLAY. A long toothed jaw hung under a flat CREST that sweeps back
     * over the shoulders — in the reference the crest is the biggest single
     * shape on the animal and the old build had none of it. Mandibles sweep
     * forward and in from the corners of the jaw. */
    parts.push([(() => { const g = new THREE.SphereGeometry(0.24 * S, 12, 9); g.scale(0.82, 0.76, 1.10); return g; })(),
      [0, hy + 0.02 * S, hz + 0.16 * S], [0.28, 0, 0]]);
    /* THE NARROWEST AND THE LONGEST — 0.11 at the hinge over 0.56 of jaw, and
     * `flat` 0.60 so it is deeper than it is wide. That is the one shape an
     * insect's head has and a mammal's never does, and it is what the old
     * 1.52-on-Z ellipsoid was reaching for with a stretched ball. The lathe
     * carries the same droop the box did (0.32) plus the cranium's own tilt,
     * and runs 0.14 → 0.70 against the old box's 0.14 → 0.58: the extra is
     * jaw the mandibles at 0.44–0.70 were already sweeping past. */
    parts.push(muzzle(0.56, 0.115, 0.062, -0.11, 0.14, 0.30, { flat: 0.60, n: 2.8, chin: 0.12, crown: 0.06 }));
    for (const sx of [1, -1]) parts.push(cheek(sx * 0.11, 0.00, 0.16, 0.105, 1.0, 0.90, 1.45));
    // the crest: two swept plates rather than one, so it has a ridge down it
    k.pair((sx) => {
      k.add(M.plate, plateGeo(0.40 * S, 0.06 * S, 0.86 * S, 0.04 * S, 2),
        [sx * 0.19 * S, hy + 0.30 * S, hz - 0.22 * S], [-0.62, sx * 0.10, sx * 0.22]);
      k.add(M.plate, tubeGeo([[sx * 0.16 * S, hy + 0.10 * S, hz + 0.14 * S, 0.055 * S],
        [sx * 0.30 * S, hy - 0.12 * S, hz + 0.44 * S, 0.034 * S],
        [sx * 0.20 * S, hy - 0.20 * S, hz + 0.70 * S, 0.008 * S]], 6));
      eyeAt(sx * 0.14, 0.12, 0.22, 0.048);
      k.row(4, (i, t) => {
        k.add(M.tooth, clawGeo(0.10 * S, 0.021 * S, 0.004 * S, 0.3, 4, 2),
          [sx * 0.11 * S, hy - 0.20 * S, hz + (0.24 + t * 0.34) * S], [0.5, 0, 0]);
        k.add(M.tooth, clawGeo(0.09 * S, 0.019 * S, 0.004 * S, 0.3, 4, 2),
          [sx * 0.11 * S, hy - 0.09 * S, hz + (0.26 + t * 0.32) * S], [2.55, 0, 0]);
      });
    });
  }

  const skull = assemble(parts, 'skull');
  const hm = mesh(skull, M.hide, head.obj);
  head.primary = hm; head.parts.push(hm); head.radius = 0.5 * S;
  markSilhouette(k.bake(head.obj));
}

/* ── bodyguard droid (boss) ──────────────────────────────────────────── */

/**
 * TWO ARCHETYPES, ONE CHASSIS, TWO SCALES AND NOTHING ELSE.
 *
 * `magna` (rung 5 of the CIS ladder, 260 hp) and `bodyguard` (the Foundry's
 * 1050-hp set-piece general) are both this builder, at 1.18 and 1.3, and they
 * measured 0.658 flank IoU at LOD 1 — close enough that a player who has just
 * learnt to fight one meets the other and reads it as the first one standing
 * further away. A set-piece must be legible AS a set-piece before it moves.
 */
export const BODYGUARD_KITS = {
  /* THE DEFAULT ROW IS THE IDENTITY, and it has to be. Every other table in
   * this file makes its no-kit row `{}` so that a builder called the way it
   * has always been called emits what it has always emitted; this one was
   * first written with the guard's girth in the default row, which quietly
   * made the shipped IG general 22% thinner before anything had asked it to. */
  chassis: {},
  /* `frame` goes through to buildB2's girth. An IG-100 is a spindle with a
   * cowl on it, not a slab — the reference plates are unambiguous — and at a
   * B2's own girth the two measured 0.965 alike. */
  guard: { frame: 0.78 },
  general: { banner: true, frame: 0.86 },
};

/**
 * THE THING AT THE END OF THE WARSHIP, and the one droid in the game that
 * meets your blade instead of shooting at you.
 *
 * It is a B2 chassis and that is a decision rather than a shortcut. Everything
 * a saber archetype needs is already true of that body — a humanoid skeleton
 * with a right hand for a hilt, a chest and neck for `attachCloak` to hang a
 * cape off, and shoulders for `installPlates` — and reaching for a fresh
 * skeleton would have meant re-deriving the gait, the sever points and the
 * ragdoll for a body the player sees for ninety seconds. What it needs on top
 * is a SILHOUETTE that is not a B2's, because the whole claim of a boss is
 * that you know what it is the moment it walks through the door.
 *
 * Three changes do that, in the order they read at distance:
 *
 *  THE HEAD. A B2's is a flat-topped wedge 14 cm across. This one wears a
 *  narrow tapered cowl over it with two horns raked back off the crown, which
 *  turns a 0.14 m box into a 0.34 m spike and puts a shape on the skyline no
 *  other body in the game has. The photoreceptor under it is a single vertical
 *  slot rather than the B2's horizontal band — one lit line, not two.
 *
 *  THE COLOUR. 0x4a4d52 gunmetal against the B2's 0x7d7266 tan. That is the
 *  cheap half and it is the half that stops working at forty metres, which is
 *  why it is not the only one.
 *
 *  THE SHOULDERS. A pair of raked pauldrons and the mast that carries the
 *  cape. Without them the cloak the saber path attaches hangs off a bare neck
 *  and reads as a bug rather than as a garment.
 *
 * Everything here is parented to a BONE (chest, head), never to `rig.root`, so
 * `Actor.cut` hands it to the DetachedPiece with the limb it was sitting past
 * and `Actor.goRagdoll` re-homes it — the same path every rivet and armour
 * plate in this file already travels.
 */
/**
 * THE GEONOSIAN WARRIOR — the first body in this game with wings on it.
 *
 * Built off `assets/reference/units/creatures/Geonosian*.png`, the plates
 * `src/world/Props.js` already names for the arena's crowd, and the one
 * dimension the reference actually states: **1.75 m**, the Geonosian average
 * height. `scale` is the claim and `tools/checks/flight.mjs` is what turns it
 * into a measurement — see FLIGHT_CANON in src/game/Flight.js, which is where
 * the figure lives, for the same reason GIANT_CANON is not in giants.mjs.
 *
 * ── WHAT MAKES IT NOT A TROOPER WITH A DIFFERENT HAT ────────────────────
 *
 * Four things, and each of them is a number on this page rather than a note:
 *
 *   THE FRAME     `legLen: 1.10`, `armLen: 1.12` and a chest radius of 0.098
 *                 against a clone's 0.155. A Geonosian is 1.75 m of which
 *                 most is limb: the silhouette is a narrow trunk slung
 *                 between long thin legs, which is the opposite proportion to
 *                 every other biped on the roster.
 *   THE STOOP     `pitch` leans the whole trunk forward. A winged insect does
 *                 not stand upright; it hangs off its own thorax. This is the
 *                 one part of the outline that reads at forty metres with the
 *                 wings furled.
 *   THE HEAD      an elongated skull with a bony crest running back off it,
 *                 two large lenses and a pair of mandibles. It is the head
 *                 the reference is entirely about and it is `headGeo`, so it
 *                 REPLACES the default ball rather than hiding inside one.
 *   THE WINGS     two bones a side, dressed here, and the only meshes in the
 *                 game hanging off a `wing` role. They are marked
 *                 `silhouette` because a Geonosian at thirty metres with its
 *                 wings culled is a thin man, and the wings are the whole
 *                 reason you know what you are looking at.
 *
 * ── THE MEMBRANE IS TWO TRIANGLES OF CHITIN AND NOT A CLOTH SIM ────────
 *
 * `Cloth.js` costs what `cloth-cost` measures, and a swarm is the wrong place
 * to spend it: the flight model already moves these wings sixty times a
 * second (src/game/Flight.js beats them off the body's own climb rate), so
 * what a sim would add is drape on a surface that is under tension whenever
 * it matters. Rigid panels on a moving bone, at two draw calls a body.
 */
export function buildGeonosian(opts = {}) {
  const S = opts.scale ?? 0.97;
  /* Long limbs on a short trunk. `legLen`/`armLen` are the only two knobs the
   * skeleton has for proportion and both are pushed the same way, which is
   * what makes the trunk read as small without any bone being shortened. */
  const rig = new Rig(humanoidSkeleton(S, { armLen: 1.12, legLen: 1.10, wings: true }), { scale: S });

  const chitin = chitinMat(opts.color ?? 0x8a6f4e, 0.52);
  const dark = chitinMat(0x4e3d2a, 0.40);
  const membrane = chitinMat(0x6f5636, 0.30);
  const lens = glassMat(0x14100c, 0.10);
  const tooth = boneMat(0xd8c9a4, 0.36);

  /**
   * THE SKULL. A long braincase raked back over a short snout, a crest that
   * carries on past the back of the head, and a jaw hung under it. Authored as
   * one geometry so the whole head is one draw call at every range.
   */
  const headShell = (s) => assemble([
    // braincase: an egg on its side, tipped back
    [(() => { const g = new THREE.SphereGeometry(0.062 * s, 10, 8); g.scale(0.86, 1.02, 1.34); return g; })(),
      [0, 0.100 * s, -0.020 * s]],
    // the crest's root: a low ridge the two horns rise out of
    [plateGeo(0.040 * s, 0.040 * s, 0.070 * s, 0.008 * s, 1), [0, 0.146 * s, -0.052 * s], [-0.50, 0, 0]],
    // brow shelf over the lenses
    [plateGeo(0.104 * s, 0.030 * s, 0.062 * s, 0.008 * s, 1), [0, 0.128 * s, 0.030 * s], [0.24, 0, 0]],
    // snout and the jaw under it
    [limbGeo(0.098 * s, 0.040 * s, 0.026 * s, 8, true, { rings: 3, bulge: 0.05, bulgeAt: 0.2, capN: 2 }),
      [0, 0.086 * s, 0.024 * s], [1.42, 0, 0]],
    [plateGeo(0.052 * s, 0.060 * s, 0.048 * s, 0.010 * s, 1), [0, 0.052 * s, 0.048 * s], [0.34, 0, 0]],
    // the neck's own collar ring
    [bandGeo(0.026 * s, 0.038 * s, 0.028 * s, 0.042 * s, 0.030 * s, 10), [0, -0.008 * s, 0]],
  ], 'head');

  dressHumanoid(rig, {
    scale: S,
    body: chitin, arm: chitin, leg: chitin, hand: dark, boot: dark, head: chitin,
    /* No deltoid. An insect's shoulder is a socket in a plate, not a muscle,
     * and the swell would put a bicep on a body that has none. */
    deltoid: false,
    sections: false,
    /**
     * THE PROPORTIONS, AND THE ONE THAT DOES THE WORK IS `chestR`.
     *
     * 0.098 against the clone's 0.155 and the B2's 0.19. Everything else
     * follows from it — a body this narrow needs thin arms and a small head or
     * it reads as a child rather than as an insect.
     */
    parts: {
      chestR: 0.098, shoulderR: 0.082, hipR: 0.086, waistR: 0.070,
      armR: 0.030, clavR: 0.040, thighR: 0.048, neckR: 0.034,
      torsoDepth: 0.82, shoulderDome: 0.30, headR: 0.070,
    },
    seg: { torso: 10, arm: 8, leg: 8, clav: 6, neck: 8 },
    limbOpts: {
      arm: { rings: 3, bulge: 0.05, bulgeAt: 0.28, capN: 2 },
      fore: { rings: 3, bulge: 0.06, bulgeAt: 0.20, capN: 2 },
      thigh: { rings: 3, bulge: 0.07, bulgeAt: 0.26, capN: 2 },
      shin: { rings: 3, bulge: 0.04, bulgeAt: 0.14, capN: 2 },
    },
    headGeo: headShell,
    handGeo: (side, s) => droidHandGeo(side, s, { curl: 0.72 }),
    feet: { w: 0.060, len: 0.150, h: 0.052 },

    buildHead(headObj, s, hg) {
      const k = new Kit();
      /* The two lenses, seated on the shell the shell decides. `onSurface`
       * with the braincase's own centre means they sit ON the skull at
       * whatever angle the skull happens to have, rather than at two
       * coordinates that were right for the sphere before it was scaled. */
      const core = new THREE.Vector3(0, 0.100 * s, -0.020 * s);
      const d = new THREE.Vector3();
      k.pair((sx) => {
        d.set(sx * 0.62, 0.34, 0.71).normalize();
        k.aim(lens, (() => { const g = new THREE.SphereGeometry(0.026 * s, 8, 6); g.scale(1, 0.72, 1); return g; })(),
          onSurface(hg, d, -0.004 * s, core), d);
        // the mandible: a curved tooth hung off the jaw, pointing in
        k.add(tooth, clawGeo(0.058 * s, 0.011 * s, 0.003 * s, sx * 0.9, 5, 4),
          [sx * 0.030 * s, 0.048 * s, 0.062 * s], [0.6, 0, sx * -0.5]);
      });
      /* THE HORNS. A Geonosian's skull carries TWO long horns, not a fin:
       * they leave the crown either side of the midline, sweep back and up
       * and curve inward at the tips, and from the flank they are as long as
       * the head is. The single crest plate that stood here was neither. */
      k.pair((sx) => k.add(dark, clawGeo(0.235 * s, 0.013 * s, 0.003 * s, -0.50, 6, 6),
        [sx * 0.026 * s, 0.150 * s, -0.056 * s], [-0.78, 0, -sx * 0.26]));
      /* THE CREST SURVIVES THE CULL AND THE LENSES DO NOT, which is a draw-call
       * decision and not a taste one. `_applyLod` keeps one primary per bone
       * plus anything tagged `silhouette`, and `characters.mjs` caps a humanoid
       * at 32 kept meshes because twenty of them can be on screen at once — a
       * swarm unit is exactly the wrong body to spend that on. Marking
       * everything here measured 34. The crest is the outline; a 2.6 cm lens
       * and a mandible are not. */
      for (const m of k.bake(headObj)) { if (m.material === dark) markSilhouette(m); }
    },

    dress(r, s) {
      /* ── the thorax: a hard dorsal shell with the wing roots in it ── */
      const chest = r.get('chest');
      if (chest) {
        const k = new Kit();
        // dorsal carapace, three overlapping plates down the back
        k.row(3, (i, t) => k.add(dark,
          plateGeo((0.118 - i * 0.016) * s, 0.070 * s, 0.052 * s, 0.010 * s, 1),
          [0, (0.030 + t * 0.150) * s, -0.052 * s], [0.16, 0, 0]));
        // a thin sternum keel
        k.add(chitin, plateGeo(0.070 * s, 0.190 * s, 0.036 * s, 0.010 * s, 1), [0, 0.088 * s, 0.048 * s]);
        // the two wing sockets, where the spars actually leave the body
        k.pair((sx) => k.add(dark, new THREE.CylinderGeometry(0.024 * s, 0.030 * s, 0.026 * s, 8),
          [sx * 0.050 * s, 0.148 * s, -0.058 * s], [1.2, 0, sx * 0.4]));
        /* The carapace and the wing sockets are shape; the sternum keel is a
         * panel line on the front. Same argument as the head above. */
        for (const m of k.bake(chest.obj)) { if (m.material === dark) markSilhouette(m); }
      }

      /* ── the abdomen ── */
      const hips = r.get('hips');
      if (hips) {
        const k = new Kit();
        k.row(3, (i, t) => k.add(chitin,
          plateGeo((0.096 - i * 0.010) * s, 0.052 * s, (0.086 - i * 0.008) * s, 0.014 * s, 1),
          [0, (0.010 - t * 0.090) * s, -0.026 * s], [-0.20, 0, 0]));
        k.bake(hips.obj);
      }

      /**
       * ── THE WINGS ──────────────────────────────────────────────────
       *
       * Four bones, dressed by hand rather than by `dressHumanoid` — that
       * function knows the humanoid's fifteen bone names and nothing else, and
       * a wing is not one of them.
       *
       * `primary`, `radius` and `parts` are set the way `addLimb` sets them,
       * because they are not decoration: `Enemy.capsules` builds the blade's
       * contact set off `bone.parts` and `bone.radius`, so a wing with meshes
       * and no radius is a wing the blade passes through.
       */
      for (const side of ['L', 'R']) {
        const sx = side === 'L' ? 1 : -1;
        for (const [name, w0, w1, len] of [
          ['wing' + side, 0.20, 0.26, 0.40],
          ['wingTip' + side, 0.26, 0.13, 0.34],
        ]) {
          const b = r.get(name);
          if (!b) continue;
          const k = new Kit();
          /* The membrane: one panel along the bone, widening away from the
           * body on the inner pair and tapering to a point on the outer. Two
           * millimetres thick at 1:1 — it is a film with veins in it. */
          /* A LEAF, not a board: a wing membrane is an ellipse drawn out along
           * the spar, widest a third of the way out and tapering to the tip,
           * and it is pale and thin — the plates show light through it. A
           * flattened sphere in the tooth's bone colour, so no new material. */
          k.add(tooth, new THREE.SphereGeometry(1, 8, 6),
            [sx * (w1 - w0) * 0.30 * s, b.length * 0.5, 0], null, [w1 * 0.5 * s, b.length * 0.52, 0.003 * s]);
          // the leading spar, which is the edge the eye actually follows
          k.add(dark, limbGeo(b.length, 0.011 * s, 0.007 * s, 5, true, { rings: 2, capN: 1 }),
            [sx * w0 * 0.42 * s, 0, 0.004 * s]);
          // two veins across the film
          k.row(2, (i, t) => k.add(dark,
            plateGeo(w1 * 0.92 * s, 0.005 * s, 0.005 * s, 0.002 * s, 1),
            [sx * (w1 - w0) * 0.30 * s, (0.26 + t * 0.46) * b.length, 0.001 * s], [0, 0, sx * 0.22]));
          const made = k.bake(b.obj);
          for (const m of made) { b.parts.push(m); markSilhouette(m); }
          b.primary = made[0] || null;
          b.radius = Math.max(b.radius, w1 * 0.5 * s);
        }
      }
    },
  });

  /* The trunk's forward lean, applied to the REST POSE rather than to the
   * group: `rig.pose` is what the animator blends toward, so leaning the group
   * would lean the feet and the aim with it. */
  for (const n of ['spine', 'chest']) {
    const b = rig.get(n);
    if (!b) continue;
    b.restQuat.multiply(_geoLean);
    b.obj.quaternion.copy(b.restQuat);
    rig.pose[n].copy(b.restQuat);
  }

  return {
    rig, group: rig.root, scale: S,
    palette: { chitin, dark, membrane, lens, tooth },
    /** Which bones hold this body up in the air. Read by src/game/Flight.js. */
    wings: ['wingL', 'wingTipL', 'wingR', 'wingTipR'],
  };
}
const _geoLean = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.13, 0, 0));

/**
 * A STOOP, BUILT INTO THE REST POSE. `stoop` pitches the trunk forward
 * (split spine/chest) and `head` pitches the neck on top of it — negative
 * lifts the gaze back up. In the REST quaternions rather than applied every
 * frame, for the reason the Geonosian's lean is: the gait writes every trunk
 * bone as rest × its own lean, so a rest-pose stoop survives a walk, and the
 * cohort's frozen rung — which is captured off the rest — wears the same
 * hunch as the live body it stands in for.
 */
function leanTrunk(rig, stoop = 0, head = 0) {
  if (!stoop && !head) return;
  for (const [n, a] of [['spine', stoop * 0.45], ['chest', stoop * 0.55], ['neck', head]]) {
    const b = rig.get(n);
    if (!b || !a) continue;
    _leanQ.setFromAxisAngle(_leanX, a);
    b.restQuat.multiply(_leanQ);
    b.obj.quaternion.copy(b.restQuat);
    rig.pose[n]?.copy(b.restQuat);
  }
}
const _leanQ = new THREE.Quaternion();
const _leanX = new THREE.Vector3(1, 0, 0);

export function buildBodyguard(opts = {}) {
  /** See BODYGUARD_KITS — `banner` may also be passed directly. */
  const K = { ...(BODYGUARD_KITS[opts.kit] || BODYGUARD_KITS.chassis), ...opts };
  const S = opts.scale ?? 1.3;
  // an IG-100 stands nearly straight — a spindle, not a hunch
  const built = buildB2({ scale: S, color: opts.color ?? 0x4a4d52, frame: K.frame ?? 1, stoop: K.stoop ?? 0.10, head: K.head ?? -0.04 });
  const rig = built.rig;
  const dark = metalMat(0x24262a, 0.44, 0.92, 2.6);
  const trim = armorMat(0x8d3a20, 0.12, 0.52, 3.0);      // the one warm accent
  const slot = emissiveMat(0xffc24a, 3.4);

  const head = rig.get('head');
  if (head) {
    const k = new Kit();
    /* The cowl: a four-sided taper from the jaw to a point 34 cm up. Built as
     * plates rather than a cone because a cone under a two-tone cel ramp has
     * one continuous terminator running round it and reads as a lampshade; a
     * faceted mass has a lit face and a shadow face with a hard edge between,
     * which is rule 1 of the art direction. */
    k.add(dark, plateGeo(0.150 * S, 0.130 * S, 0.165 * S, 0.018 * S, 2), [0, 0.086 * S, 0.004 * S]);
    k.add(dark, plateGeo(0.108 * S, 0.120 * S, 0.126 * S, 0.014 * S, 1), [0, 0.180 * S, -0.006 * S]);
    k.add(dark, plateGeo(0.062 * S, 0.110 * S, 0.076 * S, 0.010 * S, 1), [0, 0.262 * S, -0.014 * S]);
    // the two horns, raked back — the read from behind and from above
    k.pair((sx) => {
      k.add(dark, plateGeo(0.026 * S, 0.190 * S, 0.034 * S, 0.008 * S, 1),
        [sx * 0.052 * S, 0.268 * S, -0.052 * S], [-0.52, 0, sx * 0.20]);
      k.add(trim, plateGeo(0.020 * S, 0.052 * S, 0.026 * S, 0.006 * S, 1),
        [sx * 0.068 * S, 0.348 * S, -0.098 * S], [-0.52, 0, sx * 0.20]);
    });
    // one vertical lit slot, standing proud of the mask
    k.add(slot, plateGeo(0.018 * S, 0.098 * S, 0.010 * S, 0.003 * S, 1), [0, 0.150 * S, 0.084 * S]);
    k.add(dark, plateGeo(0.048 * S, 0.126 * S, 0.008 * S, 0.003 * S, 1), [0, 0.150 * S, 0.079 * S]);
    /* The cowl and the horns are the whole read on this head — the lit slot is
     * a 3 cm emissive strip and stays detail. Keeping the `dark` bucket alone
     * is one extra draw call for the piece the body is named after. */
    for (const m of k.bake(head.obj)) { if (m.material === dark) markSilhouette(m); }
  }

  const chest = rig.get('chest');
  if (chest) {
    const k = new Kit();
    k.pair((sx) => {
      // pauldron, raked outward and back off the deltoid
      k.add(dark, plateGeo(0.150 * S, 0.058 * S, 0.190 * S, 0.024 * S, 2),
        [sx * 0.196 * S, 0.096 * S, -0.010 * S], [0, 0, sx * -0.34]);
      k.add(trim, plateGeo(0.116 * S, 0.016 * S, 0.150 * S, 0.008 * S, 1),
        [sx * 0.206 * S, 0.126 * S, -0.010 * S], [0, 0, sx * -0.34]);
      // the mast the cape hangs from
      k.add(dark, new THREE.CylinderGeometry(0.016 * S, 0.012 * S, 0.170 * S, 6),
        [sx * 0.104 * S, 0.170 * S, -0.086 * S], [0.26, 0, sx * 0.12]);
    });
    // a gorget, so the cowl has a collar to sit in rather than a neck
    k.add(dark, plateGeo(0.190 * S, 0.052 * S, 0.170 * S, 0.020 * S, 2), [0, 0.140 * S, -0.006 * S]);
    /* THE GENERAL'S BANNER. `magna` and `bodyguard` are this same chassis at
     * 1.18 and 1.3 and nothing else, and they measured 0.658 alike — the
     * Foundry's 1050-hp set-piece and a rung-5 line unit reading as one droid
     * at two different distances, which is worse than reading as two units.
     * The masts above already exist to hang something from; this is the
     * something. A rigid tabard across them, not a simulated cape: this body
     * declines cloth on purpose (see the archetype's own note) and
     * `cloth-cost` sizes the whole column on how many bodies wear one. */
    if (K.banner) {
      k.add(dark, plateGeo(0.240 * S, 0.030 * S, 0.026 * S, 0.008 * S, 1), [0, 0.244 * S, -0.104 * S], [0.26, 0, 0]);
      k.add(trim, plateGeo(0.290 * S, 0.560 * S, 0.020 * S, 0.010 * S, 1), [0, -0.036 * S, -0.148 * S], [0.10, 0, 0]);
      k.add(dark, plateGeo(0.310 * S, 0.048 * S, 0.024 * S, 0.010 * S, 1), [0, -0.310 * S, -0.116 * S], [0.10, 0, 0]);
    }
    for (const m of k.bake(chest.obj)) { if (m.material !== slot) markSilhouette(m); }
  }

  return { ...built, palette: { ...built.palette, dark, trim, slot }, scale: S };
}

/* ── weapons ─────────────────────────────────────────────────────────── */

/**
 * WHERE A RIFLE IS HELD, in the weapon's own frame.
 *
 * Every blaster below publishes the same four points on `userData`, in metres,
 * with +Z down the bore and +Y up: `stock` (the butt, which goes into the
 * shoulder), `grip` (where the trigger hand's palm closes), `foregrip` (where
 * the support hand's palm closes) and `muzzle` (the barrel's end). `length` is
 * `muzzle.z - stock.z`, and `tools/checks/rifle-hold.mjs` measures the baked
 * geometry against both ends so neither can drift from the mesh.
 *
 * The POSE is derived from these and not from the hand: `Enemy._poseArms` puts
 * the stock at the shoulder and the bore on the aim, and then solves each arm
 * to its own point. That is the reverse of what it used to do — hand first,
 * rifle hanging off the hand — which is what the player was seeing: "clone
 * troopers don't appear to even be holding guns like they fire from their
 * wrists". A 45 cm rifle whose stock ended 5 cm behind the hand is, from
 * twenty metres, a dark stub on the end of an arm.
 */
function holdPoints(g, o) {
  g.userData.stock = new THREE.Vector3().fromArray(o.stock);
  g.userData.grip = new THREE.Vector3().fromArray(o.grip);
  g.userData.foregrip = new THREE.Vector3().fromArray(o.foregrip);
  g.userData.muzzle = new THREE.Vector3().fromArray(o.muzzle);
  g.userData.length = o.muzzle[2] - o.stock[2];
  return g;
}

/**
 * The blasters, cut to the reference lengths.
 *
 * They are held a metre from a first-person camera, so they get a receiver, a
 * magazine, a stock, sights and cooling ribs rather than the four boxes they
 * used to be — and each one bakes down to two silhouette meshes (receiver and
 * furniture) plus the muzzle glow, so an arena full of troopers does not cost
 * a hundred draw calls in guns.
 *
 * THE LENGTHS ARE THE REFERENCE'S, NOT A GUESS. The old `dc15` was 45 cm nose
 * to tail, the `e5` 34 cm. `assets/reference/units/clones/trooper holding …
 * DC-15A blaster rifle.webp` has the rifle running from the trooper's shoulder
 * to well past his outstretched support hand — a DC-15A is 1.05 m, the DC-15S
 * carbine a clone carries in close about 0.70, a B1's E-5 about 0.75 and the
 * Z-6 style repeater about 1.2. Half-length rifles are most of why a trooper
 * read as firing from his wrist: with the stock two hand-widths behind the
 * grip, nothing about the weapon reached the body it was supposed to be
 * braced against.
 *
 *   kind     length   stock z   grip z   foregrip z   muzzle z
 *   dc15     1.05     -0.30     -0.03     +0.26        +0.75      DC-15A rifle
 *   dc15s    0.70     -0.20     -0.03     +0.20        +0.50      DC-15S carbine
 *   e5       0.75     -0.22     -0.04     +0.21        +0.53      E-5 carbine
 *   sonic    0.62     -0.24     -0.065    +0.11        +0.38      sonic blaster (a horn)
 *   heavy    1.20     -0.32     -0.07     +0.36        +0.88      rotary repeater
 *
 * The barrel runs all the way to `muzzle`, and the glow is a short RING round
 * its end rather than the last four centimetres of barrel — the glow is not a
 * silhouette part and is culled at thirty metres, and a barrel that stopped
 * short of the muzzle would have lost its end at exactly the range a rifle's
 * length is read at.
 */
export function buildBlaster(kind = 'e5') {
  const g = new THREE.Group();
  const body = metalMat(0x2c2f35, 0.48, 0.72, 6.0);
  const dark = leatherMat(0x15161a, 0.72);
  // a sonic blaster's charge is the acid green of the plate; everything else
  // on the roster runs hot red
  const glow = emissiveMat(kind === 'sonic' ? 0x8cff3c : 0xff4422, 1.6);
  const k = new Kit();
  const rib = (n, x, y, z0, dz, w, h) => k.row(n, (i, t) =>
    k.add(dark, plateGeo(w, h, 0.008, 0.002, 1), [x, y, z0 + t * dz]));
  /** A barrel from z0 to z1 at height y, its glow ring on the last 3 cm. */
  const barrel = (r0, r1, y, z0, z1, seg = 8) => {
    k.add(body, new THREE.CylinderGeometry(r1, r0, z1 - z0, seg), [0, y, (z0 + z1) / 2], [1.5708, 0, 0]);
    k.add(glow, new THREE.CylinderGeometry(r1 * 1.25, r1 * 1.35, 0.03, seg), [0, y, z1 - 0.015], [1.5708, 0, 0]);
  };

  if (kind === 'e5') {
    // B1 carbine: slab receiver, wide shroud, skeleton stock. 0.75 m.
    k.add(body, plateGeo(0.040, 0.056, 0.30, 0.008, 1), [0, 0, 0.04]);
    k.add(body, plateGeo(0.030, 0.030, 0.30, 0.006, 1), [0, 0.030, 0.20]);
    k.add(body, new THREE.CylinderGeometry(0.017, 0.019, 0.14, 8), [0, 0.026, 0.28], [1.5708, 0, 0]);
    rib(4, 0, 0.026, 0.10, 0.20, 0.032, 0.032);
    barrel(0.011, 0.013, 0.026, 0.34, 0.53);
    // pistol grip, fore-end, and the two bars of the stock
    k.add(dark, plateGeo(0.026, 0.11, 0.042, 0.008, 1), [0, -0.072, -0.03], [0.22, 0, 0]);
    k.add(dark, plateGeo(0.032, 0.026, 0.16, 0.006, 1), [0, -0.038, 0.21]);
    k.add(dark, plateGeo(0.022, 0.048, 0.13, 0.006, 1), [0, -0.028, -0.155]);
    k.add(dark, plateGeo(0.030, 0.012, 0.14, 0.004, 1), [0, 0.036, -0.15]);
    k.add(dark, plateGeo(0.028, 0.076, 0.020, 0.004, 1), [0, -0.004, -0.21]);
    k.add(dark, plateGeo(0.010, 0.024, 0.014, 0.003, 1), [0, 0.052, 0.30]);
    holdPoints(g, { stock: [0, -0.02, -0.22], grip: [0, -0.065, -0.04],
      foregrip: [0, -0.048, 0.21], muzzle: [0, 0.026, 0.53] });
  } else if (kind === 'dc15') {
    // DC-15A: the long clone rifle. Heavy receiver, ribbed cooling shroud, a
    // thin barrel out to a flared muzzle, scope, solid stock. 1.05 m.
    k.add(body, plateGeo(0.048, 0.068, 0.36, 0.010, 1), [0, 0, 0.02]);
    k.add(body, new THREE.CylinderGeometry(0.018, 0.020, 0.30, 10), [0, 0.030, 0.35], [1.5708, 0, 0]);
    rib(6, 0, 0.030, 0.22, 0.26, 0.052, 0.052);
    barrel(0.009, 0.011, 0.030, 0.50, 0.75, 8);
    // the DC-15A's bulb behind the muzzle
    k.add(body, new THREE.CylinderGeometry(0.016, 0.014, 0.06, 8), [0, 0.030, 0.66], [1.5708, 0, 0]);
    k.add(dark, new THREE.CylinderGeometry(0.013, 0.013, 0.11, 8), [0, 0.064, 0.03], [1.5708, 0, 0]);
    k.add(dark, plateGeo(0.020, 0.020, 0.030, 0.004, 1), [0, 0.064, -0.03]);
    k.add(dark, plateGeo(0.034, 0.125, 0.048, 0.010, 1), [0, -0.084, -0.02], [0.24, 0, 0]);
    // the fore-end the support hand closes on, under the shroud
    k.add(dark, plateGeo(0.040, 0.030, 0.18, 0.006, 1), [0, -0.038, 0.26]);
    k.add(body, plateGeo(0.040, 0.026, 0.10, 0.006, 1), [0, -0.048, 0.08]);
    // the stock, and its butt plate at -0.30
    k.add(dark, plateGeo(0.030, 0.062, 0.14, 0.010, 1), [0, -0.020, -0.23]);
    k.add(dark, plateGeo(0.034, 0.086, 0.020, 0.004, 1), [0, -0.024, -0.29]);
    k.add(dark, plateGeo(0.010, 0.026, 0.014, 0.003, 1), [0, 0.056, 0.46]);
    holdPoints(g, { stock: [0, -0.02, -0.30], grip: [0, -0.075, -0.03],
      foregrip: [0, -0.050, 0.26], muzzle: [0, 0.030, 0.75] });
  } else if (kind === 'dc15s') {
    // DC-15S: the same family cut down to a carbine, with a folding-style
    // skeleton stock. 0.70 m. Nothing on the roster carries it yet — see
    // `patchesForOthers` in the rifle-hold report: the jet and ARC rungs in
    // Command.js are the bodies the reference puts one on.
    k.add(body, plateGeo(0.046, 0.066, 0.30, 0.010, 1), [0, 0, 0.02]);
    k.add(body, new THREE.CylinderGeometry(0.018, 0.020, 0.16, 10), [0, 0.030, 0.25], [1.5708, 0, 0]);
    rib(4, 0, 0.030, 0.19, 0.12, 0.050, 0.050);
    barrel(0.010, 0.012, 0.030, 0.33, 0.50, 8);
    k.add(dark, new THREE.CylinderGeometry(0.012, 0.012, 0.09, 8), [0, 0.062, 0.02], [1.5708, 0, 0]);
    k.add(dark, plateGeo(0.034, 0.120, 0.046, 0.010, 1), [0, -0.080, -0.02], [0.24, 0, 0]);
    k.add(dark, plateGeo(0.040, 0.030, 0.14, 0.006, 1), [0, -0.038, 0.20]);
    k.add(dark, plateGeo(0.022, 0.014, 0.12, 0.004, 1), [0, 0.020, -0.14]);
    k.add(dark, plateGeo(0.022, 0.014, 0.12, 0.004, 1), [0, -0.040, -0.14]);
    k.add(dark, plateGeo(0.030, 0.080, 0.018, 0.004, 1), [0, -0.012, -0.19]);
    k.add(dark, plateGeo(0.010, 0.024, 0.014, 0.003, 1), [0, 0.054, 0.30]);
    holdPoints(g, { stock: [0, -0.012, -0.20], grip: [0, -0.072, -0.03],
      foregrip: [0, -0.050, 0.20], muzzle: [0, 0.030, 0.50] });
  } else if (kind === 'sonic') {
    /**
     * THE GEONOSIAN SONIC BLASTER — a horn, not a barrel.
     *
     * It is a third silhouette rather than an `e5` repaint because the whole
     * point of the weapon is that it does not look like a rifle: the reference
     * is a stubby body with a wide flared emitter bell on the front and a
     * spherical sonic charge slung underneath. At the range these are met from
     * (see `preferred`) the bell is the only part of the gun the eye resolves,
     * and it is the part an E-5 does not have. 0.62 m: the reference plates
     * give it no rifle to be measured against, and it is held at the shoulder
     * like one, so it is long enough for its bell to clear the support hand.
     */
    k.add(body, plateGeo(0.052, 0.058, 0.30, 0.010, 1), [0, 0, 0.04]);
    k.add(body, new THREE.CylinderGeometry(0.020, 0.024, 0.08, 10), [0, 0.012, 0.23], [1.5708, 0, 0]);
    // the bell: two rings opening out to a 9 cm mouth
    k.add(body, new THREE.CylinderGeometry(0.030, 0.020, 0.06, 10), [0, 0.012, 0.30], [1.5708, 0, 0]);
    k.add(body, new THREE.CylinderGeometry(0.046, 0.030, 0.06, 12), [0, 0.012, 0.35], [1.5708, 0, 0]);
    // the charge sphere under the receiver, and the yoke holding it
    k.add(dark, new THREE.SphereGeometry(0.030, 8, 6), [0, -0.048, 0.00]);
    k.add(dark, plateGeo(0.018, 0.040, 0.020, 0.005, 1), [0, -0.022, 0.00]);
    // pistol grip, a fore-end ahead of the charge, and a shoulder brace
    k.add(dark, plateGeo(0.024, 0.090, 0.038, 0.008, 1), [0, -0.070, -0.06], [0.26, 0, 0]);
    k.add(dark, plateGeo(0.030, 0.022, 0.08, 0.005, 1), [0, -0.036, 0.11]);
    k.add(dark, plateGeo(0.026, 0.044, 0.13, 0.008, 1), [0, -0.010, -0.175]);
    k.add(dark, plateGeo(0.030, 0.060, 0.016, 0.004, 1), [0, -0.012, -0.232]);
    k.add(glow, new THREE.CylinderGeometry(0.034, 0.040, 0.02, 12), [0, 0.012, 0.37], [1.5708, 0, 0]);
    holdPoints(g, { stock: [0, -0.01, -0.24], grip: [0, -0.060, -0.065],
      foregrip: [0, -0.046, 0.11], muzzle: [0, 0.012, 0.38] });
  } else {
    // heavy repeater: three barrels in a shroud, drum magazine, carry handle,
    // a vertical foregrip. 1.2 m.
    k.add(body, plateGeo(0.070, 0.088, 0.44, 0.014, 1), [0, 0, 0.06]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      k.add(body, new THREE.CylinderGeometry(0.014, 0.016, 0.60, 8),
        [Math.sin(a) * 0.026, 0.03 + Math.cos(a) * 0.026, 0.58], [1.5708, 0, 0]);
    }
    k.add(glow, new THREE.CylinderGeometry(0.052, 0.056, 0.03, 10), [0, 0.030, 0.865], [1.5708, 0, 0]);
    k.row(5, (i, t) => k.add(dark, new THREE.CylinderGeometry(0.050, 0.050, 0.014, 8),
      [0, 0.030, (0.30 + t * 0.48)], [1.5708, 0, 0]));
    k.add(dark, new THREE.CylinderGeometry(0.058, 0.058, 0.052, 10), [0, -0.058, 0.02], [0, 0, 1.5708]);
    k.add(dark, plateGeo(0.040, 0.140, 0.060, 0.012, 1), [0, -0.100, -0.06], [0.20, 0, 0]);
    k.add(dark, plateGeo(0.030, 0.100, 0.036, 0.008, 1), [0, -0.080, 0.36], [0.12, 0, 0]);
    k.add(dark, plateGeo(0.026, 0.034, 0.20, 0.008, 1), [0, 0.086, 0.06]);
    k.add(dark, plateGeo(0.034, 0.070, 0.16, 0.010, 1), [0, -0.020, -0.24]);
    k.add(dark, plateGeo(0.038, 0.092, 0.020, 0.004, 1), [0, -0.022, -0.31]);
    holdPoints(g, { stock: [0, -0.02, -0.32], grip: [0, -0.088, -0.07],
      foregrip: [0, -0.105, 0.36], muzzle: [0, 0.030, 0.88] });
  }
  g.userData.kind = kind;
  /* A WEAPON IS PART OF A SOLDIER'S OUTLINE, and this one was culled.
   *
   * `Enemy._build` hangs the blaster off the hand, and `_build` runs BEFORE
   * the constructor collects `_lodParts` — so every gun in the game was
   * classed as decoration and stopped being drawn at thirty metres. Measured:
   * a Training Droid and a B1 Battle Droid, the same chassis with one of them
   * armed, shared 0.783 of one silhouette, and the whole difference between
   * them is the carbine that was not on screen.
   *
   * The muzzle glow is NOT kept — a 40-triangle emissive cylinder is not an
   * outline — so this is the receiver and the furniture, two merged meshes,
   * on bodies already carrying nineteen. */
  for (const m of k.bake(g)) { if (m.material !== glow) markSilhouette([m]); }
  g.traverse(o => { o.castShadow = true; });
  return g;
}

/** The blaster kinds `buildBlaster` builds, and the reference length of each. */
export const BLASTER_LENGTH = { dc15: 1.05, dc15s: 0.70, e5: 0.75, heavy: 1.20, sonic: 0.62 };


/* ── who wears what ──────────────────────────────────────────────────── */

/**
 * THE ARCHETYPE → KIT TABLE, AND THE ONE LINE THAT IS STILL MISSING.
 *
 * Every knob above exists because a specific archetype needed it, and this is
 * the single place that says which archetype needs which — so a kit cannot be
 * declared twice, and a new humanoid on the roster that nobody outfitted is a
 * check failure rather than a body that quietly looks like another one.
 * `tools/checks/characters.mjs` walks `Enemy.ARCHETYPES` and asserts that
 * every humanoid on it has a row here.
 *
 * WHAT IT IS NOT: a second copy of the roster. It carries no stats, no colour
 * and no scale — those live in the archetype and are passed by the caller. It
 * carries only what a body WEARS, which nothing else in the codebase declares.
 *
 * ── HOW IT REACHES THE BUILDERS, WHICH IS NOT YET. ─────────────────────
 *
 * `Enemy._build` builds every body with `const opts = { scale: A.scale }` and
 * a one-line special case for the marksman's paint, so the archetype's own
 * identity never reaches Bodies.js at all. The whole wiring is:
 *
 *     const opts = { scale: A.scale, ...(bodyOptsFor(this.type) || {}) };
 *
 * in place of `const opts = { scale: A.scale };` (src/game/Enemy.js, in
 * `_build`), plus `bodyOptsFor` on the import from this file. Command.js's
 * units need nothing at all — every one of them is `(o) => buildX({ ...o, … })`
 * and spreads whatever it is handed.
 *
 * Until that line lands, the kits below are reachable (and measured) but no
 * spawned body wears one. Measured either way in `tools/_roster.mjs`, which
 * takes `--wired` to apply this table and prints the gap.
 */
/* ══════════════════════════════════════════════════════════════════════ */
/*  The companion droids, and the wookiee                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A DROID'S DOME, SHARED BY THE TWO BODIES THAT HAVE ONE.
 *
 * COMPANIONS.md gives the astromech and the 2-1B the same head branch and the
 * reason is not thrift — it is that the two machines are the same idea. A
 * dome is what you build when the sensor cluster has to see in every direction
 * and there is no face to put on it, and both of these are that: an astromech
 * has no front, and a medical droid's head is a smooth instrument housing with
 * a single band of receptor across it.
 *
 * It returns the SHELL ONLY, as one geometry, for the one reason that decides
 * the shape of this pair of functions: `dressHumanoid` takes `headGeo` as a
 * geometry and gives it one material, so anything that is a different colour —
 * the photoreceptor, the dark panels, the holoprojector — cannot live in here.
 * `domeKit` is the other half and takes the materials; the astromech calls
 * both by hand and the 2-1B hands one to `headGeo` and one to `buildHead`.
 *
 *   r        dome radius, ×s
 *   squash   how much flatter than a hemisphere. 1 is a half sphere (the
 *            astromech); 0.86 is the 2-1B's, whose head is a lower, wider
 *            instrument cap than an R-unit's.
 *   collar   height of the base ring the dome turns on. 0 for a head that is
 *            not meant to look like it turns.
 */
function domeHeadGeo(s, o = {}) {
  const r = (o.r ?? 0.30) * s, squash = o.squash ?? 1, collar = (o.collar ?? 0.028) * s;
  const parts = [];
  const dome = new THREE.SphereGeometry(r, 16, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, squash, 1);
  parts.push([dome, [0, 0, 0]]);
  /* THE RING IS WHAT MAKES IT A DOME RATHER THAN A LID. A hemisphere sitting
   * on a cylinder of the same radius is one continuous surface with a
   * horizontal terminator across it and reads as a bullet; a proud ring at the
   * join is a hard edge under the cel ramp and says the top half turns. */
  if (collar > 0) parts.push([bandGeo(r * 0.94, r * 1.03, r * 0.90, r * 1.01, collar, 20), [0, -collar * 0.4, 0]]);
  return assemble(parts, 'dome');
}

/**
 * The dome's furniture: the eye, the panels, and the crown stub.
 *
 * Everything here is seated with `onSurface` against the dome's own geometry
 * rather than at typed coordinates, which is the rule `characters.mjs` holds
 * every head to ("nothing on a head stands off it like a bolted-on slab") and
 * is the only way a piece stays seated when `squash` changes the shell under
 * it. `M` carries the four materials the companion look table names.
 */
function domeKit(k, hg, s, M, o = {}) {
  const core = new THREE.Vector3(0, 0, 0);
  const d = new THREE.Vector3();
  /* THE PHOTORECEPTOR. One housing, one lens, and the lens is the only lit
   * thing on the body — which is what a player's eye goes to, so it is the one
   * piece that says which way this machine is facing. */
  /* `sink` IS INWARD — `onSurface` returns `p − dir·sink`, so a POSITIVE sink
   * buries the part in the shell it is seated on. The first build passed
   * `+er*0.05` for the lens and the whole photoreceptor was inside the dome:
   * rendered from dead ahead the droid had no eye at all, which on a body
   * whose only asymmetry IS its eye means it has no front. Both of these are
   * negative, and the lens stands further out than its own housing. */
  const er = (o.r ?? 0.30) * s;
  d.set(0, o.eyeUp ?? 0.42, 1).normalize();
  k.aim(M.panels, new THREE.CylinderGeometry(er * 0.23, er * 0.29, er * 0.17, 12),
    onSurface(hg, d, -er * 0.10, core), d);
  k.aim(M.photo, new THREE.CylinderGeometry(er * 0.17, er * 0.17, er * 0.09, 12),
    onSurface(hg, d, -er * 0.19, core), d);
  // the smaller secondary lenses either side of it, unlit
  k.pair((sx) => {
    d.set(sx * 0.46, 0.30, 0.84).normalize();
    k.aim(M.panels, new THREE.CylinderGeometry(er * 0.07, er * 0.08, er * 0.05, 8),
      onSurface(hg, d, 0, core), d);
  });
  /* THE PANELS. Radial, seated on the shell, and DELIBERATELY NOT SYMMETRIC
   * about the front — a dome with four panels at the compass points reads as a
   * machine part, and every reference astromech has its panels clocked off the
   * eye. 0.55 rad of offset is what does that. */
  if (o.panels !== false) {
    k.row(o.panelCount ?? 5, (i, t) => {
      const th = t * Math.PI * 1.7 + 0.55;
      d.set(Math.sin(th) * 0.86, 0.51, Math.cos(th) * 0.86).normalize();
      k.face(M.trim, plateGeo(er * 0.30, er * 0.46, er * 0.04, er * 0.02, 1),
        onSurface(hg, d, -er * 0.01, core), d);
    });
  }
  /* The holoprojector: a stub cylinder standing off the crown, which is the
   * one thing on the top of a dome that breaks its outline. */
  if (o.holo !== false) {
    d.set(0.30, 0.94, 0.16).normalize();
    k.aim(M.shell, new THREE.CylinderGeometry(er * 0.05, er * 0.07, er * 0.14, 8),
      onSurface(hg, d, -er * 0.06, core), d);
  }
  return k;
}

/**
 * ══ THE ASTROMECH ═══════════════════════════════════════════════════════
 *
 * "an R2/Astromech unit", and it is the most expensive body in the companion
 * set to write for a reason COMPANIONS.md states in the open: THERE IS NO
 * `DROID_PLANS`. Every droid in this file is a bespoke builder, and the one
 * astromech the game already had — `DeckCast.astromechChassis`, near the top of
 * src/game/DeckCast.js — is a vertex-coloured `InstancedMesh` with no `Rig`,
 * no bones and no capsules. It cannot be cut, shot, gripped or carried off the
 * deck, because it is scenery and was built to be.
 *
 * So this is a RIGGED one, and what it takes from that file is the RECIPE and
 * not the mesh: the can, the dome on it, two shoulder hubs, two legs with
 * wedge feet on rollers, the third leg down, the panel rows and the tool bays
 * are all shapes that file already worked out, re-authored here at the
 * proportions of a real R-unit — 1.05 m to the top of the dome on a 0.60 m
 * can — with the cel-shaded materials the rest of the roster wears rather than
 * with deck vertex colours.
 *
 * ── THE COMPENSATION: IT PUBLISHES A STANCE WITH NO LIMBS IN IT ──────────
 *
 * `_poseWalker` walks `ST.limbs` and runs a two-bone IK per entry. This
 * publishes an empty one, so that loop runs ZERO iterations and the body's
 * whole per-frame pose cost is placing the hips and turning the dome. It is
 * the cheapest rigged body in the game per frame, and that is not an
 * optimisation looking for a justification: AN ASTROMECH'S LEGS DO NOT WALK.
 * They are rigid struts on rollers and the machine gets about by rolling on
 * them, which is exactly the body a gait solver has nothing to say about.
 * (`stanceOf`'s `tuck` is the same empty-stance mechanism reached for a
 * different reason — a hawk that is never on the floor.)
 *
 * The legs are still BONES: three leg roots, so `severance` divides the leg
 * budget by three and one strut is 0.367 of the droid, and they still carry
 * meshes, so the blade still meets them. What they do not have is a walk.
 *
 * ── AND THE DOME BONE IS NAMED `head` ───────────────────────────────────
 *
 * Its ROLE is `dome` — priced apart, for the reasons argued over `BONE_ROLES`
 * and in `SEVERANCE` — but its NAME is `head`, because `_poseWalker`'s target
 * track is keyed on the name and turning the dome toward whatever the droid is
 * looking at is the single most legible thing this body can do. It is also
 * free: the track is one quaternion on a bone that is already there.
 */
export function buildAstromech(opts = {}) {
  const S = opts.scale ?? 1;
  const shell = metalMat(opts.shell ?? 0xd7d3c8, 0.42, 0.62, 2.2);
  const trim = armorMat(opts.trim ?? 0x2f5fa8, 0.10, 0.46, 2.6);
  const panels = metalMat(opts.panels ?? 0x30343a, 0.44, 0.90, 2.8);
  const photo = emissiveMat(opts.photoreceptor ?? 0xff5a3c, 3.0);
  const M = { shell, trim, panels, photo };

  /* THE SKELETON. Nine bones, and every one of them is a thing a blade can
   * take: the can, the dome, the whip, three struts and three feet. Free
   * names, because Ragdoll's joint table falls back on a name it does not know
   * and nothing downstream reads `femur{i}` on a body whose stance has no
   * limbs — see `_stance`, which prefers `built.stance` and only synthesises
   * one from `femur{i}` when a builder has published none. */
  /**
   * THE THREE HEIGHTS, AND `HIP` IS THE ONE THAT WAS WRONG.
   *
   * At `HIP` 0.10 the can's own bottom sat 10 cm off the ground and the legs
   * ran down INSIDE that 10 cm — so the rendered droid was a drum with a
   * clump of white boxes under it and no visible leg at all. An R-unit's legs
   * are a third of its height and they are the read from the side: a can, two
   * struts down its flanks, and the feet standing clear of it.
   *
   * 0.26 + 0.52 + 0.27 = 1.05 m to the crown of the dome, which is a real
   * R-unit to the centimetre, with the whip on top of that.
   */
  const CAN = 0.52, DOME = 0.27, HIP = 0.26;
  const bones = [
    { name: 'hips', parent: null, offset: [0, 0, 0], length: HIP * S, rest: [0, 1, 0], role: 'core' },
    { name: 'body', parent: 'hips', offset: [0, HIP * S, 0], length: CAN * S, rest: [0, 1, 0], role: 'core' },
    { name: 'head', parent: 'body', offset: [0, CAN * S, 0], length: DOME * S, rest: [0, 1, 0], role: 'dome' },
    /* THE WHIP. Off the dome, so it turns with it and comes off with it — and
     * so a cut that takes the dome does not leave an antenna hanging in the
     * air, which `Actor.cut` gets right for free by reparenting the subtree. */
    { name: 'antenna', parent: 'head', offset: [0.10 * S, 0.22 * S, -0.07 * S], length: 0.26 * S,
      rest: [0.10, 0.99, -0.06], role: 'antenna' },
    { name: 'legC', parent: 'body', offset: [0, 0.16 * S, 0.19 * S], length: 0.30 * S,
      rest: [0, -0.95, 0.30], role: 'leg' },
    /* Nearly upright, like the outer two: at [0, −0.52, 0.85] the third
     * shoe lay at 60 degrees and rendered as a foot kicked out in front. */
    { name: 'footC', parent: 'legC', offset: [0, 0.30 * S, 0], length: 0.14 * S, rest: [0, -0.90, 0.44], role: 'leg' },
  ];
  for (const side of [1, -1]) {
    const LR = side > 0 ? 'L' : 'R';
    bones.push({ name: `leg${LR}`, parent: 'body', offset: [side * 0.33 * S, 0.40 * S, 0],
      length: 0.44 * S, rest: [side * 0.03, -1, 0], role: 'leg' });
    bones.push({ name: `foot${LR}`, parent: `leg${LR}`, offset: [0, 0.44 * S, 0],
      /* STRAIGHT DOWN, not raked forward: at 0.44 of Z the foot hung off
       * the ankle at 26 degrees and the pair rendered as two skis pointing
       * into the ground. An astromech's foot is a shoe, and a shoe is level. */
      length: 0.20 * S, rest: [0, -0.99, 0.14], role: 'leg' });
  }
  const rig = new Rig(bones, { scale: S });

  /* ── the can ──
   * ONE LATHE with shallow caps, not a `CylinderGeometry`. A drum's flat lid
   * meets its wall at a right angle, and under a two-tone ramp that edge is a
   * black line running round the top of the body; `capY0`/`capY1` at 0.10 put
   * a few millimetres of radius on it, which is what a rolled steel edge is. */
  const body = rig.get('body');
  const R = 0.28 * S;
  const can = limbGeo(CAN * S, R, R * 0.97, 16, true, { rings: 3, capN: 2, capY0: 0.10, capY1: 0.08 });
  const bm = mesh(can, shell, body.obj);
  body.primary = bm; body.parts.push(bm); body.radius = R;
  {
    const k = new Kit();
    /* SIX RECESSED PANELS AND A LOUVRE UNDER EACH — DeckCast's own row count
     * and its own two heights, because that is the read: an astromech's body
     * is a ring of coloured panels at chest height over a band of dark louvres,
     * and six is what makes it a ring rather than a face. `face()` and not
     * `add()`, so a panel authored (width, height, thickness) is not laid down
     * 4 cm thick and standing out of the can — the defect `characters.mjs`
     * names on every head in the game. */
    /* `i / 6` AND NOT `t`. `Kit.row` hands out `t = i/(n-1)`, which over six
     * panels walks 0 → 1 in fifths — 1.2 turns of the can, with two panels
     * landing on top of each other and a bare quadrant opposite them. A ring
     * is indexed, not interpolated. */
    k.row(6, (i) => {
      const th = (i / 6) * Math.PI * 2 - Math.PI / 6;
      const d = [Math.sin(th), 0, Math.cos(th)];
      k.face(trim, plateGeo(0.13 * S, 0.16 * S, 0.014 * S, 0.006 * S, 1),
        [d[0] * R * 0.99, 0.34 * S, d[2] * R * 0.99], d);
      k.face(panels, plateGeo(0.10 * S, 0.030 * S, 0.012 * S, 0.004 * S, 1),
        [d[0] * R * 0.99, 0.13 * S, d[2] * R * 0.99], d);
    });
    // the front tool bays and the power bus socket — the only asymmetry on the can
    k.face(panels, plateGeo(0.19 * S, 0.10 * S, 0.016 * S, 0.006 * S, 1), [0, 0.43 * S, R * 0.99], [0, 0, 1]);
    k.face(trim, plateGeo(0.062 * S, 0.038 * S, 0.014 * S, 0.004 * S, 1), [0, 0.08 * S, R * 0.99], [0, 0, 1]);
    /* THE TOP AND BOTTOM RINGS. The one at the top is the bearing the dome
     * turns on, and it is the piece that stops the dome reading as a lid
     * balanced on a tube; the one at the foot is the skirt. */
    k.add(panels, bandGeo(R * 0.93, R * 1.02, R * 0.93, R * 1.02, 0.030 * S, 22), [0, CAN * S - 0.020 * S, 0]);
    k.add(panels, bandGeo(R * 0.90, R * 1.01, R * 0.94, R * 1.01, 0.036 * S, 22), [0, 0.018 * S, 0]);
    k.bake(body.obj);
  }

  /* ── the dome ── */
  const head = rig.get('head');
  {
    const hg = domeHeadGeo(S, { r: 0.28, squash: 0.96, collar: 0.030 });
    const hm = mesh(hg, shell, head.obj);
    head.primary = hm; head.parts.push(hm); head.radius = 0.28 * S;
    const k = new Kit();
    domeKit(k, hg, S, M, { r: 0.28, panelCount: 5 });
    /* The eye and the panels are what this body is READ by at range — a can
     * with a smooth dome on it is a bin — so unlike a trooper's rivets these
     * are kept past thirty metres. Three extra meshes on a body carrying nine. */
    markSilhouette(k.bake(head.obj));
  }

  /* ── the whip antenna ──
   * A tapered tube and a ball at its root. It is 8 mm thick, which is under
   * every LOD threshold in the game and is exactly why it is marked
   * silhouette: a 26 cm line off the top of a dome is a SHAPE, and an
   * astromech without it is a dustbin. */
  const ant = rig.get('antenna');
  if (ant) {
    const k = new Kit();
    k.add(panels, limbGeo(ant.length, 0.008 * S, 0.003 * S, 5, true, { rings: 2, capN: 1 }), [0, 0, 0]);
    k.add(panels, new THREE.SphereGeometry(0.014 * S, 6, 5), [0, 0, 0]);
    const made = k.bake(ant.obj);
    for (const m of made) { ant.parts.push(m); markSilhouette(m); }
    ant.primary = made[0] || null;
    ant.radius = 0.012 * S;
  }

  /* ── the legs ──
   * A strut is a flat BLADE of metal, not a tube: an astromech's leg is a
   * shoulder hub, a tapering plate and an ankle block, and the plate is what
   * makes the machine read as three straight lines from the side rather than
   * as a stool. */
  for (const [name, w, hub] of [['legL', 1, true], ['legR', 1, true], ['legC', 0.72, false]]) {
    const b = rig.get(name);
    if (!b) continue;
    const k = new Kit();
    const L = b.length;
    if (hub) {
      // the shoulder: a drum on its side, the one round shape on the leg
      k.add(shell, new THREE.CylinderGeometry(0.115 * S, 0.115 * S, 0.085 * S, 12), [0, 0.02 * S, 0], [0, 0, Math.PI / 2]);
      k.add(trim, new THREE.CylinderGeometry(0.052 * S, 0.052 * S, 0.098 * S, 10), [0, 0.02 * S, 0], [0, 0, Math.PI / 2]);
    }
    k.add(shell, plateGeo(0.105 * S * w, L * 0.92, 0.155 * S * w, 0.016 * S, 2), [0, L * 0.48, -0.012 * S]);
    /* THE KNEE BREAK IS DARK, and it is the one thing that makes the leg read
     * as a leg from the side: strut, can and foot are all the same shell
     * white, so without a dark band across it the whole flank is one pale mass
     * with a wheel under it. (The ankle is the foot bone's own — see it.) */
    k.add(panels, plateGeo(0.122 * S * w, 0.070 * S, 0.138 * S * w, 0.012 * S, 1), [0, L * 0.86, -0.006 * S]);
    // …and a trim stripe down the outer face, which is the R-unit's own livery
    k.add(trim, plateGeo(0.030 * S * w, L * 0.62, 0.020 * S, 0.006 * S, 1), [0, L * 0.46, -0.082 * S * w]);
    // the shock strut down the front of the leg
    k.add(panels, new THREE.CylinderGeometry(0.016 * S, 0.016 * S, L * 0.55, 7), [0, L * 0.55, 0.070 * S * w]);
    const made = k.bake(b.obj);
    for (const m of made) b.parts.push(m);
    b.primary = made[0] || null;
    /* THE RADIUS IS THE HUB'S AND NOT THE STRUT'S, and it is measured rather
     * than eyeballed: `Enemy.capsules` builds a bone's contact volume as a
     * capsule of `bone.radius` about the bone's own axis, and
     * `severance.mjs`'s first check walks the DRAWN surface and fails a body
     * with more than 22% of it outside. At the strut's own 0.09 the shoulder
     * drum (0.115) and the plate's corners stood outside their own capsule and
     * this body measured 27%. */
    b.radius = (hub ? 0.125 : 0.095) * S * w;
  }
  /* ── the feet ──
   * A wedge with two rollers under it, and the rollers are the point: this
   * body's whole cost as a companion is that it ROLLS and gets stuck on ground
   * the player vaults, and a foot with visible wheels is the only place that
   * cost is stated to a player who has not read the card. */
  for (const [name, w] of [['footL', 1], ['footR', 1], ['footC', 0.78]]) {
    const b = rig.get(name);
    if (!b) continue;
    const k = new Kit();
    const L = b.length;
    /**
     * ── AND THE PIECES GO DOWN THE BONE IN THE ORDER THEY GO DOWN THE FOOT ──
     *
     * A foot bone's +Y is DOWN (`rest` is [0, −0.99, 0.14]), so a part at
     * `L * 0.88` is at the SOLE and one at `L * 0.10` is at the ankle. The
     * first build had the dark ankle block at 0.90 and the shoe at 0.55 — the
     * ankle under the shoe, upside down — and rendered as a pile of pale slabs
     * at three angles under the can, which is what the in-engine flank shot
     * showed. Ankle at the top, shoe under it, rollers under that.
     */
    k.add(panels, plateGeo(0.115 * S * w, 0.075 * S, 0.130 * S * w, 0.012 * S, 1), [0, L * 0.10, 0]);
    k.add(shell, plateGeo(0.135 * S * w, 0.085 * S, 0.30 * S * w, 0.018 * S, 2), [0, L * 0.62, 0.045 * S]);
    k.pair((sx) => k.add(panels, new THREE.CylinderGeometry(0.045 * S, 0.045 * S, 0.032 * S, 9),
      [sx * 0.052 * S * w, L * 0.96, 0.115 * S], [0, 0, Math.PI / 2]));
    k.add(panels, new THREE.CylinderGeometry(0.038 * S, 0.038 * S, 0.075 * S * w, 9),
      [0, L * 0.96, -0.075 * S], [0, 0, Math.PI / 2]);
    const made = k.bake(b.obj);
    for (const m of made) { b.parts.push(m); markSilhouette(m); }
    b.primary = made[0] || null;
    /* A foot is 30 cm deep on a 16 cm bone, so its capsule is very nearly a
     * sphere — see the note on the strut's radius above for why that is the
     * right answer rather than a generous one. */
    b.radius = 0.165 * S * w;
  }

  return {
    rig, group: rig.root, scale: S,
    palette: { shell, trim, panels, photo },
    /**
     * THE EMPTY STANCE. `hipHeight` is where the hips bone rides above the
     * ground and the rest of the numbers are what `_poseWalker` reads to place
     * it: `step` and `lift` are dead on a body with no limbs and are published
     * as the values they would have rather than as zeroes, because a zero in a
     * stance is indistinguishable from a field somebody forgot. `rear` is the
     * one that is live — metres of hip travel per unit of an attack's rise —
     * and `bob` is a real 12 mm of servo wobble, which is what stops a
     * stationary droid reading as a prop.
     */
    stance: { hipHeight: HIP * S, step: 0.30 * S, lift: 0, rear: 0.06 * S, bob: 0.012 * S, limbs: [] },
    /** No verbs. See COMPANION_UNITS.astro — this body cannot fight at all. */
    moves: [],
  };
}

/**
 * ══ THE 2-1B MEDICAL DROID ══════════════════════════════════════════════
 *
 * "a medical droid", and the cheapest of the four to build because it takes
 * the decision COMPANIONS.md makes for it: A TALL THIN HUMANOID CHASSIS ON
 * `humanoidSkeleton`. So `BipedAnimator`, `POSTURES`, `hipHeight`, the parade
 * path and the deck's humanoid row all work with nothing written, and this
 * function's whole job is proportions and dressing.
 *
 * ── WHAT MAKES IT NOT A TROOPER WITH A DOME ON ─────────────────────────
 *
 *   THE WAIST. `waistR` 0.062 against a clone's 0.125, under a chest of 0.112
 *   — the narrowest midriff on the roster by half. A 2-1B's abdomen is an
 *   EXPOSED SPINE with the hip block hung off it, and the gap between chest
 *   and pelvis is the single feature every reference plate of one is about. It
 *   is dressed below as a stack of vertebral discs on a rod, so what stands in
 *   the gap is machinery and not a waist.
 *
 *   THE LIMBS ARE STRUTS. `deltoid: false` and `limbOpts` with no bulge, so
 *   arms and legs are straight tapers with a hard step at each joint. Nothing
 *   on this body has a muscle on it, and `sections: false` is the other half —
 *   `FLESH_SECTIONS` gives a shin a calf, and a surgical droid's shin is a pipe.
 *
 *   IT IS TALLER THAN A MAN AND THINNER. `legLen` 1.14 and `armLen` 1.10 on a
 *   1.10 scale measures 1.86 m off its own transformed vertex box and stands at
 *   1.79 m once `BipedAnimator`'s own hip clamp has settled (it holds the hip
 *   at `ankleY + legLen × 0.965`, so a long-legged figure keeps a few degrees
 *   of knee — which on this body is correct rather than tolerated: a 2-1B's
 *   legs are bent in every reference plate of one) — which is what a body built to
 *   reach across a table at a man lying on it is — and it is the opposite
 *   proportion to the wookiee below, long and thin against short and wide, so
 *   the two companions that share a skeleton cannot be confused at any range.
 *
 * ── AND IT IS UNARMED, WHICH IS ENFORCED WHERE IT MATTERS ───────────────
 *
 * Nothing here builds a weapon or a mount for one. The archetype declares
 * `moves: []` and `_beastBrain` now reads an empty list as "no verbs" rather
 * than falling through to a lunge (see Enemy.js), so "must never be given a
 * weapon" is true of the body and of the brain and not only of the card.
 */
export function buildMedic(opts = {}) {
  const S = opts.scale ?? 1.10;
  const rig = new Rig(humanoidSkeleton(S, { armLen: 1.10, legLen: 1.14 }), { scale: S });

  /* The 2-1B's two-tone: a dark instrument torso and head over pale limbs. It
   * is the reference's own scheme and it is also what makes the body legible —
   * the dark mass carries the machinery, and the eye reads it as the head and
   * chest of a thin figure rather than as one whole pale man. */
  const trim = metalMat(opts.trim ?? 0x3a3128, 0.40, 0.72, 2.4);
  const shell = metalMat(opts.shell ?? 0xb6ae9c, 0.44, 0.60, 2.2);
  const panels = metalMat(opts.panels ?? 0x24211d, 0.42, 0.90, 2.8);
  const photo = emissiveMat(opts.photoreceptor ?? 0x8fd8ff, 2.6);

  /* `squash` 0.96 and not 0.86: at 0.86 on a 0.115 radius the cap came out
   * wider than it was tall on a neck a third of its width, and rendered as a
   * MUSHROOM. A 2-1B's head is a rounded instrument housing that is very
   * nearly as deep as it is wide. The collar is what carries it onto the neck. */
  /* r 0.090 AND NOT 0.108. In the engine at 0.108 the cap measured 24 cm
   * across on a neck 8 cm through and read as a MUSHROOM from the flank — a
   * brim with a stalk under it. A head is about twice its own neck, not three
   * times; `neckR` goes up to meet it in the same pass. `squash` 1.02 makes
   * the housing very slightly taller than it is wide, which is the last thing
   * that stops it being a cap. */
  const headShell = (s) => domeHeadGeo(s, { r: 0.090, squash: 1.02, collar: 0.018 });

  dressHumanoid(rig, {
    scale: S,
    body: trim, arm: shell, leg: shell, hand: panels, boot: panels, head: trim,
    mats: { spine: panels, neck: panels },
    deltoid: false,
    sections: false,
    /**
     * THIN, AND THEN LESS THIN — a render, not a preference. The first pass
     * ran armR 0.034 and thighR 0.058, and what came back was a stick insect:
     * two pale pipes for legs with nothing at the knee, arms the width of the
     * fingers on them, and a torso so much heavier than either that the figure
     * read as a dark egg on wires. A 2-1B IS thin, but every part of it is a
     * MACHINED part with a joint at each end, and a limb under about 7 cm of
     * radius cannot show a joint at all at gameplay range.
     */
    parts: {
      chestR: 0.125, shoulderR: 0.106, hipR: 0.100, waistR: 0.062,
      armR: 0.043, clavR: 0.052, thighR: 0.076, neckR: 0.046,
      torsoDepth: 0.80, shoulderDome: 0.24, headR: 0.088,
    },
    seg: { torso: 12, arm: 8, leg: 8, clav: 6, neck: 8 },
    /* Straight tapers with no bulge anywhere: a strut, at every joint. */
    limbOpts: {
      arm: { rings: 2, capN: 2 }, fore: { rings: 2, capN: 2 },
      thigh: { rings: 2, capN: 2 }, shin: { rings: 2, capN: 2 },
    },
    headGeo: headShell,
    /* A surgeon's hands. `droidHandGeo` at a tighter curl than a B1's, which
     * is the difference between a hand that holds a rifle and one that holds
     * an instrument. */
    handGeo: (side, s) => droidHandGeo(side, s, { curl: 0.55 }),
    /* A real pad. At 0.058 x 0.150 the feet were two dark specks and the
     * legs ended in nothing — see the note on the limb radii. */
    feet: { w: 0.072, len: 0.190, h: 0.056 },

    buildHead(headObj, s, hg) {
      const k = new Kit();
      domeKit(k, hg, s, { shell, trim: panels, panels, photo },
        { r: 0.090, eyeUp: 0.10, panels: false, holo: false });
      /* THE VISOR BAND, and it is what separates this head from the
       * astromech's. An R-unit has ONE eye and looks in one direction; a
       * medical droid's receptor is a band across the whole front of the cap,
       * because it is reading a body on a table under it rather than picking a
       * heading. Seated with `face` on the shell so it follows the squash. */
      const core = new THREE.Vector3(0, 0, 0);
      const d = new THREE.Vector3();
      /* THE FACEPLATE FIRST — a pale panel across the front of the cap, which
       * is what stops the head reading as a dark bowl on dark shoulders. The
       * band of receptor sits ON it. Five segments rather than three: at three
       * the band was two specks either side of a gap. */
      k.row(5, (i, t) => {
        const th = (t - 0.5) * 1.9;
        d.set(Math.sin(th) * 0.86, 0.16, Math.cos(th) * 0.86).normalize();
        k.face(shell, plateGeo(0.046 * s, 0.086 * s, 0.010 * s, 0.004 * s, 1),
          onSurface(hg, d, -0.002 * s, core), d);
      });
      k.row(5, (i, t) => {
        const th = (t - 0.5) * 1.7;
        d.set(Math.sin(th) * 0.86, 0.06, Math.cos(th) * 0.86).normalize();
        k.face(photo, plateGeo(0.040 * s, 0.028 * s, 0.008 * s, 0.003 * s, 1),
          onSurface(hg, d, -0.012 * s, core), d);
      });
      /* The two audio pickups either side. Small, dark, and NOT marked
       * silhouette: at thirty metres this head is eleven pixels and what has
       * to survive is the DOME, which is the bone's own primary. */
      k.pair((sx) => {
        d.set(sx * 0.96, 0.22, 0.10).normalize();
        k.aim(panels, new THREE.CylinderGeometry(0.020 * s, 0.024 * s, 0.030 * s, 8),
          onSurface(hg, d, 0.002 * s, core), d);
      });
      k.bake(headObj);
    },

    dress(r, s) {
      /**
       * ── THE OPEN MIDRIFF ────────────────────────────────────────────
       *
       * The one thing that has to be right. `waistR` 0.062 leaves a real gap
       * between the chest lathe and the hip lathe, and what fills it is a
       * COLUMN: a rod with four discs stacked on it and a pair of pistons
       * either side. Parented to `spine`, so it moves with the trunk the way a
       * spine does and comes off with it under a blade.
       */
      const spine = r.get('spine');
      if (spine) {
        const k = new Kit();
        const L = spine.length;
        k.add(panels, new THREE.CylinderGeometry(0.030 * s, 0.030 * s, L * 1.05, 9), [0, L * 0.48, 0]);
        k.row(4, (i, t) => k.add(shell,
          /* 0.088 AND NOT 0.068: the discs were built at exactly `waistR`, so
           * they were flush with the lathe they were meant to be standing out
           * of and the "exposed spine" was a smooth dark waist. A vertebra has
           * to be WIDER than the column it is threaded on. */
          (() => { const g = new THREE.SphereGeometry(0.088 * s, 10, 6); g.scale(1, 0.40, 0.86); return g; })(),
          [0, (0.12 + t * 0.74) * L, 0]));
        k.pair((sx) => {
          k.add(panels, new THREE.CylinderGeometry(0.014 * s, 0.014 * s, L * 0.86, 7), [sx * 0.055 * s, L * 0.50, -0.020 * s]);
          k.add(shell, new THREE.CylinderGeometry(0.019 * s, 0.019 * s, L * 0.34, 7), [sx * 0.055 * s, L * 0.30, -0.020 * s]);
        });
        k.bake(spine.obj);
      }
      /* THE CHEST PLATE AND THE SHOULDER RINGS. A 2-1B's thorax is a slab of
       * instrument housing with two exposed rotator rings above it, and the
       * rings are what make the arms read as bolted ON rather than grown. */
      const chest = r.get('chest');
      if (chest) {
        const k = new Kit();
        /* SEATED PROUD OF THE LATHE, WHICH IT WAS NOT. `torsoDepth` 0.80
         * squashes the chest to 0.100 in Z, and the plate was centred at 0.070
         * with a half-depth of 0.028 — its front face landed 2 mm outside the
         * hull it was supposed to be sitting ON, so the whole instrument
         * housing was inside the droid and the front of the body was blank. */
        k.add(shell, plateGeo(0.160 * s, 0.190 * s, 0.055 * s, 0.014 * s, 2), [0, 0.105 * s, 0.104 * s]);
        k.add(panels, plateGeo(0.095 * s, 0.055 * s, 0.014 * s, 0.005 * s, 1), [0, 0.152 * s, 0.135 * s]);
        k.add(photo, plateGeo(0.032 * s, 0.014 * s, 0.010 * s, 0.003 * s, 1), [0.048 * s, 0.062 * s, 0.136 * s]);
        k.pair((sx) => k.add(panels, bandGeo(0.052 * s, 0.072 * s, 0.052 * s, 0.072 * s, 0.048 * s, 12),
          [sx * 0.100 * s, 0.185 * s, 0], [0, 0, Math.PI / 2]));
        for (const m of k.bake(chest.obj)) if (m.material === shell) markSilhouette(m);
      }
      /* THE HIP BLOCK. A pelvis on this body is a machined box, and it is what
       * the open midriff stands ON — without it the column runs into a taper
       * and the figure has no bottom half. */
      const hips = r.get('hips');
      if (hips) {
        const k = new Kit();
        k.add(shell, plateGeo(0.175 * s, 0.095 * s, 0.130 * s, 0.018 * s, 2), [0, 0.025 * s, 0]);
        k.add(panels, plateGeo(0.130 * s, 0.032 * s, 0.105 * s, 0.008 * s, 1), [0, -0.030 * s, 0]);
        /* The hip actuators: two short pistons standing out of the block over
         * each thigh, which is the join a machined pelvis has and a lathe
         * running smoothly into a leg does not. */
        k.pair((sx) => k.add(panels, new THREE.CylinderGeometry(0.026 * s, 0.030 * s, 0.070 * s, 8),
          [sx * 0.082 * s, 0.010 * s, 0.010 * s], [0, 0, sx * 0.22]));
        k.bake(hips.obj);
      }
      /**
       * THE INSTRUMENT CLUSTER, ON THE LEFT FOREARM ONLY.
       *
       * Asymmetry is the cheapest legibility there is on a body this thin, and
       * it is also correct: a 2-1B carries its diagnostic arm on one side and
       * works with the other. Three short probes and a lit readout — and the
       * readout is `photo`, so from the front the droid is an eye band and one
       * small light low on an arm, which reads as a machine at work.
       */
      /**
       * ── A JOINT AT EVERY JOINT ──────────────────────────────────────
       *
       * `dressHumanoid` builds each limb as a lathe with a hard step where the
       * next one starts, and on a body with a bicep and a calf that step IS
       * the elbow. This one has neither — `limbOpts` asks for straight tapers,
       * because a surgical droid's arm is a strut — so the step is a change of
       * radius on a smooth pipe and reads as nothing at all. One dark ring at
       * each of the four joints is what a machined limb actually has there, it
       * is four merged shapes a side, and it is the difference between a leg
       * and a length of pipe.
       */
      for (const side of ['L', 'R']) {
        for (const [bone, rr, at] of [['arm', 0.050, 0.98], ['fore', 0.046, 0.02],
          ['thigh', 0.082, 0.98], ['shin', 0.076, 0.03]]) {
          const b = r.get(bone + side);
          if (!b) continue;
          const k = new Kit();
          k.add(panels, bandGeo(rr * 0.70 * s, rr * s, rr * 0.70 * s, rr * s, 0.052 * s, 12),
            [0, b.length * at - 0.026 * s, 0]);
          k.bake(b.obj);
        }
      }
      const fore = r.get('foreL');
      if (fore) {
        const k = new Kit();
        const L = fore.length;
        k.add(panels, plateGeo(0.055 * s, 0.090 * s, 0.048 * s, 0.010 * s, 1), [0.028 * s, L * 0.42, 0]);
        k.add(photo, plateGeo(0.026 * s, 0.016 * s, 0.008 * s, 0.003 * s, 1), [0.052 * s, L * 0.42, 0.010 * s]);
        k.row(3, (i, t) => k.add(shell, new THREE.CylinderGeometry(0.006 * s, 0.004 * s, 0.075 * s, 6),
          [0.028 * s, L * 0.80, (t - 0.5) * 0.030 * s]));
        k.bake(fore.obj);
      }
    },
  });

  /* A WORKING STOOP. `leanTrunk` puts it in the REST pose for the reason that
   * function's own note gives, and 0.14 is a body that spends its life bent
   * over somebody — enough to read from the side, well under the BX commando's
   * crouch, and it survives the walk because the gait writes every trunk bone
   * as rest × its own lean. The head comes back up (−0.10) so the droid is
   * still looking where it is going. */
  leanTrunk(rig, 0.14, -0.10);

  return { rig, group: rig.root, scale: S, palette: { shell, trim, panels, photo } };
}

/**
 * A COAT, AS TAPERED CLUMPS — the creature `back: 'shag'` treatment, said once
 * as a function so the wookiee below and the wampa are the same shape law.
 *
 * What that treatment IS is one idea rather than one call site: fur is
 * authored as clumps standing OFF the body and never as a texture, because a
 * clump breaks the SILHOUETTE and a texture does not — and past thirty metres
 * the silhouette is all there is. A `clawGeo` is the primitive for the same
 * reason it is there: a tapered, slightly curved tube with real rings in it,
 * where a cone reads as a spike and hair falls.
 *
 * ── AND IT IS ROOTED WITH `onLimb`, WHICH IS THE WHOLE OF THE FIRST BUILD'S
 *    DEFECT ────────────────────────────────────────────────────────────────
 *
 * The first version placed each clump at a TYPED coordinate — `z: 0.150 * s`
 * on a chest whose lathe radius is 0.244 — so every clump was rooted 9 cm
 * INSIDE the body and only its far end came out. What renders is then not fur
 * at all: it is a row of cones emerging from a smooth surface, and at the
 * length a clump needs to read at range that is a stegosaurus. Exactly the
 * defect the creature builder's own `hull()` note describes one treatment
 * over, arrived at independently on a humanoid.
 *
 * So the root is `onLimb`, which fires a ray from the bone's axis and takes
 * the point where it leaves the mesh — the same answer `limbPlate` already
 * uses to stop a greave ending up inside a shin — and the clump is AIMED
 * mostly downward with a little of the surface normal in it, because hair
 * lies along a body and hangs off it. `droop` is that mix and it is the one
 * number that decides whether this reads as fur or as spines.
 *
 *   n       clumps in the row
 *   y0,y1   fractions along the bone
 *   a0,a1   azimuth arc, 0 straight ahead (+Z), ±π/2 the flanks
 *   len,r0  the clump; `len` may be a function of t so a row can taper
 *   droop   0 straight out of the surface, 1 straight down the body
 */
function shagOn(k, mat, bone, n, o = {}) {
  if (!bone) return k;
  const y0 = o.y0 ?? 0.15, y1 = o.y1 ?? 0.85;
  const a0 = o.a0 ?? -1.2, a1 = o.a1 ?? 1.2;
  const r0 = o.r0 ?? 0.026, droop = o.droop ?? 0.72;
  const out = [0, 0, 0];
  return k.row(n, (i, t) => {
    const th = a0 + (a1 - a0) * (n === 1 ? 0.5 : t);
    out[0] = Math.sin(th); out[1] = 0; out[2] = Math.cos(th);
    const root = onLimb(bone, (y0 + (y1 - y0) * t) * bone.length, out, o.sink ?? 0);
    const L = typeof o.len === 'function' ? o.len(t) : (o.len ?? 0.12);
    /* 4 SEGMENTS AND 2 RINGS, not 5 and 3. A coat is sixty of these and the
     * wookiee measured 15 736 triangles against the 13 000 `characters.mjs`
     * holds an archetype to — most of it hair nobody can count. At 4x2 a clump
     * is 64 triangles instead of 200 and the silhouette is identical, because
     * what a clump contributes at any range is its OUTLINE. */
    k.aim(mat, clawGeo(L, r0, r0 * 0.18, 0.5, 4, 2), root,
      [out[0] * (1 - droop), -droop, out[2] * (1 - droop)]);
  });
}

/**
 * ══ THE WOOKIEE ═════════════════════════════════════════════════════════
 *
 * "a large wookie", and COMPANIONS.md settles the two decisions that would
 * otherwise be arguments:
 *
 *   A HUMANOID RIG AT ~1.28, so BipedAnimator, POSTURES, `hipHeight`, the
 *   parade path and the deck's humanoid figure builder all work unchanged.
 *   1.32 rather than the design's 1.28, and it is a MEASUREMENT correcting a
 *   round number: `legLen` 0.98 shortens the legs for the ape proportion below,
 *   and at 1.28 the built box came out 2.08 m — under Chewbacca's stated 2.28
 *   and barely over a Geonosian. 1.32 measures 2.22 m, which is the tallest
 *   walking body on the roster short of a machine and the reason it can
 *   physically block a doorway a player is standing in.
 *
 *   NO CLOTH. `Engine.js` sizes `QUALITY.cloth` on "every enemy wearing
 *   exactly one cape" and `cloth-cost.mjs` holds every archetype to `g.n === 1`
 *   — so the bandolier is GEOMETRY. It is a strap and six cases on a bone, two
 *   draw calls, and it does not move. A simulated belt on a body this size
 *   would be the twelfth cape in a column sized for eleven.
 *
 * ── THE PROPORTIONS ARE THE OPPOSITE OF THE MEDIC'S ─────────────────────
 *
 * `armLen` 1.16 and `legLen` 0.92 under a chest of 0.225: long arms, short
 * legs, enormous barrel. That is an ape's proportion and it is what makes this
 * read as a wookiee rather than as a hairy tall man — measured against the
 * 2-1B on the same skeleton, the two silhouettes have almost nothing in common
 * above the hip, which is the whole point of two companions sharing a rig.
 */
export function buildWookiee(opts = {}) {
  const S = opts.scale ?? 1.32;
  const rig = new Rig(humanoidSkeleton(S, { armLen: 1.16, legLen: 0.98 }), { scale: S });

  /* THE PELT IS THE BODY — there is no skin on this figure a player ever sees
   * except the face — so `pelt` is the one colour the look table really moves,
   * and `braid` is the bandolier's leather. `hideMat` rather than `skinMat`:
   * 0.94 roughness with no sheen at all, because fur that catches a specular
   * is wet fur. */
  const pelt = hideMat(opts.pelt ?? 0x6b4a2c, 0.94);
  /**
   * The under-coat, two shades up. One material, and it is what gives the
   * chest, the belly and the thighs a lighter mass than the back — every
   * reference wookiee is countershaded, and a single flat brown is the thing
   * that makes a fur body read as a costume.
   *
   * DERIVED FROM THE PELT RATHER THAN DECLARED BESIDE IT. The first version
   * read `opts.pelt ?? 0x7d5c3a`, which meant the countershading existed only
   * while the player left the colour alone: pick anything in the Kennel and
   * the under-coat became the same value as the back and the whole body went
   * flat.
   *
   * BRIGHTENED RATHER THAN LERPED TOWARD WHITE, and the difference is not
   * subtle: `THREE.ColorManagement` is on, so a `lerp` runs in LINEAR space
   * and pulls the value toward grey as well as up — 0x6b4a2c a fifth of the
   * way to white comes out near 0x9a8a7c, a different and greyer colour, and
   * it rendered as pale pink quills standing against the brown rather than as
   * a lighter coat. `multiplyScalar` is a gain instead: 1.35 gives 0x7b5634,
   * which is the same brown two shades up. A coat's pale half is lit fur, not
   * different fur.
   */
  const under = hideMat(new THREE.Color(opts.pelt ?? 0x6b4a2c).multiplyScalar(1.35).getHex(), 0.94);
  const face = skinMat(0x3a2b1e, 2.6);
  /* 0x6a4a2e and not 0x4a3524: at the darker value the strap rendered as a
   * solid BLACK plank across the chest, because the one thing a cel ramp will
   * not do is separate two dark values. A bandolier is tan leather. */
  const leather = leatherMat(opts.braid ?? 0x6a4a2e, 0.68);
  const steel = metalMat(0x8b8880, 0.40, 0.90, 2.4);
  const eye = emissiveMat(0xd8b25a, 1.4);
  const tooth = boneMat(0xe0d5b8, 0.36);

  /**
   * THE HEAD. A long muzzle under a heavy brow, and a mane that swallows the
   * neck — which is the whole read, because a wookiee's head has no visible
   * join with its shoulders at all.
   *
   * Authored as ONE geometry for the reason `buildGeonosian`'s is: the head is
   * a bone primary and a primary is one draw call at every range, so a skull
   * split across three meshes is three draw calls at forty metres for a shape
   * nine pixels across. The muzzle is `limbGeo` with a `muzzleSection` — the
   * same lathe the creature heads use and for the same stated reason: a
   * `plateGeo` snout is a crate seen end-on.
   */
  const headShell = (s) => assemble([
    // braincase: long back to front, low, and heavy at the occiput
    [(() => { const g = new THREE.SphereGeometry(0.108 * s, 12, 9); g.scale(0.98, 0.94, 1.16); return g; })(),
      [0, 0.096 * s, -0.010 * s]],
    // the brow shelf, which is what a wookiee looks out from under
    [(() => { const g = new THREE.SphereGeometry(0.098 * s, 10, 7); g.scale(1.02, 0.34, 0.60); return g; })(),
      [0, 0.132 * s, 0.052 * s], [-0.26, 0, 0]],
    // the muzzle: short, deep and wide at the hinge — an ape's, not a dog's
    [limbGeo(0.115 * s, 0.072 * s, 0.048 * s, 10, true,
      { rings: 3, capN: 3, capY0: 0.22, capY1: 0.58, section: muzzleSection({ flat: 0.78, n: 2.8, chin: 0.20, crown: 0.10 }) }),
    [0, 0.058 * s, 0.052 * s], [Math.PI / 2 + 0.10, 0, 0]],
    // the cheeks, which carry the eye line into the mouth
    [(() => { const g = new THREE.SphereGeometry(0.062 * s, 9, 7); g.scale(1, 0.86, 1.20); return g; })(),
      [0.058 * s, 0.062 * s, 0.030 * s]],
    [(() => { const g = new THREE.SphereGeometry(0.062 * s, 9, 7); g.scale(1, 0.86, 1.20); return g; })(),
      [-0.058 * s, 0.062 * s, 0.030 * s]],
  ], 'head');

  dressHumanoid(rig, {
    scale: S,
    body: pelt, arm: pelt, leg: pelt, hand: pelt, boot: pelt, head: face,
    /* A DELTOID AND A HALF. The default is [0.30, 0.15, 0.17]; this is a
     * bigger swell further down the arm, which is where an ape carries its
     * shoulder mass — and it is a swell in the arm's OWN lathe rather than a
     * ball on it, for the reason `dressHumanoid` argues at length. */
    deltoid: [0.44, 0.20, 0.20],
    /* 0.185 AND NOT 0.225, WHICH IS A MEASUREMENT. `addLimb` multiplies these
     * by the figure's scale, so 0.225 on a 1.32 body is a chest radius of
     * 0.297 m — a barrel 59 cm across, half again a clone's at its own scale,
     * and it rendered as a drum with arms. 0.185 is 0.244 m, which is a clone's
     * 0.155 carried out by the scale plus about 20% — big, and still a body.
     *
     * AND THE SHOULDER IS WIDER THAN THE HIP BY A THIRD (0.186 against 0.142),
     * which the first pass had at 0.163 against 0.152 — near enough equal, and
     * a body with a man's taper reads as a man in a fur suit however much hair
     * is on it. An ape is a wedge. */
    parts: {
      chestR: 0.195, shoulderR: 0.186, hipR: 0.142, waistR: 0.150,
      armR: 0.062, clavR: 0.086, thighR: 0.110, neckR: 0.082,
      /* THE FOREARM BARELY TAPERS. `dressHumanoid` defaults it to 0.89 → 0.61
       * of the upper arm, which is a human's wrist and turned this one's arms
       * into pipes ending in sticks. An ape's forearm is as heavy as its
       * upper arm and its wrist is thick; it is also the part of the body a
       * player standing next to this thing is closest to. */
      foreR0: 0.062, foreR1: 0.050,
      /* 0.94 DEEP against a clone's 0.76 — nearly round in section. A wookiee
       * is as thick front to back as it is across, and that one number is what
       * stops the barrel reading as a broad flat man. */
      torsoDepth: 0.94, shoulderDome: 0.30, headR: 0.110,
    },
    seg: { torso: 14, arm: 12, leg: 12, clav: 8, neck: 10 },
    /* THE YOKE. A trapezius sized off the clavicle the rig actually has, and
     * on this body it does more work than on any other: the mane below sits on
     * it, and without the mass under the hair the coat hangs off a flat disc. */
    yoke: { reach: 0.72, rise: 0.048, depth: 0.086, at: 0.46, slope: 0.26 },
    yokeMat: pelt,
    headGeo: headShell,
    feet: { w: 0.082, len: 0.215, h: 0.070 },

    buildHead(headObj, s, hg) {
      const k = new Kit();
      const core = new THREE.Vector3(0, 0.096 * s, -0.010 * s);
      const d = new THREE.Vector3();
      k.pair((sx) => {
        // deep-set eyes under the shelf
        d.set(sx * 0.40, 0.10, 0.91).normalize();
        k.aim(eye, new THREE.SphereGeometry(0.019 * s, 7, 6), onSurface(hg, d, -0.004 * s, core), d);
        // the lower canine, standing out of the lip the way every reference has it
        k.add(tooth, clawGeo(0.030 * s, 0.007 * s, 0.002 * s, -0.35, 4, 3),
          [sx * 0.030 * s, 0.038 * s, 0.106 * s], [-0.30, 0, sx * 0.12]);
      });
      k.add(face, (() => { const g = new THREE.SphereGeometry(0.026 * s, 8, 6); g.scale(1.2, 0.8, 1); return g; })(),
        [0, 0.082 * s, 0.150 * s]);
      /**
       * THE MANE, and it is the head's whole outline. Two rings of clumps
       * raked back and down off the crown and the jaw, so the head's
       * silhouette is a shaggy wedge rather than a ball — and the lower ring
       * reaches past the neck onto the shoulders, which is what makes the join
       * disappear.
       */
      /* Seated with `onSurface` against the skull's own geometry, for the
       * reason `shagOn` gives about the body: a clump rooted at a typed
       * coordinate inside a shell is a spike coming out of it. Two rings, and
       * the lower one reaches past the neck onto the shoulders. */
      const mane = (n, spread, up, len, r, droop) => k.row(n, (i, t) => {
        const th = (t - 0.5) * spread;
        d.set(Math.sin(th) * Math.cos(up), Math.sin(up), Math.cos(th) * Math.cos(up)).normalize();
        const root = onSurface(hg, d, -0.010 * s, core);
        k.aim(pelt, clawGeo(len * s, r * s, r * 0.18 * s, 0.5, 4, 2), root,
          [d.x * (1 - droop) - Math.sin(th) * 0.10, -droop, d.z * (1 - droop) - 0.45]);
      });
      mane(11, 4.4, 0.60, 0.150, 0.030, 0.44);
      mane(11, 4.8, 0.02, 0.185, 0.033, 0.60);
      mane(9, 4.8, -0.55, 0.165, 0.030, 0.70);
      /* Kept past thirty metres, and it is the only thing on this head that
       * is: a wookiee at range is a mane and a pair of shoulders. */
      markSilhouette(k.bake(headObj));
    },

    dress(r, s) {
      /**
       * ── THE COAT ────────────────────────────────────────────────────
       *
       * Clumps on the chest, the back, the hips, the outside of each arm and
       * the front of each thigh — every one of them rooted on the surface by
       * `shagOn` (see it) and every one of them on a BONE, so the coat bends
       * with the body and a severed arm takes its own hair with it. That is
       * the rule every rivet and plate in this file obeys, and the reason none
       * of this hangs off `rig.root`.
       *
       * SMALL AND MANY. The first pass used five clumps of 20 cm at 5.5 cm of
       * root radius and they read as horns; a coat is made of pieces that are
       * each too small to be looked at. 10-11 cm at 2.4 cm, in rows of seven
       * to nine, is a fur EDGE — which is the only thing about hair that
       * survives being a silhouette.
       *
       * Marked silhouette on the TRUNK and not on the limbs. `characters.mjs`
       * caps a humanoid at 32 kept meshes at LOD 1, and the trunk clumps are
       * the ones that change the outline; four more merged meshes on the arms
       * and thighs would buy an edge nobody can resolve at that range.
       */
      const chest = r.get('chest');
      if (chest) {
        const k = new Kit();
        // the pectoral coat, hanging down the front
        shagOn(k, under, chest, 7, { y0: 0.30, y1: 0.30, a0: -1.05, a1: 1.05,
          len: (t) => (0.150 - Math.abs(t - 0.5) * 0.04) * s, r0: 0.028 * s, droop: 0.80, sink: 0.010 * s });
        shagOn(k, under, chest, 7, { y0: 0.62, y1: 0.62, a0: -1.15, a1: 1.15,
          len: 0.140 * s, r0: 0.026 * s, droop: 0.76, sink: 0.010 * s });
        // the back, which is what somebody following it sees
        shagOn(k, pelt, chest, 8, { y0: 0.26, y1: 0.26, a0: Math.PI - 1.2, a1: Math.PI + 1.2,
          len: 0.165 * s, r0: 0.032 * s, droop: 0.74, sink: 0.008 * s });
        shagOn(k, pelt, chest, 8, { y0: 0.60, y1: 0.60, a0: Math.PI - 1.3, a1: Math.PI + 1.3,
          len: 0.155 * s, r0: 0.030 * s, droop: 0.70, sink: 0.008 * s });
        // …and the ruff over the shoulders, which is where the mane lands
        shagOn(k, pelt, chest, 5, { y0: 0.86, y1: 0.86, a0: -2.6, a1: -1.5,
          len: 0.145 * s, r0: 0.032 * s, droop: 0.52, sink: 0.006 * s });
        shagOn(k, pelt, chest, 5, { y0: 0.86, y1: 0.86, a0: 1.5, a1: 2.6,
          len: 0.145 * s, r0: 0.032 * s, droop: 0.52, sink: 0.006 * s });
        markSilhouette(k.bake(chest.obj));

        /**
         * ── THE BANDOLIER, AS GEOMETRY ──────────────────────────────
         *
         * One strap over the left shoulder to the right hip, six cases on it,
         * and a buckle. Its own Kit, so it bakes to its own merged meshes —
         * leather and steel, two draw calls — and it is on `chest` rather than
         * on `spine` because a bandolier hangs from a SHOULDER, and a strap
         * that swung with the pelvis would slide off the body on every turn.
         *
         * A ROTATED SLAB AND NOT A SWEPT TUBE. `plateGeo` at 0.62 rad across
         * the chest reads as one continuous strap under the cel ramp and is 92
         * triangles; a tube swept round the torso is nine times that for a
         * shape the shoulder ruff covers a third of. It rides at 1.06 of the
         * chest's own radius, taken off `onLimb` rather than typed, so it
         * cannot end up under the coat it is supposed to be over.
         */
        const L = chest.length;
        const R = onLimb(chest, L * 0.5, [0, 0, 1])[2];
        const b = new Kit();
        b.add(leather, plateGeo(0.058 * s, 0.66 * s, 0.028 * s, 0.010 * s, 1),
          [0.020 * s, L * 0.44, R * 1.02], [0.06, 0, 0.62]);
        b.add(leather, plateGeo(0.058 * s, 0.64 * s, 0.028 * s, 0.010 * s, 1),
          [0.020 * s, L * 0.44, -R * 1.02], [-0.06, 0, 0.62]);
        b.row(6, (i, t) => b.add(steel,
          plateGeo(0.052 * s, 0.066 * s, 0.028 * s, 0.006 * s, 1),
          [(0.170 - t * 0.33) * s, L * (0.13 + t * 0.62), R * 1.06], [0.06, 0, 0.62]));
        b.add(steel, plateGeo(0.074 * s, 0.074 * s, 0.024 * s, 0.008 * s, 1),
          [-0.135 * s, L * 0.10, R * 0.98], [0.10, 0, 0.62]);
        markSilhouette(b.bake(chest.obj));
      }
      const hips = r.get('hips');
      if (hips) {
        const k = new Kit();
        shagOn(k, under, hips, 9, { y0: 0.30, y1: 0.30, a0: -Math.PI, a1: Math.PI,
          len: 0.135 * s, r0: 0.028 * s, droop: 0.86, sink: 0.008 * s });
        k.bake(hips.obj);
      }
      for (const side of ['L', 'R']) {
        const sx = side === 'L' ? 1 : -1;
        const arm = r.get('arm' + side);
        if (arm) {
          const k = new Kit();
          /* THREE ROWS ROUND THE ARM AND NOT TWO. At two the arm was a bare
           * pipe from every angle but one, which on the limb a player standing
           * beside this body is closest to is the whole of the read. */
          for (const a of [1.15, 1.95, 2.75]) {
            shagOn(k, pelt, arm, 4, { y0: 0.16, y1: 0.80, a0: sx * a, a1: sx * a,
              len: (t) => (0.135 - t * 0.02) * s, r0: 0.026 * s, droop: 0.62, sink: 0.006 * s });
          }
          k.bake(arm.obj);
        }
        const fore = r.get('fore' + side);
        if (fore) {
          const k = new Kit();
          for (const a of [1.30, 2.20]) {
            shagOn(k, pelt, fore, 4, { y0: 0.18, y1: 0.82, a0: sx * a, a1: sx * a,
              len: 0.115 * s, r0: 0.023 * s, droop: 0.66, sink: 0.005 * s });
          }
          k.bake(fore.obj);
        }
        const thigh = r.get('thigh' + side);
        if (thigh) {
          const k = new Kit();
          shagOn(k, under, thigh, 4, { y0: 0.20, y1: 0.74, a0: 0.5, a1: 0.5,
            len: 0.115 * s, r0: 0.026 * s, droop: 0.80, sink: 0.006 * s });
          shagOn(k, under, thigh, 4, { y0: 0.20, y1: 0.74, a0: -0.5, a1: -0.5,
            len: 0.115 * s, r0: 0.026 * s, droop: 0.80, sink: 0.006 * s });
          k.bake(thigh.obj);
        }
        const shin = r.get('shin' + side);
        if (shin) {
          const k = new Kit();
          shagOn(k, under, shin, 3, { y0: 0.20, y1: 0.62, a0: 0.6, a1: 0.6,
            len: 0.095 * s, r0: 0.022 * s, droop: 0.82, sink: 0.005 * s });
          k.bake(shin.obj);
        }
      }
    },
  });

  /* A STANDING HUNCH. Every ape carries its shoulders in front of its hips and
   * its head forward of both; 0.10 of stoop with the head brought back up is
   * that, and it goes in the rest pose for `leanTrunk`'s own stated reason. */
  leanTrunk(rig, 0.10, -0.06);

  return { rig, group: rig.root, scale: S, palette: { pelt, under, face, leather, steel } };
}

export const BODY_KITS = {
  /* the clone army — see TROOPER_KITS */
  trooper: { kit: 'line' },
  /* THE MARKSMAN'S OWN PLATE LIVES HERE, not beside his numbers.
   *
   * `ARCHETYPES.sniper` carried `trooperColor`/`accent` and `Enemy._build`
   * spread them on as a one-line special case AFTER the man's own kit, which
   * meant a Marksman the player had painted landed in stock colours — the tab
   * showing one man and the ground fielding another. The colours belong in the
   * kit table with everything else the body wears, where `buildParadeFigure`
   * reads them too: one statement of what a Marksman looks like, and the
   * player's choice spread over the top of it in both readers. */
  sniper: { kit: 'marksman', color: 0x2c3038, accent: 0xff9a20 },
  heavy: { kit: 'heavy' },
  jet: { kit: 'jet' },
  arc: { kit: 'arc' },
  officer: { kit: 'commander' },
  /* the order — see JEDI_RANKS */
  jedi: { rank: 'knight' },
  sentinel: { rank: 'sentinel' },
  guardian: { rank: 'guardian' },
  master: { rank: 'master' },
  /* the separatist chassis — see B1_KITS */
  b1: { kit: 'line' },
  /* THE REPROGRAMMED B1 wears what a B1 wears — it IS a B1, `buildB1`
   * verbatim, and the only thing that differs is whose side it is on. A
   * separate kit would be a second answer to a question the body already
   * answers. */
  b1c: { kit: 'line' },
  /* FLAGSHIP §6's third body class, on the B1 chassis and the B1 kit. The
   * conscript differs from a B1 in its NUMBERS and its paint, not in what it
   * carries — see `ARCHETYPES.conscript`, which passes the colours through to
   * `buildB1` — so the row exists to say "line kit, deliberately", which is
   * what this table is for. */
  conscript: { kit: 'line' },
  rocket: { kit: 'rocket' },
  bx: { kit: 'commando' },
  dummy: { kit: 'target' },
  /* the duellists — see ACOLYTE_KITS */
  acolyte: { kit: 'sith' },
  sparring: { kit: 'sparring' },
  /* the heavy droids — see BODYGUARD_KITS. `b2` has one chassis and one rung. */
  b2: {},
  magna: { kit: 'guard' },
  bodyguard: { kit: 'general' },
  /* THE ARENA'S OWN SPECIES. One chassis and one rung, like the B2 above: a
   * Geonosian warrior is a caste rather than a kit, and there is nothing for a
   * second row to say. It is here rather than absent because absent is exactly
   * what `characters.mjs` forbids — "a humanoid added to the roster with no row
   * in BODY_KITS looks exactly like an archetype that deliberately wears
   * nothing, and the last time that happened three archetypes went a whole
   * session without a body of their own." */
  geonosian: {},
  /* THE TWO HUMANOID COMPANIONS. One chassis and one rung each, like the B2
   * and the Geonosian above, and here for the same reason those two are: a
   * humanoid archetype with no row is what `characters.mjs` forbids, and a
   * body whose whole look comes from `COMPANION_LOOK` still has to say out
   * loud that it wears nothing from the trooper tables. The four colour slots
   * a player CAN move on these two arrive through `companionOptsFrom` — a
   * different door, argued over that function. */
  medic: {},
  wook: {},
};

/** What an archetype wears, or null if it is not a body this file dresses. */
/* ══════════════════════════════════════════════════════════════════════ */
/*  How each body carries itself                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE STANDING CROUCH EACH CHASSIS HOLDS UNDER WHATEVER ITS BRAIN ASKS — read
 * by `Enemy._pose` and handed to the gait, so a commando droid is a B1 held
 * low and stays low on the march. The forward STOOP of a trunk is not here:
 * it is built into the rest pose by `leanTrunk` in each builder (see it),
 * because the cohort's frozen rung is captured off the rest and has to wear
 * the same hunch as the body it replaces. Everything not listed stands at
 * its rest, which is the identity `Enemy` reads when this table has nothing
 * to say.
 */
export const POSTURES = {
  b1: { crouch: 0.10 },
  b1c: { crouch: 0.10 },
  conscript: { crouch: 0.12 },
  rocket: { crouch: 0.10 },
  bx: { crouch: 0.32 },
  b2: { crouch: 0.10 },
  magna: { crouch: 0.06 },
  bodyguard: { crouch: 0.06 },
};
const NO_POSTURE = Object.freeze({ crouch: 0 });
export function postureOf(type) { return POSTURES[type] || NO_POSTURE; }

export function bodyOptsFor(type) {
  return BODY_KITS[type] || null;
}
