/**
 * THE STATION SAYS THINGS — V20 lane 4. `src/game/Voice.js`, and the score in
 * `src/game/Music.js`.
 *
 * "sound with words in it" is a claim about a SIGNAL, and the two ways of
 * pretending to have checked it are both available here and both refused:
 * reading the source for the word "syllable", and asserting that a function
 * returned something truthy. So these measure numbers instead.
 *
 * `utterFor` is a pure function of text and voice — no context, no nodes — so
 * the contour is measurable directly: how many syllables a twelve-word line is
 * cut into, how long it takes to say, and where its pitch goes. A statement
 * that does not fall and a question that does not rise are both flat, and flat
 * is the thing this lane exists to remove.
 *
 * The wiring is measured on a REAL booted station with the real audio engine on
 * an offline WebAudio, because the failure that matters is not "the synthesiser
 * is wrong" but "nothing ever calls it": before this lane the tannoy had forty
 * announcements and one noise, and every check of that noise passed.
 */
import { readFile } from 'node:fs/promises';
import * as V from '../../src/game/Voice.js';
import * as Music from '../../src/game/Music.js';
import { audio } from '../../src/engine/Audio.js';
import { clearStation } from '../../src/game/StationSave.js';
import { OfflineCtx } from './_offline-audio.mjs';
import { clocked } from './_shared.mjs';

/** Twelve words, an ordinary announcement, and the line every timing below is measured on. */
const LINE = 'the tram runs the four platforms every ninety seconds, stand well clear';
const QUESTION = 'what brings you up to the ring at this hour of the night?';

/* ── the rig ───────────────────────────────────────────────────────────── */

/** The engine on an offline context. Every own property goes back after. */
function bootAudio() {
  const prev = globalThis.AudioContext;
  let ctx = null;
  globalThis.AudioContext = function () { ctx = new OfflineCtx(48000); return ctx; };
  const was = { ...audio };
  audio.ctx = null; audio.ready = false; audio._lastWake = -1e9;
  try { audio.init(); } finally { globalThis.AudioContext = prev; }
  audio.musicVolume = 0.5;
  audio.voiceLevel = 0.9;
  audio.speechMode = 'synth';
  V.resetVoices();
  return { ctx, was };
}
function restoreAudio(was) {
  for (const k of Object.keys(audio)) delete audio[k];
  Object.assign(audio, was);
  V.resetVoices();
}

async function station(deck = 40) {
  const { bootWorld } = await import('./_coop.mjs');
  const { prepareStation, finishStationBuild } = await import('../../src/game/Station.js');
  if (!globalThis.__stationFetch) {
    const root = new URL('../../', import.meta.url);
    globalThis.__stationFetch = true;
    globalThis.fetch = async (url) => {
      const buf = await readFile(new URL(String(url), root));
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    };
  }
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  finishStationBuild(world);
  return world;
}

