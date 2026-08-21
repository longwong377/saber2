/**
 * BATTLEFRONT BORZ — THE LEVY. FLAGSHIP §6's forty conscripts, fielded.
 *
 * "The lawnmower is only a lawnmower when mowing pays. Forty conscripts that
 * pay nothing are weather."
 *
 * `ARCHETYPES.conscript` was built last session and it is finished: 6 hp, one
 * turned pass, 0.71 of a B1's gun, and `World.paysOut` false so killing one
 * advances nothing at all. The lane that built it wrote down what was still
 * missing in one sentence — **"nothing yet fields forty conscripts"** — and
 * that is the whole of this file. A pool weight cannot do it: `conscript`
 * appears twice in the eleven Confederate entries of `LEVELS.geonosis.pool`,
 * so the composer draws about two of them into a wave of fifteen. Two
 * conscripts are not weather. They are a B1 that gave you nothing, which is
 * the worst version of the idea — the player learns the body is a waste of
 * time and never sees the thing the waste of time is FOR.
 *
 * ── WHY THE LEVY IS NOT BOUGHT OUT OF THE WAVE'S THREAT BUDGET ────────────
 *
 * This is the load-bearing decision and it is the opposite of what the rest of
 * Waves.js does, so it needs its argument written down.
 *
 * Everything in `_composeUnder` is bought: a body costs its `threat` and the
 * wave stops when the budget is gone. Put the levy on that ledger and forty
 * conscripts at threat 0.5 cost 20 — which at the Open Plain's wave-4 budget of
 * about 30 is the ENTIRE WAVE. The levy would arrive by deleting the rifles it
 * is supposed to be standing behind, and a levied wave would be strictly
 * EASIER than an unlevied one: forty bodies that do 1.4 dps each and die to one
 * pass, instead of ten that do 2.17 and have to be fought. Weather that makes
 * the storm smaller is not weather.
 *
 * So the levy is free, and the reason it is allowed to be free is the same
 * field that makes the conscript a conscript: `World.paysOut` is false, so the
 * levy is the one thing the director can add that changes NOTHING on either
 * ledger. It pays the player no score, no Flow, no combo and no war support,
 * and it costs the wave no threat. It is the only body on the roster that can
 * be given away in quantity without moving a number somebody tuned.
 *
 * The price it does pay is the FRAME, and that is measured rather than
 * asserted — see `LEVY_STRENGTH` and tools/checks/levy.mjs §the ladder.
 *
 * ── THE PACE IS DERIVED, NOT CHOSEN ──────────────────────────────────────
 *
 * `WaveDirector.update` feeds ONE entry off the queue per `spawnTimer`, and the
 * timer does not care what the entry is. Append forty conscripts to a fifteen-
 * body wave and the rifles arrive at a quarter of their old rate: at wave 3 the
 * gap is ~0.72 s, so the last paying body of a levied wave lands 40 s after the
 * first instead of 11 s after it. That is not "the wave got bigger", it is the
 * wave the director composed being delivered as a different wave.
 *
 * So the levy shortens the pace by exactly its own share of the queue —
 * `paying / (paying + levy)` — which makes the arrival RATE of the paying
 * bodies identical to what it was before the levy existed. One line, and it is
 * the only honest number: any other multiplier is a difficulty change smuggled
 * in beside a crowd.
 *
 * `alive` is raised by the levy's own size for the same reason. `maxAlive` is
 * 26 and FLAGSHIP §4 calls that honest; raising it to 66 for everybody would
 * re-point every wave in the game. Raising it BY the levy leaves the paying
 * bodies exactly the room they had.
 *
 * ── WHAT ADOPTS A BODY, AND WHY IT IS THE TYPE AND NOT A FLAG ────────────
 *
 * Nothing here marks a spawn. A `conscript` on the field IS the levy, however
 * it got there — off this composer, off the pool's own two entries, or out of
 * a sandbox. That is not laziness: the class was defined by an absence
 * (`score: 0`) rather than by a spawn path, and a rule that only held for
 * bodies this file queued would be a second definition of the same class,
 * which is HANDOFF §2.3's defect with a new coat.
 */

import { ARCHETYPES } from './Enemy.js';

/** The body class the levy is made of. FLAGSHIP §6's third class. */
export const LEVY_TYPE = 'conscript';

