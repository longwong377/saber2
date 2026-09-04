/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE COUNTER — V16 Lane B, and it is one system for every shop in the drum
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player asked for a great many shops:
 *
 * > *"extensive shop system that you access through differernt vendors at the
 * > zocalo; very very long list of items you can purchase with credits …
 * > list of cosmetic things you can add and they have to get cooler and cooler
 * > and cooler the more expensive they get, the shops don't always have the
 * > same things, you can buy a bunch of shit for your compansions too and a
 * > bunch of shit for your apartment."*
 *
 * …plus food stalls, an armourer, a tailor, a barber, a black market and a
 * pay office. That is nine features or it is ONE, and the whole of V16's
 * second thesis is that four systems carry fourteen asks. A counter is:
 *
 *   A PERSON, drawn from the station's own census, who is not there forever.
 *   A STOCK TABLE — everything this counter could ever sell.
 *   A SHELF — six to ten rows drawn from it, for today.
 *   A PRICE, and a rarity ladder the art budget is spent at the top of.
 *   A GATE — who this vendor will and will not deal with.
 *
 * Write that once and the shops, the stalls, the armourer and the smuggler
 * are TABLES. Write nine of them and the ninth is unmaintainable.
 *
 * ── THE SHELF REROLLS, AND THAT IS THE WHOLE FEATURE ──────────────────────
 *
 * *"the shops don't always have the same things"* is the most important
 * sentence in that paragraph and the cheapest thing in it. A fixed catalogue
 * is a wiki page you read once; a shelf that changes is a reason to walk to
 * the Zocalo. So a shelf is drawn from a seed of `(counter, day)` — the same
 * for everyone on the station on that day, different tomorrow — and a row you
 * could afford and did not buy is GONE. That is the hook, and it costs one
 * hash.
 *
 * The station clock already exists and already persists (`StationSave.hour`),
 * so "the day" is a number this file can ask for rather than invent.
 *
 * ── TWO KINDS OF THING, AND ONLY TWO ──────────────────────────────────────
 *
 * `Progress.js`'s header carries the amendment and the argument; this file
 * obeys it. Every row is exactly one of:
 *
 *   KEEPSAKE    cosmetic, permanent, changes how something LOOKS and nothing
 *               else. `keepsake.mjs` measures a bought row's effect on the
 *               player's numbers and fails on any movement at all.
 *   PROVISION   a run's worth of something, gone when the run ends — the same
 *               contract the Holocron already has.
 *
 * There is no third kind. A row that is neither is refused by `saneRow` at the
 * door rather than at review time.
 *
 * ── AND IT KEEPS NO WALLET ────────────────────────────────────────────────
 *
 * The purse lives in `Credits.js` behind one door. This file prices things,
 * decides what is on the shelf and whether a vendor will serve you; it never
 * reads or writes a balance. That separation is what lets the currency scan
 * over `Credits.js` be a short file somebody can actually read.
 */

import { makeRng } from '../engine/MathUtil.js';
import { standing } from './StationSave.js';

/** The two kinds. There is no third, and `saneRow` refuses one. */
export const KINDS = ['keepsake', 'provision'];

/**
 * THE RARITY LADDER, and the player's *"cooler and cooler and cooler the more
 * expensive they get"* is a statement about where the ART goes rather than
 * about a price curve. So the ladder is short — four rungs, not nine — because
 * a rung nobody can tell from the one below it is a rung that cost a table row
 * and bought nothing.
 *
 *   `w` is how often a rung is drawn onto a shelf, `mul` what it does to a
 *   price, and `note` is what the vendor says about it.
 */
export const TIERS = {
  common: { w: 46, note: 'off the rack' },
  fine: { w: 30, note: 'kept behind the counter' },
  rare: { w: 18, note: 'one of a handful in the sector' },
  singular: { w: 6, note: 'there is not another' },
};

/**
 * ── AND A TIER IS NOT A PRICE MULTIPLIER, WHICH IT WAS FOR ONE HOUR ───────
 *
 * The first cut gave each rung a multiplier on top of the author's `base`, and
 * the two compounded: a singular authored at 2600 came out of the shelf at
 * 57,200, which against `Credits.PER_RUN_CAP` of 900 is SIXTY-FOUR capped
 * runs. `Progress.js`'s amendment promises the dearest things cost "several
 * runs" and that is the whole of what bounds the economy, so the number was
 * not a tuning miss — it broke the guarantee the doctrine was amended on.
 *
 * The cause is that two people were setting one number. `base` IS the price,
 * in credits, and a rung now decides only how OFTEN a row reaches a shelf and
 * what the vendor says about it. One author, one number, and a price you can
 * read off the table and divide by 900 in your head.
 */
