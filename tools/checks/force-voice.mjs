/**
 * BATTLEFRONT BORZ — the eleven Force powers, and what the player says when
 * one of them goes off.
 *
 * Player note, 21 Aug, verbatim and in full because the last clause is the
 * whole design brief:
 *
 *   "the character should say something everytime he uses a particular force
 *    ability, perhaps he says the name of the attack, or maybe there's a pool
 *    of 3-4 things you can say for every force ability so it doesnt get stale
 *    and you hear the same thing over and over? i like the robotic voice sound
 *    things you do I never use the version where the computer says the actual
 *    words"
 *
 * ── WHAT WAS WRONG ───────────────────────────────────────────────────────
 *
 * Ten of the eleven powers in `POWER_COST` made no vocal sound whatsoever. A
 * push, a pull, a grip, a saber throw, Force sense, lightning, stasis, a heal,
 * a compel and a rend all shipped their own one-shot — `audio.force(chest,
 * 'push')`, a tone, a noise burst — and not one of them ever reached a larynx.
 * Driven through a real Player before this suite existed, all eleven powers
 * fired in sequence produced **one** line between them.
 *
 * That one was `forceUnleash`, and it is the more interesting half of the
 * defect, because it did not say anything of its own: it said `'streak'`, the
 * contour the announcer uses when you kill three men in one breath. So the
 * loudest moment the game can produce announced itself with somebody else's
 * sentence, and a player who heard those three rising syllables had no way to
 * know whether they had just shoved eleven men off their feet or killed three.
 *
 * ── THE TRAP, AND IT IS WHY THIS SUITE MEASURES SAMPLES ──────────────────
 *
 * "perhaps he says the name of the attack" has an obvious implementation and
 * it is the wrong one. `src/engine/Audio.js` already carries `SPOKEN_LINES` —
 * a table of English sentences handed to the browser's own `speechSynthesis`
 * — and eleven more rows of it would read as a complete feature, pass any
 * structural test, and be **inaudible to this player**, who says in the same
 * breath that he uses the wordless larynx and has never used the other mode.
 *
 * So a Force line has to be legible through an oscillator, two formant filters
 * and a breath of noise, saying nothing at all. That means it is a CONTOUR —
 * a sequence of syllable centres — and the pool is a pool of contours. And
 * nothing in a source file can tell you whether two contours sound different,
 * which is the argument tools/checks/voices.mjs is built on and the reason
 * this file borrows that file's offline synthesiser rather than inspecting
 * `FORCE_LINES` as text.
 *
 * ── WHAT IS MEASURED ─────────────────────────────────────────────────────
 *
 * Every one of the 37 contours is rendered to samples through the same
 * band-limited additive sources and RBJ biquads the browser builds from the
 * same grain list, and four numbers are read off the SAMPLES:
 *
 *   length     seconds of audio the cadence actually produces
 *   pitch      autocorrelation over the loudest window of the whole line
 *   direction  the pitch of the last third over the pitch of the first — a
 *              number above 1 is a line that rises and below 1 is one that
 *              falls, and it is the single thing a listener names first
 *   emphasis   where the energy sits in the line, 0 at the start and 1 at the
 *              end. It is what separates "HOLD still" from "hold STILL".
 *
 * Two claims are held against those: no two lines inside one power's pool may
 * land on top of each other, and no two POWERS may either. The bar is 18% on
 * at least one axis, and 18% is not arbitrary — `utterance()` dithers every
 * line it builds by ±5.5% in pitch and ±7% in pace (`vary`), so anything under
 * about 15% is a difference the game's own jitter can erase. Measured on the
 * shipped table the weakest pool pair is 24% and the weakest power pair 23%,
 * on all five larynxes.
 *
 * The rest is driven against a real Player in a real physics world: eleven
 * powers cast for real, the lines counted, the held channels pumped for a
 * second of frames, the bar run dry, and the switch turned off.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld, Body as RBody, LAYER, box as boxShape } from '../../src/physics/RapierWorld.js';
import { Player } from '../../src/game/Player.js';
import { Enemy } from '../../src/game/Enemy.js';
import { BoltPool } from '../../src/game/Bolts.js';
import { POWER_COST } from '../../src/game/Powers.js';
import { Announcer, QUIP_GAP } from '../../src/ui/Announcer.js';
import { AudioEngine, audio as sharedAudio, wordsFor } from '../../src/engine/Audio.js';
import { FORCE_LINES, FORCE_POWERS, FORCE_LINE_IDS, PLAYER_VOICES, LINE_KINDS, PLAYER_LINES,
  forcePool, contourFor, nextForceLine, utterance, peakGain, voiceAt } from '../../src/engine/Voice.js';
import { DEFAULT_SETTINGS } from '../../src/ui/Menu.js';
/**
 * THE OFFLINE SYNTHESISER, BORROWED RATHER THAN COPIED.
 *
 * tools/checks/voices.mjs owns it, its header explains at length why it exists
 * (Node has no Web Audio, and both it and the browser are downstream of one
 * grain list), and a second copy here would be HANDOFF §2.3 in a file whose
 * whole subject is one description with two consumers. Importing a check from
 * a check is otherwise unheard of in this tree; it is right here because the
 * thing imported is an INSTRUMENT and not a test.
 */
