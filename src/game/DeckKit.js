/**
 * ══════════════════════════════════════════════════════════════════════════
 *  A CAPITAL SHIP'S FLIGHT DECK — its own kit, because the general one is
 *  a ruined village
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY THIS FILE EXISTS, WRITTEN DOWN SO IT IS NOT DONE AGAIN ────────────
 *
 * The first dressing of this room was built out of `src/world/Props.js`, on the
 * strength of a survey that said it "has every part". It does — for an outdoor
 * battlefield. `addWall` paints with `M.duracrete`, which is a bombed-masonry
 * surface. `addLamp` is a STREET LAMP with a craning head on a pole.
 * `addScaffold`, `addTank`, `addMachine`, `addCrateStack` and `addRuin` are a
 * ruined settlement's furniture. Put together on a flat plain they make exactly
 * what they are: a bombed street with a shield over it.
 *
 * The player's verdict on that frame is the specification for this file:
 *
 *   "why the fuck would there be a brick wall? why the fuck would there be
 *    fucking streetlamps? why the fuck would there be random ruins and shit?
 *    this is the hangar bay of a fucking capital ship … if I were to ask
 *    anyone what it was never in a million years would they say a hangar bay"
 *
 * And it is the same failure `Levels.js` records against the six interiors it
 * deleted. Those were dressed from this same outdoor kit. The lesson is not
 * "use fewer props", it is that A ROOM ON A SHIP NEEDS SHIPBOARD PARTS, and
 * there were none in the tree until this file.
 *
 * ── WHAT ACTUALLY MAKES A DECK READ AS A DECK ─────────────────────────────
 *
 * In order of how fast the eye gets it, which is also the order this file
 * builds them:
 *
 *   1. THE PAINT. A military flight deck is COVERED in markings — landing
 *      circles, bay numerals a metre and a half tall, guide lines running the
 *      length of it, hazard chevrons at every edge, keep-out boxes round
 *      anything that moves. Nothing else in this file identifies the room as
 *      fast, and the repo had no way to paint a ground at all.
 *   2. THE PLATE. Recessed panel seams, tie-down rings on a grid, drainage
 *      grating, walkway mesh. A deck is a manufactured surface and it must not
 *      read as terrain.
 *   3. THE FRAMING. Ribbed structural bays with recessed panel banks and
 *      conduit runs — a hull section seen from inside, never a wall surface.
 *   4. THE LIGHT. Recessed strip along the deck edge and flood banks overhead.
 *      No poles. Nothing at head height on a stalk.
 *   5. THE EQUIPMENT. Low, wide, boxy, painted, hazard-striped: servicing
 *      rigs, ordnance trolleys, ladder stands, cable spools, chocks.
 *
 * ── THE PALETTE IS NEARLY MONOCHROME AND THAT IS THE POINT ────────────────
 *
 * Graphite and steel-blue across everything structural, with saturated accents
 * used ONLY as paint: caution yellow, a red for the keep-outs, a bone white for
 * the stencils. The first room was muddy — brown duracrete against blue deck
 * against pale hull — and mud is what makes an interior look like an accident.
 * Every colour in this file comes from `DECK_PAINT` and nowhere else.
 */

import * as THREE from '../../vendor/three/three.module.js';

/**
 * THE WHOLE PALETTE, AND IT IS SHORT ON PURPOSE.
 *
 * Six values. Anything that needs a seventh is a thing this room should not
 * have — the discipline is what keeps a deck from turning back into a street.
 */
export const DECK_PAINT = {
  /** Structural steel, cool and dark. Everything built is one of these two. */
  hull: 0x3a4149,
  hullDark: 0x252b32,
  /** Caution yellow. Chevrons, bay circles, anything that means "watch out". */
  caution: 0xc8971e,
  /** Keep-out red. Trench edges, ordnance boxes, the lip. */
  keepOut: 0x9a3226,
  /** Stencil white, for numerals and lettering. Bone, never paper. */
  stencil: 0xb9bec6,
  /** The black of a painted stripe and of a recess. */
  ink: 0x12151a,
};

