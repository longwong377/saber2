/**
 * SLEEPING IN THE CABIN — V18 cool 11: *"sleeping in the cabin plays the
 * night as a time-lapse through the window."*
 *
 * #27's verb has said "sleep" since V15 and the bunk was a slab of `M.deep`
 * you could stand on. This is the verb. The interact key, at the bunk
 * (`Home.homeKey`'s first branch after a held piece), runs a six-second
 * sequence on the world's own clock:
 *
 *   FADE      0.75 s   the frame darkens — `engine.punch`, the composite's
 *                      own event vignette, held rather than let decay — and
 *                      the camera lies down on the pillow, looking at the
 *                      cabin's screen.
 *   THE NIGHT 0.5 s a station hour   the clock winds to 07:00 through
 *                      `Station.tickStationClock` — the clock's own setter,
 *                      so midnight goes through `setStationHour`, the day
 *                      folds into the save and `st.day` advances exactly as
 *                      it does when the night is lived. The cabin's holonet
 *                      screen shows the orbit passing (`paintNight`: the
 *                      star field drifting, the planet's terminator sweeping
 *                      its disc, fighters' running lights crossing), and the
 *                      SkyDome's orbit clock is wound with it — a cabin with
 *                      real glass onto space sees the same night outside.
 *   FADE      0.75 s   back up; the player is standing at the bedside.
 *
 * 22:00 → 07:00 is nine hours, 4.5 s of night, six seconds all told.
 *
 * ── WHY THE SCREEN AND NOT ONLY THE WINDOW ─────────────────────────────
 *
 * #27 is on the INNER band of deck 44 at r = 31.5 m: its "real window"
 * looks onto the atrium void, and no line from the pillow reaches the skin.
 * The one surface in the room that can show space is the holonet screen
 * over the desk (`Holonet.dressTV` puts a canvas on it), so that is what the
 * night is painted on — the station's own feed, cutting to the orbit for the
 * hours you sleep. Where a cabin does have glass onto space the SkyDome's
 * clock is wound too, so both agree.
 *
 * NOTHING ROLLS. The stars and the fighters are `hash(i)`; the terminator
 * is a function of how much of the night has passed. A sleep that starts at
 * 22:00 paints the same night every time.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { tickStationClock } from './Station.js';
import { TV_W, TV_H } from './Holonet.js';
import { note } from './Journal.js';

/** Where you wake. */
export const WAKE_HOUR = 7;
/** Wall seconds per station hour while asleep. */
export const SEC_PER_HOUR = 0.5;
/** The two fades, wall seconds. */
export const FADE = 0.75;
/** How near the bunk the key means "sleep". */
export const BED_REACH = 1.9;
/** The screen is repainted this often while asleep. */
const NIGHT_FPS = 12;

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();

/** The bunk, in world: `SHAPES.twinroom` builds it at (w/2 − 2.4, d/2 − 1.2). */
export function bunkOf(h) {
  if (!h?.spot) return null;
  const { w, d } = h.spot;
  const lx = w / 2 - 2.4, lz = d / 2 - 1.2;
  const at = toWorld(h, lx, lz);
  /* The free side is inboard of it (−z in the room), a metre off. */
  const side = toWorld(h, lx, lz - 1.0);
  /* The pillow: the +x end of a 2.1 m slab whose top is at 0.84. */
  const head = toWorld(h, lx + 0.7, lz);
  return { x: at.x, y: at.y, z: at.z, top: at.y + 0.84, side, head, yaw: h.spot.yaw };
}

function toWorld(h, lx, lz) {
  return { x: h.spot.x + lx * h.cos + lz * h.sin, y: h.y, z: h.spot.z - lx * h.sin + lz * h.cos };
}

/** True when the player is at their own bunk. */
export function atBed(world) {
  const h = world?._home;
  const p = world?.player?.position;
  if (!h || !h.mine || !p) return false;
  const b = bunkOf(h);
  return !!b && Math.hypot(p.x - b.x, p.z - b.z) < BED_REACH && Math.abs(p.y - b.y) < 2;
}

/** How many station hours the night is, from `hour` to the next 07:00. */
export function nightHours(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  return h < WAKE_HOUR ? WAKE_HOUR - h : 24 - h + WAKE_HOUR;
}

/**
 * The key, at the bunk. True when the press was spent — the sequence began.
 */
