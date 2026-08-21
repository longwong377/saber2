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

export class CraterLog {
  constructor(entries = []) {
    /** Flat, `FIELDS` numbers per crater: x, z, radius, depth, rim, might. */
    this.entries = entries;
    this._terrain = null;
    this._prev = null;
  }

  /** How many craters are on the log. */
  get length() { return this.entries.length / FIELDS; }

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
      delete t._craterLog;
    }
    this._terrain = null; this._prev = null;
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
    const was = terrain.might ?? 1;
    const e = this.entries;
    for (let i = 0; i < e.length; i += FIELDS) {
      terrain.might = e[i + 5];
      apply(e[i], e[i + 1], e[i + 2], e[i + 3], e[i + 4]);
    }
    terrain.might = was;
    terrain.flush?.();
    return { craters: this.length, ms: performance.now() - t0 };
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
    return this;
  }

  /** Everything on the log, rounded to a centimetre. See FIELDS. */
  toJSON() {
    const out = new Array(this.entries.length);
    for (let i = 0; i < this.entries.length; i++) out[i] = Math.round(this.entries[i] * 100) / 100;
    return { v: 1, n: this.length, e: out };
  }

  static fromJSON(j) {
    if (!j) return new CraterLog();
    /* An array straight off the wire is accepted as well as the wrapper, so a
     * caller that stored `log.toJSON().e` and a caller that stored the whole
     * object both come back to the same place rather than one of them silently
     * loading an empty ground. */
    const e = Array.isArray(j) ? j : (j.e || []);
    return new CraterLog(e.slice(0, e.length - (e.length % FIELDS)));
  }
}

/** Fields per crater, exported so a check cannot hold a second copy of 6. */
export const CRATER_FIELDS = FIELDS;