export async function run({ check, assert }) {
  const clockedCheck = await clocked(check);

  /* ══ (a) THE LINE ═══════════════════════════════════════════════════════ */

  check('voice: a twelve-word line is a sentence, not a grunt', () => {
    const words = LINE.split(/\s+/).length;
    assert(words === 12, `the line under test is ${words} words, not twelve`);
    const u = V.utterFor(LINE, 'human');
    assert(u.count >= 10 && u.count <= 20,
      `twelve words came out as ${u.count} syllables — the splitter is not splitting on the language`);
    assert(u.dur >= 2.5 && u.dur <= 4,
      `it takes ${u.dur.toFixed(2)} s to say, which is ${u.dur < 2.5 ? 'a burst' : 'a speech'}`);
    /* Every syllable is a real event with a length and a pitch, in order. */
    let last = -1;
    for (const s of u.syllables) {
      assert(s.t > last, 'two syllables at the same instant');
      assert(s.dur > 0.01 && s.dur < 0.5, `a ${s.dur.toFixed(3)} s syllable`);
      assert(s.f0 > 40 && s.f0 < 600, `a syllable at ${s.f0.toFixed(0)} Hz`);
      assert(s.F1 > 100 && s.F2 > s.F1, `formants ${s.F1}/${s.F2} are not a vowel`);
      last = s.t;
    }
    /* THE VOWELS MOVE. A line whose formants never change is a contour with
     * words written on the banner, which is exactly what was there before. */
    const f1s = new Set(u.syllables.map(s => s.F1));
    assert(f1s.size >= 3, `every syllable has the same first formant (${[...f1s]}) — no vowels`);
    const per = (u.dur / u.count) * 1000;
    return `${u.count} syllables, ${u.dur.toFixed(2)} s, ${per.toFixed(0)} ms a syllable, ${f1s.size} vowel colours`;
  });

  check('voice: a statement falls and a question rises', () => {
    const s = V.utterFor(LINE, 'human');
    assert(!s.question, 'the statement was read as a question');
    const s0 = s.syllables[0].f0, s1 = s.syllables[s.count - 1].f0;
    assert(s1 < s0 * 0.94,
      `the statement ends at ${s1.toFixed(1)} Hz having started at ${s0.toFixed(1)} — it does not fall`);
    /* …and it falls THROUGHOUT, not only at the last syllable. */
    const mid = s.syllables[Math.floor(s.count / 2)].f0;
    assert(mid < s0 && mid > s1, `the decline is a cliff at the end, not a contour (${s0.toFixed(0)}/${mid.toFixed(0)}/${s1.toFixed(0)})`);

    const q = V.utterFor(QUESTION, 'human');
    assert(q.question, 'a line ending in a question mark was read as a statement');
    const q0 = q.syllables[0].f0, q1 = q.syllables[q.count - 1].f0;
    assert(q1 > q0 * 1.15,
      `the question ends at ${q1.toFixed(1)} Hz having started at ${q0.toFixed(1)} — it does not rise`);
    return `statement ${s0.toFixed(0)} → ${s1.toFixed(0)} Hz, question ${q0.toFixed(0)} → ${q1.toFixed(0)} Hz`;
  });

  check('voice: two species are two larynxes, not one with a label', () => {
    const seen = [];
    for (const k of V.VOICE_KEYS) {
      const r = V.pitchRange(LINE, k);
      assert(r.max > r.min, `${k} says every syllable at one pitch`);
      seen.push([k, r.mean]);
    }
    const lo = V.pitchRange(LINE, 'narn'), hi = V.pitchRange(LINE, 'minbari');
    const diff = (hi.mean - lo.mean) / lo.mean;
    assert(diff > 0.3, `Narn and Minbari are ${(diff * 100).toFixed(0)}% apart — that is the same voice twice`);
    /* And every pair of the eight is distinguishable, which is the stronger
     * claim: a table where two rows collide is a table with a typo in it. */
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        const d = Math.abs(seen[i][1] - seen[j][1]) / Math.min(seen[i][1], seen[j][1]);
        assert(d > 0.02, `${seen[i][0]} and ${seen[j][0]} are the same pitch`);
      }
    }
    /* A species with no row of its own is derived and stable, never defaulted. */
    const a = V.voiceFor('brakiri'), b = V.voiceFor('hyach');
    assert(a.f0 !== b.f0, 'two species with no row of their own got the same voice');
    assert(V.voiceFor('brakiri').f0 === a.f0, 'a derived voice is not the same twice');
    return seen.map(([k, m]) => `${k} ${m.toFixed(0)}`).join(', ') + ` Hz; Narn↔Minbari ${(diff * 100).toFixed(0)}%`;
  });

  check('voice: a second line waits for the first — one voice never talks over itself', () => {
    const { was } = bootAudio();
    try {
      const a = V.speak(LINE, 'tannoy');
      const b = V.speak('the market opens on the concourse at ten hundred hours', 'tannoy');
      assert(a && b, `nothing was scheduled (${!!a}/${!!b})`);
      assert(b.at >= a.at + a.dur,
        `the second line starts at ${b.at.toFixed(2)} s and the first ends at ${(a.at + a.dur).toFixed(2)} s`);
      assert(b.wait > 0, 'the second line was not queued at all');
      /* A DIFFERENT voice is not queued behind it: two people may talk at once. */
      const c = V.speak('mind the doors', 'drazi');
      assert(c && c.wait === 0, `a Drazi waited ${c ? c.wait.toFixed(2) : 'n/a'} s behind the tannoy`);
      return `first 0.00–${a.dur.toFixed(2)} s, second at ${b.at.toFixed(2)} s, a second voice at ${c.at.toFixed(2)} s`;
    } finally { restoreAudio(was); }
  });

  /* ══ (c) THE SCORE GETS OUT OF THE WAY ══════════════════════════════════ */

  check('voice: the music ducks while somebody is talking', () => {
    const { was } = bootAudio();
    try {
      const before = audio.stats.musicDucked | 0;
      assert(audio._musicDuckAt == null || audio._musicDuckAt >= 1, 'the score was already ducked');
      const r = V.speak(LINE, 'tannoy');
      assert(r, 'nothing was said');
      assert((audio.stats.musicDucked | 0) > before, 'the score was not ducked at all');
      assert(audio._musicDuckAt <= 0.51,
        `the score was pulled to ${audio._musicDuckAt} — 6 dB is 0.5`);
      assert(audio._musicDuckUntil >= r.dur,
        `the duck lasts ${audio._musicDuckUntil.toFixed(2)} s and the line ${r.dur.toFixed(2)} s`);
      return `pulled to ${audio._musicDuckAt} for ${audio._musicDuckUntil.toFixed(2)} s over a ${r.dur.toFixed(2)} s line`;
    } finally { restoreAudio(was); }
  });

  /* ══ (d) THE SCORE ══════════════════════════════════════════════════════ */

  check('music: a state changes tempo and intensity inside two bars, and comes back', () => {
    Music.resetScore();
    const idle = Music.scoreNow();
    assert(idle.state === 'idle', `the score starts at ${idle.state}`);
    const step = (secs, n = 30) => { for (let i = 0; i < n; i++) Music.stepScore(null, null, secs / n); };

    assert(Music.setScore('fight'), 'the score refused the state');
    /* Nothing has changed YET: the change waits for the beat. */
    assert(Music.scoreNow().state === 'idle', 'the score cut to the new state instead of waiting for the beat');
    const bars = Music.SCORE_BARS * 4 * 60 / Music.SCORES.idle.bpm; // two bars at the OLD tempo
    step(bars);
    const f = Music.scoreNow();
    assert(f.state === 'fight', `after two bars the score is ${f.state}`);
    assert(f.tempo === Music.SCORES.fight.bpm, `the tempo is ${f.tempo}, not ${Music.SCORES.fight.bpm}`);
    assert(f.tempo > idle.tempo * 1.5, `${idle.tempo} → ${f.tempo} bpm is not a gear change`);
    assert(f.intensity > 0.95 * Music.SCORES.fight.intensity,
      `the intensity only reached ${f.intensity.toFixed(2)} of ${Music.SCORES.fight.intensity}`);
    assert(f.changes === 1, `${f.changes} changes for one request`);

    Music.setScore('idle');
    step(bars + 60 / Music.SCORES.idle.bpm); // two bars, plus the beat it waits for
    const back = Music.scoreNow();
    assert(back.state === 'idle', `it did not come back: ${back.state}`);
    assert(Math.abs(back.intensity - Music.SCORES.idle.intensity) < 0.02,
      `it came back at intensity ${back.intensity.toFixed(2)}`);
    assert(back.tempo === Music.SCORES.idle.bpm, `the tempo came back to ${back.tempo}`);
    Music.resetScore();
    return `idle ${idle.tempo} bpm / ${idle.intensity} → fight ${f.tempo} / ${f.intensity.toFixed(2)} → idle, on the beat, over ${bars.toFixed(1)} s`;
  });

  check('music: every state is a real row, and a stinger goes back to work', () => {
    for (const k of Music.SCORE_KEYS) {
      const C = Music.SCORES[k];
      assert(Music.STYLE_BY.get(C.style), `${k} names a style that does not exist: ${C.style}`);
      assert(C.bpm >= 40 && C.bpm <= 200, `${k} is ${C.bpm} bpm`);
      assert(C.intensity >= 0 && C.intensity <= 1, `${k} intensity ${C.intensity}`);
      const L = C.layers;
      assert(L && ['drums', 'bass', 'melody', 'pad'].every(n => L[n] >= 0 && L[n] <= 1), `${k} has no layers`);
      /* …and the tune it would play is in its own mode at its own tempo. */
      const t = Music.tuneFor(Music.seedOf(`score:${k}:1`), C.style, { bpm: C.bpm });
      assert(t.bpm === C.bpm, `${k} asked for ${C.bpm} bpm and got ${t.bpm}`);
      assert(Music.inMode(t), `${k}'s tune has a note outside its mode`);
    }
    const nine = ['idle', 'market', 'chase', 'fight', 'vigil', 'alert', 'sleep', 'win', 'loss'];
    for (const n of nine) assert(Music.SCORES[n], `there is no '${n}' state`);

    Music.resetScore();
    Music.scoreStinger('win');
    const step = (secs, n = 40) => { for (let i = 0; i < n; i++) Music.stepScore(null, null, secs / n); };
    step(3);
    assert(Music.scoreNow().state === 'win', `a paid job scored ${Music.scoreNow().state}`);
    /* THE HOLD IS A HOLD AND NOT A LATCH: the derivation takes over again. */
    step(Music.SCORE_STINGER + 6);
    assert(Music.scoreNow().state === 'idle', `the stinger never let go: ${Music.scoreNow().state}`);
    Music.resetScore();
    return `${Music.SCORE_KEYS.length} states, all in mode; the win stinger held ${Music.SCORE_STINGER} s`;
  });

  check('music: the score reads the station rather than the room', () => {
    const at = (world, st) => Music.deriveScore(world, st);
    const life = {};
    assert(at({ _stationLife: life }, {}) === 'idle', 'a quiet station is not idle');
    assert(at({ _stationLife: { event: { id: 'market' } } }, {}) === 'market', 'market day is not scored');
    assert(at({ _stationLife: { vigil: { on: true } } }, {}) === 'vigil', 'the vigil is not scored');
    assert(at({ _stationLife: { war: { alert: 3 } } }, {}) === 'alert', 'a klaxon is not scored');
    assert(at({ _stationLife: { pick: { body: {}, lifted: 40, caught: false } } }, {}) === 'chase',
      'a thief running with your money is not a chase');
    assert(at({ _stationLife: { pick: { body: {}, lifted: 40, caught: true } } }, {}) === 'idle',
      'a thief already caught is still a chase');
    assert(at({ _sleep: { active: true }, _stationLife: life }, {}) === 'sleep', 'sleep is not scored');
    /* THE SABER AND SOMETHING CLOSE — and the distance is the whole rule. */
    const fight = (d) => at({
      _stationLife: life,
      player: { saber: { lit: true }, position: { x: 0, y: 0, z: 0 } },
      enemies: [{ position: { x: d, y: 0, z: 0 } }],
    }, {});
    assert(fight(5) === 'fight', 'a hostile at 5 m with the blade lit is not a fight');
    assert(fight(Music.FIGHT_REACH + 5) === 'idle', `a hostile at ${Music.FIGHT_REACH + 5} m is a fight`);
    assert(at({ _stationLife: life, _pitBout: { over: false } }, {}) === 'fight', 'a bout in the Arena is not a fight');
    assert(at({ _stationLife: life, _pitBout: { over: true } }, {}) === 'idle', 'a finished bout is still a fight');
    return 'sleep > fight > chase > alert > vigil > market > idle, all off state the station already keeps';
  });

  /* ══ (e) DETERMINISM ════════════════════════════════════════════════════ */

  check('voice: no random source anywhere in the voice or the score', async () => {
    for (const f of ['../../src/game/Voice.js', '../../src/game/Music.js']) {
      const src = await readFile(new URL(f, import.meta.url), 'utf8');
      assert(!/Math\.random\s*\(/.test(src), `${f} calls Math.random`);
    }
    /* And the same line twice is the same line, to the sample. */
    const a = V.utterFor(LINE, 'centauri'), b = V.utterFor(LINE, 'centauri');
    assert(a.count === b.count && Math.abs(a.dur - b.dur) < 1e-12, 'two readings of one line differ');
    for (let i = 0; i < a.count; i++) assert(a.syllables[i].f0 === b.syllables[i].f0, `syllable ${i} moved`);
    /* …but two different lines are not the same reading. */
    const c = V.utterFor('the arboretum rains at nineteen hundred hours', 'centauri');
    assert(Math.abs(c.dur - a.dur) > 1e-6, 'two different lines take exactly the same time');
    return 'no Math.random; the same text is the same utterance, to the sample';
  });

  /* ══ (b) THE WIRING, ON A REAL STATION ══════════════════════════════════ */

  clockedCheck('voice: the tannoy and a resident both reach the larynx', async () => {
    clearStation();
    const { was } = bootAudio();
    let world = null;
    try {
      world = await station(40);
      const st = world._station;
      const { stepPA } = await import('../../src/game/StationSound.js');
      const { talkTo } = await import('../../src/game/Station.js');
      /* The listener stands where the player stands, or every positioned sound
       * in this check is culled for being 50 m from the origin. */
      const p = world.player?.position;
      if (p) audio._listenerPos.set(p.x, p.y, p.z);
      V.resetVoices();

      /* THE PA. One slot's worth of station clock, twice: the first call after
       * the doors open is the one `stepPA` deliberately swallows. */
      let calls = 0;
      for (let i = 0; i < 6 && calls < 1; i++) {
        st.hour = (Number(st.hour) || 0) + 1;
        stepPA(world, st, 0.016);
        calls = st.pa?.calls | 0;
      }
      assert(calls >= 1, 'the PA never called at all');
      const said = V.speechLog();
      const pa = said.find(s => s.voice === 'tannoy');
      assert(pa, `the tannoy said nothing through the larynx (${said.length} lines spoken)`);
      assert(pa.heard, 'the announcement reached the larynx and was never scheduled');
      assert(pa.text === st.pa.said, `the tannoy said "${pa.text}" and the banner read "${st.pa.said}"`);
      assert(pa.count >= 4, `the announcement was ${pa.count} syllables`);

      /* A RESIDENT. The first body the pool has standing on the deck with a
       * species on it — the same one the interact key would reach. */
      const life = world._stationLife;
      let body = null;
      for (const b of life?.live?.values?.() || []) {
        if (b?.stationName && b.stationSpecies && !b.dead && b.stationPlace != null && b.stationSlot != null) { body = b; break; }
      }
      assert(body, 'the station booted with nobody on it');
      const before = V.speechLog().length;
      talkTo(world, body);
      const after = V.speechLog();
      const bark = after.slice(before).find(s => s.voice === body.stationSpecies || s.voice === 'human');
      assert(after.length > before, `talking to a ${body.stationSpecies} said nothing aloud`);
      assert(bark, `a ${body.stationSpecies} answered in the voice '${after[after.length - 1].voice}'`);
      assert(bark.heard, 'the bark reached the larynx and was never scheduled');
      assert(bark.count >= 2, `the bark was ${bark.count} syllables`);
      return `PA: ${pa.count} syllables of "${pa.text.slice(0, 46)}…"; ${body.stationSpecies} ${body.stationName}: ${bark.count} syllables`;
    } finally {
      try { world?.unload?.(); } catch { /* gone */ }
      restoreAudio(was);
      clearStation();
    }
  });
}
