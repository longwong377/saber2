/**
 * Environment: architecture, monuments, rock, machinery, clutter, debris.
 *
 * Everything pinned here was measured off the geometry the makers actually
 * emit, because every failure this file guards against looked completely
 * plausible in the source:
 *
 *   · a 92 m hangar wall with 0.10 vertices per square metre, so any amount of
 *     per-vertex weathering painted onto it interpolated away to nothing;
 *   · rock chips UV'd TWELVE times finer than the cliff they fell off, by a
 *     line of code whose comment said it was fixing exactly that;
 *   · a strata palette 1.78:1 in luminance repeating every 0.55 m, which is a
 *     barcode, not a cliff;
 *   · a vertexColors material over a geometry with no colour attribute, which
 *     renders BLACK — and Destruction.js and Slice.js both hand back geometry
 *     with no colour attribute;
 *   · weathering that quietly took a third off the albedo of the whole world.
 *
 * None of those raise an error. They just make it look like a hobby project.
 */

import * as THREE from 'three';
import {
  propMaterials, rockGeo, strataTint, weatherGeo, weatherStats, tessellate, WEAR,
  TEXEL_BAND, ROCK_TILE, Kit,
  addWall, addColumn, addArch, addLintel, addButtress, addBrokenWall, addStair,
  addRailing, addPlinth, addBalcony, addFloorSlab, addColossus, addRuinedGate,
  addHullSection, addGantry, addRock, addOutcrop, addRockArch, addBoulderCluster,
  addScree, addPipeRun, addCableRun, addCrateStack, addTarp, addScaffold,
  addAntenna, addLamp, addSign, addDebrisField, addRuin, addOutpost,
  makeCrate, makeBarrel, makePillar, makeVaporator, makeSpire, makeConsole,
} from '../../src/world/Props.js';
import { MEAN_ALBEDO, rawMaps, sandMaps, rockMaps, duracreteMaps, metalMaps, armorMaps,
         clothMaps } from '../../src/engine/Textures.js';

/**
 * How far above its own mean a bake's brightest texels reach, as p99/mean of
 * linear luminance — the factor any tint chosen against MEAN_ALBEDO has to
 * survive before it clips.
 *
 * Measured: sand 1.59, duracrete 1.21, rock 1.97. A tint that lands the MEAN
 * of the rock map on a target puts its top decile a further 97% above that,
 * which is how the sand drift ended up with a physically impossible albedo
 * while every number written down about it was correct.
 */
const PEAK = new Map();
/**
 * WHICH BAKE A TEXTURE CAME FROM, BY NAME.
 *
 * `PEAK` was keyed on the texture OBJECT — `PEAK.set(fn(2).map, …)` — and read
 * back with `PEAK.get(tex) ?? 3`. The `?? 3` is the defect: a cache miss was
 * silent and answered with a magic number, so the check measured the fallback
 * instead of the map. `max(albedo) * 3` is 1.56 on the drift, and 1.56 is
 * exactly what the failure printed.
 *
 * It missed because texture identity is not stable across a whole run. The map
 * factories memoise per resolution, and by the time this suite runs, another
 * suite may have built the same bake at a different size — so `fn(2).map` and
 * the material's own `map` are two different objects carrying the same pixels.
 * Forward through the suite list it happened to hit; backwards it did not.
 * FOUND BY `SABER_CHECK_ORDER=reverse`, on its first run.
 *
 * Keyed on the bake's NAME now, taken from the texture rather than from a
 * lookup, and a miss THROWS instead of guessing. A check that cannot identify
 * its subject must say so, not carry on with a plausible number.
 */
const PEAK_BY_NAME = new Map();
function mapPeak(tex) {
  if (PEAK_BY_NAME.size === 0) {
    const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    for (const [name, fn] of [['sand', sandMaps], ['rock', rockMaps], ['duracrete', duracreteMaps],
      ['metal', metalMaps], ['armor', armorMaps], ['cloth', clothMaps]]) {
      const m = rawMaps(name);
      const N = m.size * m.size, lum = new Float64Array(N);
      let s = 0;
      for (let i = 0; i < N; i++) {
        const l = (toLin(m.albedo[i * 4]) + toLin(m.albedo[i * 4 + 1]) + toLin(m.albedo[i * 4 + 2])) / 3;
        lum[i] = l; s += l;
      }
      lum.sort();
      PEAK_BY_NAME.set(name, lum[Math.floor(0.99 * (N - 1))] / (s / N));
      PEAK.set(fn(2).map, name);
    }
  }
  /* By name where the texture carries one, by identity as a fallback — and if
   * neither answers, that is a failure of the measurement and it says so. */
  const name = tex?.userData?.saberBake ?? tex?.name ?? PEAK.get(tex);
  const peak = PEAK_BY_NAME.get(name);
  if (peak == null) {
    throw new Error(`mapPeak cannot identify the bake behind this texture (name ${JSON.stringify(name)}) `
      + `— it used to answer 3 here, which is a number this check would then measure instead of the map`);
  }
  return peak;
}

