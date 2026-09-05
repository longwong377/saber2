/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE BENCH — V16 Lane A3, where a stratagem is tuned rather than bought
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"there's a certain part of the ship where you can customize and upgrade
 * your strategems maybe engineering, really make it look like ship defense …
 * if you use certain strategems certain number of times maybe you can upgrade
 * them and unlock new ones, come up with a minigame here."*
 *
 * ── THE COLLISION, AND HOW IT IS RESOLVED ─────────────────────────────────
 *
 * "Use it N times to unlock" is a cross-run progression, and `Progress.js`
 * refuses one. Its amendment allows credits to buy cosmetics and provisions —
 * it does NOT allow a usage counter to buy power, and this is not going to be
 * the feature that quietly widens it.
 *
 * So the resolution is the one V16 §A3 states and it is a real design rather
 * than a dodge: **use unlocks VARIANTS, never raw power.** A variant is a
 * SIDEGRADE — a longer fuse, a tighter pattern, a different shell — and the
 * player chooses one per run. Two hundred calls of the orbital strike does not
 * make the lance hit harder; it means you have seen enough of them to know
 * that a tighter one is sometimes what you want.
 *
 *   `tools/checks/bench.mjs` measures this: every variant's terms multiply out
 *   to no more than the stock call is worth, and a fully-unlocked bench
 *   against a fresh one wins no fight it would otherwise lose.
 *
 * ── AND THE MINIGAME IS A FIRING SOLUTION ─────────────────────────────────
 *
 * The player asked for one and did not say what. A stratagem is fire called
 * onto a place from somewhere else, so the honest minigame is the thing that
 * actually goes wrong with called fire: the solution. Three dials against a
 * drifting mark — SPREAD, DELAY and BEARING — and how well you land them sets
 * that variant's tuning FOR THE NEXT RUN ONLY.
 *
 * That is skill, it is repeatable, and it stores no number: the tuning is a
 * provision in everything but name, and it dies exactly as one does.
 *
 * ── WHERE ────────────────────────────────────────────────────────────────
 *
 * Two rooms, because they are two jobs. You MAKE the thing at `#50
 * Fabrication` — a variant is a shell with different innards — and you TUNE
 * THE CALL at `#42 Comms & sensor room`, which is where a fire mission is
 * called from and which has had no job at all until now.
 */

import { STRATAGEMS } from './Stratagems.js';
import { makeStore } from './Store.js';

const KEY = 'saber.bench.v1';
const store = makeStore(KEY);

/**
 * HOW MANY CALLS OPEN A VARIANT.
 *
 * Deliberately low. This is not a grind gate — it is a statement that you have
 * used the thing enough to have an opinion about it, and a player who has
 * called forty barrages has that opinion whether the game counts or not.
 */
export const OPENS_AT = [0, 12, 34];

/**
 * ══ THE VARIANTS ══════════════════════════════════════════════════════════
 *
 * Every row is a SIDEGRADE and the check proves it: `gain` and `cost` are both
 * required, and the product of a variant's multipliers may not exceed 1. A row
 * with only a gain is refused by `saneVariant` at the door.
 *
 * The four axes are the four things about called fire a soldier would actually
 * argue about, and each is a real field on the stratagem row:
 *
 *   radius   how wide it lands
 *   lead     how long between the call and the arrival
 *   cooldown how long until you may call again
 *   cost     what the call is billed
 */
const V = (id, name, gain, cost, mods, blurb) => ({ id, name, gain, cost, mods, blurb });

