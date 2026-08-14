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
    const sx = G / Math.max(1e-6, bx1 - bx0), sz = G / Math.max(1e-6, bz1 - bz0);
    for (const p of parts) {
      for (let i = 0; i < p.low.length; i += 3) {
        const gi = Math.min(G - 1, Math.max(0, ((p.low[i] - bx0) * sx) | 0));
        const gj = Math.min(G - 1, Math.max(0, ((p.low[i + 2] - bz0) * sz) | 0));
        const k = gi * G + gj;
        if (p.low[i + 1] > top[k]) top[k] = p.low[i + 1];
      }
    }
    return { minY, maxY, bx0, bx1, bz0, bz1, cx0, cx1, cz0, cz1, top, G };
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
    return { minY, maxY, bx0, bx1, bz0, bz1, low, mat: mesh.material };
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
 * Is this assembly FIXED to another one? A thing is standing on something or
 * it is bolted to something — the hangar's roof trusses span between its walls
 * and its light fittings hang under the trusses.
 *
 * The other thing has to REACH this one, not merely brush its foot: `b` must
 * come up to at least the middle of `a`. A chip of rubble touching the bottom
 * corner of a floating crate is not holding it up.
 */
function carried(a, all, slack = 0.06) {
  const mid = a.minY + (a.maxY - a.minY) * 0.5;
  for (const b of all) {
    if (b === a || b.maxY < mid) continue;
    if (b.bx1 + slack < a.bx0 || b.bx0 - slack > a.bx1) continue;
    if (b.bz1 + slack < a.bz0 || b.bz0 - slack > a.bz1) continue;
    if (b.maxY + slack < a.minY || b.minY - slack > a.maxY) continue;
    return true;
  }
  return false;
}

let SEATED = null;
/** Dress every level once and measure how everything in it sits. */
function seating() {
  if (SEATED) return SEATED;
  SEATED = new Map();
  P.propMaterials();
  for (const key of LEVEL_ORDER) {
    const L = LEVELS[key];
    if (!L || typeof L.dress !== 'function') continue;
    const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
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
    SEATED.set(key, rows);
    grass?.dispose();
    terrain.dispose();
  }
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
    const TOL = 0.05;
    const lines = [];
    for (const [key, rows] of seating()) {
      const ground = rows.filter((r) => !r.lamp);
      const bad = [];
      for (const r of ground) {
        if (r.seat <= TOL) continue;
        if (carried(r, rows)) continue;
        bad.push(r);
      }
      bad.sort((a, b) => b.seat - a.seat);
      const seats = ground.map((r) => r.seat);
      lines.push(`${key} n=${rows.length} p50=${pct(seats, 0.5).toFixed(2)} p99=${pct(seats, 0.99).toFixed(2)} worst=${Math.max(...seats).toFixed(2)}`);
      assert(bad.length === 0,
        `${key}: ${bad.length} of ${ground.length} assemblies stand on nothing — `
        + bad.slice(0, 4).map((b) => `${b.maker} +${b.seat.toFixed(2)} m at (${b.cx0.toFixed(0)}, ${b.minY.toFixed(1)}, ${b.cz0.toFixed(0)})`).join('; '));
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
