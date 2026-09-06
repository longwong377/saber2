/**
 * ══════════════════════════════════════════════════════════════════════════
 *  STATION SOUND — beds, not levels; and a PA with something to say (V18 hole 7)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The station had ONE bed per deck — `Station.setDeckBed` hands `Audio.
 * setAmbience` a drone level and that was the whole of what a room sounded
 * like — and a tannoy with three lines on a rota. This file is the rest:
 *
 *   THE BEDS       one synthesised bed per KIND OF PLACE, all built once on
 *                  the engine's own noise buffer and oscillators, all running
 *                  at once behind a gain each, and CROSSFADED (`XFADE` s) as
 *                  `Station.placeUnder` says which room the player is in.
 *                  Cantina: crowd murmur and a band's slow bass pulse.
 *                  Concourse: crowd and a tannoy shimmer. Medbay: monitors'
 *                  beeps. Reactor hall: a deep hum. Arboretum: chirps and
 *                  water. The ring: air handlers, and the TRAM — a held voice
 *                  whose gain is a real distance law off the car's position.
 *   THE PA         `PA_KINDS` seeded lines — arrivals, departures, a lost
 *                  child, the day's weather (`StationEvents.weatherAt`),
 *                  market day, the 20:00 vigil, lights-out and the rest —
 *                  spoken through `Audio.radio` with a two-tone chime before
 *                  them, and read as a banner, at most one per `PA_EVERY`
 *                  station-minutes (45 min, which is 90 real seconds on the
 *                  station's 2-min hour). `stepPA` takes over `Station.
 *                  stepTannoy`'s slot and writes the same `st.pa` record, so
 *                  everything that read the old tannoy reads this one.
 *
 * Everything goes to `audio.ambBus` — under the master and its volume, so the
 * player's volume and mute settings hold — and the teardown is registered with
 * `audio.hold`, so `World.unload` releases it whether or not `undress` runs.
 *
 * No `Math.random`: the rota is a hash of the day and the call number.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { audio } from '../engine/Audio.js';
import { placeUnder } from './Station.js';
import { DECK_Y, DRUM } from './StationPlan.js';
import { stationName, DEFAULT_NAME } from './StationSave.js';
import { weatherAt } from './StationEvents.js';
import { boardAt } from './FlightOps.js';
import { racesOn, VENUES } from './Tote.js';
import { occupied } from './Medbay.js';
import { companyOf } from './StationBoards.js';

/** Seconds a crossfade between beds takes (to ~95%). */
export const XFADE = 1.5;
/** Seconds between attempts to build the graph while the engine is not ready. */
const REARM = 1.0;
/** Station minutes between PA calls — 90 real seconds. */
export const PA_EVERY = 45;
/** The tram's distance law: half power at this many metres. */
export const TRAM_HALF = 22;
export const TRAM_MAX = 140;

/** Which bed a place gets. Null place is the ring. */
export function bedFor(place) {
  if (!place) return 'ring';
  switch (place.id | 0) {
    case 14: case 59: return 'cantina';
    case 9: case 7: case 17: case 40: return 'concourse';
    case 43: case 44: return 'medbay';
    case 48: case 49: return 'reactor';
    case 23: case 15: return 'arboretum';
    default: return place.band === 'ring' ? 'ring' : 'room';
  }
}

export const BED_KEYS = Object.freeze(['cantina', 'concourse', 'medbay', 'reactor', 'arboretum', 'ring', 'room']);

/* ── the graph ────────────────────────────────────────────────────────── */

