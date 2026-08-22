/**
 * ══════════════════════════════════════════════════════════════════════════
 * THIS BENCH DOES NOT REPRODUCE. DO NOT QUOTE A NUMBER FROM IT YET.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * It is committed for the question it asks and for the negative result, not for
 * its output. Identical invocations — same seed, same seconds, same mode, no
 * edit between them that the simulation reads — came back:
 *
 *     two streams pinned    56.4% shooting / 37.5% leashed
 *                           66.7%          / 25.5%
 *     three streams pinned  63.6%          / 30.9%     (+ seedWaves)
 *                           45.3%          / 48.8%
 *     five streams pinned   50.0%          / 48.8%     (+ seedArrivals, seedCommand)
 *
 * Every stream this tree exports a seeder for is pinned above and the spread
 * did not close. So something else in a `theline` drive is not a function of
 * the seed, and until it is found this file's percentages are three draws from
 * an unknown distribution rather than a measurement. HANDOFF §2.5b is the
 * general form; this is a case of it that the listed seeders do not cover.
 *
 * WHERE TO LOOK NEXT, in the order I would try them: `dutyInput` itself (it
 * steers, and where the player stands decides where the horde stands);
 * `seedExtraction`, which is exported and not called here; anything reaching
 * `Math.random` directly rather than through a named stream; and arrival
 * scheduling that keys off a clock rather than a draw. A useful first move is
 * to run two arms and diff the position of body 0 frame by frame until they
 * part — the frame they part on names the subsystem.
 *
 * The question below is still worth answering, and the buckets are still the
 * right buckets. Fix the determinism first.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * WHY YOUR LINE IS NOT SHOOTING — is it the leash, or is it the wave?
 *
 *   node --import ./tools/register.mjs tools/_leash.mjs [seconds] [seed] [mode]
 *
 * `tools/_horde.mjs`'s Command census reported that **troopers spend 73% of
 * their time with no target**, named `CommandDirector.targetFor`'s leash as the
 * suspect, and correctly declined to act on it: 73% is a number about a
 * SITUATION, and two completely different situations produce it.
 *
 *   THE WAVE. A trooper with nothing in range because the horde has not arrived
 *     yet, or is already dead, is a trooper doing exactly what it should. Every
 *     between-waves lull and every arrival flight counts into that 73%.
 *   THE LEASH. A trooper with a live hostile fifty metres away, shooting at it,
 *     that it is not allowed to answer because `targetFor` bounds candidates to
 *     `reachOf(e) * F.leash` of the body's own SLOT. That is the line being
 *     held at attention while it is killed, and it would be a defect of the
 *     first order in a mode whose loss condition is the line.
 *
 * This separates them. Every trooper, every frame, bucketed:
 *
 *     shooting          `targetFor` handed it something
 *     nothing alive     no living hostile anywhere on the field
 *     LEASHED OUT       a living hostile exists and EVERY one of them is
 *                       outside the leash of this body's slot — the only
 *                       refusal `targetFor` actually makes
 *     refused elsewhere a hostile is inside the leash and the body still has
 *                       no target, so something other than the leash said no
 *                       (`morale < REFUSE`, or `_think` not acting on it)
 *
 * The third bucket is the whole question; the fourth is what is left when the
 * answer is no, and it points at a different file.
 *
 * THE BUCKETS ASK EXACTLY WHAT `targetFor` ASKS AND NOTHING MORE. A first draft
 * of this file also required the hostile to be inside `reachOf(e)` of the BODY,
 * which is the trooper's preferred fighting band — and `targetFor` does not
 * test that at all. It reads `reachOf` only to scale the leash. That draft
 * reported 52.4% "out of reach" and 0.1% leashed on the same run, which is a
 * bench inventing a refusal the game does not make and then crediting it for
 * the idle time. §2.4 in an instrument, and the reason the note above says what
 * the leash is measured FROM.
 *
 * IT ALSO PRINTS THE TWO DISTANCES, because a share on its own does not say
 * whether the cure is a bigger number or a different rule: the median range to
 * the nearest hostile on a leashed-out frame, against the leash that refused
 * it.
 *
 * WHAT IT DOES NOT DO. It draws no conclusion about what the leash SHOULD be.
 * `leashFor`'s own note records what the leash is for — a formation that does
 * not hold is not a formation — and `_closing` already lifts it when a wave is
 * down to its last few, after a driven run once stalled for forty-seven
 * game-minutes on two bodies nobody would walk to. A fix that lifts the leash
 * everywhere buys that stall back.
 *
 * Game-time only, so it is safe on a loaded box (HANDOFF §2.6b). One arm per
 * process (§2.11), and the player is `dutyInput` driven through its own tick
 * (§2.5c) — an unticked script is a statue and a statue changes what the horde
 * does.
 */
