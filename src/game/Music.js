/**
 * ══════════════════════════════════════════════════════════════════════════
 *  MUSIC AS PLACE — a seeded tune engine, the cantina band, a busker, and the
 *  Drum's theme (V19 addition 5 / hole 3)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The station had beds (`StationSound.js`) and a PA and no music tied to a
 * place: the cantina's "band" was a square-wave LFO on a 55 Hz sine. This is
 * the rest, in three parts:
 *
 *   THE TUNE ENGINE  `tuneFor(seed, style)` is a pure function of its seed: a
 *                    key, a mode from `STYLES` (six that read as cantina,
 *                    Drazi, Minbari, Centauri, Narn, human, and the Drum's
 *                    own), a tempo, a chord walk, a bass line, a melody built
 *                    from two seeded motifs laid A A B A over eight bars, a
 *                    harmony and a counter voice where the style asks for
 *                    them, and a drum pattern. Every note is in the mode.
 *                    `tuneName(seed)` is a two-word title the residents can
 *                    say. No random source anywhere: `h2` off the seed, like
 *                    `StationLife`.
 *   THE PLAYER       `openPlayer` builds a small graph on `audio.musicBus` —
 *                    so the Music slider and mute hold — and `stepPlayer`
 *                    schedules notes on the audio clock a lookahead ahead:
 *                    an oscillator and an attack/decay envelope per note, a
 *                    filtered burst of the engine's own noise buffer per
 *                    drum. It loops. Its `out` gain is the place's distance
 *                    law, set per frame.
 *   THE PLACES       THE BAND (#14): three musicians on the cantina's dais,
 *                    a horn, a lute and a drum in their hands, swaying on the
 *                    beat, a set list 20:00–02:00 of one tune per three
 *                    station-minutes with a break every fourth; the tannoy
 *                    names the next tune; the murmur bed ducks while they
 *                    play. THE BUSKER: one resident with a lute by a kiosk on
 *                    the deck-40 ring, 10:00–18:00, a hat on the floor; the
 *                    interact key drops a credit in it (`Credits.spend`) and
 *                    he plays a named request; the `busker` fold counts your
 *                    tips and a patron is greeted. THE DRUM: the channel's
 *                    late-night programme gets a theme under it, audible
 *                    within `DRUM_REACH` m of a screen, low.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { audio } from '../engine/Audio.js';
import { placeUnder } from './Station.js';
import { PLACE, DECK_Y, floorOf } from './StationPlan.js';
import { wayPlacesOn } from './StationLife.js';
import { cupInHand } from './Bars.js';
import { spend, purse } from './Credits.js';
import { buskerState, setBuskerState, stationDay, pickpocketState } from './StationSave.js';
import { duckMurmur } from './StationSound.js';
import { resident } from './StationCast.js';
import { speak } from './Voice.js';

/* ── constants ─────────────────────────────────────────────────────────── */

/** The band's hours, and the busker's, on the station clock. */
export const BAND_FROM = 20, BAND_TO = 2;
export const BUSKER_FROM = 10, BUSKER_TO = 18;
/** Station minutes per set-list slot; every `BAND_BREAK`th slot is a break. */
export const SET_MIN = 3, BAND_BREAK = 4;
/** The band's distance law: half power at this many metres from the dais. */
export const BAND_HALF = 5, BAND_MAX = 40;
export const BUSKER_HALF = 4, BUSKER_MAX = 30;
/** The Drum's theme: heard within this many metres of a screen, and this low. */
export const DRUM_REACH = 6, DRUM_GAIN = 0.12;
/** How far ahead of the clock notes are scheduled, seconds. */
const LOOKAHEAD = 0.45;
/** The cantina's murmur while the band plays, as a fraction of itself. */
export const MURMUR_DUCK = 0.45;
/** A patron is a tipper of this many. */
export const PATRON_AT = 3;
/** Which of deck 40's kiosks the busker stands by (a `wayPlacesOn` id). */
export const BUSKER_KIOSK = 9420;
/** Seconds between attempts to build a graph while the engine is not ready. */
const REARM = 1.0;

/* ── the hash ──────────────────────────────────────────────────────────── */

