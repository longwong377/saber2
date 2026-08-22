/**
 * PROPS THAT STAND ON THE GROUND, AND PROPS YOU CANNOT SEE THROUGH.
 *
 * Two player reports, both visible on every map, both of them one measurement
 * away from being obvious and neither of them caught by anything in the suite.
 *
 * ════ ONE: "objects floating in the air on every single map" ═══════════
 *
 * Every `addX` in Props.js builds from its footprint UP, so its `pos` is a
 * point on the ground and a level hands it a terrain sample. Every `makeX`
 * built around its CENTRE — so the levels compensated by hand, with a
 * CONSTANT per prop type:
 *
 *     makeCrate(world, pos.setY(pos.y + 0.45), 0.7)
 *     makeBarrel(world, pos.setY(pos.y + 0.55))
 *     makeVaporator(world, pos.setY(pos.y + 1.3))
 *     makeSpire(world, V(x, y + 3, z), 5 + rng() * 4)
 *
 * A constant cannot be right, because the maker randomises its own size:
 * makeCrate builds at size·(0.85…1.20), so a "0.7 m" crate is 0.54–0.76 m tall
 * and one number could not seat both ends of that. Measured over the dressed
 * levels — lowest vertex of the assembly minus the terrain directly under it:
 *
 *     makeCrate      median +0.08 m, 90th +0.15, worst +0.58
 *     makeBarrel     +0.09 m on every one of them, on every level
 *     makeVaporator  +0.10 m on every one of them
 *     makeSpire      −0.41 median but +0.27 at worst — half buried, half hung
 *
 * The stacks had a version of the same disease that owed nothing to terrain:
 * addCrateStack advanced its tiers by a flat 0.9·size over boxes 0.88·size
 * tall, so there was a 2 cm gap under every crate in every stack in the game,
 * it laid each tier on its own lattice as the stack narrowed, and an 18% "gaps,
 * not a wall" roll could empty a tier entirely — measured on the arena, a live
 * top crate standing 0.86 m above the nearest thing under it. Its live crates
 * were also asked for at `s / 0.85`, i.e. between 1.00 and 1.41 times their own
 * slot, so the one on top overlapped its static neighbours by up to 12 cm.
 *
 * Nine to fifteen centimetres of daylight under a crate is what the report is
 * looking at, and it was under every crate, drum, vaporator and console in the
 * game. Three more of the same kind turned up in the survey and are fixed with
 * it: an antenna's guy anchors sat on the mast's flat datum and hung 0.72 m
 * over the dunes, the hangar's light fittings floated 0.40 m below the truss
 * they are bolted to, and its cable runs were bracketed to thin air five
 * metres in front of the wall.
 *
 * `pos` now means the same thing for every maker in the file — the point on
 * the ground the prop stands on — and Props.seatOnGround measures the
 * assembly's own underside and its own contact patch to get there.
 *
 * WHAT THIS CHECK PINS. For every assembly on every level: the lowest point of
 * its geometry, against the highest thing under its contact patch — terrain,
 * or another assembly's top, because a crate on a stack is standing on the
 * stack. That number must be ≤ 0.05 m, i.e. the thing touches what it stands
 * on. After the fix the 99th percentile seat is −0.01 to −0.07 m on every
 * level and nothing standing on the ground is clear of it at all.
 *
 * ════ TWO: "the tops of many objects are see-through" ══════════════════
 *
 * Drop a grid of vertical rays on a closed, correctly wound solid and the
 * topmost surface each ray crosses must be a FRONT face — at the point where a
 * ray enters a solid the outward normal cannot point downward, overhang or no
 * overhang. Where it does, backface culling deletes the lid and you look
 * straight into the object. Measured per maker as the fraction of its plan
 * area whose topmost crossing is back-facing:
 *
 *     addHullSection   91.6%     addRockArch   81.6%
 *     addLamp          36.5%     addRock       36.4%
 *     addOutcrop       24.7%     addColossus   13.5%
 *     addColumn broken  9.1%     makePillar     1.2%
 *
 * addRock's 36.4% is not a rounding error: rockGeo's top ring sits at 0.606 of
 * its widest radius and 0.606² = 0.367 is exactly the plan area its lid
 * covers. Five separate causes, all of them a winding:
 *
 *   · fanCap's `up` flag emitted the fan the wrong way round — every rock,
 *     outcrop, boulder landmark and broken column crown in the game;
 *   · revolveGeo's winding followed the direction the caller wrote the
 *     profile in, so the two makers that wrote theirs top-down (a lamp cowl,
 *     the colossus's mantle) came out inside out;
 *   · addRockArch swept its span with the section walked against the tangent;
 *   · addHullSection had its outer plate facing the axis, its inner plate
 *     facing away, and both torn lips pointing back into the metal;
 *   · ashlarFace wound its chamfers for a stone standing PROUD, and `relief`
 *     is negative for every empty socket and one facing stone in eight.
 *
 * Plus two holes rather than inversions: a pillar's echinus flared wider than
 * the abacus that was supposed to cover it, and a console's cable started its
 * open-ended tube on the corner of the plinth instead of inside it.
 *
 * WHAT THIS CHECK PINS. Every maker in Props.js, built on its own, rayed from
 * above on a jittered 44 × 44 grid: no column may have a back face on top with
 * the nearest front face more than 5 cm below it. After the fix that count is
 * zero for every maker; before it, 618 columns of 675 on addHullSection alone.
 *
 * ONE RESIDUE, WRITTEN DOWN RATHER THAN HIDDEN, because it is the honest limit
 * of the fix. Fuzzed over 60 random broken walls — random width, height, ruin
 * and seed — 6 columns in 77239 still fall through, by 0.09 to 0.30 m. They
 * are all on the ruined WALLHEAD, where ashlarFace lays a chamfered face plate
 * over a panel whose top edge is a random walk: a stone whose outline clears
 * the panel behind it by a couple of centimetres leaves a sliver with nothing
 * over it. That is a hairline at the top of a 6 m wall seen from directly
 * above, it is 0.008% of the plan area, and fixing it means restructuring how
 * a face plate meets a broken top — which is a different job from this one.
 *
 * Both surveys walk the makers and the levels by enumeration, so a prop added
 * next year is covered without anyone having to remember this file exists.
 */

import * as THREE from 'three';
import * as P from '../../src/world/Props.js';
import { Terrain } from '../../src/world/Terrain.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { battlefieldGround, installGround, removeGround } from '../../src/world/Battlefield.js';
import { GrassField } from '../../src/world/Scenery.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ── a world stub the dressing passes are happy with ─────────────────── */
/**
 * `level` is part of the world a dressing pass reads — several passes take
 * numbers off it (the cut's water line is `world.level?.water?.level ?? 0.30`,
 * and it then refuses to place anything loose below that) — so a survey that
 * leaves it off is surveying a level the game does not ship. sliceable.mjs had
 * the same hole and it cost the deeps every crate and barrel on its floor.
 */
function stubWorld(terrain, level = null) {
  const scene = new THREE.Scene();
  const realAdd = scene.add.bind(scene);
  // Which maker put this here, for the per-prop-type report. A label only:
  // nothing is asserted on it, so a stack format change degrades to '?'.
  scene.add = (...objs) => {
    for (const o of objs) if (o && o.userData && !o.userData.__maker) o.userData.__maker = makerOf(new Error().stack);
    return realAdd(...objs);
  };
  return {
    scene, level, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: { addStaticBox() { return {}; }, removeStaticBox() {}, staticBoxes: [], add() {}, remove() {}, bodies: [], raycast: () => null },
    addLight(l) { (this.lights ||= []).push(l); scene.add(l); return l; },
    addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
    notify() {}, report() {}, spawnEnemy: () => null, spawnDebris() {},
    time: 0,
    addProp(p) { this.props.push(p); return p; },
    terrain,
    settings: { quality: 'medium' },
  };
}

