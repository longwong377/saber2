/**
 * BATTLEFRONT BORZ — what a run actually CONTAINS.
 *
 *   node --import ./tools/register.mjs tools/trace.mjs [--waves 20] [--level scoria]
 *   node --import ./tools/register.mjs tools/trace.mjs --json > trace.json
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS, AND WHY IT IS NOT ANOTHER CHECK FILE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 1140 checks and two adversarial audits have one shape between them: the code
 * claims X and does Y. `claims.mjs` is that, by name. A finding needs a line to
 * be wrong about, so an audit can find a broken promise and cannot find an
 * ABSENCE — a hole with nothing in the source pointing at it is invisible to a
 * source sweep. The one absence L6 did find, "nothing draws the target's open
 * state", was only visible because `openness()` already existed and paid 3x.
 * The mechanic pointed at its own missing half.
 *
 * `balance.mjs` is the other instrument, and it answers a different question
 * again — is the game TUNED — under a fixed abstract model of a player. That
 * model never presses a button, so it cannot say whether an ability is worth
 * pressing.
 *
 * This says what a run CONTAINS: what it offers you, what it throws at you,
 * wave by wave, and what the ten powers cost against what a run can pay. It
 * makes no judgements. Every number here is read out of the shipped tables and
 * the shipped composer — the same `WaveDirector._compose` the game runs — so
 * that the judging can happen against facts rather than against a reading of
 * the source.
 *
 * ── THE DISCIPLINE ────────────────────────────────────────────────────────
 *
 * NOTHING IN THIS FILE HAS AN OPINION. No bars, no assertions, no "too few" or
 * "should be". The moment it starts scoring, it becomes a check with a
 * hand-written bar, and this project has spent a session removing exactly that
 * shape — seven hand-maintained tables that drifted from their generated twins,
 * and nineteen magic windows that expired in silence.
 *
 * It also does not model a player. It cannot tell you that force compel is
 * never worth pressing; it can tell you compel costs 34 Force, is gated behind
 * a card, and that the earliest that card was offered across the drafts below
 * is wave N. What that means is somebody else's call.
 */

import '../tools/dom-shim.mjs';
import * as THREE from 'three';

