/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE PLACE BUILDERS — fifty rooms and no two of them the same plan
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── THE ONE RULE THIS FILE EXISTS TO KEEP ─────────────────────────────────
 *
 * `SHARK.md` §3.1 rule 4: **no two places the same shape.** The other repo's
 * own post-mortem is why it is written down — *"16 distinct place builders
 * over 128 places; 78 from one generic kit; one corridor generator for 70
 * decks"* — and §13's warning is sharper still:
 *
 *   "every gate measured coverage or correctness, and both are perfectly
 *    satisfied by one generic thing repeated seventy-eight times … a
 *    generator is finished when its OUTPUT is various, not when its output is
 *    correct."
 *
 * So there is no `buildGenericRoom`. There is a library of PARTS below —
 * a wall run, a tier, a pit, a mezzanine, a counter, a rack — and then one
 * function per shape that composes them into a plan nothing else has. Two
 * places may share a part; they never share a plan. `station.mjs` measures
 * it rather than trusting it: the pairwise silhouette IoU of every place from
 * its own door, failing any pair over 0.85.
 *
 * ── AND EVERYTHING IN THEM IS A BODY (§11) ────────────────────────────────
 *
 * The player's bar: *"everything actually modelled and with physics and
 * interactable like any other body in Battlefield Borz."* So:
 *
 *   STRUCTURE — walls, floors, tiers, catwalks, the drum — is static
 *   geometry with box colliders, merged into the place's own kit.
 *   FURNITURE — every table, chair, crate, barrel, locker, bunk, stall,
 *   pot, tank and bench — is a `Props.Prop` through `kit.after`, so it is
 *   grabbable, throwable and cuttable exactly as a battlefield crate is.
 *
 * `loose()` is the door for the second kind, and a place that has none is a
 * place with nothing in it to pick up, which `station-sandbox.mjs` fails.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { Kit, makeCrate, makeBarrel, Prop, slabGeo, cylGeo } from '../world/Props.js';
import { DECK_Y, DRUM, floorOf, waysOn, junctionsOn } from './StationPlan.js';
/**
 * ── THE WHEEL'S SEGMENT COUNT COMES OFF THE RULES, NOT OFF A RULER ───────
 *
 * `wheelhall` draws one spoke per segment of the Drum, and `Games.DRUM` is the
 * one authority on how many there are — `drumPays` prices a deck at 3 in 20
 * off that same array. A room that drew sixteen spokes while the panel priced
 * twenty would be the two-copies-of-the-partition defect `StationPlan.js`'s
 * header is written against, in geometry.
 */
import { DRUM as GAMES_DRUM } from './Games.js';
const DRUM_SEGMENTS = GAMES_DRUM.SEGMENTS.length;

const TAU = Math.PI * 2;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PARTS                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/** A floor plate. Every place has one; what differs is what stands on it. */
function floor(kit, M, w, d, y = 0, mat = null) {
  kit.slab(mat || M.deep, w, 0.4, d, 0, y - 0.2, 0, { collide: true, bevel: 0 });
}

/**
 * Four walls with a gap for the door, which is always at local −Z (the plan
 * table puts every door on the side a walk arrives from). `open` names sides
 * to leave out entirely — a place with a window onto another place (§3.1
 * rule 5) leaves one out and glazes it.
 */
function walls(kit, M, w, d, h, opts = {}) {
  const t = 0.4, gap = opts.doorW ?? 3.4;
  const mat = opts.mat || M.hull;
  const open = new Set(opts.open || []);
  /* +Z, the back. */
  if (!open.has('back')) kit.slab(mat, w + t * 2, h, t, 0, h / 2, d / 2 + t / 2, { collide: true, bevel: 0 });
  else if (opts.glaze) kit.slab(M.glass, w, h - 0.6, 0.2, 0, h / 2, d / 2, { collide: true, bevel: 0 });
  /* ±X, the sides. */
  for (const s of [-1, 1]) {
    if (open.has(s < 0 ? 'left' : 'right')) continue;
    kit.slab(mat, t, h, d, s * (w / 2 + t / 2), h / 2, 0, { collide: true, bevel: 0 });
  }
  /* −Z, the front, with the doorway cut out of it. */
  if (!open.has('front')) {
    const side = (w - gap) / 2;
    for (const s of [-1, 1]) {
      kit.slab(mat, side, h, t, s * (gap + side) / 2, h / 2, -d / 2 - t / 2, { collide: true, bevel: 0 });
    }
    /* The lintel over the opening, and the light in its reveal. */
    kit.slab(mat, gap, h - 2.6, t, 0, 2.6 + (h - 2.6) / 2, -d / 2 - t / 2, { collide: true, bevel: 0 });
    kit.slab(M.strip, gap - 0.4, 0.1, 0.12, 0, 2.5, -d / 2 - 0.1, { collide: false, bevel: 0 });
  }
}

/** A soffit. `ribs` gives it the structure that stops it reading as a lid. */
function ceiling(kit, M, w, d, h, opts = {}) {
  kit.slab(opts.mat || M.dark, w + 0.8, 0.4, d + 0.8, 0, h + 0.2, 0, { collide: true, bevel: 0 });
  const n = opts.ribs ?? Math.max(2, Math.round(d / 3.5));
  for (let i = 0; i < n; i++) {
    const z = -d / 2 + d * ((i + 0.5) / n);
    kit.slab(M.hull, w, 0.34, 0.34, 0, h - 0.2, z, { collide: false, bevel: 0 });
  }
  if (opts.strips !== false) {
    for (let i = 0; i < n; i += 2) {
      const z = -d / 2 + d * ((i + 0.5) / n);
      kit.slab(M.strip, w * 0.66, 0.09, 0.16, 0, h - 0.42, z, { collide: false, bevel: 0 });
    }
  }
}

/** Tiered benches stepping up from a centre — the arena's and the theatre's. */
function tiers(kit, M, w, d, steps, rise, run, opts = {}) {
  for (let i = 0; i < steps; i++) {
    const y = (i + 1) * rise, z = d / 2 - (i + 0.5) * run;
    kit.slab(M.dark, w, rise, run, 0, y - rise / 2, z, { collide: true, bevel: 0 });
    if (opts.strip && i % 2 === 0) kit.slab(M.strip, w * 0.9, 0.06, 0.1, 0, y + 0.03, z - run / 2 + 0.1, { collide: false, bevel: 0 });
  }
}

/** A sunken well: a floor below the room's, with a kerb you can see. */
function sink(kit, M, w, d, depth, ctx, opts = {}) {
  kit.slab(M.deep, w, 0.4, d, 0, -depth - 0.2, 0, { collide: true, bevel: 0 });
  for (const s of [-1, 1]) {
    kit.slab(M.dark, 0.4, depth, d, s * (w / 2 + 0.2), -depth / 2, 0, { collide: true, bevel: 0 });
    kit.slab(M.dark, w + 0.8, depth, 0.4, 0, -depth / 2, s * (d / 2 + 0.2), { collide: true, bevel: 0 });
  }
  /* The kerb light that stops a hole in a dark floor being an ambush. */
  kit.slab(M.strip, w, 0.08, 0.12, 0, -0.06, -d / 2 - 0.15, { collide: false, bevel: 0 });
  if (ctx && opts.record !== false) ctx.sunk.push({ w, d, depth });
}

/** A mezzanine: a half floor at height, with a stair up and a rail. */
function mezzanine(kit, M, w, d, y, opts = {}) {
  const dd = opts.depth ?? d / 2.6;
  const z = opts.z ?? (d / 2 - dd / 2);
  kit.slab(M.dark, w, 0.34, dd, 0, y, z, { collide: true, bevel: 0 });
  /* The rail, drawn so what stops you is visible. */
  kit.slab(M.wing, w, 0.1, 0.12, 0, y + 1.0, z - dd / 2, { collide: true, bevel: 0 });
  for (let i = 0; i * 1.6 < w; i++) {
    kit.slab(M.dark, 0.08, 1.0, 0.08, -w / 2 + i * 1.6 + 0.1, y + 0.5, z - dd / 2, { collide: false, bevel: 0 });
  }
  if (opts.stair !== false) stair(kit, M, opts.stairW ?? 2.2, y, -w / 2 + (opts.stairW ?? 2.2) / 2 + 0.4, z - dd / 2 - 1.4);
}

/** A straight run of steps up to `y`, landing at (x, z), rising toward −Z. */
function stair(kit, M, w, y, x, z) {
  const n = Math.max(3, Math.round(y / 0.24));
  const rise = y / n, run = 0.32;
  for (let i = 0; i < n; i++) {
    kit.slab(M.dark, w, rise + 0.04, run, x, (i + 0.5) * rise, z - (i + 0.5) * run, { collide: true, bevel: 0 });
  }
}

/**
 * THE THREE GANTRY LEVELS OF #4, in metres off the pit's own floor, lowest
 * first. EXPORTED because `Station.js` decides which one the player is
 * standing on from their height, and there must not be a second copy of these
 * three numbers — `StationPlan.js`'s whole header is about what happens when
 * four files each keep their own idea of where something is.
 */
export const GANTRY_Y = Object.freeze([-5.4, -2.8, -0.2]);

/**
 * A flight of steps DOWN from `y0` to `y1`, running along ±Z from `z0`.
 *
 * `stair()` above goes UP to a landing and is the only one anything needed
 * until #4's pit: a hole in the floor with three levels of catwalk in it and
 * no way down is a room whose verb — *"walk the gantries"* — reaches exactly
 * one of the three. Same rise as `stair` (0.24 m a step) so the two read as
 * the same building.
 */
function drop(kit, M, w, y0, y1, x, z0, dir = -1) {
  const n = Math.max(4, Math.round(Math.abs(y0 - y1) / 0.24));
  const rise = (y1 - y0) / n, run = 0.34;
  for (let i = 0; i < n; i++) {
    kit.slab(M.dark, w, 0.18, run + 0.04, x, y0 + (i + 1) * rise, z0 + dir * (i + 0.5) * run,
      { collide: true, bevel: 0 });
  }
  return z0 + dir * n * run;
}

/** A ring of posts — a colonnade, a cage, a cell block's bars. */
function ringOf(kit, M, mat, r, h, n, y = 0, opts = {}) {
  const from = opts.from ?? 0, to = opts.to ?? TAU;
  for (let i = 0; i < n; i++) {
    const a = from + (to - from) * (i / n);
    kit.post(mat, opts.rad ?? 0.16, opts.rad ?? 0.16, h, r * Math.sin(a), y + h / 2, r * Math.cos(a),
      { radial: 6, collide: !!opts.collide });
  }
}

/** A curved wall segment, `n` chords over an arc. */
function arcWall(kit, mat, r, h, from, to, n, y = 0, t = 0.4, collide = true) {
  const span = to - from;
  const wide = 2 * r * Math.tan(Math.abs(span) / n / 2) * 1.06;
  for (let i = 0; i < n; i++) {
    const a = from + span * ((i + 0.5) / n);
    kit.slab(mat, wide, h, t, r * Math.sin(a), y + h / 2, r * Math.cos(a), { ry: a, collide, bevel: 0 });
  }
}

/**
 * A counter with a top and a face — a bar, a stall, a hatch, a desk.
 *
 * ── AND IT SAYS WHERE IT IS, WHICH IS WHAT MADE THE SHOPS REACHABLE ───────
 *
 * `Station.stationKey` had no "standing at" test at all: it asked
 * `countersAt(place.id)` for the shops in the ROOM and took `shops[0]`, so a
 * room with a kiosk AND a counter answered whichever branch ran first — and
 * the kiosk branch ran first, which is the opposite of what the comment above
 * it claimed. Driven for 45 s per room with the real key: #10 The Forge only
 * ever raised `onKiosk:hilt` and #11 the Quartermaster's cage only ever raised
 * `onKiosk:kit`. The armourer and the quartermaster were unreachable, and the
 * quartermaster is the only counter in the game carrying stims and stratagem
 * charges.
 *
 * A reach test needs a fixture to reach for, and `atRegister` is the tree's
 * own precedent for that: the dressing puts a thing somewhere and the key
 * measures the distance to it. The thing already existed — every one of these
 * rooms builds a desk — it just never told anybody where it stood.
 *
 * `kit.after` is the door for that and it is the one the loose bodies already
 * use: it takes a point in this frame and hands it back in WORLD coordinates
 * at the end of the emit, composed through whatever push/pop stack the shape
 * happened to be inside. So the arithmetic is not repeated anywhere, and a
 * shape that moves its counter moves the shop with it — which is exactly what
 * the alternative, a table of coordinates in `Station.js`, would not do.
 */
function counter(kit, M, w, d, x, z, ry = 0, h = 1.08) {
  kit.push(x, 0, z, ry);
  kit.slab(M.deep, w, h - 0.08, d, 0, (h - 0.08) / 2, 0, { collide: true, bevel: 0 });
  kit.slab(M.wing, w + 0.18, 0.08, d + 0.18, 0, h - 0.04, 0, { collide: false, bevel: 0 });
  kit.slab(M.strip, w * 0.9, 0.05, 0.06, 0, 0.16, -d / 2 - 0.04, { collide: false, bevel: 0 });
  /**
   * THREE POINTS, IN WORLD SPACE, AND THE FRAME FALLS OUT OF THEM.
   *
   * `at` is the middle of the desk, `front` is one metre out on the CUSTOMER'S
   * side (−Z of the counter's own frame — the face the strip above lights),
   * and `behind` is where the keeper stands. `front − at` is a unit vector
   * pointing at the customer, so `counterHere` reconstructs the desk's whole
   * frame from two points and never has to know the room's yaw or the depth of
   * the push stack it was built inside.
   *
   * A RADIUS WAS TRIED AND IT WAS WRONG, twice, measured in a browser:
   *   `#10 The Forge` builds its desk 0.4 m off the middle of a 13 × 10 room,
   *     so a 2.4 m radius made the WHOLE MIDDLE of the room the shop and the
   *     hilt bench unreachable — the same defect, one branch over.
   *   `#11 Quartermaster's cage` has its hatch in the front wall, so the
   *     customer stands OUTSIDE the cage, in the Concourse — a radius round
   *     the desk centre put the shop inside the bars where nobody stands.
   * A desk has a front and a back and a width; a circle has none of those.
   */
  kit.after(new THREE.Vector3(0, 0, 0), (world, q) => {
    (kit.counters || (kit.counters = [])).push({
      at: { x: q.x, y: q.y, z: q.z }, front: null, behind: null, w, d,
    });
  });
  kit.after(new THREE.Vector3(0, 0, -d / 2 - 1), (world, q) => {
    const rec = kit.counters?.[kit.counters.length - 1];
    if (rec) rec.front = { x: q.x, y: q.y, z: q.z };
  });
  kit.after(new THREE.Vector3(0, 0, d / 2 + 0.55), (world, q) => {
    const rec = kit.counters?.[kit.counters.length - 1];
    if (rec) rec.behind = { x: q.x, y: q.y, z: q.z };
  });
  kit.pop();
}

/** A wall of shelving or lockers — the racks, the cages, the parts wall. */
function rack(kit, M, w, h, x, z, ry = 0, shelves = 4) {
  kit.push(x, 0, z, ry);
  kit.slab(M.dark, w, h, 0.6, 0, h / 2, 0, { collide: true, bevel: 0 });
  for (let i = 1; i <= shelves; i++) {
    kit.slab(M.wing, w - 0.15, 0.06, 0.7, 0, (h * i) / (shelves + 1), -0.08, { collide: false, bevel: 0 });
  }
  kit.pop();
}

/** A lit screen or board on a wall — the departures board, the tactical wall. */
function board(kit, M, w, h, x, y, z, ry = 0) {
  kit.push(x, 0, z, ry);
  kit.slab(M.dark, w + 0.3, h + 0.3, 0.16, 0, y, 0, { collide: false, bevel: 0 });
  kit.slab(M.screen, w, h, 0.06, 0, y, -0.1, { collide: false, bevel: 0 });
  kit.pop();
}

/** A lit vertical tank — bacta, coolant, a kyber cabinet. */
function tank(kit, M, r, h, x, z) {
  kit.post(M.glass, r, r, h, x, h / 2, z, { radial: 10, collide: true });
  kit.post(M.dark, r + 0.12, r + 0.12, 0.3, x, 0.15, z, { radial: 10 });
  kit.post(M.dark, r + 0.12, r + 0.12, 0.3, x, h - 0.15, z, { radial: 10 });
  kit.slab(M.strip, 0.1, h - 0.7, 0.1, x, h / 2, z - r - 0.06, { collide: false, bevel: 0 });
}

/** A catwalk at height, with a rail — the reactor's, the maintenance bay's. */
function catwalk(kit, M, w, d, y, x, z, ry = 0) {
  kit.push(x, 0, z, ry);
  kit.slab(M.dark, w, 0.16, d, 0, y, 0, { collide: true, bevel: 0 });
  for (const s of [-1, 1]) {
    kit.slab(M.wing, w, 0.08, 0.08, 0, y + 1.02, s * d / 2, { collide: false, bevel: 0 });
    for (let i = 0; i * 1.8 < w; i++) kit.slab(M.dark, 0.07, 1.0, 0.07, -w / 2 + i * 1.8 + 0.2, y + 0.5, s * d / 2, { collide: false, bevel: 0 });
  }
  kit.pop();
}

/**
 * ══ THE LOOSE THINGS, AND THEY ARE THE POINT (§11) ════════════════════════
 *
 * A `Props.Prop` at a kit-space point, made when the kit is emitted. Grabbable
 * by the Force, throwable, cuttable, and armed — the same body a battlefield
 * crate is, which is exactly what the player asked the station to be made of.
 *
 * A `kit.after` and not a bare call, because a maker composed into a kit is
 * building in KIT SPACE and a rigid body has no kit space to live in; `after`
 * is handed the world point at emit. That is `Props.Kit`'s own hook and its
 * header records the bug that made it necessary.
 */
function loose(kit, x, y, z, make) {
  kit.after(new THREE.Vector3(x, y, z), (world, p) => make(world, p));
}

/** A table: a top on legs, as one throwable body. */
function tableBody(world, p, M, w = 1.5, d = 0.9, h = 0.78) {
  const g = slabGeo(w, 0.07, d, { bevel: 0.02 });
  g.translate(0, h - 0.035, 0);
  const parts = [g];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const l = cylGeo(0.05, 0.05, h, 6, 1);
    l.translate(sx * (w / 2 - 0.12), h / 2, sz * (d / 2 - 0.1));
    parts.push(l);
  }
  return bodyFrom(world, p, parts, M.deep, { mass: 16, kind: 'table' });
}

/** A stool or chair: a seat, a back, four legs. */
function chairBody(world, p, M) {
  const s = slabGeo(0.44, 0.06, 0.42, { bevel: 0.02 }); s.translate(0, 0.45, 0);
  const b = slabGeo(0.42, 0.5, 0.06, { bevel: 0.02 }); b.translate(0, 0.72, 0.18);
  const parts = [s, b];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const l = cylGeo(0.035, 0.035, 0.45, 5, 1);
    l.translate(sx * 0.17, 0.225, sz * 0.16);
    parts.push(l);
  }
  return bodyFrom(world, p, parts, M.deep, { mass: 7, kind: 'chair' });
}

/** A locker, a cabinet, a console shell — one upright box with a face. */
function boxBody(world, p, M, w, h, d, mat, mass = 22, kind = 'crate') {
  const g = slabGeo(w, h, d, { bevel: 0.03 });
  g.translate(0, h / 2, 0);
  return bodyFrom(world, p, [g], mat, { mass, kind });
}

function bodyFrom(world, p, geos, mat, opts) {
  let verts = 0, idx = 0;
  for (const g of geos) { verts += g.attributes.position.count; idx += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3);
  const ind = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    const gi = g.index ? g.index.array : null;
    if (gi) for (let i = 0; i < gi.length; i++) ind[io + i] = gi[i] + vo;
    else for (let i = 0; i < g.attributes.position.count; i++) ind[io + i] = i + vo;
    io += gi ? gi.length : g.attributes.position.count;
    vo += g.attributes.position.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(ind, 1));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  return new Prop(world, { mesh, position: p.clone(), mass: opts.mass, kind: opts.kind, hp: opts.hp ?? 30, weather: false });
}

/** Scatter `n` of something across a footprint, deterministically. */
function scatter(kit, n, w, d, seed, make) {
  let h = seed >>> 0;
  const rnd = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; };
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * w * 0.82, z = (rnd() - 0.5) * d * 0.82;
    make(x, z, rnd());
  }
}


/* ══════════════════════════════════════════════════════════════════════════ */
/*  TEXT ON A SURFACE — §14's boards, signs and rolls                         */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ A PANEL WITH WORDS ON IT ══════════════════════════════════════════════
 *
 * §14: *"Names from `names.py` on a nameplate when you look at someone"*, and
 * V15 wants the station's own name on every board that names it. Both need
 * text on geometry, and this engine already has exactly one way to do that —
 * `DeckLift.makeReadout`'s canvas texture — so this is that, generalised.
 *
 * TWO DIFFERENCES FROM THE LIFT'S, and both are §9.1:
 *
 *   The lift's readout carries `saberNoInk`, because it is a bright screen in
 *   a dark car and the ink pass would ring it. §9.1 forbids that inside a
 *   room, so these are INKED, which is right: a departures board is a panel
 *   with a frame and the frame should be drawn.
 *
 *   It is NAMED `station-sign-*`. `station.mjs` asserts every material in a
 *   place matches the engine's own naming, and an unnamed material is how a
 *   loader's would arrive.
 *
 * Headless-safe: with no `document` there is no canvas, and the material falls
 * back to a flat panel. Every check in this tree runs that way.
 */
export function signPanel(lines, opts = {}) {
  const W = opts.px || 512, H = opts.pyx || 256;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = W; canvas.height = H; }
  const ctx = canvas?.getContext?.('2d') || null;
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; }
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: tex ? 0xffffff : (opts.ink || 0xffd9a0), toneMapped: false,
  });
  mat.name = `station-sign-${opts.name || 'panel'}`;
  mat.userData.key = 'sign';
  /**
   * ── A ROW MAY BE LIT, AND THAT IS THE WHOLE OF V15 §1.2's SECOND HALF ───
   *
   * *"Your own row is lit; everyone else's is engraved."* A row is either a
   * string — engraved, the default every board in this file uses — or
   * `{ t, lit }`, and a lit one is drawn in `opts.lit1` instead of `ink2`.
   *
   * It is a shape on the ROW and not a second argument to `draw` because the
   * key that early-outs on identical text has to see it: a redraw that
   * changed only which row is lit and kept the same words would have been
   * skipped, and the moment a run files at the obelisk is exactly that
   * redraw. `rowText`/`rowLit` are the two readers and nothing else unpacks it.
   */
  const rowText = (r) => String(r && typeof r === 'object' ? r.t : r).toUpperCase();
  const rowLit = (r) => !!(r && typeof r === 'object' && r.lit);
  const panel = {
    material: mat, texture: tex,
    /** Redraw. Cheap and idempotent: it early-outs on identical text. */
    draw(rows) {
      const key = rows.map((r) => (rowLit(r) ? '*' : '') + rowText(r)).join('\u0001');
      /* The rows are KEPT, so a caller that changes one line — the station's
       * name, on every board at once — does not have to know how the rest of
       * the panel was laid out. */
      panel._rows = rows;
      if (key === panel._key || !ctx) { panel._key = key; return panel; }
      panel._key = key;
      ctx.fillStyle = opts.bg || '#0d0a07';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = opts.align || 'center';
      ctx.textBaseline = 'middle';
      const x = opts.align === 'left' ? 24 : W / 2;
      const n = rows.length || 1;
      for (let i = 0; i < rows.length; i++) {
        const big = i === 0 && opts.head !== false;
        ctx.fillStyle = big ? (opts.head1 || '#ffd9a0')
          : (rowLit(rows[i]) ? (opts.lit1 || '#ffe6bd') : (opts.ink2 || '#c9a06a'));
        ctx.font = `bold ${big ? Math.round(H / 3.4) : Math.round(H / (n + 2.2))}px "Courier New", monospace`;
        ctx.fillText(rowText(rows[i]), x, (H * (i + 0.85)) / (n + 0.7));
      }
      if (tex) tex.needsUpdate = true;
      return panel;
    },
  };
  panel.draw(lines || ['']);
  return panel;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PLANS — one per shape, and no two alike                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every builder is called with the kit already framed on the place: local
 * origin at the floor's centre, +Z radially outward (or the plan's yaw), and
 * `p.w` × `p.d` × `p.h` its interior. So a builder never does arithmetic about
 * where in the drum it is, which is what makes fifty of them readable.
 */
