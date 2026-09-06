/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE HOLONET — galactic television, all day, never the same twice
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player: *"in addition to the pod racing there should be galactic
 * television of some kind with 24/7 tv (also procedural, never the same).
 * Maybe in the apartment and other places in the station."*
 *
 * A CHANNEL is a rota of PROGRAMMES over the station's day in half-hour
 * slots, rotated by the day so tomorrow's line-up is not today's. A PROGRAMME
 * is a kind, and every kind has its own look:
 *
 *   news     a studio — THE ANCHOR at a desk, one face per station, gossiping
 *            about what the player did (the standing, the brig, the last run,
 *            the jobs owed, the ticket at the Drum, the race)
 *   orbit    the chart — the theatre's real level name, the fleet count off
 *            `deckBattleState`, the weather over the line
 *   adverts  a product hero — a real row off a real counter's shelf today,
 *            at its real price
 *   talk     two portraits in the same painter as the anchor, saying their
 *            own bark lines
 *   sport    the race standings, live off the tote
 *   drum     THE WHEELHOUSE'S DRUM, LIVE — the small hours and the top of
 *            every hour: the twenty segments, the pointer, the station clock,
 *            the last six stops
 *   ident    the station's card; the test card 02:30–05:00
 *
 * A corner clock and a channel bug on everything; a ticker where there is
 * news. Inside a programme the picture CUTS every few seconds (a new headline,
 * a new advert), so a minute in front of a screen is a minute of change.
 *
 * NOTHING HERE ROLLS. Every choice is a hash of `(day, slot, cut)` —
 * `determinism.mjs` refuses the random source in `src/`, and two screens in two
 * rooms must show the same picture at the same moment, which is what a
 * broadcast is.
 *
 * A SCREEN is a `tv` fixture a room builder declares (`StationKit.tvScreen`).
 * It paints only within `NEAR` of the player and at `FPS`.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { stationName, stationDay, standing, brigPending, casinoState } from './StationSave.js';
import { outsideLevel } from './Hangar.js';
import { deckBattleState } from './DeckBattle.js';
import { COUNTERS } from './Vendors.js';
import { shelfFor, priceOf } from './Counter.js';
import { resident, barkFor, SPECIES_BY } from './StationCast.js';
import { venueAtPlace, watch as toteWatch, resultOf, racesOn } from './Tote.js';
import { drumTable } from './Casino.js';
import { DRUM, drumAt, drumPays } from './Games.js';
import { loadProgress } from './Progress.js';
import { companyOf } from './StationBoards.js';
import { owedJobs, pinnedGivers } from './Quests.js';
import { weatherAt } from './StationEvents.js';

export const TV_W = 512, TV_H = 288;
export const NEAR = 30;
export const FPS = 6;
/** A programme is a half-hour slot; 48 a day. */
export const SLOT_MIN = 30;
/** Real seconds between cuts inside a programme. */
export const CUT_EVERY = 9;
/** The Drum goes out live for this many station minutes at the top of every hour. */
export const DRUM_MIN = 6;

export const KINDS = ['news', 'orbit', 'adverts', 'talk', 'sport', 'drum', 'ident'];
/** The rota, rotated by the day. Every kind is in it, so every day shows every kind. */
const ROTA = ['news', 'adverts', 'orbit', 'talk', 'adverts', 'sport', 'news', 'ident', 'talk', 'adverts', 'orbit', 'sport'];

