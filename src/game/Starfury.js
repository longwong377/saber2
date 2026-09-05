/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE STARFURY — 6-DOF Newtonian, and the one truly new system
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `SHARK.md` §4 is unusually specific about the order of work:
 *
 *   "**The spike comes first.** Before any modelling: a one-day probe porting
 *    the Python to JS and proving conservation of momentum hands-off and the
 *    allocator's nine mounts in a node check (`starfury.mjs`), with no scene
 *    at all."
 *
 * This file IS that spike. It has no `THREE` import, touches no world and
 * draws nothing: it is the arithmetic out of `longwong377/Opus-5`'s
 * `station/physics/starfury.py`, ported clause for clause, and
 * `tools/checks/starfury.mjs` drives it with no scene.
 *
 * ── WHY IT IS WORTH PORTING AT ALL ────────────────────────────────────────
 *
 * §4: *"nothing in this engine's flight is Newtonian — `Flight.js` the hawk,
 * `DeckFlight.js` the scripted transport, `Driving.js` — and a Starfury that
 * flies like a car is the low-effort thing we are being asked to stop
 * shipping."*
 *
 * The design premise, from the source's own header: **it is not an
 * aeroplane.** No lift surfaces, no preferred direction of travel. Four
 * thruster booms at the corners plus RCS let it rotate freely while its
 * velocity continues unchanged, and flying backwards while decelerating is
 * normal operation rather than a trick. Two consequences drive everything
 * below:
 *
 *   ATTITUDE AND VELOCITY ARE INDEPENDENT. Nothing couples the nose to the
 *   direction of motion, because nothing in vacuum provides one. There is no
 *   damping term anywhere in this file, and its absence is the feature.
 *
 *   THRUST IS ALLOCATED, NOT APPLIED. A commanded translation the thrusters
 *   cannot produce comes out PARTIALLY SATISFIED, not silently exact.
 *   Pretending otherwise would make the craft feel like it has thrusters it
 *   does not.
 */

/* ── vectors, as plain triples: no allocation discipline is needed in a file
 * that runs one craft, and a tuple reads like the Python it came from. ──── */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => Math.sqrt(dot(a, a));
const unit = (a) => { const n = norm(a); return n === 0 ? [0, 0, 0] : scale(a, 1 / n); };
export const V = { add, sub, scale, dot, cross, norm, unit };

/**
 * One thruster: where it sits on the hull and which way it PUSHES.
 *
 * `direction` is the direction of the force it applies to the craft, in body
 * frame — the opposite of where its plume goes. Getting that backwards is the
 * classic way to build a ship that flies into its own exhaust.
 */
export class Thruster {
  constructor(name, position, direction, maxThrust) {
    this.name = name;
    this.position = position;
    this.direction = direction;
    this.maxThrust = maxThrust;
  }

  force(throttle) { return scale(this.direction, this.maxThrust * Math.max(0, Math.min(1, throttle))); }

  torque(throttle) { return cross(this.position, this.force(throttle)); }
}

/**
 * ══ THE NINE MOUNTS, AND THEY ARE THE MANIFEST'S ══════════════════════════
 *
 * `assets/station/starfury_manifest.json` carries `thruster_mounts` — nine
 * named positions in the airframe's own frame — and these are those numbers.
 * They are not typed twice: `starfury.mjs` reads the manifest off disk and
 * asserts every mount here is at the position the geometry was built around,
 * which is the check §4 asks for by name ("the allocator's nine mounts in a
 * node check").
 *
 * The four mains sit OUTBOARD on the booms rather than on the centreline,
 * which is why a Starfury can pitch and yaw hard on main thrust alone: each
 * boom has real leverage about the centre of mass.
 */
export const BOOM = 3.4;
export const AFT = -2.1;
export const RETRO_Z = 2.4;

