/**
 * SABER — the controls tell the truth.
 *
 * An audit for "reads correctly, silently wrong" found four of these in the
 * menu and the key table, and every one of them read perfectly well as source:
 *
 *   1. "Camera shake" was a default in DEFAULT_SETTINGS bound to a checkbox
 *      with no onChange, and no consumer anywhere in src/. Unticking it changed
 *      nothing.
 *   2. "Cinematic slow-motion" was the same: a default, a checkbox, no reader.
 *   3. "Cleaving Throw" set `p.boonMods.throwPierce = true` and nothing read
 *      the flag. The card promised a blade that passes through everything and
 *      returns faster; the throw behaved exactly as it did without the boon.
 *   4. `scoreboard` was in ACTIONS, bound to Tab, printed in the Codex and on
 *      the pause card, and handled by nobody. The only Tab in main.js was a
 *      preventDefault, which is what made it look wired.
 *
 * So the checks come in two kinds. The behavioural ones drive the real code —
 * a real CameraRig, World.prototype.update, Player.prototype._updateThrow —
 * and print the number the claim rests on, on and off. The structural ones make
 * the whole class of bug fail the build: a setting with no reader, a boon whose
 * only effect is a flag nobody reads, an action nothing handles.
 */

import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { CameraRig } from '../../src/game/Player.js';
import { World } from '../../src/game/World.js';
import { FocusSystem } from '../../src/game/Focus.js';
import { BladeContactSolver, TOUGHNESS } from '../../src/game/Combat.js';
import { Saber } from '../../src/game/Saber.js';
import { Player } from '../../src/game/Player.js';
import { DEFAULT_SETTINGS, SETTING_READERS, applyFeelSettings, CODEX, SCHEMES, codexHtml, pauseHintsHtml,
  keyChips } from '../../src/ui/Menu.js';
import { BOONS, CLEAVE, cleavingThrow } from '../../src/game/Waves.js';
import { ACTIONS, ACTION_IDS, MOUSE, defaultBindings, conflicts, findConflict, findConflicts,
  resolveConflicts, keyLabel } from '../../src/engine/Bindings.js';
import { Input } from '../../src/engine/Input.js';
import { SaberController } from '../../src/game/SaberController.js';
import { QUALITY } from '../../src/engine/Engine.js';
import { Particles } from '../../src/world/Particles.js';
import { GrassField } from '../../src/world/Scenery.js';
import { Terrain } from '../../src/world/Terrain.js';
import { DojoDirector } from '../../src/game/Dojo.js';

/**
 * Where every COLUMN of Engine's QUALITY table is actually read.
 *
 * Same instrument as SETTING_READERS and for the same reason, one level down.
 * `grass` (0.25→1.5) and `particles` (0.4→1.35) sat in that table from the
 * foundation commit with no reader anywhere in src/ — `git log -S"q.particles"`
 * was empty — while World.loadLevel kept its own inline
 * `{low:0.55, medium:0.8, high:1, ultra:1.25}` and the Performance card
 * promised "fewer particles… for laptops and integrated graphics". Every tier
 * got Cinematic's budget. `bloom` was a third: true on all four rows and read
 * by nobody.
 *
 * A tier is a PROMISE about what the machine will be asked to draw. A column
 * of that promise with no reader is the same lie as a checkbox with no
 * onChange, so it fails the build the same way.
 *
 * This lives here rather than beside QUALITY only because Engine.js belongs to
 * another lane this round; it wants to move next to the table it describes.
 */
const QUALITY_READERS = {
  shadow:     ['engine/Engine.js', 'L.shadow.mapSize.set(q.shadow, q.shadow)'],
  shadowDist: ['engine/Engine.js', 'q.shadowDist * f'],
  viewDist:   ['engine/Engine.js', 'this.camera.far = q.viewDist'],
  pixelRatio: ['engine/Engine.js', 'Math.min(window.devicePixelRatio, q.pixelRatio)'],
  msaa:       ['engine/Engine.js', 'samples: q.msaa'],
  bloom:      ['main.js', 'QUALITY.high).bloom'],
  grass:      ['game/World.js', 'Math.round(11000 * q.grass)'],
  particles:  ['game/World.js', 'q.particles'],
};

const DEG = 180 / Math.PI;
const scene = new THREE.Scene();
const src = (p) => new URL('../../src/' + p, import.meta.url);
const read = async (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

/* ── a camera rig driven the way the game drives it ──────────────────── */

/**
 * `frames` frames of a third-person rig following a walking body, with a
 * grenade going off every `every` frames. Returns the view direction and the
 * eye position on each frame, which is everything a deviation is measured from.
 */
function driveRig(settings, { frames = 240, every = 30, kick = 1.5 } = {}) {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.15, 400);
  const rig = new CameraRig(cam);
  rig.shakeSeed = 12.5;                 // same phase in every run, so runs compare
  // The gate goes on exactly what the game gates: a world whose player owns
  // this rig. applyFeelSettings is the code main.js calls in buildWorld.
  const world = { player: { camera: rig }, hitstop: 0, addHitstop() {} };
  if (settings) applyFeelSettings(world, settings);

  const target = new THREE.Vector3(0, 0, 0);
  const dirs = [], eyes = [];
  const dir = new THREE.Vector3();
  for (let i = 0; i < frames; i++) {
    if (i % every === 0) rig.addShake(kick);
    target.z -= 3.2 / 60;               // a body walking away at 3.2 m/s
    rig.update(1 / 60, target, {});
    dirs.push(dir.set(0, 0, -1).applyQuaternion(cam.quaternion).clone());
    eyes.push(cam.position.clone());
  }
  return { rig, dirs, eyes };
}

/* ── a world clock with nothing in it but the clock ──────────────────── */

/**
 * World.prototype.update against a hand-made frame.
 *
 * Building a real World needs an Engine and a GPU; calling its own update
 * against stubs does not, and it is the SAME arithmetic — which is the point,
 * because the hitstop and the time scale are four lines at the top of that
 * function and nothing else in the codebase reproduces them.
 */
function clockWorld(settings) {
  const w = {
    running: true, paused: false, netMode: null,
    hitstop: 0, timeScale: 1, targetTimeScale: 1, time: 0, combatIntensity: 0, score: 0,
    focus: new FocusSystem(),
    settings, difficulty: null,
    player: null, players: [], enemies: [], props: [], doors: [], debris: [], locks: [],
    bladeSolver: new BladeContactSolver(), _targets: [], _capsCache: [],
    physics: { step() {}, bodies: [] },
    terrain: { flush() {} },
    particles: { update() {} },
    bolts: { update() {}, threatsNear: () => [] },
    director: { update() {} },
    engine: {
      camera: new THREE.PerspectiveCamera(), sun: { color: 0 }, hemi: { color: 0 },
      fitShadows() {}, setRadial() {}, setFocus() {}, flash() {},
    },
    pickTarget() {}, pickSpawn() {}, spawnEnemy() {},
    update: World.prototype.update,
    addHitstop: World.prototype.addHitstop,
    setTimeScale: World.prototype.setTimeScale,
    _updateCatch: World.prototype._updateCatch,
    _resolveBlades: World.prototype._resolveBlades,
    _bladeEntries: World.prototype._bladeEntries,
  };
  applyFeelSettings(w, settings);
  return w;
}

/** Per-frame world-clock advance divided by real time, for `frames` frames. */
function timeScaleTrace(w, frames, dt = 1 / 60) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    const before = w.time;
    w.update(dt, null);
    out.push((w.time - before) / dt);
  }
  return out;
}

/* ── a player who can throw ──────────────────────────────────────────── */

/** A body with a real Saber and the real throw, and nothing else it needs. */
function thrower(worldStub) {
  const saber = new Saber(scene, { colorIndex: 0, bladeLength: 1.15 });
  saber.ignite(); saber.ignition = 1;
  const p = Object.assign(Object.create(Player.prototype), {
    world: worldStub, saber,
    aimDir: new THREE.Vector3(0, 0, -1),
    throwPos: new THREE.Vector3(), throwVel: new THREE.Vector3(),
    throwSpin: 0, throwTimer: 0, throwState: 'held',
    control: { handPos: new THREE.Vector3(0, 1.35, 0), quat: new THREE.Quaternion() },
    cooldowns: { throw: 0 }, force: 100,
    boonMods: {
      deflectDamage: 1, cutPower: 1, forceCost: 1, staminaRegen: 1, moveSpeed: 1,
      jumpPower: 1, flowGain: 1, returnCone: 0.42, healOnKill: 0, lifesteal: 0,
      lightning: false, repulse: false, throwPierce: false, doubleJump: false,
    },
    limbsRemoved: 0, score: 0, combo: 0, comboTimer: 0, flow: 0,
    camera: { addShake() {} }, addFlow() {}, heal() {},
  });
  return p;
}

/**
 * A line of bodies standing in the flight path, as capsules.
 *
 * Mixed on purpose: droid plating parts under a blade that barely touches it,
 * armour and heavy do not. That mix is the whole question the boon answers —
 * a thrown blade is never LEANT on anything, so anything the solver makes you
 * earn is something a stock throw cannot take.
 */
function targetsWorld(count, spacing = 4, cuts = [], toughness = null) {
  const bodies = [];
  for (let i = 0; i < count; i++) {
    const z = -(6 + i * spacing);
    const tough = toughness ? toughness[i % toughness.length] : TOUGHNESS.droid;
    bodies.push({
      id: 'e' + i, dead: false, type: 'b1', tough,
      capsules: () => [
        { name: 'chest', p0: new THREE.Vector3(0, 1.05, z), p1: new THREE.Vector3(0, 1.55, z), r: 0.26, toughness: tough, vital: 0.9 },
        { name: 'thighL', p0: new THREE.Vector3(-0.16, 0.45, z), p1: new THREE.Vector3(-0.16, 0.95, z), r: 0.12, toughness: tough, vital: 0.4 },
      ],
      takeCut(ev) { cuts.push({ id: this.id, bone: ev.bone, cutT: ev.cutT }); },
    });
  }
  return {
    enemies: bodies, props: [], particles: {}, hitstop: 0,
    addHitstop() {}, onHitmark() {},
    _applyBladeEvent(player, ev) { cuts.push({ id: ev.target.id, bone: ev.bone, cutT: ev.cutT, speed: ev.speed }); },
  };
}

/** The bodies as the blade solver wants them, rebuilt each frame. */
function solverTargets(w) {
  return w.enemies.filter(e => !e.dead).map(e => ({ id: e.id, capsules: e.capsules(), enemy: e, dead: false }));
}