export const SHAPES = {

  /* ══════════════════════════════════════════════════════════════════════
   *  THE THREE ROOMS THAT ARE NORMALLY IMPORTED, BUILT FROM THE KIT
   * ══════════════════════════════════════════════════════════════════════
   *
   * `#9 The Concourse`, `#41 Command / CIC` and `#54 Observation dome` carry a
   * `room:` in the gazetteer, so `dressStation` normally stands the decoded
   * `.smesh` there instead of calling a builder. These three are what it uses
   * when that mesh is NOT there.
   *
   * ── WHY THAT CASE HAS TO EXIST ────────────────────────────────────────
   *
   * It threw. `placeRoom` answered a missing room with `throw new Error(...)`,
   * which is right for a typo in the gazetteer and catastrophic for the only
   * way it actually happens: an asset that did not arrive. The three rooms are
   * 1.5 MB of `.smesh` fetched at the door, and a 404, a truncated download or
   * a cold cache took the whole world down with a stack trace — on the biggest
   * space in the station, the one every visit starts in. A hall you can walk
   * through with the wrong ceiling is a bad frame; a black screen is not a
   * game. `living-force.mjs` boots every mode the game has and hit exactly
   * this, which is how it was found.
   *
   * They are deliberately PLAIN — a shell, the room's own furniture, and the
   * things §3.1 rule 5 requires (no sealed room, a door where the plan says a
   * door). They are not trying to be the imported art and they never draw when
   * it is present.
   */

  /** #9 The Concourse — a 22 × 67 m barrel hall, open at BOTH ends: the atrium
   * at one, the ring at the other. Two colonnades and a mezzanine down one
   * side, which is the shape the Zocalo mesh has and the least of it. */
  vault(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { open: ['front', 'back'], doorW: 8 });
    ceiling(kit, M, w, d, h, { ribs: 16 });
    /* The colonnades, which are what make a hall a hall rather than a corridor
     * with a high ceiling. */
    for (const sx of [-1, 1]) {
      for (let i = 0; i * 6.2 < d - 6; i++) {
        const z = -d / 2 + 4 + i * 6.2;
        kit.post(M.hull, 0.9, 0.9, h, sx * (w / 2 - 3.2), h / 2, z, { radial: 8, collide: true });
        kit.slab(M.strip, 0.5, 0.06, 0.5, sx * (w / 2 - 3.2), h - 0.4, z, { collide: false, bevel: 0 });
      }
    }
    /* The upper walk down ONE LONG SIDE, built here rather than through
     * `mezzanine`: that helper lays its deck across the room's width, and this
     * one runs the length of it. Rail toward the hall, stairs at both ends. */
    const walkD = d - 9, walkW = 4.2, walkX = w / 2 - walkW / 2 - 0.4, walkY = 3.9;
    kit.slab(M.dark, walkW, 0.34, walkD, walkX, walkY, 0, { collide: true, bevel: 0 });
    kit.slab(M.wing, 0.12, 0.1, walkD, walkX - walkW / 2, walkY + 1.05, 0, { collide: true, bevel: 0 });
    for (let i = 0; i * 1.8 < walkD; i++) {
      kit.slab(M.dark, 0.08, 1.0, 0.08, walkX - walkW / 2, walkY + 0.55, -walkD / 2 + i * 1.8, { collide: false, bevel: 0 });
    }
    for (const sz of [-1, 1]) stair(kit, M, 2.4, walkY, walkX, sz * (walkD / 2 - 0.4) + (sz > 0 ? 0 : 3.4));
    /* Shopfronts down both walls and benches down the middle. */
    for (const sx of [-1, 1]) {
      for (let i = 0; i * 9 < d - 10; i++) {
        const z = -d / 2 + 6 + i * 9;
        counter(kit, M, 3.4, 0.9, sx * (w / 2 - 1.6), z, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        board(kit, M, 2.2, 0.9, sx * (w / 2 - 0.7), 3.0, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
    }
    for (let i = -3; i <= 3; i++) {
      loose(kit, 0, 0, i * 8, (world, q) => boxBody(world, q, M, 3.0, 0.46, 0.8, M.wing, 34, 'bench'));
    }
    scatter(kit, 10, w * 0.5, d * 0.8, 31, (x, z) => loose(kit, x, 0, z, (world, q) => makeCrate(world, q, 0.6)));
  },

  /** #41 Command / CIC — a sunken pit under a rail, screens all round it and a
   * gallery you brief from. Small, dark and busy. */
  daispit(kit, M, p, ctx) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { open: ['back'], doorW: 3.2, mat: M.dark });
    ceiling(kit, M, w, d, h, { ribs: 6 });
    /* The pit, and the rail round it — the rail is the reason you can brief
     * from the floor and look down at the plot. */
    sink(kit, M, w - 5.0, d - 5.0, 1.2, ctx);
    for (const s of [-1, 1]) {
      kit.slab(M.wing, w - 5.0, 0.1, 0.12, 0, 1.05, s * ((d - 5.0) / 2 + 0.3), { collide: true, bevel: 0 });
      kit.slab(M.wing, 0.12, 0.1, d - 5.0, s * ((w - 5.0) / 2 + 0.3), 1.05, 0, { collide: true, bevel: 0 });
    }
    stair(kit, M, 2.0, 1.2, 0, -(d - 5.0) / 2 + 0.4);
    /* The plot table in the well, and the consoles round it. */
    kit.post(M.dark, 2.2, 2.0, 0.5, 0, -0.95, 0, { radial: 10, collide: true });
    kit.post(M.screen, 3.0, 3.0, 0.16, 0, -0.62, 0, { radial: 14 });
    /* The consoles stand on the FLOOR at the rail, not in the well: `counter`
     * builds up from y = 0 and the pit is 1.2 m down, so a console in the well
     * would be a console buried to its top. You lean on the rail and look
     * down at the plot, which is what the rail is for. */
    for (let i = 0; i < 6; i++) {
      const a = TAU * (i / 6) + 0.3, r = Math.min(w, d) / 2 - 1.4;
      counter(kit, M, 1.8, 0.8, r * Math.sin(a), r * Math.cos(a), a + Math.PI);
    }
    /* The screen wall, which is what a CIC is: everybody looking at the same
     * thing at the same time. */
    for (let i = -1; i <= 1; i++) board(kit, M, 3.4, 2.0, i * 3.8, h - 2.6, d / 2 - 0.55, Math.PI);
    for (let i = 0; i < 4; i++) loose(kit, (i - 1.5) * 2.0, 0, -d / 2 + 1.8, (world, q) => chairBody(world, q, M));
  },

  /** #54 Observation dome — the hub of the top deck: a round room with the
   * glass over you and nothing between you and the battle. */
  glassdome(kit, M, p) {
    const { w, d, h } = p;
    const r = Math.min(w, d) / 2;
    for (let i = 0; i < 12; i++) {
      const a = TAU * (i / 12);
      kit.slab(M.deep, 2 * r * Math.tan(Math.PI / 12) * 1.06, 0.4, r,
        r / 2 * Math.sin(a), -0.2, r / 2 * Math.cos(a), { ry: a, collide: true, bevel: 0 });
    }
    /* Waist-high wall, then glass: you stand at the edge and look out. */
    arcWall(kit, M.hull, r, 1.1, 0.5, TAU - 0.5, 20);
    arcWall(kit, M.glass, r, h - 1.4, 0.5, TAU - 0.5, 20, 1.1, 0.18, false);
    /* The dome ribs, meeting at a lit boss. */
    for (let i = 0; i < 12; i++) {
      const a = TAU * (i / 12);
      kit.slab(M.hull, 0.22, 0.22, r * 1.15, r / 2 * Math.sin(a), h * 0.75, r / 2 * Math.cos(a),
        { ry: a, rx: 0.5, collide: false, bevel: 0 });
    }
    kit.post(M.strip, 0.7, 0.7, 0.3, 0, h + 0.4, 0, { radial: 10 });
    /* Seats round the rim, facing out, and a lit table in the middle. */
    for (let i = 0; i < 8; i++) {
      const a = TAU * (i / 8) + 0.4;
      loose(kit, (r - 1.9) * Math.sin(a), 0, (r - 1.9) * Math.cos(a), (world, q) => chairBody(world, q, M));
    }
    loose(kit, 0, 0, 0, (world, q) => tableBody(world, q, M, 1.6, 1.6));
  },

  /* ── DECK 40 ──────────────────────────────────────────────────────────── */

  /** #7 Arrivals: CURVED. A long shallow crescent, glazed on its outer face,
   * with three customs gates across it and a board over them. */
  curvedhall(kit, M, p, ctx) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { open: ['back'], glaze: true, doorW: 6 });
    ceiling(kit, M, w, d, h, { ribs: 9 });
    /* The customs line: three gates, each an arch with a lit threshold. */
    for (let i = -1; i <= 1; i++) {
      const x = i * (w / 4);
      for (const s of [-1, 1]) kit.slab(M.wing, 0.5, 2.9, 1.4, x + s * 1.5, 1.45, 1.5, { collide: true, bevel: 0 });
      kit.slab(M.dark, 3.5, 0.5, 1.4, x, 3.15, 1.5, { collide: false, bevel: 0 });
      kit.slab(M.strip, 2.6, 0.08, 0.1, x, 2.86, 0.82, { collide: false, bevel: 0 });
    }
    board(kit, M, 8, 2.2, 0, h - 2.0, d / 2 - 0.6);
    /* Benches down the concourse side, and bags people put down. */
    for (let i = -2; i <= 2; i++) {
      loose(kit, i * 6, 0, -d / 2 + 3.2, (world, q) => boxBody(world, q, M, 2.6, 0.46, 0.7, M.wing, 30, 'bench'));
    }
    scatter(kit, 7, w * 0.7, d * 0.5, 71, (x, z) => loose(kit, x, 0, z, (world, q) => makeCrate(world, q, 0.5)));
  },

  /** #8 Docking throat: a COLLAR. A tube through the skin with a shuttle nose
   * in it, umbilicals, and a ramp down. No ceiling — you are inside a joint. */
  collar(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    arcWall(kit, M.hull, w / 2, h, -1.9, 1.9, 10);
    /* The collar rings, stepping in toward the shuttle. */
    for (let i = 0; i < 4; i++) {
      ringOf(kit, M, M.dark, w / 2 - 1 - i * 0.7, 0.5, 18, h - 1.6 - i * 0.3, { rad: 0.3 });
    }
    /* The shuttle's nose, filling the far end. */
    kit.post(M.wing, 2.4, 3.4, 7, 0, h / 2 - 1, d / 2 - 1.5, { rx: Math.PI / 2, radial: 10, collide: true });
    /* The ramp down out of it. */
    for (let i = 0; i < 8; i++) kit.slab(M.dark, 3.4, 0.22, 0.5, 0, 1.8 - i * 0.22, d / 2 - 5 - i * 0.5, { collide: true, bevel: 0 });
    /* The fuel line and the umbilicals, and cargo at the ramp's foot. */
    for (const s of [-1, 1]) kit.post(M.dark, 0.22, 0.22, d * 0.7, s * (w / 2 - 1.4), h - 1.4, 0, { rx: Math.PI / 2, radial: 6 });
    scatter(kit, 9, w * 0.6, d * 0.4, 17, (x, z) => loose(kit, x, 0, z - 3, (world, q) => makeCrate(world, q, 0.8)));
  },

  /** #10 The Forge: an ALCOVE SHOP. Open to the hall on one long side, a
   * bench across the middle, a pegboard wall, and the kyber cabinet lit. */
  alcoveshop(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: w - 1.2 });
    ceiling(kit, M, w, d, h, { ribs: 3, strips: false });
    rack(kit, M, w - 1.5, h - 0.9, 0, d / 2 - 0.5, 0, 5);
    counter(kit, M, w - 3, 0.9, 0, -0.4, 0, 1.0);
    /* The vice on the bench, and the cabinet with the light inside it. */
    kit.slab(M.wing, 0.4, 0.35, 0.3, w / 4, 1.15, -0.4, { collide: false, bevel: 0 });
    kit.slab(M.dark, 1.2, 2.1, 0.7, -w / 2 + 0.9, 1.05, d / 2 - 1.6, { collide: true, bevel: 0 });
    kit.slab(M.strip, 0.9, 1.6, 0.1, -w / 2 + 0.95, 1.15, d / 2 - 2.0, { collide: false, bevel: 0 });
    for (let i = 0; i < 4; i++) loose(kit, -2 + i * 1.4, 1.05, -0.4, (world, q) => makeBarrel(world, q));
  },

  /** #11 Quartermaster's cage: a CAGE. Bars floor to soffit across the front,
   * racks on three sides, one hatch. The room is a grid you look through. */
  cage(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { open: ['front'] });
    ceiling(kit, M, w, d, h, { ribs: 2 });
    /* The bars: the whole front, with a hatch cut in the middle. */
    for (let i = 0; i * 0.34 < w; i++) {
      const x = -w / 2 + i * 0.34;
      if (Math.abs(x) < 1.1) continue;
      kit.post(M.wing, 0.05, 0.05, h, x, h / 2, -d / 2, { radial: 4, collide: true });
    }
    for (const y of [1.3, 2.6]) kit.slab(M.wing, w, 0.07, 0.07, 0, y, -d / 2, { collide: false, bevel: 0 });
    counter(kit, M, 2.2, 0.8, 0, -d / 2 + 0.4, 0, 1.1);
    rack(kit, M, w - 1, h - 0.6, 0, d / 2 - 0.5, 0, 6);
    for (const s of [-1, 1]) rack(kit, M, d - 1.6, h - 0.6, s * (w / 2 - 0.5), 0, s * Math.PI / 2, 6);
    scatter(kit, 6, w * 0.5, d * 0.4, 33, (x, z) => loose(kit, x, 0, z, (world, q) => makeCrate(world, q, 0.55)));
  },

  /** #12 Recruiting: GLASS-FRONTED. A shallow box whose whole front is glass,
   * a crest on the back wall, a holoscreen, a desk and a queue rail. */
  glassfront(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { open: ['front'] });
    ceiling(kit, M, w, d, h, { ribs: 3 });
    kit.slab(M.glass, w, h - 0.5, 0.14, 0, h / 2, -d / 2, { collide: true, bevel: 0 });
    for (let i = 1; i * 2.2 < w; i++) kit.slab(M.dark, 0.14, h, 0.24, -w / 2 + i * 2.2, h / 2, -d / 2, { collide: false, bevel: 0 });
    kit.slab(M.mark, 3.0, 3.0, 0.12, 0, h - 2.2, d / 2 - 0.3, { collide: false, bevel: 0 });
    board(kit, M, 3.2, 1.8, -w / 4, 2.0, d / 2 - 0.5);
    counter(kit, M, 3.0, 1.0, w / 4, d / 4, 0, 1.05);
    /* The queue rail, which is what makes a shop read as one. */
    for (let i = 0; i < 5; i++) kit.post(M.wing, 0.05, 0.05, 1.0, -w / 2 + 1.2 + i * 1.5, 0.5, -d / 4, { radial: 5 });
    kit.slab(M.wing, 6.2, 0.05, 0.05, -w / 2 + 3.4, 1.0, -d / 4, { collide: false, bevel: 0 });
    for (let i = 0; i < 3; i++) loose(kit, -2 + i * 2, 0, 0, (world, q) => chairBody(world, q, M));
  },

  /** #13 The Databank: a ROTUNDA. Round, terminals in a ring facing inward,
   * a holo globe on a plinth at the centre, a domed soffit. */
  rotunda(kit, M, p) {
    const { w, d, h } = p;
    const r = Math.min(w, d) / 2;
    /* A round floor: twelve wedges, so the edge is round and not square. */
    for (let i = 0; i < 12; i++) {
      const a = TAU * (i / 12);
      kit.slab(M.deep, 2 * r * Math.tan(Math.PI / 12) * 1.06, 0.4, r, r / 2 * Math.sin(a), -0.2, r / 2 * Math.cos(a), { ry: a, collide: true, bevel: 0 });
    }
    arcWall(kit, M.hull, r, h, 0.42, TAU - 0.42, 18);
    /* A dome: four rings stepping in. */
    for (let i = 0; i < 4; i++) ringOf(kit, M, M.dark, r * (1 - i * 0.2), 0.36, 24, h + i * 0.5, { rad: 0.34 });
    kit.post(M.strip, 0.8, 0.8, 0.3, 0, h + 2.1, 0, { radial: 10 });
    /* The terminals, in a ring, each a desk and a screen. */
    for (let i = 0; i < 8; i++) {
      const a = TAU * (i / 8) + 0.2;
      counter(kit, M, 2.0, 0.8, (r - 1.6) * Math.sin(a), (r - 1.6) * Math.cos(a), a + Math.PI, 0.95);
      board(kit, M, 1.2, 0.7, (r - 1.6) * Math.sin(a), 1.5, (r - 1.6) * Math.cos(a), a + Math.PI);
    }
    /* The globe. */
    kit.post(M.dark, 0.8, 0.6, 1.0, 0, 0.5, 0, { radial: 12, collide: true });
    kit.post(M.screen, 1.3, 1.3, 1.3, 0, 2.0, 0, { radial: 12 });
    for (let i = 0; i < 4; i++) loose(kit, (i - 1.5) * 1.6, 0, 0, (world, q) => chairBody(world, q, M));
  },

  /** #14 The Cantina: SUNKEN AND ROUND. You come in at the concourse's level
   * and step down half a deck; the bar is a ring in the middle of the well,
   * booths are cut into the wall, and the band's dais is at the back. */
  sunkenround(kit, M, p, ctx) {
    const { w, d, h } = p;
    const depth = 2.2;
    floor(kit, M, w, 4, 0);
    kit.slab(M.deep, w, 0.4, 4, 0, -0.2, -d / 2 + 2, { collide: true, bevel: 0 });
    sink(kit, M, w - 3, d - 6, depth, ctx);
    /* Steps down, the full width, so the drop reads as an invitation. */
    for (let i = 0; i < 8; i++) kit.slab(M.dark, w - 3, 0.28, 0.6, 0, -i * 0.275, -d / 2 + 4 + i * 0.6, { collide: true, bevel: 0 });
    walls(kit, M, w, d, h, { doorW: w - 4 });
    ceiling(kit, M, w, d, h, { ribs: 5, strips: false });
    /* The bar: a ring in the round with a back-bar column inside it. */
    const br = 3.6;
    for (let i = 0; i < 14; i++) {
      const a = TAU * (i / 14);
      counter(kit, M, 2 * br * Math.tan(Math.PI / 14) * 1.06, 0.9, br * Math.sin(a), br * Math.cos(a) + 1, a, 1.12);
    }
    kit.post(M.dark, 1.4, 1.4, 2.6, 0, -depth + 1.3, 1, { radial: 10, collide: true });
    kit.post(M.strip, 1.5, 1.5, 0.2, 0, -depth + 2.7, 1, { radial: 10 });
    /* Booths in the wall, and the coloured lights over them. */
    for (let i = 0; i < 8; i++) {
      const a = TAU * (i / 8) + 0.39;
      const rr = (w - 3) / 2 - 1.2;
      kit.slab(M.deep, 2.4, 1.3, 0.5, rr * Math.sin(a), -depth + 0.65, rr * Math.cos(a) + 1, { ry: a, collide: true, bevel: 0 });
      kit.slab(M.status, 0.7, 0.14, 0.14, rr * Math.sin(a) * 0.94, -depth + 2.4, rr * Math.cos(a) * 0.94 + 1, { ry: a, collide: false, bevel: 0 });
    }
    /* The band's dais. */
    kit.slab(M.dark, 5, 0.5, 3, 0, -depth + 0.25, d / 2 - 3.4, { collide: true, bevel: 0 });
    for (let i = 0; i < 10; i++) loose(kit, ((i % 5) - 2) * 2.2, -depth, (i < 5 ? -2 : 4), (world, q) => chairBody(world, q, M));
    for (let i = 0; i < 4; i++) loose(kit, (i - 1.5) * 3, -depth, 5.5, (world, q) => tableBody(world, q, M, 1.1, 1.1, 0.74));
  },

  /** #15 The Fresh Air: a TERRACE. No fourth wall — the room ends in a rail
   * over the atrium. White cloth on tables, planters, the kitchen pass. */
  terrace(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { open: ['front'] });
    ceiling(kit, M, w, d, h, { ribs: 4 });
    /* The rail over the void, and the planters along it. */
    kit.slab(M.wing, w, 0.1, 0.14, 0, 1.02, -d / 2, { collide: true, bevel: 0 });
    for (let i = 0; i * 1.4 < w; i++) kit.slab(M.dark, 0.08, 1.0, 0.08, -w / 2 + i * 1.4 + 0.2, 0.5, -d / 2, { collide: false, bevel: 0 });
    for (let i = -2; i <= 2; i++) {
      kit.slab(M.mark, 1.1, 0.6, 0.7, i * 3.6, 0.3, -d / 2 + 0.9, { collide: true, bevel: 0 });
      kit.post(M.strip, 0.35, 0.1, 0.9, i * 3.6, 1.05, -d / 2 + 0.9, { radial: 6 });
    }
    /* The pass, with the kitchen seen through it. */
    kit.slab(M.hull, w, h - 1.4, 0.4, 0, (h - 1.4) / 2 + 1.4, d / 2 - 0.3, { collide: true, bevel: 0 });
    counter(kit, M, w - 4, 0.7, 0, d / 2 - 0.7, 0, 1.15);
    kit.slab(M.strip, w - 4.4, 0.09, 0.1, 0, 1.45, d / 2 - 1.1, { collide: false, bevel: 0 });
    for (let i = 0; i < 6; i++) {
      const x = ((i % 3) - 1) * 5, z = (i < 3 ? -2.2 : 1.4);
      loose(kit, x, 0, z, (world, q) => tableBody(world, q, M, 1.3, 1.3, 0.76));
      loose(kit, x + 0.9, 0, z, (world, q) => chairBody(world, q, M));
      loose(kit, x - 0.9, 0, z, (world, q) => chairBody(world, q, M));
    }
  },

  /** #16 Galley: a WORK ROOM. Low, hot, two ranges back to back down the
   * middle, pots hung over them, a cold-room door in the end wall. */
  workroom(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    walls(kit, M, w, d, h);
    ceiling(kit, M, w, d, h, { ribs: 3, strips: false });
    /* Two ranges, back to back, with the extraction hood over them. */
    for (const s of [-1, 1]) {
      kit.slab(M.wing, w - 2.4, 0.9, 1.0, 0, 0.45, s * 1.1, { collide: true, bevel: 0 });
      kit.slab(M.status, w - 3, 0.06, 0.5, 0, 0.92, s * 1.1, { collide: false, bevel: 0 });
    }
    kit.slab(M.dark, w - 1.6, 0.7, 3.2, 0, h - 0.6, 0, { collide: false, bevel: 0 });
    /* The pot rail, and the pots on it — every one of them throwable (#16's
     * verb IS "throw pots"). */
    kit.slab(M.wing, w - 2, 0.06, 0.06, 0, h - 1.2, 0, { collide: false, bevel: 0 });
    for (let i = 0; i < 8; i++) loose(kit, -w / 2 + 1.4 + i * ((w - 2.8) / 7), 0.95, 1.1, (world, q) => makeBarrel(world, q));
    /* The cold room: a heavy door in the end wall with its own light. */
    kit.slab(M.wing, 2.0, 2.4, 0.3, w / 2 - 1.8, 1.2, d / 2 - 0.2, { collide: true, bevel: 0 });
    kit.slab(M.strip, 1.6, 0.08, 0.1, w / 2 - 1.8, 2.5, d / 2 - 0.4, { collide: false, bevel: 0 });
    rack(kit, M, w - 3, h - 0.8, 0, -d / 2 + 0.5, Math.PI, 5);
  },

  /** #17 Food court: LOW COUNTERS in a row. The lowest ceiling on the deck,
   * one long line of vendor fronts, stools facing them, steam and neon. */
  lowcounters(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: w - 3 });
    ceiling(kit, M, w, d, h, { ribs: 8, strips: false });
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * (w / 3);
      counter(kit, M, w / 3 - 0.6, 1.1, x, d / 2 - 1.4, 0, 1.15);
      kit.slab(M.dark, w / 3 - 0.6, 1.5, 0.5, x, h - 0.9, d / 2 - 0.5, { collide: false, bevel: 0 });
      kit.slab(M.screen, w / 3 - 1.4, 0.8, 0.06, x, h - 0.95, d / 2 - 0.8, { collide: false, bevel: 0 });
      /* The steam vent above each — the thing that makes a counter a kitchen. */
      kit.post(M.wing, 0.18, 0.18, 1.2, x, h - 0.6, d / 2 - 2.4, { radial: 6 });
    }
    for (let i = 0; i < 10; i++) {
      loose(kit, -w / 2 + 1.6 + i * ((w - 3.2) / 9), 0, d / 2 - 2.8, (world, q) => boxBody(world, q, M, 0.4, 0.72, 0.4, M.deep, 6, 'stool'));
    }
  },

  /** #18 The Pit: a LOW DEN. One exit, a cashier behind bars in the corner,
   * a dice cage on a stand and four sabacc tables under hanging lamps. */
  lowden(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    walls(kit, M, w, d, h, { doorW: 2.4 });
    ceiling(kit, M, w, d, h, { ribs: 6, strips: false });
    /* The cashier: a box of bars in the far corner. */
    kit.push(w / 2 - 2.2, 0, d / 2 - 1.8, 0);
    kit.slab(M.dark, 4, h, 0.4, 0, h / 2, 1.6, { collide: true, bevel: 0 });
    counter(kit, M, 3.6, 0.7, 0, 1.0, 0, 1.05);
    for (let i = 0; i * 0.3 < 3.6; i++) kit.post(M.wing, 0.04, 0.04, h - 1.1, -1.8 + i * 0.3, 1.1 + (h - 1.1) / 2, 1.0, { radial: 4 });
    kit.pop();
    /* The dice cage on its stand. */
    kit.post(M.dark, 0.35, 0.35, 1.0, -w / 2 + 2, 0.5, d / 2 - 2, { radial: 8, collide: true });
    kit.post(M.wing, 0.6, 0.6, 0.9, -w / 2 + 2, 1.45, d / 2 - 2, { radial: 8, open: true });
    /* Four tables, each with a lamp hung over it — the room's only light. */
    for (let i = 0; i < 4; i++) {
      const x = ((i % 2) - 0.5) * 5, z = (i < 2 ? -2.2 : 2.2);
      loose(kit, x, 0, z, (world, q) => tableBody(world, q, M, 1.9, 1.9, 0.75));
      kit.post(M.dark, 0.04, 0.04, h - 2.2, x, h - (h - 2.2) / 2, z, { radial: 4 });
      kit.post(M.strip, 0.45, 0.15, 0.3, x, 2.1, z, { radial: 8 });
      for (let k = 0; k < 3; k++) loose(kit, x + Math.cos(k * 2) * 1.3, 0, z + Math.sin(k * 2) * 1.3, (world, q) => chairBody(world, q, M));
    }
  },

  /**
   * #60 The Wheelhouse: A WHEEL STOOD ON EDGE (V16 §D1).
   *
   * The one room on the station whose silhouette is a CIRCLE IN THE AIR. Rule
   * 4 is measured from the door and every other gambling room on deck 40
   * answers it with furniture on a floor — `lowden` is four tables under
   * lamps, `sunkenround` is a bar in a well, `sunkenring` is tiers round a
   * pit, `fanauditorium` is a rake of seats. This is a twenty-segment disc
   * eleven metres across standing vertically at the far end of a tall narrow
   * hall, filling the top half of the frame from the doorway, and nothing
   * else in the drum has a vertical circle in it at all.
   *
   * ── AND THE ROOM IS THE SHAPE THE SITING FORCED ───────────────────────
   *
   * 14 m across the front and 16 m deep is the only footprint deck 40's outer
   * band had left (see the note on the gazetteer row). That is a room you
   * enter down its short axis, so the plan is a PROCESSION rather than a
   * floor: the cage and the standing rail at the door, the tables in the low
   * half, the dejarik column alone on the centreline, then two steps up to
   * the dais and the wheel over it. Every one of those reads at a different
   * height from the door, which is what makes the raster of this room unlike
   * the raster of a room with tables in it.
   *
   * THE WHEEL IS TWENTY SEGMENTS BECAUSE `Games.DRUM.SEGMENTS` IS TWENTY, and
   * the two must not disagree — a wheel a player counts sixteen spokes on
   * while the panel prices three-in-twenty is a room that lies about its own
   * odds. The number is imported rather than typed.
   */
  wheelhall(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    /* A NARROW FRONT. 2.6 m in a 14 m wall is a door you notice going through,
     * which is the difference between a hall and a shopfront. */
    walls(kit, M, w, d, h, { doorW: 2.6 });
    ceiling(kit, M, w, d, h, { ribs: 7, strips: false });

    /* ── THE DAIS, at the far end. Two steps, so the wheel stands over a
     * floor the crowd is below rather than on. */
    const daisD = 4.4, daisZ = d / 2 - daisD / 2 - 0.6;
    for (let i = 0; i < 2; i++) {
      kit.slab(M.deep, w - 2.4 - i * 1.6, 0.34, daisD + 1.2 - i * 1.2, 0, 0.17 + i * 0.34, daisZ - 0.6 + i * 0.6,
        { collide: true, bevel: 0.03 });
    }
    kit.slab(M.strip, w - 4.6, 0.06, 0.1, 0, 0.72, daisZ - 2.3, { collide: false, bevel: 0 });

    /* ── THE DRUM. A rim, a hub, and one spoke per segment, stood on edge
     * over the dais. `SEGMENTS.length` and not a literal — see the note. */
    const n = DRUM_SEGMENTS, R = 5.5, cy = 4.0, cz = d / 2 - 1.1;
    /* The rim as `n` chords, so the count is legible from the floor: a player
     * can see which segment the pointer is on without a caption. */
    for (let i = 0; i < n; i++) {
      const a = (TAU * (i + 0.5)) / n;
      const chord = 2 * R * Math.sin(Math.PI / n) * 1.04;
      kit.slab(i % 2 ? M.mark : M.wing, chord, 0.42, 0.5,
        R * Math.sin(a), cy + R * Math.cos(a), cz, { rz: -a, collide: false, bevel: 0.03 });
    }
    for (let i = 0; i < n; i++) {
      const a = (TAU * i) / n;
      /* A spoke is a thin slab from the hub to the rim, laid along the radius
       * — `rz` turns it, and the offset puts its middle half way out. */
      kit.slab(M.hull, 0.14, R - 0.5, 0.26,
        (R / 2) * Math.sin(a), cy + (R / 2) * Math.cos(a), cz, { rz: -a, collide: false, bevel: 0 });
    }
    kit.post(M.deep, 0.9, 0.9, 0.7, 0, cy, cz, { rx: Math.PI / 2, radial: 16, collide: true });
    kit.post(M.strip, 0.5, 0.5, 0.76, 0, cy, cz, { rx: Math.PI / 2, radial: 12 });
    /* THE POINTER, over the top of the wheel and pointing down into it —
     * the only thing in the room that says which way is the answer. */
    kit.slab(M.status, 0.34, 0.9, 0.3, 0, cy + R + 0.6, cz, { collide: false, bevel: 0.05 });
    /* Lit FROM BEHIND, so the wheel is a black disc with a bright edge from
     * the door — the reading the silhouette raster actually takes. */
    kit.light(0, cy, cz - 1.2, { intensity: 22, distance: 26 });
    for (const s of [-1, 1]) {
      kit.post(M.dark, 0.22, 0.28, cy + R + 0.4, s * (R + 0.7), (cy + R + 0.4) / 2, cz + 0.4, { radial: 8, collide: true });
    }

    /* ── THE DEJARIK COLUMN, alone on the centreline where the hall narrows.
     * A drum of a plinth with a lit board floating over it: the one waist-
     * high circle in a room whose other circle is five metres up. */
    kit.post(M.deep, 0.85, 1.0, 0.95, 0, 0.475, -0.6, { radial: 16, collide: true });
    kit.post(M.screen, 1.15, 1.15, 0.1, 0, 1.06, -0.6, { radial: 20 });
    for (let i = 0; i < 12; i++) {
      const a = (TAU * i) / 12;
      kit.slab(M.strip, 0.18, 0.05, 0.18, 0.82 * Math.sin(a), 1.14, -0.6 + 0.82 * Math.cos(a), { collide: false, bevel: 0 });
    }

    /* ── THE TABLES. Two, not four: the room is 14 across and `lowden` next
     * door already owns "a floor of card tables". These flank the column. */
    for (const s of [-1, 1]) {
      const x = s * 4.3, z = -4.2;
      loose(kit, x, 0, z, (world, q) => tableBody(world, q, M, 2.2, 2.2, 0.78));
      kit.post(M.dark, 0.04, 0.04, h - 2.6, x, h - (h - 2.6) / 2, z, { radial: 4 });
      kit.post(M.strip, 0.5, 0.16, 0.28, x, 2.4, z, { radial: 10 });
      for (let k = 0; k < 3; k++) {
        loose(kit, x + Math.cos(k * 2.1) * 1.5, 0, z + Math.sin(k * 2.1) * 1.5, (world, q) => chairBody(world, q, M));
      }
    }

    /* ── THE CAGE BY THE DOOR. A cashier behind bars, the way `lowden` has
     * one — a casino that pays out over an open counter is a bank. */
    kit.push(-w / 2 + 2.0, 0, -d / 2 + 2.2, 0);
    kit.slab(M.dark, 3.4, h, 0.4, 0, h / 2, -1.4, { collide: true, bevel: 0 });
    counter(kit, M, 3.0, 0.65, 0, -0.9, 0, 1.05);
    for (let i = 0; i * 0.34 < 3.0; i++) {
      kit.post(M.wing, 0.035, 0.035, h - 1.1, -1.5 + i * 0.34, 1.1 + (h - 1.1) / 2, -0.95, { radial: 4 });
    }
    kit.pop();

    /* ── THE STANDING RAIL down the other wall, at drinking height. Nowhere
     * to sit on that side is what makes the room read as a night room. */
    kit.slab(M.wing, 0.5, 0.09, d - 6.5, w / 2 - 0.6, 1.05, -1.0, { collide: true, bevel: 0.02 });
    for (let i = 0; i < 4; i++) {
      kit.post(M.dark, 0.06, 0.06, 1.05, w / 2 - 0.6, 0.525, -4.0 + i * 2.0, { radial: 6 });
    }

    /* §11 — loose things. Stools at the rail and a crate of the house's own. */
    for (let i = 0; i < 4; i++) {
      loose(kit, w / 2 - 1.9, 0, -4.0 + i * 2.0, (world, q) => boxBody(world, q, M, 0.42, 0.76, 0.42, M.deep, 7, 'stool'));
    }
    loose(kit, -w / 2 + 2.0, 0, -d / 2 + 4.4, (world, q) => makeCrate(world, q));
  },

  /** #19 Holo-theatre: a FAN. The floor rakes down toward a stage, the seats
   * are in arcs that widen, the back wall is the widest thing in the room. */
  fanauditorium(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: 4 });
    ceiling(kit, M, w, d, h, { ribs: 6, strips: false });
    /* The rake: six arcs of seating stepping up toward the back. */
    for (let i = 0; i < 6; i++) {
      const rr = 5 + i * 2.4, y = i * 0.42;
      const from = -1.05, to = 1.05, n = 7 + i * 2;
      const wide = 2 * rr * Math.tan((to - from) / n / 2) * 1.06;
      for (let k = 0; k < n; k++) {
        const a = from + (to - from) * ((k + 0.5) / n);
        kit.slab(M.dark, wide, 0.42, 1.6, rr * Math.sin(a), y - 0.21 + 0.42, rr * Math.cos(a) - d / 2 + 3 + rr * 0 , { ry: a, collide: true, bevel: 0 });
      }
    }
    /* The stage, and the holo volume standing on it. */
    kit.slab(M.deep, w - 6, 0.6, 4, 0, 0.3, d / 2 - 2.6, { collide: true, bevel: 0 });
    kit.post(M.screen, 3.2, 2.4, 3.4, 0, 2.3, d / 2 - 2.6, { radial: 12 });
    kit.slab(M.strip, w - 7, 0.08, 0.12, 0, 0.62, d / 2 - 4.6, { collide: false, bevel: 0 });
  },

  /** #20 The Arena: a SUNKEN RING. A round pit with tiers all round it,
   * remotes on a gantry overhead and a rack of practice sabers at the door. */
  sunkenring(kit, M, p, ctx) {
    const { w, d, h } = p;
    const r = Math.min(w, d) / 2;
    floor(kit, M, w, d);
    arcWall(kit, M.hull, r, h, 0.5, TAU - 0.5, 20);
    /* The ring: a round well two metres down, with tiers stepping to it. */
    for (let i = 0; i < 3; i++) {
      const rr = r - 2.4 - i * 2.0, y = -0.7 * (i + 1);
      ringOf(kit, M, M.dark, rr, 0.7, 28, y, { rad: 0.9, collide: true });
    }
    for (let i = 0; i < 16; i++) {
      const a = TAU * (i / 16);
      kit.slab(M.deep, 2 * (r - 7) * Math.tan(Math.PI / 16) * 1.06, 0.4, r - 7, (r - 7) / 2 * Math.sin(a), -2.3, (r - 7) / 2 * Math.cos(a), { ry: a, collide: true, bevel: 0 });
    }
    ctx.sunk.push({ w: (r - 7) * 1.4, d: (r - 7) * 1.4, depth: 2.1 });
    /* The gantry the remotes hang from — a cross over the ring. */
    for (const ry of [0, Math.PI / 2]) {
      kit.slab(M.wing, r * 2 - 2, 0.3, 0.5, 0, h - 1.2, 0, { ry, collide: false, bevel: 0 });
    }
    for (let i = 0; i < 4; i++) {
      const a = TAU * (i / 4) + 0.4;
      kit.post(M.status, 0.28, 0.28, 0.28, (r - 5) * Math.sin(a), h - 2.4, (r - 5) * Math.cos(a), { radial: 8 });
    }
    /* The saber rack at the door. */
    rack(kit, M, 3.4, 2.2, 0, -r + 1.2, 0, 3);
  },

  /** #21 Gym: a RUNNING GALLERY. Long and shallow, open to the atrium down
   * its whole inner face, with a raised running track round the outside. */
  runninggallery(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { open: ['front'] });
    ceiling(kit, M, w, d, h, { ribs: 5 });
    /* The rail onto the void, and the track a metre above the floor. */
    kit.slab(M.wing, w, 0.1, 0.12, 0, 1.02, -d / 2, { collide: true, bevel: 0 });
    kit.slab(M.mark, w, 0.3, 2.2, 0, 0.85, d / 2 - 1.4, { collide: true, bevel: 0 });
    for (let i = 0; i < 5; i++) stair(kit, M, 1.2, 1.0, -w / 2 + 2 + i * ((w - 4) / 4), d / 2 - 2.8);
    /* Bars and weights: the bars are structure, the weights are throwable. */
    for (const x of [-w / 4, w / 4]) {
      for (const y of [1.1, 1.9]) kit.slab(M.wing, 3.4, 0.09, 0.09, x, y, 0.4, { collide: true, bevel: 0 });
      for (const s of [-1, 1]) kit.post(M.dark, 0.08, 0.08, 2.0, x + s * 1.7, 1.0, 0.4, { radial: 6 });
    }
    for (let i = 0; i < 8; i++) loose(kit, -w / 2 + 2 + i * ((w - 4) / 7), 0, -1.2, (world, q) => makeBarrel(world, q));
  },

  /** #22 Chapel: a DARK DRUM. One skylight to space, nothing else lit. The
   * tallest small room on the station, and the only one with no strips. */
  darkdrum(kit, M, p) {
    const { w, d, h } = p;
    const r = Math.min(w, d) / 2;
    for (let i = 0; i < 12; i++) {
      const a = TAU * (i / 12);
      kit.slab(M.dark, 2 * r * Math.tan(Math.PI / 12) * 1.06, 0.4, r, r / 2 * Math.sin(a), -0.2, r / 2 * Math.cos(a), { ry: a, collide: true, bevel: 0 });
    }
    arcWall(kit, M.hull, r, h, 0.34, TAU - 0.34, 20);
    /* The drum narrows to the skylight: four rings stepping in, then glass. */
    for (let i = 0; i < 5; i++) ringOf(kit, M, M.dark, r * (1 - i * 0.17), 0.5, 20, h + i * 0.8, { rad: 0.5 });
    kit.post(M.glass, r * 0.2, r * 0.2, 0.3, 0, h + 4.3, 0, { radial: 12 });
    /* The shrine, the candles and the mats. No strip lights anywhere: the
     * skylight and the candles are the whole rig, which is the room. */
    kit.slab(M.wing, 2.2, 1.2, 0.8, 0, 0.6, r - 1.8, { collide: true, bevel: 0 });
    kit.post(M.status, 0.4, 0.3, 0.9, 0, 1.65, r - 1.8, { radial: 8 });
    for (let i = 0; i < 10; i++) {
      const a = TAU * (i / 10);
      kit.post(M.status, 0.07, 0.07, 0.5, (r - 0.9) * Math.sin(a), 0.25, (r - 0.9) * Math.cos(a), { radial: 5 });
    }
    for (let i = 0; i < 6; i++) {
      const x = ((i % 3) - 1) * 1.8, z = (i < 3 ? -1.5 : 0.6);
      kit.slab(M.deep, 1.0, 0.08, 1.6, x, 0.04, z, { collide: false, bevel: 0 });
    }
  },

  /** #23 Arboretum: a CUT through two decks. No ceiling at all — the deck
   * above is open over it — real trees, a stream, and a bridge across at 44. */
  cutthrough(kit, M, p, ctx, world) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.mark);
    walls(kit, M, w, d, h, { doorW: 5 });
    /* No ceiling: the cut is what the place IS. What closes the top is the
     * deck 44 balcony that looks down into it. */
    kit.slab(M.dark, w + 0.8, 0.4, 3, 0, DRUM.pitch, -d / 2 + 1.5, { collide: true, bevel: 0 });
    kit.slab(M.dark, w + 0.8, 0.4, 3, 0, DRUM.pitch, d / 2 - 1.5, { collide: true, bevel: 0 });
    /* The stream: a channel of glass down the middle with a bank each side. */
    kit.slab(M.glass, 2.2, 0.2, d - 3, 0, 0.06, 0, { collide: false, bevel: 0 });
    for (const s of [-1, 1]) kit.slab(M.mark, 0.7, 0.35, d - 3, s * 1.45, 0.17, 0, { collide: true, bevel: 0 });
    /* The trees. `Trees.js` is the engine's own and this is the one place on
     * the station that gets it (§3.2 #23 names the file). */
    ctx.trees.push({ w: w - 4, d: d - 4, n: 9 });
    for (let i = 0; i < 5; i++) {
      loose(kit, ((i % 2) ? -1 : 1) * (w / 2 - 2.5), 0, -d / 2 + 3 + i * ((d - 6) / 4),
        (world2, q) => boxBody(world2, q, M, 2.2, 0.44, 0.6, M.wing, 26, 'bench'));
    }
  },

  /** #24 Security post: a BOOTH. The smallest room on the station, out on the
   * atrium bridge, glazed on three sides with a cell behind glass at the back. */
  booth(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    kit.slab(M.hull, w, h, 0.3, 0, h / 2, d / 2, { collide: true, bevel: 0 });
    for (const s of [-1, 1]) kit.slab(M.glass, 0.14, h - 0.7, d, s * w / 2, h / 2 - 0.2, 0, { collide: true, bevel: 0 });
    kit.slab(M.glass, w, h - 0.7, 0.14, 0, h / 2 - 0.2, -d / 2, { collide: true, bevel: 0 });
    ceiling(kit, M, w, d, h, { ribs: 1 });
    counter(kit, M, w - 1.6, 0.8, 0, d / 2 - 1.2, 0, 1.05);
    board(kit, M, 1.4, 0.9, -1.6, 1.6, d / 2 - 0.25);
    board(kit, M, 1.4, 0.9, 1.6, 1.6, d / 2 - 0.25);
    /* The cell: bars in a recess, which is the whole reason this is not a desk. */
    for (let i = 0; i * 0.28 < 2.4; i++) kit.post(M.wing, 0.045, 0.045, h - 0.4, -1.2 + i * 0.28, (h - 0.4) / 2, d / 2 - 0.05, { radial: 4 });
  },

  /** #25 Lost & found: a NOTICE WALL. Barely a room — a deep alcove whose
   * back is entirely paper and holo notes, with a droid's niche beside it. */
  noticewall(kit, M, p, ctx) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: w - 1 });
    ceiling(kit, M, w, d, h, { ribs: 2, strips: false });
    /**
     * The wall itself: forty small panels, half of them lit.
     *
     * ── AND THE LIT ONES ARE HANDED BACK, BECAUSE THEY CARRY WORDS ────────
     *
     * Measured, this room had SEVEN meshes and ZERO textures in it under a
     * verb that says "read the notices" — forty blank coloured rectangles.
     * `Notices.js` writes on them, and it can only do that if it is told where
     * they are: the positions are in the PLACE'S OWN FRAME along with the slab
     * size, exactly as `#28`'s `plaques` and `#56`'s column are handed back,
     * because reading them back off the merged mesh would be a second
     * statement of where a notice is in a form nothing could check (§2.3).
     *
     * ONLY THE LIT ONES. `(i + k) % 3` puts thirteen `M.screen` slabs on the
     * wall and twenty-seven `M.mark` ones, and that split is what the room
     * already looked like: a holo-note is lit and a piece of paper is not.
     * Writing on all forty would be forty canvases and forty draws for a wall
     * nobody can read all of anyway — thirteen is what the room already said
     * was legible.
     */
    const at = [];
    for (let i = 0; i < 8; i++) {
      for (let k = 0; k < 5; k++) {
        const x = -w / 2 + 0.8 + i * ((w - 1.6) / 7);
        const y = 0.8 + k * 0.5;
        const lit = (i + k) % 3 === 0;
        kit.slab(lit ? M.screen : M.mark, 0.5, 0.36, 0.05, x, y, d / 2 - 0.25, { collide: false, bevel: 0 });
        if (lit) at.push({ x, y, z: d / 2 - 0.25 });
      }
    }
    ctx.notices = { id: p.id, deck: p.deck, x: p.x, z: p.z, y: floorOf(p), yaw: p.yaw, w: 0.5, h: 0.36, t: 0.05, at };
    kit.slab(M.strip, w - 1.4, 0.08, 0.14, 0, 3.5, d / 2 - 0.5, { collide: false, bevel: 0 });
    counter(kit, M, 1.4, 0.7, w / 2 - 1.1, -d / 2 + 1.0, 0, 1.0);
  },

  /** #56 The Standing: an OBELISK. A tall narrow hall with one object in it,
   * three decks high, running up through a cut in the soffit — so you see the
   * top of it from the Living deck's balcony and the whole of it from the
   * Concourse floor. Four cut faces, and it turns. */
  obelisk(kit, M, p, ctx) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    /* Three walls and a doorway; NO ceiling — the cut is what makes the
     * obelisk visible from two other decks, and §3.1 rule 5 wants the window
     * onto another place to be real rather than described. */
    walls(kit, M, w, d, 7.4, { doorW: w - 3.4, mat: M.hull });
    for (const s of [-1, 1]) {
      kit.slab(M.dark, w + 0.8, 0.5, 1.6, 0, 7.6, s * (d / 2 - 0.8), { collide: true, bevel: 0 });
    }
    /* The shaft the obelisk stands in, up through decks 44 and 48: four
     * corner piers so the cut reads as structure rather than as a hole
     * somebody forgot to close. */
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        kit.slab(M.hull, 0.9, h - 7.4, 0.9, sx * (w / 2 - 0.5), 7.4 + (h - 7.4) / 2, sz * (d / 2 - 0.5), { collide: true, bevel: 0 });
      }
    }
    /* A ring of light at each deck the cut passes, so the height is READ. */
    for (let i = 0; i < 2; i++) {
      const y = 12.5 * (i + 1);
      for (const sx of [-1, 1]) kit.slab(M.strip, 0.12, 0.12, d - 1.4, sx * (w / 2 - 0.9), y, 0, { collide: false, bevel: 0 });
    }
    /* THE OBELISK. A tapering four-sided column on a plinth, with a lit
     * face-plate on each side that `StationLife` writes the rolls onto. */
    kit.slab(M.dark, 4.2, 0.6, 4.2, 0, 0.3, 0, { collide: true, bevel: 0 });
    kit.slab(M.strip, 4.6, 0.08, 4.6, 0, 0.02, 0, { collide: false, bevel: 0 });
    ctx.obelisk = { x: p.x, z: p.z, y: floorOf(p), yaw: p.yaw, h: h - 3 };
  },

  /* ── DECK 44 ──────────────────────────────────────────────────────────── */

  /** #27 Your cabin: TWO ROOMS. A partition splits it; the outer half is the
   * desk, the map table and the trophy wall, the inner is the bunk and a real
   * window. The only place on the station with a door that is yours.
   *
   * ── AND THE FURNITURE IS NOT HERE ANY MORE ──────────────────────────────
   *
   * This builder used to drop four bodies of its own — a map table, a desk, a
   * chair and a locker. `Home.js` (V15 §1.3) makes the cabin's floor a
   * PLACEMENT GRID whose contents are saved, and a room that builds furniture
   * beside a save that remembers furniture is two answers to where your desk
   * is: the one the player moved would lose on the next visit. So this builds
   * the architecture and `Home.DEFAULT_LAYOUT` builds those four, at the same
   * coordinates, as pieces you may then pick up.
   *
   * What is handed back is therefore no longer a point but a ROOM: its
   * footprint, so the grid has bounds, and the rectangles a piece may not be
   * set down in, so the grid has walls. Deriving those from the slabs below by
   * reading them back out of the kit would be the hand-maintained twin
   * `HANDOFF` §2.3 warns about; declaring them here, next to the slab each one
   * describes, is one line per obstacle and it is checked (`home.mjs`). */
  twinroom(kit, M, p, ctx) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    walls(kit, M, w, d, h, { open: ['back'], glaze: true, doorW: 2.2 });
    ceiling(kit, M, w, d, h, { ribs: 3 });
    /* The partition, with a way through at one end. */
    kit.slab(M.hull, w - 3.2, h, 0.3, -1.6, h / 2, 0.6, { collide: true, bevel: 0 });
    /* The trophy wall and the saber stand — `Home.js` fills both from the
     * ledger and the kennel, so what is built here is the furniture. */
    rack(kit, M, 4.2, 2.4, -w / 2 + 2.4, -d / 2 + 0.4, Math.PI, 4);
    kit.post(M.wing, 0.3, 0.22, 1.3, w / 2 - 1.4, 0.65, -d / 2 + 1.0, { radial: 8, collide: true });
    /* The bunk, which is built rather than placeable: it is the half of the
     * room §3.2 names, and rule 4 reads this room from its door. */
    kit.slab(M.deep, 2.1, 0.5, 1.0, w / 2 - 2.4, 0.42, d / 2 - 1.2, { collide: true, bevel: 0 });
    kit.slab(M.wing, 2.0, 0.18, 0.9, w / 2 - 2.4, 0.75, d / 2 - 1.2, { collide: false, bevel: 0 });
    ctx.home = {
      id: p.id, deck: p.deck, x: p.x, z: p.z, yaw: p.yaw, y: floorOf(p), w, d, h,
      /* Where a placed piece may not stand, in the room's own frame. */
      blockers: [
        { x: -1.6, z: 0.6, w: w - 3.2, d: 0.3 },                      // the partition
        { x: -w / 2 + 2.4, z: -d / 2 + 0.4, w: 4.2, d: 0.7 },         // the trophy rack
        { x: w / 2 - 1.4, z: -d / 2 + 1.0, w: 0.6, d: 0.6 },          // the saber stand
        { x: w / 2 - 2.4, z: d / 2 - 1.2, w: 2.1, d: 1.0 },           // the bunk
      ],
    };
  },

  /** #28 The Kennel habitat: a MEZZANINE room. High, with a half floor at
   * four metres reached by a ramp, straw below, perches above, a pool at one
   * end and a run out to the arboretum. */
  mezzanine(kit, M, p, ctx) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.mark);
    walls(kit, M, w, d, h, { doorW: 3.4 });
    ceiling(kit, M, w, d, h, { ribs: 5, strips: false });
    mezzanine(kit, M, w - 2, d, 4.2, { depth: d / 2.4 });
    /* The perches: four bars at different heights under the soffit. */
    for (let i = 0; i < 4; i++) {
      kit.slab(M.wing, w - 3, 0.12, 0.12, 0, 5.6 + i * 0.9, -d / 2 + 2 + i * 1.6, { collide: true, bevel: 0 });
    }
    /* The pool, sunk at the far end. */
    kit.slab(M.glass, 4.4, 0.2, 3.4, w / 2 - 3.4, 0.08, d / 2 - 2.6, { collide: false, bevel: 0 });
    for (const s of [-1, 1]) kit.slab(M.dark, 0.4, 0.5, 3.8, w / 2 - 3.4 + s * 2.4, 0.25, d / 2 - 2.6, { collide: true, bevel: 0 });
    /**
     * THE PLAQUES — `Habitat.js` writes the names on them from the Kennel, and
     * it needs to know WHERE they are and what to parent a panel to.
     *
     * The slabs are merged into the room's per-material mesh and come out the
     * other side with no handle, so the six positions are published in the
     * PLACE'S OWN FRAME along with the room's size. `#56`'s obelisk already
     * hands back a `group` for the same reason; this is that, plus the six
     * points, because a plaque is a surface to draw on rather than an object
     * to move. Reading them back off the merged mesh would be a second
     * statement of where a plaque is, in a form nothing could check.
     */
    const plaques = [];
    for (let i = 0; i < 6; i++) {
      const px = -w / 2 + 1.4 + i * 1.1, py = 2.4, pz = -d / 2 + 0.3;
      kit.slab(M.mark, 0.7, 0.4, 0.06, px, py, pz, { collide: false, bevel: 0 });
      plaques.push({ x: px, y: py, z: pz, w: 0.7, h: 0.4 });
    }
    ctx.habitat = { deck: p.deck, x: p.x, z: p.z, yaw: p.yaw, w, d, h, plaques };
    for (let i = 0; i < 4; i++) loose(kit, -w / 2 + 2 + i * 2, 0, 1.5, (world, q) => makeCrate(world, q, 0.6));
  },

  /** #29 Company barracks: a BUNK HALL. Long, split into bays by lockers
   * standing out from the walls, bunks in each bay, a stove and a slate. */
  bunkhall(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: 3 });
    ceiling(kit, M, w, d, h, { ribs: 9 });
    const bays = 5;
    for (let i = 0; i < bays; i++) {
      const x = -w / 2 + (w / bays) * (i + 0.5);
      for (const s of [-1, 1]) {
        /* The locker divider that MAKES the bay. */
        if (i) kit.slab(M.dark, 0.5, 2.1, 2.0, x - w / (bays * 2), 1.05, s * (d / 2 - 1.2), { collide: true, bevel: 0 });
        /* Two bunks, one over the other. */
        for (const y of [0.5, 1.6]) {
          kit.slab(M.wing, 1.9, 0.12, 0.9, x, y, s * (d / 2 - 0.8), { collide: true, bevel: 0 });
          kit.slab(M.deep, 1.8, 0.16, 0.8, x, y + 0.14, s * (d / 2 - 0.8), { collide: false, bevel: 0 });
        }
        kit.post(M.dark, 0.06, 0.06, 2.1, x - 0.9, 1.05, s * (d / 2 - 0.4), { radial: 4 });
        kit.post(M.dark, 0.06, 0.06, 2.1, x + 0.9, 1.05, s * (d / 2 - 0.4), { radial: 4 });
      }
    }
    /* The slate — the Muster board (#29's verb) — and the stove. */
    board(kit, M, 3.4, 2.0, -w / 2 + 2.4, 1.8, -d / 2 + 0.25);
    kit.post(M.dark, 0.6, 0.5, 1.2, w / 2 - 2.5, 0.6, 0, { radial: 10, collide: true });
    kit.post(M.status, 0.35, 0.35, 0.2, w / 2 - 2.5, 1.3, 0, { radial: 10 });
    kit.post(M.dark, 0.16, 0.16, h - 1.4, w / 2 - 2.5, 1.4 + (h - 1.4) / 2, 0, { radial: 6 });
    for (let i = 0; i < 4; i++) loose(kit, (i - 1.5) * 3.4, 0, 0, (world, q) => boxBody(world, q, M, 0.8, 0.5, 0.6, M.wing, 14, 'crate'));
  },

  /** #30 Officers' quarters: a CORRIDOR OF DOORS, curved, with one open.
   * Not a room at all — a passage, which is what makes it different. */
  doorcorridor(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    for (const s of [-1, 1]) kit.slab(M.hull, w, h, 0.4, 0, h / 2, s * d / 2, { collide: true, bevel: 0 });
    ceiling(kit, M, w, d, h, { ribs: 8, strips: false });
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      /* Wood and brass: a panelled door, a brass number, a lamp over it. */
      kit.slab(M.deep, 1.2, 2.3, 0.16, x, 1.15, d / 2 - 0.22, { collide: i !== 2, bevel: 0 });
      kit.slab(M.wing, 0.22, 0.22, 0.05, x + 0.4, 2.0, d / 2 - 0.32, { collide: false, bevel: 0 });
      kit.slab(M.strip, 0.5, 0.07, 0.12, x, 2.55, d / 2 - 0.35, { collide: false, bevel: 0 });
      /* The one open door, with a lit room behind it. */
      if (i === 2) {
        kit.slab(M.deep, 1.2, 2.3, 0.16, x - 0.9, 1.15, d / 2 - 0.9, { ry: 1.1, collide: true, bevel: 0 });
        kit.slab(M.screen, 1.1, 2.1, 0.04, x, 1.1, d / 2 - 0.14, { collide: false, bevel: 0 });
      }
    }
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w / n) * (i + 0.5);
      kit.slab(M.deep, 1.1, 2.3, 0.14, x, 1.15, -d / 2 + 0.22, { collide: true, bevel: 0 });
    }
  },

  /** #31 Human residential: a LIGHT WELL. Two levels of cabin doors round a
   * square well open to the soffit, with a stair in one corner and laundry
   * lines strung across it. The only place with a floor you look down into. */
  lightwell(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: 3.2 });
    ceiling(kit, M, w, d, h, { ribs: 4 });
    /* The upper gallery: a walk round all four sides at 4.4 m. */
    const gy = 4.4, gw = 2.6;
    for (const s of [-1, 1]) {
      kit.slab(M.dark, w, 0.3, gw, 0, gy, s * (d / 2 - gw / 2), { collide: true, bevel: 0 });
      kit.slab(M.dark, gw, 0.3, d - gw * 2, s * (w / 2 - gw / 2), gy, 0, { collide: true, bevel: 0 });
      kit.slab(M.wing, w, 0.09, 0.1, 0, gy + 1.05, s * (d / 2 - gw), { collide: true, bevel: 0 });
    }
    stair(kit, M, 2.0, gy, -w / 2 + 1.6, d / 2 - gw - 0.4);
    /* Cabin doors, both levels, all four sides. */
    for (let i = 0; i < 5; i++) {
      const x = -w / 2 + (w / 5) * (i + 0.5);
      for (const s of [-1, 1]) {
        kit.slab(M.wing, 1.1, 2.1, 0.14, x, 1.05, s * (d / 2 - 0.3), { collide: true, bevel: 0 });
        kit.slab(M.wing, 1.1, 2.1, 0.14, x, gy + 1.35, s * (d / 2 - 0.3), { collide: true, bevel: 0 });
      }
    }
    /* The laundry lines across the well — what makes it a place people live. */
    for (let i = 0; i < 4; i++) {
      kit.slab(M.mark, w - 4, 0.04, 0.04, 0, 6.8 + i * 0.5, -d / 2 + 4 + i * 2, { collide: false, bevel: 0 });
      for (let k = 0; k < 5; k++) kit.slab(M.mark, 0.5, 0.7, 0.02, -w / 2 + 3 + k * 2.6, 6.5 + i * 0.5, -d / 2 + 4 + i * 2, { collide: false, bevel: 0 });
    }
  },

  /** #32 Narn quarter: STONE AND LOW. The lowest ceiling of the five quarters,
   * red stone piers you walk between, braziers, a shrine in a niche. */
  stonelow(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.deep);
    walls(kit, M, w, d, h, { doorW: 2.6, mat: M.deep });
    ceiling(kit, M, w, d, h, { ribs: 12, strips: false, mat: M.deep });
    /* Piers: a grid of heavy stone posts. The room is what is between them. */
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 4; k++) {
        const x = -w / 2 + (w / 4) * (i + 0.5), z = -d / 2 + (d / 4) * (k + 0.5);
        if ((i === 1 || i === 2) && (k === 1 || k === 2)) continue;
        kit.slab(M.deep, 1.1, h, 1.1, x, h / 2, z, { collide: true, bevel: 0 });
      }
    }
    /* Braziers — the room's only light, and low. */
    for (const [x, z] of [[-w / 4, 0], [w / 4, 0], [0, -d / 3], [0, d / 3]]) {
      kit.post(M.dark, 0.5, 0.4, 0.8, x, 0.4, z, { radial: 8, collide: true });
      kit.post(M.status, 0.42, 0.2, 0.35, x, 0.95, z, { radial: 8 });
    }
    /* The shrine, in a niche in the back wall. */
    kit.slab(M.dark, 3.0, 2.4, 0.5, 0, 1.2, d / 2 - 0.5, { collide: true, bevel: 0 });
    kit.slab(M.mark, 1.4, 1.8, 0.1, 0, 1.2, d / 2 - 0.8, { collide: false, bevel: 0 });
    for (let i = 0; i < 5; i++) loose(kit, -w / 2 + 3 + i * 3.5, 0, -d / 2 + 3, (world, q) => makeBarrel(world, q));
  },

  /** #33 Centauri quarter: a GILT COURT. White and gold, a fountain in the
   * middle, portraits on every wall, a card room screened off at one end. */
  giltcourt(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.wing);
    walls(kit, M, w, d, h, { doorW: 3.6, mat: M.wing });
    ceiling(kit, M, w, d, h, { ribs: 5 });
    /* A colonnade round the court, gilt. */
    for (let i = 0; i < 12; i++) {
      const a = TAU * (i / 12);
      const rr = Math.min(w, d) / 2 - 2.2;
      kit.post(M.mark, 0.32, 0.28, h - 0.6, rr * Math.sin(a), (h - 0.6) / 2, rr * Math.cos(a), { radial: 8, collide: true });
    }
    /* The fountain: three basins stepping down, lit from inside. */
    for (let i = 0; i < 3; i++) {
      kit.post(M.wing, 2.4 - i * 0.7, 2.2 - i * 0.7, 0.45, 0, 0.22 + i * 0.5, 0, { radial: 14, collide: true });
      kit.post(M.glass, 2.1 - i * 0.7, 2.1 - i * 0.7, 0.1, 0, 0.46 + i * 0.5, 0, { radial: 14 });
    }
    kit.post(M.strip, 0.3, 0.1, 1.4, 0, 2.2, 0, { radial: 8 });
    /* The portraits. */
    for (let i = 0; i < 6; i++) {
      kit.slab(M.mark, 1.0, 1.6, 0.08, -w / 2 + 2 + i * ((w - 4) / 5), 2.6, d / 2 - 0.3, { collide: false, bevel: 0 });
    }
    /* The card room, screened. */
    kit.slab(M.mark, 6, h - 1.2, 0.16, 0, (h - 1.2) / 2, -d / 2 + 3.6, { collide: true, bevel: 0 });
    loose(kit, 0, 0, -d / 2 + 2.0, (world, q) => tableBody(world, q, M, 2.0, 2.0, 0.78));
    for (let i = 0; i < 4; i++) loose(kit, Math.cos(i * 1.57) * 1.5, 0, -d / 2 + 2.0 + Math.sin(i * 1.57) * 1.5, (world, q) => chairBody(world, q, M));
  },

  /** #34 Minbari quarter: TRIANGULAR. Everything in the room is a triangle —
   * the plan, the piers, the openings — and it is silent and blue. */
  triangular(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.glass);
    /* Three walls, not four: the plan is a triangle inside the footprint. */
    const r = Math.min(w, d) / 2;
    for (let i = 0; i < 3; i++) {
      const a = TAU * (i / 3) + Math.PI / 3;
      kit.slab(M.hull, r * 1.75, h, 0.4, r * 0.86 * Math.sin(a), h / 2, r * 0.86 * Math.cos(a), { ry: a, collide: i !== 0, bevel: 0 });
    }
    /* The soffit is a triangle too, and it steps up to a crystal at the apex. */
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 3; k++) {
        const a = TAU * (k / 3) + Math.PI / 3, s = 1 - i * 0.22;
        kit.slab(M.dark, r * 1.75 * s, 0.4, 0.6, r * 0.86 * s * Math.sin(a), h + i * 0.7, r * 0.86 * s * Math.cos(a), { ry: a, collide: false, bevel: 0 });
      }
    }
    kit.post(M.strip, 0.9, 0.05, 1.6, 0, h + 3.4, 0, { radial: 3 });
    /* Crystal piers: triangular posts at the three corners. */
    for (let i = 0; i < 3; i++) {
      const a = TAU * (i / 3);
      kit.post(M.glass, 0.7, 0.5, h - 0.4, r * 0.8 * Math.sin(a), (h - 0.4) / 2, r * 0.8 * Math.cos(a), { radial: 3, collide: true });
    }
    /* Low benches on the three sides, and nothing else at all. */
    for (let i = 0; i < 3; i++) {
      const a = TAU * (i / 3) + Math.PI / 3;
      loose(kit, r * 0.6 * Math.sin(a), 0, r * 0.6 * Math.cos(a), (world, q) => boxBody(world, q, M, 2.6, 0.4, 0.7, M.glass, 30, 'bench'));
    }
  },

  /** #35 Drazi quarter: a FIGHTING PIT. One deep round hole with a lip you
   * stand on, colours strung overhead, and noise. Nothing else in the room. */
  fightingpit(kit, M, p, ctx) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: 4 });
    ceiling(kit, M, w, d, h, { ribs: 4, strips: false });
    const r = Math.min(w, d) / 2 - 3;
    /* The pit: a round well 2.6 m down with a ramp in on one side. */
    for (let i = 0; i < 14; i++) {
      const a = TAU * (i / 14);
      kit.slab(M.deep, 2 * r * Math.tan(Math.PI / 14) * 1.06, 2.6, 0.5, r * Math.sin(a), -1.3, r * Math.cos(a), { ry: a, collide: true, bevel: 0 });
      kit.slab(M.deep, 2 * (r / 2) * Math.tan(Math.PI / 14) * 1.06, 0.4, r, (r / 2) * Math.sin(a), -2.8, (r / 2) * Math.cos(a), { ry: a, collide: true, bevel: 0 });
    }
    ctx.sunk.push({ w: r * 1.4, d: r * 1.4, depth: 2.6 });
    for (let i = 0; i < 9; i++) kit.slab(M.dark, 2.2, 0.3, 0.6, 0, -0.15 - i * 0.29, -r + 0.4 + i * 0.55, { collide: true, bevel: 0 });
    /* The colours: green and purple, strung across, which is the whole story
     * of the Drazi and the only decoration the room has. */
    for (let i = 0; i < 8; i++) {
      kit.slab(i % 2 ? M.strip : M.status, w - 3, 0.05, 0.05, 0, h - 0.6 - (i % 3) * 0.3, -d / 2 + 2 + i * ((d - 4) / 7), { collide: false, bevel: 0 });
    }
  },

  /** #36 The methane quarter: WALKWAYS OVER POOLS. Behind an airlock, yellow,
   * and the floor is not a floor — it is a grid of catwalks over standing
   * liquid. The one room you need a suit in. */
  walkwaypools(kit, M, p) {
    const { w, d, h } = p;
    /* The pools ARE the floor: a plate 1.4 m down, glazed. */
    kit.slab(M.glass, w, 0.3, d, 0, -1.25, 0, { collide: true, bevel: 0 });
    walls(kit, M, w, d, h, { doorW: 2.4 });
    ceiling(kit, M, w, d, h, { ribs: 6 });
    /* The airlock at the door: two heavy frames and a light between them. */
    for (const z of [-d / 2 - 0.1, -d / 2 + 1.6]) {
      kit.slab(M.wing, 1.4, 2.6, 0.4, -1.9, 1.3, z, { collide: true, bevel: 0 });
      kit.slab(M.wing, 1.4, 2.6, 0.4, 1.9, 1.3, z, { collide: true, bevel: 0 });
      kit.slab(M.wing, 5.2, 0.5, 0.4, 0, 2.85, z, { collide: true, bevel: 0 });
    }
    kit.slab(M.status, 0.4, 0.4, 0.2, 0, 2.6, -d / 2 + 0.75, { collide: false, bevel: 0 });
    /* The catwalks: a cross and a ring, everything else is pool. */
    catwalk(kit, M, w - 2, 2.2, 0, 0, 0, 0);
    catwalk(kit, M, d - 2, 2.2, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const a = TAU * (i / 8);
      const rr = Math.min(w, d) / 2 - 2.6;
      catwalk(kit, M, 2 * rr * Math.tan(Math.PI / 8) * 1.06, 1.8, 0, rr * Math.sin(a), rr * Math.cos(a), a + Math.PI / 2);
    }
    /* Suit checks: a rack of suits at the lock. */
    rack(kit, M, 3.4, 2.4, w / 2 - 2.2, -d / 2 + 1.4, 0, 2);
  },

  /** #37 The Vorlon's door: a DEAD END. A corridor that narrows and stops.
   * One light, one door, nothing else — the smallest place and the only one
   * you cannot go into. */
  deadend(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    /* The walls close in as you go: five bays, each narrower than the last. */
    for (let i = 0; i < 5; i++) {
      const z = -d / 2 + (d / 5) * (i + 0.5);
      const ww = w - i * 0.5;
      for (const s of [-1, 1]) kit.slab(M.hull, 0.4, h, d / 5, s * (ww / 2), h / 2, z, { collide: true, bevel: 0 });
      kit.slab(M.dark, ww, 0.4, d / 5, 0, h + 0.2, z, { collide: true, bevel: 0 });
    }
    /* The door: organic, and the one light in the corridor is on it. */
    kit.post(M.deep, 1.5, 1.1, 2.8, 0, 1.4, d / 2 - 0.6, { radial: 10, collide: true });
    kit.post(M.strip, 0.24, 0.24, 0.24, 0, 2.0, d / 2 - 1.15, { radial: 8 });
  },

  /** #38 Transient hostel: a CAPSULE WALL. Both long walls are a honeycomb
   * of bunk capsules three high; a desk at the door; a passage between. */
  capsulewall(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: 2.4 });
    ceiling(kit, M, w, d, h, { ribs: 6 });
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        for (let k = 0; k < 3; k++) {
          const x = -w / 2 + (w / 5) * (i + 0.5), y = 0.3 + k * 1.25;
          kit.slab(M.wing, w / 5 - 0.2, 1.1, 2.2, x, y + 0.55, s * (d / 2 - 1.2), { collide: true, bevel: 0 });
          kit.slab(M.dark, w / 5 - 0.6, 0.9, 0.2, x, y + 0.55, s * (d / 2 - 2.3), { collide: false, bevel: 0 });
          if ((i + k) % 2) kit.slab(M.strip, w / 5 - 0.9, 0.06, 0.08, x, y + 1.0, s * (d / 2 - 2.35), { collide: false, bevel: 0 });
        }
      }
    }
    counter(kit, M, 2.4, 0.8, w / 2 - 1.6, -d / 2 + 1.0, 0, 1.05);
  },

  /** #39 Laundry & showers: STEAM ROWS. Two rows of machines facing each
   * other with a wet aisle between, shower stalls at the end, steam. */
  steamrows(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.wing);
    walls(kit, M, w, d, h, { doorW: 2.4 });
    ceiling(kit, M, w, d, h, { ribs: 5, strips: false });
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const x = -w / 2 + (w / 6) * (i + 0.5);
        kit.slab(M.wing, w / 6 - 0.25, 1.5, 1.1, x, 0.75, s * (d / 2 - 0.9), { collide: true, bevel: 0 });
        kit.post(M.glass, 0.42, 0.42, 0.12, x, 0.95, s * (d / 2 - 1.5), { rx: Math.PI / 2, radial: 10 });
      }
      kit.slab(M.dark, w, 0.4, 1.4, 0, 1.7, s * (d / 2 - 0.9), { collide: false, bevel: 0 });
    }
    /* The showers, stalled off at one end. */
    for (let i = 0; i < 3; i++) {
      const x = w / 2 - 1.2 - i * 1.5;
      kit.slab(M.glass, 0.1, 2.2, 1.4, x, 1.1, 0, { collide: true, bevel: 0 });
      kit.post(M.wing, 0.12, 0.12, 0.3, x - 0.7, 2.1, 0, { radial: 6 });
    }
  },

  /**
   * #61 The Underlift Pit: A CHAIN OVER A SLOT (V16 §G5).
   *
   * The illegal one, and every line of it is the opposite of `sunkenring`'s
   * — which matters, because rule 4 measures the two of them and a second
   * round pit with tiers round it would be the Arena with the lights off.
   *
   *   the Arena is ROUND;         this is a rectangular SLOT, long axis across
   *   the Arena has TIERS;        this has nowhere to sit at all — you stand
   *   the Arena has a GANTRY;     this has a chain-link LID at head height
   *   the Arena is LIT from above;this has one lamp on a cable over the middle
   *
   * The lid is the silhouette: a dense low lattice filling the top half of the
   * frame from the door, which nothing else on the station has. It is also the
   * room's whole argument — the thing in the slot cannot get out of it, and
   * neither can the thing it is fighting.
   *
   * NOTHING IN HERE IS A BENCH AND NOTHING IN HERE IS A RAIL. The crowd stands
   * on the grating at the lip with a two-and-a-half metre drop in front of it
   * and nothing between, which is the room saying what kind of room it is
   * without a word of signage.
   */
  chainpit(kit, M, p, ctx) {
    const { w, d, h } = p;
    /* The grating you stand on, and it is `dark` rather than the deck's own
     * plate: this is the floor with its covering taken up. */
    floor(kit, M, w, d, 0, M.dark);
    walls(kit, M, w, d, h, { doorW: 3.0 });
    ceiling(kit, M, w, d, h, { ribs: 3, strips: false });

    /* THE CUT. Rectangular, across the room, 2.5 m down, with the lifted deck
     * plate leaning against the far wall where it was dragged. */
    const cw = w - 4.4, cd = d - 5.0, depth = 2.5;
    sink(kit, M, cw, cd, depth, ctx);
    kit.slab(M.wing, cw * 0.8, 0.24, depth + 0.9, 0, (depth + 0.9) / 2 - 0.4, d / 2 - 0.9,
      { rx: 0.28, collide: true, bevel: 0 });

    /* THE CHAIN. Two crossed sets of thin bars at 2.2 m over the cut, on a
     * frame bent out of conduit — stretched over, not built in. */
    const lid = 2.2;
    for (let i = 0; i <= 9; i++) {
      const x = -cw / 2 + (cw * i) / 9;
      kit.slab(M.wing, 0.05, 0.05, cd + 0.6, x, lid, 0, { collide: false, bevel: 0 });
    }
    for (let i = 0; i <= 7; i++) {
      const z = -cd / 2 + (cd * i) / 7;
      kit.slab(M.wing, cw + 0.6, 0.05, 0.05, 0, lid - 0.06, z, { collide: false, bevel: 0 });
    }
    for (const s of [-1, 1]) {
      for (const t of [-1, 1]) {
        kit.post(M.hull, 0.11, 0.11, lid, s * (cw / 2 + 0.3), lid / 2, t * (cd / 2 + 0.3), { radial: 6, collide: true });
      }
      /* The frame is BENT — one side higher than the other, because nobody
       * squared it up. */
      kit.slab(M.hull, 0.12, 0.12, cd + 0.6, s * (cw / 2 + 0.3), lid + (s > 0 ? 0.22 : 0), 0, { rx: s * 0.05, collide: false, bevel: 0 });
    }

    /* THE ONE LIGHT: a lamp on a cable, hung low over the middle of the cut,
     * so the slot is bright and the people at the lip are not. */
    kit.slab(M.dark, 0.05, h - lid - 0.5, 0.05, 0, lid + (h - lid) / 2 + 0.2, 0, { collide: false, bevel: 0 });
    kit.post(M.dark, 0.42, 0.42, 0.26, 0, lid + 0.5, 0, { radial: 8 });
    kit.post(M.strip, 0.3, 0.3, 0.1, 0, lid + 0.36, 0, { radial: 8 });

    /* The book, and the cable spool it is written on. Two loose things and a
     * spool you can pick up — §11, the same as every other room. */
    kit.post(M.deep, 1.05, 1.05, 0.9, -w / 2 + 1.6, 0.45, -d / 2 + 1.9, { radial: 12, collide: true });
    kit.post(M.dark, 0.34, 0.34, 0.95, -w / 2 + 1.6, 0.48, -d / 2 + 1.9, { radial: 8 });
    for (let i = 0; i < 4; i++) {
      loose(kit, w / 2 - 1.5, 0, -d / 2 + 1.6 + i * 1.1, (world, q) => makeCrate(world, q));
    }
    /* And a coil of cable slung on the wall by the door, which is the only
     * thing in the room anybody has bothered to hang up. */
    for (let i = 0; i < 3; i++) {
      kit.post(M.mark, 0.5 - i * 0.06, 0.5 - i * 0.06, 0.1, w / 2 - 0.6, 1.9 - i * 0.34, -d / 2 + 1.0,
        { rz: Math.PI / 2, radial: 10 });
    }
  },

  /**
   * #58 The Underlift: a CONTAINER ROW. Two stacks of cargo containers down
   * one side and one down the other, an aisle between them, and exactly one
   * container open — a plank across its mouth for a counter, and a hand lamp
   * clamped to the door frame.
   *
   * ── WHY IT IS THIS AND NOT A SHOP ─────────────────────────────────────
   *
   * *"the black market smuggler types only deal with sith."* The counter has
   * existed since Lane B — seven of them, and this is the seventh — with a
   * `refuse` list, a shelf that is dark two days in three, and stock nobody
   * else carries. What it did not have is a ROOM: `Vendors.UNDERLIFT` names
   * place 58 and place 58 was not in the gazetteer, so the one shop in the
   * game that is gated on your order could not be walked to.
   *
   * Everything about the room is the argument that it is not a shop. There is
   * no shopfront, no sign, no ceiling of its own — the deck's underside IS the
   * ceiling — and the light is one lamp on the open box rather than a lit
   * room. The other containers are shut, which is the point: what is in them
   * is not the player's business and the room does not pretend otherwise.
   *
   * ── AND IT IS THE SAME SERVICE GAP AS THE PIT ─────────────────────────
   *
   * `#61 The Underlift Pit` sits at 6 degrees on this band and this is at 26.
   * They share the underlift and they share the hour: the shelf is seeded off
   * the day and the pit is not on every night, so a walk down there is a walk
   * to two things that may both be shut.
   */
  containerrow(kit, M, p) {
    const { w, d, h } = p;
    /* THE DECK'S UNDERSIDE IS THE CEILING. No `ceiling()` call: a service gap
     * has beams and conduit over it and nothing else, and a finished soffit
     * here would make it a room somebody built on purpose. */
    floor(kit, M, w, d, 0, M.dark);
    walls(kit, M, w, d, h, { doorW: 2.6 });
    for (let i = 0; i < 5; i++) {
      const z = -d / 2 + (d / 5) * (i + 0.5);
      kit.slab(M.hull, w - 1.0, 0.34, 0.30, 0, h - 0.3, z, { collide: false, bevel: 0 });
    }
    for (const s of [-1, 1]) {
      kit.post(M.deep, 0.16, 0.16, h - 0.6, s * (w / 2 - 1.2), (h - 0.6) / 2, -d / 2 + 0.9, { radial: 8 });
    }

    /* THE STACKS. A container is 6.0 x 2.44 x 2.6, which is the real box and
     * is why they read as containers rather than as crates: the proportion is
     * the whole silhouette. Two high on the long wall, one high opposite, and
     * the ribs are drawn on rather than modelled — REFERENCE.md rule 6. */
    const CW = 6.0, CH = 2.6, CD = 2.44;
    const box = (x, y, z, mat, ribs = true) => {
      kit.slab(mat, CW, CH, CD, x, y + CH / 2, z, { collide: true, bevel: 0.04 });
      if (!ribs) return;
      for (let r = 0; r < 7; r++) {
        kit.slab(M.dark, 0.06, CH - 0.3, 0.03, x - CW / 2 + 0.6 + r * 0.8, y + CH / 2, z + CD / 2 + 0.02,
          { collide: false, bevel: 0 });
      }
    };
    const zBack = -d / 2 + 1.8, zFront = d / 2 - 1.8;
    box(-w / 2 + 4.0, 0, zBack, M.hull);
    box(-w / 2 + 4.0, CH, zBack, M.deep);
    box(w / 2 - 4.4, 0, zBack, M.deep);
    box(0, 0, zFront, M.hull);

    /* THE ONE THAT IS OPEN, and it faces the door. Its far wall is set back so
     * the mouth reads as depth rather than as a painted rectangle, and the
     * plank across it is the counter — `counter()` would give a shopfitted
     * desk, which is exactly the thing this room is not. */
    const ox = w / 2 - 4.4, oy = CH, oz = zBack;
    kit.slab(M.dark, CW, CH, CD - 0.5, ox, oy + CH / 2, oz - 0.25, { collide: true, bevel: 0 });
    for (const t of [-1, 1]) {
      kit.slab(M.deep, 0.22, CH, CD, ox + t * (CW / 2 - 0.11), oy + CH / 2, oz, { collide: true, bevel: 0.03 });
    }
    kit.slab(M.deep, CW, 0.22, CD, ox, oy + CH - 0.11, oz, { collide: true, bevel: 0.03 });
    kit.slab(M.wing, CW - 0.5, 0.12, 0.7, ox, oy + 1.02, oz + CD / 2 - 0.1, { collide: true, bevel: 0.02 });
    /* THE LAMP, clamped to the frame and pointed in, so the box is bright and
     * the aisle is not — the same lighting argument the pit's one hung lamp
     * makes one room across. */
    kit.post(M.dark, 0.2, 0.2, 0.16, ox - CW / 2 + 0.4, oy + CH - 0.3, oz + CD / 2, { radial: 8, rx: 0.5 });
    kit.post(M.strip, 0.15, 0.15, 0.06, ox - CW / 2 + 0.42, oy + CH - 0.38, oz + CD / 2 - 0.06, { radial: 8, rx: 0.5 });

    /* THE STEPS UP TO IT — a welded stair, because the open box is at the top
     * of a stack and a counter you cannot reach is a counter nobody uses. */
    for (let i = 0; i < 5; i++) {
      kit.slab(M.wing, 1.1, 0.1, 0.42, ox - CW / 2 - 0.7, 0.52 * (i + 1), oz + CD / 2 - 0.3 - i * 0.42,
        { collide: true, bevel: 0 });
    }

    /* §11 — loose things. Four crates nobody has stacked, in the aisle. */
    for (let i = 0; i < 4; i++) {
      loose(kit, -w / 2 + 2.2 + i * 1.2, 0, 0.4, (world, q) => makeCrate(world, q));
    }
  },

  /* ── THE FOUR TRAM PLATFORMS: #40 and its three, and rule 4 says they are
   * four DIFFERENT rooms, not one built four times. Each is named for its
   * material because that is what §3.2 names them by. ─────────────────────── */

  /** #40 Arrivals — GLASS: a clear barrel vault over an island platform. */
  glassplatform(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.wing);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (i / 8);
      kit.slab(M.glass, 0.5, 0.4, d, (d / 2 + 1) * Math.cos(a) * 0 + Math.cos(a) * (w / 2 + 0.6), Math.sin(a) * (h - 0.6) + 0.3, 0, { rz: -a, collide: false, bevel: 0 });
    }
    for (let i = 0; i < 5; i++) kit.slab(M.wing, w + 1.2, 0.18, 0.18, 0, h - 0.2, -d / 2 + (d / 4) * i, { collide: false, bevel: 0 });
    kit.slab(M.strip, w * 0.7, 0.08, 0.12, 0, h - 0.5, 0, { collide: false, bevel: 0 });
    for (let i = 0; i < 3; i++) loose(kit, (i - 1) * 4, 0, 0, (world, q) => boxBody(world, q, M, 2.4, 0.44, 0.6, M.wing, 26, 'bench'));
  },

  /** #40.2 Concourse East — BRASS: a deep bay under a ribbed brass soffit,
   * with a bench island down the middle. */
  brassplatform(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.mark);
    for (const s of [-1, 1]) kit.slab(M.hull, 0.4, h, d, s * w / 2, h / 2, 0, { collide: true, bevel: 0 });
    for (let i = 0; i < 10; i++) {
      const z = -d / 2 + (d / 10) * (i + 0.5);
      kit.slab(M.mark, w, 0.4, 0.5, 0, h - 0.2, z, { collide: false, bevel: 0 });
      if (i % 2) kit.slab(M.strip, w * 0.5, 0.07, 0.14, 0, h - 0.5, z, { collide: false, bevel: 0 });
    }
    kit.slab(M.mark, 1.6, 0.5, d - 3, 0, 0.25, 0, { collide: true, bevel: 0 });
    for (let i = 0; i < 4; i++) loose(kit, 0, 0.5, -d / 2 + 2.4 + i * ((d - 5) / 3), (world, q) => boxBody(world, q, M, 1.2, 0.4, 0.6, M.mark, 22, 'bench'));
  },

  /** #40.3 Quarters — TIMBER: low and warm, slatted screens, hanging lamps. */
  timberplatform(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.deep);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 14; i++) {
        kit.slab(M.deep, w, 0.14, 0.1, 0, 0.4 + i * 0.22, s * (d / 2 - 0.2), { collide: i === 0, bevel: 0 });
      }
    }
    kit.slab(M.deep, w, 0.4, d, 0, h + 0.2, 0, { collide: true, bevel: 0 });
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + (w / 4) * (i + 0.5);
      kit.post(M.dark, 0.03, 0.03, 1.2, x, h - 0.6, 0, { radial: 4 });
      kit.post(M.strip, 0.28, 0.2, 0.3, x, h - 1.3, 0, { radial: 8 });
    }
  },

  /** #40.4 Command — STEEL: bare, guarded, a checkpoint arch and one bench. */
  steelplatform(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    for (const s of [-1, 1]) kit.slab(M.wing, 0.5, h, d, s * w / 2, h / 2, 0, { collide: true, bevel: 0 });
    kit.slab(M.wing, w + 1, 0.6, d, 0, h + 0.3, 0, { collide: true, bevel: 0 });
    /* The checkpoint: an arch you walk through, with a scanner in it. */
    for (const s of [-1, 1]) kit.slab(M.dark, 0.8, 2.8, 1.0, s * 2.0, 1.4, -d / 2 + 1.4, { collide: true, bevel: 0 });
    kit.slab(M.dark, 4.8, 0.6, 1.0, 0, 3.1, -d / 2 + 1.4, { collide: true, bevel: 0 });
    kit.slab(M.status, 3.4, 0.1, 0.12, 0, 2.75, -d / 2 + 0.9, { collide: false, bevel: 0 });
    loose(kit, 0, 0, d / 2 - 2, (world, q) => boxBody(world, q, M, 2.2, 0.44, 0.6, M.wing, 26, 'bench'));
  },

  /* ── DECK 48 ──────────────────────────────────────────────────────────── */

  /** #42 Comms & sensor room: a SCREEN DRUM. Round, dark, screens for walls,
   * and one window with the dish turning behind it. */
  screendrum(kit, M, p) {
    const { w, d, h } = p;
    const r = Math.min(w, d) / 2;
    for (let i = 0; i < 12; i++) {
      const a = TAU * (i / 12);
      kit.slab(M.dark, 2 * r * Math.tan(Math.PI / 12) * 1.06, 0.4, r, r / 2 * Math.sin(a), -0.2, r / 2 * Math.cos(a), { ry: a, collide: true, bevel: 0 });
    }
    arcWall(kit, M.dark, r, h, 0.42, TAU - 0.42, 16);
    ringOf(kit, M, M.dark, r - 0.1, 0.5, 20, h, { rad: 0.4 });
    /* Screens: three courses right round, so the walls ARE the instrument. */
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 14; i++) {
        const a = TAU * (i / 14) + 0.2;
        if (Math.abs(a - Math.PI) < 0.5) continue;
        kit.slab(M.screen, 1.5, 0.7, 0.06, (r - 0.35) * Math.sin(a), 1.3 + k * 0.9, (r - 0.35) * Math.cos(a), { ry: a, collide: false, bevel: 0 });
      }
    }
    /* The window, and the dish turning outside it. */
    kit.slab(M.glass, 3.4, 2.2, 0.12, 0, 2.0, r - 0.2, { collide: true, bevel: 0 });
    kit.post(M.wing, 2.6, 0.6, 0.5, 0, 2.2, r + 2.6, { rx: -1.1, radial: 12 });
    for (let i = 0; i < 4; i++) counter(kit, M, 2.2, 0.9, (i - 1.5) * 2.6, -r + 2.4, Math.PI, 0.95);
  },

  /** #43 Medbay: a TRIAGE HALL. Six curtained bays down one side, the surgery
   * behind glass at the end, and a crash-cart lane clear down the middle. */
  triagehall(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.wing);
    walls(kit, M, w, d, h, { doorW: 4.4 });
    ceiling(kit, M, w, d, h, { ribs: 7 });
    for (let i = 0; i < 6; i++) {
      const x = -w / 2 + (w / 6) * (i + 0.5);
      /* The bay: a bed, a rail, a curtain, a monitor. */
      kit.slab(M.wing, 2.0, 0.7, 0.9, x, 0.35, d / 2 - 1.6, { collide: true, bevel: 0 });
      kit.slab(M.deep, 1.9, 0.16, 0.8, x, 0.78, d / 2 - 1.6, { collide: false, bevel: 0 });
      kit.slab(M.mark, 0.1, 2.2, 2.4, x - w / 12, 1.1, d / 2 - 1.4, { collide: false, bevel: 0 });
      kit.slab(M.screen, 0.7, 0.5, 0.05, x, 2.0, d / 2 - 0.25, { collide: false, bevel: 0 });
    }
    /* The surgery, glazed, at the far end. */
    kit.slab(M.glass, 6.0, h - 0.6, 0.14, w / 2 - 4, h / 2 - 0.3, -d / 2 + 3.4, { collide: true, bevel: 0 });
    kit.slab(M.strip, 3.2, 0.14, 0.5, w / 2 - 4, h - 0.5, -d / 2 + 1.8, { collide: false, bevel: 0 });
    loose(kit, w / 2 - 4, 0, -d / 2 + 1.8, (world, q) => tableBody(world, q, M, 2.2, 0.9, 0.9));
    for (let i = 0; i < 3; i++) loose(kit, (i - 1) * 4, 0, 0, (world, q) => boxBody(world, q, M, 0.7, 1.0, 0.5, M.wing, 16, 'cart'));
  },

  /** #44 Bacta ward: a TANK ROW. One line of lit cylinders with men in them
   * and a walk in front. Nothing else — the room is the row. */
  tankrow(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    walls(kit, M, w, d, h, { doorW: 2.6 });
    ceiling(kit, M, w, d, h, { ribs: 4, strips: false });
    for (let i = 0; i < 5; i++) {
      tank(kit, M, 0.85, h - 1.0, -w / 2 + (w / 5) * (i + 0.5), d / 2 - 1.6);
    }
    /* The plant behind them: pipes running the length at the soffit. */
    for (const dz of [-0.5, 0, 0.5]) kit.post(M.wing, 0.16, 0.16, w - 1, 0, h - 0.5, d / 2 - 0.6 + dz, { rx: 0, rz: Math.PI / 2, radial: 6 });
    counter(kit, M, 3.0, 0.8, -w / 2 + 2.0, -d / 2 + 1.0, 0, 1.0);
  },

  /** #45 Morgue & memorial: a NAME WALL. Cold drawers on one side, and the
   * whole other wall is the roll — read by `Graves`. */
  namewall(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    walls(kit, M, w, d, h, { doorW: 2.4 });
    ceiling(kit, M, w, d, h, { ribs: 4, strips: false });
    /* The drawers: a grid of handles, five wide and four high. */
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 4; k++) {
        kit.slab(M.wing, w / 6 - 0.14, 0.7, 0.5, -w / 2 + (w / 6) * (i + 0.5), 0.5 + k * 0.75, d / 2 - 0.4, { collide: true, bevel: 0 });
        kit.slab(M.dark, 0.4, 0.1, 0.1, -w / 2 + (w / 6) * (i + 0.5), 0.5 + k * 0.75, d / 2 - 0.68, { collide: false, bevel: 0 });
      }
    }
    /* The roll. One lit panel per rank of names, and a candle under it. */
    for (let i = 0; i < 7; i++) {
      kit.slab(M.mark, w / 7 - 0.2, 2.4, 0.05, -w / 2 + (w / 7) * (i + 0.5), 1.7, -d / 2 + 0.28, { collide: false, bevel: 0 });
    }
    kit.slab(M.strip, w - 1, 0.07, 0.16, 0, 3.1, -d / 2 + 0.42, { collide: false, bevel: 0 });
  },

  /** #46 Armoury: CAGES AND A RANGE. A cage wall of rifles, a saber vault
   * with its own door, a bench, and a firing range seen through armoured
   * glass — the range is a second volume, which is what makes the plan. */
  cagerange(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: 3 });
    ceiling(kit, M, w, d, h, { ribs: 8 });
    /* The cages. */
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + (w / 5) * (i + 0.5);
      rack(kit, M, w / 5 - 0.4, h - 1.0, x, d / 2 - 0.6, 0, 4);
      for (let k = 0; k * 0.3 < w / 5 - 0.4; k++) {
        kit.post(M.wing, 0.04, 0.04, h - 1.0, x - (w / 5 - 0.4) / 2 + k * 0.3, (h - 1.0) / 2, d / 2 - 1.0, { radial: 4 });
      }
    }
    /* The saber vault: a heavy round door in the end wall. */
    kit.post(M.wing, 1.3, 1.3, 0.4, -w / 2 + 1.2, 1.6, -d / 2 + 1.2, { rz: Math.PI / 2, radial: 14, collide: true });
    kit.post(M.strip, 0.3, 0.3, 0.1, -w / 2 + 1.0, 1.6, -d / 2 + 1.2, { rz: Math.PI / 2, radial: 10 });
    counter(kit, M, 4.0, 1.0, 0, -d / 2 + 1.4, 0, 1.05);
    /* The range: glass, then a lane with targets down it. */
    kit.slab(M.glass, 10, h - 0.8, 0.16, w / 2 - 7, h / 2 - 0.4, -d / 2 + 3.0, { collide: true, bevel: 0 });
    for (let i = 0; i < 3; i++) {
      kit.slab(M.mark, 0.7, 1.6, 0.08, w / 2 - 10 + i * 3, 0.9, -d / 2 + 1.2, { collide: true, bevel: 0 });
    }
  },

  /** #47 The Brig: a CELL RING. A ring of cells round a guard desk in the
   * middle, force-field doors that glow. You wake here (§11's consequence). */
  cellring(kit, M, p) {
    const { w, d, h } = p;
    const r = Math.min(w, d) / 2;
    floor(kit, M, w, d, 0, M.dark);
    arcWall(kit, M.hull, r, h, 0.45, TAU - 0.45, 18);
    ceiling(kit, M, w, d, h, { ribs: 5, strips: false });
    /* Six cells, each a wedge with a lit field across its mouth. */
    for (let i = 0; i < 6; i++) {
      const a = TAU * (i / 6) + 0.52;
      for (const s of [-1, 1]) {
        const b = a + s * 0.42;
        kit.slab(M.hull, 0.4, h, r - 4, (r - 2) / 1.4 * Math.sin(b), h / 2, (r - 2) / 1.4 * Math.cos(b), { ry: b, collide: true, bevel: 0 });
      }
      kit.slab(M.strip, 2.6, h - 0.6, 0.1, (r - 5.2) * Math.sin(a), h / 2 - 0.3, (r - 5.2) * Math.cos(a), { ry: a, collide: false, bevel: 0 });
      kit.slab(M.deep, 2.0, 0.4, 0.8, (r - 2.4) * Math.sin(a), 0.4, (r - 2.4) * Math.cos(a), { ry: a, collide: true, bevel: 0 });
    }
    /* The guard desk in the middle. */
    for (let i = 0; i < 6; i++) {
      const a = TAU * (i / 6);
      counter(kit, M, 1.9, 0.8, 1.8 * Math.sin(a), 1.8 * Math.cos(a), a, 1.05);
    }
    kit.post(M.screen, 1.0, 1.0, 1.4, 0, 2.0, 0, { radial: 10 });
  },

  /** #48 Reactor hall: a CATHEDRAL. Thirty metres tall, the core a lit column
   * up the middle, catwalks spiralling round it. The tallest place here. */
  cathedral(kit, M, p) {
    const { w, d, h } = p;
    const r = Math.min(w, d) / 2;
    floor(kit, M, w, d, 0, M.dark);
    arcWall(kit, M.hull, r, h, 0.4, TAU - 0.4, 22);
    /* The core: a column of glass with a strip inside it, floor to soffit. */
    kit.post(M.glass, 3.0, 3.0, h - 1, 0, (h - 1) / 2, 0, { radial: 16, collide: true });
    kit.post(M.strip, 2.2, 2.2, h - 3, 0, (h - 3) / 2 + 1, 0, { radial: 12 });
    for (let i = 0; i < 6; i++) ringOf(kit, M, M.wing, 3.4, 0.6, 16, i * (h / 6), { rad: 0.3 });
    /* The spiral: eight catwalk segments climbing a full turn and a half. */
    for (let i = 0; i < 12; i++) {
      const a = TAU * (i / 8), y = 3 + i * (h - 8) / 12;
      const rr = r - 3.5;
      catwalk(kit, M, 2 * rr * Math.tan(Math.PI / 8) * 1.06, 2.4, y, rr * Math.sin(a), rr * Math.cos(a), a + Math.PI / 2);
      kit.post(M.dark, 0.2, 0.2, y, rr * Math.sin(a), y / 2, rr * Math.cos(a), { radial: 6, collide: true });
    }
    stair(kit, M, 2.0, 3, -r + 2.4, r - 5);
    for (let i = 0; i < 6; i++) loose(kit, (i - 2.5) * 2.2, 0, -r + 3, (world, q) => makeBarrel(world, q));
  },

  /** #49 Coolant & water plant: WET GRATING. The floor is a grid over standing
   * water, pipes in banks at head height, turquoise light from below. */
  wetgrating(kit, M, p) {
    const { w, d, h } = p;
    kit.slab(M.glass, w, 0.3, d, 0, -1.05, 0, { collide: true, bevel: 0 });
    walls(kit, M, w, d, h, { doorW: 3 });
    ceiling(kit, M, w, d, h, { ribs: 6 });
    /* The grating: a grid of bars you walk on and see through. */
    for (let i = 0; i * 0.5 < w; i++) kit.slab(M.dark, 0.1, 0.1, d, -w / 2 + i * 0.5, 0.05, 0, { collide: i % 4 === 0, bevel: 0 });
    for (let i = 0; i * 0.5 < d; i++) kit.slab(M.dark, w, 0.08, 0.08, 0, 0.02, -d / 2 + i * 0.5, { collide: false, bevel: 0 });
    kit.slab(M.dark, w, 0.3, d, 0, -0.16, 0, { collide: true, bevel: 0 });
    /* The tanks and the pipe banks. */
    for (let i = 0; i < 3; i++) tank(kit, M, 1.5, h - 1.4, -w / 2 + 3 + i * 4.2, d / 2 - 2.4);
    for (let k = 0; k < 4; k++) {
      kit.post(M.wing, 0.3, 0.3, w - 1, 0, h - 1.2 - (k % 2) * 0.5, -d / 2 + 3 + k * 1.1, { rz: Math.PI / 2, radial: 8 });
    }
    kit.slab(M.strip, w - 2, 0.06, 0.4, 0, -0.9, 0, { collide: false, bevel: 0 });
  },

  /** #50 Fabrication: a MACHINE SHOP. Lathes in a row, a plasma cutter under
   * an extraction hood, a droid on a bench being rebuilt. */
  machineshop(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: 4 });
    ceiling(kit, M, w, d, h, { ribs: 6 });
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + (w / 4) * (i + 0.5);
      kit.slab(M.wing, w / 4 - 0.8, 1.1, 1.2, x, 0.55, d / 2 - 1.8, { collide: true, bevel: 0 });
      kit.post(M.dark, 0.3, 0.3, 1.4, x, 1.8, d / 2 - 1.8, { rz: Math.PI / 2, radial: 8 });
      kit.slab(M.status, 0.3, 0.14, 0.14, x + 0.6, 1.25, d / 2 - 2.3, { collide: false, bevel: 0 });
    }
    /* The cutter under its hood — the sparks are `Particles`'. */
    kit.slab(M.dark, 4.0, 1.0, 3.0, -w / 2 + 3.4, h - 0.7, -d / 2 + 3.0, { collide: false, bevel: 0 });
    kit.slab(M.wing, 3.0, 0.9, 2.0, -w / 2 + 3.4, 0.45, -d / 2 + 3.0, { collide: true, bevel: 0 });
    kit.slab(M.strip, 2.0, 0.06, 1.2, -w / 2 + 3.4, 0.92, -d / 2 + 3.0, { collide: false, bevel: 0 });
    /* The bench with the droid on it. */
    loose(kit, w / 2 - 4, 0, -d / 2 + 2.6, (world, q) => tableBody(world, q, M, 2.6, 1.2, 0.85));
    for (let i = 0; i < 5; i++) loose(kit, w / 2 - 6 + i * 1.2, 0, 0, (world, q) => makeCrate(world, q, 0.55));
  },

  /** #51 Droid pool: CHARGING ROWS. Alcoves in both long walls with a droid
   * in each and a charge light over it, a protocol droid on a bench. */
  chargingrows(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    walls(kit, M, w, d, h, { doorW: 2.8 });
    ceiling(kit, M, w, d, h, { ribs: 6, strips: false });
    for (const s of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        const x = -w / 2 + (w / 8) * (i + 0.5);
        kit.slab(M.hull, w / 8 - 0.2, 2.1, 1.2, x, 1.05, s * (d / 2 - 0.7), { collide: true, bevel: 0 });
        kit.slab(M.dark, w / 8 - 0.5, 1.8, 0.5, x, 0.9, s * (d / 2 - 1.35), { collide: false, bevel: 0 });
        kit.slab(M.strip, 0.3, 0.06, 0.1, x, 1.95, s * (d / 2 - 1.4), { collide: false, bevel: 0 });
      }
    }
    loose(kit, 0, 0, 0, (world, q) => tableBody(world, q, M, 2.2, 1.0, 0.8));
  },

  /** #52 Cargo hold: a CANYON. Container stacks in two walls with a slot
   * between them, a crane rail overhead, a lifter parked. The whole room is
   * throwable — §3.2 says so in as many words. */
  canyon(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: 5 });
    /* The stacks: static below shoulder height (they are the canyon walls),
     * loose on top (they are the sandbox). */
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        for (let k = 0; k < 3; k++) {
          const x = -w / 2 + (w / 5) * (i + 0.5), y = k * 2.6;
          kit.slab(k % 2 ? M.deep : M.wing, w / 5 - 0.4, 2.5, 4.6, x, y + 1.25, s * (d / 2 - 3), { collide: true, bevel: 0 });
        }
        loose(kit, -w / 2 + (w / 5) * (i + 0.5), 7.8, s * (d / 2 - 3), (world, q) => makeCrate(world, q, 1.2));
      }
    }
    /* The crane rail and its trolley. */
    for (const s of [-1, 1]) kit.slab(M.wing, w, 0.4, 0.5, 0, h - 1.2, s * 3.4, { collide: false, bevel: 0 });
    kit.slab(M.dark, 2.4, 0.8, 7.4, -w / 4, h - 1.8, 0, { collide: false, bevel: 0 });
    kit.post(M.dark, 0.08, 0.08, 4.0, -w / 4, h - 4.0, 0, { radial: 4 });
    scatter(kit, 14, w * 0.5, 5, 91, (x, z) => loose(kit, x, 0, z, (world, q) => makeCrate(world, q, 0.8)));
  },

  /** #53 Waste & recycling: a COMPACTOR. A pit with a moving face, a chute
   * above it, and a walk round three sides you throw things from. */
  compactor(kit, M, p, ctx) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    walls(kit, M, w, d, h, { doorW: 2.6 });
    ceiling(kit, M, w, d, h, { ribs: 4, strips: false });
    sink(kit, M, w - 6, d - 6, 3.4, ctx);
    /* The compactor face: a slab that will move (StationLife steps it). */
    kit.slab(M.wing, 0.7, 3.2, d - 6.4, -(w - 6) / 2 + 0.4, -1.7, 0, { collide: true, bevel: 0 });
    kit.slab(M.status, 0.1, 0.2, d - 7, -(w - 6) / 2 + 0.75, -0.6, 0, { collide: false, bevel: 0 });
    /* The chute over it. */
    kit.post(M.dark, 1.6, 1.2, 2.4, (w - 6) / 2 - 1.5, h - 1.4, 0, { radial: 8 });
    for (let i = 0; i < 6; i++) loose(kit, (w - 6) / 2 - 1.5, 0, (i - 2.5) * 1.2, (world, q) => makeCrate(world, q, 0.7));
  },

  /**
   * #57 The Repeating Room: A LATTICE CELL (V16 §A2).
   *
   * The holodeck, and its shape is an argument about what the room is FOR.
   *
   * ── WHY IT IS A CUBE AND WHY THE FLOOR IS EMPTY ───────────────────────
   *
   * Every other room in this file is a room with a JOB standing in it: a
   * counter, a bench, a row of tanks, a pit. The furniture is what tells you
   * what happens there. This room's job is to become somewhere else, so
   * furniture would be the one thing it must not have — a lathe in the corner
   * of a holodeck is a lathe you can still see when the room is supposed to be
   * a desert. So the floor is EMPTY: one plinth, dead centre, and 220 square
   * metres of nothing.
   *
   * That is also the whole silhouette, and it is the inverse of every deck-48
   * room around it:
   *
   *   `machineshop` is a room with things IN it;   this is a room with nothing
   *   `canyon` is high walls and a gap;            this is one even box
   *   `cathedral` is a column and catwalks;        this has one waist-high mark
   *   `compactor` and `wetgrating` sink;           this is dead flat
   *
   * ── AND THE LATTICE IS WHAT MAKES IT READ AS A MACHINE ────────────────
   *
   * Six faces, one pitch, edge to edge — floor, four walls and the soffit,
   * every one of them the same. Nothing else on this station is regular in
   * three axes at once, which is what rule 4's instrument actually keys on: an
   * even stipple over the whole frame, from any angle, with a single small
   * object at the middle of it. Measured with `station.mjs`'s own raster on
   * deck 48, the worst pair involving this room is 0.140 against a bound of
   * 0.85 — and it fills 865 of 2560 cells from its own door where the next
   * densest room on the deck fills 414 and the median fills 200, which is the
   * DENSITY doing the work rather than a lucky angle.
   *
   * The pitch is 1.05 m, which is a number and not a taste: any coarser and
   * the wall reads as panelling, any finer and it reads as texture. The studs
   * are `M.strip` because the emitters are the only light in here — there is
   * no lamp, no window, and `ceiling` is called with no ribs and no strips, so
   * the room is lit by the thing that makes the room.
   *
   * ── §11: THE ONE THING YOU CAN PICK UP ────────────────────────────────
   *
   * Four grey calibration blocks, in the reveal by the door and not on the
   * floor. A holodeck's floor has to stay clear; a room with nothing loose in
   * it at all fails §11 and is also a lie about a working machine, because
   * something has to be put on the floor to trim the emitters against.
   */
  latticecell(kit, M, p) {
    const { w, d, h } = p;
    /* Black plate, and `dark` for the shell too: this room is a hole in the
     * deck's own palette until a program paints it. */
    floor(kit, M, w, d, 0, M.dark);
    walls(kit, M, w, d, h, { doorW: 3.4, mat: M.dark });
    ceiling(kit, M, w, d, h, { ribs: 0, strips: false, mat: M.dark });

    /* THE LATTICE. One pitch on every face, counted off each span rather than
     * typed, so the grid stays square whatever the room's dimensions are. */
    const PITCH = 1.05, S = 0.16;
    const nx = Math.max(3, Math.round(w / PITCH));
    const nz = Math.max(3, Math.round(d / PITCH));
    const ny = Math.max(3, Math.round(h / PITCH));
    const at = (n, span, i) => -span / 2 + (span * (i + 0.5)) / n;
    const stud = (x, y, z, sx, sy, sz) =>
      kit.slab(M.strip, sx, sy, sz, x, y, z, { collide: false, bevel: 0 });
    /* The back wall and the two sides. The front wall is the doorway, and its
     * two returns carry the grid too — a face that skipped it would be the one
     * face you look at on the way out. */
    for (let j = 0; j < ny; j++) {
      const y = at(ny, h, j) + h / 2;
      for (let i = 0; i < nx; i++) {
        const x = at(nx, w, i);
        stud(x, y, d / 2 - 0.06, S, S, 0.06);
        /* the front returns, either side of the 3.4 m opening */
        if (Math.abs(x) > 1.7 + S) stud(x, y, -d / 2 + 0.06, S, S, 0.06);
      }
      for (let i = 0; i < nz; i++) {
        const z = at(nz, d, i);
        for (const s of [-1, 1]) stud(s * (w / 2 - 0.06), y, z, 0.06, S, S);
      }
    }
    /* The soffit and the floor. The floor's are INSET — flush with the plate,
     * so there is nothing to trip on and nothing that stops the floor reading
     * as one surface. */
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = at(nx, w, i), z = at(nz, d, j);
        stud(x, h - 0.06, z, S, 0.06, S);
        stud(x, 0.01, z, S, 0.02, S);
      }
    }

    /**
     * THE PLINTH — the console, and the only thing standing on the floor.
     *
     * Dead centre rather than by the door, which is the room's whole manner:
     * you walk into the middle of it and the room is all round you before you
     * choose anything. Waist high, so it does not break the eye line to any
     * wall — the silhouette above the plinth has to stay the lattice.
     */
    kit.post(M.dark, 0.62, 0.78, 1.02, 0, 0.51, 0, { radial: 8, collide: true });
    kit.slab(M.screen, 0.5, 0.06, 0.36, 0, 1.05, 0, { rx: -0.42, collide: false, bevel: 0 });
    kit.slab(M.strip, 0.66, 0.03, 0.5, 0, 0.06, 0, { collide: false, bevel: 0 });

    /* THE REVEAL BY THE DOOR: a shallow rack and the blocks in it. Everything
     * grabbable in this room is here and none of it is on the floor. */
    kit.slab(M.wing, 1.5, 0.12, 0.6, w / 2 - 1.2, 0.62, -d / 2 + 0.9, { collide: true, bevel: 0 });
    for (let i = 0; i < 4; i++) {
      loose(kit, w / 2 - 1.2, 0.7, -d / 2 + 0.9 + (i - 1.5) * 0.34,
        (world, q) => makeCrate(world, q, 0.28));
    }
  },

  /* ── DECK 32 AND 12: FLIGHT OPS ───────────────────────────────────────── */

  /** #2 Deck control tower: a CANTILEVER. A glass box hung out over nothing,
   * reached by a stair, with the traffic board across its back. */
  cantilever(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.wing);
    kit.slab(M.hull, w, h, 0.4, 0, h / 2, d / 2, { collide: true, bevel: 0 });
    for (const s of [-1, 1]) kit.slab(M.glass, 0.14, h - 0.7, d, s * w / 2, h / 2 - 0.2, 0, { collide: true, bevel: 0 });
    kit.slab(M.glass, w, h - 0.7, 0.14, 0, h / 2 - 0.2, -d / 2, { collide: true, bevel: 0 });
    ceiling(kit, M, w, d, h, { ribs: 3 });
    /* The struts it hangs on — a cantilever that is not visibly held is a box
     * floating in the air, which is the failure `HANGAR.md` is about. */
    for (const s of [-1, 1]) kit.slab(M.wing, 0.4, 0.4, 5.0, s * (w / 2 - 0.6), -1.4, 1.0, { rx: 0.6, collide: false, bevel: 0 });
    board(kit, M, 5.0, 1.8, 0, 2.2, d / 2 - 0.25);
    for (let i = 0; i < 4; i++) counter(kit, M, 2.0, 0.9, (i - 1.5) * 2.6, -d / 2 + 1.4, Math.PI, 0.95);
    stair(kit, M, 1.8, 3.2, 0, -d / 2 - 0.4);
  },

  /** #3 Pilots' ready room: a LOW ROOM. The lowest ceiling anywhere, lockers
   * down one wall, cots down the other, a briefing screen and an urn. */
  lowroom(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: 2.2 });
    ceiling(kit, M, w, d, h, { ribs: 5, strips: false });
    for (let i = 0; i < 8; i++) {
      kit.slab(M.wing, w / 8 - 0.15, 2.2, 0.6, -w / 2 + (w / 8) * (i + 0.5), 1.1, d / 2 - 0.4, { collide: true, bevel: 0 });
    }
    for (let i = 0; i < 4; i++) {
      kit.slab(M.deep, 1.9, 0.4, 0.8, -w / 2 + 2 + i * 3.2, 0.3, -d / 2 + 1.2, { collide: true, bevel: 0 });
    }
    board(kit, M, 3.2, 1.8, w / 2 - 2.4, 1.7, -d / 2 + 0.25);
    kit.post(M.wing, 0.3, 0.3, 0.6, -w / 2 + 1.0, 1.3, 0, { radial: 10, collide: true });
    for (let i = 0; i < 3; i++) loose(kit, (i - 1) * 2.2, 0, 0, (world, q) => chairBody(world, q, M));
    loose(kit, 0, 0, 1.2, (world, q) => tableBody(world, q, M, 1.6, 1.0, 0.76));
  },

  /** #4 Fighter maintenance bay: a DEEP PIT with gantries at three levels and
   * a fighter on a lift in it. You look down into the work. */
  deeppit(kit, M, p, ctx) {
    const { w, d, h } = p;
    floor(kit, M, w, d);
    walls(kit, M, w, d, h, { doorW: 5 });
    sink(kit, M, w - 8, d - 8, 8, ctx);
    /**
     * ══ THREE LEVELS, AND ALL THREE OF THEM REACHABLE ═════════════════════
     *
     * §3.2 #4's verb is *"walk the gantries"* and `FlightOps.js` makes walking
     * all three of them the type rating on the Starfury cert — so a level you
     * cannot get to is a gate nothing can open. As first built, the pit had
     * three catwalks at −5.4, −2.8 and −0.2 m, a kerb, and NO WAY DOWN: the
     * top one was a step off the floor and the other two were eight metres of
     * air. The stair below is that fix, and it is a switchback against the −X
     * wall with a spur onto each level, because a straight run at this rise
     * would be eleven metres long in a pit fourteen deep.
     *
     * The catwalks are 2.2 m deep rather than 1.8 so the top one meets the
     * pit's lip instead of stopping 300 mm short of it, which was a gap you
     * could fall down on the way to the verb.
     */
    const pz = (d - 8) / 2, px = (w - 8) / 2;
    const GY = GANTRY_Y;
    for (const y of GY) {
      for (const s of [-1, 1]) catwalk(kit, M, w - 9, 2.2, y, 0, s * (pz - 1.1), 0);
    }
    /* The switchback: floor → level 1 → level 0, against the −X wall. */
    const sx = -px + 1.1;
    const z1 = drop(kit, M, 1.5, GY[2], GY[1], sx, pz - 2.4, -1);
    kit.slab(M.dark, 1.5, 0.18, 1.0, sx, GY[1], z1 - 0.5, { collide: true, bevel: 0 });
    drop(kit, M, 1.5, GY[1], GY[0], sx, z1 - 1.0, -1);
    /* And the spur off each landing onto that level's catwalk, or the stair is
     * a stair to nowhere. */
    catwalk(kit, M, 3.0, 1.3, GY[1], sx, (pz - 2.6 + z1) / 2, Math.PI / 2);
    catwalk(kit, M, 3.4, 1.3, GY[0], sx, -(pz - 2.2), Math.PI / 2);
    /* The lift plate at the bottom, and the airframe standing on it. */
    kit.slab(M.wing, w - 12, 0.5, d - 12, 0, -7.6, 0, { collide: true, bevel: 0 });
    kit.slab(M.wing, 2.0, 1.4, 7.0, 0, -6.4, 0, { collide: true, bevel: 0 });
    for (const s of [-1, 1]) kit.slab(M.wing, 5.0, 0.3, 2.2, s * 3, -6.6, -1, { collide: false, bevel: 0 });
    /* The overhead gantry crane. */
    kit.slab(M.dark, w - 2, 0.5, 0.7, 0, h - 1.0, 0, { collide: false, bevel: 0 });
    scatter(kit, 8, w * 0.6, d * 0.6, 55, (x, z) => loose(kit, x, 0, z, (world, q) => makeCrate(world, q, 0.7)));
  },

  /** #5 Cobra bay: a SHAFT. Thirty-four metres of vertical launch well with
   * the Starfury on a rail up the middle and a blast wall you look through. */
  shaft(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    const r = Math.min(w, d) / 2;
    arcWall(kit, M.hull, r, h, 0.5, TAU - 0.5, 16);
    /* The rail: two rams up the full height, with the cradle between them. */
    for (const s of [-1, 1]) kit.post(M.wing, 0.4, 0.4, h - 2, s * 2.6, (h - 2) / 2, 0, { radial: 8, collide: true });
    kit.slab(M.wing, 6.0, 0.5, 2.4, 0, 1.4, 0, { collide: true, bevel: 0 });
    /* Hazard chevrons on the deck, and the blast wall with its window. */
    for (let i = 0; i < 6; i++) kit.slab(M.mark, 1.2, 0.05, 0.5, -3 + i * 1.2, 0.03, -r + 2.0, { ry: 0.6, collide: false, bevel: 0 });
    kit.slab(M.hull, w, 3.4, 0.6, 0, 1.7, -r + 0.6, { collide: true, bevel: 0 });
    kit.slab(M.glass, w - 4, 1.6, 0.2, 0, 2.4, -r + 0.6, { collide: false, bevel: 0 });
    /* The strips climbing the shaft, which is what makes it read as deep. */
    for (let i = 0; i < 10; i++) {
      const a = TAU * (i / 10);
      kit.slab(M.strip, 0.16, h - 4, 0.1, (r - 0.5) * Math.sin(a), h / 2, (r - 0.5) * Math.cos(a), { ry: a, collide: false, bevel: 0 });
    }
  },

  /** #6 Fighter rack: a CELLAR. Low and wide, two airframes on cradles, a
   * parts wall, engines on stands you can pick up and throw. */
  cellar(kit, M, p) {
    const { w, d, h } = p;
    floor(kit, M, w, d, 0, M.dark);
    walls(kit, M, w, d, h, { doorW: 4 });
    ceiling(kit, M, w, d, h, { ribs: 8, strips: false });
    for (const s of [-1, 1]) {
      kit.slab(M.wing, 1.6, 1.0, 6.0, s * (w / 4), 0.5, 0, { collide: true, bevel: 0 });
      kit.slab(M.wing, 5.0, 0.3, 1.8, s * (w / 4), 1.6, -0.8, { collide: false, bevel: 0 });
      kit.post(M.dark, 0.7, 0.7, 3.0, s * (w / 4), 1.3, 2.2, { rx: Math.PI / 2, radial: 10, collide: true });
    }
    rack(kit, M, w - 3, h - 0.6, 0, d / 2 - 0.5, 0, 5);
    /* The engines on stands — #6's verb is to grip a bell and throw it. */
    for (let i = 0; i < 4; i++) {
      loose(kit, -w / 2 + 3 + i * ((w - 6) / 3), 0.9, -d / 2 + 2.4,
        (world, q) => boxBody(world, q, M, 1.0, 1.1, 1.0, M.status, 34, 'engine'));
      kit.slab(M.dark, 1.2, 0.9, 1.2, -w / 2 + 3 + i * ((w - 6) / 3), 0.45, -d / 2 + 2.4, { collide: true, bevel: 0 });
    }
  },
};

