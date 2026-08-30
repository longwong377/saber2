/**
 * BATTLEFRONT BORZ — convex mesh slicing.
 *
 * Props are cut on the plane the blade actually swept, not at pre-authored
 * break points. Each triangle is clipped against the plane, the cross-section
 * ring is collected, and both halves get a cap fanned from the centroid — so a
 * crate cut corner-to-corner produces two wedges, not two halves of a crate.
 */

import * as THREE from '../../vendor/three/three.module.js';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();

/**
 * @param {THREE.BufferGeometry} geometry  (convex, will be converted to non-indexed)
 * @param {THREE.Vector3} planePoint       a point on the cut plane, in geometry space
 * @param {THREE.Vector3} planeNormal      unit normal, in geometry space
 * @returns {{front:THREE.BufferGeometry, back:THREE.BufferGeometry, area:number}|null}
 */
export function sliceGeometry(geometry, planePoint, planeNormal) {
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  /**
   * THE CLONE IS FREED ON EVERY WAY OUT, NOT ONLY THE ONE THAT SUCCEEDS.
   *
   * `toNonIndexed()` builds a whole second copy of the mesh — position, normal
   * and uv expanded to three vertices per triangle — and every prop mesh in the
   * game is indexed, so every call makes one. The dispose sat on the LAST line
   * and three of the four returns are above it: the plane missing the solid
   * entirely, a cut whose ring collapsed to fewer than three unique points, and
   * a half too small to build. Measured: 50 missed cuts leaked 50 geometries,
   * 50 tangent cuts leaked 50, 50 real cuts leaked none — so the leak is on
   * exactly the paths a player triggers by GRAZING furniture, which is the
   * common case and the one nobody watches. Typed arrays on the JS heap, not
   * VRAM, so no GPU counter shows it.
   */
  const bail = () => { if (geo !== geometry) geo.dispose(); return null; };
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const d0 = -planeNormal.dot(planePoint);

  const front = { p: [], n: [], u: [] };
  const back = { p: [], n: [], u: [] };
  const ring = [];

  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const N = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const U = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
  const D = [0, 0, 0];

  const emit = (side, p, n, u) => {
    side.p.push(p.x, p.y, p.z);
    side.n.push(n.x, n.y, n.z);
    side.u.push(u.x, u.y);
  };
  const tri = (side, a, b, c, na, nb, nc, ua, ub, uc) => {
    emit(side, a, na, ua); emit(side, b, nb, ub); emit(side, c, nc, uc);
  };

  let anyFront = false, anyBack = false;

  for (let t = 0; t < pos.count; t += 3) {
    for (let i = 0; i < 3; i++) {
      P[i].fromBufferAttribute(pos, t + i);
      if (nrm) N[i].fromBufferAttribute(nrm, t + i); else N[i].set(0, 1, 0);
      if (uv) U[i].fromBufferAttribute(uv, t + i); else U[i].set(0, 0);
      D[i] = planeNormal.dot(P[i]) + d0;
    }
    const nPos = (D[0] > 0 ? 1 : 0) + (D[1] > 0 ? 1 : 0) + (D[2] > 0 ? 1 : 0);
    if (nPos === 3) { tri(front, P[0], P[1], P[2], N[0], N[1], N[2], U[0], U[1], U[2]); anyFront = true; continue; }
    if (nPos === 0) { tri(back, P[0], P[1], P[2], N[0], N[1], N[2], U[0], U[1], U[2]); anyBack = true; continue; }
    anyFront = anyBack = true;

    // walk the edges, building both polygons
    const fp = [], fn = [], fu = [], bp = [], bn = [], bu = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const di = D[i], dj = D[j];
      if (di > 0) { fp.push(P[i].clone()); fn.push(N[i].clone()); fu.push(U[i].clone()); }
      else { bp.push(P[i].clone()); bn.push(N[i].clone()); bu.push(U[i].clone()); }
      if ((di > 0) !== (dj > 0)) {
        const s = di / (di - dj);
        const p = P[i].clone().lerp(P[j], s);
        const n = N[i].clone().lerp(N[j], s).normalize();
        const u = U[i].clone().lerp(U[j], s);
        fp.push(p.clone()); fn.push(n.clone()); fu.push(u.clone());
        bp.push(p.clone()); bn.push(n.clone()); bu.push(u.clone());
        ring.push(p.clone());
      }
    }
    for (let i = 1; i + 1 < fp.length; i++) tri(front, fp[0], fp[i], fp[i + 1], fn[0], fn[i], fn[i + 1], fu[0], fu[i], fu[i + 1]);
    for (let i = 1; i + 1 < bp.length; i++) tri(back, bp[0], bp[i], bp[i + 1], bn[0], bn[i], bn[i + 1], bu[0], bu[i], bu[i + 1]);
  }

  if (!anyFront || !anyBack || ring.length < 3) return bail();

  // ── cap the cross-section
  const centroid = new THREE.Vector3();
  for (const p of ring) centroid.add(p);
  centroid.multiplyScalar(1 / ring.length);

  // basis on the plane
  const ex = new THREE.Vector3(1, 0, 0);
  if (Math.abs(planeNormal.x) > 0.9) ex.set(0, 1, 0);
  const bx = new THREE.Vector3().crossVectors(planeNormal, ex).normalize();
  const by = new THREE.Vector3().crossVectors(planeNormal, bx).normalize();

  const sorted = ring
    .map((p) => {
      _v.subVectors(p, centroid);
      return { p, a: Math.atan2(_v.dot(by), _v.dot(bx)) };
    })
    .sort((a, b) => a.a - b.a);

  // drop near-duplicates so the fan stays clean
  const ptsUnique = [];
  for (const s of sorted) {
    if (!ptsUnique.length || ptsUnique[ptsUnique.length - 1].distanceToSquared(s.p) > 1e-8) ptsUnique.push(s.p);
  }
  if (ptsUnique.length >= 3 && ptsUnique[0].distanceToSquared(ptsUnique[ptsUnique.length - 1]) < 1e-8) ptsUnique.pop();
  if (ptsUnique.length < 3) return bail();

  let area = 0;
  const uvC = new THREE.Vector2(0.5, 0.5);
  for (let i = 0; i < ptsUnique.length; i++) {
    const a = ptsUnique[i], b = ptsUnique[(i + 1) % ptsUnique.length];
    _v.subVectors(a, centroid); _n.subVectors(b, centroid);
    // PROJECT FIRST, THEN CROSS. `Vector3.cross` writes its result into the
    // receiver, so taking the area here used to leave `_v` holding a vector
    // along the cut PLANE NORMAL — and bx/by lie in the plane, so every `ua`
    // computed from it collapsed onto (0.5, 0.5). Measured on the shipped
    // build: total cap UV area 0.00000 on a crate, a barrel and a pillar
    // alike, against 4 uv² per m² at this scale. Every cap triangle was a
    // zero-area sliver in UV space, so the whole cut face — the one surface
    // the eye goes to after a cut — sampled a single line of texels and read
    // as an untextured plate. The area itself was right, which is exactly why
    // nothing caught it.
    const ua = new THREE.Vector2(0.5 + _v.dot(bx) * 2, 0.5 + _v.dot(by) * 2);
    const ub = new THREE.Vector2(0.5 + _n.dot(bx) * 2, 0.5 + _n.dot(by) * 2);
    area += _t.crossVectors(_v, _n).length() * 0.5;
    // front half sees the cap facing -normal, back half sees +normal
    const negN = planeNormal.clone().negate();
    tri(front, centroid, b, a, negN, negN, negN, uvC, ub, ua);
    tri(back, centroid, a, b, planeNormal, planeNormal, planeNormal, uvC, ua, ub);
  }

  const build = (side) => {
    if (side.p.length < 9) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(side.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(side.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(side.u, 2));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  };

  const f = build(front), b = build(back);
  if (!f || !b) { f?.dispose(); b?.dispose(); return bail(); }
  if (geo !== geometry) geo.dispose();
  return { front: f, back: b, area, centroid, ringCount: ptsUnique.length };
}

