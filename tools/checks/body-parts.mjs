/**
 * SABER — the parts of a character that are supposed to MOVE.
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
import { Rig, humanoidSkeleton } from '../../src/game/Rig.js';
import { Cloak, attachCloak } from '../../src/game/Cloth.js';
import { Player } from '../../src/game/Player.js';
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
}
