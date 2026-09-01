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

import { readFile } from 'node:fs/promises';
import { makeDocument } from './_page.mjs';
import { clocked } from './_shared.mjs';
import { ATTR_IDS, traitById } from '../../src/game/Attributes.js';
/* THE SAME CURRENCY THE TRAIT TABLE IS PRICED IN, imported rather than
 * re-derived. A bond is the one thing on a record a PLAYER can cause, so if it
 * were profitable it would be a ratchet rather than a lottery — and two check
 * files with two copies of the weighting would be free to disagree about it. */
import { priceSwing } from './attributes.mjs';
import {
  ARMY_IDS, ARMIES, CommandRoster, rankFor, OPENING_STRENGTH, RANKS, MARKS, markById,
  musterPlan,
} from '../../src/game/Command.js';
import * as Company from '../../src/game/Company.js';

const KEY = 'saber.company.v1';

/**
 * Run `fn` against an empty store and put the player's own roll back after.
 *
 * SYNCHRONOUS, AND THAT IS LOAD-BEARING. `verify.mjs`'s `check` starts an async
 * body immediately and settles them all at the end, so two async checks in one
 * file run CONCURRENTLY — and the company store is a single localStorage key.
 * An async wrapper would restore whatever the OTHER check had just written, and
 * every clause here would be reading a roll it did not build. A sync body
 * cannot interleave, so it cannot.
 */
function withCleanStore(fn) {
  const had = localStorage.getItem(KEY);
  /* The muster slate rides along: the Company tab's list build calls
   * `Muster.ensure`, which writes `saber.muster.v1` when the plan wants fresh
   * men — so a fixture that cleaned only the company key would leave slate
   * state behind for the next clause to trip over. */
  const hadSlate = localStorage.getItem('saber.muster.v1');
  localStorage.removeItem(KEY);
  localStorage.removeItem('saber.muster.v1');
  try { return fn(); }
  finally {
    if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had);
    if (hadSlate == null) localStorage.removeItem('saber.muster.v1');
    else localStorage.setItem('saber.muster.v1', hadSlate);
  }
}

/** A roster of `n` fresh clones, off the real roster so the names are real. */
function freshRoll(n, army = ARMIES.republic) {
  const r = new CommandRoster(army);
  for (let i = 0; i < n; i++) r.enlist(army.tiers[0].type);
  return r;
}