export const TIER_IDS = Object.keys(TIERS);

/**
 * How many rows a counter puts out.
 *
 * ── A FRACTION OF THE TABLE, NOT A CONSTANT ──────────────────────────────
 *
 * This was a flat six-to-ten and six of the seven counters then put out the
 * SAME SHELF EVERY DAY, because a shelf of six drawn from a stock of five is
 * the stock. The reroll is the whole feature — *"the shops don't always have
 * the same things"* — and a constant shelf size quietly deletes it on every
 * counter that has not been given a long table yet.
 *
 * So a shelf is a fraction of what the counter could sell, and
 * `stockedEnough` below refuses a counter whose table is too short for one:
 * a vendor with nothing held back is a wiki page, and finding that out by
 * reading six shelves is worse than being told at the door.
 */
export const SHELF_SHARE = 0.55;
export const SHELF_MIN = 4, SHELF_MAX = 10;
/** How much a counter must hold back for its shelf to be able to change. */
export const HELD_BACK = 4;

/**
 * Can this counter's shelf actually reroll? A table no bigger than the shelf
 * it puts out is a fixed shelf, whatever the seed does.
 */
export function stockedEnough(counter) {
  const n = (counter?.stock || []).length;
  return n >= SHELF_MIN + HELD_BACK;
}

/**
 * WHO A VENDOR WILL DEAL WITH.
 *
 * *"certain items are asscessible only to jedi and some only to sith
 * affiliated, like maybe some vendors reduce to work with sepratists while the
 * black market smuggler types only deal with sith."*
 *
 * A row may name a `side`; a counter may name a `refuse`. Both are read
 * against the order the player is running, and a refusal SAYS WHY in the
 * vendor's own voice — a shutter that comes down without a word is a bug
 * report, not a character.
 */
export const SIDES = ['jedi', 'sith', 'republic', 'separatist'];

/**
 * AND V15's `standing` GETS ITS FIRST REAL READER.
 *
 * It has been in the station fold since V15 §1.1, falls when you hurt a
 * resident, and until now nothing anywhere asked for it. A vendor who has
 * heard about you charges more, and past a point does not open at all. That is
 * the consequence the number was written for.
 *
 *   +40 → 0.88x    a regular, and they knock a bit off
 *     0 → 1.00x
 *   -20 → 1.30x    they have heard
 *   -40 → shut
 */
export function markupFor(s = standing()) {
  const n = Math.max(-40, Math.min(40, Number(s) || 0));
  if (n <= -34) return { open: false, mul: Infinity, why: 'they will not open the shutter for you' };
  return { open: true, mul: 1 + (n < 0 ? -n * 0.0095 : -n * 0.003), why: null };
}

/**
 * Is this a row a counter may carry? Refused at the door, because a row that
 * is neither a keepsake nor a provision is the third category the doctrine
 * forbids, and finding it at review time means it already shipped.
 */
export function saneRow(r) {
  if (!r || typeof r !== 'object') return null;
  if (!KINDS.includes(r.kind)) return null;
  if (!r.id || typeof r.id !== 'string') return null;
  if (!TIERS[r.tier]) return null;
  if (!(Number(r.base) > 0)) return null;
  /* A KEEPSAKE MAY NOT CARRY A NUMBER. Not "should not" — the field is
   * refused, so the only way to ship a cosmetic that buys power is to lie
   * about its kind, which `keepsake.mjs` then catches on the body. */
  if (r.kind === 'keepsake' && (r.grants || r.mods || r.effect)) return null;
  /* A PROVISION MUST SAY IT DIES. `runOnly` is not a default: a provision
   * without it would be permanent power wearing the other word. */
  if (r.kind === 'provision' && r.runOnly !== true) return null;
  if (r.side && !SIDES.includes(r.side)) return null;
  return r;
}

/** What a row costs today, before the vendor's opinion of you. */
export function priceOf(row) {
  const r = saneRow(row);
  if (!r) return Infinity;
  return Math.max(1, Math.round(r.base));
}

