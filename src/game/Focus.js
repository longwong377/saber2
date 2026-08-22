/**
 * BATTLEFRONT BORZ — Focus.
 *
 * In the fiction a Jedi is not faster than a blaster bolt; they simply have
 * more time inside the same second than you do. This is the system that lets
 * the player borrow some of that, and it is deliberately built in two layers
 * that stack, because they solve two different problems.
 *
 * The PASSIVE layer is a small, free, automatic dip whenever a bolt is genuinely
 * about to hit you. It exists so that a new player is not simply killed by
 * physics — a bolt crossing the last few metres does it in under a fifth of a
 * second, which is inside human reaction time. Nobody blocks that by reacting;
 * they block it by having already been in the right place. The passive dip buys
 * back just enough that reacting is possible at all. It costs nothing, it is
 * shallow, and a good player barely notices it.
 *
 * The HELD layer is deep, expensive, and entirely the player's decision. It is
 * the one you get good at. Because it drains Force and Force is also what your
 * powers cost, holding it is always a trade: every second spent inside Focus is
 * a Force push you cannot make. That is the choice the whole system exists to
 * create — block this volley, or save the Force and move instead.
 *
 * Both layers slow the WORLD more than they slow the PLAYER. That asymmetry is
 * the entire point: it is not bullet time, it is you being fast.
 */

import { clamp, damp } from '../engine/MathUtil.js';

export const FOCUS = {
  // passive: free, shallow, automatic
  passiveScale: 0.75,      // world runs at this while a bolt is closing
  passiveEta: 0.30,        // seconds-to-impact that arms it
  passiveRange: 26,        // only bolts this close are considered

  /*
   * HELD: DEEP, COSTLY, DELIBERATE — and it was not deep enough.
   *
   * 0.35 was reported as "slow-motion bolts are still too fast", and the
   * arithmetic agrees. A blaster bolt travels at 90 m/s; at 0.35 it is still
   * covering 31 m/s, so a bolt fired from ten metres reaches you in 0.32 s.
   * That is not bullet time, it is a slightly slower bolt — and the whole point
   * of spending 38 Force a second is to be given TIME to answer with a guard.
   *
   * 0.18 puts the same bolt at 16 m/s and 0.62 s of flight, which is long
   * enough to see where it is going and flick into the zone. The player is
   * compensated back up to `playerScale` of real time as before, so the
   * asymmetry — you fast, world slow — widens with it rather than the player
   * simply being slowed too.
   */
  heldScale: 0.18,         // world time scale at full Focus
  playerScale: 0.85,       // the player keeps most of their own speed
  drain: 38,               // Force per second while held
  minToEnter: 8,           // do not let it flicker on at empty
  attack: 14,              // how fast it engages (1/s)
  release: 9,              // and lets go
};

export class FocusSystem {
  constructor(opts = {}) {
    Object.assign(this, FOCUS, opts);
    this.held = 0;          // 0..1 blend of the held layer
    this.passive = 0;       // 0..1 blend of the passive layer
    this.active = false;    // is the player asking for it
    this.scale = 1;         // world time scale this frame
    this.playerCompensation = 1;  // multiply player dt by this
    this.nearestEta = Infinity;
  }

  /**
   * @param want    is the Focus key held
   * @param force   the player's current Force, in points
   * @param threats [{ eta }] from BoltPool.threatsNear
   * @returns Force spent this frame
   */
  update(dt, want, force, threats) {
    // ── passive: arm on the closest bolt that is actually about to arrive
    let eta = Infinity;
    if (threats) {
      for (let i = 0; i < threats.length; i++) {
        const t = threats[i];
        if (t.eta >= 0 && t.eta < eta && (t.dist ?? 0) < this.passiveRange) eta = t.eta;
      }
    }
    this.nearestEta = eta;
    const passiveWant = eta < this.passiveEta ? 1 : 0;
    // engages fast (the bolt is already on its way) and lets go gently
    this.passive = damp(this.passive, passiveWant, passiveWant ? 26 : 7, dt);

    // ── held: only while asked for, and only while there is Force to burn
    const canHold = want && force > this.minToEnter;
    this.active = !!canHold;
    this.held = damp(this.held, canHold ? 1 : 0, canHold ? this.attack : this.release, dt);
    if (this.held < 0.002) this.held = 0;
    if (this.passive < 0.002) this.passive = 0;

    // ── combine. Each layer is a factor, so they stack multiplicatively and
    // neither can ever push time to zero or negative.
    const p = 1 - this.passive * (1 - this.passiveScale);
    const h = 1 - this.held * (1 - this.heldScale);
    this.scale = clamp(p * h, 0.05, 1);

    // The player is compensated back up toward their own speed, but only for
    // the HELD layer — the passive dip is meant to slow everything including
    // you, so it reads as a held breath rather than a speed boost.
    //
    // The player should run at `playerScale` of real time while the world runs
    // at `heldScale`, so the factor that turns world-dt into player-dt is
    // (player's own held factor) / (world's held factor). At full Focus that is
    // `playerScale / heldScale` — 0.85 / 0.18 = 4.72 — which lands the player
    // at 0.85x real time; at zero it is exactly 1 and costs nothing.
    //
    // The arithmetic used to be written out as `0.85 / 0.35 = 2.43`, and it
    // stopped being true the round `heldScale` went from 0.35 to 0.18 — the
    // same edit whose own note, twenty lines up, explains why 0.35 was not deep
    // enough. Two numbers in one file disagreeing about one field is exactly
    // the drift the Codex row for this power was already caught in
    // (src/ui/Menu.js said "slows to a third"), so the ratio is named rather
    // than multiplied out.
    const hPlayer = 1 - this.held * (1 - this.playerScale);
    this.playerCompensation = clamp(hPlayer / h, 1, 1 / this.heldScale);

    return canHold ? this.drain * dt * this.held : 0;
  }

  /** 0..1 for the HUD ring — how much time is being bent right now. */
  intensity() { return clamp(1 - this.scale, 0, 1) / (1 - this.heldScale); }

  reset() { this.held = 0; this.passive = 0; this.scale = 1; this.active = false; }
}
