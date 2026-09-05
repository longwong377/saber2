/**
 * ══════════════════════════════════════════════════════════════════════════
 *  CREDITS — the whole wallet, and it is deliberately a short file
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"credits that you get for doing differnt stuff in the game and playing the
 * game."*
 *
 * ── READ `Progress.js`'s AMENDMENT BEFORE YOU READ THIS ───────────────────
 *
 * This is a cross-run currency and the doctrine in `Progress.js` says there is
 * not one. The amendment at the top of that file is where the narrowing is
 * argued: a run is won by playing rather than by having played before, and
 * credits do not touch that IF AND ONLY IF the only things they buy are
 * cosmetics that are permanent and provisions that die with the run. That
 * argument lives there, in the file that states the rule, and not here —
 * because a rule and its exception written in the same file by the same hand
 * is how a doctrine quietly becomes a suggestion.
 *
 * ── WHY THIS FILE IS SHORT ON PURPOSE ─────────────────────────────────────
 *
 * It is the one file in the tree whose whole job is the thing the currency
 * scan is looking for, so it has to be a file somebody can read in a minute
 * and be sure about. It holds a number, a cap, an earn table and a spend door.
 * It knows nothing about shops (`Counter.js`), nothing about what is for sale,
 * and nothing about the station. Every judgement about WHAT may be bought is
 * somebody else's and is refused at their door.
 *
 * ── THE ECONOMY IS BOUNDED, WHICH IS THE THIRD GUARANTEE ──────────────────
 *
 * `PER_RUN_CAP` is what stops a grind: a run pays at most this, however long
 * you stay in it, so a player cannot farm one theatre into a purse. And the
 * dearest things cost several runs, so hoarding buys patience rather than an
 * advantage — which there is not one of to buy.
 */

import { makeStore } from './Store.js';

const KEY = 'saber.credits.v1';
const store = makeStore(KEY);

/** The most one run can pay, whatever happens in it. See the header. */
export const PER_RUN_CAP = 2200;

/**
 * ══ EACH WAVE PAYS MORE THAN THE ONE BEFORE IT — and this is the number ═══
 *
 * MEASURED FIRST, which is how this got here. Driven through `tools/balance.mjs`'s
 * own `simulateRun` at its own three skill settings, 24 seeds a tier, and paid
 * through the shipped funnel (`main.js`'s `record()` → `payForRun`), the table
 * as it stood paid:
 *
 *     careless (σ110)   wave 2.8   17 kills    84 credits    68/min
 *     competent (σ75)   wave 4.6   33 kills   143 credits    62/min
 *     sharp (σ45)       wave 6.0   45 kills   189 credits    56/min
 *
 * Three things are wrong with that and only one of them is the size.
 *
 *   A FLAT RATE CANNOT PAY FOR SKILL. `depth` was a straight 26 a wave and the
 *     whole earn table was a linear sum, so the best purse in the game was
 *     2.25x the worst — and the depth spread between a careless hand and a sharp
 *     one is 2.1x, the kill spread 2.6x. A linear combination of two ratios
 *     cannot exceed the larger of them, so NO setting of those rows could have
 *     made good play pay three times what bad play pays. The shape had to move,
 *     not the numbers.
 *
 *   THE FLOOR WAS A ROUNDING ERROR. A wave-1 death paid 26 — one wave at the
 *     flat rate, and the audit's own figure.
 *
 *   AND THE RATE FELL AS YOU GOT BETTER. 68 credits a minute careless, 56
 *     sharp: the last column above is the whole complaint in one line. Playing
 *     well paid LESS per minute than dying early and queueing again.
 *
 * So depth is a RISING rate: wave 1 pays `depth`, and every wave after it pays
 * `DEPTH_RAMP` of a wave more than the last one did. Reaching wave W is worth
 *
 *     depth × (W + DEPTH_RAMP × W(W−1)/2)
 *
 * which is the closed form of that sentence and is what `payForRun` computes.
 * It is ONE key's meaning changed rather than a second depth row, because a
 * second row would be a number `World.runStats` does not report — the exact
 * thing `counter.mjs` refuses at the door.
 *
 * The ramp is what buys the ratio: at 0.62 the same three tiers come out
 * 172 / 379 / 577 credits — 3.36x apart end to end, and 140 / 164 / 171 a
 * minute, so the rate now rises with the hand instead of falling. None of those
 * numbers is asserted anywhere; `balance.mjs`'s check re-derives them from the
 * same simulation and holds the RATIO and the runs-to-afford in bands, so
 * retuning any of this is caught by what it produces rather than by a figure
 * somebody remembered to update in a comment.
 *
 * `PER_RUN_CAP` moved with it, for the reason the header states: it is the
 * thing that stops a grind, so it has to sit ABOVE where honest play lands and
 * below where farming would. Wave 14 is where it binds; a sharp run reaches 6.
 */
