/**
 * WHERE THE TIME GOES INSIDE A WAVE OF THE LINE.
 *
 * `_linewave.mjs` says a late wave is 606 s and an opening one is 81 s, army
 * immortal both ways. That is the SHAPE of the problem and not its mechanism:
 * a wave that takes ten minutes is either a wave with a great many bodies in
 * it, a wave that is only allowed to put a few of them on the field at a time,
 * or a wave whose bodies take a long time to die. Those are three different
 * repairs and the wave clock cannot tell them apart.
 *
 * So this one samples the wave WHILE it runs and reports the quantities that
 * separate them, all of them read off the live director rather than derived
 * from a rule stated somewhere else (HANDOFF §2.4):
 *
 *   queued(levy)  what the composer put in the queue, and how much of it is
 *                 the levy, off `shape.levy`.
 *   hp            the HIT POINTS in that queue. This is the column the answer
 *                 turned out to be: see the finding below.
 *   sat%          the share of frames in which the concurrency gate
 *                 (`alive + inbound >= maxAlive`) was the thing holding the
 *                 queue back. A wave that is never saturated is not conveyor-
 *                 limited however long its queue is.
 *   peak/mean     hostiles standing.
 *   standing      how many of the line are on their feet, which is the other
 *                 half of the ratio `hp / seconds` is measuring.
 *
 * ── WHAT IT FOUND ───────────────────────────────────────────────────────
 *
 * Not the queue and not the conveyor. Sampled on seed 1, area 1 wave 1: the
 * whole 49-body queue is on the ground by t+18 s, `sat%` is 0 for every wave
 * of the sitting, and the remaining fifty seconds are the line killing what
 * arrived. **A wave of this mode is its hit points divided by the line's
 * throughput**, and the hit points are what the escalation grows: 448 hp in
 * the opening wave against 6 166 in the last wave of a Push, on a body count
 * that only goes from 49 to 63.
 *
 *   node --import ./tools/register.mjs tools/_lineclock.mjs [seeds] [cap-s] [mortal] [trace]
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const { spawnType } = await import('../src/game/Waves.js');
const STEP = 1 / 30;
const CAP = Number(process.argv[3] || 5400);
/* IMMORTAL BY DEFAULT, exactly as `_linelength.mjs` and `_linewave.mjs` are:
 * what is being timed is the WAVE, and a line that dies half way through one
 * stops the clock for a reason that is not the wave's length. `mortal` drives
 * the same sitting with the army the mode actually gives you. */
const MORTAL = process.argv.includes('mortal');
const TRACE = process.argv.includes('trace');

