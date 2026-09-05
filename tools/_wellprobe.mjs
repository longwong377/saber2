/**
 * THE WELL, THE RAIL AND WHAT IS OVER THE VOID — the lane's own measurement.
 *
 * Three stages, `node tools/_wellprobe.mjs [floor|see|site]` (default all):
 *
 *   floor  raycast a grid over the whole cut region on decks 44 and 48, flood
 *          from the plate outside it at knee height, and report the worst
 *          UNFENCED gap: how far out over the drop a body can walk. This is
 *          the property `Station.railWell` exists for, measured rather than
 *          restated — the fix is arithmetic and a check that repeated the
 *          arithmetic would pass on a build with no rail in it at all.
 *   see    rays from eye height at the viewpoints V15 §1.2 names, to the
 *          obelisk. Reports hits out of samples, and what stopped the ray.
 *   site   every bearing, every band, every size for #56, against
 *          `station.mjs`'s own separating-axis and door tests. This is the
 *          sweep that decided the obelisk cannot be moved to the atrium's rim.
 *
 * ── WHAT IT FOUND, SO THE NUMBERS ARE NOT ONLY IN A COMMIT MESSAGE ────────
 *
 *   floor  before  deck 44 93.8 m² unfenced, 2.61 m out over a 12.5 m drop
 *                  deck 48 149.8 m² unfenced, 3.13 m out over a 25.0 m drop
 *          after   0.0 m² and 0.00 m on both
 *   see    the column's tip went from y=25.00 against a deck-48 floor at
 *          y=25.00 (0.00 m proud) to y=29.00 (4.00 m); from the deck-48 well
 *          rail 10/10 and from deck 44's 9/10, against 0/6 from either
 *          balcony, which no siting fixes — see `site`
 *   site   5040 sitings. The `inner` band, which is the only one with a
 *          sightline through the atrium, returns 0 of 2520.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';

const WANT = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['floor', 'see', 'site']);
const TAU = Math.PI * 2, D2R = Math.PI / 180;

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

async function station(deck) {
  const { bootWorld } = await import('./checks/_coop.mjs');
  const { prepareStation } = await import('../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station', settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  world.scene.updateMatrixWorld(true);
  return world;
}

const { PLACE, PLACES, DECK_Y, DRUM } = await import('../src/game/StationPlan.js');
const p56 = PLACE.get(56);

/* ── The region, exactly as Station.js derives it ─────────────────────── */
function corners(p) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return [[-p.w / 2, -p.d / 2], [p.w / 2, -p.d / 2], [p.w / 2, p.d / 2], [-p.w / 2, p.d / 2]]
    .map(([lx, lz]) => [p.x + lx * c + lz * s, p.z - lx * s + lz * c]);
}
function request(p) {
  const C = corners(p);
  const ac = Math.atan2(p.x, p.z);
  let r1 = -Infinity, a0 = Infinity, a1 = -Infinity;
  for (const [x, z] of C) {
    r1 = Math.max(r1, Math.hypot(x, z));
    const a = ac + ((Math.atan2(x, z) - ac + Math.PI * 3) % TAU) - Math.PI;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a);
  }
  let r0 = Infinity;
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = C[i], [x1, z1] = C[(i + 1) % 4];
    const dx = x1 - x0, dz = z1 - z0;
    const t = Math.max(0, Math.min(1, -(x0 * dx + z0 * dz) / (dx * dx + dz * dz)));
    r0 = Math.min(r0, Math.hypot(x0 + t * dx, z0 + t * dz));
  }
  return { r0, r1, a0, a1 };
}
/* What `annulus` at n segments actually removes from that request. */
function madeCut(box, n) {
  const step = TAU / n;
  const i0 = Math.floor(box.a0 / step - 0.5) + 1, i1 = Math.ceil(box.a1 / step - 0.5) - 1;
  if (i1 < i0) return null;
  return { a0: i0 * step, a1: (i1 + 1) * step, r0: box.r0, r1: box.r1 };
}

