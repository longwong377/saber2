/**
 * ══════════════════════════════════════════════════════════════════════════
 *  #55 THE STATION'S OUTSIDE — a LEVEL, and it is the station seen from a seat
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §3.2's last row is not a room:
 *
 *   #55  deck null  "The station's outside"  shape `orbit`
 *        "from the Starfury: the hull, the drum, the flight deck's mouth, the
 *         docking throat, the dome"
 *        who: the fleet · idle: the war · verb: fly
 *
 * Five named sights, and the whole value of the row is that it names them: the
 * outside is not "space", it is THIS STATION from a hundred metres off, and
 * the only way to build that badly is to fly around a sphere with a texture on
 * it. So this file is where the five are, in world metres, and the circuit
 * that passes all five.
 *
 * ── WHY EVERY NUMBER IN IT IS DERIVED ─────────────────────────────────────
 *
 * `StationPlan.js`'s header: *"Four separate things have to agree about where
 * a place is, and the deck this station is bolted to has the scar to prove
 * what happens when they each keep their own copy."* The outside is a fifth
 * reader and it is the one that would be hardest to notice was wrong — a
 * docking throat drawn forty metres from where Arrivals actually opens onto it
 * looks fine from outside and is a different station.
 *
 * So NOTHING HERE IS TYPED. The hull's envelope is measured off the gazetteer's
 * own footprints deck by deck, the throat is `PLACE.get(8)`, the dome is
 * `PLACE.get(54)`, and the flight deck's mouth is on the bearing of the
 * centroid of the five flight-ops rooms — because the deck runs outboard from
 * the FLIGHT shaft and its mouth is where that run breaks the skin.
 * `Hangar.js` owns the deck's INTERIOR frame (`DECK`, and its aperture's local
 * +Z); this is the same opening from the other side, and it is derived rather
 * than copied so the two cannot drift.
 *
 * ── WHAT IT IMPORTS, AND WHY ──────────────────────────────────────────────
 *
 * `StationPlan.js` and nothing else — the gazetteer, which is the file whose
 * whole job is to be the one answer to where anything is. No THREE (a point is
 * three numbers), no world, no `Hangar.js` (that import is a cycle: `Station`
 * already imports both). A sight is a record and a circuit is a list of them,
 * so `flightops.mjs` measures the clearance of the whole loop with no scene.
 */

import { DECKS, DECK_Y, DRUM, PLACE, PLACES, placesOn, footprint } from './StationPlan.js';

const D2R = Math.PI / 180;
/** The plan's own convention: a bearing is degrees, zero down +Z, +X positive. */
const polar = (r, deg) => [r * Math.sin(deg * D2R), r * Math.cos(deg * D2R)];
const bearingOf = (x, z) => (Math.atan2(x, z) / D2R + 360) % 360;

/* ══════════════════════════════════════════════════════════════════════════
 *  1. THE HULL, AS AN ENVELOPE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A band per deck: how far out that deck reaches, and between which heights.
 * The station is a spindle rather than a cylinder — the drum is 180 m across
 * with a flight deck slung under it, a launch well under that, and a dome on
 * top — and a circuit flown against one radius would either clip the throat or
 * stand off the dome by a hundred metres.
 *
 * ── THE ONE ROW THAT IS EXCLUDED, AND WHY IT IS NAMED ─────────────────────
 *
 * `#26 The Promenade` has `band: 'ring'`, and `StationPlan.layout` gives a ring
 * a `w` of the FULL CIRCUMFERENCE (537 m) because a ring has no centre and no
 * width in the sense the other fifty rows use. Its footprint is therefore a
 * 537 m box through the middle of the station, and folded into a max it puts
 * the hull's radius at 283 m. It is excluded by name; every other place, tram
 * platforms and docking throat included, counts.
 */
export function hullBands() {
  const bands = [];
  for (const deck of DECKS) {
    const here = placesOn(deck).filter((p) => p.band !== 'ring');
    if (!here.length) continue;
    let r = 0, h = 0;
    const f = { x0: 0, z0: 0, x1: 0, z1: 0 };
    for (const p of here) {
      footprint(p, f);
      r = Math.max(r,
        Math.hypot(f.x0, f.z0), Math.hypot(f.x1, f.z1),
        Math.hypot(f.x0, f.z1), Math.hypot(f.x1, f.z0));
      h = Math.max(h, p.h || 0);
    }
    /* The three drum decks are at least the drum, whatever stands on them, and
     * at deck 44 they are at least the tram guideway — which is outside the
     * skin (§3.1) and is a thing you would fly into. */
    if (deck === 40 || deck === 44 || deck === 48) r = Math.max(r, DRUM.R);
    if (deck === 44) r = Math.max(r, DRUM.tramR);
    const y = DECK_Y[deck] ?? 0;
    /* 3.5 m of structure under a floor: `StationPlan.DECK_Y`'s own note says a
     * deck is 12.5 m of which 8.2 is walkable, and the rest is what the next
     * one stands on. Half of it hangs below. */
    bands.push({ deck, y0: y - 3.5, y1: y + Math.max(h, DRUM.storey), r });
  }
  return bands;
}

