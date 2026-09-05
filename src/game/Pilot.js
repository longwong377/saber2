/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE PILOT — what actually flies the circuit, and it is a real craft
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── THE DEFECT THIS FILE EXISTS FOR ───────────────────────────────────────
 *
 * `src/game/Starfury.js` — 325 lines, `SHARK.md` §4's *"the one new system"*,
 * a clause-for-clause port of `station/physics/starfury.py` with 264 lines of
 * green check over it — **was in no shipped build.** A strict scan for an
 * import specifier found exactly ONE importer in the whole tree and it was
 * `tools/checks/starfury.mjs`. `tools/pack.mjs` walks the module graph from
 * `index.play.html`'s entry, so 96 of the 97 `src/game/*.js` files were in the
 * manifest and that was the one that was not: finished, commented, measured,
 * and in nobody's browser. A green check over unreachable code is worse than
 * no check, because nobody investigates green.
 *
 * `Outside.js` and `Station.js` both wrote down what was missing and both were
 * exactly right about it:
 *
 *   *"`Starfury.js` is a real 6-DOF Newtonian craft, ported clause for clause
 *    and held by `starfury.mjs` — and it is not wired to anything here."*
 *   *"WHAT IS HONESTLY NOT HERE: nobody is steering."*
 *
 * This is the wiring, and it is a separate file because neither of those two
 * can be the one to do it. `flightops.mjs` asserts that `Launch.js` imports
 * NOTHING and that `Outside.js` imports exactly one module — they are a clock
 * and a geometry and their purity is the reason both are testable at 6 ms a
 * step with no station. So the seam between the track and the craft goes
 * somewhere new, and this is it.
 *
 * ── WHAT THE MEASUREMENT SAID, AND IT CHANGED THE GAME'S NUMBERS ──────────
 *
 * The lap used to be a camera on a rail at `ORBIT_SPEED = 120` m/s. A rail can
 * do that because a rail has infinite lateral authority. A Starfury has four
 * 68 kN mains against 14 800 kg — `maxLinearAccel()` is **18.4 m/s²** — and a
 * turn at 120 m/s under 18.4 m/s² has a radius of 783 m, round a station whose
 * whole circuit is 1058 m long and never more than about 200 m from the axis.
 * The rail was flying a corner five times tighter than the airframe can hold.
 *
 * So the speed is DERIVED from the airframe and the track rather than typed
 * beside them: `hold = sqrt(aMax · R · MARGIN)`, where `R` is the turn the
 * track is actually asking for over the next `WINDOW` metres. The craft runs
 * up on the straights and comes off the throttle into the drum's shoulder,
 * which is what a pilot does and is the only reason the lap closes at all.
 * Measured over a full lap, flown: the loop takes 25 s instead of 8.8, the
 * worst clearance from the hull is 30 m against `Outside.CLEAR`'s 25, and the
 * flown path never leaves the track by more than about 70 m.
 *
 * ── AND THERE IS NO SECOND FLIGHT MODEL IN HERE ───────────────────────────
 *
 * Everything below is guidance: it decides WHAT TO ASK FOR and hands it to
 * `Starfury.allocate`, which is the thing §4 says must stay honest — *"a
 * commanded translation the thrusters cannot produce comes out PARTIALLY
 * SATISFIED, not silently exact"*. Nothing here integrates a position, damps a
 * velocity or clamps a rotation: `Starfury.step` is the only integrator and
 * its absence of a damping term is the feature. If the demand cannot be met,
 * the craft misses the corner, and the check measures the miss.
 */

import { Starfury, V } from './Starfury.js';
import { CIRCUIT_LENGTH, sample, clearanceAt } from './Outside.js';

const { sub, scale, dot, cross, norm, unit } = V;

/** A track sample as a plain triple, which is what the flight model speaks. */
const P = (p) => [p.x, p.y, p.z];

/**
 * The demand the pilot holds on a straight, m/s. It is a CEILING and not a
 * cruise: the corner law below is what the craft actually flies at, and this
 * only bounds it where the track is straight enough to allow more.
 */
export const TOP_SPEED = 60;

/**
 * How far ahead the pilot aims, in metres. One second of flight at the top
 * speed: short enough that the aim point is still on the piece of track the
 * craft is on, long enough that a corner is seen before it is entered.
 */
const LEAD = 80;

