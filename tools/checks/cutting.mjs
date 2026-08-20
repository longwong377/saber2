/**
 * BATTLEFRONT BORZ — does a slash do anything?
 *
 * The player's report was "the saber does no damage to 90% of the stuff in the
 * arena, you can be right in front of an enemy and slash them and it appears to
 * do nothing." Two defects behind it, and NOTHING in 452 checks covered either:
 *
 *   1. `grind` — every contact that failed to sever — spawned slag particles
 *      and returned. No hp, no hitmarker, no hitstop, no score. A slash either
 *      took a limb off or was cosmetic, with nothing in between.
 *
 *   2. Severance needed `toughness / 2.4` metres of blade travel while in
 *      contact: 0.625 m for a trooper, 0.83 m for a droid limb, 1.88 m for
 *      armour. A pass through a capsule only gives you its chord — 0.36 m for a
 *      torso, 0.12 m for a forearm. So nothing above flesh could be severed by
 *      slashing at all, only by pressing the blade in and holding it.
 *
 * These are the checks that would have caught both. They drive the real
 * BladeContactSolver with a real Saber against real capsules; nothing here
 * reimplements the model it is testing.
 */
import * as THREE from 'three';
import { BladeContactSolver, TOUGHNESS, cutNeed } from '../../src/game/Combat.js';
import { Saber } from '../../src/game/Saber.js';
import { clocked } from './_shared.mjs';

const scene = new THREE.Scene();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * A capsule standing in for a limb, lying ACROSS the blade's path (along Z) at
 * chest height. The axis matters: the first version of this laid the capsule
 * along the same axis the blade travelled, so a "slash" was really the blade
 * being dragged through lengthwise, staying in contact for its own length and
 * parting plastoid at 3 m/s. A slash crosses; it does not drag.
 */
function limb(name, r, tough, extra = {}) {
  return { name, p0: V(0, 1.2, -0.25), p1: V(0, 1.2, 0.25), r, toughness: tough, ...extra };
}

/**
 * Sweep a lit blade horizontally through `cap` at `speed`, one pass, and report
 * what the solver emitted. The blade is moved by setHiltPose exactly as the
 * game moves it, so `speedAt` sees a real velocity rather than a planted one.
 */
