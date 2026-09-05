/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE MEDBAY — the consequence the game already tracked and never showed
 * ══════════════════════════════════════════════════════════════════════════
 *
 * V16 §C1, in the player's own words:
 *
 *   *"lets make the medbay area of the station actually do something … when
 *   you die you wake up in the med bay; also like maybe your troops/companions
 *   when they survive with really low health they are taken to the medbay and
 *   you have to release them … maybe your injured troops have to actually
 *   follow you to the medbay to get healed after a run … you actually see them
 *   being healed (would take time in game) … maybe the healthier troops carry
 *   the injured troops on a floating stretcher."*
 *
 * Almost nothing here is new. `Company.js` has kept the roll, the wounds and
 * the fallen since V13; `#43 Medbay`, `#44 Bacta ward` and `#45 Morgue &
 * memorial` are built, walkable rooms on deck 48 with five tanks already
 * standing in them. What was missing was the JOIN: a man came off the ramp on
 * a tenth of his health, the number was thrown away at the door, and the roll
 * said nothing about it the next morning.
 *
 * ── THIS IS THE FIRST REASON THE STATION CLOCK HAS EVER HAD TO EXIST ──────
 *
 * `stepStation` has advanced `st.hour` at one game hour per two real minutes
 * since V14, and `StationSave.stationHour` has persisted it, and until this
 * file NOTHING READ IT except the crowd's rhythms and the departure boards —
 * both of which are dressing. A clock that only decorates is a clock a player
 * never looks at.
 *
 * A man in a bacta tank is out for six hours. Not six runs, not "next time you
 * press play": six hours of the clock on the wall, which is twelve real
 * minutes, which is a walk to the armoury and a drink at the Long Night and a
 * look at the fleet outside the glass. You come back and he is on his feet.
 * That is what the clock was for.
 *
 * ── ONE NUMBER ON THE RECORD, AND EVERYTHING ELSE IS DERIVED ──────────────
 *
 * The whole injury record is `m.hp`: the fraction of his health he came off
 * the ramp with, kept on the stored man by `Company.manOf` and RISING as he
 * mends. Below `FIT` he is a casualty; at `FIT` the field is dropped and he is
 * a man again. How long he has left, whether he can walk, whether he needs
 * bearing, what the ward says about him — all of it is a pure function of that
 * one number and the tank he is or is not in.
 *
 * One number because two would drift. A stored `hoursLeft` beside a stored
 * `hp` is two facts about the same wound that a hand-edited save, a migration
 * or a half-finished write can make disagree, and the screen that renders them
 * has no way to tell which one is lying.
 *
 * ── WHERE HE IS, AND WHY THAT LIVES ON THE COMPANY AND NOT ON THE MAN ─────
 *
 * `company.ward.tanks` is five slots and each holds a designation or nothing.
 * A tank is OCCUPIED, which is the visible state the player was promised —
 * you look through the glass in `#44` and there is a man in there. Occupancy
 * is on the WARD rather than a `care: 'tank'` flag on the man for the same
 * reason `hp` is one number: two tanks could otherwise both claim him, or he
 * could claim a tank that has somebody else in it, and no reader could say
 * which was true. The ward is the register; the man is the patient.
 *
 * ── AND YOU CAN LEAVE THEM ────────────────────────────────────────────────
 *
 * Nothing forces the walk. A man who is never checked in still mends — he is
 * in the barracks with a field dressing on — but at `UNTENDED` of the rate, so
 * six hours in a tank is twenty out of one. That is the whole consequence and
 * it is deliberately not a punishment: the game never takes the man away, it
 * just makes the ward the fast way and lets you decide whether the walk is
 * worth it.
 *
 * ── THIS FILE WRITES NO KEY OF ITS OWN ────────────────────────────────────
 *
 * `session.mjs` counts durable `localStorage.setItem` writers and asserts at
 * most three, and `Kennel.js` states the rule for a new file the named scans
 * cannot see: *"that silence is a hazard, not a permission."* So there is no
 * `makeStore` here and no fourth key. The injury is a field on a man the
 * company already stores and the ward is a field on the company record, both
 * written through `Company.save`, which is already the one writer of that key.
 * The six-word currency scan in `company.mjs` is extended to this file on the
 * commit that creates it, for the same reason.
 *
 * ── AND NO GEOMETRY ───────────────────────────────────────────────────────
 *
 * `StationKit.tankrow` builds the five tanks and `StationPlan` places the
 * room; §9.1 says a room's materials come from `stationMats` and this file
 * builds no room. What it exports instead is `tankLocal` — where the five
 * tanks stand in the room's own frame — so a renderer that wants to put a body
 * behind the glass asks here rather than copying the loop.
 */