/** FNV-1a with a final mix, so `…:0` and `…:1` do not share their top bits. */
function hashF(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function pick(arr, u) { return arr[Math.floor(u * arr.length) % arr.length]; }
const hh = (hour) => `${String(Math.floor(hour) % 24).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;

export const isTestCard = (hour) => hour >= 2.5 && hour < 5;
export const isSmallHours = (hour) => hour >= 0 && hour < 2.5;

/** Which programme is on at this hour of this day, and how far into it. */
export function programmeAt(day, hour) {
  const d = day | 0;
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  const slot = Math.floor((h * 60) / SLOT_MIN);
  let kind;
  if (isTestCard(h)) kind = 'ident';
  else if (isSmallHours(h) || (h % 1) * 60 < DRUM_MIN) kind = 'drum';
  else {
    /* the day's rota: the same twelve, walked at a stride coprime to twelve
     * from a day-seeded start, so two days are two line-ups */
    const shift = Math.floor(hashF(`holonet:rota:${d}`) * ROTA.length);
    const stride = [1, 5, 7, 11][Math.floor(hashF(`holonet:stride:${d}`) * 4)];
    kind = ROTA[(slot * stride + shift) % ROTA.length];
  }
  const into = ((h * 60) % SLOT_MIN) / SLOT_MIN;
  return { kind, slot, into, seed: `${d}:${slot}`, day: d, hour: h };
}

/** The line-up for a day, one entry per half hour. */
export function scheduleFor(day) {
  const out = [];
  for (let s = 0; s < 48; s++) out.push(programmeAt(day, s / 2 + 0.25).kind);
  return out;
}

/* ── THE PEOPLE ON THE CHANNEL ───────────────────────────────────────────── */

/** The anchor: one per station, the same person every day. */
export function anchorFor(name = stationName()) {
  return resident(`holonet:anchor:${name}`);
}
/** The talk show's host, likewise; the guest is the day's. */
export function talkHostFor(name = stationName()) {
  return resident(`holonet:host:${name}`);
}

/* ── THE CHANNEL'S SOURCES ───────────────────────────────────────────────── */
const WORDS = {
  news: ['HOLDS', 'FALLS', 'CONTESTED', 'RELIEVED', 'QUIET', 'BURNING', 'CUT OFF', 'REINFORCED'],
  adjective: ['finest', 'honest', 'quiet', 'proper', 'last', 'only', 'cheapest', 'real'],
  slogan: ['for those who mean it', 'no questions at the counter', 'open when the shutters are', 'the ring knows the name', 'since the hull was bolted', 'ask for it by name'],
  talk: ['on the war', 'on the station', 'on what you saw', 'on the price of things', 'on going home'],
  weather: ['clear', 'dust', 'storm belt', 'ion haze', 'fair', 'squalls'],
};

/**
 * WHAT THE STATION KNOWS ABOUT THE PLAYER, read once per cut off the stores
 * that already exist. Nothing here writes. Every read is guarded: a screen
 * must never take the station down because a store was hostile.
 */
export function playerFacts(world = null, day = stationDay(), hour = 12) {
  const f = { standing: 0, brig: false, owed: [], pinned: 0, run: null, fallen: null, kills: 0, men: 0, topMan: null, drum: null, drumWon: null, race: null, ticket: null };
  try { f.standing = Number(standing()) || 0; } catch {}
  try { f.brig = brigPending() === true; } catch {}
  try { f.owed = owedJobs().map((j) => ({ pay: j.pay | 0, giver: j.giver, place: j.place })); } catch {}
  try { f.pinned = pinnedGivers().size; } catch {}
  try {
    const p = loadProgress();
    const r = p?.recent?.[0];
    if (r) f.run = { depth: Number(r.depth) || 0, score: Number(r.score) || 0, won: r.won, order: r.order, species: r.species, mode: r.mode };
    f.kills = p?.kills | 0;
  } catch {}
  try {
    const co = companyOf();
    if (co) {
      f.men = (co.men || []).filter((m) => m && m.alive !== false).length;
      const fallen = (co.fallen || []).filter(Boolean);
      if (fallen[0]) f.fallen = { name: String(fallen[0].callsign || fallen[0].name || 'a trooper'), fate: fallen[0].fate, where: fallen[0].where, n: fallen.length };
      const top = (co.men || []).filter((m) => m && (m.kills | 0) > 0).sort((a, b) => (b.kills | 0) - (a.kills | 0))[0];
      if (top) f.topMan = { name: String(top.callsign || top.name || 'a trooper'), kills: top.kills | 0 };
    }
  } catch {}
  try {
    const c = casinoState();
    const t = c?.drum;
    if (t && t.kind) {
      f.drum = { label: String(t.label || t.kind), stake: t.stake | 0, turn: t.turn | 0 };
      const turnNow = (day | 0) * 24 + Math.floor(hour);
      if (f.drum.turn <= turnNow) {
        const at = drumAt(((t.turn % 24) + 24) % 24, Math.floor(t.turn / 24));
        f.drumWon = drumPays(t, at) > 0;
      }
    }
  } catch {}
  try {
    const v = venueAtPlace(19);
    if (v) {
      const done = racesOn(v.id, day).filter((r) => r.hour <= hour);
      const last = done[done.length - 1];
      if (last) {
        const res = resultOf(last);
        const w = res?.winner != null ? last.card?.entrants?.[res.winner]?.name : null;
        if (w) f.race = { name: last.name || v.name, winner: String(w), hour: last.hour };
      }
    }
  } catch {}
  try {
    const held = world?._toteHeld;
    if (Array.isArray(held) && held.length) f.ticket = { n: held.length, stake: held.reduce((a, t) => a + (t.stake | 0), 0) };
  } catch {}
  return f;
}

const ROBE = { jedi: 'a brown robe', sith: 'a black cloak' };
function robeOf(run) {
  const o = String(run?.order || '').toLowerCase();
  return ROBE[o] || (run?.species ? `a ${run.species}` : 'a stranger');
}

/**
 * THE GOSSIP. Twenty-odd templates that read the facts; each returns a line
 * or null when the fact is not there. The anchor is a person, so they are in
 * character: they never say "the player".
 */
export const HEADLINES = [
  { id: 'standing-bad', say: (f, s) => f.standing < 0 ? `${s}'s standing falls another row — somebody hurt a resident and the kiosks remember` : null },
  { id: 'standing-bad2', say: (f) => f.standing <= -3 ? `security wants a word with a face seen on the concourse; ${-f.standing} marks against the name` : null },
  { id: 'standing-shut', say: (f) => f.standing <= -6 ? 'the counters have pulled the shutters on one customer. no appeal, the merchants say' : null },
  { id: 'standing-good', say: (f, s) => f.standing > 0 ? `a good name on ${s} tonight: the counters are pricing kindly for one regular` : null },
  { id: 'standing-zero', say: (f, s) => f.standing === 0 && !f.run ? `a quiet night on ${s}. security reports nothing, which security says is unusual` : null },
  { id: 'brig', say: (f) => f.brig ? 'a night in the brig for one visitor. the duty sergeant declined to name them, then did' : null },
  { id: 'brig2', say: (f) => f.brig ? 'the brig has a guest. the guest has a lightsaber. the sergeant has questions' : null },
  { id: 'run-left', say: (f) => f.run && f.run.won === null ? `${robeOf(f.run)} left the line in a hurry last night, ${f.run.depth} areas in. security had questions` : null },
  { id: 'run-won', say: (f) => f.run?.won === true ? `${robeOf(f.run)} came back off the line with the job done. the cantina has not been quiet since` : null },
  { id: 'run-lost', say: (f) => f.run?.won === false ? `${robeOf(f.run)} was carried back off the line. ${f.run.score} points on the board, the medics say` : null },
  { id: 'run-score', say: (f) => f.run && f.run.score > 0 ? `${f.run.score} points filed on the obelisk overnight. the roll has a new row` : null },
  { id: 'run-depth', say: (f) => f.run && f.run.depth >= 3 ? `area ${f.run.depth} reached and reported. the traffic tower says the ship came back lighter` : null },
  { id: 'fallen', say: (f) => f.fallen ? (f.fallen.fate === 'left' ? `${f.fallen.name} has left a company on this station. no forwarding address` : `${f.fallen.name} is on the fallen face tonight${f.fallen.where ? `, lost at ${f.fallen.where}` : ''}. ${f.fallen.n} names now`) : null },
  { id: 'kills', say: (f) => f.kills >= 10 ? `${f.kills} felled by one visitor's hand, by the obelisk's count. the pits are interested` : null },
  { id: 'topman', say: (f) => f.topMan ? `${f.topMan.name} tops a company's roll with ${f.topMan.kills}. the bar has put a drink by for him` : null },
  { id: 'men', say: (f) => f.men > 0 ? `${f.men} troopers on leave from one company tonight. the cantina has doubled the guard on the glasses` : null },
  { id: 'owed', say: (f) => f.owed.length ? `${f.owed.reduce((a, o) => a + o.pay, 0)} credits sit unclaimed with ${f.owed.length === 1 ? 'a giver' : `${f.owed.length} givers`} who did the asking. somebody has not gone back` : null },
  { id: 'owed2', say: (f) => f.owed.length ? `${residentName(f.owed[0].giver)} is standing in the same room a third day, waiting to pay a debt` : null },
  { id: 'pinned', say: (f) => f.pinned > f.owed.length ? `${f.pinned - f.owed.length} job${f.pinned - f.owed.length === 1 ? '' : 's'} taken off the board and not done. the givers are patient. for now` : null },
  { id: 'drum-held', say: (f) => f.drum && f.drumWon == null ? `a ticket on ${f.drum.label} at the drum, ${f.drum.stake} credits, riding the next turn. the wheelhouse is watching one face` : null },
  { id: 'drum-won', say: (f) => f.drumWon === true ? `the drum paid out on ${f.drum.label} last turn. the wheelhouse says the money is at the window` : null },
  { id: 'drum-lost', say: (f) => f.drumWon === false ? `${f.drum.stake} credits went into the drum on ${f.drum.label} and did not come out. the house sends its regards` : null },
  { id: 'race', say: (f) => f.race ? `${f.race.winner} took the ${f.race.name} at ${hh(f.race.hour)}. the tote paid, eventually` : null },
  { id: 'race-ticket', say: (f) => f.race && f.ticket ? `${f.ticket.n} ticket${f.ticket.n === 1 ? '' : 's'} still held against the theatre's card, ${f.ticket.stake} credits on the line` : null },
  { id: 'ticket', say: (f) => f.ticket && !f.race ? `a punter is holding ${f.ticket.stake} credits of tote tickets before the first race is run` : null },
];

function residentName(seed) {
  try { return resident(String(seed)).name; } catch { return 'a giver'; }
}

