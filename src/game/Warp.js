/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE JUMP — V16 Lane A1, and it is not a level load
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player's ask, in full:
 *
 * > *"if youre at a different map/planet already and you choose a different
 * > map you have to fly there before starting a game at that planet so imagine
 * > you're in the command deck somewhere ordering the pilot/captain … before
 * > starting a game you have to fly there. So maybe you give the order to the
 * > captain who then orders the pilot to fly there and there's this cool
 * > flying animation where you actually see entire station warp to that
 * > location (should take maybe 5-10 seconds and look really cool, really make
 * > it cool good) there should absolutely not be a loading screen this is just
 * > for immersion sake, anyway now obviously as you can see in the command
 * > deck's expansive windows that you are now orbiting whatever planet you
 * > choose."*
 *
 * ── WHY "ABSOLUTELY NO LOADING SCREEN" IS ACHIEVABLE AND NOT A WISH ───────
 *
 * Because **nothing is loaded.** What is outside the station is not a level:
 * it is `SkyDome.configureOrbit`'s uniforms plus `DeckBattle`'s fourteen
 * instanced draws, both of which read one record — `outsideLevel(world)` — and
 * both of which were wired in the commit that gave the station a sky. Changing
 * theatres is therefore changing WHICH RECORD, re-configuring a shader, and
 * re-dressing fourteen instanced meshes. The world is never rebuilt, the
 * player never loses control, and there is no plate because there is no load.
 *
 * That is also why this file holds no geometry and no THREE. It is a clock and
 * a state machine; the two things it drives are handed in.
 *
 * ── A SEQUENCE, NOT AN EFFECT ─────────────────────────────────────────────
 *
 * One effect is a screen wipe with better particles. A SEQUENCE reads as a
 * procedure, and a procedure reads as a ship being handled by people who do
 * this for a living — which is the whole of what the player is asking for when
 * they say *"really make it cool good"*.
 *
 *   ORDER    you give it at the plot table; a watch officer repeats it back.
 *   CALL     the klaxon, the deck lighting steps to transit amber, the crowd
 *            in the drum goes quiet. Every deck hears it, not just yours.
 *   TURN     the starfield rotates as the station comes onto its bearing.
 *   JUMP     star-lines. The fleet action outside is struck.
 *   ARRIVE   the new planet swells in, the orbit is reconfigured, the new
 *            theatre's fleet is dressed, the lighting steps back, the PA says
 *            where you are.
 *
 * ── AND THE CAMERA IS NEVER TAKEN OFF THE PLAYER ──────────────────────────
 *
 * A cutscene would contradict *"just for immersion sake"* — an immersion
 * device that removes your hands is a film. So the whole sequence plays with
 * the player in control, and the beauty shot is a PLACE: the observation dome
 * (#54) and the command deck's own windows look at the hull and the drum
 * against the star-lines. A player who wants the view walks up to it, which is
 * better than being shown it and gives #54 a job.
 */

/** The five phases, their lengths in seconds, and what each one is for. */
export const PHASES = [
  { id: 'order', t: 1.6, say: 'Helm, bring us about.' },
  { id: 'call', t: 1.4, say: 'All decks, transit stations.' },
  { id: 'turn', t: 2.2, say: 'Coming onto bearing.' },
  { id: 'jump', t: 1.5, say: 'Jumping.' },
  { id: 'arrive', t: 2.3, say: null },
];

/** Total, and it is inside the 5–10 seconds the player asked for. */
export const WARP_SECONDS = PHASES.reduce((a, p) => a + p.t, 0);

/** How far the starfield swings while the station comes onto its bearing. */
const TURN_SWING = 1.15;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * One jump, in progress.
 *
 * `sink` is everything this drives, handed in rather than imported, so the
 * whole sequence is testable with no world at all:
 *
 *   orbit(level)     re-configure the shader window. Called once, at the top
 *                    of ARRIVE — the moment the old sky is gone and the new
 *                    one has not yet been seen.
 *   fleet(on, level) strike the fleet action, and dress the new one.
 *   lights(k)        0 is normal, 1 is full transit amber. Every deck.
 *   stars(k, swing)  0 is still, 1 is full star-lines; `swing` is the bearing
 *                    turn in radians.
 *   say(line)        the PA, and the watch officer's repeat-back.
 *   quiet(k)         how far the drum's crowd is ducked, 0..1.
 *   arrived(level)   the world's own `_pickedLevel` is now this.
 */
export class Warp {
  constructor(to, sink = {}) {
    /** The level record we are going to. */
    this.to = to;
    this.sink = sink;
    this.i = 0;
    this.t = 0;
    this.done = false;
    this._said = -1;
    this._orbited = false;
  }

  /** Which phase, by id. `'done'` once it has landed. */
  get phase() { return this.done ? 'done' : PHASES[this.i].id; }

  /** How far through the whole jump, 0..1 — for a HUD bar if anything wants one. */
  get progress() {
    if (this.done) return 1;
    let before = 0;
    for (let k = 0; k < this.i; k++) before += PHASES[k].t;
    return clamp01((before + this.t) / WARP_SECONDS);
  }

  /**
   * One frame. Returns the phase id, so a caller can act on a transition
   * without keeping its own copy of the schedule.
   *
   * NOTHING HERE ALLOCATES and nothing here reads a clock: `dt` is the frame's
   * and the sequence is a pure function of how much time has been handed to
   * it, which is what makes it drivable at 6 ms a step in a check.
   */
  step(dt) {
    if (this.done) return 'done';
    const P = PHASES[this.i];
    this.t += dt;

    /* The line for this phase, said once on entry. */
    if (this._said !== this.i) {
      this._said = this.i;
      if (P.say) this.sink.say?.(P.say);
    }

    const k = clamp01(this.t / P.t);
    switch (P.id) {
      case 'order':
        break;
      case 'call':
        /* The lights and the crowd move together: a station going to transit
         * stations is a station that has stopped talking. */
        this.sink.lights?.(smooth(k));
        this.sink.quiet?.(smooth(k));
        break;
      case 'turn':
        this.sink.lights?.(1);
        this.sink.quiet?.(1);
        this.sink.stars?.(0, smooth(k) * TURN_SWING);
        break;
      case 'jump':
        /* THE OLD FLEET IS STRUCK BEFORE THE STAR-LINES, not after: ships you
         * are leaving behind should not still be firing while the station is
         * already in the jump. */
        if (k > 0.02) this.sink.fleet?.(false, null);
        this.sink.stars?.(smooth(k), TURN_SWING);
        break;
      case 'arrive':
        /**
         * THE ONE FRAME THE NEW SKY IS BUILT ON, and it is at the TOP of
         * arrive rather than at the end of jump. At the end of jump the
         * star-lines are at full and the player can see nothing, which is
         * exactly when a shader should be reconfigured and fourteen instanced
         * meshes should be rebuilt: the one moment in the sequence where a
         * hitch is invisible. Doing it on the first frame the lines come down
         * would put it in the frame the player is looking hardest at.
         */
        if (!this._orbited) {
          this._orbited = true;
          this.sink.orbit?.(this.to);
          this.sink.fleet?.(true, this.to);
          this.sink.arrived?.(this.to);
          this.sink.say?.(`Now orbiting ${this.to?.name || 'station keeping'}.`);
        }
        this.sink.stars?.(1 - smooth(k), TURN_SWING * (1 - smooth(k)));
        this.sink.lights?.(1 - smooth(k));
        this.sink.quiet?.(1 - smooth(k));
        break;
      default: break;
    }

    if (this.t >= P.t) {
      this.t -= P.t;
      this.i++;
      if (this.i >= PHASES.length) {
        this.done = true;
        /* PUT EVERYTHING BACK EXACTLY. A sequence that ends 3% amber leaves
         * the station permanently the wrong colour, and nothing downstream
         * would ever say so. */
        this.sink.lights?.(0);
        this.sink.quiet?.(0);
        this.sink.stars?.(0, 0);
        return 'done';
      }
    }
    return PHASES[this.i]?.id ?? 'done';
  }

  /** Cut it short and land immediately — a save, a disconnect, a teardown. */
  finish() {
    if (this.done) return;
    if (!this._orbited) {
      this._orbited = true;
      this.sink.orbit?.(this.to);
      this.sink.fleet?.(true, this.to);
      this.sink.arrived?.(this.to);
    }
    this.done = true;
    this.sink.lights?.(0);
    this.sink.quiet?.(0);
    this.sink.stars?.(0, 0);
  }
}

/**
 * Can the station jump to this theatre right now?
 *
 * Two refusals and both are the player's own fiction rather than a rule:
 * you cannot order a jump to where you already are, and you cannot order one
 * while one is running.
 */
export function canJump(world, to) {
  if (!to) return { ok: false, why: 'no theatre chosen' };
  if (world?._warp && !world._warp.done) return { ok: false, why: 'already under way' };
  const now = world?._pickedLevel || null;
  if (now && to === now) return { ok: false, why: `already orbiting ${to.name || 'it'}` };
  return { ok: true, why: null };
}