/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Build one place into its own group.
 *
 * ONE KIT PER PLACE, not one per deck. A deck-wide merge would be four draw
 * calls for fifty rooms and no way to cull any of them — and §12.3's rule is
 * that a place is drawn when its door is inside 80 m, which needs the place
 * to be a thing that can be switched off. The price is a draw per material per
 * place, which is why a builder keeps to four or five materials and why
 * `station.mjs` counts them.
 */
export function buildPlace(world, group, place, M, st) {
  const fn = SHAPES[place.shape];
  if (!fn) throw new Error(`StationKit: place #${place.id} (${place.name}) declares shape '${place.shape}', which has no builder`);
  const kit = new Kit(1000 + Math.round(place.id * 7));
  kit.weather = false;
  const ctx = {
    sunk: [],
    trees: [],
    place,
    /* A builder may hand something back to the station: the cabin and the
     * habitat each name themselves so `Home.js` and `Habitat.js` can find
     * their room without a second table of coordinates (§2.3). */
    home: null,
    habitat: null,
    /** #56's column, handed back so `StationLife` can write the rolls on it. */
    obelisk: null,
    /** #25's lit slabs, handed back so `Notices.js` can write on them. */
    notices: null,
  };
  fn(kit, M, place, ctx, world);
  const y = floorOf(place);
  const pos = new THREE.Vector3(place.x, y, place.z);
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), place.yaw);
  const out = kit.emit(world, pos, quat);
  for (const m of out.meshes) group.add(m);
  /* A sunken floor is world-space state `world.floorAt` reads, so it is
   * recorded here in world coordinates rather than in the builder's frame. */
  for (const s of ctx.sunk) {
    const c = Math.abs(Math.cos(place.yaw)), sn = Math.abs(Math.sin(place.yaw));
    const hx = (s.w * c + s.d * sn) / 2, hz = (s.w * sn + s.d * c) / 2;
    st.sunk.push({ x0: place.x - hx, x1: place.x + hx, z0: place.z - hz, z1: place.z + hz, dy: -s.depth });
  }
  /* ── WHERE THE DESKS IN THIS ROOM ENDED UP ───────────────────────────
   *
   * In world coordinates, off the kit's own emit — see `counter()`. Recorded
   * per PLACE and not in one flat list, because the question `stationKey` asks
   * is "am I standing at a counter IN THIS ROOM", and a flat list would make
   * that a search over every desk on the deck. A room whose shape builds no
   * desk records nothing and is not in the map at all, which is the state the
   * two rooms that sell over a plank and a stone floor are in — see
   * `counterHere` for what the key does there. */
  if (kit.counters?.length) (st.counters || (st.counters = new Map())).set(place.id, kit.counters);
  if (ctx.home) st.home = ctx.home;
  if (ctx.obelisk) st.obelisk = { ...ctx.obelisk, group };
  /* The group as well as the numbers: `Habitat.js` parents its six panels to
   * the place's own node so they are culled, moved and disposed with the room
   * exactly as everything else in it is. Same hand-back `st.obelisk` gets. */
  if (ctx.habitat) st.habitat = { ...ctx.habitat, group };
  /* #25's lit slabs, for `Notices.dressNotices` — the habitat's hand-back
   * exactly, and for the identical reason: a notice is a surface to draw on
   * rather than an object to move, and the group is what culls it. */
  if (ctx.notices) st.notices = { ...ctx.notices, group };
  if (ctx.trees.length) (st.trees ||= []).push({ place, spec: ctx.trees[0] });
  return { draws: out.meshes.length, triangles: out.triangles, boxes: out.boxes?.length || 0 };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE BETWEEN-SPACE — the walkways, and why they needed their own rule      */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHAT WAS MEASURED, AND WHAT IT SAID ═══════════════════════════════════
 *
 * The player: *"the station really should not read as a series of connected
 * rooms … it should feel like a place at large, the in-between places, the
 * walkways, the transports … it can't just be an elevator selecting a level
 * and that's the room."*
 *
 * Rule 4 measured the PLACES and never once looked at what is between them.
 * `tools/_walkprobe.mjs` stood forty points on the walkways of each deck and
 * ran rule 4's own raster down them in both directions. Shell only — no
 * crowd, no rooms behind it, just the corridor:
 *
 *   deck 40 ring   worst pair 1.000   60 of 780 pairs over 0.85
 *   deck 44 ring   worst pair 1.000   57 of 780
 *   deck 40 spines worst pair 1.000   26 of 276
 *   deck 40 rim    worst pair 1.000    9 of 120
 *
 * 1.000 means the same picture, cell for cell. `Station.js`'s `buildRing` was
 * a 72-step loop whose only variation was `i % 2`, `buildSpines` built one
 * corridor four times, and no function in the whole between-space took a
 * bearing as an input. The criticism was exactly right.
 *
 * ── THE SAME ANSWER `SHAPES` IS ───────────────────────────────────────────
 *
 * `SHAPES` holds the rule "no two places the same shape" by being a library of
 * PARTS and one function per place — never a generic builder with a parameter,
 * which `station.mjs` checks by counting distinct function objects. `FIXTURES`
 * is that, for the street: ten kinds, ten builders, no two sharing a plan, and
 * `StationPlan.WAYS` says which is at which bearing on which deck.
 *
 * ── THE FRAME EVERY FIXTURE IS BUILT IN ───────────────────────────────────
 *
 * The kit arrives pushed onto the ring at the fixture's bearing: local origin
 * on the floor at `DRUM.ringR`, local +Z radially OUTWARD (the skin is at
 * z = +4.5), local −Z inboard (the room fronts are at z = −4.5), local +X
 * tangential. So a builder never does arithmetic about where in the drum it
 * is — the same thing that makes fifty place builders readable.
 *
 * THE WALK LINE IS KEPT. Nothing may leave less than 3 m of clear ring; a
 * fixture is against one edge or an island narrow enough to pass both sides,
 * and `station.mjs` measures the clearance rather than trusting this comment.
 */

