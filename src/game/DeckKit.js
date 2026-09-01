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
  const ind = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
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
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  out.computeBoundingSphere();
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STRUCTURE                                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

const _mats = { hull: null, dark: null, glow: null, caution: null, stencil: null };
/** The room's five materials. Exported so the level can hand them round. */
export function deckMats() { return mats(); }
function mats() {
  if (_mats.hull) return _mats;
  _mats.hull = new THREE.MeshStandardMaterial({ color: DECK_PAINT.hull, roughness: 0.62, metalness: 0.55 });
  _mats.dark = new THREE.MeshStandardMaterial({ color: DECK_PAINT.hullDark, roughness: 0.7, metalness: 0.45 });
  _mats.caution = new THREE.MeshStandardMaterial({ color: DECK_PAINT.caution, roughness: 0.8, metalness: 0.1 });
  _mats.stencil = new THREE.MeshStandardMaterial({ color: DECK_PAINT.stencil, roughness: 0.85, metalness: 0.05 });
  /* THE ONLY EMISSIVE IN THE ROOM THAT IS NOT THE FIELD. A deck's light comes
   * from strips and panels, so the strips have to BE bright rather than be lit
   * — a lamp that needs a light to see it is a lamp that reads as a box. */
  _mats.glow = new THREE.MeshStandardMaterial({
    color: 0x0d1014, emissive: 0xa8c4e0, emissiveIntensity: 2.6, roughness: 0.4,
  });
  return _mats;
}

/**
 * ══ A STRUCTURAL BAY — the only kind of wall this room has ════════════════
 *
 * Not a surface. A hull seen from inside is a rank of RIBS with recessed panel
 * banks between them, and the depth between the two is what makes it read as
 * ship rather than as masonry. Three planes: the rib faces forward, the panel
 * bank sits 0.55 m behind it, and a conduit run crosses at shoulder height.
 *
 * MEASURED AGAINST THE THING IT REPLACES: `addWall` with `M.duracrete` is one
 * box with a brick bake on it — 32 triangles and a masonry surface, which is
 * why the first frame of this room had a brick wall in it. This is 9 boxes and
 * a stencil per bay, merged, and it is the difference between a building and a
 * ship.
 */
export function hullBay(kit, x, y, z, w, h, opts = {}) {
  const M = mats();
  const yaw = opts.yaw || 0;
  const depth = opts.depth ?? 0.55;
  const rib = Math.min(0.9, w * 0.16);

  /* The panel bank, set back. */
  kit.slabAt(M.dark, x, y, z, w, h, 0.6, yaw);
  /* Two horizontal bands across it — the seam every hull plate section has. */
  for (const f of [0.34, 0.68]) {
    kit.slabAt(M.hull, x, y - h / 2 + h * f, z + depth * 0.4, w * 0.98, h * 0.045, 0.22, yaw);
  }
  /* The ribs, proud of it, at both edges. */
  for (const sx of [-1, 1]) {
    kit.slabAt(M.hull, x + sx * (w / 2 - rib / 2), y, z + depth, rib, h, 0.7, yaw);
  }
  /* A conduit run at shoulder height, which is the detail that says somebody
   * maintains this. */
  kit.slabAt(M.dark, x, y - h / 2 + 2.4, z + depth * 1.3, w * 0.86, 0.34, 0.34, yaw);
  /* And the strip light under it, washing the deck rather than the wall. */
  if (opts.lit !== false) {
    kit.slabAt(M.glow, x, y - h / 2 + 2.1, z + depth * 1.4, w * 0.7, 0.12, 0.12, yaw);
  }
  return kit;
}

/**
 * ══ AN OVERHEAD FLOOD BANK ════════════════════════════════════════════════
 *
 * What lights a deck. A boxed housing hung off a spar with four lamp faces in
 * it, pointing DOWN — no pole, no stalk, nothing at head height. `addLamp`'s
 * craning street-lamp head is the exact thing this exists to never be.
 *
 * The light itself is the caller's: this is the fixture you can see, and a room
 * with more fixtures than lights is how a deck is actually lit.
 */
export function floodBank(kit, x, y, z, opts = {}) {
  const M = mats();
  const w = opts.width ?? 4.2;
  kit.slabAt(M.dark, x, y, z, w, 0.5, 1.5);
  for (let i = 0; i < 4; i++) {
    const fx = x + ((i / 3) - 0.5) * w * 0.78;
    kit.slabAt(M.glow, fx, y - 0.3, z, w * 0.16, 0.14, 1.1);
  }
  /* The hanger, up out of frame — a bank with nothing holding it floats. */
  kit.slabAt(M.hull, x, y + 1.6, z, 0.22, 3.2, 0.22);
  return kit;
}

/**
 * ══ A TIE-DOWN RING ═══════════════════════════════════════════════════════
 *
 * The smallest thing on this list and one of the most identifying: a deck is
 * covered in them on a grid, and nothing else explains what stops a parked ship
 * sliding when the ship it is parked in manoeuvres. Recessed, so it is a dark
 * socket with a bar across it rather than a bump.
 */
export function tieDown(kit, x, z) {
  const M = mats();
  kit.slabAt(M.dark, x, 0.012, z, 0.42, 0.024, 0.42);
  kit.slabAt(M.hull, x, 0.05, z, 0.30, 0.05, 0.07);
  return kit;
}

