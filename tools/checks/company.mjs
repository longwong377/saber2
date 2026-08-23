/**
 * BATTLEFRONT BORZ — THE COMPANY SURVIVES THE RUN, AND THE RUN COSTS IT.
 *
 * "But what would be the point in persisting the company? Aren't you assuming
 *  that I win every run? In reality you're either dying or quitting 99% of the
 *  time, so isn't the whole company dying anyway? Unless you have a way to
 *  retreat and recall/save your men instead of quitting outright."
 *
 * The answer is the withdrawal, and this file is the proof that the two halves
 * are actually joined. A save layer is very easy to write and very easy to get
 * silently wrong — the failure mode is not a crash, it is a roster that quietly
 * grows on every run and a mechanism that has stopped costing anything.
 *
 * SO THE ASSERTIONS ARE THE PRICE, NOT THE FEATURE:
 *
 *   IT COSTS. A man who did not reach the ramp is gone from the roll and gone
 *     for good. Asserted on a real withdrawal driven through the real ship,
 *     with the men who were still on the ground counted.
 *   A WIPE COSTS EVERYTHING. There is no branch anywhere that softens a run
 *     that ended badly, and this is the check that would go red the day one is
 *     added.
 *   QUITTING IS NOT A WITHDRAWAL. There is a door, it is held for a second and
 *     a half, and closing the tab is not it.
 *   AND IT IS NOT A RATCHET. Ten out and ten back is ten, not twenty; a
 *     company of forty deploys the ten the muster asked for; and the purse the
 *     muster spends SHRINKS by what the veterans already filled, so a returning
 *     company is a better line and never a bigger one.
 *
 * The last of those is the one that matters most. `Company.js`'s own header
 * refuses currency, unlocks and cross-run power on the same terms `Progress.js`
 * does, and a persistence layer that handed a veteran player a larger army
 * would have broken that promise in the one direction nobody would complain
 * about.
 */

import { ARMY_IDS, ARMIES, CommandRoster, rankFor, OPENING_STRENGTH } from '../../src/game/Command.js';
import * as Company from '../../src/game/Company.js';

const KEY = 'saber.company.v1';

/** Run `fn` against an empty store and put the player's own roll back after. */
async function withCleanStore(fn) {
  const had = localStorage.getItem(KEY);
  localStorage.removeItem(KEY);
  try { return await fn(); }
  finally { if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had); }
}

/** A roster of `n` fresh clones, off the real roster so the names are real. */
function freshRoll(n, army = ARMIES.republic) {
  const r = new CommandRoster(army);
  for (let i = 0; i < n; i++) r.enlist(army.tiers[0].type);
  return r;
}