/** The outermost Props.js/Scenery.js frame — the maker the level asked for. */
const EXPORTED = new Set(Object.keys(P));
function makerOf(stack) {
  let best = null;
  for (const line of String(stack).split('\n')) {
    const m = /at (?:new )?([A-Za-z0-9_$.]+) \(.*\/src\/(?:world|game)\/[A-Za-z]+\.js:/.exec(line);
    if (m) {
      const name = m[1].split('.').pop();
      if (EXPORTED.has(name) || /^(add|make)[A-Z]/.test(name)) best = name;
    }
  }
  return best || '?';
}

/* ── assemblies ──────────────────────────────────────────────────────── */
const _v = new THREE.Vector3();

/**
 * ONE ASSEMBLY IS ONE THING THE LEVEL PLACED, which is not one mesh. A Kit
 * emits one merged mesh per material for the whole structure and a Prop hangs
 * trim meshes off its body, so a per-mesh survey measures an antenna's dish as
 * an object floating twenty-five metres up. Kit.emit gives every mesh of one
 * emit the same `position`, so (maker, position) is the assembly; a Prop is its
 * own; and an InstancedMesh is one assembly PER INSTANCE, because being many
 * separate objects is the whole point of it.
 */
function assemblies(world) {
  const out = [];
  const byKey = new Map();
  const _m = new THREE.Matrix4(), _f = new THREE.Matrix4();

  /** min/max y, full bounds, and the xz bounds of the bottom of the shape. */
  const measure = (parts) => {
    let minY = Infinity, maxY = -Infinity;
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const p of parts) {
      if (p.minY < minY) minY = p.minY;
      if (p.maxY > maxY) maxY = p.maxY;
      bx0 = Math.min(bx0, p.bx0); bx1 = Math.max(bx1, p.bx1);
      bz0 = Math.min(bz0, p.bz0); bz1 = Math.max(bz1, p.bz1);
    }
    // the contact patch: the bottom eighth of the height is what does the
    // standing, and a leaning spire's crown is not it
    const band = minY + Math.max(0.04, (maxY - minY) * 0.12);
    let cx0 = Infinity, cx1 = -Infinity, cz0 = Infinity, cz1 = -Infinity;
    for (const p of parts) {
      for (let i = 0; i < p.low.length; i += 3) {
        if (p.low[i + 1] > band) continue;
        cx0 = Math.min(cx0, p.low[i]); cx1 = Math.max(cx1, p.low[i]);
        cz0 = Math.min(cz0, p.low[i + 2]); cz1 = Math.max(cz1, p.low[i + 2]);
      }
    }
    if (!isFinite(cx0)) { cx0 = bx0; cx1 = bx1; cz0 = bz0; cz1 = bz1; }
    /* An 8 × 8 max-height grid over the footprint, because a single maxY is
     * the WRONG number to ask another object for. A crate stack is one merged
     * mesh, so its bounding top is the top of its tallest crate — 21 cm above
     * the tier that the live crate beside it is actually standing on, which is
     * enough to make the crate look unsupported. The grid costs 64 floats and
     * answers the only question worth asking: how high is that thing HERE. */
    const G = 8, top = new Float32Array(G * G).fill(-Infinity);
    /* AND THE UNDERSIDE, cell by cell — the half of the height field this file
     * never built, and the reason two whole-level defects survived it.
     *
     * Everything below reads the assembly's seat off ONE number: `minY` minus
     * the highest ground under the contact patch. That is a single `max` over
     * a box, so it answers "is any part of this on something" and cannot
     * answer "is ALL of it on something" — an arch straddling a ramp reads as
     * seated off the bank its patch corner clips, and 52 m of bridge rail
     * planted from one terrain sample reads as seated off the pier it happens
     * to cross. Both shipped. `bot[k]` is the lowest surface of the assembly
     * over cell k, built by the same vertex-then-face rasterisation as `top`
     * and for the same reason: a scatter of corners is not a surface. */
    const bot = new Float32Array(G * G).fill(Infinity);
    const sx = G / Math.max(1e-6, bx1 - bx0), sz = G / Math.max(1e-6, bz1 - bz0);
    const cellX = (bx1 - bx0) / G, cellZ = (bz1 - bz0) / G;
    const bin = (v) => Math.min(G - 1, Math.max(0, v | 0));
    for (const p of parts) {
      for (let i = 0; i < p.low.length; i += 3) {
        const k = bin((p.low[i] - bx0) * sx) * G + bin((p.low[i + 2] - bz0) * sz);
        if (p.low[i + 1] > top[k]) top[k] = p.low[i + 1];
        if (p.low[i + 1] < bot[k]) bot[k] = p.low[i + 1];
      }
      /* AND THE FACES BETWEEN THEM, which is the difference between a height
       * field and a scatter of points.
       *
       * The vertex pass alone leaves holes in a solid object wherever a cell is
       * finer than the model's own vertex pitch, and it silently decides what
       * this whole file measures. Measured on `addCrateStack` seed 9952: the
       * stack is 1.68 × 0.84 m and solid to 1.37 m over the whole of it, the
       * grid is 0.210 × 0.104 m a cell, and a crate's top face carries four
       * vertex rows 0.22 m apart — so **24 of the 64 cells came back empty**,
       * in stripes, and the nine points `seatOf` samples under a live crate all
       * landed in them. The crate was resting across two lids and this file
       * called it "standing on nothing", which is how a real defect (the crate
       * was in fact bedded 0.205 m INTO those lids — Props.js `seatOnGround`)
       * got reported upside down and stayed open.
       *
       * A face fills every cell whose CENTRE it covers, at the height of the
       * face there. Not the face's bounding box and not its maximum: a bbox
       * splat over-states the surface, and over-stating support is the one
       * error this file must never make, because it excuses a float. */
      const T = p.tris, L = p.low;
      for (let t = 0; t + 2 < T.length; t += 3) {
        const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
        const ax = L[a], az = L[a + 2], bx = L[b], bz = L[b + 2], cx = L[c], cz = L[c + 2];
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(det) < 1e-12) continue;                 // edge-on: no plan area
        const i0 = bin((Math.min(ax, bx, cx) - bx0) * sx), i1 = bin((Math.max(ax, bx, cx) - bx0) * sx);
        const j0 = bin((Math.min(az, bz, cz) - bz0) * sz), j1 = bin((Math.max(az, bz, cz) - bz0) * sz);
        for (let gi = i0; gi <= i1; gi++) {
          const x = bx0 + (gi + 0.5) * cellX;
          for (let gj = j0; gj <= j1; gj++) {
            const z = bz0 + (gj + 0.5) * cellZ;
            const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
            if (u < 0 || u > 1) continue;
            const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
            if (v < 0 || u + v > 1) continue;
            const y = u * L[a + 1] + v * L[b + 1] + (1 - u - v) * L[c + 1];
            const k = gi * G + gj;
            if (y > top[k]) top[k] = y;
            if (y < bot[k]) bot[k] = y;
          }
        }
      }
    }
    return { minY, maxY, bx0, bx1, bz0, bz1, cx0, cx1, cz0, cz1, top, bot, G };
  };

  const partOf = (mesh, M) => {
    const pos = mesh.geometry.attributes.position;
    let minY = Infinity, maxY = -Infinity;
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    const low = [];
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(M);
      if (_v.y < minY) minY = _v.y;
      if (_v.y > maxY) maxY = _v.y;
      if (_v.x < bx0) bx0 = _v.x; if (_v.x > bx1) bx1 = _v.x;
      if (_v.z < bz0) bz0 = _v.z; if (_v.z > bz1) bz1 = _v.z;
      low.push(_v.x, _v.y, _v.z);
    }
    // …and which of those vertices are a triangle, because `measure` builds a
    // HEIGHT FIELD out of them and a surface is its faces, not its corners.
    const index = mesh.geometry.index;
    const n = index ? index.count : pos.count;
    const tris = new Int32Array(n - (n % 3));
    for (let t = 0; t < tris.length; t++) tris[t] = index ? index.getX(t) : t;
    return { minY, maxY, bx0, bx1, bz0, bz1, low, tris, mat: mesh.material };
  };

  const add = (key, maker, o) => {
    o.updateMatrixWorld(true);
    if (o.isInstancedMesh) {
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, _m);
        _f.multiplyMatrices(o.matrixWorld, _m);
        out.push({ maker, parts: [partOf(o, _f)] });
      }
      return;
    }
    let g = byKey.get(key);
    if (!g) { byKey.set(key, g = { maker, parts: [] }); out.push(g); }
    g.parts.push(partOf(o, o.matrixWorld));
  };
  const walk = (root, key, maker) => {
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) add(key, maker, o); });
  };
  /* A Prop adds its own mesh to the scene AND to world.props, so the scene
   * walk has to skip them or every prop is counted twice — and a duplicate
   * sitting in exactly the same place makes every prop look like it is resting
   * against something, which is precisely the excuse this check must not
   * accept. (Measured: with the duplicates in, a crate hanging 0.14 m over the
   * arena was waved through as "carried" by its own second copy.) */
  const propMeshes = new Set(world.props.map((p) => p.mesh).filter(Boolean));
  for (const child of world.scene.children) {
    if (!child.isObject3D || propMeshes.has(child)) continue;
    const maker = (child.userData && child.userData.__maker) || '?';
    const p = child.position;
    walk(child, maker + '|' + p.x.toFixed(4) + ',' + p.y.toFixed(4) + ',' + p.z.toFixed(4), maker);
  }
  for (const prop of world.props) {
    if (prop.mesh) walk(prop.mesh, 'prop:' + prop.id, (prop.mesh.userData && prop.mesh.userData.__maker) || ('make ' + prop.kind));
  }

  const done = [];
  for (const g of out) {
    if (!g.parts.length) continue;
    const m = measure(g.parts);
    if (!isFinite(m.minY)) continue;
    // the ground plane, the water and the horizon curtains ARE the view; they
    // are not things standing in it
    if (m.bx1 - m.bx0 > 150 || m.bz1 - m.bz0 > 150) continue;
    // a light fitting is a light. The hangar bolts its fixtures under the roof
    // trusses and the dojo hangs eight glass globes from a ceiling that is not
    // modelled at all (Dojo.js, 7.38 m up) — neither stands on anything and
    // neither ever will.
    const lamp = g.parts.some((p) => p.mat && p.mat.emissiveIntensity >= 2);
    done.push({ maker: g.maker, lamp, ...m });
  }
  return done;
}

/**
 * The highest thing under an assembly's contact patch: ground, or an object.
 *
 * An object only counts as support if it is under the middle of the patch —
 * see below. A level scatters three thousand scree chips, so almost anything
 * is within a few centimetres of something, and "there is a pebble beside one
 * corner" would excuse a crate hanging in the air, which is the exact bug
 * being measured.
 */