import * as Company from './Company.js';
/* THE TWO ROLLS, by name. One ward per company for `Company.load`'s own
 * reason — a droid and a clone are two companies — and `stepMedbay` settles
 * both because the station does not know which one you came home with. */
import { ARMY_IDS } from './Command.js';
import { stationHour, stationDay, passStationHours } from './StationSave.js';

/* ── the numbers ─────────────────────────────────────────────────────── */

/**
 * AT OR ABOVE THIS HE IS A MAN AND NOT A PATIENT — the fraction of his health
 * he has to be carrying for the medbay to have nothing to say about him.
 *
 * 0.7 and not 1.0, because a soldier who walks off a transport with a scorched
 * pauldron and 88% of his health is not a casualty, and a ward that admitted
 * him would admit the whole company after every run. `Reactions.DRAG_HURT` is
 * 0.45 and is the field's own line for "worth going back for under fire";
 * this is the quieter line drawn afterwards, in the light, by somebody with
 * time to look at him.
 */
export const FIT = 0.7;

/**
 * STATION HOURS FROM FLAT TO FIT, in a tank.
 *
 * 12, so the man who came off the ramp at half his health — which is what a
 * bad run actually produces — is out for six, which is the number V16 §C1
 * names. Six station hours is twelve real minutes at the clock's own rate, and
 * twelve minutes is the shape of the promise: long enough that you go and do
 * something else, short enough that you come back within the same sitting and
 * find him standing.
 */
export const HOURS = 12;

/**
 * HOW MANY TANKS THERE ARE, and it is not a balance number — it is what is
 * BUILT. `StationKit.tankrow` puts five in `#44` and has since the deck was
 * laid out; a sixth patient would be a man standing in a tank that is not
 * there. So the ward is five and a bad run overflows it, which is a truthful
 * thing for a small station to do and is the reason `checkIn` returns the men
 * it had to turn away as well as the ones it took.
 */
export const TANKS = 5;

/**
 * AT OR BELOW THIS HE DOES NOT WALK — he goes on a repulsor litter carried by
 * two who can.
 *
 * 0.28. Set below `Reactions.DRAG_HURT` (0.45) on purpose: a man the line
 * would have gone back for under fire is not necessarily a man who has to be
 * carried through his own station four hours later. This is the harder case —
 * the one who was still alive at the ramp and only just.
 */
export const LITTER = 0.28;

/** How many hands one litter takes. Two, at the head and the feet. */
export const BEARERS = 2;

/**
 * WHAT A MAN MENDS AT WHEN NOBODY CHECKED HIM IN — a fraction of the tank's
 * rate.
 *
 * 0.3, so the six hours becomes twenty. Chosen so the difference is felt in
 * SITTINGS rather than in seconds: twenty station hours is forty real minutes
 * and it is very unlikely you spend them on the station, so the man you did
 * not walk to the ward is the man who is still hurt when you next muster.
 * That is the consequence. It is not a lockout and it is not a nag — he does
 * get better, and the game never once tells you to take him.
 */
export const UNTENDED = 0.3;

/** The three rooms, by their `StationPlan` ids. Deck 48, outer band. */
export const TRIAGE = 43;
export const WARD = 44;
export const MORGUE = 45;

/* ── the injury, read off one number ─────────────────────────────────── */

const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);

/**
 * THE FRACTION OF HIS HEALTH A RECORD IS CARRYING. 1 for a man with nothing
 * wrong with him, which is the answer for a record that has never been hurt
 * and for one whose `hp` has been mended away.
 *
 * Takes ANY record with an `hp` field, which is deliberate: a companion's
 * record is a different file's shape with the same field in it, so the whole
 * of this section reads a dog and a sergeant with one set of functions rather
 * than two that would be free to disagree about what "half dead" means.
 */