export function h2(a, b) {
  let h = Math.imul(a * 374761393 + b * 668265263, 1) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** A string to an integer seed. */
export function seedOf(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** The k-th draw off a seed, in [0, 1). */
const draw = (seed, k) => h2(seed | 0, (k * 7919 + 13) | 0);
const pick = (seed, k, n) => Math.floor(draw(seed, k) * n) % n;

/* ── the styles ────────────────────────────────────────────────────────── */

/**
 * SIX MODES THAT READ AS SIX PEOPLES, and the Drum's. `scale` is semitones
 * off the root; `chords` the degrees the bass walks (indices into the scale);
 * `bpm` the tempo; `voices` how many parts (2–4); `waves` the oscillator per
 * part [melody, bass, harmony, counter]; `drums` a 16-step pattern per bar of
 * 'k' kick, 's' snare, 'h' hat, '.' rest; `swing` pulls every off-eighth late.
 */
export const STYLES = Object.freeze([
  { id: 'cantina', name: 'cantina', scale: [0, 2, 3, 5, 7, 9, 10], chords: [0, 3, 4, 0, 5, 3, 4, 0], bpm: 138, voices: 4,
    waves: ['square', 'triangle', 'sawtooth', 'sine'], drums: 'k.hsk.h.k.hsk.hh', swing: 0.14, lows: [45, 52], density: 0.85 },
  { id: 'drazi', name: 'Drazi', scale: [0, 1, 4, 5, 7, 8, 10], chords: [0, 0, 5, 0, 6, 0, 5, 0], bpm: 152, voices: 3,
    waves: ['sawtooth', 'square', 'triangle', 'sine'], drums: 'kkh.k.hskk.hk.hs', swing: 0.0, lows: [43, 50], density: 0.95 },
  { id: 'minbari', name: 'Minbari', scale: [0, 2, 4, 7, 9], chords: [0, 3, 1, 0, 4, 3, 1, 0], bpm: 72, voices: 3,
    waves: ['sine', 'triangle', 'sine', 'sine'], drums: '........h.......', swing: 0.0, lows: [50, 57], density: 0.5 },
  { id: 'centauri', name: 'Centauri', scale: [0, 2, 4, 5, 7, 9, 11], chords: [0, 5, 3, 4, 0, 5, 1, 4], bpm: 112, voices: 4,
    waves: ['triangle', 'sine', 'triangle', 'square'], drums: 'k.h.h.k.h.h.k.h.', swing: 0.0, lows: [48, 55], density: 0.7 },
  { id: 'narn', name: 'Narn', scale: [0, 3, 5, 6, 7, 10], chords: [0, 0, 3, 3, 0, 4, 3, 0], bpm: 96, voices: 3,
    waves: ['sawtooth', 'sawtooth', 'square', 'sine'], drums: 'k..sk.k.s.k.sk..', swing: 0.2, lows: [41, 48], density: 0.75 },
  { id: 'human', name: 'human', scale: [0, 2, 3, 5, 7, 8, 10], chords: [0, 5, 2, 6, 0, 5, 3, 4], bpm: 120, voices: 4,
    waves: ['triangle', 'sine', 'sine', 'triangle'], drums: 'k.h.s.h.k.h.s.hh', swing: 0.0, lows: [45, 52], density: 0.8 },
  { id: 'drum', name: 'Drum', scale: [0, 2, 3, 5, 7, 8, 11], chords: [0, 0, 5, 5, 3, 3, 4, 4], bpm: 104, voices: 3,
    waves: ['sawtooth', 'square', 'sine', 'sine'], drums: 'k...k...k...k.s.', swing: 0.0, lows: [38, 45], density: 0.6 },
]);
export const STYLE_BY = new Map(STYLES.map((s) => [s.id, s]));
/** The six peoples' styles — the band's and the busker's set lists draw from these. */
export const PLAYED = STYLES.filter((s) => s.id !== 'drum');

/* ── the names ─────────────────────────────────────────────────────────── */

const FIRST = ['Long', 'Red', 'Cold', 'Late', 'Blue', 'Iron', 'Slow', 'Green', 'Quiet', 'Broken', 'Bright', 'Ninth', 'Outer', 'Last', 'Grey', 'Hollow'];
const SECOND = ['Orbit', 'Tram', 'Night', 'Dock', 'Ring', 'Watch', 'Lantern', 'Drum', 'Corridor', 'Rain', 'Sister', 'Harbour', 'Gate', 'Skin', 'Signal', 'Deck'];

/** A two-word title off the seed, the same every time. */
export function tuneName(seed) {
  const s = typeof seed === 'number' ? seed : seedOf(seed);
  return `${FIRST[pick(s, 101, FIRST.length)]} ${SECOND[pick(s, 103, SECOND.length)]}`;
}

/* ── the tune ──────────────────────────────────────────────────────────── */

export const BARS = 8, BEATS = 4, STEPS = 16;
/** Bar → which motif: A A B A, twice over eight bars. */
export const FORM = Object.freeze(['A', 'A', 'B', 'A', 'A', 'A', 'B', 'A']);

/** Midi → Hz. */
export const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * A motif: eight steps of two beats, each a scale degree offset from the
 * phrase's centre (or a rest), with its own rhythm. Degrees are RELATIVE, so
 * the same motif over a different chord is a variation and not a repeat.
 */
function motif(seed, k, style) {
  const out = [];
  let deg = 0;
  for (let i = 0; i < 8; i++) {
    const u = draw(seed, k * 31 + i);
    const rest = u > style.density && i % 4 !== 0;
    /* A step of at most a third, mostly a second, back toward the centre when it strays. */
    const dir = deg > 3 ? -1 : deg < -3 ? 1 : (draw(seed, k * 31 + 100 + i) < 0.5 ? -1 : 1);
    const size = draw(seed, k * 31 + 200 + i) < 0.7 ? 1 : 2;
    if (!rest) deg += dir * size;
    const len = draw(seed, k * 31 + 300 + i) < 0.3 ? 2 : 1; // eighths, some quarters
    out.push({ deg: rest ? null : deg, len });
  }
  return out;
}

/**
 * THE TUNE, as a list of notes on a beat grid, seeded. Same seed, same list.
 *   { seed, name, style, root, bpm, bars, beats, notes: [{ t, dur, midi, voice }],
 *     drums: [{ t, kind }], length (beats), form }
 */
export function tuneFor(seed, styleId = null, opts = {}) {
  const s = typeof seed === 'number' ? seed >>> 0 : seedOf(seed);
  const style = STYLE_BY.get(styleId) || PLAYED[pick(s, 1, PLAYED.length)];
  /* A SOLO (`voices: 1`) is the melody alone — the busker's — with no drums. */
  const solo = (opts.voices | 0) === 1;
  const root = 48 + pick(s, 2, 12); // C3..B3
  /* THE TEMPO IS THE STYLE'S, jittered by the seed — unless the caller names
   * one. The score (`SCORES`) is the one caller that does: a state is a style
   * AND a tempo, and a chase that ran at the Drazi row's own 152 whatever the
   * state asked for would have no tempo of its own to change. */
  const bpm = Number.isFinite(opts.bpm) ? Math.max(30, Math.round(opts.bpm)) : style.bpm + (pick(s, 3, 9) - 4) * 2;
  const scale = style.scale;
  const N = scale.length;
  const degMidi = (deg, base) => {
    const oct = Math.floor(deg / N), i = ((deg % N) + N) % N;
    return base + oct * 12 + scale[i];
  };
  const motifs = { A: motif(s, 11, style), B: motif(s, 23, style) };
  const notes = [], drums = [];
  const voices = solo ? 1 : Math.max(2, Math.min(4, style.voices | 0));
  const centre = 12 + pick(s, 4, 3); // the melody's centre degree, over the root: an octave-and-a-bit up
  const swing = style.swing;
  for (let bar = 0; bar < BARS; bar++) {
    const chord = style.chords[bar % style.chords.length];
    const t0 = bar * BEATS;
    /* THE BASS: root on the beat, fifth or octave on the off-beats, walked per style. */
    const bassRoot = degMidi(chord, root - 12);
    const low = style.lows;
    for (let b = 0; b < BEATS && !solo; b++) {
      const u = draw(s, 400 + bar * 4 + b);
      let m = b === 0 ? bassRoot : (u < 0.5 ? degMidi(chord + 4, root - 12) : (u < 0.8 ? bassRoot + 12 : degMidi(chord + 2, root - 12)));
      while (m < low[0]) m += 12;
      while (m > low[1] + 12) m -= 12;
      if (style.id === 'minbari' && b % 2 === 1) continue;
      notes.push({ t: t0 + b, dur: style.id === 'minbari' ? 1.8 : 0.5, midi: m, voice: 1 });
    }
    /* THE MELODY: the bar's motif, its degrees off the chord's centre. */
    const M = motifs[FORM[bar]];
    let t = t0;
    for (let i = 0; i < M.length && t < t0 + BEATS; i++) {
      const n = M[i];
      const dur = n.len * 0.5;
      if (n.deg !== null) {
        const midi = degMidi(centre + chord + n.deg, root);
        const at = t + ((i % 2 === 1) ? swing * 0.5 : 0);
        /* `deg` is the motif's own step, kept so the form can be measured
         * across chords: the same motif over a different chord is the same
         * shape in degrees and a different one in semitones. */
        notes.push({ t: at, dur: dur * 0.9, midi, voice: 0, deg: n.deg });
        /* THE HARMONY: a third above, on the longer notes, where there is a voice for it. */
        if (voices >= 3 && (n.len === 2 || i % 4 === 0)) notes.push({ t: at, dur: dur * 0.85, midi: degMidi(centre + chord + n.deg + 2, root), voice: 2 });
      }
      t += dur;
    }
    /* THE COUNTER VOICE: the chord's third and fifth held under the phrase. */
    if (voices >= 4) {
      notes.push({ t: t0, dur: BEATS * 0.95, midi: degMidi(chord + 2, root), voice: 3 });
      notes.push({ t: t0 + 2, dur: 1.9, midi: degMidi(chord + 4, root), voice: 3 });
    }
    /* THE DRUMS: the style's pattern, one fill on the last bar of each phrase. */
    const pat = style.drums;
    for (let i = 0; i < STEPS && !solo; i++) {
      let kind = pat[i % pat.length];
      if (bar % 4 === 3 && i >= 12 && draw(s, 600 + bar * 16 + i) < 0.6) kind = 's';
      if (kind === '.') continue;
      drums.push({ t: t0 + i / 4 + ((i % 2 === 1) ? swing * 0.25 : 0), kind });
    }
  }
  notes.sort((a, b) => a.t - b.t || a.voice - b.voice);
  drums.sort((a, b) => a.t - b.t);
  return { seed: s, name: tuneName(s), style: style.id, root, bpm, bars: BARS, beats: BEATS, notes, drums, length: BARS * BEATS, form: FORM.slice(), voices };
}

/** Is every note of the tune in its mode? A check's question, answered here. */
export function inMode(tune) {
  const scale = STYLE_BY.get(tune.style).scale;
  return tune.notes.every((n) => scale.includes((((n.midi - tune.root) % 12) + 12) % 12));
}

/** The melody's shape in a bar — rhythm and motif degrees — for measuring A A B A. */
export function barShape(tune, bar) {
  const t0 = bar * BEATS;
  return tune.notes.filter((n) => n.voice === 0 && n.t >= t0 && n.t < t0 + BEATS)
    .map((n) => `${(n.t - t0).toFixed(2)}:${n.dur.toFixed(2)}:${n.deg}`).join(' ');
}

/* ── the player ────────────────────────────────────────────────────────── */

const DRUM_SPEC = {
  k: { f: 150, fEnd: 45, q: 1.2, dur: 0.18, g: 0.9, type: 'lowpass', tone: true },
  s: { f: 1800, fEnd: null, q: 0.8, dur: 0.14, g: 0.5, type: 'bandpass' },
  h: { f: 7000, fEnd: null, q: 1.4, dur: 0.05, g: 0.22, type: 'highpass' },
};
/** Per-voice level: melody, bass, harmony, counter. */
const VOICE_GAIN = [0.32, 0.30, 0.16, 0.10];

/**
 * A player on `audio.musicBus`: `{ out, voices, drums, tune, at, loop }`.
 * `out.gain` is the caller's — the place's distance law. Null when the engine
 * is not ready; the caller re-arms.
 */
export function openPlayer(tune, { gain = 0, loop = true, voices = null } = {}) {
  const ctx = audio.ctx;
  if (!ctx || !audio.ready || !audio.musicBus || !tune) return null;
  const out = ctx.createGain(); out.gain.value = gain; out.connect(audio.musicBus);
  const vg = [];
  const nv = voices ?? 4;
  for (let i = 0; i < 4; i++) { const g = ctx.createGain(); g.gain.value = i < nv ? VOICE_GAIN[i] : 0; g.connect(out); vg.push(g); }
  const dg = ctx.createGain(); dg.gain.value = nv > 1 ? 0.5 : 0.0; dg.connect(out);
  const P = { ctx, out, voices: vg, drums: dg, tune, loop, at: ctx.currentTime + 0.1, next: 0, nextDrum: 0, loops: 0, scheduled: 0, level: gain, dead: false, live: new Set() };
  P.stop = audio.hold(() => closePlayer(P, 0.05));
  return P;
}

function beatSec(P) { return 60 / P.tune.bpm; }

/** Where the player is in its tune, in beats, on the audio clock. */
export function beatOf(P, now = P?.ctx?.currentTime ?? 0) {
  if (!P) return 0;
  const b = (now - P.at) / beatSec(P);
  return b < 0 ? 0 : b;
}

function envNote(ctx, head, t0, dur, wave, freq, attack = 0.012) {
  const o = ctx.createOscillator(); o.type = wave; o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(1, t0 + attack);
  g.gain.setTargetAtTime(0.0001, t0 + Math.max(attack, dur * 0.6), Math.max(0.02, dur * 0.25));
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.08);
  o.connect(g); g.connect(head);
  o.start(t0); o.stop(t0 + dur + 0.1);
  o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } };
  return o;
}

