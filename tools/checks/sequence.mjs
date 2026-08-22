/**
 * BATTLEFRONT BORZ — THE LEFT BUTTON'S SEQUENCE, DRIVEN THROUGH A REAL WORLD.
 *
 *   "obviously pressing it closely in succession will do like an attack
 *    sequence of some sort, maybe like three clicks will be two light attacks
 *    and then a heavy slash you can hold and release for more power idk"
 *
 * `tools/checks/directional.mjs` drives that sequence's STATE MACHINE against a
 * hand-built input stub, and it is right about every state it names. What it
 * cannot see is what the state does to the WEAPON, because it never builds one
 * body to hold it — and the defect that lived here for the whole life of the
 * feature was in exactly that gap.
 *
 * ── THE CHAMBER BLEW THE GUARD UP, AND IT WAS AN ORDERING BUG ─────────────
 *
 * `SaberController.applyInput` composes the attacks as ADDITIVE OFFSETS on the
 * guard point: the frame opens by subtracting last frame's offsets off `gx/gy`,
 * every attack writes its own, and one line at the end puts them back. That
 * line sat ABOVE the sequence block, and the held heavy's chamber pose is
 * written INSIDE it — so the chamber's offset was never added, and the removal
 * at the top of the next frame subtracted it anyway.
 *
 * That is not "the pose does nothing". With the chamber settled the offset is
 * `clamp(±1) − gx`, so subtracting it gives `gx' = 2·gx ∓ 1`: the guard point
 * DOUBLES every frame, and the recentre's own pull leaves a net 1.7x. Measured
 * through the real Player, holding the third press:
 *
 *     0.26 s   |gx| 7.7e5     (the guard's whole travel is 1.0)
 *     1.01 s        4.2e26
 *     5.00 s        1.0e137
 *
 * `guardDir` takes sin/cos of that, so the blade pointed somewhere different
 * and meaningless every frame; `slashArc`/`slashAcross` hand the same numbers
 * to `Player._attackDrive`, which drives the trunk with them. At 0.9 s of hold
 * the blade tip read 7.6e22 m above the player's feet at 2.0e25 m/s.
 *
 * ── AND NOBODY WAS CHARGED FOR STANDING THERE ────────────────────────────
 *
 * `CHARGE.drain` and `HEAVY.drain` are spent through `ctx.onStrain`, and no
 * caller had ever supplied one — the same shape as `ctx.onSpin`, which
 * `Player` has a paragraph about having found in the same state. Both notes in
 * SaberController say the cost is "what stops the heavy from being a state you
 * enter once and swing out of forever", and it was free, so it was that state.
 *
 * Everything below boots a real World and drives the real `Player.handleInput`,
 * because both defects are in the seam between the controller and its caller
 * and neither is visible from either side alone.
 */

import { clocked } from './_shared.mjs';

/** A real World, a real local Player, and a keyboard we can hold buttons on. */
async function armed() {
  const H = await import('./_coop.mjs');
  const { world } = await H.bootWorld({ settings: { mode: 'sandbox', difficulty: 'knight' } });
  const p = world.player;
  p.saber.lit = true; p.saber.ignition = 1;
  const held = new Set(), hit = new Set();
  const input = {
    ...H.idleInput(),
    act: (id) => held.has(id), actHit: (id) => hit.has(id), actDown: (id) => held.has(id),
  };
  const DT = 1 / 120;
  const step = () => { world.update(DT, input); hit.clear(); };
  for (let i = 0; i < 120; i++) step();          // settle onto the ground
  return {
    world, p, DT, step, held, hit,
    press: (a) => { hit.add(a); held.add(a); },
    release: (a) => held.delete(a),
    /* Feet-relative, so the ground under the player cannot move an answer. */
    tipOverFeet: () => p.saber.tip.y - p.position.y,
  };
}