function seatOf(a, all, terrain) {
  let support = -Infinity, low = Infinity;
  if (terrain) {
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
      const h = terrain.height(a.cx0 + (a.cx1 - a.cx0) * i / 2, a.cz0 + (a.cz1 - a.cz0) * j / 2);
      if (h > support) support = h;
      if (h < low) low = h;
    }
  } else { support = 0; low = 0; }
  a.relief = support - low;
  /* Sampled over the MIDDLE HALF of the contact patch, not the whole of it and
   * not one point. Not the whole of it, because "a pebble beside one corner"
   * would excuse a crate hanging in the air. Not one point, because a live
   * crate on a stack straddles the 6 cm joint between the two under it — the
   * tiers are laid out on a different lattice as they narrow — and the exact
   * centre line can fall down that joint. */
  const mx = (a.cx0 + a.cx1) / 2, mz = (a.cz0 + a.cz1) / 2;
  const hx = (a.cx1 - a.cx0) * 0.25, hz = (a.cz1 - a.cz0) * 0.25;
  for (const b of all) {
    if (b === a || b.maxY <= support) continue;
    if (b.bx1 < mx - hx || b.bx0 > mx + hx || b.bz1 < mz - hz || b.bz0 > mz + hz) continue;
    const sx = b.G / Math.max(1e-6, b.bx1 - b.bx0), sz = b.G / Math.max(1e-6, b.bz1 - b.bz0);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const x = mx + i * hx, z = mz + j * hz;
      if (x < b.bx0 || x > b.bx1 || z < b.bz0 || z > b.bz1) continue;
      const gi = Math.min(b.G - 1, Math.max(0, ((x - b.bx0) * sx) | 0));
      const gj = Math.min(b.G - 1, Math.max(0, ((z - b.bz0) * sz) | 0));
      const h = b.top[gi * b.G + gj];
      if (h > support && h <= a.minY + 0.05) support = h;
      /* And a thing INSIDE another thing is not hanging in the air. A live
       * crate on a stack is jammed against its neighbours by up to 12 cm; that
       * is a crate stack, not a floating crate. Nothing over open ground is
       * ever inside anything, so this cannot excuse the bug being measured. */
      else if (h > a.minY + 0.05 && b.minY < a.minY && a.minY > support) support = a.minY;
    }
  }
  return a.minY - support;
}

/**
 * HOW MUCH OF AN ASSEMBLY'S FOOTING IS ACTUALLY ON THE GROUND — cell by cell,
 * and in BOTH directions.
 *
 * `seatOf` above is one number: the lowest vertex against the highest ground
 * under the patch. Two things follow from that shape and both of them shipped:
 *
 *   ONE-SIDED. The float check reads `if (r.seat <= TOL) continue`, so a prop
 *   4.9 m INSIDE the ground is not merely tolerated, it is invisible. The only
 *   burial bound in this file (`swallowed by the ground`) filters on
 *   `/^make/`, and every `addX` in Props.js — every wall, rail, arch, gantry
 *   and machine in the game — is outside it.
 *
 *   ONE SAMPLE. `max` over the patch means ANY part of it on something reads
 *   as seated. The Providence's bridge rail was 63% inside the deck and 30%
 *   in the air along its own line and reported a seat of −3.55 m; the
 *   Colosseum's gate arches stood on the podium wall six metres over the ramp
 *   they frame and reported −1.48 m.
 *
 * So: over the cells the assembly actually OCCUPIES (an empty cell is not a
 * footprint — the box round an arch is mostly the hole), and only the cells
 * whose underside is in the contact band, the ground is compared to the
 * underside HERE. `air` is the fraction hanging more than 30 cm clear, `sunk`
 * the fraction buried past what bedding into a slope can explain — which is
 * proportional to the prop's own height, exactly as the `swallowed` bound is,
 * because a 14 m arch cut through a wall is meant to have its piers in that
 * wall and a 1.1 m rail is not.
 */
export function footing(r, terrain) {
  const G = r.G, h = r.maxY - r.minY;
  const band = r.minY + Math.max(0.10, h * 0.12);
  const cw = (r.bx1 - r.bx0) / G, cd = (r.bz1 - r.bz0) / G;
  const deep = Math.max(0.30, h * 0.25);
  let n = 0, air = 0, sunk = 0, worstAir = 0, worstSunk = 0;
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const b = r.bot[i * G + j];
    if (!isFinite(b) || b > band) continue;
    const g = terrain ? terrain.height(r.bx0 + (i + 0.5) * cw, r.bz0 + (j + 0.5) * cd) : 0;
    const d = b - g;
    n++;
    if (d > 0.30) { air++; if (d > worstAir) worstAir = d; }
    else if (-d > deep) { sunk++; if (-d > worstSunk) worstSunk = -d; }
  }
  return { n, air: n ? air / n : 0, sunk: n ? sunk / n : 0, worstAir, worstSunk, deep };
}

/**
 * Is this assembly FIXED to another one? A thing is standing on something or
 * it is bolted to something — the hangar's roof trusses span between its walls
 * and its light fittings hang under the trusses.
 *
 * The other thing has to REACH this one, not merely brush its foot: `b` must
 * come up to at least the middle of `a`. A chip of rubble touching the bottom
 * corner of a floating crate is not holding it up.
 */
export function carried(a, all, slack = 0.06) {
  for (const b of all) {
    if (b === a) continue;
    if (b.bx1 + slack < a.bx0 || b.bx0 - slack > a.bx1) continue;
    if (b.bz1 + slack < a.bz0 || b.bz0 - slack > a.bz1) continue;
    if (b.maxY + slack < a.minY || b.minY - slack > a.maxY) continue;
    /* HOW HIGH IS EACH OF THEM *WHERE THEY MEET* — and until now this asked
     * both of them for a single maxY, which is the exact mistake `measure`
     * builds its 8 × 8 top grid to avoid and says so in its own note.
     *
     * The rule is unchanged in words: the other thing has to REACH this one
     * rather than brush its foot, so it must come up to the middle of it. What
     * changes is what "it" means. An assembly's global mid-height is the right
     * number for a crate and the wrong one for a RUN: the hangar strings two
     * 80 m cable runs down its long walls, and their 2.5 m of vertical extent
     * is nearly all SAG — the cable is 0.7 m thick and the rest of that number
     * is the dip between its anchors. Held against the global mid-height at
     * 6.75 m, the gantry the cable crosses (top rail 6.4 m, and the cable
     * passes through it) does not count; held against the cable where the two
     * actually meet, it plainly does.
     *
     * MEASURED over the nine levels, this changes exactly which assemblies:
     * see the check's own detail line, which now names every exemption. The
     * pebble case the rule exists for is untouched, because for a compact
     * object the local extent IS the global one: a 0.1 m chip against the
     * corner of a 0.8 m crate still has to reach 0.4 m and still does not. */
    const ox0 = Math.max(a.bx0, b.bx0), ox1 = Math.min(a.bx1, b.bx1);
    const oz0 = Math.max(a.bz0, b.bz0), oz1 = Math.min(a.bz1, b.bz1);
    const aTop = gridMax(a, ox0, ox1, oz0, oz1);
    const bTop = gridMax(b, ox0, ox1, oz0, oz1);
    // no surface of one of them over the ground they share: fall back to the
    // bounds, which is what this test used to do everywhere
    const aHigh = isFinite(aTop) ? Math.min(aTop, a.maxY) : a.maxY;
    const bHigh = isFinite(bTop) ? Math.max(bTop, b.minY) : b.maxY;
    if (bHigh + slack < a.minY + (aHigh - a.minY) * 0.5) continue;
    return b;
  }
  return null;
}

/** The highest surface of `r` over a patch of ground, off its own top grid. */
function gridMax(r, x0, x1, z0, z1) {
  const sx = r.G / Math.max(1e-6, r.bx1 - r.bx0), sz = r.G / Math.max(1e-6, r.bz1 - r.bz0);
  const bin = (v) => Math.min(r.G - 1, Math.max(0, v | 0));
  let hi = -Infinity;
  for (let i = bin((x0 - r.bx0) * sx); i <= bin((x1 - r.bx0) * sx); i++) {
    for (let j = bin((z0 - r.bz0) * sz); j <= bin((z1 - r.bz0) * sz); j++) {
      const h = r.top[i * r.G + j];
      if (h > hi) hi = h;
    }
  }
  return hi;
}

/**
 * The nearest assembly to `a`, and how far away it is — the diagnostic half of
 * the exemption above.
 *
 * "It is fixed to something" is the one excuse this check accepts, and until
 * now it was accepted SILENTLY: the pass line said nothing about how many
 * assemblies were being waved through on it or what was holding them up. Four
 * conduit runs on the warship were reported to a later session as floating,
 * and answering that took a probe, because the check that had already decided
 * they were fine could not say what it thought was carrying them. It says now.
 */
export function nearestTo(a, all) {
  let best = null, bd = Infinity;
  for (const b of all) {
    if (b === a) continue;
    const dx = Math.max(0, Math.max(b.bx0 - a.bx1, a.bx0 - b.bx1));
    const dz = Math.max(0, Math.max(b.bz0 - a.bz1, a.bz0 - b.bz1));
    const dy = Math.max(0, Math.max(b.minY - a.maxY, a.minY - b.maxY));
    const d = Math.hypot(dx, dy, dz);
    if (d < bd) { bd = d; best = b; }
  }
  return { at: best, d: bd };
}

/**
 * THE SEATING RULE ITSELF, in one place, because it has TWO callers now.
 *
 * A thing is either STANDING on something or FIXED to something; `carried` is
 * the second half and `seat` the first. Extracted when the generated-ground
 * clause was added — a second copy of "seat > TOL and nothing is carrying it"
 * is HANDOFF §2.4 exactly, an instrument restating a rule until the two
 * disagree, and the two would have had to be edited together forever.
 *
 * `lamp` assemblies are dropped by both callers for the reason the first one
 * gives: a light fitting is bolted under a truss and is not standing on
 * anything at all.
 */
export const SEAT_TOL = 0.05;
export function standing(rows) {
  const ground = rows.filter((r) => !r.lamp);
  const bad = [];
  const fixed = [];
  for (const r of ground) {
    if (r.seat <= SEAT_TOL) continue;
    const by = carried(r, rows);
    if (by) { fixed.push([r, by]); continue; }
    bad.push(r);
  }
  bad.sort((a, b) => b.seat - a.seat);
  fixed.sort((a, b) => b[0].seat - a[0].seat);
  return { ground, bad, fixed };
}

let SEATED = null;
/**
 * Dress every level once and measure how everything in it sits.
 *
 * Exported so a probe can ask this survey a question instead of building a
 * second one: `tools/_seating.mjs` prints what the checks below only assert
 * on, and a copy of the survey would be a copy of the seating rule with it.
 */
