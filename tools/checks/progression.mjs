/**
 * SABER — THE RUN, MEASURED END TO END.
 *
 * Every other file that touches this area measures a PIECE of it against a
 * hand-built stand-in: `escalation.mjs` prices waves through a director it
 * constructs itself with no world and no run, `constellation.mjs` models the
 * draft rate as `Math.floor(w / DRAFT_EVERY)` arithmetic, and `run.mjs` reads
 * the ladder as data and main.js as text. Each of those is a fair test of the
 * thing it is about. None of them ever drove THE DESCENT — the one mode in the
 * game that owns a Run, carries boons across a landing, ends in a crown, and is
 * therefore the only place all of these parts have to work together.
 *
 * Nothing under tools/ constructed a director with `mode: 'gauntlet'` before
 * this file. What that blindness was hiding, all of it reproduced here before
 * it was fixed and all of it player-facing:
 *
 *   NO CARDS. `update()` gated the draft on `mode === 'roguelite'`, written
 *   when that was the only mode with boons in it. Measured over twenty-four
 *   waves: roguelite twelve drafts, gauntlet ZERO. The flagship run mode had no
 *   reward loop.
 *
 *   AND IT GOT EASIER GOING DOWN. main.js says `start(1)` on every deploy and a
 *   landing re-enters deploy, so the wave counter restarted four times: budgets
 *   7,11,15 · 7,11,15,21 · 7,11,15,21 · 7,11,15,21,26 — a 53% and then two 67%
 *   DROPS at the three moments the fiction says you went deeper. Everything in
 *   the escalation reads that number, so the whole ladder above wave 5 was
 *   stranded: no droideka (6), no acolyte on three rungs of four (7), no walker
 *   (12), elite chance stuck at 0.066 of its 0.40 ceiling, and the bottom of
 *   the descent fielding B1s and B2s on a level whose pool names an acklay.
 *
 *   AND THE SET-PIECES PAID NOTHING. Drafts land on multiples of 2 and
 *   set-pieces on multiples of 5, so the four-card rare-floor draft the code
 *   configures could only ever have happened on a multiple of 10 — where the
 *   attunement branch returns before `n` and `floor` are read. Measured over
 *   forty waves: zero drafts ever laid out at draftSize 4.
 *
 * The rule this file holds is the one a run needs: EVERY NUMBER A RUN SHOWS OR
 * SPENDS IS THE SAME NUMBER. The wave the HUD prints, the wave the death card
 * reports, the depth the constellation gates on and the depth the run recorded
 * are one quantity, and the pressure that quantity buys only ever goes up.
 */

import * as Waves from '../../src/game/Waves.js';
import { Run, DESCENT, ladderName } from '../../src/game/Run.js';
import { recordRun, loadProgress, clearProgress, progressLines } from '../../src/game/Progress.js';
import * as Tree from '../../src/game/Constellation.js';

/* ── driving a real director ─────────────────────────────────────────── */

/**
 * The smallest world a WaveDirector actually reads. Deliberately not a mock
 * framework, for the reason lifecycle.mjs states about its engine stub: if the
 * director grows a dependency this does not carry, the drive throws and the
 * check says so rather than quietly measuring a stub.
 */
function stubWorld(pool, run = null) {
  return {
    scene: null, statics: [], players: [], enemies: [],
    takenBoons: new Waves.RankSet(), level: { pool }, settings: {}, run,
    spawnEnemy: () => null, notify() {},
  };
}
const CTX = { enemies: [], spawnEnemy: () => null, pickSpawn: () => null };

/** Empty the field so the director declares the wave clear on the next tick. */
function clearWave(d) {
  d.spawnQueue.length = 0;
  d.pending = 0;
  d.update(1 / 60, CTX);          // -> onWaveClear, onDraft, intermission
  if (!d.active) { d.intermission = 1e-3; d.update(2e-3, CTX); }   // -> start(wave+1)
}

/**
 * A whole Descent, exactly as main.js plays one: a fresh World and a fresh
 * director per rung, `start(1)` on every deploy including the landing
 * re-entries, `run.wave` written from `onWaveClear`, and `run.ascend()` when
 * the rung has asked for as many waves as it declares.
 */
