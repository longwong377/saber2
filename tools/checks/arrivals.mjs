/**
 * BATTLEFRONT BORZ — enemies must not pop into existence.
 *
 * The whole of how a body got into the game was two lines in
 * `WaveDirector.update`:
 *
 *     const pos = ctx.pickSpawn(type);
 *     const e = ctx.spawnEnemy(type, pos);
 *
 * `pickSpawn` rolls a point on a ring 34–56 m out, checks it is in bounds and
 * not on a slope, and hands it back. Nothing flew in, nothing opened, nothing
 * walked over a rise: a droid was not there, and then it was. Measured on the
 * dunes at wave 4, on the code this replaces:
 *
 *     10 bodies spawned, 10 of them with 0.00 s of warning
 *     nothing in the scene existed at the spawn point before the spawn
 *     minimum distance from the player: 38 m, i.e. inside the ring the
 *       level itself calls "far away", with no travel and no announcement
 *
 * The replacement is src/game/Arrivals.js, and it has ONE property. Everything
 * below measures that property rather than the specific vehicles, because the
 * vehicles will change and the property must not:
 *
 *     NOTHING IS DELIVERED NEAR THE PLAYER UNLESS SOMETHING THE PLAYER COULD
 *     SEE HAS BEEN STANDING WHERE IT ARRIVES FOR AT LEAST `ARRIVAL_LEAD`
 *     SECONDS FIRST — or it is delivered from beyond `MARCH_RADIUS` times the
 *     level's own spawn ring and walks the whole way in.
 *
 * `deliveryIsAnnounced` is that sentence as a function, exported from the game
 * rather than retyped here, so a new arrival kind is answerable to it too.
 */

import * as THREE from 'three';
import { WaveDirector } from '../../src/game/Waves.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { DIFFICULTY } from '../../src/game/Combat.js';
import {
  ArrivalDirector, ARRIVAL_LEAD, MARCH_RADIUS, MAX_CONCURRENT,
  ARRIVAL_BY_TERRAIN, arrivalKindFor, capacityOf, deliveryIsAnnounced,
} from '../../src/game/Arrivals.js';
import { clocked } from './_shared.mjs';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** A world with the fields an arrival and the director actually read. */
function fakeWorld(levelKey) {
  const L = LEVELS[levelKey];
  const scene = new THREE.Scene();
  const w = {
    scene, statics: [], enemies: [], level: L, difficulty: DIFFICULTY.knight,
    settings: {}, groundColor: 0xcfae82, takenBoons: { has: () => false, add() {} },
    terrain: { height: () => 0, inBounds: () => true, slopeAt: () => 0 },
    player: { position: V(0, 0, 0) }, particles: null,
    spawnEnemy(type, pos) {
      // Enough of an Enemy for `applyModifier` to run on: the wave path
      // promotes elites from wave 3 onward, and a fixture that cannot survive
      // one would be silently testing plain waves only.
      const e = {
        type, position: pos.clone(), dead: false, velocity: new THREE.Vector3(),
        grounded: true, facing: 0, A: ARCHETYPES[type], hp: 1, maxHp: 1,
        speed: 1, attackDamage: 1, world: w, mod: null, bornAt: w.clock,
        rig: null, group: null, weapon: null, saber: null, duel: null, built: {},
        shieldCentre: (out = new THREE.Vector3()) => out.copy(pos).setY(pos.y + 1),
      };
      w.enemies.push(e);
      return e;
    },
    clock: 0, notify() {}, report() {},
  };
  return w;
}

