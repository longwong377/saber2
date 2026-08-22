/**
 * BATTLEFRONT BORZ — WHAT A BOLT SENT HOME IS WORTH. FLAGSHIP §7's second verb.
 *
 *   node --import ./tools/register.mjs tools/_turn.mjs [--seeds 3,5] [--waves 2]
 *
 * ── WHY THIS NUMBER AND NOT ANOTHER ─────────────────────────────────────
 *
 * §7: "TURN — a returned bolt that kills its firer counts on THEIR morale
 * ledger. Every bolt sent home deletes a rifle and breaks a nerve. Only 5%
 * RETURN / 9% PERFECT by speed alone: a hundred hours will not exhaust it."
 *
 * The wiring is proven twice already and neither proof is a price. `tools/
 * checks/break.mjs` shows the shipped bolt path reaches `turnedHome`, and
 * `tools/checks/deflection.mjs` shows that on one rank the extra is exactly one
 * `NERVE.TURNED` a man on top of the ordinary knock. What neither can say is
 * how often the event HAPPENS when nobody is arranging it, and a verb that
 * fires twice a battle is a different design from one that fires forty times.
 *
 * So this drives `_flagship.mjs`'s scripted Jedi — a player who holds guard and
 * fights, and who therefore deflects for real — through real Command waves and
 * counts three things:
 *
 *   how many bolts come off the blade at all;
 *   how many of those RETURNS kill the side that fired them;
 *   and what one of those kills costs the horde's nerve, against what an
 *     ordinary bolt kill costs it.
 *
 * ── HOW THE NERVE IS WEIGHED, AND WHY IT IS NOT READ OFF THE TABLE ──────
 *
 * The cost of a death is measured as the drop in the SUM of every living
 * hostile body's nerve across the one `_boltHitTest` call the death happened
 * in, minus what the corpse itself was carrying. Nerve moves in exactly two
 * places — `nerveTick` once a frame, and the two death paths — so a delta taken
 * across one hit test is the death's own bill and nothing else's.
 *
 * Reading `NERVE.TURNED / NERVE.COMRADE_FELL` instead would restate a rule
 * rather than call it (HANDOFF §2.4) and, worse, would get the answer wrong:
 * the table says 4x and the field says 8.5x, because the two kinds of kill do
 * not happen in the same place. See below.
 *
 * ── THE ANSWER ──────────────────────────────────────────────────────────
 *
 * Geonosis, `knight`, the scripted Jedi, two seeds, two engagements each:
 *
 *     bolts deflected                         206 / 161
 *     of those, returns that killed a droid       9 / 4   (4.4% / 2.5%)
 *     nerve one turned kill takes off the horde     0.880
 *     nerve one ordinary bolt kill takes            0.106
 *
 * So a bolt sent home is worth **8.3x an ordinary casualty** to the rank, and
 * the table only says 4x. The other half is WHERE it happens: a return is
 * thrown from a blade standing in the middle of a formation, so `NERVE.SEE`
 * finds four men on average against about one for an ordinary bolt kill out on
 * the field. `deflection.mjs` separates those two by killing the same body
 * twice on one rank — six witnesses either way, and the extra is exactly one
 * `NERVE.TURNED` a man — so the 8.3x is the crowd and not a double bill. This
 * file is what found the gap worth separating.
 *
 * And six or seven kills in two engagements, out of a hundred deaths and two
 * hundred deflections, is the rarity §7 asks for: 2.5-4.4% of deflections
 * become a rifle deleted and a nerve broken. That is the half of the design
 * that cannot be checked, only counted.
 */

import './dom-shim.mjs';
import { bootWorld } from './checks/_coop.mjs';
import { dutyInput } from './_flagship.mjs';
import { nerveOf } from '../src/game/Nerve.js';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

/** `_flagship.mjs`'s step, for the reason its own note gives. */
const STEP = 1 / 30;
const CAP = 220;

