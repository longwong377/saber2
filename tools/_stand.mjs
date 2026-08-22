/**
 * DOES STANDING WITH YOUR LINE PAY? — the controlled test of
 * `MODES.theline.lineAdvances` and of `FLAGSHIP.md` §7's central claim.
 *
 * §6: "You can sprint 200 m into their rear; the line does not come with you…
 * killing stays fast and fun and ADVANCES NOTHING." That sentence was never
 * implemented — an area was taken on a count of cleared waves — so this is the
 * experiment that says whether implementing it changed the game.
 *
 * A 2×2. Two player scripts, both the shipped `dutyInput` so neither is a
 * script written to win: `with` holds station on the line's own centroid,
 * `away` is the same script with `standOff` — on the field, fighting, not in
 * the line. Two rule states, toggled on the DIRECTOR rather than on the mode
 * string, because a crossing rolls a session plan and Command does not, so
 * changing the mode string alone shifts the whole rng stream (HANDOFF §2.5b).
 *
 * Reported per arm: seconds to take area 1, and how many of the ten were
 * standing when it was taken.
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { seedWorld } = await import('../src/game/World.js');
const { enemyRng } = await import('../src/game/Enemy.js');
const STEP = 1 / 30;
const CAP = Number(process.env.CAP || 600);
const SEEDS = (process.argv[2] || '1,2,3,4,5,6,7,8').split(',').map(Number);
const RULE = process.argv[3] !== 'off';
const STANDOFF = Number(process.argv[4] || 0);

const rows = [];
for (const seed of SEEDS) {
  seedWorld?.(seed); enemyRng.seed(seed);
  const { world } = await H.bootWorld({ level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', order: 'jedi' }, runSeed: seed });
  const d = world.command;
  d.lineAdvances = RULE;
  /* The muster runs inside one payWave call and `mustering` is true for under
   * a frame, so an area is detected off the LOG, which is the ledger the mode
   * keeps for itself. */
  d.start(1);
  const input = dutyInput(world, STANDOFF ? { standOff: STANDOFF } : {});
  let t = 0, took = null, waited = 0;
  const n0 = d.roster.all.length;
  for (let i = 0; i < CAP / STEP && took === null; i++) {
    input.tick?.(STEP);
    world.update(STEP, input);
    t += STEP;
    if (d.awaitingLine) waited += STEP;
    if (d.log.some((r) => r.t === 'area')) took = t;
    if (world.over) break;
  }
  /**
   * THE ROSTER, NOT THE BODIES — and counting the bodies made this bench report
   * that the flagship mode cannot be won.
   *
   * This line was `d.roster.living.filter((x) => x.body && !x.body.dead)`, and
   * it printed `line 0/10` on every run of every arm. It was believed, written
   * up as "six of six seeds take the first area with nobody standing", and it
   * is an artefact: an area ENDS by clearing the field, so at the instant the
   * `area` row is logged the surviving troopers have had their bodies torn down
   * and not yet rebuilt for the next one. Measured at that exact moment on
   * seed 1: **`roster.strength` 11, `living` 11, living-with-a-body 0.**
   *
   * `tools/_muster.mjs` reads `roster.strength` at the same boundary and gets
   * the true picture — area 1 ends with 4-8 of ten and the muster carries it to
   * 8-11. A record is the man; a body is where he happens to be standing, and
   * between areas he is not standing anywhere.
   */
  const up = d.roster.strength;
  rows.push({ seed, took, up, n0, waited });
  console.log(`  seed ${seed}  ${took === null ? 'NOT TAKEN' : took.toFixed(0) + 's'}`
    + `  line ${up}/${n0}  waited ${waited.toFixed(0)}s`);
  world.unload();
}
const done = rows.filter((r) => r.took !== null);
const mean = (a) => a.reduce((n, x) => n + x, 0) / Math.max(1, a.length);
console.log(`rule=${RULE ? 'ON' : 'off'} standOff=${STANDOFF}  `
  + `took ${done.length}/${rows.length}  mean ${done.length ? mean(done.map((r) => r.took)).toFixed(0) : '—'}s  `
  + `line ${mean(rows.map((r) => r.up)).toFixed(1)}/${rows[0].n0}  waiting ${mean(rows.map((r) => r.waited)).toFixed(0)}s`);
