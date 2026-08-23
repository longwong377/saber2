/**
 * BATTLEFRONT BORZ — a broad phase for the other array everything sweeps by
 * hand: the bodies themselves.
 *
 * ── WHAT IT IS FOR ───────────────────────────────────────────────────────
 *
 * `src/physics/BoxIndex.js` opens by listing the six queries that walk
 * `physics.staticBoxes` linearly once per body per frame, and answers them.
 * This is the same finding one array over. `World.pickTarget` says so in its
 * own note — "this is O(bodies²) per frame" — and until this file existed that
 * was a fact stated and not a fact fixed:
 *
 *   pickTarget         every body walks every other body to find the nearest
 *                      hostile. A square.
 *   _hostilesFor       builds the whole opposed list, once per trooper per
 *                      frame, so `CommandDirector.targetFor` can then reject
 *                      almost all of it against a leash of 30 m. A square, and
 *                      the list it builds is thrown away every frame.
 *
 * Measured with `tools/floor.mjs` at 158 bodies on Geonosis, the first of the
 * two alone is 2.49 ms — 6.8% of the frame — and it grows as a square while
 * every other term in the table grows as a line. The mass-battle ambition in
 * PLAN.md §4 is a hundreds-of-bodies ambition, so a square is the term that
 * decides whether that is reachable at all.
 *
 * ── WHY A UNIFORM GRID, AGAIN ────────────────────────────────────────────
 *
 * The same argument BoxIndex makes, minus one complication and plus another.
 *
 * MINUS: a body is a POINT. Boxes are circles and had to be written into every
 * cell they overlap, with an `oversized` escape for the 200 m ground plate.
 * A body goes in exactly one cell, so binning is one hash per body and there is
 * no spill list and no duplicate-suppression stamp.
 *
 * PLUS: bodies MOVE. BoxIndex rebuilds when `boxVersion` moves, which on a
 * quiet level is never; this rebuilds every frame, unconditionally. That is
 * O(bodies) once against O(bodies²) saved, and it is why `sync` is cheap
 * enough to call without asking whether it is needed — see `World.update`.
 *
 * ── THE TWO QUERIES, AND WHY `nearest` IS EXACT ──────────────────────────
 *
 * `within(x, z, r, out)` is BoxIndex's contract: a SUPERSET of the bodies
 * inside the disc, with the caller keeping its own distance test. Nothing
 * subtle.
 *
 * `nearest(x, y, z, pred, best)` is the interesting one, because a grid answering
 * "the closest thing that satisfies a predicate" is only worth anything if it
 * is EXACT — a nearest-target search that sometimes returns the second-nearest
 * is a body that sometimes turns its back on what is about to kill it, which is
 * a defect a player sees and no check would ever catch by sampling.
 *
 * ── AND IT IS NOT A RING WALK, WHICH IS THE FINDING ──────────────────────
 *
 * The textbook grid nearest-neighbour expands Chebyshev rings out from the
 * query cell and stops once the best distance found is inside k·CELL, because
 * everything unscanned is at least that far. That is correct, it is what this
 * file did first, and on this game it was SLOWER THAN THE SWEEP IT REPLACED:
 * `pickTarget` went 2.49 ms a frame to 5.37 at 160 bodies.
 *
 * The reason is not a tuning miss, it is the shape of the subject. A ring walk
 * is fast when the answer is near and degenerates when the field around the
 * query is empty — and an empty field between the asker and the answer is not a
 * corner case here, it is THE OPENING OF EVERY BATTLE. Two armies land 120 m
 * apart with nothing in between; until they meet, every body on both sides is
 * asking for a nearest hostile that is ten rings away. Measured: 77% of
 * searches walked eight rings, found nothing, and swept the array anyway — 202
 * records touched per query against the 160 a plain sweep touches.
 *
 * So this sweeps the OCCUPIED CELLS instead, which is the structure the subject
 * actually has. An army is a cluster: 160 bodies on the `front` layout occupy
 * 57 cells. For each cell there is one cheap test — the closest point of that
 * cell's square to the query — and a cell that cannot beat the best found so
 * far is skipped entire, all 2.8 bodies of it.
 *
 * Two properties, and both of them are why this is the right shape:
 *
 *   IT IS NEVER MUCH WORSE THAN THE SWEEP. Occupied cells are at most bodies,
 *   so the floor is one cheap test per body and the ceiling stays a constant
 *   factor from linear no matter how the field is arranged. The ring walk had
 *   no such floor: its cost depended on emptiness, which is unbounded.
 *
 *   IT GETS BETTER THE MORE THE FIELD CLUSTERS, which is the direction a
 *   battlefield moves in. Bodies bunch into squads, squads into lines.
 *
 * The 3×3 block around the query is probed FIRST, before the sweep, for one
 * reason: it usually contains the answer, and a tight `bestD` going into the
 * sweep is what makes the per-cell rejection reject. If it does — if the best
 * found is inside CELL − STALE — the ring-1 bound applies and the sweep never
 * runs at all. That bound is the textbook one and it is worth stating once:
 *
 *   if |px − qx| < CELL then floor(px/CELL) and floor(qx/CELL) differ by at
 *   most 1, so a body closer than CELL on the plane is inside the 3×3 block on
 *   both axes — i.e. it has been scanned.
 *
 * `tools/checks/army-index.mjs` asserts the answer against the exhaustive sweep
 * body-for-body over randomised fields rather than taking any of this on trust.
 *
 * ── TIES ─────────────────────────────────────────────────────────────────
 *
 * The linear sweep this replaces took the first body at the minimum distance in
 * ARRAY order, and array order is not a fact about the world: `World.enemies`
 * is spliced as bodies die, so the same two bodies equidistant from a third
 * resolve differently depending on who died earlier in the run. A grid would
 * have swapped that for cell order, which is no better.
 *
 * So the tie is broken on `id`, which is stable, ordered, and the same on every
 * machine — the property `Net`'s claim reconciliation needs and the property
 * `determinism.mjs` exists to defend. It is a behaviour change on an exactly-
 * equal distance and nowhere else.
 */

