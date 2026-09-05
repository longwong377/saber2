/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE BARS — V16 Lane C2, and the missing half of it was never the room
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player's ask, in full:
 *
 * > *"one or two bars … a casino/nightclub with troops on leave."*
 *
 * ── THERE ARE ALREADY THREE, AND A FOURTH ROOM WOULD BE THE WRONG FIX ─────
 *
 * The first instinct on reading that line is to add a place. The gazetteer
 * disagrees, and it is worth quoting the rows rather than asserting it:
 *
 *   #14 Cantina "The Long Night"  *"sunk half a deck below the concourse; a
 *       bar in the round, booths in the wall, a band's dais, coloured lights"*
 *       — which is the NIGHTCLUB, down to the band.
 *   #18 The Pit  *"a lower room off the cantina: sabacc tables, a dice cage, a
 *       cashier behind bars, one exit"* — which is the CASINO, and `Games.js`
 *       finished the three games you play in it.
 *
 *       ── AMENDED, AND THE SENTENCE ABOVE WAS FALSE ────────────────────
 *
 *       "the three games you play in it" was the ONLY occurrence of the string
 *       "Games.js" anywhere under `src/`, and it was a sentence in a comment.
 *       No file imported the module, so `pack.mjs` never put it in a build and
 *       the three games were unplayable in every shipped copy of this game.
 *       Standing in #18 and pressing the key raises the TOTE — `stationKey`
 *       has no card-table branch and #18's own gazetteer verb is "watch and
 *       bet", which is a book and not a seat.
 *
 *       So the fourth room WAS the fix, for the games and only for the games:
 *       `#60 The Wheelhouse` (V16 §D1), deck 40 outer at 89.85°, with
 *       `Casino.js` between the room and the rules. Everything below this
 *       about LEAVE stands unchanged — that half never needed a room and
 *       still does not.
 *   #54 Observation dome  *"a glass dome onto the planet and the battle, a
 *       bar, benches, a telescope"*, `who: '20 off duty'` — the quiet one.
 *
 * So the player asked for one or two and the station has three, each with its
 * own silhouette, its own peak hour and its own crowd. What it did NOT have is
 * the second half of that sentence: **troops on leave.** At 21:00 the cantina
 * held twenty-six people and every one of them was drawn from a census of
 * merchants, dockworkers and lurkers. There was no such thing as a soldier
 * with the evening off anywhere on the station, and building a fourth room
 * would have produced a fourth room with the same problem in it.
 *
 * §3.1's rule 4 is the other half of the argument: every place must read
 * differently from its own door, so a fourth bar has to be visibly unlike
 * three existing ones before it is worth the shape. "Somewhere for soldiers to
 * drink" is not a silhouette. It is a POPULATION at an HOUR, and this station
 * has had the machinery for that since V15 — `StationLife.headcount` says how
 * many are in a room at an hour and `StationLife.occupant` says who each of
 * them is. This file is a new answer to the second question, in four rooms,
 * during one window of the day.
 *
 * ── WHAT LEAVE ACTUALLY IS ────────────────────────────────────────────────
 *
 * LIBERTY IS A WINDOW, NOT A FLAG. 18:00 to 02:00 — the evening watch and the
 * middle watch after it — and outside it a soldier is on duty, asleep, or in
 * the barracks. `libertyAt` is zero at 06:00 and stays zero all morning, which
 * is why `food.mjs` can assert the bar is empty of soldiers then while still
 * holding seven people who work nights.
 *
 * WHO GETS IT IS A ROLL AND IT LASTS THE DAY. Seeded off `(designation, day)`,
 * exactly as a shelf is seeded off `(counter, day)`: the same men have leave
 * all evening, and a different third of the company has it tomorrow. A roll
 * per visit would mean walking out of the cantina and back in to re-draw the
 * room, which `Counter.js` refused for the same reason.
 *
 * AND TWO KINDS OF MAN NEVER HAVE IT:
 *
 *   A MAN IN THE TANK. `Company.ward.tanks` is who is behind the glass in #44
 *     and `Medbay.js` mends him over station hours. He is not in a bar.
 *   A DROID. This is the same rule `Food.js` draws and it is drawn once for
 *     both lanes: **flesh takes leave, steel takes a charge.** A separatist
 *     roll's men do not drink, and the honest place for a B1 with an evening
 *     off is the rack of posts at #51, not a booth at the Long Night.
 *
 * ── AND WHERE THERE IS NO COMPANY ─────────────────────────────────────────
 *
 * A player who has never kept a manifest has no roll to draw from, and a bar
 * that emptied of soldiers because you have not played the muster yet would be
 * a feature that punishes not having used another feature. So the fallback is
 * the station's OWN garrison — `resident(seed, { role: 'security' })`, the
 * same census every other body in the drum comes out of. The bar is full of
 * soldiers either way; whether you know their names is what changes.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  AMENDED TWICE, AND BOTH OF THE ARGUMENTS ABOVE WERE HALF WRONG
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── 1. THE ASK HAD THREE CLAUSES AND ONE OF THEM WAS BUILT ───────────────
 *
 * > *"you can assign troops to go on leave … you will actually see your real
 * >  troops relaxing there … they will get increased morale and will heal
 * >  over time."*
 *
 * The middle clause worked and was the only one that did. There was NO
 * ASSIGNMENT CONTROL ANYWHERE: leave was `hashF(designation, day)`, the player
 * could not choose who went, could not see who was out, and the game never
 * once said the word. And there were ZERO WRITERS — `morale` did not appear in
 * this file, `StationLife.js` or `Medbay.js`'s leave path, so a man came back
 * from an evening in the cantina carrying exactly the nerve and the wound he
 * left with, and nothing had marked him unavailable while he was gone.
 *
 * Worse, EIGHT of this file's exports had no caller anywhere under `src/` —
 * `onLeave`, `takesLeave`, `ownHeads`, `crowdOf`, `isBar`, `barPlaces` and two
 * constants — and `tools/checks/food.mjs` called two of them DIRECTLY, so the
 * only thing in the building that had ever run them was the check asserting
 * they worked. `BARS[].line` was reachable through `crowdOf` alone, which
 * means *"the band is loud enough that nobody has to talk"* had never been
 * read by a person. `_shipped.mjs` could not see any of it: `StationLife.js`
 * imports `barman`, so the FILE was in every build and eleven-twelfths of it
 * was furniture.
 *
 * What is built now: a LIBERTY BOARD at `#29`, the company barracks —
 * `Station.stationKey` raises `world.onLeave` above the kiosk branch and
 * `main.js`'s `showLeave` is the page. `grantLeave` writes one field on the
 * man, `Company.fieldable` refuses to field him while it is there, and
 * `stepLeave` pays him by the station hour beside `stepMedbay`. See THE
 * LEDGER at the bottom of this file. `crowdOf` has a player-facing caller
 * (`main.js`'s `showBar`, off `world.onBar`) and `food.mjs` no longer calls
 * anything here that the game does not.
 *
 * ── 2. "A FOURTH ROOM WOULD BE THE WRONG FIX" WAS RIGHT ABOUT LEAVE AND ──
 *      WRONG ABOUT THE ROOMS
 *
 * That argument answered "somewhere for soldiers to drink", and it still
 * answers it: leave needed a population and not a place. It did not answer
 * the sentence beside it — *"some being really fancy and incredibly upscale
 * and others being incredibly grimy and sleezy"* — which is a CONTRAST, and a
 * contrast needs both ends. The grimy end had been standing since the plan
 * was written (#18 is a low den with a cashier behind bars and one exit; #61
 * is a hole in the deck plate with chain-link over it). The upscale end was
 * listed in V16 §6 as `#59` and was never built, so half of that sentence was
 * furniture too.
 *
 * `#59 The Ascendant` is the other end: deck 40's inner band at 63°, up on the
 * balcony BETWEEN the two grimiest rooms on the deck — #14 at 52 and #18 at 76
 * — looking down over both of them across the void. It is the only bar on the
 * station with a window, the only one that turns anybody away, and an hour in
 * it is worth nearly three times an hour in the Pit. That is the contrast
 * priced rather than described — see `BARS` and `admits`.
 */

import { PLACE } from './StationPlan.js';
import { resident } from './StationCast.js';
import { kindOfArmy } from './Attributes.js';
import { rankFor, ARMY_IDS } from './Command.js';
import { MORALE } from './Morale.js';
import { FIT, HOURS, hpOf, isHurt } from './Medbay.js';
import { stationHour, stationDay } from './StationSave.js';
import * as Company from './Company.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE ROOMS                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * The FOUR rooms on this station a soldier drinks in, and what each is for.
 *
 * `draw` is the share of the evening's leave-men who choose it, and the four
 * add to one. They are not equal and the reason is the rooms themselves: the
 * cantina has a band and twenty-six seats, the Pit has a cashier behind bars
 * and fourteen, the dome is up on deck 60 and holds people who wanted to be
 * somewhere quiet, and #59 has a man on the door. A man who drinks in the dome
 * went there on purpose.
 *
 * NO ROW HERE INVENTS A PLACE. Every id is a gazetteer row and `food.mjs`
 * holds each of them against `PLACE` — §15's rule is that a place not in §3.2
 * is not built, and a bar pointing at a room that does not exist would seat
 * the whole evening's leave into nowhere.
 *
 * ── AND THE THREE OTHER COLUMNS ARE WHAT LEAVE IS *WORTH* ────────────────
 *
 * The audit's second finding was that this file wrote nothing: *"zero hits for
 * `morale` in Bars.js, StationLife.js and Medbay.js. Nothing heals from leave,
 * nothing marks a man unavailable while he is on it."* An evening off has to
 * cost the player a man and pay him back in the two numbers the roll already
 * keeps, or it is a screensaver.
 *
 *   `ease`  MORALE PER STATION HOUR, on `Company.men[].morale` — the same
 *           0..1 field `CommandDirector._morale` reads every frame in a fight
 *           and `Company.readMan` clamps off disk. Capped at
 *           `MORALE.PRESENCE_CAP` (0.84), which is where standing beside your
 *           own commander under fire tops a man out: a night off may steady a
 *           man as far as his officer's presence would and no further.
 *   `mend`  HIS INJURY, as a fraction of the BACTA TANK's rate — `Medbay.FIT
 *           / Medbay.HOURS`, imported rather than restated so a tank that is
 *           ever re-timed re-times the barstool with it. Nothing here is a
 *           hospital and none of these is 1.
 *   `rope`  THE RANK ON THE DOOR. `Command.rankFor(xp)`, so 0 is "anybody in
 *           uniform" and 2 is Sergeant. Exactly one room has one.
 *
 * THE SPREAD IS THE CONTRAST THE PLAYER ASKED FOR, priced: *"some being really
 * fancy and incredibly upscale and others being incredibly grimy and sleezy."*
 * Eight hours of liberty in the Pit is +0.096 nerve and eight in #59 is +0.272
 * — most of a `MORALE.WAVE_CLEAR` — and the difference is a room you cannot
 * get a trooper into. The grimy end is cheap and open to everyone; the fancy
 * end is worth nearly three times as much and will not have your privates.
 */
export const BARS = [
  {
    id: 14, what: 'nightclub', draw: 0.46, ease: 0.020, mend: 0.35, rope: 0,
    line: 'the band is loud enough that nobody has to talk',
  },
  {
    id: 18, what: 'casino', draw: 0.26, ease: 0.012, mend: 0.25, rope: 0,
    line: 'they came down for one hand and it is not one hand',
  },
  {
    id: 54, what: 'quiet', draw: 0.13, ease: 0.016, mend: 0.50, rope: 0,
    line: 'up under the glass, watching the thing they were shot at by last week',
  },
  {
    /**
     * ── #59 THE ASCENDANT, AND WHY IT IS WORTH THE MOST ─────────────────
     *
     * The one room on the station where a man is looked after rather than
     * served: a steam room, a masseur, a quiet floor and somebody who takes
     * his coat. That is the whole of why `mend` is 0.6 — the best number on
     * this table and still not a tank — and why `ease` is the best too.
     *
     * `rope: 2` is Sergeant. It is the only refusal in this file and it is
     * the point of the room: the fancy end of the station is a thing your
     * company earns its way into one promotion at a time, and the player who
     * has never promoted anybody stands in a beautiful room full of other
     * people. See `admits`.
     */
    id: 59, what: 'upscale', draw: 0.15, ease: 0.034, mend: 0.60, rope: 2,
    line: 'somebody took his coat at the door and nobody has raised their voice',
  },
];

const BAR_BY = new Map(BARS.map((b) => [b.id, b]));

/** Is this place one of the four? */
export function isBar(placeId) { return BAR_BY.has(Number(placeId)); }
/** One bar row by place id, or null. */
export function barById(placeId) { return BAR_BY.get(Number(placeId)) || null; }

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE WINDOW                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * LIBERTY: 18:00 to 02:00, eight hours across the midnight.
 *
 * It is deliberately NOT the same curve `StationLife.fullness` runs, and the
 * difference is the point of the whole lane. Fullness is about the ROOM — the
 * cantina is at 0.18 of its peak at noon because a cantina at noon is quiet,
 * never empty. Liberty is about the ARMY, and an army is not 18% on leave at
 * noon. It is nought, exactly, until the evening watch.
 *
 * So this returns a hard zero outside the window and a raised cosine inside
 * it, peaking at 22:00 — four hours in, which is when a bar is fullest of
 * people who have to be up in the morning.
 */
export const LIBERTY = { from: 18.0, len: 8.0 };

export function libertyAt(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  const d = (h - LIBERTY.from + 24) % 24;
  if (d >= LIBERTY.len) return 0;
  /* Raised cosine over the window: 0 at both edges, 1 at the middle. A step
   * would put twenty men in a room on the frame the clock ticked to 18. */
  return 0.5 - 0.5 * Math.cos((d / LIBERTY.len) * Math.PI * 2);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE ROLL                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * A stable 0..1 from a string. `StationCast.hashF`'s job, re-stated here
 * rather than imported because that one is private to that file — and because
 * nothing in this file may reach `Math.random`: two people standing in the
 * same bar on the same evening must see the same men, and a roll that changed
 * when you looked away would be a room that forgets you.
 */
function hashF(seed, salt = '') {
  const s = `${seed}|${salt}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** What share of a company is off on any given evening. A third. */
export const LEAVE_SHARE = 1 / 3;

/** Is this man flesh? See the header — steel takes a charge, not an evening. */
function takesLeave(man, army = null) {
  if (!man) return false;
  const kind = man.kind || kindOfArmy(man.army || army);
  return kind !== 'steel';
}

/**
 * ══ WHICH MEN HAVE LEAVE TONIGHT, AND WHICH BAR EACH OF THEM IS IN ════════
 *
 * Returns rows of `{ man, bar, given }`, and `given` is the whole of the
 * audit's first finding: TRUE means the player wrote this row down at the
 * liberty board and FALSE means nobody has ever used the board and the station
 * is guessing.
 *
 * ── THE ORDER OF THE TWO ANSWERS, AND WHY IT IS NOT A MERGE ──────────────
 *
 * *"you can assign troops to go on leave"* — there was no assignment control
 * anywhere in the game, and leave was a hash of `(designation, day)`. The hash
 * is still here and it is still the right answer for exactly one player: the
 * one who has never opened the board. A cantina that emptied of your men
 * because you had not used a screen would be a feature punishing you for not
 * having used another feature — the same sentence this file already makes
 * about a player with no company at all.
 *
 * So: THE MOMENT ONE MAN ON THE ROLL CARRIES A WRITTEN PASS, the roll is the
 * player's and the hash is silent. Not a union — a union would mean granting
 * one man leave silently sent three others out with him, which is a control
 * that does something you did not ask for. `berths` is the ceiling on the
 * written list and it is the same third the hash draws, so the two answers are
 * the same SIZE and only one of them is yours.
 */
function onLeave(company, day = 0) {
  const men = company?.men || [];
  const army = company?.army || null;
  const inTank = new Set((company?.ward?.tanks || []).filter(Boolean));
  const eligible = [];
  for (const m of men) {
    if (!takesLeave(m, army)) continue;
    /* A MAN IN THE GLASS IS NOT IN A BAR. `Company.ward.tanks` is the bacta
     * ward's register and `Medbay.js` is mending him by the hour; putting him
     * in the cantina would be two rooms holding one man. */
    if (inTank.has(m.designation)) continue;
    eligible.push(m);
  }
  /* THE WRITTEN LIST. Capped at `berths` on the way out as well as on the way
   * in, so a hand-edited save that grants thirty passes still only empties a
   * third of the barracks — the store is where a number stops being trusted. */
  const written = [];
  for (const m of eligible) {
    const bar = barById(leaveOf(m)?.bar);
    if (bar) written.push({ man: m, bar, given: true });
  }
  if (written.length) return written.slice(0, berths(company));
  const out = [];
  for (const m of eligible) {
    if (hashF(m.designation, `leave${day | 0}`) >= LEAVE_SHARE) continue;
    out.push({ man: m, bar: pickBar(m.designation, day), given: false });
  }
  return out;
}

/** Which of the three he chose, weighted by `draw`. */
function pickBar(designation, day = 0) {
  let x = hashF(designation, `bar${day | 0}`);
  for (const b of BARS) { x -= b.draw; if (x <= 0) return b; }
  return BARS[BARS.length - 1];
}

/**
 * What share of a bar's seats hold somebody in uniform at the height of
 * liberty. Two of five.
 *
 * It is 0.4 rather than a taste because #54's own gazetteer row already says
 * `who: '20 off duty'` and #29 puts a company of eighteen two decks below. A
 * station whose bars held nothing but merchants would contradict a line
 * somebody had already written into the plan.
 */
export const GARRISON_SHARE = 0.4;

/**
 * How many soldiers are in this bar at this hour.
 *
 * `heads * GARRISON_SHARE * libertyAt(hour)`, and three bounds on it, each
 * refusing a different lie:
 *
 *   THE WINDOW. Nought outside liberty, whatever else is true. This is the
 *     clause that makes the bar empty of soldiers at 06:00 while still
 *     holding the seven people who work nights.
 *   THE ROOM. Never more than `heads`, which is `StationLife.headcount`'s
 *     answer for that place at that hour. §12.3: `heads` is who is THERE, and
 *     a bar cannot hold more soldiers than it holds people.
 *   THE PLAYER'S OWN COME FIRST. See `soldierIn` — the seats are filled from
 *     your roll while it lasts and by the station's garrison after that, so a
 *     company of four does not empty the cantina and a company of forty does
 *     not fill it twice over. `crowdOf.own` is how many of them you know by
 *     name, counted off the rows rather than derived a second time.
 */
function leaveHeads(bar, hour, heads, opts = {}) {
  const b = typeof bar === 'object' && bar ? bar : barById(bar);
  if (!b) return 0;
  const k = libertyAt(hour);
  if (k <= 0) return 0;
  const n = (heads | 0) * GARRISON_SHARE * k;
  return Math.max(0, Math.min(heads | 0, Math.round(n)));
}

/**
 * ══ WHO IS IN THE BAR, AT THIS HOUR ═══════════════════════════════════════
 *
 * The whole answer, for a check, a screen, or `StationLife`'s pool. `heads` is
 * handed in rather than computed — `StationLife.headcount` owns that curve and
 * a second copy of it here would be a second answer to how full a room is.
 *
 * Returns `{ heads, leave, own, locals, line }`: the soldiers by name, how
 * many of them are off the player's own roll, and how much of the room is
 * everybody else.
 */
export function crowdOf(bar, hour, heads, opts = {}) {
  const b = typeof bar === 'object' && bar ? bar : barById(bar);
  if (!b) return { heads: heads | 0, leave: [], own: 0, locals: heads | 0, line: null };
  const n = leaveHeads(b, hour, heads, opts);
  const leave = [];
  for (let i = 0; i < n; i++) leave.push(soldierIn(b, i, opts));
  return {
    heads: heads | 0,
    leave,
    own: leave.filter((r) => r && r.leave).length,
    locals: Math.max(0, (heads | 0) - n),
    line: b.line,
  };
}

/**
 * The soldier standing in the i-th leave seat of a bar.
 *
 * The record is exactly the shape `StationLife.occupant` returns — species,
 * name, role, stature, scale, rhythm, faction, home — because that is what
 * `spawnResident` reads to make a body. Nothing new is invented: the body is
 * built by the same census machinery every other resident in the drum is.
 *
 * ── AND HE IS OUT OF ARMOUR ───────────────────────────────────────────────
 *
 * A leave-man is a plain human resident wearing his own name, NOT a trooper
 * archetype. That is not a shortcut, it is the fiction: a man on liberty is
 * not in plate, and a cantina full of identical white helmets would read as a
 * deployment rather than as an evening off. What the player sees is a room of
 * people, and one of them is `CT-4471 "Ladder"` — a name off their own roll,
 * in a bar, at 22:00.
 */
function soldierIn(bar, i, opts = {}) {
  const b = typeof bar === 'object' && bar ? bar : barById(bar);
  if (!b) return null;
  const company = opts.company || null;
  const day = opts.day | 0;
  const seed = `bar${b.id}l${i}d${day}`;
  const rows = company && (company.men || []).length
    ? onLeave(company, day).filter((r) => r.bar.id === b.id)
    : [];
  const man = rows[i]?.man || null;
  const r = resident(seed, { species: 'human', role: 'security' });
  if (!man) {
    /* THE GARRISON. No roll of your own, so this is one of the station's — and
     * he keeps the census's own name and the security role, because that is
     * exactly what he is. */
    return { ...r, bar: b.id, leave: null };
  }
  return {
    ...r,
    name: nameOfMan(man),
    role: 'trooper',
    bar: b.id,
    /* WHO HE IS ON YOUR ROLL, so a nameplate, a dossier or a line of dialogue
     * can reach the man rather than the body. Never the man's own record —
     * a copy of the designation, so nothing in a bar can write to a manifest. */
    leave: { designation: man.designation, squad: man.squad ?? null },
  };
}

/**
 * `Company.nameOf` restated in one line, and it is restated rather than
 * imported ON PURPOSE: importing `Company.js` would pull the manifest's whole
 * store into a file whose entire contract is that it is handed a company and
 * reads it. The rule it copies is two fields long and `food.mjs` holds this
 * against `Company.nameOf` on a real man, so the copy cannot drift in silence.
 */
function nameOfMan(m) {
  const called = m?.look?.callsign || m?.nickname;
  return called ? `${m.designation} "${called}"` : (m?.designation || '');
}

/**
 * ══ THE HOOK INTO THE POOL ════════════════════════════════════════════════
 *
 * `StationLife.occupant` asks this before it draws from the census, and a
 * null here means "not a leave seat — carry on". The FIRST `n` slots of a bar
 * are the leave seats, which is the convention the Borz cast already set one
 * function up: *"FIRST, not scattered, because a slot index is what makes a
 * resident stable across a despawn."*
 */
export function barman(place, i, opts = {}) {
  const b = barById(place?.id);
  if (!b) return null;
  /* `heads` is the hour's headcount and it is HANDED IN, because this file
   * does not own that curve and a second copy of it would be a second answer
   * to how full a room is. A caller with no clock gets no soldiers, which is
   * the honest default for a question it did not ask. */
  if (!Number.isFinite(opts.heads) || !Number.isFinite(opts.hour)) return null;
  if (i >= leaveHeads(b, opts.hour, opts.heads, opts)) return null;
  return soldierIn(b, i, opts);
}

/** Every bar row, with its gazetteer place attached. For a screen and a check. */
export function barPlaces() {
  return BARS.map((b) => ({ ...b, place: PLACE.get(b.id) || null }));
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE LEDGER — the half the audit found missing                              */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHAT THE PLAYER ASKED FOR, IN THREE CLAUSES, AND WHAT WAS BUILT ═══════
 *
 * > *"you can assign troops to go on leave … you will actually see your real
 * >  troops relaxing there … they will get increased morale and will heal over
 * >  time."*
 *
 * The middle clause worked. The other two did not exist:
 *
 *   NO ASSIGNMENT CONTROL ANYWHERE. Leave was `hashF(designation, day)`. The
 *     player could not choose who went, could not see who was out, and nothing
 *     in the game ever said the word.
 *   ZERO WRITERS. `morale` did not appear once in this file, `StationLife.js`
 *     or `Medbay.js`. A man came back from an evening in the cantina with the
 *     nerve and the wound he walked in with.
 *
 * ── WHERE THE STATE LIVES, AND WHY IT IS NOT A NEW KEY ───────────────────
 *
 * One field on the man: `m.leave = { bar, since }`. It rides in `MAN_FIELDS`
 * through `Company.save`, which is the door `Medbay.js` already writes the
 * bacta ward through and the reason `saber.company.v1` has exactly one writer.
 * `tools/checks/session.mjs` counts `localStorage.setItem` across five named
 * files and refuses a sixth; nothing here adds one.
 *
 * `since` IS AN ABSOLUTE STATION HOUR — `day * 24 + hour` — and it is the same
 * line `Medbay.settle` reasons on: *"a point on a line that only ever goes
 * forward, so the span is a subtraction and there is nothing left to see
 * through."* It was a wrapped 0..24 there once and a 48-minute run mended
 * nobody. Per man rather than per company because the stamp is CONSUMED — each
 * settle credits the span and moves `since` up to now — so two men granted
 * leave four hours apart are each owed their own four hours and not the
 * company's.
 *
 * ── AND HE IS GENUINELY GONE ─────────────────────────────────────────────
 *
 * `Company.fieldable` filters him out, which is the single choke point every
 * road to a run goes through: `Muster.lineup` builds both its default line and
 * its by-name pick map out of `fieldable`, and `main.js`'s `veteransToField`
 * is `lineup`. So a man with a pass cannot be fielded by the default, cannot
 * be reached by a pick, and cannot be smuggled in by a saved slate. That is
 * the cost that makes the choice a choice.
 */

/**
 * HOW MANY MEN MAY BE OFF AT ONCE. A third of the roll, rounded up, never
 * less than one.
 *
 * `LEAVE_SHARE` and not a second number, because the ceiling on the written
 * list has to be the size of the evening the hash was already drawing — if the
 * board could send everybody there is no decision on it, and if it could send
 * fewer than the station was already showing then using the board would empty
 * the cantina.
 */
export function berths(company) {
  const n = (company?.men || []).length;
  return Math.max(1, Math.ceil(n * LEAVE_SHARE));
}

/** The pass a man is carrying — `{ bar, since }` — or null. */
function leaveOf(man) {
  const v = man?.leave;
  if (!v || typeof v !== 'object') return null;
  const bar = Number(v.bar);
  if (!BAR_BY.has(bar)) return null;
  const since = Number(v.since);
  return { bar, since: Number.isFinite(since) ? Math.max(0, since) : 0 };
}

/**
 * ══ THE ROPE ON #59'S DOOR ════════════════════════════════════════════════
 *
 * The one refusal in this file. `rope` is a rung of `Command.RANKS` and
 * `rankFor` is the only reader of a man's experience anywhere in the tree, so
 * this cannot drift from what the roster tab prints beside his name.
 *
 * A SEAT HE WAS GIVEN COUNTS AS THE RANK. `m.post` is a squad's own post and
 * `Command.holds(t, 'LEADS')` is what grants it, so a man holding one has
 * already been judged fit to lead by the licence — turning him away at a door
 * his own sergeant walks through would be two answers to one question.
 */
function admits(bar, man) {
  const b = typeof bar === 'object' && bar ? bar : barById(bar);
  if (!b || !man) return false;
  if (!takesLeave(man)) return false;
  if (!(b.rope > 0)) return true;
  return man.post === true || rankFor(man.xp | 0) >= b.rope;
}

/** The station's clock as one number that only goes forward. See `since`. */
function nowHours(now = null) {
  if (Number.isFinite(now)) return Math.max(0, now);
  return stationDay() * 24 + stationHour();
}

/**
 * ══ GRANT ONE MAN AN EVENING ══════════════════════════════════════════════
 *
 * The player's own door, and the only writer of `m.leave` that adds one.
 *
 * @param army  which roll. A company is per-army and the station does not know
 *              which one you came home with — `Medbay.checkIn`'s own rule.
 * @param who   a designation, a man, or an array of either.
 * @param bar   the place id he is sent to. An unknown one is refused rather
 *              than defaulted: a pass to a room that does not exist is a man
 *              nobody can find.
 * @returns `{ granted, refused }` — refused rows carry a `why`, because every
 *          one of the three refusals is something the player can act on.
 */
export function grantLeave(army, who, bar, now = null) {
  const b = barById(bar);
  const c = Company.load(army);
  const at = nowHours(now);
  const want = pickMen(c, who);
  const granted = [];
  const refused = [];
  if (!b) {
    for (const m of want) refused.push({ designation: m.designation, why: 'no such room' });
    return { granted, refused };
  }
  let out = (c.men || []).filter((m) => leaveOf(m)).length;
  const room = berths(c);
  /* A MAN IN THE GLASS IS NOT IN A BAR — this file's own rule, stated in the
   * header and enforced by `onLeave` for the seated crowd. It has to be
   * enforced HERE as well or the board could write a pass the room would then
   * refuse to seat: he would be out of `Company.fieldable`, out of the run,
   * and standing in neither place. */
  const inTank = new Set((c.ward?.tanks || []).filter(Boolean));
  for (const m of want) {
    if (leaveOf(m)) { refused.push({ designation: m.designation, why: 'already out' }); continue; }
    if (inTank.has(m.designation)) { refused.push({ designation: m.designation, why: 'in the ward' }); continue; }
    if (!admits(b, m)) { refused.push({ designation: m.designation, why: 'not admitted' }); continue; }
    if (out >= room) { refused.push({ designation: m.designation, why: 'no berth' }); continue; }
    m.leave = { bar: b.id, since: at };
    out++;
    granted.push(m.designation);
  }
  if (granted.length) Company.save(c);
  return { granted, refused };
}

/**
 * ══ CALL HIM BACK IN ══════════════════════════════════════════════════════
 *
 * `Medbay.discharge`'s twin, and the same argument: the pass can be torn up
 * before the evening is over, the man keeps every hour of nerve and mending he
 * has already been credited, and the berth goes to somebody else. That is the
 * decision the board exists to give the player, and it is the one thing that
 * turns a full leave list into a choice rather than a queue.
 *
 * IT SETTLES BEFORE IT TEARS UP. Without that line the hours between the last
 * settle and the press are hours the man stood in a bar and was paid nothing
 * for — the same defect `Medbay.awayFor` states at length about re-stamping a
 * ward, wearing the other face.
 *
 * @returns the designations that came in.
 */
export function recallLeave(army, who = null, now = null) {
  const c = Company.load(army);
  advanceLeaveIn(c, nowHours(now));
  const want = who === null ? (c.men || []).filter((m) => leaveOf(m)) : pickMen(c, who);
  const out = [];
  for (const m of want) {
    if (!leaveOf(m)) continue;
    delete m.leave;
    out.push(m.designation);
  }
  Company.save(c);
  return out;
}

/** Names, records or nothing → the men on this roll that means. `Medbay.pickMen`. */
function pickMen(company, who) {
  const men = company?.men || [];
  if (who === null || who === undefined) return men.slice();
  const list = Array.isArray(who) ? who : [who];
  const want = new Set(list.map((x) => (typeof x === 'string' ? x : x?.designation)).filter(Boolean));
  return men.filter((m) => want.has(m.designation));
}

/**
 * ══ WHAT THE LIBERTY BOARD PRINTS ═════════════════════════════════════════
 *
 * One row per man on the roll: where he is, what an hour there is worth to
 * him, and — for the ones still in the barracks — which of the four rooms
 * would take him. Everything a screen needs and no HTML, which is the line
 * `Medbay.wardRows` draws between this file and `main.js`.
 */
export function leaveRows(company) {
  const men = (company?.men || []).filter((m) => takesLeave(m, company?.army));
  const inTank = new Set((company?.ward?.tanks || []).filter(Boolean));
  return men.map((m) => {
    const pass = leaveOf(m);
    const b = pass ? barById(pass.bar) : null;
    return {
      designation: m.designation,
      rank: rankFor(m.xp | 0),
      /* THE TWO NUMBERS THE EVENING MOVES, as they stand right now, so the
       * board can be read before and after and the difference is visible
       * without a second screen. */
      morale: Number.isFinite(m.morale) ? m.morale : 0.72,
      hp: hpOf(m),
      hurt: isHurt(m),
      tank: inTank.has(m.designation),
      bar: b ? b.id : null,
      where: b ? (PLACE.get(b.id)?.name || b.what) : null,
      ease: b ? b.ease : 0,
      /* WHICH DOORS WOULD LET HIM IN. The velvet rope, rendered as a fact
       * about a man rather than as an error he gets after pressing. */
      may: BARS.filter((x) => admits(x, m)).map((x) => x.id),
    };
  });
}

/**
 * ══ THE HOURS, CREDITED ═══════════════════════════════════════════════════
 *
 * `Medbay.advanceIn`'s shape, clause for clause, and deliberately so: pure on
 * the object, no store and no clock, so a check can drive eight hours in one
 * line and the station can drive a sixtieth of one every frame through the
 * same arithmetic.
 *
 * TWO NUMBERS AND ONE STAMP:
 *
 *   NERVE. `ease` an hour, capped at `MORALE.PRESENCE_CAP`. Never DOWN — a man
 *     already steadier than the cap keeps what he has; an evening off is not a
 *     thing that can hurt somebody.
 *   THE WOUND. `mend` of the tank's own rate, and the field is DELETED at
 *     `FIT` rather than pinned there, because `Company.readMan` treats an
 *     absent `hp` as a whole man and two spellings of one fact is the drift
 *     that file spends its whole reader refusing.
 *   `since` MOVES UP TO NOW, always, even on a frame that credited nothing —
 *     a stamp left in the past is a span that gets paid twice.
 *
 * @returns `{ hours, eased, mended, moved }` — `mended` is who came off the
 *          wounded list on this advance, which is what a banner says.
 */
function advanceLeaveIn(company, now) {
  const at = Number(now);
  const out = { hours: 0, eased: [], mended: [], moved: false };
  if (!company || !Number.isFinite(at)) return out;
  for (const m of (company.men || [])) {
    const pass = leaveOf(m);
    if (!pass) continue;
    const b = barById(pass.bar);
    /* A pass to a room this build no longer has is torn up rather than
     * honoured — the same refusal `Company.saneWard` makes of a tank holding
     * a name that is not on the roll. */
    if (!b) { delete m.leave; out.moved = true; continue; }
    const h = at - pass.since;
    m.leave = { bar: b.id, since: at };
    if (!(h > 0)) continue;
    out.hours = Math.max(out.hours, h);
    const was = Number.isFinite(m.morale) ? m.morale : 0.72;
    const nerve = Math.min(MORALE.PRESENCE_CAP, was + b.ease * h);
    if (nerve > was) { m.morale = nerve; out.eased.push(m.designation); out.moved = true; }
    if (isHurt(m)) {
      const gain = (FIT / HOURS) * b.mend * h;
      const heal = hpOf(m) + gain;
      out.moved = true;
      if (heal >= FIT) { delete m.hp; out.mended.push(m.designation); }
      else m.hp = heal;
    }
  }
  return out;
}

/**
 * …and the same, through the store, catching up with the clock on the wall.
 * `Medbay.settle`'s door with `Medbay.settle`'s subtraction.
 */
function settleLeave(army, now = null) {
  const c = Company.load(army);
  const r = advanceLeaveIn(c, nowHours(now));
  if (r.moved) Company.save(c);
  return r;
}

/**
 * HOW OFTEN THE STATION LOOKS. Ten seconds, `Medbay.SETTLE_EVERY`'s number and
 * `Medbay.SETTLE_EVERY`'s reason: `Company.save` is a `JSON.stringify` of the
 * whole roll and a ledger that stamped on every frame would write six times a
 * minute for ever. Ten real seconds is a twelfth of a station hour.
 */
export const LEAVE_EVERY = 10;

/**
 * ══ THE STATION'S OWN STEP ════════════════════════════════════════════════
 *
 * Called once a frame from `Station.stepStation`, beside `stepMedbay` and for
 * the identical reason: *"a man mending is a thing that happens while you
 * shop"*. A night off must not be a thing that only happens while you stand in
 * the bar watching it, or the feature is a screen again.
 *
 * BOTH ROLLS, because a company is per-army and the station does not know
 * which one you came home with.
 *
 * @returns the rolls that changed, or null on a frame that did nothing.
 */
export function stepLeave(world, dt) {
  const st = world?._station;
  if (!st) return null;
  world._leaveT = (world._leaveT || 0) + (Number(dt) || 0);
  if (world._leaveT < LEAVE_EVERY) return null;
  world._leaveT = 0;
  const out = [];
  for (const army of ARMY_IDS) {
    /* THE DAY BESIDE THE HOUR. `st.hour` is the fractional wall clock and
     * `stationDay` is the counter `tickStationClock` moves through the same
     * door when it wraps, so the two cannot disagree about which midnight the
     * evening is on. */
    const r = settleLeave(army, stationDay() * 24 + st.hour);
    if (r.mended.length) out.push({ army, mended: r.mended });
  }
  return out.length ? out : null;
}
