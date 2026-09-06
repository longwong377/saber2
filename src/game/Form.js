/**
 * ══════════════════════════════════════════════════════════════════════════
 *  FORM — the reading room's own odds, printed for every runner (V18 hole 10)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The tote's board (`Tote.boardFor`) is the HOUSE'S price: the engine's model
 * with the skin's take folded in. What the reading room prints is a different
 * thing — a punter's book, read off nothing but the public form line — and
 * until this file the room printed nothing at all.
 *
 * Everything here is derived from `entrant.form.recent`, which the tote's own
 * replay (`walkVenue` → `resultOf` → `Spectacle.recordResult`) fills in from
 * the last `FORM_DAYS` days of that venue's cards. So a runner's form IS its
 * last results, seeded, and the same on every machine.
 *
 *   `formOf`      the last five finishing positions, most recent first
 *   `oddsAt`      a book over the field: form → strength → probability →
 *                 price with a bookmaker's OVERROUND (the prices add to more
 *                 than 100%), drifting on a seeded step every 30 station-min
 *                 up to the off and frozen after it
 *   `formCards`   one card per race, which is what the board paints
 *   `priceAt`     one runner's printed price at an hour — what the window
 *                 writes on a win ticket and `Tote.settleTickets` pays at
 *
 * No `Math.random` (determinism.mjs): the drift is `makeRng` off the race id
 * and the half-hour slot.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { makeRng } from '../engine/MathUtil.js';
import { racesOn, makeYard, walkVenue, FORM_DAYS, ticketFor } from './Tote.js';

/** How many results a form line carries. */
export const FORM_N = 5;
/** The book's overround: the printed prices add to 112%. */
export const OVERROUND = 1.12;
/** Station hours between drifts of the price — 30 station-min. */
export const DRIFT_EVERY = 0.5;
/** How far one drift may move a runner's probability, either way. */
export const DRIFT = 0.07;
/** Floor on any printed price. */
export const MIN_PRICE = 1.05;