/**
 * Cell edge, metres.
 *
 * Sized off the query that runs most: `CommandDirector.targetFor` rejects
 * against a leash whose formations run 14–34 m, so a leash query wants to touch
 * a handful of cells and not a hundred. 12 m puts a 30 m leash at 5×5 = 25
 * cells and a 14 m one at 3×3.
 *
 * It is also about a third of the LOD 1 distance, so the nearest-hostile ring
 * search on a body with anything at all in front of it finishes inside two
 * rings.
 */
const CELL = 12;

/**
 * The widest `within` query that is worth doing by cells: 17×17 of them, a
 * 200 m box. A radius past that is the sweep with extra steps, and `within`
 * says so rather than walking three hundred empty cells to find out.
 */
const WIDE_CELLS = 17;

/**
 * HOW FAR A BODY MAY HAVE WALKED SINCE IT WAS BINNED, metres.
 *
 * The index is rebuilt once at the top of the frame and read all the way
 * through it, so by the time the last body picks a target the first one has
 * already taken its step. That is deliberate — a rebuild per body would put the
 * O(bodies) back that this file exists to remove — but it means a body can be
 * one frame of travel outside the cell it is indexed in, and a broad phase that
 * is a superset "except for the fast ones" is not a superset.
 *
 * So every query is widened by this much and every ring bound is tightened by
 * it. Two metres is a generous frame at the speeds on this field: the fastest
 * thing that walks is under 9 m/s and the fastest thing that drives is under 30,
 * which at the 20 fps floor `Engine` clamps to is 1.5 m.
 *
 * It costs nothing measurable — a 30 m leash query goes from 5×5 cells to 5×5 —
 * and it is the difference between a bound that is proved and a bound that is
 * usually true.
 */
const STALE = 2;

const key = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