const BANDS = hullBands();

/** How far the hull reaches at a height. Zero above the dome and below the
 *  well, which is what makes "over the top" a real place to fly. */
export function hullRadiusAt(y) {
  let r = 0;
  for (const b of BANDS) if (y >= b.y0 && y <= b.y1) r = Math.max(r, b.r);
  return r;
}

/** The whole envelope, for anything that wants to know how big it is. */
export const HULL = Object.freeze({
  get bands() { return BANDS; },
  r: BANDS.reduce((a, b) => Math.max(a, b.r), 0),
  y0: BANDS.reduce((a, b) => Math.min(a, b.y0), 0),
  y1: BANDS.reduce((a, b) => Math.max(a, b.y1), 0),
});

/* ══════════════════════════════════════════════════════════════════════════
 *  2. THE FIVE SIGHTS — §3.2 #55's own list, in order
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Where the flight deck's mouth breaks the skin.
 *
 * The five flight-ops rooms are laid out in the hangar's own cartesian frame
 * (`band: 'deck32'`/`'deck12'`, which `StationPlan.layout` passes straight
 * through), so their centroid IS the direction the deck runs from the axis,
 * and the mouth is that bearing at the hull. Nothing is typed: move a room in
 * the gazetteer and the mouth moves with it, which is the property the four
 * readers of that table were given in the first place.
 */
export function mouthBearing() {
  const rooms = PLACES.filter((p) => p.band === 'deck32' || p.band === 'deck12');
  let x = 0, z = 0;
  for (const p of rooms) { x += p.x; z += p.z; }
  return bearingOf(x / rooms.length, z / rooms.length);
}

/** Which face of the drum the circuit flies past, in the plan's bearings. 300
 *  is the stretch between the promenade's night market and its star bay, and
 *  it is clear of the docking throat at 180 and of the flight deck at 125. */
export const DRUM_FACE = 300;

/** The five, each with where it is, how big it reads, and what it looks like. */
export function sights() {
  const throat = PLACE.get(8);
  const dome = PLACE.get(54);
  const mb = mouthBearing();
  const [mx, mz] = polar(hullRadiusAt(DECK_Y[32]), mb);
  const [dx, dz] = polar(DRUM.R, DRUM_FACE);
  const [tx, tz] = polar(Math.hypot(throat.x, throat.z) + throat.d / 2, bearingOf(throat.x, throat.z));
  return [
    {
      id: 'hull', name: 'the hull', at: [0, (HULL.y0 + HULL.y1) / 2, 0], r: HULL.r,
      look: 'the whole ship end on: a drum with a flight deck slung under it and a dome on top',
      /* IN FRAME THE WHOLE TIME, and therefore never the answer to "what are
       * you passing". The circuit flies inside the hull's bounding sphere for
       * the whole loop by construction, so a `nearest` that ranked it would
       * return `hull` at every sample and the other four would never be
       * named — which is exactly what the first survey printed. */
      always: true,
    },
    {
      /* The drum is a cylinder and has no one place on it, so the sight is the
       * stretch of skin the circuit actually flies past — bearing 300, deck 44,
       * which is the promenade's window wall and the one face of this station
       * with people visible in it. */
      /* `r` IS THE PATCH, NOT THE CYLINDER. The drum's own radius is 90 m and
       * a sight that big is nearer than everything else from everywhere,
       * including from directly over the dome — which is what the survey read
       * before this line was 25. Twenty-five metres is the stretch of window
       * wall a fighter at the standoff actually has in frame. */
      id: 'drum', name: 'the drum', at: [dx, DECK_Y[44], dz], r: 25,
      look: 'three decks of window wall going past, and people at them',
    },
    {
      id: 'mouth', name: "the flight deck's mouth", at: [mx, DECK_Y[32], mz], r: 34,
      look: 'a lit hexagon in a dark underside, with the field holding the air in',
    },
    {
      id: 'throat', name: 'the docking throat', at: [tx, DECK_Y[40], tz], r: throat.d,
      look: 'a shuttle nose-in on the collar, umbilicals across, the ramp down',
    },
    {
      id: 'dome', name: 'the observation dome', at: [dome.x, DECK_Y[60] + (dome.h || 7.5) / 2, dome.z],
      r: Math.max(dome.w, dome.d) / 2,
      look: 'the glass on the top of the station, lit from inside, with people under it',
    },
  ];
}

