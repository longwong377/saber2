/**
 * WHAT EACH ATTACK'S BLADE ACTUALLY DOES, in metres per second.
 *
 * `NEXT.md`: "The overhead attack has never made a swing sound. It peaks at
 * 10.8 m/s against an 11 m/s whoosh threshold. One number."
 *
 * A number to change is a number to MEASURE first, and the left click has been
 * rewritten since that note was written — so this drives the real Player
 * through every attack it has and reports the peak `swingSpeed` of each,
 * against the peaks of the two things the threshold exists to exclude: walking
 * and running with the blade out.
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';

const { world } = await bootWorld({ level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true } });
const p = world.player;
const base = idleInput();
const peakOver = async (label, drive, frames = 90) => {
  p.stamina = p.maxStamina; p.force = p.maxForce;
  for (const k in p.cooldowns) p.cooldowns[k] = 0;
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    world.update(1 / 60, drive(i));
    peak = Math.max(peak, p.saber.swingSpeed);
  }
  console.log(`${label.padEnd(22)} peak ${peak.toFixed(2)} m/s`);
  for (let i = 0; i < 40; i++) world.update(1 / 60, base);   // settle
  return peak;
};

const press = (name, held = 4) => (i) => ({
  ...base,
  act: (a) => a === name && i < held,
  actHit: (a) => a === name && i === 0,
  actDown: (a) => a === name && i < held,
  mouse: { ...base.mouse, dx: 0, dy: 0, wheel: 0, left: name === 'attack' && i < held, right: false },
});
const walk = (run) => () => ({ ...base, moveAxis: (o) => { if (o) { o.x = 0; o.y = -1; return o; } return { x: 0, y: -1 }; }, act: (a) => run && a === 'sprint' });

for (let i = 0; i < 60; i++) world.update(1 / 60, base);
p.saber.ignite?.();
for (let i = 0; i < 30; i++) world.update(1 / 60, base);

await peakOver('walking', walk(false), 120);
await peakOver('running', walk(true), 120);
/* THE REAL ACTION NAMES, off `SaberController`'s own reads: `thrust` is the
 * left button (the wide cut and its combo), `attackOver` is the overhead —
 * held for the charge — and `attackSpin` is the drill. */
await peakOver('left click (cut)', press('thrust', 6), 120);
await peakOver('left click x3', (i) => press('thrust', 3)(i % 26), 160);
await peakOver('overhead (tap)', press('attackOver', 4), 150);
await peakOver('overhead (charged)', press('attackOver', 70), 190);
await peakOver('spin', press('attackSpin', 6), 150);
