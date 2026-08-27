/**
 * BATTLEFRONT BORZ — THE ARMOUR. What stands where the gun emplacement stood.
 *
 * The player, on the object this replaces: *"Remove the battlement/big gun from
 * all the modes as it still looks like shit… that giant gun does absolutely
 * nothing and I can't destroy it either… replace it maybe with a giant mobile
 * enemy or something."*
 *
 * All three complaints were literally true of `GunPit` and none of them were
 * bugs — see the note left in its place in `src/game/Levels.js`. It was inert
 * outside the army modes, it was `hp = Infinity` on purpose, and it had no
 * collider at all. It was a good argument wearing a bad object.
 *
 * ── WHAT THE GUN WAS ACTUALLY FOR, AND WHY SOMETHING HAS TO TAKE THE JOB ──
 *
 * Measured before it was cut, the emplacement was **35–43% of all damage onto
 * the player's named line** on Geonosis, and it was deliberately OFF the wave's
 * threat ledger — the composer never paid for it. That is not a detail. It is
 * roughly two to three of the ten names an engagement costs, and `theline.12`
 * is pinned to Geonosis precisely because "this is the only one carrying the
 * levy and the gun pit — the two sources of fire the wave's threat budget never
 * pays for". Delete the gun and hand nothing back and The Line stops costing
 * what it was tuned to cost.
 *
 * So this file is the same job, done by a body instead of a building.
 *
 * ── WHY A WALKER IS WORTH MORE HERE THAN A TOWER ─────────────────────────
 *
 * `ARCHETYPES.walker` is already in the tree and already in Geonosis's pool —
 * the OG-9 Homing Spider Droid, 620 hp, 26 damage, `big: true`. Everything the
 * gun refused to be, it is:
 *
 *   IT MOVES, so it is a landmark rather than furniture. A tower on the skyline
 *     is the same picture in second one and minute ten. A thing walking down
 *     the line changes the picture every time you look up, and it is the one
 *     object on a wide field that tells you at a glance which way the battle is
 *     facing.
 *   YOU CAN KILL IT. 620 hp and a real toughness, in `world.enemies`, hit by
 *     bolts and blade and every Force power. The gun's whole design was that
 *     the only answer was twenty seconds at a door; this one has as many
 *     answers as the game has verbs, and killing it visibly stops the damage
 *     it was doing to your men. That is the same decision the gun wanted to
 *     offer — pay a price to stop the bleeding — except the player can now
 *     SEE the price and see it work.
 *   AND IT IS SOLID, because it is a body and every body in this game has been
 *     a physics capsule since the contact channel was restored. Nobody walks
 *     through it.
 *
 * ── OFF THE LEDGER, LIKE THE LEVY, AND FOR THE LEVY'S REASON ─────────────
 *
 * `src/game/Levy.js` makes this argument at length and it applies unchanged: a
 * body bought out of the wave's threat budget arrives by DELETING the rifles it
 * is supposed to be standing beside. A walker costs `threat: 12`, which at the
 * Open Plain's wave-4 budget of about 30 is a third of the whole wave — so a
 * paid-for walker would make a levied wave strictly easier, which is the exact
 * failure that note was written against.
 *
 * The difference from the levy is what it pays back. A conscript is free
 * because `paysOut` is false — it advances nothing, so it moves no ledger. A
 * walker pays 1600 score, and that is right: it is free to the WAVE and
 * expensive to the enemy, and killing it should be one of the better things
 * that happens to you in an engagement. The gun paid nothing for twenty seconds
 * of held blade, and that was one of the quieter reasons it felt bad.
 *
 * ── ONE, AND ONLY WHERE THE POOL ALREADY HAS ONE ─────────────────────────
 *
 * The gate is `Levy.levies`' gate, for the reason that file gives: a
 * hand-written list of grounds beside `LEVELS[*].pool` is the twin-table defect
 * (HANDOFF §2.3) waiting to happen. A ground whose pool has no walker in it is
 * a ground where a walker is not part of this war, and this file must not be
 * the second place that decides that.
 */

import { ARCHETYPES } from './Enemy.js';

/** The body. Named, not typed twice — `ARCHETYPES` is the table. */
export const ARMOUR_TYPE = 'walker';

