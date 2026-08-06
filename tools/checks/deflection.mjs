/**
 * SABER — can you actually BLOCK anything?
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
  const assistTrial = (tier, offDeg, fromM, dt = 1 / 60) => {
    const d = DIFFICULTY[tier];
    const speed = 88 * d.boltSpeed;
    const chest = new THREE.Vector3(0, 1.35, 0);
    const aim = new THREE.Quaternion();          // looking down -Z
    const ctrl = new SaberController();
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

  check('assist: each tier closes the share of guard error it advertises', () => {
    const rows = [];
    for (const key of ['padawan', 'knight', 'master', 'grandmaster']) {
      const d = DIFFICULTY[key];
      const speed = 88 * d.boltSpeed;
      // Fire from exactly one ASSIST_LEAD out, which is the condition the tier
      // number is defined against: a full 0.9 s of approach.
      const r = assistTrial(key, 40, speed * 0.9);
      rows.push(`${d.name} ${(r.closed * 100).toFixed(0)}%`);
      assert(Math.abs(r.closed - d.assist) < 0.05,
        `${d.name} advertises ${(d.assist * 100).toFixed(0)}% but closed ${(r.closed * 100).toFixed(1)}%`);
    }
    return rows.join(', ');
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

}