const SIGHTS = sights();
/** By id, for a caller that wants one of them. */
export const SIGHT = new Map(SIGHTS.map((s) => [s.id, s]));

/* ══════════════════════════════════════════════════════════════════════════
 *  3. THE CIRCUIT — one closed loop that passes all five
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHY A TRACK AND NOT A FLIGHT MODEL ────────────────────────────────────
 *
 * `Starfury.js` is a real 6-DOF Newtonian craft, ported clause for clause and
 * held by `starfury.mjs` — and it is not wired to anything here. That is
 * deliberate and it is the honest half of this lane: a placeholder flight
 * model is worse than no flight model, because it is the thing everybody would
 * then measure the room against. What #55 needs FIRST is somewhere to fly, and
 * somewhere to fly is these five sights and a path that shows you all of them.
 *
 * So this is a track: a closed polyline outside the hull, arc-length sampled,
 * that a camera on a rail flies today and a Starfury flies when there is one
 * to fly it. Every number in it is measured by `flightops.mjs`: the clearance
 * from the hull at every sample, the closest approach to each of the five, and
 * that the loop closes.
 *
 * ── WHERE IT STARTS ───────────────────────────────────────────────────────
 *
 * At the mouth, because that is where `Launch.js` puts you. A circuit whose
 * first waypoint was anywhere else would need a leg from the well to the
 * track, which is a second path nobody measured.
 */

/** How far off the hull the track stands, in metres. */
export const STANDOFF = 45;
/** The bar the circuit is held to: never closer than this to the envelope. */
export const CLEAR = 25;
/** And it has to actually SHOW you each sight: closest approach, metres. */
export const VIEW = 90;

/**
 * The legs, as (bearing, height) — the radius is the envelope's at that height
 * plus the standoff, so the track hugs the shape of the station rather than
 * describing a circle round the biggest part of it.
 *
 * `over` is the one waypoint that is not radial: above the dome, where the
 * envelope is nothing and a standoff off the axis would put you inside it.
 */
const LEGS = [
  { at: null, y: DECK_Y[32], sight: 'mouth' },            // filled from mouthBearing()
  { at: 152, y: DECK_Y[32] + 6 },
  { at: 180, y: DECK_Y[40], sight: 'throat' },
  { at: 232, y: DECK_Y[44] },
  { at: DRUM_FACE, y: DECK_Y[44], sight: 'drum' },
  { at: 340, y: DECK_Y[48] + 10 },
  /**
   * ── THE CLIMB IS AT THE OUTER RADIUS, AND THAT IS THE WHOLE FIX ─────────
   *
   * The first cut went straight from the drum's shoulder to a point over the
   * dome, and `survey()` measured the track FORTY-TWO METRES INSIDE the hull
   * at u = 0.72: a leg between two clear points is not itself clear, because
   * the radius interpolates linearly while the envelope steps. Nothing about
   * the two endpoints said so.
   *
   * So the climb happens at `hold` — the station's widest radius plus the
   * standoff, whatever height you are at — and the turn inboard happens only
   * above y = 55, where §3.2 #48's thirty-metre reactor hall (the tallest
   * thing on this station, not the dome) has been left behind and the envelope
   * is genuinely nothing. Two extra waypoints, and the survey now reads +45.
   */
  { at: 355, y: HULL.y1 + 9, hold: true },
  { at: 20, y: HULL.y1 + 15, over: true, sight: 'dome' },
  { at: 60, y: HULL.y1 + 9, hold: true },
  { at: 74, y: DECK_Y[40] },
  { at: 100, y: DECK_Y[32] + 4 },
];

/** The circuit, as waypoints — a bearing, a radius and a height each, in order
 *  and closed. `x`/`z` are carried too, because most readers want the point. */
export function circuit() {
  const mb = mouthBearing();
  return LEGS.map((L) => {
    const at = L.at == null ? mb : L.at;
    /* Three radii and they are all derived from the envelope:
     *   over  the standoff alone — genuinely ABOVE the station, which is the
     *         only angle the dome reads from
     *   hold  the widest the station ever is, for a leg that changes height
     *         and must not cut the corner off a step in the envelope
     *   else  this height's own reach plus the standoff, so the track hugs
     *         the shape rather than circling the biggest part of it */
    const r = (L.over ? 0 : L.hold ? HULL.r : hullRadiusAt(L.y)) + STANDOFF;
    const [x, z] = polar(r, at);
    return { x, y: L.y, z, at, r, sight: L.sight || null };
  });
}

const TRACK = circuit();

