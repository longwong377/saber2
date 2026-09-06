/**
 * The score. — src/engine/Audio.js
 *
 * Everything else in this game is generated in code: the meshes, the textures,
 * the animation, and every other sound. The soundtrack is the one asset that
 * arrives as a file, which makes it the one asset that can fail to arrive —
 * and the one that can sink the tab if it is loaded the way all the others are.
 *
 * A 49-minute MP3 decoded with `decodeAudioData`, which is how every other
 * sound in Audio.js is made, expands to about a GIGABYTE of float32 at 44.1 kHz
 * stereo. That is not a tuning problem, it is three orders of magnitude, and it
 * is why the score streams through an <audio> element instead. These checks
 * exist because the wrong choice there is invisible until someone plays for
 * long enough to hit it on a machine with less memory than the one it was
 * written on.
 *
 * The first two of them read source, and that is a weak instrument, so the rest
 * do not: they drive the real AudioEngine against the same fake WebAudio
 * tools/checks/audio.mjs uses, and they drive the real dev server over a real
 * socket. What made that necessary is written on each one — a 28 MB download
 * nobody asked for, a documented two-file split nothing could play, and a
 * server that could not say what an mp3 was.
 */
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { engine } from './audio.mjs';
import { MUSIC_TRACKS, isSilent } from '../../src/engine/Audio.js';
import { handler, parseRange } from '../serve.mjs';
import { clocked } from './_shared.mjs';
import * as Music from '../../src/game/Music.js';
import * as Sound from '../../src/game/StationSound.js';
import * as Credits from '../../src/game/Credits.js';
import { clearStation, buskerState, setBuskerState } from '../../src/game/StationSave.js';
import { PLACE } from '../../src/game/StationPlan.js';
import { audio } from '../../src/engine/Audio.js';
import { OfflineCtx } from './_offline-audio.mjs';


/**
 * THE ROW THAT STREAMS, found rather than typed.
 *
 * The soundtrack list is data and it has grown a generated score, which is now
 * row 0 — so an engine nobody has spoken to about tracks plays no file at all,
 * which is the whole point of it and would silently turn every check below into
 * a measurement of nothing. `files: null` is the row that means "whatever
 * main.js armed", and that definition lives in MUSIC_TRACKS' own docstring; a
 * literal `2` here would be this project's signature defect (HANDOFF §2.3) in a
 * check rather than in the game.
 */
const STREAM_ROW = MUSIC_TRACKS.findIndex(t => t.files === null);

/** Put an engine on the streamed row, the way the options screen would. */
const streamed = (a) => { a.setMusicTrack(STREAM_ROW); return a; };

/** Every node reachable downstream of `n`, on the recording context. */
function downstream(n, seen = new Set()) {
  for (const d of n.outs || []) if (!seen.has(d)) { seen.add(d); downstream(d, seen); }
  return seen;
}

/**
 * The score's whole path in Audio.js, as text: playMusic → _startMusic →
 * setMusicPlaying. Both delimiters are asserted, because this slice used to end
 * at `'\n  stopMusic('` — a method that no longer exists, which makes
 * indexOf return -1, which makes slice(i, -1) "everything to the end of the
 * file minus one character". The two checks below it went on passing while
 * measuring the entire engine.
 */
async function scorePath(assert) {
  const src = await readFile(new URL('../../src/engine/Audio.js', import.meta.url), 'utf8');
  const i = src.indexOf('  playMusic(');
  assert(i > 0, 'there is no music path at all');
  const j = src.indexOf('\n  _makeNoise(', i);
  assert(j > i, 'the delimiter this check slices on has moved — it is measuring the whole file');
  return src.slice(i, j);
}

/**
 * An <audio> element that records rather than plays.
 *
 * `src` is a recorded property and not a field: the whole question a chained
 * score asks is which urls this element was handed, in what order.
 */
class FakeAudio {
  constructor() {
    FakeAudio.made.push(this);
    this._src = ''; this.srcs = [];
    this.loop = false; this.preload = ''; this.crossOrigin = null; this.volume = 1;
    this.paused = true; this.plays = 0; this.pauses = 0;
    this._on = new Map();
  }
  get src() { return this._src; }
  set src(v) { this._src = v; this.srcs.push(v); }
  play() { this.plays++; this.paused = false; return Promise.resolve(); }
  pause() { this.pauses++; this.paused = true; }
  addEventListener(k, fn) { if (!this._on.has(k)) this._on.set(k, []); this._on.get(k).push(fn); }
  removeEventListener(k, fn) {
    const l = this._on.get(k); const i = l ? l.indexOf(fn) : -1;
    if (i >= 0) l.splice(i, 1);
  }
  /** What the browser does when a track finishes, or when a url is not there. */
  fire(k) { for (const fn of [...(this._on.get(k) || [])]) fn(); }
  static made = [];
}

/** Run `fn` with a recording <audio> constructor installed. */
function withAudioElement(fn) {
  const prev = globalThis.Audio;
  FakeAudio.made = [];
  globalThis.Audio = FakeAudio;
  try { return fn(); } finally { globalThis.Audio = prev; }
}


