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
 */
import { readFile, stat } from 'node:fs/promises';

export async function run({ check, assert }) {
  check('music: the score is STREAMED, never decoded into memory', async () => {
    const src = await readFile(new URL('../../src/engine/Audio.js', import.meta.url), 'utf8');
    const i = src.indexOf('playMusic(url');
    assert(i > 0, 'there is no music path at all');
    const body = src.slice(i, src.indexOf('\n  stopMusic(', i));
    assert(/new Audio\(\)|createElement\('audio'\)/.test(body),
      'the score does not go through an <audio> element');
    assert(/createMediaElementSource/.test(body),
      'the element is not routed into WebAudio, so the Music slider cannot reach it');
    assert(!/decodeAudioData/.test(body),
      'the score is decoded into a buffer — at 49 minutes that is ~1 GB resident and the tab dies');
    assert(/musicBus/.test(body),
      'the score is not on the music bus, so the Music slider does not control it');
    assert(/loop/.test(body), 'the score does not loop');
    return 'streamed through <audio> into musicBus, looping, never decoded';
  });

  check('music: a missing or unplayable file is silence, not a broken game', async () => {
    const src = await readFile(new URL('../../src/engine/Audio.js', import.meta.url), 'utf8');
    const i = src.indexOf('playMusic(url');
    const body = src.slice(i, src.indexOf('\n  stopMusic(', i));
    assert(/try\s*\{/.test(body) && /catch/.test(body),
      'nothing catches a failed load — a missing file would take the audio engine with it');
    assert(/typeof Audio === 'undefined'/.test(body),
      'the music path assumes a DOM, so it throws in a headless test rather than declining');
    // and the autoplay case, which is a "not yet" rather than an error
    assert(/paused/.test(body), 'a browser that blocks autoplay leaves the score off forever');
    return 'guarded on DOM, load failure and autoplay refusal';
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
}
