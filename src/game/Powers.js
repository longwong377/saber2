/**
 * SABER — what every Force power costs.
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
};

/** Powers a boon has to grant before any amount of Force will buy them. */
export const POWER_BOON = { lightning: 'lightning' };
