/**
 * ══════════════════════════════════════════════════════════════════════════
 *  HEALING — the ward, seen (V18 hole 5)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `Medbay.js` runs the ward and `StationLife` seats the men in the glass, and
 * that was the whole of what a player saw: five lit tubes, some with a body
 * in them. This is everything that moves in #44:
 *
 *   THE MEDIC     one body on a seeded round of the occupied tanks, walking
 *                 from tank to tank on the standing machinery every resident
 *                 uses (`standCx/standCz`, `standFace`), dwelling at each
 *                 patient, and back to the counter when the ward is empty.
 *   THE FLUID     a column of small spheres rising in every occupied tank.
 *   THE MONITOR   a canvas over each tank painting a heart-rate trace, the
 *                 rate read off the man's own health — `paintMonitor` is the
 *                 Holonet's canvas-on-a-slab pattern, small.
 *   THE WALK OUT  a man whose tank goes dark because he is fit stands at the
 *                 glass, then walks to the door and out onto the ring.
 *   THE COUNT     `wardCount` is what the room holds, and it falls as men
 *                 heal — `StationLife.headcount` reads the same register.
 *
 * Nothing here heals anybody: `stepMedbay` does, on the station's clock. This
 * only reads the register and shows it.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { TANKS, WARD, tankLocal, wardOf, hpOf } from './Medbay.js';
import { companyOf } from './StationBoards.js';
import { nameOf } from './Company.js';
import { lookFor } from './StationCast.js';
import { floorOf } from './StationPlan.js';

/** Real seconds the medic stands at a patient. */
export const DWELL = 6;
/** The medic's walking pace, m/s. */
export const PACE = 1.15;
/** A healed man sits up for this long before he walks. */
export const SIT_UP = 1.6;
/** Real seconds between reads of the register — a localStorage parse. */
const REGISTER_EVERY = 0.5;
/** Monitor repaint interval, real seconds. */
const MONITOR_EVERY = 1 / 8;
export const MON_W = 256, MON_H = 128;
const BUBBLES = 7;

function hashF(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 100000) / 100000;
}

/* ── the room's frame ────────────────────────────────────────────────── */

function toWorld(place, lx, lz, out) {
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw);
  out.x = place.x + lx * c + lz * s;
  out.z = place.z - lx * s + lz * c;
  return out;
}

/** Where the medic stands to look at tank `i`: in front of the glass. */
function bedside(place, i) {
  const [lx, , lz] = tankLocal(i, place.w, place.d);
  return toWorld(place, lx, lz - 0.85 - 0.75, {});
}

/** The register, as a row of names per tank. */
function tanksNow() {
  try { return wardOf(companyOf()).tanks.slice(); } catch { return new Array(TANKS).fill(null); }
}
function manNamed(name, company = null) {
  try { return ((company || companyOf())?.men || []).find((m) => m.designation === name) || null; } catch { return null; }
}

/* ── the monitor ─────────────────────────────────────────────────────── */

/**
 * ONE FRAME OF A BEDSIDE MONITOR. A scrolling heart-rate trace whose rate is
 * the man's own: 60 bpm fit, 120 at death's door. Text under it. Pure of the
 * world — a check paints it on a recorder.
 */