function pass(cap, speed, { dt = 1 / 60, span = 1.2, target = {} } = {}) {
  const solver = new BladeContactSolver();
  const saber = new Saber(scene, { length: 1.3 });
  saber.lit = true; saber.ignition = 1;
  // Blade upright, hilt below the capsule, travelling in X — so it sweeps
  // across the limb rather than along it.
  const q = new THREE.Quaternion();
  const tgt = { id: 't', capsules: [cap], dead: false, ...target };
  const seen = { grind: 0, cut: 0, clang: 0 };
  let work = 0, frames = 0;
  const steps = Math.ceil(span / (speed * dt));
  for (let i = 0; i <= steps; i++) {
    saber.setHiltPose(V(-span / 2 + i * speed * dt, 0.55, 0), q);
    saber.update(dt, i * dt);
    for (const e of solver.solve(saber, [tgt], dt, {})) {
      seen[e.type] = (seen[e.type] || 0) + 1;
      if (e.type === 'grind') { work += e.dWork; frames++; }
      if (e.type === 'cut') return { ...seen, severed: true, work, frames };
    }
  }
  return { ...seen, severed: false, work, frames };
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped: the two shared streams are put on
   * their modules' own seeds before each body and the wind clock is put back
   * after it. See tools/checks/_shared.mjs — the rule is there, not here.
   */
  check = await clocked(check);
  check('cutting: one committed slash parts a trooper, a droid and armour', () => {
    const rows = [];
    for (const [what, r, tough, speed] of [
      ['flesh forearm', 0.06, TOUGHNESS.flesh, 12],
      ['trooper torso', 0.18, TOUGHNESS.plastoid, 14],
      ['droid torso', 0.18, TOUGHNESS.droid, 16],
      ['B2 torso', 0.21, TOUGHNESS.armour, 26],
    ]) {
      const r1 = pass(limb('t', r, tough), speed);
      rows.push(`${what} @${speed} ${r1.severed ? 'CUT' : 'no'}`);
      assert(r1.severed, `${what} survived a ${speed} m/s slash — this is the whole defect`);
    }
    return rows.join(', ');
  });

  check('cutting: a slow press still only grinds, and heavy plate resists a slash', () => {
    // The patient-blast-door model has to survive the fix. A blade laid on and
    // pushed slowly must NOT part a trooper on the first pass…
    const slow = pass(limb('t', 0.18, TOUGHNESS.plastoid), 3);
    assert(!slow.severed, `a 3 m/s press parted plastoid in one pass — the press/slash distinction is gone`);
    assert(slow.grind > 0, 'a slow press should be grinding, and emitted nothing');
    // …and no speed at all may slash through a walker's plating or a door.
    const heavy = pass(limb('t', 0.3, TOUGHNESS.heavy), 30);
    assert(!heavy.severed, 'a 30 m/s slash went through `heavy` — that is what makes Cleaving Throw worthless');
    const door = pass(limb('t', 0.3, TOUGHNESS.blastdoor), 40);
    assert(!door.severed, 'a blast door was slashed through');
    return `3 m/s on plastoid grinds (${slow.grind}), 30 m/s on heavy grinds, 40 m/s on a blast door grinds`;
  });

  check('cutting: a grind carries the numbers a damage path needs', () => {
    // The grind event used to carry `progress` and `speed` and nothing a caller
    // could turn into hp. World now reads dWork/need to deal the share of a
    // sever done this frame — if either goes missing the damage silently
    // becomes NaN or zero, which is the bug this suite exists for.
    const solver = new BladeContactSolver();
    const saber = new Saber(scene, { length: 1.3 });
    saber.lit = true; saber.ignition = 1;
    const q = new THREE.Quaternion();
    const cap = limb('chest', 0.18, TOUGHNESS.heavy);
    let ev = null;
    for (let i = 0; i < 30 && !ev; i++) {
      saber.setHiltPose(V(-0.3 + i * 0.02, 0.55, 0), q);
      saber.update(1 / 60, i / 60);
      ev = solver.solve(saber, [{ id: 't', capsules: [cap], dead: false }], 1 / 60, {})
        .find((e) => e.type === 'grind');
    }
    assert(ev, 'a blade on a heavy capsule produced no grind at all');
    assert(Number.isFinite(ev.dWork) && ev.dWork > 0, `grind.dWork is ${ev.dWork}`);
    assert(Number.isFinite(ev.need) && ev.need > 0, `grind.need is ${ev.need}`);
    assert(ev.need === cutNeed(cap), 'grind.need disagrees with cutNeed — two homes for one number');
    const share = ev.dWork / ev.need;
    assert(share > 0 && share <= 1, `a frame's share of a sever is ${share}`);
    return `dWork ${ev.dWork.toFixed(3)} of need ${ev.need} = ${(share * 100).toFixed(1)}% of a sever per frame`;
  });

  check('cutting: the same slash does the same work at 60 Hz and 144 Hz', () => {
    // Work is credited per frame while in contact, so the total across a pass
    // must not depend on how the pass was sliced. It is not exact — a frame
    // that only partly overlaps still banks its whole travel — so the bar is
    // "within a quarter", which is the difference between a real defect and
    // sampling noise.
    const cap = () => limb('t', 0.18, TOUGHNESS.heavy);
    const a = pass(cap(), 14, { dt: 1 / 60 });
    const b = pass(cap(), 14, { dt: 1 / 144 });
    const ratio = a.work / b.work;
    assert(ratio > 0.75 && ratio < 1.33,
      `60 Hz banked ${a.work.toFixed(2)} and 144 Hz ${b.work.toFixed(2)} — ${ratio.toFixed(2)}x for the same slash`);
    return `60 Hz ${a.work.toFixed(2)} over ${a.frames} frames, 144 Hz ${b.work.toFixed(2)} over ${b.frames} — ${ratio.toFixed(2)}x`;
  });

  check('cutting: parting one piece does not reset another piece of the same structure', () => {
    // Every destructible structure in a level reaches the solver through ONE
    // DestructionProxy sharing ONE id, so clearTarget's prefix sweep wiped the
    // grind progress on every column and wall in the level each time one cell
    // came away.
    const solver = new BladeContactSolver();
    solver.progress.set('proxy:cellA', 6);
    solver.progress.set('proxy:cellB', 9);
    solver.progress.set('crate7:body', 3);

    solver.clearTarget('proxy', 'cellA');
    assert(!solver.progress.has('proxy:cellA'), 'the cell that parted kept its work');
    assert(solver.progress.get('proxy:cellB') === 9,
      'parting one cell wiped a different cell of the same structure');

    // A real Prop IS gone when it is cut — replaced by halves with new ids — so
    // it still clears whole.
    solver.clearTarget('crate7');
    assert(!solver.progress.has('crate7:body'), 'a cut prop kept its work');
    return 'per-capsule clear leaves siblings alone; whole-target clear still works';
  });

  check('cutting: a kerf in stone does not heal, a wound does', () => {
    // Progress fades once the blade leaves, or a fight-long accumulation of
    // incidental touches takes a limb off by itself. Structures are exempt:
    // Destruction paints a widening kerf at fixed fractions of the same number,
    // and at a 0.4 s grace a column being worked on healed faster than it was
    // being cut — which is exactly what the column-grind check caught.
    //
    // The gap is spent calling solve with NO targets, which is what "the blade
    // is elsewhere" actually means. Parking the blade 9 m away and bringing it
    // back instead gives it a 540 m/s frame velocity, and a 540 m/s blade cuts
    // anything — the first version of this check did that and measured the
    // capsule being severed rather than its kerf healing.
    const work = (cap, idleFrames) => {
      const solver = new BladeContactSolver();
      const saber = new Saber(scene, { length: 1.3 });
      saber.lit = true; saber.ignition = 1;
      const q = new THREE.Quaternion();
      const tgt = { id: 't', capsules: [cap], dead: false };
      const key = 't:' + cap.name;
      const touch = (x) => {
        saber.setHiltPose(V(x, 0.55, 0), q);
        saber.update(1 / 60, solver.time);
        solver.solve(saber, [tgt], 1 / 60, {});
      };
      touch(-0.06); touch(-0.03);
      for (let i = 0; i < idleFrames; i++) solver.solve(saber, [], 1 / 60, {});
      touch(0);
      return solver.progress.get(key) || 0;
    };
    const stoneCap = () => limb('cell', 0.5, TOUGHNESS.heavy, { structure: {} });
    const fleshCap = () => limb('chest', 0.3, TOUGHNESS.heavy);
    const stoneNow = work(stoneCap(), 0), stoneLater = work(stoneCap(), 180);
    const fleshNow = work(fleshCap(), 0), fleshLater = work(fleshCap(), 180);
    assert(stoneLater >= stoneNow * 0.999,
      `a stone kerf healed over three seconds: ${stoneNow.toFixed(3)} → ${stoneLater.toFixed(3)}`);
    assert(fleshLater < fleshNow * 0.9,
      `flesh kept ${fleshLater.toFixed(3)} of ${fleshNow.toFixed(3)} across three seconds — nothing fades`);
    return `stone ${stoneNow.toFixed(3)} → ${stoneLater.toFixed(3)} (kept), `
      + `flesh ${fleshNow.toFixed(3)} → ${fleshLater.toFixed(3)} (faded)`;
  });

  check('cut: a blade held in a lock does not also dismember what it is locked with', async () => {
    /**
     * A LOCK OWNS BOTH BLADES, AND ONLY ONE OF THE TWO LOOPS KNEW IT.
     *
     * `World._resolveBlades` stands the ENEMY down for a locked duellist
     * (`if (e.lock) continue`), and `Enemy._saberStrike` stands down again
     * while the steel is crossed. The PLAYER's loop had neither guard, so the
     * blade went on being solved against the body it was locked with — and a
     * lock is won by driving the mouse hard, which is the same input that feeds
     * the solver. So the correct way to WIN a lock was also the way to take
     * your opponent apart for free while their blade was barred from answering.
     * Measured on the shipped build with both fighters locked and
     * `bladesTouching` true, over twelve frames: 1 cut billed, a forearm
     * severed, 20.63 hp of grind and +60 score.
     *
     * WHY NOTHING HERE SAW IT. Every other check in this file drives
     * `BladeContactSolver` directly — which is right for the model and blind to
     * the loop, and the loop is where the guard lives. This one goes through
     * the shipped `World._resolveBlades` and asserts about the till, not about
     * the contact: the blades really are touching and the solver really does
     * report, which is the setup half below.
     *
     * World.js is imported inside the check body, never at module scope —
     * HANDOFF §2.1.
     */
    const { World } = await import('../../src/game/World.js');
    const { bladesTouching } = await import('../../src/game/Combat.js');
    const blade = () => { const s = new Saber(scene, { length: 1.3 }); s.lit = true; s.ignition = 1; return s; };

    const run = (locked) => {
      const bill = { cuts: 0, grinds: 0, dmg: 0 };
      const ps = blade();
      const player = {
        alive: true, saber: ps, isLocal: false, team: 0, id: 'p', score: 0,
        limbsRemoved: 0, combo: 0, comboTimer: 0, position: V(0, 0, 0), chest: V(0, 1.35, 0),
        boonMods: { cutPower: 1, lifesteal: 0 }, addFlow() {}, heal() {},
        camera: { addShake() {}, pos: V(0, 1.4, 0) }, control: {}, lockState: null,
      };
      /* The control column carries NO blade. With one, `_applyClash` sees the
       * bind and builds a real BladeLock on the first frame, so "unlocked"
       * would be a lock two frames later and both columns would read clean.
       * Same sweep, same body, same solver — the only thing missing is the
       * steel that would have crossed. */
      const enemy = {
        id: 'e', dead: false, team: 1, hp: 150, maxHp: 150, position: V(0, 0, -1.6),
        A: { scale: 1 }, saber: locked ? blade() : null, lock: null, actor: null,
        capsules: () => [{ name: 'forearmL', p0: V(-0.35, 1.25, -1.5), p1: V(0.35, 1.25, -1.5),
          r: 0.07, toughness: TOUGHNESS.flesh, vital: 0.3 }],
        takeCut() { bill.cuts++; return true; },
        damage(a) { bill.dmg += a; bill.grinds++; return false; },
      };
      const w = Object.assign(Object.create(World.prototype), {
        players: [player], enemies: [enemy], props: [], doors: [], locks: [], _targets: [],
        bladeSolver: new BladeContactSolver(), rules: { friendlyFire: false }, time: 0,
        particles: { sparkBurst() {}, plasma: { spawn() {} }, slag() {}, cutFlare() {} },
        addHitstop() {}, onHitmark() {}, notifyFloating() {}, report() {}, _claim() {},
        engine: { flash() {} },
      });
      // the enemy's blade laid across the player's, which is what a bind IS
      const eq = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), -Math.PI / 2);
      if (enemy.saber) {
        enemy.saber.setHiltPose(V(-0.5, 1.5, -1.5), eq); enemy.saber.update(1 / 60, 0);
        enemy.saber.setHiltPose(V(-0.5, 1.5, -1.5), eq); enemy.saber.update(1 / 60, 1 / 60);
      }

      const q = new THREE.Quaternion();
      for (let i = 0; i < 12; i++) {
        ps.setHiltPose(V(-0.4 + (i % 8) * 0.1, 0.6, -1.5), q);   // driving the mouse hard
        ps.update(1 / 60, i / 60);
        w.time += 1 / 60;
        if (locked) { player.lockState = { done: false }; enemy.lock = player.lockState; }
        w._resolveBlades(1 / 60);
      }
      return { ...bill, touching: !!enemy.saber && bladesTouching(ps, enemy.saber),
        score: player.score, limbs: player.limbsRemoved };
    };

    const free = run(false), locked = run(true);
    assert(locked.touching,
      'the two blades are not even in contact — this scene is not a lock and proves nothing');
    assert(free.cuts > 0 || free.dmg > 0,
      `the same sweep with NO lock billed ${free.cuts} cuts and ${free.dmg.toFixed(2)} hp — the blade `
      + 'is not reaching the body at all, so the locked column would read clean for the wrong reason');
    assert(locked.cuts === 0 && locked.grinds === 0,
      `a blade in a lock still billed ${locked.cuts} cut(s), ${locked.dmg.toFixed(2)} hp of grind and `
      + `+${locked.score} score against the body it was locked with — the enemy loop stands down for a `
      + 'lock and the player loop did not, so driving the mouse to win the lock dismembers a fighter '
      + 'whose blade cannot answer');
    return `no lock: ${free.cuts} cut(s) / ${free.dmg.toFixed(1)} hp · locked: 0 / 0.0 with the blades touching`;
  });
}