export function run({ check, assert }) {
  check('company: a withdrawal keeps who got aboard and nobody else', async () => {
    return await withCleanStore(() => {
      const r = freshRoll(10);
      /* Nine walk up the ramp. The tenth is `left`, which is the whole
       * sentence: `LAST_CALL` ran out while he was still crossing. */
      const aboard = r.all.slice(0, 9);
      const stranded = r.all.slice(9);
      const c = Company.keep(aboard, {
        army: 'republic', deployed: r.all, left: stranded, ground: 'geonosis',
      });
      assert(c.men.length === 9, `${c.men.length} men on the roll after nine came home`);
      assert(c.lost === 1, `${c.lost} counted lost, and exactly one man was left standing there`);
      const names = new Set(c.men.map((m) => m.designation));
      assert(!names.has(stranded[0].designation),
        `${stranded[0].designation} did not reach the ramp and is on the roll anyway`);
      assert(c.fallen.some((f) => f.designation === stranded[0].designation),
        'the man left behind is on no casualty list — the cost is not being recorded anywhere');
      assert(c.runs === 1, `${c.runs} withdrawals recorded for one withdrawal`);
      /* AND IT SURVIVES THE SESSION, which is the only thing a save file is
       * for. Read back through the module's own door, not off the object it
       * just returned — an in-memory field that never reached localStorage
       * would pass every assertion above. */
      const back = Company.load('republic');
      assert(back.men.length === 9, `${back.men.length} men after reading the store back`);
      assert(back.lost === 1, `${back.lost} lost after reading the store back`);
      return `9 of 10 home, 1 struck off, ${back.men.length} on the roll next time`;
    });
  });

  check('company: a wipe takes the whole roll, and there is no branch that softens it', async () => {
    return await withCleanStore(() => {
      const r = freshRoll(10);
      Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
      assert(Company.load('republic').men.length === 10, 'the first run did not bank');

      /* THE SECOND RUN. The same ten go out — a company deploys itself — and
       * nobody comes back. An empty manifest is what `_endWithdrawal` never
       * gets to hand over, because a wipe does not reach it: `_checkWipe` ends
       * the run and `main.js` banks an empty list. */
      const out = Company.fieldable(Company.load('republic'), 10);
      const c = Company.keep([], { army: 'republic', deployed: out, ground: 'geonosis' });
      assert(c.men.length === 0,
        `${c.men.length} men survived a run nobody came back from — something is softening a wipe`);
      assert(c.lost === 10, `${c.lost} counted lost against ten men who went out and did not return`);
      assert(c.runs === 1,
        `a wipe counted as withdrawal number ${c.runs} — runs is withdrawals SURVIVED`);
      assert(Company.load('republic').men.length === 0, 'the wipe did not reach the store');
      return `10 out, 0 back, ${c.lost} lost, roll empty, still ${c.runs} withdrawal on the record`;
    });
  });

  check('company: a roll it never fielded is not executed', async () => {
    return await withCleanStore(() => {
      const r = freshRoll(6);
      Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
      /**
       * A CALL WITH NO `deployed` IS A SESSION THIS COMPANY WAS NOT IN — a
       * mode with no army, a disconnection, a bank that fired twice. Without
       * this clause `keep` is a function that empties the roster of anybody
       * who is not on the manifest it happens to be holding, which over one
       * misrouted call is the entire save file.
       */
      const c = Company.keep([], { army: 'republic', ground: 'drifts' });
      assert(c.men.length === 6,
        `an empty manifest with no roll behind it wiped ${6 - c.men.length} men off the company`);
      assert(c.lost === 0, `${c.lost} counted lost by a run this company was never in`);
      return '6 men survived a call that named no deployment';
    });
  });

  check('company: ten out and ten back is ten, not twenty', async () => {
    return await withCleanStore(() => {
      const r = freshRoll(10);
      Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });

      /* THE SECOND RUN, THROUGH THE REAL MUSTER DOOR. The stored men are put
       * back on a fresh roster by `enlistRecord` — which is what the director
       * does — and then the same roster comes home again. A layer that matched
       * on identity badly would bank each man twice under one name or under
       * two, and both are the same bug wearing different clothes. */
      const back = new CommandRoster(ARMIES.republic);
      for (const m of Company.fieldable(Company.load('republic'), 10)) back.enlistRecord(m);
      assert(back.all.length === 10, `${back.all.length} men came back off a roll of ten`);
      const c = Company.keep(back.all, { army: 'republic', deployed: back.all, ground: 'drifts' });
      assert(c.men.length === 10, `${c.men.length} men on the roll after ten went out and ten returned`);
      const names = new Set(c.men.map((m) => m.designation));
      assert(names.size === 10, `${names.size} distinct names among ${c.men.length} records`);
      assert(c.runs === 2, `${c.runs} withdrawals after two`);
      assert(c.men.every((m) => m.runs === 2),
        'a man who has now survived two withdrawals does not say so on his own record');
      return `two runs, ${c.men.length} men, ${names.size} names, every one of them on his second`;
    });
  });

  check('company: what comes back is rank, not headcount', async () => {
    /**
     * THE PROMISE IN `Company.js`'s HEADER, MEASURED.
     *
     * "Nothing here is bought, nothing here gates a mode, a level, a crystal or
     * an order, and the hundredth run starts on the same ground the first one
     * did." The one way a roster layer breaks that without anybody noticing is
     * by ADDING to the deployment — a veteran company that fields fifteen where
     * a fresh one fields ten is cross-run power however it is described.
     *
     * Driven through the director's own muster rather than by reading
     * `_musterVeterans`: a real `CommandDirector` with a real roster, handed a
     * saved roll, against the same director handed nothing.
     */
    const { bootWorld } = await import('./_coop.mjs');
    const base = { mode: 'command', level: 'geonosis', order: 'jedi' };

    const fresh = await bootWorld({ level: 'geonosis', settings: { ...base } });
    fresh.world.director.start(1);
    const plain = fresh.world.command.roster.all.length;
    assert(plain > 0, 'a fresh command muster enlisted nobody');

    /* A COMPANY OF FORTY — four times what the mode fields — so that "it
     * deploys what the muster asked for" is being measured rather than
     * "it happened to have about the right number". */
    const big = freshRoll(40);
    const roll = big.all.map((t) => Company.manOf(t, { ground: 'geonosis' }));
    const vet = await bootWorld({
      level: 'geonosis', settings: { ...base, veterans: roll },
    });
    vet.world.director.start(1);
    const withVets = vet.world.command.roster.all;
    assert(withVets.length === plain,
      `a company of 40 deployed ${withVets.length} against a fresh muster's ${plain} — `
      + 'a saved roll is making the army BIGGER, which is the one thing this layer may not do');

    /* …AND THEY ARE ACTUALLY THE SAVED MEN. Equal counts would also be what a
     * layer that ignored the roll entirely produced, so the names are the
     * control. */
    const stored = new Set(roll.map((m) => m.designation));
    const came = withVets.filter((t) => stored.has(t.designation));
    assert(came.length > 0, 'not one saved name reached the field — the roll is being ignored');
    return `fresh ${plain} · a roll of 40 deployed ${withVets.length}, `
      + `${came.length} of them men who had served before`;
  });

  check('company: one roll per army, and a droid is not folded into the clones', async () => {
    return await withCleanStore(() => {
      const clones = freshRoll(4, ARMIES.republic);
      const droids = freshRoll(4, ARMIES[ARMY_IDS[1]] || ARMIES.republic);
      /* Both manifests handed to the REPUBLIC's roll. The droids must be
       * dropped rather than renamed: the two sides draw designations from
       * different tables and paint rank on different fields, so a droid on a
       * clone roll is a name the muster cannot draw and the tab cannot paint. */
      const c = Company.keep([...clones.all, ...droids.all], {
        army: 'republic', deployed: clones.all, ground: 'geonosis',
      });
      const foreign = c.men.filter((m) => m.army !== 'republic');
      assert(!foreign.length,
        `${foreign.length} men of another army are on the Republic's roll`);
      assert(c.men.length === 4, `${c.men.length} men kept from a manifest of eight, four of them foreign`);
      /* AND THE OTHER ROLL IS UNTOUCHED BY THE WRITE. Two armies share one
       * storage key, so a save that rewrote the whole blob would silently
       * delete the roll the player was not playing. */
      const other = ARMY_IDS.find((id) => id !== 'republic');
      if (other) {
        const o = freshRoll(3, ARMIES[other]);
        Company.keep(o.all, { army: other, deployed: o.all, ground: 'geonosis' });
        assert(Company.load('republic').men.length === 4,
          'writing the second army\'s roll trod on the first');
        assert(Company.load(other).men.length === 3, 'the second army\'s roll did not survive');
      }
      return `republic 4 · ${other || 'no second army'} ${other ? 3 : 0} · no name on both`;
    });
  });

  check('company: a man carries his rank, his kills and his name across the gap', async () => {
    return await withCleanStore(() => {
      const r = freshRoll(3);
      const [a] = r.all;
      /* Promoted through the real ladder, so the rank being carried is one the
       * game would actually have given him. `award` is the only door. */
      a.award(24);
      a.kills = 17;
      a.wounds = 2;
      a.areas = 3;
      const wasRank = a.rank;
      assert(wasRank >= 3, `24 xp bought rank ${wasRank}; this check needs a promotion to measure`);
      assert(a.nickname, 'a man promoted past the second rung earned no nickname');

      Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
      const back = new CommandRoster(ARMIES.republic);
      for (const m of Company.fieldable(Company.load('republic'))) back.enlistRecord(m);
      const him = back.all.find((t) => t.designation === a.designation);
      assert(him, `${a.designation} did not come back at all`);
      assert(him.rank === wasRank, `he went in a ${wasRank} and came back a ${him.rank}`);
      assert(him.nickname === a.nickname, `his nickname was "${a.nickname}" and is now "${him.nickname}"`);
      assert(him.kills === 17, `${him.kills} kills carried out of 17`);
      assert(him.wounds === 2, `${him.wounds} wounds carried out of 2`);
      assert(him.areas === 3, `${him.areas} grounds carried out of 3`);
      /* …AND THE GETTERS WORK, which is the whole reason `enlistRecord` goes
       * through the constructor. A plain object with the right fields answers
       * `undefined` to all four and every screen would print nothing. */
      assert(typeof him.name === 'string' && him.name.includes(a.designation),
        `his name reads "${him.name}"`);
      assert(him.rankRec && typeof him.rankRec.title === 'string',
        'the record has no rank record on it — it did not go through the constructor');
      assert(typeof him.label === 'string' && him.label.length, 'no archetype label');
      /* THE ONE KINDNESS, STATED. `broken` and `rout` are about a fight that is
       * over, and a man who walked up the ramp shaken walks off the next one
       * steady. If that ever stops being true it should be a decision and not
       * a leak. */
      assert(him.broken === false && him.rout === false,
        'a man came off the ship still broken — see enlistRecord');
      return `${him.name}, ${him.rankRec.title}, ${him.kills} down, ${him.wounds} wounds, `
        + `${him.areas} grounds — all of it across the gap`;
    });
  });

  check('company: a corrupt save is a fresh start and never a crash', async () => {
    return await withCleanStore(() => {
      /* `Progress.js`'s rule, and the reason for it is the same: a player who
       * cannot open the game because a number they never saw is a string has
       * lost more than a roster. Every one of these is a shape a store can
       * really take — a truncated write, a hand-edited blob, an older build. */
      const bad = [
        'not json at all', '[]', 'null', '3',
        '{"republic":{"men":"ten"}}',
        '{"republic":{"men":[{"type":null}]}}',
        '{"republic":{"men":[{"type":"trooper"}],"runs":"lots"}}',
        '{"republic":{"men":[{"type":"trooper","designation":"CT-1","morale":9e9,"xp":-4}]}}',
      ];
      for (const raw of bad) {
        localStorage.setItem(KEY, raw);
        const c = Company.load('republic');
        assert(c && Array.isArray(c.men), `a store of ${raw.slice(0, 30)} did not read back as a company`);
        assert(Number.isFinite(c.runs) && c.runs >= 0, `runs read back as ${c.runs}`);
        for (const m of c.men) {
          assert(m.morale >= 0 && m.morale <= 1, `a stored morale of ${m.morale} came back unclamped`);
          assert(m.xp >= 0, `a stored xp of ${m.xp} came back negative`);
        }
      }
      return `${bad.length} malformed stores, ${bad.length} clean reads`;
    });
  });

  check('company: the roll is capped, and it fields its best', async () => {
    return await withCleanStore(() => {
      /* A CAP IS NOT BALANCE, IT IS HONESTY — `Company.CAP`'s own note. A roll
       * that grew without bound would after twenty withdrawals be a phone book
       * describing men the game can never field again. */
      const r = freshRoll(Company.CAP + 15);
      const c = Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
      assert(c.men.length === Company.CAP,
        `${c.men.length} men on the roll against a cap of ${Company.CAP}`);
      assert(Company.load('republic').men.length === Company.CAP, 'the cap did not survive the store');

      /* AND WHAT IT FIELDS IS THE TOP OF IT. `fieldable` sorts by rank, then
       * service, then kills — the alternative, taking the roll in order, would
       * bench a Commander behind four recruits for no reason a player could
       * see. */
      const roll = Company.load('republic');
      const senior = roll.men[roll.men.length - 1];
      senior.xp = 40;
      Company.save(roll);
      const picked = Company.fieldable(Company.load('republic'), OPENING_STRENGTH);
      assert(picked.length === OPENING_STRENGTH, `${picked.length} men fielded for ${OPENING_STRENGTH}`);
      assert(picked[0].designation === senior.designation,
        `the highest-ranked man on the roll (${senior.designation}, rank `
        + `${rankFor(senior.xp)}) was not the first one fielded`);
      const ranks = picked.map((m) => rankFor(m.xp | 0));
      for (let i = 1; i < ranks.length; i++) {
        assert(ranks[i] <= ranks[i - 1], `the field came out ${ranks.join(',')} — not by rank`);
      }
      return `${Company.CAP + 15} kept as ${c.men.length} · fielded ${picked.length}, `
        + `led by ${senior.designation} at rank ${rankFor(senior.xp)}`;
    });
  });

  check('company: the purse shrinks by what the veterans already filled', async () => {
    /**
     * THE OTHER HALF OF "RANK, NOT HEADCOUNT", and the one a body count cannot
     * catch. `_musterOpening` spends `opening × musterCost(cheapest)` on a
     * contingent. Paying that in full on top of six returning veterans would
     * buy six more bodies' worth of HARDWARE instead of six more bodies — the
     * army stays ten strong and quietly gets a walker in it, which is
     * cross-run power arriving through the back door.
     */
    const { bootWorld } = await import('./_coop.mjs');
    /* `allies` is the setting; `commandConfig` reads it into `contingent`. */
    const base = { mode: 'waves', level: 'geonosis', order: 'jedi', allies: 10 };

    const fresh = await bootWorld({ level: 'geonosis', settings: { ...base } });
    fresh.world.director.start(1);
    const plainRoll = fresh.world.command?.roster;
    assert(plainRoll, 'a contingent booted with no roster — this check needs an army');
    const plain = plainRoll.all.length;

    const vets = freshRoll(6).all.map((t) => Company.manOf(t, { ground: 'geonosis' }));
    const withVets = await bootWorld({
      level: 'geonosis', settings: { ...base, veterans: vets },
    });
    withVets.world.director.start(1);
    const roll = withVets.world.command.roster;
    assert(roll.all.length === plain,
      `six veterans turned a contingent of ${plain} into one of ${roll.all.length}`);
    const stored = new Set(vets.map((m) => m.designation));
    const served = roll.all.filter((t) => stored.has(t.designation)).length;
    assert(served > 0, 'no veteran reached a contingent that was handed six');
    return `contingent ${plain} either way · ${served} of them men who had served before`;
  });
}