/**
 * Squared distance in three dimensions, which is what the sweep this replaces
 * measured and therefore what this has to measure.
 *
 * The grid is on the XZ plane and the ring bound is an XZ bound, so it is worth
 * saying why a 3D comparison is still safe inside it: a 3D distance is never
 * SHORTER than the XZ distance between the same two points, so a body the ring
 * bound says is at least k·CELL away on the plane is at least k·CELL away in
 * space. The bound holds for the larger quantity for free.
 */
function dist2(p, x, y, z) {
  const dx = p.x - x, dy = p.y - y, dz = p.z - z;
  return dx * dx + dy * dy + dz * dz;
}

export class ArmyIndex {
  constructor(cell = CELL) {
    this.cell = cell;
    /** @type {Map<number, {x0:number,z0:number,n:number,b:object[]}>} */
    this.cells = new Map();
    /** Cell records, reused frame to frame. `live` of them are in use. */
    this.pool = [];
    this.live = 0;
    /** The array this index was last built from. Held for the linear fallback. */
    this.bodies = [];
    /* Counters, because what this file claims is a COUNT and not a clock
     * (HANDOFF §2.6). `tested` is how many body records a caller actually
     * looked at; `linear` is how many it would have looked at without the
     * index. Their ratio is the result, and it is the same on every machine. */
    this.tested = 0;
    this.linear = 0;
    this.queries = 0;
    this.rebuilds = 0;
    /* `sweeps` is how many `within` calls were so wide that the cells were
     * not worth walking. `cellTests` is how many cheap per-cell rejections
     * `nearest` made. */
    this.sweeps = 0;
    this.nearCalls = 0; this.cellTests = 0; this.withinCalls = 0;
  }

  /** Throw everything away. */
  reset() {
    this.cells.clear();
    this.pool.length = 0;
    this.live = 0;
    this.bodies = [];
    this.tested = this.linear = this.queries = this.rebuilds = this.sweeps = 0;
    this.nearCalls = this.cellTests = this.withinCalls = 0;
  }

