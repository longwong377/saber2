/**
 * BATTLEFRONT BORZ — THE GENERATED BATTLEFIELD, MEASURED ON GROUND THAT EXISTS.
 *
 * `FLAGSHIP.md` §12 items 1 to 3, and the reason this file is arithmetic
 * rather than screenshots is that every clause of §12.3 is a property of a
 * heightfield:
 *
 *   "High ground *flanks* the front and never sits on it; exactly one
 *    chokepoint (two reads as a maze); the ridge field goes anisotropic along
 *    the advance bearing, which turns noise into *ground that moves in a
 *    direction*."
 *
 * Three claims, three statistics, and none of them is a look at a plate.
 *
 * ── WHAT IS MEASURED, AND ON WHAT ───────────────────────────────────────
 *
 * On a BUILT `Terrain`, every time. `src/world/Battlefield.js` exposes its own
 * mask and its own ridge field, and it would be much cheaper to measure those
 * — and it would be measuring the generator's opinion of itself. The generator
 * is only right if the thing `Terrain` bakes out of it at a finite grid
 * resolution has the properties, so the analytic side is used only to say
 * WHERE to sample (where is the line, where is the belt, where is the choke),
 * and every height in this file comes off the built heightfield.
 *
 * The three statistics, each named for what a wrong answer would look like:
 *
 *   THE NEAREST HIGH GROUND TO THE LINE, in metres, against the standoff the
 *     plan asked for. "Never sits on it" is a distance, so it is measured as
 *     one. A generator that put a hill on the front would show a small number
 *     here and nothing else in this file would notice.
 *
 *   THE CROSSING-BARRIER PROFILE. For each point along the line, the highest
 *     ground on the perpendicular through it — the climb you must make to
 *     cross the front there. A chokepoint is a minimum of that profile. "One"
 *     is then two numbers: how deep the deepest notch is below the median, and
 *     how deep the best OTHER notch anywhere else on the line is. Counting
 *     minima under a threshold was tried first and is not a statistic — it
 *     reports 0, 1 or 4 depending on where the threshold is put.
 *
 *   A DIRECTIONAL VARIOGRAM in the flank belt. Mean squared height difference
 *     at a 20 m lag on 36 bearings; ridges elongated along the advance are
 *     ridges whose heights differ LEAST along it. Reported as the bearing of
 *     the minimum against the plan's advance bearing, and as max/min. Both
 *     halves are needed: a ratio alone says the ground has a grain, and the
 *     bearing says it is the battle's.
 *
 * §12's other statistic — directional banding on a POINT SET, which is what
 * Clark–Evans cannot see — lives beside `clarkEvans` in `ground-cover.mjs`,
 * where the rest of this repository's scatter statistics are, and is imported
 * here to measure the dead the dressing lays on a generated line.
 */

import * as THREE from 'three';
import { Terrain, TERRAIN_PRESETS } from '../../src/world/Terrain.js';
import {
  REASONS, REASON_ORDER, planBattle, makeBattlefield, battlefieldGround,
  installGround, removeGround, alongFront, frontAtChoke,
} from '../../src/world/Battlefield.js';
import { burnBand, walkingBarrage, burnt } from '../../src/world/Front.js';
import { addFallen } from '../../src/world/Fallen.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
/* Statically, and it is safe: `Levels.js` above already imports this module,
 * so it is in the graph either way. HANDOFF §2.1's rule is about `World.js`
 * and `Engine.js`, which rewrite three's ShaderChunks behind once-only flags;
 * `Session.js` is a hash and a record. */
import { rollGround } from '../../src/game/Session.js';
import { banding } from './ground-cover.mjs';

/** The authored ground every generated one in this file borrows. Named once:
 *  four checks used to reach for `'geonosis'` inline in `cloth-cost.mjs` and
 *  three of them were silently measuring somewhere else (HANDOFF §2.6). */
const BASE = 'geonosis';
/** Half resolution, for the reason `theline.mjs` runs at 1/30: a full-quality
 *  geonosis is 340² samples of a bezier query and this file builds eleven
 *  grounds. The properties are all tens of metres wide and the cell is 3.7 m. */
const Q = 0.5;
const SEEDS = [3, 17];

/** Build, measure, DISPOSE. HANDOFF §2.7: the two suites that have ever hung
 *  this gate are the two that hold the most Worlds alive at once, and eleven
 *  live heightfields is that shape. Nothing here holds a `Terrain` past its
 *  own survey; what is cached is the numbers. */
const SURVEYS = new Map();

function survey(reason, seed) {
  const key = `${reason}:${seed}`;
  if (SURVEYS.has(key)) return SURVEYS.get(key);
  const g = battlefieldGround(BASE, seed, { reason });
  installGround(g.key, g.preset);
  let t;
  try { t = new Terrain(new THREE.Scene(), g.key, Q); } finally { removeGround(g.key); }
  const out = measure(t, g);
  t.dispose();
  SURVEYS.set(key, out);
  return out;
}