/**
 * ══ THE LEGS ARE ARCS, NOT CHORDS, AND THAT IS ALSO MEASURED ══════════════
 *
 * Interpolating two waypoints in world XZ draws a straight line between two
 * points on a circle, which cuts the corner: the leg from bearing 232 to
 * bearing 300 stood off at 147 m and sagged to 122 m in the middle, against a
 * hull that reaches 106 there — nineteen metres of clearance where the two
 * ends both read forty-one. `survey()` found it; nothing about the waypoints
 * could have.
 *
 * Flying round a station is an arc anyway, so the parameterisation is polar:
 * the bearing sweeps, the radius and the height lerp, and the world point
 * falls out. A chord is now something you would have to ask for.
 */
const shortWay = (a, b) => { let d = (b - a) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };

function pointOn(i, k) {
  const a = TRACK[i], b = TRACK[(i + 1) % TRACK.length];
  const at = a.at + shortWay(a.at, b.at) * k;
  const r = a.r + (b.r - a.r) * k;
  const y = a.y + (b.y - a.y) * k;
  const [x, z] = polar(r, at);
  return { x, y, z, at, r, leg: i };
}

/** How long the loop is, and the length of each leg. Sampled rather than
 *  solved: an arc whose radius and height both change has no short closed
 *  form worth the two lines it would save. */
function measure() {
  const legs = [];
  let total = 0;
  for (let i = 0; i < TRACK.length; i++) {
    let d = 0, prev = pointOn(i, 0);
    for (let k = 1; k <= 16; k++) {
      const q = pointOn(i, k / 16);
      d += Math.hypot(q.x - prev.x, q.y - prev.y, q.z - prev.z);
      prev = q;
    }
    legs.push(d); total += d;
  }
  return { legs, total };
}
const SPAN = measure();

/** How far round the circuit is, in metres. */
export const CIRCUIT_LENGTH = SPAN.total;

/**
 * A point on the circuit. `u` is 0..1 round the loop and WRAPS, so a caller
 * that adds `speed * dt / CIRCUIT_LENGTH` every frame never has to think about
 * the end of it.
 *
 * Arc-length parameterised, not index-parameterised: the legs are between 60
 * and 200 m long and an index sweep would fly the short ones at a crawl.
 */
export function sample(u) {
  const t = ((u % 1) + 1) % 1;
  let want = t * SPAN.total;
  let i = 0;
  while (i < SPAN.legs.length - 1 && want > SPAN.legs[i]) { want -= SPAN.legs[i]; i++; }
  const k = SPAN.legs[i] > 0 ? want / SPAN.legs[i] : 0;
  const p = pointOn(i, k);
  p.u = t;
  const near = nearest(p);
  p.near = near.sight.id;
  p.nearName = near.sight.name;
  p.nearDist = near.d;
  return p;
}

/** Which of the five you are nearest, and how far off it you are. */
export function nearest(p) {
  let best = SIGHTS[1], bd = Infinity;
  for (const s of SIGHTS) {
    if (s.always) continue;
    const d = Math.max(0, Math.hypot(p.x - s.at[0], p.y - s.at[1], p.z - s.at[2]) - s.r);
    if (d < bd) { bd = d; best = s; }
  }
  return { sight: best, d: bd };
}

/** How far outside the hull a point is. Negative means inside it, which is the
 *  one number the whole track is measured against. */
export function clearanceAt(p) {
  return Math.hypot(p.x, p.z) - hullRadiusAt(p.y);
}

/**
 * The whole track, measured: the tightest clearance and the closest approach to
 * each of the five. `flightops.mjs` prints both and asserts on them, rather
 * than this file declaring that the circuit is clear.
 */
export function survey(steps = 2000) {
  let tight = Infinity, tightAt = 0;
  const closest = new Map(SIGHTS.map((s) => [s.id, Infinity]));
  for (let i = 0; i < steps; i++) {
    const p = sample(i / steps);
    const c = clearanceAt(p);
    if (c < tight) { tight = c; tightAt = i / steps; }
    for (const s of SIGHTS) {
      /* Distance to the sight's SURFACE, floored at nought: `hull` and `drum`
       * are bodies a hundred metres across and the track flies inside their
       * bounding spheres for most of the loop, which is not a negative
       * distance, it is being right up against them. */
      const d = Math.max(0, Math.hypot(p.x - s.at[0], p.y - s.at[1], p.z - s.at[2]) - s.r);
      if (d < closest.get(s.id)) closest.set(s.id, d);
    }
  }
  return { tight, tightAt, closest, length: SPAN.total, legs: TRACK.length };
}

/**
 * What you are looking at, in words — the line #55's verb is worth. `Station.js`
 * raises it as the sortie passes each of the five, which is the whole of what
 * "fly" means until something with thrusters is flying it.
 */
export function sightLine(id) {
  const s = SIGHT.get(id);
  return s ? `${s.name} — ${s.look}` : null;
}