if (WANT.has('floor') || WANT.has('see')) {
  const box = request(p56), cut = madeCut(box, 72);
  console.log(`#56 at (${p56.x.toFixed(1)}, ${p56.z.toFixed(1)}) r=${Math.hypot(p56.x, p56.z).toFixed(2)} `
    + `${p56.w}x${p56.d}x${p56.h} yaw=${(p56.yaw / D2R).toFixed(0)}°`);
  console.log(`request  a ${(box.a0 / D2R).toFixed(2)}..${(box.a1 / D2R).toFixed(2)}°  r ${box.r0.toFixed(2)}..${box.r1.toFixed(2)}`);
  console.log(`cut@72   a ${(cut.a0 / D2R).toFixed(2)}..${(cut.a1 / D2R).toFixed(2)}°  r ${cut.r0.toFixed(2)}..${cut.r1.toFixed(2)}`
    + `  = ${((cut.a1 - cut.a0) / 2 * (cut.r1 ** 2 - cut.r0 ** 2)).toFixed(1)} m² against a ${(p56.w * p56.d).toFixed(0)} m² footprint`);
}

/* ══ STAGE `floor` ═══════════════════════════════════════════════════════ */
/**
 * A TRIANGLE INDEX, because the honest ray is unaffordable without one.
 *
 * The deck is nine MERGED meshes — one per material for the whole drum — so
 * `Raycaster.intersectObjects` tests every triangle of the ring against every
 * ray: 31 000 rays x 50 000 triangles is half an hour a deck and the first cut
 * of this probe was still running after fifteen minutes. So the scene's real
 * triangles are pulled out once, in world space, and binned by XZ. The rays
 * below are the same rays against the same geometry; only the search is fast.
 */
function triangleIndex(world, lo, hi) {
  const CELL = 1.0;
  const bins = new Map();
  const tris = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const m = new THREE.Matrix4();
  const push = (o, mat) => {
    const g = o.geometry, pos = g?.attributes?.position;
    if (!pos) return;
    const idx = g.index, n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(mat);
      }
      const x0 = Math.min(v[0].x, v[1].x, v[2].x), x1 = Math.max(v[0].x, v[1].x, v[2].x);
      const z0 = Math.min(v[0].z, v[1].z, v[2].z), z1 = Math.max(v[0].z, v[1].z, v[2].z);
      if (x1 < lo.x || x0 > hi.x || z1 < lo.z || z0 > hi.z) continue;
      const t = [v[0].clone(), v[1].clone(), v[2].clone()];
      const id = tris.push(t) - 1;
      for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
        for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
          const key = ix * 100000 + iz;
          let b = bins.get(key); if (!b) bins.set(key, b = []);
          b.push(id);
        }
      }
    }
  };
  world.scene.traverse((o) => {
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); push(o, m.premultiply(o.matrixWorld)); }
    } else if (o.isMesh) push(o, o.matrixWorld);
  });
  const at = (x, z) => bins.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL)) || [];
  /* Straight down from (x, yTop): the highest triangle under the foot. */
  const floorY = (x, z, yTop) => {
    let best = -Infinity;
    for (const id of at(x, z)) {
      const [a, b, c] = tris[id];
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(d) < 1e-9) continue;
      const w0 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
      const w1 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const y = w0 * a.y + w1 * b.y + w2 * c.y;
      if (y <= yTop && y > best) best = y;
    }
    return best;
  };
  /* Möller–Trumbore over the cells a short segment crosses. */
  const E1 = new THREE.Vector3(), E2 = new THREE.Vector3(), P = new THREE.Vector3(),
    T = new THREE.Vector3(), Q = new THREE.Vector3(), D = new THREE.Vector3();
  const hitSeg = (x0, z0, x1, z1, y) => {
    D.set(x1 - x0, 0, z1 - z0);
    const len = D.length(); if (len < 1e-9) return false;
    D.multiplyScalar(1 / len);
    const cells = new Set();
    for (let t = 0; t <= 1.0001; t += 0.25) {
      cells.add(Math.floor((x0 + (x1 - x0) * t) / CELL) * 100000 + Math.floor((z0 + (z1 - z0) * t) / CELL));
    }
    for (const key of cells) {
      for (const id of bins.get(key) || []) {
        const [a, b, c] = tris[id];
        E1.subVectors(b, a); E2.subVectors(c, a);
        P.crossVectors(D, E2);
        const det = E1.dot(P);
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det;
        T.set(x0 - a.x, y - a.y, z0 - a.z);
        const u = T.dot(P) * inv; if (u < 0 || u > 1) continue;
        Q.crossVectors(T, E1);
        const vv = D.dot(Q) * inv; if (vv < 0 || u + vv > 1) continue;
        const d = E2.dot(Q) * inv;
        if (d > 1e-4 && d < len) return true;
      }
    }
    return false;
  };
  return { floorY, hitSeg, count: tris.length };
}