function buildGraph(S) {
  const ctx = audio.ctx;
  if (!ctx || !audio.ready || !audio.ambBus) return false;
  const pink = audio.noiseBuffer(true);
  if (!pink) return false;
  S.ctx = ctx;
  const started = [];
  const out = ctx.createGain(); out.gain.value = 1; out.connect(audio.ambBus);
  S.out = out;
  const noise = (rate = 1) => { const s = ctx.createBufferSource(); s.buffer = pink; s.loop = true; s.playbackRate.value = rate; started.push(s); return s; };
  const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; started.push(o); return o; };
  const gain = (v, to) => { const g = ctx.createGain(); g.gain.value = v; g.connect(to); return g; };
  const filt = (type, f, q, to) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(to); return b; };
  const lfo = (target, hz, depth, type = 'sine') => { const l = osc(type, hz); const d = ctx.createGain(); d.gain.value = depth; l.connect(d); d.connect(target); };

  const beds = {};
  for (const k of BED_KEYS) beds[k] = { gain: gain(0, out), target: 0, layers: [] };
  const bandNoise = (bed, f, q, g, rate = 1) => { const n = noise(rate); const b = filt('bandpass', f, q, gain(g, bed.gain)); n.connect(b); return b; };
  const lowNoise = (bed, f, g, rate = 1) => { const n = noise(rate); const b = filt('lowpass', f, 0.7, gain(g, bed.gain)); n.connect(b); return b; };
  const tone = (bed, type, f, g) => { const o = osc(type, f); const gg = gain(g, bed.gain); o.connect(gg); return gg; };

  /* CANTINA: a crowd murmur, breathing, and a band's slow bass pulse. */
  {
    const b = beds.cantina;
    const murmur = gain(0.11, b.gain);
    const n = noise(0.91); const bp = filt('bandpass', 320, 0.6, murmur); n.connect(bp);
    lfo(murmur.gain, 0.13, 0.04);
    /* V19 add 5: the band ducks this — see `duckMurmur`. */
    S.murmur = murmur; S.murmurBase = 0.11;
    const bass = tone(b, 'sine', 55, 0.0);
    bass.gain.value = 0.045;
    lfo(bass.gain, 1.05, 0.045, 'square');
    const bass2 = tone(b, 'triangle', 82.4, 0.012);
    lfo(bass2.gain, 0.52, 0.012, 'square');
  }
  /* CONCOURSE: a bigger crowd, and a tannoy shimmer that never quite says anything. */
  {
    const b = beds.concourse;
    const crowd = gain(0.14, b.gain);
    const n = noise(1.0); const bp = filt('bandpass', 520, 0.5, crowd); n.connect(bp);
    lfo(crowd.gain, 0.09, 0.05);
    const shimmer = bandNoise(b, 1900, 2.5, 0.012, 1.07);
    lfo(shimmer.frequency, 0.05, 300);
  }
  /* MEDBAY: monitors' beeps — two rates, so they walk against each other. */
  {
    const b = beds.medbay;
    const beep = tone(b, 'sine', 880, 0.011);
    lfo(beep.gain, 1.2, 0.011, 'square');
    const beep2 = tone(b, 'sine', 1046, 0.007);
    lfo(beep2.gain, 1.45, 0.007, 'square');
    lowNoise(b, 260, 0.03, 0.85);
  }
  /* REACTOR HALL: a deep hum, three partials and a rumble under them. */
  {
    const b = beds.reactor;
    tone(b, 'sine', 40, 0.16); tone(b, 'sine', 60, 0.10); tone(b, 'sawtooth', 90, 0.03);
    const r = lowNoise(b, 120, 0.09, 0.62);
    lfo(r.frequency, 0.07, 30);
  }
  /* ARBORETUM: water and birds-ish chirps. */
  {
    const b = beds.arboretum;
    const water = bandNoise(b, 2400, 0.8, 0.05, 1.03);
    lfo(water.frequency, 0.31, 500);
    const birdOsc = osc('sine', 2600);
    const bird = gain(0.009, b.gain);
    birdOsc.connect(bird);
    lfo(bird.gain, 0.37, 0.009, 'square');
    lfo(birdOsc.frequency, 7.3, 380);
    const bird2 = tone(b, 'sine', 3300, 0.0);
    bird2.gain.value = 0.006;
    lfo(bird2.gain, 0.23, 0.006, 'square');
  }
  /* THE RING: air handlers, and the tram (its gain is set per frame). */
  {
    const b = beds.ring;
    const air = lowNoise(b, 240, 0.08, 0.8);
    lfo(air.frequency, 0.11, 40);
    tone(b, 'sine', 48, 0.03);
  }
  {
    const b = beds.room;
    lowNoise(b, 340, 0.05, 0.9);
  }
  /* THE TRAM, off `out` and not off a bed: it is heard from any room near
   * the guideway, at a level that is a distance law and nothing else. */
  {
    const tg = gain(0, out);
    const o = osc('sawtooth', 92); const lp = filt('lowpass', 420, 0.8, tg); o.connect(lp);
    const n = noise(0.7); const bp = filt('bandpass', 760, 0.9, tg); n.connect(bp);
    S.tram = { gain: tg, at: 0, osc: o };
  }
  const t0 = ctx.currentTime;
  for (const s of started) { try { s.start(t0); } catch { /* going */ } }
  S.started = started;
  S.beds = beds;
  S.stop = audio.hold(() => teardown(S));
  S.built = true;
  return true;
}

