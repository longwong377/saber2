/**
 * BATTLEFRONT BORZ — can the game still be heard?
 *
 * "The sound is really buggy and totally silent in most situations, comes in
 * and out." Twice now this file has been declared fixed by reading it, and
 * twice the game has gone quiet again, so these checks are deliberately not
 * about the shape of the code. They drive the real AudioEngine against a fake
 * WebAudio that behaves like the real one where it matters — every AudioParam
 * rejects a non-finite value with a TypeError, an exponential ramp to zero is a
 * RangeError, a source fires `ended` on the audio clock and not on the wall
 * clock, and a suspended context refuses to resume without a gesture — and then
 * assert on numbers.
 *
 * What actually went wrong, measured with tools/audiowatch.mjs on a real
 * session: 94% of every voice request in the game was a footstep, the pool of
 * 44 sat completely full for nine seconds at a time, and the requests that
 * arrived in that window were dropped on the floor — bolt impacts, blaster
 * shots and deflections among them. Nothing threw. Nothing leaked. No gain was
 * zero. The only way to see it was to count.
 */

import * as THREE from 'three';
import { AudioEngine, PRIO } from '../../src/engine/Audio.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ── a WebAudio that is as unforgiving as the browser's ─────────────── */

const chk = (v) => {
  if (!Number.isFinite(v)) throw new TypeError('The provided float value is non-finite.');
  return v;
};

/**
 * Every call is kept, because a param under a scheduled ramp does not report
 * where it is going: `.value` is where it was when the ramp was set. The score
 * and the ambience bed are BOTH nothing but scheduled ramps, so a check that
 * read `.value` on them would measure the level a level loaded at and call it
 * the level a fight reached. `last()` is what was commanded, in order.
 */
class Param {
  constructor(v = 0) { this._v = v; this.calls = []; }
  get value() { return this._v; }
  set value(v) { this._v = chk(v); this.calls.push(['value', v, 0]); }
  setValueAtTime(v, t) { chk(v); chk(t); this.calls.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { chk(v); chk(t); this.calls.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) {
    chk(v); chk(t);
    // The real node throws here, and this file used to reach it with a zero.
    if (v === 0) throw new RangeError('exponentialRampToValueAtTime: target must not be 0');
    this.calls.push(['exp', v, t]);
    return this;
  }
  setTargetAtTime(v, t, tc) { chk(v); chk(t); chk(tc); this.calls.push(['tgt', v, t]); return this; }
  cancelScheduledValues(t) { chk(t); this.calls.push(['cancel', 0, t]); return this; }
  /** The last value this param was COMMANDED to move to, of a kind or any. */
  last(kind) {
    for (let i = this.calls.length - 1; i >= 0; i--) if (!kind || this.calls[i][0] === kind) return this.calls[i][1];
    return null;
  }
  /** How many times it was told to move at all. A ramp per frame arrives nowhere. */
  moves() { return this.calls.filter(c => c[0] !== 'cancel' && c[0] !== 'value').length; }
}

class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = new Set(); }
  connect(d) { this.outs.add(d); this.ctx.connects++; this.ctx.edges.push([this, d]); return d; }
  disconnect(d) {
    this.ctx.disconnected.push(this);
    if (d) this.outs.delete(d); else this.outs.clear();
  }
}

class Src extends Node {
  constructor(ctx, kind) { super(ctx, kind); this.onended = null; this._started = false; }
  start(when = 0) {
    chk(when);
    if (when < 0) throw new RangeError('start time must not be negative');
    this._started = true;
  }
  stop(when = 0) {
    chk(when);
    if (!this._started) throw new Error('stop called before start');
    this._stopAt = when;
    this.ctx.running.push(this);
  }
}