export function seating(groundFor = null) {
  if (SEATED && !groundFor) return SEATED;
  /* A CALLER MAY NAME THE GROUND. `groundFor(key, L)` returns the terrain
   * preset the level's dressing is to be measured on, defaulting to the one
   * the level authored. THE LINE raises a GENERATED heightfield under the same
   * dressing (`World._groundKeyFor`), so "does this prop stand on the ground"
   * has a second answer per level and this survey is the only thing that can
   * give it. A named ground is never cached: the preset table is mutable and
   * a generated row is installed and removed around the call. */
  const out = new Map();
  P.propMaterials();
  for (const key of LEVEL_ORDER) {
    const L = LEVELS[key];
    if (!L || typeof L.dress !== 'function') continue;
    const ground = groundFor ? groundFor(key, L) : L.terrain;
    if (!ground) continue;
    const terrain = new Terrain(new THREE.Scene(), ground, 0.5);
    const world = stubWorld(terrain, L);
    /* The level's OWN cover field, built the way World.loadLevel builds it and
     * BEFORE dress(), because the stone drifts bias themselves away from it —
     * dressing first would survey a layout the game never produces. */
    const grass = L.grass ? new GrassField(new THREE.Scene(), terrain, { count: 3000, density: L.grass, radius: 46 }) : null;
    L.dress(world);
    const all = assemblies(world);
    const rows = [];
    // seat FIRST: seatOf also records the ground relief under the contact
    // patch, and a spread evaluated before the call would not carry it
    for (const a of all) { const seat = seatOf(a, all, terrain); rows.push({ ...a, seat }); }
    out.set(key, rows);
    grass?.dispose();
    terrain.dispose();
  }
  if (groundFor) return out;
  SEATED = out;
  return SEATED;
}

/* ── the downward-ray survey ─────────────────────────────────────────── */
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * Drop a jittered grid of vertical rays through a whole assembly and report
 * the columns where the top of it is not there.
 *
 * Whole assembly, not one mesh: a hole in one mesh is legitimately covered by
 * another (a vaporator's head sits over the open top of its stem). Jittered
 * inside each cell because a column landing exactly on a wall's face plane
 * grazes it, and a graze is not a hole — an unjittered 44 × 44 grid on a
 * broken wall put 39 columns exactly on z = ±0.35 and called all of them bad.
 */
function seeThrough(meshes, N = 44) {
  const bb = new THREE.Box3();
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    m.geometry.computeBoundingBox();
    bb.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld));
  }
  const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z;
  if (!(w > 1e-6 && d > 1e-6)) return { cols: 0, bad: 0, worst: 0 };
  const hash = (i, j, k) => { const t = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return 0.18 + 0.64 * (t - Math.floor(t)); };
  const cx = (i, j) => bb.min.x + (i + hash(i, j, 1)) * w / N;
  const cz = (i, j) => bb.min.z + (j + hash(i, j, 2)) * d / N;
  const cell = new Map();
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position, index = mesh.geometry.index;
    const nTri = index ? index.count / 3 : pos.count / 3;
    const M = mesh.matrixWorld;
    const dbl = !!(mesh.material && mesh.material.side === THREE.DoubleSide);
    for (let t = 0; t < nTri; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      _a.fromBufferAttribute(pos, i0).applyMatrix4(M);
      _b.fromBufferAttribute(pos, i1).applyMatrix4(M);
      _c.fromBufferAttribute(pos, i2).applyMatrix4(M);
      const ux = _b.x - _a.x, uy = _b.y - _a.y, uz = _b.z - _a.z;
      const vx = _c.x - _a.x, vy = _c.y - _a.y, vz = _c.z - _a.z;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-12) continue;
      const nyn = ny / len;
      // Only a numerical guard. A HIGHER cut here is a trap: drop the
      // near-vertical walls of a cone and the flat disc closing its base
      // becomes the "topmost" surface in the ring of columns just inside its
      // rim — which is how a perfectly sound makeSpire came back with 22 bad
      // columns of 1473. Whether a crossing is a lid is decided below.
      if (Math.abs(nyn) < 0.002) continue;
      const gx = (x) => Math.min(N - 1, Math.max(0, Math.floor((x - bb.min.x) / w * N)));
      const gz = (z) => Math.min(N - 1, Math.max(0, Math.floor((z - bb.min.z) / d * N)));
      const i0g = gx(Math.min(_a.x, _b.x, _c.x)), i1g = gx(Math.max(_a.x, _b.x, _c.x));
      const j0g = gz(Math.min(_a.z, _b.z, _c.z)), j1g = gz(Math.max(_a.z, _b.z, _c.z));
      const den = (_b.z - _c.z) * (_a.x - _c.x) + (_c.x - _b.x) * (_a.z - _c.z);
      if (Math.abs(den) < 1e-12) continue;
      for (let i = i0g; i <= i1g; i++) for (let j = j0g; j <= j1g; j++) {
        const px = cx(i, j), pz = cz(i, j);
        const l1 = ((_b.z - _c.z) * (px - _c.x) + (_c.x - _b.x) * (pz - _c.z)) / den;
        const l2 = ((_c.z - _a.z) * (px - _c.x) + (_a.x - _c.x) * (pz - _c.z)) / den;
        if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
        const y = l1 * _a.y + l2 * _b.y + (1 - l1 - l2) * _c.y;
        const k = i * N + j;
        let arr = cell.get(k); if (!arr) cell.set(k, arr = []);
        arr.push({ y, ny: nyn, dbl });
      }
    }
  }
  let cols = 0, bad = 0, worst = 0, at = '';
  for (const [k, arr] of cell) {
    cols++;
    arr.sort((p, q) => q.y - p.y);
    /* A "top" has to be a top. −0.25 is 75° from horizontal, so anything
     * steeper than that is a wall being grazed at its silhouette and not a lid
     * — makeSpire's leaning, wasp-waisted lathe threw exactly one such column
     * in 1481 at ny = −0.13. Every inversion this check was written for sits at
     * −0.6 to −1.0: an upside-down fan cap points straight down. */
    if (arr.length < 2 || arr[0].ny >= -0.25 || arr[0].dbl) continue;
    let vis = null;
    for (const c of arr) if (c.ny > 0 || c.dbl) { vis = c; break; }
    /* Nothing visible at all means you see clean through, so the drop is to
     * the far side. Writing it that way instead of as an infinity is what
     * makes the 5 cm floor do its job on a GRAZE: a ray tangent to the widest
     * ring of a bulging lathe crosses two near-vertical faces a millimetre
     * apart and neither of them faces up, which is a silhouette and not a
     * hole. One column in 20360 on makeSpire, and it moved with the seed. */
    const sink = vis ? arr[0].y - vis.y : arr[0].y - arr[arr.length - 1].y;
    if (sink <= 0.05) continue;
    bad++;
    const s = isFinite(sink) ? sink : 1e6;
    if (s > worst) {
      worst = s;
      const i = (k / N) | 0, j = k % N;
      at = `(${cx(i, j).toFixed(2)}, ${arr[0].y.toFixed(2)}, ${cz(i, j).toFixed(2)}) ny=${arr[0].ny.toFixed(2)} depth=${arr.length}`;
    }
  }
  return { cols, bad, worst, at };
}

