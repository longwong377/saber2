/**
 * BATTLEFRONT BORZ — THE FLIGHT DECK, HEARD.
 *
 * Nothing in `src/game/DeckAudio.js` draws anything, so `tools/shot.mjs` has no
 * opinion about any of it and none of the twelve suites that rasterise a scene
 * can say whether it is working. This file is the whole of the evidence, and it
 * asks its questions two ways on purpose:
 *
 *   WHAT DID THE GAME ASK FOR — through `audio.mjs`'s `FakeCtx`, which records
 *     every node built and every value commanded. That is the right instrument
 *     for the defects this project's audio has actually had: a missing branch,
 *     a leaked voice, a full pool, a ramp that never arrives.
 *   WHAT CAME OUT — through `_offline-audio.mjs`, which RENDERS the real graph
 *     into a real buffer and integrates it. That is the only instrument that
 *     can answer "walking toward the shield audibly changes the room", because
 *     that is a claim about energy in bands and no amount of reading back a
 *     filter's commanded cutoff establishes it. A lowpass closing to 300 Hz
 *     over a bed with nothing above 200 Hz in it would command exactly the
 *     same numbers and do nothing at all.
 *
 * The second instrument has already earned itself: rendering the four
 * customisation cues found three gain nodes whose envelopes open tens of
 * milliseconds into the sound and which therefore played at UNITY until they
 * did — peaks of 1.04, 1.12 and 1.16 against envelopes that never ask for more
 * than 0.07. `FakeCtx` cannot see that, because what was commanded was
 * correct; a voice count cannot see it; and it is a click followed by a bare
 * oscillator, on the four sounds a player triggers most often.
 */

import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { audio, PRIO } from '../../src/engine/Audio.js';
import {
  DECK_BED, PRESSURE, PA_VOICE, BOOT, REPULSOR,
  dressDeckAudio, stepDeckAudio, undressDeckAudio, deckSurfaceAt, edgeOf, pressureAt,
  hullThump, paCall, ventBurst, bootFall, bootHalt, repulsorPass,
  cuePaint, cueAttach, cueDetach, cueName,
} from '../../src/game/DeckAudio.js';
import { DECK } from '../../src/game/Hangar.js';
import { OfflineCtx, bands, rms, dB, BANDS } from './_offline-audio.mjs';
import { clocked } from './_shared.mjs';

/**
 * DRIVE THE SHARED SINGLETON AND HAND ALL OF IT BACK.
 *
 * It has to be the singleton: `DeckAudio` calls the module's `audio`, not an
 * engine it is handed, so a private one would measure nothing. What it may not
 * do is leave the singleton half-built for the eighty suites that run after it
 * — `audio.mjs`'s jet check records what that cost when it was got wrong (38
 * checks across five suites, every one of them green when run alone). So the
 * snapshot is every own property and it goes back in a `finally`.
 */
function boot(rate = 48000) {
  const prev = globalThis.AudioContext;
  let ctx = null;
  globalThis.AudioContext = function () { ctx = new OfflineCtx(rate); return ctx; };
  const was = { ...audio };
  audio.ctx = null; audio.ready = false; audio._lastWake = -1e9;
  try { audio.init(); } finally { globalThis.AudioContext = prev; }
  audio._listenerPos.set(0, 1.7, -34);
  ctx.setListener(0, 1.7, -34);
  return { ctx, was };
}
function restore(was) {
  for (const k of Object.keys(audio)) delete audio[k];
  Object.assign(audio, was);
}
const cam = (x, y, z) => ({ getWorldPosition(v) { v.set(x, y, z); return v; } });
const peak = (b) => { let m = 0; for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i])); return m; };
const share = (b) => BANDS.map(([n]) => `${n} ${(100 * b[n] / Math.max(b.total, 1e-18)).toFixed(0)}%`).join(', ');

/** The bed alone, rendered with the ear at (0, 1.7, z). */
function renderBed(z, seconds = 7.5) {
  const { ctx, was } = boot();
  try {
    const world = { terrain: null, settings: {} };
    const st = dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
    audio._listenerPos.set(0, 1.7, z);
    ctx.setListener(0, 1.7, z);
    stepDeckAudio(world, 1 / 60, cam(0, 1.7, z));
    const buf = ctx.render(st.out, seconds);
    /* From 3 s, so the pressure filter's own 0.20–0.35 s time constants have
     * arrived — a bed measured through its own transition is a measurement of
     * the transition. */
    return { b: bands(buf, ctx.sampleRate, 3, seconds), r: rms(buf, ctx.sampleRate, 3, seconds), pk: peak(buf) };
  } finally { restore(was); }
}

/**
 * One sound, alone, through the deck's own chain.
 *
 * SILENCING THE BED IS NOT `out.gain = 0`, because the tannoy and the vents
 * arrive through the same gain. Unplugging `chain` from the pressure filter
 * strands every bed layer and leaves a fresh gain where the one-shots land.
 */
function renderCue(fn, seconds = 2.5, at = [0, 1.7, -34]) {
  const { ctx, was } = boot();
  try {
    const world = { terrain: null, settings: {} };
    const st = dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
    audio._listenerPos.set(at[0], at[1], at[2]);
    ctx.setListener(at[0], at[1], at[2]);
    stepDeckAudio(world, 1 / 60, cam(at[0], at[1], at[2]));
    st.chain.disconnect();
    const probe = ctx.createGain();
    probe.connect(audio.ambBus);
    st.chain = probe;
    const v0 = audio.stats.alloc;
    fn(world, st, ctx);
    const buf = ctx.render(audio.comp, seconds);
    return { buf, ctx, b: bands(buf, ctx.sampleRate, 0, seconds), r: rms(buf, ctx.sampleRate, 0, seconds),
      pk: peak(buf), voices: audio.stats.alloc - v0, leaked: audio.voices };
  } finally { restore(was); }
}

