/**
 * ══════════════════════════════════════════════════════════════════════════
 *  ONE INSTRUMENT, TWO RULES — the occupancy raster rule 4 is measured with
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `station.mjs`'s rule 4 asks how alike two PLACES read from their own doors.
 * The walkway rule asks how alike two stretches of CORRIDOR read from a
 * standing point in them. They are the same question about different
 * geometry, and the moment they are two rasters they are two answers: a
 * threshold tuned against one instrument means nothing measured on the other.
 *
 * So the raster lives here, once, and both read it — the same argument
 * `StationPlan.js` makes for the partition, applied to the ruler.
 *
 * ── WHAT IT DOES ──────────────────────────────────────────────────────────
 *
 * Projects every eighth vertex of the given meshes into a 90° × 60° camera at
 * `eye` looking down `dir`, and fills a 64 × 40 occupancy grid. IoU over two
 * grids is the number `characters.mjs` computes on bodies, over the same
 * range. No GPU — §12.4 says there isn't one.
 *
 * Every eighth vertex: a silhouette is a shape, and 8× the samples moves the
 * IoU by under a percent while costing eight times as much on fifty rooms.
 */

export const W = 64, H = 40;

/**
 * @param THREE   the engine's own copy (the loader's, never node_modules')
 * @param objects an Object3D, or an array of meshes, to project
 * @param eye     {x, y, z} where the camera stands, in world metres
 * @param dir     {x, z} where it looks — need not be normalised
 * @param far     ignore anything beyond this many metres forward (default ∞)
 * @param stride  vertex stride (default 8)
 *
 * Returns `{ bits, on, depth, mats, meshes }`:
 *   bits    the W×H occupancy raster
 *   on      how many of its cells are filled
 *   depth   the nearest thing straight ahead, in metres — how far you can SEE
 *   mats    how many distinct named materials are visible
 *   meshes  how many distinct meshes are visible
 */
export function rasterView(THREE, { objects, eye, dir, far = Infinity, stride = 8 }) {
  const bits = new Uint8Array(W * H);
  const flen = Math.hypot(dir.x, dir.z) || 1;
  const dx = dir.x / flen, dz = dir.z / flen;
  const rx = -dz, rz = dx;                    // the camera's right
  const tanH = Math.tan(Math.PI / 4), tanV = Math.tan(Math.PI / 6);
  const v = new THREE.Vector3();
  const mats = new Set(), seen = new Set();
  let depth = far === Infinity ? 120 : far;
  const list = [];
  if (Array.isArray(objects)) list.push(...objects);
  else objects.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) list.push(o); });
  for (const o of list) {
    if (o.visible === false) continue;
    const pos = o.geometry?.attributes?.position;
    if (!pos) continue;
    o.updateMatrixWorld(true);
    let hit = false;
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const ox = v.x - eye.x, oz = v.z - eye.z, oy = v.y - eye.y;
      const fwd = ox * dx + oz * dz;
      if (fwd < 0.4 || fwd > far) continue;
      const side = ox * rx + oz * rz;
      const u = (side / fwd) / tanH * 0.5 + 0.5;
      const t = (oy / fwd) / tanV * 0.5 + 0.5;
      if (u < 0 || u >= 1 || t < 0 || t >= 1) continue;
      bits[(H - 1 - Math.floor(t * H)) * W + Math.floor(u * W)] = 1;
      hit = true;
      /* HOW FAR YOU CAN SEE: the nearest thing in the middle of the frame and
       * near eye level — a soffit overhead and a floor underfoot are in every
       * view ever taken and say nothing about a sightline. */
      if (Math.abs(u - 0.5) < 0.08 && Math.abs(oy) < 1.6 && fwd < depth) depth = fwd;
    }
    if (hit) {
      seen.add(o);
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) if (m) mats.add(m.name || '(unnamed)');
    }
  }
  let on = 0;
  for (let i = 0; i < bits.length; i++) on += bits[i];
  return { bits, on, depth, mats: mats.size, meshes: seen.size };
}

/** The number `characters.mjs` computes on two bodies, over two rasters. */
export function iou(a, b) {
  let inter = 0, uni = 0;
  for (let k = 0; k < a.length; k++) { if (a[k] & b[k]) inter++; if (a[k] | b[k]) uni++; }
  return uni ? inter / uni : 0;
}

/**
 * ══ WHERE A PERSON ACTUALLY WALKS ═════════════════════════════════════════
 *
 * Forty standing points in the BETWEEN-space of a deck, derived the same way
 * the places are — from band and bearing, so the sample is the station's own
 * organisation and not a list somebody typed:
 *
 *   ring     20 bearings on the outer walk, looking along it both ways
 *   spine    4 spines × 3 radii, looking in and out
 *   rim      8 bearings on the balcony lip, looking along it both ways
 *   tram     every platform's landing (deck 44 only)
 *
 * Each carries the direction of travel; the caller rasters ±.
 */
export function walkPoints(deck, DRUM, PLACES) {
  const pts = [];
  const at = (r, a, tag, tangent) => {
    const sx = Math.sin(a), sz = Math.cos(a);
    pts.push(tangent
      ? { x: r * sx, z: r * sz, dx: Math.cos(a), dz: -Math.sin(a), tag }
      : { x: r * sx, z: r * sz, dx: sx, dz: sz, tag });
  };
  for (let i = 0; i < 20; i++) at(DRUM.ringR, Math.PI * 2 * (i / 20), `ring@${Math.round(360 * i / 20)}`, true);
  for (const deg of DRUM.spines) {
    for (const r of [32, 50, 68]) at(r, deg * Math.PI / 180, `spine${deg}@${r}`, false);
  }
  for (let i = 0; i < 8; i++) at(DRUM.balcony + 1.5, Math.PI * 2 * (i / 8), `rim@${Math.round(360 * i / 8)}`, true);
  for (const p of PLACES) {
    if (p.deck !== deck || p.band !== 'tram') continue;
    const a = Math.atan2(p.door[0], p.door[1]);
    at(Math.hypot(p.door[0], p.door[1]), a, `tram#${p.id}`, true);
  }
  return pts;
}