export function hpOf(rec) {
  const v = clamp01(rec?.hp);
  return v === null ? 1 : v;
}

/** Is the medbay owed anything about him? */
export function isHurt(rec) { return hpOf(rec) < FIT; }

/** Can he make the walk on his own feet, or does he go on a litter? */
export function needsLitter(rec) { return hpOf(rec) <= LITTER; }

/**
 * STATION HOURS OF CARE HE STILL NEEDS, at a given rate.
 *
 * Derived rather than stored — see the header. `rate` is 1 in a tank and
 * `UNTENDED` out of one, so `hoursLeft(m, UNTENDED)` is the honest answer to
 * "and how long if I leave him where he is".
 */
export function hoursLeft(rec, rate = 1) {
  const hp = hpOf(rec);
  if (hp >= FIT) return 0;
  return ((FIT - hp) / FIT) * HOURS / Math.max(1e-6, rate);
}

/**
 * ONE WORD FOR HOW HE IS, for a screen that has a column and not a paragraph.
 * The ward is the only reader that needs the word and it is derived here so
 * two screens cannot pick different thresholds for "critical".
 */
export function conditionOf(rec) {
  const hp = hpOf(rec);
  if (hp >= FIT) return 'fit';
  if (hp <= LITTER) return 'critical';
  if (hp < 0.5) return 'serious';
  return 'walking wounded';
}

/**
 * THE ONE LINE A DOSSIER PRINTS ABOUT A CASUALTY, or null for a man who is
 * fine. A `[label, value]` pair in `Company.dossier`'s own shape, so a screen
 * appends it to those rows without inventing a second format.
 *
 * It lives here and not in `Company.js` because every number in it — `FIT`,
 * `HOURS`, the tank's rate — is this file's policy, and `Company.js` importing
 * this file back would be a cycle between the store and the thing stored.
 */
export function conditionRow(rec, company = null) {
  if (!isHurt(rec)) return null;
  const tank = company ? tankOf(company, rec) : -1;
  const rate = tank >= 0 ? 1 : UNTENDED;
  const h = hoursLeft(rec, rate);
  const where = tank >= 0 ? `bacta tank ${tank + 1}` : 'not checked in';
  return ['Condition', `${conditionOf(rec)} · ${h.toFixed(1)} h · ${where}`];
}

/* ── the ward register ───────────────────────────────────────────────── */

/**
 * THE WARD OFF A COMPANY RECORD, always an object with a full-length tank row.
 *
 * `Company.load` already sanitises what came off disk — the names in the slots
 * are names on the roll and nowhere else — so this only has to guarantee the
 * SHAPE a caller can index into. A short array from an older save is padded
 * rather than rejected: five tanks were built and five tanks exist whatever
 * the save remembers.
 */
export function wardOf(company) {
  const w = company?.ward;
  const tanks = Array.isArray(w?.tanks) ? w.tanks.slice(0, TANKS) : [];
  while (tanks.length < TANKS) tanks.push(null);
  return {
    at: Number.isFinite(w?.at) ? w.at : null,
    /* The DAY of that stamp — `Company.blank` states why the hour alone cannot
     * carry a span. Null is a fold written before it existed, and `settle` is
     * the one reader that knows what to do with one. */
    day: Number.isFinite(w?.day) ? (w.day | 0) : null,
    tanks,
  };
}

/** Which tank he is in, or −1. Matched on designation, which is his identity. */
export function tankOf(company, rec) {
  const who = typeof rec === 'string' ? rec : rec?.designation;
  if (!who) return -1;
  return wardOf(company).tanks.indexOf(who);
}

/** Is he behind the glass? */
export function inTank(company, rec) { return tankOf(company, rec) >= 0; }

/** How many of the five are lit. What you count walking past `#44`. */
export function occupied(company) {
  return wardOf(company).tanks.filter(Boolean).length;
}