async function run(seed, waves) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'command', level: 'geonosis', order: 'jedi', seed, difficulty: 'knight' },
  });
  world.director.start(1);
  const input = dutyInput(world);

  const S = { deflects: 0, turned: 0, ordinary: 0, nTurned: 0, nOrdinary: 0, deaths: 0 };
  const mine = world.player.team;
  /* THE HORDE'S OWN LEDGER, and only theirs: bodies with a roster record keep
   * their number on the record and `CommandDirector._morale` owns it, so
   * summing your line in here would add a term this probe cannot attribute. */
  const nerve = () => {
    let s = 0;
    for (const e of world.enemies) if (!e.dead && e.team !== mine && !e.trooper) s += nerveOf(e);
    return s;
  };

  const defl = world._onBoltDeflect.bind(world);
  world._onBoltDeflect = (...a) => { S.deflects++; return defl(...a); };

  let died = 0;
  const onKill = world.onEnemyKilled.bind(world);
  world.onEnemyKilled = (...a) => { died++; S.deaths++; return onKill(...a); };

  /* ONE HIT TEST, ONE BILL. `turnedHome` runs INSIDE `_boltHitTest`, after the
   * `damage` that already ran `witnessDeath` — so a delta taken around the
   * whole call catches both halves, which is the quantity a player feels, and
   * catches them without either being restated here.
   *
   * ONLY WHEN THE BODY THAT FELL WAS ONE OF THEIRS, and the first version of
   * this line was not: `onEnemyKilled` fires for your own troopers too — they
   * stand in `world.enemies` — and their nerve lives on a roster record that
   * this sum deliberately does not count. So a clone going down subtracted a
   * record's 0.7 from a sum it had never been part of, and the ordinary-kill
   * column came out at MINUS 0.122 of nerve: a droid dying making the horde
   * braver. A sign that cannot happen is the cheapest kind of tell there is. */
  const hitTest = world._boltHitTest.bind(world);
  world._boltHitTest = (b, from, to) => {
    const before = nerve(), d0 = died;
    const r = hitTest(b, from, to);
    const fell = r && r.victim;
    if (died > d0 && fell && fell.capsules && fell.team !== mine && !fell.trooper) {
      /* Minus what the corpse itself was carrying: it left the sum by dying,
       * and that is not a cost to anybody still standing. */
      const cost = before - nerve() - nerveOf(fell);
      if (b && b.deflected && b.deflector) { S.turned++; S.nTurned += cost; }
      else { S.ordinary++; S.nOrdinary += cost; }
    }
    return r;
  };

  const start = world.director.wave;
  const n = Math.round(CAP * waves / STEP);
  let t = 0;
  for (let i = 0; i < n; i++) {
    input.tick?.(STEP);
    world.update(STEP, input);
    t += STEP;
    if (world.director.wave > start + waves - 1 || world.command.done) break;
  }
  const out = {
    seed, gameSeconds: +t.toFixed(1), waveClears: world.director.wave - start,
    deaths: S.deaths, deflects: S.deflects,
    turnedKills: S.turned, ordinaryBoltKills: S.ordinary,
    turnedShareOfDeflects: S.deflects ? +(S.turned / S.deflects).toFixed(4) : 0,
    nervePerTurnedKill: +(S.nTurned / Math.max(1, S.turned)).toFixed(3),
    nervePerOrdinaryBoltKill: +(S.nOrdinary / Math.max(1, S.ordinary)).toFixed(3),
  };
  world.unload?.();
  return out;
}

const seeds = String(flag('seeds', '3')).split(',').map(Number);
const waves = Number(flag('waves', '2'));
const rows = [];
for (const seed of seeds) {
  const r = await run(seed, waves);
  rows.push(r);
  console.log(`  seed ${String(seed).padStart(3)}  ${String(r.gameSeconds).padStart(6)} s  `
    + `deaths ${String(r.deaths).padStart(3)}  deflects ${String(r.deflects).padStart(4)}  `
    + `turned kills ${String(r.turnedKills).padStart(3)} `
    + `(${(r.turnedShareOfDeflects * 100).toFixed(1)}% of deflects)  `
    + `nerve/turned ${r.nervePerTurnedKill.toFixed(3)}  `
    + `nerve/ordinary ${r.nervePerOrdinaryBoltKill.toFixed(3)}`);
}
const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
const turned = mean((r) => r.nervePerTurnedKill), plain = mean((r) => r.nervePerOrdinaryBoltKill);
console.log(`\n  MEAN ${mean((r) => r.turnedKills).toFixed(1)} turned kills per `
  + `${waves} engagements · a bolt sent home costs the rank ${turned.toFixed(3)} against `
  + `${plain.toFixed(3)} for an ordinary one — ${(turned / Math.max(plain, 1e-9)).toFixed(1)}x`);
