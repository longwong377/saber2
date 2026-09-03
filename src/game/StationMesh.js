/**
 * ══════════════════════════════════════════════════════════════════════════
 *  .smesh — the station's imported rooms, read
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Ninety lines and no dependency. `tools/glbmesh.mjs` did the decoding on a
 * workstation; this reads the result, which is a JSON header and two typed
 * arrays. See that file's header for why there is no `GLTFLoader`, no
 * `DRACOLoader` and no draco wasm anywhere in this repo.
 *
 * ── WHAT A CALLER GETS, AND WHAT IT MUST DO WITH IT ───────────────────────
 *
 * A `Map` from PART NAME to `BufferGeometry`, in the room's own frame with its
 * floor at y = 0. The names are the whole interface: SHARK §2's twelve-row
 * prefix table binds `zoc_rib_*`, `wall_*`, `light_*` and the rest onto
 * `deckMats`, so a room is put into the game by naming materials, never by
 * trusting whatever the exporter thought a surface was.
 *
 * NOTHING HERE MAKES A MATERIAL, and that is deliberate. §9.1's first
 * guarantee is that no loader material survives into a walkable room; the
 * cheapest way to hold that is for the loading path to be incapable of making
 * one. `station.mjs` asserts it anyway.
 *
 * ── THE GEOMETRY COMES BACK NON-INDEXED, WHICH IS NOT A WASTE ─────────────
 *
 * The file stores welded positions and part-local indices — 60 878 vertices
 * for the Concourse's 98 380 triangles, against 295 140 as exported. That is
 * a third of the bytes on the wire. It is expanded again here, and given FLAT
 * normals, because two things downstream need a real normal attribute:
 *
 *   THE INK PASS renders the scene with `MeshNormalMaterial` as an override
 *   (`Ink.js`). An override material does not inherit `flatShading` from the
 *   material it replaced, and a geometry with no normal attribute encodes to a
 *   zero vector — which `Ink` normalises, and which its own header records as
 *   the bug that painted the whole sky black.
 *
 *   THE CEL BANDS are a function of N·L (`Cel.js`). A smooth normal — which is
 *   what `computeVertexNormals` on the WELDED geometry would give — rounds
 *   every corner of a room that was modelled faceted, and `Toon.js` records
 *   that a smooth normal under the two-tone terminator speckles.
 *
 * So the weld is a transport format and the expansion restores exactly what
 * was exported, per-face normals and all. It costs vertices in GPU memory that
 * the original glTF would have cost anyway.
 *
 * ── AND IT DECODES ONCE ───────────────────────────────────────────────────
 *
 * §12.2 budgets the station's load at the hangar's, with "the GLBs decode once
 * and are cached for the session". The cache is by URL and holds the decoded
 * geometries; `Station.js` clones nothing — it merges them into the room's
 * meshes and the source geometries stay put for the next visit.
 */

import * as THREE from '../../vendor/three/three.module.js';

/** url → Promise<Room>. Session-lived, never evicted: five rooms, ~2 MB. */
const _cache = new Map();

/**
 * A room's parts, decoded.
 *
 * @typedef {{ bounds: {min:number[], max:number[]},
 *             parts: Map<string, THREE.BufferGeometry>,
 *             names: string[] }} Room
 */

/**
 * Read one `.smesh`.
 *
 * The URL is a plain relative path in the source (`assets/station/x.smesh`)
 * so `tools/pack.mjs` can rewrite it to a `data:` URL — which `fetch` reads
 * exactly the same way, which is what makes the single file work with no
 * network (§12.1). Never build this path by interpolation: the packer
 * substitutes literals.
 */
export function loadRoom(url) {
  const hit = _cache.get(url);
  if (hit) return hit;
  const p = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then((ab) => decodeRoom(ab, url));
  _cache.set(url, p);
  return p;
}

/** True once `loadRoom(url)` has settled — for a level that must not dress
 * itself half-built. `Station.js` awaits its rooms in `World._loadSteps`. */
export function roomReady(url) { return _cache.has(url); }

/** Drop everything. Only a check calls this; the game keeps its five rooms. */
export function forgetRooms() {
  for (const p of _cache.values()) {
    Promise.resolve(p).then((room) => { for (const g of room.parts.values()) g.dispose(); }, () => {});
  }
  _cache.clear();
}

/**
 * Decode a `.smesh` buffer. Exported for `station.mjs`, which reads the file
 * off disk rather than over `fetch`.
 */
