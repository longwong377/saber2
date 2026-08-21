/**
 * HOW MUCH OF THE LINE DOES ONE ENGAGEMENT COST?
 *
 * The target the player set: "an engagement fought with no help from the Jedi
 * should cost roughly HALF a ten-man line — about 5 of 10." Nothing in the
 * tree measured that, because until FLAGSHIP §16.3 no hostile bolt could touch
 * a body in `world.enemies` and your own troopers live in that array.
 *
 * ONE ENGAGEMENT IS ONE AREA, not one wave. `AREAS[0]` is three waves and the
 * muster is what the area boundary opens; a per-wave reading would price a
 * third of the thing the player is talking about.
 *
 * THREE ARMS, because an idle Jedi is a corpse with a delay (Levy.js says so
 * at length) and must not be the only one:
 *
 *   NONE   no player spawned at all. The floor: the line alone.
 *   IDLE   a player on the field who does nothing, held at full hp so the
 *          reading is about the line and not about the script dying. He is
 *          still a body the levy walks at — that is not "no help", which is
 *          exactly why NONE is measured beside him.
 *   BLADE  `dutyInput` from tools/_flagship.mjs — walks at the nearest enemy,
 *          swings, holds the guard, holds station on the line's centroid.
 *          The floor of what a present Jedi is worth; a person is worth more.
 *
 *   node --import ./tools/register.mjs tools/_linehold.mjs [mode] [seeds] [arms]
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { AREAS } = await import('../src/game/Command.js');

const STEP = 1 / 30;
const CAP = 600;                                  // game-seconds before we call it stuck
const mode = process.argv[2] || 'theline';
const seeds = (process.argv[3] || '1,2,3,5,7').split(',').map(Number);
const arms = (process.argv[4] || 'none,idle,blade').split(',');
const level = process.argv[5] || 'geonosis';

/** The run's clock, read by the wave-timing hook below. One per run. */
let tNow = 0;

async function run(arm, seed) {
  const { world } = await H.bootWorld({
    level, spawn: arm !== 'none',
    settings: { mode, level, order: 'jedi' }, runSeed: seed });
  const d = world.command;
  /**
   * THE MUSTER HAS TO BE LEFT OPEN OR THERE IS NO BOUNDARY TO READ.
   *
   * `_areaClear` ends with "no screen wired: muster for the player and press
   * on" — `autoMuster()` then `closeMuster()`, both inside the same `payWave`
   * call — so `mustering` goes true and false again between two `world.update`
   * calls and a poll for it never sees it. The first cut of this bench polled
   * for exactly that and reported a no-player run "wave 5, never cleared an
   * area" when it had in fact taken two and been given replacements for both.
   * A screen is what a player has; a no-op `onMuster` is the honest stand-in,
   * and it is also what stops the reading being taken after the replacements.
   */
  d.onMuster = () => {};
  /**
   * AND HOW LONG EACH WAVE OF THE ENGAGEMENT TOOK, from the same run.
   *
   * A lever picked for attrition moves the sitting's LENGTH with it, because
   * both come off the same quantity — how many bodies a wave puts on the
   * ground. `tools/_linewave.mjs` times a whole sitting with everybody held on
   * their feet; this is the cheap half of that number, taken from the run that
   * is already happening, so a tuning pass can never move the clock without
   * saying so. Hung off the director's own clear event rather than off a wave
   * counter, so a wave that is closed out counts exactly once.
   */
  const waves = [];
  let lastClear = 0;
  const onClear = d.onWaveClear;
  d.onWaveClear = function (...a) { waves.push(+(tNow - lastClear).toFixed(1)); lastClear = tNow;
    return onClear?.apply(this, a); };
  d.start(1);
  const n0 = d.roster.all.length;
  const input = arm === 'blade' ? dutyInput(world) : H.idleInput();
  let t = 0, ended = 'cap';
  tNow = 0;
  for (let i = 0; i < CAP / STEP; i++) {
    /* UNKILLABLE IN BOTH PLAYER ARMS, and identically, so the survival of the
     * Jedi is not a variable in a reading about the survival of the line. */
    if (world.player) world.player.hp = world.player.maxHp;
    /**
     * `tick` FIRST, AND THE FIRST CUT OF THIS BENCH DID NOT CALL IT.
     *
     * `dutyInput` is a SCRIPT: `input.tick(dt)` is where it reads the world,
     * points the move axis at the nearest enemy, presses the swing and holds
     * station on the line's centroid. `world.update` does not call it —
     * `tools/_flagship.mjs`'s own `drive` does, one line above its step — so a
     * bench that steps the world and never ticks the input has a Jedi standing
     * on the deploy mark with the guard up and nothing else. That is the IDLE
     * arm wearing the BLADE arm's name, and it would have been reported as
     * "a fighting Jedi is worth nothing".
     */
    input.tick?.(STEP);
    world.update(STEP, input); t += STEP; tNow = t;
    if (d.mustering) { ended = 'cleared'; break; }
    if (world.over) { ended = 'over'; break; }
    if (d.roster.strength === 0) { ended = 'wiped'; break; }
  }
  const out = { arm, seed, left: d.roster.strength, n0, t, wave: d.wave, ended, waves };
  world.unload();
  return out;
}

const rows = [];
for (const arm of arms) for (const seed of seeds) {
  const r = await run(arm, seed);
  rows.push(r);
  console.log(`  ${arm.padEnd(5)} seed ${String(r.seed).padStart(2)}  `
    + `${r.left}/${r.n0} left  ${r.t.toFixed(0)}s  wave ${r.wave}  ${r.ended}  `
    + `waves [${r.waves.join(' ')}]s`);
}
console.log(`\n${mode} · ${level} · area 1 = ${AREAS[0].waves} waves · n=${seeds.length} seeds`);
for (const arm of arms) {
  const a = rows.filter((r) => r.arm === arm);
  const left = a.map((r) => r.left).sort((x, y) => x - y);
  const mean = left.reduce((s, v) => s + v, 0) / left.length;
  const cleared = a.filter((r) => r.ended === 'cleared').length;
  console.log(`${arm.padEnd(5)} survivors mean ${mean.toFixed(1)}/10  `
    + `min ${left[0]} max ${left[left.length - 1]}  [${left.join(' ')}]  `
    + `cleared ${cleared}/${a.length}  `
    + `median ${(a.map((r) => r.t).sort((x, y) => x - y)[a.length >> 1]).toFixed(0)}s  `
    + `mean wave ${(() => { const w = a.flatMap((r) => r.waves);
      return w.length ? (w.reduce((x, y) => x + y, 0) / w.length).toFixed(0) : '—'; })()}s`);
}