export function auroraThrusters(mainThrust = 68000, rcsThrust = 4200) {
  const t = [];
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      t.push(new Thruster(
        `main_${sy > 0 ? 'u' : 'l'}${sx > 0 ? 'r' : 'l'}`,
        [sx * BOOM, sy * BOOM, AFT], [0, 0, 1], mainThrust,
      ));
    }
  }
  /* RCS quads: lateral, vertical and retro authority. */
  for (const sx of [1, -1]) {
    t.push(new Thruster(`rcs_lat_${sx > 0 ? 'r' : 'l'}`, [sx * BOOM, 0, 0], [-sx, 0, 0], rcsThrust));
  }
  for (const sy of [1, -1]) {
    t.push(new Thruster(`rcs_vert_${sy > 0 ? 'u' : 'd'}`, [0, sy * BOOM, 0], [0, -sy, 0], rcsThrust));
  }
  t.push(new Thruster('rcs_retro', [0, 0, RETRO_Z], [0, 0, -1], rcsThrust * 2));
  /**
   * ══ AND THE ROLL PAIR, WHICH THE PORT DID NOT HAVE ════════════════════
   *
   * ── THE DEFECT, MEASURED THE FIRST TIME ANYBODY FLEW IT ───────────────
   *
   * The nine mounts above give the airframe **no roll authority whatsoever**,
   * and the arithmetic is one line: body-z torque is `cross(position, force)`
   * in z, which is `p.x·F.y − p.y·F.x`. Every one of the nine has either its
   * position or its force on the axis that zeroes that product — the four
   * mains push along +z, the lateral pair pushes along ∓x from a mount at
   * y = 0, the vertical pair pushes along ∓y from a mount at x = 0, and the
   * retro is on the centreline. Roll demand in, nothing out.
   *
   * Nothing had noticed because nothing had ever asked: `CircuitPilot` steers
   * by pointing at its own acceleration and never rolls, and `starfury.mjs`
   * tested pitch and yaw. Driven with a stick on it, Q and E moved the craft
   * **0.000 rad/s** in six seconds. §4's ask is *"six axes"* and the layout
   * was five.
   *
   * ── WHY IT IS FOUR NOZZLES AND NOT FOUR MOUNTS ────────────────────────
   *
   * `assets/station/starfury_manifest.json` carries nine THRUSTER MOUNTS and
   * the geometry stands a sponson at each; the sections it names are
   * `rcs_sponson` AND `rcs_nozzle`, separately, because a sponson is a cluster
   * and not a single bell. So these four stand at the two vertical sponsons
   * that are already there — the same mounts, the same geometry — and fire
   * across the hull rather than along it:
   *
   *     [0, +BOOM, 0] pushing ±x  →  torque (0, 0, ∓BOOM·F)
   *     [0, −BOOM, 0] pushing ∓x  →  torque (0, 0, ∓BOOM·F)
   *
   * Two per direction, diagonally opposed, so a roll command is a COUPLE: the
   * two forces cancel and only the torque survives. That is what makes this a
   * sixth axis rather than a sideways shove with a spin in it.
   *
   * They cost nothing on any other axis, which is the property that keeps the
   * rest of the model exactly as it was ported: a pure +z or −z translation
   * demand dots to zero against all four, so `starfury.mjs`'s "a forward
   * demand opens all four mains fully, with nothing sideways in it" is
   * unchanged to the last bit.
   */
  for (const sy of [1, -1]) {
    for (const sx of [1, -1]) {
      t.push(new Thruster(`rcs_roll_${sy > 0 ? 'u' : 'd'}${sx > 0 ? 'r' : 'l'}`,
        [0, sy * BOOM, 0], [sx * sy, 0, 0], rcsThrust));
    }
  }
  return t;
}

/**
 * Rigid-body state and integration.
 *
 * ATTITUDE IS A QUATERNION (w, x, y, z), so repeated rotation never
 * gimbal-locks — which matters here more than in most craft, because a
 * Starfury genuinely does spend time pointing in every direction.
 */
export class Starfury {
  constructor(opts = {}) {
    this.mass = opts.mass ?? 14800;                       // kg, loaded
    this.inertia = opts.inertia ?? [52000, 52000, 31000]; // kg m², body axes
    this.position = opts.position ?? [0, 0, 0];
    this.velocity = opts.velocity ?? [0, 0, 0];
    this.orientation = opts.orientation ?? [1, 0, 0, 0];
    this.angularVelocity = opts.angularVelocity ?? [0, 0, 0];
    this.thrusters = opts.thrusters ?? auroraThrusters(opts.mainThrust, opts.rcsThrust);
    this._by = new Map(this.thrusters.map((t) => [t.name, t]));
  }

  /* ── attitude ─────────────────────────────────────────────────────────── */

  bodyToWorld(v) {
    const [w, x, y, z] = this.orientation;
    const t = scale(cross([x, y, z], v), 2);
    return add(add(v, scale(t, w)), cross([x, y, z], t));
  }

