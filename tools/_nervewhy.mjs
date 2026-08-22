/**
 * WHY THE HORDE NEVER BREAKS — the nerve budget, decomposed.
 *
 * `NEXT.md` and `tools/checks/break.mjs` both report the same 0.00% of hostile
 * body-seconds broken. Neither says WHERE the budget goes, and there are three
 * candidate answers that want different fixes:
 *
 *   A. nobody is ever inside `NERVE.BLADE_REACH` — the rate never applies;
 *   B. everybody is, in one-second visits, and the rally erases each one before
 *      the next — the rate applies and does not accumulate;
 *   C. they are inside it and they die before eleven seconds are up.
 *
 * So: per hostile body, its whole life — how long it lived, how long it stood
 * inside each radius of a lit blade, in how many separate visits, the longest
 * single visit, and how many of its own side went down where it could see.
 *
 *   node --import ./tools/register.mjs tools/_nervewhy.mjs [--seeds 3,5] [--secs 120]
 */

import './dom-shim.mjs';
import { bootWorld } from './checks/_coop.mjs';
import { dutyInput, drive } from './_flagship.mjs';
import { NERVE, nerveOf } from '../src/game/Nerve.js';
import { MORALE } from '../src/game/Morale.js';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = String(flag('seeds', '3,5')).split(',').map(Number);
const SECS = Number(flag('secs', '120'));
/**
 * WHERE THE JEDI STANDS, and it is the discriminator this probe exists for.
 *
 *   `duty`   — the flagship script: holds station on his own line's centroid,
 *              chases a hostile inside 14 m, leashed to 18 m. What every
 *              published reading of BREAK has been taken under.
 *   `charge` — put bodily on the centroid of the LIVING HORDE every frame,
 *              blade lit, kept alive. Nobody could play this; it is the upper
 *              bound on anything `NERVE.BLADE` can ever pay, because it is the
 *              design sentence taken literally — "walk into the front of a
 *              formation" — with the walking removed.
 */
const ARM = String(flag('arm', 'duty'));
const STEP = 1 / 30;
const RADII = [NERVE.BLADE_REACH, 9, 11, 14, 20, 30];

const q = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

