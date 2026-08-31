/**
 * BATTLEFRONT BORZ — THE BARRACKS: the muster slate, and why it may hold names
 * and nothing else.
 *
 * "when you go into the troop tab you should see the troops that you're going
 *  to spawn with in your next game, isn't that the entire point of the troop
 *  tab?"
 *
 * `Muster.js` answers that by minting the fresh half of the next deployment IN
 * ADVANCE — real designations, standing on the tab, open to a callsign, a mark,
 * a band and a squad before they have fired a shot. Which makes it the second
 * store in this game a player can hand-edit and the first one that describes
 * men who DO NOT EXIST YET, and every failure mode it has is silent:
 *
 *   IT BECOMES A REROLL BUTTON. The slate is deterministic off the company's
 *     own state, so deleting the store, re-reading it, or wiggling the want
 *     must reproduce the same men. The moment any of those is a shuffle, the
 *     tab is a slot machine — deploy, glance, quit.
 *   IT BECOMES A SHOP. A recruit's numbers are rolled the day he musters, by
 *     the run itself. A slate that could carry attrs or xp in — hand-written
 *     or leaked — is a free Commander, which is the cross-run power both
 *     `Company.js` and `Progress.js` refuse at the top of their files.
 *   IT DESYNCS FROM THE GROUND. `lineup()` is the one resolver the tab renders
 *     and the deploy path fields. If the page and the muster can disagree
 *     about who is going out, the tab is back to being the graveyard the
 *     player reported.
 *   IT MOVES A SHARED STREAM. Minting happens at MENU time, per render. One
 *     draw from `commandRng` or `enemyRng` in that path and two machines
 *     muster two different armies — the exact defect `designateWith`'s own
 *     note records costing a desync measured in hp.
 *
 * The back half of the file holds the fittings the slate arrived with: the
 * band (paint, never power — the mark check's own bar), the scorch (history,
 * never signal), the epitaph fields on a fallen record, the orders of the day,
 * and the parade ground that stands the exact next deployment on open dirt.
 */

import { readFile } from 'node:fs/promises';
import { makeDocument } from './_page.mjs';
import { clocked } from './_shared.mjs';
import { ATTR_IDS } from '../../src/game/Attributes.js';
import {
  ARMIES, CommandRoster, musterPlan, OPENING_STRENGTH, RANKS, rankFor, MARKS,
  markById, SQUAD, commandRng, CommandDirector, composeContingent, CONTINGENT_MIXED,
  leadOf, squadPlan,
} from '../../src/game/Command.js';
import { makeRng } from '../../src/engine/MathUtil.js';
import * as Company from '../../src/game/Company.js';
import * as Muster from '../../src/game/Muster.js';
import { HURT_AT } from '../../src/game/Morale.js';
import { PAINTS } from '../../src/game/Bodies.js';
import { MODES } from '../../src/game/Waves.js';
/* THE DEPLOYED ARMY, shared with licence.mjs — one fixture, see `_army.mjs`. */
import { army as licenceArmy } from './_army.mjs';

/**
 * Run `fn` against an empty company AND an empty slate, and put the player's
 * own stores back after. SYNCHRONOUS for company.mjs's stated reason — a sync
 * body cannot interleave — and it cleans BOTH keys because the two stores are
 * one mechanism: `ensure` writes the slate off the company, so a fixture that
 * cleaned only one would read the other suite state's leftovers.
 */
function withCleanStore(fn) {
  const hadC = localStorage.getItem(Company.KEY);
  const hadM = localStorage.getItem(Muster.KEY);
  localStorage.removeItem(Company.KEY);
  localStorage.removeItem(Muster.KEY);
  try { return fn(); }
  finally {
    if (hadC == null) localStorage.removeItem(Company.KEY);
    else localStorage.setItem(Company.KEY, hadC);
    if (hadM == null) localStorage.removeItem(Muster.KEY);
    else localStorage.setItem(Muster.KEY, hadM);
  }
}

/** A roster of `n` fresh clones, off the real roster so the names are real. */
function freshRoll(n, army = ARMIES.republic) {
  const r = new CommandRoster(army);
  for (let i = 0; i < n; i++) r.enlist(army.tiers[0].type);
  return r;
}

/**
 * A hand-built plan in `musterPlan()`'s exact shape, for the checks whose
 * subject is the WANT moving — the real resolver cannot be asked for a want of
 * five, because no settings blob produces one for an army mode. Everything
 * else asks `musterPlan` itself, so the shape cannot drift.
 */
const planOf = (want) => ({ army: 'republic', want, armyMode: true });

const squadWordIndex = (n) => (Number.isInteger(n) ? `squad ${n + 1}` : 'nowhere');

