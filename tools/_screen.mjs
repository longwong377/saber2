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

/* ══════════════════════════════════════════════════════════════════════ */
/*  A rank under fire, with a Jedi standing in it                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * `tools/_beaten.mjs`'s firing line with the thing it is missing: MEN.
 *
 * That probe stands one player in front of `n` rifles and reads what the guard
 * costs him, which is the half of FLAGSHIP §6 that was already built. This one
 * stands men either side of him and reads what the guard costs THEM — the
 * screen, and the number the Dead Jedi test says nobody has ever been able to
 * see.
 *
 * The control arm is a Jedi WITH AN EMPTY FORCE BAR, and that is the
 * mechanism's own off switch rather than a test hook in shipped code: the
 * screen's reach IS the Force in the bar (`Combat.screenReach`), so a player
 * at zero covers nothing and everything else about the two arms — the guard,
 * the blade, the body standing in the way, the auto-guard cone — is identical.
 * Nothing in this harness spends Force on anything else, so the arm is a
 * one-variable A/B.
 */
export async function screenLine({ mates = 4, spacing = 2.4, standOff = 0, range = 16,
  ratePerMate = 1.5, seconds = 12, force = null, hold = true, damage = 9, boltTeam = 2 } = {}) {
  const THREE = await import('three');
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', difficulty: 'knight' },
  });
  const p = world.player;
  const ground = (x, z) => (world.terrain?.height(x, z) ?? 0);
  p.position.set(standOff, ground(standOff, 0) + 0.05, 0);
  p.saber.ignite(); p.saber.ignition = 1;
  p.camera.yaw = Math.PI;                          // looking down +z, at the fire

  /* THE RANK. Either side of the Jedi at the `line` formation's own spacing,
   * one step forward, so a bolt aimed at a man crosses the ground the Jedi is
   * standing on rather than arriving behind him. */
  const mateList = [];
  for (let i = 0; i < mates; i++) {
    const off = (Math.floor(i / 2) + 1) * spacing * (i % 2 ? 1 : -1);
    const e = world.spawnEnemy('trooper', new THREE.Vector3(off, 0, 1.6));
    if (!e) continue;
    e.position.y = ground(off, 1.6) + 0.02;
    e.team = p.team;
    mateList.push(e);
  }

  const mateSet = new Set(mateList);
  const tally = { intoMates: 0, mateDamage: 0, aimed: 0 };
  const inner = world._boltHitTest.bind(world);
  world._boltHitTest = (b, from, to) => {
    const res = inner(b, from, to);
    if (res && mateSet.has(res.victim)) { tally.intoMates++; tally.mateDamage += b.damage; }
    return res;
  };

  const input = {
    keys: new Set(), buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
    act: (id) => hold && id === 'blade',
    actHit: () => false, actDown: () => false, end() {},
  };
  const frames = Math.round(seconds / STEP);
  const every = 1 / Math.max(1e-6, ratePerMate);
  let hp0 = 0;
  for (const m of mateList) hp0 += m.hp;
  const muzzle = new THREE.Vector3(), dir = new THREE.Vector3(), aim = new THREE.Vector3();
  let next = 0.4, t = 0;
  for (let i = 0; i < frames; i++) {
    if (force !== null) p.force = force;
    /**
     * THE FIRE IS SCRIPTED, AND THE FIRST VERSION'S WAS NOT.
     *
     * A real firing line was tried first — eight B1s at 16 m, the same shape
     * `tools/_beaten.mjs` uses. Measured: **0 bolts into the men, in both
     * arms.** Every rifle on the field picked the Jedi, which is the honest
     * behaviour of the target selection and makes a firing line useless as an
     * instrument for this question: there is nothing aimed at the rank to
     * screen. So the bolts are placed by hand, one stream per man, aimed at
     * the chest of the man it belongs to. The denominator is then exact —
     * every bolt in the air was going into somebody — which is the property
     * the whole measurement rests on.
     */
    if (t >= next) {
      next += every;
      for (const m of mateList) {
        if (m.dead) continue;
        aim.copy(m.position).setY(m.chestY);
        muzzle.set(aim.x, aim.y, range);
        dir.subVectors(aim, muzzle).normalize();
        /* `team` 2 BY DEFAULT AND NOT 1, and the literal matters. The enemy
         * branch of `_boltHitTest` opens with `if (bolt.team === 1 && !friendly)
         * continue` — team 1 IS the horde, and a team-1 bolt is forbidden from
         * touching anything in `world.enemies` at all, which is where your own
         * men live. A first cut of this harness fired at team 1 and measured
         * **zero bolts into the men in both arms**, which reads exactly like a
         * screen that works perfectly and is a harness that cannot land a shot.
         * Team 2 is the other army's side, which is what Command actually
         * gives a hostile commander. `boltTeam: 0` fires the OTHER case this
         * mechanic exists for: a stray off your own line. */
        world.bolts.fire(muzzle, dir, { speed: 60, team: boltTeam, damage });
        tally.aimed++;
      }
    }
    world.update(STEP, input);
    t += STEP;
    /* The Jedi is topped up before he can die, for `_beaten.mjs`'s reason: the
     * death path drops the guard, and a run that measured a body with no
     * answer in it would be measuring the death and not the screen. */
    if (p.hp < p.maxHp * 0.35) p.hp = p.maxHp;
  }
  let hp1 = 0, standing = 0;
  for (const m of mateList) { hp1 += Math.max(0, m.hp); if (!m.dead) standing++; }
  const out = {
    mates: mateList.length, standOff, seconds, ratePerMate, boltTeam,
    force: force === null ? 'full' : force,
    aimedAtMen: tally.aimed,
    boltsIntoMates: tally.intoMates,
    mateHpLost: +(hp0 - hp1).toFixed(1),
    mateStanding: standing,
    screened: p.screened || 0,
    strays: p.strayed || 0,
    guardForceSpent: +(p.guardForceSpent || 0).toFixed(2),
    guardSpent: +(p.guardSpent || 0).toFixed(1),
    deflects: p.deflects,
    forceLeft: +p.force.toFixed(1),
  };
  world.unload?.();
  return out;
}