/* ── a world stub that records everything a maker does ───────────────── */
function stubWorld() {
  const scene = new THREE.Scene();
  return {
    scene, statics: [], props: [], debris: [], doors: [], levelLights: [],
    terrain: { height: () => 0, slopeAt: () => 0, inBounds: () => true },
    particles: null,
    physics: {
      staticBoxes: [], bodies: [],
      addStaticBox(c, he, q, o) { const b = { c, he, q, o }; this.staticBoxes.push(b); return b; },
      removeStaticBox() {}, add(b) { this.bodies.push(b); }, remove() {},
    },
    addProp(p) { this.props.push(p); return p; },
    spawnDebris() {}, notify() {},
  };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Every maker in the file, built once and cached. */
const MAKERS = [
  ['addWall 9m', (w) => addWall(w, V(0, 2, 0), V(9, 4, 1))],
  ['addWall 92m', (w) => addWall(w, V(0, 2, 0), V(92, 4, 1.1))],
  ['addColumn M', (w) => addColumn(w, V(0, 0, 0))],
  ['addColumn L', (w) => addColumn(w, V(0, 0, 0), { size: 'L' })],
  ['addColumn broken', (w) => addColumn(w, V(0, 0, 0), { size: 'L', standing: 0.55 })],
  ['addArch 5', (w) => addArch(w, V(0, 0, 0), { span: 5 })],
  ['addArch 8 broken', (w) => addArch(w, V(0, 0, 0), { span: 8, broken: 0.3 })],
  ['addLintel', (w) => addLintel(w, V(0, 4, 0), { length: 6 })],
  ['addButtress', (w) => addButtress(w, V(0, 0, 0))],
  ['addBrokenWall', (w) => addBrokenWall(w, V(0, 0, 0), V(10, 6, 0.7), {
    ruin: 0.5, openings: [{ x: -3, y: 0, w: 1.5, h: 2.8, arched: true }, { x: 3, y: 1.6, w: 1.6, h: 1.6 }] })],
  ['addStair', (w) => addStair(w, V(0, 0, 0), { steps: 8, railing: true })],
  ['addRailing', (w) => addRailing(w, V(0, 0, 0), { length: 6 })],
  ['addPlinth', (w) => addPlinth(w, V(0, 0, 0))],
  ['addBalcony', (w) => addBalcony(w, V(0, 4, 0))],
  ['addFloorSlab', (w) => addFloorSlab(w, V(0, 0, 0), V(16, 12))],
  ['addColossus', (w) => addColossus(w, V(0, 0, 0))],
  ['addRuinedGate', (w) => addRuinedGate(w, V(0, 0, 0))],
  ['addHullSection', (w) => addHullSection(w, V(0, 8, 0))],
  ['addGantry', (w) => addGantry(w, V(0, 0, 0))],
  ['addRock', (w) => addRock(w, V(0, 1, 0), V(1.6, 1.2, 1.5), 3)],
  ['addOutcrop', (w) => addOutcrop(w, V(0, 0, 0), { size: 7 })],
  ['addRockArch', (w) => addRockArch(w, V(0, 0, 0))],
  ['addBoulderCluster', (w) => addBoulderCluster(w, V(0, 0, 0), { count: 14, size: 1.3 })],
  ['addScree', (w) => addScree(w, V(0, 0, 0), { radius: 10, count: 60 })],
  ['addPipeRun', (w) => addPipeRun(w, [V(0, 3, 0), V(8, 3.2, 0), V(16, 2.6, 2)], { count: 3 })],
  ['addCableRun', (w) => addCableRun(w, V(0, 8, 0), V(20, 7, 0), { count: 4 })],
  ['addCrateStack', (w) => addCrateStack(w, V(0, 0, 0))],
  ['addTarp', (w) => addTarp(w, V(0, 0, 0))],
  ['addScaffold', (w) => addScaffold(w, V(0, 0, 0))],
  ['addAntenna', (w) => addAntenna(w, V(0, 0, 0))],
  ['addLamp', (w) => addLamp(w, V(0, 0, 0), { light: true })],
  ['addSign', (w) => addSign(w, V(0, 0, 0))],
  ['addDebrisField', (w) => addDebrisField(w, V(0, 0, 0), { radius: 9 })],
  ['addRuin', (w) => addRuin(w, V(0, 0, 0), { size: 'large', pipes: true })],
  ['addOutpost', (w) => addOutpost(w, V(0, 0, 0))],
  ['makeCrate', (w) => w.addProp(makeCrate(w, V(0, 0.5, 0), 0.7))],
  ['makeBarrel', (w) => w.addProp(makeBarrel(w, V(0, 0.5, 0)))],
  ['makePillar', (w) => w.addProp(makePillar(w, V(0, 2, 0)))],
  ['makeVaporator', (w) => w.addProp(makeVaporator(w, V(0, 1.3, 0)))],
  ['makeSpire', (w) => w.addProp(makeSpire(w, V(0, 3, 0), 6))],
  ['makeConsole', (w) => w.addProp(makeConsole(w, V(0, 0.5, 0)))],
];

let BUILT = null;
/** [{ maker, mesh, geo, mat, instances }] over every mesh every maker emits. */
function built() {
  if (BUILT) return BUILT;
  BUILT = [];
  for (const [name, fn] of MAKERS) {
    const w = stubWorld();
    fn(w);
    w.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      BUILT.push({ maker: name, mesh: o, geo: o.geometry, mat: o.material,
        instanced: !!o.isInstancedMesh, world: w });
    });
  }
  return BUILT;
}

/** Per-triangle world area and uv area of a geometry, area weighted. */
function surface(geo, scale = 1) {
  const p = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index;
  const n = idx ? idx.count : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0, uvSum = 0, longest = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
    const e = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) * scale;
    b.sub(a); c.sub(a);
    const wa = b.cross(c).length() * 0.5 * scale * scale;
    if (wa < 1e-12) continue;
    if (e > longest) longest = e;
    area += wa;
    if (uv) {
      const u0 = uv.getX(i0), v0 = uv.getY(i0);
      const ua = Math.abs((uv.getX(i1) - u0) * (uv.getY(i2) - v0) - (uv.getX(i2) - u0) * (uv.getY(i1) - v0)) * 0.5;
      uvSum += Math.sqrt(ua / (wa / (scale * scale))) / scale * wa;   // uv per world metre, area weighted
    }
  }
  return { area, uvPerM: area > 0 ? uvSum / area : 0, longest, verts: p.count };
}

/** Mean instance scale of an InstancedMesh. */
function meanScale(im) {
  const m = new THREE.Matrix4(), s = new THREE.Vector3(), q = new THREE.Quaternion(), t = new THREE.Vector3();
  let acc = 0;
  for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); m.decompose(t, q, s); acc += (s.x + s.y + s.z) / 3; }
  return acc / Math.max(1, im.count);
}