export const VARIANTS = {
  strike: [
    V('narrow', 'Narrow lance', 'lands in half the radius', 'and takes two seconds longer to arrive',
      { radius: 0.5, lead: 1.55 }, 'A tighter column. You have to know where they will be, not where they are.'),
    V('quick', 'Quick call', 'arrives a third sooner', 'in a wider circle, and costs half again as much',
      { lead: 0.66, radius: 1.35, cost: 1.55 }, 'Less time for them to walk out of it. Less time for you, too.'),
  ],
  strafe: [
    V('long', 'Long run', 'twice the length of ground', 'thinner across it, and a longer wait after',
      { radius: 1.9, cooldown: 1.35 }, 'The gunship stays on the line. It is a fence, not a hammer.'),
    V('tight', 'Tight run', 'everything in sixty metres of line, and cheaper', 'over half the length, and a longer wait after',
      { radius: 0.55, cost: 0.85, cooldown: 1.3 }, 'One pass, close, and then it is gone.'),
  ],
  barrage: [
    V('creeping', 'Creeping barrage', 'walks further across the position', 'and arrives later',
      { radius: 1.5, lead: 1.5 }, 'You walk behind it. That is the whole idea and it is why it is slow.'),
    V('concentrated', 'Concentrated', 'everything into one place', 'with a longer wait between missions',
      { radius: 0.6, cooldown: 1.4 }, 'All of it, there.'),
  ],
  smoke: [
    V('deep', 'Deep bank', 'a wider and longer-lasting screen', 'and it takes longer to build',
      { radius: 1.45, lead: 1.4 }, 'Thick enough to move a company through.'),
    V('snap', 'Snap screen', 'up almost at once', 'thin, small, dearer, and a long wait for the next',
      { lead: 0.4, radius: 0.7, cooldown: 1.9, cost: 1.35 }, 'For the twenty seconds you actually needed.'),
  ],
  mines: [
    V('scatter', 'Scattered field', 'covers much more ground', 'more thinly',
      { radius: 1.7, cost: 1.15 }, 'They will find one of them. They will not find all of them.'),
    V('dense', 'Dense field', 'nothing walks through it', 'over a much smaller patch, and it costs more to lay it that thick',
      { radius: 0.5, cost: 1.2 }, 'A door, closed.'),
  ],
  ion: [
    V('wide', 'Wide pulse', 'reaches much further', 'and takes longer to charge',
      { radius: 1.6, cooldown: 1.45 }, 'Every machine in the square stops at once.'),
    V('rapid', 'Rapid cycle', 'ready again far sooner', 'over a smaller circle, and each one costs much more',
      { cooldown: 0.6, radius: 0.68, cost: 1.75 }, 'Again, and again, and again.'),
  ],
};

/** Is this a sidegrade, or is it an upgrade wearing the word? */
export function saneVariant(v) {
  if (!v || !v.id || !v.mods) return null;
  /* BOTH HALVES OR IT IS NOT A TRADE. A row with a gain and no cost is the
   * thing this whole file exists not to be. */
  if (!v.gain || !v.cost) return null;
  const keys = Object.keys(v.mods);
  if (!keys.length) return null;
  /**
   * AND IT MOVES AT LEAST TWO AXES, which is the shape of a trade.
   *
   * One axis alone is a pure gain or a pure loss whichever way it goes. This
   * is enforced at the DOOR rather than in the suite because a row that only
   * moves `radius` comes out worth a flat 1.000 — a wash by the arithmetic,
   * and a claim of something the engine cannot deliver by the prose. Refusing
   * it here means the failure is a variant that never reaches a bench, rather
   * than one a player picks and cannot tell from stock.
   */
  if (Object.keys(v.mods).filter((k) => v.mods[k] !== 1).length < 2) return null;
  return worthOf(v) <= 1.0001 ? v : null;
}

/**
 * What a variant is worth against the stock call. 1 is a wash, above 1 is an
 * upgrade, and there are none of those.
 *
 * ── RADIUS IS NOT AN AXIS OF GOOD ─────────────────────────────────────────
 *
 * The first cut of this counted `radius` as a gain — more ground covered,
 * more better — and it priced `strike/quick` at 1.70, which its own door then
 * refused. The door was right and the model was wrong, and the reason is worth
 * writing down: A WIDER ORBITAL LANCE IS NOT A BETTER ORBITAL LANCE. You
 * called it on a thing; a wider one is more likely to also land on your own
 * men. A wider minefield is thinner. A wider smoke bank is a screen with holes
 * in it. Whether more radius is a gain depends entirely on what the player
 * wanted, which is exactly what makes it the FLAVOUR of a variant rather than
 * its price.
 *
 * So the worth is over the three axes where "less" is unambiguously better for
 * the caller — how long until it arrives, how long until you may call again,
 * and what it costs — and radius is a change that must be paid for on those,
 * never a thing that pays. That is a stricter rule than the first one and it
 * is the rule the variants are now tuned against.
 */