function hashOf(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const round2 = (v) => Math.round(v * 100) / 100;

/* THE DEEPER PAST, for a runner the tote's own window does not give five
 * starts to (the Arena's two-a-night bouts). A fresh yard is walked through
 * the `FORM_DAYS` before the tote's window — the same runners, the same seeds,
 * the same `resultOf` — and its form lines are read by runner id. Cached on
 * `(venue, day, window)`; a handful of entries at most. */
const DEEP = new Map();
const DEEP_KEEP = 12;
function deepRecent(venueId, day, back) {
  const key = `${venueId}:${day | 0}:${back}`;
  const hit = DEEP.get(key);
  if (hit) return hit;
  const yard = makeYard(venueId);
  for (const _ of walkVenue(venueId, { from: (day | 0) - FORM_DAYS * (back + 1), days: FORM_DAYS, book: yard })) { /* run */ }
  const map = new Map(yard.entrants.map((e) => [e.id, e.form.recent.slice()]));
  if (DEEP.size >= DEEP_KEEP) DEEP.delete(DEEP.keys().next().value);
  DEEP.set(key, map);
  return map;
}

/**
 * The last `FORM_N` finishes, most recent first. `race` lets a short line be
 * filled from the days before the tote's own window; without it, or when
 * there is nothing further back, `null` marks a start that never was.
 */
export function formOf(entrant, race = null) {
  const recent = Array.isArray(entrant?.form?.recent) ? entrant.form.recent.slice() : [];
  if (race?.venue && recent.length < FORM_N) {
    for (let back = 1; back <= 3 && recent.length < FORM_N; back++) {
      let older = null;
      try { older = deepRecent(race.venue, race.day, back).get(entrant.id) || []; } catch { older = []; }
      for (const p of older) { if (recent.length >= FORM_N) break; recent.push(p); }
    }
  }
  const out = [];
  for (let i = 0; i < FORM_N; i++) out.push(Number.isFinite(recent[i]) ? recent[i] : null);
  return out;
}

/** The form line as a board prints it: `1-3-2-5-1`, a dash for a missing start. */
export function formLine(entrant, race = null) {
  return formOf(entrant, race).map((p) => (p == null ? '–' : String(p))).join('-');
}

/* Most recent start weighs most. */
const WEIGHTS = [1.0, 0.8, 0.65, 0.5, 0.4];

/** A runner's strength off its form alone, in a field of `field` runners. */
export function strengthOf(entrant, field, race = null) {
  const n = Math.max(2, field | 0);
  const form = formOf(entrant, race);
  let acc = 0, w = 0;
  for (let i = 0; i < form.length; i++) {
    /* A finish is scored 1 for first down to 0 for last; no start reads as
     * the middle of the field, which is what a reader assumes of a stranger. */
    const s = form[i] == null ? 0.5 : Math.max(0, Math.min(1, (n - form[i]) / (n - 1)));
    acc += WEIGHTS[i] * s; w += WEIGHTS[i];
  }
  return Math.exp(2.4 * (acc / w));
}

/** The drift slot for an hour, frozen at the off. */
export function driftSlot(race, hour) {
  const h = Math.min(Number(hour) || 0, Number(race?.hour) || 0);
  return Math.floor(Math.max(0, h) / DRIFT_EVERY);
}

/**
 * THE BOOK ON ONE RACE AT AN HOUR. A row per runner: its form, its probability
 * and its printed price. `Σ 1/odds` is `OVERROUND` (to rounding).
 */
export function oddsAt(race, hour = 0) {
  const entrants = race?.card?.entrants || [];
  const field = entrants.length;
  if (!field) return [];
  const slot = driftSlot(race, hour);
  const rng = makeRng(hashOf(`form:drift:${race.id}:${slot}`));
  const raw = entrants.map((e) => strengthOf(e, field, race));
  const base = raw.reduce((a, b) => a + b, 0) || 1;
  /* The drift: every slot up to the off nudges each runner by a seeded factor
   * and the book is renormalised, so the overround holds while the prices
   * move. Slot 0 is the opening show and does not drift. */
  const p = raw.map((s) => {
    const k = slot > 0 ? 1 + (rng() * 2 - 1) * DRIFT : 1;
    return (s / base) * k;
  });
  const sum = p.reduce((a, b) => a + b, 0) || 1;
  return entrants.map((e, i) => {
    const pi = p[i] / sum;
    return {
      id: e.id, name: e.name, form: formOf(e, race), line: formLine(e, race),
      p: Math.round(pi * 1000) / 1000,
      odds: round2(Math.max(MIN_PRICE, 1 / (pi * OVERROUND))),
    };
  });
}

/** What the printed prices add to, as a fraction — over 1 is the bookmaker's margin. */
export function overroundOf(rows) {
  return rows.reduce((a, r) => a + 1 / Math.max(MIN_PRICE, r.odds), 0);
}

/** One runner's printed price at an hour, or null if it is not on the card. */
export function priceAt(race, id, hour = 0) {
  const row = oddsAt(race, hour).find((r) => r.id === id);
  return row ? row.odds : null;
}

/**
 * A TICKET STRUCK AT THE STATION'S WINDOW: `Tote.ticketFor`'s quote with the
 * reading room's printed price stamped on a win ticket, which is what
 * `Tote.settleTickets` then pays at. `Station.stakeAtTote` strikes through
 * this; the tote's own `ticketFor` stays the house's pure quote.
 */
export function printedTicket(race, bet) {
  const q = ticketFor(race, bet);
  if (!q.ok || !q.ticket) return q;
  if (q.ticket.kind === 'win') q.ticket.form = priceAt(race, q.ticket.on, q.ticket.at);
  return q;
}

/** A card per race — what the reading room's board prints. */
export function formCards(races, hour = 0) {
  return (races || []).map((race) => ({
    id: race.id, hour: race.hour, word: race.word || 'race', ground: race.ground?.name || '',
    off: (Number(hour) || 0) >= race.hour, slot: driftSlot(race, hour),
    runners: oddsAt(race, hour),
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE BOARD — a canvas beside every feed screen
 * ══════════════════════════════════════════════════════════════════════════ */

export const BOARD_W = 512, BOARD_H = 384;
/** Real seconds between repaints when a card's prices have not moved. */
const BOARD_EVERY = 0.5;

const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

/** Paint the cards. Pure of the world: cards in, picture out. */
export function paintFormBoard(ctx, W, H, cards, hour, title = 'FORM') {
  if (!ctx) return false;
  ctx.fillStyle = '#07090b'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffd27a'; ctx.fillRect(0, 0, W, 26);
  ctx.fillStyle = '#0b0c10'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`${title} · ${hhmm(hour)}`, 8, 18);
  const list = cards.filter((c) => !c.off).slice(0, 3);
  const shown = list.length ? list : cards.slice(-3);
  if (!shown.length) {
    ctx.fillStyle = '#7fc4ff'; ctx.font = '14px monospace';
    ctx.fillText('no card today', 8, 52);
    return true;
  }
  const colW = W / shown.length;
  shown.forEach((c, k) => {
    const x = k * colW + 8;
    let y = 46;
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px monospace';
    ctx.fillText(`${hhmm(c.hour)} ${c.word.toUpperCase()}${c.off ? ' · OFF' : ''}`, x, y);
    y += 16;
    ctx.fillStyle = '#7fc4ff'; ctx.font = '11px monospace';
    ctx.fillText(c.ground.slice(0, Math.floor(colW / 7)), x, y);
    y += 16;
    for (const r of c.runners) {
      ctx.fillStyle = '#c9d4de'; ctx.font = '12px monospace';
      ctx.fillText(String(r.name).slice(0, 12), x, y);
      ctx.fillStyle = '#9fd0ff';
      ctx.fillText(r.line, x + 96, y);
      ctx.fillStyle = '#ffd27a'; ctx.font = 'bold 12px monospace';
      ctx.fillText(`${r.odds.toFixed(2)}`, x + colW - 60, y);
      y += 15;
      if (y > H - 10) break;
    }
  });
  return true;
}

/**
 * HANG A BOARD UNDER EVERY FEED SCREEN. `StationKit.dressFeeds` owns the
 * screens (`st.feeds`); this hangs one plate under each, parented to the same
 * group so it is culled and disposed with the room.
 */
export function dressFormBoards(world, st) {
  const list = st?.feeds;
  if (!world || !list || !list.length) return 0;
  const H = world._formBoards || (world._formBoards = { boards: [], t: 0 });
  let made = 0;
  for (const f of list) {
    if (H.boards.some((b) => b.feed === f)) continue;
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (canvas) { canvas.width = BOARD_W; canvas.height = BOARD_H; }
    const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
    if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; }
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x2a3a4a, toneMapped: false });
    mat.name = `station-sign-form${f.id}`;
    mat.userData.key = 'sign';
    const w = f.w, h = f.w * (BOARD_H / BOARD_W);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.name = `station-form-${f.id}`;
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    /* Under the screen, and never below knee height. */
    const ly = Math.max(0.4 + h / 2, f.at.y - f.h / 2 - 0.12 - h / 2);
    mesh.position.set(f.x + f.at.x * c + f.at.z * s, f.y + ly, f.z - f.at.x * s + f.at.z * c);
    mesh.rotation.y = f.yaw + (f.at.ry || 0);
    (f.group || world.scene).add(mesh);
    H.boards.push({ feed: f, mesh, canvas, texture: tex, material: mat, key: '', draws: 0, cards: [] });
    st.draws += 1;
    made++;
  }
  return made;
}

/** Repaint a board when its prices have moved, on a half-second beat. */
export function stepFormBoards(world, st, dt) {
  const H = world?._formBoards;
  if (!H || !H.boards.length || !(dt > 0)) return 0;
  H.t = (H.t || 0) - dt;
  if (H.t > 0) return 0;
  H.t = BOARD_EVERY;
  const day = st.day | 0, hour = Number(st.hour) || 0;
  let drawn = 0;
  for (const b of H.boards) {
    const f = b.feed;
    if (f.group && !f.group.visible) continue;
    let races = [];
    try { races = racesOn(f.venue, day); } catch { races = []; }
    const cards = formCards(races, hour);
    b.cards = cards;
    const key = `${day}:${cards.map((c) => `${c.id}/${c.slot}/${c.off ? 1 : 0}`).join('|')}`;
    if (key === b.key) continue;
    b.key = key;
    b.draws++;
    drawn++;
    const ctx = b.canvas?.getContext?.('2d') || null;
    if (ctx && paintFormBoard(ctx, b.canvas.width || BOARD_W, b.canvas.height || BOARD_H, cards, hour)) {
      if (b.texture) b.texture.needsUpdate = true;
    }
  }
  return drawn;
}

export function undressFormBoards(world) {
  const H = world?._formBoards;
  if (!H) return;
  for (const b of H.boards) {
    b.mesh.parent?.remove(b.mesh);
    b.mesh.geometry?.dispose?.();
    b.texture?.dispose?.();
    b.material?.dispose?.();
  }
  H.boards.length = 0;
  world._formBoards = null;
}