/** Every maker in Props.js, built once, on its own. */
function catalogue() {
  const w = () => {
    const scene = new THREE.Scene();
    return {
      scene, statics: [], props: [], debris: [], doors: [], levelLights: [],
      terrain: { height: () => 0, slopeAt: () => 0, inBounds: () => true }, particles: null,
      physics: { staticBoxes: [], bodies: [], addStaticBox() { return {}; }, removeStaticBox() {}, add() {}, remove() {} },
      addProp(p) { this.props.push(p); return p; }, spawnDebris() {}, notify() {},
    };
  };
  return [
    ['addWall', (o) => P.addWall(o, V(0, 2, 0), V(9, 4, 1))],
    ['addColumn', (o) => P.addColumn(o, V(0, 0, 0))],
    ['addColumn broken', (o) => P.addColumn(o, V(0, 0, 0), { size: 'L', standing: 0.55 })],
    ['addArch', (o) => P.addArch(o, V(0, 0, 0), { span: 5 })],
    ['addArch broken', (o) => P.addArch(o, V(0, 0, 0), { span: 8, broken: 0.3 })],
    ['addLintel', (o) => P.addLintel(o, V(0, 4, 0), { length: 6 })],
    ['addButtress', (o) => P.addButtress(o, V(0, 0, 0))],
    ['addBrokenWall', (o) => P.addBrokenWall(o, V(0, 0, 0), V(10, 6, 0.7), { ruin: 0.5 })],
    ['addBrokenWall openings', (o) => P.addBrokenWall(o, V(0, 0, 0), V(10, 6, 0.7), {
      ruin: 0.4, openings: [{ x: -3, y: 0, w: 1.5, h: 2.8, arched: true }, { x: 3, y: 1.6, w: 1.6, h: 1.6 }] })],
    ['addStair', (o) => P.addStair(o, V(0, 0, 0), { steps: 8, railing: true })],
    ['addRailing', (o) => P.addRailing(o, V(0, 0, 0), { length: 6 })],
    ['addPlinth', (o) => P.addPlinth(o, V(0, 0, 0))],
    ['addBalcony', (o) => P.addBalcony(o, V(0, 4, 0))],
    ['addFloorSlab', (o) => P.addFloorSlab(o, V(0, 0, 0), V(16, 12))],
    ['addColossus', (o) => P.addColossus(o, V(0, 0, 0))],
    ['addRuinedGate', (o) => P.addRuinedGate(o, V(0, 0, 0))],
    ['addHullSection', (o) => P.addHullSection(o, V(0, 8, 0))],
    ['addGantry', (o) => P.addGantry(o, V(0, 0, 0))],
    ['addMachine', (o) => P.addMachine(o, V(0, 0, 0), { light: true })],
    ['addMachine wide', (o) => P.addMachine(o, V(0, 0, 0), { width: 6.5, height: 4.4, depth: 3.6 })],
    ['addTank', (o) => P.addTank(o, V(0, 0, 0))],
    ['addTank squat', (o) => P.addTank(o, V(0, 0, 0), { radius: 3.4, height: 3.2 })],
    ['addStanchion', (o) => P.addStanchion(o, V(0, 0, 0), { lamp: true, light: true })],
    ['addRock', (o) => P.addRock(o, V(0, 1, 0), V(1.6, 1.2, 1.5), 3)],
    ['addOutcrop', (o) => P.addOutcrop(o, V(0, 0, 0), { size: 7 })],
    ['addRockArch', (o) => P.addRockArch(o, V(0, 0, 0))],
    ['addBoulderCluster', (o) => P.addBoulderCluster(o, V(0, 0, 0), { count: 14, size: 1.3 })],
    ['addScree', (o) => P.addScree(o, V(0, 0, 0), { radius: 10, count: 60 })],
    ['addPipeRun', (o) => P.addPipeRun(o, [V(0, 3, 0), V(8, 3.2, 0), V(16, 2.6, 2)], { count: 3 })],
    ['addCableRun', (o) => P.addCableRun(o, V(0, 8, 0), V(20, 7, 0), { count: 4 })],
    /* A crowd is instanced and its figures are 1 m tall, so the see-through
     * surveys below rasterise it at the same resolution as a crate — which is
     * the right test: a spectator with a hole in its top is a spectator with a
     * hole in its top. `onGround: false` because this stub's terrain is a
     * plane and the seating ladder is what is being built. */
    ['addCrowd', (o) => P.addCrowd(o, V(0, 0, 0), { rows: 4, rmin: 4, rmax: 9, rise: 0.9,
      y0: 0.2, pitch: 1.2, onGround: false })],
    ['addCrateStack', (o) => P.addCrateStack(o, V(0, 0, 0))],
    ['addTarp', (o) => P.addTarp(o, V(0, 0, 0))],
    ['addScaffold', (o) => P.addScaffold(o, V(0, 0, 0))],
    ['addAntenna', (o) => P.addAntenna(o, V(0, 0, 0))],
    ['addLamp', (o) => P.addLamp(o, V(0, 0, 0), { light: true })],
    ['addSign', (o) => P.addSign(o, V(0, 0, 0))],
    ['addDebrisField', (o) => P.addDebrisField(o, V(0, 0, 0), { radius: 9 })],
    ['addRuin', (o) => P.addRuin(o, V(0, 0, 0), { size: 'large', pipes: true })],
    ['addOutpost', (o) => P.addOutpost(o, V(0, 0, 0))],
    ['makeCrate', (o) => o.addProp(P.makeCrate(o, V(0, 0, 0), 0.7))],
    ['makeBarrel', (o) => o.addProp(P.makeBarrel(o, V(0, 0, 0)))],
    ['makePillar', (o) => o.addProp(P.makePillar(o, V(0, 0, 0)))],
    ['makeVaporator', (o) => o.addProp(P.makeVaporator(o, V(0, 0, 0)))],
    ['makeSpire', (o) => o.addProp(P.makeSpire(o, V(0, 0, 0), 6))],
    ['makeConsole', (o) => o.addProp(P.makeConsole(o, V(0, 0, 0)))],
    ['BlastDoor', (o) => new P.BlastDoor(o, { position: V(0, 2.6, 0) })],
  ].map(([name, fn]) => {
    const world = w();
    fn(world);
    const meshes = [];
    world.scene.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) meshes.push(o); });
    for (const p of world.props) if (p.mesh) p.mesh.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) meshes.push(o); });
    return { name, meshes };
  });
}

/**
 * The catalogue has to name EVERY maker, or a prop added next year is not
 * covered by anything above. Checked against the module's own exports rather
 * than against a list somebody has to remember to extend.
 */
const NOT_A_MAKER = new Set([
  'propMaterials', 'uvm', 'scaleUv', 'boxUv', 'tubeUv', 'triplanarUv', 'tessellate', 'weatherGeo',
  'weatherStats', 'paintGeo', 'mergeGeos', 'extrudeBeveled', 'slabGeo', 'catenaryPoints', 'cylGeo',
  'torusGeo', 'tubeAlong', 'pipeBetween', 'brokenEdge', 'strataTint', 'addStatic', 'seatOnGround',
  'Kit', 'Prop', 'rockGeo', 'addInstanced', 'ROCK_TILE', 'TEXEL_BAND', 'WEAR', 'ARCH',
  /* `addStorm` emits no geometry at all — it is one directional light and a
   * schedule of when to turn it on — so there is nothing for a see-through
   * survey to look through. It is in this list for the same reason
   * `addInstanced` is: the name matches the maker pattern and the thing does
   * not make a prop. */
  'addStorm',
]);

function pct(a, p) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

