/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE LAUNCH — SHARK §7 #5, and it is not a level load either
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §3.2 #5 Cobra bay: *"the launch well: a vertical shaft with the Starfury on
 * a rail, catapult rams, hazard chevrons, a blast wall you look through"*, and
 * the verb is **board and launch**.
 *
 * ── THE BAR THIS FILE IS WRITTEN AGAINST ──────────────────────────────────
 *
 * V15 §1.5: *"seemlessly should be able to go from our star wars hangar to the
 * station through just the elevator with no loading screens."* `station.mjs`
 * holds the lift to it. A launch that put a plate up would undo that lane in
 * one commit, and it would be the easy thing to do — the outside is a
 * different view of the world and a plate is how a view gets changed.
 *
 * SO NOTHING IS LOADED, and the argument is `Warp.js`'s word for word:
 *
 *   THE PLAYER NEVER MOVES. `DeckLift.js`'s ride is the proof this works —
 *   the car does not travel; the SHAFT streams past it, the doors are shut,
 *   and thirty levels go by while the player stands still on a floor that
 *   never changed. The well in #5 is a shaft with strip lights up it
 *   (`StationKit.shaft` builds ten of them), so a launch is that ride with the
 *   lid off at the top of it.
 *
 *   THE WORLD IS NEVER REBUILT. What is outside is `Hangar.outsideLevel`'s
 *   record through `SkyDome.configureOrbit`, exactly as the flight deck's own
 *   window already is. Changing what you are looking at is re-configuring a
 *   shader, which takes a frame, not a stage.
 *
 *   AND THE ONE FRAME IT HAPPENS ON IS CHOSEN. `outside(true)` is called at
 *   the TOP of MOUTH, when the well is at full scroll and the player is
 *   looking at strip lights going past at forty metres a second — the one
 *   moment in the sequence where a hitch is invisible. `Warp.js` picks its
 *   frame the same way and for the same reason.
 *
 * ── WHY IT IS A SEQUENCE AND NOT AN EFFECT ────────────────────────────────
 *
 * Same as the jump: a procedure reads as a ship handled by people who do this
 * for a living. A catapult launch is one of the most proceduralised things a
 * human being does, and every phase below is a real call in a real order —
 * you are given the seat, the canopy comes down, the deck is cleared, the
 * officer takes you, and then it is out of your hands for a second and a half.
 *
 * ── WHAT IT IMPORTS ───────────────────────────────────────────────────────
 *
 * **Nothing.** `Warp.js` imports nothing for this reason and this file is the
 * same shape: it is a clock and a state machine, the two things it drives are
 * handed in as `sink`, and it can therefore be stepped at 6 ms a step in a
 * check with no station, no THREE and no player. The well's height is a
 * parameter rather than a `StationPlan` import for the same reason — one
 * number, handed in by the file that already knows the room.
 */

/**
 * ══ OUT ═══════════════════════════════════════════════════════════════════
 *
 * Six phases, 7.7 seconds. Shorter than the jump (9.0) because a launch is one
 * ship and a jump is a station, and longer than a door because it is the thing
 * the whole of §7 is for.
 */
export const OUT = Object.freeze([
  { id: 'board', t: 1.2, say: 'Cobra bay — she is yours. In you get.' },
  { id: 'strap', t: 1.4, say: 'Canopy down and sealed. Rams to pressure.' },
  { id: 'clear', t: 1.6, say: 'Deck is clear. Launch officer has you.' },
  { id: 'drop', t: 1.1, say: 'Launch, launch, launch.' },
  { id: 'mouth', t: 1.4, say: null },
  { id: 'free', t: 1.0, say: null },
]);

/**
 * ══ IN ════════════════════════════════════════════════════════════════════
 *
 * Four phases, 5.6 seconds, and it is deliberately SHORTER than the way out.
 * Coming home is a thing you have done before; the ceremony is on the launch.
 */
export const IN = Object.freeze([
  { id: 'call', t: 1.3, say: 'Cobra bay has you. You are number one.' },
  { id: 'run', t: 1.6, say: null },
  { id: 'trap', t: 1.2, say: 'Down and locked.' },
  { id: 'stow', t: 1.5, say: null },
]);

const total = (ph) => ph.reduce((a, p) => a + p.t, 0);
/** Both, in seconds, derived rather than typed — a schedule that disagreed
 *  with its own total is how a bar gets to 90% and stops. */