export function beginSleep(world) {
  const st = world?._station;
  const pl = world?.player;
  const h = world?._home;
  if (!st || !pl || !h || world._sleep?.active) return false;
  if (!pl.alive) return false;
  const b = bunkOf(h);
  if (!b) return false;
  if (pl.seat) pl.standUp();
  const hours = nightHours(st.hour);
  const tv = (st.tvs || []).find((t) => t.place === h.spot.id && t.mesh) || null;
  world._sleep = {
    active: true, t: 0, phase: 'down',
    from: st.hour, fromDay: st.day | 0, hours, wound: 0,
    night: hours * SEC_PER_HOUR,
    bunk: b, tv, paintIn: 0, frames: 0,
    /* the facing the player wakes with: toward the room */
    yaw: Math.atan2(b.side.x - b.x, b.side.z - b.z),
  };
  world.notify?.('THE BUNK', `${fmt(st.hour)} — you lie down; ${hours} hours to 0700`);
  return true;
}

const fmt = (hour) => `${String(Math.floor(hour)).padStart(2, '0')}${String(Math.floor((hour % 1) * 60)).padStart(2, '0')} hours`;

/** Once a frame, from `stepStation` after the holonet has painted. */
export function stepSleep(world, st, dt) {
  const S = world?._sleep;
  if (!S?.active || !(dt > 0)) return;
  const pl = world.player;
  if (!pl || !pl.alive) { endSleep(world, false); return; }
  S.t += dt;
  const b = S.bunk;
  /* THE BODY STAYS AT THE BEDSIDE. Its own controller would walk it off on a
   * held key; a sleeper does not move. */
  pl.position.set(b.side.x, b.side.y, b.side.z);
  pl.velocity?.set(0, 0, 0);
  pl.facing = S.yaw;

  /* The envelope: up over FADE, held through the night, down over FADE. */
  let dark;
  if (S.phase === 'down') {
    dark = Math.min(1, S.t / FADE);
    if (S.t >= FADE) { S.phase = 'night'; S.t = 0; }
  } else if (S.phase === 'night') {
    dark = 1;
    const want = Math.min(S.hours, S.hours * (S.t / S.night));
    const step = want - S.wound;
    if (step > 0) wind(world, st, step, S);
    if (S.wound >= S.hours - 1e-6 || S.t >= S.night) {
      if (S.wound < S.hours) wind(world, st, S.hours - S.wound, S);
      S.phase = 'up'; S.t = 0;
    }
  } else {
    dark = 1 - Math.min(1, S.t / FADE);
    if (S.t >= FADE) { endSleep(world, true); return; }
  }
  /* THE FRAME DARKENS — the composite's event vignette, held. It decays at
   * 6.4/s on its own, which is why it is written every frame. */
  world.engine?.punch?.(0.25 + 0.45 * dark);

  /* THE CAMERA LIES ON THE PILLOW and looks at the screen. Written after the
   * rig's own update (the player is stepped before the station), so it
   * stands until the rig writes again next frame. */
  const rig = pl.camera;
  const cam = rig?.camera;
  if (cam) {
    _v.set(b.head.x, b.top + 0.32, b.head.z);
    if (S.tv?.mesh) _look.copy(S.tv.mesh.position);
    else _look.set(b.side.x, b.top + 0.6, b.side.z);
    cam.position.copy(_v);
    cam.lookAt(_look);
    cam.updateMatrixWorld?.();
    rig.pos?.copy(_v); rig.look?.copy(_look);
  }

  /* THE NIGHT ON THE SCREEN, at 12 fps. */
  S.paintIn -= dt;
  if (S.paintIn <= 0 && S.tv?.canvas) {
    S.paintIn = 1 / NIGHT_FPS;
    const ctx = S.tv.canvas.getContext?.('2d');
    if (ctx) {
      paintNight(ctx, TV_W, TV_H, S.wound / Math.max(S.hours, 1e-6), st.hour, S.frames / NIGHT_FPS, dark);
      if (S.tv.texture) S.tv.texture.needsUpdate = true;
      S.frames++;
    }
  }
}

/**
 * Wind the clock by `hours` through its own tick, and the sky with it.
 * `tickStationClock` adds `dt / 120` hours, so the dt handed in is hours × 120.
 */
function wind(world, st, hours, S) {
  tickStationClock(world, hours * 120);
  S.wound += hours;
  /* The SkyDome's orbit: a sixth of a period per station hour, so a night
   * is a turn and a half of the planet past the glass, and `DeckBattle`
   * follows `uOrbitT` on its next step. */
  const sky = world.engine?.skyDome;
  if (sky?._orbitTick && Number.isFinite(sky._orbitPeriod)) {
    try { sky._orbitTick(hours * sky._orbitPeriod / 6); } catch { /* a dome without a fleet */ }
  }
}