/* ══════════════════════════════════════════════════════════════════════════
 *  MUSIC AS PLACE (V19 addition 5 / hole 3) — the second half of this file.
 *
 *  The tune engine is a pure function and is checked as one: the same seed is
 *  the same note list, different seeds differ, the form is A A B A measured on
 *  the melody's own shape per bar, and every note sits in the mode's scale.
 *  The places are checked on a real deck 40 with the engine on an offline
 *  WebAudio: three musicians on the dais at 22:00 and the band's gain node
 *  falling off with distance, the murmur bed ducking under them; the busker
 *  taking a credit through the real `stationKey` and the fold counting it; the
 *  Drum's theme under a screen and nowhere else; and no random source.
 *  `clocked`, so the world-booting checks run one at a time.
 * ══════════════════════════════════════════════════════════════════════════ */
const KEY = 'saber.company.v1';

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

async function withCleanStoreAsync(fn) {
  const had = localStorage.getItem(KEY);
  const hadStation = localStorage.getItem('saber.station.v1');
  localStorage.removeItem(KEY);
  clearStation();
  try { return await fn(); }
  finally {
    if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had);
    clearStation();
    if (hadStation != null) localStorage.setItem('saber.station.v1', hadStation);
  }
}

async function station(deck = 40) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation, finishStationBuild } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  finishStationBuild(world);
  return { world, idle: idleInput() };
}

/** The engine on an offline context. Every own property goes back after. */
function bootAudio() {
  const prev = globalThis.AudioContext;
  let ctx = null;
  globalThis.AudioContext = function () { ctx = new OfflineCtx(48000); return ctx; };
  const was = { ...audio };
  audio.ctx = null; audio.ready = false; audio._lastWake = -1e9;
  try { audio.init(); } finally { globalThis.AudioContext = prev; }
  return { ctx, was };
}
function restoreAudio(was) {
  for (const k of Object.keys(audio)) delete audio[k];
  Object.assign(audio, was);
}

const shapes = (t) => [...Array(Music.BARS)].map((_, b) => Music.barShape(t, b));