export async function run({ check, assert, THREE: T }) {
  /**
   * THE PAIR, FOR THE WHOLE FILE — determinism.mjs names the two reasons: this
   * file constructs enemies (the band clause puts troopers through the real
   * `enlistBody` on a booted World) and its whole first half is about two
   * module-scope streams staying still. `clocked` also SERIALISES every body
   * behind one lock and puts localStorage back around each, which is what
   * makes the async bodies below safe to touch the store at all.
   */
  check = await clocked(check);
  const THREE = T || await import('three');
  /* READ AND IMPORT ONCE, UP FRONT, so every store/DOM clause below can be
   * SYNCHRONOUS — company.mjs's rule, kept for the same reason: sync bodies
   * cannot interleave, so they cannot read a page or a roll they did not
   * build. Enemy.js and Menu.js are pulled dynamically so this file adds no
   * static edge through the Engine's once-only shader patches. */
  const INDEX_HTML = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const { enemyRng, Enemy } = await import('../../src/game/Enemy.js');
  const {
    Menu, DEFAULT_SETTINGS, paradeSlots, buildParadeFigure, paradeContent, PARADE_SHOTS,
    STORE_KEY,
  } = await import('../../src/ui/Menu.js');

  /** A real Menu on the real page — databank.mjs and company.mjs's pattern. */
  const menuOn = (over = null) => {
    const doc = makeDocument(INDEX_HTML);
    const restore = doc.install();
    try {
      const menu = new Menu({ ...structuredClone(DEFAULT_SETTINGS), ...(over || {}) }, {});
      return { menu, doc, close: restore };
    } catch (e) { restore(); throw e; }
  };

  check('barracks: one company mints one slate, and deleting the store is not a shuffle', () => withCleanStore(() => {
    /**
     * THE WHOLE ANTI-REROLL PROMISE IN ONE CLAUSE. The salt is a hash of the
     * company's own state, so the only way to meet new men is to spend a run —
     * two ensures agree, and clearing localStorage reproduces the slate
     * instead of rerolling it. Asked through the REAL resolver so the want is
     * the want the deploy path uses, never a typed ten.
     */
    const plan = musterPlan({ mode: 'skirmish', allies: 0, order: 'jedi' }, null);
    assert(plan && plan.armyMode && plan.want === OPENING_STRENGTH,
      `a skirmish answered ${JSON.stringify(plan)} — this check needs an army mode's plan`);
    const a = Muster.ensure(plan, Company.load('republic'));
    const namesA = a.recruits.map((r) => r.designation);
    assert(namesA.length === plan.want,
      `${namesA.length} recruits minted against an empty roll and a want of ${plan.want}`);
    assert(a.salt === Muster.saltOf(Company.load('republic')),
      'the slate\'s salt is not the company\'s own state — something else is entropy');
    const b = Muster.ensure(plan, Company.load('republic'));
    assert(b.recruits.map((r) => r.designation).join() === namesA.join(),
      'two ensures over one company minted two different musters');
    /* THE DELETE. If this re-rolls, clearing site data is a free reroll and
     * the whole no-entropy argument at the top of Muster.js is decoration. */
    localStorage.removeItem(Muster.KEY);
    const c = Muster.ensure(plan, Company.load('republic'));
    assert(c.recruits.map((r) => r.designation).join() === namesA.join(),
      'deleting the store re-minted DIFFERENT men — localStorage.clear() is a shuffle');
    return `${namesA.length} names, minted three times (once through a deleted store), identical`;
  }));

  check('barracks: minting at menu time moves no shared random stream', () => withCleanStore(() => {
    /**
     * SEED-AND-PROBE, because `makeRng` exposes `.seed()` and no state
     * read-out. Seed both module streams, run everything the Company tab runs
     * per render, then draw once from each and compare against a virgin
     * generator on the same seed. One draw anywhere in the menu path and the
     * probes disagree — which is the defect that gave two machines two armies
     * and billed a host 0.4 hp for a body still standing.
     */
    const plan = musterPlan({ mode: 'skirmish', allies: 0, order: 'jedi' }, null);
    commandRng.seed(12345);
    enemyRng.seed(54321);
    const s = Muster.ensure(plan, Company.load('republic'));
    Muster.lineup(plan, Company.load('republic'), {});
    Muster.dressRecruit('republic', s.recruits[0].designation, { callsign: 'Probe', mark: 'blood' });
    Muster.flavorOf('republic', s.recruits[0].designation);
    Muster.slateFor('republic');
    const pc = commandRng();
    const cc = makeRng(12345)();
    assert(pc === cc,
      `commandRng drew ${pc} where a virgin stream at the same seed draws ${cc} — `
      + 'menu-time minting consumed the muster\'s stream, so two machines now muster two armies');
    const pe = enemyRng();
    const ce = makeRng(54321)();
    assert(pe === ce,
      `enemyRng drew ${pe} against a control of ${ce} — the slate reached into the body stream`);
    return 'ensure + lineup + dressRecruit + flavorOf: both streams exactly where they were seeded';
  }));

  check('barracks: the slate holds no numbers and cannot be made to', async () => {
    /**
     * THE SHOP DOOR, TRIED FROM EVERY SIDE. A recruit's numbers do not exist
     * until the run rolls them, so a store hand-written with attrs at 100, xp
     * at 99 and a paid trait has to come back as a man with none of it — at
     * the sanitizer, at the resolver, and ON THE FIELD, where it would
     * actually pay out. The field half is measured against a second boot of
     * the same run seed, because "his numbers are a hash of the run" is a
     * claim only two runs can prove.
     *
     * ASYNC AND IT TOUCHES THE STORE, which company.mjs's header forbids —
     * for a race `clocked` has since removed: every body in this file queues
     * behind one lock and localStorage is restored around each, so nothing
     * can interleave with the awaits below. Stated rather than assumed.
     */
    localStorage.removeItem(Company.KEY);
    localStorage.removeItem(Muster.KEY);
    const salt = Muster.saltOf(Company.load('republic'));
    const flat = {};
    for (const id of ATTR_IDS) flat[id] = 100;
    localStorage.setItem(Muster.KEY, JSON.stringify({
      republic: {
        army: 'republic', salt, picks: null,
        recruits: [{
          designation: 'CT-1234', type: 'trooper',
          attrs: flat, xp: 99, traits: ['deadeye'], squad: 1, look: { callsign: 'Ace' },
        }],
      },
    }));

    const r0 = Muster.slateFor('republic').recruits.find((r) => r.designation === 'CT-1234');
    assert(r0, 'the sanitizer dropped a legal recruit row along with its contraband');
    assert(!('attrs' in r0) && !('xp' in r0) && !('traits' in r0),
      `a hand-written recruit came off disk carrying ${['attrs', 'xp', 'traits']
        .filter((k) => k in r0).join(', ')} — the slate has become a character sheet`);
    assert(r0.look?.callsign === 'Ace' && r0.squad === 1,
      'the two fields a player actually owns were thrown out with the numbers');

    const plan = musterPlan({ mode: 'command', allies: 0, order: 'jedi' }, null);
    const slate = Muster.ensure(plan, Company.load('republic'));
    assert(slate.recruits.length === plan.want,
      `${slate.recruits.length} recruits after ensure topped up a slate of one`);
    assert(slate.recruits.some((r) => r.designation === 'CT-1234'),
      'a clean recruit row did not survive a same-salt ensure — reconcile is over-deleting');
    assert(slate.recruits.every((r) => !('attrs' in r) && !('xp' in r)),
      'ensure wrote the contraband back');

    const line = Muster.lineup(plan, Company.load('republic'), {});
    assert(line.length === plan.want, `the lineup is ${line.length} long for a want of ${plan.want}`);
    for (const m of line) {
      assert(!('attrs' in m),
        `${m.designation} materialized WITH an attrs key — enlistRecord will restore it instead `
        + 'of letting the Trooper constructor roll him, and the shop is open');
      assert(m.xp === 0, `${m.designation} materialized at xp ${m.xp} — a recruit paid rank in`);
    }

    /* THE FIELD. Two worlds, one seed, the same lineup: the attrs that arrive
     * must be the run's own hash — identical across the boots — and not the
     * hundred-across-the-board profile the store claimed. */
    const { bootWorld } = await import('./_coop.mjs');
    const base = { mode: 'command', level: 'geonosis', order: 'jedi' };
    const boots = [];
    for (let i = 0; i < 2; i++) {
      const { world } = await bootWorld({
        level: 'geonosis', settings: { ...base }, runSeed: 424242, run: { veterans: line },
      });
      boots.push(world.command.roster.all);
    }
    const [A, B] = boots;
    assert(A.length === plan.want, `${A.length} fielded for a lineup of ${plan.want}`);
    for (const t of A) {
      assert(t.rank === 0, `${t.designation} fielded at rank ${t.rank} off a slate that may not carry rank`);
      const twin = B.find((x) => x.designation === t.designation);
      assert(twin, `${t.designation} fielded in one boot of seed 424242 and not the other`);
      const off = ATTR_IDS.filter((id) => t.attr(id) !== twin.attr(id));
      assert(!off.length,
        `${t.designation}'s ${off.join(', ')} differ between two boots of one seed — his numbers `
        + 'are not the run\'s hash, so something else is deciding them');
    }
    const ace = A.find((t) => t.designation === 'CT-1234');
    assert(ace, 'the sanitized recruit never reached the field');
    assert(ATT_NOT_ALL_HUNDRED(ace),
      'CT-1234 fielded at 100 across the board — the hand-written profile reached the ground');
    return `1 poisoned row sanitized, ${plan.want} fielded twice at seed 424242 with identical `
      + 'hash-rolled numbers, all at rank 0';

    function ATT_NOT_ALL_HUNDRED(t) { return ATTR_IDS.some((id) => t.attr(id) !== 100); }
  });

  check('barracks: a name the roll claims is struck off the slate and the gap re-minted', () => withCleanStore(() => {
    /**
     * RECONCILE, BOTH WAYS IT HAPPENS. The natural way: a fold puts a man on
     * the roll whose designation a slate recruit already wears — the company
     * moved, so the whole slate re-mints and the claimed name may not come
     * back. And the surgical way, at a HELD salt, which pins the branch that
     * drops ONE row and keeps the rest — because "re-mint everything" would
     * pass the first half while deleting every look a player had given his
     * recruits on every withdrawal.
     */
    const plan = musterPlan({ mode: 'skirmish', allies: 0, order: 'jedi' }, null);
    const first = Muster.ensure(plan, Company.load('republic'));
    const claimed = first.recruits[0].designation;

    /* The collision arrives through the real doors: a Trooper GIVEN that
     * exact designation via enlistRecord, folded home by keep. */
    const roster = new CommandRoster(ARMIES.republic);
    const vet = roster.enlistRecord({ type: 'trooper', designation: claimed, army: 'republic' });
    assert(vet, `enlistRecord refused ${claimed} — the fixture never collided`);
    Company.keep(roster.all, { army: 'republic', deployed: roster.all, ground: 'geonosis' });

    const c = Company.load('republic');
    const next = Muster.ensure(plan, c);
    assert(!next.recruits.some((r) => r.designation === claimed),
      `${claimed} is on the roll AND on the slate — the muster will field him twice`);
    assert(next.recruits.length === plan.want - 1,
      `${next.recruits.length} recruits beside one veteran, for a want of ${plan.want}`);
    const names = Muster.lineup(plan, c, {}).map((m) => m.designation);
    assert(new Set(names).size === names.length,
      `the lineup repeats a designation: ${names.join(', ')}`);
    assert(names.filter((n) => n === claimed).length === 1,
      `${claimed} appears ${names.filter((n) => n === claimed).length} times in the lineup`);

    /* NOW AT A HELD SALT. Hand the roll's name to recruit 0 without moving
     * the company, dress recruit 1 first — reconcile must drop exactly the
     * thief and keep the dressed man, look and all. */
    const kept = next.recruits[1].designation;
    Muster.dressRecruit('republic', kept, { band: 'sky' });
    const raw = JSON.parse(localStorage.getItem(Muster.KEY));
    raw.republic.recruits[0].designation = claimed;
    localStorage.setItem(Muster.KEY, JSON.stringify(raw));
    const fixed = Muster.ensure(plan, Company.load('republic'));
    assert(!fixed.recruits.some((r) => r.designation === claimed),
      `${claimed} survived a same-salt reconcile`);
    assert(fixed.recruits.length === plan.want - 1,
      `reconcile left ${fixed.recruits.length} recruits — the gap was not re-minted`);
    const him = fixed.recruits.find((r) => r.designation === kept);
    assert(him && him.look?.band === 'sky',
      `${kept} was dressed before the collision and reconcile ${him ? 'stripped his band' : 're-minted him away'} `
      + '— dropping one thief cost every look on the slate');
    const minted = fixed.recruits.filter((r) => !next.recruits.some((o) => o.designation === r.designation));
    assert(minted.length === 1 && minted[0].designation !== claimed,
      `the gap re-minted as ${minted.map((r) => r.designation).join(', ') || 'nothing'}`);
    return `${claimed} claimed by the roll, struck off twice (salt moved, salt held); `
      + `gap re-minted as ${minted[0].designation}; ${kept} kept his band`;
  }));

  check('barracks: the lineup is the ground truth — the field enlists exactly it', async () => {
    /**
     * "the troops that you're going to spawn with in your next game" — the
     * page and the ground are one call now, and this drives the call all the
     * way to a mustered roster: veterans first in fieldable order, the
     * slate's recruits behind them, a pre-set callsign on the Trooper's own
     * name, a pre-dealt squad on his record. Async under clocked's lock; see
     * the note on the shop clause for why that is sound here.
     */
    localStorage.removeItem(Company.KEY);
    localStorage.removeItem(Muster.KEY);
    const r = freshRoll(4);
    Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
    const plan = musterPlan({ mode: 'command', allies: 0, order: 'jedi' }, null);
    const c = Company.load('republic');
    const slate = Muster.ensure(plan, c);
    assert(slate.recruits.length === plan.want - 4,
      `${slate.recruits.length} recruits over a roll of four`);
    Muster.dressRecruit('republic', slate.recruits[0].designation, { callsign: 'Torch' });
    Muster.setRecruitSquad('republic', slate.recruits[1].designation, 3);

    const line = Muster.lineup(plan, Company.load('republic'), {});
    assert(line.length === plan.want, `the lineup is ${line.length} for a want of ${plan.want}`);
    const vets = new Set(c.men.map((m) => m.designation));
    assert(line.slice(0, 4).every((m) => vets.has(m.designation)),
      'the four veterans do not lead the line — recruits are being fielded over men who served');

    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'geonosis', settings: { mode: 'command', order: 'jedi' },
      runSeed: 91, run: { veterans: line },
    });
    const fielded = world.command.roster.all;
    assert(fielded.map((t) => t.designation).join() === line.map((m) => m.designation).join(),
      `the roster reads ${fielded.map((t) => t.designation).join(', ')} against a lineup of `
      + `${line.map((m) => m.designation).join(', ')} — the page and the ground disagree`);
    assert(fielded.length === plan.want,
      `${fielded.length} enlisted for a plan of ${plan.want} — the muster topped up past the lineup`);
    const torch = fielded.find((t) => t.designation === slate.recruits[0].designation);
    assert(torch && torch.name.includes('"Torch"'),
      `the recruit the player named Torch fields as "${torch?.name}" — the callsign died at the ramp`);
    const squadded = fielded.find((t) => t.designation === slate.recruits[1].designation);
    assert(squadded && squadded.squad === 3,
      `his squad was dealt as 3 and he fields in ${squadded?.squad} — the pen does not reach the field`);
    return `4 veterans + ${slate.recruits.length} recruits fielded in lineup order, `
      + `"${torch.name}" wearing his lent name, squad 3 held`;
  });

  check('barracks: a deploy consumes exactly the fielded recruits and nothing else', () => withCleanStore(() => {
    /**
     * `consume` is called once, from the deploy path, with the recruit names
     * the lineup actually took — never "everything on the slate", because a
     * contingent run fields no recruits and must consume none. The empty call
     * is asserted as a BYTE no-op: a consume that rewrote the store on
     * nothing would move nothing today and be the write everybody blames
     * tomorrow.
     */
    const plan = musterPlan({ mode: 'skirmish', allies: 0, order: 'jedi' }, null);
    const slate = Muster.ensure(plan, Company.load('republic'));
    const names = slate.recruits.map((r) => r.designation);
    Muster.setPicks('republic', [names[2], names[0]]);
    const took = [names[0], names[3]];
    const after = Muster.consume('republic', took);
    assert(after.recruits.length === names.length - 2,
      `${after.recruits.length} recruits left after a deploy took two of ${names.length}`);
    assert(!after.recruits.some((r) => took.includes(r.designation)),
      'a man who deployed is still on the slate — he is on a roster now, and the fold will place him');
    assert(after.recruits.map((r) => r.designation).join()
      === names.filter((n) => !took.includes(n)).join(),
      'consume reordered or re-minted the men it did not take');
    assert(after.picks === null,
      'the picks survived the deploy they were spent on — the next lineup replays a spent hand');
    const raw = localStorage.getItem(Muster.KEY);
    const noop = Muster.consume('republic', []);
    assert(localStorage.getItem(Muster.KEY) === raw,
      'consuming nothing rewrote the store — the no-op case is the contingent case, every run');
    assert(noop.recruits.length === names.length - 2, 'the empty consume changed the slate it returned');
    return `2 of ${names.length} consumed, ${after.recruits.length} kept in order, picks spent, `
      + 'consume([]) byte-identical';
  }));

  check('barracks: a banked run moves the whole slate — new company, new men', () => withCleanStore(() => {
    /**
     * The other half of "deleting the store is not a shuffle": the ONLY thing
     * that re-deals the muster is the company itself moving, and a wipe moves
     * it (`lost` and `men.length` both feed the salt). The names the player
     * met before the run go with the company that would have fielded them —
     * the copy on the tab says so — and none of the dead come back as
     * recruits, because the casualty list is in the taken set.
     */
    const plan = musterPlan({ mode: 'skirmish', allies: 0, order: 'jedi' }, null);
    const r = freshRoll(4);
    Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
    const a = Muster.ensure(plan, Company.load('republic'));
    const namesA = a.recruits.map((x) => x.designation);
    assert(namesA.length === plan.want - 4, `${namesA.length} recruits beside four veterans`);

    const out = Company.fieldable(Company.load('republic'), 4);
    Company.keep([], { army: 'republic', deployed: out, ground: 'geonosis' });
    const c2 = Company.load('republic');
    assert(c2.men.length === 0 && c2.lost === 4,
      `the wipe left ${c2.men.length} men and ${c2.lost} lost — the fold softened a wipe`);

    const b = Muster.ensure(plan, c2);
    assert(b.salt !== a.salt, 'the company was wiped and the salt did not move — a run costs no new muster');
    const namesB = b.recruits.map((x) => x.designation);
    assert(namesB.length === plan.want, `${namesB.length} recruits over an emptied roll`);
    const held = namesA.filter((n) => namesB.includes(n));
    assert(held.length === 0,
      `${held.join(', ')} survived onto the next muster — the salt moved and the names did not`);
    const dead = new Set(c2.fallen.map((f) => f.designation));
    assert(!namesB.some((n) => dead.has(n)),
      'a man on the casualty list was re-minted as a recruit — the muster is issuing dead men\'s numbers');
    return `4 folded, 4 wiped (lost ${c2.lost}) · ${namesA.length} old names all gone, `
      + `${namesB.length} new, none of them the dead`;
  }));

  check('barracks: a want wiggle reproduces the same men, looks intact', () => withCleanStore(() => {
    /**
     * The contingent slider moves the want between renders, and the tab
     * ensures on every render — so shrink-then-grow under one salt has to be
     * the identity, or dragging a slider re-deals the muster and eats the
     * callsign a player just typed. `designateWith` derives from the taken
     * set's size, which is what makes the regrow re-walk the same ordinals.
     */
    const a = Muster.ensure(planOf(10), Company.load('republic'));
    const namesA = a.recruits.map((r) => r.designation);
    assert(namesA.length === 10, `${namesA.length} minted for a want of ten`);
    Muster.dressRecruit('republic', namesA[1], { callsign: 'Deuce', band: 'sky' });

    const b = Muster.ensure(planOf(5), Company.load('republic'));
    assert(b.recruits.map((r) => r.designation).join() === namesA.slice(0, 5).join(),
      'the trim did not keep the head of the slate — a smaller want is a different muster');

    const c = Muster.ensure(planOf(10), Company.load('republic'));
    assert(c.recruits.map((r) => r.designation).join() === namesA.join(),
      `the regrown slate reads ${c.recruits.map((r) => r.designation).join(', ')} against the `
      + `original ${namesA.join(', ')} — a want wiggle is a reroll`);
    const him = Muster.slateFor('republic').recruits.find((r) => r.designation === namesA[1]);
    assert(him?.look?.callsign === 'Deuce' && him?.look?.band === 'sky',
      `recruit #2 was named Deuce and banded before the wiggle and now wears `
      + `${JSON.stringify(him?.look)} — the slider ate the player's ink`);
    return '10 → 5 → 10 under one salt: the same ten designations, Deuce still Deuce';
  }));

  check('barracks: picks reorder the line, never grow it, and launder themselves', () => withCleanStore(() => {
    /**
     * The player's hand on the muster order. Everything a pick may do is
     * REORDER within the men the default could field — it can put a recruit
     * at the head over the top veteran, it can never add an eleventh man —
     * and everything invalid about a stored pick list (ghosts, duplicates) is
     * dropped by the next ensure rather than trusted. And a meeting fields
     * veterans only: a man who cannot die on the record must not ride into a
     * run that never banks.
     */
    const plan = musterPlan({ mode: 'skirmish', allies: 0, order: 'jedi' }, null);
    const r = freshRoll(4);
    Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
    const c = Company.load('republic');
    const line0 = Muster.lineup(plan, c, {}).map((m) => m.designation);
    const vetNames = Company.fieldable(c, plan.want).map((m) => m.designation);
    const recNames = line0.slice(4);
    assert(line0.slice(0, 4).join() === vetNames.join() && recNames.length === plan.want - 4,
      `the default line reads ${line0.join(', ')} — not veterans-then-recruits`);

    /* Bench the top veteran for a recruit, and salt the picks with a ghost, a
     * duplicate and a number — the shapes a hand-edited store really takes. */
    Muster.setPicks('republic',
      [recNames[0], vetNames[1], vetNames[2], 'CT-0000', recNames[0], 7, vetNames[3]].filter(() => true));
    const picked = Muster.lineup(plan, Company.load('republic'), {}).map((m) => m.designation);
    assert(picked.length === plan.want, `a picked lineup came out ${picked.length} long`);
    assert(new Set(picked).size === picked.length,
      `the picked lineup repeats a name: ${picked.join(', ')}`);
    assert(picked[0] === recNames[0],
      `the player put ${recNames[0]} at the head and the lineup opens on ${picked[0]}`);
    assert(picked.indexOf(vetNames[0]) === 4,
      `the benched top veteran stands at ${picked.indexOf(vetNames[0])} — picks added or lost a man `
      + 'instead of pushing him behind the picked four');

    const s2 = Muster.ensure(plan, Company.load('republic'));
    assert(Array.isArray(s2.picks) && !s2.picks.includes('CT-0000'),
      'a pick naming a man who does not exist survived ensure');
    assert(new Set(s2.picks).size === s2.picks.length, 'a duplicated pick survived ensure');

    Muster.clearPicks('republic');
    const back = Muster.lineup(plan, Company.load('republic'), {}).map((m) => m.designation);
    assert(back.join() === line0.join(),
      'clearPicks did not restore the fieldable-prefix default');

    const meet = Muster.lineup(plan, Company.load('republic'), { versus: true });
    const onRoll = new Set(c.men.map((m) => m.designation));
    assert(meet.length === 4 && meet.every((m) => onRoll.has(m.designation)),
      `a meeting fielded ${meet.map((m) => m.designation).join(', ')} — a recruit is being risked `
      + 'on a run that cannot put him on any list');
    return `${recNames[0]} to the head, ${vetNames[0]} to slot 4, still ${plan.want} men · `
      + 'ghost and duplicate picks laundered · versus fields the 4 veterans only';
  }));

  check('barracks: a reserve veteran can be fielded by name — the bench is not beyond reach', () => withCleanStore(() => {
    /**
     * The tab's one management verb, from the other side of the cut. A roll
     * that outgrew the deployment benches its tail, and "field him next run"
     * on a benched man writes a pick naming him — a name OUTSIDE the
     * fieldable prefix. The resolver's candidate map must span the whole
     * roll or that button is a lie: the pick survives `ensure`'s laundering
     * (which checks all men) and then vanishes at `lineup` (which once
     * checked only the prefix). This check is the bug's tombstone.
     */
    const plan = musterPlan({ mode: 'skirmish', allies: 0, order: 'jedi' }, null);
    const r = freshRoll(plan.want + 2);
    Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
    const c = Company.load('republic');
    const everyone = Company.fieldable(c).map((m) => m.designation);
    const line0 = Muster.lineup(plan, c, {}).map((m) => m.designation);
    assert(line0.length === plan.want && line0.join() === everyone.slice(0, plan.want).join(),
      'a full roll should field its fieldable prefix and bench the tail');
    const reserve = everyone[plan.want];        // the first man behind the cut
    const benched = line0[line0.length - 1];    // whom the swap stands down
    Muster.setPicks('republic', line0.slice(0, -1).concat(reserve));
    const picked = Muster.lineup(plan, Company.load('republic'), {}).map((m) => m.designation);
    assert(picked.length === plan.want, `the swapped line came out ${picked.length} long`);
    assert(picked.includes(reserve),
      `${reserve} was picked off the bench and the lineup dropped him — the resolver only `
      + 'reaches the prefix and the field-him button writes names it cannot honour');
    assert(!picked.includes(benched),
      `${benched} was stood down by the swap and deployed anyway — the line grew a man`);
    return `${reserve} fielded from behind the cut, ${benched} stood down, still ${plan.want} men`;
  }));

  check('barracks: ensure on a clean read writes not one byte', () => withCleanStore(() => {
    /**
     * Called from every render of the Company tab, so the no-op case is the
     * hot case — and a hot path that rewrites localStorage per frame is a
     * stall on the menu and a fresh JSON string for every equality check
     * anybody ever writes against the store. Byte-identical or it is not a
     * no-op.
     */
    const plan = musterPlan({ mode: 'skirmish', allies: 0, order: 'jedi' }, null);
    const r = freshRoll(3);
    Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
    Muster.ensure(plan, Company.load('republic'));
    const raw = localStorage.getItem(Muster.KEY);
    assert(raw, 'ensure minted a slate and wrote nothing at all');

    /**
     * COUNTED, NOT COMPARED — and that distinction is the whole check.
     *
     * This clause used to snapshot the stored STRING and assert it had not
     * changed, which cannot fail for a store that rewrites the SAME bytes
     * every call: proven by mutation, `saveSlate` made unconditional and the
     * suite still passed nineteen of nineteen. The law being guarded is not
     * "the slate does not change on a render", it is "a render does not WRITE"
     * — so the spy counts the door being opened, and the byte comparison stays
     * underneath it as a second clause, because it catches the other defect.
     */
    const realSet = localStorage.setItem.bind(localStorage);
    let writes = 0;
    localStorage.setItem = (k, v) => { if (k === Muster.KEY) writes++; return realSet(k, v); };
    try {
      for (let i = 0; i < 5; i++) Muster.ensure(plan, Company.load('republic'));
      Muster.slateFor('republic');
      Muster.slateFor('republic');
    } finally { localStorage.setItem = realSet; }
    assert(writes === 0,
      `five clean ensures and two reads opened the store for writing ${writes} time(s) — `
      + 'the tab writes localStorage per render');
    assert(localStorage.getItem(Muster.KEY) === raw,
      'the store changed under a clean read');
    return 'one write to mint, then five ensures and two reads: zero writes, byte-identical';
  }));

  check('barracks: a cleared store is cleared, and a refused write is remembered', () => withCleanStore(() => {
    /**
     * THE TWO HALVES OF src/game/Store.js, and they used to be one guess.
     *
     * `Muster` kept an in-memory mirror and read it back whenever `getItem`
     * answered nothing — so a store cleared ON PURPOSE (a player wiping site
     * data; this very fixture restoring between suites) came back from the
     * dead, callsigns and all. An absent key on a WORKING store is an empty
     * record. A store that has actually REFUSED a write is the only one that
     * gets to answer from memory, and it says so through `notSaving` so the
     * tab can warn instead of letting a player name men into a void.
     */
    const plan = musterPlan({ mode: 'skirmish', allies: 0, order: 'jedi' }, null);
    const slate = Muster.ensure(plan, Company.load('republic'));
    Muster.dressRecruit('republic', slate.recruits[0].designation, { callsign: 'Ghost' });
    assert(Muster.slateFor('republic').recruits[0].look?.callsign === 'Ghost',
      'the callsign did not reach the store at all');
    localStorage.removeItem(Muster.KEY);
    const after = Muster.slateFor('republic');
    assert(after.recruits.length === 0 && after.salt === null,
      `a cleared store answered with ${after.recruits.length} recruits — memory is shadowing the store`);
    assert(!Muster.notSaving(), 'a working store reported itself as not saving');

    /* AND THE OTHER HALF: a store that throws keeps the page coherent. */
    const realSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    let broken;
    try {
      const s2 = Muster.ensure(plan, Company.load('republic'));
      assert(s2.recruits.length === plan.want, 'a refused write lost the slate it had just minted');
      broken = Muster.notSaving();
    } finally { localStorage.setItem = realSet; }
    assert(broken, 'a refused write did not raise notSaving — the tab cannot warn about silent loss');
    return 'an absent key reads empty; a refused write is kept in memory and admitted';
  }));

  check('barracks: the salt moves with every term it claims to move with', () => withCleanStore(() => {
    /**
     * The salt is a hash of (army, runs, lost, headcount) and its whole job is
     * that a banked run cannot leave the same men on the slate. A CONSTANT
     * salt is caught by the determinism clause above — but removing any ONE
     * term was invisible, because a wipe also writes the dead onto `fallen`
     * and `takenOf` excludes them, so fresh names appeared either way and the
     * check could not tell which mechanism produced them. Each term is pinned
     * here directly, against a company that differs in exactly one field.
     */
    const base = { ...Company.blank('republic'), runs: 2, lost: 3, men: [] };
    const salt = Muster.saltOf(base);
    for (const [field, value] of [['runs', 3], ['lost', 4]]) {
      assert(Muster.saltOf({ ...base, [field]: value }) !== salt,
        `two companies differing only in \`${field}\` hash to the same salt — that term is decoration`);
    }
    const withMan = { ...base, men: [{ designation: 'CT-1234', type: 'trooper', xp: 0, runs: 0 }] };
    assert(Muster.saltOf(withMan) !== salt,
      'a company that gained a man hashes to the same salt — the headcount term is decoration');
    return 'runs, lost and headcount each move the salt on their own';
  }));

  check('barracks: the muster lives beside the roll, not in it', () => withCleanStore(() => {
    /**
     * `#company-list`'s contract is censused by seven checks in company.mjs —
     * `.diff` rows carrying `dataset.man`, veterans and the fallen row and
     * nothing else. The slate's rows live in `#company-muster`, a SIBLING,
     * carrying `dataset.recruit` — so this pins both halves: the recruits are
     * all there, correctly keyed, and not one of them leaked into the column
     * every census reads.
     */
    const r = freshRoll(4);
    Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
    const { doc, close } = menuOn({ mode: 'skirmish' });
    try {
      const want = musterPlan({ ...DEFAULT_SETTINGS, mode: 'skirmish' }, null)?.want ?? 0;
      assert(want > 4, `a skirmish wants ${want} — this fixture needs a gap for recruits to fill`);
      const muster = doc.getElementById('company-muster');
      assert(muster, 'there is no muster column beside the roll');
      const rows = [...muster.querySelectorAll('.diff')];
      assert(rows.length === want - 4,
        `${rows.length} recruit rows for a want of ${want} over a roll of 4 — the tab and the `
        + 'muster disagree about how many fresh men are coming');
      const slate = Muster.slateFor('republic');
      for (const d of rows) {
        assert(d.classList.contains('recruit'), 'a muster row does not carry the recruit class');
        assert(/^republic\/\+/.test(d.dataset.recruit || ''),
          `a recruit row is keyed "${d.dataset.recruit}" — the +sigil is what keeps a slate key `
          + 'out of the roll\'s namespace');
        const name = d.dataset.recruit.split('/+')[1];
        assert(slate.recruits.some((x) => x.designation === name),
          `${name} is on the tab and not on the slate`);
        assert(!d.dataset.man,
          'a recruit row carries dataset.man — every census in company.mjs will count him as a veteran');
      }
      const men = [...doc.getElementById('company-list').querySelectorAll('.diff')];
      assert(men.length === 4, `${men.length} rows inside #company-list against a roll of four`);
      assert(men.every((d) => d.dataset.man && !d.dataset.recruit),
        'a row inside #company-list is missing dataset.man or wearing dataset.recruit');
      return `${rows.length} recruits in #company-muster, keyed republic/+ · 4 veterans in `
        + '#company-list, none crossed over';
    } finally { close(); }
  }));

  check('barracks: selection closes now, everywhere, and a stale key self-invalidates', () => withCleanStore(() => {
    /**
     * The deselect the fallen row never had, given to every row alike: the
     * click that opened a page closes it. And a HELD key validates against
     * the store rather than being trusted — a recruit re-minted away, a
     * casualty list that emptied — because a key that sticks lands the player
     * on a blank column with no way back that they can see.
     */
    const r = freshRoll(6);
    Company.keep(r.all.slice(0, 4), {
      army: 'republic', deployed: r.all, left: r.all.slice(4), ground: 'geonosis',
    });
    const one = menuOn({ mode: 'skirmish' });
    try {
      const { menu, doc } = one;
      const index = () => /men who got out/.test(doc.getElementById('company-page').textContent);
      const manRow = [...doc.getElementById('company-list').querySelectorAll('.diff')]
        .find((d) => !d.dataset.man.endsWith('-fallen'));
      manRow.click();
      assert(menu._companyKey === manRow.dataset.man, `clicking a man opened ${menu._companyKey}`);
      manRow.click();
      assert(menu._companyKey === null && index(),
        'clicking the open man again did not put the page down and bring the index back');

      const rec = doc.querySelector('#company-muster .diff');
      assert(rec, 'no recruit row to drive');
      rec.click();
      assert(menu._companyKey === rec.dataset.recruit, `clicking a recruit opened ${menu._companyKey}`);
      rec.click();
      assert(menu._companyKey === null && index(), 'a selected recruit row does not toggle closed');

      const fal = doc.querySelector('[data-man="republic/-fallen"]');
      assert(fal, 'two men fell and there is no casualty row');
      fal.click();
      assert(menu._companyKey === 'republic/-fallen', `the fallen row opened ${menu._companyKey}`);
      fal.click();
      assert(menu._companyKey === null && index(), 'the fallen page has no way to close — the old defect');

      menu._showCompany('republic/+CT-9999');
      assert(menu._companyKey === null && index(),
        'a key naming a recruit who is not on the slate held instead of falling back to the index');
    } finally { one.close(); }

    /* And `-fallen` against an EMPTY list — the exact state the key used to
     * stick in. A fresh store, so nobody has fallen. */
    localStorage.removeItem(Company.KEY);
    localStorage.removeItem(Muster.KEY);
    const two = menuOn({ mode: 'skirmish' });
    try {
      two.menu._showCompany('republic/-fallen');
      assert(two.menu._companyKey === null,
        `an empty casualty list held the key ${two.menu._companyKey} — the page is about nobody`);
    } finally { two.close(); }
    return 'man, recruit and fallen rows all toggle closed; +CT-9999 and an empty -fallen land on the index';
  }));

  check('barracks: a recruit\'s page names him, refuses him numbers, and the pen writes', () => withCleanStore(() => {
    /**
     * The page is deliberately thin — "his numbers are rolled the day he
     * musters" is the fiction AND the literal mechanism, so the emptiness has
     * to say so out loud. What IS on it must actually write: a callsign
     * through the slate's own door, a band with a real palette id, a squad
     * chip whose one-based label lands as the zero-based field.
     */
    const { doc, close } = menuOn({ mode: 'skirmish' });
    try {
      const rec = doc.querySelector('#company-muster .diff');
      assert(rec, 'an empty roll minted no recruits to open');
      const name = rec.dataset.recruit.split('/+')[1];
      rec.click();
      const page = doc.getElementById('company-page');
      const txt = () => page.textContent.replace(/\s+/g, ' ');
      assert(txt().includes(name), `the page does not name ${name}`);
      assert(txt().includes(Muster.flavorOf('republic', name)),
        'the page has no line of character — a man with no history needs SOMETHING to meet');
      assert(/rolled the day he musters/.test(txt()),
        'the page never says why there are no numbers on it — the emptiness reads as a bug');
      for (const sel of ['.company-marks', '.company-bands', '.company-squads']) {
        assert(doc.querySelector(sel), `the recruit page is missing ${sel}`);
      }
      assert(doc.getElementById('company-callsign') && doc.getElementById('company-callsign-save'),
        'the callsign control is not on the page');

      doc.getElementById('company-callsign').value = 'Torch';
      doc.getElementById('company-callsign-save').click();
      const named = Muster.slateFor('republic').recruits.find((x) => x.designation === name);
      assert(named?.look?.callsign === 'Torch',
        `the callsign stored as ${JSON.stringify(named?.look?.callsign)}`);
      const field = doc.getElementById('company-callsign');
      assert(field && field.getAttribute('placeholder') === name,
        `the placeholder reads "${field?.getAttribute('placeholder')}" — a recruit has earned `
        + 'nothing to answer to, so his number is the only honest fallback');
      assert(/earned nothing/.test(txt()), 'the page stopped saying the name is lent, not earned');

      const sw = doc.querySelector('.company-bands .swatch[data-band="sky"]');
      assert(sw, 'the band palette has no sky swatch');
      sw.click();
      const banded = Muster.slateFor('republic').recruits.find((x) => x.designation === name);
      assert(banded?.look?.band === 'sky' && markById(banded.look.band).color != null,
        `the band stored as ${JSON.stringify(banded?.look?.band)} — not a colour the palette owns`);

      const chip = doc.querySelector('.company-squads .swatch[data-squad="1"]');
      assert(chip, 'there is no second squad chip');
      chip.click();
      const dealt = Muster.slateFor('republic').recruits.find((x) => x.designation === name);
      assert(dealt?.squad === 1,
        `squad chip 2 stored squad ${dealt?.squad} — the label is one-based and the field zero-based`);
      return `${name} named Torch, banded sky, dealt squad 2 — all three through the slate's own door`;
    } finally { close(); }
  }));

  check('barracks: the band is paint on a forearm and moves no number', async () => {
    /**
     * The mark check's pattern, one bone over. Two identical troopers through
     * the REAL `enlistBody` on a real World, one banded — every multiplier
     * the fight reads compared as a RATIO, because spawn jitter moves the
     * absolute numbers and the claim is about what ENLISTING did. The stub
     * director COUNTS rather than no-ops, so "it painted nothing" cannot pass
     * as "it painted the same"; then the shipped method proves the paint
     * actually lands on a real rig, as its own material, on the teardown
     * lists.
     */
    const { bootWorld } = await import('./_coop.mjs');
    const { Trooper, enlistBody } = await import('../../src/game/Command.js');
    const { world } = await bootWorld({ settings: { quality: 'low' } });
    const band = MARKS.find((k) => k.id === 'sky' && k.color != null) || MARKS.find((k) => k.color != null);

    let n = 0;
    const make = (look) => {
      /* THE SAME MAN TWICE: the attribute roll is pinned flat so the ONLY
       * difference between the two bodies is the colour under test. */
      const flat = {};
      for (const id of ATTR_IDS) flat[id] = 50;
      const t = new Trooper(ARMIES.republic, 'trooper', `CT-00${40 + ++n}`, { attrs: flat, traits: [] });
      t.look = look;
      const e = new Enemy(world, 'trooper', new THREE.Vector3(n * 4, 0, 8));
      const was = { maxHp: e.maxHp, attackDamage: e.attackDamage, speed: e.speed };
      const painted = [];
      const director = {
        repaint: (b, c) => { painted.push(['rank', c]); return true; },
        markUp: (b, c) => { painted.push(['mark', c]); return true; },
        bandUp: (b, c) => { painted.push(['band', c]); return true; },
        scorchUp: (b, c) => { painted.push(['scorch', c]); return true; },
      };
      enlistBody(e, t, { director, team: 0 });
      return {
        e, painted,
        gain: {
          maxHp: e.maxHp / was.maxHp,
          attackDamage: e.attackDamage / was.attackDamage,
          speed: e.speed / was.speed,
        },
      };
    };

    const plain = make(null);
    const banded = make({ band: band.id });
    for (const k of ['maxHp', 'attackDamage', 'speed']) {
      assert(Math.abs(plain.gain[k] - banded.gain[k]) < 1e-9,
        `enlisting multiplied a banded trooper's ${k} by ${banded.gain[k]} and a bare one's by `
        + `${plain.gain[k]} — the band is buying power`);
    }
    assert(!plain.painted.some(([w]) => w === 'band'), 'a bare-armed man was painted a band');
    assert(banded.painted.some(([w, c]) => w === 'band' && c === band.color),
      `a man banded ${band.id} was painted ${JSON.stringify(banded.painted)} — not the palette colour`);

    /* THE SHIPPED METHOD, ON A REAL RIG, beside the two paints it must never
     * recolour: rank on the crest, mark on the shins, band on the forearm. */
    const real = new Enemy(world, 'trooper', new THREE.Vector3(40, 0, 8));
    CommandDirector.prototype.repaint.call({}, real, RANKS[2].color);
    CommandDirector.prototype.markUp.call({}, real, MARKS.find((k) => k.id === 'blood').color);
    const before = (real._modMeshes || []).length;
    assert(CommandDirector.prototype.bandUp.call({}, real, band.color),
      'bandUp painted nothing on a real trooper rig');
    assert(real._cmdBand && real._cmdBand.color.getHex() === band.color,
      'the band material is not the colour that was asked for');
    assert(real._cmdBand !== real._cmdPaint && real._cmdBand !== real._cmdMark,
      'the band shares a material with the rank paint or the shin mark — recolour one and a '
      + 'Captain stops reading as a Captain');
    assert((real._modMeshes || []).length > before,
      'bandUp made no meshes — nothing would be drawn and nothing would be freed');
    assert((real._modMaterials || []).includes(real._cmdBand),
      'the band material is not on _modMaterials — the body\'s own teardown will leak it');
    return `${band.name} banded: gains x${plain.gain.maxHp.toFixed(2)} health either way, `
      + `${(real._modMeshes || []).length - before} mesh(es) on the forearm, own material, on the teardown list`;
  });

  check('barracks: the wound writer writes, and a scar is history made visible', () => {
    /**
     * `Trooper.wounds` has exactly one writer — a man went down, was helped
     * up, lived — driven here through the REAL `_getUpFromDown` on a minimal
     * `this`, because everything the method needs is on the instance and a
     * whole world would be forty seconds of fixture for one increment. Then
     * the paint: `scorchUp` renders the count as dark, UNLIT chips — history,
     * not signal — distinct from every mark material, and it refuses a man
     * with nothing to show.
     */
    const fake = {
      downed: true, bleed: 1, _downHelp: 9, maxHp: 100, hp: 5, actor: null, beingDragged: null,
      world: {
        command: { log: [], areaNumber: 1, wave: 2, commander: { side: 1 } },
        notify() {},
      },
      team: 1, trooper: { wounds: 0, name: 'CT-1' },
    };
    Enemy.prototype._getUpFromDown.call(fake);
    assert(fake.trooper.wounds === 1,
      `he went down, was helped up, and his record reads ${fake.trooper.wounds} wounds — `
      + 'the one writer did not write');
    assert(fake.downed === false && fake.bleed === 0, 'he got up still flagged down');
    assert(fake.hp >= 1 && fake.hp < 100,
      `he got up at ${fake.hp} of 100 hp — a rescue is not a heal`);
    assert(fake.world.command.log.some((l) => l.t === 'saved' && l.name === 'CT-1'),
      'the rescue is on no ledger — the run report cannot say who was carried');

    /* The chips, on the same stub body the parade paints — mark and band on
     * first, so "distinct from every mark material" is measured, not vacuous. */
    const fig = buildParadeFigure({
      army: 'republic', type: 'trooper', designation: 'CT-7000',
      xp: 12, wounds: 0, look: { mark: 'blood', band: 'sky' },
    });
    assert(fig && fig._stub, 'no stub body to paint');
    const stub = fig._stub;
    assert(stub._cmdPaint && stub._cmdMark && stub._cmdBand,
      'this fixture needs the three mark channels painted before the scar goes on');
    const before = stub._modMeshes.length;
    assert(CommandDirector.prototype.scorchUp.call({}, stub, 0) === false,
      'a man with no wounds was given a scar anyway');
    assert(!stub._cmdScorch && stub._modMeshes.length === before,
      'the refused scorch still left a material or a mesh behind');
    assert(CommandDirector.prototype.scorchUp.call({}, stub, 2) === true,
      'scorchUp painted nothing for two wounds');
    assert(stub._modMeshes.length === before + 2,
      `${stub._modMeshes.length - before} chips bolted for two wounds — one per time he went down`);
    const mat = stub._cmdScorch;
    assert(mat && mat !== stub._cmdPaint && mat !== stub._cmdMark && mat !== stub._cmdBand,
      'the scar shares a material with a mark channel — history is being drawn in the signal language');
    assert(mat.emissive.getHex() === 0x000000,
      `a scar glows 0x${mat.emissive.getHex().toString(16)} — at forty metres that is a third rank language`);
    assert(!MARKS.some((k) => k.color === mat.color.getHex()) && mat.color.getHex() <= 0x404040,
      `the scar is 0x${mat.color.getHex().toString(16)} — a palette colour, not a burn`);
    return 'wounds 0 → 1 through the real getter-up, on the ledger · 2 unlit chips, own material, 0 refused';
  });

  check('barracks: an epitaph keeps the name, the killer and the minute — clamped, never trusted', () => withCleanStore(() => {
    /**
     * A recruit the player named dies WEARING the name only if the casualty
     * list can still say it, and "fell to a B2, minute 7" is how a person
     * tells the story of a battle — seconds are the machine's unit, so `keep`
     * stores the minute. The two hostile shapes are the two the store can
     * really take: a hand-edited killer full of markup, and a timestamp no
     * screen can print.
     */
    const r = freshRoll(3);
    const doomed = r.all[2];
    doomed.look = { callsign: 'Zed' };
    Company.keep(r.all.slice(0, 2), {
      army: 'republic', deployed: r.all, left: [doomed], ground: 'geonosis',
      roll: [{ name: `${doomed.designation} "Zed"`, killer: 'B2 Super Battle Droid', at: 433 }],
    });
    const f = Company.load('republic').fallen.find((x) => x.designation === doomed.designation);
    assert(f, `${doomed.designation} fell and is on no list`);
    assert(f.callsign === 'Zed',
      `he died as ${JSON.stringify(f.callsign)} — the name the player lent him did not reach the stone`);
    assert(f.killer === 'B2 Super Battle Droid', `the killer stored as ${JSON.stringify(f.killer)}`);
    assert(f.at === 7,
      `433 seconds stored as minute ${f.at} — the epitaph speaks in the machine's unit`);

    /* The hand-edited store. `saneFallen` clamps exactly as `readMan` clamps
     * the living, or the casualty page becomes an innerHTML injection point. */
    const raw = JSON.parse(localStorage.getItem(Company.KEY));
    const rec = raw.republic.fallen.find((x) => x.designation === doomed.designation);
    rec.killer = '<script>x</script>';
    rec.at = 1e9;
    localStorage.setItem(Company.KEY, JSON.stringify(raw));
    const fixed = Company.load('republic').fallen.find((x) => x.designation === doomed.designation);
    assert(!/[<>]/.test(fixed.killer || ''),
      `a hand-written killer came back as ${JSON.stringify(fixed.killer)} — markup reached the page`);
    assert(fixed.at <= 999, `a stored minute of 1e9 came back as ${fixed.at}`);

    /* And a fold with NO roll — a quit banks with no account — leaves the two
     * fields honestly absent rather than invented. */
    const back = new CommandRoster(ARMIES.republic);
    for (const m of Company.fieldable(Company.load('republic'))) back.enlistRecord(m);
    Company.keep([back.all[0]], {
      army: 'republic', deployed: back.all, left: [back.all[1]], ground: 'drifts',
    });
    const quiet = Company.load('republic').fallen[0];
    assert(quiet.killer === null && quiet.at === null,
      `a run with no account wrote killer ${JSON.stringify(quiet.killer)}, minute ${quiet.at} — `
      + 'walking out mid-fight leaves you not knowing, which is true');
    return `Zed: fell to B2 Super Battle Droid, minute 7 · <script> stripped, 1e9 clamped to ${fixed.at} · `
      + 'a quit\'s epitaph says nothing';
  }));

  check('barracks: orders of the day are the last fold\'s diff — overwritten, capped, priced at nothing', () => withCleanStore(() => {
    /**
     * Ceremony without a ceremony screen: what CHANGED tonight, read once off
     * the index. Overwritten because "since the last muster" is the whole
     * meaning — an archive is a feed and a feed is homework — capped so one
     * good night is a toast and not a scroll, and rendered by `honoursOf`
     * with no currency word in any sentence, because a bulletin that reads as
     * a payout is the shop this tab refuses.
     */
    const n = 8;
    const r = freshRoll(n);
    Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
    assert(Company.load('republic').honours.length === 0,
      'the founding fold wrote honours — nothing notable happened to men the roll had never seen');

    /* THE GOOD NIGHT: every man crosses a rank (and earns his nickname), so
     * one fold produces far more honours than the cap holds. */
    const out1 = new CommandRoster(ARMIES.republic);
    for (const m of Company.fieldable(Company.load('republic'))) out1.enlistRecord(m);
    for (const t of out1.all) t.award(24);
    Company.keep(out1.all, { army: 'republic', deployed: out1.all, ground: 'drifts' });
    const c1 = Company.load('republic');
    assert(c1.honours.length === Company.HONOURS_KEEP,
      `${n} promotions and ${n} names earned in one fold produced ${c1.honours.length} honours — `
      + `the cap is ${Company.HONOURS_KEEP}, a toast and not a feed`);
    const first = out1.all[0];
    assert(c1.honours.some((h) => h.kind === 'promoted' && h.designation === first.designation
        && h.detail === RANKS[rankFor(first.xp)].title),
      `${first.designation} crossed to ${RANKS[rankFor(first.xp)].title} and no order of the day says so`);
    assert(c1.honours.some((h) => h.kind === 'named'),
      'eight men earned their first nicknames and the orders name nobody');

    /* SURVIVES THE STORE — a bulletin that dies on reload is read by no one. */
    Company.save(Company.load('republic'));
    const c2 = Company.load('republic');
    assert(JSON.stringify(c2.honours) === JSON.stringify(c1.honours),
      'the honours did not survive a save/load round trip');
    const lines = Company.honoursOf(c2);
    assert(lines.length === c2.honours.length,
      `honoursOf rendered ${lines.length} sentences for ${c2.honours.length} honours`);
    for (const line of lines) {
      assert(typeof line === 'string' && line.length,
        'an honour rendered as nothing — the page would print a blank toast');
      for (const word of ['points', 'currency', 'purchase', 'upgrade', 'unlock', 'buy']) {
        assert(!new RegExp(`\\b${word}\\b`, 'i').test(line),
          `an order of the day says "${word}": "${line}" — the bulletin has become a shop receipt`);
      }
    }

    /* OVERWRITTEN: a quiet fold — nobody promoted, nobody scarred — leaves an
     * EMPTY list, never last week's ceremony replayed. */
    const out2 = new CommandRoster(ARMIES.republic);
    for (const m of Company.fieldable(Company.load('republic'))) out2.enlistRecord(m);
    Company.keep(out2.all, { army: 'republic', deployed: out2.all, ground: 'geonosis' });
    assert(Company.load('republic').honours.length === 0,
      'a fold where nothing notable happened kept the old honours — the toast has become a plaque');

    /* AND A WIPE WRITES NONE. Rebuild a notable fold first so the wipe has
     * something to overwrite, then lose everybody: the dead get the memorial,
     * not a bulletin. */
    const out3 = new CommandRoster(ARMIES.republic);
    for (const m of Company.fieldable(Company.load('republic'))) out3.enlistRecord(m);
    for (const t of out3.all) t.award(12);
    Company.keep(out3.all, { army: 'republic', deployed: out3.all, ground: 'felucia' });
    assert(Company.load('republic').honours.length > 0, 'the rebuild fold wrote nothing to overwrite');
    const gone = Company.fieldable(Company.load('republic'));
    Company.keep([], { army: 'republic', deployed: gone, ground: 'felucia' });
    assert(Company.load('republic').honours.length === 0,
      'a wipe wrote orders of the day — the morning after everyone died is not a ceremony');
    return `${n} men: 16 moments capped to ${Company.HONOURS_KEEP}, survive the store, no currency `
      + 'word · a quiet fold empties the list · a wipe writes none';
  }));

  check('barracks: the parade is deterministic and framed — two ranks, feet on the dirt, painted with the game\'s brushes', () => {
    /**
     * "I can't see Sith troops let alone my troops." The stage stands the
     * EXACT next deployment, and everything it is built from is exported and
     * DOM-free precisely so this check can drive it with no canvas and no GL
     * — these are pure Object3D builds under the dom-shim, which is the whole
     * reason the staging lives as functions and not inside a Menu method.
     */
    const slots = paradeSlots(10);
    assert(slots.length === 10, `${slots.length} slots dealt for ten men`);
    const front = slots.slice(0, SQUAD);
    const rear = slots.slice(SQUAD);
    assert(front.length === SQUAD && rear.length === SQUAD,
      `ten men fell out as ranks of ${front.length}/${rear.length} against a squad of ${SQUAD}`);
    assert(front.every((s) => s.z === front[0].z) && rear.every((s) => s.z === rear[0].z),
      'a rank does not stand on one line');
    assert(front[0].z > rear[0].z,
      `rank 0 stands at z ${front[0].z} behind rank 1 at ${rear[0].z} — the deploying order must `
      + 'read front to back, because it is the order they fight');
    for (const [name, rank] of [['front', front], ['rear', rear]]) {
      const sum = rank.reduce((a, s) => a + s.x, 0);
      assert(Math.abs(sum) < 1e-9,
        `the ${name} rank's files sum to x ${sum} — the formation is not centred on the origin`);
    }

    /* A RECRUIT: rung 0, no look — the stub must carry NO paint at all,
     * because plain plate is what "no history yet" looks like. And his feet
     * are ON the ground: a line hovering four centimetres up is the exact
     * small-species defect standPreviewFigure's note records. */
    const cheapest = ARMIES.republic.tiers[0].type;
    const fig = buildParadeFigure(
      Muster.materialize({ designation: 'CT-2001', type: cheapest, squad: null, look: null }, 'republic'));
    assert(fig && fig.rig, 'a recruit did not build — the parade would stand an empty slot');
    fig.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fig.root);
    assert(Math.abs(box.min.y) <= 0.02,
      `the figure's lowest point sits ${(box.min.y * 100).toFixed(1)}cm from y=0 — he is floating `
      + 'over the parade ground or buried in it');
    assert(!fig._stub._cmdPaint && !fig._stub._cmdMark && !fig._stub._cmdBand && !fig._stub._cmdScorch,
      'a rung-0 recruit with no look came out painted');
    assert((fig._stub._modMaterials || []).length === 0,
      `${(fig._stub._modMaterials || []).length} paint materials on a man with nothing to show`);

    /* A VETERAN: rank paint, mark, band and scars, through the same shipped
     * prototypes the battlefield uses — one statement of what a Sergeant
     * looks like, everywhere. Built twice to prove the build draws from no
     * stream: same skeleton both times. */
    const vetMan = {
      army: 'republic', type: cheapest, designation: 'CT-2002',
      xp: 12, wounds: 2, look: { mark: 'blood', band: 'sky' },
    };
    const vet = buildParadeFigure(vetMan);
    assert(vet && vet._stub._cmdPaint && vet._stub._cmdMark && vet._stub._cmdBand && vet._stub._cmdScorch,
      `a Sergeant with a mark, a band and two wounds is missing paint: ${['_cmdPaint', '_cmdMark',
        '_cmdBand', '_cmdScorch'].filter((k) => !vet?._stub[k]).join(', ')}`);
    assert(vet._stub._cmdPaint.color.getHex() === RANKS[rankFor(12)].color,
      'the parade paints a different Sergeant colour than the battlefield does');
    const again = buildParadeFigure(vetMan);
    assert(again.rig.list.length === vet.rig.list.length,
      `two builds of one man have ${vet.rig.list.length} and ${again.rig.list.length} bones — `
      + 'the parade is drawing from a stream');

    /* AND IT IS FRAMEABLE: real content for framePreviewCamera, and the
     * three shots, opening on the whole line. */
    const content = paradeContent([fig, vet]);
    assert(content.y1 > content.y0 && Number.isFinite(content.radius) && content.radius > 0,
      `the formation frames as ${JSON.stringify(content)} — nothing for the camera to hold`);
    assert(PARADE_SHOTS.length === 3 && PARADE_SHOTS[0].id === 'line',
      'the stage bar does not open on the whole line');
    return `2 ranks of ${SQUAD}, centred, front at z ${front[0].z} · recruit unpainted, sole at `
      + `${(box.min.y * 100).toFixed(1)}cm · Sergeant wears all four channels, ${vet.rig.list.length} `
      + 'bones both builds';
  });

  check('barracks: a kit and a paint are geometry and colour, and move no number', async () => {
    /**
     * THE DRESSING ROOM'S HALF OF "THE PAGE SELLS NOTHING".
     *
     * The mark and the band above are paint bolted onto a finished body by
     * `enlistBody`. A KIT is not: a pauldron is a plate that has to exist when
     * the rig is built, so a man's kit rides the SPAWN — `world.spawnEnemy(t,
     * p, { look, kind })` → `Enemy` → `kitOptsFrom` → `buildTrooper`. That is
     * a different road into the same body, and it is a road that could carry a
     * number, so it gets the same proof.
     *
     * THE SEED IS PINNED RATHER THAN THE PROFILE. `Enemy`'s constructor rolls
     * pace off `enemyRng` before `_build` is ever called, so seeding the
     * stream to the same value before each construction makes the two bodies
     * numerically identical by construction — and any difference that then
     * appears is the kit, exactly. No ratio, no epsilon: equality.
     */
    const { bootWorld } = await import('./_coop.mjs');
    const { KIT_FIELDS, PAINT_SLOTS, kitOptsFrom, PAINTS } = await import('../../src/game/Bodies.js');
    const { world } = await bootWorld({ settings: { quality: 'low' } });

    /** Every material colour on a rig, and how many meshes carry them. */
    const survey = (e) => {
      const hexes = new Set();
      let meshes = 0;
      (e.rig?.root || e.group)?.traverse?.((o) => {
        if (!o.isMesh) return;
        meshes++;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m) continue;
          if (m.color) hexes.add(m.color.getHex());
          if (m.emissive && m.emissive.getHex()) hexes.add(m.emissive.getHex());
        }
      });
      return { meshes, hexes };
    };

    const SEED = 90210;
    const spawn = (look, kind, x) => {
      enemyRng.seed(SEED);
      const e = world.spawnEnemy(kind === 'steel' ? 'b1' : 'trooper',
        new THREE.Vector3(x, 0, 24), look ? { look, kind } : null);
      return e;
    };

    /* THE FULLEST KIT THE VOCABULARY ALLOWS, built off KIT_FIELDS itself so a
     * field added tomorrow is under this check the day it ships rather than the
     * day someone remembers. Each field takes its LAST legal value, which is
     * the one furthest from "as issued" in every row. */
    const dressed = (kind) => {
      const kit = {};
      for (const f in KIT_FIELDS[kind]) {
        const vals = KIT_FIELDS[kind][f].values;
        kit[f] = vals[vals.length - 1][0];
      }
      const paint = {};
      for (const [field] of PAINT_SLOTS[kind]) paint[field] = PAINTS[PAINTS.length - 1].id;
      return { kit, paint };
    };

    const NUMBERS = ['maxHp', 'hp', 'attackDamage', 'speed', 'forceMax', 'radius', 'height'];
    const report = [];
    for (const [kind, x] of [['flesh', 0], ['steel', 12]]) {
      const bare = spawn(null, kind, x);
      const look = dressed(kind);
      const kitted = spawn(look, kind, x + 4);
      for (const k of NUMBERS) {
        if (bare[k] == null && kitted[k] == null) continue;
        assert(bare[k] === kitted[k],
          `a dressed ${kind} body's ${k} is ${kitted[k]} and a bare one's is ${bare[k]} — `
          + 'the dressing room is selling power');
      }
      /* …AND THE SAME BRAIN. A kit that quietly changed the archetype would
       * move nothing above and everything in the fight. */
      assert(bare.type === kitted.type, `a dressed ${kind} body is a ${kitted.type}`);
      assert(bare.constructor === kitted.constructor, 'a dressed body is a different class');

      /* IT ACTUALLY LANDED, both halves. Geometry: more meshes on the rig,
       * because every field's last value bolts something on. Colour: the
       * palette hex the player picked is on the body and is not on the bare
       * one — which is what "I painted it and nothing happened" would look
       * like, and it is the complaint this whole tab exists to answer. */
      const b = survey(bare); const d = survey(kitted);
      assert(d.meshes > b.meshes,
        `a fully kitted ${kind} body has ${d.meshes} meshes and a bare one ${b.meshes} — `
        + 'the kit is stored and never built');
      const hex = PAINTS[PAINTS.length - 1].color;
      assert(d.hexes.has(hex),
        `${PAINTS[PAINTS.length - 1].name} is not on a ${kind} body that was painted it`);
      assert(!b.hexes.has(hex), `an unpainted ${kind} body already wears the test colour`);
      report.push(`${kind} +${d.meshes - b.meshes} meshes, painted, 0 numbers moved`);
    }

    /**
     * AND THE GATE REFUSES EVERYTHING ELSE. `kitOptsFrom` is the only door
     * between a stored look and a body builder, and the store is a JSON blob
     * the player's own browser holds — so a hand-edited one must not be able
     * to reach past the wardrobe. `frame` is named because it is the live
     * risk: it is real, `buildTrooper` honours it, and it is what the
     * silhouette checks measure to keep six archetypes apart at range.
     */
    const hostile = kitOptsFrom({
      kit: { frame: 2.5, pauldron: 'L', scale: 9, hp: 999, pack: 'nonsense' },
      paint: { color: 'bone', visor: '#ff0000', frame: 'ash' },
    }, 'flesh');
    assert(!('frame' in hostile), 'frame reached the body builder through a stored kit');
    for (const k of ['scale', 'hp']) assert(!(k in hostile), `${k} reached the body builder`);
    assert(hostile.pauldron === 'L', 'a legal field was dropped by the gate');
    assert(!('pack' in hostile), 'an illegal VALUE for a legal field went through');
    assert(hostile.color === PAINTS.find((p) => p.id === 'bone').color,
      'a legal paint id did not resolve to its palette colour');
    assert(!('visor' in hostile), 'a raw colour string went through as a paint');
    return `${report.join('; ')}; gate dropped frame/scale/hp and a raw hex`;
  });

  check('barracks: a contingent slate is exactly what the purse composes, and the field takes it', () => withCleanStore(() => {
    /**
     * THE ONE ANSWER, TWICE — the defect this replaced was two hand-maintained
     * twins: `_musterOpening` composed the line the fight actually gets, and
     * the tab guessed at it with `n × cheapest`. They disagreed, and the tab's
     * guess was the one the player read.
     *
     * There is now one composer, so what has to be asserted is that BOTH
     * callers still route through it and that neither has grown a second
     * opinion. The slate is checked against `composeContingent` directly, and
     * the roster the fight builds is checked against the slate — with veterans
     * standing, because a purse that forgets what the standing line already
     * cost is exactly how "eight allies" became fourteen bodies.
     */
    const cases = [
      { allies: 8, allyUnit: CONTINGENT_MIXED, vets: 0 },
      { allies: 8, allyUnit: CONTINGENT_MIXED, vets: 3 },
      { allies: 12, allyUnit: 0, vets: 0 },
      { allies: 12, allyUnit: 2, vets: 5 },
      { allies: 6, allyUnit: 3, vets: 0 },
    ];
    const lines = [];
    for (const cs of cases) {
      localStorage.removeItem(Muster.KEY);
      localStorage.removeItem(Company.KEY);
      const plan = musterPlan({ ...DEFAULT_SETTINGS, mode: 'waves', allies: cs.allies,
        allyUnit: cs.allyUnit, allyArmy: 0 }, null);
      assert(plan && !plan.armyMode, `waves with ${cs.allies} allies did not plan a contingent`);
      assert(plan.unit === cs.allyUnit, `the plan lost the composition: ${plan.unit}`);

      /* A STANDING LINE, banked the way a withdrawal banks one, so the purse
       * has something to subtract. */
      if (cs.vets) {
        const roll = freshRoll(cs.vets);
        Company.keep(roll.all, { army: plan.army, deployed: roll.all, ground: 'test' });
      }
      const c = Company.load(plan.army);
      const slate = Muster.ensure(plan, c);
      const standing = Company.fieldable(c, plan.want).map((m) => m.type);
      const want = composeContingent(ARMIES[plan.army], plan.want, standing, plan.unit);
      const got = slate.recruits.map((r) => r.type);
      assert(JSON.stringify(got) === JSON.stringify(want.types),
        `the tab slated ${JSON.stringify(got)} and the purse composes `
        + `${JSON.stringify(want.types)} for ${JSON.stringify(cs)}`);

      /* AND THE FIGHT'S OWN ROSTER IS THAT LINE. `lineup` is the deployment
       * answer both the tab and `_musterOpening` read; the veterans lead it
       * and the recruits fill it, and nothing is truncated to `want` — which
       * for a contingent is a PURSE and not a headcount. That truncation is
       * not hypothetical: capping a contingent at the slider's number is
       * exactly the bug this resolver was rewritten to stop, and it is the
       * shape a careless `Math.min(want, …)` would put back. */
      const line = Muster.lineup(plan, c);
      const flat = (a) => JSON.stringify([...a].sort());
      assert(line.length === standing.length + want.types.length,
        `the lineup fields ${line.length} men off ${standing.length} veterans and a slate of `
        + `${want.types.length} — for ${JSON.stringify(cs)}`);
      assert(flat(line.map((m) => m.type)) === flat([...standing, ...want.types]),
        `the lineup is made of ${flat(line.map((m) => m.type))} and the purse bought `
        + `${flat([...standing, ...want.types])}`);
      /* AND EVERY MAN ON IT IS A MAN — a designation apiece, none blank, none
       * shared, because "10 troops" with nobody behind it is the tab the
       * player already threw out. */
      const names = new Set(line.map((m) => m.designation));
      assert(names.size === line.length && !names.has(undefined) && !names.has(''),
        `${line.length} men on the line and ${names.size} distinct names`);
      lines.push(`${cs.allies}/${cs.allyUnit}/+${cs.vets}v → ${got.length}`);
    }
    return lines.join(', ');
  }));

  check('barracks: the dead end is a door, and what comes through it has names', () => withCleanStore(() => {
    /**
     * A FRESH PROFILE OPENS ON A MODE THAT FIELDS NOBODY. That was the whole
     * of the player's complaint arriving by a second road: the tab was
     * honest — this mode has no army of yours — and honest was useless.
     *
     * So the sentence kept its honesty and grew a control, and this is the
     * proof that the control is real: click it on a mode with a null plan and
     * the muster below fills with MEN — designations, and a look each — not a
     * number and not a promise.
     */
    const { menu, doc, close } = menuOn({ mode: 'waves', allies: 0 });
    /* WHAT REACHED THE DISK, caught at the door rather than read after it —
     * the fixture puts the player's own settings back the moment the click
     * returns, so the written bytes have to be caught as they go past. */
    let saved = null;
    const realSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k, v) => { if (k === STORE_KEY) saved = v; return realSet(k, v); };
    try {
      assert(musterPlan(menu.s, null) === null, 'the fixture mode already plans a muster');
      menu.showMenu();
      menu._buildCompanyList();
      const host = doc.getElementById('company-muster');
      const door = host.querySelector('.company-restore');
      assert(door, 'a mode that fields nobody offers no way to raise a line');
      assert(!host.querySelectorAll('[data-recruit]').length, 'men mustered before the door was opened');

      const hadS = localStorage.getItem(STORE_KEY);
      try { door.click(); } finally {
        /* …put back through the REAL setter: restoring through the spy would
         * overwrite the very bytes the spy was installed to catch. */
        if (hadS == null) localStorage.removeItem(STORE_KEY);
        else realSet(STORE_KEY, hadS);
      }
      assert(menu.s.allies === OPENING_STRENGTH,
        `the door set allies to ${menu.s.allies}`);
      /* AND IT SAVED. "I should be able to boot the game fresh and see the
       * troops I will have" is the whole point of the door, so a version of it
       * that writes `this.s` directly — same men on screen, nothing on disk —
       * is the door not working, one boot later. `_set` is what persists;
       * this is the assertion that notices when something stops calling it. */
      assert(JSON.parse(saved || '{}').allies === OPENING_STRENGTH,
        `the line was raised on screen and ${JSON.parse(saved || '{}').allies} was written to disk`);
      const men = [...doc.getElementById('company-muster').querySelectorAll('[data-recruit]')];
      assert(men.length >= 1, 'the door opened onto an empty muster');
      const named = men.filter((d) => /[A-Z]{1,3}-?\d/.test(d.querySelector('b')?.textContent || ''));
      assert(named.length === men.length,
        `${men.length - named.length} of ${men.length} men came through the door unnamed`);

      /* AND THEY ARE THE SAME MEN THE FIGHT WOULD GET — the door writes a
       * setting, and the setting is what `musterPlan` reads, so there is no
       * second path here to drift. */
      const plan = musterPlan(menu.s, null);
      assert(plan, 'the door left the plan null');
      const line = Muster.lineup(plan, Company.load(plan.army));
      assert(line.length === men.length,
        `the page shows ${men.length} men and the drop fields ${line.length}`);

      /* …AND ONE OPENS. The complaint was "you can't click anywhere to see
       * these troops", so the door is not done until the man behind it has a
       * page with a pen and a wardrobe on it. */
      men[0].click();
      const page = doc.getElementById('company-page');
      assert(page && page.querySelector('[data-kit]'),
        'a man raised through the door has no kit to change');
      assert(page.querySelector('[data-paint]'), 'a man raised through the door has no paint');
      assert(page.querySelector('input'), 'a man raised through the door cannot be named');
      return `${men.length} named men through the door, saved to disk, `
        + 'first one opens with a pen and a wardrobe';
    } finally { localStorage.setItem = realSet; close(); }
  }));

  check('barracks: the scar is reachable in every mode a company lives in', () => {
    /**
     * ── A FEATURE THAT WAS SHIPPED, SAVED, PRINTED AND UNEARNABLE ─────────
     *
     * `Trooper.wounds` is persisted, printed on the dossier, phrased in the
     * story line, celebrated in the orders of the day and painted on the plate
     * by `scorchUp`. It had exactly one writer — `Enemy._getUpFromDown` —
     * which fires only where `MODES.downed` is declared. Grep the whole tree
     * for that flag and it is on ONE mode: The Line. So in Command, in
     * skirmish, in the wave modes — every mode a company actually lives in —
     * no man could ever earn a scar, and the paint was unreachable.
     *
     * The second writer is in `_troops`, the one loop that touches every
     * living body of every army once a frame, so it is present wherever a
     * director runs. This drives it there rather than calling it: what has to
     * be true is that a man shot to a third of his health in an ORDINARY mode
     * comes out of the frame carrying it.
     */
    const modes = Object.keys(MODES).filter((k) => !MODES[k]?.downed);
    assert(modes.length >= 3, `only ${modes.length} modes lack a downed rule`);

    const { d, c } = licenceArmy();
    const sq = d.squadsOf(c)[0];
    const man = sq.find((t) => t.body);
    assert(man && (man.wounds | 0) === 0, 'the fixture man already has a scar');
    assert(!d.world.director?.downedMen,
      'the fixture is running a mode that declares downed — the point is the modes that do not');

    /* A SCRATCH IS NOT A WOUND. */
    man.body.hp = man.body.maxHp * (HURT_AT + 0.2);
    d._troops(1 / 30, {});
    assert((man.wounds | 0) === 0,
      `a man on ${(man.body.hp / man.body.maxHp).toFixed(2)} of his health was written a scar`);

    /* …AND BEING SHOT TO A THIRD IS. */
    man.body.hp = man.body.maxHp * (HURT_AT - 0.01);
    d._troops(1 / 30, {});
    assert((man.wounds | 0) === 1,
      `a man shot to a third came out of the frame with ${man.wounds | 0} wounds — the scar `
      + 'is still unreachable outside The Line');

    /* ONE PER RUN, whatever else happens to him — `wounds` reads as "runs he
     * nearly died in", which is the number a scar can honestly stand for. */
    for (let i = 0; i < 20; i++) { man.body.hp = 1; d._troops(1 / 30, {}); }
    assert((man.wounds | 0) === 1,
      `twenty frames at 1 hp wrote ${man.wounds} scars — a bad afternoon is one scar`);

    /* …AND THE OTHER WRITER RESPECTS THE SAME FLAG, so a man who is shot to a
     * third and THEN goes down and is picked up is not counted twice. */
    Enemy.prototype._getUpFromDown.call({
      downed: true, bleed: 1, _downHelp: 9, maxHp: 100, hp: 5, actor: null, beingDragged: null,
      world: { command: { log: [], areaNumber: 1, wave: 1, commander: { side: 9 } }, notify() {} },
      team: 1, trooper: man,
    });
    assert((man.wounds | 0) === 1,
      `going down after being bloodied made it ${man.wounds} — the two writers are double-counting`);

    /* AND IT MOVES NO NUMBER. A scar is a mesh; the man is the man. */
    const was = { hp: man.body.maxHp, dmg: man.body.attackDamage, speed: man.body.speed };
    d._troops(1 / 30, {});
    assert(man.body.maxHp === was.hp && man.body.attackDamage === was.dmg
      && man.body.speed === was.speed, 'carrying a scar changed a number');
    return `1 scar for a man shot to ${HURT_AT} in a mode with no downed rule, 1 after twenty `
      + `more frames and a rescue; ${modes.length} modes now reachable`;
  });

  check('barracks: left behind is not killed in action, and the memorial says which',
    () => withCleanStore(() => {
      /**
       * `keep` treats every man who went out and did not come back as gone,
       * which is right and is the whole cost of the mechanism. The memorial
       * was printing ONE sentence over two different facts: the man cut down
       * in engagement two, and the man standing eleven metres from a closing
       * ramp with nothing wrong with him.
       *
       * Both cost the same — there is no branch anywhere that softens the
       * second, and this check asserts that too — but a casualty list that
       * cannot tell them apart teaches nothing about either.
       */
      const roll = freshRoll(6);
      const [home, killed, stranded] = [roll.all[0], roll.all[1], roll.all[2]];
      killed.alive = false;
      Company.keep([home], {
        army: 'republic', deployed: roll.all, ground: 'geonosis', ended: 'withdrew',
        left: roll.all.filter((t) => t !== home),
        stranded: [stranded.designation],
        roll: [{ name: killed.name, killer: 'B2 Super Battle Droid', at: 421 }],
      });
      const c = Company.load('republic');

      /* IT STILL COSTS EVERYTHING. Five went out and did not come back; five
       * are off the roll, whatever the memorial calls them. */
      assert(c.men.length === 1 && c.men[0].designation === home.designation,
        `${c.men.length} men still on a roll that lost five`);
      assert((c.lost | 0) === 5, `the ledger counts ${c.lost} lost of 5`);

      const row = (t) => c.fallen.find((f) => f.designation === t.designation);
      assert(row(killed)?.fate === 'kia',
        `a man cut down reads "${row(killed)?.fate}"`);
      assert(row(killed)?.killer === 'B2 Super Battle Droid' && row(killed)?.at === 7,
        'the killed man lost his epitaph');
      assert(row(stranded)?.fate === 'left',
        `a man still standing when the ramp closed reads "${row(stranded)?.fate}"`);
      /* AND NOTHING IS STANDING OVER HIM. A killer under a man nothing killed
       * is the blank this whole field exists to fill. */
      assert(row(stranded)?.killer === null && row(stranded)?.at === null,
        `a man left behind was given a killer: ${JSON.stringify(row(stranded))}`);
      /* A man who went out, is not on the manifest and is not named stranded
       * is a casualty — the default every record written before this meant. */
      const other = roll.all.find((t) => t !== home && t !== killed && t !== stranded);
      assert(row(other)?.fate === 'kia', 'an unnamed loss stopped defaulting to a casualty');

      /* THE PAGE SAYS IT, off the store, through the real renderer. */
      const { menu, doc, close } = menuOn();
      try {
        menu.showMenu();
        menu._buildCompanyList();
        menu._showCompany('republic/-fallen');
        const txt = doc.getElementById('company-page').textContent;
        assert(/still standing when the ramp closed/.test(txt),
          'the memorial says nothing about the man it left');
        assert(/B2 Super Battle Droid/.test(txt), 'the memorial lost the killer it did know');
      } finally { close(); }

      /* AND A HOSTILE STORE CANNOT INVENT A THIRD FATE. */
      const raw = JSON.parse(localStorage.getItem(Company.KEY));
      raw.republic.fallen[0].fate = 'promoted-to-glory';
      localStorage.setItem(Company.KEY, JSON.stringify(raw));
      assert(Company.load('republic').fallen[0].fate === 'kia',
        'a made-up fate came off disk intact');
      return '5 lost either way · 1 kia with a killer and a minute, 1 left with neither, '
        + 'the page says both, a forged fate reads kia';
    }));

  check('barracks: a pattern issues across both stores, and nothing personal travels',
    () => withCleanStore(() => {
      /**
       * ── THE FOUR HUNDRED CLICKS ───────────────────────────────────────────
       *
       * Twelve rows of kit and three of paint across ten men is somewhere north
       * of four hundred clicks to make a company look like one company, and
       * looking like one company is most of what this screen is for. So a
       * man's pattern can be issued.
       *
       * BOTH STORES, and that is the clause that matters: on a fresh profile
       * every man the player HAS is a recruit on the slate, so a control that
       * only wrote the roll would do nothing at all for exactly the person it
       * was written for. `Muster.issue` is the one door because Muster is the
       * only file that can see both — Company may not import it back.
       *
       * AND NOTHING PERSONAL TRAVELS. The callsign is the name you gave one
       * soldier; the mark and the band are the whole of how you pick him out
       * of a line at forty metres. A pattern that copied either would delete
       * the one thing on this tab that makes a man findable, which is the
       * feature eating itself.
       */
      const roll = freshRoll(6);
      for (let i = 0; i < roll.all.length; i++) roll.all[i].squad = i < 3 ? 0 : 1;
      Company.keep(roll.all, { army: 'republic', deployed: roll.all, ground: 'geonosis' });
      const plan = planOf(10);
      Muster.ensure(plan, Company.load('republic'));

      const from = Company.load('republic').men[0];
      Company.dress('republic', from.designation, {
        kit: { pauldron: 'R', kama: 'long' },
        paint: { color: 'blood', visor: 'sun' },
        callsign: 'Torch', mark: 'ice',
      });
      const before = Muster.slateFor('republic').recruits.length;
      assert(before > 0, 'the fixture minted no recruits to issue to');

      /* ── HIS SQUAD ONLY ────────────────────────────────────────────────── */
      const n = Muster.issue('republic', from.designation, 'squad');
      assert(n > 0, 'issuing to a squad wrote nobody');
      const c1 = Company.load('republic');
      const mate = c1.men.find((m) => m.squad === from.squad && m.designation !== from.designation);
      const other = c1.men.find((m) => m.squad !== from.squad);
      assert(mate?.look?.kit?.pauldron === 'R' && mate?.look?.paint?.color === 'blood',
        `a man in the same squad wears ${JSON.stringify(mate?.look)}`);
      assert(!other?.look?.kit,
        `a man in another squad was issued the pattern anyway: ${JSON.stringify(other?.look)}`);
      assert(!mate.look.callsign && !mate.look.mark,
        `the pattern carried something personal: ${JSON.stringify(mate.look)}`);
      /* AND THE MAN IT CAME FROM IS UNTOUCHED — including the name he answers
       * to, which a loop that wrote him too would have overwritten with his
       * own pattern minus the callsign. */
      const still = c1.men.find((m) => m.designation === from.designation);
      assert(still.look.callsign === 'Torch' && still.look.mark === 'ice',
        `the pattern's own man lost his name or his mark: ${JSON.stringify(still.look)}`);

      /* ── AND THE WHOLE COMPANY, WHICH IS THE SLATE TOO ─────────────────── */
      Muster.issue('republic', from.designation, 'line');
      const c2 = Company.load('republic');
      for (const m of c2.men) {
        if (m.designation === from.designation) continue;
        assert(m.look?.kit?.kama === 'long' && m.look?.paint?.visor === 'sun',
          `${m.designation} on the roll wears ${JSON.stringify(m.look)}`);
      }
      const slate = Muster.slateFor('republic');
      assert(slate.recruits.length === before, 'issuing a pattern changed the size of the slate');
      for (const r of slate.recruits) {
        assert(r.look?.kit?.kama === 'long' && r.look?.paint?.visor === 'sun',
          `${r.designation} on the SLATE wears ${JSON.stringify(r.look)} — the men a fresh `
          + 'player actually has were not written');
      }

      /* ── A DROID WEARS WHAT A DROID CAN ────────────────────────────────── */
      const droids = new CommandRoster(ARMIES.separatist);
      for (let i = 0; i < 3; i++) droids.enlist(ARMIES.separatist.tiers[0].type);
      for (const t of droids.all) t.squad = 0;
      Company.keep(droids.all, { army: 'separatist', deployed: droids.all, ground: 'geonosis' });
      const d0 = Company.load('separatist').men[0];
      Company.dress('separatist', d0.designation,
        { kit: { pauldron: 'R', pack: 'rocket' }, paint: { color: 'jungle' } });
      Muster.issue('separatist', d0.designation, 'line');
      const mate2 = Company.load('separatist').men[1];
      assert(mate2.look?.kit?.pack === 'rocket',
        `a droid did not get the part of the pattern a droid can wear: ${JSON.stringify(mate2.look)}`);
      assert(!('pauldron' in (mate2.look?.kit || {})),
        'a droid was issued a clone pauldron — the gate is not being asked');

      /* ── AND IT MOVES NO NUMBER, which is the law this whole tab is under. */
      const after = Company.load('republic').men;
      for (const m of after) {
        assert(!('hp' in m) && !('post' in (m.look || {})) && (m.xp | 0) === 0,
          `issuing a pattern wrote something that is not a look: ${JSON.stringify(m.look)}`);
      }
      return `${n} in a squad of 3, then the whole roll and all ${slate.recruits.length} `
        + 'recruits; callsign, mark and band stayed put; a droid got the rocket tube and not the pauldron';
    }));

  check('barracks: a veteran can be moved between squads, and the seat does not move with him',
    () => withCleanStore(() => {
      /**
       * A recruit could be dealt a squad from the day the slate existed and a
       * man who had COME HOME could not, so a company that survived was stuck
       * in whatever squads the muster happened to deal it — for ever. That is
       * odd on its own and it became load-bearing when the post arrived: a
       * seat belongs to a squad, so a player who cannot move a man between
       * squads cannot organise the company the seats are in.
       *
       * AND THE SEAT STAYS BEHIND. Carrying it would put a second holder in
       * the squad he walks into, which is `leaderOf` answering with whichever
       * man came first in an array whose order is nobody's decision.
       */
      const roll = freshRoll(4);
      roll.all[0].award(RANKS[2].xp);
      for (const t of roll.all) t.squad = 0;
      Company.keep(roll.all, { army: 'republic', deployed: roll.all, ground: 'geonosis' });
      const him = roll.all[0].designation;
      Company.appoint('republic', him, true, true);
      assert(Company.load('republic').men.find((m) => m.designation === him)?.post === true,
        'the fixture failed to seat him');

      Company.assign('republic', him, 1);
      const m = Company.load('republic').men.find((x) => x.designation === him);
      assert(m.squad === 1, `he was moved to squad ${m.squad}`);
      assert(m.post !== true, 'he carried his squad\'s seat into a different squad');

      /* AN IMPOSSIBLE SQUAD IS "WHEREVER THE MUSTER DEALS HIM", not a refusal
       * and not a stored 900: this is a screen writing a number and the store
       * is where a number is decided. */
      Company.assign('republic', him, 900);
      assert(Company.load('republic').men.find((x) => x.designation === him)?.squad === null,
        'a squad past the ceiling was stored as typed');
      Company.assign('republic', him, -3);
      assert(Company.load('republic').men.find((x) => x.designation === him)?.squad === null,
        'a negative squad was stored as typed');

      /* THE PAGE OFFERS IT, and offers the same squads a recruit's page does. */
      const { menu, doc, close } = menuOn();
      try {
        menu.showMenu();
        menu._buildCompanyList();
        menu._showCompany(`republic/${him}`);
        const chips = [...doc.getElementById('company-page').querySelectorAll('[data-squad]')];
        assert(chips.length === Company.SQUADS_MAX + 1,
          `a veteran's page offers ${chips.length} squad chips and the roll has `
          + `${Company.SQUADS_MAX} squads plus "wherever"`);
        chips[2].click();
        assert(Company.load('republic').men.find((x) => x.designation === him)?.squad === 2,
          'the chip on a veteran\'s page wrote nothing');
      } finally { close(); }
      return `moved 0 → 1 → clamped → 2 through the page; the seat stayed in squad 0; `
        + `${Company.SQUADS_MAX} squads offered on both pages`;
    }));

  check('barracks: the order of battle is the shape the ground forms, and it names who has each squad',
    () => withCleanStore(() => {
      /**
       * ── A LIST OF TEN NAMES IS A LIST; A COMPANY IS SQUADS ────────────────
       *
       * Every squad in the fight has somebody in charge of it — that has been
       * true since `leaderOf` existed — and it had never once been SHOWN. So a
       * player who named a man to a seat, which is the whole point of the
       * post, could not see their own company's shape anywhere.
       *
       * The page must not have its own opinion about either half. `squadPlan`
       * is the deal `CommandRoster.assignSquads` performs, lifted so a screen
       * can ask without writing, and `leadOf` is `leaderOf` — post first, then
       * the rule. This drives the real page and then asks the FIGHT the same
       * two questions, so the day either derivation drifts, the tab and the
       * ground stop agreeing and this goes red.
       */
      const roll = freshRoll(7);
      roll.all[3].award(RANKS[2].xp);
      Company.keep(roll.all, { army: 'republic', deployed: roll.all, ground: 'geonosis' });
      const seated = roll.all[3].designation;
      Company.appoint('republic', seated, true, true);
      /* AND ONE MAN PUT SOMEWHERE BY HAND. The deal fills the first squad that
       * is not full; a man the player has already assigned keeps what he was
       * given, and the order of battle has to honour that or the veteran squad
       * picker is a control that writes a number nothing reads. Squad 3 is far
       * enough from the fill that only an honoured assignment puts him
       * there. */
      const posted = roll.all[6].designation;
      Company.assign('republic', posted, 3);

      const { menu, doc, close } = menuOn({ mode: 'command' });
      try {
        menu.showMenu();
        menu._buildCompanyList();
        menu._showCompany(null);
        const page = doc.getElementById('company-page');
        const squads = [...page.querySelectorAll('.orbat-squad')];
        assert(squads.length >= 2,
          `${squads.length} squad(s) on the order of battle for a line of ten`);

        /* THE SAME DEAL THE FIELD MAKES. Asked of the resolver the page reads
         * and of the pure rule the roster writes with, independently. */
        const plan = musterPlan(menu.s, null);
        const line = Muster.lineup(plan, Company.load('republic')) || [];
        const want = new Map();
        for (const [m, n] of squadPlan(line, SQUAD)) {
          want.set(n, (want.get(n) || 0) + 1);
        }
        assert(squads.length === want.size,
          `the page drew ${squads.length} squads and the deal makes ${want.size}`);
        /* ONE `<b>` PER MAN — a child-combinator count is what the page's own
         * markup happens to make and is not what is being asserted; the name
         * is. */
        const drawn = squads.map((d) => d.querySelectorAll('.company-taking b').length);
        assert(JSON.stringify(drawn) === JSON.stringify([...want.keys()].sort((a, b) => a - b)
          .map((k) => want.get(k))),
          `the page put ${JSON.stringify(drawn)} men in its squads and the deal makes `
          + `${JSON.stringify([...want.values()])}`);
        assert(drawn.reduce((a, b) => a + b, 0) === line.length,
          `${drawn.reduce((a, b) => a + b, 0)} men on the order of battle and ${line.length} `
          + 'in the line — somebody is not going, or is going twice');

        /* AND THE SEAT IS NAMED, in the squad the deal actually put him in. */
        const his = squadPlan(line, SQUAD).find(([m]) => m.designation === seated)?.[1];
        assert(Number.isInteger(his), 'the seated man is not in the line at all');
        const head = squads[[...want.keys()].sort((a, b) => a - b).indexOf(his)]
          ?.querySelector('h5')?.textContent || '';
        assert(/has the seat/.test(head) && head.includes(seated),
          `the squad the seated man is in reads "${head.replace(/\s+/g, ' ')}"`);

        /* …AND THE FIGHT AGREES. `leadOf` is what `CommandDirector.leaderOf`
         * calls, so the man the page names is the man the ground obeys. */
        const mine = squadPlan(line, SQUAD).filter(([, n]) => n === his).map(([m]) => m);
        assert(leadOf(mine)?.designation === seated,
          `the page says ${seated} has that squad and the rule says `
          + `${leadOf(mine)?.designation}`);

        /* THE HAND-ASSIGNED MAN IS WHERE HE WAS PUT, on the page and in the
         * deal both. */
        const where = squadPlan(line, SQUAD).find(([m]) => m.designation === posted)?.[1];
        assert(where === 3,
          `a man assigned to ${squadWordIndex(3)} was dealt into ${squadWordIndex(where)}`);
        const heads = squads.map((d) => d.querySelector('h5')?.textContent || '');
        assert(heads.some((h) => /4/.test(h.split('·')[0] || '')),
          `no squad heading on the page is the fourth: ${JSON.stringify(heads)}`);

        /* A SQUAD WITH NOBODY ABOVE THE FIRST RUNG SAYS SO rather than naming
         * a trooper who is a trooper like the other nine. */
        const flat = squads.map((d) => d.querySelector('h5')?.textContent || '')
          .filter((h) => !/has the seat/.test(h));
        assert(flat.some((h) => /outranks/.test(h)),
          `no squad of raw troopers said so: ${JSON.stringify(flat)}`);
        return `${squads.length} squads, ${drawn.join('+')} men, the seat named in `
          + `${['1st', '2nd', '3rd'][his] || `#${his + 1}`}, and leadOf agrees`;
      } finally { close(); }
    }));

  check('barracks: a delivered contingent is not announced as a refusal', () => {
    /**
     * ── THE LOUDEST OF THREE REFUSALS, FIRING ON THE SUCCESS PATH ─────────
     *
     * `composeContingent` tested the REMAINDER of the purse, and
     * `_musterOpening` runs after `_musterVeterans` has already enlisted the
     * whole line the barracks composed — so the purse handed in was a purse
     * already spent on exactly what was asked for. Every ordinary contingent
     * run opened with
     *
     *     CONTINGENT UNCHANGED — Clone Trooper costs 5 points and 10 troopers buys 0
     *
     * on top of a contingent delivered precisely as asked. `allyUnit` defaults
     * to rung 0, so this was every player, every run.
     *
     * A refusal has to be about the REQUEST — "six allies cannot buy an
     * AT-TE" is true and useful; "the men you already have used up the money"
     * is the system working. Both directions are pinned, because a version
     * that simply never refuses is the same defect with the volume down.
     */
    const A = ARMIES.republic;
    const cost = (t) => A.tiers.find((x) => x.type === t).cost;
    const line = (n, t) => new Array(n).fill(t);

    /* THE SUCCESS PATH, WITH THE LINE ALREADY STANDING. */
    for (const [want, unit, standing] of [
      [10, 0, line(10, 'trooper')],
      [8, CONTINGENT_MIXED, line(6, 'trooper')],
      [12, 2, line(6, 'sniper')],
    ]) {
      const r = composeContingent(A, want, standing, unit);
      assert(!r.refused,
        `a contingent of ${want} with ${standing.length} already standing was refused: `
        + `"${r.refused}"`);
    }

    /* …AND THE REAL ONE STILL SPEAKS. The dearest rung against a purse that
     * never could have bought it. */
    const dearest = A.tiers.reduce((a, b) => (b.cost > a.cost ? b : a));
    const rung = A.tiers.indexOf(dearest);
    const tooSmall = Math.max(1, Math.floor((dearest.cost - 1) / cost('trooper')));
    const no = composeContingent(A, tooSmall, [], rung);
    assert(no.refused && no.refused.includes(dearest.cost.toString()),
      `${tooSmall} allies cannot buy a ${dearest.type} (${dearest.cost} points) and the `
      + `composer said "${no.refused}"`);
    assert(!no.refused.includes(' buys 0'),
      `the refusal quotes the remainder rather than the purse: "${no.refused}"`);
    const enough = composeContingent(A, Math.ceil(dearest.cost / cost('trooper')), [], rung);
    assert(!enough.refused && enough.types.includes(dearest.type),
      `a purse that can exactly afford a ${dearest.type} got "${enough.refused}"`);
    return `3 delivered contingents announced nothing · ${tooSmall} allies still refused a `
      + `${dearest.type}, quoting the purse`;
  });

  check('barracks: every chip the wardrobe offers is a chip the builder reads', async () => {
    /**
     * ── THE DEAD CONTROL, ARRIVING THROUGH THE ONE DOOR NOBODY CHECKED ────
     *
     * `KIT_FIELDS` and `PAINT_SLOTS` are keyed by chassis KIND — flesh or
     * steel — which is the right key for what the STORE may hold and the wrong
     * one for what a PAGE may offer, because the options are read by
     * individual builders and the builders do not agree.
     *
     * Measured on the shipped roster before `WEARS` existed: a surviving AT-TE
     * (a named man on the Republic roll the moment one comes home) was offered
     * nine rows of kit and three of paint that `Vehicles.js` does not read,
     * and every B2, droideka and Magna was offered a unit flash and a
     * photoreceptor that their builders do not read. Fifteen controls that
     * stored a value, lit up, and changed nothing anywhere.
     *
     * This RE-MEASURES the table rather than trusting it: every rung of both
     * ladders is built bare and then once per field, and the whole
     * mesh-and-material signature is compared. A builder that learns a field,
     * or forgets one, goes red here rather than shipping a chip that does
     * nothing.
     */
    const B = await import('../../src/game/Bodies.js');
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    const sig = (root) => {
      const parts = [];
      const walk = (o) => {
        if (!o) return;
        if (o.isMesh) {
          parts.push(`${o.name || ''}:${o.geometry?.attributes?.position?.count || 0}`);
          for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
            if (m) parts.push(`${m.color ? m.color.getHex() : '-'}/${m.emissive ? m.emissive.getHex() : '-'}`);
          }
        }
        for (const c of (o.children || [])) walk(c);
      };
      walk(root);
      return parts.join('|');
    };
    const build = (type, opts) => {
      const A = ARCHETYPES[type];
      const built = A.build({ scale: A.scale ?? 1, ...(B.bodyOptsFor(type) || {}), ...opts });
      return sig(built.rig?.root || built.group);
    };

    const rows = [];
    let offered = 0;
    for (const id of Object.keys(ARMIES)) {
      const kind = id === 'separatist' ? 'steel' : 'flesh';
      for (const tier of ARMIES[id].tiers) {
        const type = tier.type;
        const base = build(type, {});
        const live = new Set();
        for (const f in (B.KIT_FIELDS[kind] || {})) {
          for (const [v] of B.KIT_FIELDS[kind][f].values) {
            if (build(type, { [f]: v }) !== base) { live.add(f); break; }
          }
        }
        for (const [f] of (B.PAINT_SLOTS[kind] || [])) {
          for (const p of B.PAINTS) {
            if (build(type, { [f]: p.color }) !== base) { live.add(f); break; }
          }
        }
        const can = B.wearableFor(type, kind);
        const shown = [...can.kit, ...can.paint];
        offered += shown.length;
        const dead = shown.filter((f) => !live.has(f));
        assert(!dead.length,
          `${type} is offered ${dead.length} control(s) its builder does not read: `
          + `${dead.join(', ')}`);
        /* AND NOTHING REAL IS HIDDEN. A field the builder honours and the page
         * refuses to offer is the same table drifting the other way. */
        const missing = [...live].filter((f) => !shown.includes(f));
        assert(!missing.length,
          `${type} reads ${missing.join(', ')} and the wardrobe does not offer `
          + 'them — the table is stale in the other direction');
        rows.push(`${type}:${shown.length}`);
      }
    }
    /* A CHASSIS THAT WEARS NOTHING GETS NO WARDROBE AT ALL, and the page says
     * so rather than drawing an empty room with two issue buttons under it. */
    const bare = Object.keys(B.WEARS).find((t) => Array.isArray(B.WEARS[t]) && !B.WEARS[t].length);
    assert(bare, 'no chassis in WEARS wears nothing — the vehicle case is untested');
    const { menu, doc, close } = menuOn();
    try {
      const html = menu._dressingHtml(null, 'flesh', 'republic', 'Squad', null, bare);
      assert(!/data-kit=|data-paint=/.test(html),
        `${bare} was still offered chips: the wardrobe drew for a chassis that wears nothing`);
      assert(/nothing on this chassis is yours to change/i.test(html),
        `${bare}'s page says nothing about why its wardrobe is empty`);
    } finally { close(); }
    return `${rows.length} chassis, ${offered} live controls offered, 0 dead; ${bare} gets a `
      + 'sentence instead of an empty room';
  });

  check('barracks: a refused write is what the next read answers with, and the page says so',
    () => withCleanStore(() => {
      /**
       * ── THE MIRROR OUTRANKS THE DISK, AND ONLY WHILE THE DISK REFUSES ────
       *
       * `Store.read` consulted the mirror only when the key was ABSENT, so a
       * store that had ever saved successfully — which is every store, after
       * the first fold — went on parsing the STALE disk copy for the rest of
       * the session. Which is exactly the failure the file was written to end:
       * quota fills, the player renames a man, `setItem` throws, and the next
       * click re-reads the pre-rename JSON and the rename is simply gone.
       *
       * Driven through the real stores by making `setItem` throw, because a
       * unit test of `makeStore` alone would not prove `Company.load` and the
       * tab are on the far side of it.
       */
      const roll = freshRoll(4);
      Company.keep(roll.all, { army: 'republic', deployed: roll.all, ground: 'geonosis' });
      const him = roll.all[0].designation;
      assert(!Company.notSaving(), 'the store is refusing before anything was refused');

      const realSet = localStorage.setItem.bind(localStorage);
      let name = null;
      try {
        localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
        Company.dress('republic', him, { callsign: 'Torch' });
        assert(Company.notSaving(), 'a refused write did not mark the store broken');
        name = Company.load('republic').men.find((m) => m.designation === him)?.look?.callsign;
      } finally { localStorage.setItem = realSet; }
      assert(name === 'Torch',
        `the write was refused and the next read answered "${name}" — the mirror was `
        + 'dropped and the stale disk copy came back, which is the edit vanishing');

      /* AND THE PAGE SAYS SO. `notSaving` had no readers in src/ at all, which
       * made the whole remembered-write mechanism something the player could
       * not be told about. */
      const { menu, doc, close } = menuOn();
      try {
        localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
        Company.dress('republic', him, { callsign: 'Boil' });
        menu.showMenu();
        menu._buildCompanyList();
        menu._showCompany(null);
        const txt = doc.getElementById('company-page').textContent;
        assert(/NOT SAVING/.test(txt),
          'the store is refusing writes and the company page says nothing about it');
      } finally { localStorage.setItem = realSet; close(); }

      /* …AND A WRITE THAT LANDS HEALS IT. A quota that frees up is a store
       * that works again, and a page that kept apologising would be its own
       * kind of lie. */
      Company.dress('republic', him, { callsign: 'Deuce' });
      assert(!Company.notSaving(), 'a successful write did not clear the refusal');
      assert(Company.load('republic').men.find((m) => m.designation === him)?.look?.callsign
        === 'Deuce', 'the healed store did not keep the write that healed it');
      return 'a refused rename survives the next read, the page warns, and a landed write heals it';
    }));

  check('barracks: two men cannot hold one squad\'s seat, on the roll or on a saved file',
    () => withCleanStore(() => {
      /**
       * `CommandRoster.appoint` is where the seat rule lives — licensed,
       * alive, ONE PER SQUAD — and `enlistRecord` used to set `t.post` by hand
       * with only the licence half of it. So the exclusivity clause had no
       * caller on the fighting side at all: a store holding two seated men in
       * one squad put both on the roll, and `leadOf` then answered with
       * whichever came first in an array whose order is nobody's decision.
       *
       * And `null === null`, so the two copies of the rule ALSO stripped each
       * other's seat off two men who had not been dealt a squad yet — the
       * opposite of what both their comments claim.
       */
      const roll = freshRoll(6);
      for (const t of roll.all) t.award(RANKS[2].xp);
      roll.all[0].squad = 0; roll.all[1].squad = 0; roll.all[2].squad = 1;
      Company.keep(roll.all, { army: 'republic', deployed: roll.all, ground: 'geonosis' });
      /* A FORGED FILE: two seats in squad 0 and one in squad 1. */
      const c = Company.load('republic');
      for (const d of [roll.all[0], roll.all[1], roll.all[2]]) {
        c.men.find((m) => m.designation === d.designation).post = true;
      }
      Company.save(c);

      const back = new CommandRoster(ARMIES.republic);
      for (const m of Company.load('republic').men) back.enlistRecord(m);
      const seatsIn = (n) => back.all.filter((t) => t.post && t.squad === n).length;
      assert(seatsIn(0) === 1,
        `${seatsIn(0)} men walked onto the roll holding squad 0's seat`);
      assert(seatsIn(1) === 1, `${seatsIn(1)} men hold squad 1's seat`);
      assert(back.all.filter((t) => t.post).length === 2,
        'the seats in two different squads did not both survive');

      /* AND TWO UNDEALT MEN DO NOT CONTEND. They are not in the same squad;
       * they are in no squad, and stripping one for the other is a seat taken
       * off a man for a reason that does not exist. */
      const loose = new CommandRoster(ARMIES.republic);
      const a = loose.enlist('trooper'); const b = loose.enlist('trooper');
      a.award(RANKS[2].xp); b.award(RANKS[2].xp);
      loose.appoint(a, true);
      const second = loose.appoint(b, true);
      assert(a.post && b.post,
        'appointing a second man with no squad stripped the first — `null === null`');
      assert(second.was === null,
        `the second appointment claimed it took the seat off ${second.was?.designation}`);
      return '1 seat per squad off a forged file, 2 squads both kept, and two undealt men '
        + 'do not contend';
    }));

  check('barracks: a painted Marksman is the same man on the parade ground and on the field',
    async () => {
      /**
       * `Enemy._build` carried a one-line special case — `if (type ===
       * 'sniper') { opts.color = A.trooperColor; opts.accent = A.accent; }` —
       * and it ran AFTER the man's own kit was spread, so it wrote over both
       * channels unconditionally. A Marksman the player had painted Blood on
       * the parade ground landed on the ground in stock plate: the tab showing
       * one man and the field fielding another, which is the whole defect the
       * parade ground exists to make impossible.
       *
       * The colours moved into `BODY_KITS`, where both readers get them from
       * one table and a choice is spread over the top. Asserted as an exact
       * agreement between the two surfaces, painted and unpainted.
       */
      const B = await import('../../src/game/Bodies.js');
      const { ARCHETYPES } = await import('../../src/game/Enemy.js');
      const hexes = (root) => {
        const out = new Set();
        const walk = (o) => {
          if (!o) return;
          if (o.isMesh) {
            for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
              if (m?.color) out.add(m.color.getHex());
            }
          }
          for (const c of (o.children || [])) walk(c);
        };
        walk(root);
        return out;
      };
      const blood = PAINTS.find((p) => p.id === 'blood');
      const report = [];
      for (const look of [null, { paint: { color: 'blood' } }]) {
        const A = ARCHETYPES.sniper;
        const field = hexes(A.build({
          scale: A.scale ?? 1, ...(B.bodyOptsFor('sniper') || {}),
          ...B.kitOptsFrom(look, 'flesh'),
        }).rig.root);
        const fig = buildParadeFigure({ army: 'republic', type: 'sniper', designation: 'CT-1',
          xp: 0, wounds: 0, look, kind: 'flesh' });
        assert(fig, 'the parade could not build a Marksman');
        const parade = hexes(fig.root);
        const only = [...field].filter((h) => !parade.has(h))
          .concat([...parade].filter((h) => !field.has(h)));
        assert(!only.length,
          `a Marksman ${look ? 'painted Blood' : 'as issued'} differs between the parade `
          + `ground and the field on ${only.map((h) => `#${h.toString(16)}`).join(' ')}`);
        if (look) {
          assert(field.has(blood.color),
            'a Marksman painted Blood does not wear it on the field');
        } else {
          assert(!field.has(blood.color), 'an unpainted Marksman already wears the test colour');
        }
        report.push(look ? 'painted' : 'as issued');
      }
      return `${report.join(' and ')}: the two surfaces agree hex for hex`;
    });

}
