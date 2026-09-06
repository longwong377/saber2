/**
 * ══════════════════════════════════════════════════════════════════════════
 *  A VOICE WITH WORDS IN IT — V20 lane 4, the first half
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"sound with words in it … not recorded lines, but the synthesis pushed to
 * real speech-like cadence for the tannoy and barks."*
 *
 * `src/engine/Voice.js` already synthesises a LARYNX — a glottal source through
 * two formants, with a chest under it — and `Audio.speak` plays it. What it
 * does not have is LANGUAGE: its contours are hand-written syllable lists per
 * emotion (`effort`, `scream`, `alarm`), so every line the station ever said
 * was the same two grunts whatever the words on the banner were. The tannoy
 * read forty different announcements in one noise.
 *
 * This is the other half, and the only thing it adds is the text:
 *
 *   THE SPLITTER   `syllabify(text)` — vowel runs are nuclei, the consonants
 *                  in front of one are its onset, a run between two nuclei
 *                  gives its last consonant to the next syllable and keeps the
 *                  rest as a coda. Digits are said as digits ("0600 hours" is
 *                  four digits and a word), a silent final 'e' is folded back,
 *                  and a word with no vowel in it at all is one schwa.
 *                  Nothing here is a dictionary; it is the rule a reader uses
 *                  on a word they have never seen, which is exactly the job.
 *   THE VOWELS     each nucleus carries a real formant pair (F1/F2 off the
 *                  cardinal vowel chart), scaled by the SPEAKER's own throat.
 *                  This is what makes it read as words rather than as a
 *                  contour: the filters MOVE between syllables, and the ear
 *                  hears vowel colour long before it hears pitch.
 *   THE CONTOUR    a sentence declines. `contourAt` falls 1.06 → 0.86 across a
 *                  statement, and a question turns that around and lifts the
 *                  last third to 1.28 — the two intonations English actually
 *                  has. Long words take a stress: higher, longer, louder on
 *                  their first syllable.
 *   THE VOICES     eight of them, and the numbers are the whole of the
 *                  characterisation: `f0` (the larynx), `formants` (the
 *                  throat), `rate` (the pace), `bend` (how far a syllable
 *                  slides), plus one structural trick each where a throat
 *                  cannot do the work — a sub-octave under the Narn, an
 *                  inharmonic ring on the droid, a chord for a Vorlon, a
 *                  band-limit and a slapback for the tannoy.
 *
 * ── ONE SOUND, ONE VOICE OUT OF THE POOL ────────────────────────────────
 *
 * A twelve-word line is sixteen syllables. Through `tone()` that would be
 * sixteen oscillators and sixteen of the engine's forty-four voices for one
 * thing a listener hears as one thing — which is the trap `Audio.shape`'s own
 * docstring was written about. So every utterance is TWO OR THREE sources with
 * automation on them: one glottal oscillator whose frequency and whose two
 * formant filters are scheduled per syllable, one looping noise source for the
 * consonant onsets and the breath, and at most one extra for the voice's own
 * trick. One `shape()` call, one voice, however long the sentence.
 *
 * ── THE QUEUE ───────────────────────────────────────────────────────────
 *
 * Two lines on one voice at once is not a mix, it is a fault: the tannoy
 * talking over itself is the single most obviously broken sound a station can
 * make. `QUEUE` holds, per voice, the audio-clock time that voice is free, and
 * a line that arrives before then is scheduled AFTER it — every event offset by
 * the wait, inside the same one `shape()`. A backlog longer than `MAX_WAIT` is
 * dropped rather than queued: a tannoy that is four announcements behind is not
 * a tannoy.
 *
 * And the score gets out of the way — `DUCK` (6 dB) for as long as the line
 * lasts, through the engine's own sidechain, so this is the same mechanism a
 * clash uses and cannot fight with it.
 *
 * No `Math.random`: the only dither is a hash of the text.
 */

import { audio, canSpeakWords } from '../engine/Audio.js';

/* ── the numbers ───────────────────────────────────────────────────────── */

