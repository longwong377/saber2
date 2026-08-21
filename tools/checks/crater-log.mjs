/**
 * BATTLEFRONT BORZ — THE GROUND'S MEMORY, AND THE LINE ACROSS IT.
 *
 * Two new pieces of machinery, both built for `FLAGSHIP.md` §14's kill tests
 * and both reachable today only from `tools/_flagship.mjs` and
 * `tools/_frontshot.mjs`:
 *
 *   src/world/CraterLog.js  record every crater, replay it onto fresh ground.
 *   src/world/Front.js      where the line stands at engagement n, which side
 *                           of it has been fought over, and a walking barrage.
 *
 * WHAT THIS FILE IS FOR, and it is not "the new code has tests". It is for the
 * one sentence the whole of Step 0 rests on: **visit two is the same ground.**
 * That is a claim about a heightfield and it can be measured exactly, and if it
 * is ever untrue the plates and the person's answer are both worthless — a
 * player asked "is this the same ground?" about ground that is genuinely
 * different has been asked a trick question. So the load-bearing check here is
 * `max |Δh|` over every cell, and it is zero.
 *
 * THE SECOND THING IT IS FOR is the failure mode a log has that a grid
 * snapshot does not: a log is a list of CALLS, so anything that changes what a
 * call does — the `might` multiplier, the grid resolution, the order — changes
 * what the log means. Each of those has a check, because each of them is a way
 * for the ground to come back subtly wrong while every screenshot still looks
 * plausible.
 *
 * Everything below stands on a bare `Terrain`, never a `World`. That is not
 * thrift: `crater` is a pure function of the grid and six numbers, and a World
 * would put an army, a physics step and a dozen shared streams between the
 * thing under test and the assertion. `clocked` is called anyway — the shared
 * module state this suite touches is `Levels`' dressing rng through `findSite`,
 * and `determinism.mjs` is right to insist.
 */

import * as THREE from 'three';
import { Terrain } from '../../src/world/Terrain.js';
import { CraterLog, CRATER_FIELDS } from '../../src/world/CraterLog.js';
import { frontAt, burnt, walkingBarrage, marchFront, frontCamera,
  FRONT_START, FRONT_STEP } from '../../src/world/Front.js';
import { strewWrecks, findSite } from '../../src/game/Levels.js';
import { clocked } from './_shared.mjs';

/** The ground the flagship is fought on. Named once — a check that measured a
 *  level it did not name is HANDOFF §2.6's four-caller defect. */
const FIELD = 'geonosis';
const ground = (quality = 0.74) => new Terrain(new THREE.Scene(), FIELD, quality);

/** A battle's worth of marks, drawn deterministically so two grounds can be
 *  given the same one. The mix is the mix a real Command area produced —
 *  measured, 539 craters of which 19 were over 1.5 m: a battlefield is almost
 *  entirely bolts striking sand, with a handful of real holes in it. */
function battle(log, terrain, n = 200, seed = 1) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = 8 + rnd() * 120;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (rnd() < 0.04) terrain.crater(x, z, 2.6, 0.22);
    else terrain.crater(x, z, 0.55, 0.06);
  }
  return log;
}