export function paintMonitor(ctx, W, H, t, hp = 1, label = '', seed = 0) {
  if (!ctx) return false;
  ctx.fillStyle = '#04110c'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#0d3a2a'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H * 0.7); ctx.stroke(); }
  const bpm = Math.round(60 + (1 - Math.max(0, Math.min(1, hp))) * 60);
  const period = 60 / bpm;              // seconds per beat
  const speed = 90;                     // px per second of trace
  ctx.strokeStyle = '#5cff9a'; ctx.lineWidth = 2;
  ctx.beginPath();
  const base = H * 0.42;
  for (let x = 0; x < W; x++) {
    const tt = t - (W - x) / speed + seed;
    const ph = ((tt % period) + period) % period / period;
    let y = base;
    if (ph < 0.06) y = base - 6 * Math.sin(ph / 0.06 * Math.PI);
    else if (ph < 0.10) y = base + 10 * Math.sin((ph - 0.06) / 0.04 * Math.PI);
    else if (ph < 0.16) y = base - 40 * Math.sin((ph - 0.10) / 0.06 * Math.PI);
    else if (ph < 0.22) y = base + 12 * Math.sin((ph - 0.16) / 0.06 * Math.PI);
    else if (ph < 0.42) y = base - 8 * Math.sin((ph - 0.22) / 0.20 * Math.PI);
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#c8ffe0'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'left';
  ctx.fillText(`${bpm} bpm`, 8, H - 30);
  ctx.fillStyle = '#7fc4ff'; ctx.font = '14px monospace';
  ctx.fillText(`${label}  ${Math.round(hp * 100)}%`, 8, H - 10);
  return true;
}

/* ── the bodies ──────────────────────────────────────────────────────── */

function spawnBody(world, at, y, seed, name, role) {
  let body = null;
  try {
    body = world.spawnEnemy('res_borz_crew', new THREE.Vector3(at.x, y + 0.1, at.z),
      { team: world.player?.team ?? 0, person: lookFor(seed, 'human', 1) });
  } catch { return null; }
  if (!body) return null;
  body.team = world.player?.team ?? 0;
  body.stationResident = true;
  body.noAmbientHarm = true;
  body.stationName = name;
  body.stationRole = role;
  body.stationSpecies = 'human';
  body.stationPlace = WARD;
  body.stationSlot = -1;
  body.standCx = at.x; body.standCz = at.z;
  body.standTx = at.x; body.standTz = at.z;
  body.standFace = body.facing || 0;
  return body;
}

function removeBody(world, body) {
  if (!body) return;
  try { body.dispose?.(); } catch { /* gone */ }
  const i = world.enemies?.indexOf(body) ?? -1;
  if (i >= 0) world.enemies.splice(i, 1);
}

/** One frame of a body on the standing machinery: walk `standCx/standCz` to
 * `standTx/standTz`, write the position, face the way it is going. */
function stepBody(body, dt) {
  const p = body.position;
  if (!p) return true;
  const dx = body.standTx - body.standCx, dz = body.standTz - body.standCz;
  const d = Math.hypot(dx, dz);
  let mx = 0, mz = 0, arrived = true;
  if (d > 0.02) {
    const step = Math.min(d, PACE * dt);
    mx = dx / d * step; mz = dz / d * step;
    body.standCx += mx; body.standCz += mz;
    arrived = d - step <= 0.02;
  }
  p.x = body.standCx; p.z = body.standCz;
  body.body?.setTransform?.(p, null);
  if (body.velocity && dt > 0) body.velocity.set(mx / dt, 0, mz / dt);
  const want = (mx * mx + mz * mz) > 1e-9 ? Math.atan2(mx, mz) : body.standFace;
  if (Number.isFinite(body.facing)) {
    let a = want - body.facing;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    body.facing += a * Math.min(1, dt * 4);
  }
  return arrived;
}

/* ── dress / step / undress ──────────────────────────────────────────── */

export function dressHealing(world, st) {
  if (!world || !st || world._healing) return world?._healing || null;
  const rec = st.places?.get(WARD);
  if (!rec) return null;
  const place = rec.place;
  const y = floorOf(place);
  const H = {
    place, group: rec.group, y,
    medic: null, medicAt: -1, medicDwell: 0, medicMoving: false, visits: [],
    round: 0, tanks: tanksNow(), registerIn: 0,
    monitors: [], bubbles: [], walkers: [], walkedOut: [],
    t: 0, monitorIn: 0, monitorFrames: 0,
  };
  world._healing = H;

  const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xbfffe6, transparent: true, opacity: 0.55, toneMapped: false });
  const bubbleGeo = new THREE.SphereGeometry(0.045, 6, 5);
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw);
  for (let i = 0; i < TANKS; i++) {
    const [lx, , lz] = tankLocal(i, place.w, place.d);
    /* THE MONITOR, over the glass, facing the walk. */
    const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (canvas) { canvas.width = MON_W; canvas.height = MON_H; }
    const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
    if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; }
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x1a5a3a, toneMapped: false });
    mat.name = `station-sign-monitor${i}`;
    mat.userData.key = 'sign';
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), mat);
    mesh.name = `station-monitor-${i}`;
    const mz = lz - 0.85 - 0.3;
    mesh.position.set(place.x + lx * c + mz * s, y + place.h - 0.9, place.z - lx * s + mz * c);
    mesh.rotation.y = place.yaw + Math.PI;
    rec.group.add(mesh);
    H.monitors.push({ tank: i, mesh, canvas, texture: tex, material: mat, frames: 0, seed: hashF(`mon${i}`) * 3 });
    st.draws += 1;
    /* THE FLUID: a column of bubbles, shown only while the tank is lit. */
    const col = new THREE.Group();
    col.name = `station-bubbles-${i}`;
    col.position.set(place.x + lx * c + lz * s, y, place.z - lx * s + lz * c);
    const rows = [];
    for (let k = 0; k < BUBBLES; k++) {
      const b = new THREE.Mesh(bubbleGeo, bubbleMat);
      const a = hashF(`b${i}:${k}:a`) * Math.PI * 2;
      const r = 0.15 + hashF(`b${i}:${k}:r`) * 0.45;
      b.position.set(Math.sin(a) * r, 0.4, Math.cos(a) * r);
      col.add(b);
      rows.push({ mesh: b, phase: hashF(`b${i}:${k}:p`), rate: 0.35 + hashF(`b${i}:${k}:v`) * 0.35 });
    }
    col.visible = false;
    rec.group.add(col);
    H.bubbles.push({ tank: i, group: col, rows, span: place.h - 1.6 });
    st.draws += BUBBLES;
  }
  /* THE MEDIC, at the counter. */
  const counter = toWorld(place, -place.w / 2 + 2.6, -place.d / 2 + 1.8, {});
  H.counter = counter;
  H.medic = spawnBody(world, counter, y, 'medic:44', 'Medic', 'medic');
  if (H.medic) H.medic.standFace = place.yaw;
  return H;
}

