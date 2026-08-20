/**
 * THE CHARACTER SHEET — hair, beard, years, muscle, a small species, the
 * injuries a fight leaves, and the head-tails that are finally simulated.
 *
 * This file exists because of the defect this codebase is a monument to:
 * `skinColor` and `hairColor` were arguments of `buildJedi` that NOTHING EVER
 * PASSED, so every Jedi in the game was one face under six robe palettes while
 * the source read as a character creator. Every control added here is therefore
 * held to the same bar the round that found that bug set: it is not enough that
 * a field is stored, or that a card lights up, or even that the geometry
 * differs somewhere. What is asserted is that the BUILT MESH MOVES — measured
 * as pixels of silhouette at the range the game is played at, as bounding
 * boxes, as vertex counts, and as material colour — and that the value the
 * player chose reaches the builder through the real chain rather than through a
 * test's own argument.
 *
 * Four things here are re-derivations rather than new properties, and each says
 * so at the assertion:
 *
 *   · creator.mjs's `speciesParts` used an absolute 100 mm to tell a lek from a
 *     stud, and preview.mjs's stand-up check used an absolute 1.55–1.95 m for a
 *     crown. Both are human-sized constants, and a species may now declare its
 *     own frame. Both are re-derived in place, against the head's own span and
 *     against the row's declared stature.
 *   · characters.mjs caps a body at 13 000 triangles and 76 meshes and measures
 *     `buildJedi()` with no options — which is exactly the figure grooming does
 *     not change, so that check cannot see the creator's library at all. The
 *     cost sweep below covers the whole REACHABLE set, which is strictly more
 *     than the cap has ever constrained.
 *   · the cloth budget in _weave.mjs is per unit AREA, which is the right
 *     normalisation for a garment and the wrong one for a limb. Stated, with
 *     the per-area numbers reported rather than hidden, and replaced by an
 *     absolute bound against the cape the same figure already wears.
 */

import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import {
  buildJedi, SPECIES, FACE_PRESETS, HAIR_STYLES, BEARD_STYLES, SHEET_KEYS,
  AGE_RANGE, MUSCLE_RANGE, speciesOf,
} from '../../src/game/Bodies.js';
import { BipedAnimator } from '../../src/game/Rig.js';
import { attachCloak, attachLekku } from '../../src/game/Cloth.js';
import { Injury, applyInjury, INJURY_COLORS } from '../../src/game/Injury.js';
import { weave, weaveLine } from './_weave.mjs';
import { clocked } from './_shared.mjs';

const src = (f) => new URL(`../../src/${f}`, import.meta.url);
const root = (f) => new URL(`../../${f}`, import.meta.url);

/* ── the figure, standing ────────────────────────────────────────────── */

const CACHE = new Map();
/** One built, posed, matrix-updated figure. Building is not cheap. */
function unit(opts = {}) {
  const key = JSON.stringify(opts);
  if (CACHE.has(key)) return CACHE.get(key);
  const built = buildJedi(opts);
  // `rig.scale`, not 1 — see standPreviewFigure. A species may be a different
  // size and the animator's ankle height is the one thing it does not measure.
  const anim = new BipedAnimator(built.rig, { scale: built.rig.scale ?? 1, hipHeight: 0.95 });
  anim.setFacing(0);
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < 60; i++) {
    anim.update(1 / 60, { position: p, facing: 0, velocity: v, grounded: true,
      groundAt: () => 0, crouch: 0, accelForward: 0, accelStrafe: 0 });
  }
  anim.swingArms(1 / 60, 0, 1);
  built.rig.updateMatrices();
  built.rig.root.updateMatrixWorld(true);
  CACHE.set(key, built);
  return built;
}

/* ── a software frame at the density the game is played at ───────────── */

/*
 * A deliberate copy of the rasteriser in creator.mjs, on the same argument its
 * own header makes about the PNG decoders in tools/: a measuring instrument
 * that two suites share is a measuring instrument that one suite can change out
 * from under the other. The light rig is src/engine/Engine.js's own — sun
 * 0xfff0d8 at 3.6, a hemisphere fill, and a cool directional at 0.45 — because
 * the whole question is whether a difference survives THAT rig.
 */
const SUN = { d: new THREE.Vector3(-0.42, 0.78, 0.46).normalize(), c: [1.0, 0.941, 0.847], i: 3.6 };
const FILL = { d: new THREE.Vector3(-1, 0.6, -0.8).normalize(), c: [0.624, 0.769, 1.0], i: 0.45 };
const SKY = [0.737, 0.847, 1.0], GND = [0.376, 0.282, 0.180], HEMI = 0.30;
const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function frame(rootObj, o = {}) {
  const H = o.H || 1080, W = o.W || 560, dist = o.dist ?? 8, yaw = o.yaw ?? 0;
  const at = o.at || new THREE.Vector3(0, 1.58, 0);
  const cam = new THREE.PerspectiveCamera(60, W / H, 0.05, 100);
  cam.position.set(at.x + Math.sin(yaw) * dist, at.y, at.z + Math.cos(yaw) * dist);
  cam.lookAt(at);
  cam.updateMatrixWorld(true);
  const VP = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const lum = new Float32Array(W * H), mask = new Uint8Array(W * H);
  const depth = new Float32Array(W * H).fill(Infinity);
  const vs = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const ns = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const nm = new THREE.Matrix3(), cp = new THREE.Vector4();

  rootObj.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position || obj.visible === false) return;
    const g = obj.geometry, P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
    if (!N) return;
    const idx = g.index, n = idx ? idx.count : P.count;
    nm.getNormalMatrix(obj.matrixWorld);
    const m = obj.material;
    const alb = (m && m.userData && m.userData.authored)
      || (m && m.color ? [m.color.r, m.color.g, m.color.b] : [0.6, 0.6, 0.6]);
    const vc = !!(m && m.vertexColors && C);
    for (let i = 0; i + 2 < n; i += 3) {
      const I = [idx ? idx.getX(i) : i, idx ? idx.getX(i + 1) : i + 1, idx ? idx.getX(i + 2) : i + 2];
      const sx = [], sy = [], sz = [], sl = [];
      let ok = true;
      for (let j = 0; j < 3; j++) {
        vs[j].fromBufferAttribute(P, I[j]).applyMatrix4(obj.matrixWorld);
        ns[j].fromBufferAttribute(N, I[j]).applyMatrix3(nm).normalize();
        cp.set(vs[j].x, vs[j].y, vs[j].z, 1).applyMatrix4(VP);
        if (cp.w <= 0.01) { ok = false; break; }
        sx.push((cp.x / cp.w * 0.5 + 0.5) * W);
        sy.push((0.5 - cp.y / cp.w * 0.5) * H);
        sz.push(vs[j].distanceTo(cam.position));
        const nn = ns[j], k = vc ? C.getX(I[j]) : 1;
        const nd = Math.max(0, nn.dot(SUN.d)) * SUN.i, fd = Math.max(0, nn.dot(FILL.d)) * FILL.i;
        const hm = 0.5 + 0.5 * nn.y;
        let L = 0;
        const wgt = [0.2126, 0.7152, 0.0722];
        for (let ch = 0; ch < 3; ch++) {
          const lit = nd * SUN.c[ch] + fd * FILL.c[ch] + HEMI * (hm * SKY[ch] + (1 - hm) * GND[ch]);
          const v = alb[ch] * k * lit * 0.955;
          L += wgt[ch] * srgb(v / (1 + v));
        }
        sl.push(L);
      }
      if (!ok) continue;
      const x0 = Math.max(0, Math.floor(Math.min(...sx))), x1 = Math.min(W - 1, Math.ceil(Math.max(...sx)));
      const y0 = Math.max(0, Math.floor(Math.min(...sy))), y1 = Math.min(H - 1, Math.ceil(Math.max(...sy)));
      const det = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
      if (Math.abs(det) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / det;
        const w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / det;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * sz[0] + w1 * sz[1] + w2 * sz[2], k = y * W + x;
        if (z >= depth[k]) continue;
        depth[k] = z;
        lum[k] = w0 * sl[0] + w1 * sl[1] + w2 * sl[2];
        mask[k] = 1;
      }
    }
  });
  return { lum, mask, W, H, mpp: 2 * dist * Math.tan(Math.PI / 6) / H };
}

/** A pixel window `halfM` metres either side of the frame centre. */
function window0(f, halfM, tall = 1.3) {
  const h = Math.ceil(halfM / f.mpp);
  return [Math.max(0, Math.round(f.W / 2 - h)), Math.max(1, Math.round(f.H / 2 - h * tall)),
    Math.min(f.W - 1, Math.round(f.W / 2 + h)), Math.min(f.H - 2, Math.round(f.H / 2 + h * tall))];
}