export async function run({ check, assert }) {

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1. Camera shake                                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: unticking Camera shake actually stops the camera shaking', () => {
    // The reference: the same rig, same walk, never kicked at all. Anything the
    // shaken runs deviate from it BY is the shake, and nothing else.
    const still = driveRig(null, { kick: 0 });
    const on = driveRig({ ...DEFAULT_SETTINGS, shake: true });
    const off = driveRig({ ...DEFAULT_SETTINGS, shake: false });

    const peakAngle = (r) => {
      let worst = 0;
      for (let i = 0; i < r.dirs.length; i++) {
        worst = Math.max(worst, Math.acos(Math.min(1, r.dirs[i].dot(still.dirs[i]))) * DEG);
      }
      return worst;
    };
    const peakShift = (r) => {
      let worst = 0;
      for (let i = 0; i < r.eyes.length; i++) worst = Math.max(worst, r.eyes[i].distanceTo(still.eyes[i]));
      return worst;
    };

    const aOn = peakAngle(on), aOff = peakAngle(off);
    assert(aOn > 0.25, `shake ON only moved the view ${aOn.toFixed(3)}° — there is no shake to switch off`);
    assert(aOff === 0, `shake OFF still deviated ${aOff.toFixed(4)}° from a camera that was never kicked`);
    assert(peakShift(off) === 0, `shake OFF still moved the eye ${peakShift(off).toFixed(4)} m`);
    assert(off.rig.shake === 0, `the rig is holding ${off.rig.shake} of shake with the setting off`);
    // and the gate is on the funnel, not on the frame: nothing accumulates
    off.rig.addShake(1.5);
    assert(off.rig.shake === 0, 'addShake got through the gate');
    return `peak view deviation: ON ${aOn.toFixed(2)}° / ${peakShift(on).toFixed(3)} m, `
      + `OFF ${aOff.toFixed(4)}° / ${peakShift(off).toFixed(4)} m`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2. Cinematic slow-motion                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: unticking Cinematic slow-motion actually stops time dilating', () => {
    const on = clockWorld({ ...DEFAULT_SETTINGS, slowmo: true });
    const off = clockWorld({ ...DEFAULT_SETTINGS, slowmo: false });

    // 0.12 s is the longest hitstop in the game (a Force rend); at 60 Hz that
    // is a little over seven frames of dilation.
    on.addHitstop(0.12);
    off.addHitstop(0.12);
    const tOn = timeScaleTrace(on, 12);
    const tOff = timeScaleTrace(off, 12);

    const minOn = Math.min(...tOn), minOff = Math.min(...tOff);
    const dilated = tOn.filter(v => v < 0.5).length;
    assert(minOn < 0.1, `slow-mo ON never took the world below ${minOn.toFixed(3)}× real time`);
    assert(dilated >= 7, `only ${dilated} frames were dilated by a 0.12 s hitstop`);
    // 1e-9, not exactly 1: world.time is an accumulator, so a per-frame ratio
    // taken off it carries float noise. Anything the toggle let through would
    // be 0.06, six orders of magnitude away from that.
    assert(minOff > 1 - 1e-6, `slow-mo OFF still ran a frame at ${minOff.toFixed(6)}× real time`);
    assert(off.hitstop === 0, `slow-mo OFF still banked ${off.hitstop} s of hitstop`);

    // Focus and Force sense are abilities, not cinematics, and must survive the
    // toggle — they bend time through targetTimeScale and focus.scale, which
    // this gate has no business touching.
    off.setTimeScale(0.42);
    const sensed = timeScaleTrace(off, 30);
    assert(Math.min(...sensed) < 0.6,
      `Force sense stopped working with slow-motion off: floor ${Math.min(...sensed).toFixed(3)}×`);
    return `hitstop: ON ${minOn.toFixed(3)}× for ${dilated} frames, OFF ${minOff.toFixed(3)}× flat; `
      + `Force sense still reaches ${Math.min(...sensed).toFixed(2)}× with the toggle off`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3. Cleaving Throw                                                 */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: Cleaving Throw passes the blade through bodies a stock throw misses', () => {
    const boon = BOONS.find(b => b.id === 'saberthrow');
    assert(boon, 'the Cleaving Throw card is gone from BOONS');

    // Six bodies in a line: two droid-plated, two armoured, two heavy.
    const MIX = [TOUGHNESS.droid, TOUGHNESS.armour, TOUGHNESS.heavy];

    /**
     * One throw down the line. The SOLVER runs on the same flight in both runs,
     * exactly as World._resolveBlades runs it every frame, so "stock" is what a
     * thrown blade really takes today and not an empty baseline.
     */
    const fly = (withBoon) => {
      const cleaved = [];
      const w = targetsWorld(6, 4, cleaved, MIX);
      const p = thrower(w);
      if (withBoon) boon.apply(p);
      // the throw itself, exactly as throwOrRecall sets it up
      p.throwState = 'flying';
      p.throwPos.set(0, 1.25, 0);
      p.throwVel.set(0, 0, -26);
      p.throwTimer = 0;
      const solver = new BladeContactSolver();
      const solved = new Set();
      const ctx = { particles: null };
      const zero = new THREE.Vector3();
      for (let i = 0; i < 90 && p.throwState !== 'held'; i++) {
        p._updateThrow(1 / 60, ctx);
        p.saber.update(1 / 60, i / 60, zero);
        for (const ev of solver.solve(p.saber, solverTargets(w), 1 / 60, { power: 1 })) {
          if (ev.type === 'cut') solved.add(ev.target.id);
        }
      }
      const passed = new Set(cleaved.map(c => c.id));
      for (const id of solved) passed.add(id);
      return { cleaved, solved: solved.size, passed: passed.size, p };
    };

    const stock = fly(false);
    const cleave = fly(true);
    assert(cleave.passed >= 5, `a cleaving throw only passed through ${cleave.passed} of 6 bodies`);
    assert(cleave.passed > stock.passed,
      `cleaving took ${cleave.passed} bodies and the stock throw took ${stock.passed} — the card buys nothing`);
    assert(stock.passed < 6,
      `the stock throw already took all 6 (${stock.solved} by the solver) — this measures nothing`);
    const cuts = cleave.cleaved;
    // once each, never twice: the flight is one pass, not a saw
    const perBody = new Map();
    for (const c of cuts) perBody.set(c.id, (perBody.get(c.id) || 0) + 1);
    const doubled = [...perBody].filter(([, n]) => n > 1);
    assert(!doubled.length, `cleaved the same body twice on one flight: ${doubled.map(([id, n]) => `${id}×${n}`).join(', ')}`);
    assert(cleave.p.throwCleaves === perBody.size,
      `the blade counted ${cleave.p.throwCleaves} passes but produced ${perBody.size}`);
    assert(cleave.p.boonMods.throwPierce === true,
      'the boon did not report itself live, so nothing downstream can read it');
    return `bodies taken per throw down a line of 6 (2 droid, 2 armour, 2 heavy): `
      + `stock ${stock.passed} (solver ${stock.solved}), cleaving ${cleave.passed} (solver ${cleave.solved}, cleave ${perBody.size})`;
  });

  check('controls: Cleaving Throw returns the blade in half the time', () => {
    const boon = BOONS.find(b => b.id === 'saberthrow');

    const recall = (withBoon) => {
      const w = targetsWorld(0, 4, []);
      const p = thrower(w);
      if (withBoon) boon.apply(p);
      // 30 m out and already turning for home — the far end of a real throw
      p.throwState = 'returning';
      p.throwPos.set(0, 1.25, -30);
      p.throwVel.set(0, 0, -6);
      p.throwTimer = 1.5;
      p.control.handPos.set(0, 1.35, 0);
      let f = 0;
      const ctx = { particles: null };
      while (p.throwState !== 'held' && f < 1200) { p._updateThrow(1 / 60, ctx); f++; }
      assert(p.throwState === 'held', 'the blade never came home');
      return f / 60;
    };

    const stock = recall(false);
    const fast = recall(true);
    const ratio = stock / fast;
    assert(ratio > 1.7 && ratio < 2.4,
      `the cleaving recall is ${ratio.toFixed(2)}× the stock speed, and the card says twice`);
    assert(Math.abs(ratio - CLEAVE.recall) < 0.25,
      `CLEAVE.recall says ${CLEAVE.recall} but the blade measured ${ratio.toFixed(2)}×`);
    return `30 m recall: stock ${(stock * 1000).toFixed(0)} ms, cleaving ${(fast * 1000).toFixed(0)} ms (${ratio.toFixed(2)}×)`;
  });

  check('controls: cutting a prop mid-flight does not saw it to atoms in one frame', () => {
    // World._applyBladeEvent pushes the two halves of a cut prop onto
    // world.props. Walking that array with for…of while cutting into it means
    // the halves are inside the same disc, get cut, push more halves, and a
    // crate reaches its generation cap on a single frame. The sweep is bounded
    // by the length it started with; this is what holds that.
    let nextId = 100;
    const makeProp = (z, gen) => ({
      id: 'p' + (nextId++), dead: false, gen,
      capsules: () => [{ name: 'c0', p0: new THREE.Vector3(0, 1.2, z), p1: new THREE.Vector3(0, 1.2, z), r: 0.45 }],
      cut() {
        if (this.gen >= 2) return null;
        return [makeProp(z - 0.2, this.gen + 1), makeProp(z + 0.2, this.gen + 1)];
      },
      shatter() { this.dead = true; },
    });

    const w = targetsWorld(0);
    w.props = [makeProp(-8, 0), makeProp(-14, 0)];
    w.bladeSolver = { clearTarget() {} };
    w.particles = { sparkBurst() {}, slag() {}, cutFlare() {} };
    w._applyBladeEvent = World.prototype._applyBladeEvent;

    const p = thrower(w);
    BOONS.find(b => b.id === 'saberthrow').apply(p);
    p.throwState = 'flying';
    p.throwPos.set(0, 1.2, 0);
    p.throwVel.set(0, 0, -26);
    p.throwTimer = 0;
    for (let i = 0; i < 60 && p.throwState !== 'held'; i++) p._updateThrow(1 / 60, { particles: null });

    // Two crates, two halves each, and that is the end of it on this flight.
    assert(p.throwCleaves === 2, `cleaved ${p.throwCleaves} props where two were standing`);
    assert(w.props.length === 6, `${w.props.length} props after cutting two — the halves were cut again`);
    assert(w.props.filter(x => x.gen === 2).length === 0,
      'the halves were re-cut inside the same sweep');
    return `2 crates → ${w.props.length} pieces (2 whole + 4 halves), ${p.throwCleaves} cleaves`;
  });

  check('controls: a cleave produces an event the real cut pipeline accepts', () => {
    // The count above uses a recording stub. This drives World's OWN
    // _applyBladeEvent with the event a cleave actually builds, so a cleave
    // cannot go on scoring while the shape it hands over has drifted.
    const took = [];
    const cuts = [];
    const w = targetsWorld(1, 4, cuts);
    w._applyBladeEvent = World.prototype._applyBladeEvent;
    w.particles = { sparkBurst() {}, slag() {}, cutFlare() {} };
    w.enemies[0].takeCut = (ev, source) => took.push({ ev, source });
    w.enemies[0].dead = false;
    const felt = { stop: 0, shake: 0 };
    w.addHitstop = (t) => { felt.stop = Math.max(felt.stop, t); };

    const p = thrower(w);
    p.camera = { addShake: (v) => { felt.shake = Math.max(felt.shake, v); } };
    BOONS.find(b => b.id === 'saberthrow').apply(p);
    p.throwState = 'flying';
    p.throwPos.set(0, 1.25, 0);
    p.throwVel.set(0, 0, -26);
    p.throwTimer = 0;
    for (let i = 0; i < 30 && !took.length; i++) p._updateThrow(1 / 60, { particles: null });

    assert(took.length === 1, `World._applyBladeEvent produced ${took.length} cuts from one pass`);
    const { ev, source } = took[0];
    assert(source === p, 'the cut was not credited to the thrower');
    assert(ev.bone && ev.cap && isFinite(ev.cutT) && ev.point && ev.impulse && ev.normal,
      `the event is missing fields: ${JSON.stringify(Object.keys(ev))}`);
    assert(ev.cutT >= 0.06 && ev.cutT <= 0.94, `cutT ${ev.cutT} is outside a limb`);
    assert(p.limbsRemoved === 1 && p.score === 60,
      `the cut did not go through the scoring path: ${p.limbsRemoved} limbs, ${p.score} points`);
    // CLEAVE.speed exists to land on the heavy side of the hitstop step, which
    // World._applyBladeEvent puts at 20 m/s. If that step moves, the number has
    // to move with it, and this is what says so.
    assert(CLEAVE.speed > 20, `CLEAVE.speed ${CLEAVE.speed} is under the hitstop step`);
    assert(felt.stop === 0.055, `a cleave produced a ${felt.stop} s hitstop, not the heavy one`);
    assert(felt.shake === 0.3, `a cleave kicked the camera ${felt.shake}, not the cut ceiling`);
    return `cut ${ev.bone} at t=${ev.cutT.toFixed(2)}, credited ${p.score} points and ${p.limbsRemoved} limb, `
      + `${felt.stop} s hitstop and ${felt.shake} shake`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  4. Tab                                                            */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: every registered action is handled by something', async () => {
    // The mirror of feel.mjs's check, which catches an action the game reads
    // but never registered. This catches the opposite and rarer one: an action
    // in the table, in the options screen and in the Codex that no code reads.
    // `scoreboard` sat there for the whole of v1.
    // The whole tree, not a hand-kept list: a list would have to be extended
    // every time a control moved file, and the check would go green for the
    // wrong reason the first time somebody forgot.
    const { readdir } = await import('node:fs/promises');
    const files = [];
    const walk = async (dir, prefix) => {
      for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
        const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
        if (e.isDirectory()) await walk(u, prefix + e.name + '/');
        else if (e.name.endsWith('.js')) files.push([prefix + e.name, await readFile(u, 'utf8')]);
      }
    };
    await walk(src(''), '');

    const readers = new Map();
    for (const [path, text] of files) {
      for (const m of text.matchAll(/\.act(?:Hit)?\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
        if (!readers.has(m[1])) readers.set(m[1], []);
        readers.get(m[1]).push(path);
      }
    }
    // moveF..moveR come through Input.moveAxis, which names every one of them.
    const dead = ACTION_IDS.filter(id => !readers.has(id));
    assert(!dead.length,
      `bound, listed and handled by nobody: ${dead.join(', ')} — every one is a key that does nothing`);
    assert(readers.get('scoreboard').includes('main.js'),
      `the scoreboard is read in ${readers.get('scoreboard').join(', ')}, not where the overlay lives`);
    return `${ACTION_IDS.length} actions read across ${files.length} files, none dead; `
      + `scoreboard in ${readers.get('scoreboard').join(', ')}`;
  });

  check('controls: everything that drives a frame closes the input frame', async () => {
    /**
     * THE ENDLESS SPIN.
     *
     * `Input` accumulates `mouse.dx/dy` from every mousemove and clears them in
     * `end()`. It is a per-frame delta, consumed exactly once. A loop that
     * reads it and never calls `end()` therefore does not read "how far the
     * mouse moved this frame" — it reads how far the mouse has moved since the
     * page opened, and yaws by that amount every frame. The camera accelerates
     * into a spin nothing can stop, which is precisely what the cel-shading
     * meadow shipped as, and it was reported as unusable and nauseating.
     *
     * `end()` also clears `pressed`/`released`, so the same omission re-fires
     * every one-shot action — jump, ignite, throw — on every frame.
     *
     * It is a contract, not a convention, so it is checked as one across the
     * whole tree rather than in main.js alone. Anything that hands an Input to
     * a world update owns both halves of the frame.
     */
    const { readdir } = await import('node:fs/promises');
    const files = [];
    const walk = async (dir, prefix) => {
      for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
        if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) continue;
        const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
        if (e.isDirectory()) await walk(u, prefix + e.name + '/');
        else if (/\.(js|html)$/.test(e.name)) files.push([prefix + e.name, await readFile(u, 'utf8')]);
      }
    };
    await walk(new URL('../../', import.meta.url), '');

    /*
     * Whoever CONSTRUCTS an Input owns its frame, and that is the test — not
     * "who calls a world update", which matches World.js's own signature and
     * every object it forwards the input to. There are exactly two owners
     * today, main.js and the toon meadow, and the second one is the one that
     * shipped broken.
     */
    const drivers = files.filter(([, t]) => /\bnew\s+Input\s*\(/.test(t));
    assert(drivers.length >= 2,
      `only ${drivers.length} Input owners found — the pattern this check scans for has moved and it is now looking at nothing`);
    const half = [];
    for (const [path, text] of drivers) {
      const b = /\binput\.begin\s*\(/i.test(text), e = /\binput\.end\s*\(\s*\)/i.test(text);
      if (!b || !e) half.push(`${path} (${b ? 'begin' : 'no begin'}, ${e ? 'end' : 'NO END'})`);
    }
    assert(!half.length,
      `drives a frame without closing the input frame: ${half.join(', ')} — `
      + 'the mouse delta never clears, so the camera spins faster every frame');
    return `${drivers.length} Input owners, all closing the frame: ${drivers.map(([p]) => p).join(', ')}`;
  });

  check('controls: the scoreboard overlay exists and Tab is what opens it', async () => {
    const html = await read('index.html');
    const main = await read('src/main.js');
    for (const id of ['scoreboard', 'score-stats', 'score-boons', 'score-roster']) {
      assert(html.includes(`id="${id}"`), `index.html has no #${id} for the scoreboard to fill`);
    }
    assert(/getElementById\('scoreboard'\)/.test(main), 'main.js never looks the overlay up');
    assert(/act\('scoreboard'\)/.test(main), 'main.js never reads the scoreboard action');
    // It must not be wired to a raw key code — that is how it would stop being
    // rebindable, which is the state four other actions were rescued from.
    assert(!/code\s*===\s*'Tab'\s*\)\s*\{?\s*set/.test(main), 'the scoreboard is driven off a raw Tab');
    const b = defaultBindings();
    assert(b.scoreboard.includes('Tab'), `the scoreboard defaults to ${b.scoreboard.join('+')}, and the Codex says Tab`);
    assert(ACTIONS.find(a => a.id === 'scoreboard').hold, 'the scoreboard is documented as a hold and is not marked hold');
    // The overlay prints the key you hold to see it, so that label has to come
    // from the binding. A typed "Tab" is a lie the moment anybody rebinds it.
    assert(html.includes('id="score-key"'), 'the overlay has no slot for the live key label');
    assert(/keyLabel\(\s*\(input\.bindings\.scoreboard/.test(main),
      'the scoreboard prints a hardcoded key instead of the one it is bound to');
    return `#scoreboard filled from act('scoreboard'), default ${b.scoreboard.join('+')}, hold, label from the binding`;
  });

  check('controls: no shipped default binds one key to two actions', () => {
    // The shipped table had `thrust: ['Mouse2']` and `hurl: ['Mouse2']`. A
    // fresh profile therefore had one button firing two things, and the options
    // screen could not say so, because findConflict only ever looked at the key
    // you were TYPING — never at the table it was typing into.
    const clash = conflicts(defaultBindings());
    assert(!clash.length, 'the shipped defaults bind one key to two actions: '
      + clash.map(c => `${c.code} → ${c.ids.join(' + ')}`).join('; ')
      + ' — no rebind can separate them');
    const b = defaultBindings();
    let n = 0;
    for (const id of ACTION_IDS) n += b[id].length;
    return `${ACTION_IDS.length} actions, ${n} bound keys, no key answered by two`;
  });

  check('controls: the rebinder settles EVERY clash, not the first one', () => {
    // Reproduce the shipped state — Mouse2 on two actions — through
    // _buildBindings.finish()'s own logic, which is: ask the resolver, then
    // write the key. Both victims are given a spare so that "could not settle"
    // is never the reason either version leaves a duplicate behind.
    const doubled = () => {
      const b = defaultBindings();
      b.thrust = ['Mouse2', 'KeyU']; b.hurl = ['Mouse2', 'KeyI'];
      return b;
    };

    const old = doubled();
    // what finish() used to do, verbatim
    const first = findConflict(old, 'Mouse2', 'dash');
    const rest = old[first].filter(k => k !== 'Mouse2');
    if (rest.length) old[first] = rest;
    old.dash = ['Mouse2'];
    const left = conflicts(old);
    assert(left.length > 0,
      'the single-clash path was supposed to leave a duplicate behind and did not — '
      + 'this check no longer reproduces the bug it exists for');

    const now = doubled();
    const res = resolveConflicts(now, 'Mouse2', 'dash');
    now.dash = ['Mouse2'];
    assert(!conflicts(now).length,
      `after settling, Mouse2 still answers to ${conflicts(now).map(c => c.ids.join('+')).join(', ')}`);
    assert(res.taken.length === 2 && !res.refused.length,
      `both victims had a spare, so both should give the key up, not ${JSON.stringify(res)}`);
    assert(now.thrust.length === 1 && now.hurl.length === 1, 'a victim lost more than the clashing key');

    // An action down to its LAST key keeps it and is reported, rather than
    // being silently muted — the one thing worse than a duplicate.
    const last = defaultBindings();
    const r3 = resolveConflicts(last, 'KeyF', 'view');
    assert(r3.refused.includes('push') && last.push.includes('KeyF'),
      'an action on its last key was left unbound');
    return `first-only left ${left.map(c => c.ids.join('+')).join(', ')}; `
      + 'resolveConflicts clears all of them and refuses to mute an action';
  });

  check('controls: the dojo steps lessons through the bindings table, not off raw keys', async () => {
    const main = await read('src/main.js');
    // The exact shape that shipped, beside a table that had just been given
    // stasis on B and rend on N so the collision could be SEEN.
    for (const [code, verb] of [['KeyN', 'skip'], ['KeyB', 'back'], ['KeyY', 'repeat']]) {
      const re = new RegExp(`code\\s*===\\s*'${code}'[^\\n]*\\.${verb}\\(`);
      assert(!re.test(main), `main.js still steps the lesson off a raw ${code}`);
    }
    for (const [id, verb] of [['lessonNext', 'skip'], ['lessonBack', 'back'], ['lessonRepeat', 'repeat']]) {
      assert(ACTION_IDS.includes(id), `${id} is not in the bindings table, so it cannot be rebound`);
      const re = new RegExp(`act(?:Hit)?\\('${id}'\\)[^\\n]*\\.${verb}\\(`);
      assert(re.test(main), `${id} is registered but nothing calls director.${verb}()`);
      assert(typeof DojoDirector.prototype[verb] === 'function',
        `DojoDirector.${verb} is gone — ${id} has nothing to drive`);
    }
    // And the keys they got must not be the keys of anything else, in a fresh
    // profile OR after the Force powers moved: that was the whole bug.
    const b = defaultBindings();
    for (const id of ['lessonNext', 'lessonBack', 'lessonRepeat']) {
      for (const code of b[id]) {
        const other = findConflict(b, code, id);
        assert(!other, `${id} defaults to ${code}, which ${other} also answers to`);
      }
    }
    // The coach panel's legend has to come from the table too — index.html
    // shipped `N next / B back / R etry with Y` baked into the markup.
    assert(/coach-keys/.test(main) && /keyLabel\(/.test(main),
      'the coach panel still prints hardcoded keys instead of the bound ones');
    return `lesson nav on ${['lessonNext', 'lessonBack', 'lessonRepeat'].map(i => b[i][0]).join('/')}, `
      + 'read as actions, legend from the bindings';
  });

  check('controls: one key press, one action — through the real Input', () => {
    // Not a source scan. A real Input, with the shipped bindings, fed the key
    // the way tools/smoke.mjs feeds the live game, and asked which actions
    // answer. With a fresh profile KeyB used to answer `stasis` AND run
    // director.back(), and KeyN `rend` AND director.skip() — two systems, one
    // press, and nothing in the table able to say so.
    const input = new Input({ addEventListener() {}, requestPointerLock() {} });
    const answers = (code) => {
      input.keys.clear(); input.pressed.clear();
      input.buttons.fill(false); input.buttonPressed.fill(false);
      if (code.startsWith('Mouse')) {
        const i = Object.keys(MOUSE).find(k => MOUSE[k] === code);
        input.buttons[i] = true; input.buttonPressed[i] = true;
      } else { input.keys.add(code); input.pressed.add(code); }
      return ACTION_IDS.filter(id => input.actHit(id) || input.act(id));
    };
    const doubled = [];
    for (const id of ACTION_IDS) {
      for (const code of input.bindings[id]) {
        const who = answers(code);
        if (who.length > 1) doubled.push(`${code} → ${who.join(' + ')}`);
      }
    }
    assert(!doubled.length, `one press, two systems: ${doubled.join('; ')}`);
    // and the three keys the dojo took answer to the dojo and to nothing else
    for (const id of ['lessonNext', 'lessonBack', 'lessonRepeat']) {
      const who = answers(input.bindings[id][0]);
      assert(who.length === 1 && who[0] === id,
        `${input.bindings[id][0]} answers to ${who.join(' + ')}, not just ${id}`);
    }
    assert(answers('KeyB').join() === 'stasis', 'KeyB still answers to more than the stasis field');
    assert(answers('KeyN').join() === 'rend', 'KeyN still answers to more than rend');
    let n = 0;
    for (const id of ACTION_IDS) n += input.bindings[id].length;
    return `${n} bound keys driven through Input, every one answered by exactly one action`;
  });

  check('controls: the training blade slider moves the blade that is in your hand', async () => {
    // The panel said "length is read when the blade is built — a change lands
    // on your next Ignite". It landed nowhere: hooks.onBladeLength was declared
    // in Menu and implemented in nothing.
    const saber = new Saber(new THREE.Scene(), { bladeLength: 1.15 });
    const before = saber.bladeLength;
    // main.js's hook, exactly as written there
    const hook = (v) => { const w = { player: { saber } }; if (w?.player?.saber) w.player.saber.bladeLength = v; };
    hook(4.0);
    assert(saber.bladeLength === 4.0, `the slider moved the blade from ${before} to ${saber.bladeLength}`);
    // and it has to be LIVE, i.e. the length the frame reads must follow —
    // Saber.update recomputes `len = bladeLength * ignition` every frame
    saber.lit = true;
    for (let i = 0; i < 120; i++) saber.update(1 / 60, i / 60);
    const tip = saber.tip.distanceTo(saber.base);
    assert(tip > 3.6, `after re-igniting at 4 m the blade measures ${tip.toFixed(3)} m`);
    hook(1.15);
    for (let i = 0; i < 120; i++) saber.update(1 / 60, 2 + i / 60);
    const back = saber.tip.distanceTo(saber.base);
    assert(back < 1.25, `after dragging back to 1.15 m the blade measures ${back.toFixed(3)} m`);

    const main = await read('src/main.js');
    assert(/onBladeLength\s*:/.test(main), 'main.js declares no onBladeLength — the hook is inert again');
    const menu = await readFile(src('ui/Menu.js'), 'utf8');
    assert(/hooks\.onBladeLength\?\.\(/.test(menu), 'the training slider no longer calls the hook');
    // The panel must not promise the OLD behaviour either. It is live now.
    assert(!/lands on your\s*\n?\s*next Ignite/.test(menu),
      'the panel still says the change lands on your next Ignite');
    return `1.15 → 4.00 m live (tip ${tip.toFixed(2)} m), and back to ${back.toFixed(2)} m`;
  });

  check('controls: the pause training sliders show exactly where they bite', async () => {
    // `s.level === 'dojo'` showed them for all eleven lessons; Dojo.inSandbox
    // is the one lesson that reads them.
    const main = await read('src/main.js');
    assert(/inSandbox/.test(main), 'main.js never asks the dojo whether this lesson is the sandbox');
    const menu = await readFile(src('ui/Menu.js'), 'utf8');
    assert(!/const live = this\.s\.mode === 'sandbox' \|\| this\.s\.level === 'dojo'/.test(menu),
      'showPause is gated on the level name again');
    assert(/showPause\(stats, sandboxLive\)/.test(menu), 'showPause no longer takes the live answer');

    // And the predicate main.js computes has to agree with the director on
    // every lesson, not just on the name of the level.
    const lessons = (await import('../../src/game/Dojo.js')).LESSONS;
    const inSandbox = lessons.map(L => !!L.setup?.sandbox);
    const n = inSandbox.filter(Boolean).length;
    assert(n >= 1, 'no lesson is the sandbox room at all');
    assert(n < lessons.length, 'every lesson is the sandbox room — the gate would be meaningless');
    assert(/sandboxRoomLive/.test(main), 'main.js has no single place that answers the question');
    return `${lessons.length} lessons, ${n} read the training numbers; the pause card asks the director`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  5. Nothing in the menu may be decorative                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: every column of the quality table is read by named code', async () => {
    const cols = Object.keys(QUALITY.low);
    for (const tier of Object.keys(QUALITY)) {
      const mine = Object.keys(QUALITY[tier]).sort().join(',');
      assert(mine === cols.slice().sort().join(','), `tier ${tier} does not have the same columns as low`);
    }
    const listed = Object.keys(QUALITY_READERS);
    const dead = cols.filter(c => !listed.includes(c));
    assert(!dead.length, `quality columns nothing in src/ reads: ${dead.join(', ')} — `
      + 'the tier promises something and delivers the tier above it');
    const stale = listed.filter(c => !cols.includes(c));
    assert(!stale.length, `QUALITY_READERS names columns that are gone: ${stale.join(', ')}`);

    // Same rule as SETTING_READERS: the declaration has to be TRUE, and the
    // expression has to actually mention the column. The manifest itself is cut
    // out of whatever file it is searched in, so an entry cannot satisfy itself
    // — this file is one of the files it names nothing in, but the next round's
    // move of the table into Engine.js must not quietly turn it green.
    const strip = (text) => {
      const a = text.indexOf('const QUALITY_READERS = {');
      if (a < 0) return text;
      const b = text.indexOf('\n};', a);
      return b < 0 ? text.slice(0, a) : text.slice(0, a) + text.slice(b);
    };
    const missing = [];
    for (const [col, [file, expr]] of Object.entries(QUALITY_READERS)) {
      assert(expr.includes(col), `the reader declared for ${col} does not mention it: ${expr}`);
      const text = await readFile(src(file), 'utf8').then(strip, () => null);
      if (text === null) { missing.push(`${col} → ${file} does not exist`); continue; }
      if (!text.includes(expr)) missing.push(`${col} → ${file} no longer contains \`${expr}\``);
    }
    assert(!missing.length, missing.join('; '));

    // And World must not have grown a second, private ladder beside it. That is
    // what it had: `{ low: 0.55, medium: 0.8, high: 1, ultra: 1.25 }`, inline,
    // deciding terrain and atmosphere while Engine's own table decided nothing.
    // Comments stripped first — the comment that RECORDS the old ladder is not
    // the old ladder, and a check that cannot tell the two apart would make
    // explaining the fix impossible.
    const world = (await readFile(src('game/World.js'), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert(!/\{\s*low\s*:\s*[\d.]/.test(world),
      'World.js has an inline quality ladder again — one value, one home');
    assert(/QUALITY\[this\.settings\.quality\]/.test(world),
      'World.js no longer reads the tier off Engine\'s table');
    return `${cols.length} columns (${cols.join(', ')}), every one with a named reader`;
  });

  check('controls: the quality tier actually changes the particle and grass budgets', () => {
    // The measurement the Performance card rests on. Built through the real
    // constructors at the real tiers, with the player's own multipliers left at
    // 1 so what is being measured is the TIER.
    const tiers = ['low', 'medium', 'high', 'ultra'];
    const scene = new THREE.Scene();
    const terrain = new Terrain(scene, 'dunes', 1);
    const rows = tiers.map((t) => {
      const q = QUALITY[t];
      const p = new Particles(scene, 1 * q.particles);
      const g = new GrassField(scene, terrain, { count: Math.round(11000 * q.grass), density: 1, radius: 46 });
      const row = { t, pooled: p.stats().pools, chips: p.chips.max, decals: p.decals.max, blades: g.count };
      p.dispose(); g.dispose?.();
      return row;
    });
    for (let i = 1; i < rows.length; i++) {
      assert(rows[i].pooled > rows[i - 1].pooled,
        `${rows[i].t} pools ${rows[i].pooled} particles, ${rows[i - 1].t} pools ${rows[i - 1].pooled}`);
      assert(rows[i].blades > rows[i - 1].blades,
        `${rows[i].t} plants ${rows[i].blades} blades, ${rows[i - 1].t} plants ${rows[i - 1].blades}`);
    }
    // The tabled spread, minus whatever the pools' own floors take back. It was
    // 1.00 on both — 19,800 particles and 11,000 blades at low exactly as at
    // ultra — which is what makes a bare "> the tier below" too weak to pin it.
    const pSpread = rows[3].pooled / rows[0].pooled;
    const gSpread = rows[3].blades / rows[0].blades;
    assert(pSpread > 2.9, `particles spread only ${pSpread.toFixed(2)}× across the four tiers`);
    assert(gSpread > 5.5, `grass spreads only ${gSpread.toFixed(2)}× across the four tiers`);
    // And the player's own slider must still multiply the tier rather than
    // replace it — `particleScale ?? q` made the tier structurally unreachable.
    const half = new Particles(scene, 0.5 * QUALITY.ultra.particles);
    assert(half.stats().pools < rows[3].pooled,
      'halving particleScale did not thin the tier — the slider is replacing it, not scaling it');
    half.dispose();
    terrain.dispose?.();
    return rows.map(r => `${r.t} ${r.pooled}p/${r.blades}g`).join('  ')
      + `  (${pSpread.toFixed(2)}× / ${gSpread.toFixed(2)}×)`;
  });

  check('controls: every setting in DEFAULT_SETTINGS is read by named code', async () => {
    const keys = Object.keys(DEFAULT_SETTINGS);
    const listed = Object.keys(SETTING_READERS);
    const unlisted = keys.filter(k => !listed.includes(k));
    assert(!unlisted.length,
      `no reader declared for: ${unlisted.join(', ')} — a setting that does nothing is a lie to the player`);
    const stale = listed.filter(k => !keys.includes(k));
    assert(!stale.length, `SETTING_READERS names settings that no longer exist: ${stale.join(', ')}`);

    // And the declaration has to be TRUE: the named file must contain the named
    // expression, and the expression must actually mention the setting.
    //
    // The table itself is cut out of whatever file it is searched in first, and
    // that is not a detail. The manifest lives in Menu.js and two entries point
    // back at Menu.js, so a plain substring search over that file is satisfied
    // by the entry's own text: delete the gate and the check still passes. Left
    // in, this check would have been exactly the kind of thing it exists to
    // catch — reads correctly, proves nothing.
    const strip = (text) => {
      const a = text.indexOf('export const SETTING_READERS = {');
      if (a < 0) return text;
      const b = text.indexOf('\n};', a);
      return b < 0 ? text.slice(0, a) : text.slice(0, a) + text.slice(b);
    };
    const cache = new Map();
    const missing = [];
    for (const [key, [file, expr]] of Object.entries(SETTING_READERS)) {
      assert(expr.includes(key), `the reader declared for ${key} does not mention it: ${expr}`);
      if (!cache.has(file)) cache.set(file, await readFile(src(file), 'utf8').then(strip, () => null));
      const text = cache.get(file);
      if (text === null) { missing.push(`${key} → ${file} does not exist`); continue; }
      if (!text.includes(expr)) missing.push(`${key} → ${file} no longer contains \`${expr}\``);
    }
    assert(!missing.length, missing.join('; '));
    return `${keys.length} settings, ${new Set(listed.map(k => SETTING_READERS[k][0])).size} reader files, all verified`;
  });

  check('controls: every control in the menu is bound to a setting', async () => {
    // The other half of the same lie. A setting with no reader does nothing;
    // a CONTROL with no setting does nothing either, and _slider and _check
    // both return quietly when the element they were given is not there — so a
    // renamed id in index.html silently unbinds a slider with no error at all.
    const html = await read('index.html');
    const menu = await readFile(src('ui/Menu.js'), 'utf8');
    const ids = new Set([
      ...[...html.matchAll(/id="(opt-[a-z0-9-]+)"/g)].map(m => m[1]),
      ...[...menu.matchAll(/id="(opt-[a-z0-9-]+)"/g)].map(m => m[1]),   // built in JS
    ]);
    const bound = [...menu.matchAll(/_(?:slider|check)\('(opt-[a-z0-9-]+)',\s*'([A-Za-z0-9_]+)'/g)]
      .map(m => [m[1], m[2]]);
    // The pickers (scheme, quality, deflect aim, opponent) are not one input
    // each, so they are looked up by id and write their setting by hand.
    const custom = new Set([
      ...[...menu.matchAll(/getElementById\('(opt-[a-z0-9-]+)'\)/g)].map(m => m[1]),
      ...[...menu.matchAll(/querySelector\('#(opt-[a-z0-9-]+)'\)/g)].map(m => m[1]),
    ]);

    const wired = new Set([...bound.map(([, key]) => key), 'sandboxType', 'scheme', 'quality', 'deflectAim', 'unlimitedBlade']);
    const orphan = [...ids].filter(id => !bound.some(([bid]) => bid === id) && !custom.has(id));
    assert(!orphan.length, `controls bound to nothing: ${orphan.join(', ')}`);

    const ghosts = bound.filter(([id]) => !ids.has(id)).map(([id, key]) => `${id} (${key})`);
    assert(!ghosts.length,
      `bound to an element that does not exist — _slider/_check return silently: ${ghosts.join(', ')}`);

    const unknown = bound.map(b => b[1]).filter(k => !(k in DEFAULT_SETTINGS));
    assert(!unknown.length, `controls writing settings that have no default: ${unknown.join(', ')}`);
    // and the two that started this: their box must exist AND carry a hook
    for (const [id, key] of [['opt-shake', 'shake'], ['opt-slowmo', 'slowmo']]) {
      assert(html.includes(`id="${id}"`), `${id} is gone from the options screen`);
      const re = new RegExp(`_check\\('${id}',\\s*'${key}',\\s*[^)]`);
      assert(re.test(menu), `${id} is bound to ${key} with no onChange — that is how it died the first time`);
    }
    return `${ids.size} controls, ${bound.length} slider/checkbox bindings + ${custom.size} pickers, ${wired.size} settings written`;
  });

  check('controls: every boon changes the player, and every change has a reader', async () => {
    // A REAL Player prototype, not a bag of fields. A boon whose effect is a
    // technique rather than a number has nothing to install on a plain object,
    // and would read as "changes nothing" against one — which is how a card
    // that lies passes a test that only inspects numbers.
    const base = () => {
      const p = thrower(targetsWorld(0));
      p.boonMods.absorb = false;
      Object.assign(p, { maxHp: 100, hp: 100, maxStamina: 100, stamina: 100 });
      p.control.deadzone = 0.24;
      p.control.sensitivity = 1;
      return p;
    };

    // Sources, minus the BOONS table itself: a boon that "reads" its own flag
    // only where it writes it is exactly the bug being fenced off here.
    const waves = await readFile(src('game/Waves.js'), 'utf8');
    const elsewhere = [
      waves.slice(0, waves.indexOf('export const BOONS = [')),
      await readFile(src('game/Player.js'), 'utf8'),
      await readFile(src('game/World.js'), 'utf8'),
      await readFile(src('game/Duel.js'), 'utf8'),
      await readFile(src('ui/HUD.js'), 'utf8'),
    ].join('\n');

    /**
     * What a key is worth when a boon has NOT set it — the `?? x` the reader
     * falls back to. Makashi's disease: World reads
     * `boonMods.riposteWindow ?? 1` and the card's "ripostes last twice as
     * long" set it to 1.0. The identity. The field changed, the window did not,
     * and every check that only diffs fields went green.
     */
    const fallback = (k) => {
      const m = elsewhere.match(new RegExp(`boonMods\\??\\.${k}\\s*\\?\\?\\s*(-?[0-9.]+)`));
      return m ? parseFloat(m[1]) : undefined;
    };

    const inert = [], unread = [], identity = [];
    for (const b of BOONS) {
      const before = base(), after = base();
      b.apply(after);
      const touched = [];
      for (const k of Object.keys(after.boonMods)) {
        if (after.boonMods[k] !== before.boonMods[k]) touched.push(k);
      }
      // Numbers are the easy half. A boon whose effect is a TECHNIQUE leaves no
      // number behind at all — it installs something on the instance — so an
      // own-key diff has to count too, or the one boon that was a lie would be
      // the one boon this check could not see.
      const was = new Set(Object.keys(before));
      const other = Object.keys(after).some(k => !was.has(k))
        || [...was].some(k => typeof before[k] !== 'object' && after[k] !== before[k])
        || after.control.deadzone !== before.control.deadzone
        || after.control.sensitivity !== before.control.sensitivity
        || after.saber.bladeLength !== before.saber.bladeLength
        || after.saber.coreWidth !== before.saber.coreWidth;
      if (!touched.length && !other) inert.push(b.id);
      for (const k of touched) {
        const re = new RegExp(`boonMods\\??\\.${k}\\b`);
        if (!re.test(elsewhere)) unread.push(`${b.id} → boonMods.${k}`);
        if (before.boonMods[k] === undefined) {
          const fb = fallback(k);
          if (fb !== undefined && after.boonMods[k] === fb) {
            identity.push(`${b.id} → boonMods.${k} = ${fb}, which is what the reader already assumes`);
          }
        }
      }
    }
    assert(!inert.length, `boons that change nothing at all: ${inert.join(', ')}`);
    assert(!unread.length,
      `boonMods nothing outside the boon table reads: ${unread.join(', ')} — the card promises what the code never does`);
    assert(!identity.length, `boons written to their own identity value: ${identity.join('; ')}`);
    return `${BOONS.length} boons, all change the player, all changes read elsewhere, none written to identity`;
  });

  check('controls: Cleaving Throw is wired to a seam that still exists', () => {
    // The technique wraps Player._updateThrow, which is the only seam the throw
    // has. Rename it in Player.js and this fails, instead of the boon silently
    // going back to being a card that lies.
    assert(typeof Player.prototype._updateThrow === 'function',
      'Player._updateThrow is gone — Cleaving Throw has nothing to wrap');
    // Through apply(), which is what the draft screen calls — not through
    // cleavingThrow directly. A boon that stops CALLING its own technique is
    // exactly as dead as one that never had it.
    const p = thrower(targetsWorld(0));
    const stock = p._updateThrow;
    BOONS.find(b => b.id === 'saberthrow').apply(p);
    assert(p._updateThrow !== stock, 'taking the card changed nothing about the throw');
    assert(p.boonMods.throwPierce === true, 'the card reports itself dead after being taken');
    const q = thrower(targetsWorld(0));
    assert(cleavingThrow(q) === true, 'the technique refused to install on a real Player');
    // and it declines cleanly on something that is not a player, rather than
    // pretending it worked
    assert(cleavingThrow({}) === false, 'the technique claimed to install on an object with no throw');
    return `wrapped ${Player.prototype._updateThrow.name || '_updateThrow'}, recall ×${CLEAVE.recall}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Residue: one value, two homes                                     */
  /* ══════════════════════════════════════════════════════════════════ */

  check('controls: no player-facing surface types a key name', async () => {
    // The residue of the rebind that moved Hurl off Mouse2 — where it had
    // shipped colliding with Thrust — onto Y. main.js was taught to print the
    // coach panel's legend from the bindings; the Codex grid, seventeen rows of
    // markup in index.html, was not. Sixteen of those rows agreed with
    // defaultBindings(); the seventeenth told a player on a fresh profile
    // "M2 to hurl it", and M2 thrusts. A typed key cannot follow a rebind, so
    // the rule is that no key name is typed at all.
    const html = await read('index.html');
    const typed = [...html.matchAll(/<kbd>([^<]*)<\/kbd>/g)].map(m => m[1]);
    assert(!typed.length,
      `index.html types ${typed.length} key names into the markup (${typed.join(', ')}) — `
      + 'markup cannot read the bindings table');
    for (const id of ['codex-grid', 'pause-hints']) {
      assert(html.includes(`id="${id}"`), `#${id} is gone, so nothing can fill it from the bindings`);
    }

    // The exact row, stated as arithmetic against the shipped table.
    const b = defaultBindings();
    const rowOf = (markup, re) =>
      [...markup.matchAll(/<div>([\s\S]*?)<span>([\s\S]*?)<\/span><\/div>/g)].find(r => re.test(r[2]));
    const chips = (s) => [...s.matchAll(/<kbd>([^<]*)<\/kbd>/g)].map(m => m[1]);
    const grip = rowOf(codexHtml(b), /Grip an object/);
    assert(grip, 'the Codex no longer has a row about gripping an object');
    const inline = chips(grip[2]);
    assert(inline.length === 1 && inline[0] === keyLabel(b.hurl[0]),
      `the grip row says ${inline.join('/') || 'nothing'} hurls, and hurl answers to `
      + `${b.hurl.map(keyLabel).join('+')}`);
    assert(b.thrust.includes('Mouse2') && !b.hurl.includes('Mouse2'),
      'Mouse2 no longer thrusts, so the row this check exists for is measuring something else now');

    // EVERY action, and by REBINDING rather than by reading a declaration:
    // move one action onto a key nothing else uses, re-render, and the Codex
    // has to start saying so. An action the Codex never mentions cannot pass,
    // and neither can a row that prints a name instead of a binding — which is
    // the only way this can be satisfied by typing, and it cannot.
    const PROBE = 'F13';
    const silent = [];
    for (const id of ACTION_IDS) {
      const probe = defaultBindings();
      probe[id] = [PROBE];
      if (!new RegExp(`<kbd>(?:Hold )?${PROBE}</kbd>`).test(codexHtml(probe))) silent.push(id);
    }
    assert(!silent.length,
      `the Codex never prints the live binding for: ${silent.join(', ')} — either the action is `
      + 'documented nowhere a player reads, or the row prints a typed name');
    // Named because they are the two that were invented and then documented
    // nowhere at all, and a generic message would not say so.
    for (const id of ['stance', 'flourish']) {
      assert(ACTION_IDS.includes(id) && !silent.includes(id),
        `${id} exists as a binding and appears on no screen the player reads`);
    }
    // The pause card is the same surface with two rebindable keys on it.
    for (const id of ['view', 'scoreboard']) {
      const probe = defaultBindings();
      probe[id] = [PROBE];
      assert(pauseHintsHtml(probe).includes(`<kbd>${PROBE}</kbd>`),
        `the pause card prints a typed key for ${id}`);
    }
    // A row may only name actions that exist; a renamed id must fail loudly
    // rather than render a dash.
    const ghosts = CODEX.flatMap(r => r.keys || []).filter(id => !ACTION_IDS.includes(id));
    assert(!ghosts.length, `the Codex names actions that are not in the table: ${ghosts.join(', ')}`);

    // The other direction, and the one that closes the hole the probe above
    // leaves: a row could still TYPE "M2" into its prose while some other row
    // printed thrust's real binding, and every assertion so far would pass. So
    // bind every action to a code of its own, render once, and require that
    // every <kbd> on the page came out of the table. The only survivors are the
    // declared literals — the mouse's own motion, which is not a binding, and
    // Esc, which main.js handles raw so that pausing survives a broken one.
    const all = defaultBindings();
    ACTION_IDS.forEach((id, i) => { all[id] = [`PROBE${i}`]; });
    const mint = new Set(ACTION_IDS.map((_, i) => `PROBE${i}`));
    const strays = chips(codexHtml(all)).map(t => t.replace(/^Hold /, ''))
      .filter(t => !mint.has(t) && t !== 'Mouse');
    assert(!strays.length,
      `key names in the Codex that did not come from the bindings table: ${[...new Set(strays)].join(', ')}`);
    const pauseStrays = chips(pauseHintsHtml(all)).map(t => t.replace(/^Hold /, ''))
      .filter(t => !mint.has(t) && t !== 'Esc');
    assert(!pauseStrays.length,
      `key names on the pause card that did not come from the table: ${[...new Set(pauseStrays)].join(', ')}`);
    // The control-scheme cards, which named Mouse2's default as "RMB" while
    // describing what is really `!input.act('thrust')`.
    const schemeStrays = SCHEMES.flatMap(s => chips(s.blurb(id => keyChips(all, id))))
      .filter(t => !mint.has(t));
    assert(!schemeStrays.length,
      `key names on the control-scheme cards that did not come from the table: ${[...new Set(schemeStrays)].join(', ')}`);
    for (const s of SCHEMES) {
      assert(/<kbd>/.test(s.blurb(id => keyChips(b, id))),
        `the ${s.name} card describes a control and names no key at all`);
    }
    // And the boon cards are a player-facing surface too: "Unlocks lightning on
    // Z" was a key name typed into a run reward.
    const named = BOONS.filter(x =>
      /\b(?:on|press|pressing|hold|holding|with) [A-Z0-9]\b|\bM[1-5]\b|\bMouse ?[1-5]\b/.test(x.text));
    assert(!named.length, `boon cards that type a key name: ${named.map(x => x.id).join(', ')}`);
    return `${CODEX.length} rows, ${ACTION_IDS.length}/${ACTION_IDS.length} actions printed from the table, `
      + `0 typed <kbd> in index.html; grip row prints ${inline[0]} and hurl is ${b.hurl.map(keyLabel).join('+')}`;
  });

  check('controls: Focusing Crystal reaches the blade, not just a field on it', () => {
    // `p.saber.coreWidth *= 1.25` moved a number that only the Saber
    // CONSTRUCTOR had ever read — uWidth/uRadius in _buildBlade, trailThickness
    // in _buildTrail — so on a blade already in the player's hand the card's
    // three promises came to one. Measured, not asserted: the uniforms, and
    // then the thing the uniforms are supposed to be for, which is the geometry
    // that actually gets drawn.
    const cam = new THREE.PerspectiveCamera();
    const s = new Saber(new THREE.Scene(), { coreWidth: 1 });
    s.ignite(); s.ignition = 1;
    const swing = (n) => {
      for (let i = 0; i < n; i++) {
        s.root.rotation.z = Math.sin(i * 0.4) * 1.2;
        s.root.updateMatrixWorld(true);
        s.update(1 / 60, { camera: cam });
      }
    };
    /**
     * The DRAWN channel. The uniform moving is not the same claim as the smear
     * getting wider: _updateTrail offsets sheet k by `(k - 1) * trailThickness`
     * along the sweep normal, so the distance between the outer two sheets is
     * the slab a player can see. A check that only read the field would pass on
     * a build where nothing consumed it — which is the bug being fixed.
     */
    const drawnSlab = () => {
      const p = s.trailPos;
      let max = 0;
      for (let i = 0; i < s.trailSegments; i++) {
        const a = (i * s.trailSheets) * 2 * 3;
        const c = (i * s.trailSheets + s.trailSheets - 1) * 2 * 3;
        const d = Math.hypot(p[a] - p[c], p[a + 1] - p[c + 1], p[a + 2] - p[c + 2]);
        if (d > max) max = d;
      }
      return max / 2;
    };
    swing(30);
    const before = {
      w: s.bladeMat.uniforms.uWidth.value.clone(),
      r: s.bladeMat.uniforms.uRadius.value,
      t: s.trailThickness,
      slab: drawnSlab(),
    };
    assert(before.slab > 1e-4, 'the trail drew nothing, so the drawn channel is not being measured');

    // Through the card, the way the draft screen takes it.
    BOONS.find(x => x.id === 'dualcrystal').apply({ saber: s, boonMods: { cutPower: 1 } });
    swing(60);
    const after = {
      w: s.bladeMat.uniforms.uWidth.value.clone(),
      r: s.bladeMat.uniforms.uRadius.value,
      t: s.trailThickness,
      slab: drawnSlab(),
    };
    const k = 1.25;
    for (const [name, a, b0] of [['uWidth.x', after.w.x, before.w.x], ['uWidth.y', after.w.y, before.w.y],
      ['uWidth.z', after.w.z, before.w.z], ['uRadius', after.r, before.r],
      ['trailThickness', after.t, before.t], ['drawn slab', after.slab, before.slab]]) {
      assert(Math.abs(a / b0 - k) < 0.001,
        `${name} went ${b0.toFixed(5)} → ${a.toFixed(5)} (${(a / b0).toFixed(3)}×), and the card is worth ${k}×`);
    }
    // Both directions: a width that only ever grows is a latch, not a setting,
    // and the forge slider drives the same accessor downwards.
    s.coreWidth = 1;
    assert(Math.abs(s.bladeMat.uniforms.uRadius.value - before.r) < 1e-9,
      'putting the width back did not put the uniform back');
    // The forge builds a fresh Saber per drag, so construction must still land.
    const wide = new Saber(new THREE.Scene(), { coreWidth: 1.6 });
    assert(Math.abs(wide.bladeMat.uniforms.uRadius.value - Saber.PROFILE.radius * 1.6) < 1e-9,
      'opts.coreWidth no longer reaches the uniforms at construction');

    // The general rule, so the next boon to write a number onto the blade
    // cannot land in a field nobody reads: any boon that moves a saber field
    // has to move something the blade DRAWS.
    const dead = [];
    for (const boon of BOONS) {
      const t = new Saber(new THREE.Scene(), {});
      t.ignite(); t.ignition = 1;
      for (let i = 0; i < 20; i++) t.update(1 / 60, { camera: cam });
      const fields = () => `${t.bladeLength}/${t.coreWidth}`;
      const drawn = () => `${t.bladeMat.uniforms.uWidth.value.toArray().join(',')}|`
        + `${t.bladeMat.uniforms.uRadius.value}|${t.bladeMat.uniforms.uLen.value}|${t.trailThickness}`;
      const f0 = fields(), d0 = drawn();
      boon.apply({
        saber: t, control: {}, maxHp: 100, hp: 100,
        boonMods: new Proxy({}, { get: (o, key) => (key in o ? o[key] : 1), set: (o, key, v) => (o[key] = v, true) }),
      });
      for (let i = 0; i < 60; i++) t.update(1 / 60, { camera: cam });
      if (fields() !== f0 && drawn() === d0) dead.push(boon.id);
    }
    assert(!dead.length,
      `boons that write a number onto the blade and change nothing it draws: ${dead.join(', ')}`);
    return `uWidth ${before.w.y.toFixed(4)}→${after.w.y.toFixed(4)}, uRadius ${before.r.toFixed(3)}→${after.r.toFixed(3)}, `
      + `drawn slab ${before.slab.toFixed(4)}→${after.slab.toFixed(4)} m (all 1.250×)`;
  });

  check('controls: every setting has a control, not only a reader', async () => {
    // The other direction of "every control is bound to a setting", and the one
    // that was never asserted. `grassScale` and `particleScale` were keys of
    // DEFAULT_SETTINGS with real readers in World.loadLevel, no opt- id in
    // index.html and no _slider anywhere — pinned at 1 forever, while World's
    // own comment described "the player's own two sliders". `bladeHold` was the
    // same lie facing the other way: World.spawnPlayer read
    // `this.settings.bladeHold` into a per-frame controller flag and there was
    // no such setting and no such box.
    const menu = await readFile(src('ui/Menu.js'), 'utf8');
    const html = await read('index.html');
    const bound = new Map([...menu.matchAll(/_(?:slider|check)\('(opt-[a-z0-9-]+)',\s*'([A-Za-z0-9_]+)'/g)]
      .map(m => [m[2], m[1]]));
    /**
     * The settings that are PICKED rather than slid — cards, swatches and
     * radio lists, one element per option. Not a free pass: each one still has
     * to be written by hand somewhere in this file, which is asserted below, so
     * a setting cannot join this list without a control writing it.
     */
    const PICKED = ['level', 'difficulty', 'mode', 'colorIndex', 'hiltStyle', 'robeIndex',
      'sandboxType', 'scheme', 'quality', 'deflectAim', 'unlimitedBlade',
      'skinIndex', 'hairIndex', 'order', 'species', 'face', 'robeCut'];
    const orphans = [], ghost = [];
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (bound.has(key)) {
        assert(html.includes(`id="${bound.get(key)}"`) || menu.includes(`id="${bound.get(key)}"`),
          `${key} is bound to #${bound.get(key)}, which is in no markup — _slider returns silently`);
        continue;
      }
      if (!PICKED.includes(key)) { orphans.push(key); continue; }
      // `_swatchRow('skin-list', 'skinIndex', ...)` names the key at the control
      // site just as explicitly as `this.s.skinIndex =` does — it is the same
      // guarantee through a shared helper, so the vocabulary widens and the
      // property does not: a setting still cannot reach this list without a
      // control that writes it BY NAME.
      const re = new RegExp(`this\\.s\\.${key}\\s*=|_set\\('${key}'|_swatchRow\\('[a-z-]+', '${key}'|_cardRow\\('[a-z-]+', '[a-z-]+', '${key}'`);
      if (!re.test(menu)) ghost.push(key);
    }
    assert(!orphans.length,
      `settings with a reader and no control: ${orphans.join(', ')} — the player cannot move them, `
      + 'so they are pinned at their default forever');
    assert(!ghost.length, `listed as picked, but nothing in the menu writes them: ${ghost.join(', ')}`);
    // and the three this check was written for
    for (const [key, id] of [['grassScale', 'opt-grass'], ['particleScale', 'opt-particles'], ['bladeHold', 'opt-bladehold']]) {
      assert(bound.get(key) === id, `${key} is bound to ${bound.get(key) || 'nothing'}, expected #${id}`);
      assert(html.includes(`id="${id}"`), `#${id} is not on the options screen`);
    }
    return `${Object.keys(DEFAULT_SETTINGS).length} settings: ${bound.size} on sliders/checkboxes, `
      + `${PICKED.length} on pickers, 0 with no control`;
  });

  check('controls: the two fidelity sliders multiply the tier and bite mid-run', async () => {
    // A control that exists is not the same claim as a control that does
    // something. Driven through World.prototype.applyQuality — the real reader,
    // and the seam the slider's hook fires — with a real Particles pool.
    const scene = new THREE.Scene();
    const w = { settings: { quality: 'high', particleScale: 1 }, particles: new Particles(scene, QUALITY.high.particles),
      applyQuality: World.prototype.applyQuality };
    const full = w.particles.scale;
    w.settings.particleScale = 0.5;
    w.applyQuality('high');
    const half = w.particles.scale;
    assert(Math.abs(half / full - 0.5) < 1e-6,
      `halving the slider took emission from ${full} to ${half}, not half of it`);
    // It must MULTIPLY the tier, not replace it: at the same slider position,
    // Performance has to stay under Cinematic.
    w.settings.particleScale = 1.5;
    w.applyQuality('low');
    const lowMax = w.particles.scale;
    w.applyQuality('ultra');
    const ultraMax = w.particles.scale;
    assert(lowMax < ultraMax,
      `Performance at 150% emits ${lowMax} and Cinematic at 150% emits ${ultraMax} — the slider is replacing the tier`);
    // Grass is planted at level load, so the slider scales the DENSITY the
    // level asks for. Asserted on the expression, because the field it feeds is
    // an allocation and rebuilding it needs a level.
    const world = await readFile(src('game/World.js'), 'utf8');
    assert(/density:\s*\(this\.settings\.grassScale \?\? 1\) \* L\.grass/.test(world),
      'grassScale no longer multiplies the level density');
    assert(/const particleScale = \(this\.settings\.particleScale \?\? 1\) \* q\.particles/.test(world),
      'particleScale no longer multiplies the tier');
    return `slider 1.0→0.5 takes emission ${full.toFixed(2)}→${half.toFixed(2)}; `
      + `at 1.5, low ${lowMax.toFixed(2)} < ultra ${ultraMax.toFixed(2)}`;
  });

  check('controls: movement is read from the table and from nowhere else', () => {
    // Input.moveAxis carried `|| this.down('ArrowUp')` and three more like it.
    // That is a second set of movement bindings that ACTIONS never knew about,
    // so with the shipped defaults ArrowUp fired NO action, drove moveAxis.y to
    // 1, and findConflicts reported the key free. Bind anything to an arrow and
    // one press did two things, with no way for the options screen to warn —
    // the KeyB/KeyN bug, still alive underneath the fix for it.
    const fresh = () => new Input({ addEventListener() {}, requestPointerLock() {} });
    const b = defaultBindings();
    const hidden = [];
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Numpad8', 'Numpad2', 'Numpad4', 'Numpad6', 'KeyI', 'KeyK', 'KeyJ', 'KeyL']) {
      const i = fresh();
      i.keys.add(code); i.pressed.add(code);
      const acts = ACTION_IDS.filter(id => i.act(id) || i.actHit(id));
      const ax = i.moveAxis();
      const moves = ax.x !== 0 || ax.y !== 0;
      if (moves && !acts.length) hidden.push(`${code} → moveAxis(${ax.x},${ax.y}) with no action and no conflict`);
      if (!acts.length) {
        assert(!findConflicts(b, code).length,
          `${code} fires no action but findConflicts claims ${findConflicts(b, code).join('+')}`);
      }
    }
    assert(!hidden.length, `keys that move the player without being in the table: ${hidden.join('; ')}`);

    // The table still drives movement, and an arrow key is now an ORDINARY key
    // — bind it and it walks, and the conflict machinery can see it.
    const w = fresh();
    w.keys.add('KeyW');
    assert(w.moveAxis().y === 1, 'W no longer walks forward');
    const arrows = defaultBindings();
    arrows.moveF = ['KeyW', 'ArrowUp'];
    const a = fresh();
    a.setBindings(arrows);
    a.keys.add('ArrowUp');
    assert(a.moveAxis().y === 1, 'ArrowUp bound to moveF does not walk');
    assert(findConflicts(arrows, 'ArrowUp').join() === 'moveF',
      'a bound arrow key is invisible to findConflicts');
    // One press, one system: with push moved onto ArrowUp, the arrow must push
    // and NOT also walk.
    const clash = defaultBindings();
    clash.push = ['ArrowUp'];
    const c = fresh();
    c.setBindings(clash);
    c.keys.add('ArrowUp'); c.pressed.add('ArrowUp');
    assert(c.moveAxis().y === 0,
      'rebinding onto an arrow key still walks as well — the second binding is still there');
    return 'moveAxis reads moveF/moveB/moveL/moveR and the stick, nothing else; '
      + '4 arrows + 4 numpad + IJKL fire nothing and move nothing';
  });

  check('controls: no gameplay reads a raw key code or a raw device', async () => {
    // The rule the arrows broke, stated once for the whole tree. A raw
    // `down('KeyX')` is not in ACTIONS, so it cannot be rebound, cannot be
    // shown, and cannot be seen to collide — every version of this bug this
    // project has had (B/N in Player, B/N/Y in main.js, the arrows in Input)
    // was one of these.
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const files = ['engine/Input.js', 'game/Player.js', 'game/SaberController.js', 'game/World.js', 'game/Enemy.js'];
    const raw = [];
    for (const f of files) {
      const body = strip(await readFile(src(f), 'utf8'));
      for (const m of body.matchAll(/\.(?:down|hit|up|anyDown)\((\s*'[^']+'[^)]*)\)/g)) {
        raw.push(`${f}: .${m[0].slice(1)}`);
      }
    }
    assert(!raw.length, `raw key codes read past the bindings table: ${raw.join('; ')}`);

    // ── the same rule for the DEVICES, which is where the last one was hiding.
    //
    // The check above only ever looked at key codes, so the wheel sailed past
    // it for the whole of v1: SaberController spent it on wrist roll and Player
    // spent it on grip distance, neither was in ACTIONS, and the collision could
    // only be resolved by Player physically stealing the field
    // (`input.mouse.wheel = 0`) before the blade could read it. A device read is
    // exactly as unrebindable as a key code and this now says so.
    //
    // ONE exception, named and bounded rather than pattern-matched away:
    // Player's grip distance still reads the wheel raw. It is a continuous
    // magnitude (notches of hold distance), not a press, so it is not an ACTION
    // in the shape ACTIONS describes — putting it in the table would mean
    // inventing analogue bindings. It is listed here so it is visible and so a
    // SECOND one cannot appear beside it unremarked.
    const ALLOWED = new Set(['game/Player.js']);
    const devices = [], excused = [];
    for (const f of files) {
      const body = strip(await readFile(src(f), 'utf8'));
      for (const m of body.matchAll(/\binput\.mouse\.(wheel|buttons)\b|\binput\.(?:buttons|buttonPressed)\s*\[/g)) {
        (ALLOWED.has(f) ? excused : devices).push(`${f}: ${m[0]}`);
      }
    }
    assert(!devices.length,
      `raw device reads past the bindings table: ${devices.join('; ')} — `
      + 'a wheel notch or a mouse button read this way cannot be rebound and cannot be seen to collide');
    return `${files.length} gameplay files, 0 raw key-code reads, `
      + `0 unexcused raw device reads (${excused.length} excused: ${excused.join(', ') || 'none'})`;
  });

  check('controls: every damage() call site matches the signature', async () => {
    // The third distinct bug this one method has produced. The signature is
    // (amount, point, source, kind); Player._land shipped
    // `this.damage(clamp(...), null, 'fall')` — three arguments, so `source`
    // received the string 'fall' and `kind` received undefined, while
    // Enemy.js's identical fall-damage line has always passed four. Nothing
    // threw, because a string is a perfectly good value for a parameter nobody
    // dereferences until somebody does.
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const args = (s) => {
      const out = []; let depth = 0, cur = '';
      for (const ch of s) {
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        if (ch === ')' || ch === ']' || ch === '}') depth--;
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };
    const files = ['game/Player.js', 'game/Enemy.js', 'game/World.js', 'game/Duel.js'];
    const bad = [], kinds = new Set();
    let sites = 0;
    for (const f of files) {
      const body = strip(await readFile(src(f), 'utf8'));
      for (const m of body.matchAll(/(\w+)\.damage\(([^;]*?)\);/g)) {
        const list = args(m[2]);
        // Props take (amount, point, dir) and are a different class with a
        // different third parameter, so they are identified by their receiver
        // rather than by arity — `pr` and `prop` are the only names used.
        if (/^(pr|prop)$/.test(m[1])) continue;
        sites++;
        if (list.length < 3 || list.length > 4) {
          bad.push(`${f}: ${m[1]}.damage(${m[2]}) has ${list.length} arguments`);
          continue;
        }
        // A string in the SOURCE slot is the bug, exactly.
        if (/^'[^']*'$/.test(list[2])) {
          bad.push(`${f}: ${m[1]}.damage(…) passes ${list[2]} as \`source\`, which takes an entity — `
            + 'it belongs in `kind`, and `kind` is then undefined');
        }
        if (list.length === 4) {
          if (!/^'[^']*'$/.test(list[3])) bad.push(`${f}: \`kind\` is ${list[3]}, which is not a string literal`);
          else kinds.add(list[3]);
        }
      }
    }
    assert(!bad.length, bad.join('; '));
    // Fall damage specifically, on both sides, because that is where it went
    // wrong and Enemy is the version that was always right.
    for (const f of ['game/Player.js', 'game/Enemy.js']) {
      const body = strip(await readFile(src(f), 'utf8'));
      const line = [...body.matchAll(/\w+\.damage\(([^;]*?)\);/g)].find(m => /'fall'/.test(m[1]));
      assert(line, `${f} no longer deals fall damage`);
      const list = args(line[1]);
      assert(list.length === 4 && list[3] === "'fall'",
        `${f} calls damage(${line[1]}) — 'fall' must be the fourth argument, \`kind\``);
    }

    // And through the real code, not only the source: _land with a killing
    // impact, recording what Player.damage is handed.
    const rec = [];
    const body = Object.assign(Object.create(Player.prototype), {
      position: new THREE.Vector3(), cloak: null, camera: { addShake() {} },
      boonMods: { repulse: false }, _shockwave() {},
      damage(...a) { rec.push(a); return false; },
    });
    body._land({ particles: null, terrain: null }, 40);
    assert(rec.length === 1, 'a 40 m/s landing dealt no fall damage at all');
    const [amount, point, source, kind] = rec[0];
    assert(Number.isFinite(amount) && amount > 0, `fall damage was ${amount}`);
    assert(point === null, `fall damage passed ${point} as the impact point`);
    assert(source === null || typeof source === 'object',
      `fall damage passed ${JSON.stringify(source)} as \`source\`, which every other call site fills with an entity`);
    assert(kind === 'fall', `fall damage reported kind ${JSON.stringify(kind)}`);
    return `${sites} damage() call sites across ${files.length} files, kinds ${[...kinds].sort().join(' ')}; `
      + `_land → (${amount.toFixed(1)}, null, null, 'fall')`;
  });

  check('controls: a world knob that never moves is not a knob', async () => {
    // `this.hpScale = 1` and `this.dmgScale = 1` sat in the World constructor,
    // were read by Enemy as `A.hp * (world.hpScale ?? 1)`, and were written by
    // nothing else anywhere — no difficulty, no mode, no wave, no control. A
    // value written once to the identity of the operation it feeds is a claim
    // that a knob exists. Enemy's `?? 1` is what keeps the seam open, so
    // deleting the write costs nothing and stops the claim.
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const world = strip(await readFile(src('game/World.js'), 'utf8'));
    const all = (await Promise.all(['game/World.js', 'game/Waves.js', 'game/Player.js', 'game/Enemy.js', 'main.js']
      .map(f => readFile(f === 'main.js' ? new URL('../../src/main.js', import.meta.url) : src(f), 'utf8'))))
      .map(strip).join('\n');
    const idle = [];
    for (const m of world.matchAll(/this\.(\w+)\s*=\s*1\s*;/g)) {
      const name = m[1];
      // Anything written again, to anything other than 1, is a live knob.
      const moved = new RegExp(`(?:this|world|w)\\.${name}\\s*=\\s*(?!1\\s*;)`, 'g');
      const hits = [...all.matchAll(moved)];
      if (!hits.length) idle.push(name);
    }
    assert(!idle.length,
      `written once, to 1, and moved by nothing: ${idle.join(', ')} — `
      + 'either give it a writer or let its reader default it');
    for (const name of ['hpScale', 'dmgScale']) {
      assert(!new RegExp(`this\\.${name}\\s*=`).test(world),
        `World writes ${name} again — if that write is real it must not be the identity`);
      const enemy = await readFile(src('game/Enemy.js'), 'utf8');
      assert(new RegExp(`world\\.${name}\\s*\\?\\?\\s*1`).test(enemy),
        `Enemy no longer defaults ${name}, so removing the constructor write would break it`);
    }
    return 'no World field is written once to its own identity; hpScale/dmgScale default in Enemy';
  });

  check('controls: Blade holds position is a setting, a box, and a live flag', () => {
    // SaberController.holdPosition has been read every frame since it was
    // written, World.spawnPlayer has always read `this.settings.bladeHold` into
    // it, and there was no such key in DEFAULT_SETTINGS and no box anywhere:
    // the reader read undefined forever. The structural half is covered by
    // "every setting has a control"; this is the behavioural half.
    assert('bladeHold' in DEFAULT_SETTINGS, 'bladeHold is not a setting');
    assert(DEFAULT_SETTINGS.bladeHold === false, 'blade-holds-position now defaults to ON');
    const w = { players: [{ control: { holdPosition: false } }], hitstop: 0, addHitstop() {} };
    applyFeelSettings(w, { ...DEFAULT_SETTINGS, bladeHold: true });
    assert(w.players[0].control.holdPosition === true,
      'ticking the box does not reach a player already in the world — it would land on the next deploy');
    applyFeelSettings(w, { ...DEFAULT_SETTINGS, bladeHold: false });
    assert(w.players[0].control.holdPosition === false, 'unticking the box does not reach the player');
    // The flag has to still mean something at the far end.
    assert(new SaberController().holdPosition === false, 'the controller no longer starts off');
    return 'bladeHold: default off, checkbox #opt-bladehold, pushed live onto every player by applyFeelSettings';
  });
}
