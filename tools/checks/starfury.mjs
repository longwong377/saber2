/**
 * THE STARFURY, WITH NO SCENE AT ALL.
 *
 * `SHARK.md` §4: *"The spike comes first. Before any modelling: a one-day
 * probe porting the Python to JS and proving conservation of momentum
 * hands-off and the allocator's nine mounts in a node check (`starfury.mjs`),
 * with no scene at all."*
 *
 * That is what this is, and the order matters: a flight model that turns out
 * not to be Newtonian AFTER a Cobra bay, a launch well, an orbit level and a
 * cockpit have been built around it is a week nobody gets back. Nothing here
 * imports three, a World or a level.
 *
 * §5.3's list for this file: momentum conserved hands-off; the allocator's
 * sums; the launch ends outside the well; the landing ends inside it; never
 * through the hull. The first two are what the spike is for and are here; the
 * last three need the level and are named as such below.
 */

import { readFile, readdir } from 'node:fs/promises';
import {
  Starfury, Thruster, auroraThrusters, mountTable, V, BOOM, AFT, RETRO_Z,
} from '../../src/game/Starfury.js';

/**
 * ══ AND THE SECOND HALF, WHICH NEEDS A WORLD ══════════════════════════════
 *
 * The header above is right that the SPIKE has no scene, and the first check
 * below still has none. What follows it could not be more different, and it is
 * there because of what the spike being green for months actually hid:
 *
 *   NOBODY FLEW IT. Driven headless through a complete sortie — the press, the
 *   six phases of `Launch.OUT`, the lap, the recovery — the player's body moved
 *   **0.703 m** and stayed standing in the launch well. `Starfury.js` was
 *   perfect and was being flown by an autopilot with the player watching from
 *   the floor of the bay. Every assertion in the spike passed throughout,
 *   because every one of them is about arithmetic.
 *
 * So the checks after it are about a PLAYER: a seat that moves the body, axes
 * that move the attitude, a camera that changes, a landing, and a sortie that
 * ends when the pilot is killed in the middle of it. None of that is knowable
 * without a station, and all of it is the half the note was asking for.
 */

/**
 * A station on a deck, booted through the door the game uses.
 *
 * `Levels.js` FIRST, and that is not decoration: it imports `STATION_LEVEL`
 * out of `Station.js`, so entering that cycle from `Station`'s side hits the
 * const in its temporal dead zone. Pre-existing, and every suite that boots a
 * world enters from the world's side and never sees it.
 */
async function station(deck) {
  await import('../../src/game/Levels.js');
  const { bootWorld } = await import('./_coop.mjs');
  const { prepareStation } = await import('../../src/game/Station.js');
  if (!globalThis.__stationFetch) {
    const root = new URL('../../', import.meta.url);
    globalThis.__stationFetch = true;
    globalThis.fetch = async (url) => {
      const buf = await readFile(new URL(String(url), root));
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    };
  }
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return world;
}

/**
 * An input device a check can actually fly with.
 *
 * `_coop.idleInput` answers false to everything, which is right for a world
 * nobody is playing and useless here: EVERY assertion below is about a key
 * being pressed. `hit` is the frame's edge set and `held` the level set —
 * `Input.actHit` is idempotent within a frame by design, so a "one-shot" read
 * twice must answer twice, and a set is what says that.
 */
function stick() {
  const hit = new Set(), held = new Set(), ax = { x: 0, y: 0 };
  return {
    hit, held, ax,
    act: (id) => held.has(id) || hit.has(id),
    actHit: (id) => hit.has(id),
    actDown: (id) => held.has(id) || hit.has(id),
    moveAxis: (o) => { if (o) { o.x = ax.x; o.y = ax.y; return o; } return { x: ax.x, y: ax.y }; },
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 },
    /* The mouse is a PER-FRAME DELTA and the edge set is one frame wide, so
     * both are cleared here — exactly as `Input.end` does after every real
     * frame. A check that forgets this holds a flick down for ever. */
    end() { hit.clear(); this.mouse.dx = 0; this.mouse.dy = 0; },
  };
}

/**
 * ══ A HAND ON THE STICK, AND IT IS ONLY A HAND ════════════════════════════
 *
 * `flyRound` decides what to ASK FOR and then asks for it THROUGH THE SIX
 * AXES — the move axis, the mouse and the two keys — and nothing else. It
 * never touches `craft.velocity`, never calls `allocate`, never calls
 * `guideRound`. Everything between the stick and the ship is the game's.
 *
 * The aiming law is deliberately the same one `Pilot.guideRound` flies, and
 * that is not a second copy of the model: what is under test here is not
 * whether the law is good, it is that A PLAYER CAN EXPRESS IT — that six axes
 * and a mouse are enough authority to get round the station, that
 * `Player.update` really runs the seat, and that the track parameter, the lap
 * counter and the recovery all answer a craft somebody is flying.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The suite's only round trip was `flightops.mjs`'s, and it drives
 * `stepStation` directly — which never runs `Player.update`, so `seat.tick` is
 * never set and `stepSortie` hands the craft to `autoStep`. THE CERTIFIED
 * ROUND TRIP WAS THE AUTOPILOT'S. A player at the stick got a quarter of a lap
 * and a tow, and nothing was red.
 */