async function descend(seed = 0x5EED) {
  const { LEVELS } = await import('../../src/game/Levels.js');
  const run = new Run({ mode: 'spire', seed, identity: { order: 'jedi', species: 'human' } });
  const led = new Tree.Communion();
  const waves = [], drafts = [], depthAgree = [];
  for (let guard = 0; guard < DESCENT.length && !run.done; guard++) {
    const rung = run.rung;
    const pool = LEVELS[rung.level].pool;
    const world = stubWorld(pool, run);
    const d = new Waves.WaveDirector(world, { mode: 'gauntlet', pool });
    d.onDraft = (hand) => drafts.push({
      wave: d.wave, n: hand.length, boss: d.isBossWave(d.wave),
      ids: hand.map((b) => b.id), first: hand[0]?.rarity,
      attune: hand.every((b) => b.attune),
    });
    /**
     * World.js's own two lines, verbatim, and the second is worth stating.
     * `_earnInsight` is handed the SAME rung-local `w` World's handler needs
     * for `run.wave >= rung.waves`, so the ledger counts a Descent's sixteen
     * waves as 18 Insight against the 22 the closed form gives for sixteen
     * waves with three set-pieces in them. Fixing that is one word in World.js
     * (`_earnInsight(this.director.wave)`) and is called out in the handover;
     * this file models what the tree does, not what it should.
     */
    d.onWaveClear = (w) => { run.wave = w; led.earn(w, d.isBossWave(w)); };
    d.start(1);
    for (let i = 0; i < rung.waves; i++) {
      waves.push({
        rung: rung.id, tier: run.tier, local: i + 1, wave: d.wave,
        budget: d.budgetFor(d.wave), boss: d.isBossWave(d.wave),
        elite: d.eliteChance(d.wave), heavy: d.heavyBias(d.wave), cap: d.bodyCap(d.wave),
        types: d.spawnQueue.map(Waves.spawnType),
        queue: d.spawnQueue.slice(),
      });
      clearWave(d);
      depthAgree.push({ wave: waves[waves.length - 1].wave, depth: run.depth });
    }
    if (run.wave >= rung.waves) run.ascend();
  }
  return { run, waves, drafts, depthAgree, insight: led.insight };
}

/** Stars an exhaustive search can light on `purse` Insight at `wave`. */
function mostStars(purse, wave) {
  let best = 0, line = [];
  const step = (led, taken, path) => {
    if (path.length > best) { best = path.length; line = path.slice(); }
    for (const s of Tree.STARS) {
      if (!led.canBuy(s.id, taken, wave)) continue;
      const cost = led.costOf(s.id, taken);
      const next = new Tree.Communion({ insight: led.insight, bought: led.bought, earned: led.earned });
      const held = new Waves.RankSet([...taken]);
      if (!next.buy(s.id, held, wave)) continue;
      held.take(s.id);
      step(next, held, [...path, `${s.id}@${cost}`]);
    }
  };
  step(new Tree.Communion({ insight: purse }), new Waves.RankSet(), []);
  return { best, line };
}

