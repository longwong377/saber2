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
 * ══ THE ONE PLACE A DEMAND IS HANDED TO THE AIRFRAME ══════════════════════
 *
 * ── THE DEFECT, AND IT IS THE ONE THAT STOPPED THE LAP CLOSING ────────────
 *
 * `Starfury.allocate` opens each thruster at `lin + rot` — how well it serves
 * the commanded translation plus how well it serves the commanded rotation,
 * clamped into 0..1 — and it is right to. But the four MAINS are the only
 * thrusters on this airframe with any pitch or yaw authority at all (the
 * lateral and vertical nozzles fire through the centre of mass and make no
 * torque), and a main's `lin` against an AFT demand is −1. Measured:
 *
 *     allocate([0, 0, −1], [0, −1, 0])  →  retro 1.00, mains 0.00 × 4
 *
 * Full stick, and every nozzle that could have answered it is held shut by the
 * throttle hand. **A pilot asking to slow down has no attitude control at all
 * for as long as they ask**, and the craft that most needs to turn round — one
 * that has run off the line, whose whole demand is astern — is the one that
 * can never do it. That is finding (3): held throttle, then a stick that could
 * not bring it back; 53 km out at two and a half minutes with `u` frozen at
 * 0.21, ending at `SORTIE_CEILING` every time.
 *
 * ── AND THE FIX IS NOT A SECOND FLIGHT MODEL ──────────────────────────────
 *
 * There is exactly ONE thruster on the ship that answers an aft demand — the
 * retro, `rcs_retro`, 8.4 kN — and nothing competes with it: its own torque is
 * zero (it is on the centreline), so `rot` never opens it and no other nozzle
 * points that way. So the aft component is taken OUT of the vector handed to
 * the allocator and put straight onto that one nozzle. Every other thruster
 * allocates exactly as it did; the sum, the partial satisfaction and the
 * clamp are untouched. What changes is only that asking for the retro no
 * longer commands the mains SHUT.
 *
 * The airframe is still honest about what it can do: there is no reverse
 * engine, holding the aft key gets you 0.57 m/s² and the way to actually stop
 * is still to turn round and light the mains — which is now a manoeuvre the
 * pilot can fly, because the stick still works while they are doing it.
 */
function command(craft, translate, rotate, throttles) {
  const aft = Math.max(0, Math.min(1, -translate[2]));
  craft.allocate([translate[0], translate[1], Math.max(0, translate[2])], rotate, throttles);
  if (aft > 0) throttles.set('rcs_retro', Math.max(throttles.get('rcs_retro') || 0, aft));
  return throttles;
}

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

  /** Where the craft is on the track — see `projectOnto`, which both pilots
   *  share so neither can disagree about which lap it is on. */

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
    /* Distance round the loop, accumulated from the wrapped step rather than
     * read off `u` — `u` is a position and 0.99 → 0.01 is a metre of travel,
     * not a lap gone backwards. `lap` is what the sortie's recovery waits on,
     * so getting this wrong is a player who never comes home. `advanceOn` is
     * the one copy of that, and of the re-acquisition under it. */
    advanceOn(this, craft.position);

    guideRound(craft, this.u, dt, this.throttles);
    return this.u;
  }
}

/**
 * ══ WHERE ON THE TRACK A POINT IS ═════════════════════════════════════════
 *
 * A local search rather than a solve: forty samples at 3 m, from a little
 * behind to 120 m ahead, which is wider than anything a 1/60 s step can cover
 * and narrow enough that the far side of the loop cannot win. The window is
 * one-sided on purpose — a craft cannot go round backwards, and a symmetric
 * search on a track that passes near itself at the mouth can.
 *
 * A FUNCTION AND NOT A METHOD, because two pilots ask it now: `CircuitPilot`
 * and the seat below. Two copies of a search that has this many opinions in it
 * is how the two would come to disagree about which lap they were on.
 */
export function projectOnto(position, from) {
  return scan(position, from, -8, 40, 3).u;
}