export function decodeRoom(arrayBuffer, label = 'smesh') {
  const dv = new DataView(arrayBuffer);
  if (dv.getUint32(0, true) !== 0x48534d53) throw new Error(`${label}: not a .smesh`);
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`${label}: version ${version}, expected 2`);
  const jsonLen = dv.getUint32(8, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 12, jsonLen)));
  const pad = (n) => (4 - (n % 4)) % 4;
  let off = 12 + jsonLen + pad(jsonLen);

  let vTotal = 0, iTotal = 0;
  for (const p of head.parts) { vTotal += p.vCount; iTotal += p.iCount; }
  const qpos = new Int16Array(arrayBuffer, off, vTotal * 3);
  off += vTotal * 6; off += pad(vTotal * 6);
  let nor = null;
  if (!head.flat) {
    nor = new Int8Array(arrayBuffer, off, vTotal * 3);
    off += vTotal * 3; off += pad(vTotal * 3);
  }
  const idx = head.wide
    ? new Uint32Array(arrayBuffer, off, iTotal)
    : new Uint16Array(arrayBuffer, off, iTotal);

  /* Dequantise: the file stores (v - min) * range / span - bias as an int16,
   * so this is that inverted. One scale for the whole file, which is why a
   * part can be drawn without knowing where the others are. */
  const q = head.quant;
  const sx = q.span[0] / q.range, sy = q.span[1] / q.range, sz = q.span[2] / q.range;
  const parts = new Map();
  for (const p of head.parts) {
    const geo = new THREE.BufferGeometry();
    const n = p.iCount;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      /* Expanded here rather than indexed — see the header. The index is
       * part-local, so `vOff` is added once. */
      const v = (p.vOff + idx[p.iOff + i]) * 3;
      pos[i * 3] = (qpos[v] + q.bias) * sx + q.min[0];
      pos[i * 3 + 1] = (qpos[v + 1] + q.bias) * sy + q.min[1];
      pos[i * 3 + 2] = (qpos[v + 2] + q.bias) * sz + q.min[2];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (nor) {
      const nn = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = (p.vOff + idx[p.iOff + i]) * 3;
        nn[i * 3] = nor[v] / 127; nn[i * 3 + 1] = nor[v + 1] / 127; nn[i * 3 + 2] = nor[v + 2] / 127;
      }
      geo.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
    } else {
      /* On non-indexed geometry this is the FACE normal, three times per
       * triangle — which is what the export carried. */
      geo.computeVertexNormals();
    }
    /* The engine's materials are untextured (`deckMats` is nine flat
     * `MeshStandardMaterial`s), and the export carries no UVs, so there is
     * nothing to unwrap. A geometry with no `uv` renders fine; one with a
     * fabricated one invites a texture nobody meant to add. */
    geo.name = p.name;
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    parts.set(p.name, geo);
  }
  return {
    bounds: head.bounds,
    parts,
    names: head.parts.map((p) => p.name),
    /** Triangles in the whole room, for `station.mjs`'s budget line. */
    tris: iTotal / 3,
  };
}

/**
 * ══ THE PREFIX TABLE (SHARK §2) ═══════════════════════════════════════════
 *
 * "Materials by prefix, not textures." Twelve rows binding the exported part
 * names onto the engine's own `deckMats` keys, and it is what makes an
 * imported room look like THIS game rather than like a visitor.
 *
 * ORDER MATTERS: the first row whose prefix matches wins, so the specific
 * rows come before the general ones — `zoc_neon_` before `zoc_`, `light_`
 * before `l`. A part that matches nothing is a defect and `station.mjs` fails
 * on it rather than letting it fall through to a default, which is the rule
 * `determinism.mjs` holds every table in this tree to: a missing thing gets an
 * error, never a plausible default.
 */
