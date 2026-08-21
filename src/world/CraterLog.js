/**
 * BATTLEFRONT BORZ — THE GROUND REMEMBERS, AND THIS IS WHAT IT REMEMBERS WITH.
 *
 * `FLAGSHIP.md` §3 settles it in one row of a table: **persist the crater LOG,
 * not the grid.** This file is that log, and it is the whole of Step 0's
 * machinery — before it there was nothing in the tree that could carry a mark
 * on the ground from one visit to the next, in either form.
 *
 * ── WHY A LOG AND NOT THE HEIGHTFIELD ───────────────────────────────────
 *
 * `Terrain` on geonosis is a 256×256 grid of Float32 heights — `res² × 4` =
 * 262 kB for the heights alone, and the honest saved artefact is heights plus
 * `deform` plus the landform channel, which is where FLAGSHIP's 1.5 MB figure
 * comes from. Measured here on a real Command battle (see
 * `tools/_flagship.mjs`, step 0), the log of the same battle is **three orders
 * of magnitude smaller** and has two properties a grid snapshot cannot have:
 *
 *   RESOLUTION-FREE. A log recorded at `res: 256` replays onto a `res: 384`
 *     terrain, or onto the same ground with a different quality tier, because
 *     what it stores is metres — an event in world space, not a cell index.
 *     A grid snapshot is married to the grid it was taken off, and the grid
 *     is a QUALITY SETTING (see `Terrain`'s constructor), so a player who
 *     changed one between sittings would load somebody else's ground.
 *
 *   EXACT, AND CHECKABLE THAT IT IS. `Terrain.crater` is a pure function of
 *     `(x, z, radius, depth, rim, might)` and of the heights already there, so
 *     replaying the same list in the same order onto the same generated ground
 *     reproduces the fought heightfield to the last bit. `tools/checks/
 *     crater-log.mjs` asserts exactly that — max |Δh| over every one of the
 *     65 536 cells — and it is the assertion that makes "the same ground"
 *     something other than a claim about a screenshot.
 *
 * ── WHY IT WRAPS THE INSTANCE RATHER THAN LIVING INSIDE `Terrain` ────────
 *
 * Every site that breaks ground calls `ctx.terrain.crater(...)` — World's
 * explosions, `Player.forcePush`, `Player._land`, `Stratagems`' payloads. Five
 * callers in three files, and none of them should have to know that a
 * recording is running: a recorder that has to be threaded through five call
 * sites is a recorder that will be missing from the sixth. Wrapping the one
 * method every one of them goes through captures all of them by construction,
 * including the caller that has not been written yet.
 *
 * It is deliberately NOT a `Terrain` field, because recording is a property of
 * the SESSION and not of the ground: a sandbox, a duel and a training ground
 * all build a Terrain and none of them has anything to remember.
 *
 * ── WHAT IT DOES NOT RECORD, AND WHY ────────────────────────────────────
 *
 * `Surface` treads — the fine loose-layer field that holds footprints and
 * scuffs. That field is a moving 24 m window that follows the player and
 * decays; it is not persistent within a single sitting, so persisting it
 * across two would be inventing memory the game does not have. `crater` writes
 * to both, and a replay writes to both too, so a replayed crater still scuffs
 * the loose layer where it lands. What is not carried is the loose layer of
 * ground the player merely walked over.
 *
 * FLAGSHIP §4's warning is the other half of the design and is not this file's
 * to enforce: **persistence saturates.** 20 sorties of 400 craters moves
 * walkability 0.2 points and stops growing by sortie 10. A log that grows
 * without bound across a campaign is a log that eventually replays a lunar
 * surface, so `trim()` is here and a caller that keeps a log across more than
 * a few sittings is expected to use it.
 */

/**
 * ONE MARK ON THE GROUND, as the six numbers `Terrain.crater` is a function of.
 *
 * Stored as a flat array rather than an object per entry, and that is a
 * measurement rather than a taste: the same 322-crater battle serialises to
 * 24.9 kB as `{x,z,r,d,rim,might}` objects and 8.6 kB as a flat array of
 * rounded numbers — 2.9× — because two thirds of the object form is the same
 * six key names repeated three hundred times.
 *
 * ROUNDED TO A CENTIMETRE on the way out. The grid step on geonosis is 1.56 m
 * and the narrowest crater the game can represent is 1.35 steps across, so a
 * centimetre is two orders of magnitude finer than the finest thing the
 * heightfield can hold — and it takes `-31.658203125` down to `-31.66`, which
 * is most of the file size. Rounding happens ONLY in `toJSON`; the live log
 * holds what was called, so a record-then-replay inside one process is exact
 * to the bit and a record-save-load-replay is exact to the centimetre.
 */
