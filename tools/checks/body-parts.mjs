/**
 * BATTLEFRONT BORZ — the parts of a character that are supposed to MOVE.
 *
 * Two of them could not, for the same underlying reason: a parameter existed,
 * read correctly, was smoothed and blended by the code around it, and then
 * reached geometry that had no way to express it.
 *
 *   THE HAND. GESTURES[].palm rolls the off hand from pointing at the target
 *   to a flat palm facing it. It reached exactly one function — aimBoneWorld,
 *   which writes a QUATERNION and nothing else — while the hand itself is one
 *   baked BufferGeometry built at curl 0.95, with the source meshes disposed.
 *   So `stasis` at palm 1.0 turned the wrist until the palm faced the target
 *   and then presented it a clenched fist. Every Force power in the game was
 *   thrown with a fist.
 *
 *   THE CLOAK. A real verlet cloth — structural, shear and bend links, four
 *   passes, sphere colliders, kicked by landings and pushes — that could not
 *   fold, because reset() sampled its rest lengths off the laid-out TAUT shape.
 *   A smooth sheet was the rest state, so the solver was converging correctly
 *   on the one thing nobody wanted. There was no surplus fabric anywhere in it.
 *
 * The numbers in here are measured off the headless sim and the built geometry,
 * both of which run in milliseconds. Where a bound looks arbitrary the comment
 * says what the old code read and what the new one does.
 */

import * as THREE from 'three';
import { buildHand, buildJedi, dressHumanoid, addShapeMorph } from '../../src/game/Bodies.js';
import { Rig, humanoidSkeleton, BipedAnimator } from '../../src/game/Rig.js';
import { Cloak, attachCloak, attachSkirt } from '../../src/game/Cloth.js';
import { Player } from '../../src/game/Player.js';
import { weave, weaveLine } from './_weave.mjs';
import { readFile } from 'node:fs/promises';

/* ══════════════════════════════════════════════════════════════════════ */
/*  hand                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Connected components over triangle adjacency.
 *
 * A merged geometry's triangles never span two source parts — mergeGeos offsets
 * the indices per part — so every component sits inside exactly one part of the
 * hand. That is what makes the rigidity test below a proof of correspondence
 * rather than a plausibility argument.
 */
function components(geo) {
  const idx = geo.index.array, n = geo.attributes.position.count;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let i = 0; i < idx.length; i += 3) { uni(idx[i], idx[i + 1]); uni(idx[i + 1], idx[i + 2]); }
  const m = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(i); }
  return [...m.values()];
}

/** The hand mesh of a built archetype. */
function handOf(built, side) { return built.rig.get('hand' + side).primary; }

/** Where vertex i lands at a given morph influence. */
function morphed(geo, i, w) {
  const p = geo.attributes.position, d = geo.morphAttributes.position[0];
  return [p.getX(i) + d.getX(i) * w, p.getY(i) + d.getY(i) * w, p.getZ(i) + d.getZ(i) * w];
}

