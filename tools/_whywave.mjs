/**
 * WHERE THE SECONDS GO — why a wave lasts 67 s with no Jedi on the field and
 * 79-83 s with one.
 *
 * `tools/_linehold.mjs` measures the OUTCOME (survivors, cleared, wave length).
 * This measures the BOOKKEEPING behind the wave length, on the same worlds,
 * with the same three module-stream reseeds, so a run here is comparable with a
 * run there. Everything below is a COUNT or a body-second: no wall clock.
 *
 *   node --import ./tools/register.mjs tools/_whywave.mjs <arm> <seeds> [level]
 *
 * ONE ARM PER PROCESS — `_linehold.mjs`'s own header explains why two arms
 * inside one process are not comparable.
 *
 * What it books, per wave, and why each one is here:
 *
 *   PAYING vs LEVY. `Levy.js` says the wave ENDS when the last PAYING body is
 *     down (`LevyPack.update`: conscripts break once `paying === 0`). So wave
 *     length is "time to kill the regulars", and every conscript-second is only
 *     relevant through what it does to the regulars' arrival rate.
 *   THE CONCURRENCY CAP. `Waves.update` lets a body onto the field only while
 *     `alive + inbound < maxAlive`, and `alive` counts CONSCRIPTS TOO (Levy.js
 *     argues at length for exactly that). So a conscript that is slow to die
 *     holds a slot the next regular cannot have. `capBlocked` is the seconds
 *     the queue was non-empty and the cap was the thing stopping it; `paceOnly`
 *     is the seconds it was merely the spawn timer.
 *   WHO EACH HOSTILE IS FIGHTING, sampled 5×/s. `installLevyAim` in Levy.js
 *     points a conscript at the JEDI rather than at the line, on purpose. This
 *     is where that shows up as body-seconds spent walking instead of dying.
 *   WHAT KILLED IT. `onEnemyKilled(e, source, kind)` — the player, a trooper,
 *     or nobody (`rout` / `retire`, both of which are the game deleting a body
 *     it could not otherwise finish).
 *   THE WATCHDOG. `Waves._watchdog` measures "is this body making progress"
 *     as distance to a PLAYER. With no player on the field that distance is
 *     Infinity for every body, so the arm with no Jedi is the arm where the
 *     watchdog can fire — `rescues`/`retires` says whether it actually does.
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { dutyInput, STAND_OFF } = await import('./_flagship.mjs');
const { enemyRng, paysOut } = await import('../src/game/Enemy.js');
const { seedWaves } = await import('../src/game/Waves.js');
const { seedWorld } = await import('../src/game/World.js');

const STEP = 1 / 30;
const CAP = 600;
/** "Close enough that the line can shoot it." `Command.targetFor` leashes a
 *  trooper to 14-34 m of its own SLOT; 30 m is the middle of that band and is
 *  used only as a probe threshold — nothing in the game reads it. */
const LEASH_PROBE = 30;
const arm = process.argv[2] || 'none';
const seeds = (process.argv[3] || '1,2,3,4,5').split(',').map(Number);
const level = process.argv[4] || 'geonosis';
const mode = 'theline';

const phase = (seed) => {
  enemyRng.seed((20260821 ^ Math.imul(seed, 2654435761)) >>> 0);
  seedWaves((20260821 ^ Math.imul(seed, 40503)) >>> 0);
  seedWorld((20260821 ^ Math.imul(seed, 2246822519)) >>> 0);
};

const blank = () => ({
  t: 0,
  paySpawn: 0, levySpawn: 0,
  paySec: 0, levySec: 0,
  payLive: 0, levyLive: 0,             // body-seconds, integrated per frame
  capBlocked: 0, paceOnly: 0, queueEmpty: 0,
  atPlayer: 0, atTrooper: 0, atNone: 0,   // sampled body-seconds, hostiles only
  levyAtPlayer: 0, levyAtTrooper: 0,
  /* WHERE A PAYING BODY'S SECONDS GO, which is the whole question: the wave
   * ends when the last PAYING body dies (Levy.js — the conscripts break the
   * moment `paying === 0`), so every second a regular spends alive and NOT
   * under the line's rifles is a second added to the wave.
   *   inLeash  within LEASH_PROBE of a living trooper of yours — shootable.
   *   outLeash further than that from every one of them — walking, or standing
   *            around a Jedi who is standing somewhere else.
   *   atSaber  its target is the player. */
  payIn: 0, payOut: 0, payAtSaber: 0,
  lineTravel: 0, playerFromLine: 0, sampled: 0,
  killPlayer: 0, killTrooper: 0, killRout: 0, killRetire: 0, killOther: 0,
  payKillPlayer: 0, payKillTrooper: 0, payKillOther: 0,
  lastPayDeath: 0,                     // seconds into the wave
  /* HOW LONG A REGULAR LIVED, BY WHO FINISHED IT. The wave ends on the last
   * paying body, so this is the wave length taken apart one body at a time:
   * ten rifles firing on one droid and one Jedi swinging at one droid are two
   * very different lengths of life. */
  lifeLine: 0, nLine: 0, lifeSaber: 0, nSaber: 0, lifeGone: 0, nGone: 0,
});