/** The station's own lines — always there, so a blank save still has news. */
function stationLines(world, P, cut) {
  const name = stationName();
  const L = outsideLevel(world);
  const theatre = L?.name || 'the line';
  const B = deckBattleState(world);
  const u = hashF(`${P.seed}:n:${cut}`);
  return [
    `${theatre} ${pick(WORDS.news, u).toLowerCase()} — the tower reports ${B ? `${B.shown || B.hulls || 0} hulls in the window` : 'a quiet orbit'}`,
    `day ${(P.day | 0) + 1} on ${name} — arrivals every six minutes, departures when they can`,
    `customs held ${Math.floor(u * 40) + 12} at the gates this shift. ${Math.floor(u * 7) + 1} are still there`,
    /* the day's weather is `StationEvents.weatherAt`'s — the same word the
     * arboretum's rain and the tannoy use, so the news and the sky agree */
    `${theatre}: ${weatherAt(P.day, theatre).line} — ${pick(WORDS.weather, hashF(`${P.seed}:w:${cut}`))} over the line has not lifted`,
  ];
}

/** The news at this cut: a headline about the player where there is one, the station's otherwise. */
export function newsAt(world, P, cut, day = P.day, hour = P.hour) {
  const F = playerFacts(world, day, hour);
  const gossip = [];
  for (const H of HEADLINES) {
    let s = null;
    try { s = H.say(F, stationName()); } catch { s = null; }
    if (s) gossip.push({ id: H.id, line: s });
  }
  const station = stationLines(world, P, cut).map((line, i) => ({ id: `station-${i}`, line }));
  const u = hashF(`${P.seed}:g:${cut}`);
  /* Two in three cuts are gossip when there is any; the station fills the rest. */
  const pool = gossip.length && (cut % 3 !== 2) ? gossip : station;
  const head = pick(pool, u);
  const rest = [...gossip, ...station].filter((x) => x !== head);
  const sub = pick(rest, hashF(`${P.seed}:g2:${cut}`));
  return { head: head.line, headId: head.id, sub: sub.line, ticker: [...gossip, ...station].map((x) => x.line).join('   ·   '), facts: F, gossip: gossip.length };
}

export function advertOf(P, cut, day) {
  const u = hashF(`${P.seed}:a:${cut}`);
  const counter = pick(COUNTERS, u);
  const rows = shelfFor(counter, day);
  const row = rows.length ? pick(rows, hashF(`${P.seed}:a2:${cut}`)) : null;
  return {
    counter: counter.name || counter.id, id: counter.id,
    item: row ? String(row.name) : 'what is on the shelf today',
    price: row ? `${priceOf(row)} CR` : '',
    tier: row?.tier ?? null,
    line: `${pick(WORDS.adjective, u)} — ${pick(WORDS.slogan, hashF(`${P.seed}:a3:${cut}`))}`,
    shelf: rows.length,
  };
}

export function talkOf(P, cut, day) {
  const host = talkHostFor();
  const guest = resident(`holonet:guest:${P.seed}`);
  const who = cut % 2 ? guest : host;
  const said = barkFor(who, day, { hour: P.hour ?? 12 });
  const line = Array.isArray(said) ? said[said.length - 1] : String(said || '…');
  return { host, guest, speaker: who, line, topic: pick(WORDS.talk, hashF(`${P.seed}:t`)) };
}

export function sportOf(world, day, hour) {
  const v = venueAtPlace(19);
  if (!v) return null;
  let reading = null;
  try { reading = toteWatch(v.id, day, hour); } catch { return null; }
  const race = reading?.race;
  const res = race ? resultOf(race) : null;
  const winner = res?.winner != null ? (race.card?.entrants?.[res.winner]?.name || null) : null;
  return { phase: reading?.phase, name: race?.name || v.name, standings: reading?.standings || [], winner, progress: reading?.progress || 0, calls: reading?.calls || [], next: reading?.next || null };
}

/** The Drum as the channel shows it: this hour's stop, the last six, and the next turn. */
export function drumOf(day, hour) {
  const T = drumTable(hour, day);
  const nextAt = Math.floor(hour) + 1;
  return { ...T, nextAt, nextIn: nextAt - hour };
}