/** …and after it. `standing` is the second half of a price. */
export function askingPrice(row, s = standing()) {
  const m = markupFor(s);
  if (!m.open) return { price: Infinity, open: false, why: m.why };
  return { price: Math.max(1, Math.round(priceOf(row) * m.mul)), open: true, why: null };
}

/**
 * ══ THE SHELF ═════════════════════════════════════════════════════════════
 *
 * Drawn from `(counter id, day)` so it is the SAME for everyone on the station
 * on that day and different tomorrow. Not from the run's seed and not from
 * `Math.random`: two players standing at one counter must see one shelf, and a
 * shelf that changed when you looked away would be a slot machine.
 *
 * Weighted by tier without replacement, so a singular row is rare on a shelf
 * rather than rare in the table and then always out.
 */
export function shelfFor(counter, day = 0) {
  const rows = (counter?.stock || []).map(saneRow).filter(Boolean);
  if (!rows.length) return [];
  /* One stream per counter per day. `makeRng` is the tree's own; nothing here
   * touches `Math.random`, which `determinism.mjs` refuses in `src/`. */
  const rng = makeRng(hashOf(`${counter.id}:${day | 0}`));
  /* A share of the table, jittered by a row either way so two counters with
   * the same stock size do not put out the same number of things. */
  const share = Math.round(rows.length * SHELF_SHARE) + (rng() < 0.5 ? 0 : 1);
  const want = Math.max(SHELF_MIN, Math.min(rows.length, Math.min(SHELF_MAX, share)));
  const pool = rows.slice();
  const out = [];
  while (out.length < want && pool.length) {
    let total = 0;
    for (const r of pool) total += TIERS[r.tier].w;
    let x = rng() * total;
    let i = 0;
    for (; i < pool.length; i++) { x -= TIERS[pool[i].tier].w; if (x <= 0) break; }
    out.push(pool.splice(Math.min(i, pool.length - 1), 1)[0]);
  }
  /* Dearest last, so a shelf reads as a shelf rather than as a list. */
  out.sort((a, b) => priceOf(a) - priceOf(b));
  return out;
}

/** A stable 32-bit hash of a string. Not a seed generator — a seed. */
function hashOf(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) || 1;
}

/**
 * Will this counter serve this player, and at what price?
 *
 * `order` is the player's own — `Order.js`'s id — which is what the two
 * faction gates read. Both refusals SPEAK: a shutter with no line behind it is
 * indistinguishable from a bug.
 */
export function offerFrom(counter, opts = {}) {
  const day = opts.day | 0;
  const order = opts.order || null;
  const s = opts.standing ?? standing();
  const m = markupFor(s);
  if (!m.open) return { open: false, why: counter?.shut || m.why, rows: [] };
  if (counter?.refuse && order && counter.refuse.includes(order)) {
    return { open: false, why: counter.refuseLine || 'they look at your order and shake their head', rows: [] };
  }
  /**
   * ── AND SOME COUNTERS ARE NOT THERE EVERY DAY ─────────────────────────
   *
   * `openDays` was declared on the black market with a note saying "NOT OPEN
   * EVERY DAY — the shelf's own seed decides, so a day it is shut is the same
   * day for everyone and is not a roll you can re-take by walking out and back
   * in", and NOTHING READ IT. Fourteen days swept, open on fourteen. A
   * promise in the data that no code keeps is the dead control this tree keeps
   * deleting, wearing a field name.
   *
   * It is rolled off `(counter, day)` — the shelf's own seed shape and for the
   * shelf's own reason: everyone on the station finds the same shutter down on
   * the same day, and walking out and back in does not re-roll it. A counter
   * with no `openDays` is open, which is every counter but this one and is
   * what a shop normally is.
   */
  const days = Number(counter?.openDays);
  if (Number.isFinite(days) && days < 1) {
    const rng = makeRng(hashOf(`${counter.id}:shut:${day | 0}`));
    rng(); rng();
    if (rng() >= days) return { open: false, why: counter?.shut || 'not today', rows: [] };
  }
  const rows = shelfFor(counter, day).filter((r) => !r.side || !order || r.side === order);
  return {
    open: true,
    why: null,
    keeper: counter?.keeper || null,
    rows: rows.map((r) => ({ ...r, price: askingPrice(r, s).price, note: TIERS[r.tier].note })),
  };
}
