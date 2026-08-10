/**
 * SABER — the wardrobe.
 *
 * "Clothes" in the character creator were six colour palettes on one identical
 * garment. The cloth solver has a real parameter set — length, pleat, flare,
 * how the fabric bends, how much air it catches, where it is pinned — and that
 * set is the vocabulary of a garment's CUT, so `ROBE_CUTS` names six of them
 * and `attachSkirt(scene, rig, { cut })` wears one.
 *
 * Everything below is measured off the headless sim. Where a bound looks
 * arbitrary the comment says what the shipped garment reads and what the cut
 * reads beside it, because almost every bound in here is RELATIVE: the temple
 * robe is the thing that shipped, and a cut is allowed to be different but not
 * allowed to be worse.
 *
 * All of them fail on the code they were written against, most of them at the
 * import: `ROBE_CUTS` and `robeCut` did not exist. Underneath that, three of
 * the behaviours do not either, and were checked separately against HEAD with
 * the options written out by hand:
 *
 *   `hemBias` was ignored, so the wrapped robe hung 25mm out of level instead
 *   of 312 and its columns were all cut the same length;
 *
 *   attachSkirt's anchor ignored the row index it is handed, so `pinRows: 2`
 *   put both waistbands at the same height AND the same radius — a zero-length
 *   structural link between two rings that are the same ring — and the tabard
 *   rode 74% of its own length up its anchor at a sprint instead of 22%;
 *
 *   `shellStep` was ignored, so a 540mm cut carried 18 colliders instead of 16
 *   and paid 1764 sphere tests a pass instead of 1568.
 *
 * The rest are measurements of what the cuts do, and would fail on any set of
 * presets that were one robe with the sliders moved — one of them did fail, on
 * the first draft of the wrapped robe, which is why that cut is not just the
 * temple robe cut on a slant.
 */

import * as THREE from 'three';
import { buildJedi } from '../../src/game/Bodies.js';
import { BipedAnimator } from '../../src/game/Rig.js';
import { Cloak, attachCloak, attachSkirt, ROBE_CUTS, robeCut } from '../../src/game/Cloth.js';

/* ── the bench ───────────────────────────────────────────────────────── */

/** A Jedi walking in a straight line, wearing whatever cut is asked for. */
function drive({ speed = 4.6, seconds = 7, tail = 150, skirt = {}, cloak = null,
                 feed = false, sample = null } = {}) {
  const built = buildJedi({ scale: 1 });
  const rig = built.rig;
  const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
  anim.setFacing(0);
  const sc = new THREE.Scene();
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(0, 0, speed);
  const sk = skirt ? attachSkirt(sc, rig, { seed: 991, rigid: built.robeSkirt, ...skirt }) : null;
  const cl = cloak ? attachCloak(sc, rig, { width: 0.36, length: 0.86, cols: 9, rows: 11,
                                            flare: 1.0, seed: 4242, ...cloak }) : null;
  if (feed && cl && sk) cl.outer = sk;
  const wind = new THREE.Vector3();
  const N = Math.round(seconds * 60);
  for (let i = 0; i < N; i++) {
    pos.z += speed / 60;
    anim.update(1 / 60, { position: pos, facing: 0, velocity: vel, grounded: true,
      groundAt: () => 0, crouch: 0, accelForward: Math.min(1, speed / 8), accelStrafe: 0 });
    anim.swingArms(1 / 60, speed, 1);
    rig.updateMatrices();
    wind.set(0, 0, -speed * 0.85);
    if (sk) sk.update(1 / 60, sk.refreshColliders(), wind);
    if (cl) cl.update(1 / 60, cl.refreshColliders(), wind);
    if (sample && i >= N - tail) sample(i, { rig, skirt: sk, cloak: cl });
  }
  return { built, rig, scene: sc, skirt: sk, cloak: cl };
}

const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };

/** The hips-frame transform, and the cloth read back in it. */
function hipsInv(rig) {
  const h = rig.get('hips').obj;
  h.updateMatrixWorld(true);
  return new THREE.Matrix4().copy(h.matrixWorld).invert();
}

/**
 * The wrinkle left in a closed row once its size, offset and ovality are taken
 * out, as a circular power spectrum. Identical to body-parts.mjs — a quadratic
 * across the column INDEX cannot be periodic, so harmonics 0-2 about the row's
 * own centre are the same three things said in a basis that closes; `nyq` is
 * the share at cols/2, which is exactly and only the per-column checkerboard,
 * and `ridge` is how well one row's wrinkle lines up with the row below it.
 */
function tubeFolds(cl) {
  const { cols, rows, pos } = cl;
  const dev = [], P = new Float64Array(Math.floor(cols / 2) + 1);
  let tot = 0, rms = 0, n = 0;
  for (let r = 1; r < rows; r++) {
    let cx = 0, cy = 0, cz = 0;
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 3; cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2];
    }
    cx /= cols; cy /= cols; cz /= cols;
    const rad = new Float64Array(cols);
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 3;
      rad[c] = Math.hypot(pos[i] - cx, pos[i + 1] - cy, pos[i + 2] - cz);
    }
    const co = [];
    for (let h = 0; h <= cols / 2; h++) {
      let a = 0, b = 0;
      for (let c = 0; c < cols; c++) {
        const th = (c / cols) * Math.PI * 2 * h;
        a += rad[c] * Math.cos(th); b += rad[c] * Math.sin(th);
      }
      co.push([a * 2 / cols, b * 2 / cols]);
      const p = (a * a + b * b) / (cols * cols);
      if (h >= 3) { P[h] += p; tot += p; }
    }
    const d = new Float64Array(cols);
    for (let c = 0; c < cols; c++) {
      const th = (c / cols) * Math.PI * 2;
      let fit = co[0][0] / 2;
      for (let h = 1; h <= 2; h++) fit += co[h][0] * Math.cos(h * th) + co[h][1] * Math.sin(h * th);
      d[c] = rad[c] - fit; rms += d[c] * d[c]; n++;
    }
    dev.push(d);
  }
  let dom = 3, best = 0;
  for (let h = 3; h < P.length; h++) if (P[h] > best) { best = P[h]; dom = h; }
  let rs = 0, rn = 0;
  for (let i = 0; i + 1 < dev.length; i++) {
    let dp = 0, la = 0, lb = 0;
    for (let c = 0; c < cols; c++) { dp += dev[i][c] * dev[i + 1][c]; la += dev[i][c] ** 2; lb += dev[i + 1][c] ** 2; }
    if (la > 1e-12 && lb > 1e-12) { rs += dp / Math.sqrt(la * lb); rn++; }
  }
  return { rms: Math.sqrt(rms / n), dom, nyq: tot ? P[P.length - 1] / tot : 0, ridge: rn ? rs / rn : 0 };
}

