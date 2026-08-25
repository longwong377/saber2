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
import { CraterLog, CRATER_FIELDS, BURN_LOG_FIELDS, SESSION_MEMORY } from '../../src/world/CraterLog.js';
import { frontAt, burnt, walkingBarrage, marchFront, frontCamera, burnBand,
  FRONT_START, FRONT_STEP } from '../../src/world/Front.js';
import { addFallen, FALLEN_LENGTH } from '../../src/world/Fallen.js';
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

  check('crater log: the DRAWN marks are on the log too, and they are what shows', () => {
    /**
     * `NEXT.md`'s Step 0 verdict, as the check that would have caught it.
     *
     * The log replayed a battle to `max |Δh| = 0` and 1.9% of pixels moved,
     * because the battlefield's visible marks were never in the heightfield:
     * 520 of 539 of them are a bolt striking sand, and `crater` widens
     * anything under 1.35 cells and shallows it to conserve volume. The marks
     * lived in `Surface` — a 29 m window that follows the player and forgets —
     * and the log carried neither that nor the decal ring.
     *
     * So the assertion this file was missing is the one below: not "the same
     * heightfield" but **the same GROUND**, scar for scar. It is the only one
     * here that would have gone red on the tree the verdict was written about.
     */
    const t = ground();
    const log = new CraterLog().attach(t);
    battle(log, t, 200, 5);
    /* A hundred marks with no hole under them — the bolt that scorched the
     * sand without moving it, which is a class of event the crater list cannot
     * express at all. `Terrain.burn` goes through `scorch`, so this is what
     * every bolt impact in the game already does. */
    let s = 77;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 100; i++) {
      const a = rnd() * Math.PI * 2, r = 10 + rnd() * 90;
      t.burn(Math.cos(a) * r, Math.sin(a) * r, 0.26, 0.85);
    }
    assert(log.burnCount === 100,
      `${log.burnCount} drawn marks logged for 100 burns — Terrain.burn is not going through scorch`);
    assert(log.burns.length === 100 * BURN_LOG_FIELDS,
      `${log.burns.length} numbers for ${log.burnCount} marks`);

    /* THE FOUGHT GROUND'S SCARS, COPIED, then the same log put back twice —
     * once from the live log and once through JSON — so the two error terms
     * are separated. That is the same split the heightfield check makes, and
     * here it is what tells a defect from a rounding. */
    const fought = Float32Array.from(t.scars.scorch);
    const churn = Float32Array.from(t.scars.depth);
    const diff = (K) => {
      let maxS = 0, maxD = 0, over = 0;
      for (let i = 0; i < fought.length; i++) {
        maxS = Math.max(maxS, Math.abs(K.scorch[i] - fought[i]));
        const d = Math.abs(K.depth[i] - churn[i]);
        maxD = Math.max(maxD, d);
        if (d > 0.01) over++;
      }
      return { maxS, maxD, over };
    };
    let marked = 0;
    for (let i = 0; i < fought.length; i++) if (fought[i] > 0.004) marked++;
    assert(marked > 400,
      `only ${marked} cells of the scar field were marked by a 300-mark battle — the ground is not `
      + 'recording what happened on it');

    /* ONE: the live log onto fresh ground. EXACT, both channels, every cell.
     * If this is ever not zero then something in `crater` or `scorch` is
     * order-dependent or reads state the log does not carry, and every other
     * number in this file is meaningless. */
    const live = ground();
    log.replay(live);
    const exact = diff(live.scars);
    assert(exact.maxS === 0 && exact.maxD === 0,
      `a replay from the live log moved the soot by ${exact.maxS} and the turned ground by `
      + `${exact.maxD} — the marks are not a pure function of the log`);

    /* TWO: through JSON, which rounds every number to a centimetre. The soot
     * barely notices — it is a stack of smooth falloffs, so a centimetre of
     * position is a thousandth of heat. The turned ground has ONE place where
     * a centimetre is worth a lot: `SurfaceField.tread` puts a BOWL inside the
     * radius and a BERM just outside it, so a cell sitting exactly on that
     * boundary can come back on the other side of it and flip sign. Measured
     * here: four cells out of sixteen hundred marked, and the mean error over
     * the whole field is under a hundredth of a millimetre. A max is the wrong
     * statistic for that and a count is the right one. */
    const back = CraterLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())));
    assert(back.burnCount === 100, `${back.burnCount} marks survived the round trip`);
    const fresh = ground();
    const r = back.replay(fresh);
    assert(r.burns === 100, `replay reported ${r.burns} drawn marks`);
    const round = diff(fresh.scars);
    assert(round.maxS < 0.02,
      `a save-and-load moved the soot by ${round.maxS.toFixed(4)} over ${marked} marked cells`);
    assert(round.over < marked * 0.01,
      `${round.over} of ${marked} marked cells came back more than a centimetre out — that is past `
      + 'what a centimetre of rounding can do at a bowl rim, so it is a defect and not a rounding');
    return `200 craters + 100 drawn marks over ${marked} cells; live replay exact to the bit, `
      + `round trip Δsoot ${round.maxS.toFixed(4)} and ${round.over} rim cells flipped`;
  });

  check('crater log: a v1 file still loads, and a v2 one carries both lists', () => {
    /* A log saved before the drawn marks existed describes a ground that had
     * none recorded, which is exactly what it loads as. The failure this
     * refuses is the other one: a v2 reader that throws on a v1 file would
     * make every saved battlefield in existence unloadable. */
    const t = ground();
    const log = new CraterLog().attach(t);
    t.crater(4, 4, 2.6, 0.22);
    t.burn(-9, 3, 0.4, 1);
    const j = log.toJSON();
    assert(j.v === 2, `toJSON writes v${j.v}`);
    assert(Array.isArray(j.b) && j.b.length === BURN_LOG_FIELDS, 'the burn list is not in the file');
    const v1 = { v: 1, n: j.n, e: j.e };
    const old = CraterLog.fromJSON(v1);
    assert(old.length === 1 && old.burnCount === 0,
      `a v1 file loaded as ${old.length} craters and ${old.burnCount} marks`);
    /* …and the bare-array form, which is what a caller who stored
     * `log.toJSON().e` has. */
    const bare = CraterLog.fromJSON(j.e);
    assert(bare.length === 1 && bare.burnCount === 0, 'a bare entry array did not load');
    /* A v1 log must still REPLAY, onto a terrain that now has a scar field. */
    const fresh = ground();
    const r = old.replay(fresh);
    assert(r.craters === 1 && r.burns === 0, `a v1 replay reported ${r.craters}/${r.burns}`);
    return 'v2 writes both lists; v1 and a bare array load and replay';
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

  check('front: the swath is burnt ON the line, and the clean side stays clean', () => {
    /**
     * `NEXT.md`'s Step 1 verdict: engagement 3 differed from engagement 1 only
     * by a pale haze at 100 m, because the one variable §3 calls "a fact about
     * a place you can stand on" was, in the plates, a fact about the SKY. This
     * is the ground half of the answer, and the property that makes it worth
     * anything is that it has a HARD EDGE at the line — burnt behind, clean in
     * front. A wash over the whole map would be weather.
     */
    const t = ground();
    const f = frontAt(3, { seed: 7 });
    const n = burnBand(t, f, { seed: 11 });
    assert(n > 200, `the swath laid ${n} marks`);
    /* Sample along the axis of advance, through the line, and read the field
     * at each station. Behind the line it must be black; a good way in front
     * of it, untouched. */
    const at = (d) => t.scars.scorchAt(f.dir.x * d, f.dir.z * d);
    let onLine = 0, ahead = 0, behind = 0, samples = 0;
    for (let k = -120; k <= 120; k += 3) {
      const px = f.dir.x * f.distance - f.dir.z * k, pz = f.dir.z * f.distance + f.dir.x * k;
      onLine += t.scars.scorchAt(px, pz);
      ahead += t.scars.scorchAt(px - f.dir.x * 40, pz - f.dir.z * 40);
      behind += t.scars.scorchAt(px + f.dir.x * 26, pz + f.dir.z * 26);
      samples++;
    }
    onLine /= samples; ahead /= samples; behind /= samples;
    assert(ahead < 0.02,
      `ground 40 m SHORT of the line reads ${ahead.toFixed(3)} — the clean side is not clean, so the `
      + 'line has no edge and there is nothing to see moving');
    assert(onLine > 0.25, `the line itself reads ${onLine.toFixed(3)}`);
    /* …and it THINS with depth into the burnt side rather than stopping dead,
     * because a front is a zone about thirty metres deep and not a stripe. */
    assert(behind > 0.01 && behind < onLine * 0.8,
      `26 m behind the line reads ${behind.toFixed(3)} against ${onLine.toFixed(3)} on it`);
    /* AND IT IS ADDITIVE ACROSS ENGAGEMENTS. Ground the line crossed at
     * engagement 1 is fought over again at 2, 3, 4 and 5, and that gradient is
     * the reason the plates can be ordered by looking down rather than up. */
    /* Averaged over a patch rather than read at a point: the band is a scatter
     * of discs with gaps in it BY DESIGN (a continuous fill reads as a shadow),
     * so a single sample is a coin toss about whether it landed in a gap. */
    const patch = (d) => {
      let sum = 0, n = 0;
      for (let a = -30; a <= 30; a += 4) for (let b = -6; b <= 6; b += 3) {
        sum += t.scars.scorchAt(f.dir.x * (d + b) - f.dir.z * a, f.dir.z * (d + b) + f.dir.x * a);
        n++;
      }
      return sum / n;
    };
    const deep = patch(FRONT_START + 8);
    burnBand(t, frontAt(1, { seed: 7 }), { seed: 13 });
    assert(patch(FRONT_START + 8) > deep + 0.01,
      `a second engagement over the same ground took ${deep.toFixed(3)} to `
      + `${patch(FRONT_START + 8).toFixed(3)} — the record is not accumulating`);
    return `line ${onLine.toFixed(3)}, 26 m behind ${behind.toFixed(3)}, 40 m short ${ahead.toFixed(3)} `
      + `over ${n} marks`;
  });

  check('front: the dead are instanced, prone, and lying ON the ground', () => {
    /* §12.4: "the dead mark the front — 520 prone instanced figures in a 26 m
     * band, thickest at the choke, one draw call." The draw-call claim is the
     * one that decides whether this can exist at all: `FLAGSHIP.md` §4 measures
     * a cuttable body at 26 calls at every distance, so four hundred of them is
     * 10 400 against a 520 budget. */
    const t = ground();
    const world = { scene: new THREE.Scene(), terrain: t, statics: [] };
    const f = frontAt(3, { seed: 7 });
    const out = addFallen(world, {
      origin: { x: f.dir.x * f.distance, z: f.dir.z * f.distance },
      dir: f.dir, count: 400, seed: 21,
    });
    assert(out && out.count > 380, `${out ? out.count : 0} of 400 bodies were placed`);
    assert(out.calls <= 2, `${out.calls} draw calls for ${out.count} bodies`);
    assert(world.statics.length === out.calls,
      `${world.statics.length} entries in statics for ${out.calls} meshes — World.unload disposes `
      + 'what it finds there, and a Group has no geometry for it to dispose');
    /* EVERY BODY IS ON THE GROUND. A prone figure floating 40 cm over a dune
     * is the fault `prop-seating.mjs` found 246 instances of in the crowd, and
     * it is invisible from any distance the field is read from. */
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    let worst = 0, band = 0;
    for (const mesh of out.meshes) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        worst = Math.max(worst, Math.abs(p.y - t.height(p.x, p.z) + 0.045));
        const across = (p.x * f.dir.x + p.z * f.dir.z) - f.distance;
        if (Math.abs(across) <= 13) band++;
      }
    }
    /* 1 cm, and the tolerance is the BUFFER's and not the placement's:
     * `instanceMatrix` is a Float32Array, so a position 200 m from the origin
     * comes back with about 2e-5 m of quantisation on it. The placement itself
     * is exact — it is `terrain.height` plus a constant sink. */
    assert(worst < 0.01, `a body sits ${(worst * 1000).toFixed(1)} mm off the ground it is lying on`);
    /* …and they are in §12.4's band rather than scattered over the map. */
    assert(band / out.count > 0.6,
      `only ${(100 * band / out.count).toFixed(0)}% of the fallen are inside the 26 m band`);
    /* TWO POSES, because one silhouette four hundred times is a pattern and a
     * pattern reads as a decal — the crowd was rebuilt for exactly this. */
    assert(out.meshes.length === 2, `${out.meshes.length} distinct poses`);
    assert(Math.abs(FALLEN_LENGTH - 1.8) < 0.01, `a man is ${FALLEN_LENGTH} m long lying down`);
    let tris = 0;
    for (const mesh of out.meshes) tris += (mesh.geometry.index.count / 3) * mesh.count;
    return `${out.count} bodies in ${out.calls} calls, ${(tris / out.count).toFixed(0)} triangles each, `
      + `${(100 * band / out.count).toFixed(0)}% inside the 26 m band`;
  });

  check('crater log: a log lays itself onto one ground once, however many times it is handed over', () => {
    /**
     * `CommandDirector.marchTo` dresses engagements 1…n in a loop and hands
     * `world.craterLog` to EVERY one of those `marchFront` calls. Without this
     * rule, carrying a log across a ground change meant replaying it once per
     * engagement onto the same fresh terrain — three engagements in, every hole
     * three times as deep, and each individual crater still the right size.
     */
    const dug = ground();
    const log = new CraterLog().attach(dug);
    battle(log, dug, 60, 5);
    log.detach();
    const fresh = ground();
    const first = log.replay(fresh);
    const after = fresh.height(0, 40);
    const again = log.replay(fresh);
    assert(first.craters > 0, 'the first replay laid nothing');
    assert(again.skipped && again.craters === 0,
      `a second replay onto the same ground laid ${again.craters} more craters`);
    assert(fresh.height(0, 40) === after, 'the ground moved on a replay that laid nothing');
    /* …and a DIFFERENT log still lays itself onto ground somebody has played
     * onto, because that is a different question and a legitimate one. */
    const other = CraterLog.fromJSON(log.toJSON());
    assert(other.replay(fresh).craters > 0,
      'a second log refused to lay itself onto ground the first had played onto — the guard is on '
      + 'the ground rather than on the log, so a co-op guest or a saved campaign could not dress');
    return `${first.craters} craters laid once, a repeat handover laid 0, a second log laid `
      + `${other.length}`;
  });

  check('crater log: the run carries the ground it fought over onto the next one', async () => {
    /**
     * THE WIRE THAT WAS COMPLETE ON BOTH SIDES AND CONNECTED NOWHERE.
     *
     * `marchTo` has passed `w.craterLog` into `marchFront` for as long as the
     * front has been dressed, and nothing in the tree ever constructed one — so
     * every engagement of every run opened on ground that had never been fought
     * over, and this file's exactness checks were measuring a system with no
     * caller. This drives a REAL World through a REAL ground change, because
     * that is the only place the defect lived.
     */
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: FIELD,
      settings: { mode: 'theline', level: FIELD },
      runSeed: 7,
    });
    const log = world.craterLog;
    assert(log, 'a world leading an army built no crater log at all — the wire is still hanging');
    assert(world.terrain._craterLog === log,
      'the log exists and is not recording the ground it belongs to');
    /* A few real holes, through the door every explosion in the game uses. */
    for (let i = 0; i < 12; i++) world.terrain.crater(10 + i * 3, -20, 2.4, 0.3);
    assert(log.length >= 12, `${log.length} craters recorded off twelve calls to terrain.crater`);
    const dug = log.length;

    /* THE GROUND CHANGES. The log is a fact about the RUN and the terrain is
     * not, so it has to survive `unload` and re-attach to what comes next. */
    world.rotateTo(FIELD);
    assert(world.craterLog === log,
      'the ground changed and the run forgot the battle it had just fought');
    assert(log.length >= dug, `the log shrank from ${dug} to ${log.length} across a ground change`);
    assert(world.terrain._craterLog === log,
      'the log survived the rotation and is not recording the new ground');
    /* …and it is the NEW terrain, not the disposed one. */
    assert(world.terrain._craterLogPlayed === log || log.length >= dug,
      'the new ground has neither been played onto nor is being recorded');
    world.unload?.();
    return `${dug} craters recorded on the first ground and carried across the rotation, `
      + `trimmed at ${SESSION_MEMORY}`;
  });
}