function drumHit(ctx, head, t0, kind) {
  const D = DRUM_SPEC[kind];
  if (!D) return;
  const buf = audio.noiseBuffer(false);
  if (!buf) return;
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = D.type; f.frequency.value = D.f; f.Q.value = D.q;
  if (D.fEnd) f.frequency.exponentialRampToValueAtTime(D.fEnd, t0 + D.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(D.g, t0 + 0.003);
  g.gain.setTargetAtTime(0.0001, t0 + 0.003, D.dur / 2.5);
  g.gain.linearRampToValueAtTime(0.0001, t0 + D.dur + 0.05);
  s.connect(f); f.connect(g); g.connect(head);
  s.start(t0); s.stop(t0 + D.dur + 0.06);
  s.onended = () => { try { s.disconnect(); f.disconnect(); g.disconnect(); } catch { /* gone */ } };
  if (D.tone) {
    /* A kick has a body: a sine dropping under the thump. */
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(D.f, t0);
    o.frequency.exponentialRampToValueAtTime(D.fEnd, t0 + D.dur);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t0); og.gain.linearRampToValueAtTime(0.8, t0 + 0.004);
    og.gain.setTargetAtTime(0.0001, t0 + 0.004, D.dur / 3); og.gain.linearRampToValueAtTime(0.0001, t0 + D.dur + 0.05);
    o.connect(og); og.connect(head); o.start(t0); o.stop(t0 + D.dur + 0.06);
    o.onended = () => { try { o.disconnect(); og.disconnect(); } catch { /* gone */ } };
  }
}

/**
 * Schedule everything that falls inside the lookahead. Returns how many events
 * were scheduled this call. Loops by moving `at` forward a tune's length.
 */
export function stepPlayer(P, now = P?.ctx?.currentTime ?? 0) {
  if (!P || P.dead) return 0;
  const ctx = P.ctx, T = P.tune, bs = beatSec(P);
  const horizon = now + LOOKAHEAD;
  let n = 0;
  for (let guard = 0; guard < 4; guard++) {
    while (P.next < T.notes.length) {
      const e = T.notes[P.next];
      const t0 = P.at + e.t * bs;
      if (t0 > horizon) break;
      P.next++;
      if (t0 < now - 0.02) continue; // missed: a frame hitch, not worth a late note
      const vg = P.voices[e.voice];
      if (!vg || vg.gain.value === 0) continue;
      const wave = (STYLE_BY.get(T.style)?.waves || ['sine'])[e.voice] || 'sine';
      try { envNote(ctx, vg, t0, Math.max(0.05, e.dur * bs), wave, hz(e.midi)); n++; } catch { /* a bad node is one note */ }
    }
    while (P.nextDrum < T.drums.length) {
      const e = T.drums[P.nextDrum];
      const t0 = P.at + e.t * bs;
      if (t0 > horizon) break;
      P.nextDrum++;
      if (t0 < now - 0.02 || P.drums.gain.value === 0) continue;
      try { drumHit(ctx, P.drums, t0, e.kind); n++; } catch { /* a bad node is one hit */ }
    }
    const end = P.at + T.length * bs;
    if (P.next >= T.notes.length && P.nextDrum >= T.drums.length && end <= horizon) {
      if (!P.loop) { P.done = true; break; }
      P.at = end; P.next = 0; P.nextDrum = 0; P.loops++;
      continue;
    }
    break;
  }
  P.scheduled += n;
  return n;
}