/** …and how many are empty, which is what `checkIn` has to spend. */
export function tanksFree(company) { return TANKS - occupied(company); }

/**
 * THE MEN THE MEDBAY IS OWED SOMETHING ABOUT, worst first.
 *
 * Worst first because every consumer of this list — the check-in, the litter
 * party, the ward screen — wants the same order, and it is the order a triage
 * nurse would use. Ties broken on designation so the list is stable across a
 * reload rather than reordering itself under the player's cursor.
 */
export function wounded(company) {
  return (company?.men || []).filter(isHurt)
    .sort((a, b) => (hpOf(a) - hpOf(b))
      || (a.designation < b.designation ? -1 : a.designation > b.designation ? 1 : 0));
}

/** The men who can carry somebody: on the roll, on their feet, not hurt. */
export function bearersAvailable(company) {
  return (company?.men || []).filter((m) => !isHurt(m));
}

/**
 * ══ WHO WALKS OFF THE TRANSPORT, AND HOW ══════════════════════════════════
 *
 * *"maybe the healthier troops carry the injured troops on a floating
 * stretcher or something."*
 *
 * The party is DERIVED, not stored. It is a fact about the roll as it stands
 * this second — who is hurt, who is not, how many hands there are — and a
 * stored copy of it would be a second truth to keep in step with the first
 * every time a man mended or died.
 *
 *   `walking`  hurt, but on his own feet, and he follows you.
 *   `litters`  [{ man, bearers }] — the critical ones, worst first, two fit
 *              men to each. Assigned worst-first so the man closest to dying
 *              gets the hands rather than whoever happens to sort first.
 *   `unborne`  critical men there were no hands left for. A real state, not an
 *              error: a company of three that comes home with two criticals
 *              can carry ONE of them, and the game says so instead of
 *              conjuring a bearer.
 *   `fit`      everybody else — the escort.
 */
export function party(company) {
  const hurt = wounded(company);
  const pool = bearersAvailable(company);
  const litters = [];
  const unborne = [];
  const walking = [];
  let next = 0;
  for (const m of hurt) {
    if (!needsLitter(m)) { walking.push(m); continue; }
    if (pool.length - next < BEARERS) { unborne.push(m); continue; }
    litters.push({ man: m, bearers: pool.slice(next, next + BEARERS) });
    next += BEARERS;
  }
  return { walking, litters, unborne, fit: pool, bearing: pool.slice(0, next) };
}

/**
 * THE ONE LINE THE BANNER RAISES WHEN YOU WALK OFF THE TRANSPORT, or null for
 * a company that came home whole.
 *
 * `{ title, body }` in `world.notify`'s own two-part shape, so the arrival
 * costs a caller one call and invents no interface — §14's "the station adds
 * no interface" is the rule and the banner is the verb every other thing in
 * this game already speaks through.
 *
 * It is a STATEMENT AND NOT A PROMPT. It says how many are hurt and how they
 * are getting there; it does not ask you to do anything, because the whole
 * point of §C1's fifth clause is that nothing forces the walk.
 */
export function arrivalNotice(company) {
  const p = party(company);
  const n = p.walking.length + p.litters.length + p.unborne.length;
  if (!n) return null;
  const bits = [];
  if (p.walking.length) bits.push(`${p.walking.length} walking`);
  if (p.litters.length) bits.push(`${p.litters.length} on litters`);
  if (p.unborne.length) bits.push(`${p.unborne.length} with nobody to carry them`);
  return {
    title: `${n} WOUNDED`,
    body: `${bits.join(', ')} — the medbay is aft`,
  };
}

/* ── check-in ────────────────────────────────────────────────────────── */

/**
 * ADMIT MEN TO THE TANKS. The end of the walk.
 *
 * @param army  which roll. One ward per roll, for `Company.load`'s own reason:
 *              a droid and a clone are two companies and always have been.
 * @param who   designations (or man records) to admit, or null for "everybody
 *              who is hurt", which is what the follow order means.
 *
 * Worst first, into the lowest free tank, and a man already in one is left
 * exactly where he is rather than being moved — a patient who changed tanks
 * because somebody opened a menu is a patient the glass lied about.
 *
 * @returns { admitted, turned, full } — designations taken, designations there
 *          was no tank for, and whether the ward filled. `turned` is the
 *          honest half: five tanks and ten wounded is a thing that happens.
 */