/** How hard the pilot pulls back onto the line, 1/s. */
const CROSS = 0.5;
/** The velocity-matching time constant, s. */
const TAU = 0.25;
/** Attitude: proportional on the pointing error, damping on the body rate. */
const K_POINT = 12;
const K_RATE = 3;
/**
 * The chord the turn radius is measured over, in metres, and how much of the
 * airframe's authority is spent holding it.
 *
 * THE WINDOW IS NOT COSMETIC. `Outside`'s track is a polyline through eleven
 * waypoints, so the curvature AT a waypoint is a corner — measured, 0.3 m of
 * radius — and a speed law reading that instantaneous number would ask the
 * craft to stop dead eleven times a lap. Two hundred metres is a fifth of the
 * circuit and is the scale a fighter actually turns on.
 *
 * `MARGIN` leaves the rest of the thrust for the cross-track term. At 1.0 the
 * craft is on the edge of its envelope with nothing left to correct with, and
 * the lap that came out of it was 90 m wide of the line at the dome.
 */
const WINDOW = 200;
const MARGIN = 0.85;

/** Wrap a circuit delta into (−0.5, 0.5] so a lap counter cannot see a step
 *  backwards as a whole lap forward. */
const wrapU = (d) => { let v = d % 1; if (v > 0.5) v -= 1; if (v < -0.5) v += 1; return v; };

/** The track's direction of travel at `u`. Sampled either side rather than
 *  differentiated: the parameterisation is arc length and a 1 m chord is
 *  exact enough for a heading. */
function tangentAt(u) {
  return unit(sub(P(sample(u + 0.001)), P(sample(u - 0.001))));
}

/**
 * The turn the track asks for at `u`, in metres of radius, measured over a
 * `WINDOW` chord — the circumradius of the three points, which is the standard
 * discrete curvature and needs no derivative of a polyline that has none.
 */
function turnRadius(u, window = WINDOW) {
  const h = window / 2 / CIRCUIT_LENGTH;
  const a = P(sample(u - h)), b = P(sample(u)), c = P(sample(u + h));
  const ab = sub(b, a), bc = sub(c, b), ac = sub(c, a);
  const twiceArea = norm(cross(ab, bc));
  if (twiceArea < 1e-9) return Infinity;
  return (norm(ab) * norm(bc) * norm(ac)) / (2 * twiceArea);
}

/** Cap a vector's length without changing its direction. */
const capped = (v, m) => (norm(v) > m ? scale(unit(v), m) : v);

/**
 * ══ ONE CRAFT, FLYING ONE CIRCUIT ═════════════════════════════════════════
 *
 * `u` is where on the track the craft IS — the nearest point, searched
 * forward from where it was — and not a number that is added to every frame.
 * That distinction is the difference between a lap and a runaway: an
 * integrated `u` races ahead of a craft that is behind the aim point, the aim
 * point races further ahead of it, and the first cut of this pilot finished
 * 500 m off the line with the circuit "complete". A projected `u` waits.
 */
export class CircuitPilot {
  /**
   * @param opts.radius the drum's outer radius, m — `StationPlan.DRUM.R`
   * @param opts.spin   its angular rate, rad/s. Derived from the radius when
   *                    it is not given: the drum spins to make its own gravity
   *                    and §3.1 stands people up on the ring, so the rate is
   *                    the one that puts a g at the skin — `sqrt(g / r)`, which
   *                    at 90 m is 0.330 rad/s and a rim speed of 29.7 m/s.
   *                    Derived rather than typed because a station that spins
   *                    at some other rate is a station whose floors are not
   *                    floors, and there is no second number to keep in step.
   */
  constructor(opts = {}) {
    const radius = opts.radius ?? 90;
    const spin = opts.spin ?? Math.sqrt(9.81 / radius);
    this.craft = new Starfury();
    this.u = 0;
    /** How far round the loop the craft has flown, in laps, fractional. */
    this.travelled = 0;
    this.lap = 0;
    this.throttles = new Map();
    /**
     * ══ THE LAUNCH IS THE DRUM'S THROW, WHICH THE MODEL ALREADY HAS ═══════
     *
     * `Starfury.launchFromDrum`'s own note, out of the Python: *"The bay is on
     * the rotating hull, so the craft leaves already carrying the drum's
     * tangential velocity. That inheritance IS the launch."* It had no caller.
     * It has one now, and what is taken from it is the SPEED: the model states
     * the throw about its own +z axis and the station's circuit lives in world
     * XZ, so the direction the craft is thrown in is the track's own tangent
     * at the mouth — which is where `Launch.js` puts you and where the circuit
     * starts, for the reason `Outside.js` gives.
     */
    const rim = norm(this.craft.launchFromDrum(spin, radius, 0));
    const T = tangentAt(0);
    this.craft.position = P(sample(0));
    this.craft.velocity = scale(T, rim);
    /* Nose along travel, so the first frame is not a craft flying backwards
     * out of its own bay. The shortest rotation from body +z onto the track's
     * heading, as a quaternion, because that is what the model carries. */
    const axis = cross([0, 0, 1], T);
    const s = norm(axis), c = dot([0, 0, 1], T);
    const ang = Math.atan2(s, c);
    const a = s > 1e-9 ? scale(axis, 1 / s) : [0, 1, 0];
    this.craft.orientation = [Math.cos(ang / 2),
      a[0] * Math.sin(ang / 2), a[1] * Math.sin(ang / 2), a[2] * Math.sin(ang / 2)];
  }