class FakeCtx {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.state = 'running';
    this.connects = 0;
    this.edges = [];          // [from, to] — the graph as it was actually wired
    this.disconnected = [];
    this.running = [];        // sources with a scheduled stop, awaiting `ended`
    this.panners = 0;
    this.resumeCalls = 0;
    this.allowResume = true;
    this.destination = new Node(this, 'destination');
    this.listener = {
      positionX: new Param(), positionY: new Param(), positionZ: new Param(),
      forwardX: new Param(), forwardY: new Param(), forwardZ: new Param(),
      upX: new Param(), upY: new Param(), upZ: new Param(),
    };
  }
  createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); return n; }
  createBiquadFilter() {
    const n = new Node(this, 'biquad');
    n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); n.detune = new Param(0);
    return n;
  }
  createDynamicsCompressor() {
    const n = new Node(this, 'comp');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
    n.reduction = 0;
    return n;
  }
  createConvolver() { const n = new Node(this, 'convolver'); n.buffer = null; n.normalize = true; return n; }
  createPanner() {
    this.panners++;
    const n = new Node(this, 'panner');
    n.panningModel = 'equalpower'; n.distanceModel = 'inverse';
    n.refDistance = 1; n.maxDistance = 10000; n.rolloffFactor = 1;
    n.positionX = new Param(); n.positionY = new Param(); n.positionZ = new Param();
    return n;
  }
  createOscillator() {
    const n = new Src(this, 'osc');
    n.type = 'sine'; n.frequency = new Param(440); n.detune = new Param(0);
    return n;
  }
  createBufferSource() {
    const n = new Src(this, 'bufsrc');
    n.buffer = null; n.loop = false; n.playbackRate = new Param(1);
    return n;
  }
  createBuffer(channels, length, rate) {
    chk(length); chk(rate);
    const data = [];
    for (let i = 0; i < channels; i++) data.push(new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate: rate,
      duration: length / rate, getChannelData: (i) => data[i] };
  }
  /** The score is the one sound in the game that is not built from these. */
  createMediaElementSource(el) { const n = new Node(this, 'media'); n.mediaElement = el; return n; }
  /** Move the audio clock and fire `ended` for everything that has finished. */
  advance(dt) {
    this.currentTime += dt;
    const still = [];
    for (const s of this.running) {
      if (s._stopAt <= this.currentTime) { try { s.onended?.(); } catch {} }
      else still.push(s);
    }
    this.running = still;
  }
  resume() {
    this.resumeCalls++;
    // A browser that has not seen a gesture rejects this and stays suspended,
    // which is the whole reason the engine has to cope with being stopped.
    if (this.allowResume) this.state = 'running';
    return Promise.resolve();
  }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

/**
 * A fully initialised engine on a fake context.
 *
 * Exported because tools/checks/music.mjs drives the same engine — the score is
 * the one sound in the game that arrives as a file, and it still has to be
 * measured on the same graph as everything else rather than against a second
 * fake that could drift away from this one.
 */
export function engine() {
  const prevAC = globalThis.AudioContext;
  let made = null;
  globalThis.AudioContext = function () { made = new FakeCtx(); return made; };
  const a = new AudioEngine();
  try { a.init(); } finally { globalThis.AudioContext = prevAC; }
  a._listenerPos.set(0, 0, 0);
  // resume() rate-limits itself off the wall clock; start every test past it.
  a._lastWake = -1e9;
  return { a, ctx: made };
}