/** Command the player's level, damped. */
export function setLevel(P, level, tc = 0.12) {
  if (!P || P.dead) return;
  const l = Math.max(0, Math.min(1, Number(level) || 0));
  if (Math.abs(l - P.level) < 0.002) return;
  P.level = l;
  try { P.out.gain.setTargetAtTime(Math.max(0.0001, l), P.ctx.currentTime, tc); } catch { /* gone */ }
}

export function closePlayer(P, fade = 0.15) {
  if (!P || P.dead) return;
  P.dead = true;
  if (P.stop) { P.stop(); P.stop = null; }
  const now = P.ctx.currentTime;
  try { P.out.gain.setTargetAtTime(0.0001, now, fade * 0.35); } catch { /* gone */ }
  const cut = () => { try { P.out.disconnect(); } catch { /* gone */ } };
  if (typeof setTimeout === 'function') setTimeout(cut, (fade + 0.3) * 1000); else cut();
}

/* ── the set lists ─────────────────────────────────────────────────────── */

/** Is `hour` inside a window that may cross midnight? */
export function withinHours(hour, from, to) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  return from < to ? (h >= from && h < to) : (h >= from || h < to);
}

/** The band's slot at this hour: three station-minutes each. */
export function bandSlot(day, hour) {
  const abs = (day | 0) * 24 + (Number(hour) || 0);
  return Math.floor(abs * 60 / SET_MIN);
}
/** Which tune the band plays in a slot, or null on a break. */
export function bandTune(slot) {
  if (slot % BAND_BREAK === BAND_BREAK - 1) return null;
  const s = seedOf(`band:${slot}`);
  return tuneFor(s, PLAYED[pick(s, 5, PLAYED.length)].id);
}
/** The busker's own tune for the day and the hour's quarter — a solo, in his own style. */
export function buskerTune(day, hour, request = null) {
  if (request != null) return tuneFor(seedOf(`busker:req:${request}`), PLAYED[pick(seedOf(`busker:req:${request}`), 6, PLAYED.length)].id, { voices: 1 });
  const q = Math.floor((Number(hour) || 0) * 4);
  const s = seedOf(`busker:${day | 0}:${q}`);
  return tuneFor(s, ['human', 'centauri', 'minbari'][pick(s, 6, 3)], { voices: 1 });
}
/** The Drum's theme: one a day. */
export function drumTune(day) { return tuneFor(seedOf(`drum:${day | 0}`), 'drum'); }

/* ── props ─────────────────────────────────────────────────────────────── */

let _mats = null;
function mats() {
  if (_mats) return _mats;
  const mk = (name, color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, ...extra }); m.name = `prop-${name}`; return m; };
  _mats = {
    brass: mk('horn', 0xc9a24a, { metalness: 0.8, roughness: 0.3 }),
    wood: mk('lute', 0x6b4a2b, { metalness: 0.05, roughness: 0.7 }),
    skin: mk('drumskin', 0xd8cbb0, { metalness: 0.0, roughness: 0.9 }),
    felt: mk('hat', 0x2a2422, { metalness: 0.0, roughness: 0.95 }),
    coin: mk('coin', 0xe0c060, { metalness: 0.9, roughness: 0.2, emissive: 0x3a2a00 }),
  };
  return _mats;
}

/** A horn: a tube and a bell, held by the tube. */
export function makeHorn() {
  const M = mats(), g = new THREE.Group(); g.name = 'horn';
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.42, 8), M.brass);
  tube.rotation.x = -Math.PI / 3; tube.position.set(0, 0.16, 0.12);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.03, 0.14, 12, 1, true), M.brass);
  bell.rotation.x = -Math.PI / 3; bell.position.set(0, 0.36, 0.24);
  g.add(tube, bell);
  return g;
}
/** A lute: a body and a neck, the neck up and out. */
export function makeLute() {
  const M = mats(), g = new THREE.Group(); g.name = 'lute';
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), M.wood);
  body.scale.set(1, 1.2, 0.45); body.position.set(0.05, 0.05, 0.08);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.5, 0.03), M.wood);
  neck.position.set(-0.2, 0.32, 0.06); neck.rotation.z = 0.7;
  g.add(body, neck);
  return g;
}
/** A hand drum: a shell with a skin. */
export function makeDrum() {
  const M = mats(), g = new THREE.Group(); g.name = 'handdrum';
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.22, 12, 1, true), M.wood);
  shell.position.set(0, 0.05, 0.16);
  const skin = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 12), M.skin);
  skin.position.set(0, 0.165, 0.16);
  g.add(shell, skin);
  return g;
}
/** The busker's hat, brim up on the floor, with the coins in it. */
export function makeHat() {
  const M = mats(), g = new THREE.Group(); g.name = 'hat';
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.012, 14), M.felt);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.1, 14, 1, true), M.felt);
  crown.position.y = 0.055;
  g.add(brim, crown);
  const coins = new THREE.Group(); coins.name = 'coins'; coins.position.y = 0.015; g.add(coins);
  g.userData.coins = coins;
  return g;
}
function addCoin(hat, i) {
  const coins = hat?.userData?.coins;
  if (!coins || coins.children.length >= 12) return;
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 8), mats().coin);
  const u = h2(i * 17 + 3, 5), v = h2(i * 17 + 7, 9);
  c.position.set((u - 0.5) * 0.12, 0.002 + coins.children.length * 0.004, (v - 0.5) * 0.12);
  coins.add(c);
}

/* ── bodies ────────────────────────────────────────────────────────────── */

const _v = new THREE.Vector3();
const _hold = new THREE.Vector3();

/** A resident body at a spot, held there. Same marks as every body in the drum. */
function spawnStill(world, key, species, at, yaw, role, name) {
  if (!world?.spawnEnemy) return null;
  let who = null;
  try { who = resident(key, { species, role }); } catch { who = null; }
  const sp = who?.species || species || 'human';
  let body = null;
  try {
    body = world.spawnEnemy(`res_${sp}`, new THREE.Vector3(at.x, at.y + 0.1, at.z), { team: world.player?.team ?? 0, person: who?.look || null });
  } catch { body = null; }
  if (!body) return null;
  body.team = world.player?.team ?? 0;
  body.stationResident = true;
  body.noAmbientHarm = true;
  body.stationName = name || who?.name || key;
  body.stationRole = role;
  body.stationSpecies = sp;
  body.stationFaction = who?.faction || 'merchants';
  body.stationMusician = key;
  body.facing = yaw;
  body.position?.set(at.x, at.y + 0.1, at.z);
  return body;
}