export function checkIn(army, who = null) {
  const c = Company.load(army);
  const ward = wardOf(c);
  const want = pickMen(c, who);
  const admitted = [];
  const turned = [];
  for (const m of want) {
    if (!isHurt(m)) continue;
    if (ward.tanks.includes(m.designation)) continue;
    const slot = ward.tanks.indexOf(null);
    if (slot < 0) { turned.push(m.designation); continue; }
    ward.tanks[slot] = m.designation;
    admitted.push(m.designation);
  }
  if (admitted.length) { c.ward = ward; Company.save(c); }
  return { admitted, turned, full: ward.tanks.every(Boolean) };
}

/**
 * TAKE HIM OUT — the *"you have to release them"* half.
 *
 * A man can be pulled out of a tank before he is mended and the game does not
 * argue: he keeps the health he has mended to and goes back to the untended
 * rate, and the tank is free for somebody worse. That is the decision the
 * player asked to be given, and it is the one place a full ward becomes a
 * choice rather than a queue.
 */
export function discharge(army, who = null) {
  const c = Company.load(army);
  const ward = wardOf(c);
  const out = [];
  const want = who === null ? ward.tanks.filter(Boolean) : pickMen(c, who).map((m) => m.designation);
  for (const name of want) {
    const i = ward.tanks.indexOf(name);
    if (i < 0) continue;
    ward.tanks[i] = null;
    out.push(name);
  }
  if (out.length) { c.ward = ward; Company.save(c); }
  return out;
}

/** Names, records or nothing → the men on this roll that means. */
function pickMen(company, who) {
  const men = company?.men || [];
  if (who === null || who === undefined) return wounded(company);
  const list = Array.isArray(who) ? who : [who];
  const want = new Set(list.map((x) => (typeof x === 'string' ? x : x?.designation)).filter(Boolean));
  /* IN THE WARD'S ORDER AND NOT THE CALLER'S, so a check-in of five men fills
   * the tanks worst-first however the caller happened to list them. */
  return [...wounded(company), ...men.filter((m) => !isHurt(m))].filter((m) => want.has(m.designation));
}

/* ── the healing clock ───────────────────────────────────────────────── */

/**
 * ADVANCE A ROLL BY `hours` OF STATION TIME, in place. Pure on the object —
 * no store, no clock — so a check can drive six hours in one line and the
 * station can drive a sixtieth of one every frame through the same arithmetic.
 *
 * Two rates and one rule: a tank mends `FIT/HOURS` of a man an hour, the
 * barracks mends `UNTENDED` of that, and a man who reaches `FIT` has the field
 * taken off him entirely — a record with no `hp` on it is a man with nothing
 * wrong with him, and that is the state the roll goes back to.
 *
 * @returns { hours, healed, moved } — healed is the designations who came off
 *          the list on this advance, which is what a notification says.
 */
export function advanceIn(company, hours) {
  const h = Number(hours);
  if (!company || !(h > 0)) return { hours: 0, healed: [], moved: false };
  const ward = wardOf(company);
  const healed = [];
  let moved = false;
  for (const m of (company.men || [])) {
    if (!isHurt(m)) {
      /* A SCRATCH IS NOT A WOUND, AND IT DOES NOT FOLLOW HIM FOR EVER. A man
       * who came off the ramp on 95% carries a stored `hp` the store was
       * right to keep — it is what happened to him — and the medbay is the
       * thing that decides it no longer matters. Cleared on the first advance
       * that sees it, so a company that fights and never gets hurt does not
       * accumulate a number against every name on the roll. */
      if (m.hp !== undefined) { delete m.hp; moved = true; }
      /* AND HE MAY STILL BE IN A TANK — pulled out of the fight and mended
       * past the line on a frame nobody was looking at. The tank is freed here
       * rather than waiting for somebody to press something, because the glass
       * is the state and an empty man behind it is the glass lying. */
      const i = ward.tanks.indexOf(m.designation);
      if (i >= 0) { ward.tanks[i] = null; moved = true; }
      continue;
    }
    const rate = ward.tanks.includes(m.designation) ? 1 : UNTENDED;
    const gain = (FIT / HOURS) * rate * h;
    const now = hpOf(m) + gain;
    moved = true;
    if (now >= FIT) {
      delete m.hp;
      healed.push(m.designation);
      const i = ward.tanks.indexOf(m.designation);
      if (i >= 0) ward.tanks[i] = null;
    } else {
      m.hp = now;
    }
  }
  if (moved) company.ward = ward;
  return { hours: h, healed, moved };
}