/**
 * ONE MAN, ONE BOLT, ONE JEDI — the smallest thing the screen can be asked.
 *
 * `screenLine` above measures the mechanic at the scale it is meant to matter
 * at; this measures whether it fired at all, and it is what the gate asks the
 * four gates of `SCREEN` with, one at a time. Everything below the `fire` call
 * is shipped code: `Bolts.update` finds the screen, `World._onBoltDeflect`
 * grades or knocks it down, `_creditDeflect` bills it.
 *
 * @param mateAt   where the man stands, relative to the Jedi, in metres
 * @param aimAt    where the bolt is actually pointed, relative to the MAN —
 *                 (0,0,0) is his chest, and pushing it sideways is how the
 *                 "would have missed him anyway" case is asked
 * @param range    how far up the bolt's own line the muzzle sits
 */
export async function oneScreen({ mateAt = [2.4, 0, 1.6], aimAt = [0, 0, 0], range = 18,
  boltTeam = 2, force = null, hold = true, damage = 12, frames = 60 } = {}) {
  const THREE = await import('three');
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', difficulty: 'knight' },
  });
  try {
    const p = world.player;
    const ground = (x, z) => (world.terrain?.height(x, z) ?? 0);
    p.position.set(0, ground(0, 0) + 0.05, 0);
    p.saber.ignite(); p.saber.ignition = 1;
    p.camera.yaw = Math.PI;                        // looking down +z
    const mate = world.spawnEnemy('trooper', new THREE.Vector3(mateAt[0], 0, mateAt[2]));
    if (!mate) throw new Error('no trooper spawned — the screen cannot be asked about a man who is not there');
    mate.position.y = ground(mateAt[0], mateAt[2]) + 0.02;
    mate.team = p.team;
    /**
     * AND HE STANDS THERE, because the subject is the screen and not the roll.
     *
     * V12 gave every trooper `Reactions.senseBolt` — a combat roll out of the
     * line of a bolt that is about to arrive — and this fixture aims one
     * straight at a man's chest from eighteen metres. He rolls: measured, 1.49
     * m across the line inside half a second, so the bolt passes him, `arrived`
     * is false and no Force is spent, which reads as a screen that did not
     * work. `noReact` is the game's own flag for a body that must not react —
     * the training remote and the control arm of `reactions.mjs` both carry it
     * — and a check about the price of covering a man cannot measure that
     * price on a man who has left.
     */
    mate.noReact = true;

    const input = {
      keys: new Set(), buttons: [false, false, false],
      mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
      delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, bindings: null,
      moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
      act: (id) => hold && id === 'blade',
      actHit: () => false, actDown: () => false, end() {},
    };
    /* Two frames with the blade parked before anything is fired, so the rig
     * has settled and the contact cannot be graded off a blade the solver is
     * still moving into place. */
    for (let i = 0; i < 2; i++) { if (force !== null) p.force = force; world.update(STEP, input); }

    const target = new THREE.Vector3(mate.position.x + aimAt[0], mate.chestY + aimAt[1], mate.position.z + aimAt[2]);
    const muzzle = new THREE.Vector3(target.x, target.y, target.z + range);
    const dir = new THREE.Vector3().subVectors(target, muzzle).normalize();
    /* HOW FAR THE BOLT'S LINE PASSES FROM THE CHEST, measured off the geometry
     * the check set up rather than read back out of the mechanic — so a price
     * assertion is against a distance the check knows and not against one the
     * thing under test reported. */
    const miss = missDistance(muzzle, target, p.chest);
    const hp0 = mate.hp, force0 = p.force, screened0 = p.screened || 0;
    world.bolts.fire(muzzle, dir, { speed: 60, team: boltTeam, damage });
    let arrived = false;
    const inner = world._boltHitTest.bind(world);
    world._boltHitTest = (b, f, t) => { const r = inner(b, f, t); if (r && r.victim === mate) arrived = true; return r; };
    for (let i = 0; i < frames; i++) { if (force !== null) p.force = force; world.update(STEP, input); }
    return {
      screened: (p.screened || 0) - screened0,
      arrived,
      mateHpLost: +(hp0 - mate.hp).toFixed(2),
      forceSpent: +((p.guardForceSpent || 0)).toFixed(3),
      staminaSpent: +((p.guardSpent || 0)).toFixed(3),
      poolLeft: +p.force.toFixed(2),
      forceBefore: +force0.toFixed(2),
      miss: +miss.toFixed(2),
      boltTeam,
    };
  } finally { world.unload?.(); }
}

/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ONLY WHEN THIS FILE IS THE ONE THAT WAS RUN — the same guard, and the same
 * reason, as `tools/_flagship.mjs`'s: `tools/checks/screen.mjs` imports
 * `screenLine`, and a module that drives fifteen Command worlds at import time
 * makes that impossible.
 */
const ENTRY = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (ENTRY) await main();

async function main() {
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
}
