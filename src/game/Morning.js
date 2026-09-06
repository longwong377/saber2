/**
 * A MORNING — V18 cool 8: *"shutters going up, the ranges lit one by one, the
 * first tram."*
 *
 * The station had a clock (§3.4, `Station.tickStationClock`) and a night on
 * it — the small hours' test card, the cantina's late crowd, the market at
 * ten — but nothing on the ring ever CLOSED. At 03:00 the chandler's window
 * was lit and stocked, the way-kiosk's three screens ran adverts to nobody,
 * and every strip on the drum burned at the same three units it burns at
 * noon. A station with no morning has no night either.
 *
 * So, on the station clock and nothing else:
 *
 *   23:00 → 23:30  the SHUTTERS come down: a slab of `M.dark` across every
 *                  shopfront, every kiosk screen and every market stall on the
 *                  ring (`StationPlan.WAYS` kinds 'shopfront', 'kiosk',
 *                  'market'), sliding down over half an hour of station time;
 *                  the ring's STRIPS dim to `NIGHT_LIT` of their day level,
 *                  sector by sector, the way they came on.
 *   06:00 → 06:30  the shutters go UP, and are hidden once they are.
 *   06:00 → 07:00  the strips come on ONE SECTOR AT A TIME: twelve thirty-
 *                  degree runs of `M.strip` round the ring soffit, from the
 *                  0° spine clockwise, one every five station minutes, and the
 *                  deck's own strip material comes up with them.
 *   06:00          the FIRST TRAM of the day service, called on the tannoy
 *                  in the station's own voice on the frame the clock crosses
 *                  six. The loop itself runs a night service — `stationlife`
 *                  measures the car moving at every hour a row can fire, so
 *                  it is not held.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────
 *
 * It makes no material: the shutters are `M.dark`, the sector runs `M.strip`,
 * both off `stationMats` (§9.1's nine). It keeps no clock: everything is a
 * function of `st.hour`, and a world dressed at 05:00 is shuttered on its
 * first frame. It does not touch the light rig — `StationLife.stepDip` owns
 * that, and a morning that fought a surge for the key light would be two
 * writers on one number. And nothing here rolls (`determinism.mjs`).
 *
 * `morningPhase(hour)` is the whole of the schedule, pure, so a check can
 * read what 05:00 or 06:30 MEANS without a world.
 */
import * as THREE from '../../vendor/three/three.module.js';
import { DRUM, DECK_Y } from './StationPlan.js';
import { speak } from './Voice.js';

/** When the shutters go up / the strips start, station hours. */
export const OPEN_AT = 6;
/** The shutters take half an hour; the strips take the hour. */
export const SHUTTER_MINS = 30;
export const STRIPS_TO = 7;
/** When the ring closes for the night. */
export const CLOSE_AT = 23;
/** The strips' night level, as a fraction of the day's. */
export const NIGHT_LIT = 0.3;
/** How many sector runs round the ring. */
export const SECTORS = 12;
/** The kinds on the ring that get a shutter. */
export const SHUTTERED = new Set(['shopfront', 'kiosk', 'market']);

const RIN = DRUM.ringW / 2;
const TAU = Math.PI * 2;

/**
 * The schedule, pure. `shut` is how far DOWN the shutters are (1 = closed),
 * `lit` the strips' level as a fraction of the day's, `sectors` how many of
 * the ring's runs are on, `open` whether the ring counts as open.
 */