export const OUT_SECONDS = total(OUT);
export const IN_SECONDS = total(IN);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);

/** The well, in metres, when the caller does not say. §3.2 #5's `h` is 34. */
export const WELL = 34;

/**
 * ══ ONE SORTIE, EITHER WAY ════════════════════════════════════════════════
 *
 * `way` is `'out'` or `'in'`. One class rather than two because the two
 * schedules are the same machine with a different table and a mirrored
 * `outside` — two classes would be two copies of the phase clock, and the
 * phase clock is the only part with any arithmetic in it.
 *
 * `sink` is everything this drives, handed in rather than imported:
 *
 *   canopy(k)      0 open, 1 down and sealed.
 *   lights(k)      0 the bay's working white, 1 launch amber. The bay only —
 *                  a launch is not a station-wide event, which is exactly what
 *                  distinguishes it from `Warp`'s `lights`.
 *   rams(k)        0 parked, 1 at pressure.
 *   shaft(k, m)    how much well has gone past: `k` is 0..1 through the ride
 *                  and `m` is metres, so a caller can scroll the strip lights
 *                  at a real speed instead of at a guess. `DeckLift`'s
 *                  `st.scroll` is the same number.
 *   outside(on)    THE ONE FRAME. True the instant the well's cap is behind
 *                  you and the station is what you are looking at; false again
 *                  at the top of STOW.
 *   say(line)      the launch officer, and the tower.
 *   sortie(rec)    the movement record, handed over once, so the tower's board
 *                  carries your own launch — see `FlightOps.movementsIn`.
 *   done(way)      the last call, once, whichever way it went.
 */
export class Sortie {
  constructor(way = 'out', sink = {}, opts = {}) {
    this.way = way === 'in' ? 'in' : 'out';
    this.phases = this.way === 'in' ? IN : OUT;
    this.seconds = this.way === 'in' ? IN_SECONDS : OUT_SECONDS;
    this.sink = sink;
    this.well = Number(opts.well) > 0 ? Number(opts.well) : WELL;
    /** The absolute station hour the movement is filed at, for the board. */
    this.at = Number(opts.at) || 0;
    this.craft = opts.craft || 'Aurora Starfury';
    this.call = opts.call || 'your own';
    this.i = 0;
    this.t = 0;
    this.done = false;
    this._said = -1;
    this._swapped = false;
    this._filed = false;
    this._ended = false;
  }

  /** Which phase, by id. `'done'` once it has finished. */
  get phase() { return this.done ? 'done' : this.phases[this.i].id; }

  /** How far through, 0..1 — for a bar, if anything ever wants one. */
  get progress() {
    if (this.done) return 1;
    let before = 0;
    for (let k = 0; k < this.i; k++) before += this.phases[k].t;
    return clamp01((before + this.t) / this.seconds);
  }

  /** Is the station's outside what the player is looking at, right now? */
  get outside() { return this._swapped; }

