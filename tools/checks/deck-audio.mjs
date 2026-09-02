/**
 * BATTLEFRONT BORZ — THE FLIGHT DECK, HEARD.
 *
 * Nothing in `src/game/DeckAudio.js` draws anything, so `tools/shot.mjs` has no
 * opinion about any of it and none of the twelve suites that rasterise a scene
 * can say whether it is working. This file is the whole of the evidence, and it
 * asks its questions three ways on purpose:
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
 *   AND WHERE IS IT — new, and it is the one whose absence cost the most.
 *     Every emitter this file places is fired at the REAL ROOM: a hangar world
 *     booted through `bootWorld`, with rays out of every horn and every vent
 *     asking what is within reach of it, and the shipped `hangardeck` ground
 *     asked whether there is deck under it.
 *
 * ── WHY THE THIRD ONE EXISTS, WHICH IS THE WHOLE STORY OF THIS FILE ───────
 *
 * This suite used to build its world as `{ terrain: null, settings: {} }` and
 * type the player's spawn as `-34` in thirteen places while reading the LIVE
 * `DECK.lip` everywhere else. So it was measuring a room that was half current
 * and half remembered, and it could not see geometry at all.
 *
 * `d1e3a92` then doubled the hangar — aft −46 → −104, lip 64 → 144, spawn
 * −34 → −74, the ground 128 m → 288 — and this suite stayed green through all
 * of it while:
 *
 *   the two bulkhead PA horns hung in open space 60 m forward of the bulkhead,
 *     with nothing inside 40 m of them but the deck 9.5 m below;
 *   three of the four coolant vents hissed over the 3.2 m pit `hangardeck`
 *     cuts into the deck around x = −52;
 *   `deckSurfaceAt` reported a patch of open steel grating over half of that
 *     same pit, on the footprint of a gantry the same commit deleted;
 *   and the "outside the field" traffic lane at z = 96…138 — outside a lip of
 *     64, the front third of a room whose lip is 144 — flew repulsorlifts
 *     through the hangar at 14–34 m altitude, filtered as though there were a
 *     shield between them and the player.
 *
 * Seventeen checks, all green, on four emitters in the wrong room. THE ROOT
 * CAUSE IS HERE AND NOT THERE: a check that cannot see the room cannot report
 * that the room moved, and coordinates in the file under test will drift again
 * the moment they are allowed to. So every number below is derived from `DECK`
 * or measured against the built scene, and there is no literal position in this
 * file at all.
 */

import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { audio, PRIO } from '../../src/engine/Audio.js';
import {
  DECK_BED, PRESSURE, PA_VOICE, BOOT, REPULSOR, GEOM, CHANT, LAUNCH, ARRIVE, STRIDE,
  dressDeckAudio, stepDeckAudio, undressDeckAudio, deckSurfaceAt, edgeOf, pressureAt,
  hullThump, drainBlasts, paCall, ventBurst, bootFall, bootHalt, bootStride, repulsorPass,
  deckChant, launchSequence, damagedArrival,
  cuePaint, cueAttach, cueDetach, cueName,
} from '../../src/game/DeckAudio.js';
import { DECK, DECK_ZONES, MUSTER, markFor } from '../../src/game/Hangar.js';
import { TERRAIN_PRESETS } from '../../src/world/Terrain.js';
import { ground } from '../../src/world/Scenery.js';
import { OfflineCtx, bands, rms, dB, BANDS } from './_offline-audio.mjs';
import { clocked } from './_shared.mjs';

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE ROOM, AS THIS FILE IS ALLOWED TO REFER TO IT                      */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * FOUR NAMES AND NO NUMBERS. Everything below asks for a place by what it IS —
 * where the player is put down, the middle of the room, a fraction of the way
 * forward — and never by where that happened to be. Thirteen occurrences of a
 * literal `-34` are what let a doubled room go unmeasured, so the rule is
 * absolute: nothing in this file is a coordinate.
 */
const DEPTH = () => DECK.lip - DECK.aft;
const ALONG = (f) => DECK.aft + DEPTH() * f;
/** Where the player stands when the level opens. `Hangar.DECK.start`. */
const EAR = () => DECK.start.z;
/** How long sound takes to cross from the muster line to the ear. */
const FLIGHT = () => Math.abs(EAR() - DECK.line) / 343;

/**
 * THE GROUND THE DECK IS ACTUALLY BUILT ON, which is not `null`.
 *
 * A `Terrain` instance costs a six-second world boot, and the render fixtures
 * below want one twenty times. What they need of it is the two methods
 * `DeckAudio` calls — `height`, which is how a vent finds out whether there is
 * deck under it, and `surfaceAt`, which is the prototype method the deck's
 * materials stand in front of — so they get the SHIPPED preset's own height
 * function behind them rather than a stub that answers nothing.
 *
 * `deck audio: every emitter has something to be bolted to` boots the real
 * world and asserts this is the same ground it loaded, so the shortcut cannot
 * become a second opinion about where the pit is.
 */
