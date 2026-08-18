/**
 * Progression checks — the parts of it that are not a ladder.
 *
 * This suite used to be mostly about THE DESCENT: a `descend()` harness that
 * played a whole climb rung by rung, and eight checks reading the result. The
 * Descent is deleted — three of its four rungs were the three interiors the
 * player named as the worst rooms in the game — and a harness for a mode that
 * does not exist is not a check, it is a fixture.
 *
 * What survives is everything that was never about the ladder: what a cleared
 * set-piece pays into the draft, and the two boon ranks whose arithmetic is
 * the kind that silently inverts. Those are kept rather than deleted with the
 * rest, because the mode they were written beside is not the thing they are
 * about.
 */


import * as Waves from '../../src/game/Waves.js';
import { recordRun, loadProgress, clearProgress, progressLines } from '../../src/game/Progress.js';
import * as Tree from '../../src/game/LivingForce.js';

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

/*
 * `descend()` LIVED HERE AND COULD NOT HAVE RUN.
 *
 * A ninety-line harness that played a whole Descent rung by rung, referring to
 * `Run` and `DESCENT` — two identifiers this file has not imported since the
 * mode was deleted, so calling it would have thrown `ReferenceError` on its
 * first line. Nothing called it. This file's own header says a harness for a
 * mode that does not exist is not a check but a fixture; it survived the cull
 * that wrote that sentence, and it is the same shape as `offenceReport`'s dead
 * `BUILDERS` (HANDOFF §6.1c) — code that reads as a supported path and is not
 * one. `stubWorld` keeps its `run` parameter: it is the smallest world a
 * director reads, and a caller that has a run is entitled to pass it.
 */

/**
 * Facets an exhaustive search can wake on `purse` Insight at `wave`.
 *
 * IT HAD NO CALLER, in a file whose own header is about a harness for a mode
 * that no longer exists being "not a check, it is a fixture". This one is the
 * same shape one step milder: a real, correct search that nothing had ever
 * asked a question. `the Insight curve is a cadence` below is now its caller,
 * and it is the right one — the whole point of an exhaustive optimum is to say
 * what the OBVIOUS play costs you against the best one, which is the only
 * honest way to ask whether an economy punishes the way people actually play.
 *
 * Cost, measured: 7 nodes at wave 10, 295 at 20, 2 603 at 30 and 33 760 at 40,
 * the last of those in 465 ms. It is exponential in the purse and the file
 * calls it once, at one depth.
 */
