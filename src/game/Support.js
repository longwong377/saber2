/**
 * BATTLEFIELD BORZ — WAR SUPPORT, the thing a stratagem actually costs.
 *
 * ── THE NOTE ─────────────────────────────────────────────────────────────
 *
 * "strategems should not cost force how does that even fucking make sense?
 *  maybe there's a bar and it shows the level of outside support and resources
 *  that have built up, and different strategems cost more obviously but when
 *  you use them it depletes your side's support resources so like carriers
 *  rearming, etc. does that make sense?"
 *
 * It makes complete sense and the old arrangement did not. `Stratagems._open`
 * called `player._spend(s.cost)` — the same pool that buys a Force push — so
 * calling in an orbital strike was paid for out of the Jedi's own connection to
 * the Force. Nothing in the fiction, the interface or the mechanics supported
 * that, and it had a real cost in play: every stratagem competed directly with
 * every Force power for one bar, so a run that leaned on the comm could not
 * lift a walker, and the two systems that were supposed to be different ways of
 * fighting were one resource with two spouts.
 *
 * ── WHAT IT IS ───────────────────────────────────────────────────────────
 *
 * A pool that belongs to YOUR SIDE rather than to your body. It is not stamina
 * and it is not mana: it is what the fleet has spare for you, and it behaves
 * like a supply line rather than like a battery.
 *
 *   IT BUILDS BY ITSELF, slowly, because ships rearm and crews turn rounds
 *     around whether or not you are doing well.
 *   IT BUILDS FASTER WHEN THE BATTLE IS GOING YOUR WAY. Holding ground and
 *     killing things is what earns a fleet's attention, so `credit` is called
 *     from the same places the score is.
 *   IT DOES NOT REFILL INSTANTLY AFTER A CALL. `REARM` is a hold on the regen
 *     after every spend, and it is the whole of "carriers rearming": the bar
 *     does not begin recovering the moment the strike lands, it begins
 *     recovering once the ship that flew it is ready again.
 *   AND IT IS SHARED. In co-op it is one pool for the party — a side has one
 *     supply line — which is what makes spending it a thing to talk about.
 *
 * ── WHERE IT IS NOT ──────────────────────────────────────────────────────
 *
 * It is deliberately NOT a per-level or per-run persistent number. `Progress.js`
 * is the written law that this game has no cross-run power, and a support pool
 * you bank between runs is a meta-progression wearing a supply metaphor.
 */

import { clamp } from '../engine/MathUtil.js';

/**
 * THE CEILING, and everything below is priced against it.
 *
 * 100 is the whole of what your side can put behind you at once. `supportCost`
 * scales every row so the dearest call on the table lands at half the bar —
 * measured, the orbital strike is 40 Force and 50 support — so the bar holds
 * two heavy calls or four light ones, and a smoke screen at 15 is something you
 * can always afford. That is the shape the note asks for: "different strategems
 * cost more obviously but when you use them it depletes your side's support
 * resources".
 */
export const SUPPORT_MAX = 100;

/** Where a battle opens. Enough for one heavy call or two light ones, so the
 *  first minute is a choice rather than a wait. */
export const SUPPORT_START = 55;

/**
 * THE STANDING TRICKLE, per second. 100 / 2.4 = 42 s to fill from empty, which
 * is a little longer than the longest cooldown on the table — so on a quiet
 * field the cooldowns are what limit you and the pool never is. It is the busy
 * field where it bites, which is where it is supposed to.
 */
export const SUPPORT_REGEN = 2.4;

/**
 * CARRIERS REARMING. After a spend the trickle stops for this long, scaled by
 * how big the spend was: `REARM * (cost / SUPPORT_MAX)`, so a smoke screen
 * costs a second and a half of recovery and an orbital strike costs seven.
 *
 * This is the mechanical content of the player's own phrase. Without it the
 * pool is a second cooldown with extra steps; with it, spending big means the
 * NEXT call is further away than its own cooldown says, and the decision is
 * about the shape of the whole engagement rather than about one button.
 */
export const REARM = 16;

/**
 * WHAT EARNS IT. Every one of these is a thing the side is doing well, and the
 * numbers are per event.
 *
 *   `kill`      a hostile down. The commonest event in the game, so it is
 *               small — a hundred kills is the whole bar, twice.
 *   `wave`      a wave cleared. The engagement's own boundary.
 *   `area`      a piece of ground held. Command's `_areaClear`.
 *   `objective` anything a mode calls a win short of the end.
 */
export const SUPPORT_EARN = { kill: 0.55, wave: 9, area: 22, objective: 14 };

export class WarSupport {
  constructor(opts = {}) {
    this.max = opts.max ?? SUPPORT_MAX;
    this.value = clamp(opts.start ?? SUPPORT_START, 0, this.max);
    /** Seconds of rearm still owed before the trickle resumes. */
    this.rearm = 0;
    /** For the HUD: what the last spend was and how long ago. */
    this.lastSpend = 0;
    this.lastAt = -99;
    this.t = 0;
    /** Total credited and spent this battle, which the readout uses. */
    this.earned = 0;
    this.spent = 0;
  }

  get frac() { return this.max > 0 ? this.value / this.max : 0; }
  /** True while the ships are turning round — the HUD draws the bar differently. */
  get rearming() { return this.rearm > 0; }

  /** Can this side afford a call of this size? */
  canAfford(cost) { return this.value >= cost - 1e-6; }

  /**
   * Spend, or refuse. Refusing changes nothing — a call you could not afford is
   * a call you did not make, and the code was still spoken, which is the cost
   * `Stratagems._open`'s own note is about.
   */
  spend(cost) {
    if (!this.canAfford(cost)) return false;
    this.value -= cost;
    this.spent += cost;
    this.lastSpend = cost;
    this.lastAt = this.t;
    /* THE REARM IS PROPORTIONAL. See REARM: a big call takes the supply line
     * out for longer, and it is ADDED rather than assigned so two calls in
     * quick succession genuinely compound. */
    this.rearm += REARM * (cost / this.max);
    return true;
  }

  /**
   * The side did something worth supporting. `kind` is a key of SUPPORT_EARN,
   * or a bare number for a caller that wants to say so itself.
   */
  credit(kind, n = 1) {
    const v = typeof kind === 'number' ? kind : (SUPPORT_EARN[kind] ?? 0) * n;
    if (!(v > 0)) return 0;
    const before = this.value;
    this.value = clamp(this.value + v, 0, this.max);
    const got = this.value - before;
    this.earned += got;
    return got;
  }

  update(dt) {
    if (!(dt > 0)) return;
    this.t += dt;
    if (this.rearm > 0) {
      this.rearm = Math.max(0, this.rearm - dt);
      return;
    }
    this.value = clamp(this.value + SUPPORT_REGEN * dt, 0, this.max);
  }

  /** Everything the HUD needs, in one object, derived. */
  readout() {
    return {
      value: this.value,
      max: this.max,
      frac: this.frac,
      rearming: this.rearming,
      rearm: this.rearm,
      earned: this.earned,
      spent: this.spent,
    };
  }
}
