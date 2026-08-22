/**
 * BATTLEFRONT BORZ — HOW WIDE THE OPEN WINDOW CAN BE MADE, AND WHAT BOUNDS IT.
 *
 *   node --import ./tools/register.mjs tools/_openwin.mjs [--seeds 3,5] [--arm grip]
 *
 * `tools/_open.mjs` measured FLAGSHIP §7's third verb and found 0.90% of enemy
 * body-seconds, `held` alone at 0.513%, with a Jedi gripping continuously. Its
 * own conclusion names the bound: the WINDOW. One pair of hands holds one body
 * out of a field of forty, and the choke kills that body in four and a half
 * seconds.
 *
 * This probe exists to answer the question that comes next and had never been
 * asked: **the recorded arm only ever GRIPPED.** `_open.mjs`'s grip arm wraps
 * `dutyInput`, which pushes on a four-second cadence and does nothing else with
 * the Force — no pull, no unleash — and `dutyInput`'s own note says why ("every
 * one of those is a decision, and a script that makes them is a script whose
 * author has decided the answer"). That is the right call for the Dead Jedi
 * test and the wrong one for this measurement: `yanked` reads EXACTLY 0.000%
 * across every run on record, and `yanked` is the state a cone of bodies
 * enters at once, at seventeen to thirty-four metres, for sixteen Force.
 *
 * So the arms here are about the FORCE BAR and not about the hands:
 *
 *   grip    the recorded baseline — hold a body whenever the bar allows.
 *   pull    never grips. Pulls whenever anything is in the cone and unleashes
 *           when a crowd is inside its radius. The two things in the kit that
 *           open MORE THAN ONE body per press.
 *   press   both, with the grip taking whatever the other two leave.
 *
 * All three are CEILINGS rather than playstyles: a player who spends every
 * point of Force on the verb and none of it on anything else.
 *
 * THE FIRST READING OF `press` IS WHY `pull` EXISTS AS A SEPARATE ARM. Seed 3,
 * one engagement: 616 Force spent, and **5 pulls and 1 unleash in the whole
 * battle**. The grip runs continuously and eats the regen, so a Jedi who holds
 * cannot afford to pull — the two verbs are not additive, they are rivals for
 * one bar. Measuring them together measures the grip.
 *
 * Both arms keep `dutyInput`'s swing, guard, station-holding and keep-alive, so
 * the only thing that moves between them is what the Force is spent on.
 *
 * ── WHAT IT COUNTS ───────────────────────────────────────────────────────
 *
 * The same accounting as `_open.mjs`, for the same reasons, and read through
 * Combat.js's own `openState` rather than by testing `gripped`/`yankT`/
 * `toppled` here (HANDOFF §2.4 — an instrument that restates a rule ends up
 * disagreeing with it, and this one would disagree in the direction that
 * flatters the verb). Hostile bodies only: in Command your own line stands in
 * `world.enemies`, and counting it would answer a different question with a
 * bigger number.
 *
 * It adds ONE thing `_open.mjs` does not have, and it is the number that
 * decides whether the window can be widened at all: **what the bar buys.**
 * `Player._spend` is wrapped, so every point of Force that actually left the
 * pool is counted, and the ratio of open-body-seconds to Force spent is the
 * exchange rate. A battle is about 220 s long and the pool refills at 7.5/s
 * from a cap of 100, so a Jedi has roughly 1,750 Force to spend in one and
 * about 4,700 hostile body-seconds to spend it on. Any mechanism that opens
 * bodies out of that pool is bounded by that ratio and by nothing else, which
 * is why the exchange rate is printed next to the share.
 */

import './dom-shim.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootWorld } from './checks/_coop.mjs';
import { dutyInput } from './_flagship.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = resolve(ROOT, '.flagship');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

/** `_flagship.mjs`'s step, for the reason its own note gives. */
const STEP = 1 / 30;
const CAP = 220;

async function commandWorld(seed) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed, difficulty: 'knight' },
  });
  world.director.start(1);
  return world;
}

/**
 * THE TWO ARMS, AND BOTH ARE CEILINGS RATHER THAN PLAYSTYLES.
 *
 * `grip` is `_open.mjs`'s arm, copied in behaviour and not in code: retake the
 * moment the last body dies or is dropped, at half-second intervals.
 *
 * `press` spends the bar on the verb. The order of preference is the order of
 * what a point of Force buys in open-body-seconds, which is the whole argument
 * of this probe — a pull reaches a cone at range and takes everything in it, an
 * unleash reaches a circle but only at arm's length, and a grip takes one body.
 * Nothing here aims: `Player` reads `aimDir` off the camera and `dutyInput`
 * already points the camera at the nearest hostile, so the cone is pointed
 * wherever the script was already looking.
 */