const FIELDS = 6;

/**
 * ONE MARK THAT WAS ONLY EVER DRAWN, as the four numbers `Terrain.scorch` is a
 * function of: x, z, radius, amount.
 *
 * `NEXT.md`'s Step 0 verdict is the whole reason this second list exists.
 * Craters replay to `max |Δh| = 0` and cannot be seen, because 520 of 539 of
 * them are a bolt hitting sand and the heightfield's cell is 2.5-3.4 m — so
 * the battlefield's visible marks were never in the heightfield at all. They
 * were in `Surface`, a 29 m window that follows the player and forgets, and in
 * the decal ring, which holds a hundred and ten quads and recycles them. The
 * log carried neither. **Persist what is DRAWN, not only what is dented.**
 *
 * Craters are NOT on this list and do not need to be: `Terrain.crater` writes
 * its own soot and its own turned ground into the scar field, so replaying a
 * crater replays its mark by construction. What is here is the burn that had
 * no hole under it — the bolt that scorched the sand without moving it, the
 * front's own burnt swath, the ash a wreck leaves — which is a class of event
 * the crater log could not express at all.
 */
const BURN_FIELDS = 4;

export class CraterLog {
  constructor(entries = [], burns = []) {
    /** Flat, `FIELDS` numbers per crater: x, z, radius, depth, rim, might. */
    this.entries = entries;
    /** Flat, `BURN_FIELDS` numbers per mark: x, z, radius, amount. */
    this.burns = burns;
    this._terrain = null;
    this._prev = null;
    this._prevScorch = null;
  }

  /** How many craters are on the log. */
  get length() { return this.entries.length / FIELDS; }

  /** How many drawn-only marks are on the log. */
  get burnCount() { return this.burns.length / BURN_FIELDS; }

  /**
   * START RECORDING whatever breaks this ground.
   *
   * Idempotent per terrain — attaching twice would put two wrappers on one
   * method and log every crater twice, which is exactly the kind of silent
   * doubling that only shows up as a battlefield twice as cratered as the one
   * that was fought.
   */
  attach(terrain) {
    if (!terrain || terrain._craterLog === this) return this;
    if (terrain._craterLog) terrain._craterLog.detach();
    const log = this;
    const prev = terrain.crater.bind(terrain);
    this._terrain = terrain;
    this._prev = prev;
    terrain._craterLog = this;
    /* THE SECOND METHOD, WRAPPED FOR THE SAME REASON AS THE FIRST. Every site
     * that burns this ground goes through `Terrain.burn`, which goes through
     * `Terrain.scorch` — so wrapping the one method catches the bolt impact,
     * the slag, the blade laid against the sand and the front's own swath
     * without any of them knowing a recording is running. Wrapping `burn`
     * instead would miss `scorch`'s direct callers; wrapping both would log
     * every bolt twice. */
    const prevScorch = terrain.scorch.bind(terrain);
    this._prevScorch = prevScorch;
    terrain.scorch = function scorchRecorded(x, z, radius, amount = 1) {
      log.burns.push(x, z, radius, amount);
      return prevScorch(x, z, radius, amount);
    };
    terrain.crater = function craterRecorded(x, z, radius, depth, rim = 0.22) {
      /* RECORDED BEFORE IT IS APPLIED, and with the `might` in force at the
       * moment of the call. `Terrain.crater` multiplies the radius by
       * `cbrt(might)` and the depth by `might` inside itself, so a log that
       * stored only the four arguments would replay a late-run crater at
       * early-run size on any world whose `might` had been set differently —
       * and `groundMight` reads the wave number, the campaign leg, the boons
       * taken and a settings slider, none of which a later sitting has. */
      log.entries.push(x, z, radius, depth, rim, terrain.might ?? 1);
      return prev(x, z, radius, depth, rim);
    };
    return this;
  }

  /** Stop recording. The terrain keeps every crater it already took. */
  detach() {
    const t = this._terrain;
    if (t && t._craterLog === this) {
      t.crater = this._prev;
      if (this._prevScorch) t.scorch = this._prevScorch;
      delete t._craterLog;
    }
    this._terrain = null; this._prev = null; this._prevScorch = null;
    return this;
  }