export function morningPhase(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  const half = SHUTTER_MINS / 60;
  let shut, lit, sectors;
  if (h < OPEN_AT) { shut = 1; lit = NIGHT_LIT; sectors = 0; }
  else if (h < OPEN_AT + half) { shut = 1 - (h - OPEN_AT) / half; lit = NIGHT_LIT + (1 - NIGHT_LIT) * (h - OPEN_AT) / (STRIPS_TO - OPEN_AT); sectors = 0; }
  else if (h < STRIPS_TO) { shut = 0; lit = NIGHT_LIT + (1 - NIGHT_LIT) * (h - OPEN_AT) / (STRIPS_TO - OPEN_AT); sectors = 0; }
  else if (h < CLOSE_AT) { shut = 0; lit = 1; sectors = SECTORS; }
  else if (h < CLOSE_AT + half) { shut = (h - CLOSE_AT) / half; lit = 1 - (1 - NIGHT_LIT) * (h - CLOSE_AT) / half; sectors = 0; }
  else { shut = 1; lit = NIGHT_LIT; sectors = 0; }
  /* The sectors, one every (60 / SECTORS) minutes from six; going down again
   * from eleven, in the same order. */
  if (h >= OPEN_AT && h < STRIPS_TO) sectors = Math.min(SECTORS, Math.floor((h - OPEN_AT) * SECTORS) + 1);
  else if (h >= CLOSE_AT && h < CLOSE_AT + half) sectors = Math.max(0, SECTORS - Math.floor((h - CLOSE_AT) / half * SECTORS) - 1);
  return { shut, lit, sectors, open: shut <= 0 };
}

/** Where a ring fixture stands, in world — the same three bands `buildWays` uses. */
function wayFrame(w, deck) {
  const y = DECK_Y[deck] ?? 0;
  const r = w.band === 'spine' ? w.r : w.band === 'rim' ? DRUM.balcony : DRUM.ringR;
  const a = w.at * Math.PI / 180;
  return { x: r * Math.sin(a), y, z: r * Math.cos(a), yaw: a };
}

/** One shutter: a slab of `M.dark` that rolls up by its own height. */
function shutter(parent, M, w, h, d, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.dark);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.userData.y0 = y; m.userData.h = h;
  parent.add(m);
  return m;
}

/**
 * Build the shutters and the sector runs. Returns the count of meshes, and
 * publishes `st.morning` for the step and for a check.
 */
export function dressMorning(world, st) {
  if (!world?.scene || !st) return 0;
  const M = st.mats;
  const deck = st.deck;
  const g = new THREE.Group();
  g.name = 'station-morning';
  const shutters = [];
  for (const w of st.ways || []) {
    if (!SHUTTERED.has(w.kind)) continue;
    const f = wayFrame(w, deck);
    const fx = new THREE.Group();
    fx.name = `morning-${w.kind}-${w.at}`;
    fx.position.set(f.x, f.y, f.z);
    fx.rotation.y = f.yaw;
    g.add(fx);
    if (w.kind === 'shopfront') {
      /* Across the whole glazed frontage, just proud of the hull line and
       * behind the awning's root. */
      shutters.push(shutter(fx, M, 9, 3.9, 0.12, 0, 1.95, -RIN + 0.45));
    } else if (w.kind === 'kiosk') {
      /* One over each of the three screens. */
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + i * (TAU / 6);
        shutters.push(shutter(fx, M, 1.25, 1.2, 0.06, 1.5 * Math.sin(a), 1.6, 1.5 * Math.cos(a), a));
      }
    } else if (w.kind === 'market') {
      /* The three stalls, at the kit's own three frames, a slab under each
       * canopy's front edge. */
      const at = [[-4.2, -RIN + 1.7, 0.0, 2.7], [0.2, RIN - 2.0, Math.PI, 3.0], [4.4, -RIN + 2.4, 0.25, 2.5]];
      for (let i = 0; i < at.length; i++) {
        const [x, z, ry, ch] = at[i];
        const stall = new THREE.Group();
        stall.position.set(x, 0, z); stall.rotation.y = ry;
        fx.add(stall);
        shutters.push(shutter(stall, M, 3.2 + i * 0.4, ch - 0.3, 0.08, 0, (ch - 0.3) / 2, -1.5));
      }
    }
    w.shuttered = true;
  }
  /* The sector runs: twelve arcs of `M.strip` under the ring soffit. */
  const sectors = [];
  const y = (DECK_Y[deck] ?? 0) + DRUM.storey - 0.3;
  const arc = TAU / SECTORS - 0.03;
  const geo = new THREE.TorusGeometry(DRUM.ringR, 0.07, 4, 10, arc);
  geo.rotateX(-Math.PI / 2);
  for (let i = 0; i < SECTORS; i++) {
    const m = new THREE.Mesh(geo, M.strip);
    m.name = `morning-sector-${i}`;
    m.position.y = y;
    /* The torus arc starts at bearing 90° once it lies flat; turn it so this
     * run covers [i, i+1) × 30° clockwise from the 0° spine. */
    m.rotation.y = i * (TAU / SECTORS) - Math.PI / 2;
    m.visible = false;
    g.add(m);
    sectors.push(m);
  }
  world.scene.add(g);
  st.morning = {
    group: g, shutters, sectors, geo,
    base: M.strip.emissiveIntensity,
    shut: -1, lit: -1, on: -1,
    /** The tannoy: `{ day, at }` of the last first-tram call. */
    firstTram: null,
    lastHour: st.hour,
  };
  const ph = morningPhase(st.hour);
  applyMorning(st, ph);
  applyStrips(st, world._stationLife, ph);
  return shutters.length + sectors.length;
}

