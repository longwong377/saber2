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
import { ATTR_IDS } from '../../src/game/Attributes.js';
import {
  ARMY_IDS, ARMIES, CommandRoster, rankFor, OPENING_STRENGTH, RANKS, MARKS, markById,
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
  localStorage.removeItem(KEY);
  try { return fn(); }
  finally { if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had); }
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
  const menuOn = () => {
    const doc = makeDocument(INDEX_HTML);
    const restore = doc.install();
    try {
      const menu = new Menu(structuredClone(DEFAULT_SETTINGS), {});
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
    assert(fields.join(',') === 'callsign,mark',
      `Company.dress writes ${fields.join(', ') || 'nothing'} — it may write a mark and a name, `
      + 'and a roster screen that can edit anything else is a cheat panel');
    return `dress writes ${fields.join(' + ')} and nothing else; no currency word in Company.js`;
  });

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