import { renderUtterance, pitch } from './voices.mjs';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * 16 kHz, not 48. Every measure below is a ratio or a length, and none of them
 * lives above 8 kHz: the highest formant in the rack is The Sage's 3.9 kHz
 * rasp. Rendering 37 contours × 5 larynxes at 48 kHz costs 21 s of a gate that
 * takes eleven minutes; at 16 kHz it is 6.9 s and every number below is
 * unchanged to the digit that is asserted on.
 */
const SR = 16000;

/* ══════════════════════════════════════════════════════════════════════ */
/*  1. WHAT A LINE MEASURES                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/** Where the energy sits, 0 at the first sample and 1 at the last. */
function emphasis(buf) {
  let n = 0, d = 0;
  for (let i = 0; i < buf.length; i++) { const e = buf[i] * buf[i]; n += i * e; d += e; }
  return d > 0 ? n / d / buf.length : 0.5;
}

function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, buf.length));
}

/**
 * One contour, rendered and measured.
 *
 * `vary` is pinned at 0.5 — the centre of the dither — so the measurement is
 * of the LINE and not of one draw of it. The 18% bar the checks assert is what
 * carries the dither.
 */
function measure(spec, id) {
  const u = utterance(spec, id, 0.5);
  const buf = renderUtterance(u, SR);
  const third = Math.max(1, Math.floor(buf.length / 3));
  const head = pitch(buf.subarray(0, third), SR);
  const tail = pitch(buf.subarray(buf.length - third), SR);
  return {
    id, dur: u.dur, grains: u.grains.length, peak: peakGain(u),
    f0: pitch(buf, SR),
    dir: tail / Math.max(1e-6, head),
    at: emphasis(buf),
    rms: rms(buf),
  };
}

/** Relative gap between two positive numbers, as a fraction of the smaller. */
const gap = (a, b) => Math.abs(a - b) / Math.max(1e-9, Math.min(Math.abs(a), Math.abs(b)));

/**
 * How far apart two measured lines are, on the axis they differ on MOST.
 *
 * The max and not the sum, deliberately: two lines that are the same length,
 * the same pitch and the same shape but land their weight in different places
 * are two lines a listener can tell apart, and an averaged distance would call
 * them one. What must never happen is that they are close on ALL FOUR.
 */
function apart(a, b) {
  return {
    dur: gap(a.dur, b.dur), f0: gap(a.f0, b.f0), dir: gap(a.dir, b.dir), at: Math.abs(a.at - b.at),
    get max() { return Math.max(this.dur, this.f0, this.dir, this.at); },
  };
}

/** The weakest pair in a list of measured lines, and how far apart it is. */
function weakest(rows) {
  let best = { sep: Infinity, pair: '—', d: null };
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const d = apart(rows[i], rows[j]);
      if (d.max < best.sep) best = { sep: d.max, pair: `${rows[i].id}/${rows[j].id}`, d };
    }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  2. A REAL PLAYER, WITH A REAL ANNOUNCER LISTENING                     */
/* ══════════════════════════════════════════════════════════════════════ */

/** An audio engine stand-in that records every line and nothing else. */
function recorder() {
  return {
    _listenerPos: new THREE.Vector3(),
    lines: [],
    speak(spec, kind, o = {}) {
      this.lines.push({ id: spec.id, kind, self: !!o.self, gain: o.gain, pos: o.pos || null });
      return 0.3;
    },
    setVoiceLevel() {},
  };
}

const flatGround = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/**
 * `_held` IS NOT DECORATION — the lightning channel cannot be measured without
 * it. `Player._readInput` closes the channel on the first frame the key is not
 * down (`!input.act('lightning')` → `endLightning()`), so a bench whose `act`
 * always answers false runs one frame and reports a channel that shut itself,
 * which is exactly the "this measured nothing" case the held-channel check
 * asserts against rather than trusting.
 */
const stubInput = () => ({
  _hit: new Set(), _held: new Set(), keys: new Set(), buttons: [false, false, false],
  mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: null,
  moveAxis: (o) => { o.x = 0; o.y = 0; return o; },
  act(id) { return this._held.has(id); },
  actHit(id) { return this._hit.has(id); },
});

/**
 * A REAL PLAYER, A REAL RapierWorld, A REAL Announcer.
 *
 * Deliberately NOT `World.loadLevel` — HANDOFF §2.6/§2.7, where the two suites
 * that build real Worlds are the two that stopped finishing, and nothing here
 * is a property of a level. But it IS real physics and a real Enemy, because
 * three of the eleven powers cannot fire without something to fire at: the
 * grip needs a loose body under the reticle, the compel needs a mind with a
 * blaster in it, and the rend needs a machine with capsules.
 *
 * The announcer is real too and holds a recorder, so what is counted is what
 * the announcer's own budget let through rather than what the game raised.
 * That is the whole of "use the budget rather than inventing a second one":
 * if `_forceVoice` went round the announcer, every count below would still be
 * right and the quip-budget check would fail.
 */
