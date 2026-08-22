/**
 * WHAT SHARE OF A REAL BATTLE THE HORDE SPENDS BROKEN — one arm, one process.
 *
 * FLAGSHIP §7's BREAK verb is a claim about a share, and `tools/checks/break.mjs`
 * can only report one seed's worth from inside the gate. This is the bench that
 * takes it over a seed list, and it exists as its own file because HANDOFF
 * §2.5b requires it: two arms inside one process are not comparable, because
 * the second starts wherever the first left the module-scope streams.
 *
 *   node --import ./tools/register.mjs tools/_nervearm.mjs --arm on  --seeds 1,2,3 > on.json
 *   node --import ./tools/register.mjs tools/_nervearm.mjs --arm off --seeds 1,2,3 > off.json
 *
 * `--arm off` sets `NERVE.ANSWERED` to zero and CHANGES NOTHING ELSE, and that
 * is arithmetically the whole of the ledger as it stood before this session:
 * the rank-carried rout in `nerveTick` cannot fire until something is broken,
 * and with `ANSWERED` at zero the measured share broken was 0.00%. So the
 * control arm is the shipped table with one constant zeroed rather than a
 * second copy of the old rule (HANDOFF §2.4).
 *
 * The Jedi is the flagship script — `dutyInput`, holding station on his own
 * line's centroid, guard up, blade lit, chasing a hostile inside 14 m. That is
 * the condition every published reading of this verb has been taken under, so
 * it is the one the before/after is taken under too.
 */

import './dom-shim.mjs';
import { bootWorld } from './checks/_coop.mjs';
import { dutyInput, drive } from './_flagship.mjs';
import { NERVE, nerveOf, nerveBroken, nerveRefusing } from '../src/game/Nerve.js';
import { MORALE } from '../src/game/Morale.js';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const ARM = String(flag('arm', 'on'));
const SEEDS = String(flag('seeds', '1,2,3')).split(',').map(Number);
const SECS = Number(flag('secs', '90'));
/**
 * WHERE THE JEDI STANDS, and it is the whole of what this verb is a claim
 * about, so it is an arm and not a constant.
 *
 *   `line`  — the flagship script unaltered: station on his own line's
 *             centroid, chasing a hostile inside 14 m, leashed to 18 m. Every
 *             published reading of BREAK has been taken here, and it is where
 *             the before/after has to be taken.
 *   `front` — FLAGSHIP §7's sentence taken literally: he WALKS AT the nearest
 *             body of the formation, at a walking pace, and stops at sword
 *             reach. Same script, same guard, same blade — the only thing that
 *             moves is where he chooses to be. The position is written rather
 *             than steered because `dutyInput`'s anchor is closed over and this
 *             is measuring the ledger, not the pathfinding; the step is bounded
 *             by a walk so it cannot become the teleport `_nervewhy.mjs` uses
 *             for its upper bound.
 */
const STANCE = String(flag('stance', 'line'));
/**
 * WHICH MODE, and it is an arm because it decides how much of the horde's fire
 * is aimed at the Jedi at all. In `command` he is one target of eleven — ten
 * troopers stand with him and the horde shoots at the line. In `waves`, which
 * is the shape of six of the eight modes, he is the only thing on the field.
 */
const MODE = String(flag('mode', 'command'));
const WALK = 4.2;
const STEP = 1 / 30;

if (ARM === 'off') NERVE.ANSWERED = 0;