/** …and the same, through the store. The door the game uses. */
export function advance(army, hours) {
  const c = Company.load(army);
  const r = advanceIn(c, hours);
  if (r.moved) Company.save(c);
  return r;
}

/**
 * ══ CATCH UP WITH THE CLOCK ON THE WALL ═══════════════════════════════════
 *
 * `ward.at` is the station hour this roll was last settled at, `ward.day` is
 * the day that stamp was taken on, and the gap between then and now is what
 * the tanks are owed. `day * 24 + at` is a point on a line that only ever goes
 * forward, so the span is a subtraction and there is nothing left to see
 * through.
 *
 * ── AND THE WRAP USED TO BE THE THING IT COULD NOT SEE THROUGH ───────────
 *
 * The span was `((now - ward.at) % 24 + 24) % 24`, and this comment used to
 * say so and claim `stepMedbay` prevented the damage. It cannot: `stepMedbay`
 * only runs while you are ON the station, which is exactly when you are not on
 * a run — and a run is the one thing in the game that moves the clock by an
 * unbounded amount, through `passStationHours`. Measured on the shipped build:
 * from hour 8, a 48-minute run is 24 station hours, `passStationHours(24)`
 * brings the clock back to hour 8, and the wrapped span read 0 h. A tank is
 * twelve hours; a run of exactly the wrong length mended nobody, and a
 * 50-minute run credited 1 hour instead of 25.
 *
 * A roll with no `at` yet is STAMPED and healed nothing, which is right: the
 * hours before the ward first looked at the clock are not hours anybody spent
 * in a tank. A roll with an `at` and NO `day` was written before the day was
 * stamped: it is read once, the old wrapped way — an honest answer for the
 * same day, and never more than the 24 hours that reading can express — and
 * comes out of this call with both halves on it.
 *
 * @param hourNow the wall clock, 0..24. Defaults to the fold's.
 * @param dayNow  which day that hour is on. Defaults to the fold's.
 */
export function settle(army, hourNow = null, dayNow = null) {
  const now = Number.isFinite(hourNow) ? hourNow : stationHour();
  const today = Number.isFinite(dayNow) ? (dayNow | 0) : stationDay();
  const c = Company.load(army);
  const ward = wardOf(c);
  if (ward.at === null) {
    ward.at = now;
    ward.day = today;
    c.ward = ward;
    Company.save(c);
    return { hours: 0, healed: [], moved: false };
  }
  /* NEGATIVE IS CLAMPED AND NOT WRAPPED, which is the difference between a
   * clock somebody set BACKWARDS — a screen, a check driving 23:00 then 01:00
   * on the same day — and time passing. Time that did not pass mends nobody;
   * the stamp below still moves, so the ward does not sit in the past. */
  const gap = ward.day === null
    ? ((now - ward.at) % 24 + 24) % 24
    : Math.max(0, (today - ward.day) * 24 + (now - ward.at));
  const r = advanceIn(c, gap);
  /**
   * WRITTEN WHEN SOMETHING HAPPENED, AND ONCE AN HOUR WHEN NOTHING DID.
   *
   * `stepMedbay` settles every ten real seconds and `Company.save` is a
   * `JSON.stringify` of the whole roll, so a ward that stamped the hour every
   * time it looked would write six times a minute for ever on a company with
   * nobody hurt. `stepStation` already refuses exactly this for the clock
   * itself and states the rule at `_savedHour`: persist on the hour, not on
   * the frame. A healthy company therefore costs one write per station hour —
   * two real minutes — and a company with men in tanks costs one per tick,
   * which is what mending them is.
   */
  if (!r.moved && ward.day === today && Math.floor(now) === Math.floor(ward.at)) return r;
  c.ward = { ...wardOf(c), at: now, day: today };
  Company.save(c);
  return r;
}