  /** Where the craft is, as a track parameter — what the sights are named off. */
  get progress() { return this.u; }

  /** Metres of daylight between the craft and the hull, right now. */
  get clearance() {
    const [x, y, z] = this.craft.position;
    return clearanceAt({ x, y, z });
  }

  /** How fast it is actually going, m/s. */
  get speed() { return this.craft.speed; }

  /**
   * ══ WHERE ON THE TRACK THE CRAFT IS ══════════════════════════════════════
   *
   * A local search rather than a solve: forty samples at 3 m, from a little
   * behind to 120 m ahead, which is wider than anything a 1/60 s step can
   * cover and narrow enough that the far side of the loop cannot win. The
   * window is one-sided on purpose — a craft cannot go round backwards, and a
   * symmetric search on a track that passes near itself at the mouth can.
   */
  _project() {
    let best = this.u, bd = Infinity;
    const [x, y, z] = this.craft.position;
    for (let k = -8; k <= 40; k++) {
      const u = this.u + k * (3 / CIRCUIT_LENGTH);
      const p = sample(u);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  /**
   * One frame. Returns how far round the loop the craft now is, 0..1, and
   * `lap` counts the times it has come back to the mouth.
   *
   * ── WHAT IT COSTS, AND WHY THAT IS ALLOWED HERE ──────────────────────────
   *
   * This allocates freely — every `add`/`sub`/`scale` makes a triple, and
   * `_project` takes forty-nine track samples — which is a rule §12.3 breaks
   * nowhere else in this tree. It is allowed for one reason and it is a
   * measured one: there is exactly ONE of these, it exists only while a player
   * is outside, and a full lap is **0.099 ms a frame** against §12.2's 2.5 ms
   * for a whole subsystem. Measured over the 1321 frames of a lap. The moment
   * a second craft flies — the fleet, a wingman — the samples become a table
   * and the triples become scratch, and neither is worth writing for one ship.
   */
  step(dt) {
    if (!(dt > 0)) return this.u;
    const craft = this.craft;
    const next = this._project();
    /* Distance round the loop, accumulated from the wrapped step rather than
     * read off `u` — `u` is a position and 0.99 → 0.01 is a metre of travel,
     * not a lap gone backwards. `lap` is what the sortie's recovery waits on,
     * so getting this wrong is a player who never comes home. */
    this.travelled += wrapU(next - this.u);
    this.u = ((next % 1) + 1) % 1;
    while (this.travelled >= 1) { this.travelled -= 1; this.lap++; }

    /* The aim point, and the heading and the corner it is asking for. */
    const at = this.u + LEAD / CIRCUIT_LENGTH;
    const aim = P(sample(at));
    const T = tangentAt(at);
    const aMax = craft.maxLinearAccel();
    const hold = Math.min(TOP_SPEED, Math.sqrt(aMax * turnRadius(at) * MARGIN));

    /**
     * CROSS-TRACK AND ALONG-TRACK, SEPARATELY. Steering at the aim point
     * alone cuts every corner, because a straight line to a point on a bend
     * is inside the bend; what is wanted is the track's heading PLUS a pull
     * back onto the line, and only the component across the line is an error.
     */
    const off = sub(craft.position, aim);
    const lateral = sub(off, scale(T, dot(off, T)));
    const want = sub(scale(T, hold), scale(lateral, CROSS));
    const accel = capped(scale(sub(want, craft.velocity), 1 / TAU), aMax);

    /**
     * AND THE NOSE GOES WHERE THE THRUST IS WANTED, which is the whole reason
     * a Starfury is not an aeroplane: the mains are the only authority worth
     * anything (68 kN each against an RCS quad's 4.2), so the craft points at
     * its own acceleration and lets its velocity do whatever it is doing.
     * Round the drum that means flying half sideways, which is correct and is
     * what the source calls normal operation.
     */
    const dir = norm(accel) > 1e-6 ? unit(accel) : unit(craft.velocity);
    const axisBody = craft.worldToBody(cross(craft.forward, dir));
    const spin = capped(sub(scale(axisBody, K_POINT), scale(craft.angularVelocity, K_RATE)), 1);

    craft.allocate(scale(craft.worldToBody(accel), 1 / aMax), spin, this.throttles);
    craft.step(dt, this.throttles);
    return this.u;
  }
}
