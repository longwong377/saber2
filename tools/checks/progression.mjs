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

/** Facets an exhaustive search can wake on `purse` Insight at `wave`. */
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
  /*  5. The numbers a run leaves behind                                */
  /* ══════════════════════════════════════════════════════════════════ */
}
