/**
 * BATTLEFRONT BORZ — the gate, in two sizes.
 *
 * THE DEFECT THIS FILE EXISTS FOR. `npm run verify` is 150 suites and, on the
 * boxes that actually run it, between eleven minutes and never: HANDOFF §2.6d
 * records three lanes in one session failing to finish a run — 25 min for 14
 * suites, 95 min for 10, one killed at 50 — and `frontdoor` alone costs 1961 s
 * for a single check. A gate nobody can finish is a gate whose reds nobody
 * triages, and that is not a theory about this repo. `determinism.mjs` names
 * the mechanism in its own header: order-dependence "is the mechanism by which
 * a fixed cone survived several rounds of being fixed". The fixed slice count
 * in `intersectBladeSweep` survived the same way and for the same reason —
 * nothing anybody could afford to run was ever going to say so.
 *
 * So there are two gates now, and the small one is the one that runs on a push:
 *
 *   npm run verify:fast     this list, ~65 s, no browser, no long horizons
 *   npm run verify          all 150 suites, the pre-release run
 *
 * WHAT IS IN IT is the mechanical contract — the blade, the bolt, the cut, the
 * guard, the boons that move them. What a change to combat code can break
 * without touching a level, a menu or a wave.
 *
 * WHAT IS DELIBERATELY NOT IN IT, said out loud rather than left to be
 * discovered, because a tier that quietly covers less than it looks like is
 * worse than no tier:
 *
 *   footwork  52.9 s     powers  18.2 s     force  19.3 s
 *
 * are all core mechanics and all too slow for a push gate; every browser-driving
 * suite (`lighting`, `frontdoor`, `front-screen`, `packed`, `lineseen`) needs a
 * Chromium and `node_modules` and is out for that reason as well as for time;
 * and every level, wave, campaign, netcode and UI suite is out entirely. THIS
 * TIER GOING GREEN IS NOT THE GATE GOING GREEN. It is the claim that the blade
 * still works, available in a minute instead of an hour.
 *
 * Timings are wall-clock on a quiet container, measured one suite at a time
 * through `tools/_one.mjs`, and they are a guide rather than a promise: they
 * move with the box. The budget is checked at the end of a `verify:fast` run,
 * which is the only place it can be checked honestly.
 */

/**
 * Named suites rather than an exclusion rule, because an exclusion rule quietly
 * adopts every suite anybody adds later and the tier stops being fast without
 * anyone deciding that. A name here that does not resolve to a real file is a
 * HARD FAILURE of the run, not a silent skip — the same rule `verify.mjs`
 * already applies to a suite that exports no `run()`, and for the same reason:
 * a gate that shrinks without saying so reads exactly like a gate that passed.
 */
export const FAST = [
  // the blade against a bolt
  'deflection',     // 4.9 s — the capture window, the sweep, the frame-rate floor
  'catch',          // 0.4 s — holding a bolt on the blade and throwing it
  'directional',    // 0.6 s — the guard rose, the default control scheme
  'bolts',          // 12.5 s — the pool, the capsules every archetype presents
  // the blade against a body
  'severance',      // 3.3 s — a limb parts where the blade crossed it
  'cutting',        // 0.4 s — cut rate, toughness, what resists
  'cleave',         // 5.5 s — the cut that carries through
  // the blade against another blade
  'duelling',       // 8.7 s — parry, chamber, riposte, bind
  'forms',          // 5.3 s — guard breaks and what each tier costs
  'grip',           // 5.2 s — two-handed, one-handed, reverse
  // what the player brings to it
  'controls',       // 8.0 s — schemes, bindings, the settings that reach the blade
  'training',       // 0.5 s — blade length, the trail, the legacy settings chain
  'movement',       // 0.2 s — the ground under all of the above
  'weapons',        // 0.3 s — what else can be held
  // and the things that move those numbers
  'order',          // 0.6 s — crystals, racks, the boon tables
  'progression',    // 0.8 s — ranks and what each one buys
  'claims',         // 8.2 s — every counted lesson is one the world can report
];

/** Wall-clock the fast tier is expected to fit inside, in seconds. */
export const FAST_BUDGET = 90;