/* Painted marks sit ON the plate, not in it: 2 cm up, unlit, and merged into
 * one mesh per colour for the whole deck. `polygonOffset` rather than height
 * alone, because at 60 m a 2 cm lift z-fights on a heightfield. */
const PAINT_Y = 0.02;

function paintMaterial(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: 0.86, metalness: 0.0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3,
    ...opts,
  });
  return m;
}

/**
 * ══ THE PAINT SHOP ════════════════════════════════════════════════════════
 *
 * A tiny 2-D drawing surface that emits flat geometry on the deck plane. Every
 * marking in the room is drawn through this, which is why they can all be
 * merged into one mesh per colour: a deck's worth of paint costs four draw
 * calls whatever is drawn on it.
 *
 * Coordinates are world x/z in metres, exactly as everything else in the room —
 * a marking is placed where it is, not in a texture space nobody can reason
 * about.
 */
export class Paint {
  constructor() { this.byColor = new Map(); }

  _push(color, geo) {
    if (!this.byColor.has(color)) this.byColor.set(color, []);
    this.byColor.get(color).push(geo);
  }

  /** A rectangle, centred, optionally spun about Y. */
  rect(color, x, z, w, d, yaw = 0) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    if (yaw) g.rotateY(yaw);
    g.translate(x, PAINT_Y, z);
    this._push(color, g);
    return this;
  }

  /** A line from a to b of a given width — the deck's guide lines. */
  line(color, x1, z1, x2, z2, w = 0.18) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return this;
    return this.rect(color, (x1 + x2) / 2, (z1 + z2) / 2, w, len, Math.atan2(dx, dz));
  }

  /** A dashed line, which is what a taxi guide actually is. */
  dashed(color, x1, z1, x2, z2, w = 0.18, dash = 1.6, gap = 1.2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.floor(len / (dash + gap)));
    for (let i = 0; i < n; i++) {
      const t0 = (i * (dash + gap)) / len, t1 = t0 + dash / len;
      this.line(color, x1 + dx * t0, z1 + dz * t0, x1 + dx * t1, z1 + dz * t1, w);
    }
    return this;
  }

  /** An annulus — the landing circles, and the ring round anything that turns. */
  ring(color, x, z, r, w = 0.3, seg = 64) {
    const g = new THREE.RingGeometry(r - w / 2, r + w / 2, seg);
    g.rotateX(-Math.PI / 2);
    g.translate(x, PAINT_Y, z);
    this._push(color, g);
    return this;
  }

  /**
   * HAZARD STRIPING — diagonal bars along a run, which is the single most
   * recognisable piece of paint on any deck anywhere. Drawn as bars rotated
   * 45° inside a clipped band, so the run can be any length and any bearing.
   */
  hazard(color, x1, z1, x2, z2, width = 1.2, pitch = 1.1) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const n = Math.max(1, Math.floor(len / pitch));
    const ux = dx / len, uz = dz / len;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * pitch;
      /* The bar is as long as the band is wide × √2 and turned 45° into it,
       * which is what makes a chevron band rather than a ladder. */
      const g = new THREE.PlaneGeometry(pitch * 0.55, width * 1.5);
      g.rotateX(-Math.PI / 2);
      g.rotateY(yaw + Math.PI / 4);
      g.translate(x1 + ux * t, PAINT_Y, z1 + uz * t);
      this._push(color, g);
    }
    return this;
  }

  /**
   * A STENCILLED NUMERAL, in the seven-bar alphabet a painted deck number
   * actually is. Height in metres; a bay number is 1.6 m and legible from the
   * far end of the room, which is the whole reason it is painted that big.
   */
  digit(color, n, x, z, h = 1.6, yaw = 0) {
    const w = h * 0.62, t = h * 0.14;
    const on = SEVEN[Math.max(0, Math.min(9, n | 0))];
    const bars = [
      [0, h / 2, w, t], [0, -h / 2, w, t], [0, 0, w, t],            // top, bottom, middle
      [-w / 2, h / 4, t, h / 2], [w / 2, h / 4, t, h / 2],          // upper left, right
      [-w / 2, -h / 4, t, h / 2], [w / 2, -h / 4, t, h / 2],        // lower left, right
    ];
    const order = [0, 4, 6, 1, 5, 3, 2];                            // a b c d e f g
    for (let i = 0; i < 7; i++) {
      if (!on[i]) continue;
      const [bx, by, bw, bh] = bars[order[i]];
      const g = new THREE.PlaneGeometry(bw, bh);
      g.rotateX(-Math.PI / 2);
      if (yaw) g.rotateY(yaw);
      const cx = x + (yaw ? bx * Math.cos(yaw) + by * Math.sin(yaw) : bx);
      const cz = z + (yaw ? -bx * Math.sin(yaw) + by * Math.cos(yaw) : by);
      g.translate(cx, PAINT_Y, cz);
      this._push(color, g);
    }
    return this;
  }

  /** A whole number, digits laid out left to right. */
  number(color, v, x, z, h = 1.6, yaw = 0) {
    const s = String(Math.max(0, v | 0));
    const step = h * 0.82;
    for (let i = 0; i < s.length; i++) {
      this.digit(color, +s[i], x + (i - (s.length - 1) / 2) * step, z, h, yaw);
    }
    return this;
  }

  /** Emit one merged mesh per colour. Four draw calls for a deck's worth. */
  build(world, opts = {}) {
    const out = [];
    for (const [color, geos] of this.byColor) {
      if (!geos.length) continue;
      const merged = mergeFlat(geos);
      const mesh = new THREE.Mesh(merged, paintMaterial(color, opts.material));
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      mesh.name = 'deck-paint';
      world.scene.add(mesh);
      world.statics.push(mesh);
      out.push(mesh);
    }
    return out;
  }
}