/** Wake. `woke` false is an interruption (a death), and says nothing. */
export function endSleep(world, woke = true) {
  const S = world?._sleep;
  if (!S) return;
  S.active = false;
  world._sleep = null;
  const st = world._station;
  if (st) st.slept = { day: st.day | 0, hours: S.wound, from: S.from, at: st.hour };
  const pl = world.player;
  if (pl && S.bunk) { pl.position.set(S.bunk.side.x, S.bunk.side.y, S.bunk.side.z); pl.velocity?.set(0, 0, 0); }
  if (woke && st) world.notify?.('THE CABIN', `${fmt(st.hour)}, day ${st.day | 0} — you slept ${Math.round(S.wound)} hours`);
  if (woke && st) note('sleep', `slept ${Math.round(S.wound)} hours in the cabin, up at ${fmt(st.hour)}`, world); // V19: the journal
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE NIGHT, PAINTED                                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

/** A seeded unit float — the same star in the same place every night. */
const hash = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

const STARS = 140;
const FIGHTERS = 7;

/**
 * One frame of the orbit outside: `u` is how much of the night has passed
 * (0..1), `hour` the station hour for the caption, `t` seconds of painting
 * for the blink, `dark` the fade for the caption's weight.
 */
export function paintNight(ctx, W, H, u, hour, t, dark = 1) {
  ctx.save();
  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, W, H);
  /* The stars, drifting with the orbit — a third of the frame over the night. */
  for (let i = 0; i < STARS; i++) {
    const x = ((hash(i) + u * 0.33) % 1) * W;
    const y = hash(i + 1000) * H;
    const m = hash(i + 2000);
    const s = 0.6 + m * 1.6;
    const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (1 + m * 2) + i));
    ctx.fillStyle = `rgba(${m > 0.7 ? '210,225,255' : '255,245,225'},${a.toFixed(2)})`;
    ctx.fillRect(x, y, s, s);
  }
  /* THE PLANET, lower right, and its terminator sweeping the disc from one
   * limb to the other over the night. */
  const cx = W * 0.72, cy = H * 0.66, r = H * 0.44;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#7fa9c8'); g.addColorStop(0.7, '#3c6e8a'); g.addColorStop(1, '#173445');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  /* Land, a few blobs turned with the day. */
  ctx.fillStyle = 'rgba(142,128,96,0.85)';
  for (let i = 0; i < 6; i++) {
    const a = hash(i + 300) * Math.PI * 2 + u * 1.8;
    const lx = cx + Math.cos(a) * r * 0.75, ly = cy + (hash(i + 400) - 0.5) * r * 1.3;
    ctx.beginPath(); ctx.ellipse(lx, ly, r * (0.12 + hash(i + 500) * 0.2), r * 0.1, a, 0, Math.PI * 2); ctx.fill();
  }
  /* The night side: a dark disc sliding across, limb to limb. */
  const sx = cx + (u * 2 - 1) * r * 2.1;
  ctx.fillStyle = 'rgba(2,4,10,0.94)';
  ctx.beginPath(); ctx.arc(sx, cy, r * 1.04, 0, Math.PI * 2); ctx.fill();
  /* Cities on the night side, a scatter that only shows where it is dark. */
  ctx.fillStyle = 'rgba(255,214,150,0.8)';
  for (let i = 0; i < 24; i++) {
    const px = cx + (hash(i + 600) - 0.5) * r * 1.7, py = cy + (hash(i + 700) - 0.5) * r * 1.7;
    if (Math.hypot(px - cx, py - cy) > r * 0.92 || Math.hypot(px - sx, py - cy) > r * 1.0) continue;
    ctx.fillRect(px, py, 1.5, 1.5);
  }
  ctx.restore();
  /* The limb's haze. */
  ctx.strokeStyle = 'rgba(150,200,255,0.35)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r + 1, 0, Math.PI * 2); ctx.stroke();
  /* FIGHTERS' RUNNING LIGHTS: seven, crossing on their own lines, blinking. */
  for (let i = 0; i < FIGHTERS; i++) {
    const k = (hash(i + 800) + t * (0.05 + hash(i + 900) * 0.08) + u * 0.6) % 1;
    const x0 = hash(i + 810) * W, y0 = hash(i + 820) * H * 0.7;
    const x1 = hash(i + 830) * W, y1 = hash(i + 840) * H * 0.7;
    const x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k;
    const blink = Math.sin(t * 9 + i * 1.7) > 0.15;
    if (!blink) continue;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255,70,50,0.95)' : 'rgba(80,190,255,0.95)';
    ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x - 3, y + 1, 1, 1);
  }
  /* The caption: the hour, the way the holonet's ident writes it. */
  ctx.fillStyle = `rgba(230,236,255,${(0.5 + 0.4 * dark).toFixed(2)})`;
  ctx.font = `bold ${Math.round(H * 0.075)}px sans-serif`;
  ctx.fillText(fmt(hour).toUpperCase(), W * 0.04, H * 0.12);
  ctx.font = `${Math.round(H * 0.05)}px sans-serif`;
  ctx.fillStyle = 'rgba(180,200,230,0.7)';
  ctx.fillText('THE ORBIT — LIVE', W * 0.04, H * 0.19);
  ctx.restore();
}