export const DEPTH_RAMP = 0.62;

/** What reaching wave `w` is worth, before the cap. The ramp's closed form. */
export function depthPay(w) {
  const n = Math.max(0, Math.floor(Number(w) || 0));
  return EARN.depth * (n + DEPTH_RAMP * (n * (n - 1)) / 2);
}

/**
 * WHAT PAYS, AND IT IS ALL THINGS THE GAME ALREADY COUNTS.
 *
 * No new telemetry: every row is a number some system already keeps, which is
 * what stops this becoming a second scoring system beside the real one.
 *
 *   depth      how far the run got — the thing the game is about
 *   won        reaching the crown
 *   kills      a floor, so a bad run is not a wasted evening
 *   saves      pulling a man out, because the roll is the point
 *   quest      what an NPC agreed to pay (V16 §C3)
 *   bout       a purse from the pits (V16 Lane G)
 */
export const EARN = {
  /* Per wave, RISING — see `DEPTH_RAMP`. Wave 1 is worth exactly this, which
   * is also the floor of the whole economy: the least a run that reached the
   * ground at all can pay. */
  depth: 32,
  won: 700,
  /* A bad run's floor. Raised from 0.7 because a careless hand still kills
   * seventeen things, and 12 credits for an evening is what "a wasted evening"
   * looks like in a ledger. */
  kills: 1.6,
  saves: 30,
  quest: 1,
  bout: 1,
};

function blank() { return { v: 1, purse: 0, earned: 0, spent: 0 }; }

let _cache = null;
function read() {
  if (_cache) return _cache;
  const v = store.read();
  _cache = { ...blank(), ...(v && typeof v === 'object' ? v : {}) };
  /* CLAMPED ON THE WAY IN, the same discipline `Kennel.js` names: a hand-
   * edited save is a hostile input, and a purse is the field somebody would
   * edit first. */
  for (const k of ['purse', 'earned', 'spent']) {
    const n = Math.floor(Number(_cache[k]));
    _cache[k] = Number.isFinite(n) && n >= 0 ? Math.min(n, 9_999_999) : 0;
  }
  return _cache;
}
function write(v) { _cache = v; store.write(v); return v; }

/** What is in the purse. */
export function purse() { return read().purse; }

/** True once a write has been refused — a screen's cue to say the fold is not
 * reaching the disk. Same door `StationSave.stationBroken` opens. */
export function creditsBroken() { return store.broken; }

/**
 * Pay for a run, ONCE, out of what the run already recorded.
 *
 * Takes the run's own report rather than a number, so the caller cannot invent
 * a figure — and returns what was actually paid after the cap, so a screen can
 * say "capped" rather than quietly showing a smaller number than it earned.
 */
export function payForRun(report = {}) {
  const raw = Math.round(
    depthPay(report.depth)
    + (report.won ? EARN.won : 0)
    + (Number(report.kills) || 0) * EARN.kills
    + (Number(report.saves) || 0) * EARN.saves);
  const paid = Math.max(0, Math.min(PER_RUN_CAP, raw));
  const s = read();
  s.purse += paid;
  s.earned += paid;
  write(s);
  return { paid, raw, capped: raw > PER_RUN_CAP };
}

/** A purse from a bout or a quest — already a settled number, still capped. */
export function pay(n, why = 'purse') {
  const amount = Math.max(0, Math.min(PER_RUN_CAP, Math.round(Number(n) || 0)));
  if (!amount) return 0;
  const s = read();
  s.purse += amount;
  s.earned += amount;
  write(s);
  return amount;
}

/**
 * THE ONE SPEND DOOR.
 *
 * Refuses rather than going negative, and answers what happened rather than a
 * boolean, because a shop that says "no" without saying "you are 40 short" is
 * the shape of thing this tree keeps removing.
 */
export function spend(n, on = null) {
  const cost = Math.round(Number(n) || 0);
  if (!(cost > 0)) return { ok: false, why: 'that is not a price', short: 0 };
  const s = read();
  if (s.purse < cost) return { ok: false, why: 'not enough credits', short: cost - s.purse };
  s.purse -= cost;
  s.spent += cost;
  write(s);
  return { ok: true, why: null, short: 0, left: s.purse, on };
}

/** Start again. Only a check calls this. */
export function clearCredits() { store.drop(); _cache = null; return read(); }
