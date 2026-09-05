/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE NOTICE BOARD — #25 Lost & found, and what is actually pinned to it
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── THE DEFECT THIS FILE EXISTS FOR ───────────────────────────────────────
 *
 * `SHAPES.noticewall` lays forty small slabs across the back of #25, half of
 * them lit, under a gazetteer verb that says *"read the notices"* and a
 * gazetteer look that says *"notices change daily"*. Measured through the same
 * door the game uses — `tools/_noticeprobe.mjs`, one press at the room's
 * centre:
 *
 *     {"said":[["LOST & FOUND","read the notices"]],"meshes":7,"texts":0}
 *
 * ZERO textures in the room. Forty blank coloured rectangles and a verb that
 * promises reading. And V15 §1.3.4 asks this room for one thing by name — the
 * home's address is *"printed on the door and on the notice board (#25)"* —
 * which was on the door (`Home.dressHome`'s plaque) and nowhere else.
 *
 * ── NOTHING BELOW IS INVENTED, AND THAT IS THE WHOLE DESIGN ───────────────
 *
 * A lost-and-found on a station with 300 residents, a jobs board, a fight card
 * and a shop day writes itself out of stores that already exist. Every notice
 * on the wall is a READING of one of them:
 *
 *   ADDRESS   `Home.homeAddress` of the door you actually live behind —
 *             §1.3.4's sentence, and the one notice that is never rolled away.
 *   LOST      `Kennel.load().fallen` with `fate: 'left'`. A companion you left
 *             standing on the ground is a lost animal; one that died is the
 *             habitat's plaque and is not this room's business.
 *   OWED      `Quests.owedJobs()` — you finished the job, the money is still
 *             in that room, and the giver is pinned there waiting.
 *   WANTED    `Quests.offersAt(place, day)` over the gazetteer, named by the
 *             GIVER — `StationCast.resident(job.giver).name` is the same seed
 *             that builds the body you will meet, so the notice and the person
 *             cannot be two different people.
 *   TONIGHT   `Tote.programmeAt` for the three venues and `Pits.venueOpen` for
 *             the two pits. A dark night says so.
 *   ON SALE   `Counter.shelfFor(counter, day)` — the dearest thing on a
 *             counter's shelf today, which is the shop's own reroll advertised
 *             one deck away.
 *   FOUND     a real row off `Vendors.everyRow()`, claimable at a real
 *             residential door — `homeAddress` again, so the addresses on the
 *             board are derived by the same function yours is and no two files
 *             can disagree about what a door is called.
 *   THE ROLL  `StationBoards.companyOf()` — how many are standing.
 *
 * ── SEEDED OFF THE DAY, AND NEVER OFF `Math.random` ───────────────────────
 *
 * `Counter.shelfFor`'s precedent, stated there and true here for the same
 * reason: *"two players standing at one counter must see one shelf, and a
 * shelf that changed when you looked away would be a slot machine."* Everyone
 * on the station reads the same board today and a different one tomorrow. One
 * stream, `makeRng(hashOf('notice:' + day))`, and the four stores it reads are
 * themselves seeded off the same day.
 *
 * ── WHAT A ROW MAY SAY, AND THE WIDTH IS DERIVED ──────────────────────────
 *
 * `StationKit.signPanel` sizes a body row at `H / (n + 2.2)` and a head row at
 * `H / 3.4`, and it neither wraps nor measures — a line too long for the
 * canvas runs off both edges of the slab. So `fit` computes the width from
 * that same arithmetic and Courier's 0.6-em advance rather than from a number
 * somebody typed: at 320 x 224 a head holds 8 characters, and a body row holds
 * 10, 12 or 14 depending on how many rows are under it. The #25 clause in
 * `tools/checks/station.mjs` drives every notice this file can produce over
 * three hundred days and asserts that nothing overruns, which is the only way
 * a typo in a line stays cheap.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { signPanel } from './StationKit.js';
import { makeRng } from '../engine/MathUtil.js';
import { PLACE, PLACES } from './StationPlan.js';
import { homeAddress, loadHome } from './Home.js';
import { offersAt, owedJobs } from './Quests.js';
import { load as loadKennel } from './Kennel.js';
import { COMPANION_KINDS } from './CompanionKinds.js';
import { COUNTERS, everyRow } from './Vendors.js';
import { shelfFor, priceOf } from './Counter.js';
import { VENUES, programmeAt } from './Tote.js';
import { PITS, venueOpen } from './Pits.js';
import { resident } from './StationCast.js';
import { companyOf } from './StationBoards.js';

/** The canvas a notice is drawn on. A slab is 0.5 m x 0.36 m — 1.39:1. */
export const NOTICE_PX = 320;
export const NOTICE_PY = 224;

/**
 * HOW MANY CHARACTERS A ROW HOLDS, off `signPanel`'s own type arithmetic.
 *
 * `signPanel` draws a head at `H/3.4` and a body row at `H/(n + 2.2)`, in
 * Courier, whose advance is 0.6 em. Nothing here is a taste number: change the
 * canvas and the widths follow, which is why this is a function and not a
 * table. `station.mjs`'s #25 clause drives every notice this file can produce
 * over three hundred days against these widths, so a new line that runs off
 * the slab is a red rather than a rendering fault somebody notices later.
 */
export function rowWidth(rows, head = true) {
  const n = Math.max(1, rows);
  const px = head ? NOTICE_PY / 3.4 : NOTICE_PY / (n + 2.2);
  return Math.max(4, Math.floor(NOTICE_PX / (px * 0.6)));
}

/**
 * One notice's rows, each cut to what its own slab can actually print.
 *
 * AT A WORD WHERE THERE IS ONE. `signPanel` does not wrap, so an over-long row
 * has to be cut somewhere; cutting mid-word gave "COOLANT & WATE" and "TRAM
 * STATION —", which read as a rendering fault rather than as a short notice.
 * The last space inside the width wins unless that would throw away more than
 * half the line, in which case a hard cut is the lesser of the two.
 */
function fit(rows) {
  const n = rows.length;
  return rows.map((r, i) => {
    const w = rowWidth(n, i === 0);
    const s = String(r ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
    if (s.length <= w) return s;
    const sp = s.lastIndexOf(' ', w);
    return (sp > w * 0.5 ? s.slice(0, sp) : s.slice(0, w)).replace(/[\s,;:.&'—-]+$/, '');
  });
}

/**
 * A ROOM AS A NOTICE NAMES IT. The gazetteer's names carry a leading article
 * and, on the four platforms, a dash and a destination — `Tram station —
 * Quarters` is 24 characters against a 14-character row. Both are dropped
 * here rather than a second table of short names being kept beside the
 * gazetteer, which is the hand-maintained twin `HANDOFF` §2.3 is about.
 */
function shortRoom(name) {
  return String(name || '').replace(/^the\s+/i, '')
    .split(/\s+[—-]\s+/)[0].split(/\s+&\s+/)[0].trim();
}

/** A stable 32-bit hash. `Counter.js`'s idiom, and the same one for the same reason. */
function hashOf(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) || 1;
}

/** `12.75` → `12:45`. The station's clock is a float and a notice is not. */
function clock(h) {
  const t = ((Number(h) || 0) % 24 + 24) % 24;
  const hh = Math.floor(t), mm = Math.round((t - hh) * 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * WHICH DOORS ON THIS STATION ARE SOMEBODY'S FRONT DOOR.
 *
 * Derived off the gazetteer's own deck-44 residential rows rather than listed,
 * so a quarter that is added or moved changes what the board can print without
 * anything here being edited. `#27` is excluded because it is YOURS — a found
 * item claimable at your own door would be a notice telling you to visit
 * yourself.
 */
const DOORS = PLACES.filter((p) => p.deck === 44 && p.id !== 27 && !p.stop
  && /quarter|residential|hostel/i.test(p.name));

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT THE STORES SAY TODAY
 * ══════════════════════════════════════════════════════════════════════════
 *
 * One read per store, done here rather than in each writer, so a board is one
 * pass over the day's state and not eight. Every one of them is wrapped: this
 * runs while a deck is being dressed, and a board that threw would take the
 * room down with it. A store that cannot be read contributes no notices, which
 * is a shorter board and never a broken one.
 */
export function sourcesFor(day = 0) {
  const s = { day: day | 0, address: '', lost: [], owed: [], work: [], card: [], shelf: [], found: [], roll: null };
  /* THE ADDRESS OF THE DOOR YOU ACTUALLY LIVE BEHIND. `loadHome().place` is
   * what Lane F reassigns; `homeAddress` derives the string from the gazetteer
   * row, so this is the same call `Home.dressHome` makes for the door plaque
   * and the two cannot print different addresses for one cabin. */
  try {
    const h = loadHome();
    s.address = homeAddress(PLACE.get(h?.place ?? 27) || PLACE.get(27)) || '';
  } catch { s.address = homeAddress(PLACE.get(27)) || ''; }

  try {
    for (const f of (loadKennel().fallen || [])) {
      if (f?.fate !== 'left') continue;
      s.lost.push({ name: f.name || (COMPANION_KINDS[f.kind]?.label || 'a companion'), where: f.where || null });
    }
  } catch { /* no kennel on disk is an empty list, not a failure */ }

  try {
    for (const j of owedJobs()) {
      const p = PLACE.get(j.place);
      if (p) s.owed.push({ room: p.name, pay: Math.max(0, j.pay | 0) });
    }
  } catch { /* no ledger */ }

  /**
   * THE JOBS ON OFFER, OVER THE WHOLE GAZETTEER AND NOT OVER ONE ROOM.
   *
   * `offersAt` is a hash and two rng draws per place — fifty-odd of them once
   * a day, which is nothing, and it is the ONLY way a board can say where the
   * work is. `ctx` is deliberately null: a job that names one of your men or a
   * kind you have fought is a conversation for the room, and printing a man's
   * name on a public board would be the station knowing something it should
   * not. `offersAt` answers with the shapes that need no context.
   */
  try {
    for (const p of PLACES) {
      if (!p.verb || p.id === 25) continue;
      for (const job of offersAt(p.id, day, null)) {
        s.work.push({ room: p.name, who: resident(job.giver).name, pay: Math.max(0, job.pay | 0) });
      }
    }
  } catch { /* no quests */ }

  try {
    for (const v of VENUES) {
      const prog = programmeAt(v.id, day);
      s.card.push({ name: v.name, dark: !!prog.dark, meets: prog.meets.length,
        from: prog.meets.length ? prog.meets[0].from : null });
    }
    /* THE TWO PITS, AND NOT THE ROOM TWICE. `#20 The Arena` is a Tote venue
     * (there is a card to bet on) AND a `Pits` venue (you can fight in it), so
     * the two loops answer for one room and the board printed ARENA on two
     * slabs. The tote's line is the richer of the two — it knows how many
     * meets and when the first one is — so the pit's is dropped where they
     * collide rather than a name being special-cased. */
    const named = new Set(s.card.map((c) => c.name));
    for (const p of PITS) {
      if (named.has(p.name)) continue;
      /* THE ROSTER HOUR, not the frame's hour: a board is read all day and
       * `venueOpen` folds the clock and the night's roll into one answer. What
       * a notice can honestly say is whether it runs TONIGHT, which is the
       * roll, so it is asked at an hour inside the venue's own window. */
      const open = venueOpen(p, p.hours[0], { day });
      s.card.push({ name: p.name, dark: !open.open, meets: 0, from: p.hours[0] });
    }
  } catch { /* no card */ }

  try {
    for (const c of COUNTERS) {
      const rows = shelfFor(c, day);
      if (!rows.length) continue;
      const top = rows[rows.length - 1];          // dearest last — shelfFor sorts
      const p = PLACE.get(c.place);
      s.shelf.push({ room: p?.name || c.name, what: top.name, price: priceOf(top) });
    }
  } catch { /* no shelf */ }

  try {
    const roll = companyOf();
    if (roll) s.roll = { standing: (roll.men || []).length, fallen: (roll.fallen || []).length };
  } catch { /* no company */ }

  return s;
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE WRITERS — one per kind of notice, and each one owns its own words
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `Quests.SHAPES`' shape: a table of small objects, each with an id and a
 * function, so a new kind of notice is a row here and nothing else in the file
 * moves. A writer hands back an array — none, one, or several — and the board
 * below decides how many of them fit.
 *
 * `pin` is what a writer is worth: the board fills the wall in descending pin
 * order, so the address and the money you are owed are on it on a busy day and
 * the shop advertisement is what falls off. It is a priority and not a
 * probability — nothing is rolled away that the player needs.
 *
 * `take` IS WHY THE BOARD IS NOT ONE THING THIRTEEN TIMES, and it was measured
 * before it was written. `offersAt` puts about twenty jobs a day across the
 * gazetteer, so a wall filled purely by pin order came out as ONE address and
 * TWELVE identical WANTED cards — a jobs board wearing the lost-and-found's
 * name, and no better than the blank wall it replaced. `take` caps what each
 * kind may claim. The caps sum to eighteen against thirteen slots, so a busy
 * day still drops the low-pin kinds and a quiet one still fills the wall.
 */
export const WRITERS = [
  {
    /* §1.3.4, and the only notice that cannot be rolled off the wall. */
    id: 'address', pin: 100, take: 1,
    write: (s) => (s.address ? [['ADDRESS', s.address, 'YOUR DOOR']] : []),
    say: (r) => `the door you live behind is ${r[1]}`,
  },
  {
    /* The giver is pinned in that room until you go back for it — see
     * `Quests.pinnedGivers`. A board that did not say so would leave the money
     * where the player would never think to look for it. */
    id: 'owed', pin: 90, take: 2,
    write: (s) => s.owed.map((o) => ['OWED', shortRoom(o.room), `${o.pay} CREDITS`, 'GO AND ASK']),
    say: (r) => `${r[2].toLowerCase()} waiting for you at ${r[1]} — go and ask`,
  },
  {
    /* A companion left standing on the ground. The one notice on this wall
     * that is literally what the room is called. */
    id: 'lost', pin: 80, take: 2,
    write: (s) => s.lost.map((l) => ['LOST', l.name, l.where || 'LEFT BEHIND', 'ANY WORD?']),
    say: (r) => `${r[1]} is still up on the wall — last seen ${String(r[2]).toLowerCase()}`,
  },
  {
    id: 'wanted', pin: 60, take: 4,
    write: (s, rng) => shuffled(s.work, rng).map((w) => ['WANTED', w.who, shortRoom(w.room), `${w.pay} CR`]),
    say: (r) => `${r[1]} wants a hand at ${r[2]}, ${String(r[3]).toLowerCase()}`,
  },
  {
    /* SHUFFLED, so the five venues take turns. Three slots and five rooms —
     * the Underlift Pit being dark tonight is the most interesting line on
     * this wall and it is the last row of the list, so a fixed order would
     * have meant it never once reached the board. */
    id: 'card', pin: 50, take: 3,
    write: (s, rng) => shuffled(s.card, rng).map((c) => (c.dark
      ? ['TONIGHT', shortRoom(c.name), 'DARK']
      : ['TONIGHT', shortRoom(c.name), c.meets ? `${c.meets} MEET${c.meets === 1 ? '' : 'S'}` : 'IT IS ON',
        c.from == null ? '' : `FROM ${clock(c.from)}`].filter(Boolean))),
    say: (r) => (r[2] === 'DARK' ? `${r[1]} is dark tonight`
      : `${r[1]} tonight — ${String(r[2]).toLowerCase()}${r[3] ? `, ${String(r[3]).toLowerCase()}` : ''}`),
  },
  {
    id: 'sale', pin: 40, take: 2,
    write: (s, rng) => shuffled(s.shelf, rng).map((h) => ['ON SALE', h.what, shortRoom(h.room), `${h.price} CR`]),
    say: (r) => `${r[1]} is on the shelf at ${r[2]}, ${String(r[3]).toLowerCase()}`,
  },
  {
    /* THE ROOM'S OWN STOCK. A thing off a real shelf, at a real door — both
     * halves derived, so nothing here is a second catalogue or a second
     * address table to keep in step. */
    id: 'found', pin: 30, take: 3,
    write: (s, rng) => {
      const rows = everyRow();
      if (!rows.length || !DOORS.length) return [];
      const out = [];
      for (let i = 0; i < 3; i++) {
        const what = rows[Math.floor(rng() * rows.length)];
        const door = DOORS[Math.floor(rng() * DOORS.length)];
        out.push(['FOUND', what.name, 'CLAIM AT', homeAddress(door)]);
      }
      return out;
    },
    say: (r) => `somebody handed in ${r[1]} — claim it at ${r[3]}`,
  },
  {
    id: 'roll', pin: 20, take: 1,
    write: (s) => (s.roll
      ? [['THE ROLL', `${s.roll.standing} STANDING`, `${s.roll.fallen} FALLEN`, 'SEE #56']] : []),
    say: (r) => `the roll is pinned up: ${String(r[1]).toLowerCase()}, `
      + `${String(r[2]).toLowerCase()} — the names are at #56`,
  },
];

/** Fisher–Yates off the day's own stream, so the order is the same for everyone. */
function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * ══ THE BOARD ═════════════════════════════════════════════════════════════
 *
 * `slots` is how many lit slabs the room actually built — the wall publishes
 * it (`ctx.notices.at`), so this is never a second opinion about how big #25's
 * back wall is. Writers are drained in pin order and the wall fills; a station
 * with nothing to say puts up fewer notices rather than padding, which is what
 * `PAPER` is emphatically not for — an unwritten slab stays paper.
 */
export function noticesFor(day = 0, slots = 13, s = null) {
  const src = s || sourcesFor(day);
  const rng = makeRng(hashOf(`notice:${day | 0}`));
  const out = [];
  for (const w of [...WRITERS].sort((a, b) => b.pin - a.pin)) {
    let took = 0;
    for (const rows of w.write(src, rng)) {
      if (out.length >= slots) return out;
      if (took >= (w.take ?? 1)) break;
      took++;
      /* `say` IS BUILT OFF THE RAW ROWS AND NOT THE FITTED ONES. `fit`
       * uppercases and cuts to the slab's width, which is right for a 320 px
       * canvas and wrong for a banner — "COOLANT & WATE" is a legible notice
       * and an illegible sentence. Both come out of the same rows, so the
       * words the key reads to you and the words on the slab in front of you
       * are one string built twice, which is the whole reason `noticeReading`
       * does not have a table of its own. */
      out.push({ id: w.id, rows: fit(rows), say: w.say ? w.say(rows) : '' });
    }
  }
  return out.slice(0, slots);
}

/**
 * ══ WHAT THE KEY SAYS — #25's verb, answered ══════════════════════════════
 *
 * ── THE DEFECT THIS FUNCTION WAS ─────────────────────────────────────────
 *
 * The gazetteer's verb for #25 is *"read the notices"* and its look is
 * *"notices change daily"*. The WALL honours both — thirteen slabs, written,
 * and `noticesFor(0) !== noticesFor(1)`. The READING did not. Measured through
 * the real door, three presses a day on days 0, 1, 2, 7 and 30, fifteen presses
 * in all:
 *
 *     LOST & FOUND :: 13 notices up today, and your door is 44-A-27
 *
 * Byte-identical, all fifteen. The two branches that could have moved it read
 * `s.owed` and `s.lost`, and both are EMPTY ON A FRESH SAVE — so the constant
 * was not an edge case, it was what every player gets on every one of their
 * first days, in a room whose one verb is to read.
 *
 * ── SO THE KEY READS YOU A NOTICE OFF THE WALL ───────────────────────────
 *
 * Which is what the verb says and what a person does: you stand at a board,
 * you read one of the things pinned to it, and if you are still standing there
 * you read the next one. Two dimensions of change and each is honest:
 *
 *   DAY TO DAY   the board itself is different (that is `noticesFor`), and the
 *                ORDER you read it in is a second draw off the day —
 *                `makeRng(hashOf('read:' + day))` — so press one is a different
 *                notice tomorrow even where the same notice is up.
 *   PRESS TO PRESS  a cursor walks that order. It is the only mutable thing in
 *                this file and it is a READING POSITION, not content: two
 *                players on one station read the same wall in the same order,
 *                which is `Counter.shelfFor`'s law and the reason nothing here
 *                is `Math.random`. It resets when the day turns, and it wraps,
 *                because a wall you have read all of is one you start again.
 *
 * WHAT IS ABOUT YOU IS READ FIRST. `owed` and `lost` are the two notices with
 * your name on them — money left in a room and an animal you left standing —
 * so they are lifted to the front of the order rather than being given a
 * branch of their own. That keeps the old code's intent (the money must not be
 * buried) without its constant, and on a fresh save, where both lists are
 * empty, the order is the day's shuffle and nothing is special-cased.
 *
 * AND THE COUNT IS SAID ONCE. "13 notices up today" is worth saying when you
 * walk up to the wall and is noise on the fourth press, so it rides the first
 * reading of the day and nothing after it.
 *
 * Two strings, because `world.notify` takes a head and a line, which is the
 * shape every other verb on the station answers in.
 */

/** Where you are in today's wall. See above: a position, not content. */
let _read = { day: null, n: 0 };

/** The order today's board is read in — the day's own draw, yours first. */
export function readingOrder(day = 0, board = []) {
  const rng = makeRng(hashOf(`read:${day | 0}`));
  const idx = shuffled(board.map((_, i) => i), rng);
  const mine = idx.filter((i) => board[i].id === 'owed' || board[i].id === 'lost');
  return [...mine, ...idx.filter((i) => !mine.includes(i))];
}

export function noticeReading(day = 0, slots = 13) {
  const s = sourcesFor(day);
  const board = noticesFor(day, slots, s);
  const door = s.address ? `your door is ${s.address}` : 'no door of yours is on it';
  /* A wall with nothing on it is a real answer and not a failure — see
   * `noticesFor`'s note about the unwritten slab staying paper. */
  if (!board.length) return ['LOST & FOUND', `nothing is pinned up today, and ${door}`];
  const d = day | 0;
  if (_read.day !== d) _read = { day: d, n: 0 };
  const order = readingOrder(d, board);
  const one = board[order[_read.n % order.length]];
  const first = _read.n === 0;
  _read.n++;
  const say = one.say || one.rows.filter(Boolean).join(' — ').toLowerCase();
  return ['LOST & FOUND', first
    ? `${board.length} notice${board.length === 1 ? '' : 's'} up today — ${say}`
    : say];
}

/**
 * ══ WRITE THE WALL ════════════════════════════════════════════════════════
 *
 * `Habitat.writePlaques`' shape and `StationBoards.dressObelisk`'s frame.
 *
 * WORLD COORDINATES AND NOT THE ROOM'S. `buildPlace` bakes a place's transform
 * into its meshes and leaves the group at identity — so a panel parented to
 * the place's group with local coordinates lands at the centre of the drum.
 * The room hands back its slab positions in ITS OWN frame (that is where they
 * were authored) and this rotates them out, exactly as `dressBoards` does for
 * the departures board.
 *
 * PARENTED TO THE PLACE, so a notice is culled, hidden and disposed with the
 * room it is in rather than living on the scene for the life of the deck —
 * `Habitat.js`'s stated reason and the same one.
 *
 * ── WHAT IT COSTS, MEASURED ───────────────────────────────────────────────
 *
 * One draw per notice. Deck 40 drew 143 meshes before this and 156 after, on
 * §12.2's bound of 400 — `tools/_noticeprobe.mjs` prints both. Thirteen
 * canvases at 320 x 224 is 3.7 MB of texture, once, on the deck the room is
 * on; `signPanel.draw` early-outs on identical text, so a revisit on the same
 * day redraws nothing at all.
 */
export function dressNotices(world, st, M) {
  const n = st?.notices;
  if (!world || !n || !Array.isArray(n.at) || !n.at.length) return null;
  const rows = noticesFor(st.day ?? 0, n.at.length);
  const parent = n.group || world.scene;
  const c = Math.cos(n.yaw), s = Math.sin(n.yaw);
  const made = [];
  for (let i = 0; i < rows.length; i++) {
    const at = n.at[i];
    const panel = signPanel(rows[i].rows, {
      name: `notice${i}`, px: NOTICE_PX, pyx: NOTICE_PY, align: 'left',
      bg: '#0d0a07', head1: '#ffd9a0', ink2: '#c9a06a',
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(n.w * 0.92, n.h * 0.92), panel.material);
    mesh.name = `station-notice-${i}`;
    /* A hair in front of the slab's own face, which is `n.t / 2` thick. */
    const lz = at.z - n.t / 2 - 0.01;
    mesh.position.set(n.x + at.x * c + lz * s, n.y + at.y, n.z - at.x * s + lz * c);
    mesh.rotation.y = n.yaw + Math.PI;
    parent.add(mesh);
    made.push({ panel, mesh });
  }
  /* ON THE DECK'S BILL, for `dressObelisk`'s stated reason: a mesh that goes
   * to the scene and is counted by nothing makes §12.2's 400 a measurement of
   * the wrong number. */
  st.draws += made.length;
  st.notices.panels = made;
  st.notices.day = st.day ?? 0;
  return made;
}

/**
 * RE-CUT THE WALL WHEN THE DAY TURNS.
 *
 * *"notices change daily"* is the gazetteer's own line for this room and it is
 * the only thing that moves here — the board is not a clock, so nothing is
 * redrawn on the hour and nothing at all is redrawn on a frame. `stepBoards`'
 * stamp shape: the day is the stamp, and it is compared before a single string
 * is built.
 */
export function stepNotices(world, st) {
  const n = st?.notices;
  if (!n?.panels?.length) return false;
  const day = st.day ?? 0;
  if (day === n.day) return false;
  n.day = day;
  const rows = noticesFor(day, n.panels.length);
  for (let i = 0; i < n.panels.length; i++) n.panels[i].panel.draw(rows[i]?.rows || ['']);
  return true;
}
