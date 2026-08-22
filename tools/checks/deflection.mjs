/**
 * BATTLEFRONT BORZ — can you actually BLOCK anything?
 *
 * Every existing deflection test grades a deflection that has already been
 * declared to happen. None of them asks the question the player asks, which is
 * whether the bolt and the blade meet at all. "It's almost impossible to block
 * lasers" is a statement about the CAPTURE WINDOW — how far off the bolt's line
 * you may place the blade and still intercept it — and until this file there was
 * no number for it.
 *
 * The window is measured, not asserted from the formula, because the formula is
 * only half the story: the test is a swept segment against a swept quad, so the
 * answer depends on where in the frame the two happen to cross, and a bolt that
 * moves 1 m per frame can straddle the blade without any single sample landing
 * near it.
 */

import * as THREE from 'three';
import { Saber } from '../../src/game/Saber.js';
import { intersectBladeSweep } from '../../src/game/Bolts.js';
import { DIFFICULTY } from '../../src/game/Combat.js';
import { SaberController } from '../../src/game/SaberController.js';
import { clocked } from './_shared.mjs';

const scene = new THREE.Scene();

function blade(opts = {}) {
  const s = new Saber(scene, { colorIndex: 0, bladeLength: opts.length ?? 1.15 });
  s.ignite();
  s.ignition = 1;
  return s;
}

/** Hold the blade at one pose for two frames, so prev→cur is a genuine (null) sweep. */
function hold(saber, pos, quat, dt = 1 / 60) {
  saber.valid = false;
  saber.setHiltPose(pos, quat);
  saber.update(dt, 0);
  saber.setHiltPose(pos, quat);
  saber.update(dt, dt);
  return saber;
}

/** Move the blade between two poses across one frame. */
function swing(saber, fromPos, fromQuat, toPos, toQuat, dt = 1 / 60) {
  saber.valid = false;
  saber.setHiltPose(fromPos, fromQuat);
  saber.update(dt, 0);
  saber.setHiltPose(toPos, toQuat);
  saber.update(dt, dt);
  return saber;
}

/**
 * Fire one bolt from `start` along `dir` and step it until it either meets the
 * blade or runs past it. Returns the frame it was caught on, or null.
 *
 * The blade is held still for the whole flight, which is the honest case: a
 * player who has already placed their guard and is waiting. A moving blade only
 * ever helps, so this is the floor of the window, not the ceiling.
 */
function fire(saber, start, dir, speed, dt = 1 / 60, frames = 90) {
  const pos = start.clone();
  const prev = start.clone();
  const step = dir.clone().normalize().multiplyScalar(speed * dt);
  for (let f = 0; f < frames; f++) {
    prev.copy(pos);
    pos.add(step);
    const hit = intersectBladeSweep(prev, pos, saber, null);
    if (hit) return { frame: f, bladeT: hit.bladeT };
    // past the blade and receding — stop rather than burn frames
    if (pos.z < saber.base.z - 4) return null;
  }
  return null;
}

/**
 * Bisect for the largest lateral offset that still intercepts. `axis` picks
 * which way we slide the bolt's line: 'x' is across the blade (the narrow
 * direction, set by the capture radius) and 'y' is along it (the wide
 * direction, set by the blade's length).
 */