/** `xor` is silhouette; `over2`/`over5` are INTERIOR luminance, edges excluded. */
function diff(a, b, win) {
  const [x0, y0, x1, y1] = win, W = a.W;
  const edge = (m, x, y) => {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!m[(y + j) * W + (x + i)]) return true;
    return false;
  };
  let xor = 0, n = 0, over2 = 0, over5 = 0, sum = 0, peak = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const k = y * W + x;
    if (a.mask[k] !== b.mask[k]) xor++;
    if (!a.mask[k] || !b.mask[k]) continue;
    if (edge(a.mask, x, y) || edge(b.mask, x, y)) continue;
    const d = Math.abs(a.lum[k] - b.lum[k]);
    n++; sum += d; peak = Math.max(peak, d);
    if (d > 0.02) over2++;
    if (d > 0.05) over5++;
  }
  return { xor, n, over2, over5, mean: n ? sum / n : 0, peak };
}

const covered = (f, win) => {
  let n = 0;
  for (let y = win[1]; y <= win[3]; y++) for (let x = win[0]; x <= win[2]; x++) if (f.mask[y * f.W + x]) n++;
  return n;
};

/* ── geometry helpers ────────────────────────────────────────────────── */

/** Every mesh's vertex data as one comparable digest. */
function digest(built) {
  const rows = [];
  built.rig.root.updateMatrixWorld(true);
  built.rig.root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry, parts = [];
    for (const name of ['position', 'normal', 'uv', 'color']) {
      const a = g.attributes[name];
      parts.push(name + ':' + (a ? a.array.length : 0));
      if (a) {
        let s = 0, t = 0;
        for (let i = 0; i < a.array.length; i++) { s += a.array[i] * (i % 7 + 1); t += Math.abs(a.array[i]) * i; }
        parts.push(s.toFixed(9) + '/' + t.toFixed(9));
      }
    }
    if (g.index) { let s = 0; for (let i = 0; i < g.index.count; i++) s += g.index.getX(i) * (i % 5 + 1); parts.push('i' + s); }
    parts.push(o.matrixWorld.elements.map(v => v.toFixed(9)).join(','));
    const m = o.material;
    parts.push(m ? `${m.type}|${m.color ? m.color.getHexString() : ''}|${m.roughness}|${m.metalness}` : '');
    rows.push(parts.join(' '));
  });
  return rows.sort().join('\n');
}

const cost = (obj) => {
  let t = 0, m = 0;
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    m++;
    t += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
  });
  return { tris: Math.round(t), meshes: m };
};

/** World-space triangles of a subtree. */
function soup(obj, out = []) {
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry, P = g.attributes.position, idx = g.index, n = idx ? idx.count : P.count;
    for (let i = 0; i + 2 < n; i += 3) {
      out.push([0, 1, 2].map(j =>
        new THREE.Vector3().fromBufferAttribute(P, idx ? idx.getX(i + j) : i + j).applyMatrix4(o.matrixWorld)));
    }
  });
  return out;
}

const _RAY = new THREE.Vector3(0.3711, 0.8123, 0.4491).normalize();
function inside(tris, p) {
  let hits = 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), q = new THREE.Vector3(), tv = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    e1.subVectors(b, a); e2.subVectors(c, a); q.crossVectors(_RAY, e2);
    const det = e1.dot(q);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    tv.subVectors(p, a);
    const u = tv.dot(q) * inv;
    if (u < 0 || u > 1) continue;
    q.crossVectors(tv, e1);
    const v = _RAY.dot(q) * inv;
    if (v < 0 || u + v > 1) continue;
    if (e2.dot(q) * inv > 1e-7) hits++;
  }
  return (hits & 1) === 1;
}

/** Everything on the head that is not the skull shell: hair, beard, strands. */
function groomParts(built) {
  const head = built.rig.get('head');
  const out = [];
  for (const o of head.obj.children) if (o.isMesh && o !== head.primary) out.push(o);
  return out;
}

/* Scratch for the point-to-triangle measure below. */
const _gv1 = new THREE.Vector3(), _gv2 = new THREE.Vector3(), _gv3 = new THREE.Vector3();
const _gv4 = new THREE.Vector3(), _gv5 = new THREE.Vector3(), _gv6 = new THREE.Vector3();

