/**
 * BATTLEFRONT BORZ — FLAGSHIP.md §14's KILL TESTS, steps 0, 1 and 2.
 *
 * These three tests exist to KILL the flagship design, not to support it, and
 * this probe is written on that footing: every arm is measured the same way,
 * every comparison is a fresh World per condition (HANDOFF §2.5 — the one
 * finding in that section came from a probe that reused a world with eight
 * bodies still standing in it), and every number it prints is one it took
 * rather than one it derived from a rule stated somewhere else (§2.4).
 *
 *   node --import ./tools/register.mjs tools/_flagship.mjs step0 [--seed 7]
 *   node --import ./tools/register.mjs tools/_flagship.mjs step1 [--seed 7]
 *   node --import ./tools/register.mjs tools/_flagship.mjs step2 [--seeds 3,5,7,11]
 *
 * Output is JSON under `.flagship/` plus a human line per arm on stdout. The
 * screenshots the tests are actually judged on are `tools/_frontshot.mjs`'s;
 * this file writes the crater logs and the numbers that one reads.
 *
 * ── STEP 0 — DOES THE GROUND REMEMBER ───────────────────────────────────
 *
 * Fight one Command area with a `CraterLog` attached, dump it, boot the level
 * again from nothing, replay, and compare the two heightfields cell by cell.
 * The question a PERSON is asked is whether visit two reads as the same ground
 * after a battle or as a level with holes in it, and that is a question about
 * a picture — but the picture is worth nothing if the replay is approximate,
 * so the number this step exists to produce is `max |Δh|` over every cell.
 *
 * ── STEP 1 — DOES THE FRONT READ ────────────────────────────────────────
 *
 * Five engagements on one Geonosis. Between each: replay the accumulated
 * crater log, re-dress at `seed + engagement`, march the smoke columns in on
 * §14's own schedule, and grow wrecks on the burnt side only. See
 * src/world/Front.js, which says what of that machinery already existed and
 * what did not. This half writes the world state; the plates come from
 * `tools/_frontshot.mjs`.
 *
 * ── STEP 2 — THE DEAD JEDI TEST ─────────────────────────────────────────
 *
 * Three arms, several seeds each:
 *
 *   NONE   no player in the world at all.
 *   BLADE  a player who fights — see `dutyInput` below, which is the only
 *          reason this test can be run headlessly at all.
 *   DEAD   the same player, the same movement, the same Force, the same
 *          orders, the same presence — and `boonMods.cutPower = 0` with the
 *          enemies taken out of the blade's target list.
 *
 * The verdict FLAGSHIP asks for: if DEAD sits nearer BLADE than NONE on
 * `fallen` and areas taken, the presence loop carries real weight. If it sits
 * nearer NONE, §7 is wrong.
 *
 * THE ONE THING THAT MAKES THIS PROBE'S ANSWER ARGUABLE, stated up front
 * because it would otherwise be found later and discount everything: the
 * player in arms BLADE and DEAD is a SCRIPT, not a person. It walks at the
 * nearest enemy and swings. It does not choose when to BREAK a formation, it
 * does not OPEN a target for the riflemen behind it, and it never decides
 * anything. So this measures the floor of what a present Jedi is worth, and a
 * person at the controls can only be worth more. A DEAD-nearer-NONE result
 * from a script is therefore NOT a refutation of §7 on its own — but a
 * DEAD-nearer-BLADE result from a script is a stronger confirmation than a
 * person could give, because nothing in it is the player being good at the
 * game.
 */

import './dom-shim.mjs';
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { CraterLog } from '../src/world/CraterLog.js';
import { marchFront, frontAt } from '../src/world/Front.js';
import { strewWrecks } from '../src/game/Levels.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = resolve(ROOT, '.flagship');
const argv = process.argv.slice(2);
const CMD = argv[0] || 'step0';
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SEED = Number(flag('seed', '7'));

/**
 * 1/30 AND NOT 1/60, and it is the same reason `tools/checks/command.mjs`
 * gives: these drives are hundreds of GAME-seconds long, `main.js` clamps `dt`
 * at 0.1 s so 0.033 is inside the range the game is written to survive, and
 * every arm of every comparison below is stepped at it. A step size that
 * differed between two arms would be an A/B on the integrator.
 */
const STEP = 1 / 30;

const mkOut = () => { mkdirSync(OUT, { recursive: true }); return OUT; };
const write = (name, obj) => {
  const f = resolve(mkOut(), name);
  writeFileSync(f, JSON.stringify(obj, null, name.endsWith('.log.json') ? 0 : 2));
  return f;
};

