/**
 * DOES THE DEPLOY CARD KEEP ITS PROMISE FOR THE PLANS NOBODY HAS FOUGHT?
 *
 * `theline.19` drives a whole sitting to its verdict and holds it inside the
 * band its own card printed — and it drives a **Raid**, because a Raid is eight
 * waves and it is the only plan cheap enough to sit in a gate. Its own header
 * says so, and says that what holds for a Raid does not automatically hold for
 * a Grind.
 *
 * That leaves the two plans a player is much more likely to see completely
 * unbound. `Session.SESSION_PLANS` weights them 1/2/1, so of every four seeded
 * sittings **two are a Push and one is a Grind**, and `DEFAULT_PLAN` — what a
 * run with no seed gets, which is every headless caller and the card a player
 * saw in the first-look plates — is the **Grind**. The one plan that is checked
 * is the one a quarter of runs get.
 *
 * The stakes are not hypothetical: before `rampWave` was fixed, `_linelength`
 * projected a Push flooring at **45.7 minutes against a card saying 18–25**.
 * The ramp fix is believed to have made all three fit. Only one of them has
 * ever been fought.
 *
 *   node --import ./tools/register.mjs tools/_planlength.mjs [planId] [seeds]
 *
 *   node --import ./tools/register.mjs tools/_planlength.mjs push 1,3,4
 *   node --import ./tools/register.mjs tools/_planlength.mjs grind 2,5
 *
 * WHAT IT IS. Exactly `theline.19`'s drive, lifted out of the gate so it can be
 * afforded: the same fixture, the same `dutyInput` script, the same immortal
 * army on both sides, the same two muster calls in `_areaClear`'s own order.
 * Every rule in that check's header applies here unchanged and is deliberately
 * not restated (HANDOFF §2.4) — read it, then read this.
 *
 * THE ONE DIFFERENCE, and it is the reason this is a bench and not a check: the
 * cap. `theline.19` caps the drive at the band's own top so a mode that has
 * drifted long fails fast and cheap. That is right for a gate and wrong for an
 * instrument, because a run that hits the cap reports "over the top" and not
 * BY HOW MUCH — and by how much is the only number that says whether the card
 * needs moving or the ramp does. So the cap here is `--slack`× the top, default
 * 3, and the summary prints the real length whenever the run ends inside it.
 *
 * IT IS A FLOOR, NOT A PREDICTION. Both armies are held on their feet, so this
 * is the fastest this build can clear these waves and a played sitting cannot
 * be shorter. A floor over the top of the band is a promise the mode cannot
 * keep for anybody; a floor under the bottom is the other failure — a mode made
 * short by making the fight trivial — and the summary prints both bars.
 *
 * WALL-CLOCK IS NOT WHAT THIS MEASURES, so it is safe to run on a loaded box
 * (HANDOFF §2.6b). Every number here is game-time off `STEP`.
 */
import './dom-shim.mjs';

const STEP = 1 / 30;
const PLAN = (process.argv[2] || 'push').toLowerCase();
const SLACK = Number(process.env.SLACK || 3);

const { SESSION_PLANS, rollSession } = await import('../src/game/Session.js');
const plan = SESSION_PLANS.find((p) => p.id === PLAN);
if (!plan) {
  console.error(`no such plan '${PLAN}' — have ${SESSION_PLANS.map((p) => p.id).join(', ')}`);
  process.exit(1);
}

/* THE SEEDS ARE DERIVED, NOT TYPED, because `rollSession` owns the mapping and
 * a hand-typed list beside it is the defect this repository names in §2.3. A
 * seed given on the command line is still checked against the same function, so
 * a run can never time one plan against another's band. */
function seedsFor(id, n) {
  const out = [];
  for (let s = 1; out.length < n && s < 4000; s++) if (rollSession(s).id === id) out.push(s);
  return out;
}
const SEEDS = process.argv[3]
  ? process.argv[3].split(',').map(Number)
  : seedsFor(PLAN, 3);

const { bootWorld } = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');

const [lo, hi] = plan.minutes;
console.log(`${plan.name} — ${plan.engagements} engagements, card says ${lo}–${hi} min`);
console.log(`seeds ${SEEDS.join(',')}   cap ${(hi * SLACK).toFixed(0)} min (${SLACK}× the top)\n`);

const rows = [];
for (const seed of SEEDS) {
  if (rollSession(seed).id !== PLAN) {
    console.log(`  seed ${seed}  SKIPPED — rolls a ${rollSession(seed).id}, not a ${PLAN}`);
    continue;
  }
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'theline', level: 'geonosis', order: 'jedi' },
    runSeed: seed,
  });
  const d = world.command;
  d.start(1);
  /* A no-op `onMuster` is what a player's screen is to the director; without it
   * `_areaClear` spends nothing and the drive walks into the last engagement
   * with the line it landed with. `theline.19`'s note has the whole argument. */
  d.onMuster = () => {};
  const input = dutyInput(world);

  let t = 0, over = null, waves = 0, wave = d.wave;
  const marks = [];
  world.onGameOver = (s) => { over = s; };
  const capSteps = (hi * SLACK * 60) / STEP;
  try {
    for (let i = 0; i < capSteps && !over; i++) {
      input.tick(STEP);
      if (world.player) world.player.hp = world.player.maxHp;
      for (const tr of d.roster.all) if (tr.alive && tr.body && !tr.body.dead) tr.body.hp = tr.body.maxHp;
      world.update(STEP, input); t += STEP;
      if (d.mustering) { marks.push(t); d.autoMuster(); d.closeMuster(); }
      if (d.wave !== wave) { waves++; wave = d.wave; }
    }
  } finally { world.unload(); }

  const mins = t / 60;
  const per = marks.map((m, k) => ((m - (marks[k - 1] || 0)) / 60).toFixed(1)).join('/');
  rows.push({ seed, mins, over: !!over, waves, per });
  console.log(`  seed ${seed}  ${over ? mins.toFixed(1) + ' min' : 'DID NOT END by ' + mins.toFixed(1)}`
    + `  ${waves} waves  engagements ${per || '—'}`
    + `  ${over ? (mins > hi ? `OVER by ${(mins - hi).toFixed(1)}` : mins < lo / 2 ? `UNDER (< ${(lo / 2).toFixed(1)})` : 'inside') : ''}`);
}

const done = rows.filter((r) => r.over);
const mean = (a) => a.reduce((n, x) => n + x, 0) / Math.max(1, a.length);
console.log(`\n${plan.name}: ${done.length}/${rows.length} ended`
  + (done.length ? `  mean ${mean(done.map((r) => r.mins)).toFixed(1)} min`
    + `  worst ${Math.max(...done.map((r) => r.mins)).toFixed(1)}`
    + `  card ${lo}–${hi}` : ''));
const over = done.filter((r) => r.mins > hi);
if (rows.length - done.length) console.log(`  ${rows.length - done.length} run(s) never ended inside ${(hi * SLACK).toFixed(0)} min — the card is unkeepable for those seeds`);
if (over.length) console.log(`  ${over.length} run(s) over the card's top: ${over.map((r) => r.seed + '@' + r.mins.toFixed(1)).join(', ')}`);
if (!over.length && done.length === rows.length) console.log(`  every seed landed inside the band its own card prints`);