async function run(seed) {
  phase(seed);
  const { world } = await H.bootWorld({
    level, spawn: arm !== 'none',
    settings: { mode, level, order: 'jedi' }, runSeed: seed });
  const d = world.command;
  d.onMuster = () => {};

  let tNow = 0, waveT0 = 0;
  const waves = [];
  let cur = blank();

  const dir = () => world.director;

  /* Deaths, at the one place a death is visible centrally (World.onEnemyKilled). */
  const born = new Map();                  // enemy -> { t0, paying }
  const okBase = world.onEnemyKilled.bind(world);
  world.onEnemyKilled = (e, source, kind) => {
    const rec = born.get(e);
    const paying = rec ? rec.paying : paysOut(e.A);
    const hostile = dir()?.blocksWaveEnd
      ? ((e.team ?? 1) !== (world.partyTeam ?? 0)) : true;
    if (hostile) {
      /* NULL SOURCE FIRST, and the first cut of this probe did not: `rout`
       * and `retire` both pass `source = null`, and in the arm with NO PLAYER
       * `world.player` is null too — so `source === world.player` was true for
       * every body the game deleted and the no-player arm read "37 kills by
       * the player" on a field with no player on it. */
      const who = source == null ? (kind === 'rout' ? 'Rout' : kind === 'retire' ? 'Retire' : 'Other')
        : (world.player && source === world.player) ? 'Player'
        : source.trooper ? 'Trooper' : 'Other';
      cur[`kill${who}`]++;
      if (paying) {
        cur.lastPayDeath = +(tNow - waveT0).toFixed(1);
        const life = rec ? tNow - rec.t0 : 0;
        if (who === 'Player') { cur.payKillPlayer++; cur.lifeSaber += life; cur.nSaber++; }
        else if (who === 'Trooper') { cur.payKillTrooper++; cur.lifeLine += life; cur.nLine++; }
        else { cur.payKillOther++; cur.lifeGone += life; cur.nGone++; }
      }
    }
    return okBase(e, source, kind);
  };

  const onClear = d.onWaveClear;
  d.onWaveClear = function (...a) {
    cur.t = +(tNow - waveT0).toFixed(1);
    waves.push(cur); cur = blank(); waveT0 = tNow;
    return onClear?.apply(this, a);
  };

  /* THE WATCHDOG, OFF — the attribution experiment. `Waves._watchdog` measures
   * "is this body making progress" as distance to a PLAYER, so on a field with
   * no player that distance is Infinity for every body and the watchdog
   * rescues and retires the wave. Turning it off is how much of the arm's wave
   * length is the watchdog and how much is the fight. */
  if (process.env.WHY_NOWATCH) d._watchdog = () => {};
  d.start(1);
  const input = arm === 'blade' ? dutyInput(world)
    : arm === 'far' ? dutyInput(world, { standOff: STAND_OFF })
    : H.idleInput();

  let t = 0, ended = 'cap', frame = 0;
  const living = [];
  let lastC = null;
  for (let i = 0; i < CAP / STEP; i++) {
    if (world.player) world.player.hp = world.player.maxHp;
    input.tick?.(STEP);
    world.update(STEP, input); t += STEP; tNow = t; frame++;

    const D = dir();
    if (D) {
      /* WHERE THE LINE IS, once a frame: the living bodies of this commander,
       * which is the same set `dutyInput` takes its centroid from. */
      living.length = 0;
      let cx = 0, cz = 0;
      for (const tr of (D.commander?.roster?.living || [])) {
        const b = tr.body; if (!b || b.dead) continue;
        living.push({ x: b.position.x, z: b.position.z });
        cx += b.position.x; cz += b.position.z;
      }
      if (living.length) {
        cx /= living.length; cz /= living.length;
        if (lastC) cur.lineTravel += Math.hypot(cx - lastC.x, cz - lastC.z);
        lastC = { x: cx, z: cz };
        if (frame % 6 === 0 && world.player) {
          cur.playerFromLine += Math.hypot(world.player.position.x - cx, world.player.position.z - cz);
          cur.sampled++;
        }
      }
      let alive = 0;
      for (const e of world.enemies) {
        if (!D.blocksWaveEnd(e)) continue;
        alive++;
        let rec = born.get(e);
        if (!rec) {
          rec = { t0: t, paying: paysOut(e.A) };
          born.set(e, rec);
          if (rec.paying) cur.paySpawn++; else cur.levySpawn++;
        }
        if (rec.paying) cur.payLive += STEP; else cur.levyLive += STEP;
        /* Sampled, not every frame: 5 Hz is plenty for a body-second and the
         * per-frame walk is already the cost of this probe. */
        if (frame % 6 === 0) {
          const tg = e.target;
          const cls = tg && tg === world.player ? 'atPlayer'
            : tg && tg.trooper ? 'atTrooper' : 'atNone';
          cur[cls] += STEP * 6;
          if (!rec.paying && cls !== 'atNone') cur[cls === 'atPlayer' ? 'levyAtPlayer' : 'levyAtTrooper'] += STEP * 6;
          if (rec.paying) {
            let near = Infinity;
            for (const t of living) {
              const dd = (t.x - e.position.x) ** 2 + (t.z - e.position.z) ** 2;
              if (dd < near) near = dd;
            }
            if (near <= LEASH_PROBE * LEASH_PROBE) cur.payIn += STEP * 6; else cur.payOut += STEP * 6;
            if (cls === 'atPlayer') cur.payAtSaber += STEP * 6;
          }
        }
      }
      /* THE CAP, recomputed exactly as `Waves.update` computes it. */
      const inbound = D.arrivals.pending;
      const maxAlive = D.shape?.alive ?? D.maxAlive;
      if (!D.spawnQueue.length) cur.queueEmpty += STEP;
      else if (!(alive + inbound < maxAlive)) cur.capBlocked += STEP;
      else cur.paceOnly += STEP;
    }

    if (d.mustering) { ended = 'cleared'; break; }
    if (world.over) { ended = 'over'; break; }
    if (d.roster.strength === 0) { ended = 'wiped'; break; }
  }
  const D = dir();
  const out = { seed, t, ended, left: d.roster.strength, waves,
    rescues: (D?.rescues || []).filter((x) => x.what === 'rescue').length,
    retires: (D?.rescues || []).filter((x) => x.what === 'retire').length,
    shape: { alive: D?.shape?.alive ?? null, levy: D?.shape?.levy ?? null, pace: D?.shape?.pace ?? null } };
  world.unload();
  return out;
}