function captureWindow(saber, mid, speed, axis, dt = 1 / 60) {
  const off = (d) => {
    const s = mid.clone();
    if (axis === 'x') s.x += d; else s.y += d;
    s.z += 30;
    return fire(saber, s, new THREE.Vector3(0, 0, -1), speed, dt);
  };
  if (!off(0)) return 0;                       // cannot even hit dead centre
  let lo = 0, hi = 0.02;
  while (hi < 4 && off(hi)) { lo = hi; hi *= 1.6; }
  for (let i = 0; i < 22; i++) {
    const mm = (lo + hi) / 2;
    if (off(mm)) lo = mm; else hi = mm;
  }
  return lo;
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  /* ── the window itself ─────────────────────────────────────────────── */

  check('block: a still blade has a capture window you can actually aim at', () => {
    const s = blade();
    hold(s, new THREE.Vector3(0, 1.35, 0), new THREE.Quaternion());
    const mid = s.pointAt(0.5, new THREE.Vector3());
    const across = captureWindow(s, mid, 40, 'x');
    const along = captureWindow(s, mid, 40, 'y');

    assert(across > 0, 'a bolt aimed straight down the blade line is not even caught');
    // A bolt is 5 cm across and the player is steering the guard with a mouse.
    // Under 8 cm of tolerance either side is sub-pixel aiming at range and is
    // what "impossible to block" feels like from the chair.
    assert(across >= 0.08,
      `capture window is +/-${(across * 100).toFixed(1)} cm across the blade — too fine to aim`);
    assert(along >= 0.45,
      `capture window is only +/-${(along * 100).toFixed(0)} cm along a ${(s.bladeLength * 100).toFixed(0)} cm blade`);
    return `+/-${(across * 100).toFixed(1)} cm across, +/-${(along * 100).toFixed(0)} cm along`;
  });

  /* ── speed must not shrink it ──────────────────────────────────────── */

  check('block: the window does not collapse as bolts get faster', () => {
    const s = blade();
    hold(s, new THREE.Vector3(0, 1.35, 0), new THREE.Quaternion());
    const mid = s.pointAt(0.5, new THREE.Vector3());
    const rows = [];
    let slowest = 0;
    for (const key of ['padawan', 'knight', 'master', 'grandmaster']) {
      const d = DIFFICULTY[key];
      if (!d) continue;
      // Enemy.js:734 — the tier number is a multiplier on the 88 m/s base bolt.
      const v = 88 * (d.boltSpeed ?? 1);
      const w = captureWindow(s, mid, v, 'x');
      rows.push(`${d.name} ${v} m/s -> +/-${(w * 100).toFixed(1)} cm`);
      if (!slowest) slowest = w;
      // A swept segment against a swept quad is speed-independent by
      // construction. If it is not, bolts are tunnelling and the sweep is a lie.
      assert(w >= slowest * 0.9,
        `${d.name}: window fell to +/-${(w * 100).toFixed(1)} cm from +/-${(slowest * 100).toFixed(1)} cm — bolts are tunnelling`);
    }
    assert(rows.length >= 2, 'no difficulty tiers carried a bolt speed');
    return rows.join(', ');
  });

  /* ── frame rate must not change the answer ─────────────────────────── */

  check('block: a 30 Hz frame does not let bolts through the blade', () => {
    const s60 = blade(); hold(s60, new THREE.Vector3(0, 1.35, 0), new THREE.Quaternion(), 1 / 60);
    const s30 = blade(); hold(s30, new THREE.Vector3(0, 1.35, 0), new THREE.Quaternion(), 1 / 30);
    const mid = s60.pointAt(0.5, new THREE.Vector3());
    const a = captureWindow(s60, mid, 62, 'x', 1 / 60);
    const b = captureWindow(s30, mid, 62, 'x', 1 / 30);
    assert(b >= a * 0.9,
      `at 30 Hz the window is +/-${(b * 100).toFixed(1)} cm against +/-${(a * 100).toFixed(1)} cm at 60 Hz — the sweep is sampling, not sweeping`);
    return `60 Hz +/-${(a * 100).toFixed(1)} cm, 30 Hz +/-${(b * 100).toFixed(1)} cm`;
  });

  /* ── a blade in motion must still catch ────────────────────────────── */

  check('block: a blade swung across the bolt catches it, not misses it', () => {
    // The guard sweeps 60 cm sideways in one frame — 36 m/s at the tip, a real
    // slash. The bolt crosses the middle of that sweep. If the test only sampled
    // the end poses this would miss, which is the classic fast-blade bug.
    const s = blade();
    const from = new THREE.Vector3(-0.30, 1.35, 0), to = new THREE.Vector3(0.30, 1.35, 0);
    swing(s, from, new THREE.Quaternion(), to, new THREE.Quaternion());
    const mid = s.pointAt(0.5, new THREE.Vector3());
    // aim at where the blade was mid-sweep, not where it ended
    const target = mid.clone(); target.x = 0;
    const hit = fire(s, target.clone().add(new THREE.Vector3(0, 0, 30)),
      new THREE.Vector3(0, 0, -1), 55);
    assert(hit, 'a bolt crossing the middle of a 36 m/s sweep was not caught');
    return `caught on frame ${hit.frame} at blade t=${hit.bladeT.toFixed(2)}`;
  });

  /* ── and must not catch what it has no business catching ───────────── */

  check('block: the blade does not catch bolts it never came near', () => {
    const s = blade();
    hold(s, new THREE.Vector3(0, 1.35, 0), new THREE.Quaternion());
    const mid = s.pointAt(0.5, new THREE.Vector3());
    for (const d of [1.0, 2.0, 4.0]) {
      const start = mid.clone(); start.x += d; start.z += 30;
      assert(!fire(s, start, new THREE.Vector3(0, 0, -1), 40),
        `a bolt passing ${d} m wide of the blade was "deflected"`);
    }
    return 'clean at 1 m, 2 m and 4 m';
  });

  /* ── the assist that is supposed to close the rest of the gap ──────── */

  /**
   * Fly one bolt at the chest and let the real assist work on a deliberately
   * wrong guard, exactly as Player.js drives it. Returns how much of the
   * original aiming error was closed and how far the guard still misses by.
   */
  const assistTrial = (tier, offDeg, fromM, dt = 1 / 60, scheme = 'hold') => {
    const d = DIFFICULTY[tier];
    const speed = 88 * d.boltSpeed;
    const chest = new THREE.Vector3(0, 1.35, 0);
    const aim = new THREE.Quaternion();          // looking down -Z
    // The scheme is NAMED rather than defaulted. `assist` now means "the share
    // of your error the tier forgives" in two schemes and the error is a
    // different quantity in each: a guard-AIMING error here, a guard-ZONE error
    // under 'directional' (tools/checks/directional.mjs measures that ladder in
    // degrees round the rose). Both are real and neither may quietly become the
    // other, so this file says which one it is measuring.
    const ctrl = new SaberController({ scheme });
    ctrl.assist = d.assist;
    ctrl.gx = (offDeg * Math.PI / 180) / ctrl.maxYaw;
    ctrl.gy = 0;
    const err0 = Math.abs(ctrl.gx);

    // The bolt runs straight down the aim axis, so the guard that intercepts it
    // is gx = gy = 0 and the whole error is in gx.
    const bolt = { pos: new THREE.Vector3(0, chest.y, -fromM), vel: new THREE.Vector3(0, 0, speed) };
    const R = 0.60;                              // guard sphere radius
    // Fixed DURATION, not a fixed end position: stepping until the bolt crosses
    // a plane quantises the flight differently at every dt, and that alone
    // moves the answer by a point or two — which would make the frame-rate
    // check below test the harness instead of the gain law.
    const flight = (fromM - R) / speed;
    const steps = Math.round(flight / dt);
    for (let i = 0; i < steps; i++) {
      bolt.pos.z = -fromM + speed * dt * (i + 1);
      const along = chest.z - bolt.pos.z;
      ctrl.applyAssist([{ bolt, eta: along / speed, point: bolt.pos, dist: along, offset: 0 }],
        chest, aim, dt);
    }
    const gd = ctrl.guardDir(aim, new THREE.Vector3());
    const gp = chest.clone().addScaledVector(gd, R);
    return {
      closed: 1 - Math.abs(ctrl.gx) / err0,
      missCm: Math.hypot(gp.x, gp.y - chest.y) * 100,
      flight: fromM / speed,
    };
  };

  // The capture window measured above. Kept as a literal so that if the blade
  // geometry changes, the first test fails loudly instead of this one quietly
  // moving its own goalposts.
  const WINDOW_CM = 12.5;

  check('assist: each tier closes the share of guard error it advertises, on the free-aim path', () => {
    const rows = [];
    for (const key of ['padawan', 'knight', 'master', 'grandmaster']) {
      const d = DIFFICULTY[key];
      const speed = 88 * d.boltSpeed;
      // Fire from exactly one ASSIST_LEAD out, which is the condition the tier
      // number is defined against: a full 0.9 s of approach.
      for (const scheme of ['hold', 'free']) {
        const r = assistTrial(key, 40, speed * 0.9, 1 / 60, scheme);
        assert(Math.abs(r.closed - d.assist) < 0.05,
          `${d.name} on "${scheme}" advertises ${(d.assist * 100).toFixed(0)}% `
          + `but closed ${(r.closed * 100).toFixed(1)}%`);
        if (scheme === 'hold') rows.push(`${d.name} ${(r.closed * 100).toFixed(0)}%`);
      }
      // …and the SAME tier number must not ALSO drag the guard under
      // 'directional', where it has already been spent on zone tolerance. Two
      // payments for one number is how a difficulty tier stops meaning
      // anything, and it would take the one choice this scheme asks the player
      // to make and make it for them.
      const dir = assistTrial(key, 40, speed * 0.9, 1 / 60, 'directional');
      assert(dir.closed === 0,
        `${d.name} closed ${(dir.closed * 100).toFixed(1)}% of the AIMING error under 'directional', `
        + 'where the same number has already bought zone tolerance');
    }
    return `${rows.join(', ')}; 'directional' closes 0% of aiming error on every tier`;
  });

  check('assist: a badly placed guard still blocks on the forgiving tiers', () => {
    // 34 m is the radius Player.js actually searches, so this is the best lead
    // the assist ever gets in the game rather than an idealised one.
    const rows = [];
    const pad = assistTrial('padawan', 40, 34);
    const kni = assistTrial('knight', 30, 34);
    const gm = assistTrial('grandmaster', 40, 34);
    rows.push(`Padawan 40° off -> ${pad.missCm.toFixed(1)} cm`);
    rows.push(`Knight 30° off -> ${kni.missCm.toFixed(1)} cm`);
    assert(pad.missCm <= WINDOW_CM,
      `Padawan promises the assist guides your guard, but 40° off still misses by ${pad.missCm.toFixed(1)} cm`);
    assert(kni.missCm <= WINDOW_CM,
      `Knight 30° off misses by ${kni.missCm.toFixed(1)} cm — outside the ±${WINDOW_CM} cm window`);
    // and the promise at the top must stay true in the other direction
    assert(gm.closed < 0.001,
      `Grandmaster advertises zero assist but closed ${(gm.closed * 100).toFixed(1)}%`);
    rows.push('Grandmaster untouched');
    return rows.join(', ');
  });

  check('assist: the same help arrives at 30, 60 and 144 Hz', () => {
    const rows = [];
    let ref = 0;
    for (const hz of [30, 60, 144]) {
      const r = assistTrial('knight', 40, 34, 1 / hz);
      rows.push(`${hz} Hz ${(r.closed * 100).toFixed(1)}%`);
      if (!ref) ref = r.closed;
      // The gain compounds as (1-k)^(T/dt) by construction, so the law itself is
      // exact. What is left is one frame of granularity: the assist stops inside
      // 0.4 m of the chest, and at 30 Hz the bolt's last step lands inside that
      // cutoff while at 144 Hz it does not, so the coarse rate pays out one
      // frame less. One 30 Hz frame is 4.4% of the error still outstanding,
      // which is about 1.5 points of the total — so the bar is 2 points, and
      // anything larger is the gain law drifting rather than the cutoff.
      // (The old formula was linear in dt under a hard cap and spread far wider.)
      assert(Math.abs(r.closed - ref) < 0.02,
        `frame rate changes the assist: ${(r.closed * 100).toFixed(1)}% at ${hz} Hz against ${(ref * 100).toFixed(1)}%`);
    }
    return rows.join(', ');
  });

  check('assist: bolts behind you do not drag the guard off the ones in front', () => {
    const chest = new THREE.Vector3(0, 1.35, 0);
    const aim = new THREE.Quaternion();
    const ctrl = new SaberController();
    ctrl.assist = DIFFICULTY.padawan.assist;
    ctrl.gx = 0.2; ctrl.gy = 0.1;
    const gx0 = ctrl.gx, gy0 = ctrl.gy;
    // straight up the player's back, and closing fast
    const bolt = { pos: new THREE.Vector3(0, 1.35, 6), vel: new THREE.Vector3(0, 0, -30) };
    for (let i = 0; i < 60; i++) {
      bolt.pos.z -= 30 / 60;
      ctrl.applyAssist([{ bolt, eta: Math.max(0, bolt.pos.z) / 30, point: bolt.pos, dist: bolt.pos.z, offset: 0 }],
        chest, aim, 1 / 60);
    }
    assert(Math.abs(ctrl.gx - gx0) < 1e-6 && Math.abs(ctrl.gy - gy0) < 1e-6,
      `a bolt from behind moved the guard by ${((ctrl.gx - gx0) * 180 / Math.PI * 1.62).toFixed(1)}°`);
    return 'guard unmoved';
  });

  check('assist: of two threats it answers the one arriving first', () => {
    const chest = new THREE.Vector3(0, 1.35, 0);
    const aim = new THREE.Quaternion();
    const ctrl = new SaberController();
    ctrl.assist = DIFFICULTY.padawan.assist;
    ctrl.gx = 0; ctrl.gy = 0;
    // near bolt off to the LEFT, far bolt off to the RIGHT. The guard must go left.
    const near = { pos: new THREE.Vector3(-4, 1.35, -6) };
    const far = { pos: new THREE.Vector3(9, 1.35, -22) };
    for (let i = 0; i < 20; i++) {
      ctrl.applyAssist([
        { bolt: far, eta: 0.62, point: far.pos, dist: 22, offset: 0 },
        { bolt: near, eta: 0.20, point: near.pos, dist: 6, offset: 0 },
      ], chest, aim, 1 / 60);
    }
    assert(ctrl.gx < -0.05,
      `guard went to gx=${ctrl.gx.toFixed(3)} — it chased the far bolt instead of the near one`);
    return `guard drawn to gx=${ctrl.gx.toFixed(2)} (left, toward the near bolt)`;
  });


  /* ── what a return is worth, and who it may be aimed at ────────────── */

  /**
   * One stub World carrying the three shipped methods that decide a deflection,
   * exactly as `catch.mjs` does it: building a real World needs an Engine, and
   * calling its methods against a hand-made frame is the same code. World.js is
   * reached by `await import` inside the check bodies — HANDOFF §2.1.
   */
  const deflectScene = async (rules = { friendlyFire: false }) => {
    const { World } = await import('../../src/game/World.js');
    const { Player } = await import('../../src/game/Player.js');
    const { BoltPool } = await import('../../src/game/Bolts.js');
    const pool = new BoltPool(scene, 8);
    const fed = [];
    const w = {
      players: [], enemies: [], bolts: pool, settings: {}, rules,
      particles: { sparkBurst() {}, plasma: { spawn() {} } }, engine: { flash() {} },
      addHitstop() {}, report() {}, notifyFloating() {},
      onDeflectFeedback(g, p, why) { fed.push({ g, why }); }, feelOn: () => false,
      _creditDeflect: World.prototype._creditDeflect,
      _onBoltDeflect: World.prototype._onBoltDeflect,
      fed,
    };
    const mkPlayer = (saber, team = 0) => Object.assign(Object.create(Player.prototype), {
      alive: true, saber, isLocal: true, team, flow: 1, score: 0, stamina: 100,
      deflects: 0, perfects: 0, combo: 0, comboTimer: 0,
      aimDir: new THREE.Vector3(0, 0, -1), chest: new THREE.Vector3(0, 1.35, 0),
      camera: { pos: new THREE.Vector3(0, 1.35, 0), addShake() {} },
      boonMods: { deflectDamage: 1, returnCone: 0.42 },
      addFlow() {}, boltCatch: null, control: null,
    });
    return { w, mkPlayer, pool };
  };

  check('deflect: a bolt volleyed back and forth cannot compound past one perfect return', async () => {
    /**
     * `bolt.damage *= res.damageMul * deflectDamage` — and nothing ever put it
     * back. A bolt is a POOLED object that survives every exchange, and the
     * enemy branch of `_onBoltDeflect` hands it straight back with no gate, so
     * one 11-damage bolt volleyed between a player and a duellist measured
     * 11.00 → 16.50 → 41.25 → … → 2175.29 over eight exchanges: 198×, with
     * `bolt.life` pushed back to ≥2.2 s on every touch so the volley never
     * expired. `canHarm(bolt.owner, victim)` is attacker === victim → true, so
     * the end of that rally is a 2175 damage bolt pointed at the 100 hp player
     * who made it.
     *
     * WHY NOTHING SAW IT. Every other deflection check grades ONE contact.
     * The multiply is correct for one contact and this file had no notion of a
     * bolt with a history — the state that compounds lives on the bolt, across
     * calls, and nothing was looking at the same bolt twice.
     *
     * The ceiling asserted is the one the game already publishes: a bolt cannot
     * be worth more than the best single return by its deflector.
     */
    const { GRADE, GRADE_DAMAGE } = await import('../../src/game/Combat.js');
    const { w, mkPlayer, pool } = await deflectScene();
    const ps = blade(), es = blade();
    const p = mkPlayer(ps, 0);
    w.players.push(p);
    const foe = { saber: es, team: 1, dead: false };
    w.enemies.push({ dead: false, team: 1, position: new THREE.Vector3(0, 1.35, -20),
      aimPoint: (o) => o.set(0, 1.35, -20) });

    const bolt = pool.fire(new THREE.Vector3(0, 1.35, -6), new THREE.Vector3(0, 0, 1),
      { speed: 40, team: 1, damage: 11 });
    const muzzle = bolt.damage;
    const trace = [muzzle];
    for (let i = 0; i < 8; i++) {
      swing(ps, new THREE.Vector3(-0.35, 1.35, -0.4), new THREE.Quaternion(),
        new THREE.Vector3(0.35, 1.35, -0.4), new THREE.Quaternion());
      let pt = ps.pointAt(0.6, new THREE.Vector3());
      w._onBoltDeflect(bolt, { saber: ps, owner: p, team: 0 }, { bladeT: 0.6, point: pt }, pt.clone());
      trace.push(bolt.damage);
      // …and the duellist bats it back, which is what makes it a rally
      pt = es.pointAt(0.6, new THREE.Vector3());
      w._onBoltDeflect(bolt, { saber: es, owner: foe, team: 1 }, { bladeT: 0.6, point: pt }, pt.clone());
    }
    const ceiling = muzzle * GRADE_DAMAGE[GRADE.PERFECT];
    assert(trace[1] > muzzle,
      `the first deflection left the bolt at ${trace[1].toFixed(2)} against a ${muzzle} muzzle — a `
      + 'return is supposed to be worth more, so a capped-at-nothing fix would pass this check');
    assert(bolt.damage <= ceiling + 1e-6,
      `eight exchanges took an ${muzzle} damage bolt to ${bolt.damage.toFixed(2)} — `
      + `${(bolt.damage / muzzle).toFixed(0)}× its muzzle damage, against a ceiling of `
      + `${ceiling.toFixed(2)} for the best single return. The grade multiplier is being applied to `
      + 'a number that already carries every earlier multiplier');
    pool.dispose();
    return `11 → ${trace.slice(1, 4).map((d) => d.toFixed(2)).join(' → ')} → … → `
      + `${bolt.damage.toFixed(2)} over eight exchanges, ceiling ${ceiling.toFixed(2)}`;
  });

  check('deflect: a bolt sent home costs the rank more, and all of the extra is the ledger', async () => {
    /**
     * FLAGSHIP §7's SECOND VERB, PRICED ON A RANK RATHER THAN ON A PAIR.
     *
     *   "TURN — a returned bolt that kills its firer counts on THEIR morale
     *    ledger. Every bolt sent home deletes a rifle and breaks a nerve."
     *
     * `tools/checks/break.mjs` already proves the shipped bolt path reaches
     * `turnedHome` at all, with one victim and one witness. What it cannot see
     * is the thing a battle measurement turned up and this check exists to
     * separate: driven through a Geonosis Command wave, a turned kill costs the
     * horde **0.495** of nerve against **0.058** for an ordinary bolt kill —
     * 8.5x, where the two table entries are only 4x apart.
     *
     * There are two explanations for that gap and they call for opposite
     * responses. Either the return is billing MORE PER WITNESS than it should —
     * a defect, two terms compounding somewhere — or a returned bolt simply
     * kills where the bodies are crowded, because it is thrown from a blade
     * standing in the middle of a rank, and the extra is the SEE radius finding
     * more men. The second is the design working.
     *
     * So: the same rank, the same body, the same place, killed twice. What is
     * asserted is that the CROWD is identical between the two arms and the cost
     * is not — which leaves the ledger as the only difference, and hands the
     * battle number its explanation instead of a second reading of it.
     */
    const H = await import('./_coop.mjs');
    const { nerveOf } = await import('../../src/game/Nerve.js');
    const { NERVE } = await import('../../src/game/Nerve.js');

    /** One rank, one death, and what it cost every man who could see it. */
    const kill = async (sentHome) => {
      const { world } = await H.bootWorld({
        level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true },
      });
      const input = H.idleInput();
      for (let i = 0; i < 8; i++) world.update(1 / 60, input);
      const g = (x, z) => world.terrain.height(x, z);
      /* A RANK ABREAST at the game's own spacing, close enough that every man
       * is inside `NERVE.SEE` of the one that falls — the placement uses the
       * radius, the assertions below do not. */
      const rank = [];
      for (let i = 0; i < 7; i++) {
        const x = -7.2 + i * 2.4;
        const e = world.spawnEnemy('b1', new THREE.Vector3(x, g(x, -10), -10));
        if (e) rank.push(e);
      }
      assert(rank.length === 7, `only ${rank.length} of the rank stood up`);
      /* TWO FRAMES, so every rig is posed off its own solve: a bolt driven at a
       * body that has never been stepped passes through the bind pose sitting
       * at the origin. break.mjs pays the same two frames for the same reason. */
      world.update(1 / 60, input); world.update(1 / 60, input);
      const victim = rank[3];
      victim.hp = 1;
      const before = rank.map((e) => nerveOf(e));

      const bolt = world.bolts.fire(
        new THREE.Vector3(victim.position.x, victim.position.y + 1.0, -16),
        new THREE.Vector3(0, 0, 1), { speed: 90, team: 0, damage: 60, owner: world.player });
      assert(bolt, 'no bolt came out of the pool');
      if (sentHome) { bolt.deflected = true; bolt.deflector = world.player; }
      bolt.owner = world.player; bolt.team = 0;
      for (let i = 0; i < 240 && !victim.dead; i++) {
        world._boltHitTest(bolt, bolt.pos.clone(), bolt.pos.clone().add(new THREE.Vector3(0, 0, 0.25)));
        bolt.pos.z += 0.25;
        if (bolt.pos.z > -4) break;
      }
      assert(victim.dead, `the ${sentHome ? 'returned' : 'ordinary'} bolt did not kill the body it was aimed at`);
      let cost = 0, moved = 0;
      rank.forEach((e, i) => {
        if (e === victim) return;
        const d = before[i] - nerveOf(e);
        cost += d;
        if (d > 1e-9) moved++;
      });
      world.unload?.();
      return { cost, moved };
    };

    const plain = await kill(false);
    const home = await kill(true);

    assert(plain.moved >= 4,
      `an ordinary death in a rank of seven moved ${plain.moved} nerves — the rank is not standing `
      + 'close enough together for this comparison to be about the ledger');
    assert(home.moved === plain.moved,
      `the returned bolt reached ${home.moved} men and the ordinary one ${plain.moved} — the two arms `
      + 'are not the same crowd, so the cost difference below is geometry and not the ledger');
    assert(home.cost > plain.cost,
      `a bolt sent home cost the rank ${home.cost.toFixed(3)} against ${plain.cost.toFixed(3)} for an `
      + 'ordinary kill — TURN is not reaching the ledger through the shipped bolt path');
    /* ON TOP OF THE ORDINARY KNOCK AND NOT INSTEAD OF IT: the extra is one
     * TURNED per man who could see it, so it scales with the crowd rather than
     * replacing what the crowd already paid. Derived from the count this run
     * MEASURED, so a change to the radius or to the spacing cannot make it
     * pass by accident. */
    const extra = (home.cost - plain.cost) / plain.moved;
    assert(Math.abs(extra - Math.abs(NERVE.TURNED)) < 1e-6,
      `the extra came to ${extra.toFixed(4)} a man against NERVE.TURNED's ${Math.abs(NERVE.TURNED)} — `
      + 'the two terms are replacing each other, or one of them is being paid twice');
    return `${plain.moved} men saw it fall · ordinary -${plain.cost.toFixed(3)}, `
      + `sent home -${home.cost.toFixed(3)} (${(home.cost / plain.cost).toFixed(1)}x, `
      + `${extra.toFixed(3)} a man on top)`;
  });

  check('deflect: the return is never aimed at your own side', async () => {
    /**
     * The blade's target list goes through `bladeTargets` → `canHarm`. The
     * deflection's candidate list was `this.enemies.filter(e => !e.dead)` raw,
     * at both call sites — and Command mode puts YOUR OWN TROOPERS in
     * `world.enemies`. Measured with a friendly trooper 14 m straight ahead and
     * the only foe out of the cone: 2 candidates where `hostileTo` gives 1,
     * `pickReturnTarget` chose THE ALLY, and `gradeCaught` paid a PERFECT
     * RETURN for it — 2.5× damage, 160 score, hitstop, flash — after which the
     * bolt passed through them harmlessly. A full reward for nothing, and with
     * friendly fire on the bolt lands.
     *
     * Asserted on the GRADE and the score rather than on the candidate list, so
     * it cannot be satisfied by filtering in one of the two call sites: what
     * must be true is that no reward is paid for aiming at a friend.
     */
    const { GRADE } = await import('../../src/game/Combat.js');
    const ally = { team: 0, dead: false, position: new THREE.Vector3(0, 1.4, -14),
      aimPoint: (o) => o.set(0, 1.4, -14) };
    const foe = { team: 1, dead: false, position: new THREE.Vector3(0, 1.4, -14),
      aimPoint: (o) => o.set(0, 1.4, -14) };

    const shot = async (mark) => {
      const { w, mkPlayer, pool } = await deflectScene();
      const s = blade();
      swing(s, new THREE.Vector3(-0.35, 1.35, -0.4), new THREE.Quaternion(),
        new THREE.Vector3(0.35, 1.35, -0.4), new THREE.Quaternion());
      const p = mkPlayer(s, 0);
      w.players.push(p);
      w.enemies.push(mark);
      const bolt = pool.fire(new THREE.Vector3(0, 1.35, -6), new THREE.Vector3(0, 0, 1),
        { speed: 40, team: 1, damage: 11 });
      const pt = s.pointAt(0.6, new THREE.Vector3());
      w._onBoltDeflect(bolt, { saber: s, owner: p, team: 0 }, { bladeT: 0.6, point: pt }, pt.clone());
      const out = { grade: w.fed[0]?.g ?? -1, score: p.score };
      pool.dispose();
      return out;
    };

    // The same bolt, the same swing, the same body in the same place — the only
    // difference is whose side the figure under the reticle is on.
    const onFoe = await shot(foe);
    const onAlly = await shot(ally);
    assert(onFoe.grade >= GRADE.RETURN,
      `a clean deflect with an ENEMY under the reticle graded ${onFoe.grade} — the return is not `
      + 'being earned at all, so the ally half below proves nothing');
    assert(onAlly.grade < GRADE.RETURN,
      `the same deflect with a FRIENDLY trooper under the reticle graded ${onAlly.grade} and paid `
      + `${onAlly.score} score — the aim assist is picking a target the damage rules will refuse, `
      + 'and in Command mode your own squad stands in world.enemies');
    assert(onAlly.score < onFoe.score,
      `sending a bolt at an ally paid ${onAlly.score}, the same as sending it at a foe`);
    return `foe under the reticle → grade ${onFoe.grade}, ${onFoe.score} score · `
      + `ally → grade ${onAlly.grade}, ${onAlly.score}`;
  });
}