/**
 * ══ AND A CRAFT THAT IS NOWHERE NEAR THE LINE FINDS IT AGAIN ══════════════
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 *
 * The window above is 120 m ahead and 24 m behind, which is exactly right for
 * a craft ON the track and is a TRAP for one that is not. An autopilot is
 * never off the line, so nothing found this until a player was: fly straight
 * out for ten seconds and the nearest point of the circuit is half a lap from
 * where the window is looking, so `u` freezes — measured, at 0.21 — and it
 * freezes for good. Every sight is named off `u`, the lap counter is fed off
 * `u`, and the recovery waits on the lap. A player who left the line could not
 * finish the sortie by flying, only by pressing the drive key or waiting out
 * the four-minute ceiling.
 *
 * So when the local window's answer is more than `OFF_TRACK` away, the whole
 * circuit is searched — coarse, then refined — and the craft is re-acquired
 * wherever it actually is. It costs 133 samples on the frames a ship is lost
 * and nothing at all on the frames it is not.
 *
 * `LAP` FRAUD IS THE THING THIS MUST NOT INTRODUCE, and `advanceOn` is where
 * that is answered: a re-acquisition credits NO distance travelled. You are
 * given back your place on the track; you are not given the piece of it you
 * flew round the outside of.
 */
export const OFF_TRACK = 150;

/** One sweep of the track: `n0`..`n1` steps of `step` metres from `from`. */
function scan(position, from, n0, n1, step) {
  let best = from, bd = Infinity;
  const [x, y, z] = position;
  for (let k = n0; k <= n1; k++) {
    const u = from + k * (step / CIRCUIT_LENGTH);
    const p = sample(u);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; best = u; }
  }
  return { u: best, d: Math.sqrt(bd) };
}

/** The nearest point of the WHOLE circuit, coarse then fine. */
export function reacquire(position) {
  const coarse = scan(position, 0, 0, 131, CIRCUIT_LENGTH / 132);
  return scan(position, coarse.u, -5, 5, CIRCUIT_LENGTH / 132 / 5);
}

/**
 * Where the craft has got to, and how much of the loop that is worth. Shared
 * by both pilots for `projectOnto`'s own reason: two copies of a search with
 * this many opinions in it is how the two come to disagree about which lap
 * they are on.
 *
 * `state` is `{ u, travelled, lap }` — a `CircuitPilot` or a `PlayerPilot`.
 */
function advanceOn(state, position) {
  const local = scan(position, state.u, -8, 40, 3);
  let next = local.u, credit = true;
  if (local.d > OFF_TRACK) {
    const far = reacquire(position);
    /* Only if it is genuinely a better answer — a metre of slack so a craft
     * hovering at the threshold does not flicker between the two. */
    if (far.d < local.d - 1) { next = far.u; credit = false; }
  }
  if (credit) state.travelled += wrapU(next - state.u);
  state.u = ((next % 1) + 1) % 1;
  while (state.travelled >= 1) { state.travelled -= 1; state.lap++; }
  return state.u;
}

/**
 * ══ ONE FRAME OF GUIDANCE, AND IT IS THE ONLY COPY OF IT ══════════════════
 *
 * Everything `CircuitPilot` knows about flying round this station, as a
 * function of a craft and a place on the track. `PlayerPilot.autoStep` uses it
 * too — a sortie whose seat is getting no frames still has to come home, and
 * an autopilot written twice is two ships that fly differently depending on
 * who is not flying them.
 *
 * It decides WHAT TO ASK FOR and hands it to `Starfury.allocate`; nothing here
 * integrates a position, damps a velocity or clamps a rotation.
 */