function teardown(S) {
  if (!S || S.torn) return;
  S.torn = true;
  const ctx = S.ctx;
  const now = ctx?.currentTime ?? 0;
  try { S.out?.gain.setTargetAtTime(0.0001, now, 0.05); } catch { /* gone */ }
  for (const s of S.started || []) { try { s.stop(now + 0.3); } catch { /* stopped */ } }
  try { S.out?.disconnect(); } catch { /* gone */ }
  S.started = null;
}

/* ── the PA ───────────────────────────────────────────────────────────── */

const PA_SPEAKER = Object.freeze({
  id: 'tannoy', name: 'Station control',
  f0: 122, wave: 'sawtooth', formants: [560, 1180], q: [5.5, 4.6], mix: 0.5,
  rasp: 0.12, raspFreq: 1900, cadence: 0.94, bend: 0.05, gain: 1.0,
});

function hashF(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 1000003) / 1000003;
}
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const DECK_NAME = Object.freeze({
  12: 'the launch well', 32: 'flight operations', 40: 'the Concourse',
  44: 'the Living deck', 48: 'the Working deck', 60: 'the Observation dome',
});
const CHILD = ['a boy of six in a red tunic', 'a Centauri girl with a toy tram', 'a Narn boy, about eight', 'a small human girl in a flight jacket', 'a Drazi child, green sash'];
const FOUND = ['a set of keys', 'a datapad', 'one glove', 'a ration card', 'a saber clip'];

/**
 * THE LINES. Each is `(st, world, rng) => string` and every one is a fact the
 * station already knows; the head is always the station's own name.
 */
export const PA_KINDS = Object.freeze([
  { id: 'arrival', say: (st) => {
    const row = rowsOf(st).find((r) => r.kind === 'in' && (r.state === 'on final' || r.state === 'inbound'));
    return row ? `arriving — ${String(row.craft).toLowerCase()} ${row.call} ${row.state} at ${row.gate}` : `${hhmm(st.hour)} hours — no arrivals on the board`;
  } },
  { id: 'departure', say: (st) => {
    const row = rowsOf(st).find((r) => r.kind === 'out');
    return row ? `departing — ${String(row.craft).toLowerCase()} ${row.call} from ${row.gate}, ${row.state}` : `${hhmm(st.hour)} hours — no departures on the board`;
  } },
  { id: 'lostchild', say: (st, w, u) => `would the parents of ${CHILD[Math.floor(u * CHILD.length) % CHILD.length]} come to the security post on the Concourse` },
  { id: 'weather', say: (st) => { const W = weatherAt(st.day | 0, st.theatre || 'the line'); return `the weather below over ${W.theatre}: ${W.line}`; } },
  { id: 'market', say: (st) => ((st.hour || 0) < 10 ? 'market day opens on the Concourse at 1000 hours — stalls to the ring' : 'market day on the Concourse — the tram runs full until 1500') },
  { id: 'vigil', say: (st) => ((st.hour || 0) < 20 ? 'the vigil is at 2000 hours in the chapel, names read at the wall' : 'the vigil is under way in the chapel — quiet on the ring, please') },
  { id: 'lightsout', say: (st) => ((st.hour || 0) < 22 ? 'lights-out on the Living deck is 2200 hours' : 'lights-out on the Living deck — the ring stays lit') },
  { id: 'tram', say: () => 'the tram runs the four platforms every ninety seconds — stand clear of the gates' },
  { id: 'medbay', say: () => { let n = 0; try { n = occupied(companyOf()); } catch { n = 0; } return n ? `the bacta ward has ${n} in the tanks — visitors to #44 on the Working deck` : 'the bacta ward is clear — all tanks free'; } },
  { id: 'watch', say: (st) => `${hhmm(st.hour)} hours, ${['first watch', 'second watch', 'third watch'][Math.floor((st.hour || 0) / 8) % 3]}` },
  { id: 'deck', say: (st) => `${DECK_NAME[st.deck | 0] || `deck ${st.deck | 0}`} — mind the lift doors` },
  { id: 'race', say: (st) => {
    for (const v of VENUES) {
      let races = [];
      try { races = racesOn(v.id, st.day | 0); } catch { races = []; }
      const next = races.find((r) => r.hour > (st.hour || 0));
      if (next) return `the next ${next.word} at the ${v.name || v.id} goes off at ${hhmm(next.hour)} — the board is open`;
    }
    return 'no card at the theatre tonight — the room is dark';
  } },
  { id: 'shuttle', say: () => 'the docking throat shuttle is boarding — flight deck the long way, outside' },
  { id: 'pressure', say: (st) => `pressure check on ${DECK_NAME[st.deck | 0] || 'this deck'} complete — all seals holding` },
  { id: 'chapel', say: () => 'the chapel is open to all faiths at all hours — the door is on the Concourse' },
  { id: 'drum', say: (st) => `the Drum spins at ${hhmm(Math.ceil(st.hour || 0))} — bets at the Wheelhouse window` },
  { id: 'lostprop', say: (st, w, u) => `lost property holds ${FOUND[Math.floor(u * FOUND.length) % FOUND.length]} — claim at the notice wall` },
  { id: 'kiosks', say: (st) => ((st.hour || 0) < 8 ? 'kiosks open at 0800 hours' : (st.hour || 0) >= 23 ? 'kiosks are shut for the night' : 'kiosks are open on the Concourse and the Working deck') },
  { id: 'reactor', say: () => 'reactor hall test in progress — a dip in the lights is expected, not a fault' },
  { id: 'rain', say: (st) => ((st.hour || 0) < 19 ? 'the arboretum rains at 1900 hours — bring nothing you mind wet' : 'the arboretum is raining — the paths are slippery') },
  { id: 'gym', say: () => 'the gym\'s running gallery is open — ten laps is the ring' },
  { id: 'throat', say: () => 'a trader is in at the docking throat — cargo across the ring for an hour' },
  { id: 'food', say: (st) => ((st.hour || 0) < 12 ? 'the food court serves breakfast until noon' : (st.hour || 0) < 18 ? 'the galley is serving — the food court until 1800' : 'the cantina is open late — the food court closes at 2100') },
  { id: 'standing', say: () => 'the Standing on the Concourse names the company of the week — read it on your way past' },
]);