const all = [];
for (const seed of seeds) {
  const r = await run(seed);
  all.push(r);
  console.log(`seed ${seed}  ${r.left}/10  ${r.t.toFixed(0)}s  ${r.ended}  rescues ${r.rescues} retires ${r.retires}  `
    + `shape alive=${r.shape.alive} levy=${r.shape.levy} pace=${r.shape.pace?.toFixed?.(2)}`);
  for (const w of r.waves) {
    console.log(`   wave ${w.t}s  spawn pay ${w.paySpawn} levy ${w.levySpawn}  `
      + `bodysec pay ${w.payLive.toFixed(0)} levy ${w.levyLive.toFixed(0)}  `
      + `cap ${w.capBlocked.toFixed(1)}s pace ${w.paceOnly.toFixed(1)}s empty ${w.queueEmpty.toFixed(1)}s  `
      + `tgt P${w.atPlayer.toFixed(0)} T${w.atTrooper.toFixed(0)} -${w.atNone.toFixed(0)}  `
      + `levytgt P${w.levyAtPlayer.toFixed(0)} T${w.levyAtTrooper.toFixed(0)}  `
      + `kills P${w.killPlayer} T${w.killTrooper} rout${w.killRout} ret${w.killRetire} o${w.killOther}  `
      + `paykills P${w.payKillPlayer} T${w.payKillTrooper} o${w.payKillOther}  lastpay ${w.lastPayDeath}s  `
      + `life line ${(w.lifeLine / (w.nLine || 1)).toFixed(1)}s saber ${(w.lifeSaber / (w.nSaber || 1)).toFixed(1)}s `
      + `gone ${(w.lifeGone / (w.nGone || 1)).toFixed(1)}s  `
      + `payin ${w.payIn.toFixed(0)} payout ${w.payOut.toFixed(0)} paysaber ${w.payAtSaber.toFixed(0)}  `
      + `travel ${w.lineTravel.toFixed(0)}m`);
  }
}