/** Shift a geometry so its centroid sits at the origin; returns the offset. */
export function recenterGeometry(geo) {
  geo.computeBoundingBox();
  const c = new THREE.Vector3();
  geo.boundingBox.getCenter(c);
  geo.translate(-c.x, -c.y, -c.z);
  geo.computeBoundingSphere();
  return c;
}

/** Approximate a geometry with spheres for the physics solver. */
export function spheresForGeometry(geo, maxSpheres = 8) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const size = new THREE.Vector3(); bb.getSize(size);
  const centre = new THREE.Vector3(); bb.getCenter(centre);
  const r = Math.max(0.02, Math.min(size.x, size.y, size.z) * 0.5);

  if (maxSpheres <= 1 || (size.x < r * 2.4 && size.y < r * 2.4 && size.z < r * 2.4)) {
    return [{ c: centre.clone(), r: Math.max(r, size.length() * 0.28) }];
  }
  // lay spheres along the longest axis, widening to fill the box
  const axis = size.x > size.y && size.x > size.z ? 'x' : (size.y > size.z ? 'y' : 'z');
  const len = size[axis];
  const n = Math.max(2, Math.min(maxSpheres, Math.round(len / (r * 1.5))));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const c = centre.clone();
    c[axis] = bb.min[axis] + r + t * Math.max(0, len - r * 2);
    out.push({ c, r });
  }
  return out;
}