/**
 * ══ A RUN IS THE SOMETHING ELSE, AND THIS IS THE DOOR AN ENDING USES ══════
 *
 * Three things in one call because they are one event and the ORDER of them is
 * the whole correctness argument:
 *
 *   1. SETTLE FIRST, on the clock as it stands. Whatever the tanks were owed
 *      for the time before the run is theirs, priced at the hour it happened.
 *   2. PASS THE RUN'S HOURS. `passStationHours` is the only writer, it refuses
 *      a zero, a negative and a NaN, and it counts the midnights.
 *   3. THEN RE-STAMP EVERY WARD AT THE NEW CLOCK — and this is the half that
 *      cannot be left out. `bank()` folds the men who came home hurt straight
 *      after this call, and they were hurt AT THE END of the run, not before
 *      it. Without the stamp the next settle would hand them the run's own
 *      hours: a 48-minute run would take a man off the ramp bleeding and have
 *      him mended before he reached the ward, which is the same defect this
 *      lane is fixing wearing the other face.
 *
 * BOTH ARMIES, because a company is per-army and an ending does not know which
 * roll came home. Stamping a roll with nobody hurt on it costs one write.
 *
 * @returns the station hour the clock came to rest on.
 */
export function awayFor(hours) {
  const h = Number(hours);
  for (const army of ARMY_IDS) settle(army);
  const now = passStationHours(h);
  if (!(h > 0)) return now;
  const day = stationDay();
  for (const army of ARMY_IDS) {
    const c = Company.load(army);
    const ward = wardOf(c);
    /* A ward nobody has ever settled stays unstamped: `settle`'s own rule is
     * that the hours before the ward first looked at the clock are not hours
     * anybody spent in a tank, and this must not become a second way to start
     * that clock. */
    if (ward.at === null) continue;
    c.ward = { ...ward, at: now, day };
    Company.save(c);
  }
  return now;
}

/**
 * HOW OFTEN THE STATION SETTLES THE WARD, in real seconds.
 *
 * Ten, which is a twelfth of a station hour. Not every frame: `Company.load`
 * parses a JSON blob out of localStorage and `save` writes one back, and doing
 * that sixty times a second for a ward that changes twelve times an hour is
 * the shape of mistake `stepStation` already refuses for the clock itself —
 * see the note on `_savedHour`.
 */
export const SETTLE_EVERY = 10;

/**
 * THE STATION'S OWN STEP. Called once a frame from `Station.stepStation`.
 *
 * Reads the clock the station is already keeping — `st.hour`, the fractional
 * one, not the persisted integer — so the ward is exactly as far along as the
 * wall is, and settles both rolls because a company is per-army and the
 * station does not know which one you came home with.
 *
 * @returns the rolls that changed on this settle, or null on a frame that did
 *          nothing, so a caller can raise a banner for a man coming off the
 *          list without asking every frame whether one did.
 */
export function stepMedbay(world, dt) {
  const st = world?._station;
  if (!st) return null;
  const w = world;
  w._medbayT = (w._medbayT || 0) + (Number(dt) || 0);
  if (w._medbayT < SETTLE_EVERY) return null;
  w._medbayT = 0;
  const out = [];
  for (const army of ARMY_IDS) {
    /* THE DAY BESIDE THE HOUR: `st.hour` is the fractional wall clock and
     * `stationDay` is the counter `tickStationClock` moves through the same
     * door when it wraps, so the two cannot disagree about which midnight the
     * ward is on. */
    const r = settle(army, st.hour, stationDay());
    if (r.healed.length) out.push({ army, healed: r.healed });
  }
  return out.length ? out : null;
}

/* ── where the tanks stand ───────────────────────────────────────────── */