/** Which tank the medic goes to next: the occupied tanks, in a seeded order. */
function nextTank(H, day) {
  const lit = [];
  for (let i = 0; i < TANKS; i++) if (H.tanks[i]) lit.push(i);
  if (!lit.length) return -1;
  const start = Math.floor(hashF(`round:${day | 0}`) * lit.length);
  const step = 1 + (Math.floor(hashF(`stride:${day | 0}`) * 3) % lit.length);
  let k = (start + H.round * step) % lit.length;
  if (lit[k] === H.medicAt && lit.length > 1) k = (k + 1) % lit.length;
  return lit[k];
}

function stepMedic(world, H, st, dt) {
  const m = H.medic;
  if (!m || m.dead || m.alive === false) return;
  const arrived = stepBody(m, dt);
  if (!arrived) { H.medicMoving = true; return; }
  if (H.medicMoving) {
    H.medicMoving = false;
    if (H.medicAt >= 0) H.visits.push({ tank: H.medicAt, who: H.tanks[H.medicAt] || null, t: H.t });
    m.standFace = H.place.yaw + (H.medicAt >= 0 ? 0 : Math.PI);
    H.medicDwell = DWELL;
    return;
  }
  H.medicDwell -= dt;
  if (H.medicDwell > 0) return;
  const next = nextTank(H, st.day);
  H.round++;
  if (next < 0) {
    if (H.medicAt === -1) { H.medicDwell = DWELL; return; }
    H.medicAt = -1;
    m.standTx = H.counter.x; m.standTz = H.counter.z;
  } else {
    H.medicAt = next;
    const at = bedside(H.place, next);
    m.standTx = at.x; m.standTz = at.z;
  }
}

/** A man off the register: sit up at the glass, walk to the door, out to the ring. */
function walkOut(world, H, tank, name) {
  const place = H.place;
  const at = bedside(place, tank);
  const body = spawnBody(world, at, H.y, `out:${name}`, name, 'trooper');
  if (!body) return;
  body.standFace = place.yaw + Math.PI;
  const door = { x: place.door[0], z: place.door[1] };
  const dx = door.x - place.x, dz = door.z - place.z;
  const d = Math.hypot(dx, dz) || 1;
  const out = { x: door.x + dx / d * 6, z: door.z + dz / d * 6 };
  H.walkers.push({ body, name, tank, legs: [door, out], leg: -1, sit: SIT_UP });
}