/** Seconds of voiced core for one plain syllable at rate 1. */
export const SYLL = 0.068;
/** Silence after a syllable, inside a word. */
const SYLL_GAP = 0.042;
/** Silence between words. */
const WORD_GAP = 0.075;
/** A comma, and a full stop. */
const COMMA = 0.17, STOP = 0.25;
/** Longest a line may be made to wait behind another on its own voice. */
export const MAX_WAIT = 6;
/** How far the score is pulled down while somebody is talking: 6 dB. */
export const DUCK = 0.5;
/** Syllables past this in one line are dropped — a paragraph is not a bark. */
export const MAX_SYLL = 48;

/**
 * THE CARDINAL VOWELS, [F1, F2] in Hz for a neutral adult throat. F1 tracks how
 * open the mouth is, F2 how far forward the tongue sits; every voice below
 * scales this pair by its own `formants` against `NEUTRAL`, so a Narn says the
 * same vowel in the same place with a different throat around it.
 */
export const VOWELS = Object.freeze({
  a: [730, 1090], e: [530, 1840], i: [270, 2290], o: [570, 840], u: [440, 1020],
  y: [300, 2100], ':': [500, 1500],
});
const NEUTRAL = [560, 1400];

/** A consonant onset is a noise burst, and its colour is where in the mouth it is made. */
const ONSETS = Object.freeze({
  s: [5200, 0.30], z: [4600, 0.24], f: [4200, 0.22], v: [3200, 0.18], h: [2400, 0.16],
  t: [3000, 0.34], k: [2400, 0.32], p: [1500, 0.28], c: [2600, 0.30], x: [3400, 0.26],
  b: [700, 0.22], d: [1400, 0.26], g: [900, 0.22], j: [2800, 0.24], q: [2400, 0.26],
  m: [500, 0.10], n: [900, 0.12], l: [1100, 0.10], r: [1300, 0.14], w: [700, 0.10],
});
const ONSET_DEFAULT = [2000, 0.18];

/**
 * EIGHT LARYNXES.
 *
 *   f0        Hz, the pitch centre — the one number that decides who this is.
 *   formants  the throat this speaker's vowels are said through.
 *   rate      pace; 0.7 is slow and deliberate, 1.3 is clipped.
 *   bend      how far a syllable slides across itself.
 *   rasp      breath and grit, as a fraction of the voiced level.
 *   len       the syllable's own length multiplier — a Drazi clips and a
 *             Vorlon holds, and that is not the same thing as speaking fast.
 *   sub/ring/chord/band/slap  the one structural trick each, where a throat
 *             cannot do the work. See the note on each row.
 */
export const VOICES = Object.freeze({
  /* Mid and warm: the reference, and the one every derived species bends off. */
  human: { id: 'human', f0: 118, formants: [620, 1180], q: [5.5, 4.6], wave: 'sawtooth',
    rate: 1.00, bend: 0.07, rasp: 0.10, len: 1.00, mix: 0.55 },
  /* Low and CLIPPED: short syllables at a fast pace, almost no slide. */
  drazi: { id: 'drazi', f0: 86, formants: [480, 980], q: [7.0, 5.5], wave: 'sawtooth',
    rate: 1.30, bend: 0.035, rasp: 0.22, len: 0.80, mix: 0.6 },
  /* High, SLOW and BREATHY — the rasp is most of the character. */
  minbari: { id: 'minbari', f0: 196, formants: [760, 2100], q: [4.0, 3.2], wave: 'triangle',
    rate: 0.70, bend: 0.05, rasp: 0.45, len: 1.30, mix: 0.7 },
  /* Mid-high, with SMALL PITCH SLIDES on every syllable — the courtly one. */
  centauri: { id: 'centauri', f0: 150, formants: [700, 1600], q: [5.0, 4.4], wave: 'sawtooth',
    rate: 1.05, bend: 0.22, rasp: 0.14, len: 1.05, mix: 0.6 },
  /* Low and GROWLED: a sub-octave under the larynx, which no throat has. */
  narn: { id: 'narn', f0: 78, formants: [420, 900], q: [6.5, 5.0], wave: 'sawtooth',
    rate: 0.92, bend: 0.09, rasp: 0.30, len: 1.10, mix: 0.65, sub: 0.5 },
  /* A CHORD, slow. Three pitches at once is the one thing a listener cannot
   * hear as a person, which is the whole point of a Vorlon. */
  vorlon: { id: 'vorlon', f0: 132, formants: [560, 1700], q: [3.5, 3.0], wave: 'sine',
    rate: 0.62, bend: 0.03, rasp: 0.18, len: 1.45, mix: 0.8, chord: [1.5, 2.51] },
  /* Square and RING-MODULATED: an inharmonic partial, metal and not throat. */
  droid: { id: 'droid', f0: 240, formants: [900, 2400], q: [9.0, 7.0], wave: 'square',
    rate: 1.25, bend: 0.02, rasp: 0.06, len: 0.85, mix: 0.5, ring: 2.71 },
  /* A human through a compression driver: BAND-LIMITED, and the hall answers
   * it 85 ms later. `slap` is a second copy of the whole contour, offset — not
   * one delayed gain, because a delay would smear the pitch of the syllable
   * before it across the one being said. */
  tannoy: { id: 'tannoy', f0: 122, formants: [560, 1180], q: [5.5, 4.6], wave: 'sawtooth',
    rate: 0.95, bend: 0.05, rasp: 0.12, len: 1.05, mix: 0.55,
    band: [320, 3400], slap: 0.085, slapGain: 0.32 },
});
export const VOICE_KEYS = Object.keys(VOICES);

