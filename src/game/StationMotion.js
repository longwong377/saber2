/**
 * ══════════════════════════════════════════════════════════════════════════
 *  V20 LANE 2 — MOTION AND PARTICLES: NOTHING STATIC IN VIEW
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player: *"Motion everywhere. Doors that open, fans that turn, screens
 * that flicker, steam from the galley, litter that drifts in the atrium's
 * draught. Nothing static in view."* And, separately: *"the station lacks
 * particles."*
 *
 * ── WHY THIS IS A FILE AND NOT FIFTY EDITS TO `StationKit` ────────────────
 *
 * A room in this game is MERGED: `buildPlace` bins every slab by material and
 * emits one mesh per material, which is what makes a fifty-room deck cost two
 * hundred draws instead of nine thousand. A merged vertex cannot move. So
 * anything that turns, slides, sways or blinks has to be its own mesh, made
 * AFTER the merge, from the same nine materials (§9.1) — which is exactly the
 * shape `Morning.js` already has for the shutters. This is that file for
 * everything else that moves.
 *
 * ── WHAT MOVES, AND WHERE IT GETS ITS NUMBERS ─────────────────────────────
 *
 *   DOORS      two leaves in every doorway the kit actually CUT. Not a table:
 *              `StationKit.walls` and `arcFront` record `kit.doorway` on the
 *              one line that cuts the reveal, and `buildPlace` hands it out on
 *              `st.doorways`. A room with an open front, a tram platform or a
 *              glazed shopfront never reaches that line and gets no door, so
 *              the rule holds itself without anybody maintaining a list.
 *   FANS       ceiling fans in the cantina, the food court, the hostel and the
 *              laundry; extractors over #15's pass, #16's ranges and the
 *              forge; one big slow fan in the reactor hall's wall.
 *   SCREENS    every Holonet screen (`st.tvs`) and every card-room feed
 *              (`st.feeds`) breathes ±5% at 8–12 Hz on a seeded phase, and
 *              drops out for 0.2 s once a minute.
 *   PARTICLES  steam off #15's pass, #16's ranges and #39's washers; smoke
 *              over #17's stalls while the ambient cook is working; sparks at
 *              the forge while somebody stands at the bench; spray at #49's
 *              wet grating. All through the engine's own pools.
 *   LITTER     twenty seeded scraps on a seeded wind field round the atrium
 *              void, settling on the balcony and kicked when a body walks
 *              through them.
 *   MOTES      dust in the light shaft down the axis — only inside the beam.
 *   SMALL      the chandelier's rings turn (counter-turning by parity), eight
 *              pendant lamps sway two degrees, the four tram route maps blink,
 *              and #19's projector cone wobbles.
 *
 * ── THE BUDGET, AND HOW IT IS KEPT ────────────────────────────────────────
 *
 * Under 0.4 ms a frame and under 40 extra draws in view. Both are held by
 * INSTANCING the things there are many of and by parenting the things there
 * are few of to the room's own group, which `stepStation`'s door cull already
 * turns off: every door on the deck is two instanced meshes; the litter, the
 * motes, the lamps and the blips are one each; a fan is one mesh inside the
 * room it hangs in. The per-frame cost is one pass over the live bodies, one
 * distance test per door, and a matrix compose only for the instances that
 * actually moved this frame.
 *
 * NOTHING HERE ROLLS. Every phase, radius, drift and dropout is a seeded
 * stream off `makeRng` (`determinism.mjs` holds the whole tree to it), so the
 * litter drifts the same way on two machines and a check can predict it.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { makeRng, noise2, TAU } from '../engine/MathUtil.js';
import { mergeGeos, slabGeo, cylGeo } from '../world/Props.js';
import { DRUM, DECK_Y, floorOf } from './StationPlan.js';
import { audio } from '../engine/Audio.js';

/* ── the doors ─────────────────────────────────────────────────────────── */

/** How near a body has to be before the leaves part. */
export const DOOR_NEAR = 2.5;
/**
 * AND HOW FAR IS STILL NEAR ONCE THE LEAVES ARE OPEN.
 *
 * Measured on deck 44: a resident stands 2.50 m from #27's reveal and does not
 * move for the whole hour. On one threshold he crosses it every few frames as
 * the pool nudges him, and the door hisses open and shut for ever. So the
 * door latches: it opens at `DOOR_NEAR` and stays open out to `DOOR_FAR`.
 */
export const DOOR_FAR = 3.3;
/** How long the leaves stay parted after the last body leaves. */
export const DOOR_HOLD = 1.5;
/** How long the leaves take to run, opening and shutting. */
export const DOOR_OPEN_S = 0.55;
export const DOOR_SHUT_S = 0.75;
/**
 * THE WIDEST DOORWAY THAT IS STILL A DOOR.
 *
 * The kit cuts a "doorway" for anything from #16's 3.4 m to the cantina's
 * 22 m, and the wide ones are not doors: `sunkenround` asks for `w − 4`
 * because #14's whole front is an open arc onto the ring, and two eleven-metre
 * leaves across it would be a wall the player watches slide. Six and a half
 * metres is the widest pair of leaves that reads as a door — it keeps #7's
 * 6 m arrivals gate and drops the cantina, the food court, the forge alcove
 * and the lost-property counter, all of which are open fronts in fact.
 */
export const DOOR_MAX_GAP = 6.5;
/** How thick a leaf is, and how far the whole run is from the wall's plane. */
const LEAF_T = 0.14;

/* ── the fans ──────────────────────────────────────────────────────────── */

/**
 * WHAT TURNS, WHERE, in the room's OWN frame — the same frame every builder
 * in `StationKit.SHAPES` reasons in, so a fan is stated where the thing it
 * hangs over is stated and never in world coordinates.
 *
 * `kind` picks the blade set; `rate` is radians a second; `tilt` turns the
 * disc out of the horizontal (π/2 stands it up in a wall).
 */
