/**
 * BATTLEFIELD BORZ — WAR SUPPORT, the thing a SUPPORT CALL actually costs.
 *
 * ── THE WORD ─────────────────────────────────────────────────────────────
 *
 * These were called stratagems. That word is Helldivers', the player said so
 * ("they should not be called strategems in game obviously as that's a
 * helldiver's thing"), and nothing a player can read says it any more: a
 * Jedi general holds up a comm and makes a SUPPORT CALL, and this file is the
 * pool it is drawn from. The two names are one sentence — you spend WAR
 * SUPPORT on a SUPPORT CALL — which is the whole reason that pairing was
 * chosen over anything more decorative. The module is still `Stratagems.js`
 * and the DOM node is still `#stratagem`; renaming an identifier a player
 * cannot see buys nothing and renaming the saved binding key would silently
 * discard every player's rebind of it.
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
 * scales every row so the dearest call on the table lands at `DEAREST_SHARE` of
 * the bar — measured off the shipped eighteen rows, the orbital bombardment is
 * 60 Force and 80 support and the smoke screen is 12 and 16 — so the bar holds
 * one of the enormous calls, or two of the middle, or six screens. That is the
 * shape the note asks for: "different strategems cost more obviously but when
 * you use them it depletes your side's support resources".
 */
export const SUPPORT_MAX = 100;

/**
 * WHAT THE DEAREST CALL ON THE TABLE TAKES OF THE BAR, as a share of it.
 *
 * It was a half, and a half was right when the table was seven rows long and
 * the orbital strike was the top of it: the bar held two heavy calls, which is
 * a rhythm rather than a decision. The table is eighteen rows now and the top
 * of it is an orbital bombardment — twenty-two detonations across forty-two
 * metres over nine seconds — and a call that clears most of a deep wave must
 * not be a thing you can afford twice in a row.
 *
 * 0.8, so the biggest call takes FOUR FIFTHS of everything your side has spare
 * and you cannot make it at all at the opening of a battle (`SUPPORT_START` is
 * 55). What that buys, measured off the shipped table: the bar holds one of the
 * top four, or two of the middle, or six smoke screens — and the rearm below is
 * proportional, so the bombardment also takes 12.8 s of the supply line's
 * recovery with it. That is the "real decision" the eighteen-row table is for.
 *
 * `Stratagems.supportCost` derives every price off this and each row's own
 * Force cost, so re-pricing a row moves its support price and nothing else.
 */
export const DEAREST_SHARE = 0.8;

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
    /**
     * THE TWO FIELDS THAT SAID THEY WERE FOR THE HUD AND WERE FOR NOBODY.
     *
     * `lastSpend` and `lastAt` were written by every `spend()` under the
     * comment "For the HUD: what the last spend was and how long ago", and
     * `readout()` — the method whose own comment is "Everything the HUD needs,
     * in one object" — does not carry either. `tools/deadfields.mjs` names them
     * both: written in `src/`, read in neither `src/` nor `tools/`.
     *
     * That is `AudioEngine.musicMissing` again, which is the case that tool was
     * built for: a field a comment says a screen reads, that no screen reads.
     * The cost is not the two writes, it is that the next person to want "how
     * long since the last call" builds on a number that has never reached
     * anybody. What the HUD actually draws the rearm from is `rearm` and
     * `rearming`, which `readout()` does carry.
     *
     * They are gone rather than published, because the readout already answers
     * the question they claim to: `rearm` IS how long ago the last spend was,
     * measured in the units the bar cares about, and `REARM * (cost / max)` is
     * where the size of that spend went.
     */
    this.t = 0;
    /** Total credited and spent this battle, which the readout uses. */
    this.earned = 0;
    this.spent = 0;
    /**
     * THE WAR EFFORT — what this side has DONE this battle, and the ladder the
     * heavier support calls are released along.
     *
     * ── WHY THERE IS A SECOND NUMBER BESIDE `earned` ────────────────────
     *
     * `earned` is what the pool actually TOOK, so it stops moving the instant
     * the bar is full: `credit` clamps at the ceiling and reports the
     * difference. That is right for a readout of the supply line and exactly
     * wrong for a measure of how the battle is going, because it freezes for
     * the player who is doing best — a side holding a full bar and killing
     * everything in front of it would never release another call. Measured on
     * a colosseum wave with the pool parked at 100: eleven kills and a cleared
     * wave credited 0.0 to `earned` and 15.05 to this field.
     *
     * So this is the credit OFFERED, ceiling or no ceiling: every kill, every
     * cleared wave, every piece of ground held, summed for the battle. It is
     * the one honest answer to "how far into this fight are you", it needs no
     * new hook anywhere — `credit` is already called from the four places the
     * score is — and it works identically in a horde run, a campaign and a
     * skirmish, none of which count waves the same way.
     *
     * ── AND IT DIES WITH THE BATTLE ─────────────────────────────────────
     *
     * A `WarSupport` is built per World and serialised nowhere, which is what
     * makes releasing calls off it an UNLOCK WITHIN A RUN rather than the
     * cross-run power `Progress.js` is the written law against. The hundredth
     * run opens with the same seven calls the first one did, and earns the
     * other eleven the same way.
     */
    this.effort = 0;
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
    /* THE WAR EFFORT TAKES THE WHOLE OFFER, BEFORE THE CEILING. See `effort`:
     * this is the record of what the side did, and a full bar does not undo a
     * kill. It is deliberately the only line in this method above the clamp. */
    this.effort += v;
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
      /* The ladder the heavier calls are released along — read by the HUD's
       * panel, which prints what the next one is still waiting on. */
      effort: this.effort,
    };
  }
}