/** Put the phase on the meshes and the material. Writes only what changed. */
function applyMorning(st, ph) {
  const mo = st.morning;
  if (!mo) return;
  if (ph.shut !== mo.shut) {
    mo.shut = ph.shut;
    for (const m of mo.shutters) {
      m.position.y = m.userData.y0 + m.userData.h * (1 - ph.shut);
      m.visible = ph.shut > 0.005;
    }
  }
  if (ph.sectors !== mo.on) {
    mo.on = ph.sectors;
    for (let i = 0; i < mo.sectors.length; i++) mo.sectors[i].visible = i < ph.sectors;
  }
  mo.lit = ph.lit;
}

/**
 * The strips' level. Every frame rather than on change, because
 * `StationLife.stepDip` restores `userData.dip0` — the DAY level — when a
 * surge ends, and a night that only wrote on the half-hour would be lit like
 * noon from then until six. While a dip is running the dip owns the number.
 */
function applyStrips(st, life, ph) {
  const mo = st.morning, m = st.mats?.strip;
  if (!mo || !m) return;
  if (m.userData.dip0 === undefined) m.userData.dip0 = mo.base;
  if (life?.dip > 0.001) return;
  const want = mo.base * ph.lit;
  if (m.emissiveIntensity !== want) m.emissiveIntensity = want;
}

const _paAt = new THREE.Vector3();

/** The morning, once a frame: the phase, the tram, the tannoy. */
export function stepMorning(world, st, dt) {
  const mo = st?.morning;
  if (!mo || !(dt > 0)) return;
  const hour = Number(st.hour) || 0;
  const ph = morningPhase(hour);
  applyMorning(st, ph);
  const life = world?._stationLife;
  applyStrips(st, life, ph);
  /* THE FIRST TRAM OF THE DAY SERVICE, on the frame the clock crosses six —
   * and only on a clock that is RUNNING forward through it, not one wound
   * past it by a sleep (`Sleep.js`) or set by a check. The car itself is not
   * held overnight: `stationlife.mjs` measures that the loop runs at every
   * hour a row can fire, and a station's tram runs a night service. */
  const prev = mo.lastHour;
  mo.lastHour = hour;
  const crossed = prev < OPEN_AT && hour >= OPEN_AT && hour - prev < 0.5;
  if (crossed && !world?._sleep?.active && mo.firstTram?.day !== (st.day | 0)) {
    mo.firstTram = { day: st.day | 0, at: hour };
    const line = life?.tram?.car ? 'first tram of the day is leaving — the ring is opening'
      : 'first tram of the day is running on the Living deck — the ring is opening';
    const head = `${String(st.name || 'STATION').toUpperCase()} CONTROL`;
    const p = world.player?.position;
    _paAt.set(p ? p.x : 0, (DECK_Y[st.deck] ?? 0) + DRUM.storey, p ? p.z : 0);
    try { speak(`${head} — 0600 hours, ${line}`, 'tannoy', { pos: _paAt, gain: 0.8 }); } catch { /* no synth */ } // V20 lane 4
    world.notify?.(head, `0600 hours — ${line}`);
  }
}

/** Take it down. */
export function undressMorning(world) {
  const st = world?._station;
  const mo = st?.morning;
  if (!mo) return;
  mo.group.parent?.remove(mo.group);
  for (const m of mo.shutters) m.geometry?.dispose?.();
  mo.geo?.dispose?.();
  const m = st.mats?.strip;
  if (m) m.emissiveIntensity = mo.base;
  st.morning = null;
}