/** Pin a held body to its spot, facing its way plus a sway — `stepStanding`'s own seam. */
function pin(body, x, y, z, yaw) {
  const p = body?.position;
  if (!p) return;
  p.x = x; p.z = z; if (Number.isFinite(y)) p.y = y + 0.1;
  body.body?.setTransform?.(p, null);
  body.velocity?.set?.(0, 0, 0);
  body.facing = yaw;
}

function removeBody(world, body) {
  if (!body) return;
  try { body.dispose?.(); } catch { /* gone */ }
  const i = world.enemies?.indexOf(body) ?? -1;
  if (i >= 0) world.enemies.splice(i, 1);
}

/** The dais's world position: `StationKit.sunkenround`'s slab, through the place's frame. */
export function daisOf(place) {
  if (!place || place.shape !== 'sunkenround') return null;
  const depth = 2.2; // sunkenround's well
  const lz = place.d / 2 - 3.4;
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw);
  return { x: place.x + lz * s, y: floorOf(place) - depth + 0.5, z: place.z + lz * c, yaw: place.yaw + Math.PI, c, s };
}

/** The busker's stand: a step along the ring past his kiosk. */
export function buskerSpot(deck = 40) {
  let ks = null;
  try { ks = wayPlacesOn(deck).filter((p) => p.way === 'kiosk'); } catch { ks = []; }
  const k = ks.find((p) => p.id === BUSKER_KIOSK) || ks[0];
  if (!k) return null;
  const r = Math.hypot(k.x, k.z), a = Math.atan2(k.x, k.z) + 4.5 / r;
  const x = r * Math.sin(a), z = r * Math.cos(a);
  /* He faces along the ring, the way people come; the hat is at his feet, a pace out. */
  const yaw = a + Math.PI / 2;
  return { x, y: DECK_Y[deck] ?? 0, z, yaw, hat: { x: x + Math.sin(yaw) * 0.8, z: z + Math.cos(yaw) * 0.8 }, kiosk: k.id };
}

/* ── dress / step / undress ────────────────────────────────────────────── */

const MUSICIANS = [
  { key: 'band:horn', species: 'drazi', make: makeHorn, dx: -1.5, name: 'Vhal Drenn' },
  { key: 'band:lute', species: 'centauri', make: makeLute, dx: 0, name: 'Tavio Mollari' },
  { key: 'band:drum', species: 'narn', make: makeDrum, dx: 1.5, name: 'Ka\'Tenn' },
];

const BUSKER_NAME = 'Old Pell';
const MC = Object.freeze({ id: 'band-mc', name: 'The Long Night', f0: 110, wave: 'sawtooth', formants: [520, 1100], q: [5, 4.4], mix: 0.5, rasp: 0.2, raspFreq: 1700, cadence: 0.9, bend: 0.08, gain: 0.9 });

export function dressMusic(world, st) {
  if (!world || !st || world._music) return world?._music || null;
  const M = { deck: st.deck, t: 0, rearm: 0, band: null, busker: null, drum: null, levels: { band: 0, busker: 0, drum: 0 }, log: [], dais: null, spot: null };
  world._music = M;
  const cantina = st.places?.get(14)?.place || (st.deck === 40 ? PLACE.get(14) : null);
  M.dais = cantina ? daisOf(cantina) : null;
  M.spot = st.deck === 40 ? buskerSpot(40) : null;
  return M;
}

/** What each player is commanded to, per key — the observable. */
export function musicLevels(world) { return world?._music?.levels || {}; }
export function musicState(world) { return world?._music || null; }

/* THE BAND */
function bandUp(world, st, M) {
  if (M.band || !M.dais) return;
  const D = M.dais;
  const B = { bodies: [], props: [], player: null, slot: -1, tune: null, said: '', on: false };
  for (const m of MUSICIANS) {
    const x = D.x + m.dx * D.c, z = D.z - m.dx * D.s;
    /* ON THE DAIS TOP, not the well floor `floorAt` reports: the slab is a
     * collider, and a body pinned at the well's height stands inside it. */
    const y = D.y;
    const body = spawnStill(world, m.key, m.species, { x, y, z }, D.yaw, 'musician', m.name);
    if (!body) continue;
    body.stationPlace = 14;
    const prop = m.make();
    (world.scene || body.mesh?.parent)?.add?.(prop);
    B.bodies.push({ body, x, y, z, prop, side: m.key === 'band:lute' ? 'L' : 'R' });
  }
  M.band = B;
}
function bandDown(world, M) {
  const B = M.band;
  if (!B) return;
  for (const b of B.bodies) { b.prop?.parent?.remove(b.prop); removeBody(world, b.body); }
  if (B.player) closePlayer(B.player);
  duckMurmur(world, 1);
  M.band = null;
  M.levels.band = 0;
}
function stepBand(world, st, M, dt, px, pz) {
  const on = withinHours(st.hour, BAND_FROM, BAND_TO) && !!M.dais;
  if (!on) { if (M.band) bandDown(world, M); return; }
  if (!M.band) bandUp(world, st, M);
  const B = M.band;
  if (!B) return;
  /* THE SET LIST: one tune a slot, a break every fourth. */
  const slot = bandSlot(st.day, st.hour);
  if (slot !== B.slot) {
    B.slot = slot;
    if (B.player) { closePlayer(B.player); B.player = null; }
    B.tune = bandTune(slot);
    if (B.tune) {
      const near = Math.hypot(M.dais.x - px, M.dais.z - pz) < BAND_MAX;
      B.said = `the band plays "${B.tune.name}"`;
      M.log.push({ t: M.t, slot, name: B.tune.name, style: B.tune.style });
      if (near && M.t > 1) {
        world.notify?.('THE LONG NIGHT', B.said);
        try { audio.radio(MC, `next, ${B.tune.name}`, { pos: _v.set(M.dais.x, M.dais.y + 1.5, M.dais.z), gain: 0.5 }); } catch { /* quiet */ }
      }
    } else { B.said = 'the band takes a break'; M.log.push({ t: M.t, slot, name: null }); }
  }
  if (B.tune && !B.player && !M.off) {
    M.rearm -= dt;
    if (M.rearm <= 0) { B.player = openPlayer(B.tune, { gain: 0, loop: true, voices: STYLE_BY.get(B.tune.style).voices }); if (!B.player) M.rearm = REARM; }
  }
  /* THE LEVEL: a distance law off the dais, damped by the room's walls outside it. */
  const d = Math.hypot(M.dais.x - px, M.dais.z - pz);
  let g = d < BAND_MAX ? 1 / (1 + (d / BAND_HALF) * (d / BAND_HALF)) : 0;
  const here = placeUnder(world, px, pz);
  if (!here || here.id !== 14) g *= 0.35;
  if (!B.tune || !B.player) g = 0;
  const playing = !!B.tune;
  if (B.player) { setLevel(B.player, g); stepPlayer(B.player); }
  M.levels.band = B.player ? g : 0;
  /* THE MURMUR DUCKS while they play. */
  if (playing !== B.on) { B.on = playing; duckMurmur(world, playing ? MURMUR_DUCK : 1); }
  /* THE SWAY, on the beat. */
  const beat = B.player ? beatOf(B.player) : M.t * 2;
  const sway = Math.sin(beat * Math.PI) * 0.12;
  for (const b of B.bodies) {
    pin(b.body, b.x, b.y, b.z, M.dais.yaw + sway);
    if (b.prop && b.body.rig) cupInHand(b.prop, b.body.rig, b.side);
  }
}