export async function run({ check, assert }) {
  const CLIMB = await descend();

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1. The Descent is a run                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('progression: the Descent offers boons, because it is the mode with a run', async () => {
    const { LEVELS } = await import('../../src/game/Levels.js');
    // Not "gauntlet is in a list" — a real director, driven, counting the hands
    // it actually laid out. The mode that owns a Run must be a mode that drafts.
    const seen = {};
    for (const mode of ['gauntlet', 'roguelite', 'waves', 'duel']) {
      const world = stubWorld(LEVELS.foundry.pool);
      const d = new Waves.WaveDirector(world, { mode, pool: world.level.pool });
      let n = 0;
      d.onDraft = () => n++;
      d.start(1);
      for (let i = 0; i < 24; i++) clearWave(d);
      seen[mode] = n;
    }
    assert(seen.gauntlet > 0,
      `the Descent laid out ${seen.gauntlet} drafts in twenty-four waves — the only mode with a run, `
      + 'a landing, a boon replay and a crown hands out no cards at all');
    assert(seen.gauntlet === seen.roguelite,
      `gauntlet drafted ${seen.gauntlet} times and roguelite ${seen.roguelite} — `
      + 'the two run modes are on different cadences');
    assert(seen.waves === 0 && seen.duel === 0,
      `the undecorated modes drafted (waves ${seen.waves}, duel ${seen.duel})`);
    /*
     * …AND NEVER ON THE WAVE THAT ENDS A RUNG. main.js raises the landing card,
     * the crown and the draft through the same `Screens.take`, and `take`
     * replaces what is on the screen: a draft on the last wave of the deeps
     * covers the crown with a card whose answer calls `resume()` on a finished
     * run, and the player is left standing in a dark room that has nothing left
     * to fight. The last wave of the Descent is an even wave, so this is one
     * frame away from happening every single time a run is won.
     */
    const enders = new Set();
    for (let i = 0, w = 0; i < DESCENT.length; i++) enders.add(w += DESCENT[i].waves);
    const onEnder = CLIMB.drafts.filter((d) => enders.has(d.wave));
    assert(!onEnder.length,
      `a draft was offered on wave ${onEnder.map((d) => d.wave).join(', ')}, which ends a rung — `
      + 'it replaces the landing card the run needs to continue through');
    // …and the same fact stated where a reader would look for it.
    assert(Waves.DRAFT_MODES.includes('gauntlet') && Waves.DRAFT_MODES.includes('roguelite'),
      'the draft is gated on an equality again instead of the declared list');
    return `over 24 waves: gauntlet ${seen.gauntlet}, roguelite ${seen.roguelite}, `
      + `waves ${seen.waves}, duel ${seen.duel}; the real climb drew ${CLIMB.drafts.length} hands in `
      + `${CLIMB.waves.length} waves`;
  });

  check('progression: a landing goes DOWN — the pressure never restarts', () => {
    const w = CLIMB.waves;
    assert(w.length === DESCENT.reduce((n, r) => n + r.waves, 0),
      `a full climb composed ${w.length} waves against a ladder of ` +
      DESCENT.reduce((n, r) => n + r.waves, 0));
    // The wave NUMBERS are the run's, not the rung's: 1..16, no repeats.
    for (let i = 0; i < w.length; i++) {
      assert(w[i].wave === i + 1,
        `wave ${i + 1} of the climb composed itself as wave ${w[i].wave} — `
        + `the ${w[i].rung} restarted the counter at ${w[i].local}`);
    }
    // …and the pressure that buys is strictly monotone ACROSS the landings,
    // which is the property the counter reset destroyed. The three drops were
    // 15→7, 21→7 and 21→7.
    let worst = 0, worstAt = '';
    for (let i = 1; i < w.length; i++) {
      const drop = (w[i - 1].budget - w[i].budget) / w[i - 1].budget;
      if (drop > worst) { worst = drop; worstAt = `${w[i - 1].rung}→${w[i].rung}`; }
      assert(w[i].budget > w[i - 1].budget,
        `the budget fell ${w[i - 1].budget} → ${w[i].budget} between wave ${w[i - 1].wave} `
        + `(${w[i - 1].rung}) and wave ${w[i].wave} (${w[i].rung})`);
    }
    assert(worst <= 0, `the deepest drop was ${(worst * 100).toFixed(0)}% at ${worstAt}`);
    // And the escalation dials the budget feeds actually move off their floors.
    const last = w[w.length - 1], first = w[0];
    assert(last.elite > first.elite * 4 && last.elite > 0.2,
      `elite chance reached only ${last.elite.toFixed(3)} at the bottom of the climb`);
    assert(last.heavy > 0.3, `the heavy bias reached only ${last.heavy.toFixed(3)}`);
    assert(last.cap > Waves.BODY_KNEE,
      `the body cap reached ${last.cap}, under BODY_KNEE ${Waves.BODY_KNEE} — the run ends before `
      + 'the count ever saturates, so the second half of the escalation never runs');
    return `budgets ${w.map((x) => x.budget).join(',')}; elite ${first.elite.toFixed(3)}→`
      + `${last.elite.toFixed(3)}, heavyBias →${last.heavy.toFixed(3)}, bodyCap →${last.cap}`;
  });

  check('progression: the bottom of the Descent fields what its level brought', async () => {
    const { LEVELS } = await import('../../src/game/Levels.js');
    // What each rung can EVER field, taken from the real composed queues rather
    // than from `unlockedAt` — a type on the unlock list that the pick never
    // reaches is the same wrong answer as one that is not on it.
    const byRung = new Map();
    for (const w of CLIMB.waves) {
      const set = byRung.get(w.rung) || byRung.set(w.rung, new Set()).get(w.rung);
      for (const t of w.types) set.add(t);
    }
    const rows = [];
    for (const rung of DESCENT) {
      const pool = new Set(LEVELS[rung.level].pool);
      const saw = byRung.get(rung.id) || new Set();
      const never = [...pool].filter((t) => !saw.has(t));
      rows.push(`${rung.id} saw ${saw.size}/${pool.size}${never.length ? ` (never ${never.join(',')})` : ''}`);
    }
    const deeps = byRung.get('deeps') || new Set();
    assert(deeps.has('acolyte') && deeps.has('droideka'),
      `the deeps fielded ${[...deeps].join(',')} — the fill never reaches the roster its own pool names`);
    assert(deeps.has('walker'),
      'no walker ever reached the bottom of the Descent — the walker unlocks at wave 12 and a '
      + 'rung-local counter never got there');
    // THE CLIMAX. The set-piece ladder gates the acklay at wave 20 and the whole
    // Descent is sixteen waves, so the bottom's set-piece was two acolytes —
    // the identical pair wave 5 opens with. `DESCENT[3].boss` is the flag that
    // says otherwise, and it had no reader anywhere in src/.
    const bossWaves = CLIMB.waves.filter((w) => w.tier === DESCENT.length - 1 && w.boss);
    assert(bossWaves.length, 'the bottom rung has no set-piece wave at all');
    const climax = new Set(bossWaves.flatMap((w) => w.types));
    assert(climax.has('beast'),
      `the climax of the Descent fielded [${[...climax].join(' ')}] — no acklay, on the one rung `
      + 'that declares itself the boss rung and a level whose pool names one');
    return `${rows.join('; ')}; climax fields ${[...climax].join(' ')}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2. One number for the whole run                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('progression: the wave a run shows is the wave a run reached', () => {
    // World packs `wave: this.director.wave` into the gameOver stats and main.js
    // prints it as "Wave reached", while the landing card prints `run.depth` and
    // the crown prints `run.depth`. Those were two different numbers: a run that
    // died on the last wave of the deeps reported 5 against a depth of 16.
    for (const { wave, depth } of CLIMB.depthAgree) {
      assert(wave === depth,
        `the director says wave ${wave} and the run says depth ${depth} — a death here `
        + `under-reports the climb by ${depth - wave} waves`);
    }
    const deepest = CLIMB.depthAgree[CLIMB.depthAgree.length - 1];
    assert(deepest.depth === DESCENT.reduce((n, r) => n + r.waves, 0),
      `a full climb finished at depth ${deepest.depth}`);
    // …and the run's own bookkeeping still counts a rung locally, or World's
    // `run.wave >= rung.waves` would end the foundry after one wave.
    assert(CLIMB.run.wave <= DESCENT[DESCENT.length - 1].waves,
      `run.wave holds ${CLIMB.run.wave}, which is not a count of waves on one rung`);
    assert(CLIMB.run.floor + CLIMB.run.wave === CLIMB.run.depth, 'depth is no longer floor + rung');
    return `director.wave === run.depth at all ${CLIMB.depthAgree.length} clears, `
      + `ending at ${deepest.depth}; run.wave ${CLIMB.run.wave} on a rung of `
      + `${DESCENT[DESCENT.length - 1].waves}`;
  });

  check('progression: the depth the sky is gated on is a depth the Descent reaches', () => {
    // Every star inherits its card's `minWave`, and main.js asks the ledger with
    // `world.director?.wave ?? 1`. With a rung-local counter that number never
    // exceeded 5, so nine of the forty-five stars — the whole mastery tier plus
    // all three verb-granting techniques — were labelled "not this early in a
    // run" at every moment of every Descent that could be played.
    const deepest = CLIMB.waves[CLIMB.waves.length - 1].wave;
    const gated = (wave) => Tree.STARS.filter((s) => {
      const b = Waves.boonById(s.id);
      return b && wave < (b.minWave ?? 1);
    }).map((s) => s.id);
    const atFive = gated(5), atBottom = gated(deepest);
    assert(atFive.length > 0, 'no star is depth-gated at all, so this measures nothing');
    assert(atBottom.length === 0,
      `${atBottom.length} of ${Tree.STARS.length} stars are still locked by depth at the bottom of `
      + `the Descent (wave ${deepest}): ${atBottom.join(', ')}`);
    // …and the reason it is reachable is the ladder, not a lowered gate.
    assert(Waves.MASTERY_AT > 5,
      'the masteries were made reachable by moving the gate down rather than by climbing to it');
    /*
     * …and the sky has to be somewhere a run can actually spend, on the Insight
     * a real climb really earned. An exhaustive search over all 45 stars with
     * the ledger's own canBuy/costOf, not a greedy cheapest-first walk, which
     * is not obviously optimal.
     */
    const purse = mostStars(CLIMB.insight, deepest);
    assert(purse.best >= 1,
      `${CLIMB.insight} Insight over a whole Descent lights ${purse.best} stars — the constellation `
      + 'is the only reward channel this mode had, and it is unaffordable');
    assert(purse.best <= CLIMB.drafts.length,
      `the tree buys ${purse.best} stars against ${CLIMB.drafts.length} drafted cards — the side `
      + 'channel has become the main one (the bound tools/checks/constellation.mjs holds)');
    return `${atFive.length} stars locked at wave 5, 0 at wave ${deepest}; masteries still gated at `
      + `${Waves.MASTERY_AT}; ${CLIMB.insight} Insight lights at most ${purse.best} `
      + `(${purse.line.join(' ')}) against ${CLIMB.drafts.length} drafts`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3. The drafts a set-piece pays                                    */
  /* ══════════════════════════════════════════════════════════════════ */

  check('progression: a set-piece cleared pays the draft the code configures', async () => {
    const { LEVELS } = await import('../../src/game/Levels.js');
    const world = stubWorld(LEVELS.foundry.pool);
    const d = new Waves.WaveDirector(world, { mode: 'roguelite', pool: world.level.pool });
    const hands = [];
    d.onDraft = (hand) => hands.push({
      wave: d.wave, boss: d.isBossWave(d.wave), n: hand.length,
      first: hand[0]?.rarity, attune: hand.every((b) => b.attune),
    });
    d.start(1);
    for (let i = 0; i < 40; i++) clearWave(d);

    const drafted = new Set(hands.map((h) => h.wave));
    const unpaid = [];
    for (let w = Waves.BOSS_EVERY; w <= 40; w += Waves.BOSS_EVERY) if (!drafted.has(w)) unpaid.push(w);
    assert(!unpaid.length,
      `set-pieces cleared at ${unpaid.join(', ')} paid no draft at all — the comment on the draft `
      + 'call says a set-piece cleared is worth MORE than a wave cleared');

    // The two boss branches, both of which have to be reachable: the wider
    // card draft with a rarity floor, and the attunement choice past it.
    const cards = hands.filter((h) => h.boss && !h.attune);
    const attune = hands.filter((h) => h.boss && h.attune);
    assert(cards.length,
      'every boss draft in forty waves was the five attunements — `draftSize` returning 4 and '
      + '`floor: rare` are dead parameters, and the comment describing them describes nothing');
    assert(attune.length,
      'no boss draft ever offered an attunement — the growth that does not converge is unreachable');
    for (const h of cards) {
      assert(h.n === d.draftSize(h.wave),
        `the boss draft at wave ${h.wave} laid out ${h.n} cards, not draftSize ${d.draftSize(h.wave)}`);
      assert(h.first && h.first !== 'common',
        `the boss draft at wave ${h.wave} opened on a ${h.first} — the rare floor is not applied`);
    }
    for (const h of attune) {
      assert(h.n === Waves.ATTUNEMENTS.length,
        `an attunement draft offered ${h.n} of ${Waves.ATTUNEMENTS.length} axes — a build denied by dice`);
    }
    // The rule is one rule, wherever it is asked from: the co-op relay in
    // main.js computes its own `attune` off a wave sent over the wire, and
    // drawBoons is what stops the two peers drawing different hands.
    const relay = Waves.drawBoons(4, new Waves.RankSet(), Waves.BOSS_EVERY,
      { floor: 'rare', attune: true });
    assert(relay.length === 4 && !relay.every((b) => b.attune),
      `a client asking for the wave-${Waves.BOSS_EVERY} boss draft got ${relay.length} cards `
      + `(attune ${relay.every((b) => b.attune)}) where the host laid out four`);
    return `drafts at ${hands.map((h) => h.wave).join(',')}; ${cards.length} boss card drafts `
      + `(${cards[0].n} wide, opening ${cards[0].first}), ${attune.length} attunement drafts`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  4. The two cards whose second rank was a lie                      */
  /* ══════════════════════════════════════════════════════════════════ */

  /** A body with the real boonMods contract and Player.applyBoon's own ranking. */
  async function subject() {
    const { defaultBoonMods } = await import('../../src/game/Player.js');
    const p = {
      hp: 100, maxHp: 100, stamina: 100, maxStamina: 100, force: 100, maxForce: 100,
      flow: 0, invuln: 0, staggerTimer: 0, kills: 0, deflects: 0, limbsRemoved: 0,
      boons: new Waves.RankSet(), boonMods: defaultBoonMods(), hits: [],
      update() {},
      damage(amount) { this.hits.push(amount); this.hp -= amount; return this.hp <= 0; },
      heal(v) { this.hp = Math.min(this.maxHp, this.hp + v); },
    };
    p.world = { enemies: [], players: [p], difficulty: null, notify() {}, engine: { flash() {} } };
    return p;
  }
  /** Exactly Player.applyBoon: the rank comes from the body, not from the card. */
  function grant(p, id) {
    const b = Waves.boonById(id);
    return b.apply(p, Waves.rankScale(p.boons.take(id))), b;
  }

  check('progression: a rank of Steadfast never makes a heavy blow land for more', async () => {
    const card = Waves.boonById('steadfast');
    const HEAVY = 40;
    const landed = [];
    for (let ranks = 0; ranks <= Waves.maxRank(card) + 1; ranks++) {
      const p = await subject();
      for (let i = 0; i < ranks; i++) grant(p, 'steadfast');
      p.damage(HEAVY, null, null, 'bolt');
      landed.push(p.hits[0]);
    }
    for (let r = 1; r < landed.length; r++) {
      assert(landed[r] <= landed[r - 1] + 1e-9,
        `rank ${r} of Steadfast lands a ${HEAVY}-point blow for ${landed[r].toFixed(2)} against rank `
        + `${r - 1}'s ${landed[r - 1].toFixed(2)} — the player pays a draft slot to take `
        + `${((landed[r] / landed[r - 1] - 1) * 100).toFixed(0)}% MORE damage`);
    }
    assert(landed[1] < landed[0], 'the first rank of Steadfast does nothing to a heavy blow');
    assert(landed[Waves.maxRank(card)] > 0,
      'the capped rank of Steadfast is total immunity to every heavy blow in the game');
    // And it stays a card about the HEAVY ones.
    const p = await subject();
    grant(p, 'steadfast'); grant(p, 'steadfast');
    p.hits.length = 0;
    p.damage(6, null, null, 'bolt');
    assert(p.hits[0] === 6, `a 6-point hit was reduced to ${p.hits[0]} at two ranks`);
    return `a ${HEAVY}-point blow lands as ${landed.map((v) => v.toFixed(2)).join(' → ')} at ranks `
      + `0..${landed.length - 1}; a 6-point hit still lands as 6`;
  });

  check('progression: the second rank of Second Wind is a second save', async () => {
    const card = Waves.boonById('secondwind');
    const survived = [];
    for (let ranks = 0; ranks <= Waves.maxRank(card); ranks++) {
      const p = await subject();
      for (let i = 0; i < ranks; i++) grant(p, 'secondwind');
      let n = 0;
      for (let blow = 0; blow < Waves.maxRank(card) + 2; blow++) {
        p.hp = 40;
        p.damage(500, null, null, 'bolt');
        if (p.hp > 0) n++;
      }
      survived.push(n);
    }
    for (let r = 1; r < survived.length; r++) {
      assert(survived[r] === r,
        `${r} rank${r === 1 ? '' : 's'} of Second Wind survived ${survived[r]} lethal blows in a wave `
        + `— the card stacks to ${Waves.maxRank(card)} and its own comment says why`);
    }
    // The charge comes back at the top of a wave — to the number of ranks HELD.
    const p = await subject();
    grant(p, 'secondwind'); grant(p, 'secondwind');
    p.hp = 40; p.damage(500, null, null, 'bolt');
    assert(p.boonMods.secondWind === 1, `one save spent left ${p.boonMods.secondWind} charges of two`);
    Waves.refreshWaveBoons({ players: [p] });
    assert(p.boonMods.secondWind === 2,
      `the next wave handed back ${p.boonMods.secondWind} charges to a player holding two ranks`);
    // …and NOT to somebody who never bought it.
    const bare = await subject();
    Waves.refreshWaveBoons({ players: [bare] });
    assert(bare.boonMods.secondWind === 0,
      `a player who has never seen the card was handed ${bare.boonMods.secondWind} charges of it`);
    return `lethal blows survived by rank: ${survived.join(' / ')}; two ranks refresh to 2, `
      + 'a player without the card refreshes to 0';
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  5. The numbers a run leaves behind                                */
  /* ══════════════════════════════════════════════════════════════════ */

  check('progression: a seed reproduces a Descent, and a different one does not', async () => {
    const a = await descend(0xA11CE), b = await descend(0xA11CE), c = await descend(0xB0B);
    const shape = (r) => r.waves.map((w) => w.queue.join(' ')).join(' | ');
    assert(shape(a) === shape(b),
      'two runs on the same seed composed different waves — Run.seed says it is "the seed EVERYTHING '
      + 'random in this run derives from", and nothing read it');
    assert(shape(a) !== shape(c), 'two different seeds composed the identical descent');
    // Per RUNG, or every rung of a run replays the rung above it.
    const rungs = new Map();
    for (const w of a.waves) rungs.set(w.rung, [...(rungs.get(w.rung) || []), w.queue.join(' ')]);
    const firsts = [...rungs.values()].map((v) => v[0]);
    assert(new Set(firsts).size === firsts.length,
      `two rungs opened with the identical wave (${firsts.join(' || ')}) — the stream is seeded per `
      + 'RUN, so every rung replays the intake');
    assert(typeof Waves.seedWaves === 'function', 'nothing can put the wave stream on a stated number');

    /**
     * AND THE TWO STREAMS THAT DECIDE WHAT THE WAVE DOES ONCE IT IS THERE.
     *
     * Seeding the composition alone gets you a run that fields the same bodies
     * in the same order and then plays out completely differently: `enemyRng`
     * chooses modifiers, strafe sides and spawn jitter, and `duelRng` chooses
     * forms, attacks, feints and every wind-up length in the game. Both were
     * built from `Math.random()` at module load, so "the seed EVERYTHING random
     * in this run derives from" derived about a third of it.
     *
     * Measured on the streams themselves rather than on a fight, because a
     * fight is the thing that would be non-reproducible if this regressed.
     */
    const { enemyRng } = await import('../../src/game/Enemy.js');
    const { duelRng } = await import('../../src/game/Duel.js');
    const draws = (rng, n = 8) => Array.from({ length: n }, () => rng().toFixed(6)).join(',');
    await descend(0xA11CE);
    const e1 = draws(enemyRng), d1 = draws(duelRng);
    await descend(0xA11CE);
    const e2 = draws(enemyRng), d2 = draws(duelRng);
    await descend(0xB0B);
    const e3 = draws(enemyRng), d3 = draws(duelRng);
    assert(e1 === e2,
      'the same seed gave two runs different enemy streams — modifiers, strafe sides and spawn '
      + 'jitter are all off this one, so the run fields the same bodies and then behaves differently');
    assert(d1 === d2,
      'the same seed gave two runs different duel streams — forms, attacks, feints and every '
      + 'wind-up length are off this one');
    assert(e1 !== e3 && d1 !== d3, 'two different seeds gave identical enemy and duel streams');

    /**
     * …AND HOW THEY ARRIVE. The last stream still outside `Run.seed`: which
     * craft comes, where it sets down, the bearing it flies in on and how the
     * squad spills out of it were all off a module-load constant. So a seeded
     * Descent replayed its waves and its choreography and then had different
     * things fly in.
     *
     * Driven through `_sitePoint`, which is the function that consumes the
     * stream — a bearing and a radius per call — rather than through a probe
     * of the rng, because the rng is module-private and a probe of it would
     * not prove that the DIRECTOR draws from the one being seeded.
     *
     * And measured from an ALREADY-USED stream. A module-level generator is
     * never reset, so each run inherits wherever the last one left it: a fix
     * that seeded only at page load would pass a test that starts clean and
     * fail in the second run of a session. The `descend` calls above have
     * advanced it before this line is reached.
     */
    const THREE = await import('three');
    const { ArrivalDirector, seedArrivals } = await import('../../src/game/Arrivals.js');
    assert(typeof seedArrivals === 'function',
      'Arrivals.js exports no seeder, so the arrival stream cannot be put on the run\'s number');
    const stubWorld = {
      terrain: { height: () => 0, inBounds: () => true, slopeAt: () => 0, half: 200 },
      players: [{ position: new THREE.Vector3(0, 0, 0), alive: true }],
      scene: new THREE.Scene(), level: {}, enemies: [],
    };
    /* THROUGH A REAL WaveDirector, not through `seedArrivals` directly.
     * The first version of this called the seeder itself and passed with the
     * call site deleted from WaveDirector's constructor — it proved the seeder
     * worked and nothing about the wiring, which is the whole defect. The
     * subject is "does building a run put the arrival stream on the run's
     * number", so a run has to be built. */
    const sites = (seed) => {
      seedArrivals(999);                 // move the stream somewhere else first
      const runWorld = { run: { seed, tier: 0, done: false }, players: [], enemies: [] };
      new Waves.WaveDirector(runWorld, { mode: 'gauntlet', pool: ['b1', 'trooper'] });
      const d = new ArrivalDirector(stubWorld);
      const out = [];
      for (let i = 0; i < 12; i++) {
        const v = new THREE.Vector3();
        d._sitePoint(40, 70, v);
        out.push(`${v.x.toFixed(3)},${v.z.toFixed(3)}`);
      }
      return out.join('|');
    };
    const s1 = sites(0xA11CE), s2 = sites(0xA11CE), s3 = sites(0xB0B);
    assert(s1 === s2,
      'the same seed put two runs\' landing craft down in different places — the arrival stream is '
      + 'still on its module-load constant, so a replayed run has different things fly into it');
    assert(s1 !== s3, 'two different seeds chose identical landing sites');
    return `seed 0xA11CE reproduced ${a.waves.length} waves exactly, and the enemy and duel `
      + `streams with them; 0xB0B differed in all three; ${firsts.length} rungs, `
      + `${new Set(firsts).size} distinct openings`;
  });

  check('progression: every field a finished run records is read by something', () => {
    const store = {};
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    };
    try {
      clearProgress();
      const r = new Run({ mode: 'spire', seed: 424242, identity: { order: 'sith', species: 'zabrak' } });
      r.tier = DESCENT.length - 1;
      r.wave = DESCENT[DESCENT.length - 1].waves;
      r.score = 91337; r.kills = 61; r.won = true;
      r.communion = { insight: 0, bought: ['cadence', 'celerity'], earned: 22 };
      r.boons = [{ id: 'ataru' }, { id: 'vaapad' }];
      const summary = r.summary();
      assert(summary.seed === 424242 && summary.mode === 'spire',
        'summary() drops the two fields that say WHICH run this was');
      const p = recordRun(summary);

      // The store's own shape is the specification: everything blank() declares
      // is written by recordRun, so everything blank() declares needs a reader.
      const lines = progressLines(p).join('  ');
      const unread = [];
      const shows = (field, needle) => { if (!lines.includes(String(needle))) unread.push(field); };
      shows('bestDepth', p.bestDepth);
      shows('bestScore', Math.floor(p.bestScore).toLocaleString());
      shows('bestTier', DESCENT[p.bestTier].name);
      shows('runs', p.runs);
      shows('kills', p.kills);
      shows('wins', p.wins);
      shows('byOrder', 'sith');
      shows('bySpecies', 'zabrak');
      shows('communed', p.communed);
      shows('crowned', p.crowned.length);
      shows('lit', Object.keys(p.lit).length);
      shows('recent', `seed ${424242}`);
      assert(!unread.length,
        `recordRun writes ${unread.join(', ')} and nothing anywhere reads ${unread.length === 1 ? 'it' : 'them'} — `
        + 'a record nobody can see is a write-only log');
      // The two run flags that were dead in the same way.
      assert(ladderName(p.recent[0].mode) && lines.includes(ladderName(p.recent[0].mode)),
        'the record cannot say which ladder a depth of 16 was climbed on');
      assert(DESCENT.some((rung) => rung.boss), 'nothing on the ladder declares itself the bottom');
      // …and still not a currency: nothing here is spendable and a fresh record
      // still starts every run at zero.
      assert(loadProgress().runs === 1 && !('insight' in p) && !('bought' in p),
        'the record has grown something a run can spend');
      return `${Object.keys(p).length} recorded fields, all read: ${progressLines(p).length} lines, `
        + `deepest ${p.bestDepth} on ${DESCENT[p.bestTier].name}, seed carried`;
    } finally {
      if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
      else delete globalThis.localStorage;
    }
  });

  check('progression: the record is about the game, not about one ladder', async () => {
    // Progress.js opens by saying "you could play for an hour and the game
    // would not know you had ever played. That is the thing being fixed" — and
    // it was fixed for one mode. main.js builds a Run only for `gauntlet`, all
    // three recordRun call sites are gated on that Run, and the menu's default
    // is `roguelite`. This half is the recorder itself: it read `summary.depth`
    // and only a Run has one, so a 23-wave roguelite handed to it verbatim
    // recorded as "deepest 0 waves" — the wiring alone would not have helped.
    const store = {};
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    };
    try {
      clearProgress();
      // EXACTLY the object World packs into onGameOver, plus the two things
      // main.js is holding at that moment.
      const stats = { wave: 23, score: 41200, kills: 190, deflects: 88, perfects: 12, limbs: 140 };
      const p = recordRun({ ...stats, mode: 'roguelite', boons: ['ataru', 'vaapad'],
        identity: { order: 'jedi', species: 'human' } });
      assert(p.bestDepth === 23,
        `a 23-wave roguelite recorded as "deepest ${p.bestDepth} waves" — the recorder reads the `
        + 'field only a Run has, so the four modes without one cannot be written down');
      assert(p.byOrder.jedi === 23 && p.bySpecies.human === 23,
        `it recorded ${p.byOrder.jedi}/${p.bySpecies.human} for what the run was played WITH`);
      assert(p.byMode?.roguelite === 23, 'the record cannot say which mode a depth was reached in');
      assert(Object.keys(p.lit).length === 2, 'the sky-you-have-walked history stayed empty');
      const lines = progressLines(p).join('  ');
      assert(!lines.includes('No runs yet') && lines.includes('23'),
        `the menu's record line reads "${lines}" after a 23-wave run`);
      // …and a Descent still records exactly as it did, on the same store.
      const climb = new Run({ mode: 'spire', identity: { order: 'sith', species: 'zabrak' } });
      climb.tier = DESCENT.length - 1; climb.wave = DESCENT[DESCENT.length - 1].waves; climb.won = true;
      const q = recordRun(climb.summary());
      assert(q.runs === 2 && q.wins === 1 && q.byMode.spire === climb.depth,
        `two modes on one record read runs ${q.runs}, wins ${q.wins}, spire ${q.byMode.spire}`);
      // A room with a slider and a lesson nothing can kill you in are not runs:
      // "deepest 99 waves" typed into a box is worse than no record at all.
      for (const mode of ['training', 'sandbox']) {
        const before = loadProgress().runs;
        const after = recordRun({ wave: 99, score: 1, kills: 1, mode }).runs;
        assert(after === before && loadProgress().bestDepth === q.bestDepth,
          `a ${mode} session was recorded as a run (${before} → ${after})`);
      }
      // A bare Run.summary() with no mode at all still records — the callers
      // that hold one must not have to learn a new shape.
      assert(recordRun({ depth: 4, kills: 1 }).runs === 3, 'an unnamed run stopped being recorded');
      return `roguelite 23 waves recorded (deepest ${q.bestDepth}, ${Object.keys(q.byMode).join('+')}); `
        + 'training and sandbox refused; a bare summary still records';
    } finally {
      if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
      else delete globalThis.localStorage;
    }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  6. …and none of it moved the modes that have no run               */
  /* ══════════════════════════════════════════════════════════════════ */

  check('progression: a mode with no run is exactly where it was', async () => {
    const { LEVELS } = await import('../../src/game/Levels.js');
    const world = stubWorld(LEVELS.foundry.pool);
    const d = new Waves.WaveDirector(world, { mode: 'roguelite', pool: world.level.pool });
    assert(d.floor === 0, `a director with no run stands on floor ${d.floor}`);
    d.start(1);
    assert(d.wave === 1, `start(1) with no run began wave ${d.wave}`);
    assert(d.rungWave === d.wave, 'the rung-local and run-wide wave differ without a run');
    // The ramp itself is pinned by escalation.mjs; what is pinned here is that
    // the run machinery cannot reach it.
    const old = (w) => 4 + w * 2.6 + Math.pow(w, 1.62) * 0.65;
    for (const w of [1, 5, 16, 30]) {
      assert(d.budgetFor(w) === Math.floor(old(w) * Math.pow(Waves.BOON_POWER, (w - 1) / 6)),
        `budgetFor(${w}) moved to ${d.budgetFor(w)}`);
    }
    // A Run exists only where main.js makes one; a director that finds a done
    // run must not stand on its floor either.
    const finished = new Run({ mode: 'spire' });
    finished.tier = DESCENT.length - 1; finished.done = true;
    const d2 = new Waves.WaveDirector(stubWorld(LEVELS.foundry.pool, finished),
      { mode: 'gauntlet', pool: LEVELS.foundry.pool });
    assert(d2.floor === 0, `a finished run still lifted the director to floor ${d2.floor}`);
    return 'floor 0, start(1) → wave 1, budget curve unmoved at waves 1/5/16/30';
  });
}
