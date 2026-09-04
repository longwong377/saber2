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

import { readFile } from 'node:fs/promises';
import {
  Starfury, Thruster, auroraThrusters, mountTable, V, BOOM, AFT, RETRO_Z,
} from '../../src/game/Starfury.js';

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
    assert(Object.keys(mounts).length === 9, `starfury: the flight model has nine thrusters — got ${Object.keys(mounts).length}`);
    let worst = 0, worstName = '';
    for (const n of names) {
      const m = manifest.thruster_mounts[n], p = mounts[n];
      if (!p) { assert(false, `starfury: the model has no thruster called ${n}`); continue; }
      const d = Math.hypot(m[0] - p[0], m[1] - p[1], m[2] - p[2]);
      if (d > worst) { worst = d; worstName = n; }
    }
    assert(worst < 1e-9,
      `starfury: every mount is where the geometry was built around it — worst ${worstName} off by ${worst.toExponential(2)} m`);

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
    assert(true, 'starfury: launch/land/hull clearance await LEVELS.orbit — §4 puts the spike first, and this is it');
  });
}