export async function run({ check, assert }) {
  check('hand: the open and closed builds are the same topology, vertex for vertex', () => {
    // The whole morph scheme rests on this and nothing enforces it at runtime
    // except addShapeMorph's guard, so it is asserted here on the real builder.
    // `curl` and `splay` only ever set rotations on the authoring groups — no
    // geometry is BUILT differently — so the flattened result must correspond.
    let detail = '';
    for (const side of ['L', 'R']) {
      const fist = buildHand(side, 1, { curl: 0.95 });
      const open = buildHand(side, 1, { curl: 0.08, splay: 1.9 });
      assert(fist.attributes.position.count === open.attributes.position.count,
        `${side}: ${fist.attributes.position.count} vertices against ${open.attributes.position.count}`);
      assert(fist.index.count === open.index.count, `${side}: index buffers differ in length`);
      for (let i = 0; i < fist.index.count; i++) {
        assert(fist.index.getX(i) === open.index.getX(i), `${side}: index ${i} differs — vertex order is not the same`);
      }
      // Correspondence, not just equal counts. Within one source part the map
      // from closed to open is a rigid motion, so every pairwise distance is
      // preserved. If vertex i meant a different part in the two builds this
      // would break immediately.
      const ca = components(fist), cb = components(open);
      assert(ca.length === cb.length, `${side}: ${ca.length} parts against ${cb.length}`);
      const pf = fist.attributes.position.array, po = open.attributes.position.array;
      let worst = 0, moved = 0;
      for (const c of ca) {
        let any = false;
        for (let x = 0; x < c.length; x++) {
          for (let y = x + 1; y < Math.min(c.length, x + 10); y++) {
            const i = c[x] * 3, j = c[y] * 3;
            const da = Math.hypot(pf[i] - pf[j], pf[i + 1] - pf[j + 1], pf[i + 2] - pf[j + 2]);
            const db = Math.hypot(po[i] - po[j], po[i + 1] - po[j + 1], po[i + 2] - po[j + 2]);
            worst = Math.max(worst, Math.abs(da - db));
          }
          const i = c[x] * 3;
          if (Math.hypot(pf[i] - po[i], pf[i + 1] - po[i + 1], pf[i + 2] - po[i + 2]) > 1e-5) any = true;
        }
        if (any) moved++;
      }
      // float32 on a 10cm part: 1.4e-8 m measured. 1e-6 is three orders of slack.
      assert(worst < 1e-6, `${side}: a part changed shape by ${worst.toExponential(2)} m between curls — not a rigid motion`);
      // four fingers of three bones plus two thumb segments
      assert(moved === 14, `${side}: ${moved} parts move with curl, expected the 14 digit bones`);
      detail = `${fist.attributes.position.count} verts, ${ca.length} parts, 14 move, drift ${worst.toExponential(1)} m`;
      fist.dispose(); open.dispose();
    }
    return detail;
  });

  check('hand: addShapeMorph refuses a morph across mismatched topology', () => {
    // A morph over the wrong vertex order is silent garbage, not an error. The
    // guard is the entire safety of the scheme, so it is pinned.
    const a = buildHand('L', 1, { curl: 0.95 });
    const b = buildHand('L', 1, { curl: 0.2, fingers: 3 });   // three fingers: fewer parts
    let threw = false;
    try { addShapeMorph(a, b, 'bad'); } catch { threw = true; }
    assert(threw, 'a morph was accepted between two different builds of the hand');
    return 'a 3-fingered target against a 4-fingered base is refused';
  });

  check('hand: the built player hand can actually open', () => {
    const jedi = buildJedi();
    for (const side of ['L', 'R']) {
      const m = handOf(jedi, side), g = m.geometry;
      assert(g.morphAttributes.position && g.morphAttributes.position.length === 1,
        `hand${side} has no open morph — every Force power is thrown with a fist`);
      assert(g.morphTargetsRelative === true, `hand${side}'s morph is absolute, not a delta`);
      assert(Array.isArray(m.morphTargetInfluences) && m.morphTargetInfluences.length === 1,
        `hand${side}'s mesh has no influence to drive`);
      assert(m.morphTargetDictionary.open === 0, `hand${side}'s morph is not named 'open'`);
    }
    // The fingertips have to travel far enough to read as an open hand at arm's
    // length. Measured: 113mm at scale 1, which is a finger going from folded
    // into the palm to straight.
    const g = handOf(jedi, 'L').geometry;
    const d = g.morphAttributes.position[0];
    let far = 0;
    for (let i = 0; i < d.count; i++) far = Math.max(far, Math.hypot(d.getX(i), d.getY(i), d.getZ(i)));
    assert(far > 0.080, `the open hand only moves ${(far * 1000).toFixed(0)} mm — that is a twitch, not an open palm`);
    // and the fingers must end up FORWARD of the palm, not curled behind it:
    // the hand-bone frame runs +Y wrist→knuckles, so an open finger is further
    // from the wrist than a closed one.
    let hiFist = 0, hiOpen = 0;
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      hiFist = Math.max(hiFist, p.getY(i));
      hiOpen = Math.max(hiOpen, morphed(g, i, 1)[1]);
    }
    assert(hiOpen > hiFist + 0.040,
      `the open hand reaches ${(hiOpen * 1000).toFixed(0)} mm against the fist's ${(hiFist * 1000).toFixed(0)} — the fingers did not extend`);
    // The bounding sphere must cover the open pose or an outstretched hand is
    // culled at the edge of frame — mergeGeos sized it around the fist alone.
    const bs = g.boundingSphere;
    let out = 0;
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = morphed(g, i, 1);
      if (Math.hypot(x - bs.center.x, y - bs.center.y, z - bs.center.z) > bs.radius + 1e-6) out++;
    }
    assert(out === 0,
      `${out} vertices of the open hand fall outside the bounding sphere — it will pop out at the screen edge`);
    return `${(far * 1000).toFixed(0)} mm of travel, reach ${(hiFist * 1000).toFixed(0)}→${(hiOpen * 1000).toFixed(0)} mm`;
  });

  check('hand: no crease is painted where nothing casts it', () => {
    // The AO set is a POSITIONAL field baked into vertex colours, and a baked
    // colour travels with its vertex. The closed-hand bake includes the shadow
    // the curled fingers throw back onto the palm; carried onto an open hand it
    // paints 272 of 364 digit vertices below 0.90 and lands a mean of 0.775
    // where the open pose wants 0.976 — a fifth of the light missing off an
    // extended hand, and a shadow on the palm with no finger over it.
    const g = handOf(buildJedi(), 'L').geometry;
    assert(g.morphAttributes.color && g.morphAttributes.color.length === 1,
      'the open hand reuses the fist\'s baked occlusion');
    const c = g.attributes.color, dc = g.morphAttributes.color[0];
    const dp = g.morphAttributes.position[0];
    let n = 0, fist = 0, open = 0, worst = 1;
    for (let i = 0; i < c.count; i++) {
      // digit vertices are exactly the ones the morph moves
      if (Math.hypot(dp.getX(i), dp.getY(i), dp.getZ(i)) < 1e-5) continue;
      n++;
      fist += c.getX(i);
      const o = c.getX(i) + dc.getX(i);
      open += o;
      worst = Math.min(worst, o);
      assert(o <= 1.0001 && o >= 0, `a morphed vertex colour left [0,1]: ${o}`);
    }
    const mf = fist / n, mo = open / n;
    assert(mo > mf * 1.15,
      `the open hand is only ${((mo / mf - 1) * 100).toFixed(0)}% brighter than the fist — the fist's creases are still on it`);
    assert(worst > 0.55, `an open finger still sits at ${worst.toFixed(2)} of full light`);
    return `${n} digit verts, mean ${mf.toFixed(3)} closed → ${mo.toFixed(3)} open, darkest open ${worst.toFixed(2)}`;
  });

  check('hand: the Force opens the LEFT hand, in proportion, and never the right', () => {
    // The saber lives in the right hand and the blade solve owns that arm, which
    // is why every gesture in GESTURES is left-handed. A grip that opened
    // mid-swing would drop the blade out of the hand on screen.
    const made = { handL: { primary: { morphTargetInfluences: [0] } },
                   handR: { primary: { morphTargetInfluences: [0] } } };
    const me = { rig: { get: (n) => made[n] }, gesture: { kind: '', env: 0 } };
    const open = () => Player.prototype._openPalm.call(me);
    const L = () => made.handL.primary.morphTargetInfluences[0];

    open();
    assert(L() === 0, 'the hand is open with no gesture running');
    // stasis is palm 1.0 — the pose that used to present a fist to the target
    me.gesture = { kind: 'stasis', env: 1 };
    open();
    assert(Math.abs(L() - 1) < 1e-9, `stasis at full envelope gives influence ${L()}, not 1`);
    // and it is a product with the envelope, so the hand travels rather than snapping
    me.gesture = { kind: 'push', env: 0.5 };
    open();
    assert(Math.abs(L() - 0.85 * 0.5) < 1e-9, `push at half envelope gives ${L()}, not palm × env`);
    // sense is palm 0.0 — a pointing hand, and it must stay closed
    me.gesture = { kind: 'sense', env: 1 };
    open();
    assert(L() === 0, 'a palm-0 gesture opened the hand anyway');
    assert(made.handR.primary.morphTargetInfluences[0] === 0,
      'the saber hand was opened — the blade is being held in a hand with its fingers out');

    // a hand with no morph on it (every droid) must not throw
    me.rig = { get: () => ({ primary: { } }) };
    me.gesture = { kind: 'push', env: 1 };
    open();
    return 'stasis→1.00, push@0.5→0.425, sense→0, right hand untouched, droids unharmed';
  });

  check('hand: a style that declares a hand shape has it reach the builder', () => {
    // THE GENERAL FORM, and the one grip.mjs already states: a field written and
    // never read is not a feature. `hands: { curl: 0.95 }` sat on the Jedi style
    // beside a `handGeo` that took (side, scale) and hard-coded the same 0.95 —
    // the ternary in dressHumanoid never reached `hands` at all, so editing it
    // did nothing whatsoever, in either direction.
    const rig = new Rig(humanoidSkeleton(1), { scale: 1 });
    let seen = null;
    dressHumanoid(rig, {
      scale: 1,
      body: new THREE.MeshBasicMaterial(),
      handGeo: (side, s, o) => { seen = o; return buildHand(side, s, o); },
      hands: { curl: 0.33, palmW: 0.071 },
    });
    assert(seen, 'handGeo was never called');
    assert(seen.curl === 0.33 && seen.palmW === 0.071,
      `handGeo received ${JSON.stringify(seen)} — the style's hand shape is inert again`);
    return 'style.hands reaches style.handGeo';
  });

  /* ════════════════════════════════════════════════════════════════════ */
  /*  cloak                                                               */
  /* ════════════════════════════════════════════════════════════════════ */

  /** The player's own collar, without needing a posed rig. */
  const collar = (halfSpan = 0.18) => (c, n, out) => {
    const t = n === 1 ? 0.5 : c / (n - 1);
    out.set(-halfSpan + 2 * halfSpan * t, 1.42, -0.10);
    out.z -= Math.cos((t - 0.5) * Math.PI) * 0.055;
  };
  const BODY = (() => {
    const o = [], add = (y, r) => o.push({ c: new THREE.Vector3(0, y, 0), r });
    add(1.30, 0.20); add(1.14, 0.19); add(0.98, 0.20);
    for (const [dy, r] of [[-0.04, 0.205], [-0.15, 0.225], [-0.26, 0.255], [-0.37, 0.235],
                           [-0.48, 0.205], [-0.59, 0.205], [-0.68, 0.210]]) add(0.98 + dy, r);
    return o;
  })();
  const scene = new THREE.Scene();
  const cloak = (opts) => new Cloak(scene, {
    cols: 9, rows: 11, width: 0.36, length: 0.86, flare: 1.0, gravity: -13,
    seed: 12345, anchorFn: collar(), ...opts,
  });
  /** What HEAD did, said in the options that now exist. */
  const TAUT = { fullness: 1, jitter: 0, lift: 0, drift: 1,
                 shear: 0.82, bend: 0.82, bendDown: 0.82, bendStretchOnly: false };

  /**
   * Fold depth and fold count.
   *
   * A quadratic fitted across each row absorbs the shape the cloak is SUPPOSED
   * to have — the flare, the collar bow, the gross swing — and leaves the
   * wrinkle. Deviation from a best-fit plane is the obvious metric and it is
   * the wrong one: the rest shape is a flared cone, so a perfectly taut cloak
   * already scores on it.
   */
  function folds(cl) {
    const { cols, rows, pos } = cl;
    // normal equations for [1, i, i²] — the design matrix never changes
    const A = [];
    for (let i = 0; i < cols; i++) A.push([1, i, i * i]);
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const r of A) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += r[a] * r[b];
    const [a0, b0, c0] = M[0], [d0, e0, f0] = M[1], [g0, h0, i0] = M[2];
    const det = a0 * (e0 * i0 - f0 * h0) - b0 * (d0 * i0 - f0 * g0) + c0 * (d0 * h0 - e0 * g0);
    const inv = [
      [(e0 * i0 - f0 * h0) / det, (c0 * h0 - b0 * i0) / det, (b0 * f0 - c0 * e0) / det],
      [(f0 * g0 - d0 * i0) / det, (a0 * i0 - c0 * g0) / det, (c0 * d0 - a0 * f0) / det],
      [(d0 * h0 - e0 * g0) / det, (b0 * g0 - a0 * h0) / det, (a0 * e0 - b0 * d0) / det],
    ];
    let sum = 0, n = 0, flips = 0, nr = 0;
    const res = new Float64Array(cols * 3);
    for (let r = 1; r < rows; r++) {
      for (let k = 0; k < 3; k++) {
        const Aty = [0, 0, 0];
        for (let c = 0; c < cols; c++) {
          const v = pos[(r * cols + c) * 3 + k];
          for (let a = 0; a < 3; a++) Aty[a] += A[c][a] * v;
        }
        const co = [0, 0, 0];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) co[a] += inv[a][b] * Aty[b];
        for (let c = 0; c < cols; c++) {
          const d = pos[(r * cols + c) * 3 + k] - (co[0] + co[1] * c + co[2] * c * c);
          res[c * 3 + k] = d; sum += d * d; n++;
        }
      }
      let cx = 0, cz = 0;
      for (let c = 0; c < cols; c++) { cx += pos[(r * cols + c) * 3]; cz += pos[(r * cols + c) * 3 + 2]; }
      cx /= cols; cz /= cols;
      let prev = 0;
      for (let c = 0; c < cols; c++) {
        let ox = pos[(r * cols + c) * 3] - cx, oz = pos[(r * cols + c) * 3 + 2] - cz;
        const L = Math.hypot(ox, oz) || 1;
        const v = res[c * 3] * ox / L + res[c * 3 + 2] * oz / L;
        if (Math.abs(v) < 1e-4) continue;              // 0.1 mm is not a fold
        const s = Math.sign(v);
        if (prev !== 0 && s !== prev) flips++;
        prev = s;
      }
      nr++;
    }
    return { rms: Math.sqrt(sum / (n / 3)), count: flips / nr };
  }

  /** Hang the cloak and let it settle. */
  function settle(opts, frames = 300) {
    const cl = cloak(opts);
    cl.reset();
    const W = new THREE.Vector3();
    for (let f = 0; f < frames; f++) cl.update(1 / 60, BODY, W);
    return cl;
  }

  check('cloak: the fabric has surplus in it to fold with', () => {
    // reset() sampled rest lengths straight off the laid-out shape, which makes
    // a smooth taut sheet the rest state — the solver had nothing to gather and
    // was converging, correctly, on the thing that reads as a board.
    const cl = cloak({});
    cl.reset();
    let across = 0, an = 0, down = 0, dn = 0;
    for (const l of cl.links) {
      assert(l.rest0 > 0, 'the taut length is not recorded, so nothing can tell surplus from stretch');
      if (l.across) { across += l.rest / l.rest0; an++; } else { down += l.rest / l.rest0; dn++; }
    }
    const a = across / an, d = down / dn;
    assert(a < 0.94, `across-cloth rest is ${(a * 100).toFixed(1)}% of the taut span — there is no fabric to gather`);
    assert(a > 0.74, `across-cloth rest is ${(a * 100).toFixed(1)}% of the taut span — that is a corset, not fullness`);
    // the drop must NOT be shortened: a cape gathers across, it does not ruche up
    assert(Math.abs(d - 1) < 0.02, `down-cloth rest is ${(d * 100).toFixed(1)}% of taut — the cape has been shortened`);
    cl.dispose();
    return `across ${(a * 100).toFixed(0)}% of taut, down ${(d * 100).toFixed(0)}%`;
  });

  check('cloak: it folds, and the folds are folds rather than solver noise', () => {
    const taut = settle(TAUT), now = settle({});
    const a = folds(taut), b = folds(now);
    // measured: 7.3 mm RMS and 2.0 sign changes per row on the shipped cloth,
    // which is the gentle bulge of a cone and not a fold at all.
    assert(a.rms < 0.011, `the taut reference already folds (${(a.rms * 1000).toFixed(1)} mm) — the metric is not measuring what it claims`);
    assert(b.rms > 0.013,
      `the cloak wrinkles ${(b.rms * 1000).toFixed(1)} mm; it reads as a board below about 13`);
    assert(b.count > 3.0,
      `only ${b.count.toFixed(1)} fold crossings per row — one bulge is not a garment`);
    assert(b.count < 7.0,
      `${b.count.toFixed(1)} crossings per row is a per-column checkerboard, which is a buckling artefact and not cloth`);
    // and it must still be the cape that was cut: a fold is surplus fabric, not
    // a stretched link. Everything below is measured against the TAUT length.
    let worst = 0;
    for (const l of now.links) {
      if (l.kind !== 0 || l.across) continue;
      const i = l.a * 3, j = l.b * 3;
      const d = Math.hypot(now.pos[j] - now.pos[i], now.pos[j + 1] - now.pos[i + 1], now.pos[j + 2] - now.pos[i + 2]);
      worst = Math.max(worst, d / l.rest0);
    }
    assert(worst < 1.30, `a vertical link is stretched to ${((worst - 1) * 100).toFixed(0)}% over its cut length — the cloth is going stretchy, not foldy`);
    const r = `taut ${(a.rms * 1000).toFixed(1)} mm / ${a.count.toFixed(1)} × → now ${(b.rms * 1000).toFixed(1)} mm / ${b.count.toFixed(1)} ×`;
    taut.dispose(); now.dispose();
    return r;
  });

  check('cloak: a bend link never pushes a forming fold flat', () => {
    // 321 of the 496 links in a 9×11 sheet are shear or bend, every one of them
    // crosses a would-be fold, and all of them were solved bilaterally at the
    // structural 0.82. A bend link in COMPRESSION is a fold; resisting it is an
    // active anti-fold force with no physical counterpart.
    // One bend link, on its own, with every other constraint removed — anything
    // less and the neighbours' pull is indistinguishable from the bend link's.
    const solo = (scale) => {
      const cl = cloak({ gravity: 0, lift: 0, drift: 0 });
      cl.reset();
      const l = cl.links.find(x => x.kind === 2 && !cl.pinned[x.a] && !cl.pinned[x.b]);
      assert(l, 'the sheet has no free bend link to test');
      cl.links = [l];
      const a = l.a * 3, b = l.b * 3;
      const mx = (cl.pos[a] + cl.pos[b]) / 2, my = (cl.pos[a + 1] + cl.pos[b + 1]) / 2, mz = (cl.pos[a + 2] + cl.pos[b + 2]) / 2;
      for (const i of [a, b]) {
        cl.pos[i] = mx + (cl.pos[i] - mx) * scale;
        cl.pos[i + 1] = my + (cl.pos[i + 1] - my) * scale;
        cl.pos[i + 2] = mz + (cl.pos[i + 2] - mz) * scale;
        cl.prev[i] = cl.pos[i]; cl.prev[i + 1] = cl.pos[i + 1]; cl.prev[i + 2] = cl.pos[i + 2];
      }
      const len = () => Math.hypot(cl.pos[b] - cl.pos[a], cl.pos[b + 1] - cl.pos[a + 1], cl.pos[b + 2] - cl.pos[a + 2]);
      const before = len();
      cl.update(1 / 60, [], new THREE.Vector3());
      const after = len();
      cl.dispose();
      return [before, after];
    };
    const [c0, c1] = solo(0.5);                 // folded to half: must be left alone
    assert(Math.abs(c1 / c0 - 1) < 1e-4,
      `a folded bend link was opened ${(100 * (c1 / c0 - 1)).toFixed(1)}% in one step — that force pushes every fold flat`);
    const [s0, s1] = solo(1.6);                 // pulled straight: must still resist
    assert(s1 < s0 * 0.999,
      'a stretched bend link does nothing either — the link is dead, not stretch-only');
    return `compressed ${(c0 * 1000).toFixed(1)}→${(c1 * 1000).toFixed(1)} mm (untouched), `
      + `stretched ${(s0 * 1000).toFixed(1)}→${(s1 * 1000).toFixed(1)} mm (pulled back)`;
  });

  check('cloak: wind deforms the sheet as well as moving it', () => {
    // A uniform body force pushes every particle the same way whichever way it
    // faces, so it can translate a cloak and can never crease one. The term that
    // makes cloth flutter is k·(n·v_rel)·n and it was entirely absent.
    const cl = settle({});
    const W = new THREE.Vector3(2.4, 0, -1.1);
    cl._aero(1 / 60, W, cl.gravity);
    let lo = Infinity, hi = -Infinity;
    for (let i = cl.cols; i < cl.cols * cl.rows; i++) {
      const i3 = i * 3;
      const along = cl.acc[i3] * W.x + cl.acc[i3 + 2] * W.z;
      lo = Math.min(lo, along); hi = Math.max(hi, along);
    }
    const spread = (hi - lo) / W.lengthSq();
    assert(spread > 0.15,
      `one wind gives every particle the same push (spread ${spread.toFixed(3)}) — it can only translate the sheet`);
    // and a face-on particle must be pushed harder than an edge-on one, which is
    // the whole asymmetry: check the sign of the correlation with |n·w|
    let best = -1, worst = -1, bestD = -1, worstD = 2;
    for (let i = cl.cols; i < cl.cols * cl.rows; i++) {
      const i3 = i * 3;
      const d = Math.abs(cl.nrm[i3] * W.x + cl.nrm[i3 + 2] * W.z) / W.length();
      if (d > bestD) { bestD = d; best = i3; }
      if (d < worstD) { worstD = d; worst = i3; }
    }
    const push = (i3) => cl.acc[i3] * W.x + cl.acc[i3 + 2] * W.z;
    assert(push(best) > push(worst),
      'the particle facing the wind is pushed no harder than the one edge-on to it');
    const r = `push varies ${spread.toFixed(2)} across the sheet; face-on ${push(best).toFixed(2)} vs edge-on ${push(worst).toFixed(2)}`;
    cl.dispose();
    return r;
  });

  check('cloak: damping is a rate, not a per-frame constant', () => {
    // 0.972 applied literally per frame is 0.972^60 = 0.18 of the speed after a
    // second at 60 fps and 0.972^144 = 0.017 at 144 — an order of magnitude
    // deader on a faster machine. A graphics setting was changing the physics.
    const decay = (fps) => {
      const cl = cloak({ gravity: 0, lift: 0, drift: 0 });
      cl.reset();
      cl.links.length = 0;                       // the integrator alone
      const dt = 1 / fps, i3 = 50 * 3;
      cl.pos[i3] = cl.prev[i3] + 1.0 * dt;       // 1 m/s, whatever the frame rate
      for (let f = 0; f < Math.round(fps); f++) cl.update(dt, [], new THREE.Vector3());
      const v = (cl.pos[i3] - cl.prev[i3]) / dt;
      cl.dispose();
      return v;
    };
    const a = decay(60), b = decay(144);
    assert(Math.abs(b / a - 1) < 0.02,
      `a second of damping leaves ${a.toFixed(3)} m/s at 60 fps and ${b.toFixed(3)} at 144 — the frame rate is the physics`);
    // and the reference rate must be untouched: 0.972^60 = 0.1820
    assert(Math.abs(a - Math.pow(0.972, 60)) < 1e-3,
      `60 fps behaviour moved: ${a.toFixed(4)} against the 0.1820 it always was`);
    return `${a.toFixed(4)} m/s left at 60 fps, ${b.toFixed(4)} at 144`;
  });

  check('cloak: a Force push is the same push at any frame rate', () => {
    // Same defect one function along: in verlet a position offset IS a velocity
    // of offset/dt, so the fixed 0.02 was 1.2 m/s at 60 fps and 2.9 at 144.
    const kick = (fps) => {
      const cl = cloak({}); cl.reset();
      const dt = 1 / fps;
      for (let f = 0; f < Math.round(fps); f++) cl.update(dt, BODY, new THREE.Vector3());
      cl.impulse(new THREE.Vector3(0, 0.4, -1).normalize(), 2.6);
      const i3 = 95 * 3;
      const v = Math.hypot(cl.pos[i3] - cl.prev[i3], cl.pos[i3 + 1] - cl.prev[i3 + 1], cl.pos[i3 + 2] - cl.prev[i3 + 2]) / dt;
      cl.dispose();
      return v;
    };
    const a = kick(60), b = kick(144);
    assert(Math.abs(b / a - 1) < 0.02, `the same push is ${a.toFixed(2)} m/s at 60 fps and ${b.toFixed(2)} at 144`);
    return `${a.toFixed(2)} m/s at both`;
  });

  check('cloak: the seeded rng is used, and two cloaks are not identical', () => {
    // Cloth.js seeded an rng at module scope and never called it once, while the
    // collar was pinned as a perfectly even cosine arc over an evenly spaced
    // grid. That is a symmetric buckling problem, and a symmetric buckling
    // problem has no preferred direction to buckle in. Folds nucleate at
    // irregularity.
    const rests = (o) => { const c = cloak(o); c.reset(); const r = c.links.map(l => l.rest); c.dispose(); return r; };
    const a = rests({ seed: 1 }), b = rests({ seed: 2 }), a2 = rests({ seed: 1 });
    assert(a.some((v, i) => v !== b[i]), 'two differently seeded cloaks are identical — the rng is dead again');
    assert(a.every((v, i) => v === a2[i]), 'the same seed gives a different cloak twice — this is not reproducible');
    // unseeded cloaks must differ from each other too, or every Jedi in a shot
    // wrinkles in lockstep
    const scene2 = new THREE.Scene();
    const mk = () => { const c = new Cloak(scene2, { anchorFn: collar() }); c.reset(); const r = c.links.map(l => l.rest); c.dispose(); return r; };
    const x = mk(), y = mk();
    assert(x.some((v, i) => v !== y[i]), 'two unseeded cloaks are identical — every robe in the shot folds the same way');
    return 'seeded reproduces, unseeded differs';
  });

  check('cloak: attachCloak forwards what a caller asks for', () => {
    // `damping` and `iterations` were declared on the Cloak and dropped on the
    // floor by the only function that builds one, so neither was reachable from
    // anywhere in the game — every cloak silently ran the constructor defaults.
    const rig = new Rig(humanoidSkeleton(1), { scale: 1 });
    const asked = {
      damping: 0.951, iterations: 6, stiffness: 0.77, flare: 1.3,
      shear: 0.44, bend: 0.06, bendDown: 0.31, fullness: 0.9, jitter: 0.03,
      lift: 2.5, seed: 99,
    };
    const cl = attachCloak(scene, rig, asked);
    assert(cl, 'attachCloak built nothing');
    for (const [k, v] of Object.entries(asked)) {
      if (k === 'seed') continue;                      // consumed into the stream
      assert(cl[k] === v, `attachCloak dropped ${k}: asked ${v}, got ${cl[k]}`);
    }
    // and the seed has to land, or a test can never pin a cloak built the normal way
    const b = attachCloak(scene, rig, asked);
    cl.reset(); b.reset();
    assert(cl.links.every((l, i) => l.rest === b.links[i].rest), 'attachCloak dropped the seed');
    cl.dispose(); b.dispose();
    return `${Object.keys(asked).length} options forwarded`;
  });

  check('cloak: fullness adds cloth rather than taking the cape in', async () => {
    // Gathered fabric is narrower than flat fabric, so compressing the rest
    // lengths on its own took a third off the hem. A costume with fullness in it
    // is the same finished width with more cloth in it, not a narrower cape.
    const hem = (cl) => {
      let lo = 1e9, hi = -1e9;
      for (let c = 0; c < cl.cols; c++) { const x = cl.pos[((cl.rows - 1) * cl.cols + c) * 3]; lo = Math.min(lo, x); hi = Math.max(hi, x); }
      return hi - lo;
    };
    const taut = settle(TAUT), now = settle({});
    const a = hem(taut), b = hem(now);
    assert(b > a * 0.86, `the hem narrowed from ${(a * 1000).toFixed(0)} to ${(b * 1000).toFixed(0)} mm — fullness ate the silhouette`);
    // and it must not hang appreciably longer either
    const low = (cl) => { let lo = 1e9; for (let c = 0; c < cl.cols; c++) lo = Math.min(lo, cl.pos[((cl.rows - 1) * cl.cols + c) * 3 + 1]); return 1.42 - lo; };
    const ha = low(taut), hb = low(now);
    assert(hb < ha * 1.08, `the cape hangs ${((hb - ha) * 1000).toFixed(0)} mm lower than the taut one — that is sag, not fullness`);
    const r = `hem ${(a * 1000).toFixed(0)}→${(b * 1000).toFixed(0)} mm, hang ${(ha * 1000).toFixed(0)}→${(hb * 1000).toFixed(0)} mm`;
    taut.dispose(); now.dispose();
    // one last thing nothing else covers: the sim must stay finite
    const src = await readFile(new URL('../../src/game/Cloth.js', import.meta.url), 'utf8');
    assert(!/iterations\s*=\s*opts\.iterations\s*\?\?\s*[0-3]\b/.test(src),
      'the constraint iteration count was lowered — that makes the cloth stretchy, not foldy');
    return r;
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  skirt                                                                 */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * THE COMPLAINT: "the cape looks good with the physics but when it's in
   * motion you see that underneath the model's clothes is just a hard cylinder".
   *
   * It was exactly right and the code agreed. The robe below the belt was five
   * lathes parented to the `hips` bone with the folds baked into the mesh
   * section AND into the vertex-colour occlusion, so it could not move relative
   * to the pelvis by one micron — the check below measures 0.000 mm of travel
   * over seven seconds of walking while the cape's hem travels 217 mm beside
   * it. Nothing was wrong with the cape. It was hanging next to a cylinder.
   *
   * Every check in this section fails on the code it was written against:
   * `closed`, `pinRows`, `pleat`, `profile`, `Cloak.outer`, `attachSkirt` and
   * `buildJedi().robeSkirt` did not exist, and the four defects in the first
   * three are defects the obvious implementation still has.
   */

  /** A Jedi walking in a straight line, with whatever cloth is asked for. */
  function walked({ speed = 4.6, seconds = 8, tail = 180, skirt = null, cloak = null,
                    feed = false } = {}) {
    const built = buildJedi({ scale: 1 });
    const rig = built.rig;
    const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
    anim.setFacing(0);
    const sc = new THREE.Scene();
    const pos = new THREE.Vector3();
    const sk = skirt ? attachSkirt(sc, rig, { seed: 991, rigid: built.robeSkirt, ...skirt }) : null;
    const cl = cloak ? attachCloak(sc, rig, { width: 0.36, length: 0.86, cols: 9, rows: 11,
                                              flare: 1.0, seed: 4242, ...cloak }) : null;
    if (feed && cl && sk) cl.outer = sk;
    const wind = new THREE.Vector3();
    const N = Math.round(seconds * 60);
    const frames = [];
    for (let i = 0; i < N; i++) {
      pos.z += speed / 60;
      anim.update(1 / 60, { position: pos, facing: 0, velocity: new THREE.Vector3(0, 0, speed),
        grounded: true, groundAt: () => 0, crouch: 0,
        accelForward: Math.min(1, speed / 8), accelStrafe: 0 });
      anim.swingArms(1 / 60, speed, 1);
      rig.updateMatrices();
      wind.set(0, 0, -speed * 0.85);
      if (sk) sk.update(1 / 60, sk.refreshColliders(), wind);
      if (cl) cl.update(1 / 60, cl.refreshColliders(), wind);
      if (i >= N - tail) frames.push(i);
    }
    rig.get('hips').obj.updateMatrixWorld(true);
    const hipsInv = new THREE.Matrix4().copy(rig.get('hips').obj.matrixWorld).invert();
    return { built, rig, anim, scene: sc, skirt: sk, cloak: cl, hipsInv, frames: frames.length };
  }

  /**
   * The wrinkle left in a closed row once its size, its offset and its ovality
   * are taken out, as a circular power spectrum.
   *
   * A quadratic across the column INDEX is the sheet's absorber and it cannot
   * be periodic, so it is the wrong one here; harmonics 0-2 about the row's own
   * centre are the same three things said in a basis that closes. `dom` is the
   * harmonic carrying the most of what is left, `nyq` is the share sitting at
   * cols/2 — which is exactly and only the per-column checkerboard, and is what
   * a lag-1 autocorrelation cannot separate from a real fold (a genuine
   * harmonic-5 pattern on 14 columns has ac1 = cos(2π·5/14) = -0.62, the same
   * sign as the artefact) — and `ridge` is how well one row's wrinkle lines up
   * with the row below it, which is the difference between a fold and a rash.
   */
  function tubeFolds(cl) {
    const { cols, rows, pos } = cl;
    const dev = [], P = new Float64Array(Math.floor(cols / 2) + 1);
    let tot = 0, rms = 0, n = 0, flips = 0, nr = 0;
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
      let prev = 0;
      for (let c = 0; c <= cols; c++) {
        const v = d[c % cols];
        if (Math.abs(v) < 1e-4) continue;
        const s = Math.sign(v);
        if (prev !== 0 && s !== prev) flips++;
        prev = s;
      }
      dev.push(d); nr++;
    }
    let dom = 3, best = 0;
    for (let h = 3; h < P.length; h++) if (P[h] > best) { best = P[h]; dom = h; }
    let rs = 0, rn = 0;
    for (let i = 0; i + 1 < dev.length; i++) {
      let dp = 0, la = 0, lb = 0;
      for (let c = 0; c < cols; c++) { dp += dev[i][c] * dev[i + 1][c]; la += dev[i][c] ** 2; lb += dev[i + 1][c] ** 2; }
      if (la > 1e-12 && lb > 1e-12) { rs += dp / Math.sqrt(la * lb); rn++; }
    }
    return { rms: Math.sqrt(rms / n), count: flips / nr, dom,
             nyq: tot ? P[P.length - 1] / tot : 0, ridge: rn ? rs / rn : 0 };
  }

  /**
   * How far the cloth is standing off the body it is wrapped around: signed
   * distance from each particle to the nearest collider surface, averaged.
   *
   * This is the direct reading of the thing `fullness` is for. A pinned SHEET
   * whose across rest is shortened has nowhere to put the surplus but sideways,
   * so it buckles; a RING shrinks to the matching radius instead, and once it
   * reaches the shell it cannot shrink further, so the surplus is spent as
   * tension over a surface it cannot pass through. Buckling shows as standoff.
   * Tension shows as zero.
   */
  function standoff(cl) {
    const { cols, rows, pos } = cl;
    const col = cl.refreshColliders();
    let s = 0, n = 0;
    for (let r = 1; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 3;
        let d = Infinity;
        for (const o of col) {
          d = Math.min(d, Math.hypot(pos[i] - o.c.x, pos[i + 1] - o.c.y, pos[i + 2] - o.c.z) - o.r);
        }
        s += Math.max(0, d); n++;
      }
    }
    return n ? s / n : 0;
  }

  check('skirt: the cloth closes on itself, in every link family', () => {
    // Links were built with `if (c + 1 < this.cols)`, so column 0 and column
    // cols-1 were never joined. A skirt is a TUBE; without a seam it gapes at
    // the back and its two free edges flap independently of each other.
    // A structural seam alone is not enough either — that is a hinge, and cloth
    // hinged at one column creases there every time — so the diagonals and the
    // bend link that reaches two columns on have to wrap as well.
    const sc = new THREE.Scene();
    const anchor = (c, n, out) => out.set(Math.sin(c / n * 2 * Math.PI) * 0.145, 1.0,
                                          Math.cos(c / n * 2 * Math.PI) * 0.145);
    const tube = new Cloak(sc, { closed: true, cols: 14, rows: 7, anchorFn: anchor });
    const sheet = new Cloak(sc, { cols: 14, rows: 7, anchorFn: anchor });
    const across = (cl) => {
      const kinds = new Set();
      for (const l of cl.links) {
        const ca = l.a % cl.cols, cb = l.b % cl.cols;
        const spans = (ca === 0 && cb >= cl.cols - 2) || (cb === 0 && ca >= cl.cols - 2)
                   || (ca === 1 && cb === cl.cols - 1) || (cb === 1 && ca === cl.cols - 1);
        if (spans && Math.floor(l.a / cl.cols) <= Math.floor(l.b / cl.cols)) kinds.add(l.kind);
      }
      return kinds;
    };
    const k = across(tube);
    assert(across(sheet).size === 0, 'a sheet grew a seam — the wrap is not conditional on `closed`');
    for (const [kind, name] of [[0, 'structural'], [1, 'shear'], [2, 'bend']]) {
      assert(k.has(kind), `the seam carries no ${name} link — column 0 and column ${tube.cols - 1} are ${kind === 0 ? 'not joined at all' : 'joined by a hinge'}`);
    }
    // and the seam must be one span, not a doubled or a missing one. Per ROW:
    // the layout flares, so the bottom row's spans are legitimately wider than
    // the top's and a seam compared against the whole-garment mean would fail
    // on correct code.
    tube.reset();
    let worstRow = 0, at = 0, seamAt = 0, meanAt = 0;
    for (let r = 0; r < tube.rows; r++) {
      let seam = 0, interior = 0, ni = 0;
      for (let c = 0; c < tube.cols; c++) {
        const a = (r * tube.cols + c) * 3, b = (r * tube.cols + (c + 1) % tube.cols) * 3;
        const d = Math.hypot(tube.pos[a] - tube.pos[b], tube.pos[a + 1] - tube.pos[b + 1], tube.pos[a + 2] - tube.pos[b + 2]);
        if (c === tube.cols - 1) seam = d; else { interior += d; ni++; }
      }
      const m = interior / ni, e = Math.abs(seam / m - 1);
      if (e > worstRow) { worstRow = e; at = r; seamAt = seam; meanAt = m; }
    }
    assert(worstRow < 0.06,
      `on row ${at} the seam span is ${(seamAt * 1000).toFixed(1)} mm against ${(meanAt * 1000).toFixed(1)} mm everywhere else in the same row — the tube gapes at the back`);
    const r = `${k.size} link families wrap; worst seam span is ${(worstRow * 100).toFixed(1)}% off its own row`;
    tube.dispose(); sheet.dispose();
    return r;
  });

  check('skirt: the mesh is a tube, welded, and lit from outside', () => {
    // The mesh was a PlaneGeometry with a 1:1 vertex↔particle map, which cannot
    // close. The closed one carries cols+1 vertex columns with the extra one
    // mapped back onto particle 0 — and that duplicate costs a hard lit line
    // down the garment unless the pair's normals are averaged, because
    // computeVertexNormals gives each copy only the faces on its own side.
    const w = walked({ skirt: {}, seconds: 4, speed: 0 });
    const sk = w.skirt, g = sk.geometry;
    assert(g.index, 'the tube has no index buffer, so it is still a plane');
    assert(g.attributes.position.count === (sk.cols + 1) * sk.rows,
      `${g.attributes.position.count} vertices for ${sk.cols}×${sk.rows} particles — the seam column is missing`);
    const p = g.attributes.position, nA = g.attributes.normal, vc = sk.cols + 1;
    let gap = 0, ndiff = 0;
    for (let r = 0; r < sk.rows; r++) {
      const a = r * vc, b = r * vc + vc - 1;
      gap = Math.max(gap, Math.hypot(p.getX(a) - p.getX(b), p.getY(a) - p.getY(b), p.getZ(a) - p.getZ(b)));
      ndiff = Math.max(ndiff, Math.hypot(nA.getX(a) - nA.getX(b), nA.getY(a) - nA.getY(b), nA.getZ(a) - nA.getZ(b)));
    }
    assert(gap < 1e-9, `the two seam vertex columns are ${(gap * 1000).toFixed(2)} mm apart — the tube is split`);
    assert(ndiff < 1e-6, `the seam's two normals differ by ${ndiff.toFixed(4)} — that is a lit crease down the robe`);
    // winding: at rest every normal has to face away from the wearer
    sk.reset();
    const hips = w.rig.get('hips').obj;
    hips.updateMatrixWorld(true);
    const axis = new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld);
    let worst = 1;
    for (let v = 0; v < p.count; v++) {
      const rx = p.getX(v) - axis.x, rz = p.getZ(v) - axis.z;
      const L = Math.hypot(rx, rz) || 1;
      worst = Math.min(worst, (nA.getX(v) * rx + nA.getZ(v) * rz) / L);
    }
    assert(worst > 0, `a face is wound inside out (worst normal·radius ${worst.toFixed(3)}) — the robe is lit from within`);
    return `${p.count} verts / ${g.index.count / 3} tris, seam gap ${(gap * 1e9).toFixed(1)} nm, `
      + `normals welded, worst outward dot ${worst.toFixed(2)}`;
  });

  check('skirt: the pinned set is a parameter, not "everything past row 0"', () => {
    // Three loops hard-coded the anchor as row 0 — the constructor, the
    // collision push (`for (let i = this.cols; i < n; i++)`) and impulse().
    // Right for a collar, right for a waistband, and an assumption rather than
    // a rule either way. A second pinned row under a belt is the case that
    // catches it: on the old loops row 1 is solved, pushed out of colliders and
    // kicked by every Force impulse in the game, whatever it was pinned to.
    const sc = new THREE.Scene();
    const at = (c, n, out, r = 0) => out.set(Math.sin(c / n * 2 * Math.PI) * 0.15,
                                             1.0 - r * 0.08, Math.cos(c / n * 2 * Math.PI) * 0.15);
    const cl = new Cloak(sc, { closed: true, cols: 12, rows: 6, pinRows: 2, anchorFn: at, length: 0.4 });
    cl.reset();
    assert(cl.pinned.slice(0, 24).every((x) => x === 1) && !cl.pinned[24],
      'pinRows did not reach the pinned set');
    // a collider swallowing the whole waistband must not move it
    const swallow = [{ c: new THREE.Vector3(0, 1.0, 0), r: 0.6 }];
    for (let i = 0; i < 30; i++) cl.update(1 / 60, swallow, new THREE.Vector3());
    cl.impulse(new THREE.Vector3(0, 1, 0), 4);
    for (let i = 0; i < 5; i++) cl.update(1 / 60, swallow, new THREE.Vector3());
    let worst = 0;
    const want = new THREE.Vector3();
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cl.cols; c++) {
        at(c, cl.cols, want, r);
        const i = (r * cl.cols + c) * 3;
        worst = Math.max(worst, Math.hypot(cl.pos[i] - want.x, cl.pos[i + 1] - want.y, cl.pos[i + 2] - want.z));
      }
    }
    // 1e-5 m, not 0: `pos` is a Float32Array and the anchor is a double, so an
    // untouched pin still reads back a few hundred nanometres out.
    assert(worst < 1e-5,
      `a pinned particle moved ${(worst * 1e6).toFixed(1)} µm off its anchor — the solver still owns it`);
    // and the row below it is genuinely free, or the test proves nothing
    let free = 0;
    for (let c = 0; c < cl.cols; c++) {
      at(c, cl.cols, want, 2);
      const i = (2 * cl.cols + c) * 3;
      free = Math.max(free, Math.hypot(cl.pos[i] - want.x, cl.pos[i + 1] - want.y, cl.pos[i + 2] - want.z));
    }
    assert(free > 0.01, 'row 2 did not move either — the cloth is frozen and the check is vacuous');
    cl.dispose();
    return `2 rows held to 0.0 mm through a collider that swallows them and a Force kick; row 2 free by ${(free * 1000).toFixed(0)} mm`;
  });

  check('skirt: a tube folds, and the folds run down it rather than round it', () => {
    const w = walked({ skirt: {}, seconds: 6, speed: 0 });
    const f = tubeFolds(w.skirt);
    // The rigid lathe this replaces bakes three cosine harmonics into its
    // section at ±up to 28 mm on a 285 mm hem. Anything under about 12 is a
    // painted cylinder again.
    assert(f.rms > 0.015,
      `the skirt wrinkles ${(f.rms * 1000).toFixed(1)} mm — that is a cylinder with a texture on it`);
    assert(f.count > 6 && f.count < 13,
      `${f.count.toFixed(1)} fold crossings per row on ${w.skirt.cols} columns — ${f.count <= 6 ? 'one bulge is not a gathered skirt' : 'that is a rash, not a garment'}`);
    // the two that separate a fold from an artefact
    assert(f.nyq < 0.12,
      `${(f.nyq * 100).toFixed(0)}% of the fold power sits at the per-column Nyquist harmonic — that is a checkerboard`);
    assert(f.ridge > 0.75,
      `one row's wrinkle correlates only ${f.ridge.toFixed(2)} with the row below it — deep per-row noise, not a fold running from the waist to the hem`);
    assert(f.dom * 2 < w.skirt.cols,
      `the dominant harmonic is ${f.dom} on ${w.skirt.cols} columns, which the mesh cannot draw`);
    // and it is still the garment that was cut
    let worst = 0;
    for (const l of w.skirt.links) {
      if (l.kind !== 0 || l.across) continue;
      const i = l.a * 3, j = l.b * 3;
      const d = Math.hypot(w.skirt.pos[j] - w.skirt.pos[i], w.skirt.pos[j + 1] - w.skirt.pos[i + 1], w.skirt.pos[j + 2] - w.skirt.pos[i + 2]);
      worst = Math.max(worst, d / l.rest0);
    }
    assert(worst < 1.20, `a vertical link is stretched ${((worst - 1) * 100).toFixed(0)}% over its cut length — going stretchy, not foldy`);
    return `${(f.rms * 1000).toFixed(1)} mm rms, ${f.count.toFixed(1)} crossings/row, dominant harmonic ${f.dom}, `
      + `${(f.nyq * 100).toFixed(0)}% at Nyquist, ridge correlation ${f.ridge.toFixed(2)}, worst stretch ${((worst - 1) * 100).toFixed(0)}%`;
  });

  check('skirt: fullness cannot fold a ring — it pulls it taut', () => {
    // The sheet's mechanism run on a tube, measured, so nobody re-derives it.
    // A pinned sheet whose across rest is shortened has nowhere to put the
    // surplus but sideways, so it buckles. A RING has: it shrinks to the
    // matching radius, and the moment it reaches the shell it cannot shrink
    // further, so every across link ends up in TENSION over a surface it
    // cannot pass through. That is the board this whole exercise is about, and
    // running the cape's own fullness on the skirt is how you get it back.
    const run = (o) => {
      const w = walked({ skirt: o, seconds: 6, speed: 0 });
      return { sk: w.skirt, f: tubeFolds(w.skirt), off: standoff(w.skirt) };
    };
    const ship = run({});
    assert(ship.sk.fullness === 1,
      `the skirt ships at fullness ${ship.sk.fullness} — on a ring that flattens the folds, it does not make them`);
    const gathered = run({ fullness: 0.86 }), tight = run({ fullness: 0.75 });
    assert(gathered.f.rms < ship.f.rms * 0.75,
      `fullness 0.86 wrinkles ${(gathered.f.rms * 1000).toFixed(1)} mm against ${(ship.f.rms * 1000).toFixed(1)} at 1 — `
      + 'shortening the ring no longer costs fold depth, so this reasoning needs re-deriving');
    assert(tight.f.rms < ship.f.rms * 0.35,
      `fullness 0.75 still wrinkles ${(tight.f.rms * 1000).toFixed(1)} mm against ${(ship.f.rms * 1000).toFixed(1)} at 1 — re-measure`);
    /**
     * The clause that used to sit here read `tight.f.ridge < 0.5` — that at
     * high gathering the wrinkle must stop lining up row to row. That is not
     * the mechanism, and lengthening the robe to bury the cone proved it: on a
     * 700mm tube the gathered cloth reads ridge 0.98 while wrinkling 4mm,
     * because what is left once the ring is taut is the SHELL showing through,
     * and a pair of legs is the same shape at every height. Coherence is not
     * folding. So the tension is read where it happens, against the body: the
     * cloth stands 26mm off the shell at fullness 1, 9mm at 0.86 and 0.4mm at
     * 0.75, and that monotone collapse is the whole claim.
     */
    assert(tight.off < ship.off * 0.25 && gathered.off < ship.off * 0.6 && gathered.off > tight.off,
      `gathering does not pull the ring onto the body: ${(ship.off * 1000).toFixed(1)} mm standoff at fullness 1, `
      + `${(gathered.off * 1000).toFixed(1)} at 0.86, ${(tight.off * 1000).toFixed(1)} at 0.75`);
    // the folds are the pleat's, so removing it has to cost something
    const flat = run({ pleat: 0 });
    assert(flat.f.nyq > ship.f.nyq * 1.5 || flat.f.rms < ship.f.rms * 0.9,
      `taking the pleat out changed nothing (${(flat.f.rms * 1000).toFixed(1)} mm / ${(flat.f.nyq * 100).toFixed(0)}% Nyquist against ${(ship.f.rms * 1000).toFixed(1)} / ${(ship.f.nyq * 100).toFixed(0)}%) — it is not what folds the tube`);
    // and a pleat is a CUT, not a bake: it adds shape and no cloth
    const c0 = ship.sk.links.filter((l) => l.across && l.a >= ship.sk.cols && l.a < ship.sk.cols * 2);
    const mean = c0.reduce((a, l) => a + l.rest / l.rest0, 0) / c0.length;
    assert(Math.abs(mean - 1) < 0.02,
      `the pleated row carries ${((mean - 1) * 100).toFixed(1)}% more cloth than it was cut — a pleat must sum to zero`);
    ship.sk.dispose(); gathered.sk.dispose(); tight.sk.dispose(); flat.sk.dispose();
    return `fullness 1 → ${(ship.f.rms * 1000).toFixed(1)} mm at ${(ship.off * 1000).toFixed(1)} mm off the body; `
      + `0.86 → ${(gathered.f.rms * 1000).toFixed(1)} at ${(gathered.off * 1000).toFixed(1)}; `
      + `0.75 → ${(tight.f.rms * 1000).toFixed(1)} at ${(tight.off * 1000).toFixed(1)}; `
      + `pleat off → ${(flat.f.rms * 1000).toFixed(1)} mm / ${(flat.f.nyq * 100).toFixed(0)}% Nyquist`;
  });

  check('skirt: the robe moves relative to the pelvis, which is the whole complaint', () => {
    // The measurement the complaint was made about. Every rigid layer below the
    // belt is a child of the `hips` bone with a constant local transform, so a
    // hem vertex of it travels EXACTLY zero in the pelvis frame however hard
    // the figure runs, while the cape's hem travels 217 mm beside it.
    const w = walked({ skirt: {}, cloak: {}, seconds: 8, feed: true });
    const hips = w.rig.get('hips').obj;
    const spread = (pts) => {
      let d = 0;
      for (const a of pts) for (const b of pts) d = Math.max(d, a.distanceTo(b));
      return d;
    };
    // re-walk, sampling. (walked() runs to the end; this samples the tail.)
    const built = buildJedi({ scale: 1 });
    const rig = built.rig;
    const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
    anim.setFacing(0);
    const sc = new THREE.Scene();
    const pos = new THREE.Vector3();
    const sk = attachSkirt(sc, rig, { seed: 991, rigid: built.robeSkirt });
    const wind = new THREE.Vector3();
    const cloth = [], rigidPts = [];
    const rigidMesh = built.robeSkirt[0];
    for (let i = 0; i < 8 * 60; i++) {
      pos.z += 4.6 / 60;
      anim.update(1 / 60, { position: pos, facing: 0, velocity: new THREE.Vector3(0, 0, 4.6),
        grounded: true, groundAt: () => 0, crouch: 0, accelForward: 0.575, accelStrafe: 0 });
      anim.swingArms(1 / 60, 4.6, 1);
      rig.updateMatrices();
      wind.set(0, 0, -4.6 * 0.85);
      sk.update(1 / 60, sk.refreshColliders(), wind);
      if (i < 5 * 60) continue;
      rig.get('hips').obj.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(rig.get('hips').obj.matrixWorld).invert();
      const k = (sk.rows - 1) * sk.cols;
      cloth.push(new THREE.Vector3(sk.pos[k * 3], sk.pos[k * 3 + 1], sk.pos[k * 3 + 2]).applyMatrix4(inv));
      rigidMesh.updateMatrixWorld(true);
      const rp = rigidMesh.geometry.attributes.position;
      rigidPts.push(new THREE.Vector3(rp.getX(0), rp.getY(0), rp.getZ(0))
        .applyMatrix4(rigidMesh.matrixWorld).applyMatrix4(inv));
    }
    const rigid = spread(rigidPts), moving = spread(cloth);
    assert(rigid < 1e-9,
      `the rigid layer moved ${(rigid * 1000).toFixed(3)} mm in the pelvis frame — it is no longer the thing being replaced, so this number needs re-deriving`);
    assert(moving > 0.08,
      `the cloth hem travels only ${(moving * 1000).toFixed(0)} mm relative to the pelvis — that is still a cylinder`);
    assert(moving < 0.60,
      `the hem travels ${(moving * 1000).toFixed(0)} mm relative to the pelvis, which is not a robe, it is a flag`);
    sk.dispose(); w.skirt?.dispose(); w.cloak?.dispose();
    return `rigid lathe ${(rigid * 1000).toFixed(3)} mm, cloth hem ${(moving * 1000).toFixed(0)} mm, over 3 s at a walk`;
  });

  check('skirt: the cape hangs on a skirt that MOVES, not on where one used to be', () => {
    // attachCloak collides against a table sampled off the rigid over-skirt.
    // Once that garment is cloth the table is a photograph — the real thing
    // swings 183 mm at a walk and the cape settles against a surface that
    // stayed put. `cloak.outer` replaces the table with spheres taken off the
    // skirt's own particles, at each row's WIDEST point: at its mean radius the
    // proxy sits inside every ridge and does worse than the table it replaces.
    const penetration = (feed) => {
      const built = buildJedi({ scale: 1 });
      const rig = built.rig;
      const anim = new BipedAnimator(rig, { scale: 1, hipHeight: 0.95 });
      anim.setFacing(0);
      const sc = new THREE.Scene();
      const pos = new THREE.Vector3();
      const sk = attachSkirt(sc, rig, { seed: 991, rigid: built.robeSkirt });
      const cl = attachCloak(sc, rig, { width: 0.36, length: 0.86, cols: 9, rows: 11, flare: 1.0, seed: 4242 });
      if (feed) cl.outer = sk;
      const wind = new THREE.Vector3();
      let worst = 0, bad = 0, frames = 0;
      const v = new THREE.Vector3();
      for (let i = 0; i < 8 * 60; i++) {
        anim.update(1 / 60, { position: pos, facing: 0, velocity: new THREE.Vector3(),
          grounded: true, groundAt: () => 0, crouch: 0, accelForward: 0, accelStrafe: 0 });
        anim.swingArms(1 / 60, 0, 1);
        rig.updateMatrices();
        sk.update(1 / 60, sk.refreshColliders(), wind);
        cl.update(1 / 60, cl.refreshColliders(), wind);
        if (i < 5 * 60) continue;
        frames++;
        rig.get('hips').obj.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(rig.get('hips').obj.matrixWorld).invert();
        // the skirt's own surface, per row, as bearing→radius
        const rows = [];
        for (let r = 0; r < sk.rows; r++) {
          let dy = 0; const rad = [];
          for (let c = 0; c < sk.cols; c++) {
            const i3 = (r * sk.cols + c) * 3;
            v.set(sk.pos[i3], sk.pos[i3 + 1], sk.pos[i3 + 2]).applyMatrix4(inv);
            dy += v.y; rad.push([Math.atan2(v.x, v.z), Math.hypot(v.x, v.z)]);
          }
          rows.push([dy / sk.cols, rad]);
        }
        let any = 0;
        for (let k = 0; k < cl.cols * cl.rows; k++) {
          if (cl.pinned[k]) continue;
          v.set(cl.pos[k * 3], cl.pos[k * 3 + 1], cl.pos[k * 3 + 2]).applyMatrix4(inv);
          const th = Math.atan2(v.x, v.z), rr = Math.hypot(v.x, v.z);
          let row = null, bd = 1e9;
          for (const q of rows) { const d = Math.abs(q[0] - v.y); if (d < bd) { bd = d; row = q; } }
          if (bd > 0.06) continue;
          let sr = 0, sd = 1e9;
          for (const [a, r2] of row[1]) {
            let d = Math.abs(a - th); if (d > Math.PI) d = 2 * Math.PI - d;
            if (d < sd) { sd = d; sr = r2; }
          }
          if (sr - rr > 0.001) { any = 1; worst = Math.max(worst, sr - rr); }
        }
        bad += any;
      }
      sk.dispose(); cl.dispose();
      return { worst, bad, frames };
    };
    const table = penetration(false), live = penetration(true);
    assert(table.bad > 0,
      'the fixed table already keeps the cape out of the cloth skirt, so the live proxy is not needed — delete it');
    assert(live.worst < 0.002,
      `the cape is still ${(live.worst * 1000).toFixed(1)} mm inside the skirt on ${live.bad}/${live.frames} frames with the live proxy`);
    assert(live.worst < table.worst,
      `the live proxy is no better than the table (${(live.worst * 1000).toFixed(1)} vs ${(table.worst * 1000).toFixed(1)} mm)`);
    return `fixed table ${(table.worst * 1000).toFixed(1)} mm inside on ${table.bad}/${table.frames} frames → `
      + `live proxy ${(live.worst * 1000).toFixed(1)} mm on ${live.bad}/${live.frames}`;
  });

  check('skirt: it dices no finer than the cape, and the rigid layer comes back at range', () => {
    /**
     * This check used to read `nSk <= nCl` — the skirt must not spend more than
     * the cape's 99 particles — and it passed at 98, by one. That bound was not
     * a measurement. It calls a fine, tiny garment cheap and a coarse, large one
     * dear, and the first real change it ever met was the one that buried the
     * rigid cone (the robe had to reach the ankles, so it went from 460mm and 7
     * rows to 700mm and 10), which it failed.
     *
     * A verlet solve costs per particle. A garment's particle count is its area
     * times its density, and only the second half is the cut's to choose: the
     * first is dictated by the body it has to cover. So the bound is on the
     * CELL — the area of one quad of the weave, off the structural links' own
     * cut lengths — and the count is pinned from both ends without anybody
     * picking a number, the area by the body and the density by the cape.
     *
     * Both are still gated at lod > 1, and because the cloth is gated the
     * lathes it stands in for cannot be deleted at build time or a character at
     * range would have a bare pelvis. attachSkirt hides them instead, and hands
     * them back through the same call.
     */
    const built = buildJedi({ scale: 1 });
    const rig = built.rig;
    rig.updateMatrices(); rig.root.updateMatrixWorld(true);
    const sk = attachSkirt(new THREE.Scene(), rig, { rigid: built.robeSkirt });
    const cl = attachCloak(new THREE.Scene(), rig, { width: 0.36, length: 0.86, cols: 9, rows: 11 });
    const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    const W = weave(sk, { tube: true }), C = weave(cl);
    assert(W.cell >= C.cell,
      `the skirt's weave is ${(W.cell * 1e4).toFixed(1)} cm² a cell against the cape's ${(C.cell * 1e4).toFixed(1)} — `
      + 'it is buying detail the cape does not get, and the particle count follows');
    assert(W.density <= C.density,
      `${W.density.toFixed(0)} particles per m² against the cape's ${C.density.toFixed(0)}`);
    assert(sk.links.length / W.n <= cl.links.length / C.n * 1.1,
      `${(sk.links.length / W.n).toFixed(2)} links a particle against the cape's ${(cl.links.length / C.n).toFixed(2)}`);
    assert(sk.iterations === cl.iterations, 'the skirt solves a different number of passes from the cape');
    assert(W.n * W.colliders / W.area <= C.n * C.colliders / C.area,
      `${(W.n * W.colliders / W.area).toFixed(0)} sphere tests per pass per m² against the cape's `
      + `${(C.n * C.colliders / C.area).toFixed(0)}`);
    // and it must not cost triangles either — it replaces more than it draws
    let rigid = 0;
    // four lathes below the belt: the two over-skirt panels, the hem, and the
    // under-robe tube that used to go on showing under a jump as THE CONE.
    assert(built.robeSkirt && built.robeSkirt.length >= 4,
      `buildJedi handed out ${built.robeSkirt ? built.robeSkirt.length : 0} rigid outer-layer meshes, not 4`);
    for (const m of built.robeSkirt) rigid += tris(m.geometry);
    assert(tris(sk.geometry) < rigid,
      `the cloth draws ${tris(sk.geometry)} triangles to replace ${rigid}`);
    // the LOD swap, both ways
    sk.setVisible(false);
    assert(built.robeSkirt.every((m) => m.visible) && !sk.mesh.visible,
      'switching the cloth off at range leaves the character with no robe below the belt');
    sk.setVisible(true);
    assert(built.robeSkirt.every((m) => !m.visible) && sk.mesh.visible,
      'the rigid lathes are still drawn underneath the cloth');
    sk.dispose();
    assert(built.robeSkirt.every((m) => m.visible), 'disposing the cloth left the robe invisible');
    cl.dispose();
    return `skirt ${weaveLine(W)} / ${W.density.toFixed(0)} per m² / ${tris(sk.geometry)} tris `
      + `against cape ${weaveLine(C)} / ${C.density.toFixed(0)} per m²; replaces ${rigid} rigid triangles`;
  });

  check('skirt: a bigger duellist gets a bigger skirt, not a differently-shaped one', () => {
    // Enemy.js hands attachCloak `scale: A.scale`, so a scaled garment is a
    // real case and not a hypothetical. It is also where the tables bite: the
    // petticoat and the inner shell are metres on a 1.0 figure and
    // refreshColliders scales what it is handed, so scaling them at the point
    // they are BUILT puts S in twice — which is how this was first written.
    //
    // The bound is 18mm, not zero. A garment 20% smaller under the same gravity
    // and the same 1/60 s step does not hang identically and never will, and
    // the cape does not either: measured over scale 0.8→1.25 the shipped skirt
    // holds its unit-space radius to 12.4mm and its drop to 5.2. Scaling the
    // shell twice — the bug this exists for — doubles both, to 24.7 and 13.3.
    const profile = (S) => {
      const built = buildJedi({ scale: S });
      const rig = built.rig;
      const anim = new BipedAnimator(rig, { scale: S, hipHeight: 0.95 * S });
      anim.setFacing(0);
      const pos = new THREE.Vector3();
      const sk = attachSkirt(new THREE.Scene(), rig, { scale: S, seed: 991, rigid: built.robeSkirt });
      for (let i = 0; i < 5 * 60; i++) {
        anim.update(1 / 60, { position: pos, facing: 0, velocity: new THREE.Vector3(), grounded: true,
          groundAt: () => 0, crouch: 0, accelForward: 0, accelStrafe: 0 });
        anim.swingArms(1 / 60, 0, 1);
        rig.updateMatrices();
        sk.update(1 / 60, sk.refreshColliders(), new THREE.Vector3());
      }
      const hips = rig.get('hips').obj;
      hips.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(hips.matrixWorld).invert();
      const v = new THREE.Vector3(), out = [];
      for (let r = 0; r < sk.rows; r++) {
        let dy = 0, rad = 0;
        for (let c = 0; c < sk.cols; c++) {
          const i = (r * sk.cols + c) * 3;
          v.set(sk.pos[i], sk.pos[i + 1], sk.pos[i + 2]).applyMatrix4(inv);
          dy += v.y; rad += Math.hypot(v.x, v.z);
        }
        out.push([dy / sk.cols / S, rad / sk.cols / S]);   // read back in UNIT space
      }
      sk.dispose();
      return out;
    };
    const one = profile(1);
    let worstR = 0, worstY = 0;
    for (const S of [0.8, 1.25]) {
      const p = profile(S);
      for (let r = 0; r < one.length; r++) {
        worstY = Math.max(worstY, Math.abs(p[r][0] - one[r][0]));
        worstR = Math.max(worstR, Math.abs(p[r][1] - one[r][1]));
      }
    }
    assert(worstR < 0.018,
      `the skirt's unit-space radius moves ${(worstR * 1000).toFixed(1)} mm between scale 0.8 and 1.25 — something is scaled twice`);
    assert(worstY < 0.009,
      `the skirt's unit-space drop moves ${(worstY * 1000).toFixed(1)} mm across scale — something is scaled twice`);
    return `over scale 0.8 → 1.25 the unit-space profile holds to ${(worstR * 1000).toFixed(1)} mm of radius `
      + `and ${(worstY * 1000).toFixed(1)} mm of drop`;
  });

  check('skirt: the folds are shaded, not just shaped', () => {
    // The lathe baked its fold shadows into vertex colour, because geometry
    // alone gives a fold a lit side and a dark side and only occlusion makes
    // the BOTTOM of one read as a fold rather than as a facet. A simulated fold
    // moves, so the bake cannot follow it; the channel is written from the live
    // radial residual instead. This is a shading claim and nothing else — it
    // does not deepen a single fold.
    const on = walked({ skirt: {}, seconds: 5, speed: 0 }).skirt;
    const off = walked({ skirt: { foldAO: 0 }, seconds: 5, speed: 0 }).skirt;
    const range = (sk) => {
      const c = sk.geometry.attributes.color.array;
      let lo = 1, hi = 0;
      for (let i = 0; i < c.length; i += 3) { lo = Math.min(lo, c[i]); hi = Math.max(hi, c[i]); }
      return [lo, hi];
    };
    const [aLo, aHi] = range(on), [bLo, bHi] = range(off);
    assert(aLo < bLo - 0.05,
      `the occlusion darkens the valleys to ${aLo.toFixed(3)} against ${bLo.toFixed(3)} with it off — it is not reaching the channel`);
    assert(aLo > 0.20, `the valleys go to ${aLo.toFixed(3)} of the light, which is a black stripe, not a shadow`);
    assert(Math.abs(aHi - bHi) < 1e-6, 'the ridges got BRIGHTER than plain cloth — that is not occlusion');
    // and it must not have moved the geometry
    const f1 = tubeFolds(on), f2 = tubeFolds(off);
    assert(Math.abs(f1.rms - f2.rms) < 1e-9, 'writing vertex colours changed the simulation');
    on.dispose(); off.dispose();
    return `valleys ${bLo.toFixed(2)} → ${aLo.toFixed(2)} of the light, ridges unchanged at ${aHi.toFixed(2)}, `
      + `folds identical at ${(f1.rms * 1000).toFixed(1)} mm`;
  });
}
