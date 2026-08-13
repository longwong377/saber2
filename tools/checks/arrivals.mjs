/**
 * SABER — enemies must not pop into existence.
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
  check('arrivals: nothing is delivered without being announced first', () => {
    // THE PROPERTY. On the old code every delivery had a lead of exactly 0 and
    // sat inside the level's own ring, which is the definition of popping in.
    const rows = [];
    // Enumerated, not named. A hand-written list is how a check keeps testing
    // levels that have been deleted and stops testing the ones that replaced
    // them — three of the five named here no longer exist.
    for (const key of LEVEL_ORDER) {
      const r = playWave(key);
      assert(r.log.length >= 4,
        `${key}: only ${r.log.length} bodies arrived in ${r.seconds.toFixed(0)} s — the wave did not run`);
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
     * where three were, and a new one cannot be added without answering it. */
    const seen = {}, rows = [];
    for (const key of LEVEL_ORDER) {
      const L = LEVELS[key];
      if (!L || L.training) continue;
      const r = playWave(key);
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
    // A spider walker does not fit in a gunship and an acklay does not queue
    // at a door. Both walk, from beyond the ring, on every level.
    for (const key of ['drifts', 'arena', 'foundry', 'mustafar', 'temple']) {
      for (const type of ['walker', 'beast']) {
        const kind = arrivalKindFor(LEVELS[key], ARCHETYPES[type], () => 0.5);
        assert(kind === 'march', `${type} arrives by ${kind} on ${key}`);
      }
    }
    return 'walker and acklay march in on every level type';
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

  check('arrivals: the sandbox keeps its instant room', () => {
    // A debug room whose whole point is twenty bodies in three seconds must
    // not wait for three gunships.
    const w = fakeWorld('dunes');
    const d = new WaveDirector(w, { mode: 'sandbox', pool: ['b1'] });
    assert(d.arrivals.enabled === false, 'the sandbox is queueing bodies behind arrivals');
    assert(d.arrivals.request('b1') === false,
      'a disabled arrival director accepted a request, so the caller will never spawn directly');
    return 'sandbox spawns stay direct and immediate';
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