/**
 * The property `railWell` exists for, measured: over the whole cut region,
 * how far out over the drop can a body get without a rail between it and the
 * void? Grid the region, raycast DOWN at every cell to say what is under the
 * foot, then flood from the plate outside the region at KNEE height, which is
 * the only thing a rail does. Anything the flood reaches that has no floor
 * under it is unfenced.
 */
async function measureFloor(deck, cut, { cell = 0.3, margin = 5 } = {}) {
  const world = await station(deck);
  const y = DECK_Y[deck];
  const A0 = cut.a0 - margin / cut.r1, A1 = cut.a1 + margin / cut.r1;
  const R0 = Math.max(DRUM.atrium + 0.2, cut.r0 - margin), R1 = Math.min(DRUM.R - 0.2, cut.r1 + margin);
  const pad = 2;
  const box = { lo: { x: -R1 - pad, z: -R1 - pad }, hi: { x: R1 + pad, z: R1 + pad } };
  let lox = Infinity, hix = -Infinity, loz = Infinity, hiz = -Infinity;
  for (const a of [A0, A1]) for (const r of [R0, R1]) { const x = r * Math.sin(a), z = r * Math.cos(a); lox = Math.min(lox, x); hix = Math.max(hix, x); loz = Math.min(loz, z); hiz = Math.max(hiz, z); }
  box.lo = { x: lox - pad, z: loz - pad }; box.hi = { x: hix + pad, z: hiz + pad };
  const ix = triangleIndex(world, box.lo, box.hi);

  const nA = Math.ceil((A1 - A0) * ((R0 + R1) / 2) / cell), nR = Math.ceil((R1 - R0) / cell);
  const grid = [];
  for (let i = 0; i <= nA; i++) {
    const a = A0 + (A1 - A0) * (i / nA), row = [];
    for (let j = 0; j <= nR; j++) {
      const r = R0 + (R1 - R0) * (j / nR);
      const x = r * Math.sin(a), z = r * Math.cos(a);
      row.push({ x, z, drop: y - ix.floorY(x, z, y + 1.2) });
    }
    grid.push(row);
  }
  const cellArea = ((A1 - A0) / nA) * ((R0 + R1) / 2) * ((R1 - R0) / nR);
  const floors = [], voids = [];
  for (const row of grid) for (const p of row) (p.drop < 0.6 ? floors : voids).push(p);

  const key = (i, j) => i * 100000 + j;
  const seen = new Set(), q = [];
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      const edge = i === 0 || i === grid.length - 1 || j === 0 || j === grid[i].length - 1;
      if (edge && grid[i][j].drop < 0.6) { seen.add(key(i, j)); q.push([i, j]); }
    }
  }
  for (let head = 0; head < q.length; head++) {
    const [i, j] = q[head];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= grid.length || nj >= grid[0].length) continue;
      if (seen.has(key(ni, nj))) continue;
      const p = grid[i][j], t = grid[ni][nj];
      /* Both ways, and at two heights: a ray that starts inside a rail post
       * leaves through a back face, which three.js and this both cull. */
      if (ix.hitSeg(p.x, p.z, t.x, t.z, y + 0.5) || ix.hitSeg(t.x, t.z, p.x, p.z, y + 0.5)
        || ix.hitSeg(p.x, p.z, t.x, t.z, y + 0.9) || ix.hitSeg(t.x, t.z, p.x, p.z, y + 0.9)) continue;
      seen.add(key(ni, nj)); q.push([ni, nj]);
    }
  }
  const unfenced = [];
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) if (seen.has(key(i, j)) && grid[i][j].drop >= 0.6) unfenced.push(grid[i][j]);
  }
  let worst = 0, at = null;
  for (const v of unfenced) {
    let best = Infinity;
    for (const f of floors) { const d = Math.hypot(v.x - f.x, v.z - f.z); if (d < best) best = d; }
    v.clear = best;
    if (best > worst) { worst = best; at = v; }
  }
  world.dispose?.();
  return { y, grid: [grid.length, nR + 1], tris: ix.count, cellArea, voids, floors, unfenced, worst, at, cut };
}