const ws = all.flatMap((r) => r.waves);
const m = (f) => (ws.reduce((s, w) => s + f(w), 0) / ws.length);
console.log(`\n=== ${arm} · ${level} · ${seeds.length} seeds · ${ws.length} cleared waves ===`);
console.log(`wave length      ${m((w) => w.t).toFixed(1)}s`);
console.log(`last paying death${m((w) => w.lastPayDeath).toFixed(1)}s into the wave`);
console.log(`spawned          paying ${m((w) => w.paySpawn).toFixed(1)}  levy ${m((w) => w.levySpawn).toFixed(1)}`);
console.log(`body-seconds     paying ${m((w) => w.payLive).toFixed(0)}  levy ${m((w) => w.levyLive).toFixed(0)}`);
console.log(`mean lifetime    paying ${(m((w) => w.payLive) / Math.max(m((w) => w.paySpawn), 1e-9)).toFixed(1)}s  `
  + `levy ${(m((w) => w.levyLive) / Math.max(m((w) => w.levySpawn), 1e-9)).toFixed(1)}s`);
console.log(`queue state      capBlocked ${m((w) => w.capBlocked).toFixed(1)}s  paceOnly ${m((w) => w.paceOnly).toFixed(1)}s  empty ${m((w) => w.queueEmpty).toFixed(1)}s`);
console.log(`targets (bodysec)player ${m((w) => w.atPlayer).toFixed(0)}  trooper ${m((w) => w.atTrooper).toFixed(0)}  none ${m((w) => w.atNone).toFixed(0)}`);
console.log(`  of which levy  player ${m((w) => w.levyAtPlayer).toFixed(0)}  trooper ${m((w) => w.levyAtTrooper).toFixed(0)}`);
console.log(`regular's life   ended by the line ${(ws.reduce((s,w)=>s+w.lifeLine,0)/Math.max(ws.reduce((s,w)=>s+w.nLine,0),1)).toFixed(1)}s  `
  + `by the blade ${(ws.reduce((s,w)=>s+w.lifeSaber,0)/Math.max(ws.reduce((s,w)=>s+w.nSaber,0),1)).toFixed(1)}s  `
  + `deleted ${(ws.reduce((s,w)=>s+w.lifeGone,0)/Math.max(ws.reduce((s,w)=>s+w.nGone,0),1)).toFixed(1)}s`);
console.log(`paying seconds   in-leash ${m((w) => w.payIn).toFixed(0)}  out-of-leash ${m((w) => w.payOut).toFixed(0)}  at-the-saber ${m((w) => w.payAtSaber).toFixed(0)}`);
console.log(`line travel      ${m((w) => w.lineTravel).toFixed(0)} m/wave   player-from-line ${(m((w) => w.playerFromLine) / Math.max(m((w) => w.sampled), 1e-9)).toFixed(0)} m`);
console.log(`kills            player ${m((w) => w.killPlayer).toFixed(1)}  trooper ${m((w) => w.killTrooper).toFixed(1)}  rout ${m((w) => w.killRout).toFixed(1)}  retire ${m((w) => w.killRetire).toFixed(1)}  other ${m((w) => w.killOther).toFixed(1)}`);
console.log(`paying kills     player ${m((w) => w.payKillPlayer).toFixed(1)}  trooper ${m((w) => w.payKillTrooper).toFixed(1)}  other ${m((w) => w.payKillOther).toFixed(1)}`);
console.log(`watchdog         ${(all.reduce((s, r) => s + r.rescues, 0) / all.length).toFixed(1)} rescues and `
  + `${(all.reduce((s, r) => s + r.retires, 0) / all.length).toFixed(1)} retires per run`);