/** The worst slope anywhere on a built grid, in `slopeAt`'s own 1 − cos θ. */
function worstSlope(t) {
  let w = 0;
  for (let j = 1; j < t.res - 1; j++) {
    for (let i = 1; i < t.res - 1; i++) w = Math.max(w, t.slopeAt(-t.half + i * t.step, -t.half + j * t.step));
  }
  return w;
}

function measure(t, g) {
  const P = g.plan, F = g.field, R = P.shape, C = P.curve;
  /** The sides that carry high ground at all — a landing zone has one. */
  const crested = [0, 1].filter((s) => R.crest[s] >= 1);

  /* ── ALONG THE LINE ─────────────────────────────────────────────────
   * Every 6 m of arc, skipping the last few metres into the map edge where
   * `inBounds` starts refusing and the heightfield's own margin lives. */
  let nLine = 0, lineSum = 0, lineMax = -Infinity;
  for (let s = 0; s <= C.length; s += 6) {
    const p = alongFront(P, s);
    if (!t.inBounds(p.x, p.z, 8)) continue;
    const h = t.height(p.x, p.z);
    nLine++; lineSum += h; lineMax = Math.max(lineMax, h);
  }
  const lineMean = lineSum / nLine;

  /* ── HIGH GROUND, AND HOW CLOSE IT COMES ────────────────────────────
   * "High" is defined off the plan rather than off a percentile: ground that
   * stands half the reason's crest above the corridor is ground the fight has
   * to go round, and that is what §12.3 means by high. A percentile would
   * define it as "the top sixth of whatever there is", which reports a
   * flat map as having high ground on it. */
  const bar = lineMean + 0.5 * Math.max(...R.crest);
  let nearHigh = Infinity, highCells = 0, flankSum = 0, nFlank = 0, cells = 0;
  for (let j = 0; j < t.res; j++) {
    for (let i = 0; i < t.res; i++) {
      const x = -t.half + i * t.step, z = -t.half + j * t.step;
      const h = t.heights[j * t.res + i];
      const q = F.at(x, z);
      const side = q.d >= 0 ? 0 : 1;
      cells++;
      if (h >= bar) { highCells++; nearHigh = Math.min(nearHigh, Math.abs(q.d)); }
      if (R.crest[side] >= 1 && Math.abs(q.d) >= R.standoff[side] + R.rise) { flankSum += h; nFlank++; }
    }
  }

  /* ── THE CROSSING-BARRIER PROFILE ───────────────────────────────────
   * Perpendicular to the line at each arc position, out past the far shoulder
   * on both sides. A crossing that leaves the map is not a crossing, so an
   * arc position whose perpendicular is more than a fifth off the map is
   * dropped rather than credited with an easy way through. */
  const span = Math.max(...R.standoff) + R.rise + 50;
  const prof = [];
  for (let s = 0; s <= C.length; s += 5) {
    const p = alongFront(P, s);
    if (!t.inBounds(p.x, p.z, 8)) continue;
    let top = -Infinity, off = 0, n = 0;
    for (let u = -span; u <= span; u += 3) {
      const x = p.x - p.tz * u, z = p.z + p.tx * u;
      n++;
      if (!t.inBounds(x, z, 8)) { off++; continue; }
      top = Math.max(top, t.height(x, z));
    }
    if (off / n <= 0.2) prof.push({ s, top });
  }
  const med = prof.map((p) => p.top).sort((a, b) => a - b)[prof.length >> 1];
  const best = prof.reduce((a, b) => (a.top < b.top ? a : b));
  /* THE SECOND WAY THROUGH has to be a different place and not the other side
   * of the same notch, so the window it is measured outside of is the notch's
   * own width — the plan's `gap`, doubled, which is where the gaussian is
   * within 2% of 1 again. */
  const elsewhere = prof.filter((p) => Math.abs(p.s - best.s) > 2 * R.gap);
  const second = elsewhere.length ? elsewhere.reduce((a, b) => (a.top < b.top ? a : b)) : null;
  const depth1 = med - best.top;
  const depth2 = second ? med - second.top : 0;

  /* ── THE DIRECTIONAL VARIOGRAM ──────────────────────────────────────
   * In the belt only — beyond the shoulder, on a crested side, clear of the
   * choke's corridor — because the ENVELOPE is anisotropic too (it is a band
   * along the line) and it is not what §12.3's clause is about. Measuring the
   * whole map first gave a minimum 90° out: the mask's own grain, drowning
   * the ridge field's. */
  const inBelt = (x, z) => {
    const q = F.at(x, z);
    const side = q.d >= 0 ? 0 : 1;
    return R.crest[side] >= 1
      && Math.abs(q.d) >= R.standoff[side] + R.rise + 10
      && F.gapAt(x, z) > 0.98;
  };
  const belt = [];
  for (let j = 0; j < t.res; j++) {
    for (let i = 0; i < t.res; i++) {
      const x = -t.half + i * t.step, z = -t.half + j * t.step;
      if (inBelt(x, z)) belt.push([x, z]);
    }
  }
  const LAG = 20;
  const vario = [];
  let pairs = Infinity;
  /* Every second cell where there are cells to spare, all of them where there
   * are not: a landing zone has one flank, and when its line runs near a
   * corner the belt is 596 cells and halving that halves the estimator's
   * sample for no saving worth having. */
  const stride = belt.length > 6000 ? 2 : 1;
  for (let k = 0; k < 36; k++) {
    const th = k * Math.PI / 36, dx = Math.cos(th) * LAG, dz = Math.sin(th) * LAG;
    let sum = 0, n = 0;
    for (let idx = 0; idx < belt.length; idx += stride) {
      const [x, z] = belt[idx], x2 = x + dx, z2 = z + dz;
      if (!t.inBounds(x2, z2, 8) || !inBelt(x2, z2)) continue;
      const d = t.height(x, z) - t.height(x2, z2);
      sum += d * d; n++;
    }
    vario.push({ th, v: sum / n, n });
    pairs = Math.min(pairs, n);
  }
  const vmin = vario.reduce((a, b) => (a.v < b.v ? a : b));
  const vmax = vario.reduce((a, b) => (a.v > b.v ? a : b));
  const axis = (a) => { const d = Math.abs(a) % Math.PI; return Math.min(d, Math.PI - d) * 180 / Math.PI; };

  return {
    reason: g.plan.reason, seed: g.plan.seed, plan: P, res: t.res, cells,
    lineMean, lineMax, bar, nearHigh, highFrac: highCells / cells,
    flankMean: nFlank ? flankSum / nFlank : null, standoff: Math.min(...crested.map((s) => R.standoff[s])),
    med, barrier: best.top, chokeAt: best.s, chokeErr: Math.abs(best.s - P.choke.s),
    depth1, depth2, choke: depth1 / Math.max(depth2, 0.05),
    aniso: vmax.v / vmin.v, grainOff: axis(vmin.th - P.bearing), beltN: belt.length, pairs,
    slope: worstSlope(t),
  };
}

