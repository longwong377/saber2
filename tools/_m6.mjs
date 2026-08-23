/**
 * M6 — DOES THE BATTERY MAKE THE JEDI WORTH MORE?
 *
 *   node --import ./tools/register.mjs tools/_m6.mjs [--seeds 2] [--minutes 4]
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE ACCEPTANCE PLAN.md §4.2 WROTE FOR ITSELF, AND THE ONE IT WAS OWED
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §4.2's own kill criterion, verbatim:
 *
 *     *Kill:* four-armed test — does the Jedi arm beat the no-player arm MORE
 *     with the Battery on the field than without? If not, it is decoration.
 *
 * Everything else about capability objectives is asserted structurally and
 * passes: a site is held by bodies and never by the player, crewing takes those
 * men out of the quorum (`objectives.mjs` measures the same ten men in the same
 * places answering `lineGathered` differently), and every effect is routed
 * through the system that already owns it. What none of that says is whether
 * the section PAYS — whether a Jedi is worth MORE to a line that is holding a
 * gun than to one that is not.
 *
 * ── WHY FOUR ARMS AND NOT TWO ─────────────────────────────────────────────
 *
 * Two arms — with a battery and without — measure whether a battery helps,
 * which is not the question and has an obvious answer (it fires at people). The
 * claim is an INTERACTION: the men who crew it come out of the quorum, so the
 * line that holds it is a weaker line, and the Jedi is the thing that is
 * supposed to make up the difference. That is only visible as a difference of
 * differences:
 *
 *     jedi × battery      a Jedi with a gun on the field
 *     none × battery      the same battle with nobody holding the sabre
 *     jedi × field        the same men on the same ground, no gun
 *     none × field        the control for the control
 *
 *     (jedi−none | battery)  >  (jedi−none | field)   ⟹  §4.2 pays
 *
 * ── AND THE MEN STAND IN THE SAME PLACES IN BOTH ─────────────────────────
 *
 * This is the half that makes it a measurement of the BATTERY rather than of a
 * squad being somewhere else. In both battery arms and both field arms, 1st
 * Squad is given the same standing order to hold the same ground — the
 * delegation that shipped for §4.4, which is also §4.2's own interface — so the
 * only thing that differs between a battery arm and a field arm is whether the
 * ground those men are standing on is an installation. Same men, same places,
 * same order; `objectives.mjs`'s weld check is the same isolation asked as a
 * question about outcomes instead of about a boolean.
 *
 * ── WHAT IS MEASURED ──────────────────────────────────────────────────────
 *
 * HOW LONG THE LINE LASTS, in game-seconds, is the headline — and it is not the
 * first thing this instrument measured. `areasTaken` per minute is the mode's
 * own scoring and it is too coarse at this horizon: measured, four arms at four
 * minutes, three of the four took ZERO ground and every arm lost its whole
 * roster. A metric that reads 0.000 in three cells cannot carry an interaction.
 *
 * What every arm does do is DIE, at a rate the arms differ in, so the run's
 * length is the finest thing available at a price that can be paid — a ten-man
 * line with no muster behind it is spent in three to four minutes, which is the
 * mode's real difficulty and is also why `theline.19` holds the army immortal
 * to time a sitting at all. `wave`, the kills and the roster are printed beside
 * it, and the ground is still printed because when it moves it is the answer.
 *
 * No bar is applied: whether an interaction of a given size is "it pays" is a
 * judgement, and the point of the numbers is to make it against them rather
 * than against a reading of the source.
 */

import './dom-shim.mjs';
import * as THREE from 'three';
import { loadavg } from 'node:os';

if ((await import('three')) !== THREE) {
  console.error('\n  _m6.mjs was started without its module loader.\n\n'
    + '  Run: node --import ./tools/register.mjs tools/_m6.mjs\n');
  process.exit(2);
}

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d;
};
const SEEDS = arg('seeds', 2);
const MINUTES = arg('minutes', 4);
const STEP = 1 / 30;

const { bootWorld } = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { Objective } = await import('../src/game/Objectives.js');

/**
 * WHERE THE SQUAD IS SENT, in metres in front of the deploy mark.
 *
 * Far enough that holding it is a real absence from the line — `MORALE.NEAR` is
 * 14 — and near enough that the men are in the battle rather than sightseeing.
 * The same number in all four arms.
 */
const POST = 18;