const FANS = [
  /* #14 the cantina: two slow four-bladed fans over the sunken bar. */
  { place: 14, kind: 'ceiling', at: [-5.5, -1.1, 1.0], r: 1.5, rate: 1.15 },
  { place: 14, kind: 'ceiling', at: [5.5, -1.1, 1.0], r: 1.5, rate: -0.95 },
  /* #17 the food court: the lowest soffit on the deck, so the smallest fans. */
  { place: 17, kind: 'ceiling', at: [-5.0, -0.55, -1.2], r: 0.95, rate: 1.5 },
  { place: 17, kind: 'ceiling', at: [5.0, -0.55, -1.2], r: 0.95, rate: -1.35 },
  /* #38 the hostel: one over the aisle between the capsule rows. */
  { place: 38, kind: 'ceiling', at: [0, -0.7, 0], r: 1.3, rate: 0.85 },
  /* #39 the laundry: two over the wet aisle. */
  { place: 39, kind: 'ceiling', at: [-3.6, -0.6, 0], r: 0.9, rate: 1.7 },
  { place: 39, kind: 'ceiling', at: [3.6, -0.6, 0], r: 0.9, rate: -1.9 },
  /* #15's pass and #16's ranges: extraction, and it runs fast. */
  { place: 15, kind: 'extract', at: [0, -0.9, 4.6], r: 0.42, rate: 9.5 },
  { place: 16, kind: 'extract', at: [-3.2, -0.95, 0], r: 0.42, rate: 10.5 },
  { place: 16, kind: 'extract', at: [3.2, -0.95, 0], r: 0.42, rate: -9.0 },
  /* #10 the forge, over the bench. */
  { place: 10, kind: 'extract', at: [0, -0.8, -0.4], r: 0.5, rate: 8.0 },
  /* #48 the reactor hall: a five-metre fan standing in the wall, turning at
   * a fifth of a revolution a second, which is what makes it read as huge. */
  { place: 48, kind: 'reactor', at: [-14.2, 9.0, 0], r: 3.6, rate: 0.34, tilt: Math.PI / 2, yaw: Math.PI / 2 },
];

/* ── the emitters ──────────────────────────────────────────────────────── */

/**
 * WHERE THE AIR IS DIRTY, in the room's own frame again. `every` is seconds
 * between puffs; `gate` names what has to be true before anything is emitted
 * at all, so a stall that nobody is cooking at makes no smoke.
 */
const EMITTERS = [
  /* #15's pass — the kitchen seen through the hatch. `terrace` stands the
   * pass at `d / 2 − 0.7`; the steam comes off the top of it. */
  { place: 15, kind: 'steam', at: [-3.0, 1.6, 5.0], every: 0.55 },
  { place: 15, kind: 'steam', at: [3.0, 1.6, 5.0], every: 0.7 },
  /* #16's two ranges, back to back at ±1.1. */
  { place: 16, kind: 'steam', at: [-2.4, 1.1, -1.1], every: 0.6 },
  { place: 16, kind: 'steam', at: [2.4, 1.1, 1.1], every: 0.75 },
  /* #39's washers: four of the twelve are running. */
  { place: 39, kind: 'steam', at: [-3.4, 1.6, 4.1], every: 0.8 },
  { place: 39, kind: 'steam', at: [1.7, 1.6, 4.1], every: 1.1 },
  { place: 39, kind: 'steam', at: [-1.7, 1.6, -4.1], every: 0.95 },
  { place: 39, kind: 'steam', at: [3.4, 1.6, -4.1], every: 1.3 },
  /* #17's three stalls, and ONLY while the ambient cook is on one of them —
   * see `stepAmbientCook` in Station.js, whose `world._cook` this reads. */
  { place: 17, kind: 'cooksmoke', at: [-6.0, 2.1, 2.1], every: 0.45, gate: 'cook' },
  { place: 17, kind: 'cooksmoke', at: [0, 2.1, 2.1], every: 0.45, gate: 'cook' },
  { place: 17, kind: 'cooksmoke', at: [6.0, 2.1, 2.1], every: 0.45, gate: 'cook' },
  /* #10's bench, while its keeper is at it. */
  { place: 10, kind: 'sparks', at: [1.6, 1.15, -0.35], every: 1.6, gate: 'worker' },
  /* #49's wet grating: the coolant coming off the pipe banks onto the grid. */
  { place: 49, kind: 'spray', at: [-4.0, 4.6, -5.4], every: 1.1 },
  { place: 49, kind: 'spray', at: [4.4, 4.1, -4.3], every: 1.5 },
];

/* ── the atrium ────────────────────────────────────────────────────────── */

/** How many scraps drift in the draught. */
export const LITTER_N = 20;
/** How many motes hang in the beam. */
export const MOTE_N = 44;
/** The beam: the lit column down the axis, and how far up it is drawn. */
const BEAM_R = 7.4;
const BEAM_H = 9.5;
/** Pendant lamps over the balcony, and how far they swing. */
const LAMP_N = 8;
const LAMP_SWAY = 2 * Math.PI / 180;
/** Which decks have the void, the balcony and the chandelier in view. */
const ATRIUM_DECKS = new Set([40, 44, 48]);

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

/** A point in a place's own frame, in world. Same arithmetic `dressFeeds` and
 *  `Holonet.dressTV` do, and the only copy of it in this file. */
function toWorld(p, lx, lz, out) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  out.x = p.x + lx * c + lz * s;
  out.z = p.z - lx * s + lz * c;
  return out;
}

/** A fan's blades, hub-centred, turning about +Y. One geometry, one material. */
function fanGeo(kind, r) {
  const geos = [];
  const blades = kind === 'extract' ? 6 : kind === 'reactor' ? 8 : 4;
  const hubR = kind === 'reactor' ? 0.55 : Math.max(0.1, r * 0.16);
  geos.push(cylGeo(hubR, hubR, kind === 'reactor' ? 0.5 : 0.18, 8, 1, false));
  const bw = r * 0.82, bt = kind === 'extract' ? 0.02 : 0.035, bd = r * (kind === 'extract' ? 0.34 : 0.26);
  for (let i = 0; i < blades; i++) {
    const a = TAU * (i / blades);
    const g = slabGeo(bw, bt, bd, { bevel: 0.006 });
    /* pitched, so a blade catches the light differently top and bottom */
    _m.makeRotationZ(kind === 'reactor' ? 0.22 : 0.32);
    g.applyMatrix4(_m);
    _m.makeTranslation(hubR + bw / 2 - 0.02, 0, 0);
    g.applyMatrix4(_m);
    _m.makeRotationY(a);
    g.applyMatrix4(_m);
    geos.push(g);
  }
  /* The rim an extractor and the reactor's fan sit inside. */
  if (kind !== 'ceiling') geos.push(cylGeo(r + 0.06, r + 0.06, kind === 'reactor' ? 0.55 : 0.16, 16, 1, true));
  return mergeGeos(geos);
}

