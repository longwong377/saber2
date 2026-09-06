/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE JOURNAL — V19 addition 2: one line per system per day, read as pages
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"Saving is a bag of folds; no readable 'what changed'"* (V19 hole 7). The
 * fix is not a diff of the folds; it is a book on the desk in the cabin, and
 * every system in the game writes ONE line into it at the moment its thing
 * happens: a talk, a bet and its result, a purchase, a man's fate, a job taken
 * and paid, a funeral, the pickpocket, a sleep, a remote test, a lift ride.
 *
 * ── THE WRITING ──────────────────────────────────────────────────────────
 *
 * `note(kind, line, when?)` appends to TODAY'S PAGE in `StationSave`'s
 * `journal` fold, stamped with the station day and hour. The day is
 * `stationDay()` (the fold's midnight counter — the one answer to what day it
 * is); the hour is the world's live clock when the caller has one and the
 * fold's persisted hour otherwise, which is within the hour of the truth
 * (`tickStationClock` writes it on every whole hour). A page holds
 * `LINES_A_DAY` lines and the book keeps `DAYS_KEPT` days; both are caps, not
 * rings — the 41st thing on a busy day is not written, because a journal
 * that forgets the morning to fit the evening is a different book.
 *
 * ── THE READING ──────────────────────────────────────────────────────────
 *
 * In the cabin (`Home.homeKey`) the key at the desk opens it: a page painted
 * on a canvas, on a slab in front of the camera — `Holonet.paintProgramme`'s
 * method — with the day's lines. The key again turns back a day; the wheel
 * turns either way; walking away closes it. `world.onJournal?.()` is asked
 * first, so a main-side panel can take it over; when nothing answers the
 * page mesh is the panel. The first open says how to flip (`hasSeen`).
 *
 * Nothing here rolls a die. Nothing here is a hook: every writer is one line
 * in the system the thing belongs to, listed in the V19 lane.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { journalState, setJournalState, stationDay, stationHour, hasSeen, markSeen } from './StationSave.js';

/** The caps. A page is a page. */
export const LINES_A_DAY = 40;
export const DAYS_KEPT = 30;

/** The page: canvas size and the slab in front of the camera. */
export const PAGE = Object.freeze({ w: 512, h: 640, slabW: 0.42, slabH: 0.525, ahead: 0.62, reach: 2.2 });

/** The kinds a line may carry — a reader's index, not a gate. */
export const KINDS = Object.freeze(['talk', 'bet', 'buy', 'paid', 'fate', 'job', 'funeral', 'pickpocket', 'sleep', 'test', 'lift', 'muster', 'note']);