import './dom-shim.mjs';

const SECONDS = Number(process.argv[2] || 120);
const SEED = Number(process.argv[3] || 1);
const MODE = process.argv[4] || 'theline';
const STEP = 1 / 30;

const H = await import('./checks/_coop.mjs');
const { dutyInput } = await import('./_flagship.mjs');
const { seedWorld } = await import('../src/game/World.js');
const { enemyRng } = await import('../src/game/Enemy.js');
const { FORMATIONS, DEFAULT_FORMATION, LEASH_FLOOR, seedCommand } = await import('../src/game/Command.js');
const { seedWaves } = await import('../src/game/Waves.js');
const { seedArrivals } = await import('../src/game/Arrivals.js');

/**
 * ALL THREE STREAMS, ON THE SAME CONSTANTS `_linehold` AND `_lethality` USE.
 *
 * Two seedings are not enough and this file proved it the hard way: with only
 * `seedWorld` and `enemyRng` pinned, two identical invocations of this bench —
 * same seed, same seconds, same mode, one edit apart that touched nothing the
 * simulation reads — came back **56.4% shooting / 37.5% leashed** and **66.7% /
 * 25.5%**. A swing of twelve points on the quantity the bench exists to report.
 * `seedWaves` is the third stream (HANDOFF §2.5b) and the wave composition is
 * exactly what decides how far away the nearest hostile is.
 *
 * The constants are copied deliberately rather than derived: they are the ones
 * the two benches whose numbers this one is meant to sit beside already use, so
 * a reading here and a reading there are the same draw.
 */
enemyRng.seed((20260821 ^ Math.imul(SEED, 2654435761)) >>> 0);
seedWaves((20260821 ^ Math.imul(SEED, 40503)) >>> 0);
seedWorld((20260821 ^ Math.imul(SEED, 2246822519)) >>> 0);
/* …and the two the two-stream benches do not touch, because this one measures
 * WHERE the horde stands and both of those decide it: `seedArrivals` picks the
 * flight and the drop point, `seedCommand` the roster and its slots. */
seedArrivals((20260821 ^ Math.imul(SEED, 374761393)) >>> 0);
seedCommand((20260821 ^ Math.imul(SEED, 668265263)) >>> 0);
const { world } = await H.bootWorld({
  level: 'geonosis',
  settings: { mode: MODE, level: 'geonosis', order: 'jedi' },
  runSeed: SEED,
});
const d = world.command;
if (!d) { console.error(`mode '${MODE}' built no CommandDirector — nothing to measure`); process.exit(1); }
d.start(1);
/* The muster is what carries a line across an area; without it this measures a
 * roster that only ever shrinks. `_areaClear` makes both calls when no screen
 * is wired, which is what a headless drive is. */
d.onMuster = () => {};
const input = dutyInput(world);

const B = { shooting: 0, nothingAlive: 0, leashed: 0, elsewhere: 0 };
const leashedRange = [];   // metres to the nearest hostile on a leashed-out frame
const leashedLeash = [];   // the leash that refused it
const leashedAt = [];      // …and when, so a standoff can be told from an approach
let bodyFrames = 0, closingFrames = 0;

const hostilesOf = (e) => world.enemies.filter((c) => c && !c.dead && c.alive !== false && c.team !== e.team);

