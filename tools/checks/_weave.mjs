/**
 * SABER — what a piece of simulated cloth actually costs.
 *
 * Both the cape and the skirt used to be measured by counting particles, and
 * the skirt was required to hold under the cape's 99. That bound was never a
 * measurement of anything: it passed at 98 by a single particle, and it says a
 * fine, tiny garment is cheap and a coarse, large one is dear — the opposite of
 * the truth. The moment the robe was lengthened from 460mm to 700mm to bury the
 * rigid cone that was showing through it, the count went to 140 and the bound
 * failed, having caught the one change it should have waved through.
 *
 * A verlet solve costs per particle and per link, so the cost of a garment is
 * (how much surface it covers) × (how finely that surface is diced). The first
 * of those is not the solver's business — it is set by the body: a robe has to
 * reach the ankles or there is a cone under it. The second is, and it is the
 * only half a cut is free to choose. So that is what these measure: the CELL,
 * the area of one quad of the weave at rest, from the structural links' own cut
 * lengths. No simulation, no dependence on how far the thing has flared.
 *
 * A garment that covers more and dices no finer is doing more work at the same
 * price per unit, which is what the skirt is: 140 particles over 1.12 m² at
 * 8.9 cm²/particle, against the cape's 99 over 0.46 m² at 5.7. The particle
 * count is then pinned from both ends without anyone picking a number — the
 * area by the body, the density by the cape — and the two numbers below are
 * printed by every check that uses them so a future increase is visible in the
 * pass line rather than only in a frame time.
 */

import * as THREE from 'three';

const ZERO = new THREE.Vector3();

/** Mean rest length of the structural (kind 0) links, along and across. */
export function weave(cl, { tube = false } = {}) {
  // rest0 is written by reset(), which runs on the first update — a cloth that
  // has never been stepped has the links but not their cut lengths, and every
  // number below would come back NaN.
  if (!cl.initialised) cl.update(1 / 60, cl.refreshColliders(), ZERO);
  let a = 0, na = 0, d = 0, nd = 0;
  for (const l of cl.links) {
    if (l.kind !== 0) continue;
    if (l.across) { a += l.rest0; na++; } else { d += l.rest0; nd++; }
  }
  const across = na ? a / na : 0, down = nd ? d / nd : 0;
  const cell = across * down;
  // a tube closes, so it has `cols` quads around; a sheet has cols-1
  const quads = (tube ? cl.cols : cl.cols - 1) * (cl.rows - 1);
  const area = quads * cell;
  const n = cl.cols * cl.rows;
  return { n, across, down, cell, area, quads,
           density: area > 0 ? n / area : Infinity,
           colliders: cl.refreshColliders().length };
}

/** `140 particles over 1.12 m² (89.0 cm²/cell)` */
export function weaveLine(w) {
  return `${w.n} particles over ${w.area.toFixed(2)} m² (${(w.cell * 1e4).toFixed(1)} cm²/cell)`;
}