export function run({ check, assert }) {

  /* ══ everything stands on something ══════════════════════════════════ */

  check('props: nothing floats — every prop rests on what is under it', () => {
    /* THE measurement the report is about. Per assembly: its lowest vertex
     * minus the highest thing under its contact patch, where "thing" is the
     * terrain or another assembly's top, because a crate on a stack stands on
     * the stack and not on the sand a metre below it.
     *
     * BEFORE, worst seat per maker over the nine levels:
     *     makeCrate +0.14   makeBarrel +0.09   makeVaporator +0.07
     *     addCrateStack (its live top crates) +2.03   addAntenna +0.72 at the
     *     guy anchors   hangar light fittings +0.40 under their own truss
     * AFTER: nothing that stands on the ground is off its support at all. The
     * 99th percentile seat runs −0.01 to −0.07 m on every level, and the only
     * positive numbers left in the detail line below belong to things the
     * exemption covers: a hangar roof truss and a ribcage of wreck frames
     * leaning on each other.
     *
     * The exemption is stated rather than hidden: a thing is either standing
     * on something or FIXED to something. A roof truss spans between the
     * hangar's walls and touches them; a lamp fitting is bolted under a truss.
     * Anything that touches no other assembly at all has to be standing. */
    const lines = [];
    /* EVERY LEVEL IS RAISED TOGETHER. This used to `assert` inside the loop, so
     * the first theatre to fail was the only one anybody ever saw — and that is
     * not academic here: alpine's one crate hid four floating conduit runs on
     * the warship for as long as it stood, and fixing alpine is what revealed
     * them. HANDOFF §6.1b has the same lesson from `cel`, where one message was
     * two failures and the second had been red the whole time. */
    const failed = [];
    for (const [key, rows] of seating()) {
      const { ground, bad, fixed } = standing(rows);
      const seats = ground.map((r) => r.seat);
      /* EVERY EXEMPTION, NAMED. `fixed` is the whole of the reason this check
       * passes on a level with a ten-metre positive seat in it, so it belongs
       * in the pass line: what is off the ground, and what the check believes
       * is holding it. A silent exemption is a hole nobody can audit. */
      /* AND THE DEEPEST, because this bound is ONE-SIDED and will stay that
       * way: `seat <= TOL` cannot see a prop inside the ground, and the only
       * burial bound in this file filters on `/^make/`. Reporting the minimum
       * beside the maximum is what makes a −3.55 m rail visible to a reader
       * of the pass line at all; the assertion on it is the run check above. */
      lines.push(`${key} n=${rows.length} p50=${pct(seats, 0.5).toFixed(2)} p99=${pct(seats, 0.99).toFixed(2)} worst=${Math.max(...seats).toFixed(2)} deepest=${Math.min(...seats).toFixed(2)}`
        + (fixed.length ? `, ${fixed.length} fixed to something (worst ${fixed[0][0].maker} +${fixed[0][0].seat.toFixed(1)} m on ${fixed[0][1].maker})` : ''));
      if (bad.length) {
        failed.push(`${key}: ${bad.length} of ${ground.length} assemblies stand on nothing — `
          + bad.slice(0, 4).map((b) => {
            const n = nearestTo(b, rows);
            return `${b.maker} +${b.seat.toFixed(2)} m at (${b.cx0.toFixed(0)}, ${b.minY.toFixed(1)}, ${b.cz0.toFixed(0)}), `
              + `nearest ${n.at ? n.at.maker : 'nothing'} ${n.d.toFixed(2)} m away`;
          }).join('; '));
      }
    }
    /* THE WHOLE TABLE, PASS OR FAIL. A failure used to throw away the per-level
     * detail — the very numbers that say whether the level that failed is the
     * only one near the line — and the next reader had to re-run the survey by
     * hand to get them back. */
    assert(failed.length === 0, failed.join('\n    ') + '\n    ' + lines.join('; '));
    return lines.join('; ');
  });

  /* ══ …AND ON THE GROUND THE FLAGSHIP MODE ACTUALLY PLAYS ON ═════════ */

  check('props: a room that declares a generated ground still stands its dressing on it', () => {
    /**
     * EVERY SURVEY ABOVE THIS LINE MEASURES A HEIGHTFIELD THE LINE DOES NOT USE.
     *
     * `World._groundKeyFor` installs a `front:<terrain>` preset off the run
     * seed for any mode declaring `generatedGround` — THE LINE does — on any
     * level declaring `battlefield`, and then raises THE SAME DRESSING on it.
     * `LEVELS[*].battlefield` is the room's own statement that it survives
     * that, and until this clause the only thing measuring the statement was
     * `theline.mjs`, which asks whether ten men are still standing after twenty
     * seconds. That is a gameplay bar. It is not a bar on the picture, and the
     * two came apart on the one room whose ARCHITECTURE IS ITS HEIGHTFIELD:
     *
     *     colosseum, seeds 1/3/7, forced on
     *       authored    7921 assemblies, p99 seat −0.04 m, worst  0.00 m
     *       generated   7921 assemblies, p99 seat  0.00 m, worst 27.97 m
     *                   31–33 of them standing on nothing, all but one a
     *                   praecinctio, hanging 16 m and 27 m over open ground
     *
     * The cause is one line of the level and it is not a bug in the level: the
     * cavea IS the heightfield (`LEVELS.colosseum.dress` says so in those
     * words, beside the crowd it seats off `T.height`). The authored ground
     * climbs 0 → 54.1 m between the sand and the arcade; the generated one
     * climbs 0 → 13.1 m, an RMS difference of 41.2 m over the fight disc — the
     * largest of the seven by a factor of two — so the two dividing walls that
     * ride the bank stay at the height the bank used to be and seven thousand
     * spectators sit in rings on an open plain. The room passes the men-
     * standing bar at 10 of 10 the whole time.
     *
     * So the bar this file owns is the second one, and the fix was the room's
     * declaration — see `LEVELS.colosseum.battlefield` for the note.
     *
     * TWO SEEDS AND NOT ONE. The height is a roll: seed 1 hung 31 assemblies
     * and seed 7 hung 33, and a single seed is a sample of a distribution this
     * clause is trying to bound. Not more than two, because each one dresses
     * every declaring level again and the colosseum alone is 7 921 assemblies.
     */
    const SEEDS = [1, 3];
    const lines = [];
    const failed = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      /* BOTH DIRECTIONS, so `battlefield` is a measured fact and not a hand-
       * maintained table beside its generated twin (HANDOFF §2.3). A room that
       * says `true` has to stand its dressing; a room that says `false` has to
       * fail to, or the `false` is a room quietly dropping out of the mode's
       * ground roll for no reason anybody can see. */
      const declared = !!L?.battlefield;
      let seated = 0;
      for (const seed of SEEDS) {
        /* THE SAME TWO NUMBERS THE GAME HANDS IN, and they are not decoration:
         * `deploy` is where the shelf that stands a borrowed sea is measured
         * from, and scoria opens 71 m off the origin. Restating the call site
         * with different arguments would measure a ground nobody plays. */
        let made = null;
        try {
          made = battlefieldGround(L.terrain, seed, { deploy: L.start, keep: L.spawnRadius?.[1] });
        } catch (err) {
          /* THE GENERATOR'S OWN REFUSAL IS A REASON, and it is the one
           * `battlefieldGround` already documents: a floor with a roof over it
           * cannot carry a front. A room on such a ground is entitled to
           * `false` without this survey having anything to say. */
          lines.push(`${key}@${seed} refused: ${err.message}`);
          if (declared) failed.push(`${key} declares \`battlefield\` and the generator refuses its ground: ${err.message}`);
          seated = -1;
          continue;
        }
        installGround(made.key, made.preset);
        try {
          const rows = seating((k) => (k === key ? made.key : null)).get(key) || [];
          const { ground, bad, fixed } = standing(rows);
          const seats = ground.map((r) => r.seat);
          if (!bad.length) seated++;
          lines.push(`${key}@${seed} ${declared ? 'declares' : 'authored'} n=${rows.length} `
            + `p99=${pct(seats, 0.99).toFixed(2)} worst=${Math.max(...seats).toFixed(2)} `
            + `loose=${bad.length}${fixed.length ? ` (${fixed.length} fixed)` : ''}`);
          if (declared && bad.length) {
            failed.push(`${key} declares \`battlefield\` and on its generated ground at seed ${seed} `
              + `${bad.length} of ${ground.length} assemblies stand on nothing — `
              + bad.slice(0, 3).map((b) => `${b.maker} +${b.seat.toFixed(2)} m at `
                + `(${b.cx0.toFixed(0)}, ${b.minY.toFixed(1)}, ${b.cz0.toFixed(0)})`).join('; '));
          }
        } finally {
          /* HANDOFF §2.9. `TERRAIN_PRESETS` is a module singleton and a row
           * left in it is a ground nobody authored, handed to every later
           * suite in the process — and `installGround` would then throw on
           * the next seed of the same room rather than on the leak. */
          removeGround(made.key);
        }
      }
      if (!declared && seated === SEEDS.length) {
        failed.push(`${key} declares \`battlefield: false\` and its dressing seats cleanly on a `
          + `generated ground at every one of ${SEEDS.join(', ')} — the room is keeping its authored `
          + 'contours for no reason this survey can see, which costs the mode a seventh of its ground roll');
      }
    }
    assert(failed.length === 0, failed.join('\n    ') + '\n    ' + lines.join('; '));
    return lines.join('; ');
  });

  check('props: a gate arch stands IN its gate, not on the wall beside it', () => {
    /**
     * ALL FOUR OF THE COLOSSEUM'S GATE ARCHES STOOD SIX METRES OVER THE RAMP
     * THEY FRAME, and every check in this file passed them — correctly, on
     * its own terms: an arch standing on top of a wall IS resting on the wall.
     *
     * The level placed each one at `(cos a · 66, sin a · 49)`, a point on the
     * podium ELLIPSE, while `TERRAIN_PRESETS.colosseum` cuts each gate on a
     * CIRCULAR bearing — `smoothstep(0.075, 0.0, |atan2(z, x) − a|)`, exactly
     * zero past 0.075 rad. An ellipse's parametric angle is not its compass
     * bearing, and the four came out 0.0788–0.0998 rad off: outside their own
     * cut, on terrain at 4.76–5.05 m over a ramp floor of 1.76–2.24 m, 6.0–6.4
     * m sideways of the ramp. The render showed the crowd THROUGH the span and
     * behind both piers.
     *
     * The property that failed is not seating, it is that A GATE IS THE LOW
     * GROUND ALONG THE WALL IT IS CUT THROUGH: a hole through a rampart is the
     * lowest thing on the rampart, whatever shape the rampart is in plan. So
     * this sweeps 14 m either way along the arch's own TANGENT — the wall's
     * local direction, perpendicular to the radius — and asks how far the
     * ground under the arch stands above the lowest ground on that line.
     *
     * The tangent and not the ring, and the difference is the whole reason
     * this is measurement rather than a restatement: the podium is an ELLIPSE,
     * so a circle at the arch's radius leaves the wall entirely on the short
     * axis and finds the arena sand 19 m away. The tangent stays on the
     * structure the arch is standing in. Nothing here reads the preset's
     * arithmetic, so if the cut moves this follows it (HANDOFF §2.4).
     *
     * Measured: 0.00–0.30 m over the floor of its own ramp on all four now,
     * against 2.82–3.08 m before, with the ramp 6.0–6.5 m to the side.
     *
     * Every arch on every level, not just this one: an arch is a hole through
     * something by definition, and a level that stands one on a bank has drawn
     * a doorway into a wall.
     */
    const rows = [];
    for (const [key, all] of seating()) {
      const arches = all.filter((r) => r.maker === 'addArch');
      if (!arches.length) continue;
      const terrain = new Terrain(new THREE.Scene(), LEVELS[key].terrain, 0.5);
      for (const r of arches) {
        const x = (r.cx0 + r.cx1) / 2, z = (r.cz0 + r.cz1) / 2;
        const rad = Math.hypot(x, z), a = Math.atan2(z, x);
        if (rad < 8) continue;                       // an arch at the middle stands in no wall
        let lowest = Infinity, at = 0;
        for (let d = -14; d <= 14; d += 0.25) {
          const h = terrain.height(x - Math.sin(a) * d, z + Math.cos(a) * d);
          if (h < lowest) { lowest = h; at = d; }
        }
        const over = terrain.height(x, z) - lowest;
        rows.push(`${key} ${(a * 57.3).toFixed(0)}° +${over.toFixed(2)} m`);
        assert(over < 1.0,
          `${key}: a gate arch at (${x.toFixed(0)}, ${z.toFixed(0)}) stands ${over.toFixed(2)} m above the `
          + `lowest ground along its own wall, ${Math.abs(at).toFixed(1)} m to the side of it — `
          + 'the arch is on the wall and the gate it frames is somewhere else');
      }
      terrain.dispose();
    }
    assert(rows.length >= 4, `${rows.length} arches surveyed — the sweep has stopped matching them`);
    return `height over the floor of their own ramp: ${rows.join(', ')}`;
  });

  check('props: a run is on the ground for its whole length, not at the one point the level sampled', () => {
    /* THE OTHER HALF OF `nothing floats`, and the reason two of these shipped.
     *
     * That check reads `if (r.seat <= TOL) continue` — one-sided — and `seat`
     * is a single `max` over the contact patch, so an assembly is passed the
     * moment ANY part of it is on ANYTHING. Both halves failed on the same
     * prop: `addRailing(world, at(-26, -40), { length: 52, yaw: π/2 })` took
     * ONE terrain sample and ran 52 m of rail off it, across a 5.4 m ramp and
     * through a 9.0 m bulkhead pier. 63% of it was inside the deck and 30% was
     * hanging up to 2.0 m in the air, and `nothing floats` reported its seat
     * as −3.55 m and said nothing, because inside the ground is under the
     * bound and the pier it crossed was the `max`.
     *
     * A RUN is where that failure is invisible and unavoidable: long in plan,
     * thin across, so its underside is a straight LINE and any relief along it
     * shows. `footing` measures the ground against the assembly's own
     * underside cell by cell, in both directions.
     *
     * THE THREE FILTERS ARE DERIVED, not tastes:
     *   6 m by 2.5 m — under 6 m the survey fills with rock walls, sastrugi
     *   and boulder clusters, whose undersides are modelled to bed into a
     *   slope and legitimately run 30-60% buried;
     *   ON THE GROUND — the assembly's own base within a metre of the terrain
     *   under its centre, i.e. a level put it on the heightfield. The ship's
     *   wall conduit rides at 12 m and was never on the ground;
     *   NOT CARRIED — the same exemption `nothing floats` grants, unchanged.
     * The Providence's rail is caught by all three and by nothing else in
     * this file. */
    const RUNS = [];
    const failed = [];
    for (const [key, rows] of seating()) {
      const terrain = new Terrain(new THREE.Scene(), LEVELS[key].terrain, 0.5);
      for (const r of rows) {
        if (r.lamp) continue;
        const long = Math.max(r.cx1 - r.cx0, r.cz1 - r.cz0);
        const short = Math.min(r.cx1 - r.cx0, r.cz1 - r.cz0);
        if (long < 6 || short > 2.5) continue;
        if (Math.abs(r.minY - terrain.height((r.cx0 + r.cx1) / 2, (r.cz0 + r.cz1) / 2)) > 1.0) continue;
        const f = footing(r, terrain);
        if (f.n < 4 || carried(r, rows)) continue;
        RUNS.push(`${key} ${r.maker} ${long.toFixed(0)} m: ${(f.air * 100).toFixed(0)}% clear / `
          + `${(f.sunk * 100).toFixed(0)}% under`);
        if (f.air > 0.10 || f.sunk > 0.10) {
          failed.push(`${key}: ${r.maker} runs ${long.toFixed(0)} m at (${r.cx0.toFixed(0)}, ${r.cz0.toFixed(0)}) `
            + `with ${(f.air * 100).toFixed(0)}% of its footing more than 0.3 m clear of the ground `
            + `(worst ${f.worstAir.toFixed(2)} m) and ${(f.sunk * 100).toFixed(0)}% more than `
            + `${f.deep.toFixed(2)} m inside it (worst ${f.worstSunk.toFixed(2)} m)`);
        }
      }
      terrain.dispose();
    }
    /* THE SIZE TRIPWIRE WAS `RUNS.length >= 2` AND IT IS NOW A REPORT, because
     * the two rails it counted were both on the Providence's bridge and the
     * Providence has been deleted at the player's request. The whole census is
     * zero: no level in the shipped roster builds a long thin run that stands
     * on open ground.
     *
     * A floor of 2 against a census of 0 is a check that can only fail, and a
     * check that can only fail gets deleted or ignored — neither of which
     * keeps the rule. A floor of 0 is the §2.3 defect, a sweep reporting clean
     * for having measured nothing. So the count goes in the PASS LINE instead:
     * an empty census says so out loud every run, and the moment a level
     * authors a rail on open ground the failure arm below is live again with
     * nothing to re-enable. */
    assert(!failed.length, failed.join('\n    ') + '\n    ' + RUNS.join('; '));
    if (!RUNS.length) {
      return 'NO LEVEL BUILDS A RUN ON OPEN GROUND — the census was the Providence\'s two bridge '
        + 'rails and that level is deleted; the footing rule is unexercised until one is authored';
    }
    return RUNS.join('; ');
  });

  check('props: what "fixed to something" will and will not excuse', () => {
    /* THE EXEMPTION, PINNED FROM BOTH SIDES — because it is the one way an
     * assembly can be a metre in the air and still pass, and because it was
     * loosened once already (see `carried`) to let a cable run count the
     * gantry it crosses. A rule that can be loosened silently is a rule that
     * will be, so the case it exists to refuse is a check of its own now.
     *
     * Both scenes are built out of real meshes and measured by the same
     * `assemblies` the levels go through, so this cannot pass by describing
     * the rule differently from the way the survey applies it. */
    const scene = (boxes) => {
      const sc = new THREE.Scene();
      for (const [w, h, d, x, y, z] of boxes) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
        m.position.set(x, y + h / 2, z);
        sc.add(m);
      }
      return assemblies({ scene: sc, props: [] });
    };
    // a 0.8 m crate hanging 1 m up, with a 0.1 m chip standing against the
    // bottom corner of it: the chip is not holding it up
    const chip = scene([[0.8, 0.8, 0.8, 0, 1.0, 0], [0.1, 0.1, 0.1, 0.44, 0.96, 0.44]]);
    assert(chip.length === 2, `the scene did not survey: ${chip.length} assemblies`);
    const crate = chip.find((r) => r.maxY - r.minY > 0.5);
    assert(!carried(crate, chip), 'a 0.1 m chip against its corner counts as holding up a floating crate');
    // the same crate against a post that comes up past the middle of it
    const post = scene([[0.8, 0.8, 0.8, 0, 1.0, 0], [0.3, 1.5, 0.3, 0.5, 0, 0]]);
    const crate2 = post.find((r) => r.maxY - r.minY < 1.0 && r.maxY - r.minY > 0.5);
    assert(carried(crate2, post), 'a post reaching past its mid-height does not count as holding a crate');
    // and a long thin run whose one crossing support reaches it locally, which
    // is the hangar's cable over its gantry in miniature: 12 m of 0.2 m rail
    // hung at 3 m, one 3.1 m post touching it a third of the way along
    const run = scene([[0.2, 0.2, 12, 0, 3.0, 0], [0.4, 3.1, 0.4, 0, 0, -4]]);
    const rail = run.find((r) => r.bz1 - r.bz0 > 5);
    assert(carried(rail, run), 'a post standing under a rail and touching it does not count as holding it');
    return 'chip refused, post accepted, one crossing support under a 12 m run accepted';
  });

  check('props: a cable run is BOLTED at both ends, not hung from the air', () => {
    /* THE HOLE IN THE CHECK ABOVE, MEASURED FROM THE OTHER END.
     *
     * `carried` asks whether ANY part of an assembly touches something that
     * comes up to it, and for a catenary that is the wrong part. A cable run
     * is 80 m of rope between two 0.3 m bracket slabs: the brackets are the
     * only thing on it that is fixed to anything, and its belly is the only
     * thing `seatOf` looks at. So a run could pass both — belly excused by
     * whatever it happens to cross in the middle, brackets bolted to nothing —
     * and one did. MEASURED on the shipped hangar before this clause existed:
     *
     *   bracket                    nearest assembly of ANY kind, in 3D
     *   (±62, 8.1, ∓40)            3.15 to 4.71 m
     *   warship (±49, 11.9, −30)   1.32 m, and it was the ROOF, above it
     *
     * Both runs were excused all the same, the hangar's by the gantry it
     * crossed at z = −14 — and that gantry's own row named the cable run as
     * what held the GANTRY up, so the two were holding each other up in a
     * ring. Straightening the gantry (it ran across the bay, not down it) took
     * the crossing away and left both runs floating 5.5 m over the deck, which
     * is what they had always been.
     *
     * The bound is what a bolt is: a bracket is a 0.3 m slab and the thing it
     * is fixed to has to be within reach of it. Half a metre of daylight is
     * not a fixing. Both levels' runs stand on stanchion heads now and read
     * 0.030 m, which is the slab's own half-thickness.
     *
     * The END is derived from the run's own bounds and its own top grid — the
     * anchor is the highest point of the run at that end — so this measures
     * where the bracket IS and not where a call site says it is. */
    const BOLT = 0.5;
    const lines = [], failed = [];
    let ends = 0, worst = 0;
    for (const [key, rows] of seating()) {
      for (const r of rows) {
        if (r.maker !== 'addCableRun') continue;
        const alongZ = (r.bz1 - r.bz0) >= (r.bx1 - r.bx0);
        for (const far of [false, true]) {
          ends++;
          const ex = alongZ ? (r.bx0 + r.bx1) / 2 : (far ? r.bx1 : r.bx0);
          const ez = alongZ ? (far ? r.bz1 : r.bz0) : (r.bz0 + r.bz1) / 2;
          // the anchor is the top of the run in the grid column at that end
          const G = r.G;
          const bin = (v, lo, hi) => Math.min(G - 1, Math.max(0, ((v - lo) * G / Math.max(1e-6, hi - lo)) | 0));
          const gi = bin(ex, r.bx0, r.bx1), gj = bin(ez, r.bz0, r.bz1);
          let ey = -Infinity;
          for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
            if (alongZ ? j !== gj : i !== gi) continue;
            if (r.top[i * G + j] > ey) ey = r.top[i * G + j];
          }
          if (!isFinite(ey)) ey = r.maxY;
          let best = null, bd = Infinity;
          for (const o of rows) {
            if (o === r || o.maker === 'addCableRun') continue;
            const d = Math.hypot(Math.max(0, o.bx0 - ex, ex - o.bx1),
              Math.max(0, o.minY - ey, ey - o.maxY),
              Math.max(0, o.bz0 - ez, ez - o.bz1));
            if (d < bd) { bd = d; best = o; }
          }
          lines.push(`${key} (${ex.toFixed(0)}, ${ey.toFixed(1)}, ${ez.toFixed(0)}) → ${best ? best.maker : 'nothing'} ${bd.toFixed(3)} m`);
          if (bd > worst) worst = bd;
          if (bd > BOLT) {
            failed.push(`${key}: a cable run's bracket at (${ex.toFixed(0)}, ${ey.toFixed(1)}, ${ez.toFixed(0)}) `
              + `is ${bd.toFixed(2)} m from the nearest assembly (${best ? best.maker : 'nothing at all'}) — nothing to bolt it to`);
          }
        }
      }
    }
    /* `ends >= 8` WAS THE TRIPWIRE AND IS NOW A REPORT, for the reason given at
     * length on the run check above: the two levels that strung cable runs
     * were the Boarding Bay and the Providence, both deleted at the player's
     * request, and `addCableRun` has no caller in a shipped level any more —
     * its only remaining call site is `works()` in Levels.js, which is itself
     * orphaned. An empty census is stated in the pass line rather than
     * asserted against. */
    assert(failed.length === 0, failed.join('\n    ') + '\n    ' + lines.join('; '));
    if (!ends) {
      return 'NO LEVEL STRINGS A CABLE RUN — `addCableRun`\'s only call site is the orphaned '
        + '`works()`; the bolt rule is unexercised until a level strings one';
    }
    return `${ends} bracket ends, worst ${worst.toFixed(3)} m from its fixing; ${lines.join('; ')}`;
  });

  check('props: a gantry runs ALONG the side it stands on, not across it', () => {
    /* WHICH WORLD AXIS THE DECK'S LONG SIDE LIES ON, measured off the built
     * geometry rather than off the `yaw` in the call.
     *
     * `addGantry` builds its deck as `slab(deckM, W, 0.14, L, …)` and steps
     * its trestle bays along z, so unrotated it is long in Z; `kitOpen` pushes
     * `yaw` onto the kit frame, and π/2 puts that on X. Three call sites
     * carried π/2 — the bay's pair and the works' two pairs — so every gantry
     * in the game ran ACROSS the room it was placed down the side of. It is
     * invisible in a seating survey: a deck lying the wrong way still stands
     * on its feet.
     *
     * WHAT SAYS WHICH WAY IS RIGHT, without a table of levels to maintain:
     * the PLACEMENT does. A level that builds two gantries at x = ±d, at the
     * same z, has put one down each side of a room whose spine is the x = 0
     * plane — that is what mirroring across an axis means — and a run down the
     * side of a room lies along the spine, not across it. So the pair itself
     * carries the answer and a new level gets checked the day it is authored.
     *
     * MEASURED, plan extent of each deck, before and after:
     *
     *   hangar  x = ±56 pair    36.7 × 4.8 → across   now 4.8 × 36.7 at ±60
     *   warship x = ±36 pair    32.7 × 4.8 → across   now 4.8 × 26.7
     *   warship x = ±36 pair    26.7 × 4.5 → across   now 4.5 × 18.7
     *
     * A single gantry that is nobody's mirror is not judged here — the cut's
     * two were placed at 0.3 and 2.1 radians on purpose — and neither is a
     * pair standing on a diagonal. This asks about the one arrangement that
     * states its own intent. */
    const mid = (a, b) => (a + b) / 2;
    const lines = [], failed = [];
    let pairs = 0;
    for (const [key, rows] of seating()) {
      const g = rows.filter((r) => r.maker === 'addGantry').map((r) => ({
        cx: mid(r.bx0, r.bx1), cz: mid(r.bz0, r.bz1), ex: r.bx1 - r.bx0, ez: r.bz1 - r.bz0,
      }));
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j];
        const onX = Math.abs(a.cx + b.cx) < 0.5 && Math.abs(a.cz - b.cz) < 0.5 && Math.abs(a.cx) > 10;
        const onZ = Math.abs(a.cz + b.cz) < 0.5 && Math.abs(a.cx - b.cx) < 0.5 && Math.abs(a.cz) > 10;
        if (!onX && !onZ) continue;
        pairs++;
        const want = onX ? 'z' : 'x';
        const got = a.ex > a.ez ? 'x' : 'z';
        lines.push(`${key} pair at ${onX ? 'x' : 'z'} = ±${Math.abs(onX ? a.cx : a.cz).toFixed(0)}: ${a.ex.toFixed(1)}×${a.ez.toFixed(1)} m, long side on ${got}`);
        if (got !== want) {
          failed.push(`${key}: a pair of gantries mirrored across ${onX ? 'x' : 'z'} = 0 at `
            + `${onX ? 'x' : 'z'} = ±${Math.abs(onX ? a.cx : a.cz).toFixed(0)} has its decks lying along ${got} `
            + `(${a.ex.toFixed(1)} × ${a.ez.toFixed(1)} m in plan) — they run across the room, not down its sides`);
        }
      }
    }
    /* `pairs >= 3` WAS THE TRIPWIRE AND IS NOW A REPORT: the three mirrored
     * pairs were the bay's and the Providence's two, and both levels are
     * deleted. `addGantry`'s only surviving call site is the orphaned
     * `works()`. Same reasoning as the two checks above — an empty census is
     * said out loud rather than asserted against, and the axis rule comes back
     * to life on its own the day a level mirrors a pair again. */
    assert(failed.length === 0, failed.join('\n    ') + '\n    ' + lines.join('; '));
    if (!pairs) {
      return 'NO LEVEL BUILDS A MIRRORED PAIR OF GANTRIES — `addGantry`\'s only call site is the '
        + 'orphaned `works()`; the axis rule is unexercised until a level places a pair';
    }
    return lines.join('; ');
  });

  check('props: on level ground a prop\'s underside is ON the ground', () => {
    /* THE NUMBER IN THE REPORT, isolated from the one thing that legitimately
     * lifts a corner. On a slope a rigid box rests on its uphill contact and
     * its downhill corner is genuinely in the air — that is a box, not a bug —
     * so this asks only about props standing on ground that is FLAT under
     * them: less than 6 cm of relief across the whole contact patch. There the
     * answer is not a range, it is a number, and it was the wrong one.
     *
     * BEFORE — lowest vertex minus the terrain directly beneath it, over every
     * prop on level ground on every level:
     *
     *     makeBarrel     +0.09 m, on every single one (h = 0.92 fixed, the
     *                    level offset it by +0.55, and 0.55 − 0.46 = 0.09)
     *     makeVaporator  +0.10 m, on every single one (−1.2 profile, +1.3)
     *     makeCrate      +0.08 median, +0.15 at the 90th — it varies because
     *                    makeCrate randomises its own size and the offset that
     *                    was supposed to cancel it could not
     *
     * AFTER: −0.015 m exactly, everywhere. That is seatOnGround's bed-in, the
     * only number left in the path. */
    const lines = [];
    for (const [key, rows] of seating()) {
      const flat = rows.filter((r) => /^make/.test(r.maker) && r.relief <= 0.06);
      if (!flat.length) continue;
      const gaps = flat.map((r) => r.seat);
      const hi = Math.max(...gaps);
      const worst = flat[gaps.indexOf(hi)];
      lines.push(`${key} ${flat.length} on the level: p50=${pct(gaps, 0.5).toFixed(3)} worst=${hi.toFixed(3)}`);
      assert(hi <= 0.02, `${key}: ${worst.maker} sits ${hi.toFixed(3)} m clear of ground that is `
        + `flat to ${worst.relief.toFixed(3)} m under it, at (${worst.cx0.toFixed(0)}, ${worst.cz0.toFixed(0)})`);
    }
    return lines.join('; ');
  });

  check('props: a seated prop is not swallowed by the ground either', () => {
    /* The other half of seating, and the reason the fix cannot be "sink
     * everything by a metre and call it bedded". A prop beds into its own
     * slope by half the relief across its contact patch, so how deep it goes
     * is set by how steep the ground under it is and by nothing else. That
     * bound is PROPORTIONAL, because the deepest cases are the ones that
     * should be deep: the canyon plants its spires on the wash's walls at up
     * to 0.56 slope, where the ground falls 4.5 m across the 1.6 m the spire
     * stands on, and a rock remnant emerging halfway out of a scree slope is
     * the right picture. Measured, deepest fraction of its own height any prop
     * is buried by, per level:
     *
     *     canyon 0.38 (a 5.9 m spire, 2.3 m in)   arena 0.06   dunes 0.03
     *     hangar 0.00 (a flat floor buries nothing)
     *
     * Half is the line: past that a crate is a lid lying on the sand. */
    const lines = [];
    for (const [key, rows] of seating()) {
      const props = rows.filter((r) => /^make/.test(r.maker));
      if (!props.length) continue;
      let worst = props[0], frac = 0;
      for (const r of props) {
        const f = -r.seat / Math.max(0.1, r.maxY - r.minY);
        if (f > frac) { frac = f; worst = r; }
      }
      lines.push(`${key} ${props.length} props, deepest ${(frac * 100).toFixed(0)}% of its height`);
      assert(frac < 0.5, `${key}: ${worst.maker} is buried ${(-worst.seat).toFixed(2)} m of its own `
        + `${(worst.maxY - worst.minY).toFixed(1)} m at (${worst.cx0.toFixed(0)}, ${worst.cz0.toFixed(0)}) `
        + `— ${(frac * 100).toFixed(0)}% of it is underground`);
    }
    return lines.join('; ');
  });

  /* ══ nothing you can see through ═════════════════════════════════════ */

  check('props: every maker in the file is in the see-through catalogue', () => {
    const named = new Set(catalogue().map((c) => c.name.split(' ')[0]));
    const missing = [];
    for (const k of Object.keys(P)) {
      if (NOT_A_MAKER.has(k) || !/^(add|make)[A-Z]|^BlastDoor$/.test(k)) continue;
      if (!named.has(k)) missing.push(k);
    }
    assert(missing.length === 0,
      `Props.js exports ${missing.length} maker(s) the surveys below never build: ${missing.join(', ')}`);
    return `${named.size} makers surveyed, ${Object.keys(P).length} exports scanned`;
  });

  check('props: no prop has a see-through top', () => {
    /* A vertical ray entering a closed, correctly wound solid MUST cross a
     * front face first: at the entry point the outward normal cannot point
     * downward, overhang or no overhang. Where it does, the lid is culled and
     * the ray keeps going until it finds a surface that is not culled — which
     * is inside the object.
     *
     * BEFORE, fraction of each maker's plan area with a back face on top:
     *     addHullSection 91.6%   addRockArch 81.6%   addLamp 36.5%
     *     addRock 36.4%   addOutcrop 24.7%   addColossus 13.5%
     *     addColumn(broken) 9.1%   makePillar 1.2%   makeConsole 0.07%
     * AFTER: zero columns, on every maker.
     *
     * The 5 cm floor on the drop is what separates a hole from a plate: on a
     * torn hull the inner and outer sheets are 28 cm apart and either may be
     * the higher of the two at the lip. */
    const rows = [];
    let total = 0, bad = 0;
    for (const c of catalogue()) {
      const r = seeThrough(c.meshes);
      total += r.cols; bad += r.bad;
      if (r.bad) rows.push(`${c.name} ${r.bad}/${r.cols} cols, worst drop ${r.worst.toFixed(2)} m at ${r.at}`);
    }
    assert(bad === 0, `${bad} of ${total} columns fall through the top of a prop: ${rows.join('; ')}`);
    return `${total} downward rays over ${catalogue().length} makers, none fell through`;
  });
}