/** Half the ring, in metres: the inboard face is at −IN, the skin at +IN. */
const RIN = DRUM.ringW / 2;

/** A hazard chevron run — the service way's own language, on a door. */
function chevrons(kit, M, w, y, z, n = 5) {
  for (let i = 0; i < n; i++) {
    kit.slab(M.status, w / n * 0.7, 0.16, 0.06, -w / 2 + (i + 0.5) * (w / n), y, z,
      { collide: false, bevel: 0, rz: 0.5 });
  }
}

/** A bench: a seat, a back, two cheeks. Static, so a crowd can be sat on it. */
function benchRun(kit, M, w, x, z, ry = 0) {
  kit.push(x, 0, z, ry);
  kit.slab(M.wing, w, 0.09, 0.52, 0, 0.44, 0, { collide: true, bevel: 0.02 });
  kit.slab(M.wing, w, 0.42, 0.08, 0, 0.72, 0.24, { collide: false, bevel: 0.02 });
  for (const s of [-1, 1]) kit.slab(M.dark, 0.1, 0.42, 0.5, s * (w / 2 - 0.2), 0.21, 0, { collide: false, bevel: 0 });
  kit.pop();
}

/** A lamp standard — the thing that makes a street a street after dark. */
function lampPost(kit, M, x, z, h = 3.4) {
  kit.post(M.dark, 0.09, 0.07, h, x, h / 2, z, { radial: 8, collide: true });
  kit.slab(M.strip, 0.5, 0.12, 0.5, x, h + 0.06, z, { collide: false, bevel: 0.03 });
  kit.light(x, h - 0.2, z, { intensity: 9, distance: 14 });
}