  /**
   * Rebuild from `bodies`. Called once a frame from `World.update`, before
   * anything reads a target — see the note there about ordering.
   *
   * Dead bodies are indexed like any other. Every caller tests `dead` already
   * (a target may die between the rebuild and the read, so the test cannot be
   * dropped whatever this does), and skipping them here would mean a body's
   * membership depended on a flag that flips mid-frame.
   */
  sync(bodies) {
    this.bodies = bodies;
    const c = this.cell;
    /* The cell records are POOLED and the map is rebuilt against them, because
     * this runs every frame: a fresh Map of fresh arrays per frame is a few
     * hundred allocations a second handed to the collector for a structure
     * whose contents are the same shape every time. `live` is how much of the
     * pool this frame is using. */
    const pool = this.pool;
    this.cells.clear();
    this.live = 0;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const p = b.position;
      if (!p) continue;
      const cx = Math.floor(p.x / c), cz = Math.floor(p.z / c);
      const k = key(cx, cz);
      let rec = this.cells.get(k);
      if (!rec) {
        rec = pool[this.live] || (pool[this.live] = { x0: 0, z0: 0, n: 0, b: [] });
        rec.x0 = cx * c; rec.z0 = cz * c; rec.n = 0;
        this.live++;
        this.cells.set(k, rec);
      }
      rec.b[rec.n++] = b;
    }
    this.rebuilds++;
    return this;
  }

  /**
   * The squared distance from (x, z) to the nearest point of a cell's square,
   * slackened by STALE — a lower bound on how close anything filed in that cell
   * can possibly be, and therefore the whole of the rejection test.
   */
  _cellFloor2(rec, x, z) {
    const c = this.cell;
    let dx = x < rec.x0 ? rec.x0 - x : (x > rec.x0 + c ? x - rec.x0 - c : 0);
    let dz = z < rec.z0 ? rec.z0 - z : (z > rec.z0 + c ? z - rec.z0 - c : 0);
    dx = dx > STALE ? dx - STALE : 0;
    dz = dz > STALE ? dz - STALE : 0;
    return dx * dx + dz * dz;
  }

  /**
   * Every body that could be within `r` of (x, z), appended to `out`.
   *
   * A superset: the cells scanned cover the disc's bounding square, so the
   * corners bring in bodies up to r·√2 away. The caller's own distance test is
   * what decides membership, exactly as in BoxIndex.
   */
  within(x, z, r, out) {
    this.queries++; this.withinCalls++;
    this.linear += this.bodies.length;
    const c = this.cell;
    r += STALE;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    /* A radius wide enough to cover the field is the sweep with extra steps. */
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > WIDE_CELLS * WIDE_CELLS) {
      this.sweeps++;
      const all = this.bodies;
      for (let i = 0; i < all.length; i++) out.push(all[i]);
      this.tested += all.length;
      return out;
    }
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const rec = this.cells.get(key(cx, cz));
        if (!rec) continue;
        for (let i = 0; i < rec.n; i++) out.push(rec.b[i]);
        this.tested += rec.n;
      }
    }
    return out;
  }

  /**
   * The nearest body to (x, z) that `pred` accepts, or null.
   *
   * `bestD` seeds the search with a distance already beaten — `World.pickTarget`
   * has usually already found a player and only wants a body that is CLOSER —
   * so a seeded search can finish inside one ring where an unseeded one would
   * expand to the horizon.
   *
   * Returns the record rather than a distance; the caller that wants the
   * distance has the position.
   */
  nearest(x, y, z, pred, bestD = Infinity) {
    this.queries++; this.nearCalls++;
    this.linear += this.bodies.length;
    const c = this.cell;
    const cx0 = Math.floor(x / c), cz0 = Math.floor(z / c);
    let best = null;
    /* THE 3×3 FIRST, because it usually holds the answer and because a tight
     * `bestD` is what makes the sweep below reject whole cells. */
    for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
      for (let cz = cz0 - 1; cz <= cz0 + 1; cz++) {
        const rec = this.cells.get(key(cx, cz));
        if (!rec) continue;
        this.tested += rec.n;
        for (let i = 0; i < rec.n; i++) {
          const b = rec.b[i];
          if (!pred(b)) continue;
          const d = dist2(b.position, x, y, z);
          if (d < bestD || (d === bestD && best && b.id < best.id)) { bestD = d; best = b; }
        }
      }
    }
    /* Anything outside the block is at least CELL away (less STALE), so a best
     * inside that is final. It is `bestD` and not `best` that is tested, and
     * the difference cost 4.1 ms a frame to find: `World.pickTarget` seeds
     * `bestD` with the distance to the nearest PLAYER and asks only for a body
     * that beats it, so a trooper standing next to you finds no BODY at all —
     * and a null `best` swept the whole field every frame to learn nothing.
     * Nothing beating a seed inside the bound is an answer: it means nothing
     * beats it anywhere. */
    const near = c - STALE;
    if (bestD <= near * near) return best;
    /* Otherwise every occupied cell, cheapest test first. The 3×3 has already
     * been scanned; re-scanning it is three body tests on this field and a
     * branch to skip it would cost as much as it saves. */
    const pool = this.pool;
    for (let k = 0; k < this.live; k++) {
      const rec = pool[k];
      this.cellTests++;
      if (this._cellFloor2(rec, x, z) >= bestD) continue;
      this.tested += rec.n;
      for (let i = 0; i < rec.n; i++) {
        const b = rec.b[i];
        if (!pred(b)) continue;
        const d = dist2(b.position, x, y, z);
        if (d < bestD || (d === bestD && best && b.id < best.id)) { bestD = d; best = b; }
      }
    }
    return best;
  }

  /**
   * The same answer by exhaustive sweep, for the check that prices this and for
   * the check that proves the grid agrees with it. Same tie rule, so the two
   * are comparable by identity and not merely by distance.
   */
  nearestLinear(x, y, z, pred, bestD = Infinity) {
    let best = null;
    const all = this.bodies;
    for (let i = 0; i < all.length; i++) {
      const b = all[i];
      if (!pred(b)) continue;
      const d = dist2(b.position, x, y, z);
      if (d < bestD || (d === bestD && best && b.id < best.id)) { bestD = d; best = b; }
    }
    return best;
  }
}