export function guideRound(craft, u, dt, throttles) {
  /* The aim point, and the heading and the corner it is asking for. */
  const at = u + LEAD / CIRCUIT_LENGTH;
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
  /**
   * AND THE PULL BACK ONTO THE LINE IS WHAT THE SHIP CAN STOP FROM.
   *
   * `CROSS · lateral` is a spring, and a spring has no idea how far away it
   * is: measured from 8 km off the track it asked for **4 000 m/s** of closing
   * speed, the craft did what it was told, arrived at 500 m/s, could not stop,
   * and flew out the other side — a phugoid that was still swinging at the
   * ceiling. It never showed on the circuit because a craft ON the line is
   * never more than about 70 m off it and the spring is the smaller of the two
   * terms there (35 m/s against 47), so this changes NOTHING about the flown
   * lap: 21.9 s and 29.9 m of worst clearance, before and after.
   *
   * Past 125 m the braking law takes over — `sqrt(2 · aMax · d · MARGIN)` is
   * the speed a ship with `aMax` can still shed in `d` metres — and a craft
   * that has run right off the circuit closes on it as fast as it can stop,
   * which is the difference between coming home and swinging past.
   */
  const d = norm(lateral);
  const pull = Math.min(CROSS * d, Math.sqrt(2 * aMax * d * MARGIN));
  const want = sub(scale(T, hold), d > 1e-6 ? scale(lateral, pull / d) : lateral);
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
  /**
   * ══ AND THE TURN HAS A SINGULARITY AT A HUNDRED AND EIGHTY DEGREES ══════
   *
   * `cross(nose, dir)` is the axis that swings the nose onto the burn, and it
   * is ZERO both when the craft already points at it AND when it points
   * EXACTLY AWAY from it — which is not a corner case out here, it is the
   * commonest attitude there is: a craft that has run off the line is flying
   * straight down its own nose and everything it needs to do is behind it.
   *
   * MEASURED, with `command` below already in place: a craft 2 km off the
   * track at 281 m/s, demanding an acceleration dead astern, computed an axis
   * of nought, never rolled a degree, and coasted — 53 KILOMETRES out at the
   * two-and-a-half-minute mark with the track parameter frozen at `u = 0.21`
   * the whole way. It could only ever end at `SORTIE_CEILING`.
   * `PlayerPilot.update`'s kill-velocity brake already carried this exact rule
   * and this law did not, so the one manoeuvre that gets a lost ship home was
   * the one manoeuvre neither pilot could fly.
   *
   * Started over the top, pitch rather than yaw, for no reason but that a
   * pilot pulls — the same choice, and the same three lines, as the brake.
   */
  let axisBody = craft.worldToBody(cross(craft.forward, dir));
  if (norm(axisBody) < 1e-3 && dot(craft.forward, dir) < 0) axisBody = [1, 0, 0];
  const spin = capped(sub(scale(axisBody, K_POINT), scale(craft.angularVelocity, K_RATE)), 1);

  command(craft, scale(craft.worldToBody(accel), 1 / aMax), spin, throttles);
  craft.step(dt, throttles);
  return craft;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  AND THE ONE WITH HANDS ON IT
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE DEFECT THIS CLASS EXISTS FOR ══════════════════════════════════════
 *
 * `SHARK.md` §4's ask is one sentence and every clause of it is a verb:
 *
 *   *"board and launch … six axes, kill-rotation, kill-velocity, chase and
 *    cockpit cameras … fly past your own hangar and look in … land."*
 *
 * What shipped above this line is `CircuitPilot` — AN AUTOPILOT. Driven
 * headless through a whole sortie, the player's BODY MOVED 0.703 m and stayed
 * standing in the launch well for the full thirty-six seconds. No seat, no
 * change of camera, no axis of control, no throttle. Four banner lines and a
 * re-configured sky dome. The flight model underneath was honest and the lap
 * was real; the half the note calls the loop was not there at all.
 *
 * So: the player boards, sits, and flies it.
 *
 * ── WHAT IS ON WHICH HAND, AND WHY NONE OF IT IS A NEW BINDING ────────────
 *
 * `Bindings.ACTIONS` is the player's own rebindable table and every row in it
 * is printed on the pause card and in the Codex. A cockpit that invented six
 * more rows would be six keys nobody has been told about — `Player._refuse`'s
 * whole note is about exactly that failure — so this is built out of the keys
 * a body ALREADY has, read through the seam `Driving.js` opened:
 *
 *   THE MOUSE IS THE STICK.      pitch on dy, yaw on dx. `Player._readInput`'s
 *                                driving branch hands the mouse to the camera,
 *                                and the camera is bolted to the airframe here,
 *                                so what the mouse actually moves is the ship.
 *   `moveF`/`moveB`  THROTTLE    fore and aft along the nose, on the mains.
 *   `moveL`/`moveR`  SWAY        the lateral RCS quad. Not a turn — a Starfury
 *                                translates sideways and its nose does not care.
 *   `jump`/`crouch`  HEAVE       the vertical quad, up and down.
 *   `rollL`/`rollR`  ROLL        Q and E, whose own label is "roll wrist left /
 *                                right". A ship rolls about its nose the same
 *                                way a wrist does, and it is the one axis a
 *                                mouse cannot carry.
 *   `blade`          KILL ROTATION   held. The attitude brake, under the hand
 *                                    that is already on the stick.
 *   `sprint`         KILL VELOCITY   held. The retro burn: everything the
 *                                    airframe has, against the way it is going.
 *   `view`           CHASE / COCKPIT  `Player._readInput` already toggles
 *                                    `camera.firstPerson` on this key inside
 *                                    the driving branch. Nothing new; the rig
 *                                    is simply pointed at the airframe.
 *   `drive`          THE TRAP     the same key that got you in. `takeControls`
 *                                 calls `leave` and `leave` calls the bay.
 *
 * That is six axes, both brakes, both cameras and a way out, and not one row
 * of `Bindings.js` changed.
 *
 * ── AND THERE IS STILL ONLY ONE FLIGHT MODEL ──────────────────────────────
 *
 * Everything below decides WHAT TO ASK FOR and hands it to `Starfury.allocate`
 * exactly as `CircuitPilot` does. Nothing here integrates, damps or clamps a
 * velocity: a stick held over is a demand, and a demand the four mains and the
 * five RCS nozzles cannot meet comes out partially satisfied. THE STICK IS A
 * TORQUE AND NOT A HEADING — let go of it and the ship keeps turning, which is
 * why kill-rotation is a control and not a nicety.
 *
 * The two brakes are composed into the SAME allocation as the stick rather
 * than allocated separately and merged, because the allocator sums a
 * translation term and a rotation term per thruster: two `allocate` calls
 * merged afterwards is a different ship. That is what
 * `Starfury.killRotationDemand` and `killVelocityDemand` are for.
 */

/** How much of the airframe's authority one unit of stick asks for. All in
 *  0..1 of full deflection, which is the currency `allocate` speaks. */
export const STICK = Object.freeze({
  /** Radians of demand per pixel of mouse. A 50 px flick is half authority. */
  mouse: 0.01,
  /** Q/E, full deflection. Roll is the cheapest axis on this airframe — the
   *  mains are outboard on the booms — so it is not given all of it. */
  roll: 0.6,
  /** The lateral and vertical quads are 4.2 kN against the mains' 68, so a
   *  full sideways demand is honest about being small: `allocate` opens the
   *  quad all the way and the craft still barely moves, which is the point. */
  sway: 1,
  heave: 1,
  throttle: 1,
});

/** How near the mouth, and how slow, a trap is. Metres and m/s. */
export const TRAP = Object.freeze({ r: 120, v: 90 });

/**
 * ══ THE AIRFRAME TAKES THE BLOWS, AND IT CAN LOSE ═════════════════════════
 *
 * `Player.damage`'s driving branch is one line and its note is the argument:
 * *"a man inside a tank is not shot at — the tank is"*. It reached for
 * `this.driving.vehicle`, which is `Driving.Crew`'s field and is the hull it
 * displaced a crew out of. A Starfury has no `Enemy` behind it — the seat IS
 * the machine — so that line threw on every blow that reached a seated pilot
 * and took the frame with it. Measured: one 20-point blast, seated, and
 * `Player.update` never returned.
 *
 * Fixing the throw alone would have made a pilot IMMORTAL, which was the
 * second half of the same finding: `Player.die` has exactly one production
 * caller and it is below that branch, so `landPlayer`'s dead-pilot path — the
 * whole of the recovery a killed pilot gets — was reachable only by a check
 * calling `die()` by hand. So the airframe is a hull with a number on it: it
 * takes what the pilot would have taken, and when it is finished the pilot
 * does not walk away from it, because there is no ground out there to be put
 * down on.
 *
 * `hull` is the airframe's own number and not a share of the player's health,
 * for `Driving.DRIVE.wreck`'s reason in reverse: a fighter is not a bigger
 * man. A body is 100 and this is three of them — enough that a hit is a
 * problem and not a death, few enough that the gauge means something.
 */
export const AIRFRAME = Object.freeze({ hull: 300 });

/**
 * A seat in a Starfury.
 *
 * Held on the player as `player.driving`, which is `Driving.Crew`'s contract
 * and the whole reason no line of `Player.js` changes: `update` returns true
 * and owns the frame, `leave` is the way out, `Player.die` and
 * `Player.dispose` both call `leave` already, and `_readInput` has hidden the
 * blade, the Force and the walk behind the same field since driving landed.
 */
export class PlayerPilot {
  /**
   * @param opts.radius  the drum's outer radius, m
   * @param opts.spin    its rate, rad/s — derived from the radius when absent
   * @param opts.onLeave (pilot, why) — the bay, told the seat is empty
   * @param opts.say     (title, line) — the launch officer
   */
  constructor(player, opts = {}) {
    this.player = player;
    this.world = player?.world || null;
    this.onLeave = opts.onLeave || null;
    this.say = opts.say || null;

    const radius = opts.radius ?? 90;
    const spin = opts.spin ?? Math.sqrt(9.81 / radius);
    this.craft = new Starfury();
    this.u = 0;
    /** Where it was on the last frame, so the station can name a sight as it
     *  goes past rather than every frame it is near one. */
    this.lastU = 0;
    this.travelled = 0;
    this.lap = 0;
    /** Was the seat driven on this frame? See `autoStep`. */
    this.tick = false;
    /** Seconds at the stick — the ceiling the bay recovers you at. */
    this.t = 0;
    this.throttles = new Map();
    /** What the stick asked for last frame, for anything that wants to show
     *  it. Read by the probe and by `starfury.mjs`. */
    this.stick = { pitch: 0, yaw: 0, roll: 0, sway: 0, heave: 0, throttle: 0 };
    this.killingRotation = false;
    this.killingVelocity = false;
    this.left = false;
    /** What the airframe has left, and what it started with. See `damage`. */
    this.maxHull = AIRFRAME.hull;
    this.hull = AIRFRAME.hull;

    /* THE LAUNCH IS THE DRUM'S THROW — `CircuitPilot`'s own arrangement, and
     * the same three lines, because a player and an autopilot leave the same
     * bay on the same rail at the same rim speed. */
    const rim = norm(this.craft.launchFromDrum(spin, radius, 0));
    const T = tangentAt(0);
    this.craft.position = P(sample(0));
    this.craft.velocity = scale(T, rim);
    const axis = cross([0, 0, 1], T);
    const s = norm(axis), c = dot([0, 0, 1], T);
    const ang = Math.atan2(s, c);
    const a = s > 1e-9 ? scale(axis, 1 / s) : [0, 1, 0];
    this.craft.orientation = [Math.cos(ang / 2),
      a[0] * Math.sin(ang / 2), a[1] * Math.sin(ang / 2), a[2] * Math.sin(ang / 2)];

    this._board();
  }

  get progress() { return this.u; }

  get speed() { return this.craft.speed; }

  /** What the pilot is sitting in, for anything that names the machine —
   *  `HUD._drivePrompt` reads it where a tank's is `vehicle.A.label`. */
  get label() { return 'Aurora Starfury'; }

  get clearance() {
    const [x, y, z] = this.craft.position;
    return clearanceAt({ x, y, z });
  }

  /** How far the craft is from the mouth of the well, in metres. */
  get toMouth() {
    const m = sample(0);
    const [x, y, z] = this.craft.position;
    return Math.hypot(m.x - x, m.y - y, m.z - z);
  }

  /** Is the bay able to take you right now? */
  get trapped() { return this.toMouth <= TRAP.r && this.speed <= TRAP.v; }

  /**
   * ══ INTO THE SEAT ═════════════════════════════════════════════════════
   *
   * `Driving.Crew`'s constructor, minus everything about a tank's team and
   * its gun, plus the two things a cockpit needs that a cupola does not: the
   * boom comes out to a ship's length, and the rig's own numbers are
   * remembered so `leave` is a restore rather than a second table of
   * defaults that can drift from `CameraRig`'s constructor. That is
   * `beginMeditationShot`'s discipline and it is here for its reason.
   */
  _board() {
    const p = this.player;
    if (!p) return;
    const cam = p.camera;
    this.was = cam ? {
      fp: cam.firstPerson, dist: cam.targetDistance, height: cam.height,
      shoulder: cam.shoulder, roll: cam.roll, rollTarget: cam.rollTarget,
      yaw: cam.yaw, pitch: cam.pitch, fovTarget: cam.fovTarget,
    } : null;
    this.wasLit = !!p.saber?.lit;
    /* Both hands are on the stick — `Crew`'s line, and its argument. */
    p.saber?.retract();
    p.saber?.setVisible(false);
    p.hum?.retract?.();
    p.releaseGrip?.();
    p._abandonStasis?.();
    if (p.senseActive) p.toggleSense?.(this.world);
    if (p.shield?.up) p._endShield?.('you are in a cockpit');
    p.driving = this;
    if (cam) {
      /* CHASE FIRST. A launch is the one moment worth watching from outside
       * the airframe, and `view` is one key away from the cockpit. */
      cam.firstPerson = false;
      cam.targetDistance = CHASE.dist;
      cam.height = CHASE.height;
      cam.shoulder = 0;
      cam.eyeOffset?.set?.(0, 0, 0);
    }
    p._applyViewMode?.();
  }

  /**
   * ONE FRAME AT THE STICK. Returns true: it owns the frame, exactly as
   * `Crew.update` does, and everything below `Player.update`'s driving branch
   * is a body on its feet.
   */
  update(dt, ctx) {
    const p = this.player;
    const input = ctx?.input;
    if (this.left) return false;
    /* THE THREE WAYS THIS ENDS THAT ARE NOT THE PLAYER PRESSING THE KEY, and
     * they are `Crew.update`'s three with a bay in place of a hull. */
    if (!p || p.alive === false) { this.leave(null); return true; }
    if (!(dt > 0)) { this.ride(); return true; }
    this.t += dt;

    /* ── THE SIX AXES ─────────────────────────────────────────────────── */
    const axis = input?.moveAxis ? input.moveAxis(_stickAxis) : _ZERO_AXIS;
    const held = (id) => !!input?.act?.(id);
    const s = this.stick;
    s.throttle = clamp1(axis.y) * STICK.throttle;
    s.sway = clamp1(axis.x) * STICK.sway;
    s.heave = ((held('jump') ? 1 : 0) - (held('crouch') ? 1 : 0)) * STICK.heave;
    s.roll = ((held('rollR') ? 1 : 0) - (held('rollL') ? 1 : 0)) * STICK.roll;
    /* THE MOUSE, READ HERE AND NOT THROUGH THE CAMERA. `Player._readInput`
     * feeds it to `camera.addYaw`/`addPitch`, whose pitch is CLAMPED to a
     * neck's ±1.28 rad — a ship that may point anywhere cannot have its stick
     * eaten by a neck. The rig is slaved to the airframe below, so what the
     * camera did with the same pixels is overwritten on the same frame and
     * there is no second reader in any sense that matters. */
    const mx = Number(input?.mouse?.dx) || 0;
    const my = Number(input?.mouse?.dy) || 0;
    s.yaw = clamp1(mx * STICK.mouse);
    /* Screen-down is a positive `dy` and nose-down is a negative body-x
     * torque, so the sign here is the sign the mouse already has. */
    s.pitch = clamp1(my * STICK.mouse);

    /* ── AND THE TWO BRAKES, INTO THE SAME ALLOCATION ─────────────────── */
    this.killingRotation = held('blade');
    this.killingVelocity = held('sprint');
    let translate = [s.sway, s.heave, s.throttle];
    let rotate = [s.pitch, s.yaw, s.roll];
    if (this.killingRotation) {
      const d = this.craft.killRotationDemand(dt);
      if (d) rotate = d;
    }
    /**
     * ══ KILL VELOCITY IS A MANOEUVRE, NOT A NOZZLE ════════════════════════
     *
     * `Starfury.killVelocity` burns whatever is pointing the right way, and on
     * this airframe that is the retro alone: 8.4 kN against the mains' 272.
     * Measured, holding it from 90 m/s for six seconds took the craft to
     * **86.6** — 3.4 m/s of a 90 m/s problem, which as a pilot's control is
     * indistinguishable from a key that does nothing.
     *
     * That is not a defect in the model, it is the model being right: there is
     * no reverse engine on a Starfury and the source says so. What a pilot
     * does about it is TURN ROUND AND LIGHT THE MAINS, which is the manoeuvre
     * the source calls normal operation — *"flying backwards while
     * decelerating"*. So this is the same pointing law `CircuitPilot` steers
     * with, aimed retrograde, with the throttle opened as the nose comes on.
     *
     * The throttle is gated on ALIGNMENT rather than opened flat, because a
     * full burn through ninety degrees of turn is not a stop, it is a corner.
     */
    if (this.killingVelocity) {
      const v = this.craft.velocity;
      if (norm(v) > 0.05) {
        const back = this.craft.worldToBody(scale(unit(v), -1));
        /**
         * THE FLIP HAS A SINGULARITY AND IT IS THE COMMON CASE.
         *
         * The axis that swings the nose onto retrograde is
         * `cross(nose, back)` — `(−back.y, back.x, 0)` for a nose at body +z —
         * and it is ZERO both when the craft already points the right way and
         * when it points EXACTLY the wrong way, which is a ship flying straight
         * down its own nose: the commonest attitude there is. Measured, a craft
         * at 90 m/s with the throttle just released held the brake for eight
         * seconds and stayed at 90.0, because the demand it computed was
         * nought.
         *
         * So a flip that has nowhere to turn is started over the top. Pitch
         * rather than yaw for no reason but that a pilot pulls.
         */
        let axisB = [-back[1], back[0], 0];
        if (norm(axisB) < 1e-3 && back[2] < 0) axisB = [1, 0, 0];
        rotate = capped(sub(scale(axisB, K_POINT), scale(this.craft.angularVelocity, K_RATE)), 1);
        /* `back[2]` is how much of retrograde is already down the nose: 1 when
         * the burn is exactly against travel, 0 across it, negative when the
         * craft is still pointing the way it is going. */
        translate = [0, 0, Math.max(0, back[2])];
      }
    }

    command(this.craft, translate, rotate, this.throttles);
    this.craft.step(dt, this.throttles);

    /* ── where that put it on the circuit ─────────────────────────────── */
    this._advance();
    /* SOMEBODY DROVE IT THIS FRAME. Read and cleared by `stepSortie`, which is
     * five steps later in the world's frame — see `autoStep`. */
    this.tick = true;

    this.ride();
    this._frame(dt, ctx);
    return true;
  }

  /**
   * ══ AND A SEAT NOBODY IS STEPPING STILL FLIES ═════════════════════════
   *
   * `update` is called out of `Player.update`, which is step 1 of a world's
   * frame. Anything that drives the STATION alone — `flightops.mjs`'s seam
   * check, a headless probe, a host running a station for a player whose body
   * is not being ticked — turns the whole sortie into a craft frozen at the
   * mouth with `_flying` true, which is finding (2) in a different costume.
   *
   * So `stepSortie` asks whether the seat was driven this frame, and if it was
   * not, the station flies it. `guideRound` is the SAME law `CircuitPilot`
   * uses — one copy, so a sortie nobody is flying does not fly differently
   * from one nobody was ever going to fly.
   */
  autoStep(dt) {
    if (this.left || !(dt > 0)) return this.u;
    this.t += dt;
    guideRound(this.craft, this.u, dt, this.throttles);
    this._advance();
    this.ride();
    return this.u;
  }

  /** Where the craft has got to on the circuit, and how many laps that is.
   *  `lastU` is kept because the station names the sights off the STEP — a
   *  sight is a thing you go past, not a thing you are near. */
  _advance() {
    this.lastU = this.u;
    return advanceOn(this, this.craft.position);
  }

  /**
   * THE PILOT RIDES. `Crew.ride`'s three lines and its argument: `position` is
   * the seat and `velocity` is the craft's, so every reader of "where is this
   * player and how fast are they going" gets the truth rather than a body
   * standing still in a bay while a shader pretends.
   *
   * This is the measurement the audit was made of. Before it the body moved
   * 0.703 m across a whole sortie.
   */
  ride() {
    const p = this.player;
    if (!p) return;
    const [x, y, z] = this.craft.position;
    p.position.set(x, y, z);
    const v = this.craft.velocity;
    p.velocity.set(v[0], v[1], v[2]);
    p.grounded = true;
    p.body?.position?.copy(p.position);
  }

  /**
   * ══ THE CAMERA, BOLTED TO THE AIRFRAME ════════════════════════════════
   *
   * Two cameras and one rig. `CameraRig` already has everything a cockpit
   * needs — a first-person eye at the target, a boom behind it, a roll — and
   * `Player._readInput`'s driving branch already toggles `firstPerson` on
   * `view`. So COCKPIT is the eye and CHASE is the boom, and all this does is
   * point the rig where the ship is pointing.
   *
   * The rig steers on yaw/pitch/roll and the ship carries a quaternion, so the
   * angles are DECOMPOSED rather than tracked: the camera's basis is the
   * ship's turned about its own up (the airframe flies +z forward and a camera
   * looks down −z), and `YXZ` is the order `syncAim` composes in, so taking
   * the same order back out is exact at every attitude but the poles.
   *
   * AND THE RIG IS DRIVEN FROM HERE. `Player.update`'s driving branch returns
   * before `_updateCamera`, so nothing else in the frame will move it.
   */
  _frame(dt, ctx) {
    const p = this.player;
    const cam = p?.camera;
    if (!cam) return;
    const [qw, qx, qy, qz] = this.craft.orientation;
    /* camera = ship · Ry(π), as a quaternion product written out — no THREE in
     * this file, for the reason its header gives about `Outside` and `Launch`. */
    const cw = -qy, cx = -qz, cy = qw, cz = qx;
    /* …and its rotation matrix, only the five elements `YXZ` needs. */
    const m13 = 2 * (cx * cz + cw * cy);
    const m23 = 2 * (cy * cz - cw * cx);
    const m33 = 1 - 2 * (cx * cx + cy * cy);
    const m21 = 2 * (cx * cy + cw * cz);
    const m22 = 1 - 2 * (cx * cx + cz * cz);
    const m11 = 1 - 2 * (cy * cy + cz * cz);
    const m31 = 2 * (cx * cz - cw * cy);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -m23)));
    let yaw, roll;
    if (Math.abs(m23) < 0.9999999) { yaw = Math.atan2(m13, m33); roll = Math.atan2(m21, m22); }
    else { yaw = Math.atan2(-m31, m11); roll = 0; }
    cam.yaw = yaw;
    cam.pitch = pitch;
    /* `CameraRig.update` composes the roll as a turn about (0, 0, −1), which
     * is the negative of the `YXZ` z term. */
    cam.roll = -roll;
    cam.rollTarget = -roll;
    cam.syncAim?.();
    cam.targetDistance = cam.firstPerson ? 0 : CHASE.dist;
    cam.height = cam.firstPerson ? 0 : CHASE.height;
    /* THE LENS OPENS WITH THE SPEED, which is the one cue in the game that
     * says how fast you are actually going in a place with nothing to pass. */
    const base = this.world?.settings?.fov ?? 60;
    cam.fovTarget = base + Math.min(12, this.speed * 0.12);
    cam.update(dt, p.position, {
      physics: ctx?.physics, terrain: null,
      /* The eye is AT the seat: a cockpit is not a head 1.62 m over a hull. */
      eyeHeight: 0, pelvis: null,
    });
  }

  /**
   * ══ WHAT HITS THE PILOT HITS THE SHIP ═════════════════════════════════
   *
   * `Player.damage`'s driving branch calls this — `Driving.Crew` hands the
   * blow to `vehicle`, and a seat that is its own machine takes it here. The
   * signature is `Enemy.damage`'s so the branch does not have to know which
   * kind of seat it is holding.
   *
   * A FINISHED AIRFRAME KILLS THE PILOT rather than putting them out, and that
   * is the one line where a cockpit differs from a cupola: `Crew.update` sets
   * a driver down beside a wreck because there is a floor under it. Out here
   * there is nothing under it, so this goes through `Player.die` — which calls
   * `leave` on its own way through, restores the body and the rig, and hands
   * the empty seat to `landPlayer`, whose dead-pilot branch ends the sortie on
   * the player's own tick with the station's director already stopped.
   *
   * `die` is not called twice: it returns immediately on a body already dead,
   * and `leave` is idempotent.
   */
  damage(amount, point, source, kind) {
    if (this.left) return false;
    const dmg = Number(amount);
    /* A non-finite blow poisons the hull the way `Player.damage`'s own guard
     * says it poisons hp: every later `hull <= 0` is false and the airframe is
     * immortal with a blank gauge. Refuse it instead. */
    if (!Number.isFinite(dmg) || dmg <= 0) return false;
    this.hull = Math.max(0, this.hull - dmg);
    if (this.hull > 0) return false;
    this.say?.('COBRA BAY', 'The airframe is gone.');
    this.player?.die?.(source);
    /* A player with no `die` — a peer's body, a stub — still gets out of a
     * fighter that no longer exists. */
    if (!this.left) this.leave('the airframe came apart');
    return true;
  }

  /**
   * ══ OUT, AND IT IS THE ONLY WAY OUT ═══════════════════════════════════
   *
   * Idempotent, and it puts back every field it borrowed. Called by the drive
   * key through `Player.takeControls`, by `Player.die` — which is the whole of
   * finding (2)'s recovery, because a death does not run the station's
   * director and this does not need it — and by `Player.dispose` on a level
   * change.
   *
   * IT DOES NOT DECIDE WHAT HAPPENS NEXT. Whether this was a trap, a tractor
   * or a corpse is the bay's question, and the bay is `onLeave`. A seat that
   * started a recovery sequence itself would be a flight file that knows about
   * `Launch.Sortie`, and `Pilot.js`'s header is about why it must not.
   */
  leave(why = null) {
    const p = this.player;
    if (this.left) return false;
    this.left = true;
    /* THE BAY IS TOLD WHAT HAPPENED. `Player.die` calls this with no reason —
     * it is a corpse's exit and knows nothing about airframes — so a hull that
     * was shot out from under the pilot says so here rather than being reported
     * as the routine recovery `landPlayer` falls back to. */
    if (!why && this.hull <= 0) why = 'the airframe came apart — the bay recovered what was left';
    if (p) {
      if (p.driving === this) p.driving = null;
      p.velocity.set(0, 0, 0);
      p.grounded = false;
      const cam = p.camera, w = this.was;
      if (cam && w) {
        cam.firstPerson = w.fp;
        cam.targetDistance = w.dist;
        cam.height = w.height;
        cam.shoulder = w.shoulder;
        cam.roll = w.roll; cam.rollTarget = w.rollTarget;
        cam.pitch = w.pitch;
        cam.fovTarget = w.fovTarget;
      }
      if (p.saber) {
        p.saber.setVisible(!p.saberDown);
        if (this.wasLit && !p.saberDown && p.alive !== false) { p.saber.ignite(); p.hum?.ignite?.(); }
      }
      p._applyViewMode?.();
    }
    this.onLeave?.(this, why);
    return true;
  }
}

/** The boom, for a thing nine metres across. A body's 3.05 m puts the camera
 *  inside the port engine pod. */
const CHASE = Object.freeze({ dist: 22, height: 3.2 });

const _stickAxis = { x: 0, y: 0 };
const _ZERO_AXIS = { x: 0, y: 0 };
const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : (Number.isFinite(v) ? v : 0));