function rowsOf(st) {
  try { return boardAt(st.day | 0, Number(st.hour) || 0) || []; } catch { return []; }
}

/** Which kind call `i` on day `d` is: a seeded rota that says every kind once before any twice. */
export function paKindAt(day, i) {
  const n = PA_KINDS.length;
  const round = Math.floor(i / n), k = i % n;
  /* A different permutation each round: (k * stride + start) mod n with a
   * stride coprime to n. */
  const u = hashF(`pa:${day | 0}:${round}`);
  const strides = [];
  for (let s = 1; s < n; s++) { let a = s, b = n; while (b) { const t = b; b = a % b; a = t; } if (a === 1) strides.push(s); }
  const stride = strides[Math.floor(u * strides.length) % strides.length];
  const start = Math.floor(hashF(`pa:start:${day | 0}:${round}`) * n);
  return (start + k * stride) % n;
}

/** What call `i` says: `[head, line, kindId]`. */
export function paLine(world, st, i) {
  const name = String(stationName() || DEFAULT_NAME).toUpperCase();
  const k = paKindAt(st.day, i);
  const K = PA_KINDS[k];
  const u = hashF(`pa:u:${st.day | 0}:${i}`);
  let line = '';
  try { line = K.say(st, world, u); } catch { line = `${hhmm(st.hour)} hours`; }
  return [name, line, K.id];
}

const _paAt = new THREE.Vector3();

/** The two-tone chime that precedes a call. A shape on the ambience bus. */
export function chime(pos = null) {
  try {
    return audio.shape({
      dur: 1.1, gain: 0.35, pos, dest: audio.ambBus,
      build: (ctx, head, t0) => {
        const srcs = [];
        [[784, 0], [988, 0.32]].forEach(([f, dt]) => {
          const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
          g.gain.setTargetAtTime(1, t0 + dt, 0.02);
          g.gain.setTargetAtTime(0.0001, t0 + dt + 0.35, 0.12);
          o.connect(g); g.connect(head);
          srcs.push(o);
        });
        return srcs;
      },
    });
  } catch { return false; }
}

/**
 * THE PA, ONCE A FRAME AND ALMOST ALWAYS A NO-OP. Returns true when this file
 * owns the tannoy (the station sound is dressed), so `Station.stepTannoy` can
 * stand down; the record it writes is the one `stepTannoy` wrote.
 */
const paSlot = (st) => Math.floor(((st.day | 0) * 24 + (Number(st.hour) || 0)) * 60 / PA_EVERY);
const paRecord = (st) => st.pa || (st.pa = { calls: 0, at: -1, said: '', head: '', line: '', name: '', spoke: '', kind: '' });

