#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════════════════
 *  GLB → .smesh — the station's imported rooms, decoded ONCE, here
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `SHARK.md` §5.1 says: vendor three r169's `GLTFLoader` and `DRACOLoader`,
 * vendor the draco wasm, teach `pack.mjs` `.glb` and `.wasm`, and build the
 * decoder path as a blob URL out of the inlined base64 at boot.
 *
 * THIS FILE IS THE SAME OUTCOME BOUGHT CHEAPER, and the reason is measured
 * rather than felt. What §5.1 is actually for is four things: the rooms'
 * geometry in the game, the engine's own materials on them, our own colliders,
 * and the floor at zero — with no CDN and no network at runtime (§12.1). None
 * of the four needs a loader in the browser.
 *
 *   the draco path   a 700 kB decoder wasm + a JS shim + `GLTFLoader`
 *                    (~120 kB) inlined as base64, a blob URL assembled at
 *                    boot, a decode of every room on the frame the level
 *                    loads, and a `MeshStandardMaterial` per primitive that
 *                    §9.1 then has to prove was thrown away.
 *   this path        the decode happens here, once, on a workstation. The
 *                    game reads a flat typed-array file with a 90-line reader
 *                    and no dependency at all. Nothing to vendor, no wasm, no
 *                    blob URL, and a loader material can never exist to be
 *                    left behind by accident.
 *
 * The handoff carries BOTH forms — `handoff/*.glb` is plain glTF 2.0 and
 * `handoff/draco/*.glb` is the same geometry compressed — and the plain one
 * needs no decoder at all: a GLB is a JSON chunk and a binary chunk, and an
 * accessor is a typed-array view into the second. So this tool has no
 * dependencies either.
 *
 * ── WHAT COMES OUT ────────────────────────────────────────────────────────
 *
 * One `.smesh` per room. Positions quantised to int16 across the file's own
 * bounds (1.0 mm on the Zocalo's 67 m length) and welded flat, with indices
 * part-local so they fit uint16. The parts keep THEIR NAMES, which is the
 * load-bearing part: `Station.js` binds `zoc_rib_*`, `wall_*`, `light_*` onto
 * the engine's own `deckMats` by prefix, and a part whose name was lost in
 * conversion is a part that cannot be given a material.
 *
 * The rooms arrive with the floor moved to y = 0 (SHARK §1.1: "measure bbox
 * min y and put the floor at 0") and with `placement` from the handoff README
 * ignored, because that is about their station and not ours.
 *
 * ── RUN IT ────────────────────────────────────────────────────────────────
 *
 *   node tools/glbmesh.mjs <in.glb> <out.smesh> [--drop pref,pref] [--keep …]
 *                          [--decimate N] [--scale S] [--report]
 *
 * The checked-in assets under `assets/station/` were made by `tools/station-
 * assets.sh`, which is the exact command line for each and is what to re-run
 * if a room is ever re-exported.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Read a .glb into { json, bin }. Plain glTF 2.0 only — draco is not decoded
 * here and does not need to be; the handoff ships both forms. */
export function readGlb(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${file}: not a GLB`);
  const total = buf.readUInt32LE(8);
  let off = 12, json = null, bin = null;
  while (off + 8 <= Math.min(total, buf.length)) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(body.toString('utf8'));
    else if (type === CHUNK_BIN) bin = body;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error(`${file}: no JSON chunk`);
  if (json.extensionsRequired?.length) {
    throw new Error(`${file}: needs ${json.extensionsRequired.join(', ')} — use the uncompressed copy in handoff/, not handoff/draco/`);
  }
  return { json, bin };
}

const COMPONENT = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array,
  5125: Uint32Array, 5126: Float32Array,
};
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** An accessor as a plain typed array, de-interleaved if it has to be. */
function accessor(g, bin, i) {
  const a = g.accessors[i];
  const T = COMPONENT[a.componentType];
  const n = NUM[a.type];
  if (a.bufferView === undefined) return new T(a.count * n);
  const bv = g.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || 0;
  if (!stride || stride === n * T.BYTES_PER_ELEMENT) {
    /* `bin.buffer` is the whole file; `bin.byteOffset` is where the chunk
     * starts in it. Forgetting the second reads the JSON chunk as floats. */
    return new T(bin.buffer, bin.byteOffset + base, a.count * n);
  }
  const out = new T(a.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset);
  const get = T === Float32Array ? (o) => dv.getFloat32(o, true)
    : T === Uint32Array ? (o) => dv.getUint32(o, true)
      : T === Uint16Array ? (o) => dv.getUint16(o, true)
        : T === Int16Array ? (o) => dv.getInt16(o, true)
          : (o) => dv.getUint8(o);
  for (let e = 0; e < a.count; e++) {
    for (let c = 0; c < n; c++) out[e * n + c] = get(base + e * stride + c * T.BYTES_PER_ELEMENT);
  }
  return out;
}

/** A node's local matrix, column-major, as a length-16 array. */
function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function mulMat(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/**
 * Walk the scene graph and flatten every primitive into world space, grouped
 * by the NAME of the node (or its mesh) it came from.
 *
 * Grouped by name and not by node, because the handoff exports one node per
 * material-ish part and the material table in `Station.js` keys on that name:
 * two nodes called `zoc_rib_arch` are one part here, which is one draw call
 * there.
 */
export function flatten(glb) {
  const { json: g, bin } = glb;
  const parts = new Map();
  const visit = (idx, parent) => {
    const node = g.nodes[idx];
    const m = mulMat(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = g.meshes[node.mesh];
      const name = node.name || mesh.name || `mesh_${node.mesh}`;
      let part = parts.get(name);
      if (!part) parts.set(name, part = { name, pos: [], nor: [], idx: [], verts: 0 });
      for (const prim of mesh.primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        const P = accessor(g, bin, prim.attributes.POSITION);
        const N = prim.attributes.NORMAL !== undefined ? accessor(g, bin, prim.attributes.NORMAL) : null;
        const count = P.length / 3;
        const base = part.verts;
        for (let v = 0; v < count; v++) {
          const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
          part.pos.push(
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
          );
          if (N) {
            const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
            let ax = m[0] * nx + m[4] * ny + m[8] * nz;
            let ay = m[1] * nx + m[5] * ny + m[9] * nz;
            let az = m[2] * nx + m[6] * ny + m[10] * nz;
            const len = Math.hypot(ax, ay, az) || 1;
            part.nor.push(ax / len, ay / len, az / len);
          } else part.nor.push(0, 1, 0);
        }
        if (prim.indices !== undefined) {
          const I = accessor(g, bin, prim.indices);
          for (let i = 0; i < I.length; i++) part.idx.push(I[i] + base);
        } else {
          for (let i = 0; i < count; i++) part.idx.push(i + base);
        }
        part.verts += count;
      }
    }
    for (const c of node.children || []) visit(c, m);
  };
  const scene = g.scenes?.[g.scene ?? 0];
  const roots = scene?.nodes || g.nodes.map((_, i) => i);
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const r of roots) visit(r, I4);
  return [...parts.values()];
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE FILE                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * `SMSH` — a JSON header and one binary blob, the same two-chunk shape a GLB
 * has, because it is the shape that survives being appended to.
 *
 *   magic   'SMSH'          u32
 *   version 2               u32
 *   jsonLen                 u32
 *   json    { quant, bounds, flat, parts:[{name,vOff,vCount,iOff,iCount}] }
 *   pad to 4
 *   int16   positions, 3 per vertex, all parts back to back
 *   uint16  indices,   PART-LOCAL, all parts back to back   (padded to 4)
 *
 * ── AND NO NORMALS, WHICH IS MOST OF THE FILE ─────────────────────────────
 *
 * Every room in the handoff is exported fully non-indexed with one normal per
 * face — the Zocalo is 295 140 vertices for 98 380 triangles, 3.00 exactly,
 * and 60 878 distinct positions. So the geometry is FACETED at source, and a
 * stored normal is a stored copy of something the triangle already says.
 *
 *   raw, as exported                295 140 verts
 *   welded on (position, normal)    155 363 verts   2 522 kB
 *   welded on position, flat        60 878 verts      933 kB
 *
 * The third row is the same picture: `flatShading` on the material takes the
 * face normal from the derivative of the position, which for a faceted mesh IS
 * the exported normal. It also suits the cel pass better than a stored one —
 * `Toon.js` records that a smooth normal under the two-tone terminator
 * speckles, and a per-face normal cannot.
 *
 * `--normals` keeps them for anything that ever turns out to be genuinely
 * smooth; the reader honours the header either way.
 *
 * Positions are quantised across the FILE's bounds, so a part can be drawn on
 * its own with the file's one dequantisation. Indices are part-local, so every
 * part gets a uint16 buffer as long as no single part passes 65 535 vertices —
 * which halves the index buffer against a file-global uint32 one.
 */
export function writeSmesh(parts, out, opts = {}) {
  const scale = opts.scale ?? 1;
  const keepNormals = !!opts.normals;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    for (let i = 0; i < p.pos.length; i += 3) {
      const x = p.pos[i] * scale, y = p.pos[i + 1] * scale, z = p.pos[i + 2] * scale;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  /**
   * THE FLOOR GOES TO ZERO HERE (SHARK §1.1). The rooms are upright in their
   * own frames and the handoff's `placement` is about THEIR station; ours puts
   * a room's lowest point on the deck it stands on, and `Station.js` then only
   * ever has to know an (x, z, yaw).
   */
  const lift = opts.floorAtZero === false ? 0 : -minY;
  minY += lift; maxY += lift;
  for (const p of parts) {
    if (scale !== 1 || lift) {
      for (let i = 0; i < p.pos.length; i += 3) {
        p.pos[i] *= scale;
        p.pos[i + 1] = p.pos[i + 1] * scale + lift;
        p.pos[i + 2] *= scale;
      }
    }
  }
  const span = [Math.max(1e-4, maxX - minX), Math.max(1e-4, maxY - minY), Math.max(1e-4, maxZ - minZ)];
  const qmin = [minX, minY, minZ];
  const qs = [65534 / span[0], 65534 / span[1], 65534 / span[2]];
  /* Encoded about the centre so both halves of the int16 range are used. */
  const enc = (v, c) => Math.max(-32767, Math.min(32767, Math.round((v - qmin[c]) * qs[c]) - 32767));

  const welded = parts.map(p => ({ name: p.name, ...weldPart(p, enc, keepNormals) }));

  let vTotal = 0, iTotal = 0, widest = 0;
  for (const w of welded) {
    vTotal += w.pos.length / 3;
    iTotal += w.idx.length;
    widest = Math.max(widest, w.pos.length / 3);
  }
  const wide = widest > 65535;
  const header = {
    version: 2,
    quant: { min: qmin, span, bias: 32767, range: 65534 },
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    flat: !keepNormals,
    wide,
    parts: [],
  };
  let vOff = 0, iOff = 0;
  for (const w of welded) {
    const b = w.bounds;
    header.parts.push({ name: w.name, vOff, vCount: w.pos.length / 3, iOff, iCount: w.idx.length, min: b.min, max: b.max });
    vOff += w.pos.length / 3;
    iOff += w.idx.length;
  }
  const jsonBuf = Buffer.from(JSON.stringify(header), 'utf8');
  const pad = (n) => (4 - (n % 4)) % 4;
  const posBytes = vTotal * 6;
  const norBytes = keepNormals ? vTotal * 3 : 0;
  const idxBytes = iTotal * (wide ? 4 : 2);
  const size = 12 + jsonBuf.length + pad(jsonBuf.length) + posBytes + pad(posBytes)
    + norBytes + pad(norBytes) + idxBytes;
  const buf = Buffer.alloc(size);
  buf.write('SMSH', 0, 'ascii');
  buf.writeUInt32LE(2, 4);
  buf.writeUInt32LE(jsonBuf.length, 8);
  jsonBuf.copy(buf, 12);
  let o = 12 + jsonBuf.length + pad(jsonBuf.length);
  for (const w of welded) for (let i = 0; i < w.pos.length; i++) { buf.writeInt16LE(w.pos[i], o); o += 2; }
  o += pad(posBytes);
  if (keepNormals) {
    for (const w of welded) for (let i = 0; i < w.nor.length; i++) { buf.writeInt8(w.nor[i], o); o += 1; }
    o += pad(norBytes);
  }
  for (const w of welded) {
    for (let i = 0; i < w.idx.length; i++) {
      if (wide) { buf.writeUInt32LE(w.idx[i], o); o += 4; } else { buf.writeUInt16LE(w.idx[i], o); o += 2; }
    }
  }
  if (o !== size) throw new Error(`smesh: wrote ${o} of ${size}`);
  writeFileSync(out, buf);
  return { size, parts: welded.length, verts: vTotal, tris: iTotal / 3, bounds: header.bounds };
}

/**
 * Weld one part and quantise it. The weld key is the QUANTISED position, so
 * welding and the encoding agree: two vertices that land on the same integer
 * are the same vertex, and a crack cannot open between them later.
 */
function weldPart(part, enc, keepNormals) {
  const map = new Map();
  const pos = [], nor = [], idx = new Array(part.idx.length);
  const P = part.pos, N = part.nor;
  let n0 = Infinity, n1 = Infinity, n2 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < part.idx.length; i++) {
    const v = part.idx[i];
    const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
    if (px < n0) n0 = px; if (px > x1) x1 = px;
    if (py < n1) n1 = py; if (py > y1) y1 = py;
    if (pz < n2) n2 = pz; if (pz > z1) z1 = pz;
    const qx = enc(px, 0), qy = enc(py, 1), qz = enc(pz, 2);
    let key = ((qx + 32768) * 65536 + (qy + 32768)) * 65536 + (qz + 32768);
    if (keepNormals) {
      key += ':' + Math.round(N[v * 3] * 127) + ',' + Math.round(N[v * 3 + 1] * 127) + ',' + Math.round(N[v * 3 + 2] * 127);
    }
    let at = map.get(key);
    if (at === undefined) {
      at = pos.length / 3;
      map.set(key, at);
      pos.push(qx, qy, qz);
      if (keepNormals) {
        nor.push(
          Math.max(-127, Math.min(127, Math.round(N[v * 3] * 127))),
          Math.max(-127, Math.min(127, Math.round(N[v * 3 + 1] * 127))),
          Math.max(-127, Math.min(127, Math.round(N[v * 3 + 2] * 127))),
        );
      }
    }
    idx[i] = at;
  }
  return { pos, nor, idx, bounds: { min: [n0, n1, n2], max: [x1, y1, z1] } };
}

/* ══════════════════════════════════════════════════════════════════════════ */

function main(argv) {
  const args = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      if (k === 'report' || k === 'normals' || k === 'nofloor') flags[k] = true;
      else flags[k] = argv[++i];
    } else args.push(argv[i]);
  }
  const [inFile, outFile] = args;
  if (!inFile) {
    console.error('usage: node tools/glbmesh.mjs <in.glb> <out.smesh> [--drop a,b] [--keep a,b] [--scale S] [--report]');
    process.exit(2);
  }
  const glb = readGlb(inFile);
  let parts = flatten(glb);
  if (flags.keep) {
    const keep = flags.keep.split(',');
    parts = parts.filter(p => keep.some(k => p.name.startsWith(k)));
  }
  if (flags.drop) {
    const drop = flags.drop.split(',');
    parts = parts.filter(p => !drop.some(k => p.name.startsWith(k)));
  }
  if (flags.report) {
    let tris = 0, verts = 0;
    for (const p of parts) { tris += p.idx.length / 3; verts += p.verts; }
    console.log(`${inFile}: ${parts.length} parts, ${verts} verts, ${tris} tris`);
    for (const p of parts.sort((a, b) => b.idx.length - a.idx.length)) {
      console.log(`  ${p.name.padEnd(28)} ${String(p.idx.length / 3).padStart(7)} tris`);
    }
  }
  if (!outFile) return;
  const r = writeSmesh(parts, outFile, { scale: flags.scale ? Number(flags.scale) : 1, normals: !!flags.normals,
    floorAtZero: !flags.nofloor });
  const b = r.bounds;
  console.log(`${outFile}: ${(r.size / 1024).toFixed(0)} kB · ${r.parts} parts · ${r.verts} verts · ${r.tris} tris`);
  console.log(`  bounds ${(b.max[0] - b.min[0]).toFixed(1)} × ${(b.max[1] - b.min[1]).toFixed(1)} × ${(b.max[2] - b.min[2]).toFixed(1)} m, floor at y=${b.min[1].toFixed(2)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