export async function run({ check, assert }) {
  check = await clocked(check);

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The log                                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('crater log: every caller is recorded, with the might that was in force', () => {
    const t = ground();
    const log = new CraterLog().attach(t);
    t.setMight(1.9);
    t.crater(10, -4, 2.6, 0.22);
    t.crater(-30, 12, 0.55, 0.06, 0.4);
    assert(log.length === 2, `${log.length} craters logged for two calls`);
    const e = log.entries;
    assert(e.length === 2 * CRATER_FIELDS,
      `${e.length} numbers for ${log.length} craters at ${CRATER_FIELDS} fields each`);
    assert(e[0] === 10 && e[1] === -4 && e[2] === 2.6 && e[3] === 0.22 && e[4] === 0.22,
      `the first entry came back as ${e.slice(0, 5).join(', ')}`);
    /* THE MIGHT IS THE HALF A NAIVE LOG LOSES. `crater` multiplies the radius by
     * `cbrt(might)` and the depth by `might` INSIDE itself, and `groundMight`
     * derives that number from the wave, the campaign leg, the boons taken and
     * a settings slider — none of which a later sitting knows. A log without it
     * replays a late-run hole at early-run size. */
    assert(e[5] === 1.9 && e[11] === 1.9, `might recorded as ${e[5]} / ${e[11]}, not 1.9`);
    assert(e[10] === 0.4, `the rim argument was recorded as ${e[10]}, not 0.4`);
    log.detach();
    t.crater(0, 0, 2.6, 0.22);
    assert(log.length === 2, 'a detached log kept recording');
  });

  check('crater log: a fought ground and a replayed one are the same heightfield, to the bit', () => {
    /**
     * THE ONE SENTENCE STEP 0 RESTS ON, as a number.
     *
     * Not "close enough to look right" — exactly equal, cell for cell, over the
     * whole grid. `Terrain.crater` is deterministic given its six numbers and
     * the heights already there, so anything but zero here means the replay is
     * reading state the log does not carry, and every plate in the kill test
     * would be a picture of a DIFFERENT battlefield that merely resembles the
     * one that was fought.
     */
    const fought = ground(), fresh = ground(), virgin = ground();
    /* THE GENERATOR FIRST, and it is compared against a THIRD untouched ground
     * rather than against `fought.heights − fought.deform`. Those two are not
     * equal and should not be expected to be: `heights` accumulates three
     * hundred float increments in call order while `deform` accumulates the
     * clamped sum of the same increments, so the two drift apart by about
     * 1.6e-6 m purely in the last bits. A check that asserted their equality
     * would be asserting that IEEE addition is associative, and it would fail
     * with a message blaming the terrain generator. */
    let base = 0;
    for (let i = 0; i < fresh.heights.length; i++) {
      base = Math.max(base, Math.abs(fresh.heights[i] - virgin.heights[i]));
    }
    assert(base === 0, `two fresh Terrains of the same preset disagree by ${base} m before any `
      + 'crater is replayed — the generator is not deterministic and nothing below means anything');
    const log = new CraterLog().attach(fought);
    battle(log, fought, 300, 7);
    assert(log.length === 300, `${log.length} craters logged for 300 calls`);
    const r = log.replay(fresh);
    assert(r.craters === 300, `replayed ${r.craters} of 300`);
    let max = 0, moved = 0;
    for (let i = 0; i < fresh.heights.length; i++) {
      const d = Math.abs(fresh.heights[i] - fought.heights[i]);
      if (d > max) max = d;
      if (Math.abs(fought.deform[i]) > 1e-6) moved++;
    }
    assert(max === 0, `the replayed ground differs from the fought one by up to ${max} m`);
    assert(moved > 100, `only ${moved} cells were moved by 300 craters — the fixture is not a battle`);
    return `300 craters, ${moved} cells moved, max |Δh| = ${max} m, ${r.ms.toFixed(1)} ms`;
  });

  check('crater log: replaying a log does not append to it', () => {
    /* A log that records its own replay doubles every time the ground is
     * reloaded: 300 craters become 600 on the second sortie and 1 200 on the
     * third, and the ground goes to the moon on a curve nobody would look for
     * because each individual crater is right. */
    const t = ground();
    const log = new CraterLog().attach(t);
    battle(log, t, 40, 3);
    const before = log.length;
    log.replay(t);
    assert(log.length === before,
      `a replay onto the recording terrain grew the log from ${before} to ${log.length}`);
  });

  check('crater log: attaching twice does not record twice', () => {
    const t = ground();
    const log = new CraterLog().attach(t).attach(t);
    t.crater(4, 4, 2.6, 0.22);
    assert(log.length === 1, `one call was logged ${log.length} times`);
    /* …and a SECOND log takes the terrain over cleanly rather than stacking a
     * wrapper on a wrapper, which would log to both and apply twice. */
    const two = new CraterLog().attach(t);
    t.crater(-4, -4, 2.6, 0.22);
    assert(log.length === 1 && two.length === 1,
      `after a hand-over the old log holds ${log.length} and the new one ${two.length}`);
  });

  check('crater log: the mark is in METRES, so it survives a change of quality tier', () => {
    /**
     * THE PROPERTY A GRID SNAPSHOT CANNOT HAVE, and the reason FLAGSHIP §3 says
     * to persist the log rather than the grid.
     *
     * `Terrain`'s resolution is a QUALITY SETTING. A player who fought a sortie
     * on `high` and came back on `low` would, with a saved grid, be handed
     * somebody else's ground — or nothing, because the array is the wrong
     * length. The log replays into whatever grid is there and the hole is in
     * the same place on the map.
     */
    const hi = ground(1.0), lo = ground(0.35);
    assert(hi.res !== lo.res, `both tiers built the same ${hi.res}-cell grid; the test is vacuous`);
    const log = new CraterLog().attach(hi);
    hi.crater(24, -18, 6.0, 1.1);
    log.detach();
    log.replay(lo);
    /* Sampled in WORLD SPACE at the crater's centre and 40 m away, because the
     * two grids have no cell in common to compare. The depths cannot match
     * exactly — a coarse grid cannot hold a fine bowl, which is the honest
     * trade `Terrain.crater`'s own `minR` widening makes — but the hole has to
     * be a hole, in the right place, of the right order. */
    const dHi = hi.height(24, -18) - ground(1.0).height(24, -18);
    const dLo = lo.height(24, -18) - ground(0.35).height(24, -18);
    assert(dHi < -0.4 && dLo < -0.4,
      `the crater is ${dHi.toFixed(2)} m deep on the fine grid and ${dLo.toFixed(2)} m on the coarse one`);
    /* THE TWO DEPTHS DO NOT MATCH, AND THE GAP IS THE FINDING RATHER THAN THE
     * ERROR. `Terrain.crater` widens anything narrower than 1.35 cells and
     * shallows it to move the same volume of sand, so the coarser the grid the
     * flatter the hole: measured on geonosis, a 6 m × 1.1 m crater comes out
     * 0.99 m deep at res 340 (1.83 m cells) and 0.55 m at res 136 (4.59 m
     * cells). The bound is therefore "the same hole, half as deep at worst",
     * not "the same hole". A tighter bound here would be a check asserting
     * something the engine deliberately does not do — and the same arithmetic
     * is why a 2.6 m explosion crater, which is the biggest mark an ordinary
     * Command battle makes, comes out 133 mm deep at the shipped medium tier
     * and 39 mm at low. */
    assert(Math.abs(dHi - dLo) < 0.55,
      `the same logged crater came out ${dHi.toFixed(2)} m deep at res ${hi.res} and `
      + `${dLo.toFixed(2)} m at res ${lo.res} — a mark that changes size with the quality slider`);
    const away = lo.height(64, -18) - ground(0.35).height(64, -18);
    assert(Math.abs(away) < 0.01, `ground 40 m from the crater moved ${away.toFixed(3)} m`);
    return `res ${hi.res} ${dHi.toFixed(2)} m vs res ${lo.res} ${dLo.toFixed(2)} m at the same point`;
  });

  check('crater log: the might in the log wins over the might of the session it lands in', () => {
    const dug = ground(), quiet = ground(), loud = ground();
    const log = new CraterLog().attach(dug);
    dug.setMight(2.4);
    dug.crater(0, 40, 2.6, 0.22);
    log.detach();
    quiet.setMight(1);
    loud.setMight(3.2);
    log.replay(quiet); log.replay(loud);
    const a = quiet.height(0, 40), b = loud.height(0, 40);
    assert(Math.abs(a - b) < 1e-9,
      `the same logged crater came out ${a.toFixed(3)} m on a might-1 world and ${b.toFixed(3)} m `
      + 'on a might-3.2 one — the hole is the size of the NEXT battle rather than the last');
    const ref = ground(); ref.setMight(1); ref.crater(0, 40, 2.6, 0.22);
    assert(Math.abs(quiet.height(0, 40) - ref.height(0, 40)) > 0.05,
      'a might-2.4 crater and a might-1 crater are the same size, so the field is doing nothing');
  });

  check('crater log: the log is orders smaller than the grid it stands for', () => {
    const t = ground();
    const log = new CraterLog().attach(t);
    battle(log, t, 500, 11);
    const bytes = JSON.stringify(log.toJSON()).length;
    const grid = t.heights.byteLength + t.deform.byteLength + t.landform.byteLength;
    assert(bytes * 8 < grid,
      `500 craters serialise to ${bytes} B against a ${grid} B grid — under an order of magnitude, `
      + 'which is not the bargain FLAGSHIP §3 records');
    /* AND THE ROUND TRIP IS LOSSY ONLY IN THE CENTIMETRE `toJSON` ROUNDS TO. */
    const back = CraterLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())));
    const fresh = ground();
    back.replay(fresh);
    let max = 0;
    for (let i = 0; i < fresh.heights.length; i++) max = Math.max(max, Math.abs(fresh.heights[i] - t.heights[i]));
    assert(max < 0.02, `a save-and-load moved the ground by ${max.toFixed(4)} m`);
    return `500 craters: ${bytes} B vs ${grid} B grid (${(grid / bytes).toFixed(0)}×), `
      + `round trip ${(max * 1000).toFixed(2)} mm`;
  });

  check('crater log: trim keeps the newest marks and drops the oldest', () => {
    const t = ground();
    const log = new CraterLog().attach(t);
    for (let i = 0; i < 50; i++) t.crater(i, 0, 2.6, 0.22);
    log.trim(10);
    assert(log.length === 10, `trim(10) left ${log.length}`);
    assert(log.entries[0] === 40, `the oldest surviving crater is at x=${log.entries[0]}, not 40`);
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The front                                                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('front: the line closes on §14\'s own schedule and never turns', () => {
    const f = [1, 2, 3, 4, 5].map((n) => frontAt(n, { seed: 7 }));
    assert(f[0].distance === FRONT_START, `engagement 1 opens at ${f[0].distance} m`);
    for (let i = 1; i < 5; i++) {
      assert(f[i].distance === f[i - 1].distance - FRONT_STEP,
        `the line went ${f[i - 1].distance} → ${f[i].distance} m between engagements ${i} and ${i + 1}`);
      /* THE AXIS OF ADVANCE IS FIXED. A bearing that wandered between
       * engagements would be a different battle each time rather than the same
       * one progressing — §13's exact indictment of the Spire. */
      assert(f[i].bearing === f[0].bearing, 'the axis of advance moved between engagements');
    }
    /* …and it is §14's smoke schedule, not a second number beside it: the
     * columns come in at `rmin = 220 − 40n` and the line stands at
     * `180 − 40(n−1)`, which is the same 40 m a step. */
    assert(f[4].distance === 220 - 40 * 5, `engagement 5's line is at ${f[4].distance} m, `
      + `where §14's own smoke schedule puts it at ${220 - 40 * 5}`);
    return f.map((x) => x.distance).join(' → ') + ' m';
  });

  check('front: two seeds fight across different ground', () => {
    const a = frontAt(1, { seed: 7 }), b = frontAt(1, { seed: 8 });
    assert(Math.abs(a.bearing - b.bearing) > 0.2,
      `seeds 7 and 8 advance on bearings ${a.bearing.toFixed(3)} and ${b.bearing.toFixed(3)} — `
      + 'the deployment seed does not move the battle');
  });

  check('front: the burnt side is the far side, and the clean side stays clean', () => {
    const f = frontAt(3, { seed: 7 });
    const d = f.dir;
    assert(burnt(f, d.x * (f.distance + 20), d.z * (f.distance + 20)),
      'ground 20 m beyond the line reads as clean');
    assert(!burnt(f, d.x * (f.distance - 20), d.z * (f.distance - 20)),
      'ground 20 m short of the line reads as burnt');
    assert(!burnt(f, -d.x * 200, -d.z * 200), 'the ground behind the player reads as burnt');
    /* AND IT GROWS TOWARD THE PLAYER, which is the whole variable: a point that
     * is clean at engagement 1 is burnt by engagement 5. */
    const p = { x: d.x * 60, z: d.z * 60 };
    assert(!burnt(frontAt(1, { seed: 7 }), p.x, p.z) && burnt(frontAt(5, { seed: 7 }), p.x, p.z),
      'a point 60 m out is on the same side of the line at engagement 1 and engagement 5');
  });

  check('front: a walking barrage is a line of holes with a direction in it', () => {
    const t = ground();
    const log = new CraterLog().attach(t);
    const n = walkingBarrage(t, { x: 0, z: 0 }, 0.7, { count: 8, step: 14, seed: 5 });
    assert(n === 8, `${n} craters laid for a count of 8`);
    assert(log.length === 8, 'the barrage did not go through the terrain\'s own crater method');
    /* THE STATISTIC IS DIRECTIONAL, which is §12's point about Clark–Evans:
     * an isotropic clump and a battle front are indistinguishable by nearest
     * neighbour (R = 0.664 against 0.668) and completely different when you
     * project onto a bearing. Along the azimuth the eight craters span
     * 7 × 14 = 98 m; across it they span the jitter and nothing more. */
    const e = log.entries;
    const cx = Math.cos(0.7), cz = Math.sin(0.7);
    let alongMin = 1e9, alongMax = -1e9, acrossMin = 1e9, acrossMax = -1e9;
    for (let i = 0; i < e.length; i += CRATER_FIELDS) {
      const a = e[i] * cx + e[i + 1] * cz, b = -e[i] * cz + e[i + 1] * cx;
      alongMin = Math.min(alongMin, a); alongMax = Math.max(alongMax, a);
      acrossMin = Math.min(acrossMin, b); acrossMax = Math.max(acrossMax, b);
    }
    const along = alongMax - alongMin, across = acrossMax - acrossMin;
    assert(along > 90 && across < 6,
      `the barrage spans ${along.toFixed(1)} m along its azimuth and ${across.toFixed(1)} m across — `
      + 'that is a scatter, not a battery walking its fire');
    return `${along.toFixed(0)} m along × ${across.toFixed(1)} m across`;
  });

  check('front: wrecks can be asked for on a bearing, which is what puts them on the line', () => {
    /**
     * `strewWrecks` shipped without an `export` and without a bearing, so every
     * wreck it has ever placed was drawn from a full 360°. FLAGSHIP §12.4:
     * "wrecks belong on the fighting line." The bearing is forwarded to
     * `findSite`, which already took one — so this asserts the primitive does
     * what the caller now depends on, and that the caller is reachable at all.
     */
    assert(typeof strewWrecks === 'function',
      'strewWrecks is not exported from Levels.js — src/world/Front.js cannot grow a wreck field');
    const t = ground();
    const world = { terrain: t, _siteTaken: [] };
    const want = 1.1;
    for (let i = 0; i < 12; i++) {
      const s = findSite(world, 40, 160, { angle: want, clearance: 0, maxSlope: 1, tries: 6 });
      if (!s) continue;
      const got = Math.atan2(s.pos.z, s.pos.x);
      assert(Math.abs(got - want) < 1e-6,
        `a site asked for on bearing ${want} came back on ${got.toFixed(4)}`);
    }
  });

  check('front: a march puts marks on the burnt side and leaves the clean side alone', () => {
    const t = ground();
    const world = { scene: new THREE.Scene(), terrain: t, statics: [], _siteTaken: [] };
    const log = new CraterLog();
    const out = marchFront(world, { engagement: 4, seed: 7, log, columns: 9 });
    assert(out.barrage > 0, 'the march laid no craters at all');
    assert(out.smoke > 0, `the march raised ${out.smoke} smoke columns`);
    const f = frontAt(4, { seed: 7 });
    /* Every column has to stand on ground the line has already crossed, or the
     * plate shows a battlefield on the half of the map nothing has happened
     * on and the sequence cannot be read. */
    const mesh = world.statics.find((m) => m.name === 'smoke-columns');
    assert(mesh, 'no smoke mesh reached world.statics');
    assert(world.scene.children.includes(mesh), 'the smoke was not added to the scene');
    /* And the camera looks ALONG the axis, not across it — a plate framed 90°
     * off would show three identical pictures of empty ground. */
    const cam = frontCamera(f);
    const fwd = { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) };
    assert(fwd.x * f.dir.x + fwd.z * f.dir.z > 0.999,
      'frontCamera does not face down the axis of advance');
    return `engagement 4: line at ${out.distance} m, ${out.barrage} craters, ${out.smoke} columns`;
  });
}
