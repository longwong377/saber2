/**
 * WHERE THE FORTY-FIVE MINUTES GO.
 *
 * A Push's floor is 45.7 min against a deploy card promising 18-25, measured
 * with the whole army held unkillable. An area declares its own wave count
 * (`AREAS[*].waves`, 3/4/4/5/5), so the length is that count times what a wave
 * costs — and nobody has measured the second number. This times every wave of
 * a real sitting from the frame it opens to the frame it is paid, with both
 * sides of the player's army held on their feet so what is timed is the WAVE
 * and not the difficulty.
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { AREAS } = await import('../src/game/Command.js');
const STEP = 1 / 30;
console.log('areas declare ' + AREAS.map((a) => a.waves).join('/') + ' waves');
for (const seed of (process.argv[2] || '1').split(',').map(Number)) {
  const { world } = await H.bootWorld({ level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', order: 'jedi' }, runSeed: seed });
  const d = world.command;
  d.start(1);
  const input = dutyInput(world);
  let t = 0, wave = d.wave, waveAt = 0, over = null;
  const times = [];
  world.onGameOver = (s) => { over = s; };
  for (let i = 0; i < 4000 / STEP && !over; i++) {
    if (world.player) world.player.hp = world.player.maxHp;
    for (const tr of d.roster.all) if (tr.alive && tr.body && !tr.body.dead) tr.body.hp = tr.body.maxHp;
    /* `input.tick(STEP)` BEFORE the step, and this line is the whole bench.
     * `dutyInput` is a script whose entire body is `tick(dt)` — it reads the
     * world there, points the move axis, presses the swing and holds station.
     * `world.update` does not call it; `_flagship.mjs`'s own `drive` does, one
     * line above its step. A loop that steps without ticking has an unkillable
     * STATUE on the deploy mark, not a Jedi, and every number it takes is a
     * number about a sitting nobody would play. Three benches in three lanes
     * had this same omission on the same afternoon. */
    input.tick?.(STEP);
    world.update(STEP, input); t += STEP;
    if (d.mustering) d.closeMuster();
    if (d.wave !== wave) {
      times.push({ w: wave, area: d.areaIndex + 1, s: t - waveAt,
        peak: world.enemies.filter((e) => e.team !== 0 && !e.dead).length });
      wave = d.wave; waveAt = t;
    }
  }
  const tot = times.reduce((n, r) => n + r.s, 0);
  console.log(`seed ${seed}  ${d.plan.id}  ${times.length} waves in ${(tot / 60).toFixed(1)} min  `
    + `mean ${(tot / Math.max(1, times.length)).toFixed(0)}s a wave  ended=${over ? (over.won ? 'WON' : 'lost') : 'never'}`);
  for (const r of times) console.log(`   area ${r.area} wave ${r.w}: ${r.s.toFixed(0)}s  (${r.peak} left standing)`);
  world.unload();
}
