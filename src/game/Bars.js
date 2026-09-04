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
 * them is. This file is a new answer to the second question, in three rooms,
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
 */

import { PLACE } from './StationPlan.js';
import { resident } from './StationCast.js';
import { kindOfArmy } from './Attributes.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE ROOMS                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * The three rooms on this station a soldier drinks in, and what each is for.
 *
 * `draw` is the share of the evening's leave-men who choose it, and the three
 * add to one. They are not equal and the reason is the rooms themselves: the
 * cantina has a band and twenty-six seats, the Pit has a cashier behind bars
 * and fourteen, and the dome is up on deck 60 and holds people who wanted to
 * be somewhere quiet. A man who drinks in the dome went there on purpose.
 *
 * NO ROW HERE INVENTS A PLACE. Every id is a gazetteer row and `food.mjs`
 * holds each of them against `PLACE` — §15's rule is that a place not in §3.2
 * is not built, and a bar pointing at a room that does not exist would seat
 * the whole evening's leave into nowhere.
 */
export const BARS = [
  {
    id: 14, what: 'nightclub', draw: 0.55,
    line: 'the band is loud enough that nobody has to talk',
  },
  {
    id: 18, what: 'casino', draw: 0.30,
    line: 'they came down for one hand and it is not one hand',
  },
  {
    id: 54, what: 'quiet', draw: 0.15,
    line: 'up under the glass, watching the thing they were shot at by last week',
  },
];

const BAR_BY = new Map(BARS.map((b) => [b.id, b]));

/** Is this place one of the three? */
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
export function takesLeave(man, army = null) {
  if (!man) return false;
  const kind = man.kind || kindOfArmy(man.army || army);
  return kind !== 'steel';
}

/**
 * Which men have leave today, and which bar each of them went to.
 *
 * Returns rows of `{ man, bar }`. Deterministic on `(designation, day)`, so
 * the evening is the same evening however many times it is asked, and a
 * different third of the roll is out tomorrow.
 */
export function onLeave(company, day = 0) {
  const men = company?.men || [];
  const army = company?.army || null;
  const inTank = new Set((company?.ward?.tanks || []).filter(Boolean));
  const out = [];
  for (const m of men) {
    if (!takesLeave(m, army)) continue;
    /* A MAN IN THE GLASS IS NOT IN A BAR. `Company.ward.tanks` is the bacta
     * ward's register and `Medbay.js` is mending him by the hour; putting him
     * in the cantina would be two rooms holding one man. */
    if (inTank.has(m.designation)) continue;
    if (hashF(m.designation, `leave${day | 0}`) >= LEAVE_SHARE) continue;
    out.push({ man: m, bar: pickBar(m.designation, day) });
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
 *   THE PLAYER'S OWN COME FIRST. See `ownHeads` — the seats are filled from
 *     your roll while it lasts and by the station's garrison after that, so a
 *     company of four does not empty the cantina and a company of forty does
 *     not fill it twice over.
 */
export function leaveHeads(bar, hour, heads, opts = {}) {
  const b = typeof bar === 'object' && bar ? bar : barById(bar);
  if (!b) return 0;
  const k = libertyAt(hour);
  if (k <= 0) return 0;
  const n = (heads | 0) * GARRISON_SHARE * k;
  return Math.max(0, Math.min(heads | 0, Math.round(n)));
}

/**
 * …and how many of those are men off the player's own roll.
 *
 * *"the population at that hour is drawn from the player's own company where
 * one exists, and from the station's residents otherwise."* Where one exists
 * it is usually SMALLER than the room — a company is ten or twenty men and
 * three bars share them — so this is a floor on how many of the uniforms in
 * the room have names you know, not a ceiling on how many uniforms there are.
 * The rest is the garrison, and the player cannot tell the difference until
 * they read a nameplate, which is exactly right.
 */
export function ownHeads(bar, hour, heads, opts = {}) {
  const b = typeof bar === 'object' && bar ? bar : barById(bar);
  const company = opts.company || null;
  if (!b || !company || !(company.men || []).length) return 0;
  const mine = onLeave(company, opts.day).filter((r) => r.bar.id === b.id).length;
  return Math.min(mine, leaveHeads(b, hour, heads, opts));
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
export function soldierIn(bar, i, opts = {}) {
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