function bench(over = {}) {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 200 });
  physics.terrain = flatGround();
  const scene = new THREE.Scene();
  const heard = recorder();
  const announcer = new Announcer(heard);
  const w = {
    scene, physics, terrain: physics.terrain, statics: [],
    settings: { ...structuredClone(DEFAULT_SETTINGS), fov: 60, bloom: false,
      forcePower: 1, forceDrain: 1, ...over },
    difficulty: null, hpScale: 1, dmgScale: 1,
    players: [], enemies: [], props: [], doors: [], locks: [],
    particles: null, bolts: new BoltPool(scene, 64), time: 0, combatIntensity: 0,
    groundColor: 0xcfae82, notices: [],
    hud: { announcer },
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {}, setSense() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify(t, d) { this.notices.push(`${t} — ${d}`); }, notifyFloating() {},
    addHitstop() {}, onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {},
    onHitmark() {}, onExplosion() {}, spawnDebrisGroup() {}, onPlayerDeath() {},
    setTimeScale() {}, addProp(p) { this.props.push(p); return p; },
  };
  const p = new Player(w, { isLocal: true });
  p.position.set(0, 0, 0);
  p.aimDir.set(0, 0, -1);
  p.saber.ignite(); p.saber.ignition = 1;
  /* Both boon-gated powers granted: `forceLightning` and `forceCompel` refuse
   * by name without them (see POWER_BOON), and a refusal is not what these
   * checks are asking about — except where they are, and there the boon is
   * taken away again. */
  p.boonMods.lightning = true;
  p.boonMods.compel = true;
  w.players.push(p);

  const input = stubInput();
  const ctx = {
    input, terrain: w.terrain, physics, particles: null, bolts: w.bolts,
    camera: w.engine.camera, time: 0, groundColor: 0,
    enemies: w.enemies, players: w.players, pickTarget: () => p,
  };

  /* A loose crate for the grip, straight ahead at the reach the aim ray uses. */
  const crate = new RBody({ position: V(0, 1.2, -5), shape: boxShape(0.4, 0.5, 0.4),
    mass: 22, layer: LAYER.PROP, mask: LAYER.WORLD });
  physics.add(crate);
  w.props.push({ body: crate, grippable: true });

  /* …and a droid with a blaster and a rig, which is one body answering both
   * `forceCompel` (a mind carrying a gun) and `forceDisassemble` (a machine
   * with capsules). One body rather than two so the aim cone is unambiguous. */
  const droid = new Enemy(w, 'b1', V(0, 0, -6));
  w.enemies.push(droid);
  droid.update(1 / 60, ctx);

  return { w, p, ctx, physics, input, heard, announcer, crate, droid,
    dispose: () => w.bolts.dispose() };
}

/**
 * WHICH METHOD FIRES WHICH POWER — and the map is checked against POWER_COST
 * rather than trusted, below. An instrument that carries its own list of the
 * game's powers is an instrument that measures ten of them the day an eleventh
 * is added, which is HANDOFF §2.3 wearing a test's clothes.
 */
const FIRE = {
  push: (b) => b.p.forcePush(b.ctx),
  pull: (b) => b.p.forcePull(b.ctx),
  grip: (b) => b.p.toggleGrip(b.ctx),
  throw: (b) => b.p.throwOrRecall(b.ctx),
  /* THE TWO SABER-SET VERBS. `throwOrRecall` is the key they ride, but the key
   * is conditional on the set — see Player.throwOrRecall — so firing them
   * through it here would only ever reach the single blade's disc. The methods
   * are what the key dispatches to, and they are what this drives. */
  throwOff: (b) => b.p.throwOffBlade(b.ctx),
  orbit: (b) => b.p.spinBarrier(b.ctx),
  sense: (b) => b.p.toggleSense(b.ctx),
  lightning: (b) => b.p.forceLightning(b.ctx),
  stasis: (b) => b.p.toggleStasis(b.ctx),
  heal: (b) => b.p.forceHeal(b.ctx),
  shield: (b) => b.p.forceShield(b.ctx),
  compel: (b) => b.p.forceCompel(b.ctx),
  rend: (b) => b.p.forceDisassemble(b.ctx),
  unleash: (b) => b.p.forceUnleash(b.ctx),
  /* THE WARD IS THE BARRIER'S KEY AIMED AT ONE OF YOUR OWN: stand a trooper
   * on the player's team in the cone first, or the same key speaks the
   * barrier's lines. Restore wants somebody hurt in its circle — `rearm`
   * already leaves the player at half. */
  ward: (b) => {
    const p = b.p;
    if (!b.mate || b.mate.dead) {
      b.mate = new Enemy(b.w, 'trooper', V(0, 0, -6));
      b.mate.team = p.team;
      b.w.enemies.push(b.mate);
      b.mate.update(1 / 60, b.ctx);
    }
    p.aimDir.copy(b.mate.chest || b.mate.position).sub(p.chest).normalize();
    const r = p.forceWard(b.ctx);
    /* AND TAKE HIM AWAY AGAIN, or the barrier's next cast on this bench finds
     * him in the cone and wards instead of shielding. */
    b.mate.dead = true;
    const i = b.w.enemies.indexOf(b.mate);
    if (i >= 0) b.w.enemies.splice(i, 1);
    b.mate = null;
    if (p.ward?.body) p._endWard();
    return r;
  },
  restore: (b) => b.p.forceRestore(b.ctx),
};