if (WANT.has('floor')) {
  const cut = madeCut(request(p56), 72);
  for (const deck of [44, 48]) {
    const m = await measureFloor(deck, cut);
    console.log(`\ndeck ${deck}: floorAt=${m.y.toFixed(2)}  grid ${m.grid[0]}x${m.grid[1]} @ 0.3 m, `
      + `cell ${m.cellArea.toFixed(3)} m², ${m.tris} triangles indexed`);
    console.log(`  hole ${m.voids.length} cells (${(m.voids.length * m.cellArea).toFixed(1)} m²), plate ${m.floors.length} cells`);
    console.log(`  UNFENCED ${m.unfenced.length} cells (${(m.unfenced.length * m.cellArea).toFixed(1)} m²), `
      + `WORST GAP ${m.worst.toFixed(2)} m`
      + (m.at ? ` at (${m.at.x.toFixed(1)}, ${m.at.z.toFixed(1)}) over ${m.at.drop.toFixed(2)} m of drop` : ''));
    /* WHERE they are, in the cut's own frame, so a residual can be told apart:
     * inside the cut is an unrailed hole, outside it is a gap in the plate. */
    const inCut = m.unfenced.filter((v) => {
      const r = Math.hypot(v.x, v.z), a = Math.atan2(v.x, v.z);
      return r >= cut.r0 && r <= cut.r1 && a >= cut.a0 && a <= cut.a1;
    });
    console.log(`    of those, ${inCut.length} are inside the cut and ${m.unfenced.length - inCut.length} outside it`);
    const sample = m.unfenced.slice(0, 400).sort((a, b) => b.clear - a.clear).slice(0, 6);
    for (const v of sample) {
      console.log(`      (${v.x.toFixed(1)}, ${v.z.toFixed(1)})  r=${Math.hypot(v.x, v.z).toFixed(2)}  `
        + `a=${(Math.atan2(v.x, v.z) / D2R).toFixed(2)}°  drop ${v.drop.toFixed(2)}  clear ${v.clear.toFixed(2)} m`);
    }
  }
}

