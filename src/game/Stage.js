/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE STAGE — the drum stops being symmetrical
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player, on the 2.0 list, item 10: *"A stage, not a station. Drop the
 * drum's symmetry: one deck badly lit and half abandoned, one deck rich, one
 * deck the workers'. Rooms that are big, rooms that are tiny, a hallway you
 * can get lost in."*
 *
 * Four fifths of that lane is geometry and lives where geometry lives —
 * `StationPlan.js` sites the abandoned quarter, the warren and the three tiny
 * rooms; `StationKit.js` builds them and carries the three dressing
 * characters. What is HERE is the part that is neither a table nor a builder:
 *
 *   `maze`        the one generator for the warren's corridors. A seeded
 *                 depth-first carve on a grid, with its dead ends and its two
 *                 exits reported rather than re-derived — the builder stands
 *                 the walls from it and `tools/checks/station.mjs` floods the
 *                 SAME graph. A check that generated its own maze would be
 *                 checking a copy, which is the defect `StationPlan`'s header
 *                 is about, in miniature.
 *   `stepStage`   the flickering strips. A dead room's one live light is the
 *                 whole of what makes it read as dead rather than as unlit,
 *                 and a flicker is a thing that has to STUTTER — a sine is a
 *                 mood light. Each strip gets a 32-slot bit pattern and a slot
 *                 length off its own room's id, so the three of them are never
 *                 in step and each is the same room on every visit.
 *   `stashKey`    the crate in the valve room, which opens once, ever.
 *
 * ── AND IT WRITES NO LIGHT ────────────────────────────────────────────────
 *
 * V20 lane 1 owns the station's lighting. This lane records WHERE the dark is
 * — `StationPlan.DARK_ARC`, copied onto `st.stage.darkArc` by `dressStation`
 * — and touches nothing else with a light in it. The emissive strips below
 * are surfaces in a room, not lamps in a rig; two lanes moving one lamp is
 * exactly the failure both of them would be blamed for.
 */

import { pay } from './Credits.js';
import { stashState, setStashState } from './StationSave.js';

/** A small deterministic stream. The same one `dressRng` uses, standing on
 * its own here because `StationKit` is not imported by this file. */
function rng(seed) {
  let a = (seed | 0) >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** The four sides of a cell, as bits on `cells[i + j * cols]`. */
export const N = 1, E = 2, S = 4, W = 8;

/**
 * ══ THE WARREN'S PLAN ═════════════════════════════════════════════════════
 *
 * A depth-first carve on a `cols × rows` grid: from a seeded start, walk to a
 * random unvisited neighbour knocking the wall between, and back up when
 * there is none. The result is a PERFECT maze — one path between any two
 * cells, and therefore real dead ends, which a "maze" made of random open
 * walls does not have. `j = 0` is the inner row (the spine end) and
 * `j = rows − 1` is the outer one (the derelict rooms' end).
 *
 * Then two things are done to it deliberately:
 *
 *   THE VALVE ROOM — a 2 × 2 block of cells at the middle with its internal
 *   walls taken out, so the middle of the maze is a ROOM and not another
 *   corner. Somewhere to arrive is what makes the rest of it a walk.
 *
 *   THE TWO EXITS — the outer wall of `(spineI, 0)` and of `(ringI, rows−1)`.
 *   `spineI` is the middle column, because `station.mjs`'s doorway walk goes
 *   straight down the room's centre line and the mouth has to be on it.
 *
 * Everything a reader could otherwise re-derive is returned: the dead ends,
 * the two exits, the valve room's cells.
 */
export function maze({ cols = 7, rows = 9, seed = 4821 } = {}) {
  const cells = new Uint8Array(cols * rows);
  const seen = new Uint8Array(cols * rows);
  const R = rng(seed);
  const at = (i, j) => i + j * cols;
  const stack = [[cols >> 1, 0]];
  seen[at(cols >> 1, 0)] = 1;
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const open = [];
    if (j + 1 < rows && !seen[at(i, j + 1)]) open.push([i, j + 1, N, S]);
    if (i + 1 < cols && !seen[at(i + 1, j)]) open.push([i + 1, j, E, W]);
    if (j > 0 && !seen[at(i, j - 1)]) open.push([i, j - 1, S, N]);
    if (i > 0 && !seen[at(i - 1, j)]) open.push([i - 1, j, W, E]);
    if (!open.length) { stack.pop(); continue; }
    const [ni, nj, bit, back] = open[Math.floor(R() * open.length) % open.length];
    cells[at(i, j)] |= bit;
    cells[at(ni, nj)] |= back;
    seen[at(ni, nj)] = 1;
    stack.push([ni, nj]);
  }
  /* The valve room: a 2 × 2 at the middle, its four internal walls out. */
  const vi = (cols >> 1) - 1, vj = (rows >> 1) - 1;
  for (let dj = 0; dj < 2; dj++) {
    cells[at(vi, vj + dj)] |= E; cells[at(vi + 1, vj + dj)] |= W;
  }
  for (let di = 0; di < 2; di++) {
    cells[at(vi + di, vj)] |= N; cells[at(vi + di, vj + 1)] |= S;
  }
  /* The two ways in. The spine's is on the centre column by construction. */
  const spineI = cols >> 1;
  const ringI = Math.min(cols - 1, spineI + 2);
  cells[at(spineI, 0)] |= S;
  cells[at(ringI, rows - 1)] |= N;
  /* And what it turned out to be, counted rather than claimed. */
  const deadEnds = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const b = cells[at(i, j)];
      let n = 0;
      for (const k of [N, E, S, W]) if (b & k) n++;
      if (n === 1) deadEnds.push([i, j]);
    }
  }
  return { cols, rows, cells, spineI, ringI, valve: { i: vi, j: vj }, deadEnds };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE FLICKER                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * WHERE THE STAGE'S OWN STATE LIVES on the station record. Made on demand,
 * because `buildPlace` runs against a bare `st` in two checks and a probe and
 * has no way to know whether `dressStation` has been round yet.
 */