/**
 * HOW MANY WALK WITH A WAVE.
 *
 * One. Not a curve, and the levy's own note makes the argument for a flat
 * number: everything else in this mode escalates — the budget, the elites, the
 * ranks — and a crowd that escalates too is the same fight with the numbers
 * scaled, which is the thing escalation is supposed to prevent.
 *
 * Two would be worse than twice as hard. A walker's `preferred` band is 12–26 m
 * and it fires 2-round bursts of 26; two of them standing off a ten-man line at
 * the same time is 104 damage a cycle onto men with 100-odd health apiece, and
 * an engagement would be decided by whether the pair happened to look at the
 * same squad. One is a threat you answer. Two is weather with a health bar.
 */
export const ARMOUR_STRENGTH = 1;

/**
 * Does this director field armour at all?
 *
 * Derived from the ground's own pool, exactly as `Levy.levies` is, so a level
 * that does not put walkers in this war does not get one from here either.
 * `campaign === false` is the Trial of Waves and its endless escalation — see
 * `Levy.levies`, which refuses the levy on the same field for the same reason:
 * a free heavy every wave, forever, is a second escalation laid on top of an
 * endless one.
 */
export function fieldsArmour(director) {
  if (!director || !ARCHETYPES[ARMOUR_TYPE]) return false;
  if (director.campaign === false) return false;
  return !!director.pool?.includes(ARMOUR_TYPE);
}

/** How many walk with this wave. */
export function armourSize(director) {
  return fieldsArmour(director) ? ARMOUR_STRENGTH : 0;
}

/**
 * Put the armour into a composed wave.
 *
 * Takes and returns `_composeUnder`'s own `{queue, left, shape}` record, so the
 * surplus loop in `_compose` sees exactly what it saw before: `left` is
 * untouched, and the conditions a wave buys are the conditions it would have
 * bought.
 *
 * ── IN FRONT OF THE LEVY AND BEHIND THE PAYING BODIES ────────────────────
 *
 * `applyLevy` appends behind the shuffle so the paying rifles lead and the mass
 * comes in over them. The walker goes in at the same seam and BEFORE that mass,
 * because it is the slowest thing in the queue — `speed: 2.4` against a B1's
 * 3.5 — and a heavy that is dealt last arrives after the fight it was supposed
 * to be part of. Composed order is arrival order; `WaveDirector.update` feeds
 * one entry per `spawnTimer` and does not care what the entry is.
 *
 * ── AND IT GETS ITS OWN ROOM ─────────────────────────────────────────────
 *
 * `shape.alive` is raised by exactly what this adds, which is the levy's rule
 * and the reason it is the right one: `maxAlive` is a tuned number about how
 * much of a wave stands at once, and taking a slot for the walker would mean a
 * ground with armour on it fields one fewer rifle — a difficulty change nobody
 * asked for, smuggled in beside a feature.
 *
 * NO PACE CORRECTION, unlike the levy. One body in a queue of fifteen moves the
 * paying cadence by 6%, which is inside the noise of a `spawnTimer` that is
 * already 0.72–0.85 s; the levy needs the correction because forty bodies
 * quarter the rate, and correcting for one would be arithmetic theatre.
 */
export function applyArmour(out, director) {
  const n = armourSize(director);
  if (!n || !out?.queue || !out.shape) return out;
  /* ALREADY DRAWN COUNTS. The composer can and does buy a walker out of the
   * pool at a high enough budget — `LEVELS.geonosis.pool` has one in it, which
   * is the same fact `fieldsArmour` reads. Adding a free one on top would field
   * two on exactly the waves that were already the hardest, which is the
   * "weather with a health bar" this file's own note refuses. */
  const drawn = out.queue.reduce((a, t) => a + (t === ARMOUR_TYPE ? 1 : 0), 0);
  const add = Math.max(0, n - drawn);
  if (!add) return out;
  for (let i = 0; i < add; i++) out.queue.push(ARMOUR_TYPE);
  out.shape.alive = (out.shape.alive ?? 26) + add;
  out.shape.armour = (out.shape.armour ?? 0) + add;
  return out;
}