function flyRound(seat, input, mod) {
  const { V, sample, CIRCUIT_LENGTH, STICK } = mod;
  const { sub, scale, dot, cross, norm, unit } = V;
  const P = (q) => [q.x, q.y, q.z];
  const craft = seat.craft;
  const at = seat.u + 80 / CIRCUIT_LENGTH;
  const aim = P(sample(at));
  const T = unit(sub(P(sample(at + 0.001)), P(sample(at - 0.001))));
  const aMax = craft.maxLinearAccel();
  const cap = (v, m) => (norm(v) > m ? scale(unit(v), m) : v);
  const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
  const off = sub(craft.position, aim);
  const lateral = sub(off, scale(T, dot(off, T)));
  const d = norm(lateral);
  const pull = Math.min(0.5 * d, Math.sqrt(2 * aMax * d * 0.85));
  const want = sub(scale(T, 45), d > 1e-6 ? scale(lateral, pull / d) : lateral);
  const accel = cap(scale(sub(want, craft.velocity), 4), aMax);
  const dir = norm(accel) > 1e-6 ? unit(accel) : unit(craft.velocity);
  let axisBody = craft.worldToBody(cross(craft.forward, dir));
  if (norm(axisBody) < 1e-3 && dot(craft.forward, dir) < 0) axisBody = [1, 0, 0];
  const spin = cap(sub(scale(axisBody, 12), scale(craft.angularVelocity, 3)), 1);
  /* …and out through the keys, the mouse and the move axis. */
  input.mouse.dy = spin[0] / STICK.mouse;
  input.mouse.dx = spin[1] / STICK.mouse;
  const body = craft.worldToBody(scale(accel, 1 / aMax));
  input.ax.y = clamp1(body[2]);
  input.ax.x = clamp1(body[0]);
  input.held.delete('jump'); input.held.delete('crouch');
  if (body[1] > 0.05) input.held.add('jump');
  else if (body[1] < -0.05) input.held.add('crouch');
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  check('starfury: the spike — Newtonian, hands off, and the nine mounts are the manifest\'s', async () => {
    /* ════════════════════════════════════════════════════════════════════════
     *  1. THE NINE MOUNTS ARE THE MANIFEST'S
     * ════════════════════════════════════════════════════════════════════════
     *
     * The airframe was BUILT around these positions — the engine bells, the RCS
     * sponsons and the retro nozzle are geometry standing at them — so a flight
     * model whose thrusters are somewhere else is a ship whose plumes come out
     * of the hull. The manifest is read off disk rather than restated here,
     * because a check that carries its own copy of the number it is checking is
     * a check that cannot fail (HANDOFF §2.3b).
     */
    const manifest = JSON.parse(await readFile(
      new URL('../../assets/station/starfury_manifest.json', import.meta.url), 'utf8'));
    const mounts = mountTable();
    const names = Object.keys(manifest.thruster_mounts);
    assert(names.length === 9, `starfury: the manifest declares nine thruster mounts — got ${names.length}`);
    /**
     * ══ NINE MOUNTS, AND MORE THAN NINE NOZZLES ON THEM ══════════════════
     *
     * This used to read `Object.keys(mounts).length === 9`, and the identity
     * it was really asserting was one nozzle per mount — which is not what the
     * geometry says. `sections` in the same manifest names `rcs_sponson` AND
     * `rcs_nozzle` separately, because a sponson is a CLUSTER: the two vertical
     * sponsons carry the roll couple as well as the heave pair (see
     * `auroraThrusters`, and the measurement that found the airframe had no
     * roll axis at all).
     *
     * So the property is stated as the property: every nozzle stands at one of
     * the manifest's nine mounts, and none of the nine is empty. A nozzle
     * floating off the hull and a sponson with nothing on it both fail; a
     * second nozzle in a sponson does not, because that is what a sponson is.
     */
    let worst = 0, worstName = '', orphan = 0;
    const occupied = new Set();
    for (const [n, p] of Object.entries(mounts)) {
      let near = Infinity, at = null;
      for (const m of names) {
        const q = manifest.thruster_mounts[m];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        if (d < near) { near = d; at = m; }
      }
      if (near > 1e-9) { orphan++; }
      else occupied.add(at);
      if (near > worst) { worst = near; worstName = n; }
    }
    assert(orphan === 0 && worst < 1e-9,
      `starfury: every nozzle stands at one of the manifest's mounts — ${orphan} do not, worst `
      + `${worstName} off by ${worst.toExponential(2)} m`);
    assert(occupied.size === 9,
      `starfury: and all nine mounts carry something — ${9 - occupied.size} are empty`);

    /* The frame the manifest states, held: +z forward, +y up, +x starboard. */
    const craft = new Starfury();
    const f = craft.forward;
    assert(Math.abs(f[2] - 1) < 1e-12, 'starfury: +z is forward at identity attitude');

    /* ════════════════════════════════════════════════════════════════════════
     *  2. MOMENTUM IS CONSERVED HANDS-OFF — §4's own first clause
     * ════════════════════════════════════════════════════════════════════════
     *
     * "No velocity damping." A craft with the throttles shut goes on going, and
     * the test is not "it does not slow down much" — it is that after ten
     * thousand steps the position is EXACTLY where the velocity says it should
     * be, to floating point. Anything that quietly bled energy would show here
     * as a metre and would show in play as a ship that flies like a car.
     */
    {
      const c = new Starfury({ velocity: [37.5, -12.25, 90.0] });
      const v0 = c.velocity.slice();
      const dt = 1 / 60, N = 10000;
      for (let i = 0; i < N; i++) c.step(dt);
      const drift = Math.hypot(c.velocity[0] - v0[0], c.velocity[1] - v0[1], c.velocity[2] - v0[2]);
      assert(drift === 0, `starfury: hands off, the velocity does not change at all — drift ${drift}`);
      /* Semi-implicit Euler advances position by the POST-step velocity, so with
       * no acceleration the closed form is exactly v·dt·N. */
      const want = [v0[0] * dt * N, v0[1] * dt * N, v0[2] * dt * N];
      const err = Math.hypot(c.position[0] - want[0], c.position[1] - want[1], c.position[2] - want[2]);
      assert(err < 1e-6,
        `starfury: after ${N} steps it is exactly where its velocity says — off by ${err.toExponential(2)} m over ${Math.round(want[2])} m`);
    }

    /* ════════════════════════════════════════════════════════════════════════
     *  3. ATTITUDE AND VELOCITY ARE INDEPENDENT
     * ════════════════════════════════════════════════════════════════════════
     *
     * The design premise in one assertion: spin the craft as hard as the RCS
     * will spin it and the velocity must not move by a millimetre per second.
     * "Flying backwards while decelerating is normal operation, not a trick."
     */
    {
      const c = new Starfury({ velocity: [0, 0, 120], angularVelocity: [0.9, 0.4, 0.2] });
      const v0 = c.velocity.slice();
      for (let i = 0; i < 600; i++) c.step(1 / 60);
      const moved = Math.hypot(c.velocity[0] - v0[0], c.velocity[1] - v0[1], c.velocity[2] - v0[2]);
      assert(moved === 0, `starfury: ten seconds of tumbling changes the velocity by ${moved} m/s`);
      /* …and it really did tumble: the nose is nowhere near where it started. */
      const dotF = c.forward[2];
      assert(dotF < 0.9, `starfury: and it really tumbled — the nose is at ${dotF.toFixed(3)} of its start`);
    }

    /* ════════════════════════════════════════════════════════════════════════
     *  4. THE QUATERNION STAYS A QUATERNION
     * ════════════════════════════════════════════════════════════════════════
     *
     * Attitude is carried as a quaternion so repeated rotation never gimbal-
     * locks, "which matters here more than in most craft, because the Starfury
     * genuinely does spend time pointing every direction". An unnormalised one
     * is a slow scale creeping into every body-to-world transform.
     */
    {
      const c = new Starfury({ angularVelocity: [1.4, -0.8, 0.5] });
      for (let i = 0; i < 20000; i++) c.step(1 / 60);
      const [w, x, y, z] = c.orientation;
      const n = Math.sqrt(w * w + x * x + y * y + z * z);
      assert(Math.abs(n - 1) < 1e-12, `starfury: 20 000 steps of tumble and |q| is ${n.toFixed(15)}`);
      assert(Number.isFinite(n), 'starfury: nothing went NaN');
    }

    /* ════════════════════════════════════════════════════════════════════════
     *  5. THE GYROSCOPIC TERM IS DOING SOMETHING
     * ════════════════════════════════════════════════════════════════════════
     *
     * The one line a reader is most likely to think is optional. With three
     * unequal moments of inertia (52/52/31) a body spun about an axis that is
     * none of the three must PRECESS — the angular velocity vector moves in the
     * body frame even with no torque at all. Delete the term and it does not,
     * and nothing else in the model would notice.
     */
    {
      const c = new Starfury({ angularVelocity: [0.8, 0.0, 0.6] });
      const w0 = c.angularVelocity.slice();
      for (let i = 0; i < 600; i++) c.step(1 / 60);
      const w1 = c.angularVelocity;
      const moved = Math.hypot(w1[0] - w0[0], w1[1] - w0[1], w1[2] - w0[2]);
      assert(moved > 0.05,
        `starfury: free precession — the body-frame spin axis moved ${moved.toFixed(3)} rad/s with no torque`);
      /* …but the MAGNITUDE is conserved: precession redistributes angular
       * momentum between axes, it does not create or destroy it. Semi-implicit
       * Euler leaks a little; a percent over ten seconds is the honest bound. */
      const m0 = Math.hypot(w0[0], w0[1], w0[2]), m1 = Math.hypot(w1[0], w1[1], w1[2]);
      assert(Math.abs(m1 - m0) / m0 < 0.02,
        `starfury: and the spin rate is conserved through it — ${m0.toFixed(4)} → ${m1.toFixed(4)} rad/s`);
    }

    /* ════════════════════════════════════════════════════════════════════════
     *  6. THE ALLOCATOR SUMS — §4's second clause
     * ════════════════════════════════════════════════════════════════════════
     *
     * "A commanded translation the thrusters cannot produce should come out
     * PARTIALLY SATISFIED, not silently exact." So the allocator is held to
     * three things: it produces thrust along a demand it CAN serve, it produces
     * essentially none along one it cannot, and no throttle ever leaves [0, 1].
     */
    {
      const c = new Starfury();
      /* Forward: the four mains, and they are the only thrust the craft has in
       * any quantity — 4 × 68 kN against 14.8 t. */
      const fwd = c.allocate([1, 0, 0].map((_, i) => (i === 2 ? 1 : 0)), [0, 0, 0]);
      let mains = 0;
      for (const [n, k] of fwd) if (n.startsWith('main_')) mains += k;
      assert(mains === 4, `starfury: a forward demand opens all four mains fully — got ${mains}`);
      const [F] = c.net(fwd);
      assert(Math.abs(F[2] - 4 * 68000) < 1, `starfury: and that is ${(F[2] / 1000).toFixed(0)} kN of thrust`);
      assert(Math.abs(F[0]) < 1e-9 && Math.abs(F[1]) < 1e-9, 'starfury: with nothing sideways in it');

      /* The mains are OUTBOARD, so four of them at equal throttle make no net
       * torque — the booms cancel in pairs. That is what lets full throttle be
       * straight ahead rather than a tumble. */
      const [, T] = c.net(fwd);
      assert(Math.hypot(T[0], T[1], T[2]) < 1e-6,
        `starfury: four symmetric booms at full throttle make ${Math.hypot(T[0], T[1], T[2]).toExponential(1)} N·m of torque`);

      /* AND THE HONEST FAILURE. There is no thruster pushing the craft
       * backwards except one small retro, so a demand for reverse thrust must
       * come out weak — an allocator that satisfied it would be inventing an
       * engine. Measured against the forward case, which is the comparison that
       * makes the number mean something. */
      const back = c.allocate([0, 0, -1], [0, 0, 0]);
      const [Fb] = c.net(back);
      const ratio = Math.abs(Fb[2]) / Math.abs(F[2]);
      assert(ratio > 0 && ratio < 0.05,
        `starfury: reverse is the retro alone — ${(Math.abs(Fb[2]) / 1000).toFixed(1)} kN, ${(ratio * 100).toFixed(1)}% of forward`);

      /* No throttle ever leaves the unit interval, whatever is asked for. */
      let bad = 0;
      for (const demand of [[9, 9, 9], [-4, 2, -7], [0, 0, 0], [1e6, 0, 0]]) {
        for (const spin of [[0, 0, 0], [5, -5, 5], [-1e6, 0, 1e6]]) {
          for (const k of c.allocate(demand, spin).values()) {
            if (!(k >= 0 && k <= 1) || !Number.isFinite(k)) bad++;
          }
        }
      }
      assert(bad === 0, `starfury: no demand, however absurd, drives a throttle outside [0, 1] — got ${bad}`);
    }

    /* ════════════════════════════════════════════════════════════════════════
     *  7. IT CAN ACTUALLY FLY — the numbers a pilot feels
     * ════════════════════════════════════════════════════════════════════════ */
    {
      const c = new Starfury();
      const a = c.maxLinearAccel();
      assert(a > 15 && a < 20,
        `starfury: full burn is ${a.toFixed(1)} m/s² — ${(a / 9.81).toFixed(1)} g, which is a fighter and not a freighter`);
      /* Ten seconds of full throttle from rest, and the distance it covers. */
      const th = c.allocate([0, 0, 1], [0, 0, 0]);
      for (let i = 0; i < 600; i++) c.step(1 / 60, th);
      assert(c.speed > 150 && c.speed < 220,
        `starfury: ten seconds of burn reaches ${c.speed.toFixed(0)} m/s`);
    }

    /* KILL ROTATION brings a tumble down rather than snapping it to zero. */
    {
      const c = new Starfury({ angularVelocity: [0.6, -0.3, 0.2] });
      const w0 = Math.hypot(...c.angularVelocity);
      const th = new Map();
      for (let i = 0; i < 900; i++) { c.killRotation(1 / 60, th); c.step(1 / 60, th); }
      const w1 = Math.hypot(...c.angularVelocity);
      assert(w1 < w0 * 0.5, `starfury: kill-rotation takes ${w0.toFixed(3)} rad/s down to ${w1.toFixed(3)} in fifteen seconds`);
    }

    /* KILL VELOCITY burns against travel, in the body frame, whatever the
     * craft is pointing at — which is the whole difference between this and
     * `velocity *= 0.98`. */
    {
      const c = new Starfury({ velocity: [0, 0, 120] });
      const th = new Map();
      for (let i = 0; i < 900; i++) { c.killVelocity(th); c.step(1 / 60, th); }
      assert(c.speed < 120, `starfury: kill-velocity slows it from 120 to ${c.speed.toFixed(1)} m/s`);
    }

    /* ════════════════════════════════════════════════════════════════════════
     *  7b. AND IT CAN ROLL — the sixth axis, which the port did not have
     * ════════════════════════════════════════════════════════════════════════
     *
     * ── THE DEFECT THIS BLOCK EXISTS FOR ────────────────────────────────────
     *
     * The nine mounts as ported give the craft ZERO body-z torque: every one of
     * them has either its position or its thrust on the axis that zeroes
     * `p.x·F.y − p.y·F.x`. Nothing had noticed, because this suite tested pitch
     * and yaw and `CircuitPilot` never rolls — and §4's ask is *"six axes"*.
     * Driven with a stick on it, Q and E moved the craft 0.000 rad/s.
     *
     * The bar is a COUPLE and not a shove: a roll that came with a sideways
     * push would be a nozzle firing across the hull, which is a translation
     * with a spin in it and not an axis of control.
     */
    {
      const c = new Starfury();
      const th = c.allocate([0, 0, 0], [0, 0, 0.6]);
      const [F, T] = c.net(th);
      assert(Math.abs(T[2]) > 1e4,
        `starfury: a roll demand makes ${Math.abs(T[2]).toFixed(0)} N·m about the nose`);
      assert(Math.hypot(F[0], F[1], F[2]) < 1e-6,
        `starfury: and it is a couple — ${Math.hypot(F[0], F[1], F[2]).toFixed(1)} N of net force with it`);
      assert(Math.hypot(T[0], T[1]) < 1e-6,
        'starfury: and it is pure roll — no pitch or yaw rides on it');
      /* Both ways round, which four nozzles buy and two would not. */
      const back = c.net(c.allocate([0, 0, 0], [0, 0, -0.6]))[1];
      assert(Math.sign(back[2]) === -Math.sign(T[2]) && Math.abs(back[2]) > 1e4,
        'starfury: and it rolls the other way just as hard');
      /* One second of stick, integrated, so the number is a rate a pilot would
       * feel rather than a torque nobody can read. */
      const d = new Starfury();
      for (let i = 0; i < 60; i++) d.step(1 / 60, d.allocate([0, 0, 0], [0, 0, 0.6]));
      assert(Math.abs(d.angularVelocity[2]) > 0.3,
        `starfury: a second of roll stick reaches ${d.angularVelocity[2].toFixed(3)} rad/s`);
      assert(Math.hypot(...d.velocity) < 1e-9,
        `starfury: and a second of rolling has moved it ${Math.hypot(...d.velocity).toExponential(1)} m/s sideways`);
    }

    /* ════════════════════════════════════════════════════════════════════════
     *  8. THE LAUNCH INHERITS THE DRUM'S SPIN
     * ════════════════════════════════════════════════════════════════════════
     *
     * "The bay is on the rotating hull, so the craft leaves already carrying the
     * drum's tangential velocity. That inheritance IS the launch."
     */
    {
      const c = new Starfury();
      const v = c.launchFromDrum(0.42, 90, -46);
      const speed = Math.hypot(v[0], v[1], v[2]);
      assert(Math.abs(speed - 0.42 * 90) < 1e-9,
        `starfury: it leaves the well already doing ${speed.toFixed(1)} m/s, thrown by the drum`);
      /* And it is TANGENTIAL — across the radius, not along it. */
      assert(Math.abs(v[0]) < 1e-12, 'starfury: and the throw is tangential, not radial');
    }

    /**
     * ── WHAT IS NOT HERE, AND WHY IT SAYS SO ─────────────────────────────────
     *
     * §5.3 also asks that "launch ends outside the well; land ends inside it;
     * never through the hull". All three need `LEVELS.orbit`, the Cobra bay's
     * geometry and the tractor — none of which exists yet, because §4 says the
     * spike comes first and this is the spike. Naming them here rather than
     * leaving the list looking complete is the point: a check file that quietly
     * covers six of nine clauses is how a gate stops meaning anything.
     */
    /**
     * ── AND WHAT USED TO BE HERE ─────────────────────────────────────────
     *
     * This line read *"launch/land/hull clearance await LEVELS.orbit — §4 puts
     * the spike first, and this is it"*, and it was honest when it was written
     * and stopped being honest the day `Outside.js` and `Launch.js` landed. The
     * three checks below are those three clauses, plus the one nobody had
     * thought to write down: that a PLAYER is flying it.
     */
    assert(true, 'starfury: the spike stands, and the flying is measured below');
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  9. SOMEBODY IS IN IT — §4's "board and launch", measured
   * ════════════════════════════════════════════════════════════════════════
   *
   * One boot, three phases, in the order a sortie happens: board and launch,
   * fly it at the stick, and be killed in the middle of it. One world because
   * a station boot is the expensive part of this file by two orders of
   * magnitude, and because the third phase is destructive and must be last.
   */
  check('starfury: the player is at the stick — a seat, six axes, two cameras, and a sortie that ends', async () => {
    const world = await station(12);
    try {
      const { PLACE, floorOf } = await import('../../src/game/StationPlan.js');
      const { CERT } = await import('../../src/game/FlightOps.js');
      const st = world._station;
      const p = world.player;
      const bay = PLACE.get(5);
      assert(st && st.deck === 12, `the check is standing on deck ${st?.deck}, not 12`);

      /* The cert, signed straight into the cached fold. The LADDER is
       * `flightops.mjs`'s subject and driving it again here would be that
       * suite's assertions in this one's file. */
      world._flight = { v: 1, cert: CERT.map((c) => c.id), gantries: [0, 1, 2], boards: 3, bells: [], sorties: 0 };
      p.position.set(bay.door[0], floorOf(bay), bay.door[1]);
      p.body?.position?.copy(p.position);

      const input = stick();
      const dt = 1 / 60;
      const step = (n, before) => {
        for (let i = 0; i < n; i++) { before?.(i); world.update(dt, input); input.end(); }
      };
      /* What the bay and the circuit say, kept: the lap is CALLED by name and
       * the five sights are named as they go past, and a lap flown wide of the
       * station names none of them. */
      const said = [];
      const notify = world.notify?.bind(world);
      world.notify = (a, b) => { said.push(`${a}: ${b}`); notify?.(a, b); };
      let lapFlownIn = 0, lapSights = 0;

      /* ── PHASE 1: BOARD AND LAUNCH ─────────────────────────────────────
       *
       * THROUGH THE KEY, not through the hook. `Input.touchHitSet.add('focus')`
       * is what a hand on the station key is; this is that set, handed to
       * `world.update` as the frame's device, and everything from
       * `Player._readInput` down runs exactly as it does in a browser. A check
       * that called `cobraBay(world, st)` could not see a seat that never
       * reaches the player.
       */
      step(6);
      const before = p.position.clone();
      step(1, () => input.hit.add('focus'));
      assert(world._sortie && world._sortie.way === 'out',
        'the station key at #5 did not start a launch');
      step(60 * 9);

      const seat = world._seat;
      assert(seat, 'nine seconds after the launch there is nobody in the seat');
      assert(p.driving === seat, "the seat is not on the player's own `driving` field");
      assert(world._flying, 'the launch never went outside');

      /**
       * ══ THE BODY MOVES WITH THE SHIP, AND THIS IS THE MEASUREMENT ══════
       *
       * A DISPLACEMENT AND NOT A FLAG. Before this lane the sortie set
       * `world._flying` true and every other statement about it was that flag
       * read back: the body moved 0.703 m across a whole sortie and stood in
       * the launch well for thirty-six seconds while a shader said otherwise.
       * A hundred metres is well under what a nine-second launch covers — the
       * drum throws it at 29.7 m/s before the throttle is touched — and well
       * over anything a man on his feet in a bay could do.
       */
      const moved = p.position.distanceTo(before);
      assert(moved > 100, `the player's body moved ${moved.toFixed(1)} m with the ship — it used to move 0.7`);
      const craftAt = seat.craft.position;
      assert(Math.hypot(p.position.x - craftAt[0], p.position.y - craftAt[1], p.position.z - craftAt[2]) < 0.01,
        'the body is not where the craft is');
      assert(Math.abs(p.velocity.length() - seat.speed) < 0.01,
        `the body's velocity is ${p.velocity.length().toFixed(1)} against the craft's ${seat.speed.toFixed(1)} m/s`);

      /* ── PHASE 2: THE SIX AXES ─────────────────────────────────────────
       *
       * Each from a stopped, level craft, one axis at a time, for one second.
       * The mouse is re-armed BEFORE every update because it is a per-frame
       * delta; a check that set it once measured a single frame and read 0.063
       * rad/s where the answer is 1.886.
       */
      const c = seat.craft;
      const rest = () => { c.velocity = [0, 0, 0]; c.angularVelocity = [0, 0, 0]; c.orientation = [1, 0, 0, 0]; };
      const axes = {};

      rest(); step(60, () => { input.ax.y = 1; }); input.ax.y = 0;
      axes.throttle = c.worldToBody(c.velocity)[2];
      assert(axes.throttle > 15,
        `THROTTLE: a second of the move key makes ${axes.throttle.toFixed(2)} m/s down the nose`);

      rest(); step(60, () => { input.ax.x = 1; }); input.ax.x = 0;
      axes.sway = c.worldToBody(c.velocity)[0];
      assert(axes.sway > 0.2, `SWAY: a second of it makes ${axes.sway.toFixed(2)} m/s across the hull`);

      rest(); input.held.add('jump'); step(60); input.held.delete('jump');
      axes.heave = c.worldToBody(c.velocity)[1];
      assert(axes.heave > 0.2, `HEAVE: a second of it makes ${axes.heave.toFixed(2)} m/s up`);

      rest(); input.held.add('rollR'); step(60); input.held.delete('rollR');
      axes.roll = c.angularVelocity[2];
      assert(Math.abs(axes.roll) > 0.3, `ROLL: a second of it makes ${axes.roll.toFixed(3)} rad/s about the nose`);
      assert(Math.hypot(...c.velocity) < 1e-6, 'ROLL: and it does not shove the craft sideways');

      rest(); step(60, () => { input.mouse.dx = 30; });
      axes.yaw = c.angularVelocity[1];
      const yawedTo = c.forward;
      assert(Math.abs(axes.yaw) > 0.5, `YAW: a second of stick makes ${axes.yaw.toFixed(3)} rad/s`);
      assert(Math.abs(yawedTo[0]) > 0.3, `YAW: and the nose actually swung — it is at (${yawedTo.map((n) => n.toFixed(2)).join(', ')})`);

      rest(); step(60, () => { input.mouse.dy = 30; });
      axes.pitch = c.angularVelocity[0];
      const pitchedTo = c.forward;
      assert(Math.abs(axes.pitch) > 0.5, `PITCH: a second of stick makes ${axes.pitch.toFixed(3)} rad/s`);
      assert(pitchedTo[1] < -0.3,
        `PITCH: and screen-down is nose-down — the nose is at (${pitchedTo.map((n) => n.toFixed(2)).join(', ')})`);

      /* SIX, AND THEY ARE SIX DIFFERENT THINGS. A control scheme where two
       * keys drive one axis reads as six and is five, which is exactly what
       * roll was before `auroraThrusters` grew its couple. */
      assert(Object.values(axes).every((v) => Math.abs(v) > 0.2), 'one of the six axes does nothing');

      /* ── THE TWO BRAKES ────────────────────────────────────────────────── */
      c.angularVelocity = [0.5, -0.35, 0.22];
      const spun = Math.hypot(...c.angularVelocity);
      input.held.add('blade'); step(60 * 6); input.held.delete('blade');
      const stilled = Math.hypot(...c.angularVelocity);
      assert(stilled < spun * 0.25,
        `KILL ROTATION: the guard key took ${spun.toFixed(3)} rad/s down to ${stilled.toFixed(3)} in six seconds`);

      rest(); c.velocity = [0, 0, 90];
      input.held.add('sprint'); step(60 * 8); input.held.delete('sprint');
      assert(c.speed < 10,
        `KILL VELOCITY: eight seconds of it took 90 m/s down to ${c.speed.toFixed(1)}`);

      /* ── THE TWO CAMERAS ───────────────────────────────────────────────
       *
       * `view` is the key that already toggles `camera.firstPerson` inside
       * `Player._readInput`'s driving branch, so what is asserted is not that
       * a boolean flipped — it is that the LENS actually moved from behind the
       * airframe into the cockpit, measured against where the craft is.
       */
      rest(); step(3);
      const chase = p.camera.pos.distanceTo(p.position);
      assert(!p.camera.firstPerson, 'a launch does not start in the chase camera');
      step(1, () => input.hit.add('view'));
      step(30);
      const pit = p.camera.pos.distanceTo(p.position);
      assert(p.camera.firstPerson && pit < 0.5,
        `COCKPIT: the lens is ${pit.toFixed(2)} m off the airframe`);
      assert(chase > 8, `CHASE: and the chase lens was ${chase.toFixed(1)} m behind it`);
      /* AND THE RIG IS BOLTED TO THE NOSE. A camera the ship's attitude does
       * not steer is a camera in a different vehicle. */
      c.orientation = [1, 0, 0, 0]; step(2);
      const yaw0 = p.camera.yaw;
      step(30, () => { input.mouse.dx = 30; });
      assert(Math.abs(p.camera.yaw - yaw0) > 0.2,
        `the camera follows the airframe — it moved ${(p.camera.yaw - yaw0).toFixed(3)} rad with the nose`);
      step(1, () => input.hit.add('view'));

      /* ── EVERY KEY OF `st.bay` HAS A READER ────────────────────────────
       *
       * ══ THE DEFECT THIS ASSERTION EXISTS FOR ════════════════════════
       *
       * `Launch.js` drove five numbers into `st.bay` on every frame of every
       * launch and NOTHING IN THE TREE READ ANY OF THEM. After a flown sortie
       * the record read `{canopy:1, lights:0, rams:1, shaft:1, scroll:34}` into
       * a vacuum, and `sortieSink`'s own comment said the four things they
       * describe "are the room's to draw" while the room drew none of them.
       *
       * BOTH HALVES ARE DERIVED. The keys come off the LIVE record a real
       * launch just built — not a list typed here, which is the way this
       * assertion would rot the first time a sixth number joined the sink —
       * and the readers come off a grep of `src/`, with comments stripped,
       * excluding the file that WRITES them. A field whose only mention is in
       * its own writer is exactly the state this is looking for.
       */
      {
        const keys = Object.keys(st.bay || {});
        assert(keys.length >= 4, `the launch built a bay record of ${keys.length} numbers`);
        const src = new URL('../../src/', import.meta.url);
        const files = [];
        const walk = async (dir) => {
          for (const e of await readdir(dir, { withFileTypes: true })) {
            const at = new URL(`${e.name}${e.isDirectory() ? '/' : ''}`, dir);
            if (e.isDirectory()) await walk(at);
            else if (e.name.endsWith('.js')) files.push(at);
          }
        };
        await walk(src);
        const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        const bodies = new Map();
        for (const f of files) bodies.set(String(f).split('/src/')[1], strip(await readFile(f, 'utf8')));
        /* The writer is the sink in `Station.js`: a key mentioned only there is
         * a key with no reader, which is the whole finding. */
        const orphans = [];
        for (const k of keys) {
          const re = new RegExp(`\\bbay\\??\\.${k}\\b`);
          const readers = [...bodies].filter(([n, t]) => n !== 'game/Station.js' && re.test(t)).map(([n]) => n);
          if (!readers.length) orphans.push(k);
        }
        assert(orphans.length === 0,
          `${orphans.length} of the launch's numbers are written to nobody: ${orphans.join(', ')} `
          + '— either the room draws them or the field goes');
        /* …and the room really is standing there to draw them on. */
        assert(st.bayRig && st.bayRig.draws > 0,
          'the Cobra bay dressed no fighter — `starfury.smesh` is decoded on every visit and drawn by nobody');
      }

      /* ── PHASE 3: THE ROUND TRIP, AND IT IS THE PLAYER'S ───────────────
       *
       * ══ THE DEFECT THIS PHASE EXISTS FOR ═══════════════════════════════
       *
       * Nothing in the suite had ever flown a lap through a player. The one
       * round trip that was certified — `flightops.mjs` — drives `stepStation`
       * directly, which never runs `Player.update`, so `seat.tick` stays false
       * and `stepSortie` flies the craft with `autoStep`: the autopilot, on
       * the player's behalf, with the stick untouched. Measured at the stick
       * instead, with the throttle held and nothing else, the craft flew
       * straight off the circuit and `u` went 0.193 → 0.221 in FOUR MINUTES
       * before the ceiling towed it home.
       *
       * So this flies the loop by hand and asserts the two things that
       * separate a player's lap from a tow: `PlayerPilot.update` ran on every
       * frame (the `tick` the station reads), and `autoStep` — the station
       * flying it for you — ran on NONE.
       */
      {
        const mod = {
          ...(await import('../../src/game/Outside.js')),
          ...(await import('../../src/game/Pilot.js')),
          V: (await import('../../src/game/Starfury.js')).V,
        };
        /* THE TWO COUNTERS. `stepSortie` clears `tick` five steps after
         * `Player.update` sets it, so a check reading the field between frames
         * always sees false — it has to be watched as it is written. */
        let ticks = 0, autos = 0, held = seat.tick;
        Object.defineProperty(seat, 'tick', {
          get: () => held, set: (v) => { if (v) ticks++; held = v; }, configurable: true,
        });
        const auto = seat.autoStep.bind(seat);
        seat.autoStep = (adt) => { autos++; return auto(adt); };

        const lapAt = seat.lap;
        let flown = 0;
        while (world._seat === seat && !seat.left && flown < 60 * 150) {
          flyRound(seat, input, mod);
          world.update(dt, input); input.end();
          flown++;
        }
        input.ax.x = 0; input.ax.y = 0;
        input.held.delete('jump'); input.held.delete('crouch');
        assert(ticks === flown,
          `the player's own tick drove ${ticks} of ${flown} frames — the rest were flown by the station`);
        assert(autos === 0,
          `${autos} frames were flown by \`autoStep\` — that is the autopilot's round trip, not the player's`);
        assert(seat.lap > lapAt,
          `${(flown / 60).toFixed(0)} s at the stick and the lap never closed — u is at ${seat.u.toFixed(3)}`);
        assert(!world._seat, 'the closed lap did not empty the seat');
        assert(said.some((l) => /a lap of the station/.test(l)),
          `the bay never called the lap: "${said.slice(-3).join(' / ')}"`);
        /* AND IT WENT PAST THE HANGAR. §4's loop is "fly past your own hangar
         * and look in" — the sights are named off the craft's own position, so
         * a lap flown wide of the station names none of them. */
        const sights = said.filter((l) => l.startsWith('OUTSIDE:')).length;
        assert(sights >= 3, `${sights} of the five sights were named on a flown lap`);
        assert(said.some((l) => /flight deck's mouth|hangar/i.test(l)),
          'the lap never passed the flight deck — that is the one sight §4 names');
        lapFlownIn = flown / 60;
        lapSights = sights;

        /* …and the recovery it started brings the fighter in and files it.
         * TO THE END OF THE SEQUENCE and not to the swap: `outside(false)`
         * puts the player back inside a phase and a half BEFORE `Sortie._end`
         * calls `done`, which is the call that files the flight. A loop that
         * stopped at `_flying` read the fold one phase early and saw 0. */
        let home = 0;
        while ((world._flying || (world._sortie && !world._sortie.done)) && home < 60 * 60) {
          world.update(dt, input); input.end(); home++;
        }
        assert(!world._flying, 'the recovery never finished');
        assert(world._flight.sorties === 1,
          `${world._flight.sorties} sorties filed for one flown round trip`);
        assert(!p.driving && !world._seat, 'the pilot is still in a seat after the recovery');
      }

      /* ── PHASE 4: SHOT DOWN ────────────────────────────────────────────
       *
       * ══ TWO DEFECTS, AND THE FIRST ONE KILLED THE FRAME ════════════════
       *
       * `Player.damage`'s driving branch read `this.driving.vehicle.damage?.()`
       * — `Driving.Crew`'s field, which a Starfury seat does not have — so
       * ANY blow that reached a seated pilot threw
       * `Cannot read properties of undefined` out of `Player.update` and took
       * the rest of the frame with it. One 20-point blast, seated, was enough.
       *
       * And the second was hiding behind it: `Player.die` has exactly ONE
       * production caller and it is BELOW that branch, so a flying player
       * could not die at all. `landPlayer`'s dead-pilot path — the whole of
       * the recovery a killed pilot gets — was reachable only by this check
       * calling `p.die()` by hand, which is a door no player has. THAT IS WHY
       * THIS PHASE NOW GOES THROUGH `damage`: the airframe is a hull, it takes
       * what the pilot would have taken, and when it is finished the pilot
       * goes with it.
       */
      const relaunch = async () => {
        while (world._sortie && !world._sortie.done) { world.update(dt, input); input.end(); }
        step(6);
        step(1, () => input.hit.add('focus'));
        let n = 0;
        while (!world._seat && n < 60 * 30) { world.update(dt, input); input.end(); n++; }
        assert(world._seat, 'the bay would not launch a second sortie');
        return world._seat;
      };
      const seat2 = await relaunch();
      {
        const { AIRFRAME } = await import('../../src/game/Pilot.js');
        const hp0 = p.hp;
        /* THE BLOW THAT USED TO THROW. */
        const killed = p.damage(100, p.position.clone(), null, 'blast');
        assert(killed === false, 'a survivable blast reported a kill');
        assert(p.hp === hp0,
          `the blast went through the airframe to the pilot — hp ${hp0} → ${p.hp}`);
        assert(seat2.hull === AIRFRAME.hull - 100,
          `the airframe took ${AIRFRAME.hull - seat2.hull} of a 100-point blast`);
        assert(p.alive && world._flying && p.driving === seat2,
          'a hundred points took the pilot out of a 300-point airframe');
        /* AND THE FRAME AFTER IT STILL RUNS — the whole of the crash. */
        step(3);
        assert(world._flying && p.driving === seat2, 'the frame after a blow while seated did not survive it');
      }

      /* ── AND KILLED MID-FLIGHT ─────────────────────────────────────────
       *
       * ══ THE DEFECT, MEASURED ════════════════════════════════════════
       *
       * With the player killed outside, the sortie froze at `u = 0.332` and
       * stayed there for **186 simulated seconds**: `world._flying` true,
       * `_sortie.done` true, `fold.sorties` never written, and no recovery path
       * of any kind. It could not have had one where it was looking:
       * `World._checkWipe` sets `over` on the last player down and
       * `World.update` gated the whole station director off behind it, so the
       * clock, the ward, the boards and the shelves stopped with the sortie.
       *
       * Both halves are asserted, because either one alone is still a stuck
       * station: the SORTIE must end, and the STATION must be released.
       */
      assert(world._flying, 'this phase needs a craft that is still outside');
      const sortiesBefore = world._flight.sorties;
      const hourAtDeath = st.hour;
      /* THROUGH THE DOOR A PLAYER HAS, and that is the whole change: the blow
       * goes to `Player.damage`, `Player.damage` gives it to the airframe, the
       * airframe runs out, and the airframe kills the pilot. `p.die()` by hand
       * reached this recovery for months while nothing in the game could. */
      const finished = p.damage(seat2.hull, p.position.clone(), null, 'blast');
      assert(finished === true,
        'the blow that finished the airframe did not report the kill it made');
      assert(p.alive === false, 'the airframe was destroyed and the pilot flew on');
      assert(world.over, 'the wipe flag is not set — the phase is not testing what it says');
      assert(!world._flying,
        'the player was killed outside and the sortie did not end on the same frame');
      assert(!world._seat && !p.driving, 'the seat is still occupied by a corpse');
      assert(world._flight.sorties === sortiesBefore + 1,
        `the sortie was never filed — fold.sorties is still ${world._flight.sorties}`);
      assert(st.mine === null, "the tower's board still carries a movement that is not happening");
      /* AND SOMEWHERE SANE, which is where it was standing when it got in —
       * not a height computed off the plan. `floorOf(#5)` is where the ROOM is
       * dressed; measured, a body teleported to it was somewhere else entirely
       * on the next frame. See `takeSeat`'s note. */
      const home = p.position.distanceTo(before);
      assert(home < 3,
        `the body was left ${home.toFixed(0)} m from where it boarded, at `
        + `${p.position.toArray().map((n) => n.toFixed(1)).join(', ')}`);
      assert(Object.values(st.bay).every((v) => v === 0),
        `the bay was left mid-launch: ${JSON.stringify(st.bay)}`);

      /* AND THE STATION RUNS AFTERWARDS. Ten seconds of clock is 0.083 of an
       * hour at `tickStationClock`'s rate; anything above nought is the gate
       * open, and the exact figure is printed so a regression reads as a
       * number rather than as a boolean. */
      step(60 * 10);
      const ran = st.hour - hourAtDeath;
      assert(ran > 0.05,
        `the station clock ran ${(ran * 60).toFixed(1)} minutes in the ten seconds after the death — it used to run 0.0`);
      return `body moved ${moved.toFixed(0)} m at the stick · six axes live · `
        + `a lap flown by hand in ${lapFlownIn.toFixed(0)} s past ${lapSights} sights, filed · `
        + `shot down at the stick · clock +${(ran * 60).toFixed(1)} min after an interrupted sortie`;
    } finally { world.dispose?.(); }
  });
}