export function run({ check, assert, near }) {

  /* ══ the loaded gun ══════════════════════════════════════════════════ */

  check('props: no vertexColours material can render black on a missing attribute', () => {
    // three feeds material.defaultAttributeValues to gl.vertexAttrib3fv for any
    // attribute a geometry does not have; without it the attribute holds
    // whatever was last bound, which measures as (0,0,0) — black. Destruction
    // and Slice both rebuild geometry with position/normal/uv only, so every
    // fractured chunk and every cut half depends on this.
    const M = propMaterials();
    const bad = [];
    for (const [k, m] of Object.entries(M)) {
      if (!m || !m.isMaterial || !m.vertexColors) continue;
      const d = m.defaultAttributeValues;
      if (!d || !d.color || d.color.length !== 3 || d.color.some((c) => c !== 1)) bad.push(k);
    }
    assert(bad.length === 0, `${bad.join(', ')} would render black over an uncoloured geometry`);
    const vc = Object.values(M).filter((m) => m && m.isMaterial && m.vertexColors).length;
    assert(vc >= 20, `only ${vc} materials read vertex colour — weathering cannot reach the rest`);
    return `${vc} vertex-colour materials, all with a white fallback`;
  });

  check('props: every geometry a maker emits reaches a material it can feed', () => {
    // the other half of the same gun: a vertexColors material over geometry
    // with no colour attribute, emitted by a maker rather than by Destruction
    const bad = [];
    for (const b of built()) {
      if (!b.mat || !b.mat.vertexColors) continue;
      if (b.geo.attributes.color) continue;
      if (b.instanced) continue;              // covered by defaultAttributeValues
      bad.push(`${b.maker}/${b.mat.type}`);
    }
    assert(bad.length === 0, `unpainted: ${bad.slice(0, 6).join(', ')}`);
    const painted = built().filter((b) => b.geo.attributes.color).length;
    return `${painted}/${built().length} meshes carry vertex colour`;
  });

  /* ══ masonry ═════════════════════════════════════════════════════════ */

  /**
   * Albedo, area-weighted, over the triangles a camera in front of a wall can
   * actually see: front-facing, and in front of everything else at that point.
   * A hidden surface is not a colour the shot contains, and averaging one in is
   * how a wall with a facing on it measures as varied while looking flat.
   */
  function faceAlbedo(w, zFace) {
    const MAPOF = { duracrete: 'duracrete', duracreteWarm: 'duracrete', duracreteDark: 'duracrete',
      sandstone: 'rock', stone: 'rock', stoneDark: 'rock', drift: 'rock', rebar: 'metal' };
    const M = propMaterials();
    const nameOf = new Map(Object.entries(M).map(([k, v]) => [v, k]));
    const out = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const mesh of w.statics) {
      const mm = MEAN_ALBEDO[MAPOF[nameOf.get(mesh.material)] || 'duracrete'];
      const col = mesh.material.color;
      const base = [col.r * mm[0], col.g * mm[1], col.b * mm[2]];
      const g = mesh.geometry, pos = g.attributes.position, cc = g.attributes.color, idx = g.index;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < n; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
        // only the outermost skin: anything at or behind the wall plane is
        // covered by the facing standing proud of it
        if ((a.z + b.z + c.z) / 3 < zFace) continue;
        b.sub(a); c.sub(a); b.cross(c);
        const area = b.length() * 0.5;
        if (!(area > 1e-7) || b.normalize().z < 0.5) continue;
        let r = 1, gg = 1, bb = 1;
        if (cc) {
          r = (cc.getX(i0) + cc.getX(i1) + cc.getX(i2)) / 3;
          gg = (cc.getY(i0) + cc.getY(i1) + cc.getY(i2)) / 3;
          bb = (cc.getZ(i0) + cc.getZ(i1) + cc.getZ(i2)) / 3;
        }
        out.push({ area, l: base[0] * r * 0.2126 + base[1] * gg * 0.7152 + base[2] * bb * 0.0722 });
      }
    }
    const A = out.reduce((s, x) => s + x.area, 0);
    const mean = out.reduce((s, x) => s + x.l * x.area, 0) / A;
    const sd = Math.sqrt(out.reduce((s, x) => s + (x.l - mean) ** 2 * x.area, 0) / A);
    return { mean, sd, rel: sd / mean, area: A };
  }

  check('masonry: a wall face is built out of stones, not printed on a panel', () => {
    /* MEASURED on the arena ring, and the reason ashlarFace exists. Rasterised
     * at 2 cm/px, one 9.4 × 8.4 m bay put 62.8% of its visible face into a
     * single luminance bin out of sixteen and 80% of it into two. That is a
     * white card, and no amount of relighting fixes it, because an extruded
     * polygon has exactly one albedo and the per-PIECE weathering tone that
     * was meant to break it up is by definition constant over the piece.
     *
     * This is the same measurement without the rasteriser: area-weighted
     * spread of the outermost skin. The A/B is against the same wall with the
     * facing switched off, so it cannot pass by the lighting changing. */
    const size = V(9.4, 8.4, 2.1);
    const mk = (o) => { const w = stubWorld(); addBrokenWall(w, V(0, 0, 0), size, { seed: 403, ruin: 0.28, ...o }); return w; };
    const flat = faceAlbedo(mk({ ashlar: false, footing: false, drift: false, talus: false, stringCourse: false }), 1.04);
    const laid = faceAlbedo(mk({ drift: false, talus: false }), 1.04);
    assert(flat.area > 30, `only ${flat.area.toFixed(0)} m² of face to measure`);
    assert(flat.rel < 0.13, `an unfaced wall already varies by ${(flat.rel * 100).toFixed(1)}% — the A/B is meaningless`);
    assert(laid.rel > 0.18, `the facing varies by ${(laid.rel * 100).toFixed(1)}% — that is still one flat panel`);
    assert(laid.rel > flat.rel * 1.8, `facing ${(laid.rel * 100).toFixed(1)}% vs panel ${(flat.rel * 100).toFixed(1)}%`);
    // and the tones must span real ground, not wobble about one value
    near(laid.mean, flat.mean, flat.mean * 0.16, 'the facing changed the wall\'s exposure, not just its variation');
    return `panel ${(flat.rel * 100).toFixed(1)}% → ashlar ${(laid.rel * 100).toFixed(1)}% ` +
      `at albedo ${flat.mean.toFixed(3)} → ${laid.mean.toFixed(3)}`;
  });

  check('masonry: what stands in sand is bedded into it', () => {
    /* Every standing structure's lowest polygon used to sit exactly on y = 0,
     * so on rolling terrain you could see under one edge of it, and the desert
     * stopped dead at its face. Both halves are checked: masonry BELOW grade
     * that nobody ever sees, and drifted sand banked against the face. */
    const rows = [];
    const cases = [
      ['addBrokenWall', (w) => addBrokenWall(w, V(0, 0, 0), V(9.4, 8.4, 2.1), { seed: 403, ruin: 0.28 })],
      ['addColumn', (w) => addColumn(w, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 504 })],
      ['addArch', (w) => addArch(w, V(0, 0, 0), { span: 7.5, rise: 5.4, thickness: 2.2, seed: 601 })],
    ];
    for (const [name, fn] of cases) {
      const w = stubWorld();
      fn(w);
      let low = 0, drift = 0;
      for (const m of w.statics) {
        m.geometry.computeBoundingBox();
        low = Math.min(low, m.geometry.boundingBox.min.y);
        if (m.material === propMaterials().drift) drift += surface(m.geometry).area;
      }
      assert(low < -0.18, `${name} stops at y=${low.toFixed(2)} — nothing of it is buried`);
      assert(drift > 1.0, `${name} has ${drift.toFixed(1)} m² of drifted sand against it`);
      rows.push(`${name.replace('add', '')} ${low.toFixed(2)}m deep, ${drift.toFixed(0)}m² drift`);
    }
    /* And it has to bank against SOMETHING. sandDrift builds about its own
     * origin, so a caller that forgets to push the pier's frame gets a bank of
     * sand hanging in the middle of the gateway — which still measures as
     * thirty square metres of drift, and is exactly the kind of geometry
     * standing inside other geometry this file keeps being bitten by. The
     * clear span of an arch is the one place there is nothing to bank against,
     * so that is where it is measured. */
    {
      const w = stubWorld();
      const span = 7.5;
      addArch(w, V(0, 0, 0), { span, rise: 5.4, thickness: 2.2, seed: 601 });
      let inside = 0, total = 0;
      for (const m of w.statics) {
        if (m.material !== propMaterials().drift) continue;
        const p = m.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) { total++; if (Math.abs(p.getX(i)) < span * 0.42) inside++; }
      }
      assert(total > 60, `the arch emitted only ${total} drift vertices`);
      assert(inside / total < 0.12,
        `${inside}/${total} drift vertices stand in the arch's clear span — that sand is banked against nothing`);
      rows.push(`gateway ${inside}/${total} drift verts in the span`);
    }

    /* And it has to stand at an angle sand can stand at.
     *
     * Dry sand holds about 34° and not one degree past it — pile it steeper
     * and it avalanches until it is 34° again — so a surface claiming to be a
     * wind-blown drift is falsified by a single face steeper than that. Both
     * versions of this that shipped had them: the section put the face above
     * the slack at 44°, and the taper at the ends of a column's drift dropped
     * from full height to a sixth of it between two columns 46 cm apart, which
     * is 52°. Measured over every drift triangle any maker emits, including
     * the cross-slope along the wall, which is where the taper hid. Faces
     * below grade are excluded: they are inside the terrain. */
    {
      const REPOSE = 34, tol = 4;
      let worst = 0, worstAt = '', n = 0;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (const [name, fn] of [['brokenWall', (w) => addBrokenWall(w, V(0, 0, 0), V(9.4, 8.4, 2.1), { seed: 403, ruin: 0.28 })],
        ['column', (w) => addColumn(w, V(0, 0, 0), { height: 7.5, radius: 0.55, seed: 504 })],
        ['plinth', (w) => addPlinth(w, V(0, 0, 0), { width: 8, height: 2.7, seed: 99 })],
        ['ruinedGate', (w) => addRuinedGate(w, V(0, 0, 0))]]) {
        const w = stubWorld();
        fn(w);
        for (const m of w.statics) {
          if (m.material !== propMaterials().drift) continue;
          const p = m.geometry.attributes.position, idx = m.geometry.index;
          const cnt = idx ? idx.count : p.count;
          for (let i = 0; i + 2 < cnt; i += 3) {
            const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
            a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
            if (Math.min(a.y, b.y, c.y) < -0.02) continue;         // buried in the terrain
            b.sub(a); c.sub(a); b.cross(c);
            if (b.length() < 1e-9) continue;
            const deg = Math.acos(Math.min(1, Math.abs(b.normalize().y))) * 180 / Math.PI;
            n++;
            if (deg > worst) { worst = deg; worstAt = name; }
          }
        }
      }
      assert(n > 200, `only ${n} drift faces to measure`);
      assert(worst < REPOSE + tol,
        `${worstAt} banks sand at ${worst.toFixed(0)}° — dry sand stands at ${REPOSE}°`);
      rows.push(`steepest sand ${worst.toFixed(0)}° over ${n} faces`);
    }

    /* And the drift has to BE sand — a grey ramp against a wall is worse than
     * no ramp at all — so it is pinned to the ground's own measured albedo.
     *
     * Read off the material's OWN recorded product rather than re-deriving
     * `colour x map mean` here, because the version of this check that did the
     * multiplication itself hard-coded MEAN_ALBEDO.rock and therefore passed a
     * drift that was 14% brighter and a third less saturated than the sand,
     * on screen, while agreeing to two decimal places on paper. */
    const dm = propMaterials().drift;
    const alb = dm.userData.albedo, s = MEAN_ALBEDO.sand;
    assert(alb, 'the drift material carries no measured albedo');
    for (let i = 0; i < 3; i++) near(alb[i], s[i], 0.075, `drift albedo channel ${i} against sand`);
    /* A mean is not a picture. The old drift matched sand's MEAN by running a
     * map with twice sand's tonal contrast at a 4.9x multiplier, which put the
     * top of its albedo histogram at 1.14 — a surface brighter than a perfect
     * white reflector, so it clipped, and a bank of desert sand rendered as
     * white marble. Whatever bake it is on, the drift's brightest texel has to
     * stay inside physical albedo. */
    const peak = Math.max(...alb) * mapPeak(dm.map);
    assert(peak < 0.95, `the drift's 99th-percentile albedo is ${peak.toFixed(2)} — that clips to white`);
    return `${rows.join(', ')}; drift albedo ${alb.map((x) => x.toFixed(2)).join('/')} ` +
      `vs sand ${s.map((x) => x.toFixed(2)).join('/')}, p99 ${peak.toFixed(2)}`;
  });

  /* ══ weathering ══════════════════════════════════════════════════════ */

  check('weathering: the world does not quietly get darker', () => {
    // Weathering is variation, not a dimmer. The mean has to stay on 1.0 or
    // every albedo in propMaterials() — all of which were chosen against
    // measured map means — is silently wrong by whatever the drift is.
    let area = 0, sum = 0;
    const bins = [];
    for (const b of built()) {
      const c = b.geo.attributes.color;
      if (!c || b.mat === propMaterials().strata) continue;   // strata carries its own tint
      const s = surface(b.geo);
      if (s.area < 0.5) continue;
      const w = weatherStats(b.geo);
      area += s.area; sum += w.lum * s.area;
      bins.push([b.maker, w.lum]);
    }
    assert(area > 500, `only ${area.toFixed(0)} m² measured`);
    const mean = sum / area;
    near(mean, 1.0, 0.05, 'area-weighted mean vertex colour');
    bins.sort((a, b) => a[1] - b[1]);
    assert(bins[0][1] > 0.66, `${bins[0][0]} weathered to ${bins[0][1].toFixed(2)} — that is a dimmer, not dirt`);
    assert(bins[bins.length - 1][1] < 1.28, `${bins[bins.length - 1][0]} weathered to ${bins[bins.length - 1][1].toFixed(2)}`);
    return `mean ${mean.toFixed(3)} over ${area.toFixed(0)} m², bins ${bins[0][1].toFixed(2)}..${bins[bins.length - 1][1].toFixed(2)}`;
  });

  check('weathering: the variation is LOW frequency, so it survives distance', () => {
    // per-vertex fizz averages to nothing three metres away and is just noise
    // on top of the noise already in the map. What has to be there is metre-
    // scale structure: dirt runs, blotching, a splash zone.
    const rows = [];
    for (const name of ['addWall 92m', 'addBrokenWall', 'addRuinedGate', 'addHullSection', 'addColossus']) {
      const bs = built().filter((b) => b.maker === name && b.geo.attributes.color);
      let best = null;
      for (const b of bs) { const s = surface(b.geo); if (!best || s.area > best.s.area) best = { b, s }; }
      assert(best, `${name} emitted nothing painted`);
      // block-average the colour over 2 m cells and take the spread of THOSE
      const { b, s } = best;
      const p = b.geo.attributes.position, c = b.geo.attributes.color;
      const cells = new Map();
      let mean = 0;
      for (let i = 0; i < p.count; i++) {
        const l = (c.getX(i) + c.getY(i) + c.getZ(i)) / 3;
        mean += l;
        const k = `${Math.round(p.getX(i) / 2)},${Math.round(p.getY(i) / 2)},${Math.round(p.getZ(i) / 2)}`;
        const e = cells.get(k) || [0, 0]; e[0] += l; e[1]++; cells.set(k, e);
      }
      mean /= p.count;
      let v = 0;
      for (const [, e] of cells) v += (e[0] / e[1] - mean) ** 2;
      const blockSd = Math.sqrt(v / cells.size);
      assert(cells.size >= 8, `${name}: only ${cells.size} two-metre cells to vary over`);
      assert(blockSd > 0.035, `${name} varies by ${(blockSd * 100).toFixed(1)}% at 2 m — that is one flat grey`);
      rows.push(`${name.replace('add', '')} ${(blockSd * 100).toFixed(1)}%`);
    }
    return rows.join(', ');
  });

  check('weathering: dirt runs DOWN, and the foot is dirtier than the head', () => {
    // the two cues that say "outside, for a long time". Both are directional,
    // so both are checked as a gradient rather than as an amplitude.
    const g = new THREE.PlaneGeometry(8, 8, 40, 40);
    g.rotateX(0);                                   // a vertical face, +z normal
    weatherGeo(g, { strength: 1, tone: 0, seed: 3, y0: -4 });
    const p = g.attributes.position, c = g.attributes.color;
    let lo = 0, nlo = 0, hi = 0, nhi = 0;
    const rowsByY = new Map();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 4;                      // 0 at the foot
      const l = (c.getX(i) + c.getY(i) + c.getZ(i)) / 3;
      if (y < 1.0) { lo += l; nlo++; } else if (y > 4) { hi += l; nhi++; }
      const k = Math.round(y * 5);
      const e = rowsByY.get(k) || []; e.push(l); rowsByY.set(k, e);
    }
    lo /= nlo; hi /= nhi;
    assert(lo < hi * 0.94, `the splash zone is only ${((1 - lo / hi) * 100).toFixed(1)}% darker than the wall above it`);
    // vertical coherence: neighbouring rows must correlate far better than
    // neighbouring columns, or the "runs" are isotropic blotches
    const cols = p.count ** 0.5 | 0;
    let dv = 0, dh = 0, n = 0;
    for (let r = 1; r < 41; r++) for (let cI = 1; cI < 41; cI++) {
      const at = (rr, cc) => { const i = rr * 41 + cc; return (c.getX(i) + c.getY(i) + c.getZ(i)) / 3; };
      dv += Math.abs(at(r, cI) - at(r - 1, cI));
      dh += Math.abs(at(r, cI) - at(r, cI - 1));
      n++;
    }
    dv /= n; dh /= n;
    assert(dh > dv * 1.5, `dirt varies ${(dh / dv).toFixed(2)}× as fast across as down — those are blotches, not runs`);
    return `splash zone ${((1 - lo / hi) * 100).toFixed(0)}% darker, runs ${(dh / dv).toFixed(1)}:1 vertical`;
  });

  check('weathering: an unweathered piece still differs from the one beside it', () => {
    // a colonnade of eight identical columns is eight copies of a column
    const kit = new Kit(11);
    const tones = [];
    for (let i = 0; i < 8; i++) {
      const g0 = new THREE.PlaneGeometry(1, 1, 1, 1);
      g0.translate(i * 3, 2, 0);
      // kit.add may hand back a NEW geometry — tessellate rebuilds — so read
      // what was actually binned, not the one that went in
      const g = kit.add(g0, propMaterials().sandstone);
      const c = g.attributes.color;
      let m = 0;
      for (let v = 0; v < c.count; v++) m += (c.getX(v) + c.getY(v) + c.getZ(v)) / 3;
      tones.push(m / c.count);
    }
    const mean = tones.reduce((a, b) => a + b, 0) / tones.length;
    const sd = Math.sqrt(tones.reduce((a, b) => a + (b - mean) ** 2, 0) / tones.length);
    assert(sd > 0.03, `eight pieces vary by ${(sd * 100).toFixed(1)}% — they are one piece eight times`);
    assert(sd < 0.2, `eight pieces vary by ${(sd * 100).toFixed(1)}% — that is eight different materials`);
    return `${(sd * 100).toFixed(1)}% piece-to-piece over 8, mean ${mean.toFixed(2)}`;
  });

  /* ══ vertex density: where the weathering has to live ═════════════════ */

  check('geometry: big flat surfaces have somewhere to put the variation', () => {
    // MEASURED before tessellate() existed: a 92 m hangar wall was 0.10 verts
    // per m² with a 30.7 m median triangle edge, a 10 m broken wall 2.85 with a
    // 10.0 m edge. Vertex colour on that is linearly interpolated across the
    // whole wall, i.e. it is not there.
    const rows = [];
    for (const name of ['addWall 92m', 'addWall 9m', 'addBrokenWall', 'addHullSection', 'addColossus', 'addRuinedGate']) {
      for (const b of built()) {
        if (b.maker !== name || !b.geo.attributes.color) continue;
        const s = surface(b.geo);
        if (s.area < 60) continue;              // only the big faces matter here
        const dens = s.verts / s.area;
        assert(dens > 1.0, `${name}: ${dens.toFixed(2)} verts/m² — weathering cannot be seen on that`);
        rows.push(`${name.replace('add', '')} ${dens.toFixed(1)}/m²`);
      }
    }
    assert(rows.length >= 5, 'not enough large surfaces measured');
    return rows.join(', ');
  });

  check('geometry: tessellation splits broad faces and leaves slivers alone', () => {
    // the second test is the expensive half. Without it a 32 m stringer 26 cm
    // wide is chopped into thirty pieces that can never show a metre-scale
    // dirt run — measured, that took the kit from 118k triangles to 297k.
    const broad = new THREE.PlaneGeometry(8, 6, 1, 1);
    const tri0 = broad.index.count / 3;
    const bt = tessellate(broad, WEAR.cell);
    const tri1 = bt.index.count / 3;
    assert(tri1 > 60, `an 8×6 m face split to only ${tri1} triangles`);
    let longest = 0;
    const p = bt.attributes.position, idx = bt.index;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(p, idx.getX(i)); b.fromBufferAttribute(p, idx.getX(i + 1)); c.fromBufferAttribute(p, idx.getX(i + 2));
      longest = Math.max(longest, a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
    }
    assert(longest < WEAR.cell * 2.1, `broad face still has a ${longest.toFixed(1)} m edge`);

    const sliver = new THREE.PlaneGeometry(32, 0.26, 1, 1);
    const st = tessellate(sliver, WEAR.cell);
    assert(st.index === null || st.index.count / 3 <= 2 || st === sliver,
      `a 32 m × 26 cm stringer was split into ${st.index ? st.index.count / 3 : '?'} triangles`);
    // and a geometry already fine enough must come back untouched, not rebuilt
    const fine = new THREE.PlaneGeometry(1, 1, 4, 4);
    assert(tessellate(fine, WEAR.cell) === fine, 'an already-fine geometry was needlessly rebuilt');
    return `8×6 m → ${tri0}→${tri1} tris, max edge ${longest.toFixed(2)} m; 32×0.26 m untouched`;
  });

  check('geometry: tessellation keeps normals unit length and uvs continuous', () => {
    const g = new THREE.CylinderGeometry(3, 3, 9, 24, 1);
    const before = surface(g);
    const t = tessellate(g, WEAR.cell);
    const after = surface(t);
    near(after.area, before.area, before.area * 0.02, 'tessellation changed the surface area');
    near(after.uvPerM, before.uvPerM, before.uvPerM * 0.05, 'tessellation changed the texel density');
    const n = t.attributes.normal, v = new THREE.Vector3();
    let worst = 0;
    for (let i = 0; i < n.count; i++) { v.fromBufferAttribute(n, i); worst = Math.max(worst, Math.abs(v.length() - 1)); }
    assert(worst < 1e-3, `a midpoint normal is ${(1 + worst).toFixed(3)} long`);
    return `area ${before.area.toFixed(1)}→${after.area.toFixed(1)} m², uv/m ${before.uvPerM.toFixed(3)}→${after.uvPerM.toFixed(3)}`;
  });

  /* ══ texel density ═══════════════════════════════════════════════════ */

  check('texel density: a crate and a wall are made of the same stuff', () => {
    // Shared maps, so the only thing setting how big the grain LOOKS is the
    // `tile` each maker passes. Left to taste this file spread 15:1 — a fuel
    // drum eight times finer than the gantry beside it, rock chips twelve
    // times finer than the cliff, by a line whose comment claimed the opposite.
    const bad = [], all = [];
    for (const b of built()) {
      if (!b.geo.attributes.uv) continue;
      if (b.mat && b.mat.map && b.mat.map.wrapS === THREE.ClampToEdgeWrapping) continue;  // signage
      const sc = b.instanced ? meanScale(b.mesh) : 1;
      const s = surface(b.geo, sc);
      if (s.area < 0.35 || s.uvPerM <= 0) continue;
      const metres = 1 / (s.uvPerM * 2);          // maps are baked at repeat 2
      all.push([b.maker, metres, s.area]);
      if (metres < TEXEL_BAND[0] || metres > TEXEL_BAND[1]) bad.push(`${b.maker} ${metres.toFixed(2)}m`);
    }
    assert(all.length > 60, `only ${all.length} surfaces measured`);
    assert(bad.length === 0, `outside ${TEXEL_BAND[0]}–${TEXEL_BAND[1]} m per repeat: ${bad.slice(0, 8).join(', ')}`);
    const sorted = all.map((r) => r[1]).sort((a, b) => a - b);
    const spread = sorted[sorted.length - 1] / sorted[0];
    assert(spread < 6, `texel density spreads ${spread.toFixed(1)}:1 across the kit`);
    // and the headline pair the brief names
    const of = (n) => { const r = all.filter((x) => x[0] === n); return r.reduce((a, x) => a + x[1] * x[2], 0) / r.reduce((a, x) => a + x[2], 0); };
    const crate = of('makeCrate'), wall = of('addWall 9m');
    assert(Math.max(crate, wall) / Math.min(crate, wall) < 3,
      `a crate is ${(wall / crate).toFixed(1)}× the texel density of a wall`);
    return `${all.length} surfaces, ${sorted[0].toFixed(2)}–${sorted[sorted.length - 1].toFixed(2)} m/repeat (${spread.toFixed(1)}:1); crate ${crate.toFixed(2)} vs wall ${wall.toFixed(2)}`;
  });

  check('texel density: instanced chips match the thing they fell off', () => {
    // scree and rubble are authored at unit size and scaled per instance, so
    // their LOCAL uv has to be multiplied by that scale. Dividing instead put a
    // 20 cm chip at 0.21 m per repeat against the cliff's 2.4 m.
    const rows = [];
    for (const [name, ref] of [['addScree', ROCK_TILE], ['addBoulderCluster', ROCK_TILE], ['addDebrisField', 2.4]]) {
      for (const b of built()) {
        if (b.maker !== name || !b.instanced) continue;
        const sc = meanScale(b.mesh);
        const s = surface(b.geo, sc);
        const metres = 1 / (s.uvPerM * 2);
        assert(metres > ref * 0.4 && metres < ref * 2.2,
          `${name} chips are ${metres.toFixed(2)} m/repeat against ${ref} m on the parent`);
        rows.push(`${name.replace('add', '')} ${metres.toFixed(2)}m @ scale ${sc.toFixed(2)}`);
      }
    }
    assert(rows.length >= 3, 'no instanced chip fields found');
    return rows.join(', ');
  });

  /* ══ rock ════════════════════════════════════════════════════════════ */

  check('rock: the strata are beds, not a barcode', () => {
    // The old palette was 1.78:1 in luminance and advanced at a constant rate,
    // so a 9 m outcrop was sixteen equal stripes cycling six colours in order.
    // Real sequences differ by hue more than by value, and by thickness most
    // of all.
    const rows = [];
    for (const seed of [606, 707, 900]) {
      const N = 20000, H = 12, out = [1, 1, 1], lum = new Float64Array(N);
      for (let i = 0; i < N; i++) { strataTint(i / N * H, seed, 1 / 0.55, out); lum[i] = (out[0] + out[1] + out[2]) / 3; }
      // low-pass out the per-texel grit before looking for bed contacts
      const W = Math.round(N / H * 0.22), sm = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        let a = 0, c = 0;
        for (let j = -W; j <= W; j++) { const k = i + j; if (k >= 0 && k < N) { a += lum[k]; c++; } }
        sm[i] = a / c;
      }
      const edges = [];
      for (let i = 2; i < N - 2; i++) {
        const d = Math.abs(sm[i + 1] - sm[i - 1]);
        if (d > 0.0015 && d >= Math.abs(sm[i] - sm[i - 2]) && d >= Math.abs(sm[i + 2] - sm[i])) edges.push(i / N * H);
      }
      const th = [];
      for (let i = 1; i < edges.length; i++) if (edges[i] - edges[i - 1] > 0.03) th.push(edges[i] - edges[i - 1]);
      th.sort((a, b) => a - b);
      assert(th.length > 6, `seed ${seed}: only ${th.length} beds over ${H} m`);
      const p10 = th[(th.length * 0.1) | 0], p90 = th[(th.length * 0.9) | 0];
      assert(p90 / p10 > 4, `seed ${seed}: bed thickness varies only ${(p90 / p10).toFixed(1)}× — that is a rhythm the eye will find`);
      const s = Float64Array.from(lum).sort();
      const ratio = s[(N * 0.98) | 0] / s[(N * 0.02) | 0];
      assert(ratio < 1.5, `seed ${seed}: beds differ ${ratio.toFixed(2)}:1 in value — a barcode`);
      const mean = lum.reduce((a, b) => a + b, 0) / N;
      assert(mean > 1.9 && mean < 2.6, `seed ${seed}: strata mean ${mean.toFixed(2)} — rock albedo drifted`);
      rows.push(`${seed}: ${th.length} beds ${p10.toFixed(2)}–${p90.toFixed(2)}m (${(p90 / p10).toFixed(0)}×), ${ratio.toFixed(2)}:1`);
    }
    return rows.join(' · ');
  });

  check('rock: an outcrop is a crag, not a stack of discs', () => {
    // Two measurable failures of the old shaping. (1) The radius stepped ±13%
    // at every bed boundary through a Math.floor, three rings apart: a wedding
    // cake. (2) The plan shape was a function of azimuth alone, so the whole
    // mass was one extruded prism with a flat disc on top.
    const g = rockGeo(new THREE.Vector3(5, 4.4, 4), 606, { seg: 17, bed: 0.55 });
    const p = g.attributes.position;
    // (1) radius vs height, sampled on one azimuth: no step may exceed 8%
    const byY = new Map();
    let maxY = -1e9, minY = 1e9;
    for (let i = 0; i < p.count; i++) { maxY = Math.max(maxY, p.getY(i)); minY = Math.min(minY, p.getY(i)); }
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), r = Math.hypot(p.getX(i), p.getZ(i));
      // The BODY only. Above 0.40 of the height the lowest crest starts to
      // taper its shoulder out, and below 0.20 the basal flare widens it — both
      // are meant to move the radius, so measuring bed relief through them
      // would just be measuring the silhouette.
      if (r < 0.05 || y < minY + (maxY - minY) * 0.20 || y > minY + (maxY - minY) * 0.38) continue;
      const k = Math.round(y * 4);
      const e = byY.get(k) || [0, 0]; e[0] += r; e[1]++; byY.set(k, e);
    }
    const keys = [...byY.keys()].sort((a, b) => a - b);
    let worstStep = 0;
    for (let i = 1; i < keys.length; i++) {
      if (keys[i] - keys[i - 1] !== 1) continue;
      const a = byY.get(keys[i - 1]), b = byY.get(keys[i]);
      worstStep = Math.max(worstStep, Math.abs(b[0] / b[1] - a[0] / a[1]) / (a[0] / a[1]));
    }
    assert(worstStep < 0.09, `the mean radius steps ${(worstStep * 100).toFixed(0)}% between 25 cm bands — that is a wedding cake`);

    // (2) the crest must not be level: the HIGHEST point on each azimuth has to
    //     vary, or the silhouette is a cylinder with a lid from every angle
    const perAz = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = Math.round(Math.atan2(p.getZ(i), p.getX(i)) * 6);
      perAz.set(k, Math.max(perAz.get(k) ?? -1e9, p.getY(i)));
    }
    const tops = [...perAz.values()].sort((a, b) => a - b);
    const crestRange = (tops[(tops.length * 0.9) | 0] - tops[(tops.length * 0.1) | 0]) / (maxY - minY);
    assert(crestRange > 0.055, `the crest is level to ${(crestRange * 100).toFixed(1)}% of the height — a cylinder with a lid`);

    // (3) vertical jointing: the plan must be re-entrant, not a smooth oval
    let dev = 0, n = 0;
    const ring = [];
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i)) > 0.4) continue;
      ring.push([Math.atan2(p.getZ(i), p.getX(i)), Math.hypot(p.getX(i), p.getZ(i))]);
    }
    ring.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ring.length - 1; i++) {
      const curv = ring[i - 1][1] - 2 * ring[i][1] + ring[i + 1][1];
      dev += Math.abs(curv); n++;
    }
    const rough = dev / n / (ring.reduce((a, r) => a + r[1], 0) / ring.length);
    assert(rough > 0.012, `the plan is smooth to ${(rough * 1000).toFixed(1)}‰ — no joints, so no buttresses`);
    return `radius step ${(worstStep * 100).toFixed(1)}%, crest range ${(crestRange * 100).toFixed(0)}% of height, plan roughness ${(rough * 1000).toFixed(1)}‰`;
  });

  check('rock: boulders are broken, and no two are the same shape', () => {
    const bs = built().filter((b) => b.maker === 'addBoulderCluster' && b.instanced);
    assert(bs.length >= 3, `only ${bs.length} boulder shapes in a 14-rock cluster`);
    // each variant must have real facets: a noise-displaced sphere has almost
    // no coplanar area, a broken rock has several flat faces
    const rows = [];
    for (const b of bs) {
      const g = b.geo, p = g.attributes.position, idx = g.index;
      const n = idx ? idx.count : p.count;
      const a = new THREE.Vector3(), q = new THREE.Vector3(), c = new THREE.Vector3();
      const norms = [];
      let area = 0;
      for (let i = 0; i + 2 < n; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(p, i0); q.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
        q.sub(a); c.sub(a); q.cross(c);
        const ar = q.length() * 0.5;
        if (ar < 1e-9) continue;
        area += ar; norms.push([q.clone().normalize(), ar]);
      }
      // largest set of triangles sharing a normal to within 6 degrees
      let best = 0;
      for (const [nn] of norms) {
        let acc = 0;
        for (const [mm, ar] of norms) if (nn.dot(mm) > 0.994) acc += ar;
        best = Math.max(best, acc);
      }
      const facet = best / area;
      assert(facet > 0.055, `a boulder's largest flat face is ${(facet * 100).toFixed(1)}% of it — that is a potato`);
      rows.push(`${(facet * 100).toFixed(0)}%`);
    }
    // and the silhouettes have to differ: compare bounding-box aspect ratios
    const aspects = bs.map((b) => {
      b.geo.computeBoundingBox();
      const s = new THREE.Vector3(); b.geo.boundingBox.getSize(s);
      return s.y / ((s.x + s.z) / 2);
    });
    const spread = Math.max(...aspects) / Math.min(...aspects);
    assert(spread > 1.6, `every boulder shape has the same ${spread.toFixed(2)}:1 proportions`);
    return `${bs.length} shapes, largest facet ${rows.join('/')}, aspect spread ${spread.toFixed(1)}:1`;
  });

  check('rock: boulders are bedded into the ground to different depths', () => {
    const w = stubWorld();
    addBoulderCluster(w, V(0, 0, 0), { count: 24, radius: 8, size: 1.4, seed: 77 });
    const depths = [];
    const m = new THREE.Matrix4(), t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const im of w.statics) {
      if (!im.isInstancedMesh) continue;
      im.geometry.computeBoundingBox();
      const lo = im.geometry.boundingBox.min.y, hi = im.geometry.boundingBox.max.y;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m); m.decompose(t, q, s);
        const h = (hi - lo) * s.y;
        depths.push(clamp01((0 - (t.y + lo * s.y)) / Math.max(1e-3, h)));
      }
    }
    const mean = depths.reduce((a, b) => a + b, 0) / depths.length;
    const sd = Math.sqrt(depths.reduce((a, b) => a + (b - mean) ** 2, 0) / depths.length);
    assert(mean > 0.2 && mean < 0.65, `boulders are buried ${(mean * 100).toFixed(0)}% deep on average`);
    assert(sd > 0.05, `every boulder is buried to the same ${(mean * 100).toFixed(0)}% — that is a row`);
    return `buried ${(mean * 100).toFixed(0)}% ± ${(sd * 100).toFixed(0)}% over ${depths.length}`;
  });

  /* ══ construction ════════════════════════════════════════════════════ */

  check('construction: an opening in a thick wall is dressed', () => {
    // a doorway cut straight through three panels with a 5 cm bevel is a hole
    // in a sheet of card. Real masonry has jambs, a head and a sill.
    const plain = stubWorld(), dressed = stubWorld();
    const openings = [{ x: -3, y: 0, w: 1.5, h: 2.8, arched: true }, { x: 3, y: 1.6, w: 1.6, h: 1.6 }];
    // no drift and no fallen rubble: this check is about what a DOORWAY is
    // made of, and both of those put geometry a metre clear of the wall face
    const bare = { drift: false, talus: false };
    addBrokenWall(plain, V(0, 0, 0), V(10, 6, 0.7), { ruin: 0.4, openings, dressings: false, seed: 5, ...bare });
    addBrokenWall(dressed, V(0, 0, 0), V(10, 6, 0.7), { ruin: 0.4, openings, seed: 5, ...bare });
    const tri = (w) => w.statics.reduce((a, m) => a + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
    const a = tri(plain), b = tri(dressed);
    assert(b > a * 1.1, `dressings added ${b - a} triangles to a wall with two openings`);
    /* And they must stand PROUD of the wall face, or they are invisible.
     * Scanned only INSIDE the openings' own bands: the wall now has a footing
     * that projects to 0.48 m and a sand drift that reaches 1.4 m clear of the
     * face, and either of those satisfies a whole-mesh bounding box without a
     * single jamb being present — which is a check that has stopped checking. */
    let maxZ = 0;
    const v = new THREE.Vector3();
    for (const m of dressed.statics) {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        for (const o of openings) {
          const ow = o.w / 2 + 0.35, oh = o.h;
          if (Math.abs(v.x - o.x) <= ow && v.y >= o.y - 0.3 && v.y <= o.y + oh + 0.5) {
            maxZ = Math.max(maxZ, v.z);
          }
        }
      }
    }
    assert(maxZ > 0.36, `nothing projects past the 0.35 m wall face (max ${maxZ.toFixed(2)} m) — no reveal`);
    return `${a} → ${b} triangles, dressings project to ${maxZ.toFixed(2)} m on a 0.35 m face`;
  });

  check('construction: nothing in the kit lost its draw-call discipline', () => {
    // the whole reason for Kit: a ruin of two hundred stones is a handful of
    // draw calls. Tessellation and weathering must not have changed that.
    const rows = [];
    // addRuin went 9 → 10 when the masonry got ground contact: the sand drift
    // banked against every footing is a fifth stone, and it cannot share a bin
    // with any of the other four because it has to be the GROUND's albedo
    // (0.40 luminance) and they are all around 0.20. One draw call for every
    // building in the game meeting the desert is the right trade.
    for (const [name, max] of [['addRuin', 10], ['addRuinedGate', 7], ['addHullSection', 6],
                               ['addGantry', 7], ['addOutcrop', 3], ['addColossus', 5]]) {
      const n = built().filter((b) => b.maker === name).length;
      assert(n <= max, `${name} costs ${n} draw calls`);
      rows.push(`${name.replace('add', '')} ${n}`);
    }
    let tris = 0;
    for (const b of built()) {
      const g = b.geo;
      tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (b.instanced ? b.mesh.count : 1);
    }
    assert(tris < 210000, `the whole kit is ${Math.round(tris)} triangles`);
    return `${rows.join(', ')} — ${Math.round(tris / 1000)}k triangles over ${MAKERS.length} makers`;
  });

  check('construction: a maker composed into a kit lands IN it, and where it was asked', () => {
    /* `{ kit }` IS THE FILE'S WHOLE COMPOSITION CONVENTION — its header says
     * "pass `{ kit }` to any `add*` to compose it into a larger merge" — and
     * one maker did not implement it. `addCrateStack` built a Kit of its own,
     * emitted it, and returned; the `{ kit }` it was handed went nowhere. That
     * costs draw calls, which is the visible half, and it puts the assembly in
     * the WRONG PLACE, which is the half nobody would have found by looking: a
     * composed maker is given a KIT-SPACE position, so `cut()`'s derelict cell
     * asked for a stack 3.4 m from its machine and got one at world (3.4, 1.8)
     * — beside the level origin, up to a hundred metres away.
     *
     * Both halves are pinned here, and pinned by COMPARISON rather than
     * against numbers typed in: the same stack is built bare at a world point
     * and composed into a kit emitted at that same point, and the two have to
     * agree. That also covers the live crates on top, which are rigid bodies
     * and have no kit space to live in — they are placed through `Kit.after`,
     * at the emit, which is the only moment their world point exists. */
    const at = new THREE.Vector3(11, 0, -7);
    const yaw = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), 0.7);
    const opts = { tiers: 3, columns: 3, seed: 4242 };

    const bare = stubWorld();
    const bareRes = addCrateStack(bare, at, { ...opts, quaternion: yaw });

    const comp = stubWorld();
    const kit = new Kit(7);
    addCrateStack(comp, V(0, 0, 0), { ...opts, kit });
    const res = kit.emit(comp, at, yaw);

    assert(res.draws === bareRes.draws,
      `composed into a kit the stack emitted ${res.draws} meshes against ${bareRes.draws} bare`);
    /* The live crates only — `world.props` also holds the destruction proxy the
     * stack registers, which has a body and no mesh. */
    const crates = (w) => w.props.filter((p) => p.mesh).map((p) => p.mesh.position.clone())
      .sort((a, b) => (a.x - b.x) || (a.y - b.y) || (a.z - b.z));
    const cb = crates(bare), cc = crates(comp);
    assert(cb.length > 0, 'the bare stack put no live crate on top of itself');
    assert(cc.length === cb.length, `${cc.length} live crates composed against ${cb.length} bare`);
    let worst = 0;
    for (let i = 0; i < cb.length; i++) worst = Math.max(worst, cc[i].distanceTo(cb[i]));
    assert(worst < 1e-6, `a composed stack's live crates land ${worst.toFixed(3)} m from where a bare one's do`);
    // and composing two of them really does merge: one bin per material, not
    // one per maker
    const two = stubWorld();
    const k2 = new Kit(7);
    addCrateStack(two, V(0, 0, 0), { ...opts, kit: k2 });
    addCrateStack(two, V(4, 0, 0), { ...opts, kit: k2, seed: 99 });
    const r2 = k2.emit(two, at, yaw);
    assert(r2.draws === res.draws,
      `two stacks in one kit cost ${r2.draws} draw calls against one stack's ${res.draws}`);
    return `${res.draws} draws composed and bare, ${cb.length} live crates within ${worst.toExponential(1)} m, two stacks still ${r2.draws}`;
  });

  check('construction: every maker still puts colliders where its mass is', () => {
    const bad = [];
    for (const [name, fn] of MAKERS) {
      if (/Scree|CableRun|PipeRun|Debris|Railing|make/.test(name)) continue;
      const w = stubWorld();
      fn(w);
      if (!w.physics.staticBoxes.length) { bad.push(name); continue; }
      // and the colliders must sit inside the geometry's bounds, not beside it
      const box = new THREE.Box3();
      for (const m of w.statics) { m.updateMatrixWorld(true); m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); }
      box.expandByScalar(1.5);
      for (const c of w.physics.staticBoxes) if (!box.containsPoint(c.c)) { bad.push(`${name} collider outside bounds`); break; }
    }
    assert(bad.length === 0, bad.slice(0, 6).join(', '));
    return `${MAKERS.length - 11} makers, every collider inside its own geometry`;
  });

  /* ══ palette ═════════════════════════════════════════════════════════ */

  check('palette: the greys are actually different greys', () => {
    // "A place needs more than one grey" was the comment; duracrete and
    // duracreteWarm were 17% apart in luminance and 0.027 apart in chroma,
    // which is one material with a rounding error.
    const M = propMaterials();
    // measure straight off the material colour × its map's mean, via the same
    // table Textures.js publishes
    const MAPOF = { duracrete: 'duracrete', duracreteWarm: 'duracrete', duracreteDark: 'duracrete',
      wood: 'duracrete', sandstone: 'rock', stone: 'rock', stoneDark: 'rock',
      hull: 'armor', panel: 'armor', paint: 'armor', paintPale: 'armor',
      crate: 'metal', crateDark: 'metal', darkSteel: 'metal', steel: 'metal', rust: 'metal' };
    const alb = {};
    for (const [k, s] of Object.entries(MAPOF)) {
      const c = M[k].color, mm = MEAN_ALBEDO[s];
      alb[k] = [c.r * mm[0], c.g * mm[1], c.b * mm[2]];
    }
    const lumOf = (a) => a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    const dirOf = (a) => { const s = a[0] + a[1] + a[2]; return [a[0] / s, a[1] / s, a[2] / s]; };
    const fam = ['duracrete', 'duracreteWarm', 'duracreteDark', 'sandstone', 'stone', 'stoneDark'];
    let worst = null;
    for (let i = 0; i < fam.length; i++) for (let j = i + 1; j < fam.length; j++) {
      const A = alb[fam[i]], B = alb[fam[j]];
      const dl = Math.abs(lumOf(A) - lumOf(B)) / Math.max(lumOf(A), lumOf(B));
      const da = dirOf(A), db = dirOf(B);
      const dc = Math.hypot(da[0] - db[0], da[1] - db[1], da[2] - db[2]);
      const sep = dl + dc * 3;
      if (!worst || sep < worst.sep) worst = { sep, a: fam[i], b: fam[j], dl, dc };
    }
    assert(worst.sep > 0.35, `${worst.a} and ${worst.b} are ${(worst.dl * 100).toFixed(0)}% / ${worst.dc.toFixed(3)} apart — one material twice`);

    // nothing may be a hole in the ground, and nothing may be paper
    const bad = [];
    for (const [k, a] of Object.entries(alb)) {
      const l = lumOf(a);
      if (l < 0.085) bad.push(`${k} ${l.toFixed(3)} (a hole)`);
      if (l > 0.52) bad.push(`${k} ${l.toFixed(3)} (paper)`);
    }
    assert(bad.length === 0, bad.join(', '));

    // and rock must stay in the same family as the ground it lies on: sand is
    // 0.578/0.398/0.190, so a blue-biased boulder reads as a different planet
    for (const k of ['stone', 'sandstone', 'stoneDark']) {
      assert(alb[k][0] > alb[k][2] * 1.25, `${k} is not warm — r/b ${(alb[k][0] / alb[k][2]).toFixed(2)} against sand's 3.0`);
    }
    return `closest pair ${worst.a}/${worst.b} Δlum ${(worst.dl * 100).toFixed(0)}% Δchroma ${worst.dc.toFixed(3)}; ` +
      `luminance ${Object.values(alb).map(lumOf).sort((x, y) => x - y)[0].toFixed(2)}–${Object.values(alb).map(lumOf).sort((x, y) => y - x)[0].toFixed(2)}`;
  });

  check('props: a scattered field of crates is not one crate forty times', () => {
    const w = stubWorld();
    const tones = [];
    for (let i = 0; i < 20; i++) {
      const p = makeCrate(w, V(i * 2, 0.5, 0), 0.75);
      const c = p.mesh.geometry.attributes.color;
      assert(c, 'a crate reached the scene with no vertex colour');
      let m = 0;
      for (let v = 0; v < c.count; v++) m += (c.getX(v) + c.getY(v) + c.getZ(v)) / 3;
      tones.push(m / c.count);
    }
    const mean = tones.reduce((a, b) => a + b, 0) / tones.length;
    const sd = Math.sqrt(tones.reduce((a, b) => a + (b - mean) ** 2, 0) / tones.length);
    near(mean, 1.0, 0.09, 'crate weathering shifted the mean albedo');
    assert(sd > 0.02, `twenty crates vary by ${(sd * 100).toFixed(1)}%`);
    return `20 crates, mean ${mean.toFixed(3)}, piece-to-piece ${(sd * 100).toFixed(1)}%`;
  });
}

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
