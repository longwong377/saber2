/**
 * BATTLEFRONT BORZ — what every Force power costs.
 *
 * A leaf module on purpose: it imports nothing, so both the thing that SPENDS
 * the Force (src/game/Player.js) and the thing that DRAWS the price
 * (src/ui/HUD.js) can read the same twelve numbers without an import cycle.
 * HUD → Player → Menu → HUD is a real cycle in this tree, and a table that has
 * to live on one side of it is a table that gets copied to the other.
 *
 * It was copied, and it drifted: the HUD's private duplicate carried lightning
 * at 14 against a real 30 and stasis at 30 against a real 26, so the wheel
 * greyed out a power the player could afford and lit one they could not. The
 * stopgap was tools/checks/hud-events.mjs GREPPING each spend out of Player.js
 * and matching it against the copy, which holds only for as long as the regex
 * still recognises the shape of the line it is looking for.
 *
 * Every one of the twelve goes through `Player._spend`/`_canSpend`, so the
 * Force Drain slider and the `forceCost` boons apply to all of them and to the
 * same degree. Three used not to — `throwOrRecall` and `toggleSense` compared
 * raw force against a literal, and `forceLightning` applied the boon multiplier
 * by hand but not the drain — which meant Force Drain at 0, the setting whose
 * own label reads "unlimited Force", freed six powers and kept charging for
 * three.
 *
 * THAT SENTENCE WAS TRUE OF THE ONE-SHOTS AND NOT OF THE HOLDS, which is where
 * it went on being wrong for another round: five of these powers are channels
 * that bill per frame — the barrier, the grip, the stasis field, the lightning
 * and the mend all through `_spend` — and Force Sense's hold was `this.force -=
 * 22 * dt`, outside the gate entirely. See `SENSE_DRAIN` at the foot of this
 * file for what that measured. The claim above now holds for the holds too.
 */

export const POWER_COST = {
  push: 20, pull: 16, grip: 10, throw: 14, sense: 25,
  lightning: 30, stasis: 26, heal: 40, compel: 34,
  /* Rend was priced by a bare `38` inside Player.forceDisassemble and by
   * nothing here, so the HUD had no number for it and the refusal quoted a
   * literal. Same table as every other power now. */
  rend: 38,
  /**
   * THE PANIC BUTTON, and it is priced as one.
   *
   * "I want one force power that is a 360 degree 'get off me' type of ability,
   * costs a lot of force but you like yell really loud and raise both your
   * arms out and push everything around you off (like in a scenario where
   * you're being overwhelmed)."
   *
   * 52 is the most expensive thing on this table, past `heal`'s 40, and that
   * is the whole design: a power that answers "there are eleven of them and
   * they are all inside my guard" has to cost enough that it cannot be the
   * answer to "there are two". At the base pool it is most of a bar, so using
   * it means choosing not to jump, dash-recover or heal for a while after —
   * which is what makes it a decision rather than a rotation.
   */
  unleash: 52,
  /**
   * THE BARRIER, and it is priced as a THRESHOLD rather than as a cost.
   *
   * The player asked for this and then asked again, and the honest answer the
   * second time was that it had never been built: "did you already add the
   * force shield/bubble in the game? i'd already asked for it but I could have
   * missed it." They had not missed it.
   *
   * 18 is deliberately cheap to RAISE — cheaper than a push — because a shield
   * you cannot afford to put up in the moment you need it is a shield that is
   * never used. What it costs is the HOLDING (see `SHIELD_HOLD`) and, most of
   * all, what it stops: every bolt that dies on it is paid for out of the same
   * pool, so a firing line drains you at the rate it is shooting. That is the
   * decision the power is made of — a barrier is not a wall, it is a bank
   * balance between you and the volley.
   */
  shield: 18,
};

/**
 * Powers a boon has to grant before any amount of Force will buy them.
 *
 * BOTH OF THEM. This held `lightning` alone while `Player.forceCompel` also
 * refuses on `!this.boonMods.forceCompel` — so the HUD's wheel lit Domination
 * as READY for every player who had never drafted it, from the first frame of
 * a first run, and pressing it produced "not attuned". Measured on a real HUD
 * against a real Player at 500 Force: 8 of 9 slots ready, lightning correctly
 * grey, compel lit and refusing. The earliest a compel card was offered across
 * 400 simulated runs was wave 12.
 *
 * The two entries here are exactly the two gates in Player.js:
 * `grep "if (!this.boonMods." src/game/Player.js` returns those two and
 * nothing else. A third power with a boon gate must be added here in the same
 * commit, or its slot will lie in the same way.
 */
export const POWER_BOON = { lightning: 'lightning', compel: 'compel' };

/**
 * WHAT FORCE SENSE COSTS TO KEEP OPEN, a second.
 *
 * It is here, beside the twelve one-shot prices, and not typed into
 * `Player._regen`, because it was a bare `22` in one place and prose about a
 * `22` in two others: `HUD.MINIMAP`'s note on the linger ("drains 22 Force a
 * second") and the Codex row that teaches the power. That is §2.3's signature
 * defect with a number small enough to look harmless.
 *
 * IT IS ALSO THE ONE PRICE IN THIS FILE THAT USED NOT TO BE ONE. The header
 * above says every power goes through `_spend`/`_canSpend`, so the Force Drain
 * slider and the `forceCost` boons reach all of them to the same degree —
 * and Sense's hold was `this.force -= 22 * dt` in `_regen`, which is none of
 * that. Measured on a real World, holding Sense from a full bar:
 *
 *     Force Drain 1 (default)          125 → 47.4, shut itself off at 5.67 s
 *     Force Drain 0 ("unlimited")      125 → 47.4, shut itself off at 5.67 s
 *     forceCost 0.05 (Tempest, flow 1) 125 → 47.4, shut itself off at 5.67 s
 *
 * Three economies, one number: the setting whose own label in index.html reads
 * "Drain at 0 is unlimited Force" freed eleven powers and went on charging for
 * the twelfth, and the boon that makes every power cost a twentieth did
 * nothing at all here. `_spend(SENSE_DRAIN * dt, true)` is the whole fix —
 * `partial` because it is a per-frame hold and a hold takes what is left and
 * stops, which is the same shape the lightning channel and the barrier use.
 */
export const SENSE_DRAIN = 22;
