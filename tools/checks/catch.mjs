/**
 * BATTLEFRONT BORZ — catch, then throw.
 *
 * The design contradiction this suite exists to pin down, in the player's own
 * words: "I don't understand how you're supposed to block and also aim at an
 * enemy in the same motion because when you're moving the blade to specifically
 * deflect the cursor can't move."
 *
 * They were right, and it was not a tuning problem. Hold-the-button-to-steer
 * freezes the camera; the reticle deflection model reads the camera to decide
 * where a bolt goes. Two systems, one moment, mutually exclusive. The fix is to
 * make them SEQUENTIAL: the bolt sticks to the blade for a quarter of a second,
 * the camera comes straight back, and where you are looking when you let go is
 * where the bolt goes.
 *
 * Everything below is a number that would have been fine in a code review and
 * is only true because it was measured: the camera really does come back on the
 * same frame, the window really is bounded, an auto-guard catch really cannot
 * re-open the auto-guard, and a parked blade really cannot catch anything.
 */

import * as THREE from 'three';
import { Saber } from '../../src/game/Saber.js';
import { SaberController, OVERHEAD, GUARD } from '../../src/game/SaberController.js';
import { BoltPool, guardIntercept, intersectBladeSweep } from '../../src/game/Bolts.js';
import { CATCH, CatchWindow, captureSnapshot, gradeCaught, GRADE, DIFFICULTY } from '../../src/game/Combat.js';
import { World } from '../../src/game/World.js';
import { Player } from '../../src/game/Player.js';
import { clocked } from './_shared.mjs';

const scene = new THREE.Scene();
const CHEST = new THREE.Vector3(0, 1.35, 0);
const DEG = 180 / Math.PI;