  worldToBody(v) {
    const [w, x, y, z] = this.orientation;
    /* The conjugate, applied by the same expression rather than by a second
     * copy of it — the Python swapped the field and restored it in a `finally`
     * for exactly this reason, and a local is cleaner than a mutation. */
    const q = [w, -x, -y, -z];
    const t = scale(cross([q[1], q[2], q[3]], v), 2);
    return add(add(v, scale(t, q[0])), cross([q[1], q[2], q[3]], t));
  }

  get forward() { return this.bodyToWorld([0, 0, 1]); }

  get up() { return this.bodyToWorld([0, 1, 0]); }

  get right() { return this.bodyToWorld([1, 0, 0]); }

  normalise() {
    const [w, x, y, z] = this.orientation;
    const n = Math.sqrt(w * w + x * x + y * y + z * z);
    if (n > 0) this.orientation = [w / n, x / n, y / n, z / n];
  }

  /* ── allocation ───────────────────────────────────────────────────────── */

  /**
   * Throttle each thruster to best approximate the commanded demand.
   *
   * DELIBERATELY SIMPLE AND HONEST, and the source says why: each thruster
   * opens in proportion to how well it serves the demand, and a demand the
   * layout cannot satisfy comes out partially satisfied rather than silently
   * exact. A least-squares allocator would give the pilot authority the
   * airframe does not have, which is the "flies like a car" failure in its
   * subtlest form.
   *
   * @param translate demanded acceleration direction and magnitude, body frame
   * @param rotate    demanded angular acceleration, body frame
   */
  allocate(translate, rotate, out = new Map()) {
    out.clear();
    const tn = norm(translate), rn = norm(rotate);
    const tw = tn > 0 ? unit(translate) : [0, 0, 0];
    const rw = rn > 0 ? unit(rotate) : [0, 0, 0];
    for (const th of this.thrusters) {
      const lin = dot(th.direction, tw) * tn;
      const tq = th.torque(1);
      const tqn = norm(tq);
      const rot = tqn > 0 ? dot(unit(tq), rw) * rn : 0;
      out.set(th.name, Math.max(0, Math.min(1, lin + rot)));
    }
    return out;
  }

  /** The net force and torque of a throttle set, in body frame. */
  net(throttles) {
    let f = [0, 0, 0], t = [0, 0, 0];
    for (const th of this.thrusters) {
      const k = (throttles instanceof Map ? throttles.get(th.name) : throttles?.[th.name]) || 0;
      if (k <= 0) continue;
      f = add(f, th.force(k));
      t = add(t, th.torque(k));
    }
    return [f, t];
  }

  /* ── integration ──────────────────────────────────────────────────────── */

  /**
   * Advance by `dt`. Semi-implicit Euler: stable and momentum-preserving at
   * the step sizes a flight model runs at.
   *
   * **THERE IS NO DAMPING TERM AND THAT IS THE POINT.** §4 lists "no velocity
   * damping" among the things the port has to keep, and `starfury.mjs`'s first
   * check is momentum conservation hands-off — a craft with the throttles shut
   * must still be exactly where its velocity says it should be, ten thousand
   * steps later.
   */
  step(dt, throttles = null, externalAccel = [0, 0, 0]) {
    const [forceBody, torqueBody] = this.net(throttles || {});

    const accel = add(scale(this.bodyToWorld(forceBody), 1 / this.mass), externalAccel);
    this.velocity = add(this.velocity, scale(accel, dt));
    this.position = add(this.position, scale(this.velocity, dt));

    const [ix, iy, iz] = this.inertia;
    let [wx, wy, wz] = this.angularVelocity;
    /**
     * Euler's equations. THE GYROSCOPIC TERM is what makes a tumbling
     * Starfury precess instead of spinning about a fixed body axis, and it is
     * the one line in this file a reader is most likely to think is optional.
     * It is not: without it a craft with three unequal moments of inertia
     * behaves like one with three equal ones, and the whole reason the source
     * carries a 52/52/31 tensor is that it does not.
     */
    const gyro = [(iy - iz) * wy * wz, (iz - ix) * wz * wx, (ix - iy) * wx * wy];
    const alpha = [
      (torqueBody[0] + gyro[0]) / ix,
      (torqueBody[1] + gyro[1]) / iy,
      (torqueBody[2] + gyro[2]) / iz,
    ];
    this.angularVelocity = add(this.angularVelocity, scale(alpha, dt));

    [wx, wy, wz] = this.angularVelocity;
    const [w, x, y, z] = this.orientation;
    this.orientation = [
      w + 0.5 * dt * (-x * wx - y * wy - z * wz),
      x + 0.5 * dt * (w * wx + y * wz - z * wy),
      y + 0.5 * dt * (w * wy + z * wx - x * wz),
      z + 0.5 * dt * (w * wz + x * wy - y * wx),
    ];
    this.normalise();
  }

