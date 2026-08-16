/**
 * BATTLEFRONT BORZ — destruction, measured.
 *
 * Two complaints, both of them numbers underneath.
 *
 *   "a column for instance would look like a column until you hit it and then
 *    the entire thing would eventually turn into a different destructible model
 *    that volume size looked larger than what it was, just janky"
 *
 * That is the pre-fractured proxy not being the mesh it replaces. Voxelised
 * against the intact solid, it was not close: a stone column's cells summed to
 * 1.88× the volume of the column and its front silhouette to 1.29×, an arch to
 * 4.50×, a ruined gate to 5.85×. Every cell was the Voronoi cell of the piece's
 * BOUNDING BOX clipped to the axis-aligned box of the surface samples it held
 * and then padded outward by a fraction of the cell — six planes and a 16 cm
 * pad, which turns a 1.10 m round shaft into a 1.42 m square post. The pop the
 * player saw was that, arriving all at once on the first hit.
 *
 *   "I would be able to carve parts and it should decide to fall based on the
 *    actual physics, that should apply to everything"
 *
 * There was a flood fill from the ground, and it did run — but connectivity is
 * only half of statics, and nothing could be PARTIALLY cut anyway: a column
 * came out one cell wide, so the blade could only ever take a whole section,
 * and a cut took every cell within 3.24 m of the hit regardless.
 *
 * So these tests measure the solid, not the code: how much space the proxy
 * occupies against how much the mesh did, how much of the mesh it still covers,
 * and whether a carve that leaves the weight over the stone stands while a
 * slightly deeper one does not.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { propMaterials, addColumn, addBrokenWall, addLintel, addArch, addRuin,
  addButtress } from '../../src/world/Props.js';
import { planInside, fractureSolid, polyVolume } from '../../src/world/Destruction.js';
import { BladeContactSolver } from '../../src/game/Combat.js';
import { Saber } from '../../src/game/Saber.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ── a world the Destruction manager is happy in ─────────────────────── */
function host(physics, player) {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], props: [], enemies: [], doors: [], levelLights: [], debris: [],
    physics, particles: null, bladeSolver: null,
    terrain: { height: () => 0, slopeAt: () => 0, inBounds: () => true, friction: 0.9, size: 400,
      normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null },
    player: { position: player || V(0, 1, 0) }, settings: { quality: 'medium' },
    addProp(p) { this.props.push(p); return p; }, addLight(l) { return l; }, onExplosion() {},
  };
}
const ground = () => ({ size: 256, res: 33, heights: new Float32Array(33 * 33), height: () => 0,
  normalAt: (x, z, o) => o.set(0, 1, 0), slopeAt: () => 0, inBounds: () => true, friction: 0.9,
  deformSeq: 0, raycast: () => null });

function build(make, player) {
  const w = new RapierWorld({ gravity: -22 });
  w.terrain = ground();
  const h = host(w, player);
  make(h);
  return { w, host: h, D: h.destruction, s: h.destruction && h.destruction.structures[0] };
}

/* ── measuring the solid ─────────────────────────────────────────────── */

/** Every triangle of the piece, in piece-local space. */
function soup(s) {
  const tris = [];
  for (const sp of s.spans) {
    const g = sp.mesh.geometry;
    const p = g.attributes.position.array;
    const idx = g.index ? g.index.array : null;
    for (let i = sp.i0; i + 2 < sp.i1; i += 3) {
      const a = (idx ? idx[i] : i) * 3, b = (idx ? idx[i + 1] : i + 1) * 3, c = (idx ? idx[i + 2] : i + 2) * 3;
      tris.push([p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]);
    }
  }
  return tris;
}

/**
 * Is (x,y,z) inside the solid? Generalised winding number along +X, counting
 * each crossing by the sign of the triangle's own normal — a Kit emits solids
 * that overlap each other, so plain parity would report a point inside two of
 * them as outside.
 */
function insideSolid(tris, x, y, z) {
  let wind = 0;
  for (let t = 0; t < tris.length; t++) {
    const T = tris[t];
    const y0 = T[1], z0 = T[2], y1 = T[4], z1 = T[5], y2 = T[7], z2 = T[8];
    const d = (z1 - z2) * (y0 - y2) + (y2 - y1) * (z0 - z2);
    if (Math.abs(d) < 1e-12) continue;
    const l0 = ((z1 - z2) * (y - y2) + (y2 - y1) * (z - z2)) / d;
    if (l0 < 0 || l0 > 1) continue;
    const l1 = ((z2 - z0) * (y - y2) + (y0 - y2) * (z - z2)) / d;
    if (l1 < 0 || l1 > 1) continue;
    const l2 = 1 - l0 - l1;
    if (l2 < 0 || l2 > 1) continue;
    if (l0 * T[0] + l1 * T[3] + l2 * T[6] <= x) continue;
    const nx = (T[4] - T[1]) * (T[8] - T[2]) - (T[5] - T[2]) * (T[7] - T[1]);
    if (nx > 0) wind++; else if (nx < 0) wind--;
  }
  return wind > 0;
}