/* ── THE PAINT ───────────────────────────────────────────────────────────── */
const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0')}`;
function shade(n, k) {
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function frame(ctx, W, H, bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
function bar(ctx, W, H, s, y, colour, size = 22, align = 'left') {
  ctx.fillStyle = colour; ctx.fillRect(0, y, W, size + 14);
  ctx.fillStyle = '#0b0c10'; ctx.font = `bold ${size}px monospace`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(String(s).slice(0, 44), align === 'left' ? 16 : W / 2, y + (size + 14) / 2);
}
function text(ctx, x, y, s, size, colour, align = 'left', bold = true) {
  ctx.fillStyle = colour; ctx.font = `${bold ? 'bold ' : ''}${size}px monospace`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(String(s), x, y);
}
/** Word-wrapped lines, by character count so the stub canvas agrees with a real one. */
function wrap(s, width) {
  const out = []; let line = '';
  for (const w of String(s).split(' ')) {
    if ((line + ' ' + w).trim().length > width) { if (line) out.push(line); line = w; }
    else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out;
}
function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }

/**
 * THE PORTRAIT — cel-shaded, two-dimensional, the species' own head.
 *
 * `who` is a `StationCast.resident()`. The head is an outline the species
 * shapes (the Minbari bone crest, the Narn's heavy jaw, the Centauri crest
 * fan, the Pak'ma'ra's tentacles, the Vree's mask, the Gaim's helmet), filled
 * with the species' own skin colour off `SPECIES.row.skin`, a flat shadow
 * down one side and a flat light on the other, and a black line round it —
 * three tones and an ink line is the cel. Hair where the species grows it, a
 * beard on a human who has one, a collar in the species' robe colour.
 */
export function portrait(ctx, x, y, r, who, { talking = false, t = 0 } = {}) {
  const S = SPECIES_BY.get(who?.species) || SPECIES_BY.get('human');
  const row = S.row, look = who?.look || {};
  const skin = row.skin ?? 0xc79a76;
  const face = look.face || {};
  const jaw = 1 + (row.face?.jaw || 0) * 0.25 + (face.jaw || 0) * 0.15;
  const skull = 1 + (row.face?.skull || 0) * 0.2 + (face.skull || 0) * 0.15;
  const rw = r * 0.78 * skull, rh = r;
  const head = S.key === 'minbari'
    ? [[x - rw, y], [x - rw * 0.9, y - rh * 0.5], [x - rw * 0.55, y - rh * 0.95], [x, y - rh * 1.05], [x + rw * 0.55, y - rh * 0.95], [x + rw * 0.9, y - rh * 0.5], [x + rw, y], [x + rw * 0.75 * jaw, y + rh * 0.6], [x + rw * 0.4 * jaw, y + rh * 0.98], [x, y + rh * 1.05], [x - rw * 0.4 * jaw, y + rh * 0.98], [x - rw * 0.75 * jaw, y + rh * 0.6]]
    : S.key === 'vree' || S.key === 'gaim'
      ? [[x - rw * 0.9, y - rh * 0.4], [x, y - rh * 1.02], [x + rw * 0.9, y - rh * 0.4], [x + rw * 0.7, y + rh * 0.5], [x, y + rh * 1.1], [x - rw * 0.7, y + rh * 0.5]]
      : [[x - rw, y - rh * 0.1], [x - rw * 0.85, y - rh * 0.65], [x - rw * 0.45, y - rh], [x + rw * 0.45, y - rh], [x + rw * 0.85, y - rh * 0.65], [x + rw, y - rh * 0.1], [x + rw * 0.8 * jaw, y + rh * 0.55], [x + rw * 0.45 * jaw, y + rh * 0.95], [x, y + rh * 1.02], [x - rw * 0.45 * jaw, y + rh * 0.95], [x - rw * 0.8 * jaw, y + rh * 0.55]];
  /* the collar and shoulders, under the head */
  const robe = S.robe?.outer ?? 0x4a5462;
  poly(ctx, [[x - r * 1.9, y + r * 2.2], [x - r * 1.4, y + r * 1.15], [x - r * 0.5, y + r * 0.85], [x + r * 0.5, y + r * 0.85], [x + r * 1.4, y + r * 1.15], [x + r * 1.9, y + r * 2.2]]);
  ctx.fillStyle = hex(robe); ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
  poly(ctx, [[x - r * 0.5, y + r * 0.85], [x, y + r * 1.4], [x + r * 0.5, y + r * 0.85]]);
  ctx.fillStyle = hex(S.robe?.inner ?? 0x8792a2); ctx.fill(); ctx.stroke();
  /* neck */
  ctx.fillStyle = shade(skin, -0.25); ctx.fillRect(x - r * 0.28, y + r * 0.7, r * 0.56, r * 0.4);
  /* the head: base, shadow, light, ink */
  poly(ctx, head); ctx.fillStyle = hex(skin); ctx.fill();
  ctx.save(); poly(ctx, head); ctx.clip();
  ctx.fillStyle = shade(skin, -0.3); ctx.fillRect(x + rw * 0.35, y - rh * 1.2, rw, rh * 2.6);
  ctx.fillStyle = shade(skin, 0.18); ctx.fillRect(x - rw * 1.2, y - rh * 1.2, rw * 0.6, rh * 2.6);
  if (row.dapple) { ctx.fillStyle = shade(skin, -0.45); for (let i = 0; i < 14; i++) { const u = hashF(`${who.seed}:dap:${i}`); ctx.fillRect(x - rw + u * rw * 2, y - rh + hashF(`${who.seed}:dap2:${i}`) * rh * 2, 4, 4); } }
  ctx.restore();
  poly(ctx, head); ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
  /* species dressings */
  if (S.key === 'minbari') { poly(ctx, [[x - rw * 0.9, y - rh * 0.5], [x, y - rh * 1.35], [x + rw * 0.9, y - rh * 0.5], [x, y - rh * 0.7]]); ctx.fillStyle = shade(skin, 0.3); ctx.fill(); ctx.stroke(); }
  if (S.key === 'centauri' && look.hair === 'crest') { poly(ctx, [[x - rw * 1.3, y - rh * 0.4], [x - rw * 0.8, y - rh * 1.5], [x, y - rh * 1.7], [x + rw * 0.8, y - rh * 1.5], [x + rw * 1.3, y - rh * 0.4], [x + rw * 0.6, y - rh * 0.9], [x - rw * 0.6, y - rh * 0.9]]); ctx.fillStyle = '#2a2320'; ctx.fill(); ctx.stroke(); }
  if (S.key === 'pakmara') for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x + i * rw * 0.35, y + rh * 0.55); ctx.quadraticCurveTo(x + i * rw * 0.5, y + rh * 1.3, x + i * rw * 0.7, y + rh * 1.6); ctx.lineWidth = 8; ctx.strokeStyle = shade(skin, -0.2); ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = '#111'; }
  if (row.hair && look.hair && look.hair !== 'shorn' && look.hair !== 'crest') {
    const long = look.hair === 'long' || look.hair === 'mane' || look.hair === 'tail';
    poly(ctx, long
      ? [[x - rw * 1.05, y + rh * 0.6], [x - rw * 1.0, y - rh * 0.6], [x - rw * 0.5, y - rh * 1.15], [x + rw * 0.5, y - rh * 1.15], [x + rw * 1.0, y - rh * 0.6], [x + rw * 1.05, y + rh * 0.6], [x + rw * 0.85, y - rh * 0.2], [x, y - rh * 0.75], [x - rw * 0.85, y - rh * 0.2]]
      : [[x - rw * 0.95, y - rh * 0.3], [x - rw * 0.7, y - rh * 1.1], [x, y - rh * 1.2], [x + rw * 0.7, y - rh * 1.1], [x + rw * 0.95, y - rh * 0.3], [x + rw * 0.75, y - rh * 0.55], [x, y - rh * 0.8], [x - rw * 0.75, y - rh * 0.55]]);
    ctx.fillStyle = `hsl(${Math.floor(hashF(`${who.seed}:hair`) * 40 + 10)}, 35%, ${18 + Math.floor(look.age * 50)}%)`; ctx.fill(); ctx.stroke();
  }
  if (look.beard && look.beard !== 'none') { poly(ctx, [[x - rw * 0.7 * jaw, y + rh * 0.4], [x - rw * 0.45 * jaw, y + rh * 1.05], [x + rw * 0.45 * jaw, y + rh * 1.05], [x + rw * 0.7 * jaw, y + rh * 0.4], [x, y + rh * 0.6]]); ctx.fillStyle = `hsl(20, 30%, ${18 + Math.floor(look.age * 50)}%)`; ctx.fill(); ctx.stroke(); }
  /* eyes, brows, mouth */
  const eyeY = y - rh * 0.12 + (face.eyes || 0) * rh * 0.1;
  if (row.eyes !== false) {
    ctx.fillStyle = hex(row.sclera ?? 0xece7dd);
    ctx.beginPath(); ctx.ellipse(x - rw * 0.38, eyeY, rw * 0.17, rh * 0.09, 0, 0, Math.PI * 2); ctx.ellipse(x + rw * 0.38, eyeY, rw * 0.17, rh * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hex(row.eye ?? 0x2c1d12);
    ctx.beginPath(); ctx.arc(x - rw * 0.36, eyeY, rw * 0.07, 0, Math.PI * 2); ctx.arc(x + rw * 0.4, eyeY, rw * 0.07, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#111';
    ctx.beginPath(); ctx.ellipse(x - rw * 0.38, eyeY, rw * 0.17, rh * 0.09, 0, 0, Math.PI * 2); ctx.ellipse(x + rw * 0.38, eyeY, rw * 0.17, rh * 0.09, 0, 0, Math.PI * 2); ctx.stroke();
  } else { ctx.fillStyle = hex(row.eye ?? 0xff8a2a); ctx.beginPath(); ctx.arc(x - rw * 0.35, eyeY, rw * 0.14, 0, Math.PI * 2); ctx.arc(x + rw * 0.35, eyeY, rw * 0.14, 0, Math.PI * 2); ctx.fill(); }
  if (row.brows !== false) { ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - rw * 0.58, eyeY - rh * 0.2); ctx.lineTo(x - rw * 0.2, eyeY - rh * 0.24); ctx.moveTo(x + rw * 0.2, eyeY - rh * 0.24); ctx.lineTo(x + rw * 0.58, eyeY - rh * 0.2); ctx.stroke(); }
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, eyeY + rh * 0.1); ctx.lineTo(x + rw * 0.08 * (1 + (face.nose || 0)), eyeY + rh * 0.42); ctx.lineTo(x - rw * 0.05, eyeY + rh * 0.44); ctx.stroke();
  if (row.mouth !== false) {
    const open = talking && Math.floor(t * 6) % 2 === 0;
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(x, y + rh * 0.55, rw * 0.28, open ? rh * 0.12 : rh * 0.025, 0, 0, Math.PI * 2); ctx.fill();
  }
}