/** Worst vertical structural link, as a fraction over its CUT length. */
function stretch(sk) {
  let worst = 0;
  for (const l of sk.links) {
    if (l.kind !== 0 || l.across) continue;
    const i = l.a * 3, j = l.b * 3;
    const d = Math.hypot(sk.pos[j] - sk.pos[i], sk.pos[j + 1] - sk.pos[i + 1], sk.pos[j + 2] - sk.pos[i + 2]);
    worst = Math.max(worst, d / l.rest0);
  }
  return worst - 1;
}

/** The leg colliders attachSkirt itself builds, in the hips frame. */
function legSpheres(rig, inv) {
  const out = [];
  const names = ['thighL', 'thighR', 'shinL', 'shinR'], radii = [0.115, 0.115, 0.098, 0.098];
  const v = new THREE.Vector3();
  for (let b = 0; b < names.length; b++) {
    const bone = rig.get(names[b]);
    if (!bone) continue;
    bone.obj.updateMatrixWorld(false);
    for (const t of [0.25, 0.8]) {
      v.set(0, bone.length * t, 0).applyMatrix4(bone.obj.matrixWorld).applyMatrix4(inv);
      out.push({ x: v.x, y: v.y, z: v.z, r: radii[b] });
    }
  }
  return out;
}

/**
 * How far a PARTICLE ends the frame inside a leg — the solver's own contract,
 * and the only leg measurement that is not really a statement about mesh
 * resolution. The collision push is the last thing update() does, so this is
 * the residual the four iterations could not clear.
 */
function legParticle(sk, rig) {
  const inv = hipsInv(rig), S = legSpheres(rig, inv);
  const v = new THREE.Vector3();
  let worst = 0;
  for (let i = 0; i < sk.cols * sk.rows; i++) {
    v.set(sk.pos[i * 3], sk.pos[i * 3 + 1], sk.pos[i * 3 + 2]).applyMatrix4(inv);
    for (const s of S) {
      const d = Math.hypot(v.x - s.x, v.y - s.y, v.z - s.z);
      if (d < s.r) worst = Math.max(worst, s.r - d);
    }
  }
  return worst;
}

/**
 * How deep the cloth SURFACE passes inside a leg.
 *
 * The solver keeps particles out and nothing more, so the quad between four of
 * them can still cut a limb — which is what "the knee comes through the robe"
 * looks like. This is therefore as much a statement about how finely the cut
 * samples its cloth as about the solve, which is exactly why the spacing check
 * below exists: the shipped robe samples every 84mm and drapes limbs of 98 and
 * 115mm radius, and a cut that samples coarser than the limb cannot cover it.
 */
function legSurface(sk, rig) {
  const inv = hipsInv(rig), S = legSpheres(rig, inv);
  const { cols, rows, pos } = sk;
  const P = new Float64Array(cols * rows * 3), v = new THREE.Vector3();
  for (let i = 0; i < cols * rows; i++) {
    v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(inv);
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
  }
  let worst = 0;
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const c2 = (c + 1) % cols;
      const quad = [[r * cols + c, (r + 1) * cols + c, r * cols + c2],
                    [r * cols + c2, (r + 1) * cols + c, (r + 1) * cols + c2]];
      for (const t of quad) {
        for (const s of S) {
          const d = Math.sqrt(triDist2(P, t[0] * 3, t[1] * 3, t[2] * 3, s.x, s.y, s.z));
          if (d < s.r) worst = Math.max(worst, s.r - d);
        }
      }
    }
  }
  return worst;
}

