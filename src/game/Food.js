/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE FOOD — V16 Lane B5, and it is a counter row from end to end
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player's ask, in full:
 *
 * > *"you can buy food and there could be a small cutscene of it being cooked
 * > then you can take it home and store it in your apartment and eat it for
 * > buffs, droids charge instead of eating."*
 *
 * ── WHAT THIS FILE IS NOT ─────────────────────────────────────────────────
 *
 * IT IS NOT A SHOP. `Counter.js` is the shop and `Vendors.js` is its content,
 * and twenty-one dishes are already sitting in it as rows on `FOOD_COURT`,
 * `FRESH_AIR` and `NARN_MARKET`. A second table of food beside that one would
 * be two answers to what a bowl of noodle costs, and the one the player read
 * off the board would be the one that was wrong. So a dish here is exactly a
 * counter row — this file adds no row, prices nothing, and holds no shelf.
 * `dishes()` is a FILTER over `Vendors.everyRow()`, and the day's menu is the
 * counter's own `shelfFor(counter, day)` with the non-food struck out.
 *
 * IT IS NOT A STORE. The larder is `Home.js`'s `store.food` field, which that
 * file's header has been reserving for this since V15 and which goes through
 * the station's own fold. Nothing here writes anything anywhere: every
 * function takes the rows and hands back new rows, so a check can drive a
 * week of shopping without a disk.
 *
 * IT IS NOT A CUTSCENE. See THE COOKING below.
 *
 * ── AND IT IS A PROVISION, WHICH IS A LOAD-BEARING WORD ───────────────────
 *
 * `Progress.js`'s AMENDMENT — CREDITS narrows "no currency" to two kinds of
 * thing, and food is the second one: **a run's worth of something, gone when
 * the run ends.** Three consequences, and all three are measured in
 * `tools/checks/food.mjs` rather than promised here:
 *
 *   A MEAL'S EFFECT IS NEVER STORED. `eat` returns a record and writes
 *     nothing. There is no durable field anywhere in the tree that a buff
 *     could live in, which is a stronger guarantee than a routine that
 *     remembers to clear one — there is nothing to forget.
 *   A DISH DOES NOT SURVIVE A DEATH. `afterDeath` empties the larder of
 *     everything that carries a run effect, which today is everything in it.
 *   NO DISH MOVES A PERMANENT NUMBER. Every mod a dish carries is on the
 *     slot record and expires off the station clock.
 *
 * ── THE SLOT, AND WHY THERE IS EXACTLY ONE ────────────────────────────────
 *
 * *"droids charge instead of eating"* — the player's own sentence says there
 * is A SLOT that a meal fills and a charge fills differently. So there is one,
 * and eating a second thing while the first is still in you is REFUSED with
 * the time left rather than stacked.
 *
 * That is not a restriction bolted on for balance. A stack turns the food
 * court into a checklist you clear before every run — nine dishes, nine
 * multipliers, every run — which is the shape V16 §B5 already refused when it
 * refused a hunger bar: *"a full stomach is a BUFF and an empty one is no buff
 * and nothing else."* One slot keeps a meal a choice.
 */

import { shelfFor } from './Counter.js';
import { everyRow } from './Vendors.js';
import { kindOfArmy } from './Attributes.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE CLOCK                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/** §3.4's day, in hours. `StationSave.hour` runs 0..24 and wraps. */
export const HOURS_IN_DAY = 24;

/**
 * ONE NUMBER FOR "WHEN", AND IT HAS TO BE ABSOLUTE.
 *
 * `StationSave.stationHour()` is an hour of the day and nothing else, so a jar
 * stowed at 22:00 and read at 03:00 is five hours old or twenty-nine and the
 * hour alone cannot say which. Everything in this file that measures a
 * DURATION — how long a dish keeps, how long a meal lasts — runs on
 * `day * 24 + hour` instead, which the counters already take as `day` and
 * which `Counter.shelfFor` and `Tote.cardAt` are both already handed.
 */
export const clockOf = (day = 0, hour = 0) => (Number(day) || 0) * HOURS_IN_DAY + (Number(hour) || 0);