function fitArm(arm, world, input) {
  const tick = input.tick;
  const baseHit = input.actHit;
  const want = new Set();
  const tally = { takes: 0, pulls: 0, unleashes: 0, heldSeconds: 0 };
  /* WRAPPED, NOT REPLACED. `dutyInput`'s own `actHit` reads a set its `tick`
   * clears every frame, and assigning over it deletes the script's swings —
   * which would make these arms a measurement of a Jedi who uses the Force
   * INSTEAD of fighting rather than one who does both. */
  input.actHit = (id) => want.has(id) || baseHit(id);
  let re = 0, pullT = 0;
  input.tick = (dt) => {
    tick(dt);
    want.clear();
    const p = world.player;
    if (!p || !p.alive) return;
    const holding = !!(p.gripEnemy && !p.gripEnemy.dead);
    if (holding) tally.heldSeconds += dt;

    if (arm === 'press' || arm === 'pull') {
      /* THE PULL FIRST, because it is the only thing in the kit that opens
       * more than one body per press. Gated on the shipped cooldown and on
       * the shipped price rather than on a cadence of this file's own, so
       * what it measures is what the bar can afford. */
      pullT -= dt;
      if (pullT <= 0 && p.cooldowns.pull <= 0 && p._canSpend(16)) {
        /* Only when something is actually in the cone — `forcePull` spends
         * whether or not it finds a body, and a probe that paid for empty
         * pulls would be measuring the script's aim. */
        const range = 17 * Math.sqrt(p.forceScale);
        let n = 0;
        for (const e of world.enemies) {
          if (e.dead || e.team === p.team) continue;
          const dx = e.position.x - p.chest.x, dz = e.position.z - p.chest.z;
          const d = Math.hypot(dx, dz);
          if (d > range || d < 1.5) continue;
          if ((dx * p.aimDir.x + dz * p.aimDir.z) / Math.max(d, 1e-6) < 0.72) continue;
          n++;
        }
        if (n > 0) { want.add('pull'); tally.pulls++; pullT = 0.65; }
      }
      /* AND THE PANIC BUTTON, when a crowd is inside it. 52 Force is most of
       * a bar, so this fires rarely and that is the point of pricing it. */
      if (p.cooldowns.unleash <= 0 && p._canSpend(52)) {
        let n = 0;
        for (const e of world.enemies) {
          if (e.dead || e.team === p.team) continue;
          if (e.position.distanceTo(p.position) <= 11) n++;
        }
        if (n >= 3) { want.add('unleash'); tally.unleashes++; }
      }
    }

    /* THE GRIP, in the gaps. Last, because it is the one that takes a single
     * body and it must not spend the bar the pull needs. */
    if (arm === 'pull') return;
    if (holding) { re = 0; return; }
    re -= dt;
    if (re <= 0) { re = 0.5; want.add('grip'); tally.takes++; }
  };
  return tally;
}