/* THE BUSKER */
function buskerUp(world, st, M) {
  if (M.busker || !M.spot) return;
  const S = M.spot;
  const y = world.floorAt ? world.floorAt(S.x, S.z) : S.y;
  const body = spawnStill(world, 'busker', 'human', { x: S.x, y, z: S.z }, S.yaw, 'busker', BUSKER_NAME);
  if (!body) return;
  body.stationBusker = true;
  const lute = makeLute(), hat = makeHat();
  const scene = world.scene;
  scene?.add?.(lute); scene?.add?.(hat);
  hat.position.set(S.hat.x, (world.floorAt ? world.floorAt(S.hat.x, S.hat.z) : S.y) + 0.005, S.hat.z);
  const led = buskerState();
  for (let i = 0; i < Math.min(12, led.tips | 0); i++) addCoin(hat, i);
  M.busker = { body, lute, hat, y, player: null, quarter: -1, tune: null, request: null, greeted: false, tipsToday: 0 };
}
function buskerDown(world, M) {
  const B = M.busker;
  if (!B) return;
  B.lute?.parent?.remove(B.lute); B.hat?.parent?.remove(B.hat);
  removeBody(world, B.body);
  if (B.player) closePlayer(B.player);
  M.busker = null;
  M.levels.busker = 0;
}
function stepBusker(world, st, M, dt, px, pz) {
  const on = withinHours(st.hour, BUSKER_FROM, BUSKER_TO) && !!M.spot;
  if (!on) { if (M.busker) buskerDown(world, M); return; }
  if (!M.busker) buskerUp(world, st, M);
  const B = M.busker;
  if (!B) return;
  const S = M.spot;
  const q = Math.floor((Number(st.hour) || 0) * 4);
  /* A request plays through once and then he is back on his own list. */
  if (B.player?.done && B.request != null) { closePlayer(B.player); B.player = null; B.request = null; B.quarter = -1; }
  if (q !== B.quarter && B.request == null) {
    B.quarter = q;
    if (B.player) { closePlayer(B.player); B.player = null; }
    B.tune = buskerTune(st.day, st.hour);
  }
  if (B.tune && !B.player && !M.off) {
    M.rearm -= dt;
    if (M.rearm <= 0) { B.player = openPlayer(B.tune, { gain: 0, loop: B.request == null, voices: 1 }); if (!B.player) M.rearm = REARM; }
  }
  const d = Math.hypot(S.x - px, S.z - pz);
  let g = d < BUSKER_MAX ? 0.7 / (1 + (d / BUSKER_HALF) * (d / BUSKER_HALF)) : 0;
  if (!B.player) g = 0;
  if (B.player) { setLevel(B.player, g); stepPlayer(B.player); }
  M.levels.busker = B.player ? g : 0;
  /* A PATRON IS GREETED, once a visit, when he sees you. */
  if (!B.greeted && d < 4 && (buskerState().tips | 0) >= PATRON_AT) {
    B.greeted = true;
    world.notify?.(BUSKER_NAME.toUpperCase(), `ah — my patron. ${buskerState().tips | 0} credits in the hat from you alone`);
  }
  const beat = B.player ? beatOf(B.player) : M.t * 2;
  const sway = Math.sin(beat * Math.PI) * 0.08;
  pin(B.body, S.x, B.y, S.z, S.yaw + sway);
  if (B.lute && B.body.rig) cupInHand(B.lute, B.body.rig, 'L');
}

/**
 * THE INTERACT KEY ON THE BUSKER — `stationKey`'s one line. True when the press
 * was spent here: a credit in the hat and a named request.
 */
export function musicKey(world) {
  const M = world?._music;
  const B = M?.busker;
  const p = world?.player?.position;
  if (!B || !p || B.body.dead) return false;
  const d = Math.hypot(B.body.position.x - p.x, B.body.position.z - p.z);
  if (d > 2.4) return false;
  const r = spend(1, 'busker');
  if (!r.ok) { world.notify?.(BUSKER_NAME.toUpperCase(), `the hat is out; you have ${purse()} credits`); return true; }
  const led = { ...buskerState() };
  led.tips = (led.tips | 0) + 1;
  led.lastDay = stationDay();
  led.requests = (led.requests | 0) + 1;
  setBuskerState(led);
  B.tipsToday++;
  addCoin(B.hat, led.tips);
  /* THE REQUEST: named off the count, so every tip is a different tune. */
  B.request = led.tips;
  if (B.player) { closePlayer(B.player); B.player = null; }
  B.tune = buskerTune(M.deck === 40 ? stationDay() : 0, 12, B.request);
  M.rearm = 0;
  const patron = led.tips >= PATRON_AT;
  const line = `${patron ? 'for my patron — ' : ''}"${B.tune.name}"${led.tips === 1 ? '. the first coin of the day' : ''}`;
  world.notify?.(BUSKER_NAME.toUpperCase(), line);
  speak(line, B.body?.stationSpecies || 'human', { pos: B.body?.position || null }); // V20 lane 4
  M.log.push({ t: M.t, busker: true, name: B.tune.name, tips: led.tips });
  return true;
}

