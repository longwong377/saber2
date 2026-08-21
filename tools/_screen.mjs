/**
 * BATTLEFRONT BORZ — WHO IS KILLING YOUR MEN, AND HOW NEAR THE JEDI IT HAPPENS.
 *
 * `NEXT.md` says the presence loop buys the line nothing a number can see, and
 * FLAGSHIP §6 proposes suppression as the answer: "a bolt answered by the
 * player is a bolt that did not arrive". Before building that, two facts are
 * needed and neither has been taken on this tree:
 *
 *   1. WHAT KILLS A TROOPER. If half the casualty list is grenades and melee,
 *      the ceiling on any bolt-screening mechanism is a half before it starts.
 *   2. HOW CLOSE THE KILLING BOLT PASSES TO THE JEDI. A screen has a reach; the
 *      distribution of that miss distance IS the mechanism's ceiling, and it is
 *      a measurement rather than a guess about how a formation stands.
 *
 * It also takes FLAGSHIP §7's BREAK verb at battle scale, which `tools/checks/
 * break.mjs` cannot: that suite proves the ledger moves on a hand-built field,
 * and this one asks what share of a real battle a real horde spends broken.
 *
 *   node --import ./tools/register.mjs tools/_screen.mjs [--seeds 3,5] [--arms blade,none]
 *
 * Every number here is taken at a seam the game already has — `_boltHitTest`
 * for the bolt, `onEnemyKilled` for the body — rather than derived from a rule
 * stated somewhere else (HANDOFF §2.4).
 */

import './dom-shim.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { dutyInput, drive } from './_flagship.mjs';
import { nerveBroken, nerveRefusing } from '../src/game/Nerve.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = resolve(ROOT, '.flagship');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = String(flag('seeds', '3,5')).split(',').map(Number);
const ARMS = String(flag('arms', 'blade')).split(',');
const ENGAGEMENTS = Number(flag('engagements', '2'));
const STAND_OFF = 100;
const STEP = 1 / 30;
const CAP = 220;

/** Closest approach of a segment to a point, in metres. */
function missDistance(from, to, p) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (l2 > 1e-12) {
    t = ((p.x - from.x) * dx + (p.y - from.y) * dy + (p.z - from.z) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
  }
  const qx = from.x + dx * t - p.x, qy = from.y + dy * t - p.y, qz = from.z + dz * t - p.z;
  return Math.sqrt(qx * qx + qy * qy + qz * qz);
}

const BANDS = [1.4, 2.5, 3.5, 5, 8, 14, 1e9];
const bandName = (d) => {
  for (const b of BANDS) if (d <= b) return b === 1e9 ? '>14' : `<=${b}`;
  return '>14';
};