async function runArm(arm, seed, engagements) {
  const { openState, OPEN_STATES } = await import('../src/game/Combat.js');
  const world = await commandWorld(seed);
  const input = dutyInput(world);
  const acts = fitArm(arm, world, input);

  const tally = { enemySeconds: 0, open: {}, hits: 0, openHits: 0, openHitStates: {}, force: 0,
                  census: {}, spare: {} };
  for (const s of OPEN_STATES) { tally.open[s.key] = 0; tally.openHitStates[s.key] = 0; }

  /**
   * THE CENSUS — WHERE THE SECONDS ACTUALLY ARE.
   *
   * `OPEN_STATES` tests three CAUSES (gripped, yanked, toppled-or-stunned).
   * The blade reads a different and longer list for the same idea —
   * `Enemy._guardOpen`, "is this body's guard already beaten", whose own note
   * says it exists so that "an opening the blade honours and the Force does
   * not is two rules" — and neither of them mentions a body that is simply
   * LIMP. A body dropped out of a grip is ragdolled on the floor with
   * `gripped` false, `toppled` false and `stunTimer` zero for the whole of
   * `GET_UP`, and prices at 1.0x while it lies there.
   *
   * So this counts each candidate condition twice: the seconds it holds, and
   * the seconds it holds while `openState` answers NOTHING. The second column
   * is the headroom — what widening the window would actually buy — and it is
   * measured rather than argued.
   */
  const COND = {
    limp: (e) => !!e.actor?.ragdolled,
    airborne: (e) => e.grounded === false,
    knocked: (e) => e.knockTimer > 0,
    disarmed: (e) => !!e.disarmed,
    staggered: (e) => !!e.duel?.staggered,
    locked: (e) => !!e.lock,
    winded: (e) => e.state === 'winded',
    guardOpen: (e) => !!e._guardOpen?.(),
  };
  for (const k of Object.keys(COND)) { tally.census[k] = 0; tally.spare[k] = 0; }

  /* WHAT THE BAR ACTUALLY PAID. `_spend` deducts nothing when it refuses (see
   * the note on the force jump in Player.js), so the only honest place to read
   * a spend is its answer. */
  const p0 = world.player;
  const spend = p0._spend.bind(p0);
  p0._spend = (cost) => {
    const before = p0.force;
    const ok = spend(cost);
    if (ok) tally.force += Math.max(0, before - p0.force);
    return ok;
  };

  const hitTest = world._boltHitTest.bind(world);
  world._boltHitTest = (...a) => {
    const res = hitTest(...a);
    const victim = res && res.victim;
    const side = world.player ? world.player.team : (world.command?.commander?.team ?? 0);
    if (victim && victim.capsules && victim.team !== side) {
      tally.hits++;
      const s = openState(victim);
      if (s) { tally.openHits++; tally.openHitStates[s.key]++; }
    }
    return res;
  };

  const start = world.director.wave;
  const n = Math.round(CAP * engagements / STEP);
  let t = 0;
  for (let i = 0; i < n; i++) {
    input.tick?.(STEP);          // HANDOFF §2.5c — a script that is not ticked is a statue
    world.update(STEP, input);
    t += STEP;
    const mine = world.player ? world.player.team : (world.command?.commander?.team ?? 0);
    for (const e of world.enemies) {
      if (e.dead || e.team === mine) continue;
      tally.enemySeconds += STEP;
      const s = openState(e);
      if (s) tally.open[s.key] += STEP;
      for (const k in COND) {
        if (!COND[k](e)) continue;
        tally.census[k] += STEP;
        if (!s) tally.spare[k] += STEP;
      }
    }
    if (world.director.wave > start + engagements - 1 || world.command.done) break;
  }

  const openSeconds = Object.values(tally.open).reduce((a, b) => a + b, 0);
  const out = {
    arm, seed, gameSeconds: +t.toFixed(1),
    waveClears: world.director.wave - start,
    enemySeconds: +tally.enemySeconds.toFixed(1),
    openSeconds: +openSeconds.toFixed(2),
    openShare: tally.enemySeconds > 0 ? +(openSeconds / tally.enemySeconds).toFixed(5) : 0,
    byState: Object.fromEntries(Object.entries(tally.open).map(([k, v]) =>
      [k, tally.enemySeconds > 0 ? +(v / tally.enemySeconds).toFixed(5) : 0])),
    takes: acts.takes, pulls: acts.pulls, unleashes: acts.unleashes,
    gripSeconds: +acts.heldSeconds.toFixed(1),
    force: Math.round(tally.force),
    /** Open body-seconds bought per point of Force that left the pool. */
    rate: tally.force > 0 ? +(openSeconds / tally.force).toFixed(4) : 0,
    census: Object.fromEntries(Object.entries(tally.census).map(([k, v]) =>
      [k, tally.enemySeconds > 0 ? +(v / tally.enemySeconds).toFixed(5) : 0])),
    spare: Object.fromEntries(Object.entries(tally.spare).map(([k, v]) =>
      [k, tally.enemySeconds > 0 ? +(v / tally.enemySeconds).toFixed(5) : 0])),
    hits: tally.hits, openHits: tally.openHits,
    worthOnHits: tally.hits > 0
      ? +(Object.entries(tally.openHitStates).reduce((sum, [k, c]) =>
          sum + c * ((OPEN_STATES.find((s) => s.key === k)?.mul ?? 1) - 1), 0) / tally.hits).toFixed(5)
      : 0,
  };
  world.unload?.();
  return out;
}

const seeds = String(flag('seeds', '3')).split(',').map(Number);
const arm = flag('arm', 'grip');
const engagements = Number(flag('engagements', '1'));
const tag = flag('tag', arm);
const rows = [];
for (const seed of seeds) {
  const r = await runArm(arm, seed, engagements);
  rows.push(r);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `openwin-${tag}.json`), JSON.stringify({ rows }, null, 2));
  console.log(`  seed ${String(seed).padStart(3)}  ${arm.padEnd(5)}  `
    + `enemy-s ${String(r.enemySeconds).padStart(7)}  open-s ${String(r.openSeconds).padStart(7)}  `
    + `share ${(r.openShare * 100).toFixed(2)}%  `
    + `held ${(r.byState.held * 100).toFixed(2)} yank ${(r.byState.yanked * 100).toFixed(2)} `
    + `down ${(r.byState.downed * 100).toFixed(2)}  `
    + `force ${String(r.force).padStart(5)} rate ${r.rate.toFixed(3)}  `
    + `pulls ${r.pulls} unl ${r.unleashes}  worth +${(r.worthOnHits * 100).toFixed(2)}%`);
}
const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
console.log(`\n  ${arm}  n=${rows.length}  MEAN open share ${(mean((r) => r.openShare) * 100).toFixed(3)}%`
  + `  held ${(mean((r) => r.byState.held) * 100).toFixed(3)}%`
  + `  yanked ${(mean((r) => r.byState.yanked) * 100).toFixed(3)}%`
  + `  downed ${(mean((r) => r.byState.downed) * 100).toFixed(3)}%`
  + `  · Force ${Math.round(mean((r) => r.force))}  rate ${mean((r) => r.rate).toFixed(3)} open-s/Force`
  + `  · worth +${(mean((r) => r.worthOnHits) * 100).toFixed(2)}%`);
console.log('    condition   share of enemy-seconds   of which NOT already open (the headroom)');
for (const k of Object.keys(rows[0]?.census || {})) {
  console.log(`    ${k.padEnd(10)}  ${(mean((r) => r.census[k]) * 100).toFixed(3)}%`
    + `${(mean((r) => r.spare[k]) * 100).toFixed(3).padStart(22)}%`);
}