/**
 * ══ A SERVICING RIG ═══════════════════════════════════════════════════════
 *
 * The deck's workhorse and the shape of everything on it: LOW, WIDE, BOXY,
 * PAINTED. A ruined-village kit has nothing this shape — its furniture is
 * tall, thin and broken, which is why a deck dressed from it reads as rubble.
 *
 * A chassis on castors, a bank of gauges, a hose reel, and a caution stripe
 * down the side. Nothing on it is above chest height.
 */
export function servicingRig(kit, x, z, opts = {}) {
  const M = mats();
  const yaw = opts.yaw || 0;
  const w = opts.width ?? 2.6, d = opts.depth ?? 1.5, h = opts.height ?? 1.15;
  kit.slabAt(M.hull, x, h / 2, z, w, h, d, yaw);
  kit.slabAt(M.caution, x, h * 0.78, z, w * 1.01, h * 0.16, d * 1.01, yaw);
  kit.slabAt(M.dark, x, h + 0.12, z, w * 0.5, 0.24, d * 0.7, yaw);
  /* The reel on the end, which is the piece that reads at distance. */
  const rg = new THREE.CylinderGeometry(0.34, 0.34, 0.5, 12);
  rg.rotateZ(Math.PI / 2);
  kit.geoAt(M.dark, rg, x + Math.cos(yaw) * (w / 2 + 0.2), h * 0.62, z - Math.sin(yaw) * (w / 2 + 0.2));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const c = new THREE.CylinderGeometry(0.13, 0.13, 0.26, 8);
      c.rotateZ(Math.PI / 2);
      kit.geoAt(M.dark, c, x + sx * w * 0.36, 0.13, z + sz * d * 0.32);
    }
  }
  return kit;
}

/**
 * ══ AN ORDNANCE TROLLEY ═══════════════════════════════════════════════════
 *
 * A low cradle with three shells on it, hazard-striped. It is here because a
 * hangar in a war has ammunition being moved across it, and because a long low
 * horizontal with three bright cylinders on it is instantly legible at forty
 * metres in a way a crate never is.
 */
export function ordnanceTrolley(kit, x, z, opts = {}) {
  const M = mats();
  const yaw = opts.yaw || 0;
  kit.slabAt(M.dark, x, 0.42, z, 3.0, 0.22, 1.0, yaw);
  kit.slabAt(M.caution, x, 0.30, z, 3.02, 0.14, 1.02, yaw);
  for (let i = 0; i < 3; i++) {
    const g = new THREE.CylinderGeometry(0.17, 0.17, 2.4, 10);
    g.rotateZ(Math.PI / 2);
    if (yaw) g.rotateY(yaw);
    kit.geoAt(M.stencil, g, x, 0.68, z + (i - 1) * 0.3);
  }
  for (const sx of [-1, 1]) {
    const c = new THREE.CylinderGeometry(0.16, 0.16, 0.2, 8);
    c.rotateZ(Math.PI / 2);
    kit.geoAt(M.dark, c, x + sx * 1.2, 0.16, z);
  }
  return kit;
}

/**
 * ══ A LADDER STAND ════════════════════════════════════════════════════════
 *
 * Wheeled steps up to a platform with a handrail, which is how a crew reaches a
 * cockpit and is the one TALL thing a deck legitimately has. It replaces
 * `addScaffold`, which is builder's scaffolding: poles, boards and diagonal
 * bracing, i.e. a building site.
 */
export function ladderStand(kit, x, z, opts = {}) {
  const M = mats();
  const yaw = opts.yaw || 0;
  const h = opts.height ?? 2.6;
  const steps = Math.max(3, Math.round(h / 0.34));
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    kit.slabAt(M.hull, x - Math.sin(yaw) * (1.1 - t * 1.1), 0.16 + t * h,
      z - Math.cos(yaw) * (1.1 - t * 1.1), 0.9, 0.06, 0.3, yaw);
  }
  kit.slabAt(M.hull, x, h + 0.2, z + 0.5, 1.1, 0.08, 1.2, yaw);
  for (const sx of [-1, 1]) {
    kit.slabAt(M.hull, x + sx * 0.5, h + 0.72, z + 0.5, 0.06, 1.0, 0.06, yaw);
  }
  kit.slabAt(M.caution, x, h + 1.2, z + 0.5, 1.1, 0.07, 0.07, yaw);
  return kit;
}

/**
 * ══ A CABLE SPOOL AND A CHOCK ═════════════════════════════════════════════
 *
 * The two smallest pieces, and they are here for the same reason the tie-downs
 * are: the floor of a working deck is never empty, and what is on it is small,
 * heavy and painted.
 */
export function cableSpool(kit, x, z) {
  const M = mats();
  for (const dy of [0, 0.62]) {
    const g = new THREE.CylinderGeometry(0.62, 0.62, 0.07, 16);
    kit.geoAt(M.dark, g, x, 0.35 + dy, z);
  }
  const drum = new THREE.CylinderGeometry(0.4, 0.4, 0.6, 14);
  kit.geoAt(M.hull, drum, x, 0.66, z);
  return kit;
}

export function chock(kit, x, z, yaw = 0) {
  const M = mats();
  kit.slabAt(M.caution, x, 0.09, z, 0.5, 0.18, 0.34, yaw);
  return kit;
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