function deckTerrain() {
  const P = TERRAIN_PRESETS.hangardeck;
  return {
    preset: P,
    height(x, z) { return P.height(x, z); },
    /* What `Terrain.surfaceAt` returns on a flat preset, verbatim: one keyword
     * for every square metre, which is the thing `deckSurfaceAt` exists to
     * replace and the thing `undress` has to put back. */
    surfaceAt() { return 'metal'; },
  };
}
const fixture = () => ({ terrain: deckTerrain(), settings: {} });

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
  audio._listenerPos.set(0, 1.7, EAR());
  ctx.setListener(0, 1.7, EAR());
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
    const world = fixture();
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
function renderCue(fn, seconds = 2.5, at = null) {
  const p = at || [0, 1.7, EAR()];
  const { ctx, was } = boot();
  try {
    const world = fixture();
    const st = dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
    audio._listenerPos.set(p[0], p[1], p[2]);
    ctx.setListener(p[0], p[1], p[2]);
    stepDeckAudio(world, 1 / 60, cam(p[0], p[1], p[2]));
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

/**
 * ══ A SEQUENCE, DRIVEN AND RECORDED ═══════════════════════════════════════
 *
 * `renderCue` cannot see a launch, and the reason is worth writing down: a
 * launch is four events over eight seconds held on the deck's own clock, and
 * `OfflineCtx.render` renders forward FROM the clock. Firing the sequence and
 * then rendering two seconds measures the first beat of it and nothing else.
 *
 * So this steps the world and renders ONE FRAME AT A TIME, concatenating — the
 * audio clock and the deck's clock advance together, which is what they do in
 * a browser and what nothing else in this file needed. It also records the
 * voice allocation count per frame, so the SCHEDULE is measured as well as the
 * sound: when each beat was asked for is a fact about the sequence and the
 * band it came out in is a different one.
 */
function renderDriven(fn, seconds, at = null) {
  const p = at || [0, 1.7, EAR()];
  const { ctx, was } = boot();
  try {
    const world = fixture();
    const st = dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
    audio._listenerPos.set(p[0], p[1], p[2]);
    ctx.setListener(p[0], p[1], p[2]);
    st.chain.disconnect();
    const probe = ctx.createGain();
    probe.connect(audio.ambBus);
    st.chain = probe;
    st.out.disconnect();
    st.out.connect(audio.ambBus);
    const v0 = audio.stats.alloc;
    let last = v0;
    fn(world, st, ctx);
    const frames = Math.ceil(seconds * 60);
    const step = 1 / 60;
    const out = new Float32Array(Math.ceil(seconds * ctx.sampleRate));
    const fired = [];
    /* THE FIRST BEAT HAPPENS BEFORE THE FIRST FRAME. A launch's clamps let go
     * on the call, not on a cue, so a recorder that started counting after
     * `fn` had run reported a four-beat sequence as three and could never
     * have caught the one beat that is not on the deck's clock. */
    if (audio.stats.alloc !== last) { fired.push({ t: 0, n: audio.stats.alloc - last }); last = audio.stats.alloc; }
    let n = 0;
    for (let i = 0; i < frames; i++) {
      stepDeckAudio(world, step, cam(p[0], p[1], p[2]));
      if (audio.stats.alloc !== last) { fired.push({ t: i / 60, n: audio.stats.alloc - last }); last = audio.stats.alloc; }
      const blk = ctx.render(audio.comp, step);
      for (let k = 0; k < blk.length && n < out.length; k++) out[n++] = blk[k];
    }
    return { buf: out, ctx, fired, voices: audio.stats.alloc - v0,
      b: bands(out, ctx.sampleRate, 0, seconds), r: rms(out, ctx.sampleRate, 0, seconds), pk: peak(out) };
  } finally { restore(was); }
}

/** RMS in 25 ms windows — the shape of a sequence over time. */
function envelope(buf, rate, win = 0.025) {
  const n = Math.floor(win * rate);
  const out = [];
  for (let i = 0; i + n <= buf.length; i += n) {
    let s = 0;
    for (let k = 0; k < n; k++) s += buf[i + k] * buf[i + k];
    out.push(Math.sqrt(s / n));
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE REAL ROOM, BOOTED ONCE                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE INSTRUMENT THAT WAS MISSING ═══════════════════════════════════════
 *
 * A hangar world, through the same door the game uses, with the deck dressed
 * by the level's own `dress` — so the horns and the vents under test are the
 * ones a player would hear and not a second derivation written here.
 *
 * Then RAYS. Twenty-six bearings out of every emitter, against every visible
 * mesh in the room, and the nearest hit is how far that sound is from anything
 * it could be bolted to. A bounding box cannot answer this — `hangar.mjs`
 * records what happened when it tried, a merged room whose box was the whole
 * room — and a bounding box is what a check would reach for.
 *
 * Booted ONCE and unloaded before anything else runs, because a loaded world
 * holds the `ground` singleton and every suite after this one shares it.
 */
let _survey = null;
async function survey() {
  if (_survey) return _survey;
  const { bootWorld } = await import('./_coop.mjs');
  const { world } = await bootWorld({
    level: 'hangar',
    settings: { mode: 'hangar', level: 'hangar', allies: 0 },
  });
  try {
    const st = world._deckAudio;
    const solid = [];
    world.scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (o.material?.userData?.saberNoInk) return;      // the field
      if (o.name === 'field-rim') return;                 // its frame
      let on = o.visible;
      for (let p = o.parent; on && p; p = p.parent) on = p.visible;
      if (!on) return;
      solid.push(o);
    });
    const dirs = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      if (a || b || c) dirs.push(new THREE.Vector3(a, b, c).normalize());
    }
    const ray = new THREE.Raycaster();
    const from = new THREE.Vector3();
    const nearest = (x, y, z, far) => {
      let best = Infinity;
      from.set(x, y, z);
      for (const d of dirs) {
        ray.set(from, d); ray.far = far;
        const h = ray.intersectObjects(solid, false)[0];
        if (h && h.distance < best) best = h.distance;
      }
      return best;
    };
    const terrain = world.terrain;
    const P = TERRAIN_PRESETS.hangardeck;
    /* THE SHORTCUT ABOVE, CHECKED. Every render fixture in this file stands on
     * `TERRAIN_PRESETS.hangardeck.height`; this is the world saying that is the
     * ground it loaded. Sampled rather than compared by identity, because a
     * `Terrain` interpolates a heightfield off the preset and the two are only
     * ever equal to within a cell. */
    const drift = [];
    for (const [x, z] of [[0, 0], [-DECK.lip * GEOM.rack, ALONG(0.4)],
      [DECK.lip * 0.5, ALONG(0.8)], [-DECK.lip * 0.36, ALONG(0.45)]]) {
      drift.push(Math.abs((terrain.height(x, z) ?? 0) - P.height(x, z)));
    }

    const horns = (st?.horns || []).map((h) => ({ at: h, d: nearest(h[0], h[1], h[2], 40) }));
    const vents = (st?.ventSites || []).map((v) => ({
      at: v.at, d: nearest(v.at[0], v.at[1], v.at[2], 20), h: terrain.height(v.at[0], v.at[2]),
    }));
    /* AND WHAT `deckSurfaceAt` CLAIMS, against what is under it. A material is
     * a promise about a surface; the pit is a hole in that surface and it is
     * free to move, so every zone is asked. */
    const zones = new Map();
    let worst = { d: 0, at: null, s: '' };
    for (let x = -DECK.lip + 1; x <= DECK.lip - 1; x += 3) {
      for (let z = DECK.aft + 1; z <= DECK.lip - 1; z += 3) {
        const s = terrain.surfaceAt(x, z);
        zones.set(s, (zones.get(s) | 0) + 1);
        if (s === 'plate') continue;                    // the pit floor is plate, and it is floor
        const h = terrain.height(x, z);
        if (-h > worst.d) worst = { d: -h, at: [x, z], s };
      }
    }
    _survey = { horns, vents, zones, worst, solid: solid.length, drift: Math.max(...drift) };
    return _survey;
  } finally { world.unload(); }
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
    const open = renderBed(EAR());
    const lip = renderBed(DECK.lip - 1.5);

    assert(dB(lip.b['800-3k'], open.b['800-3k']) < -12,
      `the 800 Hz–3 kHz band only falls ${dB(lip.b['800-3k'], open.b['800-3k']).toFixed(1)} dB between the `
      + 'spawn and the lip — the pressure differential is the single most convincing '
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
    /* AND THE PLAYER'S OWN SPAWN IS IN THE OPEN. A transition band that has
     * grown to reach where he is put down is a room that opens hushed. */
    assert(pressureAt(0, EAR()) < 0.02,
      `the room is ${(100 * pressureAt(0, EAR())).toFixed(0)}% hushed where the player is put down`);
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
  /*  WHERE EVERYTHING IS                                               */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck audio: every emitter has something to be bolted to', async () => {
    /**
     * ══ THE CHECK WHOSE ABSENCE CAUSED THE WHOLE CLASS ═══════════════════
     *
     * `HORNS` said the PA was "high on the bulkhead and out on the two inboard
     * spars, so the PA has a PLACE — which is what makes it get quieter and
     * duller as the player walks away from the ship". Every word of that is an
     * argument about geometry, and there was no check anywhere in this
     * repository that could read geometry, so when the room doubled the
     * argument became false and the file went on making it.
     *
     * A panner still attenuates a horn hanging in mid-air. That is what makes
     * this failure quiet and what makes it worth a check: the sound is not
     * missing and it is not obviously wrong, it is simply coming from
     * somewhere there is nothing — and the ear is being told a wall is 60 m
     * from where the wall is.
     *
     * SO: rays, out of every emitter, into the room the game actually builds.
     * A horn must be within a few metres of structure. A vent must be within a
     * few metres of something AND have deck under it — the second half is a
     * question for the ground and not for the scene, because the pit is
     * terrain and no dressing pass knows it is there.
     */
    const s = await survey();
    assert(s.horns.length >= 4, `the deck dressed ${s.horns.length} PA horns`);
    assert(s.vents.length >= 3, `the deck dressed ${s.vents.length} vents`);
    assert(s.drift < 1.5,
      `the world's ground and TERRAIN_PRESETS.hangardeck disagree by ${s.drift.toFixed(2)} m — the `
      + 'render fixtures in this file are standing on a different deck from the one the game loads');

    const REACH = 5;
    for (const h of s.horns) {
      const [x, y, z] = h.at;
      /* HIGH ENOUGH THAT THE DECK CANNOT BE WHAT IT FOUND. Without this the
       * whole test passes on a horn lying on the floor. */
      assert(y > REACH * 1.6,
        `a horn hangs at ${y.toFixed(1)} m — low enough that the deck under it satisfies this check `
        + 'and the wall it is supposed to be on does not have to exist');
      assert(h.d < REACH,
        `the horn at ${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(0)} has nothing within `
        + `${Number.isFinite(h.d) ? `${h.d.toFixed(0)} m` : '40 m'} of it in any of 26 directions — a `
        + 'tannoy in open space is quieter with distance the way a tannoy on a wall is, so this is '
        + 'silent, and it tells the ear there is a wall where there is none');
    }
    for (const v of s.vents) {
      const [x, y, z] = v.at;
      assert(Math.abs(v.h) < 1.0,
        `the vent at ${x.toFixed(0)}, ${z.toFixed(0)} stands over ground ${v.h.toFixed(1)} m off the `
        + 'deck plane — a coolant line letting go above a hole in the floor');
      assert(v.d < REACH * 1.6,
        `the vent at ${x.toFixed(0)}, ${z.toFixed(0)} has nothing within `
        + `${Number.isFinite(v.d) ? `${v.d.toFixed(0)} m` : '20 m'} of it — steam escaping from no pipe`);
    }
    const hd = s.horns.map((h) => h.d.toFixed(1)).join('/');
    const vd = s.vents.map((v) => v.d.toFixed(1)).join('/');
    return `${s.solid} solid objects · horns ${hd} m from structure · vents ${vd} m, ground `
      + `${s.vents.map((v) => v.h.toFixed(2)).join('/')} m`;
  });

  check('deck audio: nothing the deck calls a surface has a hole under it', async () => {
    /**
     * `deckSurfaceAt` is a PURE FUNCTION OF (x, z) installed in front of the
     * terrain's own, and that is the right shape — one footstep system, four
     * readers, no flags — but it means it cannot see the ground it is naming.
     * It used to name a patch of open steel grating on the footprint of a
     * gantry that had been deleted, half of it over the 3.2 m pit
     * `hangardeck.height` cuts into the deck.
     *
     * So every zone it reports that is not plain plate is asked what is under
     * it. Plate is exempt and that is deliberate: the floor of the pit is a
     * floor, and a player who walks down into it is standing on deck plate. A
     * WALKWAY over a hole is the failure; a hole with a floor in it is not.
     */
    const s = await survey();
    assert((s.zones.get('grating') | 0) > 40,
      `the deck reports ${s.zones.get('grating') | 0} grating samples — the material change is gone`);
    assert((s.zones.get('lip') | 0) > 40, 'there is no lip band at all');
    assert(s.worst.d < 1.2,
      `the deck calls ${s.worst.at ? `${s.worst.at[0]}, ${s.worst.at[1]}` : 'a place'} '${s.worst.s}' and `
      + `the ground there is ${s.worst.d.toFixed(1)} m below the deck plane — that is a walkway over a `
      + 'hole, which is exactly what the deleted gantry patch became');
    return `${[...s.zones].map(([k, n]) => `${k} ${n}`).join(' · ')} · deepest ground under a named `
      + `surface ${s.worst.d.toFixed(2)} m`;
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
    const open = renderBed(EAR(), 6);
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
     * AND IT MUST NOT ALL HAPPEN AT THE EDGE. A deck whose only material
     * change is the ring at the lip is a deck the ear can navigate in exactly
     * one place. The walk from the doors to the field is required to cross at
     * least three CHANGES, which cannot be satisfied by a single band however
     * wide it is made.
     *
     * MEASURED THROUGH THE SHIPPED PATH — `audio.step`, the same call
     * `Player._footstep` makes — and rendered, because two rows in a table
     * proves nothing about two sounds. Eight steps each, averaged, because the
     * noise source starts at a random offset in a 2 s buffer.
     */
    const seen = new Set();
    const seq = [];
    for (let z = DECK.aft + 4; z < DECK.lip; z += 1.5) {
      const s = deckSurfaceAt(0, z);
      seen.add(s);
      if (seq[seq.length - 1] !== s) seq.push(s);
    }
    assert(seen.size >= 3,
      `walking straight out to the field crosses ${seen.size} material(s): ${[...seen].join(', ')}`);
    assert(seq.length >= 4,
      `the walk out crosses ${seq.length - 1} material CHANGES (${seq.join(' → ')}) — everything this `
      + 'deck has to say underfoot is being said in the last few metres');
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
    return `${seq.join(' → ')} · ${Object.entries(out).map(([k, v]) => `${k} ${v.c.toFixed(0)} Hz/${v.pk.toFixed(4)}`).join(' · ')}`;
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
    const proto = { surfaceAt() { return 'metal'; }, height() { return 0; } };
    const terrain = Object.create(proto);
    const world = { terrain, settings: {} };
    assert(terrain.surfaceAt(0, 60) === 'metal', 'the fixture is not shaped like a Terrain');
    dressDeckAudio(world);
    assert(terrain.surfaceAt(0, DECK.lip - 1) === 'lip', 'dressing the deck did not change what is underfoot');
    assert(terrain.surfaceAt(0, ALONG(0.5)) === 'plate', 'the middle of the deck is not plate');
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
      /* AT THE FOOT. `boot()` leaves the ear where the player is put down,
       * which is 77 m from a step at the origin — and `_reach` CULLS a
       * footfall at that range, so every signature came back as the
       * unknown-surface default and the check reported that the deck's
       * materials did not exist. A measurement of a timbre has to be taken
       * where the sound is audible. */
      audio._listenerPos.set(0, 1.7, 0); audio.ctx.setListener(0, 1.7, 0);
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
      const world = fixture();
      dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
      const v0 = audio.stats.alloc;
      for (let i = 0; i < 24; i++) bootFall(world, { x: i - 12, y: 0, z: DECK.line });
      ctx.currentTime += 0.1;
      stepDeckAudio(world, 0.1, cam(0, 1.7, EAR()));
      const used = audio.stats.alloc - v0;
      assert(used <= 3,
        `twenty-four men landing together took ${used} voices — the chatter band's whole ceiling is `
        + `${audio.bandCap(PRIO.chatter)} and the company would take the pool with it`);
      assert(used >= 1, 'twenty-four boots landing together made no sound at all');
      /* …AND THE WINDOW IS SHORTER THAN THE FLIGHT TIME OF THE SOUND IT IS
       * COALESCING, which is what makes it inaudible as latency. Off `DECK`,
       * so a room that grows keeps the argument and a room that shrinks
       * around the window says so. */
      assert(BOOT.window <= FLIGHT(),
        `the coalescing window is ${(BOOT.window * 1000).toFixed(0)} ms and the line is `
        + `${(FLIGHT() * 1000).toFixed(0)} ms of sound travel from where the player stands — the window `
        + 'is now audible as latency');
      /* A SECOND RANK, LATER, IS A SECOND SOUND. A window that never closed
       * would be a muster you hear once. */
      const v1 = audio.stats.alloc;
      for (let i = 0; i < 8; i++) bootFall(world, { x: i - 4, y: 0, z: DECK.line });
      ctx.currentTime += 0.1;
      stepDeckAudio(world, 0.1, cam(0, 1.7, EAR()));
      assert(audio.stats.alloc - v1 >= 1, 'the second rank to land made no sound — the window never closed');
      return `24 boots → ${used} voice(s) against a ${audio.bandCap(PRIO.chatter)} ceiling · `
        + `window ${(BOOT.window * 1000).toFixed(0)} ms under ${(FLIGHT() * 1000).toFixed(0)} ms of flight time`;
    } finally { restore(was); }
  });

  check('deck audio: the company walking in is heard, and costs almost nothing', () => {
    /**
     * ══ THE HALF OF THE MUSTER THAT HAD NO SOUND ═════════════════════════
     *
     * `bootFall` had no caller in `src/` at all — only this file — so
     * twenty-four men crossed the deck in total silence and the only thing
     * that ever sounded was the coalesced `bootHalt` at the end. "The filing
     * in sells it more than the standing" is the muster's own brief.
     *
     * `bootStride` is the answer and it is a distance integrator, not a gait:
     * `stepCompany` writes `fig.root.position` and has no leg cycle to hook,
     * so a boot lands every stride length of ground the man actually covers.
     *
     * DRIVEN AS THE ROOM WOULD DRIVE IT — twenty-four men walking from the
     * bulkhead doors to the muster line at the company's own march speed, on
     * their own start offsets and their own paces, one call a man a frame.
     * The two things that matter are both measured: they are AUDIBLE (a
     * company crossing a deck makes a sustained sound, not four ticks) and
     * they are CHEAP (the whole company must never take more of the pool than
     * a couple of voices at a time, whatever it is doing).
     */
    const { ctx, was } = boot();
    try {
      const world = fixture();
      dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
      /* THE REAL WALK. The company waits in the CROWD at the rack walls now
       * (`Hangar.crowdSpots` deals it the block at the starboard wall and
       * the clusters on both flanks, inside `DECK_ZONES.crowdL/crowdR`) and
       * walks from there to `markFor`'s marks, so the distance under test is
       * the distance it actually covers — sixty-odd metres for the far man,
       * which is `MUSTER.formUp`'s own stated reason. `MUSTER.door` was the
       * bulkhead doors, and the doors are a lift now. The pace is derived the
       * way `stepCompany`'s own note says it is ("the pace falls out of the
       * longest walk on the deck"), which lands on the same number as its
       * `MARCH_SPEED` without this file holding a second copy of it. */
      const N = 24;
      const men = [];
      const CL = DECK_ZONES.crowdL, CR = DECK_ZONES.crowdR;
      for (let i = 0; i < N; i++) {
        const mark = markFor(i, N, Math.floor(i / 5), Math.ceil(N / 5));
        men.push({
          id: i,
          from: (i % 2) ? { x: CR.x1 - 12, z: (CR.z0 + CR.z1) / 2 - 6 } : { x: CL.x0 + 14, z: CL.z1 - 12 },
          mark,
          start: 0.10 + (i % 3) * 0.18 + (i * 0.37 % 1) * 0.55,
          pace: 0.88 + (i * 0.61 % 1) * 0.26,
          pos: { x: 0, y: 0, z: 0 },
        });
      }
      const longest = Math.max(...men.map((m) => Math.hypot(m.mark.x - m.from.x, m.mark.z - m.from.z)));
      const march = longest / MUSTER.formUp;
      const v0 = audio.stats.alloc;
      let boots = 0, held = 0, t = 0;
      const dt = 1 / 60;
      for (let f = 0; f < 60 * 12; f++) {
        t += dt;
        for (const m of men) {
          const dist = Math.hypot(m.mark.x - m.from.x, m.mark.z - m.from.z);
          const span = Math.max(0.8, dist / march);
          const p = Math.min(1, Math.max(0, t - m.start) * m.pace / span);
          m.pos.x = m.from.x + (m.mark.x - m.from.x) * p;
          m.pos.z = m.from.z + (m.mark.z - m.from.z) * p;
          if (bootStride(world, m, m.pos, dt)) boots++;
        }
        ctx.currentTime += dt;
        stepDeckAudio(world, dt, cam(0, 1.7, EAR()));
        ctx.render(audio.master, ctx.block / ctx.sampleRate);
        held = Math.max(held, audio.voices);
      }
      const sounds = audio.stats.alloc - v0;
      assert(boots > N * (longest / STRIDE.run) * 0.6,
        `${N} men walking ${longest.toFixed(0)} m each put down ${boots} boots — that is not a walk, and a `
        + 'company that arrives in silence is the half of the muster the brief calls the good half');
      assert(sounds > 30,
        `the whole walk-on made ${sounds} sounds — the coalescing window has swallowed the march`);
      assert(sounds < boots * 0.5,
        `${boots} boots became ${sounds} sounds — the coalescing is not doing its job and the company `
        + `is going into a chatter band whose ceiling is ${audio.bandCap(PRIO.chatter)}`);
      assert(held <= audio.bandCap(PRIO.chatter),
        `the company held ${held} voices at once against a pool of ${audio.maxVoices}`);
      assert(audio.stats.denied === 0,
        `${audio.stats.denied} of the company's footfalls were refused by the band caps`);
      /* AND A MAN BEING PLACED IS NOT A MAN WALKING. The halt snaps him onto
       * his mark and the doors put him down from nowhere; either jump cashed
       * in as distance would be a rank of boots out of one frame. */
      const ghost = { id: 'x' };
      bootStride(world, ghost, { x: 0, y: 0, z: DECK.line });
      const v1 = audio.stats.alloc;
      bootStride(world, ghost, { x: 0, y: 0, z: DECK.line + STRIDE.jump * 3 }, dt);
      assert(audio.stats.alloc === v1, 'a man teleported across the deck put down a boot');
      return `${N} men over ${longest.toFixed(0)} m at ${march.toFixed(1)} m/s → ${boots} boots → `
        + `${sounds} sounds, ${held} voices held at the peak (cap ${audio.bandCap(PRIO.chatter)}) · `
        + `${audio.stats.denied} refused`;
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
  /*  THE TANNOY, AND THE MEN                                           */
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
      assert(r.pk > 0.005, `the ${name} PA delivers ${r.pk.toFixed(4)} from the wall it is on — nobody would hear it`);
      assert(r.pk < 0.25, `the ${name} PA delivers ${r.pk.toFixed(3)} — it is the loudest thing in the room`);
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

  check('deck audio: nothing in this room says anything, anywhere', () => {
    /**
     * "Idle chatter callouts on the PA, distant and UNINTELLIGIBLE." That is
     * the design: a tannoy a player can decode is a narrator, and a narrator
     * with twelve lines is exhausted in ten minutes. The same rule now covers
     * the company singing, and it is worth stating as a property of the WHOLE
     * MODULE rather than of one function: there is no sentence anywhere in
     * `DeckAudio.js` for anything to read out.
     *
     * The test is for a quoted string with a SPACE in it — a phrase. Single
     * words are unavoidable and harmless (`'sawtooth'`, `'bandpass'`,
     * `'separatist'`); what cannot be there is a line of speech, and a line of
     * speech has a space in it.
     *
     * AND THE SECOND PROPERTY IS STRUCTURAL. There are no consonants in the
     * synthesis: one buzz through two formant bandpasses is vowels and nothing
     * else, and vowels are where the voice is while consonants are where the
     * information is.
     */
    const src = readFileSync(new URL('../../src/game/DeckAudio.js', import.meta.url), 'utf8');
    /* Comments first — this file's prose is full of sentences and all of it is
     * for a reader, not a speaker. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const said = code.match(/'[A-Za-z][A-Za-z]* [A-Za-z][A-Za-z ,.'-]{4,}'|"[A-Za-z][A-Za-z]* [A-Za-z][A-Za-z ,.'-]{4,}"/g);
    assert(!said,
      `there is a phrase in DeckAudio.js (${(said || []).slice(0, 3).join(', ')}) — a PA with lines in `
      + 'it is a narrator, and a narrator with twelve lines is exhausted in ten minutes');
    /* AND NO TWO ANNOUNCEMENTS ARE THE SAME. Every one is planned from the
     * deck's own seeded stream, so the length, the pitches, the vowels and the
     * gaps all move; two identical plans in a row would be a loop. */
    const world = fixture();
    const st = dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
    const plans = new Set();
    for (let i = 0; i < 12; i++) {
      paCall(world);                                   // headless: plans, plays nothing
      plans.add(st.paPlan.map((s) => `${s.f.toFixed(1)}/${s.sy.toFixed(3)}`).join(','));
    }
    undressDeckAudio(world);
    assert(plans.size === 12, `twelve announcements produced ${plans.size} distinct plans`);
    return `no phrase anywhere in the module · 12 announcements, ${plans.size} distinct plans`;
  });

  check('deck audio: the company sings, and the two factions are two species', () => {
    /**
     * `HANGAR-SPEC`: "Troops sing/chant on command, faction-specific."
     *
     * A CHANT IS THE OPPOSITE OF THE PA AND THAT IS THE DESIGN. `paCall`
     * re-plans every announcement so no two are alike, because a tannoy a
     * player recognises is exhausted. A chant is nothing BUT repetition — a
     * figure said again and again is what makes a body of men one thing — so
     * the two are measured as opposites: the announcement must never repeat
     * and the chant must.
     *
     * AND THE TWO FACTIONS ARE MEN AND MACHINES, which is a bigger difference
     * than the PA's two horns and has to measure as one: the Republic row is
     * four detuned larynxes with a vibrato and a fall at the end of the
     * phrase, the Confederacy's is three near-identical square waves with no
     * vibrato, no fall, and twice the beat rate.
     */
    const rep = renderCue((w) => deckChant(w, 'republic', 12), 4);
    const cis = renderCue((w) => deckChant(w, 'separatist', 12), 4);
    /* The two bands the tables actually move: the men's fundamental survives a
     * 95 Hz horn and the droids' does not survive a 190 Hz one, and the men's
     * 2.3 kHz ceiling passes an octave the droids' 1.5 kHz one does not. */
    const low = (r) => r.b['60-200'] / r.b.total;
    const top = (r) => r.b['800-3k'] / r.b.total;
    for (const [name, r] of [['republic', rep], ['separatist', cis]]) {
      assert(r.voices === 1, `a ${name} chant cost ${r.voices} voices — a section is one sound`);
      assert(r.pk > 0.004, `the ${name} chant delivers ${r.pk.toFixed(4)} — nobody would hear it`);
      assert(r.pk < 0.30, `the ${name} chant peaks at ${r.pk.toFixed(3)} — it is the loudest thing in the room`);
    }
    /* THE SPREAD IS HOW MANY PEOPLE ARE IN THE ROOM. Four voices at zero
     * spread are one voice with a thick tone; it is the beating between them
     * that the ear counts. */
    assert(CHANT.republic.spread > CHANT.separatist.spread * 4,
      `men and droids are detuned by ${CHANT.republic.spread} and ${CHANT.separatist.spread} — a network `
      + 'talking to itself has no members, and if those two are the same number the factions are one asset');
    assert(CHANT.republic.vib > 0 && CHANT.separatist.vib === 0,
      'both factions sing with the same vibrato — a vibrato is a breath and nothing over there breathes');
    assert(CHANT.separatist.beat < CHANT.republic.beat * 0.8,
      'both factions chant at the same rate');
    assert(CHANT.republic.drop < 1 && CHANT.separatist.drop >= 1,
      'both factions end a phrase the same way — a fall at the end is a cadence and a machine has none');
    /* ── AND THE ROOM'S OWN ANSWER IS THE FALLBACK ────────────────────
     *
     * `deckOrder` fires `companySing?.(world, c.army, c.men.length)` through
     * `setCompanySing`, positionally — which is why this is a positional
     * function and why the two renders above are that call shape verbatim,
     * with no adapter between the seam and the sound for the two sides to
     * drift apart across.
     *
     * `c.army` is the ROLL's army and a player with no roll has none, so the
     * argument can arrive undefined. It must then fall to `_deckFaction`, the
     * one answer `dressHangar` resolves before anything is built — not to the
     * default, which is how a Separatist deck ends up with Republic men
     * singing on it. Driven with the argument missing. */
    const bare = renderCue((w) => {
      w._deckAudio.army = 'separatist';
      return deckChant(w, undefined, 12);
    }, 4);
    assert(top(bare) < top(rep) * 0.6,
      `a chant ordered with no army named came out at ${(100 * top(bare)).toFixed(1)}% above 800 Hz against `
      + `the Republic's ${(100 * top(rep)).toFixed(1)}% — it fell to the default rather than to the room's `
      + 'own faction, and one wrong-faction asset is the whole illusion');
    /* AND THE ROOM'S ANSWER IS `_deckFaction`, WHICH IS SET FIRST. `dress`
     * used to read `_company?.army` — undefined for a player with no roll,
     * and undefined at dress time for everybody, because the dressing runs
     * before the company is called. `_deckFaction` is resolved by
     * `dressHangar` before anything is built, and it has to win. */
    const w2 = { terrain: deckTerrain(), settings: { army: 'republic' },
      _deckFaction: 'separatist', _company: { army: 'republic' } };
    const s2 = dressDeckAudio(w2);
    assert(s2.army === 'separatist',
      `a deck built in Separatist colours took the '${s2.army}' PA and chant — the room has one faction `
      + 'answer and this is not reading it');
    undressDeckAudio(w2);
    /* AND THEY COME OUT IN DIFFERENT BANDS. Two tables that differ and one
     * sound that does not is the failure this catches, and it is measured on
     * the two bands the tables actually move: the men's fundamental survives a
     * 95 Hz horn and the droids' does not survive a 190 Hz one, and the men's
     * 2.3 kHz ceiling passes an octave the droids' 1.5 kHz one does not. */
    assert(low(rep) > low(cis) * 3,
      `the two chants put ${(100 * low(rep)).toFixed(1)}% and ${(100 * low(cis)).toFixed(1)}% of their energy `
      + 'in 60–200 Hz — a section of men has chests and a comm net does not');
    assert(top(rep) > top(cis) * 1.8,
      `the two chants put ${(100 * top(rep)).toFixed(1)}% and ${(100 * top(cis)).toFixed(1)}% above 800 Hz — `
      + 'they are one chant with a different pitch, and one wrong-faction asset is the whole illusion');
    /* IT REPEATS, which is what makes it a chant. Two halves of the same
     * performance have to measure alike where two announcements do not. */
    const half = Math.floor(rep.buf.length / 2);
    const a = bands(rep.buf.slice(0, half), rep.ctx.sampleRate, 0, 2);
    const b = bands(rep.buf.slice(half), rep.ctx.sampleRate, 0, 2);
    const same = Math.abs(dB(a['200-800'], b['200-800']));
    assert(same < 8,
      `the two halves of one chant differ by ${same.toFixed(1)} dB in the vocal band — a chant that never `
      + 'says the same thing twice is a crowd');
    return `republic ${share(rep.b)} @${rep.pk.toFixed(3)} · separatist ${share(cis.b)} @${cis.pk.toFixed(3)} `
      + `· one chant's halves within ${same.toFixed(1)} dB`;
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
    const world = fixture();
    dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
    let fired = -1;
    for (let i = 0; i < 240; i++) {
      if (i === 0) hullThump(world, 1, { delay: 1.4 });
      stepDeckAudio(world, 1 / 60, cam(0, 1.7, EAR()));
      if (fired < 0 && world._deckAudio.bloom > 0) fired = i / 60;
    }
    undressDeckAudio(world);
    assert(fired > 1.3 && fired < 1.5, `a thump held for 1.4 s arrived at ${fired.toFixed(2)} s`);
    return `${(100 * low).toFixed(0)}% under 200 Hz, peak ${t.pk.toFixed(3)} · a 1.4 s hold arrived at ${fired.toFixed(2)} s`;
  });

  check('deck audio: the thumps are the flashes the player actually saw', () => {
    /**
     * ══ TWO FEATURES THAT WERE ONE LINE APART ════════════════════════════
     *
     * `SkyDome._blasts` has published every detonation it draws since it was
     * written — `{ kind, strength, delay, at }` onto `ground.orbit.events`,
     * capped at 12 with the oldest dropped, and its own comment says "drain
     * it". NOTHING DRAINED IT. So the room thumped on `THUMP.gap`'s 9–34 s
     * timer instead, which is a perfectly good muffled thump that is
     * uncorrelated with every flash in the window — and the association is the
     * entire content of the effect. `HANGAR-SPEC` carried the bullet as done
     * with the words "Nothing drains it yet" underneath it.
     *
     * Driven through the shipped queue: events are pushed the way `SkyDome`
     * pushes them, `drainBlasts` is called the way `HangarDirector.update`
     * will call it, and the deck is stepped until they arrive.
     */
    const was = ground.orbit;
    const world = fixture();
    try {
      ground.orbit = { events: [] };
      dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
      assert(drainBlasts(world) === 0, 'an empty queue produced a thump');
      /* THE THREE SHAPES `SkyDome` ACTUALLY PUSHES: two detonations at the
       * strengths `_blasts` derives, and the capital ship breaking up. */
      ground.orbit.events.push({ kind: 'blast', strength: 0.55, delay: 0.9, at: 0 });
      ground.orbit.events.push({ kind: 'blast', strength: 1.40, delay: 2.1, at: 0 });
      ground.orbit.events.push({ kind: 'breakup', strength: 2.4, delay: 1.9, at: 0 });
      const n = drainBlasts(world);
      assert(n === 3, `three flashes produced ${n} thumps`);
      assert(ground.orbit.events.length === 0,
        `${ground.orbit.events.length} events were left on the queue — a queue that is drained by its `
        + 'cap is a queue that fires the wrong twelve');
      const at = [];
      for (let i = 0; i < 240; i++) {
        const before = world._deckAudio.bloom;
        stepDeckAudio(world, 1 / 60, cam(0, 1.7, EAR()));
        if (world._deckAudio.bloom > before + 1e-6) at.push(+(i / 60).toFixed(2));
      }
      assert(at.length === 3, `three drained flashes arrived as ${at.length} thumps`);
      assert(at[0] > 0.85 && at[0] < 0.95, `the 0.9 s flash arrived at ${at[0]} s`);
      assert(at[2] > 2.05 && at[2] < 2.15, `the 2.1 s flash arrived at ${at[2]} s`);
      /* AND THE DELAYS ARE THE PUBLISHED ONES, not re-rolled here. A consumer
       * that threw the delay away and rolled its own would be a thump that is
       * once again uncorrelated with the flash it came from. */
      assert(at[1] > 1.85 && at[1] < 1.95, `the breakup's 1.9 s arrived at ${at[1]} s`);
      /* A DECK THAT IS NOT DRESSED STILL EMPTIES IT. Twelve stale detonations
       * carried across a level change would all land in the first second of
       * the next visit, bound to nothing at all. */
      undressDeckAudio(world);
      ground.orbit.events.push({ kind: 'blast', strength: 1, delay: 1, at: 0 });
      drainBlasts(world);
      assert(ground.orbit.events.length === 0, 'an undressed deck left a stale flash on the queue');
      return `3 flashes → 3 thumps at ${at.join(', ')} s, on the delays SkyDome published`;
    } finally { undressDeckAudio(world); ground.orbit = was; }
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
     * oscillator, sampled through a real crossing driven frame by frame — not
     * on the ratio function, which could be right while nothing used it. The
     * crossing is stated in lips so the room can grow without turning a
     * measurement of a Doppler into a measurement of a fly-past that no longer
     * passes the player.
     */
    const { ctx, was } = boot();
    try {
      const world = fixture();
      dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
      audio._listenerPos.set(0, 1.7, EAR()); ctx.setListener(0, 1.7, EAR());
      const run = DECK.lip * 0.85;
      const slot = repulsorPass(world, {
        from: new THREE.Vector3(-run, DECK.roof * 0.2, EAR() + 44),
        to: new THREE.Vector3(run, DECK.roof * 0.2, EAR() + 44),
        speed: 34, power: 1, gain: 2.2,
      });
      assert(slot, 'a repulsorlift pass could not be opened at all');
      assert(audio.voices >= 1, 'a held pass took no voice from the pool');
      let hi = -Infinity, lo = Infinity, abeam = 0;
      const frames = Math.ceil((slot.dur + 0.5) * 60);
      for (let i = 0; i < frames; i++) {
        stepDeckAudio(world, 1 / 60, cam(0, 1.7, EAR()));
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
      const still = audio.dopplerRatio({ x: 0, y: 0, z: EAR() + 40 }, null);
      audio._listenerVel.set(0, 0, 20);
      const running = audio.dopplerRatio({ x: 0, y: 0, z: EAR() + 40 }, null);
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
    const cross = (outside) => renderCue((w, st, ctx) => {
      const s = repulsorPass(w, {
        from: new THREE.Vector3(-40, 6, EAR() + 30), to: new THREE.Vector3(40, 6, EAR() + 30),
        speed: 30, power: 1, gain: 2.0, spin: false, outside });
      for (let i = 0; i < 90; i++) { stepDeckAudio(w, 1 / 60, cam(0, 1.7, EAR())); ctx.currentTime += 1 / 60; }
      ctx.currentTime = 0;
      return s;
    }, 1.5);
    const inside = cross(false);
    const outside = cross(true);
    assert(outside.r < inside.r * 0.8,
      `the same pass measures ${outside.r.toFixed(5)} through the field and ${inside.r.toFixed(5)} inside it — `
      + 'the boundary is not doing anything to it');
    return `air 20 m ${air(20).toFixed(0)} Hz → 120 m ${air(120).toFixed(0)} Hz · `
      + `through the field ${(20 * Math.log10(outside.r / inside.r)).toFixed(1)} dB`;
  });

  check('deck audio: unattended traffic is outside the field, and stays there', () => {
    /**
     * ══ THE ONE THAT WAS SILENTLY BACKWARDS ══════════════════════════════
     *
     * Every scheduled pass is opened with `outside: true`, which halves its
     * cutoff and cuts its level to 0.45 on the argument that it is being heard
     * THROUGH the shield. The lane was written as `z: [96, 138]`, which was
     * outside a lip of 64 and is the front third of a room whose lip is 144 —
     * so the argument stopped being true and nothing said so. Repulsorlifts
     * crossing the hangar at 14–34 m altitude, muffled as if there were a
     * boundary between them and the player, with the boundary behind them.
     *
     * DRIVEN, not read: forty minutes of deck with only the traffic schedule
     * running, every pass the deck opens for itself caught as its slot goes
     * live, and every one of them SAMPLED ALONG ITS WHOLE PATH — because a
     * lane whose ends are outside and whose middle crosses the room is the
     * same defect with a different table.
     */
    const { ctx, was } = boot();
    try {
      const world = fixture();
      const st = dressDeckAudio(world, { pa: false, vents: false, battle: false, seed: 11 });
      const seen = [];
      const live = st.passes.map(() => false);
      let worst = Infinity, worstAt = null;
      const dt = 1 / 20;
      for (let i = 0; i < 40 * 60 * 20; i++) {
        stepDeckAudio(world, dt, cam(0, 1.7, EAR()));
        ctx.currentTime += dt;
        if ((i & 15) === 0) ctx.render(audio.master, ctx.block / ctx.sampleRate);
        for (let k = 0; k < st.passes.length; k++) {
          const p = st.passes[k];
          if (p.live && !live[k]) {
            seen.push({ from: p.from.clone(), to: p.to.clone() });
            /* Twenty-one samples along the path, ends included. */
            for (let u = 0; u <= 20; u++) {
              const q = p.from.clone().lerp(p.to, u / 20);
              const clear = Math.max(Math.abs(q.x), q.z) - DECK.lip;
              if (clear < worst) { worst = clear; worstAt = q; }
            }
          }
          live[k] = p.live;
        }
      }
      assert(seen.length >= 8,
        `forty minutes of deck opened ${seen.length} unattended passes — the schedule has stopped`);
      assert(worst > 0,
        `a scheduled "outside the field" pass came ${(-worst).toFixed(0)} m INSIDE the lip at `
        + `${worstAt ? `${worstAt.x.toFixed(0)}, ${worstAt.y.toFixed(0)}, ${worstAt.z.toFixed(0)}` : '?'} — `
        + 'it is being filtered as if there were a shield between it and the player and there is not');
      /* AND IT IS NOT SO FAR OUT THAT IT IS INAUDIBLE. A lane pushed to safety
       * is a schedule that costs voices and delivers nothing. */
      const far = seen.every((s) => Math.min(s.from.length(), s.to.length()) > DECK.lip * 4);
      assert(!far, 'every scheduled pass stays more than four lips away — nobody would ever hear one');
      /* BOTH BEARINGS, because the brief is field on three sides and a lane
       * that only ever crosses the aperture is a loop. */
      /* A FLANK PASS IS ONE THAT DOES NOT MOVE IN x. Both bearings start
       * outside the lip on the axis that matters, so "is it beyond the lip" is
       * true of every pass and says nothing about which way it went. */
      const flank = seen.filter((s) => Math.abs(s.from.x - s.to.x) < 1).length;
      assert(flank > 0 && flank < seen.length,
        `${flank} of ${seen.length} passes crossed a flank — the traffic is on one bearing`);
      return `${seen.length} passes over 40 min, ${flank} up a flank · the closest any of them came to `
        + `the lip was ${worst.toFixed(0)} m outside it`;
    } finally { restore(was); }
  });

  check('deck audio: a launch is four events in order, and an arrival is not one of them', () => {
    /**
     * `HANGAR-SPEC`: "Launches: clamps release, repulsor spin-up whine, taxi,
     * punch through" and "Arrivals with battle damage: smoke trail, hard
     * landing, fire crew sprinting in."
     *
     * THE SEQUENCE IS THE WHOLE THING. A launch played as one sound is a
     * whoosh; what makes the four-beat version read is that each beat explains
     * the next, so what is measured here is WHEN each beat was asked for and
     * not only what it sounded like. `renderDriven` steps the deck and the
     * audio clock together and records the frame every voice was allocated on,
     * which is the schedule as the room actually runs it.
     */
    /**
     * ── AND IT IS WATCHED FROM THE MIDDLE OF THE DECK, WHICH IS A FACT ──
     *
     * `Audio.MAX_RANGE` is 190 m and this room is 248 m deep, so a listener
     * standing where the player is put down is OUT OF RANGE of his own
     * aperture: the punch-through happens at the lip, 222 m away, and
     * `_reach` refuses it outright rather than making it faint. That is a
     * property of the engine and the room together and it is worth knowing
     * rather than working around — a launch is watched, and a player watching
     * one has walked out to see it. The ear is put in the middle of the deck,
     * which is where he would be.
     */
    const watch = [0, 1.7, ALONG(0.5)];
    const spool = LAUNCH.spool;
    const travel = (DECK.lip - ALONG(LAUNCH.from)) / LAUNCH.speed;
    const L = renderDriven((w) => launchSequence(w), spool + travel + 2.5, watch);
    assert(L.fired.length >= 3,
      `a launch asked for ${L.fired.length} sounds — clamps, lift and the field are three events at least`);
    assert(L.fired[0].t < 0.1, `the clamps did not let go until ${L.fired[0].t.toFixed(2)} s`);
    const lift = L.fired.find((f) => f.t > spool * 0.7 && f.t < spool * 1.4);
    assert(lift, `nothing was asked for anywhere near the ${spool.toFixed(2)} s spin-up`);
    const punch = L.fired.find((f) => f.t > spool + travel * 0.8);
    assert(punch, `nothing punched through the field, which should have happened at `
      + `${(spool + travel).toFixed(1)} s`);
    assert(L.voices <= 5, `a launch cost ${L.voices} voices`);
    assert(L.pk > 0.01, `a whole launch peaks at ${L.pk.toFixed(4)} — nobody would hear it`);

    /* THE ARRIVAL, and the thing that has to be true of it is that it is a
     * DIFFERENT SHAPE: a launch ends with the loudest event and an arrival
     * ends with something hitting the deck. */
    const aTravel = (DECK.lip * LAUNCH.out - ALONG(ARRIVE.at)) / ARRIVE.speed;
    const A = renderDriven((w) => damagedArrival(w), aTravel + 2.5, watch);
    assert(A.fired.length >= 4,
      `a damaged arrival asked for ${A.fired.length} sounds — the pass, the field, the misfire and the `
      + 'landing are four');
    const touch = A.fired.filter((f) => f.t > aTravel * 0.9);
    assert(touch.length >= 1, `nothing landed at the end of a ${aTravel.toFixed(1)} s approach`);
    const env = envelope(A.buf, A.ctx.sampleRate);
    /* THE LANDING IS THE LOUDEST MOMENT OF AN ARRIVAL, which is what "hard"
     * means and the one thing a smooth one would not do. */
    let at = 0, m = 0;
    for (let i = 0; i < env.length; i++) if (env[i] > m) { m = env[i]; at = i * 0.025; }
    assert(at > aTravel * 0.85,
      `the loudest moment of a hard landing is at ${at.toFixed(1)} s of a ${aTravel.toFixed(1)} s approach `
      + '— it came in loud and landed quietly, which is an overflight');
    /* MEASURED OVER THE LANDING AND NOT OVER THE ARRIVAL. The approach is
     * three seconds of repulsorlift whine and it is supposed to be bright; the
     * claim under test is about the second the ship touches, so that is the
     * second that is integrated. Asking the whole window would be asking
     * whether an arrival is mostly a landing, which it is not. */
    const lb = bands(A.buf, A.ctx.sampleRate, aTravel - 0.05, aTravel + 0.9);
    const low = (lb['20-60'] + lb['60-200']) / lb.total;
    assert(low > 0.35,
      `only ${(100 * low).toFixed(0)}% of the touchdown is under 200 Hz — a hundred tonnes arriving hard `
      + 'on plate is felt before it is heard');
    return `launch ${L.fired.map((f) => f.t.toFixed(1)).join('/')} s, ${L.voices} voices · arrival `
      + `${A.fired.map((f) => f.t.toFixed(1)).join('/')} s, loudest at ${at.toFixed(1)} of ${aTravel.toFixed(1)} s, `
      + `touchdown ${(100 * low).toFixed(0)}% under 200 Hz`;
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
    const v = renderCue((w) => ventBurst(w, [DECK.lip * 0.3, 1.4, ALONG(0.3)], { dur: 1.4 }), 3);
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

  check('deck audio: a graph that failed to build once is tried again', () => {
    /**
     * ══ A ROOM THAT GOES MUTE AND SAYS NOTHING ═══════════════════════════
     *
     * `buildGraph` was called once, from `dress`, and its return value was
     * thrown away. It returns false whenever there is no context — and that is
     * the ORDINARY case in a browser rather than an edge, because a page may
     * not open an `AudioContext` until a gesture has landed and a level load
     * can begin before the click that started it is delivered.
     *
     * One false there left `st.ctx` null for the whole visit. Every schedule
     * below went on ticking: the announcements came round, the vents let go,
     * the thumps drained, the passes were opened and refused — and every one
     * of them reached a no-op. A silent deck, a full state machine, and
     * nothing in the console.
     *
     * DRIVEN BY BREAKING IT THE WAY IT BREAKS: the bus `buildGraph` needs is
     * taken away, the deck is dressed and stepped, and then it comes back.
     */
    const { ctx, was } = boot();
    try {
      const bus = audio.ambBus;
      audio.ambBus = null;
      const world = fixture();
      const st = dressDeckAudio(world, { pa: false, vents: false, battle: false, traffic: false });
      assert(!st.ctx, 'the graph built with no bus to build onto — this check is measuring nothing');
      for (let i = 0; i < 120; i++) stepDeckAudio(world, 1 / 60, cam(0, 1.7, EAR()));
      assert(!st.ctx, 'the graph built itself while the bus was still missing');
      audio.ambBus = bus;
      /* One frame is not enough and must not be: a retry every frame is sixty
       * failed graph builds a second for as long as the page is silent. */
      for (let i = 0; i < 180; i++) stepDeckAudio(world, 1 / 60, cam(0, 1.7, EAR()));
      assert(st.ctx, 'the deck never tried again — the room is silent for the whole visit');
      assert(st.out, 'the deck re-armed without an output');
      const buf = ctx.render(st.out, 2);
      assert(peak(buf) > 0.01,
        `the re-armed bed measures ${peak(buf).toFixed(4)} — it built a graph and did not start it`);
      /* AND THE PRESSURE FILTER WROTE AGAINST THE NEW GRAPH. `st.p` is a
       * deadband, so a rebuild that left it where it was would leave the new
       * filters at 19 kHz until the player happened to move 12 m. */
      assert(st.p >= 0, 'the re-armed graph was never told where the player is standing');
      undressDeckAudio(world);
      return `silent for 2 s with no bus, re-armed within 3 s of it coming back, bed at ${peak(buf).toFixed(3)}`;
    } finally { restore(was); }
  });

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
     * means. Every entry point this module exports is fired, including the
     * ones that hold phases on the deck's own clock — a sequence that queued
     * four cues and then found no graph to play them on is the shape that
     * throws in a browser three seconds after the level loads.
     */
    assert(!audio.ready && !audio.ctx,
      'the audio singleton has a live context in the test process — this check is measuring nothing');
    const world = fixture();
    const terrain = world.terrain;
    const st = dressDeckAudio(world);
    assert(st && !st.ctx, 'dressing a deck with no context built a graph');
    assert(st.horns.length && st.ventSites.length,
      'a headless deck derived no emitters — the positions are built at dress and a browser gets the '
      + 'same ones');
    hullThump(world, 1);
    hullThump(world, 1, { range: 4000 });
    paCall(world); ventBurst(world, [0, 1, ALONG(0.5)]);
    deckChant(world, 'republic', 12);
    launchSequence(world); damagedArrival(world);
    drainBlasts(world);
    bootFall(world, { x: 0, y: 0, z: DECK.line });
    bootStride(world, terrain, { x: 0, y: 0, z: DECK.line });
    bootStride(world, terrain, { x: 0, y: 0, z: DECK.line + 2 }, 1 / 60);
    bootHalt(world, { x: 0, y: 0, z: DECK.line }, 10);
    repulsorPass(world, { from: new THREE.Vector3(-40, 6, 20), to: new THREE.Vector3(40, 6, 20), speed: 30 });
    cuePaint(world); cueAttach(world); cueDetach(world); cueName(world);
    for (let i = 0; i < 1800; i++) stepDeckAudio(world, 1 / 60, cam(0, 1.7, DECK.aft + i * 0.13));
    undressDeckAudio(world);
    assert(!world._deckAudio, 'undressing left the state behind');
    assert(terrain.surfaceAt(0, DECK.lip * 0.44) === 'metal', 'undressing left the deck materials behind');
    /* AND TWICE IS NOT TWO DECKS. `dress` is idempotent and `undress` is safe
     * on a world that was never dressed — `World._loadSteps` can re-enter. */
    const again = dressDeckAudio(world);
    assert(dressDeckAudio(world) === again, 'dressing twice built two decks');
    undressDeckAudio(world);
    undressDeckAudio(world);
    undressDeckAudio({});
    return '30 s stepped, every entry point fired including the sequences — no context, no nodes, no throw';
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
      const world = fixture();
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
     * Twenty simulated minutes, with the audio clock advanced so the sounds
     * actually END, and the pool has to come back to where it started. The
     * player walks the length of the room while it runs, off `DECK` rather
     * than a remembered spawn, so the pressure filter is being written the
     * whole time as well.
     */
    const { ctx, was } = boot();
    try {
      const world = fixture();
      dressDeckAudio(world, { seed: 7 });
      const v0 = audio.voices;
      const dt = 1 / 30;
      const mid = ALONG(0.5), swing = DEPTH() * 0.35;
      for (let i = 0; i < 20 * 60 * 30; i++) {
        stepDeckAudio(world, dt, cam(0, 1.7, mid + swing * Math.sin(i * 0.0007)));
        ctx.currentTime += dt;
        /* `ended` is what returns a voice, and it fires on the audio clock —
         * which only moves because the renderer is asked to. Rendering one
         * block a frame is the cheapest way to keep that clock honest. */
        if ((i & 31) === 0) ctx.render(audio.master, ctx.block / ctx.sampleRate);
      }
      /* AND WHAT IS IN THE AIR IS NOT A LEAK. Two pass slots and a lane that
       * is now 600 m long means the clock can stop with both of them mid-
       * flight, which is a held voice doing its job. Another minute of deck
       * with the schedules run out is what separates "in flight" from "never
       * released", and it is the second one this check is for. */
      for (let i = 0; i < 60 * 30; i++) {
        stepDeckAudio(world, dt, cam(0, 1.7, mid));
        ctx.currentTime += dt;
        if ((i & 7) === 0) ctx.render(audio.master, ctx.block / ctx.sampleRate);
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
