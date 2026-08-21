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
 * So this one samples the wave WHILE it runs and reports the three quantities
 * that separate them:
 *
 *   QUEUED     what the composer put in the queue, paying bodies and levy
 *              apart, read off the director's own `shape` rather than derived.
 *   DELIVERY   the game-seconds from the wave opening to the LAST body leaving
 *              the queue. If that is most of the wave, the wave is arrival-
 *              paced and the lever is the conveyor.
 *   TAIL       from the last body spawned to the field clearing. If THAT is
 *              most of the wave, the lever is how long a body takes to die.
 *   SATURATION the share of sampled frames in which the concurrency gate
 *              (`alive + inbound >= maxAlive`) was the thing holding the queue
 *              back. A wave that is never saturated is not conveyor-limited
 *              however long its queue is.
 *
 * Nothing here restates a rule (HANDOFF §2.4): the queue lengths, the shape and
 * the alive count are all read off the live director, and the saturation test
 * asks the same two numbers `WaveDirector.update` asks.
 *
 *   node --import ./tools/register.mjs tools/_lineclock.mjs [seeds] [cap-s]
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const STEP = 1 / 30;
const CAP = Number(process.argv[3] || 4000);
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
  let cur = null;
  const openRow = () => ({
    w: d.wave, area: d.areaIndex + 1, at: t,
    queued: d.spawnQueue.length, levy: d.shape?.levy | 0,
    alive: d.shape?.alive ?? d.maxAlive, pace: +(d.shape?.pace ?? 1).toFixed(3),
    budget: d.budgetFor(d.wave),
    lastSpawn: t, frames: 0, satFrames: 0, peak: 0, hostSum: 0,
  });
  world.onGameOver = (s) => { over = s; };
  cur = openRow();
  for (let i = 0; i < CAP / STEP && !over; i++) {
    /* `input.tick(STEP)` BEFORE the step. `world.update` does NOT call it —
     * checked, there is no such call in src — so a loop that omits it drives an
     * unkillable STATUE on the deploy mark. `_linelength.mjs` still omits it;
     * `_linewave.mjs` does not. See the note in `_linewave.mjs`. */
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
    if (cur) {
      cur.frames++;
      if (TRACE && cur.frames % 300 === 0) {
        const kinds = {};
        for (const e of world.enemies) if (d.blocksWaveEnd(e)) kinds[e.A?.key || e.type || '?'] = (kinds[e.A?.key || e.type || '?'] | 0) + 1;
        console.log(`      t+${(t - cur.at).toFixed(0)}s  queue ${d.spawnQueue.length}`
          + ` staging ${d.arrivals.staging.length} flights ${d.arrivals.flights.length}`
          + ` inbound ${inbound} host ${host}  ` + JSON.stringify(kinds));
      }
      cur.hostSum += host;
      if (host > cur.peak) cur.peak = host;
      const room = (d.shape?.alive ?? d.maxAlive);
      if (d.spawnQueue.length && host + inbound >= room) cur.satFrames++;
      if (d.spawnQueue.length || inbound) cur.lastSpawn = t;
    }
    if (d.wave !== cur.w || d.areaIndex + 1 !== cur.area) {
      cur.total = t - cur.at;
      cur.deliver = cur.lastSpawn - cur.at;
      rows.push(cur);
      cur = openRow();
    }
  }
  const tot = rows.reduce((n, r) => n + r.total, 0);
  console.log(`\nseed ${seed}  ${d.plan.id}  ${rows.length} waves  ${(tot / 60).toFixed(1)} min`
    + `  card ${d.plan.minutes[0]}-${d.plan.minutes[1]}  ended=${over ? (over.won ? 'WON' : 'lost') : 'never'}`);
  console.log('  ar  w  budget  queued(levy)  room  total   deliver   tail   sat%  peak  mean-alive');
  for (const r of rows) {
    console.log(`  ${r.area}  ${String(r.w).padStart(2)}  ${String(r.budget).padStart(6)}`
      + `  ${String(r.queued).padStart(4)}(${String(r.levy).padStart(2)})   `
      + `  ${String(r.alive).padStart(3)}  ${r.total.toFixed(0).padStart(5)}s`
      + `  ${r.deliver.toFixed(0).padStart(6)}s  ${(r.total - r.deliver).toFixed(0).padStart(5)}s`
      + `  ${((100 * r.satFrames) / Math.max(1, r.frames)).toFixed(0).padStart(4)}`
      + `  ${String(r.peak).padStart(4)}  ${(r.hostSum / Math.max(1, r.frames)).toFixed(1).padStart(5)}`);
  }
  world.unload();
}