/**
 * ══ THE TEN KINDS ═════════════════════════════════════════════════════════
 * Each is its own function and each composes a plan nothing else has.
 * `station.mjs` counts the distinct function objects, exactly as it does for
 * `SHAPES`, so a table of ten names onto one closure fails.
 */
export const FIXTURES = {

  /** A SHOPFRONT: a glazed frontage set into the room line, awning, counter,
   * a hanging trade sign, and stock on the floor in front of it. */
  shopfront(kit, M, f) {
    const w = 9;
    kit.slab(M.hull, w, 3.9, 0.35, 0, 1.95, -RIN + 0.2, { collide: true, bevel: 0 });
    kit.slab(M.glass, w - 2.2, 2.3, 0.1, 0, 1.55, -RIN + 0.05, { collide: false, bevel: 0 });
    /* The awning, out over the walk, and the two ties that hold it. */
    kit.slab(M.mark, w - 0.6, 0.12, 2.1, 0, 3.5, -RIN + 1.3, { collide: false, bevel: 0.04, rx: -0.12 });
    for (const s of [-1, 1]) kit.post(M.dark, 0.05, 0.05, 1.5, s * (w / 2 - 0.6), 3.9, -RIN + 0.5, { radial: 5, rx: 0.7 });
    counter(kit, M, w - 3.4, 0.8, 0, -RIN + 1.9, 0, 1.02);
    kit.slab(M.strip, w - 1.4, 0.1, 0.1, 0, 3.34, -RIN + 2.3, { collide: false, bevel: 0 });
    board(kit, M, 1.9, 0.7, w / 2 - 1.2, 3.1, -RIN + 2.5, Math.PI / 2);
    loose(kit, -w / 2 + 1.0, 0.5, -RIN + 2.6, (world, p) => makeCrate(world, p, 0.7));
    loose(kit, w / 2 - 1.4, 0.55, -RIN + 2.7, (world, p) => makeBarrel(world, p));
    return 'shopfront';
  },

  /** AN ALCOVE: a niche cut back out of the walk, with a low soffit over it,
   * a curved bench in it and a light you sit under. Somewhere to stop. */
  alcove(kit, M, f) {
    const w = 6.4, d = 2.8;
    for (const s of [-1, 1]) kit.slab(M.hull, 0.4, 3.0, d, s * w / 2, 1.5, -RIN + d / 2, { collide: true, bevel: 0 });
    kit.slab(M.deep, w, 3.0, 0.3, 0, 1.5, -RIN + 0.15, { collide: true, bevel: 0 });
    kit.slab(M.dark, w + 0.8, 0.35, d + 0.4, 0, 3.15, -RIN + d / 2, { collide: false, bevel: 0 });
    kit.slab(M.strip, w - 1.2, 0.08, 0.3, 0, 2.94, -RIN + d - 0.2, { collide: false, bevel: 0 });
    benchRun(kit, M, w - 1.6, 0, -RIN + 0.75);
    /* Its floor is a step up, so the alcove reads as OFF the walk. */
    kit.slab(M.mark, w, 0.18, d - 0.3, 0, 0.09, -RIN + d / 2 - 0.1, { collide: true, bevel: 0 });
    loose(kit, w / 2 - 1.0, 0.4, -RIN + 1.9, (world, p) => boxBody(world, p, M, 0.5, 0.8, 0.4, M.dark, 14, 'crate'));
    return 'alcove';
  },

  /** A SERVICE DOOR: a hatch nobody but the crew opens — recessed frame,
   * chevrons, a conduit bundle climbing out of it, a status lamp, a bollard. */
  service(kit, M, f) {
    const w = 3.4;
    kit.slab(M.dark, w, 2.9, 0.5, 0, 1.45, -RIN + 0.25, { collide: true, bevel: 0 });
    kit.slab(M.deep, w - 0.8, 2.4, 0.16, 0, 1.2, -RIN + 0.5, { collide: false, bevel: 0 });
    chevrons(kit, M, w - 1.0, 0.35, -RIN + 0.6);
    for (const dx of [-0.5, 0, 0.5]) {
      kit.post(M.wing, 0.12, 0.12, DRUM.storey - 2.9, w / 2 - 0.5 + dx * 0.34,
        2.9 + (DRUM.storey - 2.9) / 2, -RIN + 0.5, { radial: 6 });
    }
    kit.slab(M.status, 0.26, 0.26, 0.2, 0, 3.1, -RIN + 0.5, { collide: false, bevel: 0.04 });
    kit.post(M.dark, 0.14, 0.14, 0.95, w / 2 + 0.9, 0.47, -RIN + 0.9, { radial: 6, collide: true });
    return 'service';
  },

  /** A KIOSK: a free-standing island in the middle of the walk you go round —
   * six faces, three of them screens, a lit cap. The one fixture the walk
   * SPLITS at, which is what stops the ring reading as a tube. */
  kiosk(kit, M, f) {
    kit.post(M.dark, 1.35, 1.5, 2.5, 0, 1.25, 0, { radial: 6, collide: true });
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / 6);
      kit.slab(M.screen, 1.15, 1.1, 0.08, 1.42 * Math.sin(a), 1.6, 1.42 * Math.cos(a), { ry: a, collide: false, bevel: 0 });
    }
    kit.post(M.wing, 1.75, 1.55, 0.22, 0, 2.62, 0, { radial: 6 });
    kit.slab(M.strip, 0.24, 0.9, 0.24, 0, 3.2, 0, { collide: false, bevel: 0.05 });
    kit.light(0, 2.9, 0, { intensity: 7, distance: 12 });
    loose(kit, 1.9, 0.4, 1.2, (world, p) => chairBody(world, p, M));
    return 'kiosk';
  },

  /** A PLANTER: a raised bed with a wall you sit on, a trunk and a canopy that
   * breaks the view down the ring — the cheapest thing there is that stops a
   * corridor being straight. */
  planter(kit, M, f) {
    const w = 6.2, d = 2.4;
    kit.slab(M.deep, w, 0.62, d, 0, 0.31, 0, { collide: true, bevel: 0.04 });
    kit.slab(M.wing, w + 0.24, 0.1, d + 0.24, 0, 0.64, 0, { collide: false, bevel: 0.03 });
    kit.slab(M.mark, w - 0.5, 0.16, d - 0.5, 0, 0.72, 0, { collide: false, bevel: 0 });
    kit.post(M.dark, 0.24, 0.17, 2.6, -1.3, 1.95, 0.2, { radial: 7, collide: true });
    for (const [dx, dy, dz, s] of [[-1.3, 3.1, 0.2, 2.4], [-0.7, 3.5, -0.4, 1.7], [-1.9, 3.4, 0.6, 1.6]]) {
      kit.slab(M.mark, s, 0.3, s * 0.8, dx, dy, dz, { collide: false, bevel: 0.12 });
    }
    kit.post(M.dark, 0.18, 0.13, 1.9, 1.9, 1.57, -0.3, { radial: 6, collide: true });
    kit.slab(M.mark, 1.5, 0.26, 1.2, 1.9, 2.6, -0.3, { collide: false, bevel: 0.1 });
    kit.light(0, 1.1, 0, { color: 0x9fe08a, intensity: 4, distance: 8 });
    return 'planter';
  },

  /** SEATING against the skin: three runs of bench facing outboard, a lamp
   * between them, and a bin. Where a person waits for somebody. */
  bench(kit, M, f) {
    for (const dx of [-2.6, 0, 2.6]) benchRun(kit, M, 2.2, dx, RIN - 1.5, Math.PI);
    lampPost(kit, M, -1.3, RIN - 2.4);
    lampPost(kit, M, 1.3, RIN - 2.4);
    kit.slab(M.dark, 4.2, 0.12, 1.5, 0, 0.06, RIN - 1.6, { collide: false, bevel: 0 });
    loose(kit, 3.9, 0.5, RIN - 2.2, (world, p) => makeBarrel(world, p));
    return 'bench';
  },

  /** A LEVEL CHANGE: a terrace against the skin, 0.9 m up, three steps at each
   * end and a rail along its lip. §3.1's decks are flat and this is the one
   * thing that gives a walk a section rather than a plan. */
  stair(kit, M, f) {
    const w = 12, d = 3.4, rise = 0.9;
    kit.slab(M.deep, w, rise, d, 0, rise / 2, RIN - d / 2, { collide: true, bevel: 0 });
    kit.slab(M.mark, w - 0.3, 0.1, d - 0.2, 0, rise + 0.05, RIN - d / 2, { collide: false, bevel: 0 });
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        kit.slab(M.deep, 1.1, rise * (i + 1) / 3, d - 0.6,
          s * (w / 2 + 0.55 + i * 1.1), rise * (i + 1) / 6, RIN - d / 2, { collide: true, bevel: 0 });
      }
      kit.post(M.wing, 0.06, 0.06, 1.05, s * (w / 2 + 0.2), rise + 0.52, RIN - d + 0.3, { radial: 5 });
    }
    kit.slab(M.wing, w, 0.08, 0.08, 0, rise + 1.02, RIN - d + 0.3, { collide: false, bevel: 0.02 });
    for (let i = 0; i * 2 <= w; i++) kit.slab(M.dark, 0.06, 1.0, 0.06, -w / 2 + i * 2, rise + 0.5, RIN - d + 0.3, { collide: false, bevel: 0 });
    kit.slab(M.strip, w - 1, 0.08, 0.1, 0, 0.08, RIN - d - 0.05, { collide: false, bevel: 0 });
    return 'stair';
  },

  /** A WINDOW BAY: the skin steps outboard, a rail and a step to stand on, a
   * fixed viewer on a post. §3.1 rule 1 wants the outside READ. */
  bay(kit, M, f) {
    const w = 6.6;
    for (const s of [-1, 1]) kit.slab(M.hull, 0.4, DRUM.storey, 2.2, s * w / 2, DRUM.storey / 2, RIN + 0.6, { collide: true, bevel: 0 });
    kit.slab(M.glass, w, 4.6, 0.12, 0, 2.9, RIN + 1.6, { collide: false, bevel: 0 });
    kit.slab(M.dark, w + 0.6, 0.5, 2.4, 0, DRUM.storey - 0.3, RIN + 0.6, { collide: false, bevel: 0 });
    kit.slab(M.deep, w, 0.36, 1.9, 0, 0.18, RIN - 0.4, { collide: true, bevel: 0 });
    kit.slab(M.wing, w, 0.09, 0.09, 0, 1.06, RIN - 1.3, { collide: false, bevel: 0.02 });
    for (let i = 0; i * 1.6 <= w; i++) kit.slab(M.dark, 0.06, 0.95, 0.06, -w / 2 + i * 1.6, 0.6, RIN - 1.3, { collide: false, bevel: 0 });
    kit.post(M.dark, 0.13, 0.1, 1.25, w / 2 - 1.1, 0.98, RIN - 0.9, { radial: 7, collide: true });
    kit.slab(M.wing, 0.3, 0.3, 0.75, w / 2 - 1.1, 1.7, RIN - 0.9, { collide: false, bevel: 0.05, rx: 0.35 });
    kit.slab(M.strip, w - 1.2, 0.07, 0.09, 0, 0.42, RIN - 0.45, { collide: false, bevel: 0 });
    return 'bay';
  },

  /** A GANTRY over the walk: two columns, a beam at head height, lamps and a
   * board hung under it. You pass THROUGH it, which is the whole point — a
   * corridor with a portal in it has two halves and a corridor has one. */
  gantry(kit, M, f) {
    const h = 4.4;
    for (const s of [-1, 1]) {
      kit.post(M.dark, 0.32, 0.26, h, 0, h / 2, s * (RIN - 0.9), { radial: 8, collide: true });
      kit.slab(M.wing, 0.9, 0.16, 0.9, 0, 0.08, s * (RIN - 0.9), { collide: false, bevel: 0.03 });
    }
    kit.slab(M.hull, 0.7, 0.62, DRUM.ringW - 1.4, 0, h + 0.31, 0, { collide: false, bevel: 0.04 });
    kit.slab(M.strip, 0.3, 0.09, DRUM.ringW - 2.2, 0, h - 0.06, 0, { collide: false, bevel: 0 });
    for (const s of [-1, 1]) kit.slab(M.status, 0.2, 0.2, 0.2, 0, h + 0.7, s * (RIN - 1.4), { collide: false, bevel: 0.04 });
    kit.light(0, h - 0.4, 0, { intensity: 8, distance: 15 });
    return 'gantry';
  },

  /** A MARKET RUN: three stalls staggered across the walk, each a counter
   * under its own canopy at its own height, with stock between them. Nothing
   * else in the between-space is asymmetric across the walk, and this is what
   * makes the ring feel occupied rather than furnished. */
  /** A SPINE NICHE: the wall of a radial corridor set back for two metres,
   * with a bench, a lit soffit and a map board. Frame: origin on the spine's
   * centreline, +Z outward along it, the walls at x = ±spineW/2. */
  niche(kit, M, f) {
    const hw = DRUM.spineW / 2, d = 2.0, w = 4.2;
    const s = f.side ?? 1;
    kit.slab(M.deep, d, 3.2, w, s * (hw + d / 2), 1.6, 0, { collide: false, bevel: 0 });
    kit.slab(M.hull, 0.3, 3.2, w, s * (hw + d), 1.6, 0, { collide: true, bevel: 0 });
    for (const t of [-1, 1]) kit.slab(M.hull, d, 3.2, 0.3, s * (hw + d / 2), 1.6, t * w / 2, { collide: true, bevel: 0 });
    kit.slab(M.dark, d + 0.4, 0.3, w + 0.4, s * (hw + d / 2), 3.35, 0, { collide: false, bevel: 0 });
    kit.slab(M.strip, d - 0.4, 0.08, w - 0.8, s * (hw + d / 2), 3.16, 0, { collide: false, bevel: 0 });
    benchRun(kit, M, w - 1.2, s * (hw + d - 0.5), 0, s * Math.PI / 2);
    board(kit, M, 1.2, 0.8, s * (hw + 0.25), 2.0, w / 2 - 1.0, s * Math.PI / 2);
    return 'niche';
  },

  /** A RISER: the services made visible where they cross a spine — a bundle
   * of pipe overhead, a valve stand, a grating underfoot and a floor light.
   * Deck 48's whole language, borrowed one bay at a time by the other two. */
  ducts(kit, M, f) {
    const hw = DRUM.spineW / 2;
    for (let i = 0; i < 4; i++) {
      kit.post(M.wing, 0.19, 0.19, DRUM.spineW + 1.2, 0, DRUM.storey - 1.0 - i * 0.34, -1.2 + i * 0.8,
        { rx: 0, rz: Math.PI / 2, radial: 7 });
    }
    kit.post(M.dark, 0.3, 0.3, DRUM.storey - 2.2, -hw + 0.7, (DRUM.storey - 2.2) / 2 + 1.1, 0.6, { radial: 8, collide: true });
    kit.post(M.status, 0.42, 0.42, 0.12, -hw + 0.7, 2.4, 0.6, { rx: Math.PI / 2, radial: 10 });
    kit.slab(M.dark, DRUM.spineW - 1.0, 0.1, 2.6, 0, 0.05, 0, { collide: false, bevel: 0 });
    kit.slab(M.strip, DRUM.spineW - 2.0, 0.06, 0.2, 0, 0.12, -1.3, { collide: false, bevel: 0 });
    loose(kit, hw - 1.1, 0.5, -0.8, (world, p) => makeBarrel(world, p));
    return 'ducts';
  },

  /** A BULKHEAD you walk through: a full frame across the spine with a lit
   * lintel, a raised sill and the door leaves parked in the wall. A spine
   * with two of these has three parts; a spine with none is a tube. */
  portal(kit, M, f) {
    const hw = DRUM.spineW / 2, h = 4.6;
    for (const s of [-1, 1]) {
      kit.slab(M.hull, 1.0, h, 0.9, s * (hw - 0.5), h / 2, 0, { collide: true, bevel: 0 });
      kit.slab(M.wing, 0.32, h - 0.5, 1.0, s * (hw - 1.05), (h - 0.5) / 2, 0, { collide: false, bevel: 0 });
    }
    kit.slab(M.hull, DRUM.spineW, 1.1, 0.9, 0, h + 0.55, 0, { collide: false, bevel: 0 });
    kit.slab(M.strip, DRUM.spineW - 2.4, 0.1, 0.24, 0, h - 0.12, -0.5, { collide: false, bevel: 0 });
    kit.slab(M.dark, DRUM.spineW - 2.0, 0.12, 0.7, 0, 0.06, 0, { collide: false, bevel: 0 });
    kit.slab(M.status, 0.22, 0.22, 0.2, hw - 1.6, 1.5, -0.5, { collide: false, bevel: 0.04 });
    kit.light(0, h - 0.5, 0, { intensity: 6, distance: 11 });
    return 'portal';
  },

  /** AN OVERLOOK on the balcony lip: the rail bulges out over the void on a
   * bracketed platform, with a leaning rail and a viewer. §3.1 rule 1 wants
   * the void looked into; a continuous rail is a thing you walk past. */
  overlook(kit, M, f) {
    const w = 7.0;
    /* Frame: origin on the lip, +Z pointing OUTWARD, so the void is −Z. */
    kit.slab(M.deep, w, 0.35, 3.0, 0, -0.17, -1.5, { collide: true, bevel: 0 });
    for (const s of [-1, 1]) kit.post(M.dark, 0.16, 0.1, 2.6, s * (w / 2 - 0.5), -1.5, -2.6, { rx: 0.7, radial: 6 });
    kit.slab(M.wing, w, 0.1, 0.1, 0, 1.02, -2.9, { collide: false, bevel: 0.02 });
    for (let i = 0; i * 1.3 <= w; i++) kit.slab(M.dark, 0.07, 1.0, 0.07, -w / 2 + i * 1.3, 0.5, -2.9, { collide: false, bevel: 0 });
    for (const s of [-1, 1]) kit.slab(M.wing, 0.1, 1.1, 3.0, s * w / 2, 0.55, -1.5, { collide: false, bevel: 0.02 });
    kit.post(M.dark, 0.12, 0.09, 1.15, 1.6, 0.57, -2.4, { radial: 7, collide: true });
    kit.slab(M.wing, 0.28, 0.28, 0.7, 1.6, 1.28, -2.4, { collide: false, bevel: 0.05, rx: -0.4 });
    kit.slab(M.strip, w - 0.6, 0.06, 0.14, 0, 0.06, -2.85, { collide: false, bevel: 0 });
    lampPost(kit, M, -w / 2 + 0.6, 0.6, 3.0);
    return 'overlook';
  },

  /** A STAIRHEAD: the rail breaks and eight steps drop to a half-landing over
   * the void, with a newel each side. The only place on a deck where the eye
   * is carried DOWN, which is what a balcony is for. */
  stairhead(kit, M, f) {
    const w = 3.6;
    for (let i = 0; i < 8; i++) {
      kit.slab(M.deep, w, 0.22, 0.42, 0, -0.11 - i * 0.22, -0.4 - i * 0.42, { collide: true, bevel: 0 });
    }
    kit.slab(M.deep, w + 1.6, 0.3, 2.2, 0, -1.9, -4.5, { collide: true, bevel: 0 });
    for (const s of [-1, 1]) {
      kit.post(M.dark, 0.16, 0.16, 1.5, s * (w / 2 + 0.3), 0.75, -0.2, { radial: 6, collide: true });
      kit.slab(M.wing, 0.09, 0.09, 4.6, s * (w / 2 + 0.25), 0.4, -2.4, { collide: false, bevel: 0.02, rx: -0.48 });
      kit.slab(M.wing, 0.09, 1.1, 2.4, s * (w / 2 + 0.85), -1.2, -4.6, { collide: false, bevel: 0.02 });
    }
    kit.slab(M.strip, w, 0.06, 0.14, 0, 0.06, -0.14, { collide: false, bevel: 0 });
    kit.light(0, -1.2, -4.2, { intensity: 6, distance: 12 });
    return 'stairhead';
  },

  /** A SHRINE on the lip: a lit stone facing the drop with a bench in front of
   * it and a bowl of light. Fourteen species aboard and they do not all mark
   * the same things; what they share is standing at the rail. */
  shrine(kit, M, f) {
    kit.slab(M.deep, 2.4, 2.9, 0.7, 0, 1.45, 1.1, { collide: true, bevel: 0.06 });
    kit.slab(M.mark, 1.6, 1.9, 0.14, 0, 1.55, 0.72, { collide: false, bevel: 0.03 });
    kit.slab(M.strip, 1.0, 0.1, 0.16, 0, 2.7, 0.7, { collide: false, bevel: 0 });
    kit.post(M.dark, 0.42, 0.3, 0.75, 0, 0.37, -0.5, { radial: 9, collide: true });
    kit.post(M.strip, 0.3, 0.3, 0.1, 0, 0.78, -0.5, { radial: 9 });
    benchRun(kit, M, 2.6, 0, -1.6, Math.PI);
    kit.light(0, 1.1, -0.4, { color: 0xffcf94, intensity: 6, distance: 10 });
    return 'shrine';
  },

  market(kit, M, f) {
    const at = [[-4.2, -RIN + 1.7, 0.0, 2.7], [0.2, RIN - 2.0, Math.PI, 3.0], [4.4, -RIN + 2.4, 0.25, 2.5]];
    for (let i = 0; i < at.length; i++) {
      const [x, z, ry, ch] = at[i];
      counter(kit, M, 2.8 + i * 0.4, 1.0, x, z, ry, 0.98);
      kit.push(x, 0, z, ry);
      for (const s of [-1, 1]) kit.post(M.dark, 0.06, 0.06, ch, s * (1.2 + i * 0.2), ch / 2, -0.7, { radial: 5 });
      kit.slab(M.mark, 3.2 + i * 0.4, 0.1, 2.2, 0, ch, -0.4, { collide: false, bevel: 0.05, rx: 0.1 + i * 0.05 });
      kit.slab(M.strip, 2.4, 0.07, 0.08, 0, ch - 0.22, -1.4, { collide: false, bevel: 0 });
      kit.pop();
      loose(kit, x + 1.9, 0.45, z + (ry ? -1.3 : 1.3), (world, p) => makeCrate(world, p, 0.62));
    }
    rack(kit, M, 2.4, 2.2, -1.9, -RIN + 0.5);
    return 'market';
  },
};