  /* ── derived ──────────────────────────────────────────────────────────── */

  get speed() { return norm(this.velocity); }

  /** Along the mains, at full throttle. */
  maxLinearAccel() {
    let s = 0;
    for (const t of this.thrusters) if (t.name.startsWith('main_')) s += t.maxThrust;
    return s / this.mass;
  }

  /**
   * KILL ROTATION — the one autopilot a Starfury has, and every pilot's most
   * used control. It is not a damping term: it is the allocator asked for the
   * torque that cancels the angular momentum this craft actually has, which
   * means it works exactly as well as the thrusters allow and no better.
   */
  killRotation(dt, out = new Map()) {
    const d = this.killRotationDemand(dt);
    if (!d) { out.clear(); return out; }
    return this.allocate([0, 0, 0], d, out);
  }

  /**
   * …AND THE DEMAND ON ITS OWN, WHICH IS WHAT A PILOT WITH TWO HANDS NEEDS.
   *
   * `killRotation` above allocates the whole airframe to stopping the tumble,
   * which is right for a craft nobody is flying and wrong for one that is: the
   * allocator sums a translation term and a rotation term PER THRUSTER, so a
   * player holding the attitude brake and the throttle at the same time must
   * hand both into ONE `allocate` call. Two calls merged afterwards is a
   * different ship — see `Pilot.PlayerPilot.update`, the only other caller.
   *
   * Returns null when there is nothing to stop, so a caller can tell "the
   * brake did nothing" from "the brake asked for zero".
   */
  killRotationDemand(dt) {
    const w = this.angularVelocity;
    if (norm(w) < 1e-6) return null;
    /* The torque that would stop it inside `dt`, in body frame, capped at
     * what the RCS can actually make. */
    const [ix, iy, iz] = this.inertia;
    const want = [-w[0] * ix / dt, -w[1] * iy / dt, -w[2] * iz / dt];
    return scale(unit(want), Math.min(1, norm(want) / 1e5));
  }

  /**
   * KILL VELOCITY — burn against the direction of travel. In body frame,
   * because the thrusters are, which is the whole reason this is not simply
   * `velocity *= 0.98`.
   */
  killVelocity(out = new Map()) {
    const d = this.killVelocityDemand();
    if (!d) { out.clear(); return out; }
    return this.allocate(d, [0, 0, 0], out);
  }

  /** The retro burn as a body-frame demand, for the same reason
   *  `killRotationDemand` exists: a pilot holding both brakes and a stick has
   *  one allocation, not three. Null when there is nothing to stop. */
  killVelocityDemand() {
    const v = this.velocity;
    if (norm(v) < 1e-4) return null;
    return this.worldToBody(scale(unit(v), -1));
  }

  /**
   * ══ THE LAUNCH ════════════════════════════════════════════════════════
   *
   * §3.2 #5 is a launch WELL with catapult rams, and the source models the
   * other thing a rotating hull gives you for free:
   *
   *   "The bay is on the rotating hull, so the craft leaves already carrying
   *    the drum's tangential velocity. That inheritance IS the launch: the
   *    station throws the Starfury clear, which is exactly what the show
   *    depicts and what makes cobra bays work without a catapult."
   *
   * Both are kept — the ram gives the scripted three seconds §4 asks for, and
   * the inheritance is what the craft is still carrying when the ram lets go.
   */
  launchFromDrum(omega, radius, z) {
    this.position = [radius, 0, z];
    this.velocity = [0, omega * radius, 0];
    return this.velocity;
  }
}

/**
 * The nine mounts as the manifest names them, for the check that holds this
 * file against `assets/station/starfury_manifest.json`. Exported rather than
 * re-derived there: a check that rebuilds the thing it is checking cannot
 * fail (HANDOFF §2.3b).
 */
export function mountTable(craft = new Starfury()) {
  const out = {};
  for (const t of craft.thrusters) out[t.name] = t.position;
  return out;
}