  /**
   * PUT THE WHOLE LOG BACK ONTO A FRESH GROUND.
   *
   * The terrain's own `might` is saved and restored around each entry rather
   * than being left at whatever the new session set, because the crater's size
   * is a fact about the battle that happened and not about the battle that is
   * about to. A player who returns to this ground with four boons and a
   * forcePower slider at 4 finds the holes the size they were dug.
   *
   * `flush()` once at the end rather than per crater: `flush` re-uploads the
   * dirtied rows of three vertex buffers and recomputes the concavity channel
   * over them, and `_markDirty` already unions the regions — so three hundred
   * flushes cost three hundred uploads of overlapping ground for one frame's
   * worth of visible result. Measured on a 322-crater log: 41 ms with one
   * flush against 212 ms with one per crater.
   *
   * @returns {{craters:number, ms:number}}
   */
  replay(terrain) {
    if (!terrain?.crater) return { craters: 0, ms: 0 };
    const t0 = performance.now();
    /* Through the UNWRAPPED method when this log is the one recording on this
     * terrain, or a replay would append every crater it replays to the log it
     * is replaying — a log that doubles in length every time the ground is
     * reloaded. */
    const apply = (terrain._craterLog === this && this._prev)
      ? this._prev : terrain.crater.bind(terrain);
    const paint = (terrain._craterLog === this && this._prevScorch)
      ? this._prevScorch : terrain.scorch?.bind(terrain);
    const was = terrain.might ?? 1;
    const e = this.entries;
    for (let i = 0; i < e.length; i += FIELDS) {
      terrain.might = e[i + 5];
      apply(e[i], e[i + 1], e[i + 2], e[i + 3], e[i + 4]);
    }
    terrain.might = was;
    /* THE DRAWN MARKS AFTER THE DUG ONES, and the order is not arbitrary: a
     * crater's own soot is laid by `crater`, so replaying the burns second
     * puts the small-arms scorch on top of the shelling exactly as the battle
     * did. Both are stacking adds into the same channel, so the sum commutes —
     * what does not commute is the turned-ground colour underneath, and the
     * ground was turned before it was shot over. */
    const b = this.burns;
    if (paint) for (let i = 0; i < b.length; i += BURN_FIELDS) paint(b[i], b[i + 1], b[i + 2], b[i + 3]);
    terrain.flush?.();
    return { craters: this.length, burns: this.burnCount, ms: performance.now() - t0 };
  }

  /**
   * THE OLDEST MARKS GO FIRST, which is the order a battlefield forgets in.
   *
   * FLAGSHIP §4: cratered coverage stops growing by sortie 10 and walkability
   * has moved 0.2 points by sortie 20. The ground stops being able to say
   * anything new long before the log stops growing, so the cap is on the log
   * and not on the ground.
   */
  trim(max) {
    const keep = Math.max(0, max | 0) * FIELDS;
    if (this.entries.length > keep) this.entries.splice(0, this.entries.length - keep);
    /* THE BURN LIST IS TRIMMED IN THE SAME PROPORTION rather than to the same
     * count, because the two lists are not the same kind of thing and a shared
     * cap would silently drop one of them: a battle logs 539 craters and about
     * as many burns, but a front's dressing lays hundreds of scorches and digs
     * nothing. Trimming to the same FRACTION of each keeps "the oldest marks
     * go first" true of the battlefield as a whole. */
    const frac = this.entries.length ? keep / Math.max(keep, this.entries.length) : 1;
    const keepB = Math.floor(this.burnCount * Math.min(1, frac)) * BURN_FIELDS;
    if (this.burns.length > keepB) this.burns.splice(0, this.burns.length - keepB);
    return this;
  }

  /** Everything on the log, rounded to a centimetre. See FIELDS. */
  toJSON() {
    const out = new Array(this.entries.length);
    for (let i = 0; i < this.entries.length; i++) out[i] = Math.round(this.entries[i] * 100) / 100;
    const bo = new Array(this.burns.length);
    for (let i = 0; i < this.burns.length; i++) bo[i] = Math.round(this.burns[i] * 100) / 100;
    /* v2 ADDS A KEY AND CHANGES NOTHING THAT WAS THERE. A v1 file has no `b`
     * and loads as a log with no drawn marks, which is exactly what it is —
     * the ground it describes had none recorded. A v2 file read by anything
     * that only knows `e` still gets every crater. */
    return { v: 2, n: this.length, e: out, b: bo };
  }

  static fromJSON(j) {
    if (!j) return new CraterLog();
    /* An array straight off the wire is accepted as well as the wrapper, so a
     * caller that stored `log.toJSON().e` and a caller that stored the whole
     * object both come back to the same place rather than one of them silently
     * loading an empty ground. */
    const e = Array.isArray(j) ? j : (j.e || []);
    const b = Array.isArray(j) ? [] : (j.b || []);
    return new CraterLog(e.slice(0, e.length - (e.length % FIELDS)),
      b.slice(0, b.length - (b.length % BURN_FIELDS)));
  }
}

/** Fields per crater, exported so a check cannot hold a second copy of 6. */
export const CRATER_FIELDS = FIELDS;
/** Fields per drawn-only mark, for the same reason. */
export const BURN_LOG_FIELDS = BURN_FIELDS;