export function worthOf(v) {
  const m = v?.mods || {};
  return 1 / ((m.lead ?? 1) * (m.cooldown ?? 1) * (m.cost ?? 1));
}

/** The variants a stratagem has, ever. */
export function variantsFor(id) { return (VARIANTS[id] || []).filter(saneVariant); }

/* ══════════════════════════════════════════════════════════════════════════
 *  THE LEDGER — how many times each stratagem has been called
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A COUNT AND NOT A CURRENCY. It is never spent, it buys no power, and the
 * only thing it does is decide which sidegrades are on the bench. Nothing
 * anywhere subtracts from it. That distinction is the reason this file passes
 * the six-word scan honestly rather than by avoiding vocabulary.
 */
function blank() { return { v: 1, called: {}, tuned: {}, picked: {}, solved: {} }; }
let _cache = null;
function read() {
  if (_cache) return _cache;
  const v = store.read();
  _cache = { ...blank(), ...(v && typeof v === 'object' ? v : {}) };
  if (!_cache.called || typeof _cache.called !== 'object') _cache.called = {};
  if (!_cache.tuned || typeof _cache.tuned !== 'object') _cache.tuned = {};
  if (!_cache.picked || typeof _cache.picked !== 'object') _cache.picked = {};
  if (!_cache.solved || typeof _cache.solved !== 'object') _cache.solved = {};
  /* Clamped on the way in — a hand-edited save is a hostile input, and this is
   * the field somebody would edit to open every variant at once. */
  const ids = new Set(STRATAGEMS.map((s) => s.id));
  for (const k of Object.keys(_cache.called)) {
    if (!ids.has(k)) { delete _cache.called[k]; continue; }
    const n = Math.floor(Number(_cache.called[k]));
    _cache.called[k] = Number.isFinite(n) && n > 0 ? Math.min(n, 99999) : 0;
  }
  return _cache;
}
function write(v) { _cache = v; store.write(v); return v; }

/** How many times this stratagem has been called, ever. */
export function callsOf(id) { return read().called[id] | 0; }

/** One more call. The only writer. */
export function noteCall(id, n = 1) {
  if (!STRATAGEMS.some((s) => s.id === id)) return 0;
  const s = read();
  s.called[id] = Math.min(99999, (s.called[id] | 0) + Math.max(1, n | 0));
  write(s);
  return s.called[id];
}