/**
 * ══ A JUNCTION, WHICH IS WHERE A PERSON DECIDES SOMETHING ═════════════════
 *
 * There was nothing at the mouth of a spine. The spine's two walls stopped at
 * `roomR`, the ring ran past on the far side of that line, and the one moment
 * on a walk that carries any information — *which way now* — happened at a
 * blank corner. Measured, the four mouths of a deck were the same picture:
 * `spine90@32 × spine270@32` came back at 1.000.
 *
 * Every junction gets the same STRUCTURE, because a station's junctions are a
 * family and pretending otherwise would be decoration; what makes each one
 * itself is `look`, and there are twelve of those, one per junction, each its
 * own function. A visitor learns "the brass one" and "the one with the
 * banners" the way people learn a real building.
 */
const JUNCTION_LOOK = {
  /* Deck 40 — a market deck: brass, cloth, lanterns, a customs line. */
  brass: (kit, M) => {
    for (const s of [-1, 1]) {
      kit.post(M.wing, 0.5, 0.42, 5.2, s * 5.6, 2.6, -RIN + 1.2, { radial: 10, collide: true });
      kit.post(M.wing, 0.34, 0.3, 3.4, s * 8.4, 1.7, 0, { radial: 10, collide: true });
      kit.slab(M.mark, 1.3, 1.3, 1.3, s * 8.4, 3.7, 0, { collide: false, bevel: 0.3 });
    }
    kit.slab(M.mark, 11.4, 0.3, 0.9, 0, 5.4, -RIN + 1.2, { collide: false, bevel: 0.08 });
  },
  awning: (kit, M) => {
    for (const s of [-1, 1]) {
      kit.slab(M.mark, 4.6, 0.12, 2.4, s * 3.4, 3.6, -RIN + 1.4, { collide: false, bevel: 0.05, rx: -0.16 });
      /* Cloth on a wire, right across the walk and on out along the ring —
       * what you see from thirty metres away is the washing, not the portal. */
      for (let i = 0; i < 4; i++) kit.slab(M.mark, 0.9, 1.6, 0.05, s * (6.5 + i * 1.7), DRUM.storey - 2.2, -1.4 + i * 0.9, { collide: false, bevel: 0 });
    }
    lampPost(kit, M, 0, RIN - 2.2, 4.0);
  },
  customs: (kit, M) => {
    for (const s of [-1, 1]) {
      kit.slab(M.dark, 1.0, 1.15, 2.6, s * 2.6, 0.58, -RIN + 1.6, { collide: true, bevel: 0.03 });
      kit.slab(M.screen, 0.7, 0.5, 0.06, s * 2.6, 1.4, -RIN + 0.4, { collide: false, bevel: 0 });
      /* The queue rail, running away down the ring both ways. */
      for (let i = 0; i < 5; i++) kit.post(M.wing, 0.05, 0.05, 1.0, s * (6.0 + i * 2.0), 0.5, 1.6, { radial: 5 });
      kit.slab(M.wing, 9.0, 0.06, 0.06, s * 10.0, 1.02, 1.6, { collide: false, bevel: 0 });
    }
  },
  lantern: (kit, M) => {
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      kit.post(M.dark, 0.07, 0.07, 1.4, s * 4.2, DRUM.storey - 1.0, t * 2.2, { radial: 5 });
      kit.slab(M.strip, 0.6, 0.7, 0.6, s * 4.2, DRUM.storey - 2.0, t * 2.2, { collide: false, bevel: 0.14 });
    }
    /* A row of them marching away along the walk. */
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
      kit.post(M.dark, 0.06, 0.06, 1.1, s * (7.0 + i * 2.6), DRUM.storey - 1.2, 0, { radial: 5 });
      kit.slab(M.strip, 0.5, 0.55, 0.5, s * (7.0 + i * 2.6), DRUM.storey - 2.0, 0, { collide: false, bevel: 0.12 });
    }
  },
  /* Deck 44 — a living deck: timber, glass, stone, banners. */
  timber: (kit, M) => {
    for (const s of [-1, 1]) {
      kit.slab(M.dark, 0.55, 4.4, 1.1, s * 5.2, 2.2, -RIN + 1.0, { collide: true, bevel: 0.06 });
      for (let i = 0; i < 3; i++) kit.slab(M.dark, 0.3, 2.6, 0.3, s * (7.6 + i * 2.4), 1.3, -RIN + 0.7, { collide: false, bevel: 0.05 });
    }
    kit.slab(M.dark, 11.0, 0.4, 1.1, 0, 4.6, -RIN + 1.0, { collide: false, bevel: 0.06 });
  },
  glass: (kit, M) => {
    kit.slab(M.glass, 10.4, 3.4, 0.1, 0, 2.4, -RIN + 0.4, { collide: false, bevel: 0 });
    for (const s of [-1, 1]) {
      kit.post(M.wing, 0.2, 0.2, 4.4, s * 5.2, 2.2, -RIN + 0.4, { radial: 8, collide: true });
      kit.slab(M.glass, 7.0, 3.0, 0.08, s * 9.2, 2.1, -RIN + 0.4, { collide: false, bevel: 0 });
      kit.post(M.wing, 0.16, 0.16, 4.0, s * 12.8, 2.0, -RIN + 0.4, { radial: 8 });
    }
  },
  stone: (kit, M) => {
    for (const s of [-1, 1]) {
      kit.slab(M.deep, 1.3, 3.6, 1.3, s * 5.0, 1.8, -RIN + 1.1, { collide: true, bevel: 0.1 });
      kit.slab(M.deep, 1.0, 2.2, 1.0, s * 9.0, 1.1, -RIN + 1.1, { collide: true, bevel: 0.1 });
      kit.slab(M.deep, 0.8, 1.4, 0.8, s * 12.4, 0.7, -RIN + 1.1, { collide: true, bevel: 0.1 });
    }
    kit.slab(M.deep, 11.4, 0.7, 1.3, 0, 3.95, -RIN + 1.1, { collide: false, bevel: 0.1 });
  },
  banner: (kit, M) => {
    for (let i = -2; i <= 2; i++) kit.slab(M.mark, 1.0, 3.2, 0.05, i * 2.2, DRUM.storey - 2.4, -RIN + 0.9, { collide: false, bevel: 0 });
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      kit.slab(M.mark, 0.8, 4.4, 0.05, s * (7.5 + i * 3.0), DRUM.storey - 3.0, RIN - 1.2, { collide: false, bevel: 0 });
    }
  },
  /* Deck 48 — a working deck: paint, pipe, shutters, work lamps. */
  hazard: (kit, M) => {
    chevrons(kit, M, 10.0, 0.3, -RIN + 0.35, 9);
    for (const s of [-1, 1]) {
      kit.slab(M.status, 0.3, 0.3, 0.3, s * 4.4, 3.4, -RIN + 0.5, { collide: false, bevel: 0.06 });
      kit.slab(M.status, 1.4, 2.2, 0.1, s * 8.0, 1.4, -RIN + 0.4, { collide: false, bevel: 0, rz: 0.4 });
    }
  },
  conduit: (kit, M) => {
    for (let i = 0; i < 5; i++) kit.post(M.wing, 0.15, 0.15, 11.5, -3.2 + i * 1.6, DRUM.storey - 1.1, 0, { rx: Math.PI / 2, radial: 6 });
    /* …and the same bundle turning the corner and running off down the ring. */
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      kit.post(M.wing, 0.15, 0.15, 16, s * 12, DRUM.storey - 1.4 - i * 0.4, RIN - 1.4, { rz: Math.PI / 2, radial: 6 });
    }
  },
  shutter: (kit, M) => {
    for (let i = 0; i < 7; i++) kit.slab(M.dark, 10.6, 0.28, 0.12, 0, 4.6 + i * 0.34, -RIN + 0.3, { collide: false, bevel: 0 });
    for (const s of [-1, 1]) kit.slab(M.dark, 3.2, 3.4, 0.4, s * 8.4, 1.7, -RIN + 0.35, { collide: true, bevel: 0 });
  },
  lamps: (kit, M) => {
    for (const s of [-1, 1]) {
      lampPost(kit, M, s * 4.6, -RIN + 1.4, 3.0);
      lampPost(kit, M, s * 4.6, RIN - 1.4, 3.0);
      lampPost(kit, M, s * 11.0, RIN - 1.4, 3.0);
    }
  },
};