async function commandWorld(seed, opts = {}) {
  const { world } = await bootWorld({
    level: 'geonosis',
    spawn: opts.player !== false,
    settings: { mode: 'command', level: 'geonosis', order: opts.order || 'jedi',
      seed, difficulty: 'knight' },
  });
  world.director.start(1);
  return world;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  A Jedi that actually does something                                   */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE SCRIPTED JEDI — and without it steps 2's three arms are two arms.
 *
 * `idleInput()` is what every headless check in this repository drives a
 * player with: it returns false for every action and (0,0) for the movement
 * axis forever. A player driven by it stands where it was put and never
 * swings, so "player with a blade" and "player without one" would be the same
 * world twice and the test would report a difference of zero and call it a
 * finding.
 *
 * What this does, and deliberately no more:
 *
 *   IT HOLDS STATION ON ITS OWN LINE and meets whatever comes inside `ENGAGE`,
 *     which is the Vanguard's band (§8, 0–3 m) and the only one of the four
 *     playstyles that can be scripted without inventing judgement. Holding
 *     station is also what keeps the Jedi INSIDE the formation, which is what
 *     makes `MORALE.JEDI_NEAR` pay — and that term is the presence loop this
 *     whole step is testing. The first version chased the nearest body across
 *     the field and died in 99 game-seconds having dragged the line with it,
 *     which is §6's own paragraph happening to a script.
 *   IT SWINGS ON A FIXED CADENCE inside reach: `thrust` and `attackOver`
 *     alternating every `SWING` seconds, through `actHit`, which is the same
 *     door `tools/checks/animation.mjs` opens an attack with.
 *   IT HOLDS THE GUARD and PUSHES on a fixed cadence — see the notes on `act`
 *     and on `pushT` below. Both are in BOTH player arms, because §14's arm is
 *     "keep Force, orders, presence, morale and stratagems" and because
 *     without a guard the script does not live to the second engagement.
 *   IT KEEPS THE BLADE LIT and the camera pointed at what it is walking at,
 *     because `Player` builds its movement frame off `camera.yaw`.
 *
 * What it does NOT do: dash, dive, pick a guard zone, grip, hurl, unleash,
 * spell a stratagem, or give an order. Every one of those is a decision, and a
 * script that makes them is a script whose author has decided the answer.
 */
const SWING = 0.55;
/** How near a foe has to come before the Jedi leaves the line to meet it. */
const ENGAGE = 14;
/** …and how far from the line it will ever get. §6: "walking 35 m forward drags
 *  the whole formation with you and costs 4 of 10 men." */
const LEASH = 18;
/** Seconds between Force pushes while something is inside `PUSH_REACH`. */
const PUSH_EVERY = 4.0;
const PUSH_REACH = 8;
/** Below this fraction of health the Jedi is put back on its feet — see
 *  `keepAlive`, which is the one intervention in this probe and is counted. */
const FLOOR = 0.35;

function dutyInput(world, opts = {}) {
  const hit = new Set();
  let swing = 0, alt = 0, pushT = 0;
  const axis = { x: 0, y: 0 };
  const tally = { heals: 0, swings: 0, pushes: 0, downAt: null, t: 0 };
  const input = {
    keys: new Set(), buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (o) => { if (o) { o.x = axis.x; o.y = axis.y; return o; } return { ...axis }; },
    /* THE GUARD IS HELD, ALWAYS. The shipped default scheme is `directional`
     * (Menu.js DEFAULT_SETTINGS), where `blade` RAISES A ZONE rather than
     * taking the mouse — so holding it is what a player under fire does with
     * their right hand and costs the script nothing it has to decide. Without
     * it the blade is parked, `CatchWindow` never opens the auto-guard cone,
     * and the Jedi is a man standing in the open: measured, 100 hp to dead in
     * 77 game-seconds of wave 1 and 2. With it the same script is still on its
     * feet after 400. That is not a tuning choice — a probe whose player dies
     * in the first engagement is measuring the script's tactics, not presence. */
    act: (id) => id === 'blade',
    actHit: (id) => hit.has(id), actDown: (id) => hit.has(id),
    end() {},
    tally,
  };
  input.tick = (dt) => {
    hit.clear();
    tally.t += dt;
    const p = world.player;
    if (!p) { axis.x = axis.y = 0; return; }
    if (!p.alive && tally.downAt === null) tally.downAt = +tally.t.toFixed(1);
    /* KEPT ON ITS FEET, AND COUNTED. The intervention is identical in both
     * player arms, so it cannot favour one — and the COUNT is itself a
     * measurement: if the disarmed Jedi needs many more of these than the
     * armed one, the blade's contribution to the line is partly that it stops
     * things reaching the Jedi at all. */
    if (opts.keepAlive !== false && p.alive && p.hp < p.maxHp * FLOOR) {
      p.hp = p.maxHp; tally.heals++;
    }
    if (!p.alive) { axis.x = axis.y = 0; return; }
    if (p.saber && !p.saber.lit) p.saber.ignite();

    /* WHERE THE LINE IS — the centroid of this commander's living bodies. The
     * script holds station on it rather than on the origin, so when the
     * formation advances the Jedi advances with it and `MORALE.JEDI_NEAR`
     * keeps paying. Standing on a fixed point would have the army walk out
     * from under the presence term this step exists to measure. */
    let ax = 0, az = 0, n = 0;
    const c = world.command?.commander;
    for (const tr of (c ? c.roster.living : [])) {
      const b = tr.body;
      if (!b || b.dead) continue;
      ax += b.position.x; az += b.position.z; n++;
    }
    const anchor = n ? { x: ax / n, z: az / n } : { x: 0, z: 0 };
    /**
     * …AND `standOff` PUTS THE JEDI ON THE FIELD BUT NOT IN THE LINE.
     *
     * The fourth arm exists to separate two explanations of the same result.
     * Step 2 measures a line that loses seven men with a Jedi in it and none
     * without, and nothing in the first three arms tells "a Jedi COSTS the
     * line men" apart from "a Jedi drags the fight out, and the men standing
     * near him are standing in fire that was aimed at him".
     *
     * So: a player who is alive, armed, fighting whatever reaches him, and a
     * hundred metres away. Same script, same guard, same keep-alive — the only
     * thing that moves is where he holds station. If the line still loses its
     * seven, presence is not what is killing them.
     *
     * The offset is a fixed bearing rather than a random one so the arm is as
     * repeatable as the other three, and it is applied to the ANCHOR rather
     * than clamped on the player, so `LEASH` keeps measuring distance from the
     * station the script is actually holding.
     */
    if (opts.standOff) { anchor.x += opts.standOff; }

    /* The nearest living HOSTILE, and the team test is not optional: in Command
     * your own troopers are `Enemy`s in `world.enemies` with another team on
     * them, so a script that walked at `enemies[0]` would spend the battle
     * chasing its own sergeant. */
    let best = null, bd = 1e9;
    for (const e of world.enemies) {
      if (e.dead || e.team === p.team) continue;
      const d = e.position.distanceToSquared(p.position);
      if (d < bd) { bd = d; best = e; }
    }
    const dist = best ? Math.sqrt(bd) : 1e9;
    const fromLine = Math.hypot(p.position.x - anchor.x, p.position.z - anchor.z);
    const chase = best && dist < ENGAGE && fromLine < LEASH;
    const tx = chase ? best.position.x : anchor.x;
    const tz = chase ? best.position.z : anchor.z;
    const dx = tx - p.position.x, dz = tz - p.position.z;
    const reach = Math.hypot(dx, dz);
    /* `Player` builds forward as `-(sin yaw, 0, cos yaw)` — Player.js 3928. */
    if (best) p.camera.yaw = Math.atan2(-(best.position.x - p.position.x), -(best.position.z - p.position.z));
    else if (reach > 0.01) p.camera.yaw = Math.atan2(-dx, -dz);
    axis.x = 0;
    axis.y = reach > 2.4 ? 1 : 0;

    if (best && dist < 3.4) {
      swing += dt;
      if (swing >= SWING) { swing = 0; tally.swings++; hit.add((alt++ % 2) ? 'attackOver' : 'thrust'); }
    } else swing = 0;

    /* THE FORCE, and it is in both player arms because §14 says so: "keep
     * Force, orders, presence, morale and stratagems". A push is also the one
     * thing this script does that BREAKS ground — `Player.forcePush` ends in
     * `terrain.crater(x, z, 1.8 + power, 0.42 * power)`, which is a real hole
     * where a bolt striking the sand is a 4 mm scuff. Step 0's crater log is
     * mostly empty without it, and a probe that never pushed would have
     * measured a battlefield no Jedi had fought on. */
    pushT += dt;
    if (best && dist < PUSH_REACH && pushT >= PUSH_EVERY) { pushT = 0; tally.pushes++; hit.add('push'); }
  };
  return input;
}

/**
 * DRIVE A WORLD, and count what happened while it did.
 *
 * `until` is checked every step so an arm that clears its engagements early
 * stops there rather than fighting on into the next one — the comparison is
 * over the same NUMBER OF ENGAGEMENTS, not the same wall of time, because a
 * player who clears three waves in 200 s and one who takes 400 s have both
 * fought three waves and the second one has simply been slower.
 */
function drive(world, seconds, input, until = null) {
  const n = Math.round(seconds / STEP);
  let t = 0;
  for (let i = 0; i < n; i++) {
    input.tick?.(STEP);
    world.update(STEP, input);
    t += STEP;
    if (until && until(t)) break;
  }
  return t;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Step 0 — the ground remembers                                         */
/* ══════════════════════════════════════════════════════════════════════ */

async function step0() {
  const report = { seed: SEED, step: 0 };

  /* ── VISIT ONE. One Command area, fought with the log attached. The cap is
   * generous and the real stop is `areasTaken`, so a slow area is a slow area
   * and not a truncated one. */
  const w1 = await commandWorld(SEED);
  const log = new CraterLog().attach(w1.terrain);
  const input = dutyInput(w1);
  const t0 = Date.now();
  const fought = drive(w1, 900, input, () => w1.command.areasTaken >= 1);
  report.visitOne = {
    gameSeconds: +fought.toFixed(1), wallMs: Date.now() - t0,
    areasTaken: w1.command.areasTaken, waves: w1.director.wave,
    fallen: w1.command.roster.fallen.length,
    standing: w1.command.roster.strength,
  };

  /* WHAT KIND OF MARKS THEY ARE, because "1 186 craters" and "1 186 holes" are
   * different sentences. `World._boltHitTest` craters at 0.55 m × 0.06 m for
   * every bolt that reaches the ground, which is a scuff; an explosion is
   * 2.6 m × 0.55 m. Counting them apart is the difference between a battlefield
   * that has been shot over and one that has been shelled. */
  const e = log.entries;
  let big = 0, small = 0, deepest = 0, widest = 0;
  for (let i = 0; i < e.length; i += 6) {
    if (e[i + 2] >= 1.5) big++; else small++;
    deepest = Math.max(deepest, e[i + 3]); widest = Math.max(widest, e[i + 2]);
  }
  report.craters = { total: log.length, shelled: big, scuffed: small,
    deepest: +deepest.toFixed(3), widest: +widest.toFixed(2) };

  /* ── THE LOG AGAINST THE GRID, which is FLAGSHIP §3's whole claim. The grid
   * figure is the honest one — heights + deform + the landform channel — and
   * not just the height array, because a snapshot that restored heights alone
   * would come back with the concavity channel still describing the crest the
   * crater used to be. */
  const T1 = w1.terrain;
  const j = JSON.stringify(log.toJSON());
  const gridBytes = T1.heights.byteLength + T1.deform.byteLength + T1.landform.byteLength;
  report.size = { logBytes: j.length, gridBytes, ratio: +(gridBytes / j.length).toFixed(1),
    res: T1.res, cells: T1.heights.length };
  report.logFile = write(`step0-seed${SEED}.log.json`, log.toJSON());

  /* THE FOUGHT GROUND, copied before anything else touches it. */
  const fightHeights = Float32Array.from(T1.heights);

  /* ── VISIT TWO. A World built from nothing, on the same seed, and the log
   * put back onto it. Round-tripped through JSON on the way, because that is
   * what a session that was actually saved and loaded would do — and the
   * rounding in `toJSON` is the one lossy step in the whole path. */
  const w2 = await commandWorld(SEED);
  const T2 = w2.terrain;
  let baseMax = 0;
  for (let i = 0; i < T2.heights.length; i++) {
    /* THE GENERATED GROUND HAS TO BE THE SAME GROUND FIRST. If two boots of
     * one seed disagreed before a single crater was replayed, every number
     * below would be measuring the generator and not the log. */
    baseMax = Math.max(baseMax, Math.abs(T2.heights[i] - (fightHeights[i] - T1.deform[i])));
  }
  const reloaded = CraterLog.fromJSON(JSON.parse(j));
  const r = reloaded.replay(T2);
  /* AND THE SAME LOG WITHOUT THE ROUND TRIP, onto a third ground, so the two
   * error terms are separated. `toJSON` rounds to a centimetre (see
   * CraterLog.js) and that rounding is the ONLY lossy step in the path — a
   * replay from the live log has to be exact to the bit, and if it is not then
   * something in `crater` is order-dependent or reads state the log does not
   * carry, which would make every other number here meaningless. */
  const w3 = await commandWorld(SEED);
  const exact = log.replay(w3.terrain);
  let exactMax = 0;
  for (let i = 0; i < w3.terrain.heights.length; i++)
    exactMax = Math.max(exactMax, Math.abs(w3.terrain.heights[i] - fightHeights[i]));
  w3.unload?.();
  let max = 0, sum = 0, moved = 0;
  for (let i = 0; i < T2.heights.length; i++) {
    const d = Math.abs(T2.heights[i] - fightHeights[i]);
    if (d > max) max = d;
    sum += d;
    if (Math.abs(T1.deform[i]) > 0.005) moved++;
  }
  /* HOW MUCH GROUND THE BATTLE ACTUALLY MARKED, in square metres, because a
   * percentage of cells is a fact about a grid and the question is about a
   * place. The walkable disc on this level is r = 90 m — the figure
   * `world-immersion` uses — so the fraction below is of the ground a player
   * can stand on rather than of the whole 500 m plate. */
  const cell = T2.step * T2.step;
  report.replay = {
    craters: r.craters, ms: +r.ms.toFixed(1),
    exactMs: +exact.ms.toFixed(1),
    baseGroundMaxDelta: +baseMax.toFixed(6),
    maxDelta: +max.toFixed(6), meanDelta: +(sum / T2.heights.length).toFixed(8),
    maxDeltaNoRoundTrip: +exactMax.toFixed(9),
    cellsMoved: moved, cellsMovedPct: +(100 * moved / T2.heights.length).toFixed(2),
    markedM2: +(moved * cell).toFixed(0),
    pctOfWalkableDisc: +(100 * moved * cell / (Math.PI * 90 * 90)).toFixed(2),
    cellM: +T2.step.toFixed(2),
  };

  /* ── AND FIGHT AGAIN on the replayed ground, which is the half of §14 Step 0
   * that is not about a picture: a battlefield you cannot fight a second
   * battle on is not persistence, it is damage. */
  const log2 = new CraterLog().attach(T2);
  const in2 = dutyInput(w2);
  const t2 = Date.now();
  const fought2 = drive(w2, 900, in2, () => w2.command.areasTaken >= 1);
  report.visitTwo = {
    gameSeconds: +fought2.toFixed(1), wallMs: Date.now() - t2,
    areasTaken: w2.command.areasTaken, waves: w2.director.wave,
    fallen: w2.command.roster.fallen.length,
    standing: w2.command.roster.strength,
    newCraters: log2.length,
  };
  /* THE SECOND SORTIE'S GROUND, saved so the plates can show the state a third
   * visit would open on — and so §4's "persistence saturates" claim has the
   * numbers from this tree beside it. */
  const both = new CraterLog([...log.entries, ...log2.entries]);
  report.afterTwo = { craters: both.length,
    bytes: JSON.stringify(both.toJSON()).length };
  write(`step0-seed${SEED}-two-sorties.log.json`, both.toJSON());

  const f = write(`step0-seed${SEED}.json`, report);
  console.log(JSON.stringify(report, null, 2));
  console.log('\nwrote', f);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Step 1 — the marching front                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * FIVE ENGAGEMENTS, HEADLESS, to produce the crater log each plate is dressed
 * with. The plates themselves are rendered by `tools/_frontshot.mjs`, which
 * boots the real game in a real browser and replays these logs — a render is
 * four seconds a frame through SwiftShader (HANDOFF §2.6) and fighting five
 * engagements in there would be a day.
 *
 * The output is one log per engagement, CUMULATIVE: engagement 3's file is
 * everything that had happened to the ground by the end of engagement 3, which
 * is what a player arriving for engagement 4 would be standing on.
 */
async function step1() {
  const report = { seed: SEED, step: 1, engagements: [] };
  const world = await commandWorld(SEED);
  const log = new CraterLog().attach(world.terrain);
  const input = dutyInput(world);
  const front0 = frontAt(1, { seed: SEED });
  report.bearing = +front0.bearing.toFixed(4);

  for (let n = 1; n <= 5; n++) {
    /* ONE ENGAGEMENT IS ONE WAVE HERE, and that is a substitution worth
     * naming: FLAGSHIP's engagement is a whole battle between musters, and the
     * unit today's Command actually has is a wave inside an area. Using the
     * wave keeps five engagements inside one deployment on one ground, which
     * is the thing §13 says the mode rests on. */
    const target = world.director.wave;
    const t0 = Date.now();
    const secs = drive(world, 400, input, () => world.director.wave > target);
    const f = frontAt(n, { seed: SEED });
    report.engagements.push({
      n, gameSeconds: +secs.toFixed(1), wallMs: Date.now() - t0,
      wave: world.director.wave, front: f.distance,
      craters: log.length, fallen: world.command.roster.fallen.length,
      standing: world.command.roster.strength,
    });
    write(`step1-seed${SEED}-e${n}.log.json`, log.toJSON());
  }
  const f = write(`step1-seed${SEED}.json`, report);
  console.log(JSON.stringify(report, null, 2));
  console.log('\nwrote', f);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Step 2 — the Dead Jedi test                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * TAKE THE BLADE AWAY WITHOUT TAKING THE JEDI AWAY.
 *
 * §14 names two knobs: `boonMods.cutPower = 0`, and the blade out of
 * `bladeTargets`. The second one needs a translation, because `bladeTargets`
 * is the PLAYER-versus-player list; the list a Jedi's blade meets an army
 * through is assembled inline in `World.update` and handed to
 * `this.bladeSolver.solve`. So both knobs are turned at the one place they
 * both pass through: the solver call. Enemies are filtered out of the target
 * list and the power is forced to zero.
 *
 * Everything else is untouched and that is the point of the arm — the Force
 * powers, the orders, the presence terms in `MORALE`, the stratagems and the
 * body itself all still work, and the blade still deflects, still clashes and
 * still cuts props and doors.
 *
 * `boonMods.cutPower` is ALSO set every frame, not once: `Waves.js` recomputes
 * `boonMods` from the taken-boon set whenever the set changes, so a single
 * assignment at boot is a knob that quietly turns itself back on the first time
 * anything touches the boons.
 */
function disarm(world) {
  const solver = world.bladeSolver;
  const orig = solver.solve.bind(solver);
  let blocked = 0;
  solver.solve = (saber, targets, dt, opts) => {
    const kept = [];
    for (const t of targets) { if (t.enemy) blocked++; else kept.push(t); }
    return orig(saber, kept, dt, { ...opts, power: 0 });
  };
  return { blocked: () => blocked };
}

/**
 * WHAT THE PLAYER'S BLADE ACTUALLY DID TO THE ARMY, counted at the one door
 * every blade event goes through. This is the arm's own proof: if DEAD reports
 * anything but zero here, the arm did not disarm anybody and its numbers mean
 * nothing.
 */
function watchBlade(world) {
  const orig = world._applyBladeEvent.bind(world);
  const tally = { events: 0, onEnemies: 0, damage: 0, kills: 0 };
  world._applyBladeEvent = (p, ev, dt) => {
    tally.events++;
    if (ev && ev.target && ev.target.enemy) {
      tally.onEnemies++;
      const hp = ev.target.enemy.hp;
      const out = orig(p, ev, dt);
      const lost = hp - ev.target.enemy.hp;
      if (lost > 0) tally.damage += lost;
      if (hp > 0 && ev.target.enemy.hp <= 0) tally.kills++;
      return out;
    }
    return orig(p, ev, dt);
  };
  return tally;
}

/**
 * `far` IS THE CONTROL THE FIRST THREE ARMS DO NOT HAVE. See `standOff` in
 * `dutyInput`: a Jedi on the field, armed and fighting, a hundred metres from
 * the line. It separates the cost of PRESENCE from the cost of a player
 * existing for the horde to walk toward.
 */
const ARMS = ['none', 'blade', 'dead', 'far'];
const STAND_OFF = 100;

async function runArm(arm, seed, engagements) {
  const world = await commandWorld(seed, { player: arm !== 'none' });
  const input = arm === 'none' ? idleInput()
    : dutyInput(world, arm === 'far' ? { standOff: STAND_OFF } : {});
  const blade = arm === 'none' ? null : watchBlade(world);
  const dis = arm === 'dead' ? disarm(world) : null;
  if (arm === 'dead') {
    /* Every frame — see `disarm`'s note on why once is not enough. */
    const tick = input.tick;
    input.tick = (dt) => { tick(dt); if (world.player) world.player.boonMods.cutPower = 0; };
  }
  const t0 = Date.now();
  const start = world.director.wave;
  /**
   * 220 GAME-SECONDS AN ENGAGEMENT, AND THE CAP IS A MEASUREMENT NOT A BUDGET.
   *
   * A wave of area one takes 70-130 game-seconds to clear across every arm
   * measured here, so 220 is comfortably over the top of that distribution and
   * a run that reaches it did not fight slowly - it failed to finish. Two
   * things do that, and both are worth reporting rather than waiting out:
   *
   *   - the arm genuinely cannot kill what is in front of it, which is exactly
   *     what the DEAD arm is being asked about;
   *   - FLAGSHIP §16's live bug 3, measured here on this tree: a wave with zero
   *     hostiles left, an empty queue and no inbound arrival that stays
   *     `active` indefinitely. One run sat in that state from 200 s to 350 s.
   *
   * `waveClears` is therefore the honest denominator for every arm rather than
   * "three engagements", and `cappedOut` says which rows did not get three.
   */
  const CAP = 220;
  /**
   * EVERY ENEMY THAT DIES, COUNTED WHEN IT DIES.
   *
   * Wrapped on the world's own kill callback rather than counted off the
   * roster at the end, for the reason the note over `foeKilled` gives: bodies
   * leave `world.enemies` and a census cannot see the ones that already have.
   * Variadic past the argument it reads, so a signature change downstream does
   * not silently drop the tail.
   */
  const killed = { n: 0 };
  {
    const inner = world.onEnemyKilled ? world.onEnemyKilled.bind(world) : null;
    world.onEnemyKilled = (...a) => { killed.n++; return inner ? inner(...a) : undefined; };
  }
  let stalled = 0, stallAt = null;
  const secs = drive(world, CAP * engagements, input, (t) => {
    /* THE STALL, WATCHED RATHER THAN WAITED OUT. The condition is the base
     * director's own clear test read from outside: nothing left to deliver,
     * nothing in the air, nothing hostile standing - and the wave still open. */
    const d0 = world.command;
    const blocking = world.enemies.reduce((n, e) => n + (d0.blocksWaveEnd(e) ? 1 : 0), 0);
    if (d0.active && !d0.spawnQueue.length && !d0.arrivals.pending && blocking === 0) {
      stalled += STEP;
      if (stalled > 15 && stallAt === null) stallAt = +t.toFixed(1);
    } else stalled = 0;
    return world.director.wave > start + engagements - 1 || world.command.done;
  });
  const d = world.command;
  const out = {
    arm, seed, gameSeconds: +secs.toFixed(1), wallMs: Date.now() - t0,
    cappedOut: secs >= CAP * engagements - STEP,
    stalledAt: stallAt,
    wave: world.director.wave, waveClears: world.director.wave - start,
    areasTaken: d.areasTaken, area: d.areaNumber,
    fallen: d.roster.fallen.length, standing: d.roster.strength,
    enlisted: d.roster.all.length,
    playerAlive: world.player ? !!world.player.alive : null,
    bladeDamage: blade ? +blade.damage.toFixed(1) : null,
    bladeKills: blade ? blade.kills : null,
    bladeEventsOnEnemies: blade ? blade.onEnemies : null,
    enemiesBlockedFromBlade: dis ? dis.blocked() : null,
    /**
     * THE OTHER SIDE'S LOSSES, which `fallen` says nothing about. A Jedi that
     * cannot cut may still be killing droids by returning bolts and by handing
     * ten riflemen an opened target, and if it is, that is §7's OPEN and TURN
     * verbs showing up in a number.
     *
     * ── AND THIS COULD NOT BEAR THAT READING, MEASURED ─────────────────────
     *
     * It was `world.enemies.filter(e => e.dead).length`, which is a CORPSE
     * CENSUS at the sampling instant and not a count of kills: `Corpses`
     * settles and disposes bodies as the run goes on, and the three arms do not
     * run for the same length of time — five seeds, means of 22 s with no
     * player against 56 s with a blade and 95 s with the blade disabled. So the
     * short arm was reported as killing THREE TIMES more (7.6 against 2.4)
     * when what it had was fresher corpses.
     *
     * Counted at the door instead. `foeKilled` is cumulative and monotone;
     * `foeStanding` is what is left alive, which is the census this used to be
     * confused with, kept because it is a real and different question.
     */
    foeKilled: killed.n,
    foeDown: world.enemies.filter((e) => e.dead).length,
    foeAlive: world.enemies.filter((e) => !e.dead).length,
    /* AND THE NERVE OF THE LINE, averaged over the squads that still exist.
     * §10 says `JEDI_NEAR` pins every record at 1.000 in four seconds while
     * the player stands in the formation, which — if it is still true — is
     * exactly the mechanism this whole step is asking about, so it is measured
     * rather than assumed. */
    morale: +avgMorale(d).toFixed(3),
    broken: avgMorale.broken,
    jediHeals: input.tally ? input.tally.heals : null,
    jediSwings: input.tally ? input.tally.swings : null,
    jediPushes: input.tally ? input.tally.pushes : null,
    jediDownAt: input.tally ? input.tally.downAt : null,
  };
  world.unload?.();
  return out;
}

/**
 * THE NERVE OF WHAT IS LEFT OF THE LINE.
 *
 * `t.morale` on the trooper record is where the ledger actually lives —
 * `CommandDirector.shake` writes it and `_troops` drives it per second — so it
 * is read off the record rather than off a squad object that does not hold it.
 *
 * This number is here because §10 says the presence term is BROKEN in exactly
 * the condition this step measures: "`JEDI_NEAR` +0.085/s pins every record at
 * 1.000 in four seconds while you stand among them." If that is still true then
 * both player arms will read 1.000 and the no-player arm will not, and the
 * morale column of the verdict is measuring a saturated term rather than a
 * mechanic. Better to see it saturate than to leave it out.
 */
function avgMorale(d) {
  let sum = 0, n = 0, broken = 0;
  for (const c of d.commanders || [d.commander]) {
    for (const t of c.roster.living) {
      if (typeof t.morale !== 'number') continue;
      sum += t.morale; n++;
      if (t.broken) broken++;
    }
  }
  avgMorale.broken = broken;
  return n ? sum / n : 0;
}

async function step2() {
  const seeds = String(flag('seeds', '3,5,7,11')).split(',').map(Number);
  const engagements = Number(flag('engagements', '3'));
  const rows = [];
  for (const seed of seeds) {
    for (const arm of ARMS) {
      const r = await runArm(arm, seed, engagements);
      rows.push(r);
      /* WRITTEN AFTER EVERY ROW. Fifteen real Command worlds on a contended box
       * is over an hour, and a probe that only writes at the end is a probe
       * whose whole run is lost to one timeout - which happened once here. */
      write('step2-partial.json', { rows });
      console.log(`  seed ${String(seed).padStart(3)}  ${arm.padEnd(5)}  `
        + `fallen ${String(r.fallen).padStart(2)}  standing ${String(r.standing).padStart(2)}  `
        + `waves ${r.waveClears}  areas ${r.areasTaken}  foeKilled ${String(r.foeKilled).padStart(3)}  `
        + `bladeDmg ${String(r.bladeDamage ?? '—').padStart(7)}  morale ${r.morale}  `
        + `${(r.wallMs / 1000).toFixed(0)}s`);
    }
  }

  /* ── THE VERDICT, computed rather than eyeballed.
   *
   * The axis is FLAGSHIP's: `fallen` and areas taken. `fallen` is the one that
   * moves at this length — three engagements inside area one cannot take more
   * than one area — so the position of DEAD between NONE and BLADE is reported
   * on the mean fallen across seeds, as a fraction:
   *
   *     0.0 = exactly where NONE sits      1.0 = exactly where BLADE sits
   *
   * A denominator that is small compared with the spread between seeds means
   * the three arms are indistinguishable, which is its own answer and is
   * reported as such rather than being turned into a fraction of noise. */
  const mean = (arm, k) => {
    const v = rows.filter((r) => r.arm === arm).map((r) => r[k]);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  const sd = (arm, k) => {
    const v = rows.filter((r) => r.arm === arm).map((r) => r[k]);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1));
  };
  const verdict = {};
  for (const k of ['fallen', 'areasTaken', 'foeKilled', 'waveClears', 'morale', 'gameSeconds']) {
    const none = mean('none', k), blade = mean('blade', k), dead = mean('dead', k);
    const far = mean('far', k);
    const span = blade - none;
    verdict[k] = {
      none: +none.toFixed(2), blade: +blade.toFixed(2), dead: +dead.toFixed(2),
      far: +far.toFixed(2),
      sdNone: +sd('none', k).toFixed(2), sdBlade: +sd('blade', k).toFixed(2),
      sdDead: +sd('dead', k).toFixed(2), sdFar: +sd('far', k).toFixed(2),
      /* WHERE `far` SITS ON THE SAME AXIS, and it is the number the fourth arm
       * was added for: near 1 means a Jedi a hundred metres away costs the line
       * what a Jedi standing in it costs, so PRESENCE is not the mechanism;
       * near 0 means it is. */
      farPosition: Math.abs(span) < 1e-9 ? null : +((far - none) / span).toFixed(2),
      position: Math.abs(span) < 1e-9 ? null : +((dead - none) / span).toFixed(2),
      nearer: Math.abs(span) < 1e-9 ? 'arms are identical'
        : (Math.abs(dead - blade) < Math.abs(dead - none) ? 'BLADE' : 'NONE'),
    };
  }
  const out = { step: 2, seeds, engagements, rows, verdict };
  const f = write('step2.json', out);
  console.log('\n' + JSON.stringify(verdict, null, 2));
  console.log('\nwrote', f);
}

/* ══════════════════════════════════════════════════════════════════════ */

if (CMD === 'step0') await step0();
else if (CMD === 'step1') await step1();
else if (CMD === 'step2') await step2();
else { console.error('usage: _flagship.mjs step0|step1|step2'); process.exit(2); }

/* Exported so `tools/_frontshot.mjs` and any future check can dress a world the
 * same way this one does rather than holding a second copy of the schedule. */
export { marchFront, frontAt, strewWrecks, dutyInput, drive, THREE };