/** The channel bug: top right, on everything. */
function bug(ctx, W, kind) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(W - 128, 8, 120, 26);
  ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(W - 112, 21, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0b0c10'; ctx.beginPath(); ctx.arc(W - 112, 21, 3.5, 0, Math.PI * 2); ctx.fill();
  text(ctx, W - 98, 21, `HOLONET·${String(kind).toUpperCase()}`, 11, '#ffd27a');
}
function clock(ctx, hour) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(8, 8, 58, 22);
  text(ctx, 14, 19, hh(hour), 13, '#ffffff');
}
function ticker(ctx, W, H, s, t, bg = '#ffd27a', fg = '#0b0c10') {
  ctx.fillStyle = bg; ctx.fillRect(0, H - 30, W, 30);
  ctx.save(); ctx.beginPath(); ctx.rect(0, H - 30, W, 30); ctx.clip();
  ctx.font = 'bold 15px monospace';
  const w = Math.max(ctx.measureText(s).width || 0, s.length * 9) + 80;
  const off = (t * 60) % w;
  text(ctx, W - off, H - 15, s, 15, fg);
  text(ctx, W - off + w, H - 15, s, 15, fg);
  ctx.restore();
}
function lowerThird(ctx, W, y, head, sub) {
  ctx.fillStyle = 'rgba(7,10,18,0.85)'; ctx.fillRect(16, y, W - 32, 58);
  ctx.fillStyle = '#ffd27a'; ctx.fillRect(16, y, 6, 58);
  text(ctx, 34, y + 18, head, 14, '#ffd27a');
  text(ctx, 34, y + 40, sub, 12, '#e8eefc', 'left', false);
}