/** Play a whole wave headlessly, killing bodies as they land so it drains. */
function playWave(levelKey, wave = 4, seconds = 120) {
  const w = fakeWorld(levelKey);
  const d = new WaveDirector(w, { mode: 'roguelite', pool: LEVELS[levelKey].pool });
  d.start(wave);
  const ctx = {
    enemies: w.enemies, particles: null, terrain: w.terrain,
    pickSpawn: () => V(40, 0, 0), spawnEnemy: (t, p) => w.spawnEnemy(t, p),
  };
  const dt = 1 / 60;
  let t = 0, peakLive = 0;
  while (t < seconds && (d.active || d.arrivals.pending)) {
    d.update(dt, ctx);
    t += dt; w.clock = t;
    peakLive = Math.max(peakLive, d.arrivals.flights.filter(f => !f.done).length);
    for (const e of w.enemies) e.dead = true;         // clear the pad
  }
  return { w, d, seconds: t, log: d.arrivals.log.slice(), peakLive,
    ring: LEVELS[levelKey].spawnRadius?.[1] ?? 56 };
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  check('arrivals: nothing is delivered without being announced first', () => {
    // THE PROPERTY. On the old code every delivery had a lead of exactly 0 and
    // sat inside the level's own ring, which is the definition of popping in.
    const rows = [];
    // Enumerated, not named. A hand-written list is how a check keeps testing
    // levels that have been deleted and stops testing the ones that replaced
    // them — three of the five named here no longer exist.
    for (const key of LEVEL_ORDER) {
      /* DEEPEN UNTIL THERE IS A WAVE TO MEASURE, rather than asserting that
       * wave 4 is one everywhere.
       *
       * A wave is a THREAT BUDGET, not a headcount, and the Colosseum's pool is
       * large creatures — a 1250 hp reek eats most of an early wave on its own,
       * so its wave 4 delivers three bodies where a droid level's delivers
       * eight. That is the level working, and the check flapped on it: the
       * composition is drawn by seed, so some runs bought four small things and
       * some bought three big ones, and a suite that fails at random teaches
       * everyone to re-run rather than to read.
       *
       * Going deeper is strictly stronger than lowering the bar to three: the
       * property under test is that nothing arrives unannounced, and it is now
       * tested on a wave with more bodies in it, not fewer. */
      let r = playWave(key);
      for (let wave = 6; r.log.length < 4 && wave <= 12; wave += 2) r = playWave(key, wave);
      assert(r.log.length >= 4,
        `${key}: only ${r.log.length} bodies arrived in ${r.seconds.toFixed(0)} s even at wave 12 — `
        + 'the wave did not run');
      const bad = r.log.filter(l => !deliveryIsAnnounced(l, r.ring));
      assert(bad.length === 0,
        `${key}: ${bad.length} of ${r.log.length} bodies appeared with no warning — worst was a `
        + `${bad[0]?.kind} delivering ${bad[0]?.type} after ${bad[0]?.lead.toFixed(2)} s at `
        + `${bad[0]?.dist.toFixed(0)} m (needs ${ARRIVAL_LEAD} s or ${(r.ring * MARCH_RADIUS).toFixed(0)} m)`);
      const lead = Math.min(...r.log.map(l => l.lead));
      const dist = Math.min(...r.log.map(l => l.dist));
      rows.push(`${key} ${r.log.length} bodies, min lead ${lead.toFixed(2)} s, min range ${dist.toFixed(0)} m`);
    }
    return rows.join('; ');
  });

  check('arrivals: every level type has a way of bringing enemies in', () => {
    // A level whose terrain is not in the table falls through to `march`,
    // which is honest but is not a set piece. Every level actually in LEVELS
    // has to have been thought about.
    const missing = [];
    for (const [key, L] of Object.entries(LEVELS)) {
      if (L.training) continue;                       // the dojo conjures its own
      if (!ARRIVAL_BY_TERRAIN[L.terrain]) missing.push(`${key} (terrain '${L.terrain}')`);
    }
    assert(missing.length === 0,
      `${missing.length} shipping level(s) have no arrival for their terrain: ${missing.join(', ')}`);
    // and the two set pieces must both be reachable, not merely declared
    const kinds = new Set(Object.values(ARRIVAL_BY_TERRAIN).flat());
    for (const need of ['dropship', 'gate', 'march']) {
      assert(kinds.has(need), `no level ever produces a '${need}' arrival`);
    }
    return Object.entries(ARRIVAL_BY_TERRAIN)
      .map(([t, k]) => `${t}: ${k.join('/')}`).join(', ');
  });

  check('arrivals: an interior gets a door, an open sky gets a ship', () => {
    /* The one thing an arrival cannot do is be impossible. A gunship inside a
     * roofed foundry, or a free-standing sally port in the middle of an open
     * erg, is worse than the pop it replaced.
     *
     * OVER EVERY LEVEL, not three named ones. This used to run on the dune
     * sea, the arena and Hangar Bay Nine; two of those were deleted at the
     * player's request, and naming levels was the weaker form of the question
     * anyway — the property is about whether a level HAS A SKY, which every
     * level states, so every level can be asked. Nine levels are covered here
     * where three were, and a new one cannot be added without answering it.
     *
     * ── ONE WAVE WAS NOT A SAMPLE, and it took a level being ADDED to show it.
     *
     * `arrivalKindFor` draws from the terrain's own weighted list, and three
     * levels weight it `['march', 'march', 'dropship']` — a one-in-three draw,
     * against a wave that delivers about eight bodies of which the heavies march
     * regardless. So "did this level ever fly a ship" was a coin flip that had
     * been landing heads. Adding an eighth level to LEVEL_ORDER moved the phase
     * of the shared arrival stream and the Drowned Wood — untouched, correct,
     * and passing for a year — started failing.
     *
     * That is HANDOFF §6.2's order-independence residue in its purest form: a
     * check that passes because it has margin rather than because the property
     * holds. The fix is the one this file's FIRST check already argues for —
     * take a bigger sample rather than lower the bar, because the property under
     * test is unchanged and is now actually being tested. Waves are accumulated
     * until the level has delivered enough bodies for a one-in-three draw to be
     * a statement instead of a guess: at 24 deliveries, missing a 1/3 kind
     * entirely is a 1-in-73,000 event.
     */
    const seen = {}, rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L || L.training) continue;
      const log = [];
      for (let wave = 4; log.length < 24 && wave <= 16; wave += 2) {
        log.push(...playWave(key, wave).log);
      }
      const r = { log };
      const kinds = [...new Set(r.log.map(l => l.kind))].sort();
      seen[key] = kinds;
      const roofed = L.atmosphere.sky === false;
      // A walled bowl has a sky and still cannot take a ship, so "no dropship"
      // is asserted off the level's own arrival table rather than off the sky.
      const table = ARRIVAL_BY_TERRAIN[L.terrain] || ['march'];
      if (!table.includes('dropship')) {
        assert(!kinds.includes('dropship'),
          `a dropship flew into ${key}, which has no sky to fly it through (kinds: ${kinds.join(', ')})`);
        assert(kinds.includes('gate') || kinds.includes('march'),
          `${key} never opened a gate or marched anything in (kinds: ${kinds.join(', ')})`);
      } else {
        assert(!roofed, `${key} is roofed and its arrival table still lists a dropship`);
        assert(kinds.includes('dropship'),
          `open ${key} never once used a dropship (kinds seen: ${kinds.join(', ')})`);
      }
      rows.push(`${key}: ${kinds.join('+')}`);
    }
    const anyGate = Object.values(seen).some((k) => k.includes('gate'));
    const anyShip = Object.values(seen).some((k) => k.includes('dropship'));
    assert(anyGate && anyShip, 'the game no longer produces both set pieces');
    assert(rows.length >= 6, `only ${rows.length} levels exercised`);
    return rows.join(', ');
  });

  check('arrivals: something too big for a ship walks in', () => {
    /*
     * THIS CHECK COULD NOT FAIL, and one of the five levels it named does not
     * exist.
     *
     * `arrivalKindFor` opens with `if (walksIn(A)) return 'march';`, and
     * `walksIn` is `A.big || A.boss`. The walker is `big` and the acklay is
     * `boss`, so the function returned before the level was ever read — the
     * loop over five level keys contributed nothing, and it would have passed
     * against `null`, against `{}`, and as it did against
     * `LEVELS['arena'] === undefined`, since `arena` was deleted with the
     * Sanctum. The `|| ['march']` on the line after would have swallowed the
     * dead key even if the branch HAD been reached. Its summary line claimed
     * "on every level type", which is the one thing it did not test.
     *
     * So it now asserts both halves, and the levels are enumerated rather than
     * typed (§2.3), which is also what stops a deleted key getting in again:
     *
     *   a body that walks in walks in EVERYWHERE — the property as written;
     *   a body that does NOT walk in arrives some other way SOMEWHERE, which
     *   is what makes the first half a fact about `walksIn` rather than a
     *   restatement of the early return.
     */
    const walkers = Object.keys(ARCHETYPES).filter((t) => ARCHETYPES[t].big || ARCHETYPES[t].boss);
    const carried = Object.keys(ARCHETYPES).filter((t) => !ARCHETYPES[t].big && !ARCHETYPES[t].boss);
    assert(walkers.length >= 2, `only ${walkers.length} bodies are too big for a ship`);
    assert(carried.length >= 2, `only ${carried.length} bodies can be carried`);

    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      assert(L, `LEVEL_ORDER names '${key}' and LEVELS has no such level`);
      for (const type of walkers) {
        const kind = arrivalKindFor(L, ARCHETYPES[type], () => 0.5);
        assert(kind === 'march', `${type} arrives by ${kind} on ${key}`);
      }
    }

    // The other half: over every level and every carried body, at least one
    // arrival is NOT a march. Without this the check above is satisfied by an
    // `arrivalKindFor` that returns 'march' unconditionally.
    const other = new Set();
    for (const key of LEVEL_ORDER) {
      for (const type of carried) {
        for (const roll of [0.1, 0.5, 0.9]) {
          const kind = arrivalKindFor(LEVELS[key], ARCHETYPES[type], () => roll);
          if (kind !== 'march') other.add(kind);
        }
      }
    }
    assert(other.size > 0,
      'every body on every level arrives by marching — `arrivalKindFor` is answering before it reads '
      + 'the level, which is exactly what made the previous version of this check unfailable');

    return `${walkers.length} bodies march in on all ${LEVEL_ORDER.length} levels; `
      + `${carried.length} carried bodies also arrive by ${[...other].sort().join('/')}`;
  });

  check('arrivals: a squad rides in together instead of one ship each', () => {
    // Capacity is the difference between a landing and a taxi rank. If every
    // body opened its own flight, the sky would be a queue of gunships and the
    // concurrency cap would throttle the wave to a trickle.
    assert(capacityOf('dropship') >= 3, `a dropship carries ${capacityOf('dropship')}`);
    assert(capacityOf('gate') >= 3, `a gate passes ${capacityOf('gate')} at a time`);
    // Aggregated over several waves so this is measuring the mechanism rather
    // than one lucky composition.
    const byKind = {};
    const ships = new Set();
    let shipDeliveries = 0, peak = 0;
    for (const wave of [4, 6, 8, 10]) {
      const r = playWave('drifts', wave);
      peak = Math.max(peak, r.peakLive);
      for (const l of r.log) {
        byKind[l.kind] = (byKind[l.kind] || 0) + 1;
        if (l.kind === 'dropship') { shipDeliveries++; ships.add(l.flight); }
      }
    }
    assert(ships.size > 0, 'four waves on the erg produced no dropship at all');
    const perShip = shipDeliveries / ships.size;
    assert(perShip > 1.4,
      `${shipDeliveries} bodies came off ${ships.size} gunships — ${perShip.toFixed(2)} each, `
      + 'which is a taxi rank, not a landing');
    assert(peak <= MAX_CONCURRENT,
      `${peak} arrivals were live at once against a cap of ${MAX_CONCURRENT}`);
    return `waves 4–10 on the dunes: ${JSON.stringify(byKind)}; ${perShip.toFixed(2)} bodies per `
      + `gunship, never more than ${peak} arrival(s) in flight`;
  });

  check('arrivals: a wave is not clear while a ship is still on final approach', () => {
    // `alive === 0 && !spawnQueue.length` ended the wave. Bodies in transit
    // are in neither list, so a wave could be declared clear with a full
    // gunship thirty metres up, and the HUD would read 0 remaining.
    const w = fakeWorld('dunes');
    const d = new WaveDirector(w, { mode: 'roguelite', pool: LEVELS.drifts.pool });
    d.start(3);
    const ctx = { enemies: w.enemies, particles: null, terrain: w.terrain,
      pickSpawn: () => V(40, 0, 0), spawnEnemy: (t, p) => w.spawnEnemy(t, p) };
    // run until everything queued is in the air but nothing has landed
    let t = 0, sawTransit = false;
    while (t < 20) {
      d.update(1 / 60, ctx); t += 1 / 60;
      for (const e of w.enemies) e.dead = true;
      if (!d.spawnQueue.length && d.arrivals.pending > 0) {
        sawTransit = true;
        assert(d.active,
          `the wave went inactive with ${d.arrivals.pending} bodies still in transit`);
        assert(d.remaining >= d.arrivals.pending,
          `the HUD reads ${d.remaining} remaining with ${d.arrivals.pending} bodies inbound`);
      }
    }
    assert(sawTransit, 'the fixture never reached a state with bodies in transit, so it proves nothing');
    return 'a wave with bodies in the air stays active and counts them as remaining';
  });

  check('arrivals: the wave path no longer spawns anything directly', async () => {
    // The source form, because the behavioural checks above can only see what
    // the director happens to do on the seeds it runs. A future edit that puts
    // `ctx.spawnEnemy` back on the hot path would pass every one of them.
    const { readFile } = await import('node:fs/promises');
    const src = (await readFile(new URL('../../src/game/Waves.js', import.meta.url), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const i = src.indexOf('  update(dt, ctx) {');
    assert(i > 0, 'WaveDirector.update is gone');
    const body = src.slice(i, src.indexOf('\n  get remaining', i));
    assert(/this\.arrivals\.request\(/.test(body),
      'the wave path does not go through the arrival director at all');
    const direct = [...body.matchAll(/ctx\.spawnEnemy\(/g)];
    assert(direct.length <= 1,
      `the wave path calls ctx.spawnEnemy directly ${direct.length} times — an arrival is optional`);
    assert(/arrivals\.request\([^)]*\)\s*\)\s*\{/.test(body.replace(/\n/g, ' ')) || /if \(!this\.arrivals\.request/.test(body),
      'the direct spawn is not guarded by the arrival declining the request');
    return 'every wave body is requested from the arrival director; the direct call is the fallback only';
  });

  check('arrivals: the sandbox arrives from somewhere, and its instant room is a choice', () => {
    /**
     * THIS CHECK USED TO ASSERT THE OPPOSITE, and the correction is worth
     * leaving in rather than quietly rewriting.
     *
     * It read `assert(d.arrivals.enabled === false, 'the sandbox is queueing
     * bodies behind arrivals')`, under the comment "a debug room whose whole
     * point is twenty bodies in three seconds must not wait for three
     * gunships" — which is the same defence `WaveDirector`'s own constructor
     * used to carry, written by the same hand, agreeing with itself.
     *
     * Player note #17 is about exactly that room: "even in training mode or in
     * ANY MODE, the enemies should not materialize in front of you they should
     * arrive from somewhere not teleport behind you." The sandbox is where a
     * player spends the longest watching bodies enter the world — it is the mode
     * you sit in and dial the count up and down — so it was the worst possible
     * place to keep the one path that pops them into existence at eleven metres.
     *
     * The fast path is not deleted. It is `settings.instantSpawn`, and the whole
     * of the change is which way round the default is. Both halves are asserted
     * here so neither can drift: the room arrives by default, AND the instant
     * room still exists for anybody who wants it.
     */
    const w = fakeWorld('dunes');
    const d = new WaveDirector(w, { mode: 'sandbox', pool: ['b1'] });
    assert(d.arrivals.enabled === true,
      'the sandbox still teleports bodies in front of the player — see note #17');
    assert(d.arrivals.request('b1') === true,
      'the sandbox director refused an arrival request, so its bodies have nowhere to come from');

    const fast = fakeWorld('dunes');
    fast.settings = { instantSpawn: true };
    const df = new WaveDirector(fast, { mode: 'sandbox', pool: ['b1'] });
    assert(df.arrivals.enabled === false,
      'settings.instantSpawn did not reach the arrival director, so the fast path is unreachable');
    assert(df.arrivals.request('b1') === false,
      'a disabled arrival director accepted a request, so the caller will never spawn directly');

    /* …and the same setting reaches the WAVE path, which is the half a
     * sandbox-only test would miss: a player who has asked for instant spawns
     * has asked for them everywhere, and a mode that half-honoured it would be
     * two behaviours behind one switch. */
    const wr = fakeWorld('dunes');
    wr.settings = { instantSpawn: true };
    const dr = new WaveDirector(wr, { mode: 'roguelite', pool: ['b1'] });
    assert(dr.arrivals.enabled === false, 'instantSpawn is honoured in the sandbox and ignored in a wave');
    return 'default: the sandbox arrives; instantSpawn: direct and immediate, in every mode';
  });

  check('arrivals: an arrival leaves nothing behind in the scene', () => {
    // Every geometry and material is shared at module scope and the director
    // parks its one group in `world.statics`, which is the list World.unload
    // empties. So a level that ends mid-landing costs one scene removal, not a
    // leak per ship.
    const w = fakeWorld('dunes');
    const before = w.scene.children.length;
    const d = new WaveDirector(w, { mode: 'roguelite', pool: LEVELS.drifts.pool });
    assert(w.scene.children.length === before + 1,
      `the arrival director added ${w.scene.children.length - before} objects to the scene root`);
    assert(w.statics.includes(d.arrivals.group),
      'the arrival group is not in world.statics, so World.unload will not remove it');
    d.start(4);
    const ctx = { enemies: w.enemies, particles: null, terrain: w.terrain,
      pickSpawn: () => V(40, 0, 0), spawnEnemy: (t, p) => w.spawnEnemy(t, p) };
    for (let t = 0; t < 60; t += 1 / 60) {
      d.update(1 / 60, ctx);
      for (const e of w.enemies) e.dead = true;
    }
    const held = d.arrivals.group.children.length;
    assert(held <= MAX_CONCURRENT,
      `${held} finished arrivals are still parented into the scene after the wave drained`);
    d.arrivals.dispose();
    assert(w.scene.children.length === before,
      `disposing the director left ${w.scene.children.length - before} object(s) in the scene`);
    return `one group in the scene and in world.statics; ${held} live child/children after a `
      + 'full wave; dispose returns the scene to where it started';
  });
}