/**
 * Put the player back where a power can be cast again.
 *
 * Cooldowns to zero, the bar full, every channel shut, and the announcer's
 * quip budget cleared — the last one because `_say` sets `QUIP_GAP + dur` on
 * the way out and the whole point of that gap is that the NEXT line waits. A
 * bench that did not clear it would measure one line for eleven powers and
 * report the budget as the bug.
 */
function rearm(b) {
  const p = b.p;
  p.force = p.maxForce;
  for (const k of Object.keys(p.cooldowns)) p.cooldowns[k] = 0;
  p.channel = null;
  p.healing = null; p.healTarget = null;
  p.senseActive = false;
  p.gripBody = null; p.gripEnemy = null;
  p.stasis.active = false; p.stasis.held.length = 0; p.stasis.firing.length = 0;
  p.stasis.bodies.clear();
  p.throwState = 'held';
  /* A barrier ALREADY UP makes `forceShield` a toggle-down, which spends
   * nothing and says nothing — so the bench would read the one defensive
   * power in the game as silent. Put it away between casts. */
  p.shield.up = false; p.shield.power = 0; p.shield.t = 0;
  p.hp = p.maxHp * 0.5;                       // so a self-heal is not "already whole"
  b.announcer.quipT = 0;
  b.announcer.effortT = 0;
  b.w.time += 1;
  b.ctx.time = b.w.time;
}

/** Cast one power from a clean state and hand back the lines it produced. */
function cast(b, power) {
  rearm(b);
  const before = b.heard.lines.length;
  FIRE[power](b);
  return b.heard.lines.slice(before);
}

