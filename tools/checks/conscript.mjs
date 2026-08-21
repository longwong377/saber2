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

/**
 * §6's own pair, as a ratio so it can be checked without a moving player.
 *
 * THE CONSCRIPT'S HALF MOVED, 1.4 -> 0.7, AND IT IS THE ONE NUMBER IN THIS FILE
 * THAT IS NOT §6's ANY MORE. What follows is the whole of why, because a check
 * that quietly re-points at a new target is a check nobody can argue with.
 *
 * §6 prices BOTH of these against A MOVING PLAYER — a player with a guard, a
 * dash and a dive. Until this session that was the only reader there was:
 * `World._boltHitTest` opened its enemy loop with an early-out over every
 * hostile bolt in the game and your own troopers live in `world.enemies`, so
 * no rifle on the other side could touch your army (FLAGSHIP §16.3). The same
 * `damage` field now serves a second case its author never priced — a clone
 * trooper with 46 hit points and a slot to stand in, who cannot dash, dive or
 * block — and the two readings disagree about what the number should be.
 *
 * ── SUPERSEDED IN PART — THE CONTROLLED NUMBER IS AT THE TOP ─────────────
 *
 * Every figure in the note below was taken ACROSS PROCESSES and is therefore
 * not a comparison. `World.js` had no reseeder for its module-level `rng`
 * when they were taken — it has `seedWorld` now — so two runs differing in
 * any earlier draw diverge completely, and `theline` and `command` differ in
 * one because a crossing rolls a session plan and Command does not. The same
 * change read 5.4 and 3.0 of ten on that alone.
 *
 * RE-TAKEN PROPERLY. Both arms from fresh processes, identical module-init
 * phase, `LEVELS.geonosis.battlefield` pinned off in both, the only
 * difference being the two constants this session moved, 20 seeds apiece:
 *
 *     as shipped before this session   1.35 of 10   (sd 1.73)
 *     with both halved                 2.80 of 10   (sd 2.33)
 *                                      +1.45, se 0.65, z 2.24
 *
 * So the lever is real and it is SMALL — and **the target is not met**. The
 * player asked for an engagement fought without the Jedi to cost about half
 * a ten-man line; it costs 7.2 of 10. What the figures below are still good
 * for is the RANKING they establish, which the controlled run does not
 * contradict: the two sources of fire the wave's threat budget never pays
 * for are the two that move this number at all. No single figure in them
 * should be quoted.
 *
 * MEASURED on the case §6 did not price: one engagement of the flagship mode
 * on its own ground, driven to its muster with no Jedi on the field, five seeds
 * (`tools/_linehold.mjs`). Taking the levy off the field moves the survivors
 * from 1.8 of 10 to 4.0 of 10 — **two of the eight names an engagement costs
 * are the weather's**, and the player's target for that engagement is five men
 * left standing. The levy is charged no threat by design and its exemption is
 * argued at length in src/game/Levy.js, every word of it about the PLAYER's two
 * ledgers.
 *
 * WHAT DOES NOT MOVE IS §6's ARGUMENT, and this is the part that makes the
 * halving safe rather than a nerf. §6's answer to a crowd is not damage, it is
 * SUPPRESSION — "the crowd does not kill you. It nails your feet to the floor,
 * and then the four B2s at 5.85 dps each kill you" — and suppression is billed
 * PER BOLT: `GUARD.stamina` is [1.2, 0.4, 0, 0] by grade and an unanswered bolt
 * in the guard cone costs Force. Not one of those numbers reads `damage`. The
 * same forty bodies arrive at the same cadence firing the same bolts and
 * draining the same bar; a conscript is now MORE purely the thing §6 says it
 * is, not less.
 *
 * And the band below still guards what this check was written to guard — its
 * own note says it: "a conscript that drifted to a tenth of a B1 would be
 * harmless furniture, and one that drifted to a B1's equal would be a B1 you
 * get for free." A third of a B1 is neither. The round was 10 against a B1's 9,
 * which is to say the body defined by being worth nothing carried the heaviest
 * small-arms round on the Confederate roster and reached §6's dps ratio by
 * firing fewer, bigger ones — the wrong shape for weather twice over.
 */
const B1_DPS = 2.17, CONSCRIPT_DPS = 0.7;

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

  check('conscript: its gun is a third of a B1\'s, measured on one field', async () => {
    const { mixedLine } = await import('../_beaten.mjs');
    /**
     * §6 PRICES BOTH BODIES AGAINST A MOVING PLAYER — 2.17 dps for a B1 and
     * 1.4 for a conscript. Reproducing "a moving player" inside a check would
     * be a second copy of a movement script, so the RATIO is what is bound:
     * 1.4 / 2.17 = 0.645, which is a fact about two roster rows and survives
     * any harness that measures both the same way.
     *
     * ── AND THE FIRST HARNESS DID NOT MEASURE THEM THE SAME WAY ───────────
     *
     * It booted a world per archetype and compared the two. That is comparing
     * two WORLDS: the same B1 arm read 3.485, 3.468 and 2.805 hp/s over three
     * runs of the identical call — a 24% spread on the control, larger than the
     * difference the check exists to see — because two boots are two dressings,
     * two prop layouts and two skies. It passed twice and then failed in a full
     * gate run at 0.842, which is the worst way for a check to be wrong: green
     * often enough to be believed.
     *
     * `mixedLine` puts four of each on ONE arc, interleaved, shooting one
     * player under one sky, and attributes every point of damage to the body
     * that fired it — off `Player.damage`'s own `source`. There are no longer
     * two arms to differ; there is one measurement with two columns. Measured
     * twice: 0.721 at 90 s and 0.707 at 150 s.
     *
     * THE BAND IS SIZED ON THAT PAIR AND ON THE GAP TO THE TARGET. The shipped
     * conscript sits at 0.71 against §6's 0.645 — a little hotter than asked,
     * and the cadence is not the dial that moves it (1.45 s to 1.62 s between
     * bursts moved it 1.459 to 1.473, inside the noise, because at twelve
     * bodies on one arc line of sight decides how often a rifle speaks). What
     * the check is for is the class staying a class: a conscript that drifted
     * to a tenth of a B1 would be harmless furniture, and one that drifted to a
     * B1's equal would be a B1 you get for free.
     */
    const r = await mixedLine({ types: ['b1', 'conscript'], each: 4, range: 12, seconds: 90 });
    assert(r.dps.b1 > 0.5,
      `a B1 did ${r.dps.b1} hp/s to a standing player in ${r.seconds}s — the control column is broken`);
    const ratio = r.dps.conscript / r.dps.b1;
    const want = CONSCRIPT_DPS / B1_DPS;
    assert(Math.abs(ratio - want) < 0.12,
      `a conscript does ${ratio.toFixed(3)} of a B1's damage against §6's ${want.toFixed(3)} `
      + `(${r.dps.conscript} hp/s against ${r.dps.b1}, four of each on one field for ${r.seconds}s). `
      + '§6 does not ask for a harmless body: what makes forty of them weather is that killing '
      + 'them pays nothing.');
    return `on one field, ${r.each} of each for ${r.seconds}s: b1 ${r.dps.b1} hp/s · conscript `
      + `${r.dps.conscript} hp/s · ratio ${ratio.toFixed(3)} against §6's ${want.toFixed(3)} → `
      + `${(B1_DPS * ratio).toFixed(2)} dps on §6's own scale`;
  });
}