/** Every survey, built once and shared. */
function all() {
  const out = [];
  for (const r of REASON_ORDER) for (const s of SEEDS) out.push(survey(r, s));
  return out;
}

export function run({ check, assert, near }) {

  /* ══ 1. a reason, from a table of five ═══════════════════════════════ */

  check('battlefield.1 the reason is one seeded choice out of five', () => {
    /**
     * §12.1: "One seeded choice, not a continuous parameter space. That is how
     * you avoid slop." Three things follow and all three are checkable: the
     * table has five rows, the seed reaches all of them, and a seed names the
     * same one twice.
     */
    assert(REASON_ORDER.length === 5, `the table holds ${REASON_ORDER.length} reasons`);
    for (const r of REASON_ORDER) assert(REASONS[r], `${r} is in the order and not in the table`);
    assert(Object.keys(REASONS).length === REASON_ORDER.length,
      'the table and its order disagree — a row nobody can roll is a row nobody has seen');

    const seen = new Map();
    for (let seed = 1; seed <= 300; seed++) {
      const p = planBattle(seed, { scale: 620 });
      assert(REASONS[p.reason], `seed ${seed} rolled "${p.reason}"`);
      seen.set(p.reason, (seen.get(p.reason) | 0) + 1);
      /* The same seed is the same battle. A plan is a pure function of its
       * seed or the deploy card is a lie — HANDOFF §2.11's rule, applied to a
       * generator rather than to a fight. */
      assert(planBattle(seed, { scale: 620 }).reason === p.reason, `seed ${seed} rolled twice and differed`);
    }
    assert(seen.size === 5, `300 seeds reached ${seen.size} of the five reasons`);
    /* NOT A CONTINUOUS SPACE. Two seeds on one reason are the same numbers;
     * what differs between them is where the line runs, not what kind of place
     * this is. That is the difference between a table and a parameter space
     * and it is what §12.1 is asking for. */
    const a = planBattle(1, { scale: 620, reason: 'pass' }), b = planBattle(2, { scale: 620, reason: 'pass' });
    assert(a.shape === b.shape, 'two grounds on one reason do not share the reason\'s numbers');
    let threw = false;
    try { planBattle(1, { scale: 620, reason: 'swamp' }); } catch { threw = true; }
    assert(threw, 'a reason that is not on the table was accepted — §2.3, a missing thing answered with a default');
    return [...seen].map(([k, v]) => `${k}×${v}`).join(' ');
  });

  /* ══ 2. the front, before the ground ═════════════════════════════════ */

  check('battlefield.2 the front is a bezier from one map edge to another, from six numbers', () => {
    /**
     * §12.2: "A bezier from one map edge to another, 3–5 control points, two
     * axes of advance crossing it. Six numbers."
     */
    const rows = [];
    for (let seed = 1; seed <= 60; seed++) {
      const p = planBattle(seed, { scale: 620 });
      const half = p.scale / 2;
      assert(p.numbers.length === 6, `the plan is drawn from ${p.numbers.length} numbers`);
      assert(p.control.length >= 3 && p.control.length <= 5,
        `${p.control.length} control points, and §12.2 asks for 3–5`);
      /* BOTH ENDS ON AN EDGE, AND NOT THE SAME EDGE. A line that enters and
       * leaves the same side of the map is a bay, not a front. */
      const edgeOf = (q) => (Math.abs(Math.abs(q.x) - half) < 1e-6 ? (q.x > 0 ? 'E' : 'W')
        : Math.abs(Math.abs(q.z) - half) < 1e-6 ? (q.z > 0 ? 'S' : 'N') : null);
      const e0 = edgeOf(p.control[0]), e1 = edgeOf(p.control[p.control.length - 1]);
      assert(e0 && e1, `seed ${seed}: the line ends at (${p.control[0].x.toFixed(0)}) and does not touch an edge`);
      assert(e0 !== e1, `seed ${seed}: the line enters and leaves on the ${e0} edge`);
      /* AND IT STAYS ON THE MAP. A bezier lies inside the hull of its
       * controls, so this is a check that the clamp holds rather than a
       * sampling of the curve — but the curve is sampled anyway, because a
       * theorem about the code that is not true of the output is the more
       * expensive kind of wrong. */
      for (let i = 0; i < p.curve.n; i++) {
        assert(Math.abs(p.curve.xs[i]) <= half && Math.abs(p.curve.zs[i]) <= half,
          `seed ${seed}: the line leaves the map at (${p.curve.xs[i].toFixed(0)}, ${p.curve.zs[i].toFixed(0)})`);
      }
      /* TWO AXES OF ADVANCE, CROSSING IT. Crossing means from opposite sides:
       * one army's axis has a positive component on the front's normal and the
       * other's is negative, and they are not the same line. */
      const [A, B] = p.advance;
      const dotA = Math.cos(A) * p.dir.x + Math.sin(A) * p.dir.z;
      const dotB = Math.cos(B) * p.dir.x + Math.sin(B) * p.dir.z;
      assert(dotA > 0.1 && dotB < -0.1,
        `seed ${seed}: the two axes cross the line at ${dotA.toFixed(2)} and ${dotB.toFixed(2)} — they do not meet on it`);
      assert(Math.abs(Math.abs(A - B) - Math.PI) > 0.1,
        `seed ${seed}: the two axes of advance are one axis drawn twice`);
      /* AND THE FIGHT IS WHERE THE PLAYER IS. §13.3: the variable has to be a
       * fact a place can show you from the inside. */
      assert(Math.hypot(p.choke.x, p.choke.z) < half * 0.62,
        `seed ${seed}: the chokepoint is ${Math.hypot(p.choke.x, p.choke.z).toFixed(0)} m from the deploy point`);
      if (seed <= 3) rows.push(`${e0}→${e1} choke ${Math.hypot(p.choke.x, p.choke.z).toFixed(0)} m out`);
    }
    return `60 seeds: ${rows.join(', ')}`;
  });

  /* ══ 3. the height function derives from the front ═══════════════════ */

  check('battlefield.3 high ground flanks the front and never sits on it', () => {
    /**
     * The first clause of §12.3, as a distance in metres: how close does
     * ground that stands half a crest above the corridor come to the line?
     *
     * MEASURED, five reasons × two seeds on a built geonosis-borrowing grid:
     * the nearest high ground is 63–166 m out against standoffs of 38–58 m,
     * i.e. never inside the standoff and always outside it by the part of the
     * rise it takes to get half way up. The corridor's own ground stays within
     * a metre or so of where it started while the flanks stand 7–19 m over it.
     */
    const rows = [];
    for (const m of all()) {
      assert(m.nearHigh >= m.standoff,
        `${m.reason}/${m.seed}: high ground comes within ${m.nearHigh.toFixed(0)} m of the line and the `
        + `shoulders are supposed to stand ${m.standoff} m back`);
      /* AND THERE IS HIGH GROUND AT ALL. "Flanks the front" is two claims and
       * a flat map satisfies the first one. */
      /* THAT THERE IS ANY. `nearHigh` is a minimum over an empty set on a map
       * with no high ground on it, and an empty minimum passes the clause
       * above without argument. The bar is half a percent of the map rather
       * than a tenth of it because a GUN LINE is legitimately thin: its
       * shoulder stands 118 m back and rises over another 88, so on a 620 m
       * field the crest has 100 m of map left to occupy and covers 1.1% of it.
       * That is a landform — 4 hectares of it — and a bound tuned to a pass
       * would have deleted the row. */
      assert(m.highFrac > 0.005,
        `${m.reason}/${m.seed}: ${(m.highFrac * 100).toFixed(2)}% of the map is high ground — nothing flanks anything`);
      assert(m.flankMean - m.lineMean > 2,
        `${m.reason}/${m.seed}: the flanks stand ${(m.flankMean - m.lineMean).toFixed(1)} m above the line`);
      /* THE LINE IS FLAT ENOUGH TO FIGHT ON. `lineMax` is the highest point
       * ON the front; a line that climbs 20 m over its length is a ridge with
       * a battle drawn on it. */
      assert(m.lineMax - m.lineMean < 4,
        `${m.reason}/${m.seed}: the line itself rises ${(m.lineMax - m.lineMean).toFixed(1)} m above its own mean`);
      rows.push(`${m.reason} ${m.nearHigh.toFixed(0)}≥${m.standoff}`);
    }
    return `nearest high ground vs standoff — ${rows.join(', ')}`;
  });

  check('battlefield.4 exactly one chokepoint, and it is the one the plan named', () => {
    /**
     * "Exactly one chokepoint (two reads as a maze)."
     *
     * Two numbers rather than a count: the deepest notch in the crossing
     * barrier, and the deepest notch anywhere else. MEASURED over the ten
     * grounds: the notch runs 9–28 m below the median crossing and the best
     * other way through is 0.3–8.8 m below it, a ratio of 2.4 to 34.
     *
     * The first version of this counted profile points under 0.45 × median
     * and reported between 0 and 4 chokepoints on grounds that all had one —
     * a threshold on a noisy profile is a coin toss, and the ratio of two
     * minima is not.
     */
    const rows = [];
    for (const m of all()) {
      assert(m.depth1 > 3,
        `${m.reason}/${m.seed}: the best crossing is only ${m.depth1.toFixed(1)} m below the median climb — `
        + 'there is no chokepoint, only a wall of even height');
      assert(m.choke > 2,
        `${m.reason}/${m.seed}: the second way through is ${m.depth2.toFixed(1)} m deep against the choke's `
        + `${m.depth1.toFixed(1)} m — two ways through reads as a maze`);
      /* AND IT IS WHERE THE BATTLE SAID IT WOULD BE. A ground with one
       * chokepoint somewhere else is a ground whose dressing, whose dead and
       * whose two axes of advance all point at a wall. */
      assert(m.chokeErr < m.plan.shape.gap,
        `${m.reason}/${m.seed}: the lowest crossing is ${m.chokeErr.toFixed(0)} m along the line from the `
        + `chokepoint the plan named, and the notch is only ${m.plan.shape.gap} m wide`);
      rows.push(`${m.reason} ${m.depth1.toFixed(0)}m vs ${m.depth2.toFixed(1)}m (${m.choke.toFixed(1)}×)`);
    }
    return rows.join(', ');
  });

  check('battlefield.5 the ridge field runs along the advance bearing', () => {
    /**
     * "The ridge field goes anisotropic along the advance bearing, which turns
     * noise into ground that moves in a direction."
     *
     * A directional variogram at a 20 m lag, in the flank belt. Ground with a
     * grain differs least ALONG the grain, so the bearing of the minimum is
     * the grain's own — MEASURED, it lands 0–7° off the advance bearing on
     * every one of the ten grounds, and the max/min ratio runs 2.5–18 against
     * an isotropic field's 1.
     *
     * The ratio tracks the reason's own `grain` — a wreck field is authored at
     * 148/70 = 2.1 and measures 2.5–3.5; a gun line at 262/68 = 3.9 measures
     * 7.0–8.1 — so the row a person wrote is the thing that reaches the
     * ground, which is the whole of §12.1's argument for a table.
     */
    const rows = [];
    for (const m of all()) {
      /* A PRECONDITION ON THE ESTIMATOR, stated as the number of PAIRS the
       * thinnest bearing was averaged over rather than as the size of the
       * belt: a landing zone has one flank and can be down to 596 cells of it
       * when the line runs near a corner, and that is still 200 pairs a
       * bearing, which is a quiet enough variogram. The belt size is not the
       * quantity the estimate's noise depends on. */
      assert(m.pairs > 150,
        `${m.reason}/${m.seed}: the thinnest bearing has ${m.pairs} pairs in it (${m.beltN} belt cells)`);
      assert(m.grainOff < 20,
        `${m.reason}/${m.seed}: the ground's grain runs ${m.grainOff.toFixed(0)}° off the advance bearing`);
      assert(m.aniso > 2,
        `${m.reason}/${m.seed}: the ridge field measures ${m.aniso.toFixed(2)}× across its grain against `
        + 'along it — that is isotropic noise with a battle drawn on top of it');
      /* THE RATIO CANNOT EXCEED THE ROW BY MUCH WITHOUT MEANING SOMETHING
       * ELSE: a variogram of 50 would be a corrugation, not ground. */
      assert(m.aniso < 40, `${m.reason}/${m.seed}: ${m.aniso.toFixed(1)}× is corrugated iron, not terrain`);
      rows.push(`${m.reason} ${m.aniso.toFixed(1)}× at ${m.grainOff.toFixed(0)}°`);
    }
    return rows.join(', ');
  });

  /* ══ 5. do not generate the palette ══════════════════════════════════ */

  check('battlefield.6 the palette is the authored ground\'s, field for field', () => {
    /**
     * §12.5: "Do not generate the palette. Pick from authored sets."
     *
     * Enforced by construction — the row is a spread of an authored preset —
     * so what this measures is that the construction is still what it says:
     * every key the base has, the generated row has, and it is the SAME
     * OBJECT, not a copy that could be perturbed later. The one exception is
     * `height`, which is the whole point, plus the plan hung on the row so a
     * diagnostic can tell what it is looking at.
     *
     * Nothing here names a colour. A list of the fields that must be borrowed
     * is a hand-maintained twin of `TERRAIN_PRESETS` (§2.3, eight instances
     * and counting): a field added to a preset tomorrow would not be on it.
     */
    const g = battlefieldGround(BASE, 5);
    const base = TERRAIN_PRESETS[BASE];
    const extra = Object.keys(g.preset).filter((k) => !(k in base));
    assert(extra.length === 1 && extra[0] === 'battlefield',
      `the generated row invents ${extra.join(', ')}`);
    const changed = Object.keys(base).filter((k) => g.preset[k] !== base[k]);
    assert(changed.length === 1 && changed[0] === 'height',
      `the generated row rewrites ${changed.join(', ')} — §12.5 allows it to rewrite the shape and nothing else`);
    assert(Object.keys(base).length > 20, `only ${Object.keys(base).length} fields borrowed — is this a preset?`);

    /* AND IT IS GROUND OF THE SAME KIND. The palette is authored; the
     * question left is whether the shape it is painted on is out of family
     * with it — a slope the authored ground never reaches would put rock
     * bands, footfall material and grass cover somewhere their author never
     * looked. Measured against the base itself rather than against a number,
     * so an edit to geonosis moves both sides at once. */
    const authored = new Terrain(new THREE.Scene(), BASE, Q);
    const bar = worstSlope(authored);
    authored.dispose();
    for (const m of all()) {
      assert(m.slope <= bar,
        `${m.reason}/${m.seed} reaches slope ${m.slope.toFixed(2)} where ${BASE} itself never passes ${bar.toFixed(2)}`);
    }
    /* A roofed or paved ground is refused rather than accepted and ruined. */
    let threw = false;
    try { battlefieldGround('hangar', 1); } catch { threw = true; }
    assert(threw, 'a front was derived on a hangar deck');
    return `${Object.keys(base).length} fields borrowed from ${BASE} unchanged, one replaced; `
      + `steepest generated ${Math.max(...all().map((m) => m.slope)).toFixed(2)} against ${BASE}'s own ${bar.toFixed(2)}`;
  });

  /* ══ 13.5 — the constraint that binds all of it ══════════════════════ */

  check('battlefield.7 a generated ground is a layer, and no seed can name it', () => {
    /**
     * FLAGSHIP §13.5: "No room's deletion deletes the mode — every level in
     * `LEVEL_ORDER` is a legal seed. That is exactly what killed the Descent."
     *
     * THE LINE rolls its ground off the run seed over the seven authored
     * theatres. A generated ground is a LAYER on one of those — an authored
     * row with its height replaced — and this is the check that it cannot
     * become the eighth: the roll is taken with a generated ground installed
     * and standing in the table, and it must still only ever name a level.
     *
     * `theline.mjs` owns the roll itself and this file does not restate it
     * (§2.4); what is asserted here is only what THIS file could break.
     */
    const g = battlefieldGround(BASE, 9);
    const before = Object.keys(TERRAIN_PRESETS).sort().join(',');
    installGround(g.key, g.preset);
    try {
      assert(TERRAIN_PRESETS[g.key], 'the generated ground did not install');
      assert(!LEVELS[g.key] && !LEVEL_ORDER.includes(g.key),
        `${g.key} is in the level roster — a generated ground has become a room`);
      /* Installed, in the table, and still unreachable by the mode's own roll:
       * the roll is over LEVEL_ORDER, and the generated key is not a level. */
      for (let seed = 1; seed <= 200; seed++) {
        assert(LEVEL_ORDER.includes(rollGround(seed, LEVEL_ORDER)),
          `seed ${seed} rolled off the roster while a generated ground was installed`);
      }
      /* AND IT CANNOT SHADOW AN AUTHORED ONE, which is the way a generated
       * ground would actually delete a room: not by removing the name, by
       * answering to it. */
      let shadow = false;
      try { installGround(BASE, g.preset); } catch { shadow = true; }
      assert(shadow, `a generated ground was allowed to take the name '${BASE}'`);
      let stole = false;
      try { removeGround(BASE); } catch { stole = true; }
      assert(stole, `removeGround deleted the authored '${BASE}'`);
      assert(TERRAIN_PRESETS[BASE], `'${BASE}' is gone from the table`);
    } finally { removeGround(g.key); }
    assert(Object.keys(TERRAIN_PRESETS).sort().join(',') === before,
      'the ground table is not what it was before the install — HANDOFF §2.9, a suite that borrows a '
      + 'singleton must hand back all of it');
    return `${g.key} borrows ${g.base}; ${LEVEL_ORDER.length} authored grounds still the only things a seed can name`;
  });

  check('battlefield.8 the same seed builds the same ground', async () => {
    /**
     * A deploy card that names a seed and a ground is a promise that the two
     * go together. Two builds of one seed, sampled on the same 40 × 40 lattice
     * — and a THIRD build with another seed drawn in between, because the
     * failure this is really about is a generator that reads a shared stream
     * (HANDOFF §2.11: one rng stream, one process).
     */
    const one = makeBattlefield(planBattle(21, { scale: 620 }));
    makeBattlefield(planBattle(22, { scale: 620 })).height(10, 10);
    const two = makeBattlefield(planBattle(21, { scale: 620 }));
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const x = -300 + i * 15, z = -300 + j * 15;
        worst = Math.max(worst, Math.abs(one.height(x, z) - two.height(x, z)));
      }
    }
    assert(worst === 0, `two builds of seed 21 differ by up to ${worst.toFixed(4)} m`);
    /* And two seeds are two battles — the same test §12.1 makes of the reason,
     * made of the ground. */
    const other = makeBattlefield(planBattle(22, { scale: 620 }));
    let diff = 0;
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const x = -300 + i * 15, z = -300 + j * 15;
        diff = Math.max(diff, Math.abs(one.height(x, z) - other.height(x, z)));
      }
    }
    assert(diff > 5, `two seeds differ by ${diff.toFixed(1)} m at most — the seed is not moving the battle`);
    return `seed 21 twice: identical; seed 21 against 22: ${diff.toFixed(0)} m apart`;
  });

  check('battlefield.9 the dressing lands on the generated line', () => {
    /**
     * §12.4's marks are built and they take a STRAIGHT front — a bearing and a
     * distance. `frontAtChoke` is the one conversion from the bezier to that,
     * the tangent at the chokepoint, and this is the measurement of what the
     * linearisation costs: where do the burn marks actually fall relative to
     * the curve they are supposed to be drawn on?
     *
     * MEASURED on a pass at seed 3, whose curve is one of the tighter ones in
     * the roster: the tangent is good for 80 m either side of the choke, and
     * inside that the burn lands within a few tens of metres of the curve and
     * on the right side of it. Asked for `burnBand`'s own default of ±260 m
     * instead, three quarters of the swath came down on the CLEAN side — so
     * `reach` is not a refinement, it is the thing that makes the bridge
     * usable at all. The dead, laid in a ±150 m band, are the same object
     * §12's banding statistic is calibrated on, so the band is measured with
     * it here rather than by eye.
     */
    const g = battlefieldGround(BASE, 3, { reason: 'pass' });
    installGround(g.key, g.preset);
    let t;
    try { t = new Terrain(new THREE.Scene(), g.key, Q); } finally { removeGround(g.key); }
    const front = frontAtChoke(g.plan);
    /* A SPY, AND PUT BACK. The scar field is a texture and the marks are not
     * readable out of it; what is readable is where they were asked for.
     * HANDOFF §2.9's rule applies to one method as much as to a singleton. */
    const marks = [];
    const real = t.scorch.bind(t);
    t.scorch = (x, z, r, a) => { marks.push([x, z]); return real(x, z, r, a); };
    const laid = burnBand(t, front, { seed: 613, half: front.reach });
    t.scorch = real;
    assert(laid > 100 && marks.length === laid, `${laid} burns laid, ${marks.length} seen`);
    /* AND THE SAME CALL WITHOUT `reach`, so the comparison is a measurement
     * and not a bound somebody chose. This is the only place in the file where
     * a number is asserted against another number from the same run. */
    const wide = [];
    t.scorch = (x, z, r, a) => { wide.push([x, z]); return real(x, z, r, a); };
    burnBand(t, front, { seed: 613 });
    t.scorch = real;

    const spread = (ms) => {
      const v = ms.map(([x, z]) => g.field.at(x, z).d).sort((a, b) => a - b);
      return { med: v[v.length >> 1], worst: Math.max(Math.abs(v[0]), Math.abs(v[v.length - 1])),
        p95: [...v].map(Math.abs).sort((a, b) => a - b)[Math.floor(v.length * 0.95)] };
    };
    const near = spread(marks), far = spread(wide);
    /* THE SWATH STRADDLES THE LINE. `burnBand` lays its near row ON the line
     * and thins out behind it, so the median wants to be within a row or two
     * of zero — measured, +1 m — and nothing in it wants to be a hundred
     * metres out on the clean side, which is what the tangent does past its
     * reach. MEASURED: ±34 m worst with `reach`, 157 m without. */
    assert(Math.abs(near.med) < 20,
      `the burn's median lands ${near.med.toFixed(0)} m from the line — the swath is not on the front`);
    assert(near.worst < 70,
      `a burn mark falls ${near.worst.toFixed(0)} m from the line`);
    assert(near.p95 * 2 < far.p95,
      `the tangent's reach buys nothing: 95% of the swath within ${near.p95.toFixed(0)} m of the line `
      + `against ${far.p95.toFixed(0)} m when the whole 260 m band is asked for`);

    /* The craters walk, and they walk on ground the line has crossed. */
    const across = front.bearing + Math.PI / 2;
    const from = { x: front.dir.x * (front.distance + 10) - Math.cos(across) * 52,
      z: front.dir.z * (front.distance + 10) - Math.sin(across) * 52 };
    const n = walkingBarrage(t, from, across, { seed: 31 });
    assert(n >= 6, `${n} craters of a walking barrage landed on the map`);

    /* And the dead: §12.4's band, on the generated front, measured with §12's
     * own statistic rather than looked at. */
    const world = { scene: new THREE.Scene(), statics: [], terrain: t };
    const f = addFallen(world, { origin: { x: g.plan.choke.x, z: g.plan.choke.z },
      dir: front.dir, count: 520, half: 150, depth: 6.5, seed: 4211 });
    const pts = [], m4 = new THREE.Matrix4();
    for (const im of f.meshes) for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m4); pts.push([m4.elements[12], m4.elements[14]]); }
    const b = banding(pts);
    assert(b.ratio > 5, `the fallen band measures ${b.ratio.toFixed(1)} on the banding statistic — it is not a line`);
    const bearOff = Math.abs(b.at - g.plan.bearing) % Math.PI;
    assert(Math.min(bearOff, Math.PI - bearOff) < 0.35,
      `the dead lie across a bearing ${(b.at * 180 / Math.PI).toFixed(0)}° against an advance of `
      + `${(g.plan.bearing * 180 / Math.PI).toFixed(0)}°`);
    for (const im of f.meshes) im.geometry.dispose();
    t.dispose();
    return `tangent good for ±${front.reach} m; ${laid} burns, median ${near.med.toFixed(0)} m off the line `
      + `and 95% inside ${near.p95.toFixed(0)} m (against ${far.p95.toFixed(0)} m unbounded); `
      + `${n} craters; the dead band at ${b.ratio.toFixed(1)}`;
  });

  check('battlefield.10 five reasons are five grounds', () => {
    /**
     * The point of a table of five is that the five are different PLACES, not
     * five settings of one place. Three axes a player would feel — how much
     * ground stands over the line, how tight the way through is, and whether
     * the line is a low place — and each reason has to be distinguishable from
     * every other on at least one of them.
     */
    const rows = [];
    const by = new Map();
    for (const m of all()) {
      const k = m.reason;
      const v = by.get(k) || [];
      v.push(m); by.set(k, v);
    }
    const sig = (ms) => ({
      relief: ms.reduce((a, b) => a + (b.flankMean - b.lineMean), 0) / ms.length,
      gap: ms[0].plan.shape.gap,
      cut: ms.reduce((a, b) => a + b.lineMean, 0) / ms.length,
    });
    const sigs = [...by].map(([k, ms]) => [k, sig(ms)]);
    for (const [k, s] of sigs) rows.push(`${k} relief ${s.relief.toFixed(1)} m, gap ${s.gap} m, line ${s.cut.toFixed(1)} m`);
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        const a = sigs[i][1], b = sigs[j][1];
        const apart = Math.abs(a.relief - b.relief) > 2 || Math.abs(a.gap - b.gap) > 10
          || Math.abs(a.cut - b.cut) > 1.5;
        assert(apart, `${sigs[i][0]} and ${sigs[j][0]} build the same ground`);
      }
    }
    /* AND THE FORD IS THE ONE WHOSE LINE IS THE LOW GROUND, which is the row
     * that would be pure decoration if `swale` never reached the heightfield. */
    const ford = sigs.find(([k]) => k === 'ford')[1];
    for (const [k, s] of sigs) {
      if (k === 'ford') continue;
      assert(ford.cut < s.cut - 1.5, `the ford's line sits at ${ford.cut.toFixed(1)} m and ${k}'s at ${s.cut.toFixed(1)} m`);
    }
    return rows.join('; ');
  });
}