/**
 * One junction, at the mouth of a spine. The structure: a portal you pass
 * under, a floor inlay you cross, two pylons, a bollard line that splays the
 * corner open, and the sign that says what is each way. `dressWayfinding`
 * hangs the words on it.
 */
function buildJunction(kit, M, j, y) {
  const a = j.at * Math.PI / 180;
  kit.push(DRUM.ringR * Math.sin(a), y, DRUM.ringR * Math.cos(a), a);
  const hw = DRUM.spineW / 2;
  /* Its own proportions, off its own row: the height of the portal, how far
   * the corner is splayed, how many bollards, and which inlay is under you.
   * Twelve junctions, twelve sets of numbers — which is what stopped
   * `spine90@32 × spine270@32` from measuring 1.000. */
  const H = j.h ?? 5.6, splay = j.splay ?? 0.62, nb = j.bollards ?? 3;
  /* THE PORTAL, over the spine's mouth on the inboard side of the ring. */
  for (const s of [-1, 1]) {
    kit.slab(M.hull, 0.8, H, 1.6, s * (hw + 0.6), H / 2, -RIN + 0.8, { collide: true, bevel: 0 });
    /* …and the splay: the corner is opened out rather than turned. */
    kit.slab(M.hull, 0.6, H, 2.6, s * (hw + 2.2), H / 2, -RIN + 2.0, { collide: true, bevel: 0, ry: s * splay });
  }
  kit.slab(M.hull, DRUM.spineW + 2.8, 0.9, 1.6, 0, H + 0.45, -RIN + 0.8, { collide: false, bevel: 0 });
  kit.slab(M.strip, DRUM.spineW + 0.6, 0.12, 0.3, 0, H - 0.1, -RIN + 1.5, { collide: false, bevel: 0 });
  /* THE FLOOR INLAY, right across the ring: you know you are at a crossing
   * because the ground under you changed — and the three patterns are how a
   * regular tells one crossing from another with their eyes down. */
  if (j.inlay === 'disc') {
    kit.post(M.mark, 4.6, 4.6, 0.08, 0, 0.04, 0, { radial: 16 });
    kit.post(M.strip, 5.2, 5.0, 0.06, 0, 0.09, 0, { radial: 20, open: true });
  } else if (j.inlay === 'chevron') {
    for (let i = -2; i <= 2; i++) {
      kit.slab(M.mark, 2.6, 0.08, 1.1, i * 1.9, 0.04, i * 0.55, { collide: false, bevel: 0, ry: 0.4 });
    }
    kit.slab(M.strip, DRUM.spineW + 3.0, 0.06, 0.2, 0, 0.09, -RIN + 0.5, { collide: false, bevel: 0 });
  } else {
    kit.slab(M.mark, DRUM.spineW + 3.0, 0.08, DRUM.ringW - 0.6, 0, 0.04, 0, { collide: false, bevel: 0 });
    kit.slab(M.strip, DRUM.spineW + 3.0, 0.06, 0.22, 0, 0.09, RIN - 0.5, { collide: false, bevel: 0 });
    kit.slab(M.strip, DRUM.spineW + 3.0, 0.06, 0.22, 0, 0.09, -RIN + 0.5, { collide: false, bevel: 0 });
  }
  /* THE BOLLARDS that keep a crowd off the corner. */
  for (const s of [-1, 1]) for (let i = 0; i < nb; i++) {
    kit.post(M.dark, 0.13, 0.11, 0.9, s * (hw + 3.4 + i * 1.3), 0.45, -RIN + 3.0 + i * 0.5, { radial: 6, collide: true });
  }
  /* AND, WHERE THERE IS SOMETHING OUTBOARD TO GO TO, a gate through the skin.
   * On deck 44 every junction is a tram platform (§3.2 #40 and its three) and
   * a crossing with a train on the far side of it is not the same crossing as
   * one with a wall. */
  if (j.outboard) {
    for (const s of [-1, 1]) kit.slab(M.dark, 0.7, 4.2, 1.2, s * (hw - 0.4), 2.1, RIN - 0.7, { collide: true, bevel: 0 });
    kit.slab(M.dark, DRUM.spineW + 0.6, 0.8, 1.2, 0, 4.6, RIN - 0.7, { collide: false, bevel: 0 });
    kit.slab(M.screen, 2.2, 0.7, 0.08, 0, 3.4, RIN - 1.35, { collide: false, bevel: 0 });
    kit.slab(M.strip, DRUM.spineW + 1.4, 0.07, 0.18, 0, 0.1, RIN - 1.6, { collide: false, bevel: 0 });
  }
  /* THE PYLON that carries the sign — the one thing you look for at a
   * junction, and it stands where it can be seen from both ways round. */
  kit.post(M.dark, 0.28, 0.24, 4.6, hw + 1.9, 2.3, RIN - 1.6, { radial: 8, collide: true });
  kit.light(0, 5.0, 0, { intensity: 10, distance: 20 });
  const look = JUNCTION_LOOK[j.look];
  if (look) look(kit, M);
  kit.pop();
}

