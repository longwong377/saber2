/**
 * BATTLEFRONT BORZ — THE THIRD BODY CLASS. FLAGSHIP §6's conscript.
 *
 * "6 hp, 1.4 dps, one pass, worth 0 score and 0 Insight. The lawnmower is only
 * a lawnmower when mowing pays. Forty conscripts that pay nothing are weather."
 *
 * The roster had two classes and no third: something you fight and something
 * you fight harder, and BOTH PAY. §7's four verbs are all things a raindrop
 * does instead of killing everything, and none of them can compete with a body
 * that hands out score for walking through it. So the class is defined by a
 * single absence — it is worth nothing — and the checks here are about that
 * absence being complete rather than about the archetype existing.
 *
 * WHAT WENT WRONG THE FIRST TIME, kept because it is the reusable half: `score:
 * 0` on its own does NOT make a body unpaid. `World.onEnemyKilled` hands out
 * war support, Flow, a combo and a kill-feed line beside the score, and a body
 * worth no score that still fed the Flow meter would be worth MORE per second
 * of blade time than a B1. The payout is derived off one field now
 * (`World.paysOut`) and every consequence is asserted below, because the next
 * reward hung on a kill will be hung there too.
 */

import { ARCHETYPES, guardFor } from '../../src/game/Enemy.js';
import { DATABANK, factionOf } from '../../src/game/Databank.js';
import { LEVELS } from '../../src/game/Levels.js';
import { clocked } from './_shared.mjs';

/** §6's own pair, as a ratio so it can be checked without a moving player. */
const B1_DPS = 2.17, CONSCRIPT_DPS = 1.4;