export function stepPA(world, st, dt) {
  const S = world?._stationSound;
  if (!S) return false;
  if (!(dt > 0)) return true;
  const pa = paRecord(st);
  const abs = (st.day | 0) * 24 + (Number(st.hour) || 0);
  const slot = paSlot(st);
  if (slot === pa.at) return true;
  /* The slot the visit began on was stamped at dress time, so the first call
   * comes a full slot after the doors open and never as the deck fades in. */
  if (pa.at < 0) { pa.at = slot; return true; }
  pa.at = slot;
  const [head, line, kind] = paLine(world, st, pa.calls);
  pa.calls++;
  pa.head = head; pa.line = line; pa.kind = kind; pa.said = `${head} — ${line}`;
  pa.name = String(stationName() || DEFAULT_NAME);
  const p = world.player?.position;
  _paAt.set(p ? p.x : 0, (DECK_Y[st.deck] ?? 0) + DRUM.storey, p ? p.z : 0);
  pa.chimed = chime(_paAt);
  try { pa.spoke = audio.radio(PA_SPEAKER, pa.said, { pos: _paAt, gain: 0.8 }) || ''; }
  catch { pa.spoke = ''; }
  world.notify?.(head, line);
  S.paLog.push({ kind, line, t: S.t, hour: abs });
  return true;
}

/* ── dress / step / undress ──────────────────────────────────────────── */

export function dressStationSound(world, st) {
  if (!world || !st || world._stationSound) return world?._stationSound || null;
  const S = { built: false, torn: false, rearm: 0, cur: null, since: 0, t: 0, paLog: [], beds: null, tram: null, levels: {} };
  world._stationSound = S;
  /* Stamp the PA's slot now — see `stepPA`. */
  const pa = paRecord(st);
  if (pa.at < 0) pa.at = paSlot(st);
  buildGraph(S);
  return S;
}

/**
 * THE MURMUR UNDER THE BAND (V19 add 5). `Music.js` pulls the cantina's crowd
 * to `level` of itself while the band plays and back to 1 when it stops; the
 * level is kept on `S.levels.murmur` so a check can read it without a clock.
 */
export function duckMurmur(world, level = 1) {
  const S = world?._stationSound;
  if (!S) return false;
  const l = Math.max(0, Math.min(1, Number(level) || 0));
  S.levels.murmur = l;
  if (!S.murmur || !S.ctx) return false;
  try { S.murmur.gain.setTargetAtTime(S.murmurBase * l, S.ctx.currentTime, 0.6); } catch { return false; }
  return true;
}

/** What the bed's gain is currently commanded to, per key — the observable. */
export function bedLevels(world) {
  return world?._stationSound?.levels || {};
}

export function stepStationSound(world, st, dt) {
  const S = world?._stationSound;
  if (!S || !(dt > 0)) return;
  S.t += dt;
  if (!S.built || S.torn) {
    S.rearm -= dt;
    if (S.rearm > 0) return;
    S.rearm = REARM;
    if (S.torn) { S.torn = false; S.built = false; }
    if (!buildGraph(S)) return;
  }
  const ctx = S.ctx;
  const now = ctx.currentTime;
  const p = world.player?.position;
  const px = p ? p.x : 0, pz = p ? p.z : 0;
  const key = bedFor(placeUnder(world, px, pz));
  if (key !== S.cur) {
    S.cur = key; S.since = S.t;
    for (const k of BED_KEYS) {
      const b = S.beds[k];
      const want = k === key ? 1 : 0;
      if (b.target === want) continue;
      b.target = want;
      S.levels[k] = want;
      b.gain.gain.setTargetAtTime(want, now, XFADE / 3);
    }
  }
  /* THE TRAM: a distance law off the car, where there is a car. */
  const car = world._stationLife?.tram?.car;
  let tram = 0;
  if (car && car.parent) {
    const d = Math.hypot(car.position.x - px, car.position.z - pz);
    tram = d < TRAM_MAX ? 0.16 / (1 + (d / TRAM_HALF) * (d / TRAM_HALF)) : 0;
  }
  if (Math.abs(tram - S.tram.at) > 0.003) {
    S.tram.at = tram;
    S.tram.gain.gain.setTargetAtTime(tram, now, 0.25);
  }
  /* THE PLAYER'S VOLUME holds through `ambBus` → `master`; a volume at zero
   * also parks the whole graph, so it costs nothing while muted. */
  const on = (audio.volume ?? 1) > 0.001 && !audio.muted ? 1 : 0;
  if (on !== S.on) { S.on = on; S.out.gain.setTargetAtTime(on, now, 0.1); }
}

export function undressStationSound(world) {
  const S = world?._stationSound;
  if (!S) return;
  if (S.stop) { S.stop(); S.stop = null; }
  teardown(S);
  world._stationSound = null;
}
