/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE HOLONET — galactic television, all day, never the same twice
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player: *"in addition to the pod racing there should be galactic
 * television of some kind with 24/7 tv (also procedural, never the same).
 * Maybe in the apartment and other places in the station."*
 *
 * A CHANNEL is a schedule of PROGRAMMES over the station's day, drawn from a
 * seed of the day so tomorrow's line-up is not today's; a PROGRAMME is a kind
 * (news, the orbit chart, an advert break, a talk show, the sport desk, the
 * ident) painted on a canvas from what the station actually knows right now —
 * the war outside the window, who won at the holo-theatre, what is on the
 * shelves today, two residents' own lines, the hour. Inside a programme the
 * picture CUTS every few seconds (a new headline, a new advert), so a minute
 * in front of a screen is a minute of change.
 *
 * A SCREEN is a `tv` fixture a room builder declares (`StationKit.tvScreen`):
 * the cabin, the cantina, the food court, the hostel, the Ascendant. All of
 * them show the same channel at the same moment, which is the point of a
 * broadcast: two people in two rooms are watching the same thing. It paints
 * only within `NEAR` of the player and at `FPS`, and nothing here allocates
 * per frame beyond the canvas call.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { stationName, stationDay } from './StationSave.js';
import { outsideLevel } from './Hangar.js';
import { deckBattleState } from './DeckBattle.js';
import { COUNTERS } from './Vendors.js';
import { shelfFor } from './Counter.js';
import { resident, barkFor, SPECIES_KEYS } from './StationCast.js';
import { venueAtPlace, watch as toteWatch, resultOf } from './Tote.js';

export const TV_W = 512, TV_H = 288;
export const NEAR = 30;
export const FPS = 6;
/** How many station minutes a programme runs. */
const PROGRAMME_MIN = 70;
/** Real seconds between cuts inside a programme. */
const CUT_EVERY = 9;

const KINDS = ['news', 'orbit', 'adverts', 'talk', 'sport', 'ident', 'news', 'adverts', 'talk'];