let t = 0;
for (let i = 0; i < SECONDS / STEP && !world.over; i++) {
  input.tick?.(STEP);
  world.update(STEP, input);
  t += STEP;
  if (d.mustering) { d.autoMuster(); d.closeMuster(); }
  /* Sampled at 2 Hz rather than every frame: the buckets are a share and the
   * shares do not move inside 0.5 s, while `hostilesOf` is O(n) per body and
   * this would otherwise be the slowest thing in the process. */
  if (i % 15) continue;

  if (d._closing) closingFrames++;
  for (const tr of d.roster.living) {
    const e = tr.body;
    if (!e || e.dead) continue;
    bodyFrames++;

    const F = FORMATIONS[d.commanderOf(e)?.formation] || FORMATIONS[DEFAULT_FORMATION];
    const leash = d.leashFor(F, e);
    const reach = d.reachOf(e);   // reported, never a bucket test
    const hostiles = hostilesOf(e);

    if (!hostiles.length) { B.nothingAlive++; continue; }
    if (e.target && !e.target.dead) { B.shooting++; continue; }

    /* Asked exactly the way `targetFor` asks it, and only that: candidates are
     * bounded by the leash of the body's own SLOT, and by nothing else. */
    const slot = leash === Infinity ? null : d.slotFor(e, { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
    const ax = slot ? slot.x : e.position.x, az = slot ? slot.z : e.position.z;
    let nearestBody = Infinity, insideLeash = false;
    for (const c of hostiles) {
      const db = Math.hypot(c.position.x - e.position.x, c.position.z - e.position.z);
      if (db < nearestBody) nearestBody = db;
      /* From the SLOT, and against the leash alone — see the note at the top on
       * why the body's own reach is not a second condition here. */
      if (Math.hypot(c.position.x - ax, c.position.z - az) <= leash) insideLeash = true;
    }
    if (!insideLeash) { B.leashed++; leashedRange.push(nearestBody); leashedLeash.push(leash); leashedAt.push(t); }
    else B.elsewhere++;
  }
}
world.unload();

const pc = (n) => bodyFrames ? (100 * n / bodyFrames).toFixed(1) + '%' : '—';
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

console.log('!! NOT REPRODUCIBLE — identical runs of this bench disagree by 20 points.');
console.log('!! Read the header before using any number below. Five streams are pinned and it still moves.');
console.log(`${MODE} seed ${SEED} — ${t.toFixed(0)} game-s, ${bodyFrames} trooper-samples`
  + `  (closing on ${(100 * closingFrames / Math.max(1, Math.ceil(SECONDS / STEP / 15))).toFixed(0)}% of samples)`);
console.log(`  shooting          ${pc(B.shooting)}`);
console.log(`  nothing alive     ${pc(B.nothingAlive)}   (the wave, not the leash)`);
console.log(`  LEASHED OUT       ${pc(B.leashed)}   <- the defect, if it is one`);
console.log(`  refused elsewhere ${pc(B.elsewhere)}   (inside the leash and still no target)`);
if (B.leashed) {
  console.log(`     nearest hostile on those frames: median ${med(leashedRange).toFixed(1)} m`
    + `, against a median leash of ${med(leashedLeash).toFixed(1)} m (floor ${LEASH_FLOOR})`);
  /**
   * AND WHETHER THAT IS AN APPROACH OR A STANDOFF, which is the difference
   * between the leash refusing a body that is on its way in — correct, and the
   * whole reason a formation holds — and refusing one that is going to sit out
   * there shooting. The share alone cannot tell them apart, and neither can the
   * median: a horde that closes and a horde that never does produce the same
   * count of leashed frames if the wave lasts the same time. Split by half of
   * the run instead, which is the cheapest statistic that moves under one and
   * not the other.
   */
  const half = t / 2;
  const early = leashedRange.filter((_, k) => leashedAt[k] < half);
  const late = leashedRange.filter((_, k) => leashedAt[k] >= half);
  if (early.length && late.length) {
    const a = med(early), b = med(late);
    console.log(`     first half ${a.toFixed(1)} m → second half ${b.toFixed(1)} m`
      + `  — ${b < a - 2 ? 'CLOSING (the leash is refusing bodies on their way in)'
        : b > a + 2 ? 'OPENING (they are backing off out of reach)'
        : 'FLAT (a standoff: they sit there and the line is not allowed to answer)'}`);
  }
} else {
  console.log(`     the leash refused nothing this run — the idle time is the wave`);
}
