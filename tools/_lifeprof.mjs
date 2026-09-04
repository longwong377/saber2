/**
 * WHERE `stepDeckLife`'S TIME ACTUALLY GOES.
 *
 * `deckcast: the step costs under 1.5 ms` has drifted from the 1.0 ms its own
 * note records to 2.6, and "this box is slow" is a claim and not a measurement.
 * Sixteen sub-steps run every frame; this times each of them separately over a
 * live deck so the answer is a name rather than a total.
 *
 *   node --import ./tools/register.mjs tools/_lifeprof.mjs
 */
import { bootWorld, idleInput, run } from './checks/_coop.mjs';
import * as DL from '../src/game/DeckLife.js';

const FRAMES = 300;
const DT = 1 / 60;

const { world } = await bootWorld({
  level: 'hangar',
  settings: { mode: 'hangar', level: 'hangar', allies: 0 },
});
const life = world._deckLife;
const input = idleInput();
run(world, 2, input);

/* THE SUB-STEPS ARE MODULE-PRIVATE, so they are timed the only way an outside
 * caller can: the whole step, and then the whole step again with one of them
 * disabled. The difference is that step's cost. Disabling is done by emptying
 * the collection it walks rather than by patching the function, so nothing here
 * needs DeckLife to export anything it does not. */
function time(label, before, after) {
  before?.();
  /* A warm-up pass, because the first frame after a change pays for whatever
   * the change invalidated and that is not the steady-state cost. */
  for (let i = 0; i < 30; i++) DL.stepDeckLife(world, DT);
  const t0 = performance.now();
  for (let i = 0; i < FRAMES; i++) DL.stepDeckLife(world, DT);
  const ms = (performance.now() - t0) / FRAMES;
  after?.();
  return { label, ms };
}

const rows = [];
const whole = time('WHOLE STEP');
rows.push(whole);

/* Each collection emptied and put back. `stepDeckLife` early-outs on an empty
 * list in every one of these, which is exactly the measurement wanted. */
const parts = [
  ['droids', () => life.droids],
  ['workers', () => life.workers],
  ['silhouettes', () => life.sils],
  ['cranes', () => life.cranes],
  ['parked', () => life.parked],
  ['loose', () => life.loose],
  ['vents', () => life.vents],
  ['traffic', () => life.traffic],
  ['boards', () => life.boards],
  ['rings', () => life.rings],
];
for (const [label, get] of parts) {
  const list = get();
  if (!Array.isArray(list)) { rows.push({ label: `${label} (not a list)`, ms: NaN }); continue; }
  const kept = list.slice();
  const r = time(label, () => { list.length = 0; }, () => { list.push(...kept); });
  rows.push({ label: `${label} (${kept.length})`, ms: whole.ms - r.ms, off: r.ms });
}

console.log(`\nwhole step: ${whole.ms.toFixed(3)} ms/frame over ${FRAMES} frames`);
console.log('cost attributed by emptying each collection:\n');
for (const r of rows.slice(1).sort((a, b) => (b.ms || 0) - (a.ms || 0))) {
  console.log(`  ${String(r.label).padEnd(22)} ${(r.ms || 0).toFixed(3)} ms   (step reads ${(r.off || 0).toFixed(3)} without it)`);
}
world.unload();