async function arm({ seed, jedi, battery }) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', order: 'jedi', seed,
      difficulty: 'knight', instantSpawn: true, quality: 'low' },
    runSeed: seed,
    /* NO JEDI ON THE FIELD AT ALL in the `none` arms, which is not the same
     * thing as an idle one — `theline.mjs` makes the same distinction, and
     * Levy.js's note is the reason: "an idle Jedi is not a Jedi; it is a corpse
     * with a delay". */
    spawn: jedi,
  });
  world.beginCampaign?.();
  if (!world.director.active) world.director.start(1);
  const d = world.command;
  d.onMuster = () => {};

  /* THE SQUAD, POSTED — in every arm, so the men are equally absent from the
   * line whether or not the ground they are standing on is a gun. */
  d._troops(STEP, {});
  const squads = d.squadsOf(d.commander);
  const post = new THREE.Vector3(0, 0, POST);
  if (squads[0]) {
    for (const t of squads[0]) if (t.body) t.body.position.copy(post);
    d.order('cover', d.commander, 0);
  }

  /* AND IN TWO OF THE FOUR, THAT GROUND IS A BATTERY. The field is the one the
   * mode already builds; this puts a site under the men rather than building a
   * second kind of objective. */
  if (battery && world.objectives) {
    const site = world.objectives.add(new Objective('battery', post.clone()));
    site.owner = world.player?.team ?? 0;
  } else if (world.objectives) {
    /* …AND IN THE OTHER TWO THERE IS NO INSTALLATION ANYWHERE, so a site the
     * seed happened to lay next to the post cannot pay one arm and not the
     * other. The mode's own four sites are the seed's, not this test's. */
    world.objectives.dispose();
  }

  const input = jedi ? dutyInput(world) : { tick() {}, act: () => false, actHit: () => false,
    moveAxis: () => ({ x: 0, y: 0 }), mouse: { dx: 0, dy: 0, wheel: 0 } };
  const frames = Math.round(MINUTES * 60 / STEP);
  for (let i = 0; i < frames; i++) {
    input.tick?.(STEP);
    world.update(STEP, input);
    if (d.mustering) { d.autoMuster(); d.closeMuster(); }
    if (world.over) break;
  }
  const r = d.roster;
  return {
    seed, jedi, battery,
    played: +world.time.toFixed(1),
    areas: d.areasTaken | 0,
    wave: world.director.wave | 0,
    kills: world.players.reduce((a, p) => a + (p.kills || 0), 0),
    living: r ? r.living.length : 0,
    fallen: r ? r.fallen.length : 0,
    payouts: world.objectives?.payouts | 0,
    over: !!world.over,
  };
}

/* ── the drive ─────────────────────────────────────────────────────────── */

const CELLS = [
  { jedi: true, battery: true }, { jedi: false, battery: true },
  { jedi: true, battery: false }, { jedi: false, battery: false },
];
const rows = [];
const t0 = process.cpuUsage();
for (let s = 0; s < SEEDS; s++) {
  for (const c of CELLS) {
    rows.push(await arm({ seed: 600 + s, ...c }));
    process.stderr.write('.');
  }
}
const cpu = process.cpuUsage(t0);
process.stderr.write('\n');

/* ── the report ────────────────────────────────────────────────────────── */

const cell = (jedi, battery) => rows.filter((r) => r.jedi === jedi && r.battery === battery);
const mean = (a, k) => (a.length ? a.reduce((x, r) => x + r[k], 0) / a.length : 0);
const perMin = (a) => mean(a, 'areas') / (mean(a, 'played') / 60 || 1);

console.log('\n  M6 — does the Battery make the Jedi worth more? (PLAN.md §4.2)');
console.log(`  ${SEEDS} seeds × ${MINUTES} min × 4 cells · ${((cpu.user + cpu.system) / 1e6).toFixed(0)} s CPU `
  + `at load ${loadavg()[0].toFixed(2)}\n`);
console.log('  jedi  battery   survived  areas/min    kills   living  fallen  payouts  wave');
const T = {};
for (const jedi of [true, false]) {
  for (const battery of [true, false]) {
    const a = cell(jedi, battery);
    T[`${jedi}/${battery}`] = mean(a, 'played');
    console.log(`  ${String(jedi).padEnd(5)} ${String(battery).padEnd(8)} ${mean(a, 'played').toFixed(1).padStart(9)} `
      + `${perMin(a).toFixed(3).padStart(10)} `
      + `${mean(a, 'kills').toFixed(1).padStart(8)} ${mean(a, 'living').toFixed(1).padStart(8)} `
      + `${mean(a, 'fallen').toFixed(1).padStart(7)} ${mean(a, 'payouts').toFixed(1).padStart(8)} `
      + `${mean(a, 'wave').toFixed(1).padStart(5)}`);
  }
}

const withGun = T['true/true'] - T['false/true'];
const without = T['true/false'] - T['false/false'];
console.log(`\n  what a Jedi is worth WITH a battery on the field: ${withGun.toFixed(1)} s of run`);
console.log(`  …and WITHOUT one:                                 ${without.toFixed(1)} s`);
console.log(`  the interaction §4.2 asks for:                     ${(withGun - without).toFixed(1)} s`);
console.log('\n  Positive is the section paying: the men on the gun are out of the quorum, so the');
console.log('  line holding it is the weaker line, and the Jedi is what makes up the difference.');
console.log('  No bar is applied — §4.2\'s own words are "if not, it is decoration".\n');
