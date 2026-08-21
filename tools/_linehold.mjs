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
 *
 * ── HOW TO COMPARE TWO BUILDS WITH THIS, AND IT IS NOT OBVIOUS ───────────
 *
 * `World.js` holds ONE module-level `rng` for the whole process and exports no
 * reseeder — `const rng = makeRng(moduleSeed(2))` — so a run's stream position
 * is whatever every draw before it left behind. The per-run reseeding below
 * reaches `enemyRng` and `Waves`' stream and cannot reach that one. Three
 * consequences, each of which cost a wrong conclusion before it was written
 * down:
 *
 *   BOTH ARMS FROM FRESH PROCESSES, one invocation each, same seed list. Two
 *     arms inside one process are not comparable: the second starts wherever
 *     the first stopped.
 *
 *   NEVER COMPARE ACROSS MODE STRINGS. A crossing rolls a session plan
 *     (`rollSession`) and Command does not, so `theline` and `command` diverge
 *     on the first draw and stay diverged. The same director and the same
 *     change read 5.4 and 3.0 purely on that. Compare theline against theline.
 *
 *   PIN THE CONTOURS. `LEVELS.geonosis.battlefield` raises a generated
 *     heightfield per run seed, which is a second variable inside a number
 *     whose standard deviation is already three.
 *
 * AND THE QUANTITY IS CHAOTIC, NOT MERELY NOISY. Two arms differing ONLY in
 * one bolt's damage — 10 against 5 — took the same seed from 5 survivors to 1
 * and the next seed from 1 to 5. A perturbation of a few hit points diverges
 * the whole engagement inside seconds, so a per-seed pair means nothing and
 * only the mean over many seeds does. Five seeds carry a standard error near
 * 1.3 on a ten-man roster; twenty carry about 0.65. Budget accordingly, and
 * treat any difference under about 1.5 men at five seeds as unmeasured.
 */
import './dom-shim.mjs';
const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { enemyRng } = await import('../src/game/Enemy.js');
const { seedWaves } = await import('../src/game/Waves.js');
const { seedWorld } = await import('../src/game/World.js');

const STEP = 1 / 30;
const CAP = 600;                                  // game-seconds before we call it stuck
const mode = process.argv[2] || 'theline';
const seeds = (process.argv[3] || '1,2,3,5,7').split(',').map(Number);
const arms = (process.argv[4] || 'none,idle,blade').split(',');
const level = process.argv[5] || 'geonosis';
/**
 * WHICH ENGAGEMENT, 1-based. Engagement 1 is the cheap end of the sitting —
 * `tools/_linewave.mjs` times an opening wave at 81 s and a late one at 606 —
 * so a survival rate tuned on it is a rate at the one place nobody dies. This
 * stands a FRESH ten-man line at the top of a later stage: no promotions, no
 * replacements, no accumulated dead, which is not what a real run arrives with
 * and is exactly what makes two engagements comparable.
 */
const at = Math.max(1, Number(process.argv[6] || 1));

/** The run's clock, read by the wave-timing hook below. One per run. */
let tNow = 0;

/**
 * EVERY RUN STARTS FROM A STATED PHASE, and the first cut of this bench did
 * not — which cost a whole afternoon's comparability.
 *
 * `Enemy.js` and `Waves.js` each hold ONE module-level stream for the whole
 * process (`enemyRng`, and `Waves`' own), so run five of a sweep begins
 * wherever run four left off. Two runs of the same arm at the same seed, from
 * two processes, came back 201 s and 155 s — same code, same seed, different
 * history — because a code edit anywhere above changed how much of those
 * streams module init and the earlier runs had drawn. A bench whose answer
 * depends on what ran before it cannot compare a before against an after,
 * which is the only thing this bench exists to do.
 *
 * XORed with a large constant rather than seeded with 1, 2, 3: adjacent small
 * seeds put a linear-congruential-ish stream in nearly the same place, and the
 * seeds this is driven with are literally 1, 2, 3.
 *
 * All THREE module-level streams are covered — `enemyRng`, `Waves`' own, and
 * `World.js`'s, which had no reseeder until this session and is the one whose
 * absence made every cross-process comparison in this file's first afternoon
 * worthless. See `seedWorld`.
 */
const phase = (seed) => {
  enemyRng.seed((20260821 ^ Math.imul(seed, 2654435761)) >>> 0);
  seedWaves((20260821 ^ Math.imul(seed, 40503)) >>> 0);
  /* THE THIRD STREAM, and it is the one that was missing. See `seedWorld` in
   * World.js for what its absence cost: two arms differing only in the mode
   * string read 5.4 and 3.0 of ten on the same change. */
  seedWorld((20260821 ^ Math.imul(seed, 2246822519)) >>> 0);
};

async function run(arm, seed) {
  phase(seed);
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
  /* THE STAGE, AND THE WAVE NUMBER DERIVED FROM THE STAGES RATHER THAN TYPED
   * (HANDOFF §2.4): the run's wave counter at the top of stage k is one plus
   * every wave of every stage before it, which is the same sum `payWave` walks
   * one clear at a time. A typed 7 here would drift the day an area's length
   * moves and nothing would say so. */
  let w0 = 1;
  if (at > 1) {
    d.areaIndex = Math.min(at - 1, d.stages.length - 1);
    for (let i = 0; i < d.areaIndex; i++) w0 += d.stages[i].waves;
  }
  d.start(w0);
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
console.log(`\n${mode} · ${level} · engagement ${at} · n=${seeds.length} seeds`);
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