function hashF(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
function pick(arr, u) { return arr[Math.floor(u * arr.length) % arr.length]; }

/** Which programme is on at this hour of this day, and how far into it. */
export function programmeAt(day, hour) {
  const slot = Math.floor((hour * 60) / PROGRAMME_MIN);
  const u = hashF(`holonet:${day | 0}:${slot}`);
  const kind = (hour >= 2.5 && hour < 5) ? 'ident' : pick(KINDS, u);
  const into = ((hour * 60) % PROGRAMME_MIN) / PROGRAMME_MIN;
  return { kind, slot, into, seed: `${day | 0}:${slot}` };
}

/* ── THE CHANNEL'S SOURCES ───────────────────────────────────────────────── */
const WORDS = {
  news: ['HOLDS', 'FALLS', 'CONTESTED', 'RELIEVED', 'QUIET', 'BURNING', 'CUT OFF', 'REINFORCED'],
  adjective: ['finest', 'honest', 'quiet', 'proper', 'last', 'only', 'cheapest', 'real'],
  slogan: ['for those who mean it', 'no questions at the counter', 'open when the shutters are', 'the ring knows the name', 'since the hull was bolted', 'ask for it by name'],
  talk: ['on the war', 'on the station', 'on what you saw', 'on the price of things', 'on going home'],
  weather: ['clear', 'dust', 'storm belt', 'ion haze', 'fair', 'squalls'],
};

function newsLines(world, P, cut) {
  const name = stationName();
  const L = outsideLevel(world);
  const theatre = L?.name || 'the line';
  const B = deckBattleState(world);
  const u = hashF(`${P.seed}:n:${cut}`);
  const lines = [
    `${theatre.toUpperCase()} ${pick(WORDS.news, u)}`,
    B ? `${B.shown ?? B.fighters ?? '—'} HULLS IN THE WINDOW OVER ${name.toUpperCase()}` : `${name.toUpperCase()} REPORTS A QUIET ORBIT`,
    `DAY ${stationDay() + 1} ON ${name.toUpperCase()} — ARRIVALS EVERY SIX MINUTES`,
    `THE STANDING FILES ANOTHER ROW`,
    `CUSTOMS: ${Math.floor(u * 40) + 12} HELD AT THE GATES THIS SHIFT`,
  ];
  return { head: pick(lines, u), sub: pick(lines, hashF(`${P.seed}:n2:${cut}`)), ticker: lines.join('   ·   ') };
}

function advertOf(P, cut, day) {
  const u = hashF(`${P.seed}:a:${cut}`);
  const counter = pick(COUNTERS, u);
  const rows = shelfFor(counter, day);
  const row = rows.length ? pick(rows, hashF(`${P.seed}:a2:${cut}`)) : null;
  return {
    counter: counter.name || counter.id,
    item: row ? String(row.name) : 'what is on the shelf today',
    price: row?.price != null ? `${row.price} cr` : '',
    line: `${pick(WORDS.adjective, u)} — ${pick(WORDS.slogan, hashF(`${P.seed}:a3:${cut}`))}`,
  };
}

function talkOf(P, cut, day) {
  const a = resident(`tv:${P.seed}:a`), b = resident(`tv:${P.seed}:b`);
  const who = cut % 2 ? b : a;
  const said = barkFor(who, day, { hour: 12 });
  const line = Array.isArray(said) ? said[said.length - 1] : String(said || '');
  return { host: a, guest: b, speaker: who, line, topic: pick(WORDS.talk, hashF(`${P.seed}:t`)) };
}

function sportOf(world, day, hour) {
  const v = venueAtPlace(19);
  if (!v) return null;
  let reading = null;
  try { reading = toteWatch(v.id, day, hour); } catch { return null; }
  const race = reading?.race;
  const res = race ? resultOf(race) : null;
  const winner = res?.winner != null ? (race.card?.entrants?.[res.winner]?.name || null) : null;
  return { phase: reading?.phase, name: race?.name || v.name, standings: reading?.standings || [], winner, progress: reading?.progress || 0, calls: reading?.calls || [] };
}

/* ── THE PAINT ───────────────────────────────────────────────────────────── */
function frame(ctx, W, H, bg) {
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
}
function bar(ctx, W, H, text, y, colour, size = 22, align = 'left') {
  ctx.fillStyle = colour; ctx.fillRect(0, y, W, size + 14);
  ctx.fillStyle = '#0b0c10'; ctx.font = `bold ${size}px monospace`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(String(text).slice(0, 44), align === 'left' ? 16 : W / 2, y + (size + 14) / 2);
}
function text(ctx, x, y, s, size, colour, align = 'left', bold = true) {
  ctx.fillStyle = colour; ctx.font = `${bold ? 'bold ' : ''}${size}px monospace`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(String(s), x, y);
}
function face(ctx, x, y, r, hue, mouth) {
  ctx.fillStyle = `hsl(${hue}, 45%, 55%)`; ctx.beginPath(); ctx.ellipse(x, y, r * 0.8, r, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.15, r * 0.08, 0, Math.PI * 2); ctx.arc(x + r * 0.3, y - r * 0.15, r * 0.08, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.45, r * 0.25, mouth ? r * 0.14 : r * 0.03, 0, 0, Math.PI * 2); ctx.fill();
}
function logo(ctx, W, name) {
  ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(W - 30, 26, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0b0c10'; ctx.beginPath(); ctx.arc(W - 30, 26, 6, 0, Math.PI * 2); ctx.fill();
  text(ctx, W - 50, 26, name, 14, '#ffd27a', 'right');
}

export function paintProgramme(ctx, W, H, world, P, cut, t, day, hour) {
  const name = stationName();
  const hue = hashF(P.seed) * 360;
  if (P.kind === 'news') {
    const N = newsLines(world, P, cut);
    frame(ctx, W, H, '#0e1420');
    ctx.fillStyle = `hsl(${hue}, 30%, 22%)`; ctx.fillRect(0, 0, W, H * 0.62);
    face(ctx, 96, 118, 52, hue + 120, Math.floor(t * 4) % 3 === 0);
    ctx.fillStyle = '#243046'; ctx.fillRect(170, 62, W - 200, 110);
    text(ctx, 184, 92, N.head, 20, '#ffffff');
    text(ctx, 184, 132, N.sub, 15, '#9fd0ff', 'left', false);
    bar(ctx, W, H, 'HOLONET · NEWS', H * 0.62, '#ffd27a', 18);
    const tick = N.ticker + '   ·   ' + N.ticker;
    ctx.save(); ctx.beginPath(); ctx.rect(0, H - 54, W, 54); ctx.clip();
    const off = (t * 70) % (ctx.measureText(N.ticker).width + 60);
    text(ctx, 20 - off, H - 27, tick, 18, '#e8eefc');
    ctx.restore();
    logo(ctx, W, name.toUpperCase());
  } else if (P.kind === 'orbit') {
    const L = outsideLevel(world);
    frame(ctx, W, H, '#070a12');
    const u = hashF(`${P.seed}:o`);
    ctx.fillStyle = `hsl(${(u * 360) | 0}, 40%, 42%)`; ctx.beginPath(); ctx.arc(W * 0.35, H * 0.5, 84, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4d6b8f'; ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.ellipse(W * 0.35, H * 0.5, 84 + i * 34, 26 + i * 12, -0.4, 0, Math.PI * 2); ctx.stroke(); }
    const a = t * 0.6 + u * 6;
    ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(W * 0.35 + Math.cos(a) * 152, H * 0.5 + Math.sin(a) * 50, 5, 0, Math.PI * 2); ctx.fill();
    text(ctx, W * 0.62, 70, (L?.name || 'THE LINE').toUpperCase(), 22, '#ffffff');
    text(ctx, W * 0.62, 106, `ORBIT · ${pick(WORDS.weather, hashF(`${P.seed}:w:${cut}`)).toUpperCase()}`, 15, '#9fd0ff', 'left', false);
    text(ctx, W * 0.62, 136, `${name.toUpperCase()} · DAY ${day + 1}`, 15, '#9fd0ff', 'left', false);
    text(ctx, W * 0.62, 166, `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')} STATION`, 15, '#9fd0ff', 'left', false);
    bar(ctx, W, H, 'HOLONET · ORBIT', H - 40, '#7fc4ff', 16);
  } else if (P.kind === 'adverts') {
    const A = advertOf(P, cut, day);
    const h2 = hashF(`${P.seed}:ac:${cut}`) * 360;
    frame(ctx, W, H, `hsl(${h2 | 0}, 55%, 30%)`);
    ctx.fillStyle = `hsl(${(h2 + 40) | 0}, 70%, 60%)`; ctx.beginPath(); ctx.arc(W * 0.24, H * 0.46, 70 + Math.sin(t * 3) * 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0c10'; ctx.fillRect(W * 0.24 - 30, H * 0.46 - 30, 60, 60);
    text(ctx, W * 0.44, 74, A.item.toUpperCase(), 22, '#ffffff');
    text(ctx, W * 0.44, 112, A.price, 26, '#ffd27a');
    text(ctx, W * 0.44, 150, A.line, 14, '#f4f4f4', 'left', false);
    bar(ctx, W, H, A.counter.toUpperCase(), H - 44, '#ffffff', 20);
  } else if (P.kind === 'talk') {
    const T = talkOf(P, cut, day);
    frame(ctx, W, H, '#1a1410');
    ctx.fillStyle = '#2c231b'; ctx.fillRect(0, H * 0.7, W, H * 0.3);
    face(ctx, W * 0.28, H * 0.42, 58, hashF(T.host.seed) * 360, T.speaker === T.host && Math.floor(t * 5) % 2 === 0);
    face(ctx, W * 0.72, H * 0.42, 58, hashF(T.guest.seed) * 360, T.speaker === T.guest && Math.floor(t * 5) % 2 === 0);
    text(ctx, W * 0.28, H * 0.42 + 84, T.host.name, 13, '#ffd27a', 'center');
    text(ctx, W * 0.72, H * 0.42 + 84, `${T.guest.name} · ${T.guest.species}`, 13, '#ffd27a', 'center');
    ctx.fillStyle = '#f4efe6'; ctx.fillRect(16, H * 0.72, W - 32, 44);
    text(ctx, 26, H * 0.72 + 22, String(T.line).slice(0, 56), 14, '#111', 'left', false);
    bar(ctx, W, H, `LATE, ${T.topic.toUpperCase()}`, H - 26, '#c9a86a', 14);
  } else if (P.kind === 'sport') {
    const S = sportOf(world, day, hour);
    frame(ctx, W, H, '#0b1a12');
    bar(ctx, W, H, 'HOLONET · SPORT', 0, '#7fffb0', 18);
    if (!S) { text(ctx, W / 2, H / 2, 'NO CARD TONIGHT', 22, '#ffffff', 'center'); }
    else {
      text(ctx, 16, 70, S.name.toUpperCase(), 18, '#ffffff');
      if (S.phase === 'running') {
        ctx.fillStyle = '#1c3a2a'; ctx.fillRect(16, 90, W - 32, 18);
        ctx.fillStyle = '#7fffb0'; ctx.fillRect(16, 90, (W - 32) * Math.min(1, S.progress), 18);
        S.standings.slice(0, 5).forEach((s, i) => text(ctx, 16, 128 + i * 24, `${i + 1}. ${s.name}`, 15, '#e8ffef', 'left', false));
        if (S.calls.length) text(ctx, 16, H - 24, String(S.calls[S.calls.length - 1]).slice(0, 52), 13, '#9fd0ff', 'left', false);
      } else if (S.phase === 'called' && S.winner) {
        text(ctx, 16, 110, `WON BY ${S.winner.toUpperCase()}`, 24, '#ffd27a');
        S.standings.slice(0, 4).forEach((s, i) => text(ctx, 16, 150 + i * 24, `${i + 1}. ${s.name}`, 15, '#e8ffef', 'left', false));
      } else {
        text(ctx, 16, 110, S.phase === 'parading' ? 'THE FIELD IS PARADING' : 'NEXT CARD AT THE HOLO-THEATRE', 16, '#e8ffef', 'left', false);
        S.standings.slice(0, 6).forEach((s, i) => text(ctx, 16, 146 + i * 22, s.name, 14, '#9fd0ff', 'left', false));
      }
    }
  } else {
    /* the ident: the station's own card, and the test card in the small hours */
    frame(ctx, W, H, '#101318');
    const bars = ['#ffffff', '#ffd27a', '#7fffb0', '#7fc4ff', '#ff7a5a', '#b48cff', '#3a3f4a'];
    if (hour >= 2.5 && hour < 5) bars.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * (W / 7), 0, W / 7 + 1, H * 0.6); });
    else { ctx.fillStyle = `hsl(${hue | 0}, 40%, 22%)`; ctx.fillRect(0, 0, W, H * 0.6); }
    ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(W / 2, H * 0.3, 40 + Math.sin(t * 2) * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#101318'; ctx.beginPath(); ctx.arc(W / 2, H * 0.3, 20, 0, Math.PI * 2); ctx.fill();
    text(ctx, W / 2, H * 0.74, `HOLONET · ${name.toUpperCase()}`, 22, '#ffffff', 'center');
    text(ctx, W / 2, H * 0.88, hour >= 2.5 && hour < 5 ? 'PROGRAMMES RESUME AT 05:00' : 'STAY WITH US', 14, '#9fd0ff', 'center', false);
  }
  /* the corner clock, on everything */
  text(ctx, 12, 16, `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`, 13, '#ffffff');
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