export async function run({ check, assert }) {

  /**
   * THE SOUNDTRACK LIST IS PERSISTED BY INDEX, AND THAT IS A TRAP.
   *
   * `musicIndex` goes into localStorage as a NUMBER (src/ui/Menu.js), so
   * inserting a row silently changes the meaning of every value already stored
   * at or after it. Adding the generated score in the middle of the list would
   * have handed a 28 MB download to every player who had chosen "No score" —
   * a settings migration, invisible, in a game that has no settings migration.
   *
   * There is exactly one arrangement with the properties the change needed, and
   * this is the check that says so rather than a comment claiming it: the
   * generated score is row 0 so a fresh profile and an untouched slider both
   * land on it, and `silence` keeps the index it has always had. Only row 0's
   * meaning moved, from the streamed theme to the generated one, which is the
   * intended change and the only one.
   */
  check('music: the track list can grow without re-meaning a stored index', () => {
    const ids = MUSIC_TRACKS.map(t => t.id);
    assert(new Set(ids).size === ids.length, `duplicate track ids: ${ids.join(', ')}`);
    assert(MUSIC_TRACKS[0].synth === true,
      `row 0 is '${ids[0]}', which is what a fresh profile and an unmoved slider get — `
      + 'it has to be the one that fetches nothing and cannot fail to arrive');
    assert(ids[1] === 'silence',
      `'silence' has moved to row ${ids.indexOf('silence')} — every player who chose `
      + 'no score is now on something else');
    assert(STREAM_ROW > 0, 'no row streams a file at all, so the shipped mp3 is unreachable');

    // The three kinds are distinguishable and no row is two of them at once.
    for (const t of MUSIC_TRACKS) {
      const kinds = [t.files === null, !!t.synth, isSilent(t)].filter(Boolean).length;
      assert(kinds === 1, `'${t.id}' is ${kinds} kinds of row at once, not one`);
      assert(typeof t.name === 'string' && t.name && typeof t.blurb === 'string' && t.blurb,
        `'${t.id}' has nothing for the options screen to print`);
    }

    // …and the engine can be put on every one of them and back.
    const { a } = engine();
    const seen = [];
    for (let i = 0; i < MUSIC_TRACKS.length; i++) {
      a.setMusicTrack(i);
      seen.push(`${MUSIC_TRACKS[i].id}:${a.score.enabled ? 'bed' : '—'}${a.score.armed ? '+cue' : ''}`);
    }
    assert(/bed\+cue/.test(seen[0]), 'the generated row does not play the generated score');
    assert(seen[1] === 'silence:—', `"No score" left something running: ${seen[1]}`);
    assert(/^theme:—\+cue$/.test(seen[STREAM_ROW]),
      `the streamed row is wrong: ${seen[STREAM_ROW]} (it wants the stingers and not the bed)`);
    return `${ids.join(' → ')}; ${seen.join(' ')}`;
  });

  check('music: the score is STREAMED, never decoded into memory', async () => {
    const body = await scorePath(assert);
    assert(/new Audio\(\)|createElement\('audio'\)/.test(body),
      'the score does not go through an <audio> element');
    assert(/createMediaElementSource/.test(body),
      'the element is not routed into WebAudio, so the Music slider cannot reach it');
    assert(!/decodeAudioData/.test(body),
      'the score is decoded into a buffer — at 49 minutes that is ~1 GB resident and the tab dies');
    /* "…and it reaches the mixer" used to be `/musicBus/.test(body)`. It is now
     * a walk of the real graph, in the check below — there is a duck node
     * between the stream and the slider, and a text match on the bus name would
     * have had to be widened to accept it, which is the point at which a source
     * check stops discriminating. Left as a note rather than deleted silently. */
    assert(/loop/.test(body), 'the score does not loop');
    // 'auto' is a request for the whole 28 MB up front, whether or not a note
    // of it is ever heard. play() pulls what it is playing and no more.
    assert(!/preload = 'auto'/.test(body),
      "the element asks for preload='auto' — that is the whole file, before the first note");
    return 'streamed through <audio>, looping, never decoded, no preload=auto';
  });

  check('music: a missing or unplayable file is silence, not a broken game', async () => {
    const body = await scorePath(assert);
    assert(/try\s*\{/.test(body) && /catch/.test(body),
      'nothing catches a failed load — a missing file would take the audio engine with it');
    assert(/typeof Audio === 'undefined'/.test(body),
      'the music path assumes a DOM, so it throws in a headless test rather than declining');
    // and the autoplay case, which is a "not yet" rather than an error
    assert(/paused/.test(body), 'a browser that blocks autoplay leaves the score off forever');
    return 'guarded on DOM, load failure and autoplay refusal';
  });

  /**
   * THE 28 MB NOBODY ASKED FOR.
   *
   * src/main.js binds the score's start to the first pointerdown or keydown
   * anywhere on the page — right, because that gesture is what unlocks the
   * context — and playMusic then fetched theme.mp3 unconditionally with
   * `preload='auto'`. Measured: 29,400,953 bytes, the largest file in the
   * repository by two orders of magnitude, on the first click on the landing
   * page, before the player had chosen a level or pressed Deploy. Turning Music
   * to 0 in Options wrote `musicBus.gain` and nothing else — grep for
   * settings.music: it reaches `audio.setMusicVolume` and stops there — so the
   * element still streamed and still decoded, to play 28 MB at zero. There was
   * no way to play this game without paying for the soundtrack.
   */
  check('music: at Music 0 the score is never fetched, and the slider is what starts it', () => {
    return withAudioElement(() => {
      const { a, ctx } = engine();
      streamed(a);
      a.setMusicVolume(0);
      const armed = a.playMusic(['theme.mp3'], { loop: true });
      assert(armed === null, 'playMusic started a stream the player had turned off');
      assert(FakeAudio.made.length === 0,
        `${FakeAudio.made.length} <audio> element(s) were built for a score set to zero — that is the 28 MB`);

      // …and the slider is what starts it, so turning music on mid-session works
      a.setMusicVolume(0.5);
      assert(FakeAudio.made.length === 1,
        'moving the Music slider off zero did not start the score it had suppressed');
      const el = FakeAudio.made[0];

      /**
       * …AND IT REACHES THE MIXER, measured on the real graph rather than by
       * grepping for the word `musicBus` in the method that builds it.
       *
       * The stream used to connect straight to `musicBus`, which is the param
       * the Music slider owns, so a duck and a slider move fought over one
       * number. There is a node between them now, and a text check would either
       * have to be relaxed to accept it (which accepts anything) or would fail
       * for a change that is an improvement. The graph answers the question the
       * text was standing in for: does the score arrive at the mixer, and does
       * it pass the thing that ducks it on the way.
       */
      const media = ctx.edges.map(([f]) => f).find(n => n.kind === 'media');
      assert(media, 'the element was never wired into WebAudio at all');
      const reach = downstream(media);
      assert(reach.has(a.musicDuck),
        'the stream bypasses musicDuck — a clash cannot make room for itself over the score');
      assert(reach.has(a.musicBus), 'the stream never reaches musicBus — the Music slider is not on it');
      assert(reach.has(a.master) && reach.has(ctx.destination), 'the stream never reaches the destination');
      assert(!reach.has(a.comp),
        'the stream goes through the master compressor — every blaster shot would pump the music');
      assert(el.srcs.length === 1 && el.srcs[0] === 'theme.mp3', `the element was handed ${el.srcs.join(', ')}`);
      assert(el.plays === 1, `play() was called ${el.plays} times`);
      assert(el.preload !== 'auto', `preload is '${el.preload}' — that is the whole file up front`);

      // back to zero PAUSES the stream rather than muting it, which is what
      // stops the browser pulling the rest of the file…
      a.setMusicVolume(0);
      assert(el.pauses === 1, 'Music 0 left the stream running at zero volume');
      assert(FakeAudio.made.length === 1, 'Music 0 tore the element down instead of pausing it');
      // …and coming back up RESUMES rather than restarting a 49-minute track.
      a.setMusicVolume(0.7);
      assert(el.plays === 2 && el.srcs.length === 1,
        `the score restarted from the top: ${el.srcs.length} loads, ${el.plays} plays`);
      return `0 elements at Music 0, 1 on the first move off it, paused/resumed with the slider; `
        + 'media → musicDuck → musicBus → master, around the compressor';
    });
  });

  /**
   * THE SPLIT THE REPOSITORY DOCUMENTS.
   *
   * assets/music/README.md tells the maintainer replacing the score that
   * GitHub's web uploader refuses files over 25 MB, and that the way round it
   * is "Export the track as theme.mp3 and theme2.mp3 … the player will chain
   * them seamlessly and loop back to the first. This keeps full quality." It
   * called that the better trade and put it first. Nothing chained anything:
   * `theme2` occurred exactly once in the whole repository, in that sentence,
   * and playMusic took a single url and set `el.loop`. A maintainer who
   * followed the project's own first instruction shipped a game that played
   * half its soundtrack and looped it, silently.
   */
  check('music: a split score chains, wraps, and steps over a half that is not there', () => {
    return withAudioElement(() => {
      const { a } = engine();
      streamed(a);
      const m = a.playMusic(['one.mp3', 'two.mp3'], { loop: true });
      assert(m, 'a two-file score did not start at all');
      const el = FakeAudio.made[0];
      assert(el.srcs[0] === 'one.mp3', `the score opened on ${el.srcs[0]}`);
      assert(el.loop === false,
        'native looping is on for a list — the element would repeat the first half forever');

      el.fire('ended');
      assert(el.srcs[1] === 'two.mp3', `after the first half ended the element got ${el.srcs[1]}`);
      el.fire('ended');
      assert(el.srcs[2] === 'one.mp3', `the chain did not wrap: ${el.srcs.join(' → ')}`);
      assert(el.plays === 3, `${el.plays} plays for 3 tracks`);

      // A maintainer who uploaded only the first half must get the first half
      // on repeat, not an error-load-error loop at network speed.
      const n = el.srcs.length;
      el.fire('error'); el.fire('error'); el.fire('error');
      assert(el.srcs.length <= n + 2,
        `${el.srcs.length - n} loads were attempted for two missing files — that is a spin`);

      // and one file still loops natively, with no gap for anything to schedule
      const { a: b } = engine();
      streamed(b);
      b.playMusic('solo.mp3', { loop: true });
      const solo = FakeAudio.made[1];
      assert(solo.loop === true, 'a single-file score lost its native loop');
      return `one → two → one (${el.plays} plays), a missing half costs ${el.srcs.length - n} retries, `
        + 'single file still loops natively';
    });
  });

  check('music: the file is there, and it is what it says it is', async () => {
    const url = new URL('../../assets/music/theme.mp3', import.meta.url);
    let st = null;
    try { st = await stat(url); } catch { /* reported below */ }
    assert(st, 'assets/music/theme.mp3 is missing — the score will not play');
    // ID3v2 or a bare MPEG frame sync; anything else is not an MP3 whatever it
    // is called, and the browser will decline it silently.
    const head = (await readFile(url)).subarray(0, 4);
    const id3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
    const sync = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
    assert(id3 || sync, `theme.mp3 does not start with ID3 or an MPEG frame sync (${[...head]})`);
    // A soundtrack that ships from the repository is also a download every
    // player pays for on first load, so the size is worth stating out loud.
    const mb = st.size / (1024 * 1024);
    assert(mb < 60, `theme.mp3 is ${mb.toFixed(0)} MB — that is a long wait on a first load`);
    return `${mb.toFixed(1)} MB, ${id3 ? 'ID3-tagged' : 'bare'} MPEG audio`;
  });

  check('music: it starts on the gesture that unlocks the context, once', async () => {
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    assert(/playMusic\(/.test(main), 'nothing ever starts the score');
    // WebAudio cannot start before a user gesture, and the context unlock is
    // already bound to exactly that. Two listeners, one shared handler — a
    // second copy of the start logic is a second chance to start it twice.
    const i = main.indexOf('startScore');
    assert(i > 0, 'the score start is not a named handler, so it cannot be shared or removed');
    assert((main.match(/playMusic\(/g) || []).length === 1,
      'the score is started from more than one place — it will overlap itself');
    return 'one handler, bound to both pointer and key unlock';
  });

  /**
   * THE SERVER, which is the only thing between the browser and the one file in
   * this project that is not made of numbers.
   *
   * `npm start` is tools/serve.mjs, and it had ten extensions in its MIME table
   * with `.mp3` not among them, and no Range support of any kind: every request
   * was answered `200` with the whole 28 MB body read into memory. Measured
   * against the running server before the fix, `GET /assets/music/theme.mp3`
   * with `Range: bytes=0-1` returned `HTTP/1.1 200`,
   * `Content-Type: application/octet-stream`, no Accept-Ranges, no
   * Content-Range and 29,400,953 bytes. Safari refuses an <audio> source from a
   * server that does not honour Range, so the score simply does not play there
   * under `npm start`, and no amount of reading Audio.js would show it.
   */
  check('music: the dev server can serve the one asset that is not procedural', async () => {
    // The names main.js actually asks for, so renaming the asset without
    // teaching the server about it fails here rather than in a browser.
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const list = /const TRACKS = \[([^\]]*)\]/.exec(main);
    assert(list, 'src/main.js no longer names the score in a TRACKS list, so this cannot see what it asks for');
    const names = [...list[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    assert(names.length > 0, 'main.js names no audio file at all — this check is measuring nothing');

    const server = createServer(handler);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const get = (path, headers) => fetch(`http://127.0.0.1:${port}${path}`, { headers });
    try {
      let served = 0;
      for (const name of names) {
        const path = `/assets/music/${name}`;
        // HEAD, not GET: the point is the headers, and the file is 28 MB. An
        // element asking "what is this and can I seek it" is asking exactly
        // this much.
        const whole = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'HEAD' });
        if (whole.status === 404) continue;          // a split half that is not shipped
        served++;
        assert(/^audio\//.test(whole.headers.get('content-type') || ''),
          `${name} is served as ${whole.headers.get('content-type')} — the browser has to guess`);
        assert(whole.headers.get('accept-ranges') === 'bytes',
          `${name} advertises no byte ranges, so Safari will not take it as an <audio> source`);
        assert(Number(whole.headers.get('content-length')) > 0,
          `${name} came back with no length at all`);

        const part = await get(path, { Range: 'bytes=0-1' });
        assert(part.status === 206, `a range request for ${name} answered ${part.status}, not 206`);
        const cr = part.headers.get('content-range') || '';
        assert(/^bytes 0-1\/\d+$/.test(cr), `Content-Range came back as '${cr}'`);
        const body = new Uint8Array(await part.arrayBuffer());
        assert(body.length === 2, `two bytes were asked for and ${body.length} arrived`);

        // …and a range it cannot satisfy is a 416, not a silent whole file: an
        // element that gets everything back from a seek cannot tell it failed.
        const bad = await get(path, { Range: 'bytes=99999999999-' });
        assert(bad.status === 416, `an unsatisfiable range answered ${bad.status}`);
        await bad.arrayBuffer();
      }
      assert(served > 0, `none of ${names.join(', ')} exists to be served`);

      // the rest of the site is unchanged by all of that
      const page = await get('/');
      assert(page.status === 200 && /text\/html/.test(page.headers.get('content-type') || ''),
        'the server stopped serving index.html');
      await page.arrayBuffer();

      // and the range parser itself, on the three forms a browser sends
      assert(parseRange('bytes=0-1', 100).end === 1, 'bytes=0-1');
      assert(parseRange('bytes=50-', 100).end === 99, 'an open-ended range does not run to the end');
      assert(parseRange('bytes=-10', 100).start === 90, 'a suffix range does not count from the end');
      assert(parseRange('bytes=200-300', 100) === null, 'a range past the end was accepted');
      assert(parseRange('rows=0-1', 100) === null, 'a unit that is not bytes was accepted');
      return `${served} of ${names.length} track(s): audio/* + Accept-Ranges, 206 for bytes=0-1, 416 for junk`;
    } finally {
      // closeAllConnections FIRST: an assertion that fires part-way through a
      // response leaves its body unread, close() waits for that socket, and the
      // suite hangs instead of reporting the failure.
      server.closeAllConnections?.();
      await new Promise(r => server.close(r));
    }
  });

  /* ── music as place ─────────────────────────────────────────────────── */
  const place = await clocked(check);

  /* ════════════════════════════════════════════════════════════════════════ */

  place('music: the same seed is the same tune, different seeds differ, the form is A A B A, every note in the mode', () => {
    const a = Music.tuneFor('the long night'), b = Music.tuneFor('the long night'), c = Music.tuneFor('the short day');
    assert(JSON.stringify(a.notes) === JSON.stringify(b.notes) && a.name === b.name && a.bpm === b.bpm, 'the same seed gave two tunes');
    assert(JSON.stringify(a.notes) !== JSON.stringify(c.notes), 'two seeds gave one tune');
    const names = new Set();
    let aaba = 0, bDiffers = 0, styles = new Set();
    const N = 240;
    for (let i = 0; i < N; i++) {
      const t = Music.tuneFor(`seed:${i}`);
      names.add(t.name); styles.add(t.style);
      assert(t.bars === 8 && t.length === 32, `tune ${i} is ${t.bars} bars`);
      assert(Music.inMode(t), `tune ${i} (${t.style}) has a note off its mode`);
      const S = Music.STYLE_BY.get(t.style);
      const voices = new Set(t.notes.map((n) => n.voice));
      assert(voices.size >= 2 && voices.size <= 4 && voices.size === Math.min(4, Math.max(2, S.voices)), `tune ${i} has ${voices.size} voices for a ${S.voices}-voice style`);
      assert(t.drums.length > 0, `tune ${i} has no drums`);
      const sh = shapes(t);
      const A = [0, 1, 3, 4, 5, 7].every((k) => sh[k] === sh[0]);
      const B = sh[2] === sh[6];
      if (A && B) aaba++;
      if (sh[2] !== sh[0]) bDiffers++;
      /* THE BASS is a line: at least one note a beat, in the style's register. */
      const bass = t.notes.filter((n) => n.voice === 1);
      assert(bass.length >= (t.style === 'minbari' ? 16 : 32), `tune ${i} has ${bass.length} bass notes`);
      assert(bass.every((n) => n.midi >= S.lows[0] && n.midi <= S.lows[1] + 12), `tune ${i}'s bass leaves its register`);
    }
    assert(aaba === N, `${aaba}/${N} tunes are A A B A`);
    assert(bDiffers >= N * 0.9, `B repeats A in ${N - bDiffers}/${N} tunes`);
    assert(styles.size === Music.PLAYED.length, `${styles.size} styles drawn of ${Music.PLAYED.length}`);
    assert(names.size >= 60, `${names.size} distinct names over ${N} tunes`);
    /* THE SIX MODES read as six: every style names a people and no two share a scale. */
    const scales = new Set(Music.STYLES.map((s) => s.scale.join(',')));
    assert(scales.size === Music.STYLES.length, 'two styles share a scale');
    for (const id of ['cantina', 'drazi', 'minbari', 'centauri', 'narn', 'human', 'drum']) assert(Music.STYLE_BY.has(id), `no ${id} style`);
    return `${N} tunes: all A A B A, ${bDiffers} with a B that differs, ${names.size} names, ${styles.size} styles; "${a.name}" (${a.style}, ${a.bpm} bpm, ${a.notes.length} notes, ${a.drums.length} hits)`;
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  place('music: in the cantina at 22:00 three musicians stand on the dais, the band is loud at 3 m and under a fifth of that at 15 m, the murmur ducks',
    () => withCleanStoreAsync(async () => {
      const { ctx, was } = bootAudio();
      let world = null;
      try {
        const st0 = await station(40);
        world = st0.world;
        const idle = st0.idle;
        const st = world._station;
        const M = world._music;
        assert(M && M.dais, 'the music was not dressed on deck 40, or the dais was not found');
        const cantina = PLACE.get(14);
        const D = M.dais;
        /* IN THE ROOM, 3 m in front of the dais. */
        const p = world.player.position;
        const fx = Math.sin(D.yaw), fz = Math.cos(D.yaw);
        p.x = D.x + fx * 3; p.z = D.z + fz * 3;
        st.hour = 22;
        world.update(1 / 60, idle);
        ctx.currentTime += 0.5;
        world.update(1 / 60, idle);
        const B = M.band;
        assert(B && B.bodies.length === 3, `${B?.bodies.length ?? 0} musicians at 22:00`);
        for (const b of B.bodies) {
          const body = b.body;
          assert(world.enemies.includes(body) && body.stationResident && body.noAmbientHarm && body.stationMusician, `${body.stationName} is not a resident musician`);
          const d = Math.hypot(body.position.x - D.x, body.position.z - D.z);
          assert(d < 2.0, `${body.stationName} is ${d.toFixed(2)} m from the dais's centre`);
          const well = world.floorAt(body.position.x, body.position.z);
          assert(well < D.y - 0.3, `under ${body.stationName} the well floor is ${well.toFixed(2)}, the dais top ${D.y.toFixed(2)} — not a sunken room`);
          assert(Math.abs(body.position.y - D.y) < 0.4, `${body.stationName} stands at y ${body.position.y.toFixed(2)}, the dais top is ${D.y.toFixed(2)}`);
          assert(b.prop && b.prop.parent, `${body.stationName} has no instrument in the scene`);
        }
        const props = new Set(B.bodies.map((b) => b.prop.name));
        assert(props.size === 3, `the instruments are ${[...props].join(',')}`);
        assert(B.tune && B.player, `no tune (${B.tune?.name}) or no player at 22:00`);
        const scheduled = B.player.scheduled;
        assert(scheduled > 0, 'no note was scheduled');
        const near = Music.musicLevels(world).band;
        const gNear = B.player.out.gain.last('tgt');
        assert(near > 0.5 && gNear === Math.max(0.0001, near), `at 3 m the band is ${near.toFixed(3)}, the node was told ${gNear}`);
        /* THE MURMUR under them. */
        const S = world._stationSound;
        assert(Sound.bedLevels(world).murmur === Music.MURMUR_DUCK, `the murmur is ${Sound.bedLevels(world).murmur} while the band plays`);
        assert(Math.abs(S.murmur.gain.last('tgt') - S.murmurBase * Music.MURMUR_DUCK) < 1e-6, `the murmur node was told ${S.murmur.gain.last('tgt')}`);
        /* 15 m in front — still in the room, at the bar. */
        p.x = D.x + fx * 15; p.z = D.z + fz * 15;
        world.update(1 / 60, idle);
        const far = Music.musicLevels(world).band;
        assert(far > 0 && far < near * 0.2, `at 15 m the band is ${far.toFixed(3)} against ${near.toFixed(3)} at 3 m`);
        /* THE SWAY: the facing moves with the beat. */
        const f0 = B.bodies[0].body.facing;
        ctx.currentTime += 60 / B.tune.bpm * 0.5;
        world.update(1 / 60, idle);
        const f1 = B.bodies[0].body.facing;
        assert(Math.abs(f1 - f0) > 0.02, `the horn player's facing moved ${(f1 - f0).toFixed(3)} over half a beat`);
        /* THE SET LIST over the evening: a tune a slot, a break every fourth, named. */
        const names = new Set();
        let breaks = 0, tunes = 0;
        for (let h = 20; h < 22; h += 3 / 60) {
          st.hour = h;
          world.update(1 / 60, idle);
          const t = M.band.tune;
          if (t) { tunes++; names.add(t.name); } else breaks++;
        }
        assert(tunes >= 28 && breaks >= 9, `${tunes} tunes and ${breaks} breaks over two hours`);
        assert(names.size >= 20, `${names.size} distinct tunes over the evening`);
        /* AND AT 03:00 THEY ARE GONE, and the murmur is back. */
        st.hour = 3;
        world.update(1 / 60, idle);
        assert(!M.band, 'the band is still on the dais at 03:00');
        assert(!world.enemies.some((e) => e.stationMusician), 'a musician body is still in the world at 03:00');
        assert(Sound.bedLevels(world).murmur === 1, `the murmur is ${Sound.bedLevels(world).murmur} after the band left`);
        return `3 musicians on the dais at (${D.x.toFixed(1)}, ${D.y.toFixed(2)}, ${D.z.toFixed(1)}) in ${cantina.name}; band ${near.toFixed(3)} at 3 m, ${far.toFixed(3)} at 15 m; murmur ${Music.MURMUR_DUCK}× under it; ${tunes} tunes, ${breaks} breaks, ${names.size} names 20:00–22:00; ${scheduled} events scheduled in the first half-second`;
      } finally {
        world?.dispose?.();
        restoreAudio(was);
      }
    }));

  /* ════════════════════════════════════════════════════════════════════════ */

  place('music: the busker on the ring takes a credit through the real key, the fold counts it, he plays a named request and greets a patron',
    () => withCleanStoreAsync(async () => {
      const { ctx, was } = bootAudio();
      let world = null;
      const hadCredits = localStorage.getItem('saber.credits.v1');
      Credits.clearCredits();
      try {
        const st0 = await station(40);
        world = st0.world;
        const idle = st0.idle;
        const st = world._station;
        const M = world._music;
        const { stationKey } = await import('../../src/game/Station.js');
        assert(M && M.spot, 'no busker spot on deck 40');
        st.hour = 12;
        world.update(1 / 60, idle);
        const B = M.busker;
        assert(B && world.enemies.includes(B.body), 'no busker at noon');
        assert(B.body.stationResident && B.body.noAmbientHarm && B.body.stationBusker, 'the busker is not a resident');
        assert(B.lute.parent && B.hat.parent, 'the lute or the hat is not in the scene');
        const floor = world.floorAt(M.spot.x, M.spot.z);
        assert(Math.abs(B.body.position.y - floor) < 0.5, `the busker stands at ${B.body.position.y.toFixed(2)} over a floor at ${floor.toFixed(2)}`);
        assert(B.player && B.player.tune.voices === 1 && B.player.tune.notes.every((n) => n.voice === 0) && !B.player.tune.drums.length, 'the busker is not playing a solo voice');
        /* THE KEY, from a metre in front of him, with nothing in the purse. */
        const p = world.player.position;
        p.x = B.body.position.x + Math.sin(M.spot.yaw) * 1.0; p.z = B.body.position.z + Math.cos(M.spot.yaw) * 1.0;
        const banners = [];
        world.notify = (a, b) => banners.push(`${a} — ${b}`);
        assert(Credits.purse() === 0, `the purse starts at ${Credits.purse()}`);
        assert(stationKey(world) === true, 'the key was not taken by the busker with an empty purse');
        assert((buskerState().tips | 0) === 0, 'a tip was counted with no credits');
        assert(banners.some((b) => /hat is out/.test(b)), `he said: ${banners.join(' | ')}`);
        /* WITH CREDITS: three tips, three requests, and a patron. */
        Credits.pay(10);
        const played = [];
        for (let i = 0; i < 3; i++) {
          banners.length = 0;
          assert(stationKey(world) === true, `press ${i + 1} was not taken`);
          assert(Credits.purse() === 10 - (i + 1), `after tip ${i + 1} the purse is ${Credits.purse()}`);
          assert((buskerState().tips | 0) === i + 1, `after tip ${i + 1} the fold says ${buskerState().tips}`);
          assert(B.request === i + 1 && B.tune, `no request after tip ${i + 1}`);
          played.push(B.tune.name);
          assert(banners.some((b) => b.includes(`"${B.tune.name}"`)), `he did not name the request: ${banners.join(' | ')}`);
          ctx.currentTime += 0.2;
          world.update(1 / 60, idle);
          assert(B.player && B.player.tune === B.tune, 'the request is not the tune playing');
        }
        assert(new Set(played).size === 3, `the three requests were ${played.join(', ')}`);
        assert(B.hat.userData.coins.children.length === 3, `${B.hat.userData.coins.children.length} coins in the hat after three tips`);
        assert(banners.some((b) => /patron/.test(b)), `the third tip did not make a patron: ${banners.join(' | ')}`);
        /* THE GREETING on a fresh visit: the fold says patron, he says so on sight. */
        st.hour = 19;
        world.update(1 / 60, idle);
        assert(!M.busker, 'the busker is still there at 19:00');
        banners.length = 0;
        st.hour = 11;
        world.update(1 / 60, idle);
        assert(M.busker && M.busker.hat.userData.coins.children.length === 3, 'the coins did not come back with the fold');
        assert(banners.some((b) => /my patron/.test(b)), `no greeting for a patron: ${banners.join(' | ')}`);
        const lvl = Music.musicLevels(world).busker;
        assert(lvl > 0.4, `a metre from the busker he is at ${lvl.toFixed(3)}`);
        p.x = M.spot.x + Math.sin(M.spot.yaw) * 20; p.z = M.spot.z + Math.cos(M.spot.yaw) * 20;
        world.update(1 / 60, idle);
        const farL = Music.musicLevels(world).busker;
        assert(farL < lvl * 0.1, `at 20 m the busker is ${farL.toFixed(3)} against ${lvl.toFixed(3)} at 1 m`);
        return `busker at (${M.spot.x.toFixed(1)}, ${M.spot.z.toFixed(1)}) by kiosk ${M.spot.kiosk}; 3 tips → fold ${buskerState().tips}, purse ${Credits.purse()}, requests ${played.join(' / ')}; ${lvl.toFixed(3)} at 1 m, ${farL.toFixed(4)} at 20 m`;
      } finally {
        world?.dispose?.();
        restoreAudio(was);
        Credits.clearCredits();
        if (hadCredits != null) localStorage.setItem('saber.credits.v1', hadCredits);
        setBuskerState({});
      }
    }));

  /* ════════════════════════════════════════════════════════════════════════ */

  place('music: the Drum programme has a theme under it within 6 m of a screen, low, and nothing past it',
    () => withCleanStoreAsync(async () => {
      const { was } = bootAudio();
      let world = null;
      try {
        const st0 = await station(40);
        world = st0.world;
        const idle = st0.idle;
        const st = world._station;
        const M = world._music;
        const { programmeAt } = await import('../../src/game/Holonet.js');
        const tv = (st.tvs || []).find((t) => t.mesh);
        assert(tv, 'no screen on deck 40');
        st.hour = 1.25;
        st.tvOn = programmeAt(st.day | 0, 1.25);
        assert(st.tvOn.kind === 'drum', `at 01:15 the channel shows ${st.tvOn.kind}`);
        const p = world.player.position;
        p.x = tv.mesh.position.x + 2; p.z = tv.mesh.position.z;
        world.update(1 / 60, idle);
        const near = Music.musicLevels(world).drum;
        assert(M.drum && M.drum.tune.style === 'drum', 'no Drum theme by the screen');
        assert(near > 0 && near <= Music.DRUM_GAIN, `2 m from the screen the theme is ${near.toFixed(3)}`);
        assert(M.drum.player.out.gain.last('tgt') === near, 'the node was not told the level');
        p.x = tv.mesh.position.x + 10;
        world.update(1 / 60, idle);
        assert(!M.drum && Music.musicLevels(world).drum === 0, `10 m from the screen the theme is ${Music.musicLevels(world).drum}`);
        /* And a programme that is not the Drum has no theme even at the screen. */
        p.x = tv.mesh.position.x + 2;
        st.tvOn = { kind: 'news' };
        world.update(1 / 60, idle);
        assert(!M.drum, 'the theme plays under the news');
        return `Drum theme "${Music.drumTune(st.day | 0).name}" at ${near.toFixed(3)} 2 m from screen ${tv.id}, 0 at 10 m, 0 under the news`;
      } finally {
        world?.dispose?.();
        restoreAudio(was);
      }
    }));

  /* ════════════════════════════════════════════════════════════════════════ */

  place('music: no Math.random, and the hooks are in Station.js', async () => {
    const src = await readFile(new URL('../../src/game/Music.js', import.meta.url), 'utf8');
    assert(!/Math\.random/.test(src), 'Music.js uses Math.random');
    const st = await readFile(new URL('../../src/game/Station.js', import.meta.url), 'utf8');
    for (const h of ['dressMusic(world, st)', 'stepMusic(world, st, dt)', 'undressMusic(world)', 'musicKey(world)']) assert(st.includes(h), `Station.js lacks ${h}`);
    /* The engine is on the Music slider's bus, so volume and mute hold. */
    assert(/audio\.musicBus/.test(src), 'the players are not on musicBus');
    return 'no Math.random; four hooks; players on musicBus';
  });
}