async function run(seed) {
  /* ALL THREE MODULE STREAMS, PINNED PER SEED — HANDOFF §2.5b. World.js is
   * imported dynamically for §2.1's reason and the other two ride with it. */
  const { seedWorld } = await import('../src/game/World.js');
  const { enemyRng } = await import('../src/game/Enemy.js');
  const { seedWaves } = await import('../src/game/Waves.js');
  seedWorld(seed); enemyRng.seed(seed); seedWaves(seed);

  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: MODE, level: 'geonosis', order: 'jedi', seed, difficulty: 'knight' },
  });
  world.director.start(1);
  const p = world.player;
  p.saber.ignite(); p.saber.ignition = 1;
  const input = dutyInput(world);

  /* THE BOLTS THE BLADE ANSWERED, at the one door that turns one. Counted so
   * the share below can be read against what the player actually did. */
  let answered = 0, aimed = 0;
  /* …AND HOW MUCH OF THE HORDE'S FIRE WAS AIMED AT HIM IN THE FIRST PLACE.
   * `Enemy.target` is what the brain picked this frame and `BoltPool.fire`
   * stamps the owner, so this is the game's own answer to "who was he shooting
   * at" rather than a geometric guess. The ratio is the deflection rate, and it
   * is the ceiling on anything an answered bolt can ever be worth. */
  const fire = world.bolts.fire.bind(world.bolts);
  world.bolts.fire = (from, dir, opts = {}) => {
    const o = opts.owner;
    if (o && o.team !== p.team && o.target === p) aimed++;
    return fire(from, dir, opts);
  };
  const od = world._onBoltDeflect.bind(world);
  world._onBoltDeflect = (bolt, entry, hit, pt) => {
    if (entry && entry.owner === p && bolt.owner && bolt.owner.team !== p.team) answered++;
    return od(bolt, entry, hit, pt);
  };

  let secs = 0, hostileSeconds = 0, brokenSeconds = 0, refusingSeconds = 0, worst = 1;
  /* HOW MANY OF ITS OWN SIDE A BODY CAN SEE — the formation's own density, and
   * the number that decides whether a rank can carry anything at all. */
  let seenSum = 0, seenN = 0, seenSamples = 0;
  const brokeEver = new Set(), bodies = new Set();
  drive(world, SECS, input, () => {
    if (STANCE === 'front') {
      let best = null, bd = 1e9;
      for (const e of world.enemies) {
        if (e.dead || e.team === p.team) continue;
        const d = (e.position.x - p.position.x) ** 2 + (e.position.z - p.position.z) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        const d = Math.sqrt(bd);
        const step = Math.min(Math.max(0, d - 3.2), WALK * STEP);
        if (step > 0) {
          p.position.x += (best.position.x - p.position.x) / d * step;
          p.position.z += (best.position.z - p.position.z) / d * step;
          p.position.y = (world.terrain?.height(p.position.x, p.position.z) ?? 0) + 0.05;
        }
      }
      if (p.saber.ignition < 1) p.saber.ignition = 1;
    }
    secs += STEP;
    for (const e of world.enemies) {
      if (e.dead || e.trooper || e.team === p.team) continue;
      bodies.add(e);
      hostileSeconds += STEP;
      const n = nerveOf(e);
      if (n < worst) worst = n;
      if (nerveBroken(e)) { brokenSeconds += STEP; brokeEver.add(e); }
      if (seenSamples % 30 === 0) {
        let seen = 0;
        for (const o of world.enemies) {
          if (o === e || o.dead || o.team !== e.team) continue;
          const dx = o.position.x - e.position.x, dz = o.position.z - e.position.z;
          if (dx * dx + dz * dz <= NERVE.SEE * NERVE.SEE) seen++;
        }
        seenSum += seen; seenN++;
      }
      seenSamples++;
      if (nerveRefusing(e)) refusingSeconds += STEP;
    }
    return false;
  });

  const out = {
    arm: ARM, mode: MODE, stance: STANCE, seed, gameSeconds: +secs.toFixed(0),
    bodies: bodies.size,
    hostileSeconds: +hostileSeconds.toFixed(0),
    brokenPct: +(100 * brokenSeconds / Math.max(1e-9, hostileSeconds)).toFixed(2),
    refusingPct: +(100 * refusingSeconds / Math.max(1e-9, hostileSeconds)).toFixed(2),
    brokeEver: brokeEver.size,
    brokeEverPct: +(100 * brokeEver.size / Math.max(1, bodies.size)).toFixed(1),
    answered, aimed,
    answeredPct: +(100 * answered / Math.max(1, aimed)).toFixed(1),
    worst: +worst.toFixed(3),
    seenMean: +(seenSum / Math.max(1, seenN)).toFixed(2),
    line: MORALE.BREAK,
  };
  world.unload?.();
  return out;
}

const rows = [];
for (const s of SEEDS) {
  const r = await run(s);
  rows.push(r);
  process.stderr.write(`${ARM}/${MODE}/${STANCE} seed ${s}: broken ${r.brokenPct}% refusing ${r.refusingPct}% `
    + `broke-ever ${r.brokeEver}/${r.bodies} answered ${r.answered} worst ${r.worst}\n`);
}
const mean = (k) => +(rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(2);
console.log(JSON.stringify({
  arm: ARM, mode: MODE, stance: STANCE, seeds: SEEDS.length,
  brokenPct: mean('brokenPct'), refusingPct: mean('refusingPct'),
  brokeEverPct: mean('brokeEverPct'), answered: mean('answered'), aimed: mean('aimed'), answeredPct: mean('answeredPct'), seenMean: mean('seenMean'),
  hostileSeconds: rows.reduce((s, r) => s + r.hostileSeconds, 0),
  worst: +Math.min(...rows.map((r) => r.worst)).toFixed(3),
  rows,
}, null, 2));