const fmt = (h) => `${String(Math.floor(h)).padStart(2, '0')}${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

function book() {
  const j = journalState();
  if (j && typeof j === 'object' && j.days && typeof j.days === 'object') return j;
  return { v: 1, days: {} };
}

/**
 * ONE LINE. `when` is optional: a world (`when._station.hour`), an
 * `{ day, hour }`, or nothing — the fold answers then. Returns the record
 * written, or null when the page was full or the line was blank.
 */
export function note(kind, line, when = null) {
  const t = String(line ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!t) return null;
  const k = KINDS.includes(kind) ? kind : 'note';
  const st = when?._station || null;
  const day = Number.isFinite(when?.day) ? (when.day | 0) : Number.isFinite(st?.day) ? (st.day | 0) : stationDay();
  const hourRaw = Number.isFinite(when?.hour) ? when.hour : Number.isFinite(st?.hour) ? st.hour : stationHour();
  const h = Math.round((((hourRaw % 24) + 24) % 24) * 100) / 100;
  const j = book();
  const key = String(day);
  const page = Array.isArray(j.days[key]) ? j.days[key] : (j.days[key] = []);
  if (page.length >= LINES_A_DAY) return null;
  const rec = { h, k, t };
  page.push(rec);
  /* Thirty days, the newest kept. */
  const keys = Object.keys(j.days).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  for (const d of keys.slice(DAYS_KEPT)) delete j.days[String(d)];
  setJournalState(j);
  return rec;
}

/** The lines of one day, oldest first. */
export function pageOf(day = stationDay()) {
  const page = book().days[String(day | 0)];
  return Array.isArray(page) ? page.slice() : [];
}

/** Which days have a page, newest first. */
export function daysWritten() {
  return Object.keys(book().days).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
}

/** A line as the page prints it. */
export function printed(rec) { return `${fmt(rec.h)}  ${rec.t}`; }

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE PAGE                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

function wrap(s, cols) {
  const out = [];
  let line = '';
  for (const w of String(s).split(' ')) {
    if ((line + ' ' + w).trim().length > cols && line) { out.push(line); line = w; }
    else line = (line ? line + ' ' : '') + w;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Paint one day onto a 2-D context. Pure of the world: the check paints the
 * same page the cabin does. Returns the rows painted.
 */
export function paintPage(ctx, W, H, day, lines, opts = {}) {
  if (!ctx) return [];
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#d9cdae';
  ctx.fillRect(0, 0, 18, H);
  for (let y = 84; y < H - 40; y += 26) { ctx.fillStyle = '#e2d7bd'; ctx.fillRect(34, y, W - 60, 1); }
  ctx.fillStyle = '#3a2f22';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`DAY ${day | 0}`, 34, 48);
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#6a5a44';
  ctx.textAlign = 'right';
  ctx.fillText(opts.pager || '', W - 30, 48);
  ctx.textAlign = 'left';
  const rows = [];
  if (!lines.length) rows.push('— nothing written —');
  for (const rec of lines) for (const r of wrap(printed(rec), 44)) rows.push(r);
  ctx.font = '16px monospace';
  ctx.fillStyle = '#2b2419';
  let y = 104;
  for (const r of rows) {
    if (y > H - 30) break;
    ctx.fillText(r, 40, y);
    y += 26;
  }
  if (opts.hint) {
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#7a6a54';
    ctx.fillText(opts.hint, 34, H - 14);
  }
  return rows;
}

function journalOf(world) { return world?._journal || null; }

/** Is the book open? */
export function journalOpen(world) { return !!journalOf(world)?.open; }

function repaint(world, J) {
  const days = daysWritten();
  const today = stationDay();
  if (!days.includes(today)) days.unshift(today);
  days.sort((a, b) => b - a);
  if (!days.includes(J.day)) J.day = today;
  const i = days.indexOf(J.day);
  const lines = pageOf(J.day);
  const pager = `${i + 1} / ${days.length}`;
  J.days = days;
  J.lines = lines;
  J.rows = paintPage(J.ctx, PAGE.w, PAGE.h, J.day, lines, { pager, hint: J.hint });
  if (J.texture) J.texture.needsUpdate = true;
}

function place(world, J) {
  const cam = world?.player?.camera?.camera;
  const mesh = J.mesh;
  if (!mesh) return;
  if (cam) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    mesh.position.copy(cam.position).addScaledVector(fwd, PAGE.ahead);
    mesh.quaternion.copy(cam.quaternion);
  } else {
    const p = world?.player?.position;
    if (p) mesh.position.set(p.x, p.y + 1.4, p.z - PAGE.ahead);
  }
  mesh.updateMatrixWorld?.();
}

/**
 * OPEN IT at the desk — or close it if it is open. `world.onJournal` is
 * asked first; when nothing answers, the page mesh is the panel.
 */
export function openJournal(world, at = null) {
  if (!world) return false;
  if (journalOpen(world)) { closeJournal(world); return true; }
  if (typeof world.onJournal === 'function' && world.onJournal() === true) return true;
  const first = !hasSeen('journal');
  if (first) markSeen('journal');
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = PAGE.w; canvas.height = PAGE.h; }
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; }
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0xefe6cf, toneMapped: false, depthTest: false, transparent: false });
  mat.name = 'station-sign-journal';
  mat.userData.key = 'sign';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PAGE.slabW, PAGE.slabH), mat);
  mesh.name = 'journal-page';
  mesh.renderOrder = 900;
  mesh.frustumCulled = false;
  const J = {
    open: true, mesh, canvas, texture: tex, material: mat,
    ctx: canvas?.getContext?.('2d') || null,
    day: stationDay(), days: [], lines: [], rows: [],
    at: at ? at.clone() : (world.player?.position?.clone() || null),
    hint: first ? 'key: back a day · wheel: either way · walk away to close' : null,
    flips: 0,
  };
  world._journal = J;
  world.scene?.add(mesh);
  place(world, J);
  repaint(world, J);
  world.notify?.('THE JOURNAL', first
    ? `day ${J.day} — the key turns back a day, the wheel either way; walk away to close it`
    : `day ${J.day} — ${J.lines.length} line${J.lines.length === 1 ? '' : 's'}`);
  return true;
}

export function closeJournal(world) {
  const J = journalOf(world);
  if (!J) return false;
  J.open = false;
  if (J.mesh) {
    J.mesh.parent?.remove(J.mesh);
    J.mesh.geometry?.dispose?.();
  }
  J.texture?.dispose?.();
  J.material?.dispose?.();
  world._journal = null;
  return true;
}

/** Turn the pages: +1 is an older day, −1 a newer one. */
export function flipJournal(world, by = 1) {
  const J = journalOf(world);
  if (!J?.open) return false;
  const days = J.days.length ? J.days : [J.day];
  const i = days.indexOf(J.day);
  const to = Math.max(0, Math.min(days.length - 1, i + (by | 0)));
  if (to === i) return false;
  J.day = days[to];
  J.flips++;
  repaint(world, J);
  world.notify?.('THE JOURNAL', `day ${J.day} — ${J.lines.length} line${J.lines.length === 1 ? '' : 's'}`);
  return true;
}

/**
 * THE KEY WHILE THE BOOK IS OPEN: back a day; on the oldest page, close it.
 * `Home.homeKey`'s first line.
 */
export function journalKey(world) {
  if (!journalOpen(world)) return false;
  if (!flipJournal(world, 1)) closeJournal(world);
  return true;
}

/** Once a frame, from the home: the page follows the eye and closes when you walk off. */
export function stepJournal(world) {
  const J = journalOf(world);
  if (!J?.open) return;
  const p = world.player?.position;
  if (p && J.at && p.distanceTo(J.at) > PAGE.reach) { closeJournal(world); return; }
  place(world, J);
}