/* ── THE PROGRAMMES ──────────────────────────────────────────────────────── */
function paintNews(ctx, W, H, world, P, cut, t, day, hour) {
  const name = stationName();
  const A = anchorFor(name);
  const N = newsAt(world, P, cut, day, hour);
  /* the studio: a dark blue wall, a window on the orbit, a lit strip */
  frame(ctx, W, H, '#0e1420');
  ctx.fillStyle = '#16213a'; ctx.fillRect(0, 0, W, H * 0.66);
  ctx.fillStyle = '#0a1226'; ctx.fillRect(W * 0.46, 26, W * 0.5, 120);
  ctx.fillStyle = `hsl(${Math.floor(hashF(`${P.seed}:planet`) * 360)}, 40%, 40%)`; ctx.beginPath(); ctx.arc(W * 0.86, 100, 46, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4d6b8f'; ctx.lineWidth = 2; ctx.strokeRect(W * 0.46, 26, W * 0.5, 120);
  ctx.fillStyle = '#ffd27a'; ctx.fillRect(0, H * 0.66 - 4, W, 4);
  /* the desk */
  ctx.fillStyle = '#2a3550'; ctx.fillRect(0, H * 0.66, W, H * 0.34);
  ctx.fillStyle = '#1c2438'; ctx.fillRect(0, H * 0.66, W, 10);
  /* the anchor, talking on the cuts that read */
  portrait(ctx, 108, 112, 46, A, { talking: (cut % 3) !== 2, t });
  /* the headline card */
  const lines = wrap(N.head.toUpperCase(), 26).slice(0, 3);
  ctx.fillStyle = 'rgba(7,10,18,0.7)'; ctx.fillRect(W * 0.46, 152, W * 0.5, 22 + lines.length * 22);
  lines.forEach((l, i) => text(ctx, W * 0.46 + 10, 166 + i * 22, l, 15, '#ffffff'));
  lowerThird(ctx, W, H * 0.68, `${A.name.toUpperCase()} · ${A.species.toUpperCase()}`, String(N.sub).slice(0, 62));
  ticker(ctx, W, H, N.ticker, t);
}

function paintOrbit(ctx, W, H, world, P, cut, t, day, hour) {
  const L = outsideLevel(world);
  const B = deckBattleState(world);
  const name = stationName();
  frame(ctx, W, H, '#070a12');
  const u = hashF(`${P.seed}:o`);
  for (let i = 0; i < 40; i++) { ctx.fillStyle = '#c9d6ff'; ctx.fillRect(hashF(`${P.seed}:s:${i}`) * W, hashF(`${P.seed}:s2:${i}`) * H, 2, 2); }
  ctx.fillStyle = `hsl(${(u * 360) | 0}, 40%, 42%)`; ctx.beginPath(); ctx.arc(W * 0.3, H * 0.52, 84, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(W * 0.3 + 20, H * 0.52, 84, -Math.PI / 2, Math.PI / 2); ctx.fill();
  ctx.strokeStyle = '#4d6b8f'; ctx.lineWidth = 2;
  for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.ellipse(W * 0.3, H * 0.52, 84 + i * 34, 26 + i * 12, -0.4, 0, Math.PI * 2); ctx.stroke(); }
  const n = B ? Math.min(12, B.shown || B.hulls || 0) : 0;
  for (let i = 0; i < n; i++) { const a = t * 0.4 + i * (Math.PI * 2 / Math.max(1, n)); ctx.fillStyle = i % 2 ? '#ff7a5a' : '#7fc4ff'; ctx.fillRect(W * 0.3 + Math.cos(a) * 152 - 2, H * 0.52 + Math.sin(a) * 50 - 2, 5, 5); }
  ctx.fillStyle = '#ffd27a'; const a = t * 0.6 + u * 6; ctx.beginPath(); ctx.arc(W * 0.3 + Math.cos(a) * 118, H * 0.52 + Math.sin(a) * 38, 5, 0, Math.PI * 2); ctx.fill();
  /* the chart */
  ctx.fillStyle = 'rgba(7,10,18,0.75)'; ctx.fillRect(W * 0.56, 44, W * 0.42, 190);
  ctx.strokeStyle = '#7fc4ff'; ctx.strokeRect(W * 0.56, 44, W * 0.42, 190);
  text(ctx, W * 0.58, 66, (L?.name || 'THE LINE').toUpperCase().slice(0, 18), 18, '#ffffff');
  text(ctx, W * 0.58, 94, `ORBIT · ${pick(WORDS.weather, hashF(`${P.seed}:w:${cut}`)).toUpperCase()} · ${weatherAt(day, L?.name || 'the line').line.toUpperCase()}`, 13, '#9fd0ff', 'left', false);
  text(ctx, W * 0.58, 118, B ? `FLEET · ${B.hulls} HULLS · ${B.shown} IN VIEW` : 'FLEET · NONE IN THE WINDOW', 13, '#9fd0ff', 'left', false);
  text(ctx, W * 0.58, 142, B ? `PHASE · ${String(B.phase || '').toUpperCase()} · ROUND ${B.round ?? 0}` : 'THE TOWER REPORTS QUIET', 13, '#9fd0ff', 'left', false);
  text(ctx, W * 0.58, 166, B ? `${B.fighters | 0} FIGHTERS · ${B.bolts | 0} BOLTS` : `${name.toUpperCase()} · DAY ${day + 1}`, 13, '#9fd0ff', 'left', false);
  text(ctx, W * 0.58, 190, `${hh(hour)} STATION · DAY ${day + 1}`, 13, '#ffd27a', 'left', false);
  const bars = 8; for (let i = 0; i < bars; i++) { const v = hashF(`${P.seed}:bar:${i}:${cut}`); ctx.fillStyle = i === cut % bars ? '#ffd27a' : '#2b4a6b'; ctx.fillRect(W * 0.58 + i * 22, 224 - v * 20, 16, v * 20); }
  bar(ctx, W, H, `HOLONET · ORBIT · ${(L?.name || 'the line').toUpperCase()}`, H - 34, '#7fc4ff', 14);
}

function paintAdverts(ctx, W, H, P, cut, t, day) {
  const A = advertOf(P, cut, day);
  const h2 = hashF(`${P.seed}:ac:${cut}`) * 360;
  frame(ctx, W, H, `hsl(${h2 | 0}, 55%, 28%)`);
  /* rays behind the hero */
  ctx.fillStyle = `hsl(${h2 | 0}, 60%, 34%)`;
  for (let i = 0; i < 12; i++) { const a0 = i * Math.PI / 6 + t * 0.2, a1 = a0 + Math.PI / 12; poly(ctx, [[W * 0.26, H * 0.48], [W * 0.26 + Math.cos(a0) * 400, H * 0.48 + Math.sin(a0) * 400], [W * 0.26 + Math.cos(a1) * 400, H * 0.48 + Math.sin(a1) * 400]]); ctx.fill(); }
  /* the product: a shape per counter */
  const cx = W * 0.26, cy = H * 0.48 + Math.sin(t * 2) * 4;
  ctx.strokeStyle = '#111'; ctx.lineWidth = 4;
  ctx.fillStyle = `hsl(${(h2 + 40) | 0}, 70%, 60%)`;
  if (/cloth/i.test(A.id)) { poly(ctx, [[cx - 50, cy - 40], [cx - 20, cy - 55], [cx + 20, cy - 55], [cx + 50, cy - 40], [cx + 60, cy - 10], [cx + 40, cy], [cx + 40, cy + 60], [cx - 40, cy + 60], [cx - 40, cy], [cx - 60, cy - 10]]); }
  else if (/armour/i.test(A.id)) { poly(ctx, [[cx - 45, cy - 50], [cx + 45, cy - 50], [cx + 55, cy], [cx + 30, cy + 60], [cx - 30, cy + 60], [cx - 55, cy]]); }
  else if (/food|fresh|market/i.test(A.id)) { ctx.beginPath(); ctx.arc(cx, cy, 52, 0, Math.PI * 2); }
  else { ctx.beginPath(); ctx.rect(cx - 45, cy - 45, 90, 90); }
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(cx - 18, cy - 18, 12, 0, Math.PI * 2); ctx.fill();
  /* the copy */
  ctx.fillStyle = 'rgba(7,10,18,0.55)'; ctx.fillRect(W * 0.5, 40, W * 0.47, 150);
  wrap(A.item.toUpperCase(), 18).slice(0, 2).forEach((l, i) => text(ctx, W * 0.52, 66 + i * 24, l, 20, '#ffffff'));
  text(ctx, W * 0.52, 124, A.price || 'ASK AT THE COUNTER', 26, '#ffd27a');
  text(ctx, W * 0.52, 160, A.line.slice(0, 34), 12, '#f4f4f4', 'left', false);
  /* the burst */
  ctx.fillStyle = '#ffd27a'; ctx.beginPath(); for (let i = 0; i < 16; i++) { const rr = i % 2 ? 22 : 34, a = i * Math.PI / 8; ctx.lineTo(W * 0.9 + Math.cos(a) * rr, 216 + Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
  text(ctx, W * 0.9, 216, A.shelf ? `${A.shelf} ON` : 'NEW', 11, '#0b0c10', 'center');
  bar(ctx, W, H, `${A.counter.toUpperCase()} · TODAY'S SHELF`, H - 40, '#ffffff', 16);
}

function paintTalk(ctx, W, H, P, cut, t, day) {
  const T = talkOf(P, cut, day);
  frame(ctx, W, H, '#1a1410');
  ctx.fillStyle = '#26201a'; ctx.fillRect(0, 0, W, H * 0.6);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#2e2620' : '#221c17'; ctx.fillRect(i * (W / 6), 0, W / 6, H * 0.6); }
  ctx.fillStyle = '#c9a86a'; ctx.fillRect(0, H * 0.6 - 3, W, 3);
  ctx.fillStyle = '#3a2f24'; ctx.fillRect(0, H * 0.6, W, H * 0.4);
  const hostTalks = T.speaker === T.host, guestTalks = T.speaker === T.guest;
  portrait(ctx, W * 0.26, H * 0.36, 44, T.host, { talking: hostTalks, t });
  portrait(ctx, W * 0.74, H * 0.36, 44, T.guest, { talking: guestTalks, t });
  text(ctx, W * 0.26, H * 0.6 + 16, T.host.name.toUpperCase(), 12, hostTalks ? '#ffd27a' : '#c9a86a', 'center');
  text(ctx, W * 0.74, H * 0.6 + 16, `${T.guest.name.toUpperCase()} · ${T.guest.species.toUpperCase()}`, 12, guestTalks ? '#ffd27a' : '#c9a86a', 'center');
  /* the speech card, on the speaker's side */
  const sx = hostTalks ? 16 : W * 0.5 - 8;
  ctx.fillStyle = '#f4efe6'; ctx.fillRect(sx, H * 0.7, W * 0.5 - 8, 52);
  poly(ctx, [[hostTalks ? W * 0.26 - 10 : W * 0.74 - 10, H * 0.7], [hostTalks ? W * 0.26 + 10 : W * 0.74 + 10, H * 0.7], [hostTalks ? W * 0.26 : W * 0.74, H * 0.7 - 12]]); ctx.fill();
  wrap(String(T.line), 34).slice(0, 2).forEach((l, i) => text(ctx, sx + 10, H * 0.7 + 18 + i * 18, l, 12, '#111', 'left', false));
  bar(ctx, W, H, `LATE, ${T.topic.toUpperCase()} · WITH ${T.host.name.toUpperCase()}`, H - 26, '#c9a86a', 12);
}

function paintSport(ctx, W, H, world, P, cut, t, day, hour) {
  const S = sportOf(world, day, hour);
  frame(ctx, W, H, '#0b1a12');
  ctx.fillStyle = '#10261b'; for (let i = 0; i < 8; i++) ctx.fillRect(0, 40 + i * 30, W, 15);
  bar(ctx, W, H, 'HOLONET · SPORT · THE TOTE', 0, '#7fffb0', 16);
  if (!S) { text(ctx, W / 2, H / 2, 'NO CARD TONIGHT', 22, '#ffffff', 'center'); }
  else {
    text(ctx, 16, 58, S.name.toUpperCase().slice(0, 30), 18, '#ffffff');
    if (S.phase === 'running') {
      ctx.fillStyle = '#1c3a2a'; ctx.fillRect(16, 76, W - 32, 14);
      ctx.fillStyle = '#7fffb0'; ctx.fillRect(16, 76, (W - 32) * Math.min(1, S.progress), 14);
      text(ctx, W - 20, 83, 'LIVE', 11, '#ff7a5a', 'right');
      S.standings.slice(0, 5).forEach((s, i) => {
        ctx.fillStyle = i === 0 ? '#ffd27a' : '#2a5a40'; ctx.fillRect(16, 100 + i * 24, 26, 20);
        text(ctx, 29, 110 + i * 24, String(i + 1), 13, '#0b0c10', 'center');
        text(ctx, 52, 110 + i * 24, String(s.name).toUpperCase().slice(0, 22), 14, '#e8ffef');
        ctx.fillStyle = '#3a7a55'; ctx.fillRect(300, 104 + i * 24, Math.max(4, (W - 320) * (1 - i * 0.15) * Math.min(1, S.progress)), 12);
      });
      if (S.calls.length) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(16, H - 62, W - 32, 26); text(ctx, 24, H - 49, String(S.calls[S.calls.length - 1]).slice(0, 56), 12, '#9fd0ff', 'left', false); }
    } else if (S.phase === 'called' && S.winner) {
      text(ctx, 16, 96, `WON BY ${S.winner.toUpperCase()}`, 24, '#ffd27a');
      S.standings.slice(0, 4).forEach((s, i) => text(ctx, 16, 134 + i * 24, `${i + 1}. ${String(s.name).toUpperCase()}`, 14, '#e8ffef', 'left', false));
    } else {
      text(ctx, 16, 96, S.phase === 'parading' ? 'THE FIELD IS PARADING' : S.next ? `NEXT OFF AT ${hh(S.next.hour)}` : 'NEXT CARD AT THE HOLO-THEATRE', 16, '#e8ffef', 'left', false);
      S.standings.slice(0, 6).forEach((s, i) => text(ctx, 16, 128 + i * 22, String(s.name).toUpperCase(), 13, '#9fd0ff', 'left', false));
    }
  }
  ticker(ctx, W, H, S ? `${S.name.toUpperCase()} · ${String(S.phase || '').toUpperCase()}${S.winner ? ` · WON BY ${S.winner.toUpperCase()}` : ''}${S.next ? ` · NEXT ${hh(S.next.hour)}` : ''}` : 'THE TOTE IS CLOSED', t, '#7fffb0');
}

/**
 * THE DRUM, LIVE. The wheel is `Games.DRUM.SEGMENTS`, twenty of them, two the
 * house's. Where it stands is `drumAt(hour, day)` — a pure function of the
 * station clock, so the screen in the cantina and the wheel in the Wheelhouse
 * cannot disagree. At the top of the hour it SPINS DOWN onto this hour's stop
 * over the first minutes, driven by the station clock (not real time), so
 * walking in halfway sees it halfway.
 */
export function drumAngle(hour, day) {
  const D = drumOf(day, hour);
  const n = DRUM.SEGMENTS.length;
  const seg = Math.PI * 2 / n;
  const target = -D.at * seg;
  const m = (hour % 1) * 60;
  if (m >= DRUM_MIN) return { angle: target, spinning: false, D };
  /* four full turns eased out over the live minutes, landing on the stop */
  const k = 1 - m / DRUM_MIN;
  const ease = k * k * k;
  return { angle: target - ease * Math.PI * 2 * 4, spinning: ease > 0.002, D };
}

function paintDrum(ctx, W, H, P, cut, t, day, hour) {
  const { angle, spinning, D } = drumAngle(hour, day);
  frame(ctx, W, H, '#140c10');
  ctx.fillStyle = '#1e1218'; ctx.fillRect(0, 0, W, H * 0.86);
  for (let i = 0; i < 20; i++) { ctx.fillStyle = 'rgba(255,210,122,0.06)'; ctx.fillRect(hashF(`drum:l:${i}`) * W, hashF(`drum:l2:${i}`) * H * 0.8, 3, 3); }
  const cx = W * 0.32, cy = H * 0.5, R = 108;
  const n = DRUM.SEGMENTS.length, seg = Math.PI * 2 / n;
  const BAND = ['#7fc4ff', '#7fffb0', '#ff7a5a'];
  for (let i = 0; i < n; i++) {
    const v = DRUM.SEGMENTS[i];
    const a0 = -Math.PI / 2 + angle + i * seg - seg / 2, a1 = a0 + seg;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
    const base = v === null ? '#111111' : BAND[DRUM.BANDS.findIndex((b) => b.includes(v))] || '#666666';
    ctx.fillStyle = (i % 2 && v !== null) ? shade(parseInt(base.slice(1), 16), -0.3) : base;
    ctx.fill(); ctx.strokeStyle = '#0b0c10'; ctx.lineWidth = 2; ctx.stroke();
    const am = a0 + seg / 2;
    text(ctx, cx + Math.cos(am) * R * 0.78, cy + Math.sin(am) * R * 0.78, v === null ? '·' : String(v), 12, v === null ? '#ffd27a' : '#0b0c10', 'center');
  }
  ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#0b0c10'; ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, R + 4, 0, Math.PI * 2); ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 4; ctx.stroke();
  /* the pointer, at the top */
  poly(ctx, [[cx - 12, cy - R - 16], [cx + 12, cy - R - 16], [cx, cy - R + 10]]); ctx.fillStyle = '#ff7a5a'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
  /* the board */
  ctx.fillStyle = 'rgba(7,10,18,0.75)'; ctx.fillRect(W * 0.6, 40, W * 0.38, 200);
  ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 1; ctx.strokeRect(W * 0.6, 40, W * 0.38, 200);
  text(ctx, W * 0.62, 60, 'THE DRUM · WHEELHOUSE', 13, '#ffd27a');
  text(ctx, W * 0.62, 84, spinning ? 'SPINNING' : (D.house ? 'THE HOUSE' : `DECK ${D.deck}`), 22, spinning ? '#ff7a5a' : '#ffffff');
  text(ctx, W * 0.62, 108, spinning ? `TURN ${hh(Math.floor(hour))}` : `STOPPED ${hh(Math.floor(hour))}`, 12, '#9fd0ff', 'left', false);
  text(ctx, W * 0.62, 128, `NEXT TURN ${hh(D.nextAt)} · IN ${Math.max(1, Math.ceil(D.nextIn * 60))} MIN`, 12, '#9fd0ff', 'left', false);
  text(ctx, W * 0.62, 152, 'LAST SIX', 11, '#ffd27a');
  D.prev.slice(0, 6).forEach((p, i) => {
    ctx.fillStyle = p.deck === null ? '#111' : BAND[DRUM.BANDS.findIndex((b) => b.includes(p.deck))] || '#666';
    ctx.fillRect(W * 0.62 + i * 30, 162, 26, 20); ctx.strokeStyle = '#0b0c10'; ctx.strokeRect(W * 0.62 + i * 30, 162, 26, 20);
    text(ctx, W * 0.62 + i * 30 + 13, 172, p.deck === null ? '·' : String(p.deck), 11, p.deck === null ? '#ffd27a' : '#0b0c10', 'center');
  });
  /* the caption cycles the bets, one per cut */
  const caps = [`DECK PAYS ×${D.pays.deck}`, `BAND PAYS ×${D.pays.band}`, `SPINE PAYS ×${D.pays.spine}`, 'TWO HOUSE SEGMENTS · NOBODY WINS', 'A TICKET RIDES THE NEXT TURN'];
  text(ctx, W * 0.62, 200, caps[cut % caps.length], 10, '#e8eefc', 'left', false);
  /* the live lamp blinks */
  ctx.fillStyle = Math.floor(t * 2) % 2 ? '#ff7a5a' : '#5a2a20'; ctx.beginPath(); ctx.arc(W * 0.95, 60, 5, 0, Math.PI * 2); ctx.fill();
  text(ctx, W * 0.62, 222, `STATION CLOCK ${hh(hour)}`, 13, '#ffffff');
  bar(ctx, W, H, isSmallHours(hour) ? 'THE DRUM · THROUGH THE NIGHT' : 'THE DRUM · ON THE HOUR, LIVE', H - 34, '#ffd27a', 14);
}

function paintIdent(ctx, W, H, P, t, hour) {
  const name = stationName();
  const hue = hashF(P.seed) * 360;
  frame(ctx, W, H, '#101318');
  if (isTestCard(hour)) {
    const bars = ['#ffffff', '#ffd27a', '#7fffb0', '#7fc4ff', '#ff7a5a', '#b48cff', '#3a3f4a'];
    bars.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * (W / 7), 0, W / 7 + 1, H * 0.5); });
    /* the grey scale under the colour bars, and the tone circle */
    for (let i = 0; i < 7; i++) { const v = Math.round(255 * (i / 6)); ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(i * (W / 7), H * 0.5, W / 7 + 1, H * 0.1); }
    ctx.strokeStyle = '#0b0c10'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(W / 2, H * 0.3, 70, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = Math.floor(t) % 2 ? '#0b0c10' : '#ffffff'; ctx.fillRect(W / 2 - 6, H * 0.3 - 6, 12, 12);
    ctx.fillStyle = '#0b0c10'; ctx.fillRect(W / 2 - 90, H * 0.6 - 26, 180, 26);
    text(ctx, W / 2, H * 0.6 - 13, 'TEST CARD', 13, '#ffffff', 'center');
    text(ctx, W / 2, H * 0.74, `HOLONET · ${name.toUpperCase()}`, 22, '#ffffff', 'center');
    text(ctx, W / 2, H * 0.88, 'PROGRAMMES RESUME AT 05:00', 14, '#9fd0ff', 'center', false);
  } else {
    ctx.fillStyle = `hsl(${hue | 0}, 40%, 22%)`; ctx.fillRect(0, 0, W, H * 0.6);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; for (let i = 0; i < 6; i++) ctx.fillRect(i * (W / 6) + ((t * 20) % (W / 6)), 0, 3, H * 0.6);
    ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(W / 2, H * 0.3, 40 + Math.sin(t * 2) * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#101318'; ctx.beginPath(); ctx.arc(W / 2, H * 0.3, 20, 0, Math.PI * 2); ctx.fill();
    /* the station's ring: twelve ticks turning with the hour hand */
    ctx.strokeStyle = 'rgba(255,210,122,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, H * 0.3, 62, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6 + t * 0.3; ctx.fillStyle = i === Math.floor(hour) % 12 ? '#ffffff' : '#ffd27a'; ctx.fillRect(W / 2 + Math.cos(a) * 62 - 2, H * 0.3 + Math.sin(a) * 62 - 2, 4, 4); }
    text(ctx, W / 2, H * 0.74, `HOLONET · ${name.toUpperCase()}`, 22, '#ffffff', 'center');
    text(ctx, W / 2, H * 0.88, `${name.toUpperCase()}'S OWN CHANNEL · STAY WITH US`, 13, '#9fd0ff', 'center', false);
  }
}

export function paintProgramme(ctx, W, H, world, P, cut, t, day, hour) {
  if (!ctx) return false;
  const d = day | 0, h = ((Number(hour) || 0) % 24 + 24) % 24;
  switch (P.kind) {
    case 'news': paintNews(ctx, W, H, world, P, cut, t, d, h); break;
    case 'orbit': paintOrbit(ctx, W, H, world, P, cut, t, d, h); break;
    case 'adverts': paintAdverts(ctx, W, H, P, cut, t, d); break;
    case 'talk': paintTalk(ctx, W, H, P, cut, t, d); break;
    case 'sport': paintSport(ctx, W, H, world, P, cut, t, d, h); break;
    case 'drum': paintDrum(ctx, W, H, P, cut, t, d, h); break;
    default: paintIdent(ctx, W, H, P, t, h);
  }
  clock(ctx, h);
  bug(ctx, W, P.kind);
  return true;
}

/* ── THE SCREENS ─────────────────────────────────────────────────────────── */
export function dressTV(world, st) {
  const list = st?.tvs;
  if (!world || !list || !list.length) return 0;
  let made = 0;
  for (const tv of list) {
    if (tv.mesh) continue;
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (canvas) { canvas.width = TV_W; canvas.height = TV_H; }
    const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
    if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; }
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x9fd0ff, toneMapped: false });
    mat.name = `station-sign-tv${tv.id}`;
    mat.userData.key = 'sign';
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(tv.w, tv.h), mat);
    mesh.name = `station-tv-${tv.id}`;
    const c = Math.cos(tv.yaw), s = Math.sin(tv.yaw);
    mesh.position.set(tv.x + tv.at.x * c + tv.at.z * s, tv.y + tv.at.y, tv.z - tv.at.x * s + tv.at.z * c);
    mesh.rotation.y = tv.yaw + (tv.at.ry || 0);
    (tv.group || world.scene).add(mesh);
    tv.mesh = mesh; tv.canvas = canvas; tv.texture = tex; tv.material = mat; tv.frames = 0;
    st.draws += 1;
    made++;
  }
  return made;
}

export function stepTV(world, st, dt) {
  const list = st?.tvs;
  if (!list || !list.length || !(dt > 0)) return 0;
  st.tvT = (st.tvT || 0) + dt;
  st.tvIn = (st.tvIn ?? 0) - dt;
  if (st.tvIn > 0) return 0;
  st.tvIn = 1 / FPS;
  const p = world.player?.position;
  const day = st.day | 0, hour = st.hour ?? 12;
  const P = programmeAt(day, hour);
  const cut = Math.floor(st.tvT / CUT_EVERY);
  st.tvOn = P;
  let painted = 0;
  for (const tv of list) {
    if (!tv.mesh || (tv.group && !tv.group.visible)) continue;
    const near = p ? Math.hypot(p.x - tv.mesh.position.x, p.z - tv.mesh.position.z) < NEAR : true;
    if (!near) continue;
    const ctx = tv.canvas?.getContext?.('2d');
    if (!ctx) continue;
    paintProgramme(ctx, TV_W, TV_H, world, P, cut, st.tvT, day, hour);
    if (tv.texture) tv.texture.needsUpdate = true;
    tv.frames++;
    painted++;
  }
  return painted;
}