function mostFacets(purse, wave) {
  let best = 0, line = [];
  const step = (led, taken, path) => {
    if (path.length > best) { best = path.length; line = path.slice(); }
    for (const s of Tree.FACETS) {
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
  check('progression: a set-piece cleared pays the draft the code configures', async () => {
    const { LEVELS } = await import('../../src/game/Levels.js');
    const world = stubWorld(LEVELS.colosseum.pool);
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
  /*  4. The Insight economy, as a cadence rather than a rate           */
  /* ══════════════════════════════════════════════════════════════════ */

  check('progression: Insight arrives as a cadence a player can plan against', () => {
    /**
     * WHAT THE RATE IS, MEASURED, BECAUSE "IT DOES NOT FEEL LIKE IT DOES
     * ANYTHING" IS A CLAIM ABOUT A CADENCE AND NOT ABOUT A RATE.
     *
     * `living-force.mjs` already pins the two bounds that matter to BALANCE —
     * the tree never outgrows the draft beside it, and a Trial run buys about
     * the w/3 growth events its own budget curve is fitted for. Both are
     * shares. Neither of them can see the thing a player actually experiences,
     * which is HOW OFTEN THEY GET TO DECIDE SOMETHING: a currency that pays out
     * once in a run is a reward, and one that pays out every other wave is not
     * a decision. Between those two there is a cadence, and nothing measured
     * it.
     *
     * So this walks the SHIPPED objects — a real `Communion`, a real `RankSet`,
     * `canBuy`/`costOf`/`buy` — forty waves, as the most impatient player
     * possible: buy the cheapest reachable facet the moment it is affordable.
     * Nothing here reimplements the price series or the reachability rule; the
     * arithmetic in `insightAfter` is exercised by living-force.mjs against the
     * ledger, and this one asks the ledger directly.
     *
     * MEASURED, at the shipping tables:
     *
     *   Path of the Blade   5 purchases at waves 7, 11, 17, 25, 33
     *                       gaps 7 · 4 · 6 · 8 · 8
     *   Trial of Waves     12 purchases at waves 3 … 37
     *                       gaps 3 · 1 · 1 · 2 · 3 · 1 · 4 · 4 · 3 · 5 · 4 · 6
     *
     * That is the number the Codex now prints and the Holocron now counts down
     * to, and it is why the fix for the player's note was legibility and not
     * rate: five spends in forty waves is a real cadence, and before this the
     * only place either number appeared was in a comment.
     */
    const walk = (drafts) => {
      const rate = Tree.insightRate(drafts);
      const taken = new Waves.RankSet();
      const led = new Tree.Communion();
      const buys = [];
      for (let w = 1; w <= 40; w++) {
        led.earn(w, w % Waves.BOSS_EVERY === 0, rate);
        for (;;) {
          const open = Tree.FACETS.filter((s) => led.canBuy(s.id, taken, w));
          if (!open.length) break;
          open.sort((a, b) => led.costOf(a.id, taken) - led.costOf(b.id, taken));
          const cost = led.costOf(open[0].id, taken);
          if (!led.buy(open[0].id, taken, w)) break;
          taken.take(open[0].id);
          buys.push({ wave: w, cost, id: open[0].id });
        }
      }
      return buys;
    };

    const path = walk(true);
    const trial = walk(false);

    /* A CADENCE HAS A FLOOR AND A CEILING, and both of them are a statement
     * about the player's attention rather than about the balance. Under the
     * floor the Holocron is a screen you visit twice; over the ceiling it is a
     * vending machine and the draft is not the spine any more. */
    assert(path.length >= 3,
      `a forty-wave run of the drafting mode offers ${path.length} purchase moments — `
      + 'the Holocron is a reward you collect, not an economy you spend in');
    assert(path.length <= 12,
      `a forty-wave run offers ${path.length} purchase moments — at that rate the tree is the `
      + 'spine of the run and the draft is the side channel');

    /* AND THE FIRST ONE HAS TO ARRIVE. Every heart of a current is an epic, and
     * from an empty hand the hearts are the only reachable facets — so in a
     * mode with no draft the opening purchase is priced at the top of the table
     * and a player earning 1 a wave would wait a quarter of the run for it. */
    assert(path[0].wave <= 10,
      `the first facet a run can afford lands at wave ${path[0].wave} — a currency that cannot be `
      + 'spent for a quarter of a run is a number that ticks');
    assert(trial[0].wave < path[0].wave,
      `the mode with no draft opens its first facet at wave ${trial[0].wave} against the drafting `
      + `mode's ${path[0].wave} — the rate that is supposed to be four times larger is not earlier`);

    /* THE WAIT MUST GROW. That is the whole design of an arithmetic price
     * series — a purse kept shut reaches further than one spent — and if the
     * gaps were flat the escalator would not be one. Halves rather than
     * first-against-last, so one long gap in the middle cannot carry it. */
    const gaps = path.slice(1).map((b, i) => b.wave - path[i].wave);
    const half = Math.floor(gaps.length / 2);
    const early = gaps.slice(0, half).reduce((a, b) => a + b, 0) / (half || 1);
    const late = gaps.slice(gaps.length - half).reduce((a, b) => a + b, 0) / (half || 1);
    assert(late >= early,
      `the wait between purchases runs ${early.toFixed(1)} waves early and ${late.toFixed(1)} late — `
      + 'the price escalator is not escalating anything a player would notice');

    /* WHAT THE OBVIOUS PLAY COSTS, against the best play there is.
     *
     * `mostFacets` is an exhaustive search over every buying ORDER on the whole
     * forty-wave purse at once — strictly more freedom than the walk above had,
     * which spent as it earned and was gated by `minWave` on the way. So the
     * optimum is an upper bound by construction and the question is the SIZE OF
     * THE GAP: an economy where buying the cheapest thing you can afford costs
     * you two facets out of five is an economy that punishes the way everybody
     * plays and never says so. Measured: 5 against 5, i.e. impatience costs
     * nothing in COUNT — what saving buys is a different set, which is
     * living-force.mjs's territory and is exactly what the Holocron's footer
     * now states in Insight.
     */
    const purse = Tree.insightAfter(40, Waves.BOSS_EVERY);
    const best = mostFacets(purse, 40);
    assert(path.length >= best.best - 2,
      `spending as you earn wakes ${path.length} facets where the best possible play on the same `
      + `${purse} Insight wakes ${best.best} — the economy punishes the obvious play and nothing `
      + 'in the game warns anybody');

    return `path ${path.length} buys at w${path.map((b) => b.wave).join('/')} `
      + `(gaps ${gaps.join('·')}, ${early.toFixed(1)}→${late.toFixed(1)}); `
      + `trial ${trial.length} buys from w${trial[0].wave}; `
      + `best possible on ${purse} Insight is ${best.best}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  5. The numbers a run leaves behind                                */
  /* ══════════════════════════════════════════════════════════════════ */
}