/**
 * HOW MANY. §6 says forty, and forty is what the frame was measured against.
 *
 * MEASURED, on a real `high` World on geonosis in Command, camera on the
 * player, over a 90-second engagement with the shipped composer, the shipped
 * arrivals and the shipped LOD ladder. A body's cost in visible meshes is a
 * pure function of its rung and the ladder is clean:
 *
 *     conscript   12 m LOD0  45 meshes · 45 m LOD1  23 · 90 m LOD2  4 · 170 m LOD3  0
 *     b1          the same four numbers, exactly
 *     trooper     47 · 26 · 4 · 0
 *
 * So forty conscripts standing ON you is 1 800 draw calls and no ladder can
 * help: L2 does not begin until 62 m. That number is the ceiling this constant
 * is up against, and it is not what a levy actually costs, because a levy
 * arrives from the spawn ring at 58-96 m and dies on the way in. Measured
 * through the shipped path, peak over the engagement:
 *
 *     no levy    18 bodies (10 of them yours)    767 body draw calls
 *     levy 40    64 bodies                     1 415 body draw calls
 *
 * — 46 more bodies for 648 more calls, 14 a body against the 45 a contact body
 * costs, because at any instant most of the mass is still crossing the ground
 * at L1 and L2. THAT is the ladder earning its keep, and it is the first time
 * `MergedSkin` and `Cohorts` have been asked to carry a real mass rather than
 * a bench of 42 bodies stood at a fixed radius.
 *
 * The number is not raised past forty and the reason is arithmetic rather than
 * taste: the levy's cost is linear in bodies at every rung, so eighty is 2 830
 * calls at the same peak and there is nothing in the ladder that bends. Forty
 * is what §6 asked for and forty is what the frame was shown to hold.
 */
export const LEVY_STRENGTH = 40;

/**
 * Does this director's ground want a levy at all?
 *
 * ASKED OF THE POOL, not of a list of level keys. A level that names
 * `conscript` in its pool has said it wants the body; a level that does not has
 * said it does not, and a hand-written list of grounds beside `LEVELS[*].pool`
 * is the twin-table defect (HANDOFF §2.3) waiting to happen. Today that is
 * geonosis and only geonosis, which is the mode's own ground.
 */
export function levies(director) {
  return !!ARCHETYPES[LEVY_TYPE] && !!director?.pool?.includes(LEVY_TYPE);
}

/**
 * How many conscripts this wave's levy is.
 *
 * Flat, and that is deliberate. Everything else in this mode escalates — the
 * budget, the heavy bias, the muster shelf — and the levy is the one thing that
 * must not, because its whole content is that it is not worth anything. A levy
 * that grew would be an escalation made of bodies that pay nothing, which is
 * the reward curve and the difficulty curve pulling in opposite directions.
 * The weather is the same weather in area 1 and area 5; what changes is what is
 * shooting from inside it.
 */
export function levySize(director, wave = director?.wave ?? 1) {
  if (!levies(director)) return 0;
  return LEVY_STRENGTH;
}

/**
 * Put the levy into a composed wave.
 *
 * Takes and returns `_composeUnder`'s own `{queue, left, shape}` record, so the
 * surplus loop in `_compose` — which re-composes and reads `left` to buy
 * another condition — sees exactly what it saw before: the levy costs no
 * budget, so `left` is untouched and the conditions a wave buys are the
 * conditions it would have bought.
 *
 * The levy goes in BEHIND the shuffle, not into it. A shuffled levy would put
 * conscripts in the first rank at random and the wave would open with weather;
 * appended, the paying bodies of the wave lead and the mass comes in over them,
 * which is the shape the reference plates of this battle have and the shape the
 * pace correction above assumes.
 */
export function applyLevy(out, director, wave = director?.wave ?? 1) {
  const n = levySize(director, wave);
  if (!n || !out?.queue || !out.shape) return out;
  const paying = out.queue.length;
  for (let i = 0; i < n; i++) out.queue.push(LEVY_TYPE);
  /* The room and the rate. Both are stated against `paying`, so a wave the
   * composer made small gets the same levy and the same paying-body cadence as
   * one it made large. */
  out.shape.alive = (out.shape.alive ?? 26) + n;
  out.shape.pace = (out.shape.pace ?? 1) * (paying / (paying + n));
  out.shape.levy = n;
  return out;
}