export async function run({ check, assert }) {

  check('audio: the engine comes up with a live graph and a full master', () => {
    const { a, ctx } = engine();
    assert(a.ready, 'init() did not finish — every sound in the game is a no-op');
    assert(a.master.gain.value === 0.8, `master is at ${a.master.gain.value}`);
    assert(a.sfxBus.gain.value === 1 && a.ambBus.gain.value === 1,
      `a bus came up muted: sfx ${a.sfxBus.gain.value}, amb ${a.ambBus.gain.value}`);
    assert(a.master.outs.has(ctx.destination), 'master never reached the destination');
    assert(ctx.disconnected.length === 0, 'init() disconnected something');
    return `${ctx.connects} edges, master ${a.master.gain.value}, sfx ${a.sfxBus.gain.value}`;
  });

  check('audio: a NaN volume setting cannot mute the game for good', () => {
    // A stored setting is whatever is in localStorage. master.gain.value = NaN
    // throws inside init(), which leaves ctx set and `ready` false, and every
    // later init() returns early on the ctx it already has. Permanent silence,
    // nothing in the console.
    const prevAC = globalThis.AudioContext;
    globalThis.AudioContext = function () { return new FakeCtx(); };
    const a = new AudioEngine();
    a.setVolume(undefined); a.setMusicVolume(NaN);
    try { a.init(); } finally { globalThis.AudioContext = prevAC; }
    assert(a.ready, 'a NaN volume killed init() — the whole session is silent');
    assert(Number.isFinite(a.master.gain.value) && a.master.gain.value > 0,
      `master came up at ${a.master.gain.value}`);
    assert(Number.isFinite(a.musicBus.gain.value), `musicBus came up at ${a.musicBus.gain.value}`);
    return `volume NaN → ${a.master.gain.value}, music NaN → ${a.musicBus.gain.value}`;
  });

  check('audio: the voice bands reserve real room above the chatter', () => {
    const { a } = engine();
    const caps = [PRIO.chatter, PRIO.world, PRIO.combat, PRIO.critical].map(p => a.bandCap(p));
    for (let i = 1; i < caps.length; i++) {
      assert(caps[i] > caps[i - 1], `band ${i} (${caps[i]}) does not sit above band ${i - 1} (${caps[i - 1]})`);
    }
    assert(caps[3] === a.maxVoices, `the top band is ${caps[3]} of ${a.maxVoices} — it must be the whole pool`);
    // A clash costs three voices and a deflection up to three. Whatever the
    // chatter is doing, there has to be room for several of them.
    const reserve = a.maxVoices - caps[0];
    assert(reserve >= 12, `only ${reserve} voices are held back from chatter — four clashes is 12`);
    return `caps ${caps.join('/')} of ${a.maxVoices}, ${reserve} reserved above chatter`;
  });

  check('audio: a storm of footsteps cannot silence a clash', () => {
    const { a } = engine();
    const near = V(2, 0, 0);
    // 400 footsteps on a single timestamp: worse than the 143/s the game
    // actually produces, and the pool must still not be theirs to fill.
    for (let i = 0; i < 400; i++) a.step(near, 'sand');
    const chatter = a.voices;
    assert(chatter <= a.bandCap(PRIO.chatter),
      `footsteps took ${chatter} of ${a.maxVoices} voices — the band cap is ${a.bandCap(PRIO.chatter)}`);

    const before = a.voices;
    a.clash(near, 1);
    assert(a.voices - before === 3, `the clash got ${a.voices - before} of its 3 voices`);
    const afterClash = a.voices;
    a.deflect(near, 3);
    assert(a.voices - afterClash === 3, `the deflection got ${a.voices - afterClash} of its 3 voices`);
    const afterDeflect = a.voices;
    a.ui('click');
    assert(a.voices - afterDeflect === 1, 'a menu blip was refused');
    return `400 footsteps held ${chatter}/${a.maxVoices}; clash, deflect and UI all still played`;
  });

  check('audio: the pool drains back to empty over a long fight', () => {
    const { a, ctx } = engine();
    const near = V(3, 1, 0);
    for (let f = 0; f < 1800; f++) {           // 30 s at 60 Hz
      for (let k = 0; k < 2; k++) a.step(near, 'sand');
      if (f % 7 === 0) a.blaster(near, false);
      if (f % 11 === 0) a.boltHit(near);
      if (f % 23 === 0) a.clash(near, 1);
      if (f % 97 === 0) a.explosion(near, 1);
      ctx.advance(1 / 60);
    }
    const mid = a.voices;
    ctx.advance(5);                            // let everything in flight finish
    assert(a.voices === 0, `${a.voices} of ${a.maxVoices} voices never came back — the game goes mute`);
    assert(a.stats.alloc === a.stats.freed,
      `allocated ${a.stats.alloc} but freed ${a.stats.freed} — ${a.stats.alloc - a.stats.freed} stranded`);
    assert(a.stats.threw === 0, `${a.stats.threw} voices threw mid-build`);
    return `${a.stats.alloc} voices over 30 s, ${mid} live at the end of the fight, 0 after it`;
  });

  check('audio: a refused sound does not leave a panner on the effects bus', () => {
    const { a, ctx } = engine();
    const near = V(2, 0, 0);
    const p0 = ctx.panners;
    const v0 = a.stats.alloc;
    for (let i = 0; i < 400; i++) a.step(near, 'sand');
    const built = ctx.panners - p0, took = a.stats.alloc - v0;
    assert(built === took,
      `${built} panners were built for ${took} voices — ${built - took} are orphaned on sfxBus forever`);
    assert(a.stats.denied > 0, 'the pool was never actually saturated, so this proves nothing');
    return `${a.stats.denied} refusals, ${built} panners for ${took} voices`;
  });

  check('audio: a sound too far away to hear is not worth a voice', () => {
    const { a, ctx } = engine();
    const p0 = ctx.panners;
    // At 80 m the inverse law leaves 2.05% of a source's amplitude, so a 0.09
    // footstep arrives at 0.0018 — under the 0.013 RMS the empty room already
    // makes on its own — while a 0.5 detonation still lands at 0.0103 and
    // belongs in the mix. The old flat 190 m cull gave both the same range.
    a.step(V(80, 0, 0), 'sand');
    assert(a.voices === 0, 'a footstep 80 m away took a voice');
    assert(ctx.panners === p0, 'a footstep 80 m away built a panner');
    a.explosion(V(80, 0, 0), 1);
    assert(a.voices === 3, `the distant explosion got ${a.voices} of its 3 voices`);

    // and near sounds are untouched
    const { a: b } = engine();
    b.step(V(2, 0, 0), 'sand');
    assert(b.voices === 1, 'a footstep two metres away was culled');
    return `footstep culled at 80 m, explosion kept, footstep at 2 m kept`;
  });

  check('audio: a stopped context is not fed sounds it cannot play', () => {
    const { a, ctx } = engine();
    ctx.allowResume = false;                   // a browser with no gesture yet
    ctx.state = 'suspended';
    const t = ctx.currentTime;
    const near = V(2, 0, 0);
    for (let i = 0; i < 200; i++) { a.clash(near, 1); a.step(near, 'sand'); }
    assert(a.voices === 0,
      `${a.voices} voices were taken while the context was stopped — none of them can ever fire 'ended'`);
    assert(ctx.currentTime === t, 'the fake clock moved; this test is not measuring what it thinks');
    assert(ctx.resumeCalls > 0, 'nothing ever asked the context to come back — that is the permanent mute');
    assert(a.stats.dropped >= 200, `only ${a.stats.dropped} sounds were dropped out of 800 scheduled`);

    // and it plays again the moment the context does
    ctx.allowResume = true;
    a._lastWake = -1e9;
    a.resume();
    assert(ctx.state === 'running', 'resume() did not restart the context');
    a.clash(near, 1);
    assert(a.voices === 3, `after resuming, the clash got ${a.voices} of its 3 voices`);
    return `800 sounds dropped while suspended, ${ctx.resumeCalls} resume attempts, full voices after`;
  });

  check('audio: a throw mid-build releases the voice and its panner', () => {
    const { a, ctx } = engine();
    const near = V(2, 0, 0);
    const p0 = ctx.panners, d0 = ctx.disconnected.length;
    const realGain = ctx.createGain.bind(ctx);
    ctx.createGain = () => { throw new TypeError('the browser said no'); };
    for (let i = 0; i < 60; i++) { a.clash(near, 1); a.blaster(near, true); }
    ctx.createGain = realGain;
    assert(a.voices === 0, `${a.voices} voices leaked through a throw — 44 of these and the game is mute`);
    assert(a.stats.threw > 0, 'nothing actually threw, so this proves nothing');
    const built = ctx.panners - p0, freed = ctx.disconnected.length - d0;
    assert(freed >= built, `${built} panners were built and only ${freed} disconnected`);
    // and the engine is still usable afterwards
    a.clash(near, 1);
    assert(a.voices === 3, `the engine did not recover: ${a.voices} of 3 voices`);
    return `${a.stats.threw} throws, 0 voices leaked, ${freed} panners released, engine still plays`;
  });

  check('audio: retiring a voice never disconnects a shared bus', () => {
    const { a, ctx } = engine();
    const shared = new Set([a.sfxBus, a.musicBus, a.master, a.ambBus, a.comp]);
    // Non-positional sounds route straight to sfxBus. Calling disconnect() on
    // that unplugs every sound in the game from the compressor, permanently.
    for (let f = 0; f < 600; f++) {
      a.ui(['hover', 'click', 'good', 'bad'][f & 3]);
      a.force(null, 'sense');
      ctx.advance(1 / 60);
    }
    ctx.advance(5);
    const bad = ctx.disconnected.filter(n => shared.has(n));
    assert(bad.length === 0, `${bad.length} shared buses were torn down (${bad.map(n => n.kind).join(', ')})`);
    assert(a.voices === 0, `${a.voices} voices leaked from non-positional sounds`);
    /* REACHABILITY, not one named edge. This used to assert
     * `a.sfxBus.outs.has(a.comp)`, which is a statement about the shape of the
     * graph rather than about the question — "can a sound still get out" — and
     * it went red the day a filter was inserted between the two on a change
     * that had made the game LOUDER. HANDOFF §2.4: an instrument that restates
     * a rule eventually disagrees with it. */
    const reaches = (from, to) => {
      const seen = new Set(), q = [from];
      while (q.length) {
        const n = q.pop();
        if (n === to) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        for (const o of n.outs) q.push(o);
      }
      return false;
    };
    assert(reaches(a.master, ctx.destination), 'the master no longer reaches the destination');
    assert(reaches(a.sfxBus, a.comp), 'the graph came apart: sfx no longer reaches the compressor');
    assert(reaches(a.sfxBus, ctx.destination), 'a sound on the effects bus cannot leave the machine');
    return `${a.stats.alloc} bus-routed voices, 0 bus disconnects, sfx→comp→destination intact`;
  });

  check('audio: a hum is an instrument, not a voice, and disposes cleanly', () => {
    const { a, ctx } = engine();
    const v0 = a.voices;
    const hums = [];
    for (let i = 0; i < 10; i++) { const h = a.createHum(0x57c9ff); h.ignite(); hums.push(h); }
    assert(a.voices === v0, `${a.voices - v0} one-shot voices were spent on hums`);
    for (const h of hums) { h.set(18, 0.4); h.move(V(1, 1, 1)); }
    const d0 = ctx.disconnected.length;
    for (const h of hums) h.dispose();
    // panner, hp, lp, bus, nsG, nsF, lfoG and five osc gains = 12 per hum
    assert(ctx.disconnected.length - d0 >= 10 * 12,
      `only ${ctx.disconnected.length - d0} nodes released for 10 hums — a hum stays audible forever`);
    assert(a.voices === v0, 'disposing a hum moved the one-shot pool');
    return `10 hums, 0 pool voices, ${ctx.disconnected.length - d0} nodes released on dispose`;
  });

  /**
   * THE SCORE, and what this check used to be.
   *
   * It asserted two things: that the pool was untouched, and that `intensity`
   * had smoothed above 0.9. Neither of those is a sound. `intensity` is
   * smoothed BEFORE the `< 0.12` early return, and the pulse takes no voices by
   * design, so — measured, not argued — deleting the entire pulse block and
   * leaving the smoothing line alone kept both assertions green: 0 oscillators,
   * 0 pool voices, intensity 0.998, PASS. The one test of the game's musical
   * reaction to combat could not tell the feature from its total absence.
   *
   * So it counts SOURCES ARRIVING ON THE MUSIC BUS, over ten seconds, at three
   * drive levels, against the tempo the code claims (bpm = 74 + 46 × I), and
   * reads back the envelope and the sweep those sources were given.
   */
  check('audio: the fight is audible in the score, at the tempo it claims', () => {
    const run = (drive) => {
      const { a, ctx } = engine();
      const e0 = ctx.edges.length;
      for (let f = 0; f < 600; f++) { a.updateScore(1 / 60, drive); ctx.advance(1 / 60); }
      const fresh = ctx.edges.slice(e0);
      // One pulse is [oscillator → gain] and [gain → musicBus]. Walk it from
      // the bus back, so what is counted is what the mix would actually receive.
      const gains = fresh.filter(([, d]) => d === a.musicBus).map(([g]) => g);
      const oscs = gains.map(g => (fresh.find(([, d]) => d === g) || [])[0]).filter(Boolean);
      ctx.advance(2);
      return { a, ctx, pulses: gains.length, gains, oscs };
    };

    // The smoothing is a 1/0.6 s lag, so ten seconds at drive I average
    // I × 0.834 of it: the expected count is ∫bpm/60 dt over that.
    const expected = (drive) => (74 + 46 * drive * 0.834) * 10 / 60;

    const hot = run(1), mid = run(0.4), cold = run(0);
    for (const [name, r, drive] of [['full', hot, 1], ['0.4', mid, 0.4]]) {
      const want = expected(drive);
      assert(r.pulses > 0, `${name} drive put NOTHING on the music bus — the score does not answer the fight`);
      assert(Math.abs(r.pulses - want) <= want * 0.15,
        `${name} drive gave ${r.pulses} pulses in 10 s, and bpm = 74 + 46 × I says ${want.toFixed(1)}`);
    }
    assert(hot.pulses > mid.pulses + 2,
      `a full fight (${hot.pulses}) is no faster than a quarter of one (${mid.pulses})`);
    assert(cold.pulses === 0, `${cold.pulses} pulses played with nothing happening at all`);

    // and each one is the envelope and the sweep the source says it is
    const peak = Math.max(...hot.gains.map(g => g.gain.last('lin') ?? 0));
    assert(peak > 0.10 && peak <= 0.1401,
      `the loudest pulse was commanded to ${peak.toFixed(4)}, not the stated 0.14 × intensity`);
    assert(hot.oscs.length === hot.pulses,
      `${hot.oscs.length} of ${hot.pulses} pulses had a source at all`);
    const swept = hot.oscs.filter(o => o.frequency?.last('exp') !== null);
    assert(swept.length === hot.pulses,
      `${swept.length} of ${hot.pulses} pulses actually swept — a sub that does not move is a hum`);
    const from = swept[0].frequency.last('set'), to = swept[0].frequency.last('exp');
    assert(from > to, `the pulse sweeps ${from} → ${to} Hz, which is upwards`);
    assert(hot.a.voices === 0, `the score took ${hot.a.voices} voices from the one-shot pool`);
    return `${hot.pulses}/${mid.pulses}/${cold.pulses} pulses in 10 s at I=1/0.4/0, `
      + `${from.toFixed(0)}→${to.toFixed(0)} Hz, peak ${peak.toFixed(3)}, pool untouched`;
  });

  /**
   * THE ROOM, which is the half of it the player can actually hear.
   *
   * src/engine/Audio.js says of the drone bed, three lines above where it is
   * built, "a slow-breathing minor cluster that swells with the fight". It was
   * written in exactly one place in the project — setAmbience, from level data,
   * at load — and measured over ten seconds at full combat intensity it
   * received ZERO automations: a nine-enemy fight and an empty level were the
   * same room.
   */
  check('audio: the room swells with the fight, and settles after it', () => {
    const { a, ctx } = engine();
    a.setAmbience({ wind: 0.20, windFreq: 190, drone: 0.26 });   // scoria's bed
    const base = a.droneGain.gain.last('tgt');
    assert(Math.abs(base - 0.26) < 1e-9, `the level's own drone arrived as ${base}`);
    const moves0 = a.droneGain.gain.moves();

    for (let f = 0; f < 600; f++) { a.updateScore(1 / 60, 1, 0); ctx.advance(1 / 60); }
    const hot = a.droneGain.gain.last('tgt');
    assert(hot > base + 0.06,
      `ten seconds of a full fight moved the drone from ${base} to ${hot} — the bed does not answer combat`);
    // …and the fight is not weather: the wind bed must not have moved with it.
    assert(Math.abs(a.windGain.gain.last('tgt') - 0.20) < 1e-9,
      `the wind rose with the fight (${a.windGain.gain.last('tgt')}) — that is a storm, not a battle`);

    for (let f = 0; f < 1800; f++) { a.updateScore(1 / 60, 0, 0); ctx.advance(1 / 60); }
    const cold = a.droneGain.gain.last('tgt');
    assert(Math.abs(cold - base) < 0.01,
      `thirty seconds after the fight the drone is still at ${cold.toFixed(3)}, not back to ${base}`);

    // A ramp scheduled every frame is a ramp that never arrives anywhere: 2400
    // frames of this must cost tens of automations, not thousands.
    const moves = a.droneGain.gain.moves() - moves0;
    assert(moves > 2 && moves < 80, `${moves} drone automations over 2400 frames`);
    return `drone ${base} → ${hot.toFixed(3)} under a full fight → ${cold.toFixed(3)} after it, `
      + `in ${moves} automations`;
  });

  /**
   * THE WEATHER. Eight of the thirteen levels ship a squall — kamino peaks at
   * 1.0 for 44 s of every 88 — and src/world/Scenery.js drives fog density, sun
   * intensity, hemi fill and a 2.4× particle wind off `weather.intensity` every
   * frame. The audio wind was written once, at level load. A white-out crossed
   * the level in silence.
   */
  check('audio: a squall is heard as well as seen', () => {
    const { a, ctx } = engine();
    a.setAmbience({ wind: 0.42, windFreq: 520, drone: 0.18 });   // kamino's bed
    const w0 = a.windGain.gain.last('tgt'), f0 = a.windFilter.frequency.last('tgt');

    for (let f = 0; f < 900; f++) { a.updateScore(1 / 60, 0, 1); ctx.advance(1 / 60); }
    const w1 = a.windGain.gain.last('tgt'), f1 = a.windFilter.frequency.last('tgt');
    assert(w1 > w0 * 1.5, `a full squall took the wind from ${w0} to ${w1} — under +3.5 dB, it is not weather`);
    assert(f1 > f0 * 1.3, `the wind's band stayed at ${f1.toFixed(0)} Hz — a gale is brighter than a breeze`);
    // and a storm is not a fight
    assert(Math.abs(a.droneGain.gain.last('tgt') - 0.18) < 1e-9,
      `the drone rose with the weather (${a.droneGain.gain.last('tgt')})`);

    for (let f = 0; f < 900; f++) { a.updateScore(1 / 60, 0, 0); ctx.advance(1 / 60); }
    assert(Math.abs(a.windGain.gain.last('tgt') - w0) < 0.006,
      `the squall blew out and the wind stayed at ${a.windGain.gain.last('tgt')}`);
    assert(Math.abs(a.windFilter.frequency.last('tgt') - f0) < 7,
      `the wind's band never came back down: ${a.windFilter.frequency.last('tgt').toFixed(0)} Hz`);
    return `wind ${w0} → ${w1.toFixed(3)} and ${f0} → ${f1.toFixed(0)} Hz at peak squall, both back after`;
  });

  /**
   * SLOW MOTION WAS SILENT.
   *
   * Force Sense takes the world to 0.42× and a full Focus hold to 0.18×, and
   * `grep focus src/engine/Audio.js` returned nothing at all — the signature
   * power of the game bent time and the mix did not move.
   */
  check('audio: slow motion sounds slow', () => {
    const { a, ctx } = engine();
    const at = (s) => {
      a.setTimeScale(s); ctx.advance(0.2);
      return { f: a.timeLP.frequency.last('tgt') ?? a.timeLP.frequency.value,
        q: a.timeLP.Q.last('tgt') ?? a.timeLP.Q.value, p: a._timePitch };
    };
    const full = at(1);
    assert(full.f > 15000, `the bus is filtered at full speed (${full.f.toFixed(0)} Hz) — this must be free`);
    assert(full.p === 1, `one-shots are detuned at full speed (${full.p})`);

    const sense = at(0.42);          // Player.toggleSense
    const focus = at(0.18);          // a full Focus hold
    assert(sense.f < full.f * 0.72, `Force Sense moved the band from ${full.f.toFixed(0)} to ${sense.f.toFixed(0)} Hz`);
    assert(focus.f < sense.f * 0.8, `a deeper hold did not go darker: ${sense.f.toFixed(0)} vs ${focus.f.toFixed(0)} Hz`);
    assert(focus.q > full.q, `no resonance on the way down (${full.q} vs ${focus.q})`);
    assert(focus.p < 0.7 && sense.p < 0.8 && focus.p < sense.p,
      `pitch did not follow the clock: 1× ${full.p}, 0.42× ${sense.p}, 0.18× ${focus.p}`);

    // …and it is a real fundamental on a real sound, not a field.
    a.setTimeScale(1); ctx.advance(0.2);
    const before = ctx.edges.length;
    a.tone({ freq: 440, dur: 0.1, gain: 0.2, prio: PRIO.critical });
    const dry = ctx.edges.slice(before).map(([f]) => f).find(n => n.kind === 'osc');
    a.setTimeScale(0.18); ctx.advance(0.2);
    const mark = ctx.edges.length;
    a.tone({ freq: 440, dur: 0.1, gain: 0.2, prio: PRIO.critical });
    const slow = ctx.edges.slice(mark).map(([f]) => f).find(n => n.kind === 'osc');
    assert(dry && slow, 'the probe tones never built an oscillator');
    assert(Math.abs(dry.frequency.value - 440) < 0.001,
      `a tone at full speed came out at ${dry.frequency.value.toFixed(1)} Hz`);
    assert(slow.frequency.value < 300,
      `a tone in a 0.18× world came out at ${slow.frequency.value.toFixed(1)} Hz`);

    // Back up, and back to free.
    a.setTimeScale(1); ctx.advance(0.2);
    assert((a.timeLP.frequency.last('tgt') ?? 0) > 15000, 'the band never reopened');
    const semis = (12 * Math.log2(slow.frequency.value / 440)).toFixed(1);
    return `bus band ${full.f.toFixed(0)} → ${sense.f.toFixed(0)} Hz at Sense → ${focus.f.toFixed(0)} Hz at a full hold; `
      + `Q ${full.q.toFixed(2)} → ${focus.q.toFixed(2)}; a 440 Hz tone lands at `
      + `${slow.frequency.value.toFixed(0)} Hz (${semis} semitones); all of it back at 1×`;
  });

  /**
   * EVERY SPACE SOUNDED LIKE THE SAME ROOM.
   *
   * `init()` built one convolver from `_makeImpulse(2.4, 2.6)` behind a send of
   * 0.16, and `grep reverbSend` found nothing after the line that created it. A
   * 30,000-seat stone bowl, an open dune sea and a sealed foundry were all
   * played through that one tail at that one level for the life of the project.
   *
   * The room is DERIVED (World.roomOf) rather than added as a tenth field to
   * ten level records, so this measures the derivation over the whole roster —
   * a spread, not a single number — and then measures that the derivation
   * actually reaches the graph.
   */
  check('audio: each level is a different room, and the room reaches the graph', async () => {
    const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
    // World.js is imported dynamically and inside the function body: it reaches
    // Engine.js, whose module-level ShaderChunk rewrites sit behind once-only
    // flags. See tools/verify.mjs.
    const { roomOf } = await import('../../src/game/World.js');

    /* The GROUND is `Terrain.surfaceAt`'s answer and this check does not build
     * ten heightfields to ask it — that is the shape that made levels-quality
     * unrunnable (HANDOFF §2.6). It sweeps the four surfaces that exist instead,
     * which is a stronger statement than one sample each: the derivation has to
     * be spread over the ROSTER whatever it is standing on. */
    const rows = [], all = [];
    for (const k of LEVEL_ORDER) {
      const L = LEVELS[k];
      const r = roomOf(L, 'sand');
      all.push(r);
      rows.push(`${k} ${r.seconds.toFixed(2)}s/${r.send.toFixed(3)}`);
      for (const g of ['sand', 'stone', 'metal', 'water']) {
        const q = roomOf(L, g);
        assert(Number.isFinite(q.seconds) && Number.isFinite(q.decay) && Number.isFinite(q.send),
          `${k}/${g} produced a non-finite room`);
        assert(q.seconds >= 0.15 && q.seconds <= 6 && q.send >= 0 && q.send <= 0.6,
          `${k}/${g} is out of the range setRoom will take: ${JSON.stringify(q)}`);
      }
    }
    const span = (list, f) => { const v = list.map(f); return Math.max(...v) / Math.min(...v); };
    /* The bar is "these are different places", not a tuning. One shared room is
     * 1.00x on everything, which is what shipped.
     *
     * TWO POPULATIONS, because the three numbers have two different causes and
     * measuring both against one would understate one of them. `seconds` and
     * `send` are the LEVEL's — how enclosed it is and how far it spreads — so
     * they are spread across the roster with the ground held still. `decay` is
     * the GROUND's, so a sweep that holds the ground still measures almost
     * nothing of it (1.55x, and every bit of that is grass and water); it is
     * spread over the four surfaces `Terrain.surfaceAt` can actually report. */
    const grid = [];
    for (const k of LEVEL_ORDER) for (const g of ['sand', 'stone', 'metal', 'water']) grid.push(roomOf(LEVELS[k], g));
    assert(span(all, r => r.seconds) > 3, `every level's tail is within ${span(all, r => r.seconds).toFixed(2)}x`);
    assert(span(all, r => r.send) > 3, `every level's send is within ${span(all, r => r.send).toFixed(2)}x`);
    assert(span(grid, r => r.decay) > 2.5,
      `every ground decays the same: within ${span(grid, r => r.decay).toFixed(2)}x`);

    // …and it lands. The impulse is a real buffer and the send is a real ramp.
    const { a } = engine();
    const open = roomOf(LEVELS[LEVEL_ORDER.find(k => LEVELS[k].ambience?.wind >= 0.3)] || {}, 'sand');
    const hall = roomOf(LEVELS.foundry || LEVELS[LEVEL_ORDER[0]], 'metal');
    a.setAmbience({ wind: 0.04, drone: 0.3, room: hall });
    const long = a.reverb.buffer;
    assert(long, 'setRoom left the convolver with no impulse at all');
    assert(Math.abs(long.duration - hall.seconds) < 0.02,
      `the impulse is ${long.duration.toFixed(2)}s for a ${hall.seconds.toFixed(2)}s room`);
    const sendLong = a.reverbSend.gain.last('tgt');
    a.setAmbience({ wind: 0.42, drone: 0.03, room: open });
    const short = a.reverb.buffer;
    assert(short !== long, 'the second level reused the first level\'s impulse');
    assert(short.duration < long.duration * 0.6,
      `an open ridge got ${short.duration.toFixed(2)}s against the hall's ${long.duration.toFixed(2)}s`);
    assert(a.reverbSend.gain.last('tgt') < sendLong * 0.6,
      `the send did not move between rooms: ${sendLong} → ${a.reverbSend.gain.last('tgt')}`);
    // Re-entering the same room must not rebuild 320 kB of impulse.
    const again = a.reverb.buffer;
    a.setRoom(open);
    assert(a.reverb.buffer === again, 'the same room built a second impulse');

    return `${LEVEL_ORDER.length} levels: tail ${span(all, r => r.seconds).toFixed(1)}x, `
      + `send ${span(all, r => r.send).toFixed(1)}x, decay ${span(grid, r => r.decay).toFixed(1)}x over 4 grounds `
      + `(all were 2.40s / 2.6 / 0.16); graph ${long.duration.toFixed(2)}s@${sendLong.toFixed(3)} `
      + `→ ${short.duration.toFixed(2)}s@${a.reverbSend.gain.last('tgt').toFixed(3)}, re-entry rebuilds nothing`;
  });
}