/**
 * A pendant lamp on a long cable, PIVOTED AT THE ORIGIN so a swing is one
 * rotation and the top of the cable never moves. The origin is the soffit, so
 * the whole thing hangs and nothing floats.
 */
const LAMP_DROP = 3.4;
function lampGeo() {
  const geos = [slabGeo(0.04, LAMP_DROP, 0.04, { bevel: 0.004 })];
  _m.makeTranslation(0, -LAMP_DROP / 2, 0);
  geos[0].applyMatrix4(_m);
  const shade = cylGeo(0.15, 0.32, 0.36, 10, 1, true);
  _m.makeTranslation(0, -LAMP_DROP - 0.16, 0);
  shade.applyMatrix4(_m);
  geos.push(shade);
  const bulb = cylGeo(0.1, 0.1, 0.12, 8, 1, false);
  _m.makeTranslation(0, -LAMP_DROP - 0.3, 0);
  bulb.applyMatrix4(_m);
  geos.push(bulb);
  return mergeGeos(geos);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DRESS                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything that moves on this deck, built once, after the rooms are merged.
 * Returns how many meshes it added, which is also what it put on `st.draws`.
 */
export function dressStationMotion(world, st) {
  if (!world?.scene || !st || st.motion) return 0;
  const M = st.mats;
  const deck = st.deck;
  const y0 = DECK_Y[deck] ?? 0;
  const rng = makeRng(9109 + deck * 31);
  const group = new THREE.Group();
  group.name = 'station-motion';
  world.scene.add(group);
  const mo = {
    group, rng, t: 0, deck,
    doors: [], leaves: null, edges: null, doorGeo: null,
    fans: [], screens: [], emitters: [],
    litter: null, motes: null, lamps: null, rings: [], blips: null, cone: null,
    /** Scratch: every live body's position, gathered once a frame. */
    bodies: [],
    draws: 0,
    /** What a check counts: puffs asked for, per kind. */
    puffs: { steam: 0, cooksmoke: 0, sparks: 0, spray: 0 },
  };
  st.motion = mo;

  dressDoors(world, st, mo, M);
  dressFans(world, st, mo, M);
  dressScreens(st, mo, rng);
  dressEmitters(world, st, mo);
  if (ATRIUM_DECKS.has(deck)) {
    dressLitter(world, st, mo, M, y0);
    dressMotes(mo, M, y0);
    dressLamps(mo, M, y0);
    dressRings(st, mo, M);
  }
  dressBlips(st, mo, M);
  dressCone(st, mo, M);

  st.draws += mo.draws;
  return mo.draws;
}

/* ── 1. doors ──────────────────────────────────────────────────────────── */

function dressDoors(world, st, mo, M) {
  const list = [];
  for (const [id, dw] of st.doorways || new Map()) {
    const rec = st.places.get(id);
    if (!rec || !dw || dw.gap > DOOR_MAX_GAP) continue;
    const p = rec.place;
    const y = floorOf(p);
    const c = toWorld(p, 0, dw.z, new THREE.Vector3());
    list.push({
      id, place: p, group: rec.group,
      gap: dw.gap, head: dw.head, z: dw.z,
      cx: c.x, cz: c.z, y, yaw: p.yaw,
      open: 0, hold: 0, was: -1, box: null, moved: true, vis: true,
    });
  }
  if (!list.length) return;
  mo.doors = list;
  const n = list.length * 2;
  mo.doorGeo = new THREE.BoxGeometry(1, 1, 1);
  mo.leaves = new THREE.InstancedMesh(mo.doorGeo, M.hull, n);
  mo.leaves.name = 'station-door-leaves';
  mo.edges = new THREE.InstancedMesh(mo.doorGeo, M.strip, n);
  mo.edges.name = 'station-door-edges';
  for (const im of [mo.leaves, mo.edges]) {
    im.frustumCulled = false;
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mo.group.add(im);
    mo.draws++;
  }
  /* The collider: ONE static box across the doorway per door, disabled the
   * moment the leaves are far enough apart to walk between. A box that
   * followed each leaf would be two boxes to move and the same answer. */
  const P = world.physics;
  for (const d of list) {
    if (!P?.addStaticBox) break;
    _q.setFromAxisAngle(_up, d.yaw);
    d.box = P.addStaticBox(
      new THREE.Vector3(d.cx, d.y + d.head / 2, d.cz),
      new THREE.Vector3(d.gap / 2, d.head / 2, 0.1),
      _q, { friction: 0.5, userData: { door: d.id } },
    );
  }
  writeDoors(mo, true);
}

/** Put the leaves where their `open` says. Only the doors that moved. */
function writeDoors(mo, all = false) {
  if (!mo.leaves) return;
  let wrote = 0;
  for (let i = 0; i < mo.doors.length; i++) {
    const d = mo.doors[i];
    if (!all && !d.moved) continue;
    d.moved = false;
    wrote++;
    /* ── A DOOR IS DRAWN WITH ITS ROOM AND NOT WITHOUT IT ────────────────
     *
     * The leaves are ONE instanced pair for the whole deck, so they cannot
     * be parented into the place's group and culled by `stepStation`'s door
     * cull like everything else in the room. Past `CULL` the room's walls
     * stop being drawn — and a leaf left standing there is two slabs hanging
     * in mid-air over an empty plate. Collapsed to nothing instead, which
     * costs the same one matrix write the move already costs. */
    if (!d.vis) {
      _s.set(0, 0, 0);
      _v.set(d.cx, d.y, d.cz);
      _q.setFromAxisAngle(_up, d.yaw);
      _m.compose(_v, _q, _s);
      mo.leaves.setMatrixAt(i * 2, _m); mo.leaves.setMatrixAt(i * 2 + 1, _m);
      mo.edges.setMatrixAt(i * 2, _m); mo.edges.setMatrixAt(i * 2 + 1, _m);
      continue;
    }
    _q.setFromAxisAngle(_up, d.yaw);
    const half = d.gap / 2;
    for (const sgn of [-1, 1]) {
      const k = i * 2 + (sgn < 0 ? 0 : 1);
      /* Shut, a leaf spans [0, ±gap/2]; open, [±gap/2, ±gap] — which is
       * inside the 0.4 m wall beside the reveal, so it is not seen. */
      const lx = sgn * (half / 2 + d.open * half);
      toWorld(d.place, lx, d.z, _v);
      _v.y = d.y + d.head / 2;
      _s.set(half, d.head - 0.06, LEAF_T);
      _m.compose(_v, _q, _s);
      mo.leaves.setMatrixAt(k, _m);
      /* The lit edge on the leading lip. */
      const ex = sgn * (d.open * half + 0.035);
      toWorld(d.place, ex, d.z, _v);
      _v.y = d.y + d.head / 2;
      _s.set(0.07, d.head - 0.34, LEAF_T + 0.06);
      _m.compose(_v, _q, _s);
      mo.edges.setMatrixAt(k, _m);
    }
  }
  if (wrote) { mo.leaves.instanceMatrix.needsUpdate = true; mo.edges.instanceMatrix.needsUpdate = true; }
}

/* ── 2. fans ───────────────────────────────────────────────────────────── */

function dressFans(world, st, mo, M) {
  for (const f of FANS) {
    const rec = st.places.get(f.place);
    if (!rec) continue;
    const p = rec.place;
    const geo = fanGeo(f.kind, f.r);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, f.kind === 'reactor' ? M.wing : M.dark);
    mesh.name = `station-fan-${f.place}-${mo.fans.length}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    /* `at[1]` is measured DOWN from the room's own soffit for a fan that
     * hangs, and up from the floor for one that stands in a wall. */
    const ly = f.tilt ? f.at[1] : (p.h || 4) + f.at[1];
    const holder = new THREE.Group();
    holder.name = `station-fan-mount-${f.place}`;
    toWorld(p, f.at[0], f.at[2], _v);
    holder.position.set(_v.x, floorOf(p) + ly, _v.z);
    holder.rotation.y = p.yaw + (f.yaw || 0);
    if (f.tilt) holder.rotation.x = f.tilt;
    holder.add(mesh);
    rec.group.add(holder);
    mo.fans.push({ mesh, rate: f.rate, a: mo.rng() * TAU, geo });
    mo.draws++;
  }
  /* The stem a hanging fan hangs on is part of the room and merged with it;
   * only the disc is a mesh. Nothing else to do here. */
  return mo.fans.length;
}

/* ── 3. screens ────────────────────────────────────────────────────────── */

/** How far a screen's brightness swings, and how long a dropout lasts. */
export const FLICKER = 0.05;
export const DROPOUT_S = 0.2;
export const DROPOUT_EVERY = 60;

function dressScreens(st, mo, rng) {
  const add = (mat, name) => {
    if (!mat) return;
    const rec = {
      mat, name,
      /** 8–12 Hz, seeded, so no two screens breathe together. */
      hz: 8 + rng() * 4,
      phase: rng() * TAU,
      /** When in the minute this one drops out. */
      dropAt: rng() * DROPOUT_EVERY,
      /** `emissiveIntensity` on a standard material; the colour's scale on a
       *  `MeshBasicMaterial`, which is what the canvas screens are. */
      emissive: mat.emissiveIntensity !== undefined,
      base: mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 1,
      level: 1,
    };
    mo.screens.push(rec);
  };
  for (const tv of st.tvs || []) add(tv.material || tv.mesh?.material, `tv${tv.id}`);
  for (const f of st.feeds || []) add(f.panel?.material || f.mesh?.material, `feed${f.id}`);
}

/* ── 4. the emitters ───────────────────────────────────────────────────── */

function dressEmitters(world, st, mo) {
  for (const e of EMITTERS) {
    const rec = st.places.get(e.place);
    if (!rec) continue;
    const p = rec.place;
    toWorld(p, e.at[0], e.at[2], _v);
    mo.emitters.push({
      kind: e.kind, gate: e.gate || null, place: e.place, group: rec.group,
      x: _v.x, y: floorOf(p) + e.at[1], z: _v.z,
      every: e.every, in: mo.rng() * e.every, n: 0,
    });
  }
}

/* ── 5. the litter ─────────────────────────────────────────────────────── */

function dressLitter(world, st, mo, M, y0) {
  const n = LITTER_N;
  const geo = new THREE.BoxGeometry(0.24, 0.012, 0.17);
  const mesh = new THREE.InstancedMesh(geo, M.mark, n);
  mesh.name = 'station-litter';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mo.group.add(mesh);
  mo.draws++;
  const L = {
    mesh, geo, n,
    x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n),
    spin: new Float32Array(n), roll: new Float32Array(n), rest: new Uint8Array(n),
    /** How far each scrap has travelled in all — a scrap that settles early
     *  has drifted, and a straight-line displacement would say it had not. */
    path: new Float32Array(n),
    /** When each resting scrap next asks the draught whether it is going
     *  anywhere. Staggered, so twenty scraps never all ask on one frame. */
    next: new Float32Array(n),
    kicks: 0, settled: 0, lofts: 0, y0,
  };
  const r0 = DRUM.atrium + 1.2, r1 = DRUM.balcony - 0.6;
  for (let i = 0; i < n; i++) {
    const a = mo.rng() * TAU, r = r0 + mo.rng() * (r1 - r0);
    L.x[i] = r * Math.sin(a);
    L.z[i] = r * Math.cos(a);
    L.y[i] = y0 + 1.3 + mo.rng() * 2.6;
    L.vx[i] = (mo.rng() - 0.5) * 0.3;
    L.vz[i] = (mo.rng() - 0.5) * 0.3;
    L.vy[i] = -0.05 - mo.rng() * 0.05;
    L.spin[i] = (mo.rng() - 0.5) * 2.2;
    L.roll[i] = mo.rng() * TAU;
    L.next[i] = mo.rng() * 0.6;
  }
  mo.litter = L;
  writeLitter(L);
}

function writeLitter(L) {
  for (let i = 0; i < L.n; i++) {
    _v.set(L.x[i], L.y[i], L.z[i]);
    _q.setFromAxisAngle(_up, L.roll[i]);
    _s.set(1, 1, 1);
    _m.compose(_v, _q, _s);
    L.mesh.setMatrixAt(i, _m);
  }
  L.mesh.instanceMatrix.needsUpdate = true;
}

/* ── 5b. the motes ─────────────────────────────────────────────────────── */

function dressMotes(mo, M, y0) {
  const n = MOTE_N;
  const geo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const mesh = new THREE.InstancedMesh(geo, M.strip, n);
  mesh.name = 'station-motes';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mo.group.add(mesh);
  mo.draws++;
  const D = { mesh, geo, n, a: new Float32Array(n), r: new Float32Array(n), y: new Float32Array(n), ph: new Float32Array(n), y0 };
  for (let i = 0; i < n; i++) {
    D.a[i] = mo.rng() * TAU;
    /* biased inward, so the shaft has a core and a haze */
    D.r[i] = BEAM_R * Math.sqrt(mo.rng()) * 0.94;
    D.y[i] = y0 + 0.6 + mo.rng() * BEAM_H;
    D.ph[i] = mo.rng() * TAU;
  }
  mo.motes = D;
}

/* ── 6. the small motion ───────────────────────────────────────────────── */

function dressLamps(mo, M, y0) {
  const geo = lampGeo();
  if (!geo) return;
  const mesh = new THREE.InstancedMesh(geo, M.strip, LAMP_N);
  mesh.name = 'station-lamps';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mo.group.add(mesh);
  mo.draws++;
  const L = { mesh, geo, n: LAMP_N, px: new Float32Array(LAMP_N), pz: new Float32Array(LAMP_N),
    py: new Float32Array(LAMP_N), ph: new Float32Array(LAMP_N), hz: new Float32Array(LAMP_N),
    ax: new Float32Array(LAMP_N) };
  const r = (DRUM.atrium + DRUM.balcony) / 2;
  for (let i = 0; i < LAMP_N; i++) {
    const a = TAU * (i / LAMP_N) + 0.19;
    L.px[i] = r * Math.sin(a);
    L.pz[i] = r * Math.cos(a);
    L.py[i] = y0 + DRUM.storey - 0.35;
    L.ph[i] = mo.rng() * TAU;
    /* a pendulum this long swings at about 0.45 Hz; the seed moves it a little */
    L.hz[i] = 0.40 + mo.rng() * 0.12;
    L.ax[i] = a;
  }
  mo.lamps = L;
}

/** The chandelier's rings, handed out of `Station.buildChandelier` so they can
 *  turn: two meshes a parity — the lit hoops and their dark caps and spokes. */
function dressRings(st, mo, M) {
  const specs = st.chandelier;
  if (!specs || !specs.length) return;
  for (const parity of [0, 1]) {
    const hoops = [], frames = [];
    for (const s of specs) {
      if ((s.i & 1) !== parity) continue;
      const hoop = cylGeo(s.r, s.r, 0.22, 28, 1, true);
      _m.makeTranslation(0, s.y, 0);
      hoop.applyMatrix4(_m);
      hoops.push(hoop);
      const cap = cylGeo(s.r + 0.14, s.r + 0.14, 0.12, 28, 1, true);
      _m.makeTranslation(0, s.y + 0.17, 0);
      cap.applyMatrix4(_m);
      frames.push(cap);
      for (let k = 0; k < 6; k++) {
        const a = TAU * (k / 6) + s.i * 0.3;
        const sp = slabGeo(s.r - 0.5, 0.08, 0.08, { bevel: 0.01 });
        _m.makeTranslation((s.r - 0.5) / 2, 0, 0);
        sp.applyMatrix4(_m);
        _m.makeRotationY(a);
        sp.applyMatrix4(_m);
        _m.makeTranslation(0, s.y, 0);
        sp.applyMatrix4(_m);
        frames.push(sp);
      }
    }
    if (!hoops.length) continue;
    const cx = specs[0].cx, cz = specs[0].cz;
    for (const [geos, mat, tag] of [[hoops, M.strip, 'lit'], [frames, M.dark, 'frame']]) {
      const geo = mergeGeos(geos);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `station-chandelier-${tag}-${parity}`;
      mesh.position.set(cx, 0, cz);
      mo.group.add(mesh);
      mo.rings.push({ mesh, geo, rate: parity ? -0.055 : 0.075 });
      mo.draws++;
    }
  }
}

/** The four tram route maps, one blinking dot each. Deck 44 only. */
function dressBlips(st, mo, M) {
  const stops = [];
  for (const rec of st.places.values()) {
    if (!rec.place.stop) continue;
    stops.push(rec.place);
  }
  if (!stops.length) return;
  const geo = new THREE.BoxGeometry(0.26, 0.26, 0.06);
  const mesh = new THREE.InstancedMesh(geo, M.status, stops.length);
  mesh.name = 'station-routeblips';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mo.group.add(mesh);
  mo.draws++;
  const B = { mesh, geo, n: stops.length, x: new Float32Array(stops.length), y: new Float32Array(stops.length),
    z: new Float32Array(stops.length), yaw: new Float32Array(stops.length), ph: new Float32Array(stops.length), on: new Uint8Array(stops.length) };
  for (let i = 0; i < stops.length; i++) {
    const p = stops[i];
    toWorld(p, -p.w / 2 + 1.6, p.d / 2 - 0.45, _v);
    B.x[i] = _v.x; B.z[i] = _v.z;
    B.y[i] = floorOf(p) + 2.05;
    B.yaw[i] = p.yaw;
    B.ph[i] = mo.rng() * 2;
    B.on[i] = 1;
  }
  mo.blips = B;
}

/** #19's projector cone, hung from the soffit onto the holo volume. */
function dressCone(st, mo, M) {
  const rec = st.places.get(19);
  if (!rec) return;
  const p = rec.place;
  const len = Math.max(1.5, (p.h || 7) - 4.2);
  const geo = new THREE.ConeGeometry(1.9, len, 14, 1, true);
  /* The apex at the origin, so the wobble pivots on the projector and not on
   * the middle of the beam — a cone that swung about its waist would read as
   * a lamp coming loose. */
  geo.translate(0, -len / 2, 0);
  const mesh = new THREE.Mesh(geo, M.glass);
  mesh.name = 'station-projector-cone';
  const lz = p.d / 2 - 2.6;
  toWorld(p, 0, lz, _v);
  mesh.position.set(_v.x, floorOf(p) + 4.2 + len, _v.z);
  mesh.renderOrder = 6;
  rec.group.add(mesh);
  mo.cone = { mesh, geo, x: mesh.position.x, z: mesh.position.z };
  mo.draws++;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STEP                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Every live body's position, gathered once — the doors and the litter both
 *  ask the same question and a second pass would be a second pass. */
function gatherBodies(world, st, out) {
  out.length = 0;
  const p = world.player?.position;
  if (p) out.push(p);
  const live = world._stationLife?.live;
  if (live) for (const b of live.values()) { if (b && !b.dead && b.position) out.push(b.position); }
  for (const k of st.keepers || []) { if (k.body && !k.body.dead && k.body.position) out.push(k.body.position); }
  return out;
}

export function stepStationMotion(world, st, dt) {
  const mo = st?.motion;
  if (!mo || !(dt > 0)) return;
  mo.t += dt;
  const bodies = gatherBodies(world, st, mo.bodies);
  stepDoors(world, mo, bodies, dt);
  for (const f of mo.fans) { f.a += f.rate * dt; f.mesh.rotation.y = f.a; }
  stepScreens(mo);
  stepEmitters(world, st, mo, bodies, dt);
  if (mo.litter) stepLitter(world, mo, bodies, dt);
  if (mo.motes) stepMotes(mo, dt);
  if (mo.lamps) stepLamps(mo);
  for (const r of mo.rings) r.mesh.rotation.y += r.rate * dt;
  if (mo.blips) stepBlips(mo);
  if (mo.cone) {
    const t = mo.t;
    mo.cone.mesh.rotation.z = Math.sin(t * 0.9) * 0.035;
    mo.cone.mesh.rotation.x = Math.sin(t * 0.63 + 1.1) * 0.028;
  }
}

/* ── the doors ─────────────────────────────────────────────────────────── */

const _paAt = new THREE.Vector3();

/** A short synthesised hiss — pneumatics, at the doorway. */
function hiss(d, shutting) {
  try {
    _paAt.set(d.cx, d.y + 1.4, d.cz);
    audio.noise({
      dur: shutting ? 0.34 : 0.42, gain: 0.085,
      type: 'bandpass', freq: shutting ? 1500 : 2600, freqEnd: shutting ? 700 : 1200,
      q: 1.1, pos: _paAt, pink: true,
    });
  } catch { /* no synth in a headless world */ }
}

function stepDoors(world, mo, bodies, dt) {
  if (!mo.doors.length) return;
  const near2 = DOOR_NEAR * DOOR_NEAR, far2 = DOOR_FAR * DOOR_FAR;
  for (const d of mo.doors) {
    const reach2 = d.hold > 0 ? far2 : near2;
    let near = false;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      /* Only bodies on this deck's storey — a resident twelve metres up is
       * not standing at this door. */
      if (Math.abs(b.y - d.y) > 4) continue;
      const dx = b.x - d.cx, dz = b.z - d.cz;
      if (dx * dx + dz * dz <= reach2) { near = true; break; }
    }
    const vis = d.group.visible !== false;
    if (vis !== d.vis) { d.vis = vis; d.moved = true; }
    if (near) d.hold = DOOR_HOLD;
    else if (d.hold > 0) d.hold -= dt;
    const want = d.hold > 0 ? 1 : 0;
    if (want !== d.was) {
      /* The hiss is on the frame the leaves are ASKED to move, not on the
       * frame they arrive: a door that is already open and asked again says
       * nothing. */
      if (d.was >= 0 && ((want === 1 && d.open < 0.98) || (want === 0 && d.open > 0.02))) hiss(d, want === 0);
      d.was = want;
    }
    const prev = d.open;
    if (want > d.open) d.open = Math.min(1, d.open + dt / DOOR_OPEN_S);
    else if (want < d.open) d.open = Math.max(0, d.open - dt / DOOR_SHUT_S);
    if (d.open !== prev) d.moved = true;
    /* THE COLLIDER FOLLOWS THE LEAVES. Off as soon as the gap is walkable,
     * on the moment the leaves close over it again. */
    if (d.box) d.box.disabled = d.open > 0.2;
  }
  writeDoors(mo);
}

/* ── the screens ───────────────────────────────────────────────────────── */

function stepScreens(mo) {
  const t = mo.t;
  for (const s of mo.screens) {
    let k = 1 + FLICKER * Math.sin(t * s.hz * TAU + s.phase);
    const phase = (t + s.dropAt) % DROPOUT_EVERY;
    if (phase < DROPOUT_S) k = 0.06;
    s.level = k;
    if (s.emissive) s.mat.emissiveIntensity = s.base * k;
    else s.mat.color.setScalar(k);
  }
}

/* ── the emitters ──────────────────────────────────────────────────────── */

/** How far from the player an emitter still bothers to emit. */
const EMIT_RANGE = 32;

function stepEmitters(world, st, mo, bodies, dt) {
  if (!mo.emitters.length) return;
  const fx = world.particles;
  const p = world.player?.position;
  for (const e of mo.emitters) {
    e.in -= dt;
    if (e.in > 0) continue;
    e.in = e.every;
    if (e.gate === 'cook' && !world._cook) continue;
    if (e.gate === 'worker') {
      let at = false;
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        const dx = b.x - e.x, dz = b.z - e.z;
        if (dx * dx + dz * dz < 9.0 && Math.abs(b.y - e.y) < 3) { at = true; break; }
      }
      if (!at) continue;
    }
    e.n++;
    mo.puffs[e.kind] = (mo.puffs[e.kind] || 0) + 1;
    if (!fx) continue;
    if (p && (Math.abs(p.x - e.x) > EMIT_RANGE || Math.abs(p.z - e.z) > EMIT_RANGE)) continue;
    if (e.group && !e.group.visible) continue;
    puff(fx, mo, e);
  }
}

function puff(fx, mo, e) {
  const r = mo.rng;
  _v.set(e.x + (r() - 0.5) * 0.4, e.y, e.z + (r() - 0.5) * 0.4);
  if (e.kind === 'steam') {
    fx.smoke?.spawn(_v, new THREE.Vector3((r() - 0.5) * 0.18, 0.62 + r() * 0.3, (r() - 0.5) * 0.18),
      { life: 2.4 + r() * 1.1, size: 0.30, drag: 1.5, gravity: -0.5, color: 0xdde6ea, alpha: 0.34 });
  } else if (e.kind === 'cooksmoke') {
    fx.smoke?.spawn(_v, new THREE.Vector3((r() - 0.5) * 0.2, 0.75 + r() * 0.3, (r() - 0.5) * 0.2),
      { life: 2.0 + r() * 0.9, size: 0.26, drag: 1.7, gravity: -0.4, color: 0xb8b2a6, alpha: 0.30 });
  } else if (e.kind === 'sparks') {
    fx.sparkBurst?.(_v, null, 8, { speed: 3.4, embers: false });
  } else if (e.kind === 'spray') {
    for (let i = 0; i < 3; i++) {
      fx.water?.spawn(_v, new THREE.Vector3((r() - 0.5) * 0.7, -1.6 - r(), (r() - 0.5) * 0.7),
        { life: 0.9 + r() * 0.4, size: 0.07, drag: 0.8, gravity: 8, color: 0x9fd8ff, alpha: 0.8 });
    }
  }
}

/* ── the litter ────────────────────────────────────────────────────────── */

/** The draught: a seeded, slowly turning field round the void. Tangential,
 *  because what an atrium's air does is go round. */
function wind(x, z, t, out) {
  const r = Math.hypot(x, z) || 1e-3;
  const tx = -z / r, tz = x / r;
  /* one turn of the field every couple of minutes, plus a slow gust */
  const g = 0.42 + 0.34 * noise2(x * 0.035 + t * 0.012, z * 0.035 - t * 0.009);
  out.x = tx * g + noise2(x * 0.09, z * 0.09 + t * 0.05) * 0.22;
  out.z = tz * g + noise2(x * 0.09 + 11.3, z * 0.09 + t * 0.05) * 0.22;
  /* the updraught off the deck's own strips, strongest over the void's lip */
  out.y = 0.16 * noise2(x * 0.07 + t * 0.03, z * 0.07) - 0.08;
  return out;
}

const _w = { x: 0, y: 0, z: 0 };

function stepLitter(world, mo, bodies, dt) {
  const L = mo.litter;
  const t = mo.t;
  const rIn = DRUM.atrium + 0.7, rOut = DRUM.balcony + 0.4;
  let settled = 0;
  for (let i = 0; i < L.n; i++) {
    if (L.rest[i]) {
      settled++;
      /* ── AND A GUST PICKS IT UP AGAIN ────────────────────────────────
       *
       * Twenty scraps that all come to rest in the first minute and never
       * move again are not litter drifting in a draught; they are twenty
       * stickers on the balcony. So a resting scrap asks the field every
       * half-second whether the air over it has got up, and the field is the
       * same seeded one that carries the airborne ones — no roll. */
      if (t >= L.next[i]) {
        L.next[i] = t + 0.5;
        if (noise2(L.x[i] * 0.05 + t * 0.09, L.z[i] * 0.05 - t * 0.05) > 0.55) {
          L.vy[i] = 0.75 + 0.4 * noise2(L.z[i] * 0.2, L.x[i] * 0.2);
          L.vx[i] = 0; L.vz[i] = 0;
          L.spin[i] = 1.4 * noise2(L.x[i] * 0.3, L.z[i] * 0.3);
          L.rest[i] = 0;
          L.lofts++;
          settled--;
          continue;
        }
      }
      /* Kicked when somebody walks through it. */
      for (let k = 0; k < bodies.length; k++) {
        const b = bodies[k];
        if (Math.abs(b.y - L.y[i]) > 2.2) continue;
        const dx = L.x[i] - b.x, dz = L.z[i] - b.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 1.3) continue;
        const d = Math.sqrt(d2) || 1e-3;
        L.vx[i] = (dx / d) * 1.5 + (mo.rng() - 0.5) * 0.6;
        L.vz[i] = (dz / d) * 1.5 + (mo.rng() - 0.5) * 0.6;
        L.vy[i] = 1.3 + mo.rng() * 0.7;
        L.spin[i] = (mo.rng() - 0.5) * 6;
        L.rest[i] = 0;
        L.kicks++;
        settled--;
        break;
      }
      continue;
    }
    wind(L.x[i], L.z[i], t, _w);
    /* A scrap is light: the air owns it, and it only ever falls slowly. */
    L.vx[i] += (_w.x - L.vx[i]) * Math.min(1, dt * 1.6);
    L.vz[i] += (_w.z - L.vz[i]) * Math.min(1, dt * 1.6);
    L.vy[i] += (_w.y - 0.26 - L.vy[i]) * Math.min(1, dt * 1.2);
    const px = L.x[i], pz = L.z[i];
    L.x[i] += L.vx[i] * dt;
    L.y[i] += L.vy[i] * dt;
    L.z[i] += L.vz[i] * dt;
    L.path[i] += Math.hypot(L.x[i] - px, L.z[i] - pz);
    L.roll[i] += L.spin[i] * dt;
    /* KEPT IN THE BAND. Nothing falls down the void — the draught is what
     * holds it over the balcony, and a scrap that reaches the inner lip is
     * pushed back out by the column of air coming up it. */
    const r = Math.hypot(L.x[i], L.z[i]) || 1e-3;
    if (r < rIn || r > rOut) {
      const want = Math.min(rOut - 0.3, Math.max(rIn + 0.3, r));
      const k = want / r;
      L.x[i] *= k; L.z[i] *= k;
      L.vx[i] *= 0.4; L.vz[i] *= 0.4;
    }
    /* THE FLOOR IS ONLY ASKED FOR WHEN A SCRAP IS NEAR IT. `activeFloorAt`
     * walks this deck's sunken rooms and wells, and twenty of those a frame
     * was a third of this lane's whole budget on deck 48. A scrap over half a
     * metre up cannot be landing this frame. */
    const floor = (L.y[i] < L.y0 + 0.6 && world.floorAt) ? world.floorAt(L.x[i], L.z[i]) : L.y0 - 9;
    if (L.y[i] <= floor + 0.02) {
      L.y[i] = floor + 0.012;
      L.vx[i] = L.vz[i] = L.vy[i] = 0;
      L.spin[i] = 0;
      L.rest[i] = 1;
      L.settled++;
      settled++;
    } else if (L.y[i] > L.y0 + 6) {
      L.y[i] = L.y0 + 6;
      L.vy[i] = -0.1;
    }
  }
  L.resting = settled;
  writeLitter(L);
}

/* ── the motes ─────────────────────────────────────────────────────────── */

function stepMotes(mo, dt) {
  const D = mo.motes, t = mo.t;
  for (let i = 0; i < D.n; i++) {
    /* A mote drifts DOWN the beam and turns very slowly about the axis; it
     * is put back at the top when it leaves the bottom, so the shaft never
     * empties and nothing is ever drawn outside it. */
    D.a[i] += (0.018 + 0.012 * Math.sin(D.ph[i])) * dt;
    D.y[i] -= (0.055 + 0.03 * Math.sin(t * 0.4 + D.ph[i])) * dt;
    if (D.y[i] < D.y0 + 0.3) D.y[i] = D.y0 + BEAM_H;
    const r = D.r[i] * (0.94 + 0.06 * Math.sin(t * 0.25 + D.ph[i]));
    _v.set(r * Math.sin(D.a[i]), D.y[i] + 0.08 * Math.sin(t * 0.7 + D.ph[i]), r * Math.cos(D.a[i]));
    _q.setFromAxisAngle(_up, D.a[i] * 3 + D.ph[i]);
    _s.set(1, 1, 1);
    _m.compose(_v, _q, _s);
    D.mesh.setMatrixAt(i, _m);
  }
  D.mesh.instanceMatrix.needsUpdate = true;
}

/* ── the lamps and the blips ───────────────────────────────────────────── */

function stepLamps(mo) {
  const L = mo.lamps, t = mo.t;
  for (let i = 0; i < L.n; i++) {
    const sw = LAMP_SWAY * Math.sin(t * L.hz[i] * TAU + L.ph[i]);
    _v.set(L.px[i], L.py[i], L.pz[i]);
    _q.setFromAxisAngle(_up, L.ax[i]);
    _m.compose(_v, _q, _s.set(1, 1, 1));
    /* the swing is about the lamp's own hanging point, across the balcony */
    _m2.makeRotationX(sw);
    _m.multiply(_m2);
    L.mesh.setMatrixAt(i, _m);
  }
  L.mesh.instanceMatrix.needsUpdate = true;
}

function stepBlips(mo) {
  const B = mo.blips, t = mo.t;
  let changed = false;
  for (let i = 0; i < B.n; i++) {
    /* 0.7 s on, 0.7 s off, offset per platform. */
    const on = ((t + B.ph[i]) % 1.4) < 0.7 ? 1 : 0;
    if (on === B.on[i] && B.wrote) continue;
    B.on[i] = on;
    changed = true;
    _v.set(B.x[i], B.y[i], B.z[i]);
    _q.setFromAxisAngle(_up, B.yaw[i]);
    _s.set(on ? 1 : 0.001, on ? 1 : 0.001, on ? 1 : 0.001);
    _m.compose(_v, _q, _s);
    B.mesh.setMatrixAt(i, _m);
  }
  B.wrote = true;
  if (changed) B.mesh.instanceMatrix.needsUpdate = true;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE UNDRESS                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Put it all down. The fans and the cone are parented to their rooms and
 * `undressStation`'s own loop disposes those geometries — but it runs AFTER
 * this, and a mesh disposed twice is not a fault, so everything this file made
 * is freed here and the room's loop finds it already gone.
 */
export function undressStationMotion(world) {
  const st = world?._station;
  const mo = st?.motion;
  if (!mo) return;
  const P = world.physics;
  for (const d of mo.doors) if (d.box) P?.removeStaticBox?.(d.box);
  mo.doors.length = 0;
  mo.doorGeo?.dispose?.();
  for (const f of mo.fans) { f.mesh.parent?.remove(f.mesh); f.geo?.dispose?.(); }
  mo.fans.length = 0;
  for (const r of mo.rings) { r.mesh.parent?.remove(r.mesh); r.geo?.dispose?.(); }
  mo.rings.length = 0;
  for (const part of [mo.litter, mo.motes, mo.lamps, mo.blips]) {
    if (!part) continue;
    part.mesh.parent?.remove(part.mesh);
    part.mesh.dispose?.();
    part.geo?.dispose?.();
  }
  if (mo.cone) { mo.cone.mesh.parent?.remove(mo.cone.mesh); mo.cone.geo?.dispose?.(); }
  for (const s of mo.screens) {
    if (s.emissive) s.mat.emissiveIntensity = s.base;
    else s.mat.color?.setScalar?.(1);
  }
  mo.screens.length = 0;
  mo.group.parent?.remove(mo.group);
  st.motion = null;
}
