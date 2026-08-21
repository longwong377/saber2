/**
 * HOW LONG IS A SITTING, AT ITS FASTEST?
 *
 * §5 promises Raid 10–15 min, Push 18–25, Grind 30–45, and the deploy card
 * prints that band as a promise. Nothing has ever measured it.
 *
 * Both sides of the player's army are held on their feet — the Jedi and every
 * named trooper — which does NOT make this a prediction of how long a real
 * sitting takes. It makes it a LOWER BOUND: an army that cannot be killed
 * clears waves as fast as this build can clear them, so whatever this reads,
 * a real run cannot be shorter. If the bound is already past the band the card
 * prints, the card is making a promise the mode cannot keep.
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const STEP = 1 / 30;
const CAP = Number(process.argv[3] || 5400);
for (const seed of (process.argv[2] || '1,2,5').split(',').map(Number)) {
  const { world } = await H.bootWorld({ level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', order: 'jedi' }, runSeed: seed });
  const d = world.command;
  d.start(1);
  const input = dutyInput(world);
  let t = 0, over = null, area = 0, marks = [];
  world.onGameOver = (s) => { over = s; };
  for (let i = 0; i < CAP / STEP && !over; i++) {
    if (world.player) world.player.hp = world.player.maxHp;
    for (const tr of d.roster.all) if (tr.alive && tr.body && !tr.body.dead) tr.body.hp = tr.body.maxHp;
    world.update(STEP, input); t += STEP;
    if (d.mustering) { marks.push(t); d.closeMuster(); }
    if (d.areaIndex > area) area = d.areaIndex;
  }
  const band = d.plan.minutes;
  const mins = t / 60;
  const per = marks.map((m, k) => (m - (marks[k - 1] || 0)).toFixed(0)).join('/');
  console.log(`seed ${seed}  ${d.plan.id.padEnd(5)} ${d.stages.length} stages  card says ${band[0]}-${band[1]} min  `
    + `floor ${mins.toFixed(1)} min  areas ${area + 1}  per-area ${per || '—'}s  `
    + `ended=${over ? (over.won ? 'WON' : 'lost') : 'NEVER'}`);
  world.unload();
}