export async function run({ check, assert }) {
  check = await clocked(check);

  check('conscript: the third body class exists, dies to one pass, and is on a level', () => {
    const A = ARCHETYPES.conscript;
    assert(A, 'FLAGSHIP §6 names a third body class and the roster has no `conscript`');
    assert(A.hp === 6, `the conscript has ${A.hp} hp against §6's 6`);
    /* ONE PASS is not an authored flag — `guardFor` decides how many killing
     * cuts a body turns aside, and anything under the hide threshold turns
     * none. Asked of the function rather than restated. */
    assert(guardFor(A) === 0,
      `the conscript turns ${guardFor(A)} killing passes aside — §6 says one pass, and a body that `
      + 'has to be opened first is not something you walk through');
    assert(!A.big && !A.boss && !A.saber, 'the conscript is not line infantry');
    /* REACHABLE. `roster.mjs` holds this line for the whole roster; it is
     * repeated here in the narrow form because a conscript that no pool names
     * is a body class that shipped and cannot be met. */
    const pools = Object.entries(LEVELS).filter(([, L]) => (L.pool || []).includes('conscript'));
    assert(pools.length > 0,
      'no level pool names `conscript`, so the third body class cannot appear in a wave');
    const D = DATABANK.conscript;
    assert(D && factionOf('conscript'),
      'the conscript has no Databank row, so the one page that tells a player it is worth nothing '
      + 'does not exist — and a player who cannot learn that will keep killing them');
    return `${A.hp} hp · ${guardFor(A)} turned passes · ${factionOf('conscript')} · `
      + `on ${pools.map(([k]) => k).join(', ')}`;
  });

  check('conscript: killing one pays NOTHING — no score, no Flow, no combo, no war support', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { paysOut } = await import('../../src/game/World.js');
    assert(paysOut(ARCHETYPES.b1), '`paysOut` says a B1 is worth nothing, so it says nothing at all');
    assert(!paysOut(ARCHETYPES.conscript), 'a conscript pays out');

    const { world } = await bootWorld({ level: 'geonosis', settings: { mode: 'waves', level: 'geonosis' } });
    try {
      const p = world.player;
      /**
       * THE SHIPPED CALLBACK, driven twice with the same source: once with a
       * B1 and once with a conscript. Everything a kill pays is read off the
       * player and the world before and after, so a reward added tomorrow that
       * forgets the gate turns this red — which is the whole reason this is a
       * before/after census rather than four named assertions.
       */
      const census = () => ({
        score: world.score, pScore: p.score, kills: p.kills,
        flow: p.flow, combo: p.combo, support: world.support?.value ?? 0,
      });
      const kill = (type) => {
        const before = census();
        const e = world.spawnEnemy(type, p.position.clone().add({ x: 4, y: 0, z: 0 }));
        assert(e, `${type} would not spawn`);
        e.hp = 0; e.dead = true;
        world.onEnemyKilled(e, p, 'cut');
        const after = census();
        const d = {};
        for (const k of Object.keys(before)) d[k] = +(after[k] - before[k]).toFixed(4);
        return d;
      };

      const b1 = kill('b1');
      assert(b1.score > 0 && b1.pScore > 0 && b1.flow > 0 && b1.combo > 0,
        `killing a B1 paid ${JSON.stringify(b1)} — the control arm pays nothing, so the conscript `
        + 'arm below proves nothing');

      const con = kill('conscript');
      assert(con.score === 0, `a conscript paid ${con.score} to the run's score`);
      assert(con.pScore === 0, `a conscript paid ${con.pScore} to the player's score`);
      assert(con.flow === 0,
        `a conscript paid ${con.flow} Flow — Flow buys Focus, so a body worth no score that still `
        + 'fed the meter would be worth MORE per second of blade time than a B1');
      assert(con.combo === 0, `a conscript paid ${con.combo} combo`);
      assert(con.support === 0,
        `a conscript paid ${con.support} war support — stratagems are bought with it, so mowing a `
        + 'crowd that pays nothing would still be buying orbital fire');
      /* …AND IT IS STILL A BODY THAT DIED. The record is not a reward. */
      assert(con.kills === 1,
        'killing a conscript did not count as a kill at all — the run summary is a record of what '
        + 'happened, and a body that went down went down');
      return `B1 → ${JSON.stringify(b1)} · conscript → ${JSON.stringify(con)}`;
    } finally { world.unload?.(); }
  });

  check('conscript: it is two thirds of a B1\'s gun, measured on the same ground', async () => {
    const { firingLine } = await import('../_beaten.mjs');
    /**
     * §6 PRICES BOTH BODIES AGAINST A MOVING PLAYER — 2.17 dps for a B1 and
     * 1.4 for a conscript. Reproducing "a moving player" inside a check would
     * be a second copy of a movement script, so the RATIO is what is bound:
     * 1.4 / 2.17 = 0.645, which is a fact about two roster rows and survives
     * any harness that measures both the same way.
     *
     * Blade down, one shooter, same range, same seconds. The blade is down
     * because with a guard up what reaches the player is what the guard
     * missed, and that is a measurement of the guard.
     *
     * The band is wide (±0.18 of the ratio) and it is honest rather than lax:
     * two 90-second samples of a stochastic gun land 0.50 and 0.69 apart on
     * the same numbers. What the check is for is the class staying a class —
     * a conscript that drifted to a tenth of a B1 would be harmless furniture,
     * and one that drifted to a B1's equal would be a B1 you get for free.
     */
    const secs = 90;
    const b1 = await firingLine({ n: 1, range: 12, seconds: secs, type: 'b1', guard: false });
    const con = await firingLine({ n: 1, range: 12, seconds: secs, type: 'conscript', guard: false });
    assert(b1.dpsPerRifle > 0.5,
      `a B1 did ${b1.dpsPerRifle} hp/s to a standing player in ${secs}s — the control arm is broken`);
    const ratio = con.dpsPerRifle / b1.dpsPerRifle;
    const want = CONSCRIPT_DPS / B1_DPS;
    assert(Math.abs(ratio - want) < 0.18,
      `a conscript does ${ratio.toFixed(3)} of a B1's damage against §6's ${want.toFixed(3)} `
      + `(${con.dpsPerRifle} hp/s against ${b1.dpsPerRifle}). §6 does not ask for a harmless body: `
      + 'what makes forty of them weather is that killing them pays nothing.');
    return `b1 ${b1.dpsPerRifle} hp/s · conscript ${con.dpsPerRifle} hp/s · ratio ${ratio.toFixed(3)} `
      + `against §6's ${want.toFixed(3)} → ${(B1_DPS * ratio).toFixed(2)} dps on §6's own scale`;
  });
}