export async function run({ check, assert }) {
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  THE ONE IDEA                                                      */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck audio: walking to the shield takes the room away, and leaves the hull', () => {
    /**
     * THE HEADLINE, AND THE ONLY ONE THAT CANNOT BE FAKED BY READING PARAMS.
     *
     * `HANGAR-SPEC`: "Audible pressure differential — muffled hush right at the
     * boundary, deck noise behind you." The claim under test is that the
     * MIDRANGE goes and the SUB does not, because that is what a room ending
     * sounds like and a fade is not.
     *
     * The bars are set well inside the measurement (−12 against −18.2 dB, +0
     * against +0.7) so that a re-tune of the bed does not turn this red for
     * being 2 dB different, but a re-tune that DROPS the feature does.
     */
    const open = renderBed(-34);
    const lip = renderBed(DECK.lip - 1.5);

    assert(dB(lip.b['800-3k'], open.b['800-3k']) < -12,
      `the 800 Hz–3 kHz band only falls ${dB(lip.b['800-3k'], open.b['800-3k']).toFixed(1)} dB between the `
      + 'middle of the deck and the lip — the pressure differential is the single most convincing '
      + 'thing in this room and at that depth it is a volume knob');
    assert(dB(lip.b['200-800'], open.b['200-800']) < -8,
      `the 200–800 Hz band falls only ${dB(lip.b['200-800'], open.b['200-800']).toFixed(1)} dB`);
    assert(dB(lip.b['20-60'], open.b['20-60']) > -2,
      `the sub falls ${dB(lip.b['20-60'], open.b['20-60']).toFixed(1)} dB at the lip — structure-borne `
      + 'sound does not need air, and a boundary that takes the hull with it is a mute, not a place');
    /* AND THE EAR AGREES. A-weighted, because this bed is 72% sub by energy
     * and an unweighted total measures the one layer that is supposed to
     * survive — it moves 0.0 dB across this walk, which is true and says the
     * opposite of what a listener would say. */
    const a = dB(lip.b.aTotal, open.b.aTotal);
    assert(a < -8, `A-weighted, the walk to the lip is only ${a.toFixed(1)} dB`);
    const lowOpen = (open.b['20-60'] + open.b['60-200']) / open.b.total;
    const lowLip = (lip.b['20-60'] + lip.b['60-200']) / lip.b.total;
    assert(lowLip > 0.95 && lowOpen < 0.95,
      `energy under 200 Hz goes ${(100 * lowOpen).toFixed(0)}% → ${(100 * lowLip).toFixed(0)}% — `
      + 'at the boundary there should be almost nothing left but the hull');
    return `A-weighted ${a.toFixed(1)} dB · 800 Hz–3 kHz ${dB(lip.b['800-3k'], open.b['800-3k']).toFixed(1)} dB, `
      + `200–800 ${dB(lip.b['200-800'], open.b['200-800']).toFixed(1)}, 20–60 `
      + `${dB(lip.b['20-60'], open.b['20-60']).toFixed(1)} · under 200 Hz ${(100 * lowOpen).toFixed(0)}% → ${(100 * lowLip).toFixed(0)}%`;
  });

  check('deck audio: and it does it smoothly, over the last twenty metres', () => {
    /**
     * A BOUNDARY, NOT A DOOR. The failure this guards is a curve that snaps —
     * a player walking a straight line into a step change hears a trigger
     * volume, which is the single most authored-feeling artefact a level can
     * have. So the pressure is sampled along the walk and required to be
     * MONOTONIC and to have no single 2 m step worth more than a quarter of
     * the whole travel.
     *
     * Read off `pressureAt` rather than off a render, because it is pure and
     * because the render already established that `p` is what moves the graph.
     */
    let prev = -1, worst = 0, worstAt = 0;
    const rows = [];
    for (let e = 30; e >= 0; e -= 2) {
      const p = pressureAt(0, DECK.lip - e);
      assert(p >= prev, `the hush goes BACKWARDS between ${e + 2} m and ${e} m out`);
      if (prev >= 0 && p - prev > worst) { worst = p - prev; worstAt = e; }
      prev = p;
      if (e % 6 === 0) rows.push(`${e}m ${p.toFixed(2)}`);
    }
    assert(worst < 0.25, `${(worst * 100).toFixed(0)}% of the whole transition happens in one 2 m step at ${worstAt} m out`);
    assert(pressureAt(0, DECK.lip - 30) < 0.02, 'the room is already hushed 30 m from the field');
    assert(pressureAt(0, DECK.lip - 1) > 0.95, 'the room is not hushed with the player against the field');
    /* AND THE WALL BEHIND YOU IS NOT A FIELD. A radial measure would hush the
     * room as the player walked AFT, which is the one direction with more ship
     * in it rather than less. */
    assert(pressureAt(0, DECK.aft + 2) < 0.02,
      'walking to the bulkhead hushes the room — the deck has one wall and it is not a boundary');
    assert(edgeOf(0, DECK.aft - 20) === edgeOf(0, DECK.aft),
      'walking further aft changes how close `edgeOf` thinks the field is — it is measuring the '
      + 'bulkhead as a fourth open side');
    assert(edgeOf(30, DECK.aft) === DECK.lip - 30,
      'aft of the bulkhead the only thing that decides how close the field is should be how far '
      + 'across the deck you are standing');
    return `${rows.join(' · ')} · worst 2 m step ${(worst * 100).toFixed(0)}%`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  THE BED                                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck audio: the bed is a hull and not a chord', () => {
    /**
     * The level's own `ambience.drone` is five sines on A1–E2–A2–E3–A3, a
     * stack of perfect fifths, and it is a good musical drone. A ship is a
     * PLANT: rotating machinery whose tones are not in any key and which BEAT
     * against each other rather than consonating. Two things are asserted and
     * both are the difference:
     *
     *   nothing in the bed is a whole-number ratio of anything else in it, to
     *     within a hertz — a 2:1 or 3:2 pair fuses and is heard as timbre;
     *   the two subs are close enough to beat and far enough apart not to
     *     fuse, which is the 2.33 s swell that says the thing is enormous.
     */
    const fs = [...DECK_BED.sub.map((s) => s.f), DECK_BED.plant.f, DECK_BED.turbine.f];
    const beat = Math.abs(DECK_BED.sub[1].f - DECK_BED.sub[0].f);
    assert(beat > 0.15 && beat < 1.2,
      `the two subs are ${beat.toFixed(2)} Hz apart — under about 0.15 they are one oscillator with a `
      + 'very long period and over about 1.2 they are a dissonance rather than a swell');
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const r = fs[j] / fs[i];
        const n = Math.round(r);
        if (n >= 2 && n <= 4) {
          assert(Math.abs(r - n) * fs[i] > 0.2,
            `${fs[i]} Hz and ${fs[j]} Hz are an exact ${n}:1 — they fuse into one tone, which is a note`);
        }
      }
    }
    /* THE THREE NOISE LAYERS RUN AT THREE INCOMMENSURATE RATES off one 2 s
     * buffer. Three copies at one rate lock into a single audible 2 s period,
     * and a listener finds a two-second loop inside two minutes. */
    const rates = ['rumble', 'air', 'hiss'].map((k) => DECK_BED[k].rate);
    for (let i = 0; i < rates.length; i++) {
      for (let j = i + 1; j < rates.length; j++) {
        assert(Math.abs(rates[i] - rates[j]) > 0.15,
          `two noise layers run at ${rates[i]} and ${rates[j]} — near enough to phase-lock into one loop`);
      }
    }
    return `subs ${fs[0]}/${fs[1]} Hz beating at ${beat.toFixed(2)} Hz (${(1 / beat).toFixed(2)} s), `
      + `noise at ${rates.join('/')}×`;
  });

  check('deck audio: the bed is a floor and not a wall', () => {
    /**
     * A bed's whole job is to be under everything, so the number that matters
     * is not what it measures on its own but what it measures against the
     * things that have to be heard over it. The level's shared drone peaks
     * around 0.13; a footstep on plate delivers about 0.05 at a metre and a
     * half. A bed that arrived at either of those is a bed that has become the
     * room's loudest object.
     */
    const open = renderBed(-34, 6);
    assert(open.pk < 0.20, `the bed peaks at ${open.pk.toFixed(3)} — louder than the drone it sits under`);
    assert(open.r > 0.008, `the bed measures ${open.r.toFixed(4)} RMS — there is no room here at all`);
    const low = (open.b['20-60'] + open.b['60-200']) / open.b.total;
    assert(low > 0.6 && low < 0.98,
      `${(100 * low).toFixed(0)}% of the bed is under 200 Hz — under about 60% it is a hiss rather than a `
      + 'hull, and over about 98% there is nothing for the pressure filter to take away');
    return `${open.r.toFixed(4)} RMS, ${open.pk.toFixed(3)} peak · ${share(open.b)}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  THE DECK UNDERFOOT                                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck audio: the deck changes under your boots on the way to the field', () => {
    /**
     * `Terrain.surfaceAt` opens `if (this.preset.flat) return 'metal'`, so
     * without this every square metre of the deck is the same 3400 Hz tick.
     * `HANGAR-SPEC` asks for "your own footsteps changing material as you walk
     * toward the shield".
     *
     * MEASURED THROUGH THE SHIPPED PATH — `audio.step`, the same call
     * `Player._footstep` makes — and rendered, because two rows in a table
     * proves nothing about two sounds. Eight steps each, averaged, because the
     * noise source starts at a random offset in a 2 s buffer.
     */
    const seen = new Set();
    for (let z = DECK.aft + 4; z < DECK.lip; z += 2) seen.add(deckSurfaceAt(0, z));
    assert(seen.size >= 3,
      `walking straight out to the field crosses ${seen.size} material(s): ${[...seen].join(', ')}`);
    assert(deckSurfaceAt(0, DECK.lip - 1) === 'lip', 'the last plates before the drop are not their own material');

    const { ctx, was } = boot();
    const out = {};
    try {
      for (const s of ['metal', 'plate', 'grating', 'lip']) {
        const acc = {}; let pk = 0;
        for (let k = 0; k < 8; k++) {
          ctx.currentTime = 0;
          audio._listenerPos.set(0, 0, 0); ctx.setListener(0, 0, 0);
          audio.step({ x: 0, y: 0, z: -1.5 }, s, false);
          const buf = ctx.render(audio.comp, 0.4);
          const b = bands(buf, ctx.sampleRate, 0, 0.4);
          for (const [n] of BANDS) acc[n] = (acc[n] || 0) + b[n] / 8;
          pk += peak(buf) / 8;
        }
        const tot = BANDS.reduce((t, [n]) => t + acc[n], 0);
        /* The spectral centroid, on log band centres — one number for "how
         * bright", which is the whole of what a material sounds like once the
         * level has been taken out of it. */
        const mid = { '20-60': 35, '60-200': 110, '200-800': 400, '800-3k': 1550, '3k-12k': 6000 };
        out[s] = { c: Math.exp(BANDS.reduce((t, [n]) => t + acc[n] / tot * Math.log(mid[n]), 0)), pk };
      }
    } finally { restore(was); }

    assert(out.grating.c > out.plate.c * 1.5,
      `grating's spectral centroid is ${out.grating.c.toFixed(0)} Hz against plate's ${out.plate.c.toFixed(0)} — `
      + 'open steel bar over a blast channel rings and 40 mm plate on frames does not, and if those two '
      + 'measure the same the material change is a table entry rather than a sound');
    assert(out.lip.pk > out.plate.pk * 1.15,
      `the lip is only ${(20 * Math.log10(out.lip.pk / out.plate.pk)).toFixed(1)} dB over plate — the two paces `
      + 'before the edge are the two this room is composed around');
    return Object.entries(out).map(([k, v]) => `${k} ${v.c.toFixed(0)} Hz/${v.pk.toFixed(4)}`).join(' · ');
  });

  check('deck audio: it extends the one footstep system rather than adding a second', () => {
    /**
     * There is exactly one path from a foot to a sound in this game and four
     * readers of it — `Player._footstep`, `Enemy`, `Presence` (twice) and
     * `Particles.surfaceTint`. The deck's materials arrive by standing an own
     * property in front of the live terrain INSTANCE's `surfaceAt`, so all
     * four are served and none is edited; and they go away with the world.
     *
     * THE TWO WAYS THAT COULD GO WRONG, both driven here: a dress that does
     * not restore leaves every later level on the flight deck's materials, and
     * a restore that ASSIGNS the prototype's method back leaves an own
     * property that a later fix to `Terrain.prototype.surfaceAt` could never
     * reach.
     */
    const proto = { surfaceAt(x, z) { return 'metal'; } };
    const terrain = Object.create(proto);
    const world = { terrain, settings: {} };
    assert(terrain.surfaceAt(0, 60) === 'metal', 'the fixture is not shaped like a Terrain');
    dressDeckAudio(world);
    assert(terrain.surfaceAt(0, DECK.lip - 1) === 'lip', 'dressing the deck did not change what is underfoot');
    assert(terrain.surfaceAt(0, 0) === 'plate', 'the middle of the deck is not plate');
    undressDeckAudio(world);
    assert(terrain.surfaceAt(0, DECK.lip - 1) === 'metal', 'undressing left the deck materials behind');
    assert(!Object.prototype.hasOwnProperty.call(terrain, 'surfaceAt'),
      'undressing left an own `surfaceAt` on the terrain — the prototype is shadowed forever');
    /* AND EVERY KEY IT CAN RETURN HAS A ROW IN `Audio.SURFACES`, asked of the
     * engine rather than of a list written here: a surface with no row falls
     * to `SURFACE_DEFAULT` and every material change silently stops. */
    const { ctx, was } = boot();
    try {
      const sigs = new Map();
      const real = audio.ctx.createBiquadFilter.bind(audio.ctx);
      for (const s of ['metal', 'plate', 'grating', 'lip', 'a-surface-nobody-has-written']) {
        const made = [];
        audio.ctx.createBiquadFilter = () => { const n = real(); made.push(n); return n; };
        try { audio.step({ x: 0, y: 0, z: -1 }, s, false); } finally { audio.ctx.createBiquadFilter = real; }
        sigs.set(s, `${(made[0]?.frequency?._init ?? 0).toFixed(0)}/${(made[0]?.Q?._init ?? 0).toFixed(1)}`);
      }
      const fallback = sigs.get('a-surface-nobody-has-written');
      for (const s of ['plate', 'grating', 'lip']) {
        assert(sigs.get(s) !== fallback,
          `'${s}' plays the unknown-surface default (${fallback}) — it has no row in Audio.SURFACES and `
          + 'every deck material is the same sound');
      }
      return `${[...sigs].filter(([k]) => k !== 'a-surface-nobody-has-written')
        .map(([k, v]) => `${k} ${v}`).join(' · ')} · unknown ${fallback}`;
    } finally { restore(was); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  BOOTS                                                             */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck audio: a rank of boots is one sound, not twenty-four', () => {
    /**
     * `PRIO`'s own measurement: 94% of every voice request in a real fight was
     * a footstep, and the pool sat full for nine seconds at a stretch while
     * bolt impacts were thrown on the floor. Twenty-four men at 1.8 paces a
     * second is 43 footfalls a second into a chatter band whose ceiling is
     * fifteen live voices.
     *
     * It is also wrong as SOUND. A rank in step is one event, and `footfall`
     * already knows how to make it: mass moves pitch, level and length, and
     * over 2.75 reference masses the ground answers underneath.
     */
    const { ctx, was } = boot();
    try {
      const world = { terrain: null, settings: {} };
      dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
      const v0 = audio.stats.alloc;
      for (let i = 0; i < 24; i++) bootFall(world, { x: i - 12, y: 0, z: DECK.line });
      ctx.currentTime += 0.1;
      stepDeckAudio(world, 0.1, cam(0, 1.7, -34));
      const used = audio.stats.alloc - v0;
      assert(used <= 3,
        `twenty-four men landing together took ${used} voices — the chatter band's whole ceiling is `
        + `${audio.bandCap(PRIO.chatter)} and the company would take the pool with it`);
      assert(used >= 1, 'twenty-four boots landing together made no sound at all');
      /* …AND THE WINDOW IS SHORTER THAN THE FLIGHT TIME OF THE SOUND IT IS
       * COALESCING, which is what makes it inaudible as latency. */
      const flight = Math.abs(DECK.start.z - DECK.line) / 343;
      assert(BOOT.window <= flight,
        `the coalescing window is ${(BOOT.window * 1000).toFixed(0)} ms and the line is `
        + `${(flight * 1000).toFixed(0)} ms of sound travel away — the window is now audible as latency`);
      /* A SECOND RANK, LATER, IS A SECOND SOUND. A window that never closed
       * would be a muster you hear once. */
      const v1 = audio.stats.alloc;
      for (let i = 0; i < 8; i++) bootFall(world, { x: i - 4, y: 0, z: DECK.line });
      ctx.currentTime += 0.1;
      stepDeckAudio(world, 0.1, cam(0, 1.7, -34));
      assert(audio.stats.alloc - v1 >= 1, 'the second rank to land made no sound — the window never closed');
      return `24 boots → ${used} voice(s) against a ${audio.bandCap(PRIO.chatter)} ceiling · `
        + `window ${(BOOT.window * 1000).toFixed(0)} ms under ${(flight * 1000).toFixed(0)} ms of flight time`;
    } finally { restore(was); }
  });

  check('deck audio: ten men halting are heavier and lower than one', () => {
    /**
     * The saturation is the point. Ten men are not ten times one man — the ear
     * fuses them and hears a bigger, lower, longer thing — so this measures
     * that the rank is LOUDER and that it is not louder by ten.
     */
    const one = renderCue((w) => bootHalt(w, { x: 0, y: 0, z: DECK.line }, 1), 1.2);
    const ten = renderCue((w) => bootHalt(w, { x: 0, y: 0, z: DECK.line }, 10), 1.2);
    const g = 20 * Math.log10(ten.pk / Math.max(one.pk, 1e-9));
    assert(g > 3, `ten men halting are only ${g.toFixed(1)} dB over one — the rank does not read`);
    assert(g < 20, `ten men halting are ${g.toFixed(1)} dB over one — a rank saturates, it does not sum`);
    const lowOne = one.b['20-60'] / one.b.total, lowTen = ten.b['20-60'] / ten.b.total;
    assert(lowTen > lowOne,
      `one man halting is ${(100 * lowOne).toFixed(0)}% sub and ten are ${(100 * lowTen).toFixed(0)}% — a rank `
      + 'has to bring the deck with it, which is `footfall`\'s own bodyThump over 2.75 reference masses');
    return `+${g.toFixed(1)} dB for 10× the men · sub share ${(100 * lowOne).toFixed(0)}% → ${(100 * lowTen).toFixed(0)}%`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  THE TANNOY                                                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck audio: the PA is a horn, and the two factions are two machines', () => {
    /**
     * A tannoy sounds the way it does because of what it CANNOT do: nothing
     * under the horn's cutoff, nothing over the driver's, a hard resonance
     * where the throat rings, and distortion because it is always driven too
     * hard. So the test is the BAND: a PA whose energy is spread like a voice
     * in a room is a voice in a room.
     *
     * And `HANGAR-SPEC` is absolute that the two factions never mix, so the two
     * rows have to measure as two different speakers rather than two settings.
     */
    const rep = renderCue((w) => paCall(w, { army: 'republic' }), 5);
    const cis = renderCue((w) => paCall(w, { army: 'separatist' }), 5);
    for (const [name, r] of [['republic', rep], ['separatist', cis]]) {
      assert(r.voices === 1,
        `one ${name} announcement cost ${r.voices} voices — a nine-syllable line built out of `
        + '`tone()` is nine oscillators and nine panners for one sound');
      const lo = r.b['20-60'] / r.b.total;
      assert(lo < 0.02, `${(100 * lo).toFixed(0)}% of the ${name} PA is under 60 Hz — a horn has no bottom`);
      const mid = (r.b['200-800'] + r.b['800-3k']) / r.b.total;
      assert(mid > 0.9,
        `only ${(100 * mid).toFixed(0)}% of the ${name} PA is in 200 Hz–3 kHz — that is not a compression `
        + 'driver on a horn, it is a person');
      assert(r.pk > 0.01, `the ${name} PA delivers ${r.pk.toFixed(4)} at 30 m — nobody would hear it`);
      assert(r.pk < 0.25, `the ${name} PA delivers ${r.pk.toFixed(3)} at 30 m — it is the loudest thing in the room`);
    }
    /* TWO MACHINES: the Republic horn reaches 2.6 kHz and the Confederacy's
     * stops at 1.9, so the energy sits in different bands. */
    const rTop = rep.b['800-3k'] / rep.b.total, cTop = cis.b['800-3k'] / cis.b.total;
    assert(rTop > cTop * 1.5,
      `the two factions' announcements put ${(100 * rTop).toFixed(0)}% and ${(100 * cTop).toFixed(0)}% of their `
      + 'energy in the same band — they are one PA with a different pitch, and one wrong-faction asset '
      + 'is the whole illusion');
    assert(PA_VOICE.republic.chime.length !== PA_VOICE.separatist.chime.length,
      'both factions key up with the same number of pips');
    return `republic ${share(rep.b)} @${rep.pk.toFixed(3)} · separatist ${share(cis.b)} @${cis.pk.toFixed(3)}`;
  });

  check('deck audio: the PA says nothing, and says it differently every time', () => {
    /**
     * "Idle chatter callouts on the PA, distant and UNINTELLIGIBLE." That is
     * the design: a tannoy a player can decode is a narrator, and a narrator
     * with twelve lines is exhausted in ten minutes.
     *
     * TWO PROPERTIES MAKE IT UNINTELLIGIBLE AND BOTH ARE STRUCTURAL rather
     * than a matter of the mix — there are no words anywhere in this module to
     * be found and read out, and there are no consonants in the synthesis: one
     * buzz through two formant bandpasses is vowels and nothing else, and
     * vowels are where the voice is while consonants are where the information
     * is.
     */
    const src = readFileSync(new URL('../../src/game/DeckAudio.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export function paCall'), src.indexOf('export function ventBurst'));
    assert(!/['"`][A-Za-z][A-Za-z ,.'-]{9,}['"`]/.test(body.replace(/\/\*[\s\S]*?\*\//g, '')),
      'there is a sentence in `paCall` — a PA with lines in it is a narrator, and a narrator with '
      + 'twelve lines is exhausted in ten minutes');
    /* AND NO TWO ARE THE SAME. Every announcement is planned from the deck's
     * own seeded stream, so the length, the pitches, the vowels and the gaps
     * all move; two identical plans in a row would be a loop. */
    const world = { terrain: null, settings: {} };
    const st = dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
    const plans = new Set();
    for (let i = 0; i < 12; i++) {
      paCall(world);                                   // headless: plans, plays nothing
      plans.add(st.paPlan.map((s) => `${s.f.toFixed(1)}/${s.sy.toFixed(3)}`).join(','));
    }
    undressDeckAudio(world);
    assert(plans.size === 12, `twelve announcements produced ${plans.size} distinct plans`);
    return `no words in the source · 12 announcements, ${plans.size} distinct plans`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  THE WAR, AND THE TRAFFIC                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck audio: a hull thump is a hull, and it arrives late', () => {
    /**
     * "Distant explosions with no sound, then a delayed muffled thump through
     * the hull." Two claims: the DELAY, which is the whole effect, and the
     * BAND — what reaches you through four hundred metres of ship is the
     * bottom two octaves, because everything above them was absorbed by the
     * structure it came through.
     */
    const t = renderCue((w) => hullThump(w, 1, { delay: 0 }), 2);
    assert(t.voices === 1, `one hull thump cost ${t.voices} voices`);
    const low = (t.b['20-60'] + t.b['60-200']) / t.b.total;
    assert(low > 0.85,
      `only ${(100 * low).toFixed(0)}% of a hull thump is under 200 Hz — it is an explosion in the room, `
      + 'not a detonation heard through a ship');
    assert(t.b['3k-12k'] / t.b.total > 0,
      'a hull thump has no high end at all — the rattle is what puts it inside a structure');
    const half = renderCue((w) => hullThump(w, 0.5, { delay: 0 }), 2);
    assert(half.pk < t.pk * 0.8, 'a half-strength thump is the same sound');

    /* THE DELAY, DRIVEN. A thump asked for with a hold must not sound until
     * the hold has passed, on the deck's own clock. */
    const world = { terrain: null, settings: {} };
    dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
    let fired = -1;
    for (let i = 0; i < 240; i++) {
      if (i === 0) hullThump(world, 1, { delay: 1.4 });
      stepDeckAudio(world, 1 / 60, cam(0, 1.7, -34));
      if (fired < 0 && world._deckAudio.bloom > 0) fired = i / 60;
    }
    undressDeckAudio(world);
    assert(fired > 1.3 && fired < 1.5, `a thump held for 1.4 s arrived at ${fired.toFixed(2)} s`);
    /* AND A RANGE IS A RANGE. `SPEED_OF_SOUND` and nothing else. */
    return `${(100 * low).toFixed(0)}% under 200 Hz, peak ${t.pk.toFixed(3)} · a 1.4 s hold arrived at ${fired.toFixed(2)} s`;
  });

  check('deck audio: a ship going past DOPPLERS, and by a stated amount', () => {
    /**
     * ══ THE ONE THE RECON SAID COULD NOT BE DONE ═══════════════════════════
     *
     * "there is no Doppler anywhere (verified: grep -i doppler|speedOfSound|
     * setVelocity over src/ and tools/ is empty), so a ship taxiing past is a
     * gain ramp." True of the engine as it stood, and it is not a thing anybody
     * forgot: WebAudio HAD a Doppler and the spec deprecated it in 2014 and
     * browsers removed it in 2016. There is no switch to find.
     *
     * It is done by hand instead, and this engine is the easy case for it
     * because nothing here is a sample: every pitch is an
     * `OscillatorNode.frequency` this code already writes every frame.
     *
     * So the assertion is on the COMMANDED FREQUENCY of the pass's own
     * oscillator, sampled through a real 240 m crossing driven frame by frame
     * — not on the ratio function, which could be right while nothing used it.
     */
    const { ctx, was } = boot();
    try {
      const world = { terrain: null, settings: {} };
      dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
      audio._listenerPos.set(0, 1.7, -34); ctx.setListener(0, 1.7, -34);
      const slot = repulsorPass(world, {
        from: new THREE.Vector3(-120, 12, 10), to: new THREE.Vector3(120, 12, 10),
        speed: 34, power: 1, gain: 2.2,
      });
      assert(slot, 'a repulsorlift pass could not be opened at all');
      assert(audio.voices >= 1, 'a held pass took no voice from the pool');
      let hi = -Infinity, lo = Infinity, abeam = 0;
      const frames = Math.ceil((slot.dur + 0.5) * 60);
      for (let i = 0; i < frames; i++) {
        stepDeckAudio(world, 1 / 60, cam(0, 1.7, -34));
        ctx.currentTime += 1 / 60;
        if (!slot.live) break;
        /* What the oscillator was actually TOLD to be, which is the thing a
         * listener would hear. Divided by the layer's rest frequency and by
         * the spin-up ramp, so what is left is the Doppler alone. */
        const ramp = Math.min(1, slot.t / REPULSOR.spin);
        const f = slot.a.o.frequency.last?.('tgt') ?? slot.a.o.frequency.calls.at(-1)?.[1];
        const r = f / (REPULSOR.a.f * (0.72 + 0.28 * (ramp * ramp * (3 - 2 * ramp))));
        if (slot.t > REPULSOR.spin) { hi = Math.max(hi, r); lo = Math.min(lo, r); }
        if (Math.abs(r - 1) < 0.01) abeam = slot.t;
      }
      const sweep = hi / lo;
      assert(sweep > 1.10,
        `the whine only sweeps ${sweep.toFixed(3)}× across a 34 m/s pass — that is a mistuning, not a `
        + 'movement, and a pass with no pitch on it reads as a mixing desk every time');
      assert(sweep < 1.6, `the whine sweeps ${sweep.toFixed(3)}× — a hangar taxi is not a jet fighter`);
      assert(hi > 1 && lo < 1, `the pass is ${hi.toFixed(3)}–${lo.toFixed(3)} — it never crosses unity, so it `
        + 'is approaching or receding for the whole pass and never goes past');
      assert(abeam > 0, 'the whine never passes through its own rest pitch');
      /* AND THE LISTENER'S OWN MOTION IS IN IT. Running at a fixed source has
       * to raise the pitch on its own — that is the half of the formula a
       * source-only implementation drops. */
      const still = audio.dopplerRatio({ x: 0, y: 0, z: 40 }, null);
      audio._listenerVel.set(0, 0, 20);
      const running = audio.dopplerRatio({ x: 0, y: 0, z: 40 }, null);
      audio._listenerVel.set(0, 0, 0);
      assert(running > still * 1.02,
        `running at a still source at 20 m/s changes the pitch by ${((running / still - 1) * 100).toFixed(1)}% — `
        + 'the listener term is missing from the ratio');
      return `${hi.toFixed(3)} → ${lo.toFixed(3)} = ${sweep.toFixed(3)}× = `
        + `${(12 * Math.log2(sweep)).toFixed(2)} semitones, unity abeam at ${abeam.toFixed(1)} s · `
        + `listener at 20 m/s ×${running.toFixed(3)}`;
    } finally { restore(was); }
  });

  check('deck audio: distance is a filter, and the field is a filter', () => {
    /**
     * The other half of a pass, and the half that does most of the work. A far
     * ship is not a near ship turned down — air eats the top end, and the
     * reason distance SOUNDS like distance is that the treble goes with it.
     *
     * And a ship on the far side of the field is heard through a pressure
     * boundary, which is the same statement made about a source instead of
     * about the room. It is also `HANGAR-SPEC`'s "pop" with no code for a pop:
     * a ship crossing the field gets brighter and louder in one step.
     */
    const air = (d) => REPULSOR.top * Math.exp(-d / REPULSOR.fall);
    assert(air(20) > 12000 && air(120) < 5000,
      `air absorption puts 20 m at ${air(20).toFixed(0)} Hz and 120 m at ${air(120).toFixed(0)} — one of `
      + 'those is not a distance');
    assert(REPULSOR.through < 0.8 && REPULSOR.throughGain < 0.8,
      'a ship outside the field sounds exactly like one inside it');
    const inside = renderCue((w, st, ctx) => {
      const s = repulsorPass(w, { from: new THREE.Vector3(-40, 6, 20), to: new THREE.Vector3(40, 6, 20),
        speed: 30, power: 1, gain: 2.0, spin: false });
      for (let i = 0; i < 90; i++) { stepDeckAudio(w, 1 / 60, cam(0, 1.7, -34)); ctx.currentTime += 1 / 60; }
      ctx.currentTime = 0;
      return s;
    }, 1.5);
    const outside = renderCue((w, st, ctx) => {
      const s = repulsorPass(w, { from: new THREE.Vector3(-40, 6, 20), to: new THREE.Vector3(40, 6, 20),
        speed: 30, power: 1, gain: 2.0, spin: false, outside: true });
      for (let i = 0; i < 90; i++) { stepDeckAudio(w, 1 / 60, cam(0, 1.7, -34)); ctx.currentTime += 1 / 60; }
      ctx.currentTime = 0;
      return s;
    }, 1.5);
    assert(outside.r < inside.r * 0.8,
      `the same pass measures ${outside.r.toFixed(5)} through the field and ${inside.r.toFixed(5)} inside it — `
      + 'the boundary is not doing anything to it');
    return `air 20 m ${air(20).toFixed(0)} Hz → 120 m ${air(120).toFixed(0)} Hz · `
      + `through the field ${(20 * Math.log10(outside.r / inside.r)).toFixed(1)} dB`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  THE PERIPHERY AND THE MENU                                        */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck audio: a vent lets go, and the four cues are four different events', () => {
    /**
     * `audio.noise()`'s envelope is attack-then-decay and a pressure release is
     * attack, HOLD, then fall — the hold is the whole character. And the four
     * customisation cues are the sounds a player triggers most often, so each
     * one is the sound of its own action rather than a UI blip: a wash, a part
     * seating, a part coming away, and a datapad taking an entry.
     *
     * MEASURED ON THE SIGNATURE, in the shape `audio.mjs` established: two
     * cues that render to the same band profile are, to a listener, the same
     * sound, however different their source is.
     */
    const v = renderCue((w) => ventBurst(w, [4, 1.4, -30], { dur: 1.4 }), 3);
    assert(v.voices === 1, `a vent burst cost ${v.voices} voices for three layers`);
    assert((v.b['800-3k'] + v.b['3k-12k']) / v.b.total > 0.6,
      `only ${(100 * (v.b['800-3k'] + v.b['3k-12k']) / v.b.total).toFixed(0)}% of a steam vent is over 800 Hz`);

    const cues = {
      paint: renderCue((w) => cuePaint(w), 1.2),
      attach: renderCue((w) => cueAttach(w), 1.2),
      detach: renderCue((w) => cueDetach(w), 1.2),
      name: renderCue((w) => cueName(w), 1.2),
    };
    const sig = {};
    for (const [k, r] of Object.entries(cues)) {
      assert(r.voices === 1, `the ${k} cue cost ${r.voices} voices`);
      /* THE DEFECT THIS RENDER FOUND. A GainNode is born at 1 and holds that
       * until its first scheduled event, so a layer whose envelope opens 25 ms
       * in plays at UNITY for 25 ms. Three of these four peaked over 1.0
       * against envelopes that never ask for more than 0.07. */
      assert(r.pk < 0.30,
        `the ${k} cue peaks at ${r.pk.toFixed(3)} against layer gains under 0.08 — a gain node whose `
        + 'envelope opens late plays at unity until it does, which is a click and then a bare oscillator');
      assert(r.pk > 0.005, `the ${k} cue delivers ${r.pk.toFixed(4)} — nobody would feel that`);
      sig[k] = BANDS.map(([n]) => Math.round(20 * r.b[n] / Math.max(r.b.total, 1e-18))).join('/');
    }
    const seen = new Set(Object.values(sig));
    assert(seen.size === 4,
      `the four customisation cues render to ${seen.size} distinct band profiles (${Object.entries(sig)
        .map(([k, s]) => `${k} ${s}`).join(', ')}) — a menu where a paint job and a pauldron click the `
      + 'same way is a menu, not a hangar');
    /* AND THE PAINT IS A SWEEP. "Paint applies as a wash moving over the
     * armour, not a pop" — so it is the one cue with a length you can hear. */
    assert(cues.paint.r * 1.2 > cues.name.r,
      'the paint cue carries less energy than the datapad blip — it is supposed to be a wash across a plate');
    return `vent ${share(v.b)} · ${Object.entries(sig).map(([k, s]) => `${k} ${s}`).join(' · ')}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  THE THINGS THAT MUST NOT HAPPEN                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck audio: it is silent and safe with no audio context at all', () => {
    /**
     * EVERY CHECK IN THIS REPOSITORY RUNS WITH NO `AudioContext`.
     * `tools/dom-shim.mjs` defines no audio of any kind, so `audio.init()`
     * returns at `if (!AC) return;` and `ready` stays false for the process.
     * A deck dressed there has a state object and no nodes, and it has to
     * step, thump, muster and tear down exactly like a live one.
     *
     * Driven against the SINGLETON in its shipped headless state rather than
     * against a stub, because a stub is a second opinion about what headless
     * means.
     */
    assert(!audio.ready && !audio.ctx,
      'the audio singleton has a live context in the test process — this check is measuring nothing');
    const terrain = { surfaceAt: () => 'metal' };
    const world = { terrain, settings: {} };
    const st = dressDeckAudio(world);
    assert(st && !st.ctx, 'dressing a deck with no context built a graph');
    for (let i = 0; i < 1800; i++) stepDeckAudio(world, 1 / 60, cam(0, 1.7, -34 + i * 0.05));
    hullThump(world, 1);
    hullThump(world, 1, { range: 4000 });
    paCall(world); ventBurst(world, [0, 1, 0]);
    bootFall(world, { x: 0, y: 0, z: -12 }); bootHalt(world, { x: 0, y: 0, z: -12 }, 10);
    repulsorPass(world, { from: new THREE.Vector3(-40, 6, 20), to: new THREE.Vector3(40, 6, 20), speed: 30 });
    cuePaint(world); cueAttach(world); cueDetach(world); cueName(world);
    undressDeckAudio(world);
    assert(!world._deckAudio, 'undressing left the state behind');
    assert(terrain.surfaceAt(0, 63) === 'metal', 'undressing left the deck materials behind');
    /* AND TWICE IS NOT TWO DECKS. `dress` is idempotent and `undress` is safe
     * on a world that was never dressed — `World._loadSteps` can re-enter. */
    const again = dressDeckAudio(world);
    assert(dressDeckAudio(world) === again, 'dressing twice built two decks');
    undressDeckAudio(world);
    undressDeckAudio(world);
    undressDeckAudio({});
    return '30 s stepped, every cue fired, torn down twice — no context, no nodes, no throw';
  });

  check('deck audio: unloading the level takes the bed with it', () => {
    /**
     * ══ THE JETPACK DEFECT, ONE LEVEL UP ══════════════════════════════════
     *
     * `audio: a dead jet trooper stops making a noise` measures what a
     * continuous voice with a manually managed lifetime costs when the release
     * cannot arrive: six live panners at the spots six troopers fell, six of
     * the world band's thirty voices gone, and a seventh trooper 1.7 m away
     * getting nothing because the cap is full of corpses.
     *
     * A level's own bed is the same shape and worse, because it is not keyed
     * on anything and nothing in `World.unload` knows it exists:
     * `setAmbience({wind:0, drone:0})` reaches the SHARED bed and this is not
     * it. So the teardown is registered with `audio.hold`, which `stopLoops()`
     * — already called by `World.unload` — drains.
     *
     * Driven through `stopLoops` and not through `undressDeckAudio`, because
     * `stopLoops` is the call the game actually makes.
     */
    const { ctx, was } = boot();
    try {
      const world = { terrain: null, settings: {} };
      const st = dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
      assert(st.ctx, 'the bed did not build on a live context');
      const before = ctx.render(st.out, 1.5);
      assert(peak(before) > 0.01, `a live deck bed measures ${peak(before).toFixed(4)} — it is not playing`);
      /* A held pass as well, because that is the other thing with a lifetime. */
      repulsorPass(world, { from: new THREE.Vector3(-40, 6, 20), to: new THREE.Vector3(40, 6, 20), speed: 30, gain: 2 });
      const held = audio.voices;
      assert(held >= 1, 'a held pass took no voice');

      audio.stopLoops();
      /* The teardown ramps rather than cutting — a graph unplugged at whatever
       * amplitude it was at is a click — so the silence is measured after it. */
      const after = ctx.render(st.out, 3);
      const tail = rms(after, ctx.sampleRate, 1.5, 3);
      assert(tail < 1e-4, `the deck bed is still playing at ${tail.toFixed(6)} RMS after World.unload's stopLoops()`);
      assert(audio.reverbSend.gain.last('tgt') !== PRESSURE.send,
        'the convolver send was left at the lip\'s 0.05 — `setRoom` only writes on a load, so nothing '
        + 'would ever put it back and the next level would play in the flight deck\'s dead room');
      /* …and a second drain is not a second teardown. */
      audio.stopLoops();
      return `bed ${peak(before).toFixed(3)} peak → ${tail.toExponential(1)} RMS after stopLoops, `
        + `send restored to ${audio.reverbSend.gain.last('tgt').toFixed(3)}`;
    } finally { restore(was); }
  });

  check('deck audio: twenty minutes on the deck does not fill the voice pool', () => {
    /**
     * The pool is 44 voices banded at 15 / 30 / 39 / 44, and a leak of one a
     * minute is a game that goes silent in three quarters of an hour with
     * nothing in the console. Everything this file schedules — announcements,
     * vents, thumps, traffic — is on a timer, so a deck left alone is exactly
     * the shape that finds it.
     *
     * Thirty simulated minutes, with the audio clock advanced so the sounds
     * actually END, and the pool has to come back to where it started.
     */
    const { ctx, was } = boot();
    try {
      const world = { terrain: null, settings: {} };
      dressDeckAudio(world, { seed: 7 });
      const v0 = audio.voices;
      const dt = 1 / 30;
      for (let i = 0; i < 20 * 60 * 30; i++) {
        stepDeckAudio(world, dt, cam(0, 1.7, -34 + 30 * Math.sin(i * 0.0007)));
        ctx.currentTime += dt;
        /* `ended` is what returns a voice, and it fires on the audio clock —
         * which only moves because the renderer is asked to. Rendering one
         * block a frame is the cheapest way to keep that clock honest. */
        if ((i & 31) === 0) ctx.render(audio.master, ctx.block / ctx.sampleRate);
      }
      const leaked = audio.voices - v0;
      assert(leaked <= 1,
        `${leaked} voices are still held after twenty minutes on an empty deck — a pool of `
        + `${audio.maxVoices} leaking at this rate is a silent game and nothing in the console`);
      assert(audio.stats.threw === 0, `${audio.stats.threw} sounds threw on the way to a param`);
      assert(audio.stats.alloc > 40, `only ${audio.stats.alloc} sounds in twenty minutes — the deck is dead`);
      undressDeckAudio(world);
      return `${audio.stats.alloc} sounds over 20 min · ${leaked} voices held · ${audio.stats.threw} throws · `
        + `${audio.stats.denied} refused by the band caps`;
    } finally { restore(was); }
  });
}