/** Which variants are open on the bench, and which are still shut, and why. */
export function benchFor(id) {
  const calls = callsOf(id);
  return variantsFor(id).map((v, i) => ({
    ...v,
    /* The FIRST variant is at `OPENS_AT[0]`, which is 0 — a bench with nothing
     * on it is a room with a sign. The index was `i + 1` for one run and every
     * first variant was shut on a fresh save. */
    open: calls >= OPENS_AT[Math.min(i, OPENS_AT.length - 1)],
    at: OPENS_AT[Math.min(i, OPENS_AT.length - 1)],
    calls,
    worth: worthOf(v),
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE FIRING SOLUTION — the minigame, and it stores nothing
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Three dials against a drifting mark. `solve` scores one attempt; the score
 * sets that variant's tuning FOR ONE RUN and is then gone, which is why this
 * is a skill test rather than a stat. `tuned` is cleared by `clearTuning`,
 * which the run's own ending calls.
 */
export const DIALS = ['spread', 'delay', 'bearing'];

/**
 * Score an attempt. `want` is where the dials should have been — the room
 * generates it from the day and the drift — and `got` is where the player put
 * them. Answers 0..1, and the curve is deliberately unforgiving in the middle:
 * a solution that is nearly right is a shell that is nearly on the target.
 */
/** Past this much error on a dial, the shell is not on the target at all. */
const MISS = 0.35;

export function solve(want, got) {
  let sum = 0;
  for (const d of DIALS) {
    const a = Number(want?.[d]);
    const b = Number(got?.[d]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    const err = Math.abs(a - b);
    /**
     * ── THE PENALTY ACCELERATES, AND THE FIRST CUT HAD IT BACKWARDS ──────
     *
     * `(1 - err)²` is the obvious curve and it is the wrong one: its slope is
     * STEEPEST at zero, so the first tenth of error costs more than the
     * second. That is a solution that punishes you hardest for being nearly
     * perfect, which is neither how called fire works nor a thing anybody
     * would enjoy.
     *
     * `1 - (err/MISS)²` is the other way round — nearly right is nearly
     * right, and then it falls off a cliff. Measured: a tenth off scores
     * 0.918, two tenths 0.673, and past a third of a dial the shell is
     * somewhere else entirely and the score is zero.
     */
    const k = err / MISS;
    sum += k >= 1 ? 0 : 1 - k * k;
  }
  return Math.max(0, Math.min(1, sum / DIALS.length));
}

/**
 * What a solved call is worth, and the ceiling is deliberately small.
 *
 * A perfect solution takes a tenth off the wait and a twentieth off the cost.
 * It is a reward for doing a thing well, not a second progression — and
 * because it dies with the run, a player who never touches the bench is behind
 * by one tenth of one cooldown, which is nothing.
 */
export function tuningFrom(score) {
  const k = Math.max(0, Math.min(1, Number(score) || 0));
  return { cooldown: 1 - 0.10 * k, cost: 1 - 0.05 * k };
}

/**
 * Set this run's tuning for one call. Run-scoped.
 *
 * `clock` is the station hour the solution was sent on, and passing it is what
 * arms the one-an-hour gate below — a caller that has no clock (a check, the
 * Codex preview) still sets a tuning and simply does not stamp one.
 */
export function setTuning(id, score, clock = null) {
  const s = read();
  s.tuned[id] = tuningFrom(score);
  if (Number.isFinite(clock)) s.solved[id] = Math.floor(clock);
  return write(s).tuned[id];
}

/** This run's tuning, or the identity. */
export function tuningFor(id) { return read().tuned[id] || { cooldown: 1, cost: 1 }; }

/* ══════════════════════════════════════════════════════════════════════════
 *  WHICH SHELL IS IN THE TUBE — the pick, and it is run-scoped too
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `benchFor` has always said which variants are open. Nothing said which one
 * you had FITTED, so twelve sidegrades sat behind a use count that nothing
 * incremented and reached no run even if it had. The pick is a decision you
 * make at #50 before you go, it holds for that run, and it dies with it — the
 * same contract the solution has and for the same reason: a sidegrade that
 * survived would be a loadout, and a loadout chosen once and kept is the
 * cross-run power `Progress.js` refuses.
 *
 * A pick that is not open is refused HERE and not at the panel, so a hand-
 * edited save cannot fit a shell it has not earned the right to.
 */
export function pick(id, variantId) {
  const s = read();
  if (!variantId) { delete s.picked[id]; return write(s).picked[id] ?? null; }
  const row = benchFor(id).find((v) => v.id === variantId && v.open);
  if (!row) return null;
  s.picked[id] = variantId;
  return write(s).picked[id];
}

/** The variant fitted to this call for this run, as a row, or null. */
export function pickedFor(id) {
  const want = read().picked[id];
  if (!want) return null;
  return benchFor(id).find((v) => v.id === want && v.open) || null;
}

/**
 * ══ THE ONE READER A CALL NEEDS ═══════════════════════════════════════════
 *
 * Everything this file knows about one support call, multiplied out into the
 * four numbers a call is made of. `Stratagems._open` and `_commit` ask this
 * and nothing else, so the fitted shell and the firing solution cannot be
 * applied in two places that disagree, and a stratagem row's own numbers stay
 * the only base there is.
 *
 * Identity is `{radius: 1, lead: 1, cooldown: 1, cost: 1}` — a player who has
 * never walked into either room fights with the table exactly as written.
 */
export function callMods(id) {
  const v = pickedFor(id)?.mods || {};
  const t = tuningFor(id);
  return {
    radius: v.radius ?? 1,
    lead: v.lead ?? 1,
    cooldown: (v.cooldown ?? 1) * t.cooldown,
    cost: (v.cost ?? 1) * t.cost,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE DRIFTING MARK — where the dials should be, this hour
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `solve(want, got)` needs a `want`, and the room is what generates it. Two
 * properties and both are load-bearing:
 *
 *   IT IS A PURE FUNCTION OF THE CLOCK AND THE CALL. No `Math.random` — the
 *     tree forbids one in `src/` and this is where one would be reached for
 *     first. Two players on the same station hour get the same problem, which
 *     is what makes a score worth comparing at all.
 *   IT MOVES EVERY HOUR. A fixed solution is a number you write down once and
 *     type in for ever, which is a password and not a skill.
 *
 * The hash is the integer mix `Store.js` and `Quests.js` already use for their
 * own day rolls; three draws off it, one per dial, each landing in 0.12..0.88
 * so no dial's answer is ever at an end stop you could hold and forget.
 */
function mix(n) {
  let h = (n | 0) + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
function idNum(id) {
  let n = 0;
  for (let i = 0; i < String(id).length; i++) n = (Math.imul(n, 31) + String(id).charCodeAt(i)) | 0;
  return n;
}

/** Where the mark STANDS for this call on this station hour — the centre. */
export function wantFor(id, clock = 0) {
  const base = idNum(id) * 7919 + Math.floor(Number(clock) || 0) * 104729;
  const out = {};
  for (let i = 0; i < DIALS.length; i++) out[DIALS[i]] = 0.12 + mix(base + i * 2654435761) * 0.76;
  return out;
}

/**
 * ══ AND IT DRIFTS, WHICH IS THE WHOLE OF THE TEST ═════════════════════════
 *
 * A mark that is shown and does not move is a number you copy into a box, and
 * `solve` would answer 1.000 for everybody. Each dial's mark swings about its
 * hour's centre at its own rate, so the three are never still together and a
 * solution is a moment as much as a setting: you set the dials, you watch, and
 * you send when the three of them are where you put them. That is a firing
 * solution, which is what the room is.
 *
 * `t` is seconds since the solution was opened, and everything about the swing
 * — centre, rate, phase — is a pure function of the call and the hour. No
 * `Math.random`: two players on the same station hour are handed the same
 * problem, which is the only thing that makes one score comparable to another.
 *
 * The rates are deliberately close together and irrational against each other
 * (0.45..1.20 rad/s), so the three come back into the same relationship only
 * every few minutes rather than every second.
 */
export const DRIFT = 0.18;

export function markAt(id, clock = 0, t = 0) {
  const c = wantFor(id, clock);
  const base = idNum(id) + Math.floor(Number(clock) || 0) * 31;
  const out = {};
  for (let i = 0; i < DIALS.length; i++) {
    const d = DIALS[i];
    const rate = 0.45 + mix(base + 977 * (i + 1)) * 0.75;
    const phase = mix(base + 613 * (i + 1)) * Math.PI * 2;
    const v = c[d] + Math.sin((Number(t) || 0) * rate + phase) * DRIFT;
    out[d] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

/**
 * ══ ONE ATTEMPT AN HOUR, AND THAT IS WHAT MAKES IT A TEST ═════════════════
 *
 * `solve` is cheap to call and the panel could offer a SEND every second; a
 * solution you may re-take until it is perfect is a button with extra steps,
 * and every player would arrive at 1.000. So the room takes one solution per
 * call per station hour — the same hour the shops reroll on and the medbay
 * heals on, which is the clock this whole deck already runs on. Walking out
 * and back in does not reset it, exactly as it does not reset a spin at #60.
 */
export function solvedAt(id) { const v = read().solved[id]; return Number.isFinite(v) ? v : null; }
export function canSolve(id, clock = 0) {
  const was = solvedAt(id);
  return was === null || Math.floor(Number(clock) || 0) > was;
}

/**
 * The run ended. THE TUNING GOES, and the fitted shell with it — that is what
 * keeps this a skill test: a bench solution is a provision in everything but
 * name and dies exactly as one does, and so does a sidegrade you chose for one
 * fight. `called` survives, because a count of what you have done is a record
 * and `Progress.js` has always allowed one of those.
 *
 * `solved` goes too. It is the hour-gate above, and holding it across a run
 * would mean the room refused you a solution for a run it had never given one
 * to — the gate exists to stop re-taking, not to ration by wall clock.
 */
export function clearTuning() {
  const s = read();
  s.tuned = {}; s.picked = {}; s.solved = {};
  return write(s);
}

/** Start again. Only a check calls this. */
export function clearBench() { store.drop(); _cache = null; return read(); }