async function run(seed) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed, difficulty: 'knight' },
  });
  world.director.start(1);
  const p = world.player;
  const input = dutyInput(world);

  /* One record per hostile body, keyed by identity. */
  const log = new Map();
  const rec = (e) => {
    let r = log.get(e);
    if (!r) {
      r = {
        life: 0, dwell: RADII.map(() => 0), run: RADII.map(() => 0), best: RADII.map(() => 0),
        visits: RADII.map(() => 0), sawFall: 0, sawMine: 0, minNerve: 1, died: false,
      };
      log.set(e, r);
    }
    return r;
  };

  /* Witnesses, at the door the game already uses. */
  let falls = 0, witnessSum = 0, byPlayer = 0, byPlayerWitness = 0;
  const crowdAtKill = [];
  const kin = world.onEnemyKilled ? world.onEnemyKilled.bind(world) : null;
  world.onEnemyKilled = (e, source, ...rest) => {
    if (p && e.team !== p.team && !e.trooper) {
      falls++;
      const mine = source === p || (source && source.owner === p) || (source && source.isLocal);
      let n = 0;
      for (const o of world.enemies) {
        if (o === e || o.dead || o.team !== e.team) continue;
        const dx = o.position.x - e.position.x, dz = o.position.z - e.position.z;
        if (dx * dx + dz * dz <= NERVE.SEE * NERVE.SEE) { n++; const r = rec(o); r.sawFall++; if (mine) r.sawMine++; }
      }
      witnessSum += n;
      if (mine) {
        byPlayer++; byPlayerWitness += n;
        let c = 0;
        for (const o of world.enemies) {
          if (o.dead || o.team === p.team || o.trooper) continue;
          if (o.position.distanceTo(p.position) <= NERVE.SEE) c++;
        }
        crowdAtKill.push(c);
      }
      const r = log.get(e); if (r) r.died = true;
    }
    return kin ? kin(e, source, ...rest) : undefined;
  };

  /* ── THE BOLT THE JEDI BATTED AWAY, counted at the one door that turns one:
   * `World._onBoltDeflect`. `bolt.owner` is the FIRER and it is read before the
   * call, because `_creditDeflect` rewrites it to the deflector. */
  let deflects = 0;
  const defl = new Map();
  const od = world._onBoltDeflect.bind(world);
  world._onBoltDeflect = (bolt, entry, hit, pt) => {
    const firer = bolt.owner;
    const hostileToDeflector = firer && entry && entry.owner && firer.team !== entry.owner.team;
    if (hostileToDeflector && entry.owner === p) {
      deflects++;
      defl.set(firer, (defl.get(firer) || 0) + 1);
      const r = log.get(firer); if (r) r.deflected = (r.deflected || 0) + 1;
    }
    return od(bolt, entry, hit, pt);
  };

  let hostileSeconds = 0, brokenSeconds = 0, litSeconds = 0;
  const crowd = RADII.map(() => 0);   // hostile-count integral around the player
  drive(world, SECS, input, () => {
    if (ARM === 'charge') {
      let hx = 0, hz = 0, hn = 0;
      for (const e of world.enemies) {
        if (e.dead || e.trooper || e.team === p.team) continue;
        hx += e.position.x; hz += e.position.z; hn++;
      }
      if (hn) {
        p.position.x = hx / hn; p.position.z = hz / hn;
        p.position.y = (world.terrain?.height(p.position.x, p.position.z) ?? 0) + 0.05;
      }
      if (p.saber && p.saber.ignition < 1) { p.saber.ignite?.(); p.saber.ignition = 1; }
      if (p.hp < p.maxHp) p.hp = p.maxHp;
    }
    const blades = world._nerveBlades || [];
    if (blades.length) litSeconds += STEP;
    for (const e of world.enemies) {
      if (e.dead || e.trooper || e.team === p.team) continue;
      const d = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
      for (let i = 0; i < RADII.length; i++) if (d <= RADII[i]) crowd[i] += STEP;
    }
    for (const e of world.enemies) {
      if (e.dead || e.trooper || e.team === p.team) continue;
      hostileSeconds += STEP;
      const r = rec(e);
      r.life += STEP;
      const n = nerveOf(e);
      if (n < r.minNerve) r.minNerve = n;
      if (n < MORALE.BREAK) brokenSeconds += STEP;
      let near = Infinity;
      for (const b of blades) {
        if (b.team === e.team) continue;
        const dx = e.position.x - b.position.x, dz = e.position.z - b.position.z;
        const d = Math.hypot(dx, dz);
        if (d < near) near = d;
      }
      for (let i = 0; i < RADII.length; i++) {
        if (near <= RADII[i]) {
          r.dwell[i] += STEP;
          if (r.run[i] === 0) r.visits[i]++;
          r.run[i] += STEP;
          if (r.run[i] > r.best[i]) r.best[i] = r.run[i];
        } else r.run[i] = 0;
      }
    }
    return false;
  });

  const all = [...log.values()];
  const out = {
    arm: ARM, seed, bodies: all.length, hostileSeconds: +hostileSeconds.toFixed(0),
    brokenPct: +(100 * brokenSeconds / Math.max(1e-9, hostileSeconds)).toFixed(2),
    litPct: +(100 * litSeconds / SECS).toFixed(0),
    falls, witnessesPerFall: +(witnessSum / Math.max(1, falls)).toFixed(2),
    fallsByPlayer: byPlayer,
    witnessesPerPlayerKill: +(byPlayerWitness / Math.max(1, byPlayer)).toFixed(2),
    crowdAtPlayerKill: { mean: +mean(crowdAtKill).toFixed(2), p90: +q(crowdAtKill, 0.9).toFixed(0), max: Math.max(0, ...crowdAtKill) },

    life: { mean: +mean(all.map((r) => r.life)).toFixed(1), p50: +q(all.map((r) => r.life), 0.5).toFixed(1), p90: +q(all.map((r) => r.life), 0.9).toFixed(1) },
    radii: {},
  };
  for (let i = 0; i < RADII.length; i++) {
    const dw = all.map((r) => r.dwell[i]), bs = all.map((r) => r.best[i]);
    out.radii[RADII[i]] = {
      everInside: +(100 * all.filter((r) => r.dwell[i] > 0).length / Math.max(1, all.length)).toFixed(0),
      dwellShareOfLife: +(100 * dw.reduce((s, x) => s + x, 0) / Math.max(1e-9, all.reduce((s, r) => s + r.life, 0))).toFixed(1),
      totalDwellMean: +mean(dw).toFixed(2),
      longestVisitMean: +mean(bs).toFixed(2),
      longestVisitP90: +q(bs, 0.9).toFixed(2),
      longestVisitMax: +Math.max(0, ...bs).toFixed(2),
      visitsMean: +mean(all.map((r) => r.visits[i])).toFixed(2),
    };
  }
  out.sawFall = { mean: +mean(all.map((r) => r.sawFall)).toFixed(2), p90: +q(all.map((r) => r.sawFall), 0.9).toFixed(0), max: Math.max(0, ...all.map((r) => r.sawFall)) };
  out.sawMine = { mean: +mean(all.map((r) => r.sawMine)).toFixed(2), p90: +q(all.map((r) => r.sawMine), 0.9).toFixed(0), max: Math.max(0, ...all.map((r) => r.sawMine)) };
  const dv = all.map((r) => r.deflected || 0);
  out.deflect = {
    total: deflects, shooters: defl.size,
    perBodyMean: +mean(dv).toFixed(2), perBodyP90: +q(dv, 0.9).toFixed(0), perBodyMax: Math.max(0, ...dv),
    everDeflectedPct: +(100 * dv.filter((x) => x > 0).length / Math.max(1, dv.length)).toFixed(0),
  };
  out.crowdAroundPlayer = {};
  for (let i = 0; i < RADII.length; i++) out.crowdAroundPlayer[RADII[i]] = +(crowd[i] / SECS).toFixed(2);
  out.minNerve = { best: +Math.min(...all.map((r) => r.minNerve)).toFixed(3), mean: +mean(all.map((r) => r.minNerve)).toFixed(3) };
  world.unload?.();
  return out;
}

const rows = [];
for (const s of SEEDS) rows.push(await run(s));
console.log(JSON.stringify(rows, null, 2));