/* ══════════════════════════════════════════════════════════════════════ */

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here. */
  check = await clocked(check);
  await initPhysics();

  /* ────────────────────────────────────────────────────────────────────
   * THE POOLS EXIST, AND THEY ARE POOLS
   * ──────────────────────────────────────────────────────────────────── */

  check('force-voice: every power the player can cast has a pool, and none is smaller than three', () => {
    /**
     * Derived from `POWER_COST` — the table src/game/Player.js actually spends
     * out of — and not from a list typed here. That is the only way this check
     * can fail on the day a twelfth power is added silently.
     */
    const powers = Object.keys(POWER_COST);
    const missing = powers.filter(k => !forcePool(k).length);
    assert(!missing.length,
      `casts silently: ${missing.join(', ')} — a bound key that costs Force and makes no sound`);
    const spare = FORCE_POWERS.filter(k => !(k in POWER_COST));
    assert(!spare.length, `FORCE_LINES carries pools for powers nothing can cast: ${spare.join(', ')}`);
    const thin = powers.map(k => [k, forcePool(k).length]).filter(([, n]) => n < 3);
    assert(!thin.length,
      `the note asks for "a pool of 3-4 things" and these are under it: `
      + thin.map(([k, n]) => `${k} (${n})`).join(', '));
    // …and the fixture that drives them cannot fall behind the table either.
    const undriven = powers.filter(k => !FIRE[k]);
    assert(!undriven.length, `this suite has no way to fire ${undriven.join(', ')}`);
    const total = powers.reduce((n, k) => n + forcePool(k).length, 0);
    assert(total === FORCE_LINE_IDS.length, `${total} pooled lines against ${FORCE_LINE_IDS.length} ids`);
    return `${powers.length} powers, ${total} lines, `
      + powers.map(k => `${k}×${forcePool(k).length}`).join(' ');
  });

  check('force-voice: the Force lines stay OFF the emote wheel', () => {
    /**
     * The reason `FORCE_LINES` is a second table rather than more rows of
     * `LINES`, and it is a real constraint rather than tidiness:
     * `PLAYER_LINES` is `LINE_KINDS` minus the room's own calls, src/ui/HUD.js
     * builds one emote-wheel slot per member of it, and tools/checks/
     * spectacle.mjs asserts the wheel covers it EXACTLY. Thirty-seven Force
     * lines in `LINES` is thirty-seven emote slots and a red gate.
     */
    const leaked = FORCE_LINE_IDS.filter(id => LINE_KINDS.includes(id) || PLAYER_LINES.includes(id));
    assert(!leaked.length, `Force lines have leaked into the wheel's vocabulary: ${leaked.join(', ')}`);
    // …and yet every one of them still resolves to a real contour, which is
    // the thing the two tables have to agree about.
    const unresolved = FORCE_LINE_IDS.filter(id => !contourFor(id));
    assert(!unresolved.length, `named in a pool and resolving to nothing: ${unresolved.join(', ')}`);
    for (const id of FORCE_LINE_IDS) {
      const c = contourFor(id);
      assert(Array.isArray(c.syll) && c.syll.length >= 2,
        `${id} has ${c.syll?.length ?? 0} syllable(s) — a one-syllable contour has no shape at all, `
        + 'because syllable() glides every syllable the same way by the SPEAKER\'s bend');
      assert(typeof c.words === 'string' && c.words.length > 0,
        `${id} carries no words, so the spoken mode says nothing where the larynx says something`);
    }
    return `${FORCE_LINE_IDS.length} Force contours, ${LINE_KINDS.length} wheel contours, no overlap; `
      + `every Force line ≥2 syllables and carries its own words`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * AND THEY ARE DIFFERENT SOUNDS — measured, not read
   * ──────────────────────────────────────────────────────────────────── */

  check('force-voice: no two lines in a pool are the same sound', () => {
    const spec = voiceAt(0);
    const rows = [];
    let worst = { sep: Infinity };
    for (const power of FORCE_POWERS) {
      const pool = forcePool(power).map(id => measure(spec, id));
      assert(pool.every(r => r.rms > 0.002), `${power} has a line that rendered silent`);
      assert(pool.every(r => r.f0 > 20), `${power} has a line with no pitch at all`);
      const w = weakest(pool);
      if (w.sep < worst.sep) worst = { ...w, power };
      rows.push(`${power} ${(w.sep * 100).toFixed(0)}%`);
      assert(w.sep >= 0.18,
        `${w.pair} are the same line: ${(w.d.dur * 100).toFixed(0)}% apart in length, `
        + `${(w.d.f0 * 100).toFixed(0)}% in pitch, ${(w.d.dir * 100).toFixed(0)}% in direction, `
        + `${(w.d.at * 100).toFixed(0)}% in where the weight sits — and utterance() dithers `
        + 'every line by ±5.5% in pitch and ±7% in pace, so that is inside the jitter');
    }
    return `${rows.join(' ')} — weakest ${worst.pair} at ${(worst.sep * 100).toFixed(0)}%`;
  });

  check('force-voice: no two POWERS sound the same either', () => {
    /**
     * The other half of the same claim, and the half a pool-only check cannot
     * see: four distinct shoves and four distinct pulls are worth nothing if a
     * shove and a pull are the same shape. The power is the rhythm — syllable
     * count, length, direction, where the weight sits — and the variant is the
     * melody over it, so a listener learns the eleven and hears the four
     * inside each as the same person saying it differently.
     */
    const spec = voiceAt(0);
    const rows = FORCE_POWERS.map((power) => {
      const pool = forcePool(power).map(id => measure(spec, id));
      const avg = (k) => pool.reduce((a, r) => a + r[k], 0) / pool.length;
      return { id: power, dur: avg('dur'), f0: avg('f0'), dir: avg('dir'), at: avg('at'),
        syll: contourFor(pool[0].id).syll.length };
    });
    let worst = { sep: Infinity, pair: '—' };
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        // A different number of beats is already a different line, whatever
        // the pitch does: that is the one axis a listener counts rather than
        // compares, and it cannot be washed out by a slow larynx.
        const sep = a.syll !== b.syll ? 1 : apart(a, b).max;
        if (sep < worst.sep) worst = { sep, pair: `${a.id}/${b.id}` };
      }
    }
    assert(worst.sep >= 0.18,
      `${worst.pair} are the same power to the ear at ${(worst.sep * 100).toFixed(0)}%`);
    return rows.map(r => `${r.id} ${r.syll}b/${(r.dur * 1000) | 0}ms/${r.f0.toFixed(0)}Hz/`
      + `${r.dir.toFixed(2)}`).join('  ') + `  — weakest ${worst.pair} ${(worst.sep * 100).toFixed(0)}%`;
  });

  check('force-voice: the separation survives every larynx the player can pick', () => {
    /**
     * A contour is a set of RATIOS — pitch as a multiple of `f0`, length as a
     * multiple of the base syllable divided by `cadence` — so in principle a
     * separation measured on one voice holds on all five. In principle is not
     * a measurement: The Sage is a 208 Hz triangle at cadence 0.72 through a
     * 3.9 kHz rasp, and the pitch estimator has been wrong about a larynx
     * before (voices.mjs's own header records putting a 138 Hz voice at 353).
     */
    const rows = [];
    for (const spec of PLAYER_VOICES) {
      let worst = { sep: Infinity, pair: '—' };
      for (const power of FORCE_POWERS) {
        const w = weakest(forcePool(power).map(id => measure(spec, id)));
        if (w.sep < worst.sep) worst = w;
      }
      assert(worst.sep >= 0.18,
        `in ${spec.id}'s throat, ${worst.pair} collapse to ${(worst.sep * 100).toFixed(0)}%`);
      rows.push(`${spec.id} ${(worst.sep * 100).toFixed(0)}%`);
    }
    return `weakest pool pair per larynx: ${rows.join(' ')}`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * IT DOES NOT GO STALE
   * ──────────────────────────────────────────────────────────────────── */

  check('force-voice: the same power fired over and over never repeats a line back to back', () => {
    /**
     * "so it doesnt get stale and you hear the same thing over and over" is
     * the requirement, and a fair die does not meet it: with a pool of three a
     * uniform draw repeats itself back-to-back on a third of all casts, and
     * the immediate repeat is precisely the event a listener hears as "it said
     * that already". `nextForceLine` draws from the n−1 lines that are NOT the
     * last one, so the repeat is impossible rather than unlikely.
     *
     * Driven through `AudioEngine.forceLine`, which is where the memory lives,
     * on a fresh engine so the run does not depend on what the gate did before
     * it. 600 draws per power is enough that a 1-in-3 event would appear about
     * 200 times.
     */
    const a = new AudioEngine();
    const rows = [];
    for (const power of FORCE_POWERS) {
      const pool = forcePool(power);
      const seq = [];
      for (let i = 0; i < 600; i++) seq.push(a.forceLine(power));
      const bad = [];
      for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) bad.push(`${i}:${seq[i]}`);
      assert(!bad.length,
        `${power} said the same line twice running ${bad.length} times in 600 casts (${bad.slice(0, 3).join(', ')})`);
      const counts = pool.map(id => seq.filter(x => x === id).length);
      assert(counts.every(n => n > 0),
        `${power} never said ${pool.filter((id, i) => !counts[i]).join(', ')} in 600 casts — `
        + 'a line nobody hears is not in the pool');
      /* …and the spread is FLAT. A picker that alternated between two of four
       * would also never repeat, and would be staler than the random one. The
       * bound is generous because the draw is over n−1 and the chain is not
       * quite uniform: with a pool of 4 the stationary distribution is exactly
       * flat, and the sample noise at 600 draws is what the 0.72 covers. */
      const want = 600 / pool.length;
      const flat = Math.min(...counts) / want;
      assert(flat > 0.72,
        `${power} favours one line ${(1 / flat).toFixed(2)}× over another: ${counts.join('/')}`);
      rows.push(`${power} ${counts.join('/')}`);
    }
    return `600 casts each, 0 back-to-back repeats: ${rows.join('  ')}`;
  });

  check('force-voice: the pick is pure, and it is the caller that remembers', () => {
    /**
     * `nextForceLine(power, last, roll)` takes the memory and the draw as
     * ARGUMENTS. That is what lets this check exist at all: a picker with a
     * module-level `last` and a `Math.random()` inside it can only be measured
     * statistically, and a picker that is a function of its inputs can be
     * measured exactly. It is also what keeps src/engine/Voice.js free of
     * mutable state, which tools/checks/_shared.mjs would otherwise have to
     * put back between suites.
     */
    for (const power of FORCE_POWERS) {
      const pool = forcePool(power);
      for (const last of [...pool, '']) {
        const seen = new Set();
        // Every corner of the roll, plus the two ends, plus a nonsense one.
        for (const roll of [0, 0.001, 0.25, 0.5, 0.75, 0.999, 1, 1.5, -1, NaN]) {
          const got = nextForceLine(power, last, roll);
          assert(pool.includes(got), `${power} drew ${JSON.stringify(got)}, which is not in its pool`);
          assert(got !== last || last === '', `${power} drew ${got} straight after ${last}`);
          seen.add(got);
        }
        assert(seen.size === (last === '' ? pool.length : pool.length - 1),
          `after ${last || 'nothing'}, ${power} can only reach ${seen.size} of its ${pool.length} lines`);
      }
      // Same inputs, same answer — twice, because that is what pure means.
      assert(nextForceLine(power, pool[0], 0.42) === nextForceLine(power, pool[0], 0.42),
        `${power} is not a function of its arguments`);
    }
    assert(nextForceLine('nothing-like-this', '', 0.5) === '',
      'a power with no pool drew a line out of nowhere');
    return `${FORCE_POWERS.length} pools × ${FORCE_LINE_IDS.length + FORCE_POWERS.length} `
      + 'starting states × 10 rolls, every draw in the pool and none a repeat';
  });

  /* ────────────────────────────────────────────────────────────────────
   * DRIVEN — a real Player, a real announcer, real physics
   * ──────────────────────────────────────────────────────────────────── */

  check('force-voice: all eleven powers speak when they actually go off', () => {
    /**
     * The measurement this whole suite exists for. Before it, the same drive
     * produced ONE line out of eleven, and that one was `'streak'` — the
     * killstreak contour, borrowed by `forceUnleash` because it was the
     * loudest thing in LINES.
     */
    const b = bench();
    try {
      const rows = [], silent = [];
      for (const power of FORCE_POWERS) {
        const said = cast(b, power);
        if (!said.length) { silent.push(power); continue; }
        assert(said.length === 1, `${power} said ${said.length} lines for one press`);
        const line = said[0];
        assert(forcePool(power).includes(line.kind),
          `${power} said '${line.kind}', which is not one of its own lines (${forcePool(power).join(', ')})`);
        assert(line.self === true,
          `${power}'s line is not marked as the player's own, so it takes PRIO.combat and does not duck the room`);
        assert(line.id === voiceAt(b.w.settings.voiceIndex).id,
          `${power} spoke in ${line.id}'s throat and the player chose ${voiceAt(b.w.settings.voiceIndex).id}`);
        rows.push(`${power}→${line.kind}`);
      }
      assert(!silent.length, `cast and said nothing: ${silent.join(', ')}`);
      return `${rows.length}/${FORCE_POWERS.length}: ${rows.join(' ')}`;
    } finally { b.dispose(); }
  });

  check('force-voice: a held channel says it once per cast, not once per frame', () => {
    /**
     * Lightning, the grip, the heal and the stasis field are CHANNELS: opened
     * by a press and then run from a per-frame tick for as long as they last.
     * The failure mode is the loudest one in this feature — a line on the tick
     * rather than on the opening is sixty lines a second — and it is invisible
     * to any check that only presses the key once.
     *
     * So this presses once and then runs the real `Player.update` for a
     * second, which is what carries `_lightningTick`, `_updateGrip`,
     * `_updateHeal` and `_updateStasis`. The channel is confirmed to still be
     * OPEN at the end, or the check would pass for a power that simply shut
     * itself down on frame two.
     */
    /**
     * ONE BENCH PER CHANNEL, and it is not tidiness. Driven on a shared bench
     * the stasis field's own second of frames captures the crate the grip is
     * aimed at — `_stasisCapture` takes every loose body inside 9 m and the
     * crate is at 5 — and the grip that follows then finds nothing to hold and
     * says nothing, which reads as this check's own defect. Four worlds cost
     * about a second; a shared one costs a wrong answer.
     */
    const benches = [];
    try {
      const held = [
        /* …and which key stays DOWN while it runs, where the power has one. */
        ['lightning', (p) => p.channel?.kind === 'lightning', 'lightning'],
        ['heal', (p) => p.healing !== null && p.healing !== undefined, null],
        ['stasis', (p) => p.stasis.active === true, null],
        ['grip', (p) => !!(p.gripBody || p.gripEnemy), null],
      ];
      const rows = [];
      for (const [power, open, key] of held) {
        const b = bench();
        benches.push(b);
        const said = cast(b, power);
        if (key) b.input._held.add(key);
        assert(said.length === 1, `${power} said ${said.length} lines on the press`);
        const before = b.heard.lines.length;
        const dt = 1 / 60;
        for (let i = 0; i < 60; i++) { b.w.time += dt; b.ctx.time = b.w.time; b.p.update(dt, b.ctx); }
        const during = b.heard.lines.length - before;
        assert(open(b.p), `${power}'s channel closed inside the second, so this measured nothing`);
        assert(during === 0,
          `${power} said ${during} more lines over 60 frames of an open channel — `
          + `that is ${(during * 60 / 60).toFixed(0)} a second of one man shouting`);
        rows.push(`${power} 1 line, 60 frames, ${during} more`);
      }
      return rows.join('; ');
    } finally { for (const b of benches) b.dispose(); }
  });

  check('force-voice: a refused power is silent — you did not do anything', () => {
    /**
     * Three kinds of refusal, and all three have to be silent, because a line
     * on a refusal is the game announcing something that did not happen.
     *
     *   AN EMPTY BAR — every power in the file goes through `_spend` or
     *   `_canSpend`, so this is one condition that reaches all eleven.
     *   A COOLDOWN — the `recovering — 0.4s` refusal.
     *   NOT ATTUNED — lightning and compel refuse by name without their boon.
     *
     * `notices` is read as well as the line count: a run where nothing was
     * refused would pass a silence check by doing nothing at all, which is the
     * shape of test HANDOFF §2.5 is about.
     */
    const b = bench();
    try {
      // 1. an empty bar
      let refused = 0;
      for (const power of FORCE_POWERS) {
        rearm(b);
        b.p.force = 0;
        b.w.notices.length = 0;
        const before = b.heard.lines.length;
        FIRE[power](b);
        const said = b.heard.lines.length - before;
        assert(said === 0, `${power} shouted on an empty bar — ${said} line(s)`);
        if (b.w.notices.length) refused++;
      }
      assert(refused >= 9,
        `only ${refused} of ${FORCE_POWERS.length} powers said out loud WHY they refused an empty bar — `
        + 'a silent refusal makes this check pass by measuring nothing');

      // 2. a cooldown
      rearm(b);
      b.p.forcePush(b.ctx);
      const afterFirst = b.heard.lines.length;
      assert(b.p.cooldowns.push > 0, 'a push left no cooldown, so the second press is not a refusal');
      b.p.force = b.p.maxForce;
      b.announcer.quipT = 0;
      b.p.forcePush(b.ctx);
      assert(b.heard.lines.length === afterFirst, 'a push still recovering said something anyway');

      // 3. not attuned
      rearm(b);
      b.p.boonMods.lightning = false;
      b.p.boonMods.compel = false;
      const before = b.heard.lines.length;
      b.p.forceLightning(b.ctx);
      b.p.forceCompel(b.ctx);
      assert(b.heard.lines.length === before,
        'a power the player has not drafted announced itself being cast');
      b.p.boonMods.lightning = true;
      b.p.boonMods.compel = true;
      return `${FORCE_POWERS.length} powers on an empty bar: 0 lines, ${refused} spoken refusals; `
        + 'a cooldown and an undrafted power likewise silent';
    } finally { b.dispose(); }
  });

  check('force-voice: the switch is real, and it defaults ON', () => {
    /**
     * `forceVoice` is its own box rather than a clause of `voiceLines`,
     * because the two answer different questions — see its note in
     * DEFAULT_SETTINGS. Both directions are driven: off must silence the
     * powers and leave the ordinary voice alone, and `voiceLines` off must
     * silence both, since a player who has switched their own voice off has
     * switched off everything that comes out of their throat.
     */
    assert(DEFAULT_SETTINGS.forceVoice === true,
      `forceVoice ships as ${JSON.stringify(DEFAULT_SETTINGS.forceVoice)} — the player asked for this by name`);
    const b = bench();
    try {
      const fireAll = () => {
        let n = 0;
        for (const power of FORCE_POWERS) n += cast(b, power).length;
        return n;
      };
      const on = fireAll();
      assert(on === FORCE_POWERS.length, `${on} lines with the switch on, expected ${FORCE_POWERS.length}`);

      b.w.settings.forceVoice = false;
      const off = fireAll();
      assert(off === 0, `${off} lines with Force voices switched off`);
      // …and the rest of the player's voice is untouched by that box.
      b.announcer.quipT = 0;
      assert(b.announcer.say(b.w.settings, 'kill', b.p.chest) === true,
        'switching Force voices off also silenced the ordinary quip — that is the wrong box');

      // the other box: your own voice off silences the powers too
      b.w.settings.forceVoice = true;
      b.w.settings.voiceLines = false;
      const quiet = fireAll();
      assert(quiet === 0, `${quiet} Force lines with the player's own voice switched off entirely`);
      return `on ${on}/${FORCE_POWERS.length} · forceVoice off ${off} · voiceLines off ${quiet} · `
        + 'the ordinary quip still speaks with forceVoice off';
    } finally { b.dispose(); }
  });

  check('force-voice: a power spends the quip budget rather than going round it', () => {
    /**
     * The rule this feature had to obey and the easiest one to skip: there is
     * already a budget that stops the game talking over itself, and a line
     * that called `audio.speak` directly would sound identical in isolation
     * and land on top of every kill line in a fight.
     *
     * Two halves, and both are needed. A power is FORCED past the gap — the
     * player pressed a key and a rate limit may not swallow it — and it then
     * SETS the gap, so the automatic quip that would have followed waits.
     */
    const b = bench();
    try {
      rearm(b);
      b.announcer.quipT = QUIP_GAP;                 // a quip has just been said
      const said = cast(b, 'push');
      assert(said.length === 1, 'a pressed power was swallowed by the quip gap');

      // …and the gap is now set by it, so a kill line does not land on top.
      rearm(b);
      b.p.forcePull(b.ctx);
      const set = b.announcer.quipT;
      assert(set >= QUIP_GAP,
        `a Force line left the quip budget at ${set.toFixed(2)}s — the next kill line lands on top of it`);
      const before = b.heard.lines.length;
      /* NOT forced: this is the announcer noticing a kill, which is exactly
       * the line the budget is there to hold back. */
      b.announcer._say(voiceAt(0), 'kill', null, 1, true);
      assert(b.heard.lines.length === before,
        'a kill line landed on top of the shout that made the kill possible');
      return `forced past a full ${QUIP_GAP}s gap, and leaves ${set.toFixed(2)}s behind it`;
    } finally { b.dispose(); }
  });

  /* ────────────────────────────────────────────────────────────────────
   * AND IT WORKS IN THE MODE THE PLAYER ACTUALLY USES
   * ──────────────────────────────────────────────────────────────────── */

  check('force-voice: every line is carried by the wordless larynx, not by the speech synthesiser', () => {
    /**
     * THE CLAUSE THE WHOLE FEATURE TURNS ON: "i like the robotic voice sound
     * things you do I never use the version where the computer says the actual
     * words". `speechMode` is 'synth' for this player and always has been, and
     * a Force line built as text would be silence for him.
     *
     * So: with the engine in 'synth' — the shipped default — every one of the
     * 37 lines has to come out of the oscillator path with a real duration and
     * real grains behind it, and `canSpeakWords()` is false in Node anyway, so
     * nothing here can accidentally be measuring the browser's synthesiser.
     */
    const spec = voiceAt(0);
    assert(sharedAudio.speechMode === 'synth',
      `the engine ships in '${sharedAudio.speechMode}' mode, which is not what the player uses`);
    const rows = [];
    for (const power of FORCE_POWERS) {
      for (const id of forcePool(power)) {
        const u = utterance(spec, id, 0.5);
        assert(u.kind === id, `${id} fell back to another contour: utterance() built '${u.kind}'`);
        assert(u.dur > 0.08, `${id} is ${(u.dur * 1000) | 0}ms long — under a tenth of a second is a click`);
        assert(u.grains.length >= 6,
          `${id} built ${u.grains.length} grains; two syllables is at least six layers of one`);
        assert(peakGain(u) > 0.05, `${id} peaks at ${peakGain(u).toFixed(3)}, under the hearing floor at any range`);
      }
      rows.push(`${power} ${forcePool(power).map(id => utterance(spec, id, 0.5).grains.length).join('/')}g`);
    }
    /* The other mode is not broken by this, it is merely not what is being
     * relied on: each contour carries its own words and `wordsFor` finds them,
     * so a player who does use 'spoken' gets a sentence per power. */
    const wordless = FORCE_LINE_IDS.filter(id => !wordsFor(id));
    assert(!wordless.length, `no words for the spoken mode: ${wordless.join(', ')}`);
    return `${FORCE_LINE_IDS.length} lines through the larynx: ${rows.join(' ')}`;
  });
}
