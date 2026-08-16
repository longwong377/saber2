/**
 * BATTLEFRONT BORZ — the hilt, which is the object the player looks at most.
 *
 * Note 62: "more hilt options, in more detail."
 *
 * What was there: FIVE NAMES AND FOUR OBJECTS. One shared body — the same
 * shroud, the same three neck rings, the same seven grip rings, the same
 * control box, the same pommel — with three `if (this.hiltStyle === …)` blocks
 * bolting a part onto the end of it. Graflex and Guardian were byte-identical
 * meshes; Sentinel was that same weapon with a cone on the muzzle. In first
 * person the hilt is on screen every frame of the game and it was, in effect,
 * one hilt with a spinner next to it.
 *
 * The bar this file sets is therefore not "does a hilt exist" but the thing
 * that was actually wrong: NO TWO HILTS MAY BE THE SAME OBJECT, and the
 * difference has to be something you could see across a room rather than a
 * changed material on identical geometry. Silhouette, part count and length are
 * all measured; so is the one thing a redesign can quietly break, which is that
 * the hands still land on the grip.
 *
 * Every check here fails on the tree it was written against — the first two by
 * Graflex and Guardian being identical, the third by five hilts existing where
 * ten are asked for, and the fourth because the spec table it reads did not.
 */

import * as THREE from 'three';
import { Saber, HILT_STYLES, HILT_SPECS } from '../../src/game/Saber.js';
import { ORDERS } from '../../src/game/Order.js';
import { GRIP_AT, fpGripOn, FIST_CLEAR } from '../../src/game/Player.js';

/**
 * A hilt's shape, as numbers: how many parts it is made of, how long it is,
 * and its silhouette sampled as a radius profile up the axis.
 *
 * The profile is what "you could tell it apart across a room" means, and it is
 * deliberately taken from the WORLD-SPACE bounding radius at each height
 * rather than from the part list: two hilts built from different meshes that
 * happen to occupy the same envelope look the same, and that is the failure
 * being tested for.
 */
function shape(style) {
  const scene = new THREE.Scene();
  const s = new Saber(scene, { colorIndex: 0, hiltStyle: style });
  s.root.updateMatrixWorld(true);
  const N = 48;
  let lo = Infinity, hi = -Infinity, parts = 0;
  const pts = [];
  s.hilt.traverse((o) => {
    if (!o.isMesh) return;
    parts++;
    const g = o.geometry;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      pts.push(v);
      lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
    }
  });
  const prof = new Float64Array(N);
  const span = Math.max(1e-6, hi - lo);
  for (const v of pts) {
    const k = Math.min(N - 1, Math.max(0, Math.floor(((v.y - lo) / span) * N)));
    prof[k] = Math.max(prof[k], Math.hypot(v.x, v.z));
  }
  const out = { parts, lo, hi, len: span, prof, emitter: s.emitterY, floor: s.hiltFloor, fp: fpGripOn(s) };
  s.dispose();
  return out;
}

/** How different two silhouettes are: mean |Δradius| over the profile, in mm. */
function silhouetteDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.prof.length; i++) sum += Math.abs(a.prof[i] - b.prof[i]);
  return (sum / a.prof.length) * 1000;
}