export const PART_MATERIAL = [
  /* ── THE LIGHTS. §9.1: "imported light meshes become the emissive strip".
   * `strip` and not `glow`/`lamp`/`glowDim`: those three carry
   * `userData.saberNoInk`, which §9.1 forbids inside a room, and `strip` is
   * the one emissive material in `deckMats` that the ink pass still draws. */
  ['light_indicator', 'status'],
  ['fix_mp_light_indicator', 'status'],
  ['light_deck_channel_fascia', 'dark'],
  ['light_deck_channel_cell', 'dark'],
  ['light_deck_channel', 'strip'],
  ['light_wall_strip_bank', 'strip'],
  ['light_wall_course', 'strip'],
  ['light_bar_backlight', 'strip'],
  ['light_house_cove', 'strip'],
  ['light_portal_head', 'strip'],
  ['light_service_tube', 'strip'],
  ['light_dais_key', 'strip'],
  ['light_bezel', 'dark'],
  ['light_housing', 'dark'],
  ['light_downlight', 'strip'],
  ['light_', 'strip'],
  ['cc_light_strip', 'strip'],
  ['zoc_neon_', 'strip'],
  ['zoc_stall_light', 'strip'],
  ['zoc_rib_lamp', 'strip'],
  ['zoc_downlight', 'strip'],
  /* Screens and signage faces read as lit surfaces, not as lamps. */
  ['zoc_screen', 'screen'],
  ['sign_text', 'screen'],
  ['sign_face', 'screen'],
  ['signage_panel', 'screen'],
  ['sign_frame', 'dark'],
  ['sign_post', 'dark'],
  ['prop_tactical_display', 'screen'],
  ['fix_mp_dress_screen', 'screen'],
  ['prop_info_board', 'screen'],
  /* Glass: the CIC's glazing, the dome's viewports, the Starfury's canopy.
   * `glass` is the station's own — a transparent `MeshStandardMaterial` built
   * by `Station.js` in the same discipline as `deckMats`, never a loader's. */
  ['cc_glazing', 'glass'],
  ['prop_viewport', 'glass'],
  ['cockpit_glazing', 'glass'],
  /* ── THE ZOCALO (#9). Vault, galleries, market, floor. */
  ['zoc_rib_', 'hull'],
  ['zoc_gallery_', 'hull'],
  ['zoc_purlin', 'dark'],
  ['zoc_bulkhead', 'hull'],
  ['zoc_soffit', 'dark'],
  ['zoc_rail', 'dark'],
  ['zoc_stair', 'dark'],
  ['zoc_stall_', 'deep'],
  ['zoc_table_', 'deep'],
  ['zoc_chair_', 'deep'],
  ['zoc_service_chrome', 'wing'],
  ['zoc_deck_chevron', 'mark'],
  ['zoc_deck_strip', 'strip'],
  ['zoc_deck_', 'deep'],
  /* ── THE TRANSIT CORRIDOR — deck 40's corridor type and no other's. */
  ['transit_deck', 'deep'],
  ['transit_rib', 'hull'],
  ['transit_rail', 'dark'],
  ['transit_panel', 'dark'],
  ['transit_soffit', 'dark'],
  ['transit_skirt', 'dark'],
  ['transit_cornice', 'dark'],
  ['transit_dado', 'dark'],
  ['transit_mullion', 'dark'],
  ['transit_conduit', 'dark'],
  ['transit_wall', 'hull'],
  ['transit_', 'hull'],
  /* ── THE FURNITURE both imported rooms carry. Everything under `prop_` is
   * hand height or below and becomes a `Props.Prop` body (§11), so the
   * material is the one the kit's own crates and benches take. */
  ['prop_door', 'wing'],
  ['prop_gallery_rail', 'dark'],
  ['prop_deck_marking', 'mark'],
  ['prop_', 'deep'],
  ['fix_mp_prop_', 'deep'],
  ['fix_mp_plant_', 'dark'],
  ['fix_platform_edge', 'mark'],
  ['fix_gantry_rail', 'dark'],
  ['dress_gantry_rib', 'dark'],
  /* ── THE SHELL NAMES the rooms share. */
  ['wall_reveal', 'dark'],
  ['wall_panel', 'hull'],
  ['wall_', 'hull'],
  ['rail_band', 'dark'],
  ['skirt', 'dark'],
  ['soffit', 'dark'],
  /* ── COMMAND (#41). */
  ['cc_console', 'deep'],
  ['cc_dais', 'dark'],
  ['cc_pit', 'dark'],
  ['cc_floor', 'deep'],
  ['cc_stair', 'dark'],
  ['cc_rail', 'dark'],
  ['cc_skirt', 'dark'],
  ['cc_dado', 'dark'],
  ['cc_cornice', 'dark'],
  ['cc_mullion', 'dark'],
  ['cc_panel', 'dark'],
  ['cc_', 'hull'],
  /* ── THE OBSERVATION DOME (#54). */
  ['bay_emblem_wall', 'mark'],
  ['bay_', 'hull'],
  ['worship_deck', 'deep'],
  ['worship_soffit', 'dark'],
  ['worship_wall', 'hull'],
  ['dress_kerb', 'dark'],
  ['dress_post', 'dark'],
  ['dress_furnace', 'dark'],
  ['industrial_rib_wall', 'hull'],
  ['alien_frost_panel', 'wing'],
  /* ── THE STARFURY. Its own sections; the airframe is `wing`, the four
   * engine bells are the one hot thing on it. */
  ['engine_bell', 'status'],
  ['engine_pod', 'dark'],
  ['retro_nozzle', 'status'],
  ['rcs_nozzle', 'dark'],
  ['rcs_sponson', 'wing'],
  ['canopy_frame', 'dark'],
  ['cockpit_canopy', 'dark'],
  ['gun_pod', 'dark'],
  ['boom_tip', 'dark'],
  ['boom', 'wing'],
  ['dorsal_deck', 'dark'],
  ['fuselage', 'wing'],
  ['nose', 'wing'],
  ['root_fairing', 'wing'],
  ['tip_vane', 'wing'],
];

/**
 * Which `deckMats` key a part takes, or `null` if the table has no row for it.
 *
 * Null and not a fallback: see the note above. A caller that wants the room
 * anyway can pick its own default, and `station.mjs` is the one that refuses.
 */
export function materialKeyFor(name) {
  for (const [prefix, key] of PART_MATERIAL) if (name.startsWith(prefix)) return key;
  return null;
}