/** A string to a 0..1 draw. The only dither in this file. */
export function hashF(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 1000003) / 1000003;
}

/**
 * The voice a species speaks with.
 *
 * Fifteen species live on this station and eight rows are written down, so the
 * other seven are DERIVED rather than defaulted: the human larynx, moved by a
 * hash of the species name, which is stable forever and is never the same twice.
 * A defaulted species would make Brakiri and Hyach the same person.
 */
export function voiceFor(species) {
  const key = String(species || 'human').toLowerCase();
  if (VOICES[key]) return VOICES[key];
  const u = hashF(`voice:${key}`);
  const base = VOICES.human;
  return {
    ...base, id: key,
    f0: Math.round(base.f0 * (0.74 + u * 0.62)),
    formants: [Math.round(base.formants[0] * (0.86 + u * 0.34)), Math.round(base.formants[1] * (0.9 + u * 0.3))],
    rate: 0.86 + u * 0.34,
    bend: 0.05 + u * 0.1,
  };
}

/* ── the splitter ──────────────────────────────────────────────────────── */

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const isVowel = (c) => c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u' || c === 'y';

/** Digits are read as digits, the way a tannoy reads them: "0600" is four. */
function words(text) {
  const out = [];
  const raw = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
  for (const w of raw) {
    const tail = /[.!?]$/.test(w) ? 'stop' : /[,;:—–-]$/.test(w) ? 'comma' : '';
    const body = w.replace(/[^a-z0-9']/g, '');
    if (!body) { if (tail && out.length) out[out.length - 1].tail = tail; continue; }
    /* A word with digits in it is split at the seam rather than spelled out. */
    const parts = body.match(/\d+|[a-z']+/g) || [body];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], last = i === parts.length - 1;
      if (/^\d+$/.test(p)) {
        for (let k = 0; k < p.length; k++) out.push({ w: DIGITS[+p[k]], tail: last && k === p.length - 1 ? tail : '' });
      } else out.push({ w: p, tail: last ? tail : '' });
    }
  }
  return out;
}

/** One word into `[{ onset, nucleus, coda }]`. Nothing here is a dictionary. */
export function splitWord(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return [];
  const out = [];
  let i = 0, onset = '';
  while (i < w.length && !isVowel(w[i])) { onset += w[i]; i++; }
  if (i >= w.length) return [{ onset, nucleus: ':', coda: '' }]; // no vowel at all: one schwa
  while (i < w.length) {
    let nucleus = '';
    while (i < w.length && isVowel(w[i])) { nucleus += w[i]; i++; }
    let run = '';
    while (i < w.length && !isVowel(w[i])) { run += w[i]; i++; }
    if (i >= w.length) { out.push({ onset, nucleus, coda: run }); break; }
    /* A single consonant between two vowels belongs to the SECOND syllable
     * (wa-ter, not wat-er); a run of two or more keeps all but its last. */
    const coda = run.length <= 1 ? '' : run.slice(0, -1);
    out.push({ onset, nucleus, coda });
    onset = run.length ? run.slice(-1) : '';
  }
  /* THE SILENT E. "gate" is one syllable and so is "gates"; a splitter that
   * says two is the most audible thing this rule can get wrong. The exception
   * is the one English actually has: -es after a sibilant IS said (hou-ses,
   * pla-ces), and after anything else it is not (gates, notes). And a final
   * -le or -re keeps its own syllable (litt-le). */
  if (out.length > 1) {
    const last = out[out.length - 1];
    if (last.nucleus === 'e' && (!last.coda || last.coda === 's') && last.onset
        && !'lr'.includes(last.onset.slice(-1))
        && !(last.coda === 's' && 'szxcgj'.includes(last.onset.slice(-1)))) {
      out.pop();
      out[out.length - 1].coda += last.onset + last.coda;
    }
  }
  return out;
}

/**
 * A line into syllables, each carrying what it needs to be said: where it is
 * in the sentence, whether its word is long enough to take a stress, and what
 * silence follows it.
 */
export function syllabify(text) {
  const ws = words(text);
  const out = [];
  for (let wi = 0; wi < ws.length; wi++) {
    const { w, tail } = ws[wi];
    const parts = splitWord(w);
    if (!parts.length) continue;
    const long = w.length >= 7 || parts.length >= 3;
    for (let si = 0; si < parts.length; si++) {
      out.push({
        ...parts[si], word: w, wi, si, of: parts.length,
        stress: si === 0 && (parts.length > 1 || long),
        long,
        end: si === parts.length - 1,
        tail: si === parts.length - 1 ? tail : '',
      });
    }
    if (out.length >= MAX_SYLL) break;
  }
  return out.slice(0, MAX_SYLL);
}

/* ── the contour ───────────────────────────────────────────────────────── */

/** Is this a question? The mark, or an opening interrogative. */
export function isQuestion(text) {
  const s = String(text || '').trim();
  if (/\?\s*$/.test(s)) return true;
  return /^(what|who|where|when|why|how|which|are|is|do|does|did|can|could|will|would|have|has)\b/i.test(s);
}

/**
 * The pitch multiplier for syllable `i` of `n`.
 *
 * A STATEMENT DECLINES — 1.06 down to 0.86 — which is the single most
 * characteristic thing an English sentence does and is why a flat contour reads
 * as a machine. A QUESTION does the opposite in its last third and ends above
 * where it started. A stressed syllable is lifted out of whichever line it is on.
 */
export function contourAt(i, n, question, stress) {
  const u = n > 1 ? i / (n - 1) : 0;
  let p = question ? 0.94 + 0.02 * u : 1.06 - 0.20 * u;
  if (question && u > 0.72) p += ((u - 0.72) / 0.28) * 0.32;
  if (stress) p *= 1.09;
  /* The alternation a foot has, small enough to be rhythm and not melody. */
  p *= 1 + (i % 2 === 0 ? 0.012 : -0.012);
  return p;
}

/* ── the utterance ─────────────────────────────────────────────────────── */

/**
 * Everything about one line except the nodes: the syllables, when each is said,
 * at what pitch, through which formants, and how long the whole thing takes.
 *
 * A pure function of `(text, voice)` — which is what makes a check able to
 * measure a contour without building an audio graph at all.
 */
export function utterFor(text, voiceId = 'human', opts = {}) {
  const V = typeof voiceId === 'object' && voiceId ? voiceId : voiceFor(voiceId);
  const syl = syllabify(text);
  const question = opts.question ?? isQuestion(text);
  const rate = Math.max(0.3, (V.rate || 1) * (Number(opts.rate) || 1));
  const dither = 1 + (hashF(String(text)) - 0.5) * 0.06;
  const fs = [(V.formants?.[0] || NEUTRAL[0]) / NEUTRAL[0], (V.formants?.[1] || NEUTRAL[1]) / NEUTRAL[1]];
  const syllables = [];
  let t = 0;
  for (let i = 0; i < syl.length; i++) {
    const s = syl[i];
    const nuc = s.nucleus || ':';
    const vow = VOWELS[nuc[nuc.length - 1]] || VOWELS[':'];
    /* A doubled vowel or a stressed syllable is HELD; a coda shortens the
     * vowel and lends its time to the consonant that closes it. */
    let len = (V.len || 1) * (nuc.length > 1 ? 1.35 : 1) * (s.stress ? 1.28 : 1) * (s.coda ? 0.94 : 1);
    if (s.end && s.tail === 'stop') len *= 1.25;
    const dur = (SYLL * len) / rate;
    const p = contourAt(i, syl.length, question, s.stress) * dither;
    const f0 = (V.f0 || 118) * p;
    const bend = V.bend || 0.06;
    const level = (s.stress ? 1.0 : 0.82) * (s.end ? 0.95 : 1);
    const on = s.onset ? (ONSETS[s.onset[s.onset.length - 1]] || ONSET_DEFAULT) : null;
    syllables.push({
      t, dur, f0, from: f0 * (1 - bend * 0.6), to: f0 * (1 + bend * 0.4), pitch: p,
      F1: Math.round(vow[0] * fs[0]), F2: Math.round(vow[1] * fs[1]),
      level, stress: !!s.stress, vowel: nuc, word: s.word, text: `${s.onset}${s.nucleus}${s.coda}`,
      onset: on ? { freq: on[0], gain: on[1], dur: Math.min(0.055, dur * 0.45) } : null,
    });
    t += dur;
    t += (s.end ? WORD_GAP : SYLL_GAP) / rate;
    if (s.tail === 'comma') t += COMMA / rate;
    else if (s.tail === 'stop') t += STOP / rate;
  }
  const dur = Math.max(0.05, t - (WORD_GAP / rate));
  return { voice: V, text: String(text || ''), question, rate, syllables, count: syllables.length, dur };
}

/** The pitch a voice actually covers over a line: what makes two of them different. */
export function pitchRange(text, voiceId = 'human') {
  const u = utterFor(text, voiceId);
  if (!u.syllables.length) { const V = voiceFor(voiceId); return { min: V.f0, max: V.f0, mean: V.f0 }; }
  let lo = Infinity, hi = 0, sum = 0;
  for (const s of u.syllables) { lo = Math.min(lo, s.f0); hi = Math.max(hi, s.f0); sum += s.f0; }
  return { min: lo, max: hi, mean: sum / u.syllables.length };
}

/* ── the queue ─────────────────────────────────────────────────────────── */

/** Per voice, the audio-clock time it stops talking. */
const QUEUE = new Map();
/** What was said, for a check and for anything that wants to read it back. */
const SAID = [];
export const SAID_MAX = 32;

export function voiceFree(id, now = audio?.ctx?.currentTime || 0) {
  return Math.max(now, QUEUE.get(String(id)) || 0);
}
export function speechLog() { return SAID.slice(); }
export function resetVoices() { QUEUE.clear(); SAID.length = 0; }

/* ── the graph ─────────────────────────────────────────────────────────── */

/** One envelope, written onto a gain param. Never an exponential ramp to zero. */
function env(param, t0, dur, level, attack) {
  const a = Math.max(0.004, attack);
  param.setValueAtTime(0.0001, t0);
  param.linearRampToValueAtTime(Math.max(0.0002, level), t0 + a);
  param.setTargetAtTime(0.0001, t0 + a, Math.max(0.012, dur / 2.6));
  param.linearRampToValueAtTime(0.0001, t0 + dur + 0.02);
}

/**
 * Build one voice path — a source through two formants and a chest, with the
 * whole line's automation on it — and return the source.
 *
 * `off` is the slapback's offset: the tannoy builds this twice, the second one
 * later and quieter and darker, which is what a hall does to a horn.
 */
function voicePath(ctx, head, t0, u, pitch, { off = 0, gain = 1, dark = 0 } = {}) {
  const V = u.voice;
  const osc = ctx.createOscillator();
  osc.type = V.wave || 'sawtooth';
  const bus = ctx.createGain();
  bus.gain.value = gain;
  const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass';
  f1.frequency.value = (V.formants?.[0] || 600) * pitch; f1.Q.value = V.q?.[0] ?? 5;
  const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass';
  f2.frequency.value = (V.formants?.[1] || 1200) * pitch; f2.Q.value = V.q?.[1] ?? 4;
  const g1 = ctx.createGain(); g1.gain.value = 0.0001;
  const g2 = ctx.createGain(); g2.gain.value = 0.0001;
  const chest = ctx.createBiquadFilter(); chest.type = 'lowpass';
  chest.frequency.value = Math.max(80, (V.f0 || 118) * 2.2 * pitch); chest.Q.value = 0.9;
  const gc = ctx.createGain(); gc.gain.value = 0.0001;
  osc.connect(f1); f1.connect(g1); g1.connect(bus);
  osc.connect(f2); f2.connect(g2); g2.connect(bus);
  osc.connect(chest); chest.connect(gc); gc.connect(bus);
  let tail = bus;
  if (dark > 0 || V.band) {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
    hp.frequency.value = Math.max(20, V.band ? V.band[0] : 60); hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = Math.min(18000, (V.band ? V.band[1] : 5200) * (dark ? 0.55 : 1));
    lp.Q.value = 0.7;
    bus.connect(hp); hp.connect(lp); tail = lp;
  }
  tail.connect(head);
  const mix = V.mix ?? 0.55;
  for (const s of u.syllables) {
    const t = t0 + off + s.t;
    osc.frequency.setValueAtTime(Math.max(20, s.from * pitch), t);
    osc.frequency.linearRampToValueAtTime(Math.max(20, s.to * pitch), t + s.dur);
    f1.frequency.setTargetAtTime(s.F1 * pitch, t, 0.018);
    f2.frequency.setTargetAtTime(s.F2 * pitch, t, 0.018);
    env(g1.gain, t, s.dur, s.level * 0.9, s.dur * 0.16);
    env(g2.gain, t + s.dur * 0.02, s.dur * 0.9, s.level * mix * 0.8, s.dur * 0.22);
    env(gc.gain, t, s.dur * 0.95, s.level * 0.3, s.dur * 0.2);
  }
  return osc;
}

/** The consonants and the breath: one looping noise source, one burst per onset. */
function noisePath(ctx, head, t0, u, buf) {
  if (!buf) return null;
  const V = u.voice;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const flt = ctx.createBiquadFilter(); flt.type = 'bandpass';
  flt.frequency.value = 2000; flt.Q.value = 1.6;
  const g = ctx.createGain(); g.gain.value = 0.0001;
  src.connect(flt); flt.connect(g); g.connect(head);
  const rasp = V.rasp || 0;
  for (const s of u.syllables) {
    const t = t0 + s.t;
    if (s.onset) {
      const d = Math.max(0.012, s.onset.dur);
      const at = Math.max(t0, t - d * 0.8);
      flt.frequency.setValueAtTime(s.onset.freq, at);
      env(g.gain, at, d, s.onset.gain * s.level, 0.004);
    }
    if (rasp > 0.02) {
      flt.frequency.setTargetAtTime(Math.max(600, s.F2 * 1.1), t, 0.02);
      env(g.gain, t, s.dur * 0.9, rasp * s.level * 0.5, s.dur * 0.2);
    }
  }
  return src;
}

/** The one structural trick, where the row has one: a sub, a ring or a chord. */
function extraPaths(ctx, head, t0, u, pitch) {
  const V = u.voice;
  const out = [];
  const mk = (mult, type, level, filter) => {
    const o = ctx.createOscillator(); o.type = type;
    const f = ctx.createBiquadFilter(); f.type = filter.type; f.frequency.value = filter.freq; f.Q.value = filter.q;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    o.connect(f); f.connect(g); g.connect(head);
    for (const s of u.syllables) {
      const t = t0 + s.t;
      o.frequency.setValueAtTime(Math.max(20, s.from * mult * pitch), t);
      o.frequency.linearRampToValueAtTime(Math.max(20, s.to * mult * pitch), t + s.dur);
      env(g.gain, t, s.dur * 0.9, s.level * level, s.dur * 0.15);
    }
    out.push(o);
  };
  if (V.sub) mk(V.sub, 'sine', 0.36, { type: 'lowpass', freq: Math.max(90, (V.f0 || 90) * 1.6), q: 0.9 });
  if (V.ring) mk(V.ring, 'square', 0.30, { type: 'bandpass', freq: (V.formants?.[1] || 1200) * 1.15, q: (V.q?.[1] ?? 5) * 1.4 });
  if (Array.isArray(V.chord)) for (const m of V.chord) mk(m, V.wave || 'sine', 0.26, { type: 'bandpass', freq: (V.formants?.[1] || 1200) * m * 0.6, q: 3 });
  return out;
}

/* ── the call ──────────────────────────────────────────────────────────── */

/**
 * SAY IT.
 *
 * Returns the record of what was scheduled — `{ at, wait, dur, count }` — or
 * null when nothing was said, which is a real answer and not a failure: the
 * engine may not be up, the voice slider may be at zero, the line may be behind
 * a backlog longer than `MAX_WAIT`, or the player may have chosen the browser's
 * own speech, in which case `Audio.radio` says it with real words and this
 * stands down rather than doubling it.
 */
export function speak(text, voiceId = 'human', opts = {}) {
  const line = String(text || '').trim();
  if (!line) return null;
  const V = typeof voiceId === 'object' && voiceId ? voiceId : voiceFor(voiceId);
  const u = utterFor(line, V, opts);
  if (!u.count) return null;
  /**
   * THE LINE IS LOGGED WHERE IT WAS ASKED FOR, not where it was heard.
   *
   * `heard` is what actually got a graph, and it is false for every reason a
   * sound is ever refused — no context yet, the voice slider at zero, a
   * backlog, a cull. A caller still gets `null` in all of those, so nothing
   * downstream can mistake a refusal for a reading; but "the PA is a voice and
   * not a caption" is a question about the CALL, and a check on a station with
   * no audio device has to be able to ask it. That check exists
   * (`station.mjs`) and it is the one that caught the tannoy going quiet.
   */
  const rec = { voice: V.id || 'human', text: line, at: 0, wait: 0, dur: u.dur,
    count: u.count, question: u.question, heard: false };
  SAID.push(rec);
  if (SAID.length > SAID_MAX) SAID.shift();
  /* THE PLAYER'S CHOICE COMES FIRST. In 'spoken' the browser's own synthesiser
   * says the words and a contour under it would be two readings at once. */
  if (audio?.ready && audio.speechMode === 'spoken' && canSpeakWords()) {
    try { audio.radio({ ...V, cadence: V.rate, gain: 1 }, line, { pos: opts.pos || null, gain: opts.gain ?? 0.8 }); } catch { /* no synth */ }
    rec.heard = true;
    return null;
  }
  if (!audio?.ready || !audio.ctx) return null;
  if ((audio.voiceLevel ?? 1) <= 0.001) return null;
  const now = audio.ctx.currentTime;
  const id = V.id || 'human';
  const at = Math.max(now, QUEUE.get(id) || 0);
  const wait = at - now;
  if (wait > MAX_WAIT) return null;
  const slap = V.slap || 0;
  const total = wait + u.dur + slap + 0.12;
  const gain = Math.max(0, Math.min(2, Number(opts.gain ?? 0.9)));
  const ok = audio.shape({
    dur: total, gain, pos: opts.pos || null, dest: audio.speechBus,
    build: (ctx, head, t0, pitch) => {
      const t = t0 + wait;
      const srcs = [voicePath(ctx, head, t, u, pitch)];
      const n = noisePath(ctx, head, t, u, audio.noiseBuffer(false));
      if (n) srcs.push(n);
      for (const e of extraPaths(ctx, head, t, u, pitch)) srcs.push(e);
      /* THE HALL, for the tannoy only: the same contour again, later, darker
       * and quieter. A PA in a drum this size is mostly its own reflection. */
      if (slap) srcs.push(voicePath(ctx, head, t, u, pitch, { off: slap, gain: V.slapGain ?? 0.3, dark: 1 }));
      return srcs;
    },
  });
  if (!ok) return null;
  QUEUE.set(id, at + u.dur + slap + 0.06);
  /* THE SCORE MAKES ROOM — 6 dB, for as long as the line lasts, through the
   * engine's own sidechain so a clash and a word cannot fight over the bus. */
  try { audio.duckMusic(DUCK, wait + u.dur + 0.25); } catch { /* no score */ }
  rec.at = at; rec.wait = wait; rec.heard = true;
  return rec;
}