export async function run({ check, assert }) {
  check('hilts: no two are the same object', () => {
    /* The bound is 0.6 mm of mean radius difference over the profile, and it is
     * low on purpose: it is not asking hilts to be wildly unlike each other,
     * only to be DIFFERENT OBJECTS. Two identical meshes score exactly 0.00,
     * which is the number Graflex and Guardian returned. The closest surviving
     * pair is far above it, so nothing here is tuned to just-pass. */
    const shapes = Object.fromEntries(HILT_STYLES.map((h) => [h, shape(h)]));
    const pairs = [];
    let worst = Infinity, worstPair = '';
    for (let i = 0; i < HILT_STYLES.length; i++) {
      for (let j = i + 1; j < HILT_STYLES.length; j++) {
        const a = HILT_STYLES[i], b = HILT_STYLES[j];
        const d = silhouetteDiff(shapes[a], shapes[b]);
        pairs.push([`${a}/${b}`, d]);
        if (d < worst) { worst = d; worstPair = `${a}/${b}`; }
      }
    }
    assert(worst > 0.6,
      `${worstPair} differ by ${worst.toFixed(2)} mm of mean radius over the whole hilt — they are the same object with different names`);
    // …and the part counts must not all be one number either, or every hilt is
    // the same assembly with the dimensions nudged.
    const counts = new Set(HILT_STYLES.map((h) => shapes[h].parts));
    assert(counts.size >= 5,
      `${HILT_STYLES.length} hilts are built from only ${counts.size} distinct part counts`);
    const lens = HILT_STYLES.map((h) => shapes[h].len);
    assert(Math.max(...lens) / Math.min(...lens) > 1.15,
      `every hilt is within ${((Math.max(...lens) / Math.min(...lens) - 1) * 100).toFixed(0)}% of the same length`);
    return `${HILT_STYLES.length} hilts, closest pair ${worstPair} at ${worst.toFixed(2)} mm, `
      + `${counts.size} distinct part counts, ${(Math.min(...lens) * 1000) | 0}–${(Math.max(...lens) * 1000) | 0} mm long`;
  });

  check('hilts: there are enough of them, and every one is detailed', () => {
    /* "More options, in more detail" is two claims and this is both. The part
     * count is the detail one: a hilt made of four cylinders is a prop, and the
     * shipped ones are 15 to 20 pieces. */
    assert(HILT_STYLES.length >= 10, `only ${HILT_STYLES.length} hilts`);
    const rows = [];
    for (const h of HILT_STYLES) {
      const sh = shape(h);
      assert(sh.parts >= 9, `${h} is only ${sh.parts} pieces — that is a prop, not a weapon`);
      assert(HILT_SPECS[h].blurb && HILT_SPECS[h].blurb.length > 20,
        `${h} has nothing said about it, so the card that offers it says nothing`);
      rows.push(`${h} ${sh.parts}p/${(sh.len * 1000) | 0}mm`);
    }
    return rows.join(', ');
  });

  check('hilts: the hands still close on the grip, whichever one it is', () => {
    /* THE THING A REDESIGN BREAKS SILENTLY. `GRIP_AT` puts the right hand at
     * +0.050 along the hilt's axis and the left at -0.015, and Player solves
     * both arms to those two points. A hilt whose grip section does not span
     * them has the hands closing on air — or, worse, on the control box — and
     * nothing anywhere throws.
     *
     * Measured against the hilt's own extent with a small margin, because a
     * hand at the very end of a grip is a hand half off it. */
    const rows = [];
    for (const h of HILT_STYLES) {
      const sh = shape(h);
      const spec = HILT_SPECS[h];
      /* THE TWO-HANDED GRIP IS A CONSTANT AND IS CHECKED AS ONE. `FP` is not,
       * and asserting a constant against ten hilts is what proved it could not
       * be: `hilts` wants the point inside the SHORTEST hilt (fp > -0.042, the
       * Shoto) and `first person` wants at most 35% of the hilt behind the
       * fist (fp <= -0.070, the Graflex), and that interval is empty. So the
       * first-person point is derived per weapon now, and what is asserted is
       * the DERIVED value — a stronger statement than the constant ever made,
       * because it has to hold for each hilt separately rather than for one
       * number that happened to suit the default. */
      for (const side of ['R', 'L']) {
        const y = GRIP_AT[side];
        assert(y < sh.hi - 0.012 && y > sh.lo + 0.012,
          `${h}: the ${side} hand grips at ${(y * 1000).toFixed(0)} mm, and the hilt runs `
          + `${(sh.lo * 1000).toFixed(0)}–${(sh.hi * 1000).toFixed(0)} mm`);
      }
      assert(sh.fp < sh.hi - 0.012 && sh.fp > sh.lo + 0.012,
        `${h}: the FP hand grips at ${(sh.fp * 1000).toFixed(0)} mm, and the hilt runs `
        + `${(sh.lo * 1000).toFixed(0)}-${(sh.hi * 1000).toFixed(0)} mm`);
      /* And the measurement the game holds must be the one an independent walk
       * of the same meshes finds. A `hiltFloor` that drifted from the geometry
       * would put every fist in the game a few millimetres into the air with
       * nothing to say so. */
      assert(Math.abs(sh.floor - sh.lo) < 1e-6,
        `${h}: Saber.hiltFloor says ${(sh.floor * 1000).toFixed(1)} mm and the meshes say `
        + `${(sh.lo * 1000).toFixed(1)} mm`);
      // and the emitter may not wander, because it is part of the reach
      assert(Math.abs(spec.emitter - 0.155) <= 0.015,
        `${h} emits at ${(spec.emitter * 1000).toFixed(0)} mm against the standard 155 — that is a longer sword wearing a hilt's name`);
      rows.push(`${h} ${(sh.lo * 1000) | 0}…${(sh.hi * 1000) | 0}mm`);
    }
    return `hands at R${(GRIP_AT.R * 1000).toFixed(0)}/L${(GRIP_AT.L * 1000).toFixed(0)} mm, `
      + `FP at each hilt's own floor +${(FIST_CLEAR * 1000).toFixed(0)}: ` + rows.join(', ');
  });

  check('hilts: every order builds some, nobody builds them all, and all are reachable', () => {
    /* An order's rack is a statement about the order. A rack that is the whole
     * catalogue is not one — and a hilt no order builds is content that ships
     * and can only be reached by declining to pick a side. */
    const union = new Set(ORDERS.flatMap((o) => o.hilts));
    const orphans = HILT_STYLES.filter((h) => !union.has(h));
    assert(!orphans.length, `no order builds ${orphans.join(', ')}`);
    for (const o of ORDERS) {
      assert(o.hilts.length >= 3, `${o.id} builds only ${o.hilts.length} hilts`);
      assert(o.hilts.length < HILT_STYLES.length,
        `${o.id} builds every hilt there is, which says nothing about ${o.id}`);
      for (const h of o.hilts) assert(HILT_SPECS[h], `${o.id} builds a '${h}', which is not a hilt`);
      assert(new Set(o.hilts).size === o.hilts.length, `${o.id} lists a hilt twice`);
    }
    return ORDERS.map((o) => `${o.id} ${o.hilts.length}`).join(', ')
      + ` — ${union.size}/${HILT_STYLES.length} reachable`;
  });
}