/** Is (x,y,z) inside any cell? Exact — a cell is a convex polyhedron. */
function insideCells(chunks, x, y, z) {
  for (const c of chunks) {
    const poly = c.cell && c.cell.poly;
    if (!poly) continue;
    let ok = true;
    for (const f of poly.faces) {
      const p = f.pts[0];
      if (f.n.x * (x - p.x) + f.n.y * (y - p.y) + f.n.z * (z - p.z) > 1e-6) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Voxelise the intact mesh and the cells over the same grid.
 * Returns volumes, the fraction of the mesh the cells cover, and the ratio of
 * their front silhouettes — which is what the player actually sees pop.
 */
function occupancy(s, res = 40) {
  const tris = soup(s);
  const bb = s.local, size = bb.getSize(new THREE.Vector3());
  const pad = 0.02, n = res;
  const dx = (size.x + pad * 2) / n, dy = (size.y + pad * 2) / n, dz = (size.z + pad * 2) / n;
  const vox = dx * dy * dz;
  let mesh = 0, cells = 0, both = 0;
  const silM = new Uint8Array(n * n), silC = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    const x = bb.min.x - pad + (i + 0.5) * dx;
    for (let j = 0; j < n; j++) {
      const y = bb.min.y - pad + (j + 0.5) * dy;
      for (let k = 0; k < n; k++) {
        const z = bb.min.z - pad + (k + 0.5) * dz;
        const a = insideSolid(tris, x, y, z), b = insideCells(s.chunks, x, y, z);
        if (a) { mesh++; silM[i * n + j] = 1; }
        if (b) { cells++; silC[i * n + j] = 1; }
        if (a && b) both++;
      }
    }
  }
  let sm = 0, sc = 0;
  for (let i = 0; i < n * n; i++) { sm += silM[i]; sc += silC[i]; }
  return {
    mesh: mesh * vox, cells: cells * vox,
    ratio: cells / Math.max(1, mesh),
    covered: both / Math.max(1, mesh),
    sil: sc / Math.max(1, sm),
  };
}

export async function run({ check, assert }) {
  await initPhysics();
  propMaterials();

  /* ══ the proxy is the mesh ═══════════════════════════════════════════ */

  check('destruction: the fractured piece occupies the space the intact one did', () => {
    const rows = [];
    for (const [name, make, maxRatio] of [
      ['column', (h) => addColumn(h, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 500, drift: false }), 1.6],
      ['wall', (h) => addBrokenWall(h, V(0, 0, 0), V(9.4, 8.4, 2.1), { seed: 401, ruin: 0.28 }), 1.75],
      ['lintel', (h) => addLintel(h, V(0, 6.2, 0), { length: 6.4, height: 0.62, depth: 0.72, seed: 3 }), 1.4],
      ['buttress', (h) => addButtress(h, V(0, 0, 0), { seed: 55 }), 1.45],
    ]) {
      const { s } = build(make);
      s.prefracture();
      const o = occupancy(s);
      // Bigger than the mesh is the bug the player reported: the piece grows
      // the instant it is hit. 1.88 on a column before this; the floor is what
      // a 26-plane hull can do round a lathe, about 1.05 per convex lump.
      assert(o.ratio < maxRatio,
        `${name}: the cells fill ${o.ratio.toFixed(2)}× the volume of the mesh they replace`);
      // and smaller is the same bug the other way round — a piece that shrinks
      assert(o.covered > 0.93,
        `${name}: the cells cover only ${(o.covered * 100).toFixed(1)}% of the intact solid`);
      assert(o.sil < 1.25, `${name}: the silhouette grows ${o.sil.toFixed(2)}× on the first hit`);
      rows.push(`${name} ${o.ratio.toFixed(2)}× vol, ${o.sil.toFixed(2)}× sil, ${(o.covered * 100).toFixed(0)}% covered`);
    }
    return rows.join('; ');
  });

  check('destruction: a cell is clipped to the stone it holds, not to its bounding box', () => {
    // The direct statement of the same thing, on a shape with a known answer:
    // a solid cylinder. Sampled all round and fractured, the cells must sum to
    // the cylinder and not to the box it fits in — 4/π = 1.27 apart.
    const R = 0.55, H = 4;
    const pts = [], nrm = [];
    for (let j = 0; j <= 40; j++) {
      const y = (j / 40) * H;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push(Math.cos(a) * R, y, Math.sin(a) * R);
        nrm.push(Math.cos(a), 0, Math.sin(a));
      }
    }
    for (const [y, ny] of [[0, -1], [H, 1]]) {          // and the two end caps
      for (let r = 0; r <= 6; r++) for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2, rr = (r / 6) * R;
        pts.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
        nrm.push(0, ny, 0);
      }
    }
    const bounds = new THREE.Box3(V(-R, 0, -R), V(R, H, R));
    const cells = fractureSolid(bounds, new Float32Array(pts), {
      cell: 1.35, seed: 5, maxCells: 18, normals: new Float32Array(nrm),
    });
    let vol = 0;
    for (const c of cells) vol += polyVolume(c.poly);
    const cyl = Math.PI * R * R * H, box = 4 * R * R * H;
    assert(cells.length >= 4, `${cells.length} cells out of a 4 m cylinder`);
    assert(vol < cyl * 1.16, `the cells are ${(vol / cyl).toFixed(3)}× the cylinder — the box is ${(box / cyl).toFixed(3)}×`);
    assert(vol > cyl * 0.9, `the cells are only ${(vol / cyl).toFixed(3)}× the cylinder — stone has gone missing`);
    return `${cells.length} cells sum to ${vol.toFixed(2)} m³ against the cylinder's ${cyl.toFixed(2)} `
      + `(${(vol / cyl).toFixed(3)}×); its bounding box would be ${(box / cyl).toFixed(3)}×`;
  });

  check('destruction: nothing is one cell wide, so there is such a thing as a partial cut', () => {
    const rows = [];
    for (const [name, make] of [
      ['column', (h) => addColumn(h, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 500, drift: false })],
      ['wall', (h) => addBrokenWall(h, V(0, 0, 0), V(9.4, 8.4, 2.1), { seed: 401, ruin: 0.28 })],
    ]) {
      const { s } = build(make);
      s.prefracture();
      // count distinct cells across the piece's two horizontal axes at mid height
      const y = s.local.min.y + s.size.y * 0.5;
      const at = s.chunks.filter((c) => c.bounds.min.y <= y && c.bounds.max.y >= y);
      const xs = new Set(), zs = new Set();
      for (const c of at) { xs.add(Math.round(c.centre.x * 4)); zs.add(Math.round(c.centre.z * 4)); }
      assert(at.length >= 3, `${name}: only ${at.length} cells across the section at mid height`);
      assert(xs.size >= 2 || zs.size >= 2,
        `${name}: the section at mid height is one cell wide — the blade can only take all of it`);
      rows.push(`${name} ${at.length} cells (${xs.size}×${zs.size}) across the waist`);
    }
    return rows.join('; ');
  });

  /* ══ statics decide what falls ═══════════════════════════════════════ */

  check('destruction: statics, not a rule — the weight has to be over the stone', () => {
    // The support polygon is the convex hull of the contacts still bearing.
    // Four cells across a column: lose one and the weight is still inside the
    // hull of the other three; lose two and it is on the edge of a half.
    const quad = (x, z) => [x, z, x + 1, z, x + 1, z + 1, x, z + 1];
    const three = [...quad(0, 0), ...quad(-1, 0), ...quad(-1, -1)];
    const two = [...quad(-1, 0), ...quad(-1, -1)];
    assert(planInside([...quad(0, 0), ...quad(-1, 0), ...quad(-1, -1), ...quad(0, -1)], 0, 0, 0.06),
      'an uncut section does not hold its own weight');
    assert(planInside(three, 0, 0, 0.06), 'a quarter cut away and the section already lets go');
    assert(!planInside(two, 0, 0, 0.06), 'half the section cut away and the weight is still "supported"');
    assert(planInside(two, -0.5, 0, 0.06), 'weight moved over the half that is left and it still falls');
    return 'full and 3/4 sections carry a centred load; a 1/2 section does not, but carries it re-centred';
  });

  check('destruction: carve a column and how deep decides whether the top falls', () => {
    /* The whole ask, end to end and with a real blade: hold it horizontally
     * into a stone column, sweeping, with the tip reaching a measured depth
     * past the near face, and see what is left standing. Both runs get the same
     * eight and a bit seconds of blade, so the only thing that differs is how
     * far in it reaches. Nothing anywhere knows this is a column: the flood
     * fill and the overturning test read the cells that are left. */
    const R = 0.55, H = 3.4, L = 1.3;
    function carve(depth) {
      const { w, host: h, D, s } = build(
        (hh) => addColumn(hh, V(0, 0, 0), { height: 7.5, radius: R, seed: 500, drift: false }),
        V(-1.4, 3.2, 0));
      const solver = new BladeContactSolver();
      h.bladeSolver = solver;
      s.prepareAll();
      const saber = new Saber(h.scene, { colorIndex: 0, bladeLength: L });
      saber.ignite(); saber.ignition = 1;
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(1, 0, 0));
      /* Tip ends `depth` past the face — and the plasma does not start at the
       * hilt. It starts at the emitter, 15.5 cm up it, so `-R - L + depth` put
       * the tip at `depth + 0.155` past the face and this test was carving 41%
       * and 82% of the section while calling them 27% and 68%. Measured: hilt
       * -1.550 → base -1.395 → tip -0.095, against a face at -0.55. */
      const hiltX = -R + depth - L - saber.emitterY;
      for (let i = 0; i < 500; i++) {
        const dt = 1 / 60;
        saber.setHiltPose(V(hiltX, H, Math.sin(i * dt * 9) * 1.1), q);
        saber.update(dt, dt);
        for (const e of solver.solve(saber,
          [{ id: D.proxy.id, capsules: D.proxy.capsules(), prop: D.proxy, dead: false }], dt, {})) {
          if (e.type === 'cut') D.proxy.cut(e.point, e.normal, e.impulse);
        }
        D.update(dt); w.step(dt);
      }
      for (let i = 0; i < 180; i++) { D.update(1 / 60); w.step(1 / 60); }
      let top = -Infinity, left = 0;
      for (const c of s.chunks) {
        if (c.state !== 'attached') continue;
        left++;
        top = Math.max(top, c.bounds.max.y + s.position.y);
      }
      return { top, left };
    }
    const shallow = carve(0.30), deep = carve(0.75);
    assert(shallow.top > H + 2,
      `a 0.30 m notch in a 1.10 m column dropped everything above it (top left standing y=${shallow.top.toFixed(2)})`);
    assert(deep.top < H,
      `a 0.75 m cut into a 1.10 m column left it standing to y=${deep.top.toFixed(2)}`);
    assert(shallow.top - deep.top > 2,
      `the two depths differ by only ${(shallow.top - deep.top).toFixed(2)} m`);
    return `27% of the section carved away and the column still stands to y=${shallow.top.toFixed(2)} `
      + `(${shallow.left} cells up); 68% and nothing above the cut survives — y=${deep.top.toFixed(2)} `
      + `(${deep.left} cells)`;
  });

  check('destruction: a carrier ground away below a piece stops carrying it', () => {
    // "cut a column and what it holds up falls" — without either piece knowing
    // that the other exists beyond the bearing patch they share.
    const w = new RapierWorld({ gravity: -22 });
    w.terrain = ground();
    const h = host(w);
    addColumn(h, V(-2.6, 0, 0), { height: 6, radius: 0.45, seed: 11, drift: false });
    addColumn(h, V(2.6, 0, 0), { height: 6, radius: 0.45, seed: 12, drift: false });
    addLintel(h, V(0, 6.2, 0), { length: 7.2, height: 0.62, depth: 0.72, seed: 13 });
    const D = h.destruction;
    D._linkSupports();
    const [left, right, lintel] = D.structures;
    assert(lintel.restsOn.length === 2, `the lintel rests on ${lintel.restsOn.length} pieces`);
    assert(lintel.groundedByCarrier(), 'a lintel on two whole columns is not supported');

    // take out the middle of the left column only — its base is untouched
    left.damageSphere(V(-2.6, 3.0, 0), 2.4, 6000);
    assert(left.state !== 'intact', 'the column survived 6000 damage through its middle');
    let base = 0;
    for (const c of left.chunks) if (c.state === 'attached' && c.bounds.max.y < 1.5) base++;
    assert(base > 0, 'the test removed the column\'s base, which is not what it is testing');
    assert(!lintel.groundedByCarrier(),
      'a column with a hole through its middle is still reported as holding up the lintel');
    for (let i = 0; i < 300; i++) { w.step(1 / 60); D.update(1 / 60); }
    const ys = lintel.chunks.filter((c) => c.mesh).map((c) => c.mesh.position.y);
    assert(ys.length, 'the lintel did not come apart at all');
    assert(Math.max(...ys) < 5, `a piece of the lintel is still up at y=${Math.max(...ys).toFixed(2)}`);
    return `${base} cells of the column's base still standing, and the lintel came down anyway `
      + `to y=${Math.max(...ys).toFixed(2)}`;
  });

  check('destruction: the blade fails a piece where the blade is, not at its middle', () => {
    /* Capsules for an unbroken piece used to run the whole length of the
     * maker's collider, and the solver books its cut work per capsule and hands
     * the wear back at the capsule's MIDPOINT — so grinding at the ankles of a
     * 7.5 m column and grinding at its capital both landed the damage at
     * y = 3.9, and the column always failed in the middle. */
    const { D, s } = build((h) => addColumn(h, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 500, drift: false }));
    const out = [];
    const mids = (y) => {
      out.length = 0;
      D.bladeCapsules(V(1.2, y, 0), out);
      const near = out.filter((c) => c.structure === s)
        .map((c) => (c.p0.y + c.p1.y) * 0.5)
        .sort((a, b) => Math.abs(a - y) - Math.abs(b - y));
      return near.length ? near[0] : NaN;
    };
    const low = mids(1.2), high = mids(6.4);
    assert(isFinite(low) && isFinite(high), 'the column published no capsules to the blade');
    assert(Math.abs(low - 1.2) < 1.1, `a blade at y=1.2 gets a capsule centred at y=${low.toFixed(2)}`);
    assert(Math.abs(high - 6.4) < 1.1, `a blade at y=6.4 gets a capsule centred at y=${high.toFixed(2)}`);
    assert(Math.abs(high - low) > 3, 'both ends of the column report the same capsule');
    return `blade at 1.2 m → capsule at ${low.toFixed(2)} m, blade at 6.4 m → ${high.toFixed(2)} m`;
  });

  /* ══ composed pieces ═════════════════════════════════════════════════ */

  check('destruction: a hall\'s own walls and columns break one at a time, for the same draw calls', () => {
    const w = new RapierWorld({ gravity: -22 });
    w.terrain = ground();
    const h = host(w);
    const res = addRuin(h, V(0, 0, 0), { size: 'medium', seed: 2020 });
    const D = h.destruction;
    assert(D && D.structures.length >= 6,
      `a ruined hall registered ${D ? D.structures.length : 0} destructible pieces`);
    // the whole reason this was given up on: it must not cost draw calls
    assert(h.statics.length <= 10, `the hall costs ${h.statics.length} draw calls`);
    // and every piece must own a distinct run of the shared meshes
    const seen = [];
    for (const s of D.structures) {
      assert(s.spans.length, `${s.kind} owns no geometry`);
      for (const sp of s.spans) {
        assert(sp.v1 > sp.v0, 'a piece owns an empty run');
        for (const o of seen) {
          if (o.mesh !== sp.mesh) continue;
          assert(sp.v1 <= o.v0 || sp.v0 >= o.v1,
            'two pieces of the hall claim the same vertices');
        }
        seen.push(sp);
      }
    }
    // break exactly one column and check nothing else in the hall moved
    const col = D.structures.find((s) => s.size.y > 3 && s.size.x < 6 && s.size.z < 6);
    assert(col, 'the hall has no column-shaped piece');
    const before = D.structures.filter((s) => s.state !== 'intact').length;
    col.damageSphere(col.centre, Math.max(2, col.radius * 0.7), 1e5);
    const after = D.structures.filter((s) => s.state !== 'intact').length;
    assert(col.state !== 'intact', 'the column did not break');
    assert(after - before === 1, `breaking one column changed the state of ${after - before} pieces`);
    // the geometry it hid is its own: the rest of the hall still draws
    for (const m of h.statics) assert(m.visible, 'breaking one column hid a whole mesh of the hall');
    return `${D.structures.length} separately destructible pieces in ${h.statics.length} draw calls, `
      + `${res.triangles | 0} triangles; one column broken, ${after - before} piece changed`;
  });

  check('destruction: an arch is one piece, not its own piers plus itself', () => {
    // partClose is recursive-safe and a maker that IS the destructible piece
    // owns everything its sub-makers built — registering both put the same
    // stone in three structures, each of which removed the others' colliders.
    const { D, w } = build((h) => addArch(h, V(0, 0, 0), { span: 5, seed: 33 }));
    assert(D.structures.length === 1, `one arch registered ${D.structures.length} structures`);
    const s = D.structures[0];
    const boxes = w.staticBoxes.length;
    s.prepareAll();
    s.convert();
    assert(w.staticBoxes.length > 0, 'converting the arch left the world with no colliders at all');
    return `1 structure, ${s.chunks.length} cells, ${boxes} collider(s) → ${w.staticBoxes.length} after conversion`;
  });
}