function blade(opts = {}) {
  const s = new Saber(scene, { colorIndex: 0, bladeLength: opts.length ?? 1.15 });
  s.ignite();
  s.ignition = 1;
  return s;
}
function hold(saber, pos, quat, dt = 1 / 60) {
  saber.valid = false;
  saber.setHiltPose(pos, quat);
  saber.update(dt, 0);
  saber.setHiltPose(pos, quat);
  saber.update(dt, dt);
  return saber;
}
function swing(saber, fromPos, toPos, quat, dt = 1 / 60) {
  saber.valid = false;
  saber.setHiltPose(fromPos, quat);
  saber.update(dt, 0);
  saber.setHiltPose(toPos, quat);
  saber.update(dt, dt);
  return saber;
}
function boltAt(pos, dir, speed = 40) {
  return { pos: pos.clone(), prev: pos.clone(), vel: dir.clone().normalize().multiplyScalar(speed), speed };
}
/** The input stub the controller reads. */
function mkInput() {
  return {
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: {},
    _held: new Set(), _hit: new Set(),
    act(id) { return this._held.has(id); },
    actHit(id) { return this._hit.has(id); },
  };
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);

  /* ── the camera comes back ─────────────────────────────────────────── */

  check('catch: the camera comes back the instant a bolt is caught, button or no button', () => {
    const c = new SaberController();
    c.reset(CHEST, new THREE.Quaternion());
    const input = mkInput();
    input._held.add('blade');
    input.mouse.dx = 120;
    const frozen = c.applyInput(input, 1 / 60, { stamina: 1 });
    assert(frozen.yaw === 0 && frozen.pitch === 0,
      `the camera moved while steering the blade: yaw ${frozen.yaw}`);

    // now a bolt is stuck to the blade, and the button is STILL down
    c.catchHold = CATCH.hold;
    const gx0 = c.gx, gy0 = c.gy;
    input.mouse.dx = 120;
    const back = c.applyInput(input, 1 / 60, { stamina: 1 });
    const deg = Math.abs(back.yaw) * DEG;
    assert(deg > 5, `the camera is still frozen during a catch: ${deg.toFixed(2)}° for 120 px`);
    // …and the blade does NOT wander off home while it is holding something
    assert(Math.abs(c.gx - gx0) < 1e-9 && Math.abs(c.gy - gy0) < 1e-9,
      `the guard drifted ${(Math.abs(c.gx - gx0) * c.maxYaw * DEG).toFixed(2)}° while holding a bolt`);
    return `frozen 0.00°, caught ${deg.toFixed(1)}° per 120 px, guard held`;
  });

  /* ── the window itself ─────────────────────────────────────────────── */

  check('catch: the hold is a quarter second, and stacking cannot extend it forever', () => {
    const cw = new CatchWindow();
    const dt = 1 / 120;
    cw.add({ bolt: 1 }, { bladeHeld: false });
    let t = 0;
    while (!cw.update(dt, false) && t < 3) t += dt;
    assert(Math.abs(t + dt - CATCH.hold) < 0.02,
      `a lone catch held for ${(t + dt).toFixed(3)} s, not ${CATCH.hold} s`);
    const lone = t + dt;

    // now refresh it every frame, forever, and watch the ceiling bite
    const cw2 = new CatchWindow();
    let open = 0;
    for (let i = 0; i < 600; i++) {
      cw2.add({ bolt: i }, { bladeHeld: false });
      open += dt;
      if (cw2.update(dt, false)) break;
    }
    assert(open <= CATCH.maxOpen + 0.02,
      `an unbroken stream held the window open for ${open.toFixed(3)} s — the camera never comes back`);
    assert(cw2.count <= CATCH.maxHeld, `${cw2.count} bolts on one blade, cap is ${CATCH.maxHeld}`);
    return `lone catch ${(lone * 1000).toFixed(0)} ms, saturated ${(open * 1000).toFixed(0)} ms (cap ${CATCH.maxOpen * 1000}), ${cw2.count} bolts max`;
  });

  check('catch: releasing the button throws early, but only if it was down when you caught', () => {
    // caught with the button DOWN → letting go fires immediately
    const a = new CatchWindow();
    a.add({ bolt: 1 }, { bladeHeld: true });
    assert(!a.update(1 / 60, true), 'threw while the button was still held');
    assert(a.update(1 / 60, false), 'releasing the button did not throw');

    // caught with the button already UP → nothing to release; it must expire
    const b = new CatchWindow();
    b.add({ bolt: 1 }, { bladeHeld: false });
    let t = 0;
    while (!b.update(1 / 60, false) && t < 1) t += 1 / 60;
    assert(t > CATCH.hold - 0.03,
      `a catch made with the button up fired after ${(t * 1000).toFixed(0)} ms instead of expiring`);
    return `held → fires on release (33 ms), not held → expires at ${((t + 1 / 60) * 1000).toFixed(0)} ms`;
  });

  /* ── only a driven blade catches ───────────────────────────────────── */

  check('catch: a parked blade blocks, a driven blade catches', () => {
    const still = blade();
    hold(still, new THREE.Vector3(0, 1.35, 0), new THREE.Quaternion());
    const p = still.pointAt(0.6, new THREE.Vector3());
    const parked = captureSnapshot(boltAt(p.clone().add(new THREE.Vector3(0, 0, 2)), new THREE.Vector3(0, 0, -1)),
      still, { bladeT: 0.6, point: p });
    assert(!parked.caught,
      `a blade at ${parked.bladeSpeed.toFixed(2)} m/s caught a bolt — hold-to-win`);

    const driven = blade();
    swing(driven, new THREE.Vector3(-0.3, 1.35, 0), new THREE.Vector3(0.3, 1.35, 0), new THREE.Quaternion());
    const q = driven.pointAt(0.6, new THREE.Vector3());
    const snap = captureSnapshot(boltAt(q.clone().add(new THREE.Vector3(0, 0, 2)), new THREE.Vector3(0, 0, -1)),
      driven, { bladeT: 0.6, point: q });
    assert(snap.caught, `a blade at ${snap.bladeSpeed.toFixed(1)} m/s did not catch`);
    return `parked ${parked.bladeSpeed.toFixed(2)} m/s → block, driven ${snap.bladeSpeed.toFixed(1)} m/s → catch`;
  });

  /* ── the throw goes where you look, not where you blocked ──────────── */

  check('catch: the throw reads the aim you have on RELEASE, not the one you had on contact', () => {
    const s = blade();
    swing(s, new THREE.Vector3(-0.3, 1.35, 0), new THREE.Vector3(0.3, 1.35, 0), new THREE.Quaternion());
    const p = s.pointAt(0.6, new THREE.Vector3());
    // the bolt came from straight ahead; the blade swept sideways
    const snap = captureSnapshot(boltAt(p.clone().add(new THREE.Vector3(0, 0, 2)), new THREE.Vector3(0, 0, -1)),
      s, { bladeT: 0.6, point: p });

    const rows = [];
    for (const [label, aim] of [['left', new THREE.Vector3(-1, 0, -1)], ['right', new THREE.Vector3(1, 0, -1)],
                                ['up', new THREE.Vector3(0, 1, -1)]]) {
      aim.normalize();
      const res = gradeCaught(snap, { aimDir: aim, aimOrigin: CHEST, candidates: [], flow: 1, caught: true });
      const off = Math.acos(Math.min(1, res.dir.dot(aim))) * DEG;
      assert(off < 2, `looked ${label} and the bolt went ${off.toFixed(1)}° off the sightline`);
      rows.push(`${label} ${off.toFixed(2)}°`);
    }

    // and a victim under the reticle takes it in preference to the bare sightline
    const enemy = { dead: false, aimPoint: (o) => o.set(6, 1.35, -18) };
    const aim = new THREE.Vector3(6, 0, -18).normalize();
    const res = gradeCaught(snap, { aimDir: aim, aimOrigin: CHEST, candidates: [enemy], flow: 1, caught: true });
    assert(res.target && res.target.entity === enemy, 'no victim claimed under the reticle');
    return rows.join(', ') + ', victim claimed';
  });

  check('catch: a whole stack fires at one reticle', () => {
    const s = blade();
    swing(s, new THREE.Vector3(-0.3, 1.35, 0), new THREE.Vector3(0.3, 1.35, 0), new THREE.Quaternion());
    const cw = new CatchWindow();
    // three bolts arriving from three different directions, all caught
    for (const d of [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-0.5, 0, -1), new THREE.Vector3(0.6, 0.2, -1)]) {
      const p = s.pointAt(0.5, new THREE.Vector3());
      cw.add({ bolt: {}, snap: captureSnapshot(boltAt(p.clone().sub(d.clone().multiplyScalar(2)), d), s, { bladeT: 0.5, point: p }) },
        { bladeHeld: true, chest: CHEST, incoming: d });
    }
    assert(cw.count === 3, `stacked ${cw.count} of 3`);
    const aim = new THREE.Vector3(0.3, 0.1, -1).normalize();
    let worst = 0;
    for (const h of cw.held) {
      const res = gradeCaught(h.snap, { aimDir: aim, aimOrigin: CHEST, candidates: [], flow: 1, caught: true });
      worst = Math.max(worst, Math.acos(Math.min(1, res.dir.dot(aim))) * DEG);
    }
    assert(worst < 2, `three bolts caught from three directions scattered by up to ${worst.toFixed(1)}°`);
    return `3 caught from 3 directions, all within ${worst.toFixed(2)}° of one reticle`;
  });

  check('catch: a caught bolt is inert — it does not fly, age, or count as a threat', () => {
    const pool = new BoltPool(scene, 8);
    const s = blade();
    hold(s, new THREE.Vector3(0, 1.35, 0), new THREE.Quaternion());
    const b = pool.fire(new THREE.Vector3(0, 1.35, 6), new THREE.Vector3(0, 0, -1), { speed: 60, life: 0.2 });
    pool.hold(b, s, 0.6);
    for (let i = 0; i < 60; i++) pool.update(1 / 60, {});
    assert(b.active, 'a caught bolt expired on the blade');
    assert(b.held, 'a caught bolt let go on its own');
    const onBlade = b.pos.distanceTo(s.pointAt(0.6, new THREE.Vector3()));
    assert(onBlade < 0.12, `a caught bolt sat ${(onBlade * 100).toFixed(0)} cm off the blade`);
    const threats = pool.threatsNear(new THREE.Vector3(0, 1.35, -4), 30);
    assert(threats.length === 0, 'a caught bolt is still being reported as an incoming threat');
    pool.release(b, new THREE.Vector3(0, 0, -1), 60);
    assert(!b.held && b.vel.length() > 59, 'release did not put the bolt back in flight');
    pool.dispose();
    return `1 s on the blade: still alive, ${(onBlade * 1000).toFixed(0)} mm off the axis, 0 threats reported`;
  });

  check('catch: a held bolt looks held — shorter, fatter, hotter, and crackling', () => {
    /**
     * "Clearly readable as caught" has to be a number or it is an opinion. Read
     * the instance data the GPU actually gets for a flying bolt and a caught one
     * on the same frame, and for the caught one across a beat of its pulse.
     */
    const pool = new BoltPool(scene, 8);
    const s = blade();
    hold(s, new THREE.Vector3(0, 1.35, 0), new THREE.Quaternion());
    const flying = pool.fire(new THREE.Vector3(3, 1.35, 6), new THREE.Vector3(0, 0, -1), { speed: 40 });
    const caught = pool.fire(new THREE.Vector3(0, 1.35, 6), new THREE.Vector3(0, 0, -1), { speed: 40 });
    pool.hold(caught, s, 0.6);
    for (let i = 0; i < 6; i++) pool.update(1 / 60, {});

    const read = (i) => {
      const m = new THREE.Matrix4();
      pool.mesh.getMatrixAt(i, m);
      const sc = new THREE.Vector3().setFromMatrixScale(m);
      const c = pool.mesh.instanceColor.array;
      return { len: sc.z, rad: sc.x, lum: (c[i * 3] + c[i * 3 + 1] + c[i * 3 + 2]) / 3 };
    };
    assert(pool.mesh.count === 2, `${pool.mesh.count} instances drawn, expected 2`);
    const a = read(0), b = read(1);
    assert(b.len < a.len * 0.5, `the caught bolt is ${(b.len * 100).toFixed(0)} cm against the flying one's ${(a.len * 100).toFixed(0)} cm`);
    assert(b.rad > a.rad * 1.4, `the caught bolt is ${(b.rad * 1000).toFixed(0)} mm across against ${(a.rad * 1000).toFixed(0)} mm`);
    assert(b.lum > a.lum, `the caught bolt is dimmer (${b.lum.toFixed(2)}) than the flying one (${a.lum.toFixed(2)})`);

    // …and it must actually pulse: sample a whole cycle of the 22 Hz crackle
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < 12; i++) {
      pool.update(1 / 240, {});
      const r = read(1);
      lo = Math.min(lo, r.lum); hi = Math.max(hi, r.lum);
    }
    assert(hi / lo > 1.3, `the crackle only swings ${(hi / lo).toFixed(2)}:1 — it reads as a steady light`);
    pool.dispose();
    return `${(b.len / a.len).toFixed(2)}× length, ${(b.rad / a.rad).toFixed(2)}× radius, ${(b.lum / a.lum).toFixed(2)}× brightness, crackling ${(hi / lo).toFixed(1)}:1 at 22 Hz`;
  });

  /* ── the auto-guard cone ───────────────────────────────────────────── */

  check('auto-guard: the cone is 40° wide and 0.40 s long, and it is a sphere not a searchlight', () => {
    const cw = new CatchWindow();
    cw.add({ bolt: 1 }, { bladeHeld: false, chest: CHEST, incoming: new THREE.Vector3(0, 0, 1) });
    const g = cw.guard();
    assert(g, 'a manual catch did not open the cone');
    assert(Math.abs(g.cone * DEG - 20) < 0.01, `half-angle is ${(g.cone * DEG).toFixed(1)}°`);

    // measure the widest incoming angle actually accepted, by bisection
    const accepts = (deg) => {
      const a = deg / DEG;
      const from = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)).multiplyScalar(8).add(CHEST);
      const to = from.clone().lerp(CHEST, 1.0);          // straight at the chest
      return !!guardIntercept(from, to, g);
    };
    let lo = 0, hi = 90;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (accepts(m)) lo = m; else hi = m; }
    assert(Math.abs(lo - 20) < 1.0, `the cone accepts up to ${lo.toFixed(1)}° off axis, not 20°`);

    // The cone points back down the line the caught bolt came in on: incoming
    // was +Z, so it came from -Z, and that is where the guard faces.
    // A bolt aimed dead at you but still 40 m out has not ARRIVED and must not
    // be caught: the guard is a sphere around you, not a hitscan down the axis.
    const far = CHEST.clone().add(new THREE.Vector3(0, 0, -40));
    assert(!guardIntercept(far, far.clone().add(new THREE.Vector3(0, 0, 1)), g),
      'the auto-guard reached out 40 m and caught a bolt that had not arrived');
    assert(guardIntercept(CHEST.clone().add(new THREE.Vector3(0, 0, -2)), CHEST.clone().add(new THREE.Vector3(0, 0, -0.5)), g),
      'the auto-guard missed a bolt arriving down its own axis');
    // and nothing from behind, ever
    assert(!guardIntercept(CHEST.clone().add(new THREE.Vector3(0, 0, 2)), CHEST.clone().add(new THREE.Vector3(0, 0, 0.5)), g),
      'the auto-guard caught a bolt arriving from directly behind the cone');

    // and the duration
    let t = 0;
    while (cw.guard() && t < 2) { cw.update(1 / 120, false); t += 1 / 120; }
    assert(Math.abs(t - CATCH.autoGuard) < 0.03, `the cone stayed open ${t.toFixed(3)} s, not ${CATCH.autoGuard} s`);
    return `±${lo.toFixed(1)}° (40° cone), ${(t * 1000).toFixed(0)} ms, radius ${CATCH.autoRadius} m`;
  });

  check('auto-guard: an AUTO catch cannot re-open the cone — no hold-to-win chain', () => {
    const cw = new CatchWindow();
    cw.add({ bolt: 1 }, { manual: true, bladeHeld: false, chest: CHEST, incoming: new THREE.Vector3(0, 0, 1) });
    // burn most of the window down, then let the cone catch one for free
    for (let i = 0; i < 20; i++) cw.update(1 / 60, false);
    const before = cw.auto;
    cw.add({ bolt: 2 }, { manual: false, bladeHeld: false, chest: CHEST, incoming: new THREE.Vector3(0, 0, 1) });
    const afterAuto = cw.auto;
    assert(afterAuto <= before + 1e-9,
      `a free catch pushed the cone from ${before.toFixed(3)} s back to ${afterAuto.toFixed(3)} s — one deflect would cover a whole stream`);
    // …whereas a manual one may
    cw.add({ bolt: 3 }, { manual: true, bladeHeld: false, chest: CHEST, incoming: new THREE.Vector3(0, 0, 1) });
    assert(cw.auto > before, 'a manual catch failed to re-arm the cone');
    return `0.33 s in, the cone had ${before.toFixed(3)} s left; a free catch left it at ${afterAuto.toFixed(3)} s, a manual one re-armed it to ${cw.auto.toFixed(2)} s`;
  });

  check('auto-guard: in a scripted flurry it covers the follow-up and not the field', () => {
    /**
     * A firing line: five droids spread over 60° at 18 m, each loosing a burst
     * of three at Knight's 40.5 m/s and 0.19 s between shots, staggered so the
     * volley overlaps. Fifteen bolts, none of which a hand could answer.
     *
     * The player deflects ONE by hand — the first to arrive — and from then on
     * only the cone is working. The window is never re-armed manually again,
     * which is the honest worst case for the feature and the honest best case
     * for the abuse it must not allow.
     *
     * The number this produces is the whole point. Too low and the cone is
     * decoration; too high and manual deflection stops mattering.
     */
    const d = DIFFICULTY.knight;
    const speed = 88 * d.boltSpeed;
    const shots = [];
    for (let g = 0; g < 5; g++) {
      const a = (-30 + g * 15) / DEG;
      const from = CHEST.clone().add(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)).multiplyScalar(18));
      const dir = CHEST.clone().sub(from).normalize();
      for (let k = 0; k < 3; k++) shots.push({ from, dir, t0: g * 0.06 + k * 0.19, deg: -30 + g * 15 });
    }
    shots.sort((a, b) => a.t0 - b.t0);

    const cw = new CatchWindow();
    const dt = 1 / 60;
    const flight = (18 - CATCH.autoRadius) / speed;
    const pos = shots.map(s => s.from.clone());
    const live = shots.map(() => true);
    let manual = -1, caught = 0, through = 0;

    for (let f = 0; f < 240; f++) {
      const t = f * dt;
      // the one bolt the player answers by hand: the first one to reach them
      if (manual < 0) {
        for (let i = 0; i < shots.length; i++) {
          if (live[i] && t >= shots[i].t0 + flight) {
            cw.add({ bolt: i }, { manual: true, bladeHeld: false, chest: CHEST, incoming: shots[i].dir });
            live[i] = false; manual = i; break;
          }
        }
      }
      const guard = cw.guard();
      for (let i = 0; i < shots.length; i++) {
        if (!live[i] || t < shots[i].t0) continue;
        const prev = pos[i].clone();
        pos[i].addScaledVector(shots[i].dir, speed * dt);
        if (guard && guardIntercept(prev, pos[i], guard)) {
          cw.add({ bolt: i }, { manual: false, chest: CHEST, incoming: shots[i].dir });
          live[i] = false; caught++;
        } else if (pos[i].distanceTo(CHEST) < 0.4) { live[i] = false; through++; }
      }
      cw.update(dt, false);
    }
    const others = shots.length - 1;
    const frac = caught / others;
    // Geometry alone: how many of the volley even come from inside the cone.
    const eligible = shots.filter((s, i) => i !== manual
      && Math.abs(s.deg - shots[manual].deg) <= CATCH.autoCone * DEG).length;
    assert(caught >= 1, 'the auto-guard caught nothing at all in a flurry — it is decoration');
    assert(frac <= 0.35,
      `the auto-guard caught ${(frac * 100).toFixed(0)}% of a 15-bolt volley off ONE manual deflect — that is hold-to-win`);
    assert(through > others / 2,
      `only ${through} of ${others} got through — the cone is doing the player's job`);
    return `1 manual deflect covered ${caught}/${others} (${(frac * 100).toFixed(0)}%), ${through} got through; `
      + `${eligible} were even inside the 40° cone geometrically`;
  });

  check('catch: the whole path, from a bolt in flight to a bolt on the blade', () => {
    /**
     * End to end through BoltPool.update, which is where the wiring actually
     * lives: a bolt flies, the swept blade meets it, the deflect callback fires
     * with the contact, the bolt is pinned — and then a SECOND bolt on a line
     * the blade never touches is taken by the cone the first one opened.
     */
    const pool = new BoltPool(scene, 16);
    const s = blade();
    const cw = new CatchWindow();
    const owner = { name: 'player' };
    let manualHits = 0, autoHits = 0;
    pool.onDeflect = (b, entry, hit, pt) => {
      const snap = captureSnapshot(b, s, { bladeT: hit.bladeT, point: pt, auto: hit.auto });
      if (!snap.caught) return;
      if (hit.auto) autoHits++; else manualHits++;
      cw.add({ bolt: b, snap }, { manual: !hit.auto, bladeHeld: false, chest: CHEST, incoming: snap.boltDir });
      pool.hold(b, s, hit.auto ? 0.55 : snap.bladeT);
    };

    // The blade sweeps 60 cm sideways through the bolt's line — a real slash.
    const a = new THREE.Vector3(-0.30, 1.35, -0.55), bpos = new THREE.Vector3(0.30, 1.35, -0.55);
    const straight = pool.fire(new THREE.Vector3(0, 1.9, -6), new THREE.Vector3(0, 0, 1), { speed: 40, team: 1 });
    // second bolt, 15° off the first's line — inside the cone, nowhere near the blade
    const ang = 15 / DEG;
    const off = CHEST.clone().add(new THREE.Vector3(Math.sin(ang), 0, -Math.cos(ang)).multiplyScalar(6));
    const flank = pool.fire(off, CHEST.clone().sub(off).normalize(), { speed: 40, team: 1 });

    for (let f = 0; f < 40; f++) {
      s.setHiltPose(f % 2 ? bpos : a, new THREE.Quaternion());
      s.update(1 / 60, f / 60);
      pool.update(1 / 60, {
        blades: [{ saber: s, owner, team: 0, guard: cw.guard() }],
      });
      cw.update(1 / 60, false);
    }
    assert(manualHits === 1, `the blade caught ${manualHits} bolts by hand, expected 1`);
    assert(straight.held, 'the bolt the blade met is not stuck to it');
    assert(autoHits === 1, `the cone caught ${autoHits} bolts, expected 1`);
    assert(flank.held, 'the flanking bolt was not taken by the cone');
    pool.dispose();
    return `1 caught by the blade, 1 by the 40° cone it opened, both riding the blade`;
  });

  /* ── World's own wiring, on World's own methods ────────────────────── */

  /**
   * The three World methods that make the loop real, driven directly. Building
   * a whole World needs an Engine and a GPU; calling its methods against a
   * hand-made frame does not, and it is the SAME CODE — which is the point,
   * because every bug in this feature so far has been in the wiring rather than
   * in the model.
   */
  const fakeWorld = () => {
    const pool = new BoltPool(scene, 16);
    const events = [];
    const w = {
      players: [], enemies: [], bolts: pool, settings: {},
      particles: {
        sparkBurst: () => {}, plasma: { spawn: () => {} },
      },
      engine: { flash: () => {} },
      addHitstop: () => {},
      report: (e) => events.push(e),
      notifyFloating: () => {},
      onDeflectFeedback: (g, p, why) => events.push({ type: 'feedback', g, why }),
      _updateCatch: World.prototype._updateCatch,
      _throwCaught: World.prototype._throwCaught,
      _creditDeflect: World.prototype._creditDeflect,
      _onBoltDeflect: World.prototype._onBoltDeflect,
      _bladeEntries: World.prototype._bladeEntries,
      events,
    };
    return w;
  };
  // A real Player prototype, because _onBoltDeflect branches on `instanceof
  // Player` to tell "the hero answered a bolt" from "a duellist batted one away".
  const fakePlayer = (saber) => Object.assign(Object.create(Player.prototype), {
    alive: true, saber, isLocal: true, team: 0, flow: 1, score: 0, stamina: 100,
    deflects: 0, perfects: 0, combo: 0, comboTimer: 0, aimDir: new THREE.Vector3(0, 0, -1),
    chest: CHEST.clone(), camera: { pos: CHEST.clone(), addShake: () => {} },
    boonMods: { deflectDamage: 1, returnCone: 0.42 },
    addFlow: () => {}, boltCatch: new CatchWindow(),
    control: { bladeHeld: true, catchHold: 0 },
  });

  check('world: hold the button, catch, get the camera back, let go, bolt leaves', () => {
    const w = fakeWorld();
    const s = blade();
    swing(s, new THREE.Vector3(-0.3, 1.35, -0.4), new THREE.Vector3(0.3, 1.35, -0.4), new THREE.Quaternion());
    const p = fakePlayer(s);
    w.players.push(p);

    const bolt = w.bolts.fire(new THREE.Vector3(0, 1.35, -6), new THREE.Vector3(0, 0, 1), { speed: 40, team: 1 });
    const pt = s.pointAt(0.6, new THREE.Vector3());
    // the contact, exactly as BoltPool would deliver it
    w._onBoltDeflect(bolt, { saber: s, owner: p, team: 0 }, { bladeT: 0.6, point: pt }, pt.clone());
    assert(bolt.held, 'World did not stick the bolt to the blade');
    assert(p.boltCatch.count === 1, `the window is holding ${p.boltCatch.count} bolts`);
    assert(p.control.catchHold > 0, 'the camera was not handed back on the catch frame');
    assert(p.boltCatch.guard(), 'a manual catch did not open the auto-guard cone');

    // three frames of holding the button: nothing leaves
    for (let i = 0; i < 3; i++) w._updateCatch(1 / 60);
    assert(bolt.held, 'the bolt left while the button was still held');
    assert(p.control.catchHold > 0, 'the camera was taken away again mid-hold');

    // look somewhere else, then let go
    p.aimDir.set(0.8, 0.2, -1).normalize();
    p.control.bladeHeld = false;
    w._updateCatch(1 / 60);
    assert(!bolt.held, 'letting go did not throw the bolt');
    assert(bolt.team === 0 && bolt.deflector === p, 'the thrown bolt is not the player’s');
    const off = Math.acos(Math.min(1, bolt.vel.clone().normalize().dot(p.aimDir))) * DEG;
    assert(off < 3, `the throw went ${off.toFixed(1)}° off where the player was looking`);
    assert(p.deflects === 1, `credited ${p.deflects} deflects`);
    assert(p.control.catchHold === 0, 'the camera is still locked to the blade after the throw');
    assert(w.events.some(e => e.type === 'deflect'), 'nothing was reported to the director');
    w.bolts.dispose();
    return `caught, camera back, thrown ${off.toFixed(2)}° off the new sightline`;
  });

  check('world: a slow blade still blocks immediately, and opens no cone', () => {
    const w = fakeWorld();
    const s = blade();
    hold(s, new THREE.Vector3(0, 1.35, -0.4), new THREE.Quaternion());
    const p = fakePlayer(s);
    w.players.push(p);
    const bolt = w.bolts.fire(new THREE.Vector3(0, 1.35, -6), new THREE.Vector3(0, 0, 1), { speed: 40, team: 1 });
    const pt = s.pointAt(0.6, new THREE.Vector3());
    w._onBoltDeflect(bolt, { saber: s, owner: p, team: 0 }, { bladeT: 0.6, point: pt }, pt.clone());
    assert(!bolt.held, 'a parked blade caught a bolt');
    assert(bolt.team === 0 && bolt.vel.length() > 1, 'the block did not send the bolt anywhere');
    assert(p.boltCatch.count === 0, 'a block put something in the catch window');
    assert(!p.boltCatch.guard(), 'a BLOCK opened the auto-guard cone — that is hold-to-win');
    assert(p.control.catchHold === 0, 'a block took the camera away');
    w.bolts.dispose();
    return 'block scatters on contact, no window, no cone';
  });

  check('world: the blade going out drops what it was holding', () => {
    const w = fakeWorld();
    const s = blade();
    swing(s, new THREE.Vector3(-0.3, 1.35, -0.4), new THREE.Vector3(0.3, 1.35, -0.4), new THREE.Quaternion());
    const p = fakePlayer(s);
    w.players.push(p);
    const bolt = w.bolts.fire(new THREE.Vector3(0, 1.35, -6), new THREE.Vector3(0, 0, 1), { speed: 40, team: 1 });
    const pt = s.pointAt(0.6, new THREE.Vector3());
    w._onBoltDeflect(bolt, { saber: s, owner: p, team: 0 }, { bladeT: 0.6, point: pt }, pt.clone());
    assert(bolt.held && bolt.active, 'setup: the bolt was not caught');
    s.ignition = 0;
    w._updateCatch(1 / 60);
    assert(!bolt.active, 'a bolt survived on a blade that had gone out');
    assert(p.boltCatch.count === 0 && p.control.catchHold === 0,
      'the window kept the camera after the blade went out');
    w.bolts.dispose();
    return 'blade out → bolt gone, window closed, camera returned';
  });

  /* ── the earned grade is still earned ──────────────────────────────── */

  check('catch: a free auto-guard catch is aimed but not rewarded', () => {
    const s = blade();
    hold(s, new THREE.Vector3(0, 1.35, 0), new THREE.Quaternion());       // parked
    const p = s.pointAt(0.55, new THREE.Vector3());
    const snap = captureSnapshot(boltAt(p.clone().add(new THREE.Vector3(0, 0, 2)), new THREE.Vector3(0, 0, -1)),
      s, { bladeT: 0.55, point: p, auto: true });
    assert(snap.caught, 'the auto-guard failed to catch off a parked blade');
    const enemy = { dead: false, aimPoint: (o) => o.set(0, 1.35, -20) };
    const aim = new THREE.Vector3(0, 0, -1);
    const res = gradeCaught(snap, { aimDir: aim, aimOrigin: CHEST, candidates: [enemy], flow: 1, caught: true });
    assert(res.grade === GRADE.DEFLECT, `a free catch graded ${res.grade}, expected DEFLECT`);
    assert(res.damageMul === 1, `a free catch multiplied damage by ${res.damageMul}`);
    assert(res.target, 'a free catch was not even aimed');

    // a fast tip earns the RETURN it always did
    const fast = blade();
    swing(fast, new THREE.Vector3(-0.6, 1.35, 0), new THREE.Vector3(0.6, 1.35, 0), new THREE.Quaternion(), 1 / 120);
    const q = fast.pointAt(0.8, new THREE.Vector3());
    const snap2 = captureSnapshot(boltAt(q.clone().add(new THREE.Vector3(0, 0, 2)), new THREE.Vector3(0, 0, -1)),
      fast, { bladeT: 0.8, point: q });
    const res2 = gradeCaught(snap2, { aimDir: aim, aimOrigin: CHEST, candidates: [enemy], flow: 1, caught: true });
    assert(res2.grade >= GRADE.RETURN,
      `a ${snap2.bladeSpeed.toFixed(0)} m/s tip graded ${res2.grade}, expected RETURN or better`);
    return `auto catch ×${res.damageMul} aimed, ${snap2.bladeSpeed.toFixed(0)} m/s manual catch ×${res2.damageMul}`;
  });

  /* ── the stationary thrust ─────────────────────────────────────────── */

  check('thrust: a standing stab actually extends the blade, and holds there', () => {
    const c = new SaberController();
    const aim = new THREE.Quaternion();
    c.reset(CHEST, aim);
    const input = mkInput();
    for (let i = 0; i < 120; i++) { c.applyInput(input, 1 / 60, { stamina: 1 }); c.update(1 / 60, CHEST, aim, {}); }
    const rest = c.handPos.clone();
    const tip0 = rest.clone().addScaledVector(c._bladeDir, 1.15);
    input._hit.add('thrust');
    let maxTip = 0, msPast30 = 0;
    for (let i = 0; i < 90; i++) {
      c.applyInput(input, 1 / 60, { stamina: 1 });
      input._hit.clear();
      c.update(1 / 60, CHEST, aim, {});
      const tip = c.handPos.clone().addScaledVector(c._bladeDir, 1.15);
      const d = tip.distanceTo(tip0);
      maxTip = Math.max(maxTip, d);
      if (d > 0.30) msPast30 += 1000 / 60;
    }
    // 11.5 cm was the old figure — the target was a spike that had decayed to
    // 22% before the hands' own 400 ms spring could reach it, so a standing
    // stab moved the blade less than the width of the hilt guard.
    assert(maxTip > 0.40,
      `a standing thrust moved the tip ${(maxTip * 100).toFixed(1)} cm — that is not a stab`);
    assert(msPast30 > 150,
      `the thrust was past 30 cm for only ${msPast30.toFixed(0)} ms — a twitch, not a lunge`);
    // …and it must come back
    assert(c.thrust === 0 && c.thrustT < 0, 'the thrust envelope never closed');
    return `tip +${(maxTip * 100).toFixed(0)} cm, ${msPast30.toFixed(0)} ms past 30 cm, envelope closed`;
  });

  /* ── the lateral guard ─────────────────────────────────────────────── */

  check('stance: a horizontal guard across the body is reachable, and was not before', () => {
    /**
     * A guard stance is not "a blade that happens to be horizontal" — you could
     * always get that by pointing sideways. It is a blade laid ACROSS you: hilt
     * one side of your centreline, tip the other, level, held out in front.
     *
     * It was unreachable for a geometric reason rather than a missing keybind.
     * The hands and the guard point both sat on the SAME ray out of the chest,
     * so the blade could be aimed anywhere on a sphere but only ever pointed
     * radially outward — a spoke, never a bar.
     */
    const c = new SaberController();
    const aim = new THREE.Quaternion();
    const fwd = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0);
    const read = () => {
      const base = c._handTarget.clone();
      const tip = base.clone().addScaledVector(c._bladeDir, 1.15);
      const bx = base.clone().sub(CHEST).dot(right), tx = tip.clone().sub(CHEST).dot(right);
      const mid = base.clone().lerp(tip, 0.5).sub(CHEST).dot(fwd);
      const across = Math.acos(Math.min(1, Math.abs(c._bladeDir.dot(fwd)))) * DEG;
      const elev = Math.asin(Math.max(-1, Math.min(1, c._bladeDir.y))) * DEG;
      const ok = ((bx < 0) !== (tx < 0)) && mid > 0.25;
      return { off: ok ? Math.max(Math.abs(elev), 90 - across) : 999, across, elev, span: Math.abs(tx - bx) };
    };

    let best = 999;
    for (let gx = -1; gx <= 1.0001; gx += 0.02) {
      for (let gy = -1; gy <= 1.05001; gy += 0.02) {
        c.gx = gx; c.gy = gy; c.roll = 0; c.thrust = 0; c.stance = 0;
        c.solveTargets(CHEST, aim, 0);
        best = Math.min(best, read().off);
      }
    }
    assert(best > 25,
      `a guard stance is ${best.toFixed(1)}° away with no stance at all — this test is measuring the wrong thing`);

    const rows = [];
    for (const s of [1, -1]) {
      c.gx = 0; c.gy = c.readyY; c.roll = 0; c.thrust = 0; c.stance = s;
      c.solveTargets(CHEST, aim, 0);
      const r = read();
      assert(r.off < 12,
        `stance ${s} lands ${r.off.toFixed(1)}° off a guard stance (${r.across.toFixed(0)}° across, ${r.elev.toFixed(0)}° elevated)`);
      assert(r.span > 0.9, `only ${(r.span * 100).toFixed(0)} cm of the blade lies across the body`);
      // and the arms must not go through the ribs to do it
      assert(c._handTarget.distanceTo(CHEST) < 0.78,
        `the stance put the hands ${(c._handTarget.distanceTo(CHEST) * 100).toFixed(0)} cm from the chest`);
      rows.push(`${s > 0 ? 'right' : 'left'}-lead ${r.across.toFixed(0)}° across / ${r.elev.toFixed(1)}° level / ${(r.span * 100).toFixed(0)} cm`);
    }
    return `unreachable without it (best ${best.toFixed(0)}° off); ${rows.join(', ')}`;
  });

  check('stance: the blade returns to the ordinary guard when you let go', () => {
    const c = new SaberController();
    const aim = new THREE.Quaternion();
    c.reset(CHEST, aim);
    const input = mkInput();
    input._held.add('stance');
    c.gx = 0.4;
    for (let i = 0; i < 60; i++) c.applyInput(input, 1 / 60, { stamina: 1 });
    const held = c.stance;
    assert(held > 0.9, `holding the stance key only reached ${held.toFixed(2)}`);
    input._held.delete('stance');
    for (let i = 0; i < 60; i++) c.applyInput(input, 1 / 60, { stamina: 1 });
    assert(Math.abs(c.stance) < 0.02, `the stance stuck at ${c.stance.toFixed(3)} after release`);
    return `held ${held.toFixed(2)}, released ${c.stance.toFixed(3)}`;
  });

  /* ── flourish, and blade-holds-position ────────────────────────────── */

  check('flourish: a twirl that changes nothing about the fight', () => {
    const c = new SaberController();
    const aim = new THREE.Quaternion();
    c.reset(CHEST, aim);
    const input = mkInput();
    for (let i = 0; i < 60; i++) { c.applyInput(input, 1 / 60, { stamina: 1 }); c.update(1 / 60, CHEST, aim, {}); }
    const before = { stamina: c.stamina, flow: c.flow, thrust: c.thrust, assist: c.assist };
    input._hit.add('flourish');
    let frames = 0, maxRoll = 0, maxOff = 0;
    for (let i = 0; i < 120; i++) {
      c.applyInput(input, 1 / 60, { stamina: 1 });
      input._hit.clear();
      c.update(1 / 60, CHEST, aim, {});
      if (c.flourishT >= 0) frames++;
      maxRoll = Math.max(maxRoll, c.roll);
      maxOff = Math.max(maxOff, Math.hypot(c.gx - c.readyX, c.gy - c.readyY));
    }
    assert(frames > 30, `the flourish ran for ${frames} frames`);
    assert(maxRoll > Math.PI * 3, `the blade turned ${(maxRoll / Math.PI / 2).toFixed(2)} times — that is not a twirl`);
    assert(maxOff > 0.1, 'the guard never left the ready pose — nothing visible happened');
    assert(c.thrust === before.thrust && c.assist === before.assist,
      'the flourish touched something that grades a contact');
    assert(Math.abs(c.gx - c.readyX) < 0.02 && Math.abs(c.gy - c.readyY) < 0.02,
      `the flourish left the guard at gx=${c.gx.toFixed(3)} instead of back on the ready guard`);
    return `${(frames / 60 * 1000).toFixed(0)} ms, ${(maxRoll / Math.PI / 2).toFixed(2)} turns, lands back on guard`;
  });

  check('flourish: any real intent cancels it, and it leaves no residue', () => {
    const c = new SaberController();
    const aim = new THREE.Quaternion();
    c.reset(CHEST, aim);
    const input = mkInput();
    // A guard well away from ready, and a wrist already rolled: neither may be
    // yanked by starting or cancelling a twirl.
    c.gx = -0.55; c.gy = -0.30; c.roll = 1.2;
    const gx0 = c.gx, gy0 = c.gy, roll0 = c.roll;
    input._hit.add('flourish');
    c.applyInput(input, 1 / 60, { stamina: 1 });
    input._hit.clear();
    // One frame of ordinary recentring plus one frame of twirl. What it must NOT
    // be is a jump to the middle of the circle — an implementation that ASSIGNS
    // the guard instead of offsetting it moves 0.85 here, and the wrist 1.03 rad.
    const dGuard = Math.abs(c.gx - gx0), dRoll = Math.abs(c.roll - roll0);
    assert(dGuard < 0.12,
      `starting a flourish moved the guard ${dGuard.toFixed(3)} (a snap to ready would be ${Math.abs(gx0 - c.readyX).toFixed(2)})`);
    assert(dRoll < 0.35,
      `starting a flourish moved the wrist ${dRoll.toFixed(3)} rad in one frame (a snap to phase 0 would be ${roll0})`);
    assert(Math.abs(c.gy - gy0) < 0.12, `starting a flourish moved the guard ${(c.gy - gy0).toFixed(3)} vertically`);

    for (let i = 0; i < 10; i++) c.applyInput(input, 1 / 60, { stamina: 1 });
    assert(c.flourishT > 0, 'the flourish never started');
    const mid = c.roll;
    input._held.add('blade');
    c.applyInput(input, 1 / 60, { stamina: 1 });
    assert(c.flourishT < 0, 'taking the blade did not cancel the flourish');
    // cancelling gives the wrist straight back, minus the twirl it had done
    assert(Math.abs(c.roll - roll0) < 0.02,
      `cancelling left the wrist at ${c.roll.toFixed(3)} rad instead of the ${roll0} it started at (mid-twirl ${mid.toFixed(2)})`);
    return `no snap in, cancelled by taking the blade, wrist back to ${c.roll.toFixed(3)} rad`;
  });

  check('blade hold: off by default, and honoured when asked for', () => {
    const aim = new THREE.Quaternion();
    const out = [];
    for (const holdPos of [false, true]) {
      const c = new SaberController({ holdPosition: holdPos });
      c.reset(CHEST, aim);
      const input = mkInput();
      c.gx = -0.8; c.gy = -0.6;
      for (let i = 0; i < 60; i++) c.applyInput(input, 1 / 60, { stamina: 1 });
      out.push({ holdPos, gx: c.gx, gy: c.gy });
    }
    assert(new SaberController().holdPosition === false, 'blade-holds-position is on by default');
    assert(Math.abs(out[0].gx - 0.30) < 0.02,
      `with the option off the blade settled at gx=${out[0].gx.toFixed(3)} instead of the ready guard`);
    assert(Math.abs(out[1].gx + 0.8) < 1e-6 && Math.abs(out[1].gy + 0.6) < 1e-6,
      `with the option on the blade drifted to gx=${out[1].gx.toFixed(3)} gy=${out[1].gy.toFixed(3)}`);
    return `off → back to ${out[0].gx.toFixed(2)}/${out[0].gy.toFixed(2)}, on → stays at ${out[1].gx.toFixed(2)}/${out[1].gy.toFixed(2)}`;
  });

  /* ── the capture window is untouched by all of it ──────────────────── */

  check('catch: none of this narrowed the window you have to hit', () => {
    // The ±12.5 cm / ±70 cm capture window is pinned by deflection.mjs against a
    // bare blade. Repeat it here with a stance held and a thrust running, because
    // both move the hilt and neither is allowed to cost the player their block.
    const measure = (setup) => {
      const s = blade();
      const c = new SaberController();
      const aim = new THREE.Quaternion();
      c.reset(CHEST, aim);
      setup(c);
      for (let i = 0; i < 4; i++) c.update(1 / 60, CHEST, aim, {});
      s.valid = false;
      s.setHiltPose(c.handPos, c.quat); s.update(1 / 60, 0);
      s.setHiltPose(c.handPos, c.quat); s.update(1 / 60, 1 / 60);
      const mid = s.pointAt(0.5, new THREE.Vector3());
      const axis = new THREE.Vector3().subVectors(s.tip, s.base).normalize();
      // slide the bolt's line across the blade, perpendicular to both the blade
      // and the bolt, and bisect for the last offset that still intercepts
      const side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 0, -1));
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const hits = (d) => {
        const from = mid.clone().addScaledVector(side, d).add(new THREE.Vector3(0, 0, 26));
        const step = new THREE.Vector3(0, 0, -1).multiplyScalar(40 / 60);
        const p = from.clone(), prev = from.clone();
        for (let f = 0; f < 90; f++) {
          prev.copy(p); p.add(step);
          if (intersectBladeSweep(prev, p, s, null)) return true;
          if (p.z < s.base.z - 4) return false;
        }
        return false;
      };
      if (!hits(0)) return 0;
      let lo = 0, hi = 0.02;
      while (hi < 2 && hits(hi)) { lo = hi; hi *= 1.6; }
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (hits(m)) lo = m; else hi = m; }
      return lo;
    };
    const plain = measure(() => {});
    const stanced = measure((c) => { c.stance = 1; });
    const thrusting = measure((c) => { c.thrust = 1; c.thrustStanding = 1; });
    const swinging = measure((c) => { c.swingT = OVERHEAD.wind; c.swing = 1; });
    assert(plain >= 0.08, `the bare window fell to ±${(plain * 100).toFixed(1)} cm`);
    assert(stanced >= 0.08, `holding a stance shrank the window to ±${(stanced * 100).toFixed(1)} cm`);
    assert(thrusting >= 0.08, `thrusting shrank the window to ±${(thrusting * 100).toFixed(1)} cm`);
    assert(swinging >= 0.08, `an overhead shrank the window to ±${(swinging * 100).toFixed(1)} cm`);

    // ── and the directional guard is added ON TOP of it, never instead of it.
    //
    // This check used to end here, pinning the blade's own capture window as
    // the whole of what a player has to hit. Directional blocking gives them a
    // second, much larger volume — a 1.4 m sphere sectored into four zones — and
    // the property worth pinning is now stronger and has two halves: the blade
    // window is UNCHANGED by any of it, and the zone is a strict superset of the
    // blade, so nothing a player could hit before can now be missed.
    const zoneWindow = () => {
      const c = new SaberController({ scheme: 'directional' });
      const aim = new THREE.Quaternion();
      c.reset(CHEST, aim);
      c.setZone('high', { force: true });
      c.update(1 / 60, CHEST, aim, {});
      const g = c.guard;
      // in front of the player (the aim looks down -Z) and closing on the chest
      const hits = (d) => {
        const from = CHEST.clone().add(new THREE.Vector3(d, 0, -26));
        const step = new THREE.Vector3(0, 0, 40 / 60);
        const p = from.clone(), prev = from.clone();
        for (let f = 0; f < 120; f++) {
          prev.copy(p); p.add(step);
          if (guardIntercept(prev, p, g, new THREE.Vector3())) return true;
          if (p.z > CHEST.z + 3) return false;
        }
        return false;
      };
      if (!hits(0)) return 0;
      let lo = 0, hi = 0.05;
      while (hi < 4 && hits(hi)) { lo = hi; hi *= 1.6; }
      for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (hits(m)) lo = m; else hi = m; }
      return lo;
    };
    const zone = zoneWindow();
    assert(zone > plain,
      `a raised guard zone answers ±${(zone * 100).toFixed(1)} cm against the bare blade's `
      + `±${(plain * 100).toFixed(1)} cm — the new scheme is NARROWER than the one it replaces`);
    // The zone must not be so wide it stops being a guard: past the sphere it
    // has to let a clean miss through, or "directional" would be a word for a
    // bubble.
    assert(zone < GUARD.radius,
      `the zone answers ±${(zone * 100).toFixed(0)} cm, wider than its own ${GUARD.radius} m sphere`);
    return `blade window bare ±${(plain * 100).toFixed(1)} cm, stance ±${(stanced * 100).toFixed(1)} cm, `
      + `thrust ±${(thrusting * 100).toFixed(1)} cm, overhead ±${(swinging * 100).toFixed(1)} cm; `
      + `a raised HIGH guard answers ±${(zone * 100).toFixed(0)} cm on top of it`;
  });
}