/**
 * WHERE TANK `i` STANDS IN `#44`'s OWN FRAME, in metres, given the room's
 * width and depth.
 *
 * `StationKit.tankrow` owns this geometry and this MIRRORS it rather than
 * replacing it: the loop there is `-w/2 + (w/5)*(i+0.5)` along the wall at
 * `d/2 - 1.6`, and a renderer that wants to stand a body behind the glass
 * needs the same five points. Kept here so there is one place to correct if
 * the row is ever re-laid, and named after the kit so the next reader knows
 * which of the two is the original.
 */
export function tankLocal(i, w, d) {
  const n = Math.max(1, TANKS);
  return [-w / 2 + (w / n) * ((i | 0) + 0.5), 0, d / 2 - 1.6];
}

/* ── the death screen that is not a death screen ─────────────────────── */

/**
 * ══ YOU WAKE HERE ════════════════════════════════════════════════════════
 *
 * *"when you die you wake up in the med bay."*
 *
 * A death screen is a modal that stops the game to tell you the game stopped.
 * A bed in `#43` with the roll on the wall beside you is the same information
 * delivered by the place it happened to, and you can get up and walk out of
 * it — which is the difference between an ending and a consequence.
 *
 * This returns the PLAN and not the scene: which room, which bed, and what the
 * curtain beside you says. `main.js` owns where a player is put and this file
 * may not reach into it; what this owns is the answer to "and what does the
 * medbay have to say about the state I am in".
 *
 * `#43` is a triage hall with six curtained bays (`StationPlan` #43's own
 * `look`), so the bed is one of six and it is chosen by the run rather than at
 * random — the same death puts you in the same bay, which is what makes it a
 * place rather than a shuffle.
 */
export const BAYS = 6;

export function wakePlan(company, seed = 0) {
  const bay = Math.abs(seed | 0) % BAYS;
  const hurt = wounded(company);
  const ward = wardOf(company);
  return {
    place: TRIAGE,
    bay,
    /* WHAT IS ON THE CURTAIN BESIDE YOU. The roll as it stands after the run
     * that put you here: who is in a tank, who is waiting, and who is not
     * coming back. Three numbers, because a man waking up on a station reads
     * three numbers and not a table. */
    inTanks: ward.tanks.filter(Boolean).length,
    waiting: hurt.filter((m) => !ward.tanks.includes(m.designation)).length,
    lost: company?.lost | 0,
    /* AND THE NEXT MAN OFF THE LIST, so the first thing the room tells you is
     * that somebody is getting better rather than that you died. */
    soonest: soonestOut(company),
  };
}

/**
 * WHO COMES OFF THE LIST NEXT, and in how many station hours. Null for a
 * company with nobody hurt, which is a real and quiet answer.
 */
export function soonestOut(company) {
  const ward = wardOf(company);
  let best = null;
  for (const m of wounded(company)) {
    const rate = ward.tanks.includes(m.designation) ? 1 : UNTENDED;
    const h = hoursLeft(m, rate);
    if (!best || h < best.hours) best = { designation: m.designation, hours: h, tank: ward.tanks.indexOf(m.designation) };
  }
  return best;
}

/**
 * THE WARD, AS ROWS A SCREEN PRINTS. Five tanks in order, each either a man
 * and his hours or an empty one, then the men waiting outside for a tank.
 *
 * Derived here rather than in the menu for `Company.dossier`'s stated reason:
 * a page and a check that both build the same table from the same function
 * cannot disagree about it, and a page that stops saying something goes red
 * rather than the check being taught to agree.
 */
export function wardRows(company) {
  const ward = wardOf(company);
  const by = new Map((company?.men || []).map((m) => [m.designation, m]));
  const rows = ward.tanks.map((name, i) => {
    const m = name ? by.get(name) : null;
    if (!m) return { tank: i, designation: null, hours: 0, state: 'empty' };
    return {
      tank: i, designation: name, hours: hoursLeft(m, 1),
      state: isHurt(m) ? conditionOf(m) : 'ready to come out',
    };
  });
  for (const m of wounded(company)) {
    if (ward.tanks.includes(m.designation)) continue;
    rows.push({
      tank: null, designation: m.designation, hours: hoursLeft(m, UNTENDED),
      state: `${conditionOf(m)} · not checked in`,
    });
  }
  return rows;
}