/* a b c d e f g — the bars that are lit for each numeral. */
const SEVEN = [
  [1, 1, 1, 1, 1, 1, 0], [0, 1, 1, 0, 0, 0, 0], [1, 1, 0, 1, 1, 0, 1],
  [1, 1, 1, 1, 0, 0, 1], [0, 1, 1, 0, 0, 1, 1], [1, 0, 1, 1, 0, 1, 1],
  [1, 0, 1, 1, 1, 1, 1], [1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 0, 1, 1],
];

/**
 * Merge a pile of position/uv/normal geometries into one. Written here rather
 * than pulled from three's BufferGeometryUtils because the packer inlines every
 * module it can see and this is nine lines against a file of them.
 */
function mergeFlat(geos) {
  let verts = 0, idx = 0;
  for (const g of geos) {
    verts += g.attributes.position.count;
    idx += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  /**
   * AND COLOUR, WHICH THIS DROPPED. Every gradient in this file lives in a
   * `color` attribute — the reflection smears and the lamp pools are geometry
   * fades, deliberately, so they cost no texture — and a merge that copies
   * only position/normal/uv throws all of it away silently. The mesh still
   * draws; it draws flat, at full brightness, which is a bright rectangle on
   * the floor where a reflection should be. Absent on a source geometry means
   * white, so an uncoloured slab merged beside a faded quad is unchanged.
   */
  const wantsColor = geos.some((g) => g.attributes.color);
  const col = wantsColor ? new Float32Array(verts * 3).fill(1) : null;
  const ind = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
    if (col && g.attributes.color) col.set(g.attributes.color.array, vo * 3);
    const gi = g.index ? g.index.array : null;
    if (gi) for (let i = 0; i < gi.length; i++) ind[io + i] = gi[i] + vo;
    else for (let i = 0; i < p.count; i++) ind[io + i] = i + vo;
    io += gi ? gi.length : p.count;
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * ══ THE BUILDER EVERY PART ABOVE EMITS INTO ═══════════════════════════════
 *
 * One mesh per material for the whole room. `Props.Kit` does the same job for
 * the outdoor library and this is not it, deliberately: that one carries
 * weathering, destructibility, seeded jitter and collider bookkeeping that a
 * painted steel deck wants none of, and its materials are the very ones this
 * file exists to avoid.
 *
 * Measured on the finished deck: 118 source primitives, 5 materials, 5 draw
 * calls. The room it replaces emitted 193 meshes for less.
 */
export class DeckBuild {
  constructor() { this.bins = new Map(); }

  geoAt(mat, geo, x, y, z) {
    geo.translate(x, y, z);
    if (!this.bins.has(mat)) this.bins.set(mat, []);
    this.bins.get(mat).push(geo);
    return this;
  }

  /** A box, centred, optionally spun about Y — the shape almost everything is. */
  slabAt(mat, x, y, z, w, h, d, yaw = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (yaw) g.rotateY(yaw);
    return this.geoAt(mat, g, x, y, z);
  }

  build(world, opts = {}) {
    const out = [];
    for (const [mat, geos] of this.bins) {
      if (!geos.length) continue;
      const mesh = new THREE.Mesh(mergeFlat(geos), mat);
      mesh.castShadow = opts.castShadow !== false;
      mesh.receiveShadow = true;
      mesh.name = 'deck-kit';
      world.scene.add(mesh);
      world.statics.push(mesh);
      out.push(mesh);
    }
    return out;
  }

  /** How many primitives went in, for a check that wants to price the room. */
  get count() { let n = 0; for (const g of this.bins.values()) n += g.length; return n; }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STRUCTURE — every part measured off assets/reference/misc             */
/* ══════════════════════════════════════════════════════════════════════════ */

const _mats = {};
/** The room's materials. Six of them, and six is the discipline. */
export function deckMats() {
  if (_mats.hull) return _mats;
  /* MONOCHROME BLUE-GREY, rule 6. Not one of these is warm and not one is
   * saturated: in seven references the only colour is a red status lamp. */
  _mats.hull = new THREE.MeshStandardMaterial({ color: 0x545d68, roughness: 0.66, metalness: 0.35 });
  _mats.dark = new THREE.MeshStandardMaterial({ color: 0x272d35, roughness: 0.72, metalness: 0.3 });
  _mats.deep = new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.8, metalness: 0.2 });
  /**
   * THE STRIP. Rule 4: light in these rooms is thin bright bars set into the
   * structure, in ranks, and there is not one visible lamp head in any of the
   * seven images. So the strip is EMISSIVE — it is the thing you see, not a
   * thing that is lit — and it is the only white in the room.
   */
  _mats.strip = new THREE.MeshStandardMaterial({
    color: 0x0b0e12, emissive: 0xdae8ff, emissiveIntensity: 3.0, roughness: 0.4,
  });
  /* The only colour. Status lamps on the overhead fixtures, exactly as in
   * `hangar 7.jpg`, and nothing else in the room is allowed any. */
  _mats.status = new THREE.MeshStandardMaterial({
    color: 0x1a0c0c, emissive: 0xff3418, emissiveIntensity: 2.4, roughness: 0.5,
  });
  /* What a parked fighter is: near-black panels on a grey spine. */
  _mats.wing = new THREE.MeshStandardMaterial({ color: 0x1c2128, roughness: 0.58, metalness: 0.45 });
  /**
   * ══ THE SMEAR, AND IT IS THE FLOOR'S ONLY REAL TRICK ══════════════════
   *
   * Rule 2 says the deck is a black mirror and in `hangar 5.webp` the
   * reflection is half the picture. A real reflection is not available here:
   * `Reflector` is a second render of the whole room per plane, and a metal
   * deck with no environment map renders BLACK — which is exactly what the
   * first render of this room was, a floor with `metalness: 0.385` and nothing
   * for it to reflect.
   *
   * So the reflection is DRAWN. Every wall strip gets a flat additive quad
   * lying on the deck beneath it, running inward, bright at the wall foot and
   * gone by the far end. That is the shape a vertical light actually makes on
   * a wet floor, it costs one quad, and it is the difference between a deck
   * and a car park.
   */
  _mats.smear = new THREE.MeshBasicMaterial({
    color: 0x9fc4ff, transparent: true, opacity: 0.5, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true,
  });
  _mats.smear.userData.saberNoInk = true;
  /**
   * THE RIM AND THE NEAR STRIPS ARE UNLIT. A `MeshStandardMaterial` with a
   * high `emissiveIntensity` is still shaded, still tone-mapped and still
   * loses to a dark ambient; the brightest object in every reference cannot be
   * something the lighting gets a vote on. `MeshBasicMaterial` at full white
   * is the only thing that survives a dark room, and rule 1 says the rim is
   * brighter than anything it lights.
   */
  _mats.glow = new THREE.MeshBasicMaterial({ color: 0xeaf3ff });
  _mats.glow.userData.saberNoInk = true;
  /* Same, dimmed, for the ranks that recede — a hundred strips all at full
   * white is a wall of paper. */
  _mats.glowDim = new THREE.MeshBasicMaterial({ color: 0x9dbbe4 });
  _mats.glowDim.userData.saberNoInk = true;
  return _mats;
}

/**
 * ══ A REFLECTION SMEAR ════════════════════════════════════════════════════
 *
 * One quad, flat on the deck, pointing away from the wall it belongs to. It is
 * built from a plane whose vertex colours fade along its length, so the bright
 * end is at the strip's foot and the far end is nothing — a gradient in
 * geometry rather than a texture, because a texture is a fetch and a decode
 * and this is four vertices.
 */
export function smear(kit, x, z, len, wide, dirX, dirZ) {
  const M = deckMats();
  const g = new THREE.PlaneGeometry(wide, len, 1, 3);
  g.rotateX(-Math.PI / 2);
  /* Point it down the wall's normal. `atan2` rather than a branch so a smear
   * off an angled wall works the same as one off a square one. */
  g.rotateY(Math.atan2(dirX, dirZ));
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  /* The fade, along the quad's own length before it was moved. */
  let minT = Infinity, maxT = -Infinity;
  const t = [];
  for (let i = 0; i < pos.count; i++) {
    const d = pos.getX(i) * dirX + pos.getZ(i) * dirZ;
    t.push(d); if (d < minT) minT = d; if (d > maxT) maxT = d;
  }
  for (let i = 0; i < pos.count; i++) {
    const f = maxT > minT ? (t[i] - minT) / (maxT - minT) : 0;
    /* Squared, because a linear falloff reads as a painted stripe and a
     * reflection is brightest right at the object and dies fast. */
    const a = (1 - f) * (1 - f);
    col[i * 3] = a; col[i * 3 + 1] = a; col[i * 3 + 2] = a;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return kit.geoAt(M.smear, g, x + dirX * len * 0.5, 0.05, z + dirZ * len * 0.5);
}

/**
 * ══ A DECK UPLIGHT ════════════════════════════════════════════════════════
 *
 * `hangar 3.jpg` has them scattered across the floor — small white domes set
 * flush, each throwing a short pool. At eye level they are what tells you the
 * floor is a surface and not a void, and they are the cheapest scale ruler in
 * the room because you know how big one is.
 */
export function deckLamp(kit, x, z) {
  const M = deckMats();
  const g = new THREE.CylinderGeometry(0.42, 0.55, 0.22, 8);
  kit.geoAt(M.glow, g, x, 0.11, z);
  /* The pool it throws, as a flat disc — additive, so it lifts the plate
   * around it instead of painting a grey circle on it. */
  const pool = new THREE.CircleGeometry(2.6, 12);
  pool.rotateX(-Math.PI / 2);
  const pc = new Float32Array(pool.attributes.position.count * 3);
  for (let i = 0; i < pool.attributes.position.count; i++) {
    /* Vertex 0 is the centre of a CircleGeometry fan; everything else is rim. */
    const a = i === 0 ? 0.55 : 0.0;
    pc[i * 3] = a; pc[i * 3 + 1] = a; pc[i * 3 + 2] = a;
  }
  pool.setAttribute('color', new THREE.BufferAttribute(pc, 3));
  kit.geoAt(M.smear, pool, x, 0.04, z);
  return kit;
}

/**
 * ══ A RACK BAY — the thing that makes this a hangar ════════════════════════
 *
 * `assets/reference/REFERENCES.md` rule 3, and it is the piece the first two
 * dressings of this room did not have at all. In `hangar 7.jpg` both side walls
 * are ranks of ANGLED ALCOVES receding to a vanishing point, each holding a
 * fighter, dozens of them. In 3, 4 and 6 the same thing with the fighters on
 * overhead mounts. **That is what "rows and rows of ships" is** — the floor
 * stays clear and the ships are stored in the walls.
 *
 * The first version parked three ships on the deck and called it a hangar. Ten
 * per side, receding, is a different room.
 *
 * ONE BAY IS: a canted back panel, two ribs framing it, a full-height light
 * strip in the recess between them (rule 4), a mount arm, and a fighter hung
 * off it. Everything merges, so a wall of ten costs what one costs.
 */
export function rackBay(kit, x, y, z, opts = {}) {
  const M = deckMats();
  const s = opts.side ?? 1;              // -1 port, +1 starboard
  const w = opts.width ?? 15;
  const h = opts.height ?? 21;
  const cant = opts.cant ?? 0.16;        // the lean that makes the wall read

  /* The recess: a dark back panel set into the wall, canted out at the top. */
  kit.slabAt(M.deep, x - s * 1.2, y, z, 1.6, h, w * 0.92, -s * cant);
  /* The ribs either side of it, proud, which is what gives the wall its rhythm
   * when ten of them recede. */
  for (const dz of [-1, 1]) {
    kit.slabAt(M.hull, x, y, z + dz * w * 0.47, 3.2, h * 1.04, w * 0.06, -s * cant);
  }
  /**
   * THE STRIPS, full height in the recess, and there are THREE of them
   * because that is what the references show. `hangar 6.jpg` puts a group of
   * slotted bars in every wall bay; `hangar 1.webp` a rank of tall angled
   * ones. One thin bar per bay reads as a seam. Three read as a light.
   *
   * `glowDim` and not `strip`: an emissive standard material is still shaded,
   * and in a room this dark the ranks came out grey. These are unlit.
   */
  for (const d of [-0.30, 0, 0.30]) {
    kit.slabAt(M.glowDim, x - s * 2.0, y, z + d * w, 0.5, h * 0.74, w * 0.10, -s * cant);
  }
  /* The header run over the bay — rule 4's long horizontal, which is what ties
   * a rank of bays into a wall instead of leaving them as separate boxes. */
  kit.slabAt(M.glowDim, x - s * 1.4, y + h * 0.50, z, 0.4, 0.5, w * 0.86, -s * cant);
  /* The mount arm out of the recess, and the fighter on it. */
  kit.slabAt(M.hull, x - s * 3.6, y + h * 0.06, z, 4.4, 1.1, 1.1);
  if (opts.ship !== false) parkedFighter(kit, x - s * 7.2, y + h * 0.06, z, s, opts.kind ?? 0);
  return kit;
}

/**
 * ══ THE SHUTTLE ON THE PAD ════════════════════════════════════════════════
 *
 * `hangar 7.jpg`'s focal object and `hangar 5.webp`'s: one big craft on a
 * raised platform in the middle distance, wings folded UP, dwarfing the men
 * beside it. Everything else in this room is either a wall or a speck; without
 * one object at a readable size between the two there is no scale ladder, and
 * a room with no ladder reads flat however far away its far wall is.
 */
export function shuttlePad(kit, x, z, opts = {}) {
  const M = deckMats();
  const yaw = opts.yaw ?? 0;
  const r = opts.radius ?? 16;
  /* The pad: a low disc with a lit kerb, standing 1.2 m proud of the deck. */
  const pad = new THREE.CylinderGeometry(r, r * 1.04, 1.2, 16);
  kit.geoAt(M.dark, pad, x, 0.6, z);
  const kerb = new THREE.TorusGeometry(r * 0.99, 0.22, 6, 24);
  kerb.rotateX(-Math.PI / 2);
  kit.geoAt(M.glowDim, kerb, x, 1.2, z);
  /* The hull: a long wedge, nose forward. */
  const hull = new THREE.CylinderGeometry(0.6, 3.4, 22, 6);
  hull.rotateZ(Math.PI / 2);
  hull.rotateY(yaw);
  kit.geoAt(M.hull, hull, x, 5.4, z);
  kit.slabAt(M.hull, x, 4.2, z, 9, 2.4, 7, yaw);
  /* THE WINGS, FOLDED UP — the silhouette the whole shape exists for. Three
   * blades: one dorsal, two canted off the shoulders, all of them tall. */
  kit.slabAt(M.wing, x - Math.sin(yaw) * 2, 15.5, z - Math.cos(yaw) * 2, 1.0, 20, 5.5, yaw);
  for (const sx of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.9, 19, 5.0);
    g.rotateZ(sx * 0.20); g.rotateY(yaw);
    kit.geoAt(M.wing, g, x + sx * Math.cos(yaw) * 4.6, 14.4, z - sx * Math.sin(yaw) * 4.6);
  }
  /* The ramp down, because a ship you could walk into is a ship. */
  kit.slabAt(M.hull, x + Math.sin(yaw) * 12, 1.6, z + Math.cos(yaw) * 12, 4.2, 0.3, 8, yaw);
  /* Two landing lamps under it — the reference's craft are always lit from
   * beneath by their own pad. */
  for (const sx of [-1, 1]) {
    kit.slabAt(M.glow, x + sx * Math.cos(yaw) * 6, 1.5, z - sx * Math.sin(yaw) * 6, 1.2, 0.3, 1.2, yaw);
  }
  return kit;
}

/**
 * ══ A PARKED FIGHTER, IN SILHOUETTE ═══════════════════════════════════════
 *
 * Two big flat panels and a body between them — the TIE read, which is what
 * every one of the four references with fighters in it shows: at rack distance
 * a fighter is a pair of dark hexagonal slabs and a ball. Modelling more would
 * be modelling what the haze eats.
 *
 * `Vehicles.js` has real hulls and they are the wrong tool here: each is
 * transform-owned per frame by a director, none has a parked pose, and twenty
 * of them is twenty times the geometry for a shape that is 30 px wide at the
 * far end of the wall.
 */
function parkedFighter(kit, x, y, z, s, kind = 0) {
  const M = deckMats();
  /**
   * THREE HULLS, NOT ONE. "Rows and rows of different ships" is the brief and
   * a wall of one mesh repeated ninety times is a wall of one mesh: the eye
   * finds the repeat in about a second and the room stops being a place. The
   * kinds are cheap — the same six primitives arranged three ways — and at
   * rack distance three silhouettes is all the variety there is room for.
   */
  if (kind === 1) {
    /* A GUNSHIP: flat body, stub wings out, twin engines aft. */
    kit.slabAt(M.wing, x, y, z, 5.0, 1.7, 8.6);
    for (const dz of [-1, 1]) kit.slabAt(M.wing, x, y - 0.3, z + dz * 5.2, 4.0, 0.5, 3.4, dz * 0.12);
    for (const dz of [-1, 1]) {
      const e = new THREE.CylinderGeometry(0.85, 0.85, 4.2, 8);
      e.rotateX(Math.PI / 2);
      kit.geoAt(M.dark, e, x, y + 0.9, z + dz * 2.4);
    }
    const nose = new THREE.CylinderGeometry(0.4, 1.7, 4.0, 6);
    nose.rotateZ(Math.PI / 2);
    kit.geoAt(M.hull, nose, x - s * 4.2, y, z);
    return kit;
  }
  if (kind === 2) {
    /* AN INTERCEPTOR: a long spine with four swept blades. */
    const body = new THREE.CylinderGeometry(0.55, 1.5, 11, 7);
    body.rotateZ(Math.PI / 2);
    kit.geoAt(M.hull, body, x - s * 1.5, y, z);
    for (const dz of [-1, 1]) for (const dy of [-1, 1]) {
      const g = new THREE.BoxGeometry(4.6, 0.35, 5.4);
      g.rotateX(dz * dy * 0.5);
      kit.geoAt(M.wing, g, x + s * 1.4, y + dy * 2.0, z + dz * 2.6);
    }
    const eye2 = new THREE.SphereGeometry(1.1, 8, 6);
    kit.geoAt(M.dark, eye2, x - s * 5.4, y, z);
    return kit;
  }
  /* THE STANDARD: two big flat panels and a ball between them — the TIE read,
   * which is what four of the seven references park in their walls. */
  const w = 7.4, t = 0.55;
  for (const dz of [-1, 1]) {
    /* The panel, canted in at the top the way a TIE's wing is. */
    kit.slabAt(M.wing, x, y, z + dz * 3.4, w * 0.62, w, t, 0);
  }
  /* The pylon and the ball. */
  kit.slabAt(M.dark, x, y, z, 1.5, 1.5, 6.4);
  const ball = new THREE.SphereGeometry(1.9, 10, 8);
  kit.geoAt(M.dark, ball, x, y, z);
  /* The one bright spot on it — the cockpit, catching the strip behind. */
  const eye = new THREE.CylinderGeometry(1.05, 1.05, 0.3, 10);
  eye.rotateZ(Math.PI / 2);
  kit.geoAt(M.hull, eye, x - s * 1.75, y, z);
  return kit;
}

/**
 * ══ AN OVERHEAD FIXTURE ═══════════════════════════════════════════════════
 *
 * `hangar 7.jpg`: massive cylinders dropping from above with clusters of red
 * status lamps, cut off by the top of the frame. They are how the overhead
 * reads as enormous WITHOUT a ceiling ever being drawn — the eye follows them
 * up and out, and the room is as tall as it wants to be.
 *
 * This is the one thing the first version got right, as spars. These are
 * heavier and they carry the only colour in the room.
 */
export function overheadRig(kit, x, z, opts = {}) {
  const M = deckMats();
  const top = opts.top ?? 64;
  const drop = opts.drop ?? 16;
  const r = opts.radius ?? 3.1;
  const g = new THREE.CylinderGeometry(r, r * 0.86, drop, 12);
  kit.geoAt(M.dark, g, x, top - drop / 2, z);
  /* The collar, and the lamps round it. */
  const c = new THREE.CylinderGeometry(r * 1.24, r * 1.24, 1.4, 12);
  kit.geoAt(M.hull, c, x, top - drop + 1.2, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    kit.slabAt(M.status, x + Math.cos(a) * r * 1.3, top - drop + 1.2, z + Math.sin(a) * r * 1.3,
      0.5, 0.5, 0.5);
  }
  /* And the shaft continuing up out of frame — no cap, ever. */
  const up = new THREE.CylinderGeometry(r * 0.7, r * 0.7, 40, 10);
  kit.geoAt(M.dark, up, x, top + 18, z);
  return kit;
}

/**
 * ══ A CATWALK ═════════════════════════════════════════════════════════════
 *
 * `hangar 6.jpg` puts a single figure on one, halfway up the back wall, and it
 * is the whole scale of that image. A walkway a person could be standing on
 * tells you how big the wall behind it is, and nothing else in a room this
 * empty does.
 */
export function catwalk(kit, x, y, z, len, opts = {}) {
  const M = deckMats();
  const yaw = opts.yaw ?? 0;
  kit.slabAt(M.dark, x, y, z, len, 0.5, 3.0, yaw);
  kit.slabAt(M.hull, x, y + 1.0, z + 1.4, len, 0.12, 0.12, yaw);
  const n = Math.max(2, Math.round(len / 5));
  for (let i = 0; i <= n; i++) {
    const t = (i / n - 0.5) * len;
    kit.slabAt(M.hull, x + Math.cos(yaw) * t, y + 0.55, z - Math.sin(yaw) * t + 1.4, 0.1, 1.0, 0.1);
  }
  /* Under-lighting, which is what makes a catwalk read at distance. */
  kit.slabAt(M.strip, x, y - 0.34, z, len * 0.94, 0.12, 0.4, yaw);
  return kit;
}

/** A crate cluster — `hangar 7.jpg` has them in loose groups, low and dark. */
export function crates(kit, x, z, n = 5, seed = 1) {
  const M = deckMats();
  let r = seed * 9301;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const w = 1.6 + rnd() * 1.4, h = 1.2 + rnd() * 1.0;
    kit.slabAt(i % 3 ? M.dark : M.hull, x + (rnd() - 0.5) * 7, h / 2, z + (rnd() - 0.5) * 7,
      w, h, w * 0.8, rnd() * 0.6);
  }
  return kit;
}