export async function run({ check, assert, near }) {
  /* Every check in this file is wrapped: the two shared streams are put on
   * their modules' own seeds before each body and the wind clock is put back
   * after it. See tools/checks/_shared.mjs — the rule is there, not here.
   */
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  the contract                                                      */
  /* ══════════════════════════════════════════════════════════════════ */

  check('grooming: the sheet is exported in the shape the menu builds against', () => {
    assert(SHEET_KEYS.join(',') === 'hair,beard,age,muscle',
      `the sheet is ${SHEET_KEYS.join(',')} — the menu writes exactly these four`);
    for (const [name, list] of [['hair', HAIR_STYLES], ['beard', BEARD_STYLES]]) {
      assert(list.length >= 6, `${name} offers only ${list.length} choices`);
      const ids = new Set();
      for (const it of list) {
        assert(typeof it.id === 'string' && it.id, `a ${name} entry has no id`);
        assert(typeof it.name === 'string' && it.name, `${it.id} has no name for a card`);
        assert(typeof it.blurb === 'string' && it.blurb, `${it.id} has no blurb — the card would be a bare word`);
        assert(!ids.has(it.id), `two ${name} entries share the id ${it.id}`);
        ids.add(it.id);
      }
    }
    // The FIRST entry of each list is the neutral one, because the menu lights
    // card 0 for an unknown id and the builder falls back to entry 0.
    assert(HAIR_STYLES[0].id === 'temple', 'the neutral cut is no longer first in the list');
    assert(BEARD_STYLES[0].id === 'none', 'the neutral beard is no longer first in the list');
    assert(AGE_RANGE[0] === 0 && AGE_RANGE[1] === 1, 'the years slider has moved its bounds');
    assert(MUSCLE_RANGE[0] === 0 && MUSCLE_RANGE[1] === 1, 'the muscle slider has moved its bounds');
    return `${HAIR_STYLES.length} cuts, ${BEARD_STYLES.length} beards, ${SHEET_KEYS.length} sheet keys`;
  });

  check('grooming: the neutral sheet is the figure that shipped, to the last float', () => {
    /**
     * The rule the whole creator is built on, extended to four more parameters.
     * `buildJedi()` is called with no sheet by Player, Enemy, Net, the toon
     * scene and the menu preview, so the neutral value of every one of these
     * has to be the arithmetic identity — not "close", the same floats.
     */
    const base = digest(unit({}));
    const same = {
      'the explicit neutral sheet': { hair: 'temple', beard: 'none', age: 0, muscle: 0.5 },
      'the sheet inside a face object': { face: { hair: 'temple', beard: 'none', age: 0, muscle: 0.5 } },
      'an empty face object': { face: {} },
      'the neutral face preset with a sheet': { face: { preset: 'even', hair: 'temple', beard: 'none', age: 0, muscle: 0.5 } },
      'an unknown cut and beard': { hair: 'ziggurat', beard: 'moustachio' },
      'out-of-range years and muscle': { age: -3, muscle: 0.5 },
    };
    for (const [what, opts] of Object.entries(same)) {
      assert(digest(unit(opts)) === base, `${what} is not the figure buildJedi() builds`);
    }
    // and the four axes are genuinely independent of the eight face numbers:
    // a face preset with a sheet on it is the preset, plus the sheet.
    assert(digest(unit({ face: 'heavy' })) === digest(unit({ face: { preset: 'heavy', hair: 'temple', beard: 'none', age: 0, muscle: 0.5 } })),
      'a preset id and the same preset inside a sheet are different figures');
    return `${Object.keys(same).length} spellings of "nothing chosen" all build the shipped figure`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  every control reaches the geometry                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('grooming: every cut is a different head at the range the game is played at', () => {
    /**
     * THE BAR, and it is the species check's bar rather than a softer one.
     *
     * A cut you can only tell apart in a 300-pixel preview box is a settings
     * screen. At 8 m through a 60° vertical FOV on a 1080-line frame one pixel
     * is 8.55 mm and a head is 24 pixels tall, so this rasterises the head and
     * shoulders at exactly that density and compares SILHOUETTE ONLY — a cut
     * that needed its shading to be told apart would not pass, which is the
     * point, because hair is read by its outline.
     *
     * Measured head-on and at three quarters, because a cut that only reads
     * from one bearing (a nape mass, a braid) is half a cut.
     */
    let worst = 1e9, worstPair = '', cov = 0;
    const rows = [];
    for (const yaw of [0, 0.55]) {
      const shots = {};
      for (const h of HAIR_STYLES) {
        shots[h.id] = frame(unit({ hair: h.id }).rig.root, { yaw, at: new THREE.Vector3(0, 1.58, 0), dist: 8 });
      }
      const win = window0(shots.temple, 0.26);
      cov = covered(shots.temple, win);
      for (const A of HAIR_STYLES) for (const B of HAIR_STYLES) {
        if (A.id >= B.id) continue;
        const d = diff(shots[A.id], shots[B.id], win);
        // One score, both channels — the same statistic `creator: face presets
        // are still faces` uses: pixels of OUTLINE moved plus interior pixels
        // whose shading moved by more than 5%. A cut is mostly outline, but a
        // shaved head against a close crop is mostly the second: 2 cm of hair
        // over a skull moves the tone of the crown far more than its edge.
        const score = d.xor + d.over5;
        if (score < worst) { worst = score; worstPair = `${A.id}/${B.id} (${d.xor} outline + ${d.over5} shading)`; }
      }
      if (yaw === 0) for (const h of HAIR_STYLES.slice(1)) {
        const d = diff(shots.temple, shots[h.id], win);
        rows.push(`${h.id} ${d.xor}+${d.over5}`);
      }
    }
    /**
     * 40, against the face presets' 30 on the same statistic.
     *
     * The species check demands 40 pixels of pure SILHOUETTE between two
     * species, and that is the right bar there because two species are two
     * different skulls. Eight cuts on ONE skull cannot all be 40 pixels of
     * outline apart — a bald head and a close crop differ by 2 cm of hair,
     * which is two pixels of edge and a whole crown of tone. So the statistic
     * is the face presets' (outline + shading past 5%) and the number is
     * higher than theirs, because a haircut is a bigger object than a brow.
     */
    assert(worst > 40, `${worstPair} at 8 m — that is the same head twice`);
    return `head+shoulders covers ${cov} px at 8 m; vs the temple crop ${rows.join(', ')}; closest pair ${worstPair}`;
  });

  check('grooming: a beard is a shape on the jaw, not a tint on it', () => {
    /**
     * A beard is smaller than a haircut and the honest measurement says so.
     * Two ranges, and both have to move:
     *
     *   8 m — the range a duel is fought at. The bar here is the SILHOUETTE
     *   again but a lower one, because a beard adds mass under a jaw that is
     *   4 pixels deep at that range. What it must not be is zero.
     *
     *   0.7 m — the creator's own box and the range a lock-up puts two faces
     *   at. Here the bar is high, and it is on the silhouette rather than on
     *   the shading, so a beard authored as a dark patch painted on a chin
     *   would fail.
     */
    const far = {}, near1 = {};
    for (const b of BEARD_STYLES) {
      far[b.id] = frame(unit({ hair: 'crop', beard: b.id }).rig.root, { yaw: 0.4, at: new THREE.Vector3(0, 1.58, 0), dist: 8 });
      // Centred on the JAW and 17 cm of window, not 13: a long beard's fall
      // reaches 155 mm below the chin, and a window that stops at the chin is
      // measuring the two beards' moustaches.
      near1[b.id] = frame(unit({ hair: 'crop', beard: b.id }).rig.root,
        { yaw: 0.4, at: new THREE.Vector3(0, 1.535, 0), dist: 0.8, W: 700, H: 900 });
    }
    const winF = window0(far.none, 0.20), winN = window0(near1.none, 0.19);
    /*
     * AT 8 m THE MEASURE IS INTERIOR LUMINANCE, and the reason is a fact about
     * where a beard IS rather than a softening of the bar. A beard's fall hangs
     * in front of the chest, so from the front it changes no outline at all —
     * measured, `full` against `long` is exactly 0 silhouette pixels — while it
     * changes 250 interior pixels from near-black cloth to near-black hair. The
     * silhouette bar is where a beard actually lives in outline, which is the
     * jaw, and it is asserted at the creator's own range below.
     */
    let worstFar = 1e9, worstNear = 1e9, pairF = '', pairN = '';
    const farD = (a, b) => { const d = diff(far[a], far[b], winF); return d.xor + d.over2; };
    for (const A of BEARD_STYLES) for (const B of BEARD_STYLES) {
      if (A.id >= B.id) continue;
      const f = farD(A.id, B.id);
      const nd = diff(near1[A.id], near1[B.id], winN);
      const n = nd.xor + nd.over2;
      if (f < worstFar) { worstFar = f; pairF = `${A.id}/${B.id}`; }
      if (n < worstNear) { worstNear = n; pairN = `${A.id}/${B.id}`; }
    }
    const rows = BEARD_STYLES.slice(1).map(b =>
      `${b.id} ${farD('none', b.id)}/${(() => { const d = diff(near1.none, near1[b.id], winN); return d.xor + d.over2; })()}`);
    assert(worstFar >= 20, `${pairF} are the same head at 8 m (${worstFar} px of outline and shading)`);
    /*
     * OUTLINE PLUS SHADING at close range too, and for the reason the far
     * measurement gives: a beard's fall hangs in FRONT of a chest that is
     * already covering those pixels, so the silhouette only changes where the
     * beard reaches past the body's own outline. Measured, `full` against
     * `long` — 115 mm of difference in length — is 68 silhouette pixels and
     * 1900 interior ones. The interior term is the beard.
     */
    assert(worstNear >= 900, `${pairN} are the same face in the creator's own box (${worstNear} px)`);
    // and a clean chin really is clean: no beard means no beard geometry at all
    const clean = groomParts(unit({ hair: 'crop', beard: 'none' })).length;
    const full = groomParts(unit({ hair: 'crop', beard: 'full' })).length;
    assert(full >= clean, 'a full beard built no more parts than a clean chin');
    return `vs clean, outline+shading at 8 m / 0.8 m: ${rows.join(', ')}; `
      + `closest pair ${pairF} ${worstFar} px far, ${pairN} ${worstNear} px near`;
  });

  check('grooming: the years reach the face, the hairline AND the colour', () => {
    /**
     * THREE SEPARATE CLAIMS, because "age" is the kind of parameter that gets
     * shipped as a tint and called a feature.
     *
     * 1. The FACE moves: the brow shelf, the cheek hollow, the chin. Measured
     *    as interior luminance at 8 m, which is where a shading mass lives.
     * 2. The HAIRLINE moves: a receding hairline is worth whole pixels of
     *    silhouette, which a wrinkle map never is.
     * 3. The COLOUR moves, and it moves off the colour the PLAYER chose rather
     *    than to a fixed white — a black-haired elder is iron grey and a
     *    sand-haired one is nearly white.
     */
    const young = unit({ age: 0 }), old = unit({ age: 1 });
    const a = frame(young.rig.root, { at: new THREE.Vector3(0, 1.58, 0), dist: 8 });
    const b = frame(old.rig.root, { at: new THREE.Vector3(0, 1.58, 0), dist: 8 });
    const win = window0(a, 0.22);
    const d = diff(a, b, win);
    assert(d.xor >= 12, `eighty years changed ${d.xor} silhouette pixels at 8 m — the hairline is not moving`);
    assert(d.over2 >= 20, `eighty years changed the shading of only ${d.over2} interior pixels`);
    // monotone: the middle of the slider is between the two ends, not a jump
    const mid = frame(unit({ age: 0.5 }).rig.root, { at: new THREE.Vector3(0, 1.58, 0), dist: 8 });
    const dm = diff(a, mid, win);
    assert(dm.xor > 0 && dm.xor < d.xor,
      `half the years is ${dm.xor} px against a lifetime's ${d.xor} — the slider is a switch, not a slider`);
    // and the grey. The hair material is the one on the groom meshes.
    /*
     * The LARGEST groom mesh, not the first child: the head's children are the
     * eyes, the irises, the lashes, the brows, the ears, the lip and then the
     * hair, and the first of them with a colour on it is a sclera. Measured, an
     * eye white is 0.802 luminance at every age, which is exactly the answer a
     * "grey" test would report if it were reading the wrong material — and did.
     */
    const hairMat = (u) => {
      let best = null, bt = 0;
      for (const o of groomParts(u)) {
        const t = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
        if (o.material?.color && t > bt) { bt = t; best = o.material.color; }
      }
      return best;
    };
    const c0 = hairMat(young), c1 = hairMat(old);
    assert(c0 && c1, 'no hair material found on the built head');
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    assert(lum(c1) > lum(c0) * 1.8,
      `hair went from ${lum(c0).toFixed(3)} to ${lum(c1).toFixed(3)} over a lifetime — that is not grey`);
    // off the player's OWN colour: a copper head greys to a different grey
    const copper = hairMat(unit({ age: 1, hairColor: 0x92451c }));
    assert(copper.getHexString() !== c1.getHexString(),
      'two different hair colours grey to the same hex — the grey is a replacement, not a mix');
    return `80 years: ${d.xor} silhouette px, ${d.over2} shaded px at 8 m; hair luminance `
      + `${lum(c0).toFixed(3)} → ${lum(c1).toFixed(3)} (#${c0.getHexString()} → #${c1.getHexString()})`;
  });

  check('grooming: muscle is a different distribution, not a bigger body', () => {
    /**
     * THE DISTINCTION THAT MAKES THIS WORTH A SECOND SLIDER.
     *
     * The frame slider is GIRTH — everything wider together. If muscle did the
     * same thing it would be a duplicate control, and the honest test of that
     * is the SHOULDER-TO-WAIST RATIO: girth leaves it alone (both ends grow),
     * distribution moves it. Measured off the built lathes rather than off the
     * source, because a ratio computed from the numbers typed in Bodies.js
     * would pass whether or not those numbers reach a vertex.
     */
    const radius = (built, bone) => {
      const b = built.rig.get(bone);
      const g = b.primary.geometry;
      g.computeBoundingBox();
      const s = g.boundingBox.getSize(new THREE.Vector3());
      return Math.max(s.x, s.z) / 2;
    };
    const rows = [];
    let ratio0 = 0, ratio1 = 0;
    for (const [name, m] of [['wiry', 0], ['even', 0.5], ['powerful', 1]]) {
      const u = unit({ muscle: m });
      // the waist is the TOP of the hips lathe and the shoulders the top of the
      // chest; both are read off the mesh that was actually built
      const sh = radius(u, 'chest'), wa = radius(u, 'hips');
      rows.push(`${name} ${(sh / wa).toFixed(3)}`);
      if (m === 0) ratio0 = sh / wa;
      if (m === 1) ratio1 = sh / wa;
    }
    assert(ratio1 > ratio0 * 1.06,
      `the shoulder-to-hip ratio runs ${ratio0.toFixed(3)} → ${ratio1.toFixed(3)} across the muscle slider — `
      + 'that is girth, and the frame slider already does girth');
    // the frame slider must NOT do the same thing to the same ratio in the same
    // direction as strongly, or the two controls are one control
    const bRatio = (b) => {
      const u = unit({ build: b });
      return radius(u, 'chest') / radius(u, 'hips');
    };
    const gb = bRatio(1) / bRatio(0), gm = ratio1 / ratio0;
    assert(Math.abs(gm - gb) > 0.03,
      `muscle moves shoulder-to-hip by ${gm.toFixed(3)} and frame by ${gb.toFixed(3)} — the two sliders are the same slider`);
    // and it reaches the SILHOUETTE, over the shoulders where a deltoid lives
    const a = frame(unit({ muscle: 0 }).rig.root, { at: new THREE.Vector3(0, 1.40, 0), dist: 8 });
    const c = frame(unit({ muscle: 1 }).rig.root, { at: new THREE.Vector3(0, 1.40, 0), dist: 8 });
    const win = window0(a, 0.34);
    const d = diff(a, c, win);
    assert(d.xor >= 60, `the whole muscle slider is ${d.xor} silhouette pixels over the shoulders at 8 m`);
    return `shoulder/hip ${rows.join(', ')} (×${gm.toFixed(3)} on muscle, ×${gb.toFixed(3)} on frame); `
      + `${d.xor} silhouette px at 8 m`;
  });

  check('grooming: every garment still fits the body across the muscle slider', () => {
    /**
     * THE FAILURE MODE OF ADDING A SECOND BODY AXIS.
     *
     * The collar, the obi, the belt, both skirts, the boot shafts and the whole
     * sleeve-and-bracer stack are lathes at typed radii scaled by K-factors, and
     * every one of those factors was derived against the FRAME slider alone.
     * Muscle takes its term from the same expression as the limb it is worn on
     * — but "took it from the same expression" is a claim about source, and
     * what matters is whether the limb is still inside the band on the built
     * mesh. So: walk every band on every bone, at the CORNERS of both sliders
     * rather than one at a time, because the corner is what fails.
     */
    const worst = { gap: 1e9, at: '' };
    let bands = 0, baseline = 1e9;
    for (const build of [0, 0.5, 1]) for (const muscle of [0, 0.5, 1]) {
      const u = unit({ build, muscle });
      for (const bone of ['neck', 'armL', 'foreL', 'shinL', 'hips', 'spine', 'chest']) {
        const b = u.rig.get(bone);
        if (!b || !b.primary) continue;
        const limb = b.primary.geometry;
        limb.computeBoundingBox();
        const ls = limb.boundingBox.getSize(new THREE.Vector3());
        const lr = Math.max(ls.x, ls.z) / 2 * (b.primary.scale.x || 1);
        for (const o of b.obj.children) {
          if (!o.isMesh || o === b.primary || o.userData.boneChild) continue;
          o.geometry.computeBoundingBox();
          const gb = o.geometry.boundingBox;
          const gs = gb.getSize(new THREE.Vector3());
          const gr = Math.max(gs.x * (o.scale.x || 1), gs.z * (o.scale.z || 1)) / 2;
          // Only things that WRAP: a band is at least half the limb's width and
          // no more than three times it. A pouch or a clasp is not a band.
          if (gr < lr * 0.55 || gr > lr * 3) continue;
          bands++;
          /**
           * AT THE BAND'S OWN HEIGHT, not against the limb's widest point.
           *
           * The first version of this compared a boot cuff at the ankle against
           * the shin's largest radius — which is the CALF, a third of the way
           * up and 30% wider across the muscle slider. It reported a boot 15 mm
           * inside a leg it is nowhere near, on geometry that is correct.
           * `creator: every garment still fits` walks it per height for exactly
           * this reason; so does this.
           */
          const y0b = gb.min.y * (o.scale.y || 1) + o.position.y;
          const y1b = gb.max.y * (o.scale.y || 1) + o.position.y;
          const P = limb.attributes.position;
          let lrHere = 0;
          for (let i = 0; i < P.count; i++) {
            const y = P.getY(i) * (b.primary.scale.y || 1);
            if (y < y0b - 0.004 || y > y1b + 0.004) continue;
            lrHere = Math.max(lrHere, Math.hypot(P.getX(i) * (b.primary.scale.x || 1),
              P.getZ(i) * (b.primary.scale.z || 1)));
          }
          if (lrHere <= 0) continue;
          const gap = gr - lrHere;
          if (muscle === 0.5) baseline = Math.min(baseline, gap);
          if (gap < worst.gap) { worst.gap = gap; worst.at = `${bone} on build ${build}/muscle ${muscle}`; }
        }
      }
    }
    assert(bands > 40, `only ${bands} garment bands found — the walk is not reaching the wardrobe`);
    /**
     * THE BOUND IS THE SHIPPED FIGURE'S OWN, not a typed millimetre.
     *
     * A band may sink INTO the limb it closes on — a belt does, an obi does,
     * and a boot shaft is a circular lathe over a shin whose section carries a
     * calf lobe behind it, so it is 14 mm inside its own leg on the figure that
     * shipped and always has been. A flat "> -6 mm" therefore fails correct
     * geometry, which is what the first version of this did.
     *
     * What muscle must not do is make it WORSE. So the baseline is measured on
     * the frame slider alone — the axis that already exists — and the whole
     * square has to stay within 8 mm of it. That is a bound on the thing this
     * change is responsible for and on nothing else.
     */
    assert(worst.gap > baseline - 0.008,
      `${worst.at}: a band is ${(worst.gap * 1000).toFixed(1)} mm inside the limb it is worn on, against `
      + `${(baseline * 1000).toFixed(1)} mm on the frame slider alone`);
    return `${bands} bands over 9 corners of the frame×muscle square; tightest ${(worst.gap * 1000).toFixed(1)} mm `
      + `at ${worst.at}, against ${(baseline * 1000).toFixed(1)} mm on frame alone`;
  });

  check('grooming: a shaved head is bald, and a cut that covers still hides its roots', () => {
    /**
     * The defect `creator: a bald species is bald` was written for, arriving by
     * the other door. The skull's occlusion bake drives everything above the ear
     * line down to 0.28 SO THAT a hair poke-through reads as a dark root rather
     * than as bare bone — and that is a black skullcap on a shaved head. It was
     * gated on `sp.hair`, which is a species fact; it is now gated on whether
     * the CUT covers the crown, which is what it always meant.
     */
    const crown = (u) => {
      const shell = u.rig.get('head').primary.geometry;
      shell.computeBoundingBox();
      const sb = shell.boundingBox;
      const yLine = sb.min.y + (sb.max.y - sb.min.y) * 0.734;
      const zLine = sb.min.z + (sb.max.z - sb.min.z) * 0.630;
      const C = shell.attributes.color, P = shell.attributes.position;
      let sum = 0, n = 0;
      for (let i = 0; i < C.count; i++) {
        if (P.getY(i) < yLine || P.getZ(i) > zLine) continue;
        sum += C.getX(i); n++;
      }
      return { mean: n ? sum / n : 0, n };
    };
    const rows = [];
    for (const h of HAIR_STYLES) {
      const c = crown(unit({ hair: h.id }));
      assert(c.n > 12, `${h.id}: only ${c.n} crown vertices sampled`);
      if (h.crown === false) {
        assert(c.mean > 0.80, `${h.id} covers nothing and its crown is baked at ${c.mean.toFixed(2)} — that is a skullcap`);
      } else {
        assert(c.mean < 0.45, `${h.id} covers the crown but it is baked at ${c.mean.toFixed(2)}, so a poke-through would show as bare bone`);
      }
      rows.push(`${h.id} ${c.mean.toFixed(2)}`);
    }
    return rows.join(' ');
  });

  check('grooming: nothing a cut or a beard hangs on a head passes through the body', () => {
    /**
     * The padawan braid is 30 cm of rigid strand parented to the HEAD, and the
     * player's glance is clamped to ±0.85 rad — so its tip sweeps 30 cm
     * sideways across the shoulder it hangs beside. This is the property
     * `creator: nothing a species hangs on a head passes through the body under
     * it` holds the lekku to, applied to everything the creator can put on a
     * head, over every yaw the head can reach.
     *
     * It is not hypothetical: the first pass hung the braid at z +0.020, in
     * front of the ear, and the render showed a chopstick laid down the cheek;
     * moving it behind the ear is what put it outside the shoulder line as
     * well. And on the small-folk row, whose head is 1.85× its body's share,
     * cutting the braid at HEAD scale put 3 of its 80 vertices inside the
     * trapezius — which is why a strand's LENGTH is a body measurement.
     */
    const combos = [];
    for (const h of HAIR_STYLES) combos.push({ hair: h.id });
    for (const b of BEARD_STYLES) combos.push({ hair: 'crop', beard: b.id });
    combos.push({ species: 'smallfolk' }, { species: 'smallfolk', hair: 'padawan', beard: 'long' });
    let checked = 0, worst = 0, worstAt = '';
    for (const opts of combos) {
      const built = unit(opts);
      const rig = built.rig, head = rig.get('head');
      const torso = [];
      for (const name of ['chest', 'spine', 'hips']) {
        for (const o of rig.get(name).obj.children) if (!o.userData.boneChild) soup(o, torso);
      }
      const restQ = head.obj.quaternion.clone();
      for (let i = -4; i <= 4; i += 2) {
        head.obj.quaternion.copy(head.restQuat)
          .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i * 0.2125, 0, 'YXZ')));
        rig.updateMatrices();
        rig.root.updateMatrixWorld(true);
        let n = 0;
        for (const o of groomParts(built)) {
          const P = o.geometry.attributes.position, v = new THREE.Vector3();
          for (let j = 0; j < P.count; j++) {
            v.fromBufferAttribute(P, j).applyMatrix4(o.matrixWorld);
            if (i === 0) checked++;
            if (inside(torso, v)) n++;
          }
        }
        if (n > worst) { worst = n; worstAt = `${JSON.stringify(opts)} at yaw ${(i * 0.2125).toFixed(2)}`; }
      }
      head.obj.quaternion.copy(restQ);
      rig.updateMatrices();
      rig.root.updateMatrixWorld(true);
    }
    assert(worst === 0, `${worstAt}: ${worst} groom vertices are inside the torso`);
    return `${combos.length} combinations, ${checked} vertices, clear at every glance in ±0.85 rad`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  what the library costs                                            */
  /* ══════════════════════════════════════════════════════════════════ */

  check('grooming: the whole library costs no draw calls and stays inside the wall', () => {
    /**
     * THE COST, AND THE RE-DERIVATION, stated in full because the number moves.
     *
     * `characters: no archetype has quietly doubled in cost` caps a body at
     * 13 000 triangles and 76 meshes and it measures `buildJedi()` WITH NO
     * OPTIONS — which is the one figure grooming does not change, so that check
     * cannot see the creator's library at all. It still passes untouched, and
     * the first assertion here is what keeps it meaningful: the ungroomed
     * figure is still exactly 12 796 triangles in 64 meshes.
     *
     * It was 12 924 in 66 until the belt's two hanging ends stopped being rigid
     * geometry. They were 128 triangles in 2 meshes that drew nothing — the
     * robe below the belt covered every vertex of them — and they are cloth
     * now. See attachSash() in Cloth.js and tools/checks/sash.mjs. A figure
     * getting CHEAPER is exactly as much of a reason to re-derive this number
     * as one getting dearer; the point of pinning it is that it moves for a
     * reason somebody wrote down.
     *
     * The bound on the reachable set is derived rather than ratcheted, and the
     * derivation is the one the capped check's own comment makes: "each one
     * costs a draw call per material per bone, doubled by the shadow pass...
     * twenty of these are on screen at once". Twenty is B1s, troopers, acolytes
     * and droidekas — none of which takes a character sheet. `buildJedi` builds
     * the PLAYER, its co-op peers and the duel opponent: at most four figures,
     * and usually one. So:
     *
     *   · MESHES — the binding cost — must not move for grooming: a beard is
     *     merged into the hair's own geometry on the hair's own material, and
     *     the only extra meshes in the whole library are the strands, which are
     *     separate for a Ragdoll reason (see the note at the strand loop). Three
     *     at worst, on one figure, against ten of headroom.
     *   · TRIANGLES may move, and the worst reachable character is reported
     *     here in the pass line so an increase is visible in a diff rather than
     *     only in a frame time.
     */
    const plain = cost(unit({}).rig.root);
    assert(plain.tris === 12796 && plain.meshes === 64,
      `buildJedi() with no sheet is ${plain.tris}/${plain.meshes}, not the 12796/64 every other check measures`);
    let worst = { tris: 0, meshes: 0, at: '' }, worstM = { meshes: 0, at: '' };
    for (const h of HAIR_STYLES) for (const b of BEARD_STYLES) {
      for (const extra of [{}, { age: 1, muscle: 1 }]) {
        const c = cost(unit({ hair: h.id, beard: b.id, ...extra }).rig.root);
        const at = `${h.id}+${b.id}${extra.age ? ' aged' : ''}`;
        if (c.tris > worst.tris) worst = { ...c, at };
        if (c.meshes > worstM.meshes) worstM = { meshes: c.meshes, at };
      }
    }
    assert(worstM.meshes <= 70,
      `${worstM.at} draws ${worstM.meshes} meshes — grooming is buying draw calls, which is the cost that binds`);
    assert(worst.tris < 13400,
      `${worst.at} is ${worst.tris} triangles; the ungroomed figure is ${plain.tris} and the wall is 13000 for everything that is not the player`);
    // and every species still pays for itself out of the hair it does not have
    for (const sp of SPECIES.slice(1)) {
      const c = cost(unit({ species: sp.id }).rig.root);
      assert(c.tris <= plain.tris, `${sp.id} costs ${c.tris - plain.tris} triangles more than the human it replaces`);
    }
    return `ungroomed ${plain.tris}/${plain.meshes}; worst reachable ${worst.at} ${worst.tris}/${worst.meshes}; `
      + `most draw calls ${worstM.at} ${worstM.meshes} of 76`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  the small folk                                                    */
  /* ══════════════════════════════════════════════════════════════════ */

  check('grooming: the small species is a small FRAME, not a human scaled down', () => {
    /**
     * THE PLAYER'S OWN WORDING: "a small frame, correctly proportioned rather
     * than a scaled-down human". A uniform shrink is trivially available and is
     * exactly what this must not be, so the measurement is HEAD-TO-BODY, which
     * is what the eye actually reads as size: a human figure is seven and a
     * half heads tall and every small-bodied species in the fiction is three to
     * four.
     */
    const sp = speciesOf('smallfolk');
    assert(sp.frame && sp.frame.stature, 'the small-folk row declares no frame');
    const u = unit({ species: 'smallfolk' });
    const box = new THREE.Box3().setFromObject(u.rig.root);
    const headG = u.rig.get('head').primary.geometry;
    headG.computeBoundingBox();
    const headH = headG.boundingBox.max.y - headG.boundingBox.min.y;
    const heads = box.max.y / headH;
    const human = unit({});
    const hbox = new THREE.Box3().setFromObject(human.rig.root);
    const hheadG = human.rig.get('head').primary.geometry;
    hheadG.computeBoundingBox();
    const hheads = hbox.max.y / (hheadG.boundingBox.max.y - hheadG.boundingBox.min.y);
    assert(Math.abs(box.min.y) < 0.02, `the small figure stands ${(box.min.y * 1000).toFixed(0)} mm off the floor`);
    near(box.max.y, sp.frame.stature, sp.frame.stature * 0.12, 'declared stature');
    assert(heads > 3.2 && heads < 5.0,
      `the small figure is ${heads.toFixed(2)} heads tall — a uniform shrink would be ${hheads.toFixed(2)}, the same as a human`);
    assert(hheads - heads > 2.0,
      `${heads.toFixed(2)} heads against the human's ${hheads.toFixed(2)} — that is the same proportion at a smaller size`);
    // the limbs are re-proportioned too, not just scaled: short legs, long arms
    const len = (built, b) => built.rig.get(b).length;
    const armLeg = (b) => (len(b, 'armL') + len(b, 'foreL')) / (len(b, 'thighL') + len(b, 'shinL'));
    assert(armLeg(u) > armLeg(human) * 1.25,
      `arm-to-leg is ${armLeg(u).toFixed(3)} against the human's ${armLeg(human).toFixed(3)} — the limbs were scaled, not re-proportioned`);
    // and it has to READ as a different figure, framed on its own head
    const a = frame(u.rig.root, { at: new THREE.Vector3(0, box.max.y - 0.09, 0), dist: 3.2 });
    const b = frame(human.rig.root, { at: new THREE.Vector3(0, hbox.max.y - 0.09, 0), dist: 3.2 * box.max.y / hbox.max.y });
    // Scaled to the same apparent size, the two silhouettes still have to
    // differ — that is what "correctly proportioned" means as a picture.
    const d = diff(a, b, window0(a, 0.14));
    assert(d.xor > 400, `at matched apparent size the two figures differ by only ${d.xor} silhouette pixels`);
    return `${box.max.y.toFixed(3)} m (declared ${sp.frame.stature}), ${heads.toFixed(2)} heads against the human's `
      + `${hheads.toFixed(2)}, arm/leg ${armLeg(u).toFixed(3)} vs ${armLeg(human).toFixed(3)}, ${d.xor} px apart at matched size`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  the head-tails, simulated                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('lekku: they MOVE relative to the head, which is the whole complaint', () => {
    /**
     * The same measurement the skirt was held to, on the other bone. A rigid
     * lek is welded to the skull: it tracks the head's yaw exactly and travels
     * ZERO millimetres in the head's own frame, which is what makes it read as
     * a prop. This drives the head through a real glance and measures the tip's
     * travel IN THE HEAD'S FRAME — the frame in which the rigid answer is
     * identically zero, so there is nothing for a wrong answer to hide behind.
     */
    const built = unit({ species: 'twilek' });
    assert(built.lekku && built.lekku.length, 'the Twi\'lek row exposes no lek to simulate');
    assert(built.speciesMeshes.length, 'the rigid pair it stands in for was not handed out');
    const scene = new THREE.Scene();
    const lek = attachLekku(scene, built.rig, { roots: built.lekku, rigid: built.speciesMeshes });
    assert(lek && lek.parts.length === 2, 'a Twi\'lek did not get two lekku');
    const head = built.rig.get('head');
    const restQ = head.obj.quaternion.clone();
    const wind = new THREE.Vector3();
    for (let i = 0; i < 60; i++) lek.update(1 / 60, wind);
    const local = new THREE.Matrix4(), tip = new THREE.Vector3();
    const trail = [];
    for (let f = 0; f < 240; f++) {
      // a glance, inside the ±0.85 rad Player clamps the head to
      const yaw = 0.8 * Math.sin(f / 34);
      head.obj.quaternion.copy(head.restQuat)
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')));
      built.rig.updateMatrices();
      built.rig.root.updateMatrixWorld(true);
      lek.update(1 / 60, wind);
      local.copy(head.obj.matrixWorld).invert();
      const p = lek.parts[0].pos, n = lek.parts[0].cols * lek.parts[0].rows;
      const last = (n - 1) * 3;
      tip.set(p[last], p[last + 1], p[last + 2]).applyMatrix4(local);
      trail.push(tip.clone());
    }
    head.obj.quaternion.copy(restQ);
    built.rig.updateMatrices();
    let travel = 0;
    for (let i = 1; i < trail.length; i++) travel += trail[i].distanceTo(trail[i - 1]);
    const box = new THREE.Box3();
    for (const t of trail) box.expandByPoint(t);
    const span = box.getSize(new THREE.Vector3()).length();
    assert(travel > 0.25, `the tip travelled ${(travel * 1000).toFixed(0)} mm in the head's frame over four seconds — a rigid lek travels 0`);
    assert(span > 0.03, `the tip's whole excursion is ${(span * 1000).toFixed(0)} mm — it is following the skull`);
    for (const l of lek.parts) for (let i = 0; i < l.pos.length; i++) {
      assert(Number.isFinite(l.pos[i]), 'the solver produced a non-finite particle');
    }
    // the LOD swap, both ways, exactly as the skirt does it
    lek.setVisible(false);
    assert(built.speciesMeshes.every(m => m.visible) && lek.parts.every(l => !l.mesh.visible),
      'switching the lekku off at range leaves a Twi\'lek with a bare head');
    lek.setVisible(true);
    assert(built.speciesMeshes.every(m => !m.visible) && lek.parts.every(l => l.mesh.visible),
      'the rigid pair is still drawn inside the simulated one');
    lek.dispose();
    assert(built.speciesMeshes.every(m => m.visible), 'disposing the lekku left the head bald');
    return `tip travels ${(travel * 1000).toFixed(0)} mm in the head's frame over 4 s, excursion ${(span * 1000).toFixed(0)} mm; `
      + 'rigid pair swaps back at range';
  });

  check('lekku: the pair costs less than the one cape the same figure already wears', () => {
    /**
     * THE BUDGET, AND WHY IT IS STATED IN ABSOLUTE TERMS.
     *
     * tools/checks/_weave.mjs measures a garment PER UNIT AREA — cell size,
     * particles per m², sphere tests per m² — and its reasoning is exactly
     * right for a garment: the area is set by the body ("a robe has to reach
     * the ankles"), so the only thing a cut is free to choose is how finely it
     * dices that area, and that is what must be capped.
     *
     * A lek is not a garment and the normalisation does not carry. Its area is
     * 0.06 m² against the cape's 0.46, and what the solver has to resolve is
     * its LENGTH — a 44 cm tail bending over a shoulder needs segments ALONG
     * it — while its circumference contributes area without contributing
     * anything the simulation needs. Held to the cape's cell size it would come
     * out as a three-sided prism in four segments, which cannot bend like a
     * tail; and the per-area numbers would be flattered by making it FATTER,
     * which is the wrong incentive in every direction.
     *
     * So the bound is absolute, against the cape the same character is already
     * running on the same frame — which is what a frame actually pays — and
     * every per-area number is reported rather than hidden.
     */
    const built = unit({ species: 'twilek' });
    const cape = attachCloak(new THREE.Scene(), built.rig, { width: 0.36, length: 0.86, cols: 9, rows: 11 });
    const C = weave(cape);
    const lek = attachLekku(new THREE.Scene(), built.rig, { roots: built.lekku, rigid: built.speciesMeshes });
    const W = weave(lek.parts[0], { tube: true });
    const pairN = lek.parts.reduce((a, l) => a + l.cols * l.rows, 0);
    const pairLinks = lek.parts.reduce((a, l) => a + l.links.length, 0);
    const pairTests = lek.parts.reduce((a, l) => a + l.cols * l.rows * l.refreshColliders().length, 0);
    const capeTests = C.n * C.colliders;
    assert(pairN < C.n, `the pair is ${pairN} particles against the cape's ${C.n}`);
    assert(pairLinks < cape.links.length, `the pair is ${pairLinks} links against the cape's ${cape.links.length}`);
    assert(pairTests < capeTests, `the pair costs ${pairTests} sphere tests a pass against the cape's ${capeTests}`);
    for (const l of lek.parts) {
      assert(l.iterations === cape.iterations, `a lek solves ${l.iterations} passes, not the cape's ${cape.iterations}`);
      assert(l.links.length / (l.cols * l.rows) <= cape.links.length / C.n * 1.1,
        `a lek costs ${(l.links.length / (l.cols * l.rows)).toFixed(2)} links a particle against the cape's ${(cape.links.length / C.n).toFixed(2)}`);
      assert(l.refreshColliders().length <= 6,
        `a lek carries ${l.refreshColliders().length} colliders — a head, a neck, a ribcage and one shoulder is what it can hit`);
    }
    // and it must be cheaper than the rigid pair is to DRAW, or the swap is a
    // loss at every range: 2 meshes against 1 is the honest cost, and it is
    // paid in triangles rather than in draw calls being saved.
    const rigidTris = built.speciesMeshes.reduce((a, m) =>
      a + (m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3), 0);
    const clothTris = lek.parts.reduce((a, l) => a + l.geometry.index.count / 3, 0);
    assert(clothTris < rigidTris,
      `the simulated pair draws ${clothTris} triangles to replace ${rigidTris} rigid ones`);
    const line = `pair ${pairN} particles / ${pairLinks} links / ${pairTests} sphere tests a pass against the cape's `
      + `${C.n} / ${cape.links.length} / ${capeTests}; ${clothTris} tris for ${rigidTris}; `
      + `per m² a lek is ${weaveLine(W)} at ${W.density.toFixed(0)}/m² against the cape's ${weaveLine(C)} at ${C.density.toFixed(0)}/m²`;
    cape.dispose(); lek.dispose();
    return line;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  injury                                                            */
  /* ══════════════════════════════════════════════════════════════════ */

  check('injury: a hit puts a mark ON the body, where the hit landed', () => {
    /**
     * Not "a counter went up". The mark has to be geometry, it has to be a
     * child of a BONE so it travels with a swinging arm and comes off with a
     * severed one, and its vertices have to lie on the surface the player can
     * see — which on a torso lathe squashed on Z is not the radius the lathe
     * was built at.
     */
    const built = buildJedi({});
    built.rig.updateMatrices();
    built.rig.root.updateMatrixWorld(true);
    const inj = new Injury(built.rig, { seed: 7 });
    const before = cost(built.rig.root);
    assert(inj.level === 0, 'a fresh body is already wounded');
    // a hit on the chest, from the front
    const chest = built.rig.get('chest');
    chest.obj.updateMatrixWorld(true);
    const at = new THREE.Vector3(0, chest.length * 0.5, 0.30).applyMatrix4(chest.obj.matrixWorld);
    const w = inj.hit(at, 0.30);
    assert(w, 'a hit on the chest produced no wound');
    const after = cost(built.rig.root);
    assert(after.tris > before.tris, 'the wound added no geometry');
    assert(after.meshes > before.meshes && after.meshes - before.meshes <= 2,
      `one wound added ${after.meshes - before.meshes} meshes`);
    /* ON the surface: every mark vertex is within 12 mm of the limb it lies on.
     *
     * MEASURED TO THE TRIANGLE AND NOT TO ITS CENTROID, which is what it said
     * and not what it did. A chest lathe is twelve segments round, so a
     * triangle is 6-7 cm across and its centroid is that far from points that
     * are exactly ON it: the old measure read 30-70 mm for marks lying flush,
     * which is why the bound had to be 50 mm to pass at all and why the
     * comment above it has never been true. Point-to-triangle is the question
     * the sentence asks, and against it the bound can be what it claims. */
    const nearTri = (v, a, b, c) => {
      const ab = _gv1.subVectors(b, a), ac = _gv2.subVectors(c, a), ap = _gv3.subVectors(v, a);
      const d1 = ab.dot(ap), d2 = ac.dot(ap);
      if (d1 <= 0 && d2 <= 0) return v.distanceTo(a);
      const bp = _gv4.subVectors(v, b);
      const d3 = ab.dot(bp), d4 = ac.dot(bp);
      if (d3 >= 0 && d4 <= d3) return v.distanceTo(b);
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        // 0/0 on a zero-length edge is the NaN this measure reported.
        const den1 = d1 - d3;
        const t = Math.abs(den1) > 1e-20 ? d1 / den1 : 0;
        return v.distanceTo(_gv5.copy(a).addScaledVector(ab, t));
      }
      const cp = _gv4.subVectors(v, c);
      const d5 = ab.dot(cp), d6 = ac.dot(cp);
      if (d6 >= 0 && d5 <= d6) return v.distanceTo(c);
      const vb = d5 * d2 - d1 * d6;
      if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const den2 = d2 - d6;
        const t = Math.abs(den2) > 1e-20 ? d2 / den2 : 0;
        return v.distanceTo(_gv5.copy(a).addScaledVector(ac, t));
      }
      const va = d3 * d6 - d5 * d4;
      if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        const den3 = (d4 - d3) + (d5 - d6);
        const t = Math.abs(den3) > 1e-20 ? (d4 - d3) / den3 : 0;
        return v.distanceTo(_gv5.copy(b).addScaledVector(_gv6.subVectors(c, b), t));
      }
      // A degenerate triangle — a lathe's pole fan has them — has no interior
      // to project into, and 1/0 here is the NaN this measure reported.
      const sum = va + vb + vc;
      if (!(Math.abs(sum) > 1e-20)) return Math.min(v.distanceTo(a), v.distanceTo(b), v.distanceTo(c));
      const den = 1 / sum;
      const w1 = vb * den, w2 = vc * den;
      return v.distanceTo(_gv5.copy(a).addScaledVector(ab, w1).addScaledVector(ac, w2));
    };
    built.rig.updateMatrices();
    built.rig.root.updateMatrixWorld(true);
    /* EVERY SKIN THE PLACER CONSIDERED, and not the bare lathe underneath it.
     *
     * This soup was `bone.primary` alone. A mark is rayed onto the FURTHEST
     * surface the bone carries — cloth if there is cloth there, skin if there
     * is not, which is `Injury`'s own rule and the right one — so a stain
     * lying perfectly on a tabard measured 63 mm from the chest beneath it and
     * the check called that a floating vertex. It was measuring the wrong
     * body. `injury` meshes are excluded for the obvious reason. */
    const body = [];
    for (const name of ['chest', 'spine', 'hips']) {
      const bone = built.rig.get(name);
      if (!bone) continue;
      for (const o of [bone.primary, ...bone.obj.children]) {
        if (!o || !o.isMesh || o.userData?.injury) continue;
        soup(o, body);
      }
    }
    let worst = 0, n = 0;
    for (const m of inj.meshes.values()) {
      const P = m.geometry.attributes.position, v = new THREE.Vector3();
      m.updateMatrixWorld(true);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
        let d = 1e9;
        for (const [a, b, c] of body) d = Math.min(d, nearTri(v, a, b, c));
        worst = Math.max(worst, d); n++;
      }
    }
    assert(n > 0, 'the wound has no vertices');
    assert(worst < 0.012, `a mark vertex is ${(worst * 1000).toFixed(1)} mm from the nearest triangle of the body it is painted on`);
    // it landed on the bone the hit was nearest, not on a fixed one
    assert(w.bone === 'chest', `a hit on the chest marked the ${w.bone}`);
    // and it is a DIRECT child of that bone — the Ragdoll/first-person rule
    for (const m of inj.meshes.values()) {
      assert(m.parent === built.rig.get(w.bone).obj,
        'a mark is not a direct child of its bone — Ragdoll.addBone re-homes only direct children');
    }
    inj.dispose();
    return `one hit → ${after.tris - before.tris} triangles in ${after.meshes - before.meshes} mesh(es) on the ${w.bone}, `
      + `worst vertex ${(worst * 1000).toFixed(0)} mm off the body`;
  });

  check('injury: it accumulates, it is capped, and it comes off', () => {
    const built = buildJedi({});
    built.rig.updateMatrices();
    built.rig.root.updateMatrixWorld(true);
    const inj = new Injury(built.rig, { seed: 11 });
    const base = cost(built.rig.root);
    const steps = [];
    /**
     * ENOUGH HITS TO REACH THE CAP, DERIVED FROM THE CAP.
     *
     * This loop was `i < 12`, chosen when `Injury.max` was 6 — twelve hits
     * comfortably overran it. Player note #42 ("haven't been able to notice the
     * player model looking injured or bloody the more damaged they get") moved
     * the cap to 14, and twelve hits then left twelve wounds against a cap of
     * fourteen: the check failed while reporting a body that was working
     * exactly as intended.
     *
     * That is the signature defect this project keeps re-finding (HANDOFF 2.3):
     * a literal sitting beside the value it is supposed to track. The count is
     * now `max + 4`, so the cap is overrun by construction whatever the cap
     * becomes, and the next person to retune the budget does not have to know
     * this line exists.
     */
    const hits = inj.max + 4;
    for (let i = 0; i < hits; i++) {
      inj.hit(null, 0.25);
      steps.push(cost(built.rig.root).tris - base.tris);
    }
    assert(steps[0] > 0 && steps[2] > steps[0], `the marks are not accumulating: ${steps.slice(0, 4).join(', ')}`);
    assert(inj.wounds.length === inj.max,
      `${hits} hits left ${inj.wounds.length} wounds against a cap of ${inj.max}`);
    const capped = cost(built.rig.root);
    assert(capped.meshes - base.meshes <= inj.maxBones * 2,
      `a fully wounded body carries ${capped.meshes - base.meshes} extra meshes against a cap of ${inj.maxBones * 2}`);
    /* 520, not 400. A wound is THREE marks now and not one — the stain where
     * the hit landed and two smaller runs at 40-80 degrees of bearing either
     * side of it, because blood spreads round a limb and because a single
     * stain is on whichever side the attacker was standing. Measured through
     * `tools/_hurt.mjs`, that is the difference between 0.3% of the player's
     * own silhouette carrying a mark and 4-6% of it. Nine plus seven plus
     * seven is 23 triangles a wound against the nine this bound was written
     * for, and 420 total on a fully wounded body — still under a hundredth of
     * what the figure itself costs. */
    assert(capped.tris - base.tris < 520,
      `a fully wounded body is ${capped.tris - base.tris} extra triangles — a wound is meant to be `
      + 'a stain and two runs, about 23 of them');
    assert(inj.level === 1, `${inj.wounds.length} wounds of ${inj.max} is level ${inj.level}`);
    inj.clear();
    const clean = cost(built.rig.root);
    assert(clean.tris === base.tris && clean.meshes === base.meshes,
      `clearing left ${clean.tris - base.tris} triangles and ${clean.meshes - base.meshes} meshes behind`);
    // the toggle wipes what is already there rather than only stopping new ones
    inj.hit(null, 0.3); inj.hit(null, 0.3);
    inj.setEnabled(false);
    assert(cost(built.rig.root).tris === base.tris, 'switching injuries off left the marks on the body');
    assert(inj.hit(null, 0.5) === null, 'switching injuries off did not stop new ones');
    inj.dispose();
    return `marks accumulate ${steps.slice(0, 4).join('→')}… capped at ${inj.max} wounds / `
      + `${capped.tris - base.tris} tris / ${capped.meshes - base.meshes} meshes; the toggle wipes`;
  });

  check('injury: the gate is on Player.damage, and it reads the setting live', () => {
    /**
     * THE WIRE, and it is the half that the signature bug in this codebase was
     * missing. A body that CAN be marked is not a feature; a body that IS
     * marked when the game hurts you is. `Player.damage` is the single damage
     * path and this workstream may not edit it, so the gate wraps the funnel —
     * the same seam camera shake and hitstop use — and this drives a stand-in
     * Player through it rather than calling Injury directly.
     */
    const built = buildJedi({});
    built.rig.updateMatrices();
    built.rig.root.updateMatrixWorld(true);
    let taken = 0;
    const player = {
      rig: built.rig, hp: 100, maxHp: 100,
      damage(amount, point) { this.hp -= amount; taken++; return this.hp <= 0; },
      heal(v) { this.hp = Math.min(this.maxHp, this.hp + v); },
    };
    const world = { players: [player] };
    assert(applyInjury(world, { injury: true }), 'the gate did not arm');
    const base = cost(built.rig.root);
    player.damage(24, new THREE.Vector3(0, 1.3, 0.3), null, 'bolt');
    assert(taken === 1, 'the wrapper swallowed the hit instead of forwarding it');
    assert(player.hp === 76, `hp is ${player.hp} — the wrapper changed the damage`);
    assert(cost(built.rig.root).tris > base.tris, 'a hit through Player.damage marked nothing');
    // idempotent, and re-arming does not double-wrap
    applyInjury(world, { injury: true });
    const beforeSecond = cost(built.rig.root).tris;
    player.damage(10, null, null, 'fall');
    const marks = player.injury.wounds.length;
    assert(marks === 2, `two hits left ${marks} wounds — the funnel is wrapped twice`);
    assert(cost(built.rig.root).tris > beforeSecond, 'the second hit marked nothing');
    // healing to full wipes it
    player.heal(100);
    assert(cost(built.rig.root).tris === base.tris, 'a body healed to full still carries its wounds');
    // and the setting is read LIVE off the world rather than captured
    player.damage(20, null, null, 'bolt');
    assert(cost(built.rig.root).tris > base.tris, 'the gate stopped working after a heal');
    applyInjury(world, { injury: false });
    assert(cost(built.rig.root).tris === base.tris, 'unticking the box left the marks on the body');
    player.damage(20, null, null, 'bolt');
    assert(cost(built.rig.root).tris === base.tris, 'unticking the box did not stop new marks');
    assert(INJURY_COLORS.blood !== INJURY_COLORS.tear, 'blood and torn cloth are the same colour');
    return `${taken} hits through the real funnel; hp untouched, marks arrive, heal and the toggle both wipe`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  the wire, end to end                                              */
  /* ══════════════════════════════════════════════════════════════════ */

  check('grooming: the sheet reaches the game, not just the preview', async () => {
    /**
     * THE CHECK THIS FILE EXISTS FOR.
     *
     * `skinColor` and `hairColor` were arguments of buildJedi that nothing
     * passed for the whole life of the project, and every one of them read
     * perfectly well as source. So the chain is asserted LINK BY LINK against
     * the real files: the menu writes the sheet into `settings.face`, World
     * hands `settings.face` to Player, Player hands it to buildJedi, and
     * buildJedi reads the four keys out of it. Break any one and this fails.
     *
     * `face` is the carrier because it is the only appearance argument on that
     * path that has always been allowed to be an object — see DEFAULT_SETTINGS
     * in ui/Menu.js. That is a fact about two files this workstream does not
     * own, so it is asserted rather than assumed.
     */
    const menu = await readFile(src('ui/Menu.js'), 'utf8');
    const world = await readFile(src('game/World.js'), 'utf8');
    const player = await readFile(src('game/Player.js'), 'utf8');
    const bodies = await readFile(src('game/Bodies.js'), 'utf8');
    const html = await readFile(root('index.html'), 'utf8');

    assert(/face:\s*\{[^}]*hair:/.test(menu), 'DEFAULT_SETTINGS.face is not a character sheet');
    assert(menu.includes('this.s.face = characterSheet('), 'nothing in the menu writes the sheet');
    for (const key of SHEET_KEYS) {
      assert(new RegExp(`_sheetCardRow\\('[a-z-]+',\\s*'[a-z-]+',\\s*'${key}'|_sheetSlider\\('[a-z-]+',\\s*'${key}'`).test(menu),
        `${key} has no control in the creator — the player cannot choose it`);
    }
    for (const id of ['hairstyle-list', 'beard-list', 'sheet-muscle', 'sheet-age']) {
      assert(html.includes(`id="${id}"`), `#${id} is in no markup — the row would build into nothing`);
    }
    assert(world.includes('face: this.settings.face'), 'World no longer hands the sheet to the Player');
    assert(player.includes('face: opts.face'), 'Player no longer hands the sheet to buildJedi');
    assert(bodies.includes('function sheetOf(opts = {})'), 'buildJedi no longer resolves a sheet');
    assert(/const G = sheetOf\(opts\)/.test(bodies), 'buildJedi does not read the sheet it resolves');
    // and the four are actually CONSUMED, each by something that makes geometry
    for (const [key, expr] of [['hair', 'HAIR_CUTS[G.hair.id]'], ['beard', 'beardParts(s, hg, G.beard)'],
      ['age', '0.034 * G.a'], ['muscle', 'const mu = G.m']]) {
      assert(bodies.includes(expr), `${key} is resolved and never used — \`${expr}\` is gone`);
    }

    // …and then the same claim as a measurement, through the sheet only.
    const base = digest(unit({}));
    const rows = [];
    for (const [key, value] of [['hair', 'mane'], ['beard', 'full'], ['age', 1], ['muscle', 1]]) {
      const viaFace = digest(unit({ face: { [key]: value } }));
      assert(viaFace !== base, `passing ${key} inside the face object changed nothing about the built figure`);
      assert(viaFace === digest(unit({ [key]: value })),
        `${key} through the face object and ${key} at the top level build different figures`);
      rows.push(key);
    }
    return `menu → settings.face → World → Player → buildJedi, asserted per link; ${rows.join(', ')} all move the mesh`;
  });
}
