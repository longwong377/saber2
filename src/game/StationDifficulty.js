/**
 * ══════════════════════════════════════════════════════════════════════════
 *  DIFFICULTY THAT CHANGES THE STATION — V19 hole 10 / addition 10
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"Difficulty is a slider; the station ignores it."* It did: `settings.
 * difficulty` picked a row of `Combat.DIFFICULTY` and every reader of that row
 * was a bolt, a parry window or an enemy's fire rate. The drum priced its
 * shelves, held its cell, lost its patience, picked your pocket and mended
 * your men at the same numbers on Padawan and on Grandmaster.
 *
 * ONE TABLE, FIVE READERS, EACH IN ITS OWN MODULE. This file owns the ladder
 * and nothing else; the five things that read it read it ONCE, on the line
 * where they decide:
 *
 *   prices         `Counter.priceOf`        the shelf's base price, multiplied
 *   brigPatience   `StationLife.deliverToBrig`  the cell's field, `CELL_HOLD` ×
 *   guardPatience  `StationLife.stepGuards`     seconds boxed in before it is an arrest, ×
 *   pickOdds       `Pickpocket.pickPlan`        does he strike today, and how much he takes
 *   healRate       `Medbay.advanceIn`           the tank's mend per hour, ×
 *
 * Monotonic across the four tiers, the way `balance.mjs` holds the combat
 * ladder: cheaper, shorter, more patient, quieter and quicker on Padawan;
 * dearer, longer, quicker to arrest, bolder and slower on Grandmaster.
 * `stationwar.mjs` drives the five readers between the ends and asks each to
 * move the right way.
 *
 * NO WORLD AT THE COUNTER. `priceOf(row)` and `advanceIn(company, hours)` are
 * pure on their arguments and have no world to ask, so `dressStation` binds
 * the station's world here once (`bindStationDiff`) and a reader with nothing
 * in hand reads the bound one. A check binds whatever it likes.
 */

import { DIFFICULTY } from './Combat.js';

/** The ladder. Every column is monotonic in the tier's order. */
export const STATION_DIFF = Object.freeze({
  padawan:     Object.freeze({ tier: 'padawan',     prices: 0.85, brigPatience: 0.6, guardPatience: 1.8, pickOdds: 0.30, healRate: 1.30 }),
  knight:      Object.freeze({ tier: 'knight',      prices: 1.00, brigPatience: 1.0, guardPatience: 1.0, pickOdds: 0.55, healRate: 1.00 }),
  master:      Object.freeze({ tier: 'master',      prices: 1.15, brigPatience: 1.4, guardPatience: 0.7, pickOdds: 0.80, healRate: 0.85 }),
  grandmaster: Object.freeze({ tier: 'grandmaster', prices: 1.30, brigPatience: 1.8, guardPatience: 0.5, pickOdds: 1.00, healRate: 0.70 }),
});

export const TIERS = Object.freeze(Object.keys(STATION_DIFF));

let _bound = null;

/** The station's world, for readers that are handed none. */
export function bindStationDiff(world) { _bound = world || null; }

/** Which tier a world is on: its settings first, then its difficulty row. */
export function tierOf(world) {
  const s = world?.settings?.difficulty;
  if (typeof s === 'string' && STATION_DIFF[s]) return s;
  const d = world?.difficulty;
  if (d) for (const k of TIERS) if (DIFFICULTY[k] === d || DIFFICULTY[k]?.name === d.name) return k;
  return 'knight';
}

/**
 * The five numbers for this world — or for the bound one, or Knight's.
 * @returns {{ tier, prices, brigPatience, guardPatience, pickOdds, healRate }}
 */
export function stationDiff(world = _bound) {
  return STATION_DIFF[tierOf(world)] || STATION_DIFF.knight;
}