async function runArm(arm, seed) {
  const { world } = await bootWorld({
    level: 'geonosis',
    spawn: arm !== 'none',
    settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed, difficulty: 'knight' },
  });
  world.director.start(1);
  const input = arm === 'none' ? idleInput()
    : dutyInput(world, arm === 'far' ? { standOff: STAND_OFF } : {});

  /* ── THE BOLT DOOR. Every bolt that reaches a body goes through here, so the
   * census is of the same events the game resolves and not of a second model
   * of them. The miss distance is taken BEFORE the call, because the victim's
   * position moves inside `damage` when a body ragdolls. */
  const bolt = { atTroops: 0, atPlayer: 0, atFoe: 0, troopDamage: 0, bands: {}, killBands: {} };
  for (const b of BANDS) { bolt.bands[bandName(b)] = 0; bolt.killBands[bandName(b)] = 0; }
  const inner = world._boltHitTest.bind(world);
  world._boltHitTest = (b, from, to) => {
    const p = world.player;
    const miss = p && p.alive ? missDistance(from, to, p.chest) : Infinity;
    const res = inner(b, from, to);
    const v = res && res.victim;
    /* A PLAYER IS NOT A TROOPER, AND THE FIRST CUT OF THIS PROBE COUNTED HIM AS
     * ONE. `res.victim` is whatever the door hit and a `Player` carries `hp`
     * and `team` exactly as a body does, so a team test alone put every bolt
     * the Jedi took into the "bolts into your men" column — with a miss
     * distance of zero, which is what produced a 9-deep bucket at 1.4 m and an
     * empty one at 2.5. Identity, not shape. */
    if (v && world.players.includes(v)) bolt.atPlayer++;
    else if (v && v.hp !== undefined && v.team !== undefined) {
      /* A TROOPER OF YOURS IS AN `Enemy` WITH ANOTHER TEAM ON IT. The team test
       * is the same one `_flagship.mjs`'s script uses to find a hostile, read
       * the other way round. */
      const friendly = world.player ? v.team === world.player.team : v.team !== 1;
      if (friendly) {
        bolt.atTroops++;
        bolt.troopDamage += b.damage;
        bolt.bands[bandName(miss)]++;
        if (v.dead || v.hp <= 0) bolt.killBands[bandName(miss)]++;
      } else bolt.atFoe++;
    }
    return res;
  };

  /* ── THE BODY DOOR. What killed each of your men, by the `kind` the game
   * already passes to its own kill callback. */
  const deaths = { troops: {}, foes: 0 };
  const kin = world.onEnemyKilled ? world.onEnemyKilled.bind(world) : null;
  world.onEnemyKilled = (e, source, kind, ...rest) => {
    const friendly = world.player ? e.team === world.player.team : e.team !== 1;
    if (friendly) deaths.troops[kind || 'unknown'] = (deaths.troops[kind || 'unknown'] || 0) + 1;
    else deaths.foes++;
    return kin ? kin(e, source, kind, ...rest) : undefined;
  };

  /* ── THE HORDE'S NERVE, in enemy-seconds. Sampled on the same step the world
   * takes, so the integral is over game time and not over frames. */
  const nerve = { enemySeconds: 0, brokenSeconds: 0, refusingSeconds: 0, worst: 1 };
  const start = world.director.wave;
  const t0 = Date.now();
  const secs = drive(world, CAP * ENGAGEMENTS, input, () => {
    for (const e of world.enemies) {
      if (e.dead || e.trooper) continue;
      if (world.player && e.team === world.player.team) continue;
      nerve.enemySeconds += STEP;
      if (nerveBroken(e)) nerve.brokenSeconds += STEP;
      if (nerveRefusing(e)) nerve.refusingSeconds += STEP;
      if (typeof e.nerve === 'number' && e.nerve < nerve.worst) nerve.worst = e.nerve;
    }
    return world.director.wave > start + ENGAGEMENTS - 1 || world.command.done;
  });

  const d = world.command;
  const out = {
    arm, seed, gameSeconds: +secs.toFixed(1), wallMs: Date.now() - t0,
    fallen: d.roster.fallen.length, standing: d.roster.strength,
    waveClears: world.director.wave - start,
    foeKilled: deaths.foes,
    troopDeathsBy: deaths.troops,
    boltsIntoTroops: bolt.atTroops,
    boltDamageIntoTroops: +bolt.troopDamage.toFixed(1),
    boltsIntoPlayer: bolt.atPlayer,
    boltsIntoFoes: bolt.atFoe,
    missBands: bolt.bands,
    killingMissBands: bolt.killBands,
    nerve: {
      enemySeconds: +nerve.enemySeconds.toFixed(1),
      brokenPct: nerve.enemySeconds ? +(100 * nerve.brokenSeconds / nerve.enemySeconds).toFixed(2) : 0,
      refusingPct: nerve.enemySeconds ? +(100 * nerve.refusingSeconds / nerve.enemySeconds).toFixed(2) : 0,
      worst: +nerve.worst.toFixed(3),
    },
    guardSpent: world.player ? +(world.player.guardSpent || 0).toFixed(1) : null,
    guardForceSpent: world.player ? +(world.player.guardForceSpent || 0).toFixed(1) : null,
    deflects: world.player ? world.player.deflects : null,
    screened: world.player ? (world.player.screened || 0) : null,
    screenRefused: world.player ? (world.player.screenRefused || 0) : null,
  };
  world.unload?.();
  return out;
}

const rows = [];
for (const seed of SEEDS) {
  for (const arm of ARMS) {
    const r = await runArm(arm, seed);
    rows.push(r);
    console.log(`seed ${seed} ${arm.padEnd(5)} fallen ${String(r.fallen).padStart(2)} `
      + `secs ${String(r.gameSeconds).padStart(5)} boltsIntoTroops ${String(r.boltsIntoTroops).padStart(4)} `
      + `broken ${String(r.nerve.brokenPct).padStart(5)}% refusing ${String(r.nerve.refusingPct).padStart(5)}% `
      + `screened ${r.screened} (${(r.wallMs / 1000).toFixed(0)}s)`);
    console.log('   deaths by  ', JSON.stringify(r.troopDeathsBy));
    console.log('   bolts into troops, by miss to the Jedi ', JSON.stringify(r.missBands));
    console.log('   …of those that killed                  ', JSON.stringify(r.killingMissBands));
  }
}
mkdirSync(OUT, { recursive: true });
const f = resolve(OUT, 'screen.json');
writeFileSync(f, JSON.stringify({ seeds: SEEDS, arms: ARMS, engagements: ENGAGEMENTS, rows }, null, 2));
console.log('\nwrote', f);