for (const seed of (process.argv[2] || '1').split(',').map(Number)) {
  const { world } = await H.bootWorld({ level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', order: 'jedi' }, runSeed: seed });
  const d = world.command;
  d.start(1);
  const input = dutyInput(world);
  let t = 0, over = null;
  const rows = [];
  /* THE BULK OF THE WAVE, off the queue the composer just built. Hit points
   * rather than bodies, because a body is not a unit of time. */
  const bulk = () => d.spawnQueue.reduce((n, e) => n + (ARCHETYPES[spawnType(e)]?.hp || 0), 0);
  const openRow = () => ({
    w: d.wave, area: d.areaIndex + 1, at: t,
    queued: d.spawnQueue.length, levy: d.shape?.levy | 0, hp: bulk(),
    budget: d.budgetFor(d.wave),
    frames: 0, satFrames: 0, peak: 0, hostSum: 0, line: d.roster.living.length,
  });
  const row = (r) => `  ${r.area}  ${String(r.w).padStart(2)}  ${String(r.budget).padStart(6)}`
    + `  ${String(r.queued).padStart(4)}(${String(r.levy).padStart(2)})  ${String(r.hp).padStart(6)}`
    + `  ${r.total.toFixed(0).padStart(5)}s  ${(r.hp / Math.max(1, r.total)).toFixed(1).padStart(5)}`
    + `  ${((100 * r.satFrames) / Math.max(1, r.frames)).toFixed(0).padStart(4)}`
    + `  ${String(r.peak).padStart(4)}  ${(r.hostSum / Math.max(1, r.frames)).toFixed(1).padStart(5)}`
    + `  ${String(r.line).padStart(5)}`;
  world.onGameOver = (s) => { over = s; };
  console.log(`\nseed ${seed}  ${d.plan.id}  ${d.stages.length} stages `
    + `${d.stages.map((a) => a.id + '×' + a.waves).join(' ')}  card ${d.plan.minutes[0]}-${d.plan.minutes[1]} min`);
  console.log('  ar   w  budget  queued(lvy)      hp  total   hp/s  sat%  peak  alive   line');
  let cur = openRow();
  for (let i = 0; i < CAP / STEP && !over; i++) {
    /* `input.tick(STEP)` BEFORE the step. `world.update` does NOT call it —
     * there is no such call anywhere in src — so a loop that omits it drives an
     * unkillable STATUE on the deploy mark. `_linelength.mjs` still omits it;
     * `_linewave.mjs` does not. */
    input.tick?.(STEP);
    if (!MORTAL) {
      if (world.player) world.player.hp = world.player.maxHp;
      for (const tr of d.roster.all) if (tr.alive && tr.body && !tr.body.dead) tr.body.hp = tr.body.maxHp;
    }
    world.update(STEP, input); t += STEP;
    if (d.mustering) d.closeMuster();
    /* The same two numbers `WaveDirector.update` gates the queue on, asked one
     * frame later — `blocksWaveEnd` is the director's own predicate. */
    const host = world.enemies.reduce((n, e) => n + (d.blocksWaveEnd(e) ? 1 : 0), 0);
    const inbound = d.arrivals.pending;
    cur.frames++;
    cur.hostSum += host;
    if (host > cur.peak) cur.peak = host;
    if (d.spawnQueue.length && host + inbound >= (d.shape?.alive ?? d.maxAlive)) cur.satFrames++;
    if (TRACE && cur.frames % 300 === 0) {
      console.log(`      t+${(t - cur.at).toFixed(0)}s  queue ${d.spawnQueue.length}`
        + ` staging ${d.arrivals.staging.length} inbound ${inbound} host ${host}`);
    }
    /* ON THE WAVE NUMBER ALONE. `areaIndex` advances a frame apart from `wave`
     * at a stage boundary, so closing on either of them split the boundary wave
     * into two rows and read its queue a second time half-drained — the time
     * still partitioned correctly but the hit points did not. */
    if (d.wave !== cur.w) {
      cur.total = t - cur.at;
      /* THE LINE ON ITS FEET as the wave closed — the other half of the ratio
       * `hp / seconds` is measuring, and the half the muster moves. */
      cur.line = d.roster.living.length;
      rows.push(cur);
      /* PRINTED AS IT CLOSES rather than at the end: a whole sitting is tens of
       * minutes of wall clock, and a run that only speaks when it is finished
       * is a run nobody can read while it is going. */
      console.log(row(cur));
      cur = openRow();
    }
  }
  /* THE LAST WAVE IS PART OF THE SITTING. The loop leaves on `over`, which is
   * raised by the wave that ends the crossing — so the wave the run was WON on
   * never saw a wave-number change and its rows, its hit points and its
   * seconds were all dropped. Measured on a Raid: 624 s reported against 744 s
   * actually driven, which is the whole of the last engagement's climax
   * missing from a table about length. */
  if (cur.frames) {
    cur.total = t - cur.at;
    cur.line = d.roster.living.length;
    rows.push(cur);
    console.log(row(cur));
  }
  const tot = rows.reduce((n, r) => n + r.total, 0);
  const hp = rows.reduce((n, r) => n + r.hp, 0);
  console.log(`  seed ${seed}  ${d.plan.id}  ${rows.length} waves  ${(tot / 60).toFixed(1)} min`
    + `  card ${d.plan.minutes[0]}-${d.plan.minutes[1]}  ${hp} hp  ${(hp / Math.max(1, tot)).toFixed(1)} hp/s`
    + `  ended=${over ? (over.won ? 'WON' : 'lost') : 'never'}`);
  world.unload();
}