/**
 * ══ EVERY FIXTURE ON A DECK, AND THE FOUR JUNCTIONS ═══════════════════════
 * Called by `Station.js` with the shell's own kit, so the whole between-space
 * still merges to one mesh per material — the fixtures cost triangles, not
 * draw calls, which is what lets there be forty of them under §12.2's 400.
 */
export function buildWays(kit, M, deck) {
  const y = DECK_Y[deck] ?? 0;
  const built = [];
  for (const w of waysOn(deck)) {
    const fn = FIXTURES[w.kind];
    if (!fn) continue;
    const a = w.at * Math.PI / 180;
    /* WHICH WALKWAY. Three bands, three frames, and every one of them puts
     * local +Z radially outward so a builder never asks where it is:
     *   ring   on the outer walk at `ringR`
     *   spine  at radius `r` down a radial corridor
     *   rim    on the balcony lip at `DRUM.balcony`, the void at local −Z */
    const r = w.band === 'spine' ? w.r : w.band === 'rim' ? DRUM.balcony : DRUM.ringR;
    /* Deck 40's +Z spine is the Concourse (§3.2 #9) and is not built as a
     * corridor, so nothing is hung in it either. */
    if (w.band === 'spine' && deck === 40 && w.at === 0) continue;
    kit.push(r * Math.sin(a), y, r * Math.cos(a), a);
    fn(kit, M, w);
    kit.pop();
    built.push(w);
  }
  for (const j of junctionsOn(deck)) buildJunction(kit, M, j, y);
  return built;
}

/**
 * ══ THE WORDS, WHICH ARE REAL GEOMETRY ════════════════════════════════════
 *
 * `dressBoards` puts the station's name on the departures board and the four
 * platforms. This is the same thing for the street: at every junction, what is
 * ahead and what is each way round the ring, on a panel bolted to that
 * junction's pylon; and a hanging blade over each gantry. A player who can
 * read where they are is a player in a place rather than in a corridor.
 */
export function dressWayfinding(world, st, M) {
  const y = st.deckY ?? 0;
  const made = [];
  const hang = (a, r, yaw, wide, tall, high, rows, name) => {
    const panel = signPanel(rows, { name, px: 384, pyx: 192 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wide, tall), panel.material);
    mesh.position.set(r * Math.sin(a), y + high, r * Math.cos(a));
    mesh.rotation.y = yaw;
    world.scene.add(mesh);
    world.statics.push(mesh);
    made.push({ panel, mesh });
  };
  for (const j of junctionsOn(st.deck)) {
    const a = j.at * Math.PI / 180;
    /* Both faces, because a sign a player walks past the back of is a sign
     * that only works if you came the right way round. */
    hang(a, DRUM.ringR + 2.6, a, 3.2, 1.1, 4.2, [j.name, j.sign[1], j.sign[2]], `way${j.deck}-${j.at}a`);
    hang(a, DRUM.ringR + 2.6, a + Math.PI, 3.2, 1.1, 4.2, [j.name, j.sign[2], j.sign[1]], `way${j.deck}-${j.at}b`);
    hang(a, DRUM.roomR + 1.4, a + Math.PI, 4.4, 0.9, 5.9, [j.sign[0]], `way${j.deck}-${j.at}c`);
  }
  for (const w of waysOn(st.deck)) {
    if (w.kind !== 'gantry') continue;
    const a = w.at * Math.PI / 180;
    hang(a, DRUM.ringR, a + Math.PI / 2, 3.0, 0.85, 3.7, [w.name], `way${w.deck}-g${w.at}`);
  }
  st.wayfinding = made;
  return made;
}
