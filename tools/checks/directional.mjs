/**
 * BATTLEFRONT BORZ — DIRECTIONAL BLOCKING.
 *
 * The scheme this replaces had the mouse doing two jobs at once. Holding the
 * blade froze the camera so the mouse could steer a continuous guard POSITION,
 * and the deflection model reads the camera to decide where a bolt goes:
 *
 *     "I don't understand how you're supposed to block and also aim at an enemy
 *      in the same motion because when you're moving the blade to specifically
 *      deflect the cursor can't move."
 *
 * That is not a tuning problem, it is the definition of the scheme, and the one
 * line it lived on was `const bladeMode = bladeHeld && this.catchHold <= 0`.
 *
 * A guard ZONE is a discrete state set by a flick. Nothing has to be held in
 * place, so nothing has to be taken. Every check below prints the number, and
 * the number that matters most is in `camera` — the degrees of view the player
 * gets to sweep while a bolt is being blocked, which used to be exactly zero.
 */

import * as THREE from 'three';
import { Saber } from '../../src/game/Saber.js';
import {
  SaberController, ZONE, ZONE_POSE, ZONE_ROSE, ZONE_ORDER, GUARD, PARRY,
  SPIN, SLASH, CHARGE, aimAngles, zoneOfRose, zoneOfDir, roseDelta,
} from '../../src/game/SaberController.js';
import { BoltPool, guardIntercept, guardZoneOf } from '../../src/game/Bolts.js';
import {
  CatchWindow, PARRY_GRADE, captureSnapshot, gradeCaught, zoneTolerance,
  GRADE, GRADE_NAME, DIFFICULTY,
} from '../../src/game/Combat.js';
import { World } from '../../src/game/World.js';
import { Player } from '../../src/game/Player.js';
import { ACTIONS, WHEEL, defaultBindings, conflicts, keyLabel } from '../../src/engine/Bindings.js';
import { Input } from '../../src/engine/Input.js';
import { clocked } from './_shared.mjs';

const scene = new THREE.Scene();
const CHEST = new THREE.Vector3(0, 1.35, 0);
const DEG = 180 / Math.PI;
const TIERS = ['padawan', 'knight', 'master', 'grandmaster'];

function blade() {
  const s = new Saber(scene, { colorIndex: 0, bladeLength: 1.15 });
  s.ignite(); s.ignition = 1;
  return s;
}
function hold(s, pos, quat, dt = 1 / 60) {
  s.valid = false;
  s.setHiltPose(pos, quat); s.update(dt, 0);
  s.setHiltPose(pos, quat); s.update(dt, dt);
  return s;
}

/** The input stub the controller reads, with a mouse we can drive. */
function mkInput() {
  return {
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: defaultBindings(),
    _held: new Set(), _hit: new Set(),
    act(id) { return this._held.has(id); },
    actHit(id) { return this._hit.has(id); },
  };
}

/** A controller in a named scheme, settled, with its guard published. */
function rig(scheme, aim = new THREE.Quaternion(), chest = CHEST) {
  const c = new SaberController({ scheme });
  c.reset(chest, aim);
  const input = mkInput();
  const step = (dt = 1 / 60) => {
    const cam = c.applyInput(input, dt, { stamina: 1 });
    c.update(dt, chest, aim, { stamina: 1, flow: 0 });
    input._hit.clear();
    input.mouse.dx = 0; input.mouse.dy = 0; input.mouse.wheel = 0;
    return cam;
  };
  return { c, input, step, chest, aim };
}

/** A unit direction at polar angle `theta` off the sightline, at rose bearing `rose`. */
function dirAt(theta, rose) {
  const st = Math.sin(theta), ct = Math.cos(theta);
  return new THREE.Vector3(st * Math.cos(rose), st * Math.sin(rose), -ct);
}

/**
 * A direction at a given bearing IN THE GUARD'S OWN CHART, which is the one
 * place a "rose error in degrees" is a well-defined quantity.
 *
 * The guard's rose is atan2(pitch, yaw) and yaw/pitch are the same Euler pair
 * applyAssist has always used, so the chart is NOT the geometric sphere: a
 * direction 60° off the sightline at geometric bearing φ comes out at a rose
 * that differs from φ by up to 9°, because the yaw/pitch projection stretches
 * the horizontal. Measuring a tolerance with a geometric probe therefore reads
 * a tolerance that is nowhere in the code — it reported Padawan's ±127.8° as
 * ±136.4°, an 8.6° error entirely in the instrument.
 *
 * `rho` is the chart radius; θ works out as acos(cos yaw · cos pitch), which
 * stays inside the reach for every bearing at the radii used here.
 */