/* ══ STAGE `see` ═════════════════════════════════════════════════════════ */
if (WANT.has('see')) {
  const cut = madeCut(request(p56), 72);
  const at = (r, aDeg) => [r * Math.sin(aDeg * D2R), r * Math.cos(aDeg * D2R)];
  /* The rail stands on the plate at cut.r0 - 0.12, cut.r1 + 0.12 and the two
   * bearings; a viewer AT the rail is a step back from it, on solid floor. */
  const upper = [
    ['at the well rail, outer arc', ...at(cut.r1 + 1.2, 15)],
    ['at the well rail, east side', ...at((cut.r0 + cut.r1) / 2, 21.4)],
    ['the balcony (atrium lip)', ...at(27, 13.08)],
  ];
  const spots = {
    40: [
      ["inside #56's hall", p56.x - 4 * Math.sin(p56.yaw), p56.z - 4 * Math.cos(p56.yaw)],
      ['the Concourse floor, 27 m out', 0, 27],
      ['the Concourse floor, 45 m out', 0, 45],
      ["the atrium lip at #56's bearing", ...at(19, 13.08)],
      ['the balcony across the void', ...at(19, 193.08)],
    ],
    44: upper,
    48: upper,
  };
  for (const deck of [40, 44, 48]) {
    const world = await station(deck);
    const st = world._station, y = DECK_Y[deck];
    const g = st.obelisk?.group3;
    const own = new Set(); if (g) g.traverse((o) => own.add(o));
    const targets = [];
    world.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !own.has(o)) targets.push(o); });
    const cols = []; if (g) g.traverse((o) => { if (o.isMesh) cols.push(o); });
    const R = new THREE.Raycaster(); R.far = 400;
    const box = new THREE.Box3();
    let capY = -Infinity;
    for (const m of cols) { box.setFromObject(m); capY = Math.max(capY, box.max.y); }
    console.log(`\ndeck ${deck}: column tip y=${capY.toFixed(2)}, deck floor y=${y.toFixed(2)} `
      + `→ ${(capY - y).toFixed(2)} m proud of this deck`);
    if (!cols.length) { console.log('  no column on this deck'); world.dispose?.(); continue; }
    for (const [tag, ex, ez] of spots[deck]) {
      let hits = 0, n = 0, blockers = new Map();
      for (let i = 0; i < 10; i++) {
        const ty = Math.max(y + 0.5, capY - 0.6 - i * ((capY - (st.obelisk.y + 0.6)) / 12));
        if (ty < y - 0.4) continue;
        n++;
        const from = new THREE.Vector3(ex, y + 1.6, ez);
        const to = new THREE.Vector3(st.obelisk.x, ty, st.obelisk.z);
        const dir = to.clone().sub(from); const len = dir.length(); dir.normalize();
        R.set(from, dir); R.far = len - 1.6;
        const h = R.intersectObjects(targets, false)[0];
        R.far = 400;
        if (!h) hits++;
        else blockers.set(h.object.name || '(unnamed)', (blockers.get(h.object.name || '(unnamed)') | 0) + 1);
      }
      const why = [...blockers].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k}×${v}`).join(', ');
      console.log(`  ${tag.padEnd(32)} ${hits}/${n}${why ? '   blocked by ' + why : ''}`);
    }
    world.dispose?.();
  }
}

/* ══ STAGE `site` ════════════════════════════════════════════════════════ */
if (WANT.has('site')) {
  const { wayPlacesOn } = await import('../src/game/StationLife.js');
  const overlap = (A, B, slack = 0.5) => {
    let least = Infinity;
    for (const poly of [A, B]) {
      for (let i = 0; i < 4; i++) {
        const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % 4];
        const len = Math.hypot(x1 - x0, z1 - z0) || 1;
        const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const [x, z] of A) { const d = x * nx + z * nz; if (d < a0) a0 = d; if (d > a1) a1 = d; }
        for (const [x, z] of B) { const d = x * nx + z * nz; if (d < b0) b0 = d; if (d > b1) b1 = d; }
        const gap = Math.min(a1, b1) - Math.max(a0, b0);
        if (gap < least) least = gap;
        if (gap <= slack) return 0;
      }
    }
    return least;
  };
  const inside = (p, x, z, pad = 0) => {
    const dx = x - p.x, dz = z - p.z, c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    return Math.abs(dx * c - dz * sn) <= p.w / 2 + pad && Math.abs(dx * sn + dz * c) <= p.d / 2 + pad;
  };
  const on = (d) => PLACES.filter((p) => p.deck === d && !p.external && p.band !== 'ring' && p.w && p.id !== 56);
  const P = { 40: on(40), 44: on(44), 48: on(48) };
  const rimsOf = (d) => wayPlacesOn(d).filter((w) => Math.abs(Math.hypot(w.x, w.z) - (DRUM.balcony + 2)) < 0.01);
  const RIM = { 40: rimsOf(40), 44: rimsOf(44), 48: rimsOf(48) };
  const norm = (v) => ((v % TAU) + TAU) % TAU;
  /* A cut that takes a spine corridor's floor, or the floor a rim fixture
   * stands on, is a cut that puts a walkway over the void — the same defect
   * one deck along. */
  const fouls = (cut, deck) => {
    const bad = [];
    for (const deg of DRUM.spines) {
      const a = norm(deg * D2R);
      for (let r = Math.max(cut.r0, DRUM.balcony); r <= Math.min(cut.r1, DRUM.roomR); r += 0.5) {
        const half = Math.asin(Math.min(1, (DRUM.spineW / 2) / r));
        if (norm(cut.a1) > a - half && norm(cut.a0) < a + half) { bad.push(`spine ${deg}°`); break; }
      }
    }
    for (const w of RIM[deck]) {
      const a = norm(Math.atan2(w.x, w.z)), r = Math.hypot(w.x, w.z);
      const half = Math.asin(Math.min(1, (w.w / 2 + 1) / r));
      if (r > cut.r0 - 2.5 && r < cut.r1 + 2.5 && a + half > norm(cut.a0) && a - half < norm(cut.a1)) bad.push(`rim ${(a / D2R).toFixed(0)}°`);
    }
    return bad;
  };
  const mk = {
    inner: (at, w, d) => { const a = at * D2R, r = DRUM.balcony + d / 2; return { id: 56, deck: 40, w, d, x: r * Math.sin(a), z: r * Math.cos(a), yaw: a + Math.PI }; },
    outer: (at, w, d) => { const a = at * D2R, r = DRUM.roomR - d / 2; return { id: 56, deck: 40, w, d, x: r * Math.sin(a), z: r * Math.cos(a), yaw: a }; },
  };
  const SIZES = [[12, 11], [10, 10], [9, 12], [8, 14], [7, 7], [12, 14], [14, 12]];
  const runs = new Map();
  let tried = 0;
  for (const band of ['inner', 'outer']) {
    for (const [w, d] of SIZES) {
      const ok = [];
      for (let at = 0; at < 360; at++) {
        tried++;
        const p = mk[band](at, w, d), C = corners(p);
        if (P[40].some((q) => overlap(C, corners(q)) > 0)) continue;
        let rmin = Infinity, rmax = 0;
        for (const [x, z] of C) { const r = Math.hypot(x, z); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
        if (rmin < DRUM.atrium || rmax > DRUM.R) continue;
        if (RIM[40].some((f) => inside(p, f.x, f.z, 3))) continue;
        if (P[44].some((q) => inside(q, p.x, p.z, 3))) continue;
        if (P[48].some((q) => inside(q, p.x, p.z, 3))) continue;
        const cut = madeCut(request(p), 72);
        if (!cut) continue;
        if (fouls(cut, 44).length || fouls(cut, 48).length) continue;
        ok.push(at);
      }
      if (ok.length) runs.set(`${band} ${w}x${d}`, ok);
    }
  }
  console.log(`\nsiting sweep: ${tried} sitings tried (2 bands × ${SIZES.length} sizes × 360 bearings)`);
  if (!runs.size) console.log('  NO SITING PASSES');
  for (const [k, ats] of runs) {
    const g = []; let s = null, prev = null;
    for (const a of ats) { if (prev === null || a !== prev + 1) { if (s !== null) g.push([s, prev]); s = a; } prev = a; }
    if (s !== null) g.push([s, prev]);
    console.log(`  ${k.padEnd(14)} ${g.map(([a, b]) => `${a}°..${b}°`).join('  ')}`);
  }
}
process.exit(0);