export async function run({ check, assert }) {
  check = await clocked(check);

  check('sequence: the heavy can be held, and the guard stays inside its own travel', async () => {
    const { GX_MAX, GY_MAX, GY_MIN, HEAVY } = await import('../../src/game/SaberController.js');
    const r = await armed();
    const { p } = r;

    /* Straight to the third press. The sequence STATE is the entry condition —
     * `directional.mjs` is what proves three presses reach it — and driving two
     * live cuts first only moves the body this measures. */
    p.control.comboStep = 1;
    p.control.comboTimer = 1;
    r.press('thrust');
    r.step();
    assert(p.control.heavyArmed, 'the third press did not chamber — this check is not driving the heavy');

    /* FIVE SECONDS OF HOLD. The runaway needed about eleven to overflow to
     * Infinity outright, and a quarter of a second to leave the guard box by
     * six orders of magnitude, so this is far past where it is visible and far
     * short of anything a player would call patient. */
    let worstX = 0, worstY = 0, worstTip = 0, frames = 0;
    for (let i = 0; i < 600; i++) {
      r.step();
      frames++;
      worstX = Math.max(worstX, Math.abs(p.control.gx));
      worstY = Math.max(worstY, Math.abs(p.control.gy));
      worstTip = Math.max(worstTip, Math.abs(r.tipOverFeet()));
      if (!Number.isFinite(p.saber.tip.x + p.saber.tip.y + p.saber.tip.z)) break;
    }
    assert(p.control.heavyArmed,
      `the heavy let go of itself after ${frames} frames — a chambered blade waits for the button`);
    /* The guard point is in units of its own travel, so the box IS the bound
     * and there is no second number to type. A hair of tolerance for the
     * spring's own overshoot at the clamp. */
    assert(worstX <= GX_MAX + 1e-6 && worstY <= Math.max(GY_MAX, GY_MIN) + 1e-6,
      `chambering drove the guard to (${worstX.toExponential(2)}, ${worstY.toExponential(2)}) against a `
      + `travel box of (${GX_MAX}, ${Math.max(GY_MAX, GY_MIN)}) — the chamber pose is being written after `
      + 'the offsets are applied and taken off again before they ever are');
    /* And the weapon is still on the body. A blade solved off a guard outside
     * its own box is not merely mis-posed: it is unbounded. */
    assert(worstTip < 4,
      `the blade tip reached ${worstTip.toExponential(2)} m over the player's feet while the heavy was `
      + 'chambered');
    /* THE POSE IS REAL, which is the other half of the same line: the chamber
     * has to actually put the blade where HEAVY says, and the authored pose is
     * the full width of the guard at `HEAVY.lift` above it. */
    assert(Math.abs(Math.abs(p.control.gx) - HEAVY.rise) < 0.03,
      `the chambered guard sits at |gx| ${Math.abs(p.control.gx).toFixed(3)} against HEAVY.rise `
      + `${HEAVY.rise} — the chamber is not reaching its own pose`);
    assert(Math.abs(p.control.gy - HEAVY.lift) < 0.03,
      `the chambered guard sits at gy ${p.control.gy.toFixed(3)} against HEAVY.lift ${HEAVY.lift}`);

    const poseX = p.control.gx, poseY = p.control.gy;

    /* AND IT GOES ON RELEASE, into a cut and not into a shrug. */
    r.release('thrust');
    r.step(); r.step();
    assert(!p.control.heavyArmed && p.control.isHeavy && p.control.slashT >= 0,
      'letting go of the third press did not swing the heavy');
    let peak = 0;
    for (let i = 0; i < 200 && p.control.slashT >= 0; i++) { r.step(); peak = Math.max(peak, p.saber.tipSpeed); }
    assert(peak > 8,
      `the released heavy peaked the blade at ${peak.toFixed(1)} m/s, under the 8 m/s at which this game's `
      + 'own cutting model says a swing outworks a press');
    return `5 s chambered at (${poseX.toFixed(2)}, ${poseY.toFixed(2)}) inside a `
      + `(${GX_MAX}, ${Math.max(GY_MAX, GY_MIN)}) box, tip within ${worstTip.toFixed(2)} m; released at `
      + `${peak.toFixed(1)} m/s`;
  });

  check('sequence: winding a blade costs the arm that holds it', async () => {
    /**
     * Both charges are priced in SaberController and both were free. The
     * amounts are read from the tables rather than typed, so this measures the
     * PROPERTY — a hold costs and a tap does not — and cannot drift when either
     * number is tuned.
     *
     * `CHARGE.drain` and `HEAVY.drain` are fractions of the bar per second and
     * only run above their own `hold` threshold, so the most either can cost is
     * `(full − hold) × drain` of the bar. Half of that is a floor no rounding
     * can reach and no tap can clear.
     */
    const { CHARGE, HEAVY } = await import('../../src/game/SaberController.js');
    /* ONE WORLD, FOUR ARMS. Booting a World is the expensive thing in this file
     * and HANDOFF §2.7 is about suites that hold several alive at once; what is
     * measured here is a stamina bar, which no random stream touches, so a
     * shared rig costs the measurement nothing. `reset` is the controller's own
     * one door onto its attack state, so no arm inherits the last one's clock. */
    const rig = await armed();
    const { p } = rig;
    const spend = (action, holdFrames, combo) => {
      /* `reset` is the controller's ONE DOOR onto its attack state and it now
       * clears all five cooldowns; before it did, this arm read a tapped heavy
       * as costing 0.0% of the bar — not because the press was free but
       * because `thrustCooldown`, left armed by the arm above, refused it. A
       * check that passes on a press that never happened is worse than no
       * check, so the door is asserted rather than assumed. */
      p.control.reset(p.chest, p.camera.aimQuat);
      assert(p.control.thrustCooldown <= 0 && p.control.slashCool <= 0 && p.control.swingCool <= 0
        && p.control.spinCool <= 0,
        'reset() left an attack cooldown armed, so the arms below are measuring refused presses');
      p.control.comboStep = combo; p.control.comboTimer = combo ? 1 : 0;
      p.staminaHold = 0;
      p.stamina = p.maxStamina;
      rig.press(action);
      let low = p.stamina;
      for (let i = 0; i < holdFrames; i++) { rig.step(); low = Math.min(low, p.stamina); }
      rig.release(action);
      for (let i = 0; i < 40; i++) { rig.step(); low = Math.min(low, p.stamina); }
      return (p.maxStamina - low) / p.maxStamina;
    };

    const overFull = spend('attackOver', 130, 0);
    const overTap = spend('attackOver', 2, 0);
    const heavyFull = spend('thrust', 130, 1);
    const heavyTap = spend('thrust', 2, 1);

    const overMax = (CHARGE.full - CHARGE.hold) * CHARGE.drain;
    const heavyMax = (HEAVY.full - HEAVY.hold) * HEAVY.drain;
    assert(overFull > overMax * 0.5,
      `holding the overhead to a full charge cost ${(overFull * 100).toFixed(1)}% of the bar against the `
      + `${(overMax * 100).toFixed(1)}% CHARGE.drain prices — nobody is reading ctx.onStrain, so standing `
      + 'at full charge is free and the heavy is a state you live in');
    assert(heavyFull > heavyMax * 0.5,
      `holding the third press to a full charge cost ${(heavyFull * 100).toFixed(1)}% of the bar against `
      + `the ${(heavyMax * 100).toFixed(1)}% HEAVY.drain prices`);
    /* AND A TAP IS STILL A TAP. `hold` exists so a player mashing the sequence
     * never accidentally pays for a charge they did not ask for. */
    assert(overTap < overMax * 0.25,
      `a TAPPED overhead cost ${(overTap * 100).toFixed(1)}% of the bar — CHARGE.hold is supposed to make a `
      + 'tap free');
    /* A TAPPED HEAVY IS NOT FREE — it still opens the lunge, which is its own
     * price — so this is stated as an ORDER and not as a floor of zero, which
     * is the reading that hid a refused press. */
    assert(heavyTap > 0 && heavyFull > heavyTap * 1.5,
      `the third press cost ${(heavyFull * 100).toFixed(1)}% held and ${(heavyTap * 100).toFixed(1)}% `
      + 'tapped — holding a chambered blade has to cost more than letting it go at once');
    return `overhead ${(overTap * 100).toFixed(1)}% tapped → ${(overFull * 100).toFixed(1)}% wound; `
      + `heavy ${(heavyTap * 100).toFixed(1)}% → ${(heavyFull * 100).toFixed(1)}%`;
  });
}
