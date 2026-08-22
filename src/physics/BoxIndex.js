/**
 * BATTLEFRONT BORZ — a broad phase for the one array everything sweeps by hand.
 *
 * ── WHAT IT IS FOR ───────────────────────────────────────────────────────
 *
 * `physics.staticBoxes` is not the solver's list; it is the list every
 * hand-rolled query in the game walks LINEARLY, once per body per frame:
 * `Enemy._gatherNear`, `Enemy`'s push-out sweep, `Player._gatherNear`,
 * `Support.supportHeight` and `ceilingHeight`, `Spawn`, `CommandDirector`.
 * Three separate notes in this tree already say so and each of them fixed the
 * problem for its own caller and nobody else's:
 *
 *   Trees.js       "every near-list in the engine walks `physics.staticBoxes`
 *                  LINEARLY, once per body per frame — so the array is a
 *                  per-frame O(bodies × boxes) cost." Its answer is an 11 m
 *                  RING of trunk colliders round each body, rebuilt four times
 *                  a second off a 12 m cell index — i.e. it keeps the array
 *                  short by refusing to put most trees in it at all.
 *   Enemy.js       NEAR_REACH's note: the gait asks about the ground ~11 times
 *                  a body a frame, so it gathers a short list ONCE and hands
 *                  that to `supportHeight`. The gather is still linear.
 *   Enemy.js       "the array GROWS as the level is fought in: cutting masonry
 *                  converts a monolithic structure into per-chunk static
 *                  colliders, so four minutes of an ordinary temple fight takes
 *                  241 to 377."
 *
 * All three describe the same shape: N boxes × B bodies every frame, with N
 * rising through the session. This is the index the gather should have been
 * reading, so the cost stops depending on how much of the level has been shot.
 *
 * ── WHY A UNIFORM GRID AND NOT A TREE ────────────────────────────────────
 *
 * The subjects are static, the queries are small discs on the XZ plane, and the
 * population is a few hundred — every property that makes a grid the right
 * structure and a BVH the wrong one. A grid also rebuilds in one linear pass,
 * which matters because `Destruction` adds boxes in bursts of dozens.
 *
 * ── THE CORRECTNESS ARGUMENT, WHICH IS THE WHOLE FILE ────────────────────
 *
 * The callers' test is `|centre − p|xz ≤ box.radius + reach`, so the query is
 * "which box CIRCLES overlap the disc (p, reach)". A box is inserted into every
 * cell its own circle (centre, radius) overlaps; a query scans every cell the
 * disc (p, reach) overlaps. If the two circles overlap they share a point, that
 * point lies in one cell, and that cell is both insert-covered and
 * scan-covered — so the grid can never MISS a box the linear sweep would have
 * found. It may return extra, and the caller's own distance test rejects those,
 * which is why `query` returns a candidate list rather than an answer.
 *
 * A box whose circle spans more cells than `SPILL` goes on an `oversized` list
 * that every query scans in full. Without it one 200 m ground plate would write
 * itself into forty thousand cells and the index would cost more than the sweep
 * it replaces. Nothing else about the structure changes: `oversized` is scanned
 * exhaustively, so it is exactly the old behaviour for the handful of records
 * that need it.
 *
 * ── STALENESS ────────────────────────────────────────────────────────────
 *
 * The index is rebuilt when the owner's `boxVersion` moves, and RapierWorld
 * bumps that in `addStaticBox`, `removeStaticBox` and `clear`. A version and
 * not a length: a remove and an add inside one frame leave the length alone and
 * the contents different, which is exactly the case a length check answers
 * confidently and wrongly (HANDOFF §2.3).
 *
 * `disabled` is deliberately NOT part of the index. It is a live property with
 * a setter that reaches into Rapier, it flips on doors and shields several
 * times a second, and every caller already tests it — an index that tracked it
 * would have to be rebuilt on a door opening for no gain at all.
 */

/** Cell edge, metres. About four body-reaches, so a gather touches 2×2 cells. */
const CELL = 10;

/** A box that would occupy more than this many cells is scanned exhaustively. */
const SPILL = 25;

const key = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

export class BoxIndex {
  constructor(cell = CELL) {
    this.cell = cell;
    /** @type {Map<number, object[]>} */
    this.cells = new Map();
    /** Boxes too big to bin. Scanned by every query. @type {object[]} */
    this.oversized = [];
    /** The `boxVersion` this index was built from. */
    this.version = -1;
    /** How many boxes are binned, for the checks that price this. */
    this.binned = 0;
    /* Counters, because the thing this file claims is a COUNT and not a clock
     * (HANDOFF §2.6). `tested` is how many box records a caller actually looked
     * at; `linear` is how many it would have looked at without the index. Their
     * ratio is the whole result and it is the same number on every machine. */
    this.tested = 0;
    this.linear = 0;
    this.queries = 0;
    this.rebuilds = 0;
  }

  /** Throw away everything. The next query rebuilds. */
  reset() {
    this.cells.clear();
    this.oversized.length = 0;
    this.version = -1;
    this.binned = 0;
  }

  /** (Re)build from `boxes` if `version` has moved since the last build. */
  sync(boxes, version) {
    if (version === this.version) return;
    this.cells.clear();
    this.oversized.length = 0;
    this.binned = 0;
    const c = this.cell;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const r = b.radius;
      const x0 = Math.floor((b.center.x - r) / c), x1 = Math.floor((b.center.x + r) / c);
      const z0 = Math.floor((b.center.z - r) / c), z1 = Math.floor((b.center.z + r) / c);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > SPILL) { this.oversized.push(b); continue; }
      this.binned++;
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = key(cx, cz);
          const list = this.cells.get(k);
          if (list) list.push(b); else this.cells.set(k, [b]);
        }
      }
    }
    this.version = version;
    this.rebuilds++;
  }

  /**
   * Every box whose circle could reach within `reach` of (x, z).
   *
   * A SUPERSET, not an answer: the caller keeps its own distance test, which is
   * the only thing that decides membership. `out` is reused by the caller, so
   * this appends and never allocates one.
   *
   * A box that spans several cells appears in each of them, so it can be
   * offered twice. Every caller's test is idempotent — `supportHeight` takes a
   * maximum, `_gatherNear` builds a list the same function then sweeps — but a
   * duplicated entry is still wasted work and a longer short-list, so each box
   * carries the id of the query that last took it. An integer stamp rather than
   * a Set: a Set of a dozen boxes allocates once a body a frame and this does
   * not allocate at all.
   */
  query(boxes, version, x, z, reach, out) {
    this.sync(boxes, version);
    const stamp = ++this.queries;
    this.linear += boxes.length;
    const c = this.cell;
    const x0 = Math.floor((x - reach) / c), x1 = Math.floor((x + reach) / c);
    const z0 = Math.floor((z - reach) / c), z1 = Math.floor((z + reach) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.cells.get(key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (b._qs === stamp) continue;
          b._qs = stamp;
          this.tested++;
          out.push(b);
        }
      }
    }
    for (let i = 0; i < this.oversized.length; i++) {
      const b = this.oversized[i];
      if (b._qs === stamp) continue;
      b._qs = stamp;
      this.tested++;
      out.push(b);
    }
    return out;
  }
}
