/**
 * BATTLEFRONT BORZ — what every Force power costs.
 *
 * A leaf module on purpose: it imports nothing, so both the thing that SPENDS
 * the Force (src/game/Player.js) and the thing that DRAWS the price
 * (src/ui/HUD.js) can read the same nine numbers without an import cycle.
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
 * Every one of the nine goes through `Player._spend`/`_canSpend`, so the Force
 * Drain slider and the `forceCost` boons apply to all of them and to the same
 * degree. Three used not to — `throwOrRecall` and `toggleSense` compared raw
 * force against a literal, and `forceLightning` applied the boon multiplier by
 * hand but not the drain — which meant Force Drain at 0, the setting whose own
 * label reads "unlimited Force", freed six powers and kept charging for three.
 */

export const POWER_COST = {
  push: 20, pull: 16, grip: 10, throw: 14, sense: 25,
  lightning: 30, stasis: 26, heal: 40, compel: 34,
  /* Rend was priced by a bare `38` inside Player.forceDisassemble and by
   * nothing here, so the HUD had no number for it and the refusal quoted a
   * literal. Same table as every other power now. */
  rend: 38,
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