export async function run({ check, assert }) {
  /**
   * THE PAIR, FOR THE WHOLE FILE. `determinism.mjs` names this file outright —
   * it builds enemies (the mark clause puts two troopers through the real
   * `enlistBody`) and drives a World's frames, and a suite that does either
   * without handing the module clocks back shifts the wind clock and every
   * random stream for every suite after it.
   *
   * It also SERIALISES, which this file needed for its own reasons before
   * `determinism.mjs` asked: `verify.mjs` starts every async body at once, and
   * the company store is a single localStorage key while `doc.install()` swaps
   * a global document. The first cut of this file had a check whose whole
   * subject is an empty roll reading a roll of five men. `withCleanStore` is
   * still synchronous underneath — belt and braces, and its note says why —
   * but the lock is what makes it true rather than lucky.
   */
  check = await clocked(check);
  /**
   * READ ONCE, UP FRONT, so that every DOM clause below can be SYNCHRONOUS.
   *
   * `verify.mjs`'s `check` starts an async body immediately and settles them
   * all at the end — so two async checks in one file run CONCURRENTLY. Both of
   * the things a menu clause needs are global and shared: `doc.install()`
   * swaps `globalThis.document`, and the company store is one localStorage key.
   * An async DOM clause therefore reads whichever page and whichever roll the
   * other one happened to leave installed, which is exactly what the first cut
   * of this file did — a roll of five men on a check whose whole subject is an
   * empty one.
   *
   * Sync bodies cannot interleave, so they cannot. `run` is async so the read
   * can happen before the first `check` is registered; nothing below awaits.
   */
  const INDEX_HTML = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  check('company: a withdrawal keeps who got aboard and nobody else', () => withCleanStore(() => {
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
  }));

  check('company: a wipe takes the whole roll, and there is no branch that softens it', () => withCleanStore(() => {
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
  }));

  check('company: a roll it never fielded is not executed', () => withCleanStore(() => {
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
  }));

  check('company: ten out and ten back is ten, not twenty', () => withCleanStore(() => {
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
  }));

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

  check('company: one roll per army, and a droid is not folded into the clones', () => withCleanStore(() => {
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
  }));

  check('company: a man carries his rank, his kills and his name across the gap', () => withCleanStore(() => {
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
  }));

  check('company: a corrupt save is a fresh start and never a crash', () => withCleanStore(() => {
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
  }));

  check('company: the roll is capped, and it fields its best', () => withCleanStore(() => {
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
  }));

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

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Bonds between men                                                 */
  /* ══════════════════════════════════════════════════════════════════ */

  /**
   * WHY THESE FOUR AND NOT A HAPPY PATH.
   *
   * Everything above this line is about a roll that costs something. A bond is
   * the first thing in this file that GIVES something, which means it is the
   * first thing that can quietly stop costing — and every failure mode it has
   * is silent:
   *
   *   IT FORMS TOO EASILY. A bond every man has after his first withdrawal is
   *     a fact about nobody. There is no symptom; the roster simply prints an
   *     extra line for everyone.
   *   IT DOES NOT SURVIVE, or a hand-edited save hands a man fifty of them.
   *   IT IS PROFIT. The one that matters most: a bond that is a net gain in
   *     the currency `attributes.mjs` prices traits in makes a veteran roster
   *     strictly stronger than a fresh one, which is the cross-run power both
   *     this file's header and `Company.js`'s refuse.
   *   IT KEEPS PAYING AFTER HE IS DEAD. The whole cost of a bond is losing it,
   *     so a lapsed one that never lapses is the mechanism with its price
   *     removed and nothing on any screen to say so.
   */

  /** Two runs of the same men, holding `a` grounds and then `b` more. */
  const twoRuns = (n, a, b) => {
    const r = freshRoll(n);
    for (const t of r.all) t.areas = a;
    Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
    if (b <= 0) return { names: r.all.map((t) => t.designation) };
    const back = new CommandRoster(ARMIES.republic);
    for (const m of Company.fieldable(Company.load('republic'))) back.enlistRecord(m);
    for (const t of back.all) t.areas = a + b;
    Company.keep(back.all, { army: 'republic', deployed: back.all, ground: 'drifts' });
    return { names: r.all.map((t) => t.designation), back };
  };

  check('company: a bond forms only after real shared service, and never before', () => withCleanStore(() => {
      const near = Math.max(1, Company.BOND_AREAS - 1);
      /* ONE GROUND SHORT. The whole point of the threshold is that two men who
       * were merely mustered together and withdrew do not come home friends. */
      const short = freshRoll(4);
      for (const t of short.all) t.areas = near;
      Company.keep(short.all, { army: 'republic', deployed: short.all, ground: 'geonosis' });
      const half = Company.load('republic').men[0];
      assert(half.bonds.length,
        `${near} grounds held side by side and the roll recorded no shared service at all`);
      assert(half.bonds.every((b) => b.areas === near),
        `the tally reads ${half.bonds.map((b) => b.areas).join('/')} for ${near} shared grounds`);
      assert(!half.traits.includes('bonded'),
        `a bond formed on ${near} of the ${Company.BOND_AREAS} grounds it asks for`);
      assert(!Company.dossier(half, 'republic').some(([k]) => k === 'Bonded to'),
        'the dossier calls unfinished shared service a bond');


      /* THE SECOND RUN CROSSES IT. Same men, same ground, one more area each. */
      const roll1 = Company.load('republic');
      const back = new CommandRoster(ARMIES.republic);
      for (const m of Company.fieldable(roll1)) back.enlistRecord(m);
      for (const t of back.all) t.areas = Company.BOND_AREAS;
      Company.keep(back.all, { army: 'republic', deployed: back.all, ground: 'drifts' });
      const roll2 = Company.load('republic');
      const him = roll2.men.find((m) => m.designation === half.designation);
      assert(him.bonds.some((b) => b.areas >= Company.BOND_AREAS),
        `his best tally is ${Math.max(...him.bonds.map((b) => b.areas))} of ${Company.BOND_AREAS}`);
      assert(him.traits.includes('bonded'),
        'he has held four grounds beside the same man and it has changed nothing about him');
      assert(Company.dossier(him, 'republic').some(([k]) => k === 'Bonded to'),
        'his page does not say who he came through it with');
      /* IT IS TWO-SIDED ON THE ROLL AS WELL AS ON THE CARD: every man he
       * carries carries him back, or one of them is bonded to a stranger. */
      const by = new Map(roll2.men.map((m) => [m.designation, m]));
      for (const b of him.bonds) {
        assert(by.get(b.with)?.bonds.some((o) => o.with === him.designation),
          `${him.designation} is bonded to ${b.with} and ${b.with} has never heard of him`);
      }
      assert(him.bonds.length <= Company.BONDS_MAX,
        `${him.bonds.length} bonds against a cap of ${Company.BONDS_MAX}`);
      return `${near}/${Company.BOND_AREAS} grounds: tallied, not bonded · `
        + `${Company.BOND_AREAS}/${Company.BOND_AREAS}: ${him.bonds.length} bond(s), both sides`;
  }));

  check('company: shared ground is what the pair did, not what the older of them did', () => withCleanStore(() => {
      /**
       * A man who has held nine grounds and a man who arrived for the last one
       * have ONE ground between them. It is the whole force of the word
       * "together" in the rule, and it is the clause that would go red the day
       * somebody read the tally off `areas` directly — which is very tempting,
       * because `areas` is already on the record and is already the right
       * number for one of the two men.
       *
       * The fixture is chosen so that every wrong answer is a DIFFERENT number:
       * the larger is 9, the first man's is 9, the second's is 1, and the sum
       * is 10. Only `min` gives 1.
       */
      const pair = freshRoll(2);
      const [vet, green] = pair.all;
      vet.areas = 9; green.areas = 1;
      Company.keep(pair.all, { army: 'republic', deployed: pair.all, ground: 'geonosis' });
      const roll = Company.load('republic');
      const him = roll.men.find((m) => m.designation === vet.designation);
      const shared = him.bonds.find((b) => b.with === green.designation);
      assert(shared, 'nine grounds and one, and the pair have no tally between them at all');
      assert(shared.areas === 1,
        `9 grounds and 1 came out as ${shared.areas} shared — that is `
        + `${shared.areas === 9 ? 'the older man\'s own service' : 'not what they did together'}`);
      /* AND IT READS THE SAME FROM HIS SIDE, which is what makes it a fact
       * about the pair rather than a field on one of them. */
      const back = roll.men.find((m) => m.designation === green.designation)
        .bonds.find((b) => b.with === vet.designation);
      assert(back && back.areas === shared.areas,
        `he reads ${shared.areas} and the other man reads ${back?.areas}`);
      assert(!him.traits.includes('bonded'), 'one shared ground is a bond');
      return `9 grounds and 1 → ${shared.areas} shared, the same from both sides, no bond`;
  }));

  check('company: a bond survives the save, and a hand-edited one cannot stack', () => withCleanStore(() => {
      twoRuns(4, 2, Company.BOND_AREAS - 2);
      const before = Company.load('republic').men[0];
      assert(before.traits.includes('bonded'), 'this clause needs a bond to have formed');
      const was = before.bonds.map((b) => `${b.with}:${b.areas}`).join(' ');

      /* THROUGH THE REAL STORE. `save` writes only `MAN_FIELDS`, so a bond
       * that lived on the object and never reached the whitelist would pass
       * every clause above and be gone the next time the game opened. */
      Company.save(Company.load('republic'));
      const after = Company.load('republic').men.find((m) => m.designation === before.designation);
      assert(after.bonds.map((b) => `${b.with}:${b.areas}`).join(' ') === was,
        `his bonds read "${after.bonds.map((b) => `${b.with}:${b.areas}`).join(' ')}" `
        + `after a save that wrote "${was}"`);
      assert(after.traits.includes('bonded'), 'the bond survived and the trait it hangs did not');
      /* …AND READING IT TWICE DOES NOT PAY HIM TWICE. `settleBonds` runs on
       * every `load`, and the Menu loads every time it opens. */
      const twice = Company.load('republic').men.find((m) => m.designation === before.designation);
      for (const id of ATTR_IDS) {
        assert(twice.attrs[id] === after.attrs[id],
          `opening the roll again moved his ${id}: ${after.attrs[id]} → ${twice.attrs[id]}`);
      }

      /**
       * NOW THE HAND-EDITED SAVE. Written straight to the key, which is the
       * only threat model that matters here: `bonds` is the one field on a
       * record that names ANOTHER record, so it is the only one where an edit
       * buys something the game never handed out.
       */
      const raw = JSON.parse(localStorage.getItem(KEY));
      const roll = Company.load('republic');
      const me = raw.republic.men.find((m) => m.designation === before.designation);
      me.bonds = [
        { with: me.designation, areas: 99 },                 // himself
        { with: 'CT-0000', areas: 99 },                      // a man who does not exist
        { with: roll.men[1].designation, areas: 1e9 },       // a tally no screen can draw
        ...Array.from({ length: 50 }, (_, i) => ({ with: `CT-9${i}`, areas: 40 })),
        { with: null, areas: 4 }, { with: 'CT-1', areas: 'lots' },
      ];
      localStorage.setItem(KEY, JSON.stringify(raw));
      const fixed = Company.load('republic').men.find((m) => m.designation === before.designation);
      assert(fixed.bonds.length <= Company.BONDS_MAX,
        `a save claiming 54 bonds came back with ${fixed.bonds.length}`);
      assert(!fixed.bonds.some((b) => b.with === fixed.designation), 'he is bonded to himself');
      const on = new Set(Company.load('republic').men.map((m) => m.designation));
      for (const b of fixed.bonds) {
        assert(on.has(b.with), `${b.with} is not on the roll and is on his record`);
        assert(Number.isInteger(b.areas) && b.areas > 0 && b.areas <= Company.BOND_TALLY_MAX,
          `a tally of ${b.areas} survived the sanitiser`);
      }
      /* AND THE ONE HE INVENTED IS ONE-SIDED, so it is not a bond. The man he
       * claims never claimed him back at anything like that number. */
      const rows = Company.bondRows(fixed, Company.load('republic'));
      for (const r of rows) assert(r.strength <= 1, `a bond of strength ${r.strength} on a 0..1 bar`);
      return `saved and re-read intact (${was}) · 54 hand-written bonds sanitised to `
        + `${fixed.bonds.length}`;
  }));

  check('company: a manifest is ten and a man has three, and the last man is not left out', () => withCleanStore(() => {
      /**
       * THE SLOTS, DEALT ON A ROLL THAT IS BIGGER THAN THEM. Eight men who held
       * every ground together is 28 pairs competing for 12 slots, and it is the
       * only shape that catches the two ways this goes wrong at once:
       *
       *   A MAN WITH SEVEN BONDS has none — the cap is what stops the tab
       *     becoming a join table, and it has to survive the fold, not just the
       *     sanitiser on the way in.
       *   AND A MAN WITH ZERO. Dealing the slots per man rather than per pair
       *     left the last four of these eight bonded to nobody at all, because
       *     none of the three they each chose chose them back. Measured on this
       *     exact fixture before `settleBonds` dealt them by pair: 4 of 8 men
       *     with no bond, and nothing anywhere would have said so.
       */
      const n = Company.BONDS_MAX + 5;
      twoRuns(n, 2, Company.BOND_AREAS - 2);
      const roll = Company.load('republic');
      assert(roll.men.length === n, `${roll.men.length} of ${n} men came home`);
      const by = new Map(roll.men.map((m) => [m.designation, m]));
      const counts = roll.men.map((m) => m.bonds.length);
      assert(Math.max(...counts) <= Company.BONDS_MAX,
        `a man came out of one withdrawal with ${Math.max(...counts)} bonds`);
      assert(Math.min(...counts) > 0,
        `${counts.filter((c) => !c).length} of ${n} men who held every ground together `
        + `came home bonded to nobody — the slots are being dealt per man (${counts.join(',')})`);
      for (const m of roll.men) {
        assert(m.traits.includes('bonded'), `${m.designation} has a bond and does not carry it`);
        for (const b of m.bonds) {
          const back = by.get(b.with)?.bonds.find((o) => o.with === m.designation);
          assert(back && back.areas === b.areas,
            `${m.designation}→${b.with} reads ${b.areas} and comes back ${back?.areas}`);
        }
      }
      return `${n} men, 28 pairs, ${counts.join('/')} bonds each — none over `
        + `${Company.BONDS_MAX}, none at zero`;
  }));

  check('company: a bond is not a net gain in the currency traits are priced in', () => withCleanStore(() => {
      /**
       * MEASURED ON THE STORED RECORD, not on the table. `attributes.mjs`
       * prices the `bonded` row itself; this prices what actually happened to a
       * man on a real roll after two real withdrawals, which is the number that
       * would move if `settleBonds` ever applied the give and skipped the take.
       */
      twoRuns(4, 2, Company.BOND_AREAS - 2);
      const roll = Company.load('republic');
      const him = roll.men[0];
      assert(him.traits.includes('bonded'), 'this clause needs a bond to have formed');

      /* THE SAME MAN WITHOUT HIS BOND. `Trooper` re-rolls a profile from a hash
       * of who he is, so a fresh muster of his own designation IS the man he
       * was before anything happened to him — no fixture, no stored copy. */
      const plain = new CommandRoster(ARMIES.republic).enlistRecord({
        type: him.type, designation: him.designation, army: 'republic',
      });
      const delta = {};
      for (const id of ATTR_IDS) delta[id] = him.attrs[id] - plain.attr(id);
      const moved = ATTR_IDS.filter((id) => delta[id] !== 0);
      assert(moved.length >= 2,
        `a bond moved ${moved.length} of his numbers (${moved.join(', ')}) — `
        + 'a one-sided trait is a rank with a name on it');
      assert(moved.some((id) => delta[id] > 0) && moved.some((id) => delta[id] < 0),
        `the bond moved ${moved.join(', ')} all the same way`);
      const net = priceSwing(delta);
      assert(net <= 0,
        `two withdrawals with the same men made him +${net.toFixed(4)} of a soldier for free — `
        + 'a veteran roster is now strictly stronger than a fresh one');
      /* …AND NOT A PUNISHMENT. Nobody may learn to bring different men. */
      assert(net > -0.06, `a bond costs ${(-net).toFixed(4)} of a man — that is a tax on surviving`);
      /* AND THE WHOLE ROLL, not just the man who happened to be first: a
       * mechanism that was neutral per man and positive per company would be
       * the same defect one level up. */
      let total = 0;
      for (const m of roll.men) {
        const t = new CommandRoster(ARMIES.republic).enlistRecord({
          type: m.type, designation: m.designation, army: 'republic',
        });
        const d = {};
        for (const id of ATTR_IDS) d[id] = m.attrs[id] - t.attr(id);
        total += priceSwing(d);
      }
      assert(total <= 0, `the roll of ${roll.men.length} gained +${total.toFixed(4)} between them`);
      return `${moved.length} axes moved, net ${net.toFixed(4)} per man, `
        + `${total.toFixed(4)} across the roll`;
  }));

  check('company: a bond to a dead man stops paying, and hands back what it lent', () => withCleanStore(() => {
      twoRuns(4, 2, Company.BOND_AREAS - 2);
      const roll = Company.load('republic');
      const him = roll.men[0];
      assert(him.traits.includes('bonded'), 'this clause needs a bond to have formed');
      const lent = { ...him.attrs };
      const friends = him.bonds.map((b) => b.with);
      assert(friends.length, 'he is bonded to nobody');

      /* THE THIRD RUN: he walks up the ramp and every man he is bonded to does
       * not. `left` is the same door the casualty clauses above use. */
      const out = new CommandRoster(ARMIES.republic);
      for (const m of Company.fieldable(roll)) out.enlistRecord(m);
      const home = out.all.filter((t) => !friends.includes(t.designation));
      const lostThem = out.all.filter((t) => friends.includes(t.designation));
      for (const t of out.all) t.areas = Company.BOND_AREAS + 2;
      Company.keep(home, {
        army: 'republic', deployed: out.all, left: lostThem, ground: 'felucia',
      });

      const after = Company.load('republic').men.find((m) => m.designation === him.designation);
      assert(after, 'he did not come home either — this clause needs him alive');
      for (const b of after.bonds) {
        assert(!friends.includes(b.with),
          `${b.with} is dead and is still on ${after.designation}'s record`);
      }
      assert(!after.traits.includes('bonded'),
        'every man he was bonded to is dead and he is still drawing the bond');
      assert(!Company.dossier(after, 'republic').some(([k]) => k === 'Bonded to'),
        'his page still lists a bond to a dead man');

      /* AND THE NUMBERS CAME BACK. He is the man he was mustered as, exactly —
       * not a veteran left carrying a 14 Nerve penalty for ever with nothing on
       * the page to explain it. Compared against a fresh muster of his own
       * designation, which is what `Trooper`'s hash makes reproducible. */
      const plain = new CommandRoster(ARMIES.republic).enlistRecord({
        type: after.type, designation: after.designation, army: 'republic',
      });
      const stuck = ATTR_IDS.filter((id) => after.attrs[id] !== plain.attr(id));
      assert(!stuck.length,
        `losing them left ${stuck.map((id) => `${id} ${after.attrs[id]} vs ${plain.attr(id)}`).join(', ')}`);
      const paid = ATTR_IDS.filter((id) => lent[id] !== after.attrs[id]);
      assert(paid.length,
        'nothing on his record changed when the men he was bonded to died — the bond was never worth anything');

      /* THE SAME THING THROUGH THE OTHER DOOR: a save that still claims the
       * trait and a bond to a name that is not on the roll. `load` has to
       * refuse it and refund it without a run happening at all. */
      const raw = JSON.parse(localStorage.getItem(KEY));
      const rec = raw.republic.men.find((m) => m.designation === after.designation);
      rec.attrs = { ...lent };
      rec.traits = [...new Set([...(rec.traits || []), 'bonded'])];
      rec.bonds = [{ with: 'CT-0000', areas: Company.BOND_TALLY_MAX }];
      localStorage.setItem(KEY, JSON.stringify(raw));
      const forged = Company.load('republic').men.find((m) => m.designation === after.designation);
      assert(!forged.traits.includes('bonded'), 'a hand-written bond to a ghost still pays out');
      assert(!forged.bonds.length, `${forged.bonds.length} bonds to men who are not on the roll`);
      const kept = ATTR_IDS.filter((id) => forged.attrs[id] !== plain.attr(id));
      assert(!kept.length,
        `the forged bond kept ${kept.map((id) => `${id}=${forged.attrs[id]}`).join(', ')}`);
      return `${friends.length} bond(s) struck off with the men · ${paid.length} axes handed back · `
        + 'a forged bond to a ghost refunded on load';
  }));

  check('company: a roster screen can print a bond without owning a second model', () => withCleanStore(() => {
      /**
       * REQUIREMENT 3, ASSERTED AS AN API RATHER THAN AS MARKUP. `Menu.js` is
       * another agent's file and a bond it could only render by reaching across
       * the roll itself would be a second model of the pairing living in a DOM
       * method — where the only way to test it is to parse HTML. So everything
       * a page needs is a pure function here, and this is the clause that says
       * so.
       */
      const near = Math.max(1, Company.BOND_AREAS - 1);
      const short = freshRoll(3);
      for (const t of short.all) t.areas = near;
      Company.keep(short.all, { army: 'republic', deployed: short.all, ground: 'geonosis' });
      let roll = Company.load('republic');
      /* A PAIR THAT IS NOT A PAIR YET IS THE INTERESTING ROW, and the one a
       * screen that only printed finished bonds would hide: it is the only
       * thing on this tab that says anything about the NEXT run. */
      const soon = Company.bondRows(roll.men[0], roll);
      assert(soon.length, 'shared service short of a bond is invisible to the page');
      assert(soon.every((r) => !r.bonded && r.toGo === Company.BOND_AREAS - near),
        `a pair ${Company.BOND_AREAS - near} ground(s) short reads ${JSON.stringify(soon[0])}`);
      assert(soon.every((r) => r.strength > 0 && r.strength < 1),
        'the bar for an unfinished bond is empty or full');

      const backOn = new CommandRoster(ARMIES.republic);
      for (const m of Company.fieldable(roll)) backOn.enlistRecord(m);
      for (const t of backOn.all) t.areas = Company.BOND_AREAS;
      Company.keep(backOn.all, { army: 'republic', deployed: backOn.all, ground: 'drifts' });
      roll = Company.load('republic');
      const him = roll.men[0];
      Company.dress('republic', him.bonds[0].with, { callsign: 'Ladder' });
      roll = Company.load('republic');
      const rows = Company.bondRows(roll.men.find((m) => m.designation === him.designation), roll);
      assert(rows.length && rows.every((r) => r.bonded && r.strength === 1 && r.toGo === 0),
        `a finished bond reads ${JSON.stringify(rows[0])}`);
      /* THE NAME IS THE ONE THE PLAYER GAVE HIM, resolved off the roll — which
       * is the whole reason this cannot be a field on the record. */
      const named = rows.find((r) => r.with === him.bonds[0].with);
      assert(named.name.includes('Ladder'),
        `the page would print "${named.name}" for a man the player named Ladder`);
      assert(rows.every((r) => r.type), 'the rows do not say what the other man does');

      /* WHAT IT IS WORTH, IN BOTH ARMIES' WORDS AND OFF THE TRAIT TABLE. A
       * second copy of the swing over here is the defect this repo has removed
       * nine of, so it is compared against the row that owns it. */
      const t = traitById('bonded');
      const flesh = Company.bondWorth('flesh');
      const steel = Company.bondWorth('steel');
      assert(flesh.length === Object.keys(t.up).length + Object.keys(t.down).length,
        `bondWorth prints ${flesh.length} of the ${Object.keys(t.up).length
          + Object.keys(t.down).length} halves of the swing`);
      assert(flesh.some(([, v]) => v.startsWith('+')) && flesh.some(([, v]) => v.startsWith('−')),
        `bondWorth shows one side only: ${JSON.stringify(flesh)}`);
      for (const k in t.up) {
        assert(flesh.some(([, v]) => v === `+${t.up[k]}`), `the give is not ${t.up[k]} any more`);
      }
      assert(flesh.map(([k]) => k).join() !== steel.map(([k]) => k).join(),
        'a droid page and a clone page name the bond axis the same thing');
      return `${soon.length} unfinished row(s), ${rows.length} finished · `
        + `worth ${flesh.map(([k, v]) => `${v} ${k}`).join(', ')} / `
        + `${steel.map(([k, v]) => `${v} ${k}`).join(', ')}`;
  }));

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The tab                                                           */
  /* ══════════════════════════════════════════════════════════════════ */

  /**
   * A REAL MENU ON A REAL PAGE, exactly as databank.mjs and menu.mjs build one.
   * Nothing here constructs markup or asserts against a copy of the expected
   * text: the page is rendered from `Company.dossier` and the clauses compare
   * it against that same table, so a page that stopped saying something goes
   * red rather than a check that was updated to agree with it.
   */
  const { Menu, DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
  /* `over` is for the clauses whose subject is a SETTING the page reads — the
   * roll column's cut is decided by `musterPlan(this.s)`, and the default mode
   * leads no army, so a page built on the defaults has no cut to show. */
  const menuOn = (over = null) => {
    const doc = makeDocument(INDEX_HTML);
    const restore = doc.install();
    try {
      const menu = new Menu({ ...structuredClone(DEFAULT_SETTINGS), ...(over || {}) }, {});
      return { menu, doc, close: restore };
    } catch (e) { restore(); throw e; }
  };

  check('company: the tab exists, and it lists the men who are actually on the roll', () => withCleanStore(() => {
      const r = freshRoll(7);
      const [star] = r.all;
      star.award(24);
      star.kills = 9;
      Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });

      const { doc, close } = menuOn();
      try {
        const tab = [...doc.querySelectorAll('.menu-tabs .tab')].find((t) => t.dataset.tab === 'company');
        assert(tab, 'there is no Company tab in the bar');
        assert(doc.querySelector('[data-panel="company"]'), 'the Company tab has no panel');

        const list = doc.getElementById('company-list');
        assert(list, 'the roll column is missing');
        const rows = [...list.querySelectorAll('.diff')].filter((d) => !d.dataset.man.endsWith('-fallen'));
        assert(rows.length === 7,
          `${rows.length} rows on the roll against seven men — the page is not reading the store`);
        /* THE ORDER IS `fieldable`'s, and the promoted man is first. A page
         * that listed them in enlistment order would bench a Captain behind
         * four recruits on screen exactly as the muster would on the field. */
        assert(rows[0].dataset.man === `republic/${star.designation}`,
          `the roll opens on ${rows[0].dataset.man} and the senior man is ${star.designation}`);
        const txt = rows[0].textContent.replace(/\s+/g, ' ');
        assert(txt.includes(star.designation), `the first row does not name him: "${txt}"`);
        assert(txt.includes(RANKS[rankFor(star.xp)].title),
          `the first row does not print his rank "${RANKS[rankFor(star.xp)].title}": "${txt}"`);
        assert(/9 down/.test(txt), `the first row does not print his nine kills: "${txt}"`);
        return `Company tab present · ${rows.length} rows · led by ${star.designation}, `
          + `${RANKS[rankFor(star.xp)].title}`;
      } finally { close(); }
  }));

  /**
   * THE MEN YOU GOT OUT ARE THE MEN THE NEXT ARMY MODE FIELDS.
   *
   * The defect this binds: `main.js` gated the company on `picksCampaign` —
   * true for exactly one of the five army modes — while `World.loadLevel`'s
   * own rule is `crossing || battles`. So a man extracted from a Command run
   * NEVER fielded in the next one unless the unrelated allies slider was set,
   * and the tab read as a graveyard: the roll only ever gained fallen. The
   * player, verbatim: "I still only see fallen troops in the troop management
   * screen and nothing in regards to the troops I'm taking in."
   *
   * `musterPlan` is the one resolver now; these clauses hold it to loadLevel's
   * three answers: an army mode fields OPENING_STRENGTH whatever the slider
   * says, a bare mode fields the contingent the slider asked for or nothing,
   * and the contingent's army choice is honoured only where a contingent is
   * what is being built.
   */
  check('company: the men you got out are the men the next army mode fields', async () => {
    const { musterPlan } = await import('../../src/game/Command.js');
    const { MODES } = await import('../../src/game/Waves.js');
    for (const mode of Object.keys(MODES)) {
      const army = !!(MODES[mode].crossing || MODES[mode].battles);
      const bare = musterPlan({ mode, allies: 0, order: 0 });
      if (army) {
        assert(bare && bare.want === OPENING_STRENGTH,
          `${mode} leads an army and musterPlan answers ${JSON.stringify(bare)} with the slider at 0 `
          + '— the company would never field there again');
      } else {
        assert(bare === null,
          `${mode} fields no army at allies 0 and musterPlan still answers ${JSON.stringify(bare)}`);
        const five = musterPlan({ mode, allies: 5, order: 0 });
        /**
         * …AND A MODE WITH NO ROSTER AT ALL ANSWERS NOTHING, WHATEVER THE
         * SLIDER SAYS.
         *
         * `MODES.training` is run by a `DojoDirector`, which has no roster —
         * so a plan there would have the barracks mint, name, paint and SAVE
         * ten men for a run that can never deploy one of them. Measured before
         * the exemption, on a cleared store: Training offered "Take 10
         * troopers into Training", and the click wrote a line to disk.
         *
         * Asserted from the mode's own declaration rather than by name, and
         * asserted in BOTH directions, so neither the flag nor the reader can
         * quietly go away.
         */
        if (MODES[mode].dojo) {
          assert(five === null,
            `${mode} is run by the dojo and musterPlan still answers ${JSON.stringify(five)} — `
            + 'the tab would raise a line that has nowhere to land');
        } else {
          assert(five && five.want === 5,
            `${mode} with a contingent of five gets ${JSON.stringify(five)}`);
        }
      }
    }
    /* The contingent's ally-army choice is honoured; an army mode's is not —
     * its army is the mode's, resolved off the order, and letting the box
     * override it would hand a Republic roll to a Separatist roster. */
    const chosen = musterPlan({ mode: 'waves', allies: 4, order: 0, allyArmy: 1 });
    assert(chosen?.army === ARMY_IDS[1],
      `a contingent asked for ${ARMY_IDS[1]} and musterPlan drew ${chosen?.army}`);
    /* THE FLAG HAS A WRITER. A `dojo` nobody declares would make the clause
     * above vacuous — every mode would take the `else` and the exemption would
     * be a comment. */
    const dojos = Object.keys(MODES).filter((m) => MODES[m].dojo);
    assert(dojos.length === 1, `${dojos.length} modes declare a dojo: ${dojos.join(', ')}`);
    return `${Object.keys(MODES).length} modes resolved · army modes field ${OPENING_STRENGTH} `
      + `regardless of the slider · bare modes field the slider or nothing · ${dojos[0]} fields `
      + 'nobody at any setting';
  });

  check('company: the tab names the men being taken in, not only the fallen', () => withCleanStore(() => {
      const r = freshRoll(4);
      const [lead] = r.all;
      lead.award(24);
      Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });

      const { menu, doc, close } = menuOn();
      try {
        /* An army mode with the allies slider untouched — the exact state the
         * player reported from. The section must name the banked men as next
         * run's line and say how many fresh fill the rest. */
        menu.s.mode = 'command';
        menu.s.allies = 0;
        menu._showCompany(null);
        const page = doc.getElementById('company-page');
        const txt = page.textContent.replace(/\s+/g, ' ');
        assert(/Taking in/.test(txt), 'the page has no "Taking in" section');
        assert(txt.includes(lead.designation),
          `the section does not name ${lead.designation}, who is first off the roll`);
        assert(new RegExp(`${OPENING_STRENGTH - 4} fresh`).test(txt),
          `four banked men against a line of ${OPENING_STRENGTH} and the page does not say `
          + `"${OPENING_STRENGTH - 4} fresh": "${txt.slice(0, 300)}"`);

        /* And a mode with no army says so instead of showing a stale plan. */
        menu.s.mode = 'duel';
        menu._showCompany(null);
        const t2 = page.textContent.replace(/\s+/g, ' ');
        assert(/fields no army/.test(t2), 'a mode with no army does not explain itself');
        /* The roll summary lines below the section may still NAME the men —
         * they are the company's, whatever the mode. What must be gone is the
         * plan: no count of fresh enlistments for a line nobody is fielding. */
        assert(!/fresh/.test(t2.split('You can give')[0].split('Taking in')[1] || ''),
          'the duel page still states a muster plan for a mode with no army');
        return `Taking in: ${lead.designation} + ${OPENING_STRENGTH - 4} fresh on command · `
          + 'duel says it fields no army';
      } finally { close(); }
  }));

  check('company: a man\'s page prints every line of his record and types none of them', () => withCleanStore(() => {
      const r = freshRoll(3);
      const [him] = r.all;
      him.award(24); him.kills = 11; him.wounds = 2; him.areas = 4;
      Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });

      const { menu, doc, close } = menuOn();
      try {
        menu._showCompany(`republic/${him.designation}`);
        const page = doc.getElementById('company-page').textContent.replace(/\s+/g, ' ');
        /* EVERY ROW `dossier` PRODUCES, compared against `dossier` itself. A
         * check with its own list of expected labels would be the
         * hand-maintained twin this codebase has deleted nine of. */
        const stored = Company.load('republic').men.find((m) => m.designation === him.designation);
        const rows = Company.dossier(stored, 'republic');
        assert(rows.length >= 6, `dossier produced only ${rows.length} rows`);
        const absent = rows.filter(([k, v]) => !page.includes(k) || !page.includes(String(v)));
        assert(!absent.length,
          `the page does not print: ${absent.map(([k, v]) => `${k}=${v}`).join(', ')}`);
        assert(page.includes(him.designation), 'the page does not name him');
        /* AND THE RANK'S OWN NUMBERS, which are the answer to "what does
         * Captain buy" and the reason this page does not sell upgrades. */
        const R = RANKS[rankFor(him.xp)];
        assert(page.includes(`${Math.round((R.hp - 1) * 100)}% health`),
          `the page never says what the rank buys: "${page.slice(0, 240)}"`);
        /* HIS HISTORY, written by the run and not by the page. */
        assert(stored.story.length, 'a man with 11 kills and 2 wounds gained no line of history');
        for (const line of stored.story) {
          assert(page.includes(line), `the page does not print his line "${line}"`);
        }
        return `${rows.length} dossier rows and ${stored.story.length} history line(s), all on the page`;
      } finally { close(); }
  }));

  check('company: the page can name him and paint him, and can change nothing else', () => withCleanStore(() => {
      const r = freshRoll(2);
      const [him] = r.all;
      him.award(24); him.kills = 5;
      Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
      const before = Company.load('republic').men.find((m) => m.designation === him.designation);

      const { menu, doc, close } = menuOn();
      try {
        menu._showCompany(`republic/${him.designation}`);
        const field = doc.getElementById('company-callsign');
        const save = doc.getElementById('company-callsign-save');
        assert(field && save, 'the callsign control is not on the page');
        field.value = 'Ladder';
        save.click();

        const named = Company.load('republic').men.find((m) => m.designation === him.designation);
        assert(named.look?.callsign === 'Ladder', `the callsign stored as ${named.look?.callsign}`);
        assert(Company.nameOf(named).includes('"Ladder"'),
          `he is called ${Company.nameOf(named)} — the callsign does not reach the name`);
        /* THE EARNED NICKNAME SURVIVES IT, which is what makes clearing the
         * callsign give him his old name back rather than nothing. */
        assert(named.nickname === before.nickname,
          `naming him overwrote the nickname he earned ("${before.nickname}" → "${named.nickname}")`);

        /* A MARK, through the swatch the page renders. */
        const mark = MARKS.find((m) => m.color != null);
        menu._showCompany(`republic/${him.designation}`);
        const sw = doc.querySelector(`.company-marks .swatch[data-mark="${mark.id}"]`);
        assert(sw, `the palette has no swatch for ${mark.id}`);
        sw.click();
        const painted = Company.load('republic').men.find((m) => m.designation === him.designation);
        assert(painted.look?.mark === mark.id, `the mark stored as ${painted.look?.mark}`);
        assert(markById(painted.look.mark).color === mark.color, 'the stored mark is not that colour');

        /**
         * AND NOTHING THE GAME OWNS MOVED. This is the assertion the whole
         * page is held to: rank, kills, wounds, grounds and runs are written
         * by a run, and a roster screen that could edit them would be a cheat
         * panel with a casualty list on it. Compared field by field against
         * the record as it stood before either write.
         */
        for (const k of ['xp', 'kills', 'wounds', 'areas', 'runs', 'type', 'designation']) {
          assert(painted[k] === before[k],
            `editing his appearance changed ${k}: ${before[k]} → ${painted[k]}`);
        }

        /* CLEARING IT GIVES HIM HIS EARNED NAME BACK. */
        menu._showCompany(`republic/${him.designation}`);
        doc.getElementById('company-callsign').value = '   ';
        doc.getElementById('company-callsign-save').click();
        const cleared = Company.load('republic').men.find((m) => m.designation === him.designation);
        assert(!cleared.look?.callsign, `a blank callsign stored as "${cleared.look?.callsign}"`);
        assert(Company.nameOf(cleared) === Company.nameOf(before),
          `cleared he is "${Company.nameOf(cleared)}" and he started as "${Company.nameOf(before)}"`);
        return `named "Ladder", painted ${mark.name}, cleared back to ${Company.nameOf(cleared)}; `
          + '7 game-owned fields unmoved';
      } finally { close(); }
  }));

  check('company: the page sells nothing — there is no cross-run currency anywhere in it', async () => {
    /**
     * THE PROMISE, GUARDED AT THE SOURCE.
     *
     * "Upgrade certain things in their stats" was asked for and is deliberately
     * not built: there already is a way to make a man better and it is the rank
     * ladder, which he earns by fighting. A second way — points spent on a menu
     * between runs — is a cross-run currency that buys power, which
     * `Progress.js` and `Company.js` both refuse at the top of their own files.
     *
     * So this reads the two files and requires that the ONE door the tab writes
     * through is still the one that takes a mark and a name. It is a source
     * check because that is where the defect would appear: a `spend`, a
     * `points`, an `upgrade` on the company record would pass every behavioural
     * clause in this file on the day it was added and every one of them for
     * ever after.
     */
    const src = (p) => readFile(new URL('../../src/' + p, import.meta.url), 'utf8');
    const co = await src('game/Company.js');
    const menu = await src('ui/Menu.js');
    /* Comments stripped: the notes in both files argue about currency at
     * length, and a check that could not tell an argument from an
     * implementation would make explaining the decision impossible. */
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const code = strip(co);
    for (const word of ['points', 'currency', 'purchase', 'upgrade', 'unlock', 'buy']) {
      assert(!new RegExp(`\\b${word}\\b`, 'i').test(code),
        `Company.js has grown a "${word}" — the roll has become a currency`);
    }
    /* `dress` is the one writer the tab reaches, and it takes two fields. */
    const writers = [...strip(menu).matchAll(/companyDress\s*\(([^)]*)\)/g)].map((m) => m[1]);
    assert(writers.length, 'the Company tab no longer writes through Company.dress');
    const dressBody = /export function dress\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(code)?.[1] || '';
    assert(dressBody, 'Company.dress is gone');
    const fields = [...dressBody.matchAll(/'(\w+)' in look/g)].map((m) => m[1]).sort();
    /* Three now — the band joined the mark and the name in the barracks
     * rebuild, argued at `bandUp` and priced by the paint checks below and in
     * barracks.mjs. Still cosmetic to the last field, still validated against
     * the one palette, and STILL a pin: the day a fourth appears, somebody
     * comes here and argues it the way the band was argued. */
    /* FIVE NOW, AND THE ARGUMENT IS THE SAME ONE. `kit` is hardware the body
     * builders have always accepted — a pauldron, a kama, a pack — and `paint`
     * is the armour under the rank's own colours. Neither moves a number:
     * `KIT_FIELDS` deliberately withholds `frame`, the one option that would
     * resize a man into another rung's silhouette, and a colour has never been
     * read by anything that fights. Both are priced on real bodies by
     * `barracks.mjs`. The pin stays a pin: the day a SIXTH appears, somebody
     * comes here and argues it the way these two were argued. */
    assert(fields.join(',') === 'band,callsign,kit,mark,paint',
      `Company.dress writes ${fields.join(', ') || 'nothing'} — it may write a name, two marks, `
      + 'a kit and a paint job, and a roster screen that can edit anything else is a cheat panel');
    /* …and the slate's own writer holds the same line for men not yet on any
     * roll: `Muster.dressRecruit` takes the same three fields and Muster.js
     * has grown no currency word either. */
    const mu = await src('game/Muster.js');
    const muCode = strip(mu);
    for (const word of ['points', 'currency', 'purchase', 'upgrade', 'unlock', 'buy']) {
      assert(!new RegExp(`\\b${word}\\b`, 'i').test(muCode),
        `Muster.js has grown a "${word}" — the slate has become a shop`);
    }
    const recruitBody = /export function dressRecruit\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(muCode)?.[1] || '';
    assert(recruitBody, 'Muster.dressRecruit is gone');
    const rFields = [...recruitBody.matchAll(/'(\w+)' in look/g)].map((m) => m[1]).sort();
    assert(rFields.join(',') === 'band,callsign,kit,mark,paint',
      `Muster.dressRecruit writes ${rFields.join(', ') || 'nothing'} — a recruit may be named, `
      + 'painted and kitted, nothing else');
    return `dress and dressRecruit write ${fields.join(' + ')} and nothing else; `
      + 'no currency word in Company.js or Muster.js';
  });

  check('company: the roll says which of them you are taking out next run', () => withCleanStore(() => {
    /**
     * ── "IS THAT NOT THE ENTIRE POINT OF THE TROOP TAB?" ─────────────────
     *
     * "when you go into the troop tab you should see the troops that you're
     * going to spawn with in your next game."
     *
     * The Taking in page names them in full and always did. What the ROLL
     * column did not say is where the cut falls, and the cut is real: a
     * deployment is `Company.fieldable(load(army), plan.want)`, so a company of
     * fourteen fields ten and benches four, in this order, with nothing on
     * screen saying which four.
     *
     * ASSERTED AGAINST `musterPlan`, which is what `veteransToField` asks and
     * therefore what actually decides — not against a typed 10. The day a
     * skirmish's opening moves, this check moves with it or it goes red for
     * the right reason.
     */
    const led = { ...DEFAULT_SETTINGS, mode: 'skirmish' };
    const want = musterPlan(led, null)?.want ?? 0;
    assert(want > 0,
      'a skirmish fields no army, so this check cannot see a cut — musterPlan and MODES disagree '
      + 'about which modes lead one');
    const r = freshRoll(want + 4);
    Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
    const { doc, close } = menuOn({ mode: 'skirmish' });
    try {
      const list = doc.getElementById('company-list');
      const rows = [...list.querySelectorAll('.diff')].filter((d) => !d.dataset.man.endsWith('-fallen'));
      assert(rows.length === want + 4, `${rows.length} rows against a roll of ${want + 4}`);
      const going = rows.filter((d) => !d.classList.contains('company-reserve'));
      assert(going.length === want,
        `${going.length} of ${rows.length} men are shown as deploying against a muster that takes `
        + `${want} — the page and the field disagree about who is going out`);
      /* THE CUT IS A PREFIX, not a scatter: `fieldable` sorts and the muster
       * slices, so the men going out are the top of the list and the reserve
       * is the tail. A page that marked four at random would pass a count. */
      const firstBenched = rows.findIndex((d) => d.classList.contains('company-reserve'));
      assert(firstBenched === want,
        `the first reserve man is row ${firstBenched} and the muster takes ${want} — the marking `
        + 'does not follow the order the field takes them in');
      const txt = list.textContent.replace(/\s+/g, ' ');
      assert(txt.includes(`${want} of ${rows.length}`),
        `the roll never states the cut in words: "${txt.slice(0, 120)}"`);
      return `${want} of ${want + 4} marked as deploying, in fieldable order, and said in words`;
    } finally { close(); }
  }));

  check('company: an empty roll explains itself instead of showing an empty column', () => withCleanStore(() => {
      const { doc, close } = menuOn();
      try {
        const list = doc.getElementById('company-list');
        const rows = [...list.querySelectorAll('.diff')];
        assert(!rows.length, `${rows.length} men on a roll nobody has ever filled`);
        const txt = list.textContent.replace(/\s+/g, ' ');
        /**
         * A PAGE THAT SHOWED NOTHING TO A PLAYER WHO HAS NOT WITHDRAWN YET
         * would never explain itself, and this is the one mechanism in the
         * game whose whole subject is a decision the player has to know exists
         * before they can make it. Every army has to say so, not just the
         * first — a player leading droids is the same player.
         */
        for (const id of ARMY_IDS) {
          const army = ARMIES[id];
          assert(txt.includes(army.short || army.name),
            `${id} is not on the roll column at all`);
        }
        assert(/extraction/i.test(txt),
          `the empty roll does not say how one starts: "${txt}"`);
        const page = doc.getElementById('company-page').textContent.replace(/\s+/g, ' ');
        assert(/0 .*on the roll/i.test(page) || page.includes('0'),
          'the index page does not count an empty roll');
        return `${ARMY_IDS.length} armies listed, each saying how a roll starts`;
      } finally { close(); }
  }));

  check('company: the casualty list is on the page, and it is the men who did not come back', () => withCleanStore(() => {
      const r = freshRoll(6);
      const dead = r.all.slice(4);
      for (const t of dead) t.award(10);
      Company.keep(r.all.slice(0, 4), {
        army: 'republic', deployed: r.all, left: dead, ground: 'geonosis',
      });

      const { menu, doc, close } = menuOn();
      try {
        const row = doc.querySelector('[data-man="republic/-fallen"]');
        assert(row, 'a company with two dead men has no casualty row on the roll');
        menu._showCompany('republic/-fallen');
        const page = doc.getElementById('company-page').textContent.replace(/\s+/g, ' ');
        for (const t of dead) {
          assert(page.includes(t.designation), `${t.designation} fell and is on no list: "${page}"`);
        }
        for (const t of r.all.slice(0, 4)) {
          assert(!page.includes(t.designation),
            `${t.designation} came home and is on the casualty list`);
        }
        assert(page.includes('geonosis'), 'the casualty list does not say where they fell');
        return `2 named on the fallen page, 4 survivors off it`;
      } finally { close(); }
  }));

  check('company: the roll is re-read every time the menu comes back', () => withCleanStore(() => {
    /**
     * THE ONE PAGE IN THIS MENU THAT A RUN CHANGES.
     *
     * `_buildCompany` runs once, at construction. Every other tab is a
     * function of the settings and the shipped tables, so building it once is
     * right; this one is a function of a save file that a run just rewrote —
     * men die, men are promoted, a withdrawal writes the whole list. Built
     * once and never refreshed, the tab shows the roll as it stood when the
     * page was created, which for any session that has played anything is a
     * list of the dead standing.
     *
     * Driven the way it actually happens: open the menu, play (which here is
     * writing the store, because what the run does to it is the only part the
     * page can see), and come back through `showMenu` — which is the one
     * moment all three doors back to this screen share.
     */
    const { menu, doc, close } = menuOn();
    try {
      const before = [...doc.getElementById('company-list').querySelectorAll('.diff')];
      assert(!before.length, `${before.length} men on the roll before anything was played`);

      const r = freshRoll(5);
      const kept = r.all.slice(0, 3);
      Company.keep(kept, { army: 'republic', deployed: r.all, left: r.all.slice(3), ground: 'geonosis' });

      menu.showMenu();
      const rows = [...doc.getElementById('company-list').querySelectorAll('.diff')]
        .filter((d) => !d.dataset.man.endsWith('-fallen'));
      assert(rows.length === 3,
        `${rows.length} men on the roll after a run that brought three home — the tab is stale`);
      const named = rows.map((d) => d.textContent).join(' ');
      for (const t of kept) {
        assert(named.includes(t.designation), `${t.designation} came home and is not on the tab`);
      }
      /* AND THE PAGE IS BACK ON THE INDEX. The man who was open may be on the
       * casualty list now — `_showCompany` validates its key for that reason
       * — and the index is the sentence that says what the page is for. */
      assert(menu._companyKey === null,
        `the page came back on ${menu._companyKey} rather than on the index`);

      /* …AND A SECOND RUN THAT KILLS THEM IS READ TOO, which is the direction
       * that actually hurts: a tab that only ever GREW would pass everything
       * above and still show a dead man standing. */
      const out = Company.fieldable(Company.load('republic'), 3);
      Company.keep([], { army: 'republic', deployed: out, ground: 'drifts' });
      menu.showMenu();
      const after = [...doc.getElementById('company-list').querySelectorAll('.diff')]
        .filter((d) => !d.dataset.man.endsWith('-fallen'));
      assert(!after.length, `${after.length} men still standing on a roll that was wiped`);
      return '0 → 3 after a withdrawal → 0 after a wipe, on the index each time';
    } finally { close(); }
  }));

  check('company: a mark is paint on a body and moves no number', async () => {
    /**
     * The other half of "the page sells nothing", measured on real bodies
     * rather than in the source: two identical troopers put through the real
     * `enlistBody`, one of them marked, and every number the fight reads
     * compared.
     *
     * A REAL WORLD, because `Enemy` takes one — `_build` reaches
     * `world.scene` and `world.physics` — and a scene handed in its place
     * fails in the constructor. The one thing stubbed is the DIRECTOR, and it
     * is stubbed to COUNT rather than to no-op: "it painted nothing" must not
     * be able to pass as "it painted the same".
     */
    const THREE = await import('three');
    const { bootWorld } = await import('./_coop.mjs');
    const { enlistBody, Trooper, MARKS: M } = await import('../../src/game/Command.js');
    const { Enemy } = await import('../../src/game/Enemy.js');
    const { world } = await bootWorld({ settings: { quality: 'low' } });
    const mark = M.find((k) => k.color != null);

    let n = 0;
    const make = (look) => {
      /**
       * THE SAME MAN TWICE, WEARING DIFFERENT PAINT.
       *
       * `Trooper` rolls an attribute spread at the muster now, so two fresh
       * troopers are two different soldiers — which is the point of that system
       * and is fatal to this fixture, whose whole claim is that the ONLY
       * difference between these two bodies is a colour. Left alone it compared
       * one man's Grit against another's and called the gap a mark: measured,
       * ×0.9916 against ×1.1152.
       *
       * So the profile is pinned flat. Not to defeat the roll — to hold every
       * variable but the one under test, which is what the fixture always
       * meant by "the same trooper".
       */
      const flat = {};
      for (const id of ATTR_IDS) flat[id] = 50;
      const t = new Trooper(ARMIES.republic, 'trooper', `CT-000${++n}`,
        { attrs: flat, traits: [] });
      t.look = look;
      const e = new Enemy(world, 'trooper', new THREE.Vector3(n * 4, 0, 0));
      /* THE RATIO, NOT THE VALUE. `Enemy` jitters a body's pace and health per
       * spawn — two fresh troopers are not numerically identical and never
       * were — so comparing the absolute numbers would measure the roll of the
       * dice. What has to be equal is what ENLISTING did to them, which is the
       * rank multiplier and nothing else. */
      const was = { maxHp: e.maxHp, attackDamage: e.attackDamage, speed: e.speed };
      const painted = [];
      const director = {
        repaint: (b, c) => { painted.push(['rank', c]); return true; },
        markUp: (b, c) => { painted.push(['mark', c]); return true; },
      };
      enlistBody(e, t, { director, team: 0 });
      return { e, painted, gain: {
        maxHp: e.maxHp / was.maxHp,
        attackDamage: e.attackDamage / was.attackDamage,
        speed: e.speed / was.speed,
        full: e.hp === e.maxHp,
      } };
    };

    const plain = make(null);
    const marked = make({ mark: mark.id });
    for (const k of ['maxHp', 'attackDamage', 'speed']) {
      assert(Math.abs(plain.gain[k] - marked.gain[k]) < 1e-9,
        `enlisting multiplied a marked trooper's ${k} by ${marked.gain[k]} and an unmarked `
        + `one's by ${plain.gain[k]}`);
    }
    assert(plain.gain.full && marked.gain.full, 'a body came off the muster short of full health');
    assert(!plain.painted.some(([w]) => w === 'mark'), 'an unmarked man was painted a mark');
    assert(marked.painted.some(([w, c]) => w === 'mark' && c === mark.color),
      `a man marked ${mark.id} was painted ${JSON.stringify(marked.painted)}`);

    /* AND IT REALLY REACHES THE BODY. The stub above proves `enlistBody` asks;
     * this proves the director can answer, through the shipped method, on a
     * real rig — the meshes and the material land on `_modMeshes` and
     * `_modMaterials`, which is what the body's own teardown walks. */
    const real = new Enemy(world, 'trooper', new THREE.Vector3(40, 0, 0));
    const before = (real._modMeshes || []).length;
    const { CommandDirector } = await import('../../src/game/Command.js');
    const painted = CommandDirector.prototype.markUp.call({}, real, mark.color);
    assert(painted, 'markUp painted nothing on a real trooper rig');
    assert((real._modMeshes || []).length > before,
      'markUp made no meshes, so nothing would be drawn and nothing would be freed');
    assert(real._cmdMark && real._cmdMark.color.getHex() === mark.color,
      'the mark material is not the colour that was asked for');
    /* …and it is a SECOND material, never a recolour of the rank paint: a
     * marked Captain must still read as a Captain at every distance. */
    assert(real._cmdMark !== real._cmdPaint, 'the mark and the rank paint are the same material');
    return `${mark.name} painted on ${(real._modMeshes || []).length - before} mesh(es); `
      + `enlisting gained x${plain.gain.maxHp.toFixed(2)} health either way; rank paint untouched`;
  });
}