/* ══════════════════════════════════════════════════════════════════════════ */
/*  WHAT A DISH IS                                                            */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * A dish is a PROVISION whose effect names `hours`.
 *
 * That is not a convention invented here — `Vendors.FOOD_COURT` and its two
 * neighbours already write `{ hours: 3, staminaRegen: 1.12 }`, and the field's
 * own comment says "how long it lasts on the station clock". Every provision
 * that is not food — a stim, a stratagem charge, whatever is in the black
 * vial — carries no `hours` and is therefore not a dish, which is why this
 * test is a test about the row rather than a list of ids to keep in step.
 */
export function isDish(row) {
  return !!row && row.kind === 'provision' && row.runOnly === true
    && !!row.effect && Number.isFinite(row.effect.hours) && row.effect.hours > 0;
}

/** Every dish any counter on the station could ever put on a board. */
export function dishes() { return everyRow().filter(isDish); }

/**
 * One dish by id, from the counters or from the charge table.
 *
 * INDEXED ONCE. `keepingLeft` runs this per row per read of the larder and
 * `everyRow()` flat-maps seven counters, so the naive version rebuilt the
 * whole catalogue thirty-two times to answer thirty-two questions about it.
 * The tables are module-scope literals and cannot change under this.
 */
let _byId = null;
export function dishById(id) {
  if (!_byId) {
    _byId = new Map();
    for (const d of dishes()) _byId.set(d.id, d);
    for (const c of CHARGES) _byId.set(c.id, c);
  }
  return _byId.get(id) || null;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  HOW IT IS MADE — one table, two features                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE PREP, AND WHY IT CARRIES BOTH THE CUTSCENE AND THE SHELF LIFE ═════
 *
 * The player asked for two separate things and they are the same fact about a
 * dish. *"a small cutscene of it being cooked"* is HOW IT IS MADE; *"take it
 * home and store it"* asks how long the thing survives the walk, which is
 * also how it is made — a wok bowl is dead in four hours and a sealed jar
 * keeps for three days, and neither of those numbers is a taste.
 *
 * So there is one classification. `steps` is the cooking; `keeps` is the
 * station hours it will still be worth eating after. Writing them as two
 * tables would let a dish be cooked over coals and keep like a sealed jar,
 * with nothing anywhere to say so.
 *
 * ── THE STEPS ARE A TABLE AND NOT A RENDERER ──────────────────────────────
 *
 * `Warp.js`'s PHASES is the precedent and the reason is stated there: a
 * sequence written as data is drivable at 6 ms a step by a check, and a
 * sequence written as an animation is not. Nothing in here draws, waits, or
 * takes the camera; `Cook` below is a clock over the table and a surface plays
 * it out. A check asserts it terminates and reads right, which is the whole
 * of what can be asserted about a cutscene.
 *
 * `t` is seconds. Every prep totals between two and six, which is *"small"*.
 */
export const PREP = {
  wok: {
    keeps: 4, note: 'A bowl off a burner is dead by the end of the watch.',
    steps: [
      { id: 'order', t: 0.8, say: 'You point at the board. He does not write it down.' },
      { id: 'fire', t: 0.9, say: 'The burner comes up under the wok and the whole counter goes orange.' },
      { id: 'toss', t: 1.5, say: 'Three tosses, a splash off a tin, and it catches for a second.' },
      { id: 'plate', t: 0.8, say: 'Into the bowl in one movement, and the burner is already down.' },
    ],
  },
  fry: {
    keeps: 5, note: 'It was never going to be good cold. It is not good cold.',
    steps: [
      { id: 'order', t: 0.8, say: 'You point. He nods at the oil.' },
      { id: 'in', t: 0.9, say: 'It goes into the oil and the noise fills the counter.' },
      { id: 'turn', t: 1.2, say: 'Turned once with a wire spider. Nobody times it; he knows.' },
      { id: 'drain', t: 0.9, say: 'Out onto a rack, shaken twice, wrapped in paper.' },
    ],
  },
  pot: {
    keeps: 8, note: 'A pot dish is better the next watch, right up until it is not.',
    steps: [
      { id: 'order', t: 0.8, say: 'He lifts the lid and looks at you rather than at the pot.' },
      { id: 'skim', t: 1.4, say: 'A skim off the top. Whatever comes off goes in a tin under the counter.' },
      { id: 'ladle', t: 1.2, say: 'Two ladles. The second is the one with anything in it.' },
      { id: 'salt', t: 0.8, say: 'Salt from a bowl, by hand, without measuring.' },
    ],
  },
  steam: {
    keeps: 4, note: 'Out of the basket it goes tough within the watch.',
    steps: [
      { id: 'order', t: 0.7, say: 'He takes the top basket off a stack of six.' },
      { id: 'lid', t: 1.3, say: 'The lid goes on and the steam finds the gap along one side.' },
      { id: 'wait', t: 1.8, say: 'Nothing happens for a while. That is the whole method.' },
      { id: 'off', t: 0.8, say: 'The basket comes off the stack and onto the counter, still in it.' },
    ],
  },
  grill: {
    keeps: 6, note: 'Charred outside, so it travels better than it has any right to.',
    steps: [
      { id: 'order', t: 0.7, say: 'He picks one out of the tray without looking at the tray.' },
      { id: 'coals', t: 1.0, say: 'Onto the bars. The fat goes into the coals and comes back as smoke.' },
      { id: 'turn', t: 1.4, say: 'Turned twice, brushed once, from a jar nobody else is allowed to touch.' },
      { id: 'rest', t: 1.0, say: 'Off the heat and left alone a moment, which is the part people skip.' },
    ],
  },
  pass: {
    keeps: 6, note: 'A kitchen dish, boxed at the pass by somebody who disapproves.',
    steps: [
      { id: 'order', t: 0.9, say: 'The order goes through the pass on a paper. Somebody behind it repeats it back.' },
      { id: 'wait', t: 1.8, say: 'You can hear more of it than you can see.' },
      { id: 'ring', t: 0.9, say: 'The bell on the pass goes once.' },
      { id: 'carry', t: 1.0, say: 'It is carried out and set down square to the edge of the table.' },
    ],
  },
  poured: {
    keeps: 2, note: 'A poured glass is drunk where it was poured. Carrying one home is a decision you will regret.',
    steps: [
      { id: 'order', t: 0.6, say: 'He has the bottle in his hand before you have finished asking.' },
      { id: 'pour', t: 1.2, say: 'Poured with the glass tipped over, and straightened at the end.' },
      { id: 'set', t: 0.6, say: 'Set down in front of you, on a mat, turned the right way round.' },
    ],
  },
  cold: {
    keeps: 10, note: 'Nothing was done to it, so nothing can undo it in a hurry.',
    steps: [
      { id: 'order', t: 0.6, say: 'He does not cook it, and he would like you to know that.' },
      { id: 'cut', t: 1.1, say: 'Cut on a board that has never been used for anything else.' },
      { id: 'plate', t: 0.7, say: 'Onto a plate. There is not any more to it than that.' },
    ],
  },
  sealed: {
    keeps: 72, note: 'THREE DAYS, and it is the only thing on the station worth stocking a larder with.',
    steps: [
      { id: 'order', t: 0.6, say: 'He reaches under the counter without breaking eye contact.' },
      { id: 'check', t: 1.0, say: 'The seal is turned to the light and looked at, twice.' },
      { id: 'hand', t: 0.7, say: 'Handed over still sealed. Do not open it in here.' },
    ],
  },
  live: {
    keeps: 3, note: 'It was alive when you ordered it. That is the shelf life.',
    steps: [
      { id: 'order', t: 0.8, say: 'He asks once whether you are sure.' },
      { id: 'lift', t: 1.1, say: 'The lid comes off the tank and the noise out of it changes.' },
      { id: 'still', t: 1.6, say: 'It is better if you do not watch this part. He does not hurry it.' },
      { id: 'done', t: 0.9, say: 'It stops moving. He waits a moment longer than he needs to.' },
    ],
  },
  /**
   * AND THE DROID'S, WHICH IS DELIBERATELY THE DULLEST ONE HERE.
   *
   * *"droids charge instead of eating."* A charge fills the same slot and is
   * not a meal, and the honest way to say that in a sequence is to make it
   * longer and less interesting than every dish on the station: no fire, no
   * knife, no smell, one handshake and a wait. `keeps` is 0 because a charge
   * is drawn where it is drawn — there is nothing to carry home, which is
   * `stowable` below and is measured.
   */
  charge: {
    keeps: 0, note: 'Current is not something you take home in a box.',
    steps: [
      { id: 'plug', t: 0.9, say: 'The cable goes in. Nothing about this is a meal.' },
      { id: 'hand', t: 1.6, say: 'A handshake with the station bus. It is refused once, then allowed.' },
      { id: 'draw', t: 2.4, say: 'Current. The status ring cycles and it takes exactly as long as it takes.' },
      { id: 'seat', t: 0.9, say: 'Full. The cable is stowed and the hatch shuts itself.' },
    ],
  },
};

/**
 * WHICH DISH IS MADE WHICH WAY — one word each, and there is no default.
 *
 * A row here is a judgement about a dish that its own `blurb` already implies:
 * live spoo has its own prep because the whole of its line — *"it is better if
 * you do not watch"* — is about the making of it, and a jar of pickle is
 * `sealed` because that is what a jar is.
 *
 * ── AND A DISH WITH NO ROW IS AN ERROR, NOT A DEFAULT ─────────────────────
 *
 * `prepOf` returns null rather than guessing, and `food.mjs` fails on any dish
 * in `Vendors.js` that is not in this table. That is `determinism.mjs`'s own
 * rule — "a missing thing gets an error, never a plausible default" — and it
 * is the whole reason to hold it here: the next person to add a row to
 * `FOOD_COURT` gets a red check naming their dish and asking for one word,
 * instead of a bowl that silently cooks like a jar of pickle and keeps for
 * three days.
 */
export const PREP_OF = {
  /* #17 The food court — cheap, fast, and under a low ceiling. */
  'f-noodle': 'wok', 'f-noodle-big': 'wok',
  'f-flatbread': 'fry', 'f-roll': 'fry',
  'f-stew': 'pot', 'f-broth': 'pot',
  'f-pickle': 'sealed',
  'f-dumpling': 'steam',
  'f-skewer': 'grill',
  /* #15 The Fresh Air — you sit down, and there is a kitchen behind the pass. */
  'f-plate': 'pass', 'f-roast': 'pass', 'f-fish': 'pass',
  'f-soup': 'pot',
  'f-bread': 'cold',
  'f-brandy': 'poured', 'f-wine': 'poured',
  /* #32 The Narn quarter — things a human should not eat. */
  'f-flarn': 'pot',
  'f-breen': 'cold', 'f-tuffle': 'cold',
  'f-spoo': 'live',
  'f-methane': 'sealed',
  /* The droid's, and it is not sold anywhere. See `CHARGES`. */
  'c-trickle': 'charge', 'c-post': 'charge',
};

/** How this dish is made, or null if nobody has said. See `PREP_OF`. */
export function prepOf(dish) {
  const key = typeof dish === 'string' ? dish : dish?.id;
  const id = PREP_OF[key];
  return id ? { id, ...PREP[id] } : null;
}

/** How many station hours this dish is still worth eating after it is made. */
export function keepsFor(dish) { return prepOf(dish)?.keeps ?? 0; }

/** Can this be carried home at all? A poured glass can; current cannot. */
export function stowable(dish) { return keepsFor(dish) > 0; }

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE MENU — the counter's own shelf, with the shopping struck out          */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * What is on the board at this counter today.
 *
 * `shelfFor(counter, day)` is `Counter.js`'s and the seed is `(counter, day)`,
 * so this is the SAME board for everyone on the station on that day and a
 * different one tomorrow — which is the reroll `Counter.js`'s header calls
 * "the most important sentence in that paragraph and the cheapest thing in
 * it". Nothing is re-seeded here and no second stream exists: a menu that
 * rerolled on its own would show a different board to the shelf standing
 * behind it, at the same counter, on the same day.
 *
 * The filter is why this function exists at all. `FRESH_AIR` sells a
 * tablecloth and `NARN_MARKET` sells a banner; a food surface should not
 * offer to cook either.
 */
export function menuAt(counter, day = 0) {
  return shelfFor(counter, day).filter(isDish);
}

/**
 * …and the board a surface actually draws: the dish, how it is made, how long
 * it keeps and how long it lasts in you. Derived on every read, because four
 * of those five are already facts about the row.
 */
export function boardAt(counter, day = 0) {
  return menuAt(counter, day).map((d) => ({
    id: d.id, name: d.name, blurb: d.blurb, base: d.base, tier: d.tier,
    prep: prepOf(d)?.id || null,
    keeps: keepsFor(d),
    lasts: d.effect.hours,
    seconds: cookSeconds(d),
  }));
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE COOKING                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * How long the hand-over takes, and it is one step rather than eleven.
 *
 * Every prep ends the same way — the thing arrives and the person who made it
 * says the one line about it that is worth saying. That line already exists:
 * it is the dish's own `blurb`, written by whoever wrote the row, and reusing
 * it means twenty-one dishes cost twenty-one words of new writing between them
 * instead of twenty-one closing lines that would drift out of step with the
 * board the moment somebody re-priced a bowl.
 */
export const HANDOVER = 1.2;

/**
 * The whole sequence for one dish: the prep's steps, then the hand-over.
 * Pure, allocating a new array — a surface plays it, a check drives it.
 */
export function cookFor(dish) {
  const d = typeof dish === 'string' ? dishById(dish) : dish;
  const p = prepOf(d);
  if (!d || !p) return null;
  return {
    dish: d.id,
    name: d.name,
    prep: p.id,
    steps: [
      ...p.steps.map((s) => ({ ...s })),
      { id: 'over', t: HANDOVER, say: `${d.name}. ${d.blurb}` },
    ],
  };
}

/** How many seconds the whole thing takes. Between two and eight, always. */
export function cookSeconds(dish) {
  const c = cookFor(dish);
  return c ? c.steps.reduce((a, s) => a + s.t, 0) : 0;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * ══ ONE COOKING, IN PROGRESS ══════════════════════════════════════════════
 *
 * `Warp.js`'s class, at a tenth of the size, and for the same reason: the
 * sequence is a pure function of how much time has been handed to it, so a
 * check drives it at 6 ms a step and asserts that it lands.
 *
 * `sink` is handed in rather than imported — `say(line)` once per step, and
 * `done(dish)` when the thing is over the counter — so the whole cutscene runs
 * with no world, no DOM and no camera. THE PLAYER IS NEVER TAKEN OFF THEIR
 * FEET: `Warp.js` argues this at length for the jump and the argument is the
 * same one here, and smaller — a person standing at a counter watching a man
 * cook does not need the camera taken away to understand what is happening.
 */
export class Cook {
  constructor(dish, sink = {}) {
    const c = cookFor(dish);
    this.of = c ? c.dish : null;
    this.steps = c ? c.steps : [];
    this.sink = sink;
    this.i = 0;
    this.t = 0;
    this.done = this.steps.length === 0;
    this._said = -1;
    this.seconds = this.steps.reduce((a, s) => a + s.t, 0);
  }

  /** Which step, by id. `'done'` once the thing is over the counter. */
  get stepId() { return this.done ? 'done' : this.steps[this.i].id; }

  /** The line on screen right now, or null. */
  get line() { return this.done ? null : this.steps[this.i].say; }

  /** How far through, 0..1 — for a bar, if a surface wants one. */
  get progress() {
    if (this.done) return 1;
    let before = 0;
    for (let k = 0; k < this.i; k++) before += this.steps[k].t;
    return clamp01((before + this.t) / (this.seconds || 1));
  }

  /**
   * One frame. Returns the step id, so a caller can act on a transition
   * without keeping a second copy of the schedule.
   *
   * IT ADVANCES BY MORE THAN ONE STEP IF IT HAS TO. A `dt` bigger than a step
   * — a stalled frame, a check driving it in one call — must land on the end
   * rather than leave the last two lines unsaid, which is what a single
   * `if (t >= P.t)` would do.
   */
  step(dt) {
    if (this.done) return 'done';
    this.t += Number(dt) || 0;
    for (;;) {
      if (this._said !== this.i) {
        this._said = this.i;
        this.sink.say?.(this.steps[this.i].say);
      }
      if (this.t < this.steps[this.i].t) return this.steps[this.i].id;
      this.t -= this.steps[this.i].t;
      this.i++;
      if (this.i >= this.steps.length) {
        this.done = true;
        this.t = 0;
        this.sink.done?.(this.of);
        return 'done';
      }
    }
  }

  /** Cut it short and hand it over — a save, a teardown, a player walking off. */
  finish() {
    if (this.done) return;
    for (let k = this.i; k < this.steps.length; k++) this.sink.say?.(this.steps[k].say);
    this.done = true;
    this.sink.done?.(this.of);
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DROID BRANCH                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * The two kinds of eater, and the words are the tree's own.
 *
 * `Attributes.kindOfArmy` has answered `'flesh'` or `'steel'` since the
 * separatist roll existed, and `Command.js` reads the same two off a body's
 * cloth. There is no third word for this here: a droid is `steel` in this file
 * because it is `steel` in the four files that already had an opinion.
 */
export const EATER_KINDS = ['flesh', 'steel'];
export function eaterKind(army) { return kindOfArmy(army); }

/**
 * ══ WHAT A DROID DOES INSTEAD, AND IT IS FREE ═════════════════════════════
 *
 * A charge is NOT a counter row and is deliberately not for sale. Two reasons,
 * and the second is the one that matters:
 *
 *   THERE IS NOWHERE TO SELL IT. #51 The droid pool and every powered wall on
 *     the station already carry the station's own bus. Nobody sells you the
 *     air either.
 *   A DROID MUST NOT BE PRICED OUT OF THE ONLY THING IT CAN DO. If a fleshy
 *     man can eat for 11 credits and a droid has to pay for current, then
 *     playing a separatist roll costs money to do the same thing — which is a
 *     tax on a choice, and `Progress.js`'s amendment allows a shop, not a
 *     handicap.
 *
 * So the trade is TIME and VARIETY rather than credits: `PREP.charge` is the
 * longest sequence in the file, there are two of these against twenty-one
 * dishes, and neither is as good as the roast. A droid is never hungry and
 * never delighted.
 *
 * They are shaped exactly as a counter provision — `kind`, `runOnly`, `effect`
 * with `hours` — so `isDish` accepts them, `eat` needs no branch for them, and
 * they fill the same slot. That is the player's *"instead of"*, structurally.
 */
export const CHARGES = [
  {
    kind: 'provision', id: 'c-trickle', name: 'A trickle off a wall socket', tier: 'common',
    base: 1, runOnly: true, free: true,
    effect: { hours: 3, staminaRegen: 1.10 },
    blurb: 'Anywhere there is a powered wall. It is not a good charge and it is everywhere.',
  },
  {
    kind: 'provision', id: 'c-post', name: 'A post at the droid pool', tier: 'common',
    base: 1, runOnly: true, free: true,
    effect: { hours: 6, staminaRegen: 1.18, ward: 0.96 },
    blurb: 'A proper bus, in #51, with a rack of them along the wall. Nobody charges anybody for it.',
  },
];

/** Is this row a charge rather than a dish? */
export function isCharge(row) { return !!row && !!row.free && prepOf(row)?.id === 'charge'; }

/** What this kind of eater takes: the dishes, or the charges. */
export function offeredTo(kind) {
  return kind === 'steel' ? CHARGES.slice() : dishes();
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE SLOT — eating, and being full                                         */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * Take a dish or a charge.
 *
 * Returns `{ ok, why, slot }` and never throws. A refusal SAYS WHY in the
 * station's own voice, which is `Counter.offerFrom`'s rule and is worth
 * repeating: a door that closes without a line is indistinguishable from a
 * defect, and the player is the one who has to tell them apart.
 *
 * `slot` is the whole of what a meal is. It goes on the RUN — `world.run`, a
 * screen, a check's local — and nowhere else, and there is no function in this
 * file that writes it anywhere. See the header.
 */
export function eat(row, opts = {}) {
  const d = typeof row === 'string' ? dishById(row) : row;
  const kind = opts.kind === 'steel' ? 'steel' : 'flesh';
  const now = Number.isFinite(opts.clock) ? opts.clock : clockOf(opts.day, opts.hour);
  const slot = opts.slot || null;

  if (!isDish(d)) return { ok: false, why: 'that is not something anybody eats', slot };
  if (!prepOf(d)) return { ok: false, why: `nobody has said how ${d.name} is made`, slot };

  /* THE TWO REFUSALS THE PLAYER ASKED FOR, and each is the other's mirror. */
  if (isCharge(d) && kind !== 'steel') {
    return { ok: false, why: 'you have nowhere to plug it in', slot };
  }
  if (!isCharge(d) && kind === 'steel') {
    return { ok: false, why: 'a droid has no stomach — there is a rack of posts at the droid pool', slot };
  }

  /* AND THE SLOT IS ONE SLOT. See the header for why this refuses rather than
   * stacks. It reports the time left, so the refusal is information. */
  if (slot && now < slot.until) {
    const left = slot.until - now;
    return {
      ok: false,
      why: `you are still full of ${slot.name} — ${left.toFixed(1)} h of it left`,
      left, slot,
    };
  }

  const mods = {};
  for (const k of Object.keys(d.effect)) { if (k !== 'hours') mods[k] = d.effect[k]; }
  return {
    ok: true, why: null,
    slot: {
      of: d.id,
      name: d.name,
      kind: isCharge(d) ? 'charge' : 'meal',
      from: now,
      until: now + d.effect.hours,
      mods,
    },
  };
}

/** Is there still something in the slot? */
export function full(slot, clock = 0) { return !!slot && clock < slot.until; }

/**
 * What the slot is doing to you right now — the mods, or nothing at all.
 *
 * A NEW OBJECT EVERY TIME AND NEVER THE SLOT'S OWN. Handing back the stored
 * table would let a caller that merges mods in place edit the meal it is
 * reading, and a buff that grew every frame is the exact failure the doctrine
 * is written against.
 */
export function modsOf(slot, clock = 0) { return full(slot, clock) ? { ...slot.mods } : {}; }

/** How long is left in the slot, in station hours. Zero when it is empty. */
export function leftIn(slot, clock = 0) { return full(slot, clock) ? slot.until - clock : 0; }

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE LARDER                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ IT IS `Home.js`'s `store.food`, AND IT WAS ALWAYS GOING TO BE ═════════
 *
 * That field has been in the home's record since V15 with a comment naming
 * this lane: *"food is bought at a counter, carried and stored at home … so
 * they are one field with two lists in it, validated from the first version so
 * that landing B5 adds rows rather than a migration."* It does. This file
 * holds the arithmetic and `Home.js` holds the pen — `stowFood`, `takeFood`
 * and `emptyLarder` over there are four lines each and go through
 * `setHomeStock`, which is the one door onto the station's fold.
 *
 * A ROW IS `{ id, n, t }`. `id` and `n` are `Home.clean`'s own, already
 * clamped; `t` is the absolute clock the batch was stowed at, which is the one
 * field this lane added and the only thing that can answer how old a jar is.
 *
 * All of it is pure: rows in, new rows out. Nothing here reads or writes a
 * store, so a check drives a week of shopping without touching a disk.
 */
export const LARDER_ROWS = 32;
export const STACK_MAX = 99;

/** Put `n` of a dish in. Refuses, and says why, rather than dropping it. */
export function stow(rows, dish, opts = {}) {
  const list = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [];
  const d = typeof dish === 'string' ? dishById(dish) : dish;
  const n = Math.max(1, Math.round(Number(opts.n) || 1));
  const now = Number.isFinite(opts.clock) ? opts.clock : clockOf(opts.day, opts.hour);
  if (!isDish(d)) return { ok: false, why: 'that does not go in a larder', rows: list };
  if (!stowable(d)) {
    return { ok: false, why: `${d.name} does not travel — ${prepOf(d)?.note || 'it is drunk where it is poured'}`, rows: list };
  }
  const at = list.findIndex((r) => r.id === d.id);
  if (at < 0 && list.length >= LARDER_ROWS) {
    return { ok: false, why: 'the larder is full', rows: list };
  }
  if (at < 0) { list.push({ id: d.id, n: Math.min(STACK_MAX, n), t: now }); return { ok: true, why: null, rows: list }; }
  /**
   * A SECOND BATCH TAKES THE NEWER STAMP, AND THE OLDER ONE IS LOST WITH IT.
   *
   * The alternative is a row per batch, which is a jar of pickle occupying six
   * of thirty-two larder rows because you walked past the counter six times.
   * Stamping the stack with the newest arrival is the generous direction — you
   * are never told your fresh food has gone off — and the pessimistic one
   * would silently throw away something the player just paid for.
   */
  list[at].n = Math.min(STACK_MAX, (list[at].n | 0) + n);
  list[at].t = now;
  return { ok: true, why: null, rows: list };
}

/** Take one out to eat. Returns the row taken so a caller can hand it to `eat`. */
export function unstow(rows, id) {
  const list = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [];
  const at = list.findIndex((r) => r.id === id);
  if (at < 0) return { ok: false, why: 'there is none of that in the larder', rows: list, row: null };
  const row = { ...list[at] };
  if (list[at].n > 1) list[at].n -= 1; else list.splice(at, 1);
  return { ok: true, why: null, rows: list, row };
}

/** How many station hours a stowed row has left before it is not worth eating. */
export function keepingLeft(row, clock = 0) {
  const d = dishById(row?.id);
  if (!d) return 0;
  const gone = clock - (Number(row.t) || 0);
  return Math.max(0, keepsFor(d) - gone);
}

/** Has it gone off? */
export function spoiled(row, clock = 0) { return keepingLeft(row, clock) <= 0; }

/**
 * Throw out whatever has gone off. Called whenever the larder is read, so a
 * player never eats something the clock has already killed and never sees a
 * row it would refuse — a list with dead entries in it is a list that lies.
 */
export function sweep(rows, clock = 0) {
  const kept = [], lost = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    (spoiled(r, clock) ? lost : kept).push({ ...r });
  }
  return { kept, lost };
}

/**
 * ══ AND NOTHING WITH A RUN EFFECT SURVIVES A DEATH ════════════════════════
 *
 * `Progress.js`'s amendment: a provision is *"a run's worth of something, and
 * gone when the run ends — exactly as the player specified, and exactly the
 * contract the Holocron already has."* An uneaten dish in a larder is still a
 * provision, so it goes with the run that failed to eat it.
 *
 * WRITTEN AS A TEST ON THE ROW RATHER THAN AS "EMPTY THE LARDER". Today it
 * empties it, because everything in it carries an effect. The day somebody
 * adds a cake with no mods on it — a keepsake you eat, which the doctrine
 * allows — that row survives, and nobody has to remember to come back here and
 * carve out an exception.
 */
export function afterDeath(rows) {
  const kept = [], lost = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const d = dishById(r?.id);
    const runs = !!d && Object.keys(d.effect).some((k) => k !== 'hours');
    (runs ? lost : kept).push({ ...r });
  }
  return { kept, lost };
}

/** Every row in the larder, as a dish plus what the clock has done to it. */
export function larderRows(rows, clock = 0) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const d = dishById(r.id);
    return {
      id: r.id, n: r.n | 0, t: Number(r.t) || 0,
      name: d?.name || r.id,
      keeps: keepsFor(d),
      left: keepingLeft(r, clock),
      spoiled: spoiled(r, clock),
    };
  });
}