  /**
   * One frame. Returns the phase id so a caller can act on a transition
   * without keeping a second copy of the schedule.
   *
   * NOTHING HERE ALLOCATES except the one movement record, which is built once
   * and handed over once, and nothing here reads a clock: `dt` is the frame's.
   */
  step(dt) {
    if (this.done) return 'done';
    const P = this.phases[this.i];
    this.t += dt;
    if (this._said !== this.i) {
      this._said = this.i;
      if (P.say) this.sink.say?.(P.say);
    }
    const k = clamp01(this.t / P.t);
    const s = smooth(k);
    switch (P.id) {
      /* ── OUT ───────────────────────────────────────────────────────────── */
      case 'board':
        /* Nothing moves. You are getting into an aeroplane, and the one
         * second where nothing happens is what makes the rest read as fast. */
        this.sink.lights?.(0);
        break;
      case 'strap':
        this.sink.canopy?.(s);
        this.sink.rams?.(s);
        break;
      case 'clear':
        /* The bay goes to launch amber as the crew walks out of it — the
         * lighting change IS the deck being cleared, rather than a caption
         * saying it was. */
        this.sink.canopy?.(1);
        this.sink.rams?.(1);
        this.sink.lights?.(s);
        break;
      case 'drop':
        /* The catapult. The well streams past at up to twice the lift's
         * cruise, which is what a rail does that a lift does not. */
        this.sink.lights?.(1);
        this.sink.shaft?.(s, s * this.well * 0.72);
        break;
      case 'mouth':
        /**
         * ══ THE ONE FRAME, AND IT IS AT THE TOP OF MOUTH ═════════════════
         *
         * At this instant the well is at full scroll and the strip lights are
         * a blur; a shader reconfigure here is a hitch nobody can see. Doing
         * it one phase later — on the first frame of FREE, when the player is
         * looking hardest — would put it in the only frame of the sequence
         * that anybody will remember. `Warp.js` picks its frame by the same
         * argument, at the top of ARRIVE.
         */
        if (!this._swapped) {
          this._swapped = true;
          this.sink.outside?.(true);
          this._file();
        }
        this.sink.shaft?.(1, this.well * (0.72 + 0.28 * s));
        this.sink.lights?.(1 - s);
        break;
      case 'free':
        /* Control back, the canopy still down, the well behind you. The
         * player has had it the whole time — see the note in `Warp.js` about
         * why an immersion device that takes your hands is a film. */
        this.sink.shaft?.(1, this.well);
        this.sink.lights?.(0);
        break;
      /* ── IN ────────────────────────────────────────────────────────────── */
      case 'call':
        this.sink.lights?.(s);
        break;
      case 'run':
        this.sink.lights?.(1);
        this.sink.shaft?.(1 - s, this.well * (1 - s));
        break;
      case 'trap':
        this.sink.shaft?.(0, 0);
        this.sink.rams?.(1 - s);
        break;
      case 'stow':
        /* The mirror of MOUTH: the cap is shut over you and the bay is what
         * you are looking at again, on the frame the well is dark. */
        if (!this._swapped) {
          this._swapped = true;
          this.sink.outside?.(false);
        }
        this.sink.canopy?.(1 - s);
        this.sink.lights?.(1 - s);
        break;
      default: break;
    }

    if (this.t >= P.t) {
      this.t -= P.t;
      this.i++;
      if (this.i >= this.phases.length) return this._end();
    }
    return this.phases[this.i]?.id ?? 'done';
  }

  /** The movement the tower puts on its board, built once. */
  _file() {
    if (this._filed) return null;
    this._filed = true;
    const rec = {
      n: Math.round(this.at * 60), gate: 'COBRA', craft: this.craft, call: this.call,
      kind: this.way === 'out' ? 'out' : 'in', due: this.at, at: this.at, held: false, hold: 0,
      from: 'the station', mine: true,
    };
    this.sink.sortie?.(rec);
    return rec;
  }

  /**
   * PUT EVERYTHING BACK EXACTLY, whichever way it ended. A sequence that ends
   * 3% amber leaves the bay permanently the wrong colour and nothing
   * downstream would ever say so — `Warp.js` learnt this one the hard way and
   * wrote it down.
   */
  _end() {
    if (this._ended) return 'done';
    this._ended = true;
    this.done = true;
    this.i = this.phases.length - 1;
    this.sink.lights?.(0);
    this.sink.rams?.(this.way === 'out' ? 1 : 0);
    this.sink.canopy?.(this.way === 'out' ? 1 : 0);
    this.sink.shaft?.(this.way === 'out' ? 1 : 0, this.way === 'out' ? this.well : 0);
    this.sink.done?.(this.way);
    return 'done';
  }

  /** Cut it short and land it now — a save, a teardown, a disconnect. The
   *  swap still happens, because a half-launched player looking at a wall
   *  that is no longer there is worse than an abrupt one. */
  finish() {
    if (this.done) return;
    if (!this._swapped) {
      this._swapped = true;
      this.sink.outside?.(this.way === 'out');
      if (this.way === 'out') this._file();
    }
    this._end();
  }
}

/**
 * Can this player launch right now?
 *
 * The refusals are the player's own fiction rather than rules, exactly as
 * `Warp.canJump`'s two are: you cannot launch without the cert, you cannot
 * launch out of a bay that is already cycling, and you cannot launch into a
 * recovery — the well is one rail and something is on it.
 *
 * TAKES A BAG, NOT A WORLD. `FlightOps.readiness` builds the bag and this file
 * still imports nothing, which is what lets a check drive every refusal
 * without a station.
 */
export function canLaunch(state = {}) {
  if (state.flying) return { ok: false, why: 'you are already outside' };
  if (state.busy) return { ok: false, why: 'the bay is cycling' };
  if (!state.cert) return { ok: false, why: state.short || 'the cert is not signed' };
  if (state.recovering) return { ok: false, why: 'a fighter is on the rail — wait for the trap' };
  return { ok: true, why: null };
}