/** Squared distance from p to triangle abc — Ericson's region test. */
function triDist2(P, ia, ib, ic, px, py, pz) {
  const ax = P[ia], ay = P[ia + 1], az = P[ia + 2];
  const abx = P[ib] - ax, aby = P[ib + 1] - ay, abz = P[ib + 2] - az;
  const acx = P[ic] - ax, acy = P[ic + 1] - ay, acz = P[ic + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - P[ib], bpy = py - P[ib + 1], bpz = pz - P[ib + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = P[ib]; qy = P[ib + 1]; qz = P[ib + 2]; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const t = d1 / (d1 - d3);
        qx = ax + abx * t; qy = ay + aby * t; qz = az + abz * t;
      } else {
        const cpx = px - P[ic], cpy = py - P[ic + 1], cpz = pz - P[ic + 2];
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = P[ic]; qy = P[ic + 1]; qz = P[ic + 2]; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
              const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
              qx = P[ib] + (P[ic] - P[ib]) * w; qy = P[ib + 1] + (P[ic + 1] - P[ib + 1]) * w;
              qz = P[ib + 2] + (P[ic + 2] - P[ib + 2]) * w;
            } else {
              const den = 1 / (va + vb + vc), t = vb * den, w = vc * den;
              qx = ax + abx * t + acx * w; qy = ay + aby * t + acy * w; qz = az + abz * t + acz * w;
            }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

/** How finely the cut samples its own cloth: worst spans, and area per particle. */
function sampling(sk) {
  const d = (a, b) => Math.hypot(sk.pos[b * 3] - sk.pos[a * 3], sk.pos[b * 3 + 1] - sk.pos[a * 3 + 1],
                                 sk.pos[b * 3 + 2] - sk.pos[a * 3 + 2]);
  let across = 0, down = 0, area = 0;
  for (let r = 0; r < sk.rows; r++) {
    for (let c = 0; c < sk.cols; c++) {
      const c2 = (c + 1) % sk.cols;
      across = Math.max(across, d(r * sk.cols + c, r * sk.cols + c2));
      if (r + 1 < sk.rows) {
        down = Math.max(down, d(r * sk.cols + c, (r + 1) * sk.cols + c));
        area += d(r * sk.cols + c, r * sk.cols + c2) * d(r * sk.cols + c, (r + 1) * sk.cols + c);
      }
    }
  }
  return { across, down, per: Math.sqrt(area / (sk.cols * sk.rows)) };
}

/** The hem's own silhouette in the hips frame: mean drop, and its slant. */
function hemOf(sk, rig) {
  const inv = hipsInv(rig), v = new THREE.Vector3();
  let lo = 1e9, hi = -1e9, mean = 0, rad = 0;
  for (let c = 0; c < sk.cols; c++) {
    const i = ((sk.rows - 1) * sk.cols + c) * 3;
    v.set(sk.pos[i], sk.pos[i + 1], sk.pos[i + 2]).applyMatrix4(inv);
    lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); mean += v.y; rad += Math.hypot(v.x, v.z);
  }
  return { y: mean / sk.cols, slant: hi - lo, r: rad / sk.cols };
}

/** Cape particles inside the skirt's own surface, in metres. */
function capeInside(sk, cl, rig) {
  const inv = hipsInv(rig), v = new THREE.Vector3(), rows = [];
  for (let r = 0; r < sk.rows; r++) {
    let dy = 0; const rad = [];
    for (let c = 0; c < sk.cols; c++) {
      const i = (r * sk.cols + c) * 3;
      v.set(sk.pos[i], sk.pos[i + 1], sk.pos[i + 2]).applyMatrix4(inv);
      dy += v.y; rad.push([Math.atan2(v.x, v.z), Math.hypot(v.x, v.z)]);
    }
    rows.push([dy / sk.cols, rad]);
  }
  let worst = 0, any = 0;
  for (let k = 0; k < cl.cols * cl.rows; k++) {
    if (cl.pinned[k]) continue;
    v.set(cl.pos[k * 3], cl.pos[k * 3 + 1], cl.pos[k * 3 + 2]).applyMatrix4(inv);
    const th = Math.atan2(v.x, v.z), rr = Math.hypot(v.x, v.z);
    let row = null, bd = 1e9;
    for (const q of rows) { const dd = Math.abs(q[0] - v.y); if (dd < bd) { bd = dd; row = q; } }
    if (bd > 0.06) continue;
    let sr = 0, sd = 1e9;
    for (const [a, r2] of row[1]) {
      let dd = Math.abs(a - th); if (dd > Math.PI) dd = 2 * Math.PI - dd;
      if (dd < sd) { sd = dd; sr = r2; }
    }
    if (sr - rr > 0.001) { any = 1; worst = Math.max(worst, sr - rr); }
  }
  return { worst, any };
}

/* ── the suite ───────────────────────────────────────────────────────── */

export function run({ check, assert }) {
  const IDS = ROBE_CUTS.map((c) => c.id);

  /**
   * Standing profile, fold spectrum, sampling and cost — one settle per cut,
   * memoised because five of the checks below want it.
   */
  const _rest = new Map();
  function rest(id) {
    if (_rest.has(id)) return _rest.get(id);
    const w = drive({ speed: 0, seconds: 6, tail: 1, skirt: id ? { cut: id } : {} });
    const sk = w.skirt;
    const r = {
      f: tubeFolds(sk), hem: hemOf(sk, w.rig), s: sampling(sk),
      len: sk.length, cols: sk.cols, rows: sk.rows,
      n: sk.cols * sk.rows, links: sk.links.length, iterations: sk.iterations,
      colliders: sk.refreshColliders().length, tris: sk.geometry.index.count / 3,
      hemBias: sk.hemBias, pinRows: sk.pinRows, pleatHarm: sk.pleatHarm,
      leg: legSurface(sk, w.rig), part: legParticle(sk, w.rig),
    };
    sk.dispose();
    _rest.set(id, r);
    return r;
  }

  check('garments: the cut list is a wardrobe the UI can read, and every id resolves', () => {
    // The character creator stores an id and hands it straight to attachSkirt,
    // so an id that does not resolve is a character with no robe.
    assert(Array.isArray(ROBE_CUTS) && ROBE_CUTS.length >= 4,
      `${ROBE_CUTS?.length} cuts — a wardrobe of one garment is what this replaces`);
    const seen = new Set();
    for (const c of ROBE_CUTS) {
      assert(c.id && !seen.has(c.id), `duplicate or missing cut id ${JSON.stringify(c.id)}`);
      seen.add(c.id);
      assert(c.name && c.name.length > 2, `cut ${c.id} has no name for the UI to print`);
      assert(c.blurb && c.blurb.length > 24, `cut ${c.id} has no blurb worth showing a player`);
      assert(c.skirt && typeof c.skirt === 'object', `cut ${c.id} carries no skirt options`);
      assert(c.cloak && typeof c.cloak === 'object', `cut ${c.id} carries no cape options`);
      assert(robeCut(c.id) === c, `robeCut('${c.id}') does not resolve to its own entry`);
    }
    assert(robeCut('nonesuch') === null, 'robeCut invents a cut for an unknown id');
    // an unknown id must not throw in the middle of building a character
    const built = buildJedi({ scale: 1 });
    built.rig.updateMatrices(); built.rig.root.updateMatrixWorld(true);
    const sk = attachSkirt(new THREE.Scene(), built.rig, { cut: 'nonesuch', rigid: built.robeSkirt });
    assert(sk && sk.cols === 14 && sk.rows === 7 && Math.abs(sk.length - 0.46) < 1e-9,
      'an unknown cut id did not fall back to the temple robe');
    sk.dispose();
    return `${ROBE_CUTS.length} cuts: ${IDS.join(', ')}`;
  });

  check('garments: asking for no cut is the garment that shipped, to the last bit', () => {
    /*
     * Player, Enemy and both sparring acolytes call attachSkirt and attachCloak
     * with no cut at all, so the default path is not allowed to move by one
     * ulp. Three separate claims:
     *
     *   1. the constructed parameters are still the shipped constants;
     *   2. `cut: 'temple'` is the same garment, particle for particle, after
     *      seven seconds of walking — the UI's "no change" option really is;
     *   3. a fixed synthetic cloth still lands on the number it landed on
     *      before any of this existed. That one needs no rig and no body, so it
     *      keeps its meaning whatever else in the project moves.
     */
    const built = buildJedi({ scale: 1 });
    built.rig.updateMatrices(); built.rig.root.updateMatrixWorld(true);
    const sk = attachSkirt(new THREE.Scene(), built.rig, { rigid: built.robeSkirt });
    const want = { cols: 14, rows: 7, pinRows: 1, iterations: 4, pleat: 0.24, pleatHarm: 5,
                   shear: 0.20, fullness: 1, gravity: -13, foldAO: 0.55, hemBias: 0, closed: true };
    for (const k in want) {
      assert(sk[k] === want[k], `the default skirt's ${k} is ${sk[k]}, not the shipped ${want[k]}`);
    }
    assert(Math.abs(sk.length - 0.46) < 1e-12, `the default length is ${sk.length}`);
    // 8 shell spheres at 55mm + 8 leg spheres: the shell step is a parameter now
    assert(sk.refreshColliders().length === 16,
      `the default skirt builds ${sk.refreshColliders().length} colliders, not the shipped 16`);
    sk.dispose();

    // (2) — one rig, both garments, same frames
    const rig2 = buildJedi({ scale: 1 });
    const anim = new BipedAnimator(rig2.rig, { scale: 1, hipHeight: 0.95 });
    anim.setFacing(0);
    const sc = new THREE.Scene();
    const a = attachSkirt(sc, rig2.rig, { seed: 991, rigid: rig2.robeSkirt });
    const b = attachSkirt(sc, rig2.rig, { seed: 991, rigid: rig2.robeSkirt, cut: 'temple' });
    const ca = attachCloak(sc, rig2.rig, { width: 0.36, length: 0.86, seed: 4242 });
    const cb = attachCloak(sc, rig2.rig, { width: 0.36, length: 0.86, seed: 4242, cut: 'temple' });
    const pos = new THREE.Vector3(), wind = new THREE.Vector3();
    for (let i = 0; i < 300; i++) {
      pos.z += 4.6 / 60;
      anim.update(1 / 60, { position: pos, facing: 0, velocity: new THREE.Vector3(0, 0, 4.6),
        grounded: true, groundAt: () => 0, crouch: 0, accelForward: 0.575, accelStrafe: 0 });
      anim.swingArms(1 / 60, 4.6, 1);
      rig2.rig.updateMatrices();
      wind.set(0, 0, -4.6 * 0.85);
      a.update(1 / 60, a.refreshColliders(), wind);
      b.update(1 / 60, b.refreshColliders(), wind);
      ca.update(1 / 60, ca.refreshColliders(), wind);
      cb.update(1 / 60, cb.refreshColliders(), wind);
    }
    const same = (x, y, what) => {
      for (let i = 0; i < x.length; i++) {
        assert(x[i] === y[i], `${what} differs at ${i}: ${x[i]} vs ${y[i]} — cut:'temple' is not the shipped garment`);
      }
    };
    same(a.pos, b.pos, 'skirt position');
    same(a.links.map((l) => l.rest), b.links.map((l) => l.rest), 'skirt rest length');
    same(a.geometry.attributes.normal.array, b.geometry.attributes.normal.array, 'skirt normal');
    same(a.geometry.attributes.color.array, b.geometry.attributes.color.array, 'skirt vertex colour');
    same(ca.pos, cb.pos, 'cape position');
    a.dispose(); b.dispose(); ca.dispose(); cb.dispose();

    // (3) — the golden, on a cloth that has never heard of a rig
    const anchor = (c, n, out) => out.set(Math.sin(c / n * 2 * Math.PI) * 0.145, 1.0,
                                          Math.cos(c / n * 2 * Math.PI) * 0.145);
    const g = new Cloak(new THREE.Scene(), { closed: true, cols: 14, rows: 7, length: 0.46,
      seed: 4242, profile: (t) => 1 + 0.62 * t * t, pleat: 0.24, pleatHarm: 5, shear: 0.20,
      foldAO: 0.55, anchorFn: anchor });
    g.reset();
    const spheres = [{ c: new THREE.Vector3(0, 0.74, 0), r: 0.185 },
                     { c: new THREE.Vector3(0.06, 0.62, 0.03), r: 0.12 }];
    const w = new THREE.Vector3(0.4, 0, -1.1);
    for (let i = 0; i < 240; i++) g.update(1 / 60, spheres, w);
    let sp = 0, sr = 0;
    for (let i = 0; i < g.pos.length; i++) sp += g.pos[i] * (i + 1);
    for (let i = 0; i < g.links.length; i++) sr += g.links[i].rest * (i + 1);
    // measured on the code this landed against, and on HEAD before it
    assert(sp.toPrecision(17) === '9758.6185752972960',
      `the reference cloth settles at ${sp.toPrecision(17)}, not 9758.6185752972960 — reset() or update() moved under a garment with no bias in it`);
    assert(sr.toPrecision(17) === '15233.992263271823',
      `the reference cloth's rest lengths sum to ${sr.toPrecision(17)}, not 15233.992263271823`);
    g.dispose();
    return `12 shipped constants, 1518 values identical under cut:'temple', golden ${sp.toFixed(4)}`;
  });

  check('garments: no cut is another cut with a slider moved', () => {
    /*
     * The point of the exercise. Four garments that read differently beat eight
     * that are one robe at different lengths, so every PAIR has to separate on
     * at least two of the five things an eye actually reads: how long it is,
     * how wide it finishes, how deep the folds are, how many of them go round,
     * and how far the hem travels in the pelvis frame at a walk.
     *
     * Hem travel is the one that catches a pure re-colour of the fabric
     * parameters: the cassock is only 80mm longer than the temple robe and
     * moves 134mm against its 183 because it is damped, deaf to the wind and
     * stiff down the cloth.
     */
    const travel = new Map();
    for (const id of IDS) {
      // every hem particle's own travel in the pelvis frame, averaged round the
      // ring — one column is a lottery on a garment whose hem is not level
      const pts = [];
      const w = drive({ speed: 4.6, seconds: 7, tail: 150, skirt: { cut: id },
        sample: (i, { rig, skirt: sk }) => {
          const inv = hipsInv(rig), r0 = (sk.rows - 1) * sk.cols;
          const frame = [];
          for (let c = 0; c < sk.cols; c++) {
            const k = (r0 + c) * 3;
            frame.push(new THREE.Vector3(sk.pos[k], sk.pos[k + 1], sk.pos[k + 2]).applyMatrix4(inv));
          }
          pts.push(frame);
        } });
      let d = 0;
      for (let c = 0; c < pts[0].length; c++) {
        let m = 0;
        for (const a of pts) for (const b of pts) m = Math.max(m, a[c].distanceTo(b[c]));
        d += m / pts[0].length;
      }
      travel.set(id, d);
      w.skirt.dispose();
    }
    const sig = IDS.map((id) => {
      const r = rest(id);
      return { id, len: r.len, hem: r.hem.r, fold: r.f.rms, harm: r.f.dom,
               slant: r.hem.slant, travel: travel.get(id) };
    });
    const axes = [
      ['length', (s) => s.len, 0.06],           // 60mm of hem height
      ['hem width', (s) => s.hem, 0.020],       // 20mm of radius, 40 across
      ['fold depth', (s) => s.fold, 0.005],     // 5mm of wrinkle
      ['fold count', (s) => s.harm, 0.9],       // a different harmonic
      ['hem slant', (s) => s.slant, 0.10],      // 100mm of asymmetry
      ['hem travel', (s) => s.travel, 0.035],   // 35mm of swing at a walk
    ];
    for (let i = 0; i < sig.length; i++) {
      for (let j = i + 1; j < sig.length; j++) {
        const hit = axes.filter(([, f, tol]) => Math.abs(f(sig[i]) - f(sig[j])) >= tol);
        assert(hit.length >= 2,
          `${sig[i].id} and ${sig[j].id} are the same garment: they differ only on `
          + `[${hit.map((h) => h[0]).join(', ')}] — cut one of them`);
      }
    }
    return sig.map((s) => `${s.id} ${(s.len * 1000).toFixed(0)}/${(s.hem * 1000).toFixed(0)}mm `
      + `fold ${(s.fold * 1000).toFixed(0)}mm h${s.harm} travel ${(s.travel * 1000).toFixed(0)}mm`).join('; ');
  });

  check('garments: every cut still folds, and folds in something the mesh can draw', () => {
    // The fold metric the tube was built against, applied to the whole
    // wardrobe. `nyq` is the share of the wrinkle sitting at the per-column
    // Nyquist harmonic, which is exactly and only a checkerboard, and `ridge`
    // is whether one row's wrinkle lines up with the row below it — a fold runs
    // from the waistband to the hem, a rash does not. Lag-1 autocorrelation
    // cannot tell those apart: a real harmonic-5 pattern on 14 columns scores
    // -0.62, the same sign as the artefact.
    const out = [];
    for (const id of IDS) {
      const r = rest(id);
      const floor = id === 'coat' ? 0.010 : 0.018;   // the coat creases; it does not fold
      assert(r.f.rms > floor,
        `${id} wrinkles ${(r.f.rms * 1000).toFixed(1)}mm — that is a painted cylinder`);
      assert(r.f.dom * 2 < r.cols,
        `${id}'s dominant harmonic is ${r.f.dom} on ${r.cols} columns, which the mesh cannot draw`);
      assert(r.f.nyq < 0.12,
        `${(r.f.nyq * 100).toFixed(0)}% of ${id}'s fold power is at the per-column Nyquist — a checkerboard, not a fold`);
      assert(r.f.ridge > 0.70,
        `${id}'s rows correlate only ${r.f.ridge.toFixed(2)} with each other — deep per-row noise, not folds running down the cloth`);
      // and the pleat that was asked for is the pleat that arrived
      assert(Math.abs(r.f.dom - r.pleatHarm) <= 1,
        `${id} was cut with ${r.pleatHarm} pleats and settles on ${r.f.dom}`);
      out.push(`${id} ${(r.f.rms * 1000).toFixed(1)}mm h${r.f.dom} ridge ${r.f.ridge.toFixed(2)}`);
    }
    return out.join('; ');
  });

  check('garments: a cut may not sample its cloth coarser than the leg it drapes', () => {
    /*
     * THE REASON THERE IS NO FLOOR-LENGTH ROBE IN THE LIST.
     *
     * The particle budget is the cape's — 99 — and it buys a fixed area of
     * cloth, not a length. The shipped robe is 0.66 m² over 98 particles, one
     * every 84mm, and the limbs it has to drape are spheres of 115mm (thigh)
     * and 98mm (shin) radius. A garment whose quads are bigger than the limb
     * cannot lie on it: the corners sit outside the sphere and the triangle
     * between them cuts straight through it.
     *
     * Measured, at the same fabric and the same 14×7: a 460mm cut samples every
     * 84mm and the cloth reaches 45mm into a 115mm thigh at a slow walk; 540mm
     * samples every 90 and reaches 55; 580mm every 94 and reaches 90; a
     * floor-length 740mm samples every 106 and reaches 95mm of a 98mm shin,
     * which is the cloth passing through the middle of the leg. The particle
     * residual stays at 0.0-1.8mm throughout — the garment is not badly solved,
     * it is badly sampled, and covering it needs about 145 particles against
     * the 99 the LOD gate allows.
     */
    const out = [];
    for (const id of IDS) {
      const r = rest(id);
      assert(r.s.per < 0.098,
        `${id} samples its cloth every ${(r.s.per * 1000).toFixed(0)}mm, which is coarser than the 98mm shin it drapes — `
        + 'it will cut through the leg between particles whatever the solver does');
      assert(r.s.down < 0.150,
        `${id}'s rows are ${(r.s.down * 1000).toFixed(0)}mm apart — a 98mm collider fits between them`);
      out.push(`${id} ${(r.s.per * 1000).toFixed(0)}mm`);
    }
    return out.join(', ');
  });

  check('garments: the legs still swing inside every cut', () => {
    /*
     * Two measurements, because they answer different questions.
     *
     * The PARTICLE residual is the solver's own contract: the collision push is
     * the last thing update() does, so anything left inside a limb is what four
     * iterations could not clear. The shipped robe reads 0.0mm standing and at
     * a stroll and 17.2mm through the jog band, where the knee crosses a quad
     * faster than the solve can answer.
     *
     * The SURFACE figure is the cloth's triangles against the same spheres, and
     * it is mostly a statement about sampling — see the check above. It is here
     * as a relative bound: at a stroll, where the solver is converging and the
     * numbers are stable, no cut may be more than 40mm worse than the temple
     * robe. (Above about 3 m/s every garment in the list, the shipped one
     * included, is beaten by the stride: the thigh's own collider leaves the
     * skirt's silhouette entirely, which is why the bound is measured at 1.6.)
     */
    const base = { part: 0, surf: 0 };
    const out = [];
    for (const id of [null, ...IDS]) {
      const P = [], S = [];
      const w = drive({ speed: 1.6, seconds: 6, tail: 120, skirt: id ? { cut: id } : {},
        sample: (i, { rig, skirt: sk }) => { P.push(legParticle(sk, rig)); S.push(legSurface(sk, rig)); } });
      w.skirt.dispose();
      const part = pct(P, 1), surf = pct(S, 0.95);
      if (id === null) { base.part = part; base.surf = surf; continue; }
      assert(part < 0.012,
        `${id} ends a frame with a particle ${(part * 1000).toFixed(1)}mm inside a leg at a stroll `
        + `(the temple robe: ${(base.part * 1000).toFixed(1)}mm) — the solve is not converging under this cut`);
      assert(surf < base.surf + 0.040,
        `${id}'s cloth reaches ${(surf * 1000).toFixed(0)}mm into a leg against the temple robe's `
        + `${(base.surf * 1000).toFixed(0)}mm — the legs are outside this garment, not inside it`);
      out.push(`${id} ${(surf * 1000).toFixed(0)}mm`);
    }
    assert(base.surf > 0.02,
      `the temple robe reads only ${(base.surf * 1000).toFixed(0)}mm, so the bound above is no longer measuring anything`);
    return `surface, at a stroll: temple ${(base.surf * 1000).toFixed(0)}mm; ` + out.join(', ');
  });

  check('garments: no cut rides up or stretches worse than the robe that shipped', () => {
    /*
     * The skirt rides up its own anchor at a sprint — 274mm of a 460mm garment
     * — and so does the cape. It is not the wind: switching the wind off leaves
     * 236 of those 274mm, because the inner shell pumps the cloth up its own
     * cone every stride. That is the solver's established behaviour and this
     * check exists so a cut does not make it worse: as a FRACTION of the
     * garment (a 300mm tabard riding 300mm has vanished; a 740mm cassock riding
     * 300mm has not), and in stretch, which is the same energy arriving in the
     * links instead.
     */
    const line = [];
    let baseRide = 0, baseStretch = 0;
    for (const id of [null, ...IDS]) {
      const o = id ? { cut: id } : {};
      const r = id ? rest(id) : rest(null);
      const H = [], S = [];
      drive({ speed: 7.4, seconds: 7, tail: 150, skirt: o,
        sample: (i, { rig, skirt: sk }) => { H.push(hemOf(sk, rig).y); S.push(stretch(sk)); } }).skirt.dispose();
      const ride = (H.reduce((a, b) => a + b, 0) / H.length - r.hem.y) / r.len;
      const str = pct(S, 0.95);
      if (id === null) { baseRide = ride; baseStretch = str; continue; }
      assert(ride < baseRide + 0.10,
        `${id} rides ${(ride * 100).toFixed(0)}% of its own length up its anchor at 7.4 m/s against the temple robe's ${(baseRide * 100).toFixed(0)}%`);
      assert(str < baseStretch + 0.10,
        `${id} stretches a vertical link ${(str * 100).toFixed(0)}% over its cut length at a sprint against the temple robe's ${(baseStretch * 100).toFixed(0)}%`);
      line.push(`${id} ${(ride * 100).toFixed(0)}%/${(str * 100).toFixed(0)}%`);
    }
    assert(baseRide > 0.4 && baseRide < 0.8,
      `the temple robe now rides ${(baseRide * 100).toFixed(0)}% at a sprint rather than the 60% these bounds were set against — re-derive them`);
    return `ride/stretch at 7.4 m/s — temple ${(baseRide * 100).toFixed(0)}%/${(baseStretch * 100).toFixed(0)}%; ` + line.join(', ');
  });

  check('garments: the cape stays outside whatever the wearer has on', () => {
    /*
     * The cape's collider proxy IS the skirt's own particles, taken at each
     * row's widest point, so a cut that changes the silhouette changes the
     * surface the cape hangs on. Two things to prove: that the live proxy keeps
     * the cape out of every cut, and that it is still earning its place —
     * against the fixed table the cape used to carry, the ceremonial robe is
     * 86mm bigger than the photograph and the cape goes straight through it.
     */
    const line = [];
    let tableWorst = 0;
    for (const id of IDS) {
      let live = 0, liveBad = 0, table = 0;
      for (const feed of [false, true]) {
        drive({ speed: 0, seconds: 6, tail: 120, skirt: { cut: id }, cloak: {}, feed,
          sample: (i, { rig, skirt: sk, cloak: cl }) => {
            const r = capeInside(sk, cl, rig);
            if (feed) { live = Math.max(live, r.worst); liveBad += r.any; }
            else table = Math.max(table, r.worst);
          } });
      }
      assert(live < 0.002,
        `the cape is ${(live * 1000).toFixed(1)}mm inside the ${id} on ${liveBad} frames even with the live proxy`);
      tableWorst = Math.max(tableWorst, table);
      line.push(`${id} ${(table * 1000).toFixed(0)}→${(live * 1000).toFixed(1)}mm`);
    }
    assert(tableWorst > 0.02,
      `the fixed table would keep the cape out of every cut (worst ${(tableWorst * 1000).toFixed(1)}mm), so the live proxy is not needed — delete it`);
    return `fixed table → live proxy: ` + line.join(', ');
  });

  check('garments: the asymmetric cut is cut asymmetric, not knocked sideways', () => {
    /*
     * `hemBias` scales the per-column drop by 1 + b·cos(θ + phase), so the rest
     * lengths sampled off that layout really are longer on one side. Three
     * things separate that from a symmetric garment that happens to be swinging:
     * the slant is there standing, it is still there after seven seconds of
     * walking, and it is in the CLOTH — the vertical rest lengths differ round
     * the ring by the same factor the hem does.
     */
    const wrap = rest('wrap');
    assert(wrap.hemBias > 0, 'the wrap cut carries no hemBias, so nothing here is being tested');
    const level = IDS.filter((id) => id !== 'wrap').map((id) => rest(id).hem.slant);
    const worstLevel = Math.max(...level);
    assert(wrap.hem.slant > 0.20,
      `the wrap's hem is only ${(wrap.hem.slant * 1000).toFixed(0)}mm out of level standing — that is not an asymmetric garment`);
    assert(worstLevel < 0.08,
      `a symmetric cut hangs ${(worstLevel * 1000).toFixed(0)}mm out of level, so the wrap's slant proves nothing`);
    // it is in the fabric, not in the pose
    const w = drive({ speed: 0, seconds: 3, tail: 1, skirt: { cut: 'wrap' } });
    const sk = w.skirt;
    const perCol = new Float64Array(sk.cols);
    for (const l of sk.links) {
      if (l.kind !== 0 || l.across) continue;
      perCol[l.a % sk.cols] += l.rest0;
    }
    const lo = Math.min(...perCol), hi = Math.max(...perCol);
    assert(hi / lo > 1.4,
      `the longest column of the wrap is only ${((hi / lo - 1) * 100).toFixed(0)}% longer than the shortest — the hem is displaced, not cut`);
    sk.dispose();
    // and it survives a walk
    let slant = 1e9;
    drive({ speed: 4.6, seconds: 7, tail: 60, skirt: { cut: 'wrap' },
      sample: (i, { rig, skirt: s }) => { slant = Math.min(slant, hemOf(s, rig).slant); } }).skirt.dispose();
    assert(slant > 0.12,
      `after seven seconds of walking the wrap's hem is within ${(slant * 1000).toFixed(0)}mm of level — the cut washed out`);
    return `standing slant ${(wrap.hem.slant * 1000).toFixed(0)}mm against ${(worstLevel * 1000).toFixed(0)}mm for the level cuts, `
      + `columns cut ${((hi / lo - 1) * 100).toFixed(0)}% apart, ${(slant * 1000).toFixed(0)}mm still slanted at a walk`;
  });

  check('garments: a short cut is held by two rings, and the second one is a ring', () => {
    /*
     * `pinRows` has been a parameter since the tube landed and attachSkirt fed
     * it an anchor that ignored the row index — so both waistbands came out at
     * the same height, with a zero-length structural link between them and a
     * second ring at the belt's own radius instead of the body's. The tabard is
     * the first cut to ask for one, because it is the only thing that stops a
     * 300mm garment finishing a sprint bunched at the waist.
     */
    const w = drive({ speed: 0, seconds: 3, tail: 1, skirt: { cut: 'tabard' } });
    const sk = w.skirt;
    assert(sk.pinRows === 2, `the tabard pins ${sk.pinRows} row(s)`);
    const inv = hipsInv(w.rig), v = new THREE.Vector3();
    const ring = (r) => {
      let y = 0, rad = 0;
      for (let c = 0; c < sk.cols; c++) {
        const i = (r * sk.cols + c) * 3;
        v.set(sk.pos[i], sk.pos[i + 1], sk.pos[i + 2]).applyMatrix4(inv);
        y += v.y; rad += Math.hypot(v.x, v.z);
      }
      return { y: y / sk.cols, r: rad / sk.cols };
    };
    const r0 = ring(0), r1 = ring(1);
    assert(r0.y - r1.y > 0.04,
      `the two pinned rings are ${((r0.y - r1.y) * 1000).toFixed(1)}mm apart — the second one is on top of the first and the link between them has no length`);
    assert(r1.r > r0.r + 0.03,
      `the second ring sits at ${(r1.r * 1000).toFixed(0)}mm against the belt's ${(r0.r * 1000).toFixed(0)}mm — it is not following the body`);
    for (let i = 0; i < sk.cols * 2; i++) assert(sk.pinned[i], `particle ${i} of the two rings is not pinned`);
    sk.dispose();

    // and the ring is what holds the hem down: same cut on one ring rides away
    const ride = (opts) => {
      const r = drive({ speed: 0, seconds: 5, tail: 1, skirt: { cut: 'tabard', ...opts } });
      const y0 = hemOf(r.skirt, r.rig).y, len = r.skirt.length;
      r.skirt.dispose();
      const H = [];
      drive({ speed: 7.4, seconds: 7, tail: 150, skirt: { cut: 'tabard', ...opts },
        sample: (i, { rig, skirt: s }) => H.push(hemOf(s, rig).y) }).skirt.dispose();
      return (H.reduce((a, b) => a + b, 0) / H.length - y0) / len;
    };
    const two = ride({}), one = ride({ pinRows: 1 });
    assert(two < one - 0.25,
      `on one ring the tabard rides ${(one * 100).toFixed(0)}% of its length and on two it rides ${(two * 100).toFixed(0)}% — the second ring is not doing anything`);
    assert(two < 0.35,
      `even on two rings the tabard rides ${(two * 100).toFixed(0)}% of its own length at a sprint`);
    return `rings ${((r0.y - r1.y) * 1000).toFixed(0)}mm apart at ${(r0.r * 1000).toFixed(0)}→${(r1.r * 1000).toFixed(0)}mm; `
      + `sprint ride-up ${(one * 100).toFixed(0)}% on one ring, ${(two * 100).toFixed(0)}% on two`;
  });

  check('garments: weight is not gravity, and every cut pays the cape\'s budget', () => {
    /*
     * TWO CLAIMS THAT BELONG TOGETHER, because both are about what a preset is
     * allowed to spend.
     *
     * The first is the one that will be re-derived by whoever next writes a
     * "heavier" robe: in a verlet solve where every particle masses the same,
     * `gravity` is not weight, it is LOAD, and a chain's sag is load over
     * stiffness. Turning it up buys stretch and nothing else. Heft is damping,
     * a fabric deaf to the air, and a stiff bend down the cloth.
     *
     * The second is the cape's budget, which the skirt has always had to live
     * inside: 99 particles, four iterations, and particles × colliders under
     * what the cape itself costs — and the rigid lathes underneath have to come
     * back when the simulation is switched off at range, or a distant character
     * is a bare pelvis.
     */
    const heavy = [];
    for (const g of [-13, -16]) {
      const S = [];
      drive({ speed: 7.4, seconds: 7, tail: 150, skirt: { cut: 'cassock', gravity: g },
        sample: (i, { skirt: sk }) => S.push(stretch(sk)) }).skirt.dispose();
      heavy.push(pct(S, 0.95));
    }
    assert(heavy[1] > heavy[0] * 1.15,
      `raising gravity from -13 to -16 changed the cassock's sprint stretch from ${(heavy[0] * 100).toFixed(0)}% to `
      + `${(heavy[1] * 100).toFixed(0)}% — the note in Cloth.js says it costs 15%+ and would need re-deriving`);

    const built = buildJedi({ scale: 1 });
    built.rig.updateMatrices(); built.rig.root.updateMatrixWorld(true);
    const cape = attachCloak(new THREE.Scene(), built.rig, { width: 0.36, length: 0.86, cols: 9, rows: 11 });
    const nCape = cape.cols * cape.rows, cCape = cape.refreshColliders().length;
    let rigidTris = 0;
    for (const m of built.robeSkirt) rigidTris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    const worst = { id: '', n: 0, tests: 0 };
    for (const id of IDS) {
      const sc = new THREE.Scene();
      const sk = attachSkirt(sc, built.rig, { cut: id, rigid: built.robeSkirt });
      const n = sk.cols * sk.rows, c = sk.refreshColliders().length;
      assert(n <= nCape, `${id} costs ${n} particles against the cape's ${nCape}`);
      assert(sk.links.length <= cape.links.length * 1.1,
        `${id} costs ${sk.links.length} links against the cape's ${cape.links.length}`);
      assert(sk.iterations === cape.iterations, `${id} solves ${sk.iterations} passes, not the cape's ${cape.iterations}`);
      assert(n * c <= nCape * cCape,
        `${id} costs ${n * c} sphere tests a pass against the cape's ${nCape * cCape}`);
      assert(sk.geometry.index.count / 3 < rigidTris,
        `${id} draws ${sk.geometry.index.count / 3} triangles to replace ${rigidTris} rigid ones`);
      // the LOD gate, both ways, for every cut
      sk.setVisible(false);
      assert(built.robeSkirt.every((m) => m.visible) && !sk.mesh.visible,
        `switching ${id} off at range leaves the character with no robe below the belt`);
      sk.setVisible(true);
      assert(built.robeSkirt.every((m) => !m.visible) && sk.mesh.visible,
        `the rigid lathes are still drawn under the ${id}`);
      sk.dispose();
      assert(built.robeSkirt.every((m) => m.visible), `disposing the ${id} left the robe invisible`);
      if (n * c > worst.tests) { worst.id = id; worst.n = n; worst.tests = n * c; }
    }
    cape.dispose();
    return `gravity -13→-16 costs ${(heavy[0] * 100).toFixed(0)}%→${(heavy[1] * 100).toFixed(0)}% stretch; `
      + `dearest cut is ${worst.id} at ${worst.n} particles and ${worst.tests} sphere tests against the cape's ${nCape * cCape}`;
  });
}