/* THE DRUM'S THEME */
function stepDrum(world, st, M, dt, px, pz) {
  const on = st.tvOn?.kind === 'drum';
  let near = null, bd = DRUM_REACH;
  if (on && st.tvs) {
    for (const tv of st.tvs) {
      const m = tv.mesh;
      if (!m || (tv.group && !tv.group.visible)) continue;
      const d = Math.hypot(m.position.x - px, m.position.z - pz);
      if (d < bd) { bd = d; near = tv; }
    }
  }
  if (!near) {
    if (M.drum) { closePlayer(M.drum.player); M.drum = null; }
    M.levels.drum = 0;
    return;
  }
  if (!M.drum && !M.off) {
    M.rearm -= dt;
    if (M.rearm <= 0) {
      const tune = drumTune(st.day);
      const player = openPlayer(tune, { gain: 0, loop: true, voices: 3 });
      if (player) M.drum = { player, tune }; else M.rearm = REARM;
    }
  }
  if (!M.drum) return;
  const g = DRUM_GAIN * (1 - bd / DRUM_REACH);
  setLevel(M.drum.player, g); stepPlayer(M.drum.player);
  M.levels.drum = g;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE SCORE — music that scores WHAT YOU ARE DOING (V20 lane 4, half two)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"a music system that scores what you are doing, not where you are standing."*
 *
 * Everything above this line is music as PLACE: the band is in the cantina, the
 * busker is by a kiosk, the Drum's theme is under a screen, and all three are a
 * distance law — walk away and they go. That is right for a station and it is
 * not a score. A player being chased along the ring by a thief with his money
 * heard exactly what a player standing on the same metre of deck doing nothing
 * heard, because the only question the music had ever been asked was where the
 * listener was.
 *
 * So: NINE STATES, each a style, a tempo, an intensity and four layers, and one
 * derivation from the things the station already knows — the thief is running,
 * the saber is lit and something is close, Command has sounded the klaxon, the
 * names are being read in the chapel, the market is on, you are asleep.
 *
 * ── WHY IT IS BUILT ON `tuneFor` AND NOT ON A SECOND ENGINE ─────────────
 *
 * The tune engine above is already a seeded, deterministic, in-mode composer
 * with a bass, a melody, a harmony, a counter voice and drums on four separate
 * gains. A state is therefore a SET OF ARGUMENTS to it — a style, a tempo
 * override (the one thing `tuneFor` did not take, added for this), and which of
 * its four voices are up — rather than a new synthesiser. Everything the band
 * gets for free the score gets too: it is in a key, it loops, it goes through
 * `musicBus`, it stops at Music 0, and it cannot make a note outside the mode.
 *
 * ── THE CROSSFADE IS ON THE BEAT AND TAKES TWO BARS ─────────────────────
 *
 * A cut is what a menu does. Two players run at once through the change: the
 * outgoing one falls and the incoming one rises over `SCORE_BARS` bars, and the
 * change does not START until the next beat, so a fight beginning halfway
 * through a bar does not put the drums a quaver out for the rest of the level.
 *
 * The fade runs on the SCORE'S OWN CLOCK (`dt`) and not on the audio clock,
 * which is what makes it measurable: `scoreNow()` is true whether or not a
 * WebAudio context ever existed, and the state machine is therefore checkable
 * on a machine with no sound at all.
 *
 * ── IT SITS UNDER THE ROOM ──────────────────────────────────────────────
 *
 * Idle is 0.06 — under the band, under the busker, under the beds; you are
 * meant to notice it only when it is not there. `UNDER_PLACE` drops it further
 * again while a musician in the room is actually playing, because the cantina's
 * band is the better music and the score's job at that moment is to get out of
 * its way.
 */

/** Bars a state change is crossfaded over, and the beats in them. */
export const SCORE_BARS = 2;
/** A win or a loss holds the score for this long before the derivation resumes. */
export const SCORE_STINGER = 6;
/** What the score is multiplied by while the band or the busker is audible. */
export const UNDER_PLACE = 0.35;

/**
 * NINE STATES. `bpm` and `intensity` are the two numbers a listener perceives;
 * `layers` is which of the tune engine's four voices and its drums are up, and
 * is what makes an intensity audible rather than merely louder.
 */
export const SCORES = Object.freeze({
  idle: { id: 'idle', style: 'human', bpm: 76, intensity: 0.15, gain: 0.06,
    layers: { drums: 0, bass: 0.9, melody: 0.25, pad: 1 } },
  market: { id: 'market', style: 'centauri', bpm: 116, intensity: 0.45, gain: 0.13,
    layers: { drums: 0.7, bass: 1, melody: 0.9, pad: 0.8 } },
  chase: { id: 'chase', style: 'drazi', bpm: 158, intensity: 0.85, gain: 0.24,
    layers: { drums: 1, bass: 1, melody: 0.8, pad: 0 } },
  fight: { id: 'fight', style: 'narn', bpm: 142, intensity: 1.00, gain: 0.28,
    layers: { drums: 1, bass: 1, melody: 1, pad: 0.5 } },
  vigil: { id: 'vigil', style: 'minbari', bpm: 56, intensity: 0.25, gain: 0.18,
    layers: { drums: 0, bass: 0.7, melody: 0.9, pad: 1 } },
  alert: { id: 'alert', style: 'drum', bpm: 128, intensity: 0.75, gain: 0.24,
    layers: { drums: 1, bass: 1, melody: 0.3, pad: 0.9 } },
  sleep: { id: 'sleep', style: 'minbari', bpm: 44, intensity: 0.08, gain: 0.10,
    layers: { drums: 0, bass: 0.5, melody: 0, pad: 1 } },
  win: { id: 'win', style: 'cantina', bpm: 132, intensity: 0.70, gain: 0.22,
    layers: { drums: 0.9, bass: 1, melody: 1, pad: 0.7 } },
  loss: { id: 'loss', style: 'narn', bpm: 58, intensity: 0.30, gain: 0.20,
    layers: { drums: 0, bass: 1, melody: 0.6, pad: 1 } },
});
export const SCORE_KEYS = Object.keys(SCORES);
export const scoreCfg = (name) => SCORES[name] || SCORES.idle;

/**
 * ONE SCORE, at module scope, because there is one of them: it outlives a deck
 * change the way the player's own ears do, and a hook in `Quests` or
 * `Pickpocket` can reach it without being handed a world.
 */
const SC = {
  state: 'idle', from: 'idle', want: 'idle',
  tempo: SCORES.idle.bpm, intensity: SCORES.idle.intensity,
  beat: 0, armAt: 0, fade: 1, hold: 0, level: 0, t: 0, lost: '',
  player: null, old: null, rearm: 0, changes: 0, log: [],
};

/** What the score is doing. The observable, and it needs no audio context. */
export function scoreNow() {
  return { state: SC.state, from: SC.from, want: SC.want, tempo: SC.tempo,
    intensity: SC.intensity, level: SC.level, fade: SC.fade, beat: SC.beat,
    hold: SC.hold, changes: SC.changes };
}
export function scoreLog() { return SC.log.slice(); }

/**
 * Ask for a state. Takes effect on the NEXT BEAT and is then crossfaded over
 * `SCORE_BARS` bars; asking twice for the same state is not a change.
 */
export function setScore(state) {
  const name = SCORES[state] ? state : 'idle';
  if (name === SC.want) return false;
  SC.want = name;
  SC.armAt = Math.ceil(SC.beat + 1e-6);
  return true;
}

/** A job paid, or money gone: the score says so, and then goes back to work. */
export function scoreStinger(kind = 'win') {
  const name = kind === 'loss' ? 'loss' : 'win';
  SC.hold = SCORE_STINGER;
  setScore(name);
  return name;
}

/** Everything back to the top. For a level teardown, and for a check. */
export function resetScore() {
  if (SC.player) closePlayer(SC.player);
  if (SC.old) closePlayer(SC.old);
  SC.state = SC.from = SC.want = 'idle';
  SC.tempo = SCORES.idle.bpm; SC.intensity = SCORES.idle.intensity;
  SC.beat = 0; SC.armAt = 0; SC.fade = 1; SC.hold = 0; SC.level = 0; SC.t = 0; SC.lost = '';
  SC.player = null; SC.old = null; SC.rearm = 0; SC.changes = 0; SC.log.length = 0;
}

/** A player for a state: its style, its tempo, and only the layers it wants. */
function openScore(state, day = 0) {
  const C = scoreCfg(state);
  const tune = tuneFor(seedOf(`score:${state}:${day | 0}`), C.style, { bpm: C.bpm });
  const P = openPlayer(tune, { gain: 0, loop: true });
  if (!P) return null;
  const L = C.layers;
  /* melody, bass, harmony, counter — the harmony rides the melody's layer at a
   * lower level, and the counter voice IS the pad. */
  const want = [L.melody, L.bass, L.melody * 0.7, L.pad];
  for (let i = 0; i < 4; i++) { try { P.voices[i].gain.value = VOICE_GAIN[i] * want[i]; } catch { /* gone */ } }
  try { P.drums.gain.value = 0.5 * L.drums; } catch { /* gone */ }
  P.score = state;
  return P;
}

/** How far from the player a hostile counts as a fight. */
export const FIGHT_REACH = 20;

/**
 * WHAT THE PLAYER IS DOING, off what the station already knows. Every one of
 * these is a fact some other file owns; nothing here decides anything.
 */
export function deriveScore(world, st) {
  const life = world?._stationLife;
  if (world?._sleep?.active) return 'sleep';
  /* THE SABER IS LIT AND SOMETHING IS CLOSE — or a bout is on in the Arena. */
  const bout = world?._pitBout;
  if (bout && !bout.over) return 'fight';
  if (world?.player?.saber?.lit) {
    const p = world.player.position;
    for (const e of world.enemies || []) {
      if (!e || e.dead || e.alive === false || !e.position) continue;
      if (Math.hypot(e.position.x - p.x, e.position.z - p.z) <= FIGHT_REACH) return 'fight';
    }
  }
  /* THE THIEF IS RUNNING: he has your money, he is on his feet, he is not caught. */
  const P = life?.pick;
  if (P && P.body && P.lifted > 0 && !P.caught) return 'chase';
  if ((life?.war?.alert || 0) > 0) return 'alert';
  if (life?.vigil?.on) return 'vigil';
  /* MARKET DAY, and it is `StationLife`'s own running row rather than an hour
   * written twice: the event is 10:00 for 55 minutes and says so itself. */
  if (life?.event?.id === 'market') return 'market';
  return 'idle';
}

/**
 * `stepMusic`'s one line. Derives the state, moves the crossfade, and commands
 * the two players' levels.
 */
export function stepScore(world, st, dt) {
  if (!(dt > 0)) return;
  SC.t += dt;
  SC.beat += dt * SC.tempo / 60;
  /* THE LOSS THE STATION CAN ACTUALLY DETECT, and it is not a purse going
   * down: a purse goes down at every counter on the deck. The thief getting
   * away with your money is the one unambiguous one, and `StationSave` already
   * writes it — `gone` with a `taken`, once a day, which is also what makes
   * this fire once rather than every frame after it. */
  let S = null;
  try { S = pickpocketState(); } catch { S = null; }
  const key = S && S.gone && (S.taken | 0) > 0 ? `${S.day | 0}:${S.taken | 0}` : '';
  if (key && key !== SC.lost) { SC.lost = key; scoreStinger('loss'); }
  if (SC.hold > 0) SC.hold = Math.max(0, SC.hold - dt);
  else if (world && st) setScore(deriveScore(world, st));
  else if (SC.want === 'win' || SC.want === 'loss') setScore('idle');

  /* THE CHANGE, ON THE BEAT. */
  if (SC.want !== SC.state && SC.beat >= SC.armAt) {
    SC.from = SC.state;
    SC.state = SC.want;
    SC.tempo = scoreCfg(SC.state).bpm;
    SC.fade = 0;
    SC.changes++;
    SC.log.push({ t: SC.t, from: SC.from, to: SC.state, tempo: SC.tempo });
    if (SC.log.length > 32) SC.log.shift();
    if (SC.old) { closePlayer(SC.old); SC.old = null; }
    SC.old = SC.player; SC.player = null;
    SC.rearm = 0;
  }
  const C = scoreCfg(SC.state), F = scoreCfg(SC.from);
  if (SC.fade < 1) {
    const bars = SCORE_BARS * BEATS * 60 / Math.max(20, SC.tempo);
    SC.fade = Math.min(1, SC.fade + dt / bars);
  }
  SC.intensity = F.intensity + (C.intensity - F.intensity) * SC.fade;

  const M = world?._music;
  const off = M ? M.off : (!((audio.musicVolume ?? 0.45) > 0.001) || !!audio.muted);
  if (off) {
    if (SC.player) { closePlayer(SC.player); SC.player = null; }
    if (SC.old) { closePlayer(SC.old); SC.old = null; }
    SC.level = 0;
    return;
  }
  /* UNDER THE ROOM'S OWN MUSIC. */
  const place = M?.levels || {};
  const under = ((place.band || 0) + (place.busker || 0)) > 0.02 ? UNDER_PLACE : 1;
  const base = C.gain * under;
  SC.level = base * SC.fade;

  if (!SC.player) {
    SC.rearm -= dt;
    if (SC.rearm <= 0) {
      SC.player = openScore(SC.state, st?.day ?? 0);
      if (!SC.player) SC.rearm = REARM;
    }
  }
  if (SC.player) { setLevel(SC.player, SC.level); stepPlayer(SC.player); }
  if (SC.old) {
    const gone = scoreCfg(SC.from).gain * under * (1 - SC.fade);
    setLevel(SC.old, gone); stepPlayer(SC.old);
    if (SC.fade >= 1) { closePlayer(SC.old); SC.old = null; }
  }
}

export function stepMusic(world, st, dt) {
  const M = world?._music;
  if (!M || !st || !(dt > 0)) return;
  M.t += dt;
  const p = world.player?.position;
  const px = p ? p.x : 0, pz = p ? p.z : 0;
  /* MUSIC OFF IS OFF: no players opened, and the bodies still play in mime. */
  const off = !((audio.musicVolume ?? 0.45) > 0.001) || !!audio.muted;
  M.off = off;
  if (off) {
    for (const P of [M.band?.player, M.busker?.player, M.drum?.player]) if (P) closePlayer(P);
    if (M.band) M.band.player = null;
    if (M.busker) M.busker.player = null;
    M.drum = null;
  }
  stepBand(world, st, M, dt, px, pz);
  stepBusker(world, st, M, dt, px, pz);
  stepDrum(world, st, M, dt, px, pz);
  stepScore(world, st, dt); // V20 lane 4: the score, under the place's own music
}

export function undressMusic(world) {
  const M = world?._music;
  if (!M) return;
  bandDown(world, M);
  buskerDown(world, M);
  if (M.drum) { closePlayer(M.drum.player); M.drum = null; }
  resetScore(); // V20 lane 4: the score goes with the deck
  world._music = null;
}