function stepWalkers(world, H, dt) {
  for (let i = H.walkers.length - 1; i >= 0; i--) {
    const w = H.walkers[i];
    const b = w.body;
    if (!b || b.dead || b.alive === false) { H.walkers.splice(i, 1); continue; }
    if (w.sit > 0) { w.sit -= dt; stepBody(b, dt); continue; }
    if (w.leg < 0) { w.leg = 0; b.standTx = w.legs[0].x; b.standTz = w.legs[0].z; }
    const arrived = stepBody(b, dt);
    if (!arrived) continue;
    w.leg++;
    if (w.leg >= w.legs.length) {
      H.walkedOut.push(w.name);
      world.notify?.('BACTA WARD', `${w.name} walks out on his own feet`);
      removeBody(world, b);
      H.walkers.splice(i, 1);
      continue;
    }
    b.standTx = w.legs[w.leg].x; b.standTz = w.legs[w.leg].z;
  }
}

export function stepHealing(world, st, dt) {
  const H = world?._healing;
  if (!H || !(dt > 0)) return;
  H.t += dt;
  /* THE REGISTER, on a half-second beat: a tank that went dark is a man out. */
  H.registerIn -= dt;
  if (H.registerIn <= 0) {
    H.registerIn = REGISTER_EVERY;
    const now = tanksNow();
    /* One parse of the roll per beat; the monitors read this copy. */
    try { H.company = companyOf(); } catch { H.company = null; }
    for (let i = 0; i < TANKS; i++) {
      const was = H.tanks[i], is = now[i];
      if (was && !is) walkOut(world, H, i, nameOf(manNamed(was, H.company) || { designation: was }) || was);
    }
    H.tanks = now;
  }
  /* THE FLUID. */
  for (const col of H.bubbles) {
    const on = !!H.tanks[col.tank];
    if (col.group.visible !== on) col.group.visible = on;
    if (!on) continue;
    for (const r of col.rows) {
      const u = (H.t * r.rate + r.phase) % 1;
      r.mesh.position.y = 0.35 + u * col.span;
    }
  }
  /* THE MONITORS, at 8 fps, only lit tanks. */
  H.monitorIn -= dt;
  if (H.monitorIn <= 0) {
    H.monitorIn = MONITOR_EVERY;
    for (const mon of H.monitors) {
      const who = H.tanks[mon.tank];
      const ctx = mon.canvas?.getContext?.('2d');
      if (!ctx) continue;
      if (!who) {
        if (mon.blank) continue;
        mon.blank = true;
        ctx.fillStyle = '#04110c'; ctx.fillRect(0, 0, MON_W, MON_H);
        if (mon.texture) mon.texture.needsUpdate = true;
        continue;
      }
      mon.blank = false;
      const rec = manNamed(who, H.company);
      paintMonitor(ctx, MON_W, MON_H, H.t, rec ? hpOf(rec) : 0.5, nameOf(rec || { designation: who }) || who, mon.seed);
      if (mon.texture) mon.texture.needsUpdate = true;
      mon.frames++;
      H.monitorFrames++;
    }
  }
  stepMedic(world, H, st, dt);
  stepWalkers(world, H, dt);
}

/** How many the ward holds — the number that falls as men heal. */
export function wardCount(world) {
  const H = world?._healing;
  const tanks = H ? H.tanks : tanksNow();
  return tanks.filter(Boolean).length;
}

export function undressHealing(world) {
  const H = world?._healing;
  if (!H) return;
  removeBody(world, H.medic);
  for (const w of H.walkers) removeBody(world, w.body);
  H.walkers.length = 0;
  for (const m of H.monitors) {
    m.mesh.parent?.remove(m.mesh);
    m.mesh.geometry?.dispose?.(); m.texture?.dispose?.(); m.material?.dispose?.();
  }
  for (const b of H.bubbles) b.group.parent?.remove(b.group);
  if (H.bubbles[0]?.rows[0]) { H.bubbles[0].rows[0].mesh.geometry?.dispose?.(); H.bubbles[0].rows[0].mesh.material?.dispose?.(); }
  H.monitors.length = 0; H.bubbles.length = 0;
  world._healing = null;
}