export function stageOf(st) {
  return (st.stage || (st.stage = {
    /** `StationPlan.DARK_ARC`, copied here by `dressStation` for the light lane. */
    darkArc: null,
    /** One per derelict room — see `addFlicker`. */
    flickers: [],
    /** Every dressing kind this deck actually laid — see `StationKit.noteDress`. */
    dressKinds: new Set(),
    /** Where the crate in the valve room ended up, in world XZ. */
    stash: null,
  }));
}

/**
 * One derelict room's strip, registered by `StationKit.buildPlace` off the
 * builder's `ctx.flicker`. `mat` is the room's OWN clone of the deck's strip
 * material — the deck's is shared by every lit surface on the deck and
 * dimming it would put the whole of 48 on this room's rhythm.
 */
export function addFlicker(st, place, mat) {
  const stage = stageOf(st);
  const R = rng(place.id * 977 + 13);
  /* ~70 % lit, so the room is USUALLY on and the dark is the event. */
  let bits = 0;
  for (let k = 0; k < 32; k++) if (R() < 0.7) bits |= (1 << k);
  stage.flickers.push({
    id: place.id, mat, base: mat.emissiveIntensity,
    bits, slot: 0.07 + R() * 0.12, t: R() * 3,
  });
  return stage.flickers.length;
}

/**
 * Step the stage. Called once a frame from `Station.stepStation`; a no-op on
 * every deck that has no derelict room on it, which is two of the three.
 */
export function stepStage(world, st, dt) {
  const stage = st?.stage;
  if (!stage || !stage.flickers.length) return 0;
  let dark = 0;
  for (const f of stage.flickers) {
    f.t += dt;
    const k = Math.floor(f.t / f.slot) & 31;
    const on = (f.bits >>> k) & 1;
    /* Not off: a dead strip still throws a little. 6 % is the glow of a tube
     * that has struck and not held, which is what this is. */
    const want = on ? f.base : f.base * 0.06;
    if (f.mat.emissiveIntensity !== want) f.mat.emissiveIntensity = want;
    if (!on) dark++;
  }
  return dark;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE STASH                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/** How far from the crate the key answers, and what is in it. */
export const STASH_REACH = 2.2;
const STASH_PAY = 320;

/**
 * The crate in the valve room. ONCE, EVER — `StationSave.stash` is the fold,
 * so a lift ride, a reload and a new run all find it already opened. A second
 * press says so rather than doing nothing, because a key that answers nothing
 * reads as a key that is broken.
 *
 * Called from `Station.stationKey` ahead of the place branch: the warren has
 * no counter, no kiosk and no resident, so nothing else in that function
 * could ever claim the press.
 */
export function stashKey(world) {
  const at = world?._station?.stage?.stash;
  if (!at) return false;
  const p = world.player?.position;
  if (!p) return false;
  if (Math.hypot(p.x - at.x, p.z - at.z) > STASH_REACH) return false;
  const fold = stashState();
  if (fold && fold.opened) {
    world.notify?.('THE VALVE ROOM', 'the crate is empty — you emptied it');
    return true;
  }
  const paid = pay(STASH_PAY, 'the warren stash');
  setStashState({ opened: true, paid });
  world.notify?.('THE VALVE ROOM', `somebody's stash: ${paid} credits, and a smell of coolant`);
  return true;
}
