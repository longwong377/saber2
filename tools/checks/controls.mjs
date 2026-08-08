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
import { DEFAULT_SETTINGS, SETTING_READERS, applyFeelSettings } from '../../src/ui/Menu.js';
import { BOONS, CLEAVE, cleavingThrow } from '../../src/game/Waves.js';
import { ACTIONS, ACTION_IDS, defaultBindings } from '../../src/engine/Bindings.js';

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

  /* ══════════════════════════════════════════════════════════════════ */
  /*  5. Nothing in the menu may be decorative                          */
  /* ══════════════════════════════════════════════════════════════════ */

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
}