if ((await import('three')) !== THREE) {
  console.error('\n  trace.mjs was started without its module loader.\n\n'
    + '  Run: node --import ./tools/register.mjs tools/trace.mjs\n');
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (n, d) => {
  const eq = args.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const has = (n) => args.includes('--' + n);

const WAVES = parseInt(flag('waves', '20'), 10);
const LEVEL = flag('level', null);
const SEED = parseInt(flag('seed', '1234'), 10);

const {
  WaveDirector, BOONS, ATTUNEMENTS, drawBoons, isAttuneWave,
  seedWaves, RankSet, maxRank, MASTERY_NEEDS, BOSS_EVERY, DRAFT_EVERY,
} = await import('../src/game/Waves.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const { POWER_COST, POWER_BOON } = await import('../src/game/Powers.js');
const { LEVELS, LEVEL_ORDER } = await import('../src/game/Levels.js');
const Tree = await import('../src/game/Constellation.js');

const level = LEVEL || LEVEL_ORDER[0];
if (!LEVELS[level]) {
  console.error(`no level "${level}" — the game lists ${LEVEL_ORDER.join(', ')}`);
  process.exit(2);
}

/* ── the run, composed by the game's own director ───────────────────────── */

seedWaves(SEED);

/**
 * A director with the level's real pool and nothing else stubbed that decides
 * composition. `_compose` is the function the game calls; the queue it fills is
 * the wave you actually fight.
 */
/* `WaveDirector(world, opts)` — TWO arguments, and the first cut of this file
 * passed the options as the first one. `opts` was then empty, `this.pool` fell
 * back to its own default ladder, and every level composed identically: the
 * trace showed 'trooper' and 'acolyte' on a Colosseum whose pool contains
 * neither, and 40 waves of six archetypes out of twenty, which read as a large
 * content hole and was a one-argument mistake in the instrument. The tell was
 * there to be seen — two different levels producing byte-identical
 * composition — and it is the same shape as every harness defect this session:
 * a default answering for a missing thing and being reported as a measurement. */
const stubWorld = { enemies: [], player: null, terrain: null, settings: {}, takenBoons: new Set(), scene: null };
const dir = new WaveDirector(stubWorld, { pool: LEVELS[level].pool });

const waves = [];
for (let w = 1; w <= WAVES; w++) {
  dir.start(w);
  const queue = (dir.spawnQueue ?? []).slice();
  const bodies = queue.map((e) => String(e).split('|')[0]);
  const mods = queue.map((e) => String(e).split('|')[1]).filter(Boolean);
  const counts = {};
  for (const b of bodies) counts[b] = (counts[b] ?? 0) + 1;
  const threat = bodies.reduce((a, b) => a + (ARCHETYPES[b]?.threat ?? 0), 0);
  waves.push({
    wave: w,
    boss: w % BOSS_EVERY === 0,
    attune: isAttuneWave(w),
    bodies: bodies.length,
    threat,
    kinds: Object.keys(counts).length,
    counts,
    mods: mods.length ? mods : undefined,
    budget: dir.budgetFor?.(w),
    heavyLimit: dir.heavyLimit?.(w),
  });
}

/* ── what the run offers ────────────────────────────────────────────────── */

/**
 * A card as the trace reports it: what it is, what it costs the pool, and WHICH
 * AXIS it pulls the build toward. The axis is the field the judges could not
 * see and asked for by name.
 */
const card = (b) => ({
  id: b.id,
  rarity: b.rarity ?? null,
  // Attunements carry a single `attune` axis; boons carry an `axes` array.
  axes: b.attune ? [b.attune] : (b.axes ?? []),
  maxRank: maxRank(b),
});

const taken = new RankSet();
const drafts = [];
for (let w = 1; w <= WAVES; w++) {
  /* THE DIRECTOR'S OWN PREDICATE, not a second copy of the rule.
   *
   * This read `w % DRAFT_EVERY !== 0`, which is a reimplementation — and the
   * shipped `isDraftWave` is `wave % DRAFT_EVERY === 0 || this.isBossWave(wave)`.
   * So this loop emitted no draft on waves 5, 15, 25 and 35, four judges read
   * that as "half the boss waves pay nothing", and I confirmed it by writing the
   * SAME wrong arithmetic a second time in a probe. The game was right
   * throughout. An instrument that restates a rule instead of calling it will
   * eventually disagree with it, and it did so here in the one direction nobody
   * checks: it manufactured a defect rather than hiding one. */
  if (!dir.isDraftWave(w)) continue;
  const attune = isAttuneWave(w);
  const offered = drawBoons(dir.draftSize(w), taken, w, { attune });
  // Take the first offered card, every time. NOT a model of a player — a fixed
  // rule, so the sequence is reproducible and the offers downstream are the
  // offers a run that always took the left-hand card would see.
  const pick = offered[0];
  if (pick) taken.add?.(pick.id) ?? taken.take?.(pick.id);
  drafts.push({
    wave: w,
    attune,
    offered: offered.map(card),
    took: pick ? card(pick) : null,
  });
}

/**
 * WHAT THE RUN IS BECOMING, which the first cut of this file could not say.
 *
 * Every judge that read this trace named the same gap independently: the cards
 * came out as bare `id:rarity` strings, so the single most important question
 * about progression — does a run form a coherent BUILD, or does it accumulate
 * eight unrelated things — was unmeasurable from the output. The axes are on
 * the cards already; nothing was reading them.
 *
 * Counted rather than judged, like everything else here. Three cards on an axis
 * is the game's own `MASTERY_NEEDS`, so a reader can see whether the run ever
 * came near paying that price without this file having an opinion about it.
 */
const axisTally = {};
for (const d of drafts) {
  if (!d.took) continue;
  for (const ax of d.took.axes ?? []) axisTally[ax] = (axisTally[ax] ?? 0) + 1;
  if (d.took.attune) axisTally[d.took.attune] = (axisTally[d.took.attune] ?? 0) + 1;
}

/** The earliest wave each card was OFFERED across the drafts above. */
const firstOffered = {};
for (const d of drafts) {
  for (const o of d.offered) {
    if (firstOffered[o.id] === undefined) firstOffered[o.id] = d.wave;
  }
}

/* ── what the player can spend, against what a run pays ─────────────────── */

const powers = Object.entries(POWER_COST).map(([id, cost]) => ({
  id,
  force: cost,
  gatedBy: POWER_BOON?.[id] ?? null,
  firstOfferedAt: POWER_BOON?.[id]
    ? (Object.entries(firstOffered).find(([bid]) => bid === POWER_BOON[id])?.[1] ?? null)
    : null,
}));

/* ── the sky, and what a run of this length can afford of it ────────────── */

const insight = Tree.insightAfter(WAVES, BOSS_EVERY);
const stars = Tree.STARS?.length ?? 0;
const constellation = (Tree.CONSTELLATIONS ?? []).map((c) => ({
  axis: c.axis,
  root: c.root,
  stars: Tree.starsOf?.(c.axis)?.length ?? null,
}));

/* ── the roster it could all happen on ──────────────────────────────────── */

const levels = LEVEL_ORDER.map((k) => ({
  key: k,
  name: LEVELS[k].name,
  pool: (LEVELS[k].pool ?? []).length,
  sky: LEVELS[k].atmosphere?.sky !== false,
  hazard: LEVELS[k].water?.kind ?? null,
}));

const trace = {
  level, waves: WAVES, seed: SEED,
  bossEvery: BOSS_EVERY, draftEvery: DRAFT_EVERY,
  archetypes: Object.keys(ARCHETYPES).length,
  cards: { boons: BOONS.length, attunements: ATTUNEMENTS.length },
  run: waves,
  drafts,
  firstOffered,
  axisTally,
  powers,
  economy: { insightAfter: insight, starsInSky: stars, constellation },
  levels,
};

if (has('json')) {
  console.log(JSON.stringify(trace, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nSABER — run trace: ${level}, ${WAVES} waves, seed ${SEED}\n`);
  console.log(`  ${Object.keys(ARCHETYPES).length} archetypes · ${BOONS.length} boons + `
    + `${ATTUNEMENTS.length} attunements · ${stars} stars · ${LEVEL_ORDER.length} levels\n`);

  console.log('  WAVE  BODIES  THREAT  KINDS  COMPOSITION');
  for (const w of waves) {
    const tag = w.attune ? ' ATTUNE' : w.boss ? ' BOSS' : '';
    const comp = Object.entries(w.counts).map(([k, n]) => `${n}x${k}`).join(' ');
    console.log(`  ${pad(w.wave + tag, 12)}${pad(w.bodies, 8)}${pad(w.threat, 8)}${pad(w.kinds, 7)}${comp}`);
  }

  console.log('\n  DRAFTS');
  for (const d of drafts) {
    console.log(`  w${pad(d.wave, 4)}${d.attune ? 'ATTUNE  ' : '        '}${d.offered.map((o) => o.id + ':' + o.rarity + '[' + o.axes.join('/') + ']').join('  ')}`);
  }

  console.log('\n  BUILD — cards taken per axis (mastery needs ' + MASTERY_NEEDS + ')');
  const ax = Object.entries(axisTally).sort((a, b) => b[1] - a[1]);
  console.log('  ' + (ax.length ? ax.map(([k, n]) => `${k} ${n}`).join('  ') : '(nothing taken)'));

  console.log('\n  POWERS');
  for (const p of powers) {
    console.log(`  ${pad(p.id, 12)}${pad(p.force + ' Force', 12)}`
      + (p.gatedBy ? `gated by ${p.gatedBy}`
        + (p.firstOfferedAt ? ` (first offered w${p.firstOfferedAt})` : ' (never offered in this run)') : ''));
  }

  console.log(`\n  ECONOMY  ${insight} Insight after ${WAVES} waves`);
  for (const c of constellation) console.log(`  ${pad(c.axis, 10)}${c.stars} stars, root ${c.root}`);

  console.log('\n  LEVELS');
  for (const l of levels) {
    console.log(`  ${pad(l.key, 12)}${pad(l.name, 22)}${pad(l.pool + ' in pool', 14)}`
      + `${l.sky ? 'sky' : 'indoors'}${l.hazard ? ', ' + l.hazard : ''}`);
  }
  console.log('');
}