function chartDir(rho, rose) {
  const yaw = rho * Math.cos(rose), pitch = rho * Math.sin(rose);
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

/**
 * A guard descriptor by hand, so the geometry can be examined without a
 * controller in the way. Same fields _publishGuard writes.
 */
function guardFor(zone, { tol = 0, origin = CHEST, aim = new THREE.Quaternion() } = {}) {
  return {
    active: true, zone, rose: ZONE_ROSE[zone], half: GUARD.sector + tol,
    centre: GUARD.centre, reach: GUARD.reach, radius: GUARD.radius,
    parry: false, parryAge: 0,
    origin: origin.clone(), inv: aim.clone().invert(),
  };
}

/** Fire a line at the chest from direction `d` and ask whether `g` answers it. */
function answers(g, d, { miss = 0, from = 24, origin = CHEST } = {}) {
  const target = origin.clone();
  if (miss) {
    // slide the aim point sideways, perpendicular to the incoming line
    const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    target.addScaledVector(side.normalize(), miss);
  }
  const start = target.clone().addScaledVector(d, from);
  const step = d.clone().negate().multiplyScalar(40 / 60);
  const p = start.clone(), prev = start.clone();
  for (let f = 0; f < 200; f++) {
    prev.copy(p); p.add(step);
    if (guardIntercept(prev, p, g, new THREE.Vector3())) return true;
    if (p.clone().sub(origin).dot(d) < -2) return false;
  }
  return false;
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1. The partition                                                  */
  /* ══════════════════════════════════════════════════════════════════ */

  check('zones: every bolt classifies into exactly one zone', () => {
    // The four sectors have to TILE the rose — no direction with two answers
    // and none with none — or "the matching zone blocks" is not a statement
    // about anything. Swept at 2° over the whole circle and at every polar
    // angle from the centre disc out to the reach.
    let tested = 0, worstGap = 0;
    for (let roseDeg = 0; roseDeg < 360; roseDeg += 2) {
      const rose = roseDeg / DEG;
      const owners = ZONE_ORDER.filter(z => Math.abs(roseDelta(rose, ZONE_ROSE[z])) <= GUARD.sector + 1e-9);
      assert(owners.length >= 1, `rose ${roseDeg}° falls in no zone at all`);
      // at most two only exactly on a boundary, and zoneOfRose must pick one
      const picked = zoneOfRose(rose);
      assert(owners.includes(picked),
        `rose ${roseDeg}° binned to ${picked}, which does not own it (${owners.join('/')})`);
      tested++;
      worstGap = Math.max(worstGap, owners.length);
    }
    // and the geometric test agrees with the classifier, bolt by bolt
    let mismatch = 0, sampled = 0, multi = 0;
    for (let thDeg = 22; thDeg <= 95; thDeg += 4) {
      for (let roseDeg = 0; roseDeg < 360; roseDeg += 6) {
        const d = dirAt(thDeg / DEG, roseDeg / DEG);
        const hits = ZONE_ORDER.filter(z => answers(guardFor(z), d));
        sampled++;
        if (thDeg > GUARD.reach * DEG) { if (hits.length) mismatch++; continue; }
        if (hits.length !== 1) { multi++; continue; }
        const want = guardZoneOf(
          CHEST.clone().addScaledVector(d, 24), CHEST.clone().addScaledVector(d, 23),
          guardFor(ZONE.HIGH)).zone;
        if (want !== hits[0]) mismatch++;
      }
    }
    assert(multi === 0, `${multi} of ${sampled} sampled directions were answered by 0 or 2+ zones`);
    assert(mismatch === 0, `${mismatch} of ${sampled} directions were answered by a zone the classifier did not name`);
    return `${tested} rose bearings tile the circle (max ${worstGap} owners, only on a boundary); `
      + `${sampled} bolt directions, each answered by exactly one zone`;
  });

  check('zones: a shot down your own centreline is answered by any guard', () => {
    // THE number that decides whether this is a skill or a lottery.
    //
    // A bolt is classified by where its LINE crosses the guard sphere, so a
    // frontal shooter's zone is decided by how far off your centreline the shot
    // was placed: θ = asin(miss / radius). Enemy spread is ±1.4–2.1°, which at
    // 20 m scatters bolts around the chest in a direction that is UNIFORM on the
    // rose — so without the centre disc a shooter you are looking straight at
    // would hand you a fresh random zone on every bolt of every burst.
    const torso = 0.40;                                   // half a body, generously
    const thetaTorso = Math.asin(torso / GUARD.radius);
    assert(thetaTorso < GUARD.centre,
      `a shot ${torso} m off your centreline arrives at ${(thetaTorso * DEG).toFixed(1)}°, `
      + `outside the ${(GUARD.centre * DEG).toFixed(0)}° disc — frontal fire would be a coin toss`);

    const head = new THREE.Vector3(0, 0, -1);
    const rows = [];
    for (const m of [0, 0.15, 0.3, 0.4]) {
      const took = ZONE_ORDER.filter(z => answers(guardFor(z), head, { miss: m }));
      assert(took.length === 4,
        `a bolt ${m} m off centre was answered by only ${took.length} of the four zones (${took.join('/') || 'none'})`);
      rows.push(`${(m * 100).toFixed(0)} cm→all 4`);
    }
    // …and past the torso it does become directional, which is the other half
    const wide = ZONE_ORDER.filter(z => answers(guardFor(z), head, { miss: 1.1 }));
    assert(wide.length < 4,
      `a bolt 1.1 m wide of you — a clean miss — was still answered by all four zones`);

    /**
     * THE WHOLE RULE, AS ONE NUMBER: how far off your sightline a shooter has to
     * stand before their bolts stop being answered by any guard you happen to be
     * holding, and start needing the right one.
     *
     * This is the number a player would have to work out for themselves, and it
     * is worth pinning because it is what makes the scheme learnable in one
     * sentence — "your guard covers your centreline plus one quadrant" — and
     * because it is where the mechanic could silently become either trivial (a
     * disc so wide nothing is directional) or a lottery (a disc so narrow that
     * the enemy you are LOOKING at hands you a random zone on every bolt).
     */
    let lo = 0, hi = Math.PI / 2;
    const allFour = (b) => ZONE_ORDER.filter(
      z => answers(guardFor(z), new THREE.Vector3(-Math.sin(b), 0, -Math.cos(b)))).length === 4;
    assert(allFour(0), 'setup: a shooter dead ahead is not covered by every guard');
    while (hi - lo > 1e-4) { const m = (lo + hi) / 2; if (allFour(m)) lo = m; else hi = m; }
    const crossover = lo * DEG;
    assert(Math.abs(crossover - GUARD.centre * DEG) < 1.5,
      `the "any guard answers it" region reaches ${crossover.toFixed(1)}° of shooter bearing, `
      + `not the ${(GUARD.centre * DEG).toFixed(0)}° the disc is written as`);
    // …and immediately past it, exactly one zone answers. If two did, the disc
    // would just have a soft edge instead of being a disc.
    const past = ZONE_ORDER.filter(z => answers(guardFor(z),
      new THREE.Vector3(-Math.sin((crossover + 4) / DEG), 0, -Math.cos((crossover + 4) / DEG))));
    assert(past.length === 1,
      `${past.length} zones answer a shooter ${(crossover + 4).toFixed(0)}° off the sightline (${past.join('/')})`);

    return `${rows.join(', ')}; a 1.1 m near-miss is answered by ${wide.length} (${wide.join('/')}); `
      + `torso shots arrive inside ${(thetaTorso * DEG).toFixed(1)}° of a ${(GUARD.centre * DEG).toFixed(0)}° disc; `
      + `a shooter past ${crossover.toFixed(0)}° of bearing needs the right zone (${past[0]})`;
  });

  check('zones: the rose tables in Bolts and SaberController have not drifted', () => {
    // Bolts keeps its own copy so it needs no dependency on the controller. Two
    // copies of a table is exactly how a partition silently stops partitioning.
    const rows = [];
    for (const z of ZONE_ORDER) {
      const d = dirAt(60 / DEG, ZONE_ROSE[z]);
      const seen = guardZoneOf(CHEST.clone().addScaledVector(d, 20),
        CHEST.clone().addScaledVector(d, 19), guardFor(z));
      assert(seen.zone === z,
        `a bolt straight down ${z}'s own axis was classified ${seen.zone} by Bolts`);
      assert(zoneOfDir(d, new THREE.Quaternion()) === z,
        `…and ${z} by the controller's own classifier`);
      rows.push(`${z}@${(ZONE_ROSE[z] * DEG).toFixed(0)}°`);
    }
    return rows.join(' ');
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2. Match blocks, mismatch does not — through the real pool        */
  /* ══════════════════════════════════════════════════════════════════ */

  /**
   * The whole path: a real controller in a real scheme, a real Saber on its
   * hilt pose, a real BoltPool, a bolt fired from a real bearing.
   */
  const shoot = (zone, fromZone, { tier = 'grandmaster', theta = 60, scheme = 'directional' } = {}) => {
    const pool = new BoltPool(scene, 8);
    const r = rig(scheme);
    const s = blade();
    r.c.assist = DIFFICULTY[tier].assist;
    // Neutral is the button UP: holding it always raises a guard, so there is
    // no such thing as "holding the blade with no zone" and asking for one
    // would be measuring a state the game cannot be in.
    if (zone !== ZONE.NONE) r.input._held.add('blade');
    r.step();
    if (zone !== ZONE.NONE) r.c.setZone(zone, { force: true });
    for (let i = 0; i < 30; i++) { r.step(); s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, i / 60); }
    r.c.zoneParry = false;                       // a settled guard, not a parry
    r.step();

    const d = dirAt(theta / DEG, ZONE_ROSE[fromZone]);
    const from = CHEST.clone().addScaledVector(d, 14);
    const bolt = pool.fire(from, d.clone().negate(), { speed: 40, team: 1 });
    let hit = null;
    pool.onDeflect = (b, entry, h) => { hit = { ...h, bolt: b }; b.active = false; };
    const owner = { control: r.c, chest: r.chest };
    for (let f = 0; f < 40 && !hit; f++) {
      r.step();
      s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, (30 + f) / 60);
      pool.update(1 / 60, { blades: [{ saber: s, owner, team: 0, guard: null }] });
      if (!bolt.active && !hit) break;
    }
    pool.dispose();
    return hit;
  };

  check('zones: the matching zone blocks, and the wrong zone does not', () => {
    const rows = [];
    let blocked = 0, through = 0;
    for (const held of ZONE_ORDER) {
      for (const from of ZONE_ORDER) {
        const hit = shoot(held, from);
        const same = held === from;
        if (same) {
          assert(hit, `holding ${held}, a bolt from ${from} at 60° went straight through the guard`);
          blocked++;
        } else {
          const opposite = Math.abs(roseDelta(ZONE_ROSE[held], ZONE_ROSE[from])) > Math.PI / 2 + 1e-6;
          if (opposite) {
            assert(!hit, `holding ${held}, a bolt from the OPPOSITE zone ${from} was blocked anyway`);
          }
          if (!hit) through++;
        }
      }
      rows.push(held);
    }
    assert(through === 12,
      `at Grandmaster only ${through} of the 12 wrong-zone shots got through — the guard is not directional`);
    return `4 zones × 4 bearings at 60°: ${blocked}/4 matching blocked, ${through}/12 mismatched let through`;
  });

  check('zones: no guard at all blocks nothing', () => {
    // Neutral has to be a real state, or the zone would be decoration on top of
    // "hold the button". With the guard down the 1.4 m sphere does not exist and
    // only the blade itself can answer anything — which at 60° off the sightline
    // it cannot, because the blade is resting on the ready guard.
    for (const from of ZONE_ORDER) {
      assert(!shoot(ZONE.NONE, from), `a bolt from ${from} was blocked with no guard raised`);
    }
    const r = rig('directional');
    r.step();
    assert(!r.c.guard.active && r.c.zone === ZONE.NONE, 'the guard is up before the button is');
    r.input._held.add('blade'); r.step();
    assert(r.c.guard.active, 'holding the blade did not raise a guard');
    r.input._held.delete('blade'); r.step();
    assert(!r.c.guard.active && r.c.zone === ZONE.NONE, 'letting go left the guard up');
    return 'no guard → 0 of 4 blocked; button up → down → up tracks exactly';
  });

  check('zones: the two continuous-aim schemes publish no guard at all', () => {
    // Free aim must survive untouched. A zone guard leaking into 'hold' would
    // hand it a free 1.4 m sphere it never had.
    for (const scheme of ['hold', 'free']) {
      const r = rig(scheme);
      r.input._held.add('blade');
      for (let i = 0; i < 20; i++) r.step();
      assert(!r.c.guard.active, `scheme "${scheme}" published a directional guard`);
      assert(r.c.zone === ZONE.NONE, `scheme "${scheme}" entered zone ${r.c.zone}`);
      for (const from of ZONE_ORDER) {
        assert(!shoot(ZONE.HIGH, from, { scheme }),
          `scheme "${scheme}" blocked a bolt from ${from} with a zone it should not have`);
      }
    }
    // …and switching away from directional drops the guard on the spot
    const r = rig('directional');
    r.input._held.add('blade');
    for (let i = 0; i < 10; i++) r.step();
    assert(r.c.guard.active, 'setup: the directional guard never came up');
    r.c.setScheme('hold'); r.step();
    assert(!r.c.guard.active && r.c.zone === ZONE.NONE,
      'switching scheme mid-run left a directional guard standing');
    return 'hold and free: no guard published, 0 of 8 bolts taken by one; scheme change drops it';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3. THE CAMERA — the whole point of the change                     */
  /* ══════════════════════════════════════════════════════════════════ */

  check('camera: the view is live while you block, which it never was before', () => {
    /**
     * The measurement this whole round exists to produce.
     *
     * Both schemes get the SAME mouse: an ordinary 14 px/frame track, plus one
     * 64 px flick, held across the frames in which a bolt arrives and is
     * answered. What is counted is the degrees of camera yaw the player gets
     * while that is happening.
     *
     * Under 'hold' the answer is exactly zero by construction — `bladeMode`
     * returns { yaw: 0, pitch: 0 } — and that zero IS the bug report.
     */
    const trial = (scheme) => {
      const pool = new BoltPool(scene, 8);
      const aim = new THREE.Quaternion();
      const r = rig(scheme, aim);
      const s = blade();
      r.input._held.add('blade');
      for (let i = 0; i < 20; i++) { r.step(); s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, i / 60); }

      // A bolt from 55° to the left, which is LEFT's zone, timed to land after
      // the flick. 40 m/s over 9 m is 0.225 s = ~13 frames.
      const d = dirAt(55 / DEG, ZONE_ROSE.left);
      const bolt = pool.fire(CHEST.clone().addScaledVector(d, 9), d.clone().negate(),
        { speed: 40, team: 1 });
      const owner = { control: r.c, chest: r.chest };
      let yawSwept = 0, pitchSwept = 0, blocked = false, blockFrame = -1;
      pool.onDeflect = (b) => { blocked = true; b.active = false; };
      for (let f = 0; f < 30; f++) {
        // the flick that sets LEFT: 64 px of leftward mouse in one frame
        if (f === 2) { r.input.mouse.dx = -64; r.input.mouse.dy = 0; }
        else { r.input.mouse.dx = -14; r.input.mouse.dy = 4; }
        const cam = r.step();
        yawSwept += Math.abs(cam.yaw) * DEG;
        pitchSwept += Math.abs(cam.pitch) * DEG;
        s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, (20 + f) / 60);
        pool.update(1 / 60, { blades: [{ saber: s, owner, team: 0, guard: null }] });
        if (blocked && blockFrame < 0) blockFrame = f;
        if (blocked) break;
      }
      pool.dispose();
      return { yawSwept, pitchSwept, blocked, blockFrame, zone: r.c.zone };
    };

    const dir = trial('directional');
    const old = trial('hold');

    assert(dir.blocked, 'setup: the directional guard never blocked the bolt, so this measures nothing');
    assert(dir.zone === ZONE.LEFT,
      `the leftward flick set zone "${dir.zone}" instead of LEFT — the block was luck`);
    assert(old.yawSwept === 0 && old.pitchSwept === 0,
      `setup: 'hold' swept ${old.yawSwept.toFixed(1)}° of yaw, so it is not the frozen scheme this replaces`);
    assert(dir.yawSwept > 20,
      `the camera only swept ${dir.yawSwept.toFixed(1)}° while blocking — the point of the change is that it moves`);
    return `blocking the same bolt: directional swept ${dir.yawSwept.toFixed(1)}° yaw / `
      + `${dir.pitchSwept.toFixed(1)}° pitch over ${dir.blockFrame + 1} frames, `
      + `hold swept ${old.yawSwept.toFixed(1)}° / ${old.pitchSwept.toFixed(1)}° — the camera was frozen`;
  });

  check('camera: aiming slowly never changes your guard', () => {
    // The other half of "live at all times": if ordinary tracking set zones,
    // the guard would flail every time you followed a target.
    const r = rig('directional');
    r.input._held.add('blade');
    r.step();
    const zone0 = r.c.zone;
    let swept = 0;
    for (let f = 0; f < 240; f++) {
      // a 2 Hz sinusoidal track at up to 18 px/frame — 1080 px/s, brisk aiming
      r.input.mouse.dx = Math.sin(f / 60 * Math.PI * 4) * 18;
      r.input.mouse.dy = Math.cos(f / 60 * Math.PI * 4) * 12;
      swept += Math.abs(r.step().yaw) * DEG;
    }
    assert(r.c.zone === zone0,
      `four seconds of ordinary tracking changed the guard from ${zone0} to ${r.c.zone}`);
    assert(r.c.zoneFlicks === 1, `tracking registered ${r.c.zoneFlicks - 1} spurious flicks`);
    assert(swept > 100, `setup: the mouse only swept ${swept.toFixed(0)}° — it was not really aiming`);
    // and a genuine flick still lands
    r.input.mouse.dx = 0; r.input.mouse.dy = -60;
    r.step();
    assert(r.c.zone === ZONE.HIGH, `an upward flick set "${r.c.zone}" instead of HIGH`);
    return `${swept.toFixed(0)}° of tracking at up to 1080 px/s: guard unmoved on ${zone0}; `
      + `one 60 px upward flick → HIGH (gate ${PARRY.speed} px/s)`;
  });

  check('flick: a fast PAN is not a flick, and a flick out of a fast pan still is', () => {
    /**
     * A speed threshold alone cannot tell the two apart, because a fast pan
     * spends part of every sweep above any fixed threshold. Measured, five
     * seconds of ordinary 2 Hz tracking with a bare 1400 px/s gate:
     *
     *   peak  600 → 0 changes    peak 1800 → 20
     *   peak 1000 → 0            peak 2400 → 41
     *   peak 1400 → 0            peak 3600 → 41
     *
     * — a guard flailing between all four zones every time the player makes a
     * big turn, which is precisely the situation this scheme exists to be good
     * at. The second half of the gate is `PARRY.burst`: a flick must also be
     * fast relative to what the hand has been doing, read off the mouseSpeed EMA
     * this file already kept and never used for anything.
     *
     * Both directions are measured, because a gate that rejects panning by
     * rejecting everything would pass half of this.
     */
    const pan = (peak, hz = 2, frames = 300) => {
      const r = rig('directional');
      r.input._held.add('blade');
      r.step();
      const base = r.c.zoneFlicks;
      const amp = peak / 60;
      for (let f = 0; f < frames; f++) {
        r.input.mouse.dx = Math.sin(f / 60 * Math.PI * 2 * hz) * amp;
        r.input.mouse.dy = Math.cos(f / 60 * Math.PI * 2 * hz) * amp * 0.6;
        r.step();
      }
      return { changes: r.c.zoneFlicks - base, ctl: r.c };
    };
    const rows = [];
    for (const peak of [600, 1000, 1400, 1800, 2400, 3600]) {
      const { changes } = pan(peak);
      // Two is the EMA's own warm-up: from a standstill the average is zero, so
      // the first sweep of a violent pan genuinely IS a movement out of rest.
      // Twenty is a mechanic that does not work.
      assert(changes <= 2,
        `five seconds of ${peak} px/s panning changed the guard ${changes} times without being asked`);
      rows.push(`${peak}→${changes}`);
    }

    // …and the flick still has to land, from every one of those pan speeds
    const flickAfterPan = (peak) => {
      const r = rig('directional');
      r.input._held.add('blade');
      const amp = peak / 60;
      for (let f = 0; f < 120; f++) {
        r.input.mouse.dx = Math.sin(f / 60 * Math.PI * 4) * amp;
        r.step();
      }
      r.input.mouse.dx = 0; r.input.mouse.dy = -70;      // straight up = HIGH
      r.step();
      return r.c.zone;
    };
    for (const peak of [0, 600, 1200, 1800, 2400, 3600]) {
      const got = flickAfterPan(peak);
      assert(got === ZONE.HIGH,
        `a 70 px upward flick out of a ${peak} px/s pan set "${got}" instead of HIGH — `
        + `the burst gate (${PARRY.burst}x) is rejecting real flicks`);
    }
    return `panning ${rows.join(', ')} spurious changes in 5 s; `
      + `a 70 px flick lands out of a pan at 0–3600 px/s (gate ${PARRY.speed} px/s and ${PARRY.burst}x recent)`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  4. The parry window                                               */
  /* ══════════════════════════════════════════════════════════════════ */

  /**
   * One contact, graded, with the zone entered `age` seconds before it. Driven
   * through captureSnapshot and gradeCaught — the same two functions every
   * other deflection in the game goes through, which is the point: a parry is a
   * second way onto the existing ladder, not a second ladder.
   */
  const gradeParry = (age, { parry = true, enemy = true } = {}) => {
    const s = blade();
    hold(s, new THREE.Vector3(0, 1.35, 0), new THREE.Quaternion());   // PARKED blade
    const p = s.pointAt(0.62, new THREE.Vector3());
    const bolt = {
      pos: p.clone().add(new THREE.Vector3(0, 0, 2)), prev: p.clone(),
      vel: new THREE.Vector3(0, 0, -40), speed: 40,
      guardZone: { zone: ZONE.HIGH, parry, age },
    };
    const snap = captureSnapshot(bolt, s, { bladeT: 0.62, point: p, auto: parry });
    const target = { dead: false, aimPoint: (o) => o.set(0, 1.35, -20) };
    const res = gradeCaught(snap, {
      aimDir: new THREE.Vector3(0, 0, -1), aimOrigin: CHEST,
      candidates: enemy ? [target] : [], flow: 1, caught: true,
    });
    return { snap, res };
  };

  check('parry: a zone entered inside the window grants the return; a late one does not', () => {
    // The blade is PARKED in every one of these — 0 m/s, nowhere near the
    // 7.5 m/s a RETURN normally costs — so the only thing being graded is the
    // timing. That is deliberate: a zone snap peaks the blade at 1.8–8.1 m/s
    // depending on which two poses it is between, so half of them could never
    // earn a return by force and a parry that depended on force would be a
    // coin toss decided by which guard you happened to be leaving.
    const rows = [];
    const sharp = gradeParry(0.04);
    const inside = gradeParry(0.16);
    const late = gradeParry(0.16, { parry: false });

    assert(sharp.snap.bladeSpeed < 1,
      `setup: the "parked" blade was moving ${sharp.snap.bladeSpeed.toFixed(1)} m/s — force could explain the grade`);
    assert(sharp.res.grade === GRADE.PERFECT,
      `a ${(PARRY_GRADE.perfect * 1000).toFixed(0)} ms parry graded ${GRADE_NAME[sharp.res.grade]}, expected PERFECT RETURN`);
    assert(inside.res.grade === GRADE.RETURN,
      `a 160 ms parry graded ${GRADE_NAME[inside.res.grade]}, expected RETURN`);
    assert(late.res.grade === GRADE.BLOCK,
      `a guard set before the window graded ${GRADE_NAME[late.res.grade]}, expected BLOCK`);
    assert(late.res.damageMul === 1 && inside.res.damageMul === 1.5 && sharp.res.damageMul === 2.5,
      `damage ladder came out ${late.res.damageMul}/${inside.res.damageMul}/${sharp.res.damageMul}`);

    // the redirect: a parried bolt goes at what is under the reticle, and a
    // blocked one scatters off the blade
    assert(inside.res.target, 'a parry was not aimed at anything');
    const toEnemy = new THREE.Vector3(0, 1.35, -20).sub(inside.snap.point).normalize();
    const off = Math.acos(Math.max(-1, Math.min(1, inside.res.dir.dot(toEnemy)))) * DEG;
    assert(off < 3, `the parried bolt left ${off.toFixed(1)}° off the enemy it was aimed at`);
    assert(!late.res.target, 'a plain block picked a target — a block is not aimed');
    rows.push(`${(PARRY_GRADE.perfect * 1000).toFixed(0)} ms→PERFECT ×2.5`);
    rows.push(`160 ms→RETURN ×1.5 (${off.toFixed(1)}° off the enemy)`);
    rows.push('late→BLOCK ×1.0, scattered');
    return rows.join(', ');
  });

  check('parry: the window is real time and cannot be held open by mashing', () => {
    // A window that re-arms on every press is a window that is always open.
    // PARRY.cooldown is longer than PARRY.window on purpose, so two windows can
    // never touch and the duty cycle has a ceiling that can be stated.
    assert(PARRY.cooldown > PARRY_GRADE.window,
      `the re-entry cooldown ${PARRY.cooldown}s is not longer than the ${PARRY_GRADE.window}s window`);

    // A mash the flick gate will actually honour. Flicking EVERY frame no longer
    // works at all — the burst gate sees the mouse speed EMA rise to meet it and
    // stops calling it a flick, which is a second, independent defence measured
    // in its own check above. So this mashes as fast as a player really could:
    // a full 70 px throw into a different zone every seventh frame, 8.6 times a
    // second, with just enough gap between them for the EMA to fall back.
    const r = rig('directional');
    r.input._held.add('blade');
    r.step();
    let open = 0, frames = 0;
    const cycle = ['high', 'left', 'low', 'right'];
    for (let f = 0; f < 240; f++) {
      if (f % 7 === 0) {
        const rose = ZONE_ROSE[cycle[(f / 7) % 4]];
        r.input.mouse.dx = Math.cos(rose) * 70;
        r.input.mouse.dy = -Math.sin(rose) * 70;
      }
      r.step();
      frames++;
      if (r.c.guard.parry) open++;
    }
    const entries = r.c.zoneFlicks;
    const duty = open / frames;
    const ceiling = PARRY_GRADE.window / PARRY.cooldown;
    assert(duty <= ceiling + 0.02,
      `mashing held a parry window open ${(duty * 100).toFixed(0)}% of the time against a `
      + `${(ceiling * 100).toFixed(0)}% ceiling`);
    assert(entries > 25,
      `setup: only ${entries} zone changes in 4 s — the mash did not happen, so the cooldown was never tested`);

    // …while a player who flicks once and waits gets exactly one window, and
    // exactly one. The flick is at frame 40 rather than 10 because RAISING the
    // guard opens a window of its own — tapping the button as a bolt lands is
    // the parry input — and a flick inside that window's own cooldown would be
    // measuring the raise, not the flick.
    const q = rig('directional');
    q.input._held.add('blade');
    q.step();
    let raised = 0, flicked = 0;
    for (let f = 0; f < 160; f++) {
      if (f === 40) { q.input.mouse.dx = -70; q.input.mouse.dy = 0; }
      q.step();
      if (q.c.guard.parry) { if (f < 40) raised += 1 / 60; else flicked += 1 / 60; }
    }
    assert(q.c.zone === ZONE.LEFT, `the flick set ${q.c.zone}, not LEFT`);
    for (const [what, s] of [['raising the guard', raised], ['one flick', flicked]]) {
      assert(Math.abs(s - PARRY_GRADE.window) < 0.03,
        `${what} bought ${(s * 1000).toFixed(0)} ms of parry window, `
        + `not ${(PARRY_GRADE.window * 1000).toFixed(0)} ms`);
    }
    return `${entries} zone changes in 4 s bought ${(duty * 100).toFixed(0)}% window `
      + `(ceiling ${(ceiling * 100).toFixed(0)}%); raise ${(raised * 1000).toFixed(0)} ms, `
      + `flick ${(flicked * 1000).toFixed(0)} ms`;
  });

  check('parry: the whole path, through World\'s own catch and throw', () => {
    /**
     * A parry is CAUGHT — it rides the blade for the catch window and is thrown
     * where you are looking. That is not a new mechanic bolted on beside the
     * old one, it is the old one finally being usable: the camera the window was
     * invented to hand back was never taken in the first place.
     */
    const pool = new BoltPool(scene, 8);
    const s = blade();
    const aim = new THREE.Quaternion();
    const r = rig('directional', aim);
    const events = [];
    const w = Object.assign(Object.create(World.prototype), {
      players: [], enemies: [], bolts: pool, settings: {},
      particles: { sparkBurst: () => {}, plasma: { spawn: () => {} } },
      engine: { flash: () => {} }, addHitstop: () => {},
      report: () => {}, notifyFloating: () => {},
      onDeflectFeedback: (g, p, why) => events.push({ g, why }),
    });
    const enemy = { dead: false, aimPoint: (o) => o.set(6, 1.35, -18) };
    w.enemies.push(enemy);
    const p = Object.assign(Object.create(Player.prototype), {
      alive: true, saber: s, isLocal: true, team: 0, flow: 1, score: 0, stamina: 100,
      deflects: 0, perfects: 0, combo: 0, comboTimer: 0,
      aimDir: new THREE.Vector3(0, 0, -1), chest: CHEST.clone(),
      camera: { pos: CHEST.clone(), addShake: () => {} },
      boonMods: { deflectDamage: 1, returnCone: 0.42 },
      addFlow: () => {}, boltCatch: new CatchWindow(), control: r.c,
    });
    w.players.push(p);
    pool.onDeflect = (b, entry, hit, pt) => w._onBoltDeflect(b, entry, hit, pt);

    r.input._held.add('blade');
    for (let i = 0; i < 20; i++) { r.step(); s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, i / 60); }

    // bolt from 58° left, 6 m out: ~9 frames of flight at 40 m/s
    const d = dirAt(58 / DEG, ZONE_ROSE.left);
    const bolt = pool.fire(CHEST.clone().addScaledVector(d, 6), d.clone().negate(), { speed: 40, team: 1 });
    let caughtAt = -1;
    for (let f = 0; f < 40; f++) {
      if (f === 4) { r.input.mouse.dx = -70; r.input.mouse.dy = 0; }   // flick LEFT, late
      r.step();
      s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, (20 + f) / 60);
      pool.update(1 / 60, { blades: w._bladeEntries() });
      w._updateCatch(1 / 60);
      if (bolt.held && caughtAt < 0) caughtAt = f;
      if (caughtAt >= 0 && !bolt.held) break;
    }
    assert(r.c.zone === ZONE.LEFT, `the flick set ${r.c.zone}, not LEFT`);
    assert(caughtAt >= 0, 'the parried bolt was never caught on the blade');
    assert(bolt.team === 0, 'the parried bolt did not change sides — it was not returned');
    assert(p.deflects > 0, 'the parry credited nothing');
    const toEnemy = new THREE.Vector3(6, 1.35, -18).sub(bolt.pos).normalize();
    const off = Math.acos(Math.max(-1, Math.min(1, bolt.vel.clone().normalize().dot(toEnemy)))) * DEG;
    assert(off < 8, `the returned bolt left ${off.toFixed(1)}° off the enemy under the reticle`);
    pool.dispose();
    return `flicked LEFT on frame 4, caught on ${caughtAt}, thrown back ${off.toFixed(1)}° off the enemy; `
      + `${p.deflects} deflect credited, ${p.perfects} perfect`;
  });

  check('parry: the flag does not ride the bolt back out again', () => {
    /**
     * A parry stamps the bolt, because World rebuilds the hit descriptor from
     * three fields on its way to captureSnapshot and anything on the descriptor
     * would be dropped in transit. A stamp on a shared, pooled, RECYCLED object
     * has a lifetime, and getting it wrong here is not cosmetic: a returned bolt
     * is on YOUR team and flying at an enemy who also has a blade, and their
     * captureSnapshot reads the same field. A stale flag would hand that enemy a
     * free RETURN off a guard they never held.
     *
     * So the stamp lives for exactly one callback. Measured on the real pool.
     */
    const pool = new BoltPool(scene, 8);
    const r = rig('directional');
    const s = blade();
    r.input._held.add('blade');
    for (let i = 0; i < 20; i++) { r.step(); s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, i / 60); }
    r.c.setZone(ZONE.LEFT, { force: true });

    const d = dirAt(58 / DEG, ZONE_ROSE.left);
    const bolt = pool.fire(CHEST.clone().addScaledVector(d, 6), d.clone().negate(), { speed: 40, team: 1 });
    let sawInside = false;
    pool.onDeflect = (b) => {
      // inside the callback the stamp must be there and must say parry
      sawInside = !!(b.guardZone && b.guardZone.parry);
      b.active = false;
    };
    const owner = { control: r.c, chest: r.chest };
    for (let f = 0; f < 30 && bolt.active; f++) {
      r.step();
      s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, (20 + f) / 60);
      pool.update(1 / 60, { blades: [{ saber: s, owner, team: 0, guard: null }] });
    }
    assert(sawInside, 'setup: the parry stamp never reached the callback, so this proves nothing');
    assert(bolt.guardZone === null,
      `the parry stamp outlived its callback (${JSON.stringify(bolt.guardZone)}) — the next blade `
      + 'this bolt meets would be graded as if it had parried');

    // …and a fresh bolt out of the pool never inherits one, however the slot
    // was last used
    const reused = pool.fire(CHEST.clone().add(new THREE.Vector3(0, 0, -6)),
      new THREE.Vector3(0, 0, 1), { speed: 40, team: 1 });
    assert(reused.guardZone === null, 'a recycled pool slot came out carrying a parry');
    reused.guardZone = { zone: ZONE.HIGH, parry: true, age: 0 };
    pool.release(reused, new THREE.Vector3(0, 0, -1), 40);
    assert(reused.guardZone === null, 'releasing a caught bolt left its parry flag on it');
    pool.dispose();
    return 'stamp present inside the callback, null immediately after, null on reuse and on release';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  5. Difficulty is zone tolerance                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('assist: each tier forgives the share of ZONE error it advertises', () => {
    /**
     * `DIFFICULTY.assist` keeps its meaning — the share of your error the tier
     * forgives — but under directional the error is a zone error, not an aiming
     * error, so what it buys is measured in degrees round the rose. The base
     * sector is 45° and a full assist buys another 90°, which reaches the far
     * edge of the adjacent quadrant and stops short of the opposite zone at
     * every tier.
     *
     * Measured by bisection against the REAL geometry, not read off the formula.
     */
    const widest = (tier) => {
      const g = guardFor(ZONE.HIGH, { tol: zoneTolerance(DIFFICULTY[tier].assist) - GUARD.sector });
      // walk a bolt round the guard's own chart at a fixed 60° radius and find
      // the last bearing it still answers
      let lo = 0, hi = Math.PI;
      const ok = (delta) => answers(g, chartDir(60 / DEG, ZONE_ROSE.high + delta));
      if (!ok(0)) return 0;
      while (hi - lo > 1e-4) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
      return lo;
    };
    const rows = [];
    for (const tier of TIERS) {
      const d = DIFFICULTY[tier];
      const want = zoneTolerance(d.assist);
      const got = widest(tier);
      assert(Math.abs(got - want) * DEG < 1.5,
        `${d.name} advertises ${(d.assist * 100).toFixed(0)}% → ±${(want * DEG).toFixed(1)}°, `
        + `measured ±${(got * DEG).toFixed(1)}°`);
      assert(got < Math.PI - 1e-6,
        `${d.name} forgives a guard held the wrong way round`);
      rows.push(`${d.name} ${(d.assist * 100).toFixed(0)}%→±${(got * DEG).toFixed(0)}°`);
    }
    // the ladder has to be a ladder
    const w = TIERS.map(widest);
    for (let i = 1; i < w.length; i++) {
      assert(w[i] < w[i - 1], `${TIERS[i]} forgives at least as much as ${TIERS[i - 1]}`);
    }
    assert(Math.abs(w[3] - GUARD.sector) * DEG < 1.5,
      `Grandmaster forgives ±${(w[3] * DEG).toFixed(1)}° instead of its own bare ${(GUARD.sector * DEG).toFixed(0)}° sector`);
    // and an ADJACENT zone's own centre is answered on the forgiving tiers only
    const adjacent = (tier) => answers(
      guardFor(ZONE.HIGH, { tol: zoneTolerance(DIFFICULTY[tier].assist) - GUARD.sector }),
      chartDir(60 / DEG, ZONE_ROSE.left));
    assert(adjacent('padawan') && adjacent('knight'),
      'the forgiving tiers do not accept an adjacent zone, which is what they promise');
    assert(!adjacent('master') && !adjacent('grandmaster'),
      'the strict tiers accept an adjacent zone, so their guard is not directional');
    return `${rows.join(', ')}; adjacent centre accepted by Padawan+Knight only`;
  });

  check('assist: the tier reaches the guard on every tier, Grandmaster included', () => {
    // Player only calls applyAssist when `difficulty.assist > 0`, so a tolerance
    // computed inside it would never run for Grandmaster and would inherit
    // whatever the previous tier left in the field. It is computed in
    // _publishGuard instead, which runs every frame on every tier.
    const rows = [];
    for (const tier of TIERS) {
      const r = rig('directional');
      r.c.assist = DIFFICULTY[tier].assist;
      r.input._held.add('blade');
      r.step(); r.step();
      const want = zoneTolerance(DIFFICULTY[tier].assist);
      assert(Math.abs(r.c.guard.half - want) < 1e-9,
        `${tier}: published half-arc ${(r.c.guard.half * DEG).toFixed(1)}° against ${(want * DEG).toFixed(1)}°`);
      rows.push(`${tier} ±${(r.c.guard.half * DEG).toFixed(0)}°`);
    }
    // …and the assist must not ALSO drag the guard point, or the tier is paid twice
    const r = rig('directional');
    r.c.assist = DIFFICULTY.padawan.assist;
    r.input._held.add('blade');
    for (let i = 0; i < 30; i++) r.step();
    r.c.setZone(ZONE.HIGH, { force: true });
    for (let i = 0; i < 40; i++) r.step();
    const gx0 = r.c.gx, gy0 = r.c.gy;
    const bolt = { pos: new THREE.Vector3(-8, 1.35, -12), vel: new THREE.Vector3(20, 0, 24) };
    for (let i = 0; i < 60; i++) {
      r.c.applyAssist([{ bolt, eta: 0.3, point: bolt.pos, dist: 12, offset: 0 }], CHEST, r.aim, 1 / 60);
    }
    assert(Math.abs(r.c.gx - gx0) < 1e-9 && Math.abs(r.c.gy - gy0) < 1e-9,
      `Padawan's assist dragged the guard off its zone by (${(r.c.gx - gx0).toFixed(3)}, ${(r.c.gy - gy0).toFixed(3)}) — `
      + 'the tier is being paid twice');
    return `${rows.join(', ')}; the guard point itself is never dragged`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  6. The guard is yours — it travels and it turns                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('zones: the guard walks with you and turns with your head', () => {
    // The auto-guard cone deliberately does NOT turn — its whole job is to hold
    // a bearing while you look elsewhere. A directional guard is the opposite
    // claim, and the two must not be confused for each other.
    const chest = new THREE.Vector3(0, 1.35, 0);
    const aim = new THREE.Quaternion();
    const c = new SaberController({ scheme: 'directional' });
    c.reset(chest, aim);
    const input = mkInput();
    input._held.add('blade');
    c.applyInput(input, 1 / 60, { stamina: 1 });
    c.setZone(ZONE.LEFT, { force: true });

    const speed = 4.6 * 1.62;
    let drift = 0;
    for (let f = 0; f < 60; f++) {
      chest.z -= speed / 60;
      c.applyInput(input, 1 / 60, { stamina: 1 });
      c.update(1 / 60, chest, aim, { stamina: 1 });
      drift = c.guard.origin.distanceTo(chest);
    }
    assert(drift < 1e-6, `the guard origin is ${drift.toFixed(2)} m from the chest it belongs to`);
    // …and 3.7 m of sprinting really would have been past the sphere
    assert(speed > GUARD.radius, 'setup: the sprint is too slow to have exposed a frozen origin');

    // turning: a bolt from due left must follow the head round
    const boltFromWorldLeft = () => {
      const d = new THREE.Vector3(-Math.sin(55 / DEG), 0, -Math.cos(55 / DEG));
      return answers(c.guard, d, { origin: chest });
    };
    c.update(1 / 60, chest, aim, {});
    assert(boltFromWorldLeft(), 'setup: a bolt from 55° left was not answered by the LEFT guard');
    aim.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -110 / DEG);   // look 110° right
    c.update(1 / 60, chest, aim, {});
    assert(!boltFromWorldLeft(),
      'the guard did not turn with the head — LEFT still answered a bolt now behind the shoulder');
    return `3.7 m of sprint, 0.00 m drift; turning 110° takes the LEFT guard off a world-left bolt`;
  });

  check('zones: nothing behind the shoulder line is ever answered', () => {
    const g = guardFor(ZONE.HIGH, { tol: zoneTolerance(1) - GUARD.sector });   // fullest forgiveness
    let taken = 0, tried = 0;
    for (let thDeg = 105; thDeg <= 175; thDeg += 5) {
      for (let roseDeg = 0; roseDeg < 360; roseDeg += 15) {
        tried++;
        if (answers(g, dirAt(thDeg / DEG, roseDeg / DEG))) taken++;
      }
    }
    assert(taken === 0, `${taken} of ${tried} bolts from behind the ${(GUARD.reach * DEG).toFixed(0)}° reach were blocked`);
    return `${tried} bearings from ${105}° to 175° off the sightline, 0 answered, at maximum tolerance`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  7. The attack rose, and the wheel that drives it                  */
  /* ══════════════════════════════════════════════════════════════════ */

  check('attack: the wheel is a rebindable action, not a raw device read', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const id of ['attackOver', 'attackStab']) {
      const a = ACTIONS.find(x => x.id === id);
      assert(a, `${id} is not in ACTIONS — it cannot be rebound or even found`);
      assert(a.keys.length, `${id} ships with no key`);
    }
    const b = defaultBindings();
    assert(b.attackOver.includes(WHEEL.up), `overhead defaults to ${b.attackOver.join('+')}, not the wheel`);
    assert(b.attackStab.includes(WHEEL.down), `stab defaults to ${b.attackStab.join('+')}, not the wheel`);
    assert(!conflicts(b).length, 'adding the wheel put two actions on one code: '
      + conflicts(b).map(c => `${c.code}→${c.ids.join('+')}`).join('; '));
    assert(keyLabel(WHEEL.up) !== WHEEL.up && keyLabel(WHEEL.down) !== WHEEL.down,
      'the wheel codes have no human-readable label, so the options screen would print "WheelUp"');

    // and the blade no longer reads the device behind the table's back
    const src = await readFile(new URL('../../src/game/SaberController.js', import.meta.url), 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    assert(!/mouse\.wheel/.test(body),
      'SaberController still reads input.mouse.wheel directly — the roll and the grip are back to sharing a device');

    // through the REAL Input, both directions, both edges
    const canvas = { addEventListener() {}, removeEventListener() {} };
    const inp = new Input(canvas);
    inp.setBindings(b);
    inp.mouse.wheel = -1;
    assert(inp.actHit('attackOver') && !inp.actHit('attackStab'),
      'a wheel-up notch did not fire the overhead');
    inp.mouse.wheel = 1;
    assert(inp.actHit('attackStab') && !inp.actHit('attackOver'),
      'a wheel-down notch did not fire the stab');
    inp.end();
    assert(!inp.actHit('attackOver') && !inp.actHit('attackStab'),
      'a wheel notch outlived its own frame — one flick would fire every frame after it');
    inp.dispose();
    return `attackOver=${b.attackOver.map(keyLabel).join('/')}, attackStab=${b.attackStab.map(keyLabel).join('/')}, `
      + 'no clash, one notch = one frame, no raw wheel left in the blade';
  });

  check('attack: an overhead is a real swing, out of every guard, and gives it back', () => {
    /**
     * Two claims, measured out of all four zones because an attack that only
     * works from one of them is not an attack, it is a coincidence.
     *
     * FAST. A snap straight from the high pose to the low one peaks the tip at
     * 7.9 m/s — under SLASH_REF, the speed Combat's cutting model calls "a
     * swing does twice a press's work". So the overhead drives the guard TARGET
     * along an arc instead of changing pose, and the hands and blade are
     * genuinely travelling when they cross the centreline.
     *
     * AND IT GIVES THE GUARD BACK. The arc is an additive offset, so a swing out
     * of a held zone lands back in that zone. An implementation that assigned
     * the guard would drop your block every time you attacked — a thing a player
     * would feel constantly and never be able to name.
     */
    const SLASH_REF = 8;
    const rows = [];
    for (const z of ZONE_ORDER) {
      const r = rig('directional');
      const s = blade();
      r.input._held.add('blade');
      for (let i = 0; i < 40; i++) { r.step(); s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, i / 60); }
      r.c.setZone(z, { force: true });
      for (let i = 0; i < 40; i++) { r.step(); s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, (40 + i) / 60); }
      const gx0 = r.c.gx, gy0 = r.c.gy;

      r.input._hit.add('attackOver');
      let tip = 0, low = 9, high = -9, frames = 0;
      for (let i = 0; i < 60; i++) {
        r.step();
        s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, (80 + i) / 60);
        tip = Math.max(tip, s.speedAt(1));
        if (r.c.swingT >= 0) { frames++; high = Math.max(high, r.c.gy); low = Math.min(low, r.c.gy); }
      }
      assert(frames > 0, `the overhead never started out of the ${z} guard`);
      assert(tip > SLASH_REF,
        `out of ${z} the overhead peaked the tip at ${tip.toFixed(1)} m/s, under the `
        + `${SLASH_REF} m/s at which a swing outworks a press`);
      assert(high - low > 1.2,
        `out of ${z} the guard only travelled ${(high - low).toFixed(2)} units through the "overhead"`);
      assert(Math.abs(r.c.gx - gx0) < 0.02 && Math.abs(r.c.gy - gy0) < 0.02,
        `the swing left the guard at (${r.c.gx.toFixed(3)}, ${r.c.gy.toFixed(3)}) instead of back on `
        + `the ${z} zone (${gx0.toFixed(3)}, ${gy0.toFixed(3)}) — attacking drops your guard`);
      assert(r.c.zone === z, `the swing changed the guard zone from ${z} to ${r.c.zone}`);
      rows.push(`${z} ${tip.toFixed(1)} m/s over ${(high - low).toFixed(2)} units`);
    }
    return `${rows.join(', ')}; every one lands back on its own zone`;
  });

  check('attack: a spin sweeps SIDEWAYS and turns the body through the cut', () => {
    /**
     * THE SPIN IS THE OVERHEAD WITH THE AXES EXCHANGED, and the two claims
     * that make it a different attack rather than a second button are both
     * measured here.
     *
     * IT IS LATERAL. If the sweep showed up on `gy` it would be an overhead
     * with a longer cooldown. The travel is compared against the overhead's
     * own on the SAME rig, so this cannot pass by the spin being feeble in
     * both axes.
     *
     * IT TURNS YOU. A horizontal sweep with the feet planted is a slash, and
     * the controller already has one. `cam.yaw` accumulated over the cut is
     * what makes the blade reach what is BESIDE you, and it has to be spent on
     * the cut and nowhere else — a wind-up that moved the view would read as a
     * shove on the mouse.
     *
     * And it gives the guard back, for the reason the overhead's note gives.
     */
    const r = rig('directional');
    const s = blade();
    r.input._held.add('blade');
    for (let i = 0; i < 40; i++) { r.step(); s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, i / 60); }
    r.c.setZone(ZONE_ORDER[0], { force: true });
    for (let i = 0; i < 40; i++) { r.step(); s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, (40 + i) / 60); }
    const gx0 = r.c.gx, gy0 = r.c.gy;

    r.input._hit.add('attackSpin');
    let tip = 0, xlo = 9, xhi = -9, ylo = 9, yhi = -9, yaw = 0, windYaw = 0, frames = 0;
    for (let i = 0; i < 80; i++) {
      const cam = r.step();
      s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, (80 + i) / 60);
      tip = Math.max(tip, s.speedAt(1));
      if (r.c.spinT >= 0) {
        frames++;
        xhi = Math.max(xhi, r.c.gx); xlo = Math.min(xlo, r.c.gx);
        yhi = Math.max(yhi, r.c.gy); ylo = Math.min(ylo, r.c.gy);
        yaw += Math.abs(r.c.spinYaw);
        if (r.c.spinT < SPIN.wind) windYaw += Math.abs(r.c.spinYaw);
      }
    }
    assert(frames > 0, 'the spin never started');
    assert(tip > 8, `the spin peaked the tip at ${tip.toFixed(1)} m/s, under the 8 m/s a swing needs`);
    const across = xhi - xlo, up = yhi - ylo;
    assert(across > 1.2, `the spin only travelled ${across.toFixed(2)} units across`);
    assert(across > up * 3,
      `the spin moved ${across.toFixed(2)} across and ${up.toFixed(2)} up — that is not a lateral sweep`);
    assert(Math.abs(yaw - SPIN.yaw) < 0.05,
      `the body turned ${yaw.toFixed(2)} rad through the spin against SPIN.yaw ${SPIN.yaw}`);
    assert(windYaw < 1e-6,
      `${windYaw.toFixed(3)} rad of the turn was spent winding up — the view must not move before the cut`);
    assert(Math.abs(r.c.gx - gx0) < 0.02 && Math.abs(r.c.gy - gy0) < 0.02,
      `the spin left the guard at (${r.c.gx.toFixed(3)}, ${r.c.gy.toFixed(3)}) instead of back on `
      + `(${gx0.toFixed(3)}, ${gy0.toFixed(3)})`);
    return `${tip.toFixed(1)} m/s over ${across.toFixed(2)} units across and ${up.toFixed(2)} up, `
      + `${yaw.toFixed(2)} rad of body turn, all of it inside the cut`;
  });

  check('attack: holding the overhead makes the blade genuinely faster', () => {
    /**
     * A CHARGED HEAVY THAT IS NOT A DAMAGE MULTIPLIER.
     *
     * Cutting in this game is `bladeSpeed × sharpness / toughness`, so the
     * honest way to build a heavy is to change the SWING and let the same
     * contact solver read whatever the blade is then doing. Two swings on
     * identical rigs, one tapped and one held past CHARGE.hold, compared on
     * the two things that are supposed to move: the tip's peak speed, and how
     * long the whole attack takes.
     *
     * NOT THE ARC. That was the first attempt and it is worth the sentence:
     * the guard's travel is clamped and the ordinary overhead already
     * saturates it, so a 1.55x amplitude measured out at 2.03 units against
     * 1.94. The check that caught it is this one, which is why it asserts on
     * speed and commitment instead.
     *
     * A TAP MUST STILL BE A TAP. The heavy shares the light's button, so the
     * thing that could go wrong is a player mashing the attack and getting a
     * heavy they did not ask for. The tapped rig releases inside CHARGE.hold
     * and has to come out at `charged` 0 — the swing that shipped.
     */
    const swing = (holdFrames) => {
      const r = rig('directional');
      const s = blade();
      for (let i = 0; i < 40; i++) { r.step(); s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, i / 60); }
      r.input._hit.add('attackOver');
      r.input._held.add('attackOver');
      let tip = 0, lo = 9, hi = -9, dur = 0, charged = 0;
      for (let i = 0; i < 140; i++) {
        if (i === 1) r.input._hit.delete('attackOver');
        if (i >= holdFrames) r.input._held.delete('attackOver');
        r.step();
        s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, (40 + i) / 60);
        tip = Math.max(tip, s.speedAt(1));
        if (r.c.swingT >= 0) {
          dur += 1 / 60; hi = Math.max(hi, r.c.gy); lo = Math.min(lo, r.c.gy);
          charged = Math.max(charged, r.c.charged);
        }
      }
      return { tip, arc: hi - lo, dur, charged };
    };
    const tap = swing(2);
    const held = swing(Math.ceil(CHARGE.full * 60) + 4);
    assert(tap.charged === 0,
      `a tapped overhead came out at charge ${tap.charged.toFixed(2)} — mashing produces a heavy`);
    assert(held.charged > 0.9,
      `holding for the full ${CHARGE.full}s only reached charge ${held.charged.toFixed(2)}`);
    assert(held.tip > tap.tip * 1.25,
      `the heavy peaked at ${held.tip.toFixed(1)} m/s against the tap's ${tap.tip.toFixed(1)} — `
      + 'a charge that does not move the blade faster is a damage multiplier wearing a costume');
    assert(held.dur > tap.dur * 1.15,
      `the heavy took ${held.dur.toFixed(2)}s against the tap's ${tap.dur.toFixed(2)}s — a heavy that `
      + 'costs no time is free');
    return `tap ${tap.tip.toFixed(1)} m/s over ${tap.arc.toFixed(2)} units in ${tap.dur.toFixed(2)}s; `
      + `held ${held.tip.toFixed(1)} m/s over ${held.arc.toFixed(2)} units in ${held.dur.toFixed(2)}s`;
  });

  check('attack: both attack inputs run ONE lunge envelope, and only the button cuts', () => {
    /**
     * THE PREMISE OF THIS CHECK EXPIRED, and the measurement that expired it
     * is the one the player made by playing:
     *
     *   "the left click attacks barely do anything, like it's the slightest
     *    movement of the saber"
     *
     * It used to assert that `thrust` and `attackStab` reached the same TIP
     * DISTANCE, under the title "a stab is a stab, not a directional feature",
     * and that was right while the left button was a stab and nothing else.
     * The left button is a CUT now (`SLASH`) with the lunge inside it, so tip
     * distance can no longer be the instrument: measured across the change,
     * the wheel reaches 53 cm and the button 158 cm, and 105 cm of that is the
     * cut the button is supposed to have.
     *
     * The claim underneath it has NOT expired and is asserted harder here, on
     * the envelope itself rather than on a proxy that a second attack can move:
     * there is ONE thrust envelope in this file and both inputs run it, frame
     * for frame. What differs is `thrustGain` — how much of that envelope the
     * hands are given — and whether a cut runs alongside.
     */
    const run = (fire) => {
      const c = new SaberController({ scheme: 'directional' });
      const aim = new THREE.Quaternion();
      c.reset(CHEST, aim);
      const input = mkInput();
      for (let i = 0; i < 120; i++) { c.applyInput(input, 1 / 60, { stamina: 1 }); c.update(1 / 60, CHEST, aim, {}); }
      const tip0 = c.handPos.clone().addScaledVector(c._bladeDir, 1.15);
      fire(input);
      let max = 0, slashFrames = 0;
      const env = [];
      for (let i = 0; i < 90; i++) {
        c.applyInput(input, 1 / 60, { stamina: 1 });
        input._hit.clear();
        c.update(1 / 60, CHEST, aim, {});
        env.push(c.thrust);
        if (c.slashT >= 0) slashFrames++;
        max = Math.max(max, c.handPos.clone().addScaledVector(c._bladeDir, 1.15).distanceTo(tip0));
      }
      return { max, env, slashFrames, gain: c.thrustGain };
    };
    const wheel = run((i) => i._hit.add('attackStab'));
    const button = run((i) => i._hit.add('thrust'));

    // ONE envelope. Not "similar" — the same numbers, because it is the same
    // three lines of code reached from two keys.
    let worst = 0;
    for (let i = 0; i < wheel.env.length; i++) worst = Math.max(worst, Math.abs(wheel.env[i] - button.env[i]));
    assert(worst < 1e-9,
      `the two inputs traced different thrust envelopes — worst frame differs by ${worst.toFixed(6)}`);
    assert(wheel.env.some((v) => v > 0.99), 'the wheel stab never reached a full lunge');

    // …and only ONE of them cuts.
    assert(wheel.slashFrames === 0, `the wheel stab also ran ${wheel.slashFrames} frames of cut`);
    assert(button.slashFrames > 6, `the left button ran only ${button.slashFrames} frames of cut`);
    assert(button.gain === SLASH.lunge && wheel.gain === 1,
      `thrustGain came out ${button.gain} on the button and ${wheel.gain} on the wheel`);
    // The cut is the difference, and it is most of the reach.
    assert(button.max > wheel.max * 1.8,
      `the left button reached ${(button.max * 100).toFixed(0)} cm against the bare stab's `
      + `${(wheel.max * 100).toFixed(0)} cm — the cut is not adding a cut`);
    return `one envelope to 1e-9; wheel ${(wheel.max * 100).toFixed(0)} cm and no cut, `
      + `button ${(button.max * 100).toFixed(0)} cm over ${button.slashFrames} frames of cut `
      + `at ${SLASH.lunge}x lunge`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  8. The poses are guards, and the blade is really in them          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('zones: the blade really goes where the zone says, and blocks read off it', () => {
    /**
     * The zone is a VOLUME and the blade is a line, so they can disagree — and
     * if they do, the player sees a bolt stop in mid-air beside a weapon that is
     * somewhere else. Two things are measured: that each pose actually points
     * the blade into its own sector, and that a zone block reports its contact
     * ON the blade rather than out on the guard sphere.
     */
    const rows = [];
    for (const z of ZONE_ORDER) {
      const r = rig('directional');
      const s = blade();
      r.input._held.add('blade');
      r.step();
      r.c.setZone(z, { force: true });
      for (let i = 0; i < 60; i++) { r.step(); s.setHiltPose(r.c.handPos, r.c.quat); s.update(1 / 60, i / 60); }
      const mid = s.pointAt(0.5, new THREE.Vector3()).sub(CHEST);
      const a = aimAngles(mid, r.aim);
      const off = Math.abs(roseDelta(a.rose, ZONE_ROSE[z])) * DEG;
      // The INNER HALF of the sector, not merely inside it. A blade sitting on
      // its own boundary is technically in the right zone and reads as being in
      // neither — and the poses have the headroom: measured, the worst of the
      // four is 14° of a 45° sector. Holding them to half is what stops a future
      // pose tweak from quietly sliding the blade off the zone it represents.
      assert(off < GUARD.sector * DEG / 2,
        `the ${z} pose puts the blade at rose ${(a.rose * DEG).toFixed(0)}°, ${off.toFixed(0)}° off its own `
        + `axis — over half of the ${(GUARD.sector * DEG).toFixed(0)}° sector, so it reads as between zones`);
      assert(a.theta > GUARD.centre,
        `the ${z} pose leaves the blade inside the centre disc — it is not a directional guard at all`);
      rows.push(`${z} ${(a.theta * DEG).toFixed(0)}°/${off.toFixed(0)}° off-axis`);

      // and the contact comes back on the blade
      const hit = shoot(z, z, { theta: 55 });
      assert(hit, `setup: the ${z} guard did not block its own bearing`);
      const dToBlade = Math.min(
        hit.point.distanceTo(s.base), hit.point.distanceTo(s.tip),
        hit.point.distanceTo(s.pointAt(0.5, new THREE.Vector3())));
      assert(dToBlade < 0.7,
        `the ${z} block was reported ${dToBlade.toFixed(2)} m from the blade — it would not read as a block`);
      assert(hit.bladeT >= 0.08 && hit.bladeT <= 0.96,
        `the block reported bladeT ${hit.bladeT.toFixed(2)}, off the blade entirely`);
    }
    return rows.join(', ');
  });

  check('scheme: every card in the options screen is a scheme the blade understands', async () => {
    /**
     * Two lists that could drift: the cards the player can click, and the
     * branches applyInput actually has. A card for a scheme the controller has
     * never heard of does not fail — it falls through to the 'hold' branch and
     * quietly does something else, which is the worst possible outcome because
     * the menu goes on saying it is selected.
     *
     * Checked by BEHAVIOUR rather than by a declared list: each scheme is driven
     * through the real controller and has to produce its own documented answer
     * to one question — does holding the blade button take the camera away.
     */
    const { SCHEMES, DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    // What "I want the blade" IS, per scheme. 'free' inverts the button — the
    // blade is yours by default and you hold `thrust` to get the camera back —
    // so its blade-taking input is holding NOTHING, and that inversion is
    // exactly the kind of thing a card can quietly stop matching.
    const TAKE = { hold: ['blade'], free: [], directional: ['blade'] };
    const rows = [];
    for (const s of SCHEMES) {
      const held = TAKE[s.key];
      assert(held, `the options screen offers a scheme "${s.key}" this check has never heard of — `
        + 'add it here and to applyInput, or the card selects a branch that does not exist');
      const r = rig(s.key);
      for (const a of held) r.input._held.add(a);
      r.input.mouse.dx = 40;
      const cam = r.step();
      const frozen = cam.yaw === 0 && cam.pitch === 0;
      // The whole claim of the round, stated once per card: taking the blade
      // costs you the camera in both continuous-aim schemes and costs you
      // nothing in the directional one.
      const want = s.key !== 'directional';
      assert(frozen === want,
        `scheme card "${s.key}" ${frozen ? 'freezes' : 'leaves live'} the camera while the blade is taken, `
        + 'which is not what its branch in applyInput says');
      assert(r.c.guard.active === (s.key === 'directional'),
        `scheme card "${s.key}" ${r.c.guard.active ? 'raised' : 'did not raise'} a directional guard`);
      rows.push(`${s.key} ${frozen ? 'freezes the view' : 'keeps the view'}${r.c.guard.active ? ' + guards' : ''}`);
    }
    assert(SCHEMES.some(s => s.key === DEFAULT_SETTINGS.scheme),
      `the shipped default scheme "${DEFAULT_SETTINGS.scheme}" has no card in the options screen`);
    assert(DEFAULT_SETTINGS.scheme === 'directional',
      `the game ships "${DEFAULT_SETTINGS.scheme}", not directional`);
    assert(SCHEMES[0].key === DEFAULT_SETTINGS.scheme,
      'the shipped default is not the first card, so the recommended scheme is not the one on top');
    // and the two schemes that are NOT the default must still exist — free aim
    // survives this change, it is not replaced by it
    for (const key of ['hold', 'free']) {
      assert(SCHEMES.some(s => s.key === key), `the "${key}" scheme was dropped instead of kept`);
    }
    return `${rows.join(', ')}; ships "${DEFAULT_SETTINGS.scheme}", ${SCHEMES.length} cards`;
  });

  check('zones: the ready guard is still where neutral rests', () => {
    // READY_GUARD survives the change: it is what NEUTRAL means now, and the
    // guard has to land back on it when the button comes up.
    const r = rig('directional');
    r.input._held.add('blade');
    r.step();
    r.c.setZone(ZONE.LOW, { force: true });
    for (let i = 0; i < 40; i++) r.step();
    assert(Math.abs(r.c.gy - ZONE_POSE.low.y) < 0.02,
      `the LOW zone settled the guard at gy=${r.c.gy.toFixed(3)}, not ${ZONE_POSE.low.y}`);
    r.input._held.delete('blade');
    for (let i = 0; i < 60; i++) r.step();
    assert(Math.abs(r.c.gx - r.c.readyX) < 0.02 && Math.abs(r.c.gy - r.c.readyY) < 0.02,
      `dropping the guard left the blade at (${r.c.gx.toFixed(3)}, ${r.c.gy.toFixed(3)}) `
      + `instead of the ready guard (${r.c.readyX}, ${r.c.readyY})`);
    return `LOW → gy ${ZONE_POSE.low.y}, released → back to (${r.c.readyX}, ${r.c.readyY}) in under 1 s`;
  });
}
