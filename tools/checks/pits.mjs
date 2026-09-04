/**
 * THE COMPANION PITS — WHETHER THE PLAYER IS ACTUALLY IN THE FIGHT.
 *
 * "you fight against another inhabitant on the station who has a companion
 *  (definetly a rare thing …) … losing should also have real consequences
 *  sometimem permanenet but the rewards should be good too … there needs to be
 *  a certain level of skill, a minigame in here"
 *
 * V16 §G2 answers the control question — THE ORDER, THE READ, THE CORNER —
 * and every clause of that answer is a claim about a DISTRIBUTION rather than
 * about a function, so every one of them below is driven rather than read:
 *
 *   "TIMING IS THE SKILL" is the hardest thing in this lane to get honestly
 *     wrong-proof, because a control scheme that does nothing passes every
 *     structural check ever written. It cannot pass three hundred bouts each
 *     of three players — one who reads the telegraph, one who says nothing,
 *     one who shouts at random — unless the ordering it claims is real. That
 *     is `the corner is worth something`, and it prints all three win rates.
 *
 *   "OPT-IN EVERY SINGLE TIME" is a claim about what CANNOT happen, and the
 *     only honest way to hold it is to try: three hundred bouts in the pit
 *     that kills, with the stake never accepted, and the kennel read
 *     afterwards. Zero is the only passing number.
 *
 *   "REWARDS ARE CREDITS AND COSMETICS, NEVER A STAT" is also an absence. A
 *     hundred bouts are fought and folded and the record is compared field by
 *     field against what it started as — every field except the three the
 *     design says a pit may write.
 *
 * The ROOMS are held to rule 4's own instrument, pointed at deck 44 — which
 * `station.mjs` does not measure, because it rasterises deck 40 only. A new
 * pit that read like the Arena would sail through the shipped gate and be
 * caught here.
 */

import { readFile } from 'node:fs/promises';
import { clocked } from './_shared.mjs';
import { makeRng } from '../../src/engine/MathUtil.js';
import {
  PITS, PIT_ORDERS, INTENTS, CORNER_ACTS, HANDLER_RARITY, ROSTER_HOUR,
  LISTEN, WRONG, TOL, SWING, ORDER_WINDOW, ORDERS_PER_ROUND, KILL_AT,
  PHASES, pitById, pitAtPlace, venueOpen, isHandler, handlerOf, handlersOn,
  heftOf, footOf, bondOf, entrantForRecord, matchFor,
  offerBout, openBout, beginRound, callOrder, runRound, cornerAct, pitState,
  settleBout, foldPit, scarFor, pitCard, runPitCard, pitCall, orderById,
} from '../../src/game/Pits.js';
import { announce, MOMENTS, momentsOf } from '../../src/game/Spectacle.js';
import * as Kn from '../../src/game/Kennel.js';

const SRC = new URL('../../src/game/Pits.js', import.meta.url);
const pct = (n) => `${(n * 100).toFixed(1)}%`;

/* ── the station, booted exactly as `station.mjs` boots it ────────────── */

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

async function station(deck = 44) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return { world, idle: idleInput() };
}

/* ── a fixture animal, and a night the illegal pit is actually on ─────── */

/** A grown, well-kept massiff — the animal a player would take to a pit. */
function grown(name = 'Borz') {
  const rec = Kn.adopt('massiff', name);
  rec.xp = 20; rec.runs = 16; rec.meals = 7; rec.grooms = 7;
  Kn.save({ ...Kn.load(), live: rec });
  return Kn.load().live;
}

/** The first night in the next fortnight that the Underlift is open. */
function openNight(venue, hour = 23) {
  for (let day = 0; day < 30; day++) {
    if (venueOpen(venue, hour, { day }).open) return day;
  }
  throw new Error('the Underlift never opens — the night roll is broken');
}

/**
 * ONE WHOLE BOUT, FOUGHT BY ONE OF THREE PLAYERS.
 *
 * `read`   reads the telegraph and lands ONE order on the commit
 * `silent` gives no order at all and lets the animal fight
 * `spam`   fills every slot the round has, with a random order at a random
 *          moment — which is what a player mashing the wheel actually does
 *
 * Nothing else differs. The same handler, the same seed, the same corner act,
 * the same engine.
 */
function fight(style, { venue, rec, handler, seed, day = 0, hour = 23, accept = false, rng }) {
  const offer = offerBout({ venue, rec, handler, hour, day, seed });
  const bout = openBout(offer, { accept: accept ? offer.stake.token : null });
  let guard = 0;
  while (!bout.over && guard++ < 40) {
    const read = beginRound(bout);
    if (style === 'read') {
      const o = PIT_ORDERS.find((x) => x.counters === read.reads);
      callOrder(bout, o.id, read.commitAt);
    } else if (style === 'spam') {
      for (let k = 0; k < ORDERS_PER_ROUND; k++) {
        callOrder(bout, PIT_ORDERS[rng.int(0, PIT_ORDERS.length - 1)].id, rng.range(0, ORDER_WINDOW));
      }
    }
    if (!PHASES.includes(pitState(bout).phase)) throw new Error(`the bout is in phase '${bout.phase}'`);
    runRound(bout);
    if (!PHASES.includes(pitState(bout).phase)) throw new Error(`the bout is in phase '${bout.phase}'`);
    if (!bout.over) cornerAct(bout, bout.bleed ? 'bind' : 'water');
  }
  if (!bout.over) throw new Error('a bout never ended');
  return bout;
}

export async function run({ check, assert }) {
  check = await clocked(check);
  const src = await readFile(SRC, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const roster = handlersOn(ROSTER_HOUR);
  const arena = pitById('arena');
  const under = pitById('underlift');

  /* ══════════════════════════════════════════════════════════════════════
   *  1. THE CORNER — the control scheme, and whether it is a control scheme
   * ══════════════════════════════════════════════════════════════════════ */

  check('pits: the corner is worth something — reading the telegraph beats silence beats shouting', () => {
    /**
     * ══ THE CLAUSE THE WHOLE LANE STANDS ON ═════════════════════════════
     *
     * *"there needs to be a certain level of skill, a minigame in here"*, and
     * §G2's answer: *"an order landed as the opponent commits is worth three
     * landed at random, and the wheel has a real cost — an animal listening is
     * an animal not watching."*
     *
     * A control scheme that did nothing would give three identical win rates.
     * A control scheme with no COST would give spam ≥ silence, because more
     * orders would be strictly more chances. Both of those are the failure and
     * both of them are invisible to any check that reads the table.
     *
     * The three players are otherwise identical — same animals, same handlers,
     * same seeds, same corner act, same engine — so every point of difference
     * below came out of what the handler at the rail did.
     */
    const rec = grown();
    const N = 300;
    const out = {};
    for (const style of ['read', 'silent', 'spam']) {
      const rng = makeRng(4242);
      let wins = 0;
      for (let i = 0; i < N; i++) {
        const b = fight(style, {
          venue: arena, rec, handler: roster[i % roster.length], seed: 5000 + i * 13, hour: 12, rng,
        });
        if (b.outcome.won) wins++;
      }
      out[style] = wins / N;
    }
    assert(out.read > out.silent + 0.05,
      `a player who reads the telegraph wins ${pct(out.read)} against ${pct(out.silent)} for one who says `
      + 'nothing — the read is not doing anything, so the minigame is decoration');
    assert(out.spam < out.silent - 0.05,
      `shouting at random wins ${pct(out.spam)} against ${pct(out.silent)} for silence — an animal `
      + 'listening is supposed to be an animal not watching, and the order has no cost');
    assert(out.read < 0.9,
      `a reader wins ${pct(out.read)} — the animal is supposed to own everything the handler does not, `
      + 'and a corner that decides the fight is the player driving the massiff after all');
    return `over ${N} bouts each: reads the tell ${pct(out.read)}, says nothing ${pct(out.silent)}, `
      + `shouts at random ${pct(out.spam)} — the read is worth ${((out.read - out.silent) * 100).toFixed(1)} points `
      + `and the noise costs ${((out.silent - out.spam) * 100).toFixed(1)}`;
  });

  check('pits: an order on the commit is worth several at random, and the price list says why', () => {
    /* THE FOUR NUMBERS, READ BACK OUT OF THE SCORER RATHER THAN OFF THE
     * TABLE. `scoreOrder` is reached through `callOrder`, which is the only
     * door a surface has, so what is measured is what a player would get. */
    const rec = grown();
    const rng = makeRng(77);
    let perfect = 0, random = 0, wrongTimed = 0, n = 0;
    for (let i = 0; i < 400; i++) {
      const mk = () => openBout(offerBout({
        venue: arena, rec, handler: roster[i % roster.length], hour: 12, seed: 600 + i,
      }), {});
      const a = mk(); const readA = beginRound(a);
      const right = PIT_ORDERS.find((o) => o.counters === readA.reads);
      perfect += callOrder(a, right.id, readA.commitAt).value;
      const b = mk(); beginRound(b);
      random += callOrder(b, PIT_ORDERS[rng.int(0, 4)].id, rng.range(0, ORDER_WINDOW)).value;
      const c = mk(); const readC = beginRound(c);
      const wrong = PIT_ORDERS.find((o) => o.counters && o.counters !== readC.reads);
      wrongTimed += callOrder(c, wrong.id, readC.commitAt).value;
      n++;
    }
    perfect /= n; random /= n; wrongTimed /= n;
    assert(perfect > 0, `a perfectly read, perfectly timed order is worth ${perfect.toFixed(3)} — it must be worth having`);
    assert(random < 0, `an order at a random moment is worth ${random.toFixed(3)} — it must cost, or spamming is free`);
    assert(perfect > Math.abs(random) * 2.5,
      `a landed order is worth ${perfect.toFixed(3)} against ${random.toFixed(3)} at random — §G2 says three, `
      + 'and this is not that');
    assert(wrongTimed < 0,
      `an order that answers the wrong intent is worth ${wrongTimed.toFixed(3)} even landed on the commit — `
      + 'a well-timed wrong answer must not pay');
    return `landed on the commit ${perfect.toFixed(3)}, at random ${random.toFixed(3)}, right time wrong order `
      + `${wrongTimed.toFixed(3)} — listening costs ${LISTEN} a call, a wrong answer is ×${WRONG}, `
      + `the window is ±${TOL}s of a ${ORDER_WINDOW}s round, and one unit of it is ${SWING} rating`;
  });

  check('pits: the read is a read — a feint is worth what a feint is worth', () => {
    /* THE TELL IS NOT THE INTENT, and a check that only ever saw honest tells
     * would be measuring a quiz. The other handler's `craft` is hidden and
     * decides how often the body lies; over a long card the two must disagree
     * sometimes and agree most of the time, or "reading it is the whole
     * minigame" is either impossible or free. */
    const rec = grown();
    let rounds = 0, feints = 0;
    for (let i = 0; i < 200; i++) {
      const b = openBout(offerBout({
        venue: arena, rec, handler: roster[i % roster.length], hour: 12, seed: 900 + i,
      }), {});
      let g = 0;
      while (!b.over && g++ < 10) {
        const read = beginRound(b);
        rounds++;
        if (read.reads !== b.intent) feints++;
        runRound(b);
        if (!b.over && !b.corner) cornerAct(b, 'word');
      }
    }
    const rate = feints / rounds;
    assert(rate > 0.04 && rate < 0.45,
      `the telegraph is a feint ${pct(rate)} of the time — outside the band where reading it is worth `
      + 'doing but not a certainty');
    return `${feints} feints in ${rounds} rounds (${pct(rate)}), across ${new Set(roster.map((h) => h.craft)).size} `
      + 'different handlers\' craft';
  });

  check('pits: the order wheel is the licence table, and a fresh animal is not handed the top of it', async () => {
    /* THE GATE IS `holdsCompanion` AND NOTHING ELSE. A second table here would
     * be a rung the player climbed in the field meaning nothing in the pit,
     * which is exactly the "two ladders" defect `COMPANION_RANKS` refuses. */
    const C = await import('../../src/game/Companions.js');
    for (const o of PIT_ORDERS) {
      assert(C.COMPANION_ORDERS[o.holds],
        `the pit order ${o.label} is licensed by '${o.holds}', which is not one of COMPANION_ORDERS`);
    }
    const K = await import('../../src/game/CompanionKinds.js');
    const fresh = { kind: 'massiff', xp: 0 };
    const sworn = { kind: 'massiff', xp: 20 };
    const held = (rec) => PIT_ORDERS.filter((o) => K.holdsCompanion(rec, o.holds)).map((o) => o.id);
    const f = held(fresh), s = held(sworn);
    assert(f.includes('break'),
      'a STRANGE animal cannot be told to break off — "protection that needs a licence is not protection"');
    assert(f.length < s.length,
      `STRANGE holds ${f.length} pit orders and SWORN holds ${s.length} — the ladder buys nothing in here`);
    assert(s.length === PIT_ORDERS.length, `SWORN holds only ${s.length} of ${PIT_ORDERS.length}`);
    /* AND THE REFUSAL IS A SENTENCE, not a silent no-op. */
    const rec = grown();
    const bout = openBout(offerBout({ venue: arena, rec, handler: roster[0], hour: 12, seed: 5 }), {});
    beginRound(bout);
    const no = callOrder(bout, 'hold', 1.0, { kind: 'massiff', xp: 0 });
    assert(typeof no.refused === 'string' && /STRANGE/.test(no.refused),
      `a refused order came back as ${JSON.stringify(no)} rather than a sentence saying why`);
    /* EVERY INTENT HAS AN ANSWER AND NO TWO ORDERS ANSWER THE SAME ONE, or
     * the read has a question with no right answer in it. */
    for (const o of PIT_ORDERS) {
      assert(orderById(o.id) === o, `orderById cannot find ${o.label} — two tables of orders`);
    }
    const answers = PIT_ORDERS.filter((o) => o.counters).map((o) => o.counters);
    assert(new Set(answers).size === answers.length, 'two orders answer the same intent');
    for (const i of INTENTS) {
      assert(answers.includes(i.id), `nothing answers ${i.label} — that round cannot be read`);
    }
    return `${PIT_ORDERS.length} orders over ${INTENTS.length} intents; STRANGE holds ${f.join(', ')}, `
      + `SWORN holds ${s.join(', ')}`;
  });

  check('pits: the corner is one action, it is spent, and the animal\'s state is on the table', () => {
    const rec = grown();
    const night = openNight(under);
    /* A BOUT THAT SURVIVES ITS FIRST ROUND, found rather than assumed: a
     * fixture seed that happens to end in one round today would turn this
     * check into a tuning tripwire the next time a bite is moved. */
    let bout = null;
    for (let seed = 31; seed < 131 && !bout; seed++) {
      const b = openBout(offerBout({ venue: under, rec, handler: roster[0], hour: 23, day: night, seed }), {});
      /* OUT OF PHASE, both ways. */
      assert(cornerAct(b, 'water').refused, 'the corner opened before the bell');
      beginRound(b);
      assert(cornerAct(b, 'water').refused, 'the corner opened during the round');
      runRound(b);
      assert(b.phase === 'corner' || b.over, `after a round the bout is in '${b.phase}'`);
      if (!b.over) bout = b;
    }
    assert(bout, 'a hundred bouts in a row all ended inside one round — there are no rounds');
    const st = pitState(bout);
    for (const k of ['condition', 'theirCondition', 'bleed', 'corner', 'spent', 'round', 'of']) {
      assert(st[k] !== undefined, `the corner cannot see '${k}' — §G2 requires the state be visible`);
    }
    assert(cornerAct(bout, 'nothing').refused, 'an act that does not exist was accepted');
    const before = bout.taken.mine;
    const did = cornerAct(bout, 'water');
    assert(!did.refused && bout.taken.mine < before,
      `water gave back nothing: ${before} → ${bout.taken.mine}`);
    const again = cornerAct(bout, 'word');
    assert(again.refused, 'a second corner action was allowed — §G2 says ONE');
    assert(CORNER_ACTS.length === 3, `${CORNER_ACTS.length} corner acts, not the three §G2 names`);
    assert(new Set(CORNER_ACTS.map((a) => a.answers)).size === 3,
      'two corner acts answer the same number, so one of them is never the right choice');
    return `three acts, one spent (${did.act}: ${did.did}); a second refused with "${again.refused}"; `
      + `state shows condition ${st.condition}/${st.pool}, bleed ${st.bleed}, corner ${st.corner}`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  2. CONSEQUENCE
   * ══════════════════════════════════════════════════════════════════════ */

  check('pits: no animal dies without a stake that was stated and accepted', () => {
    /**
     * ══ THE HARSHEST THING IN THE GAME, TRIED THREE HUNDRED TIMES ═══════
     *
     * §G3: *"that is the harshest thing in the game and it must be opt-in
     * every single time, with the stake stated before you accept."*
     *
     * Three hundred bouts in the pit that has no doctor, every one of them
     * fought to the end and folded into a real kennel, with the stake NEVER
     * accepted. Zero is the only number that passes — and then the same three
     * hundred with the stake accepted, which must kill somebody or the opt-in
     * is opting into nothing.
     */
    const day = openNight(under);
    const rng = makeRng(11);
    const run = (accept) => {
      let deaths = 0, losses = 0, scars = 0;
      for (let i = 0; i < 300; i++) {
        Kn.clear();
        const rec = grown('Borz');
        const b = fight('silent', {
          venue: under, rec, handler: roster[i % roster.length], seed: 1200 + i * 3, day, accept, rng,
        });
        const fold = foldPit(b);
        if (!b.outcome.won) losses++;
        if (fold.scar) scars++;
        if (fold.died) {
          deaths++;
          assert(!Kn.load().live, 'an animal died and is still in the kennel');
          assert(Kn.load().fallen.length > 0, 'an animal died and the fallen roll is empty');
        }
      }
      return { deaths, losses, scars };
    };
    const declined = run(false);
    assert(declined.deaths === 0,
      `${declined.deaths} of ${declined.losses} losses were fatal with the stake DECLINED — the opt-in is not a gate`);
    assert(declined.scars === declined.losses,
      `${declined.losses} losses wrote ${declined.scars} scars — a pit loss must always leave a mark`);
    const taken = run(true);
    assert(taken.deaths > 0,
      `${taken.losses} losses with the stake ACCEPTED and nothing died — the stake stakes nothing`);
    assert(taken.deaths < taken.losses * 0.7,
      `${taken.deaths} of ${taken.losses} accepted losses were fatal — "sometimes permanent" is not "usually"`);
    /* AND THE SANCTIONED ROOM CANNOT EVEN OFFER IT. */
    const rec = grown();
    const off = offerBout({ venue: arena, rec, handler: roster[0], hour: 12, seed: 4 });
    assert(off.stake.mortal === false && off.stake.token === null,
      'the Arena offered a mortal stake — there is a doctor at that rail');
    return `stake declined: ${declined.deaths}/${declined.losses} losses fatal, ${declined.scars} scars written. `
      + `Stake accepted: ${taken.deaths}/${taken.losses} fatal (${pct(taken.deaths / taken.losses)}) at a `
      + `threshold of ${KILL_AT}× the pool. The Arena cannot offer one at all`;
  });

  check('pits: a stake cannot be accepted by accident — the token is the stake you were shown', () => {
    /* A CALLER THAT NEVER RENDERED THE WORDS CANNOT PRODUCE THE TOKEN, and a
     * caller that rendered ONE stake and accepted ANOTHER produces the wrong
     * one. Both land on the safe bout rather than on the fatal one. */
    const rec = grown();
    const day = openNight(under);
    const a = offerBout({ venue: under, rec, handler: roster[0], hour: 23, day, seed: 7 });
    const b = offerBout({ venue: under, rec, handler: roster[1], hour: 23, day, seed: 8 });
    assert(a.stake.token && b.stake.token && a.stake.token !== b.stake.token,
      'two different stakes share a token, so accepting one accepts the other');
    assert(openBout(a, {}).stake.mortal === false, 'a bout opened with no acceptance is mortal');
    assert(openBout(a, { accept: true }).stake.mortal === false, 'a truthy value accepted the stake');
    assert(openBout(a, { accept: b.stake.token }).stake.mortal === false,
      'the token from a DIFFERENT offer accepted this one');
    assert(openBout(a, { accept: a.stake.token }).stake.mortal === true, 'the right token did not accept');
    /* AND THE STAKE IS STATED IN WORDS, WITH THE ANIMAL'S NAME IN IT. */
    assert(/does not come back/.test(a.stake.words) && a.stake.words.includes(rec.name),
      `the stake reads "${a.stake.words}" — it must name what is being put up`);
    assert(a.stake.purse > a.stake.safePurse,
      `the fatal purse is ${a.stake.purse} against ${a.stake.safePurse} — the rewards are supposed to be good`);
    return `token ${a.stake.token}; declined/true/wrong-token all open safe, right token opens mortal; `
      + `purse ${a.stake.safePurse} → ${a.stake.purse}`;
  });

  check('pits: a pit writes a scar and a story and NOT ONE STAT', () => {
    /**
     * §G3: *"Rewards: credits, and KEEPSAKES … Never a stat."*
     *
     * The record is snapshotted, a hundred bouts are fought and folded into
     * it, and every field is compared back. `scars` and `story` may move. The
     * eighteen others may not — and that includes the two the growth ladder
     * reads (`runs`, `meals`/`grooms`), because a pit that fed the stage
     * ladder would be the ladder climbable by standing in a room.
     */
    Kn.clear();
    const rec = grown();
    const before = JSON.parse(JSON.stringify(rec));
    let wins = 0, purse = 0, keepsakes = 0;
    for (let i = 0; i < 100; i++) {
      const live = Kn.load().live || grown();
      const b = fight('read', {
        venue: arena, rec: live, handler: roster[i % roster.length], seed: 3000 + i * 5, hour: 12,
        rng: makeRng(2 + i),
      });
      foldPit(b);
      if (b.outcome.won) { wins++; purse += b.outcome.purse; }
      if (b.outcome.keepsake) keepsakes++;
    }
    const after = Kn.load().live;
    assert(after, 'the Arena killed the animal');
    const moved = [];
    for (const k of Object.keys(before)) {
      if (k === 'scars' || k === 'story') continue;
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) moved.push(`${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`);
    }
    assert(moved.length === 0, `a hundred bouts moved ${moved.length} fields that are not a scar:\n      ${moved.join('\n      ')}`);
    assert(after.scars.length > 0, 'a hundred bouts and not one scar');
    assert(after.scars.length <= 6, `${after.scars.length} scars survived a cap of 6`);
    assert(after.story.length <= Kn.STORY_KEEP, `${after.story.length} lines of story against a cap of ${Kn.STORY_KEEP}`);
    /* THE SCAR NAMES THE FIGHT. A list of "a torn ear" six times is a texture;
     * a list that says where and against whom is a history. */
    for (const s of after.scars) {
      assert(s.includes('—'), `the scar "${s}" does not name the fight it came from`);
    }
    /* A SCAR IS NOT CHOSEN AND IT IS NOT DRAWN AFRESH EITHER: the same bout
     * names the same mark, so a re-read of a fold is not a second scar. */
    const b0 = fight('read', { venue: arena, rec: after, handler: roster[0], seed: 61, hour: 12, rng: makeRng(9) });
    assert(scarFor(b0) === scarFor(b0), 'the same bout leaves two different scars');
    /* AND THE FOLD SURVIVES A ROUND TRIP THROUGH THE STORE. */
    const disk = Kn.load().live;
    assert(disk.scars.length === after.scars.length,
      'the scars did not come back off disk — the write is in memory only');
    /* THE REWARD IS A NUMBER AND AN ID, and nothing accumulated it. */
    assert(purse > 0 && keepsakes > 0, `${wins} wins paid ${purse} and ${keepsakes} keepsakes`);
    assert(!/balance|wallet|credits\s*[+-]?=/.test(code), 'Pits.js has grown somewhere to put the purse');
    return `100 bouts: ${wins} won, ${purse} in purses, ${keepsakes} keepsakes, ${after.scars.length} scars kept `
      + `of ${100 - wins} losses, ${after.story.length} lines of story — 0 of ${Object.keys(before).length - 2} `
      + 'other fields moved';
  });

  check('pits: the fallen roll names the fight, and the disk wins over the bout', () => {
    Kn.clear();
    const day = openNight(under);
    let epitaph = null;
    for (let i = 0; i < 400 && !epitaph; i++) {
      Kn.clear();
      const rec = grown('Borz');
      const b = fight('silent', {
        venue: under, rec, handler: roster[i % roster.length], seed: 8000 + i * 3, day, accept: true,
        rng: makeRng(3),
      });
      const fold = foldPit(b);
      if (fold.died) epitaph = { fold, b };
    }
    assert(epitaph, '400 accepted mortal bouts and nothing ever died');
    const k = Kn.load();
    const f = k.fallen[0];
    assert(f && f.fate === 'kia', `the epitaph reads ${JSON.stringify(f)}`);
    assert(f.where && f.where.includes(epitaph.b.venue.name),
      `the epitaph says it happened at "${f.where}" — §G3 wants the fight named beside it`);
    assert(f.killer === epitaph.b.theirs.name, `the killer reads "${f.killer}"`);
    assert(!k.live, 'the animal is dead and still live');
    assert(k.lost >= 1, 'a death did not count against the kennel');
    /* AND A FOLD AGAINST A RECORD THAT IS NOT ON THE DISK CHANGES NOTHING —
     * `keepCompanion`'s foreign-manifest refusal, which is what stops an
     * animal the player deleted mid-bout being written back over the top. */
    const other = grown('Other');
    const stale = { ...epitaph.b, recId: 'not-this-one' };
    const before = JSON.stringify(Kn.load().live);
    const nothing = foldPit(stale);
    assert(nothing.kept === false && JSON.stringify(Kn.load().live) === before,
      'a bout fought by a record that is not on the disk wrote to the disk anyway');
    return `"${f.name}" — ${f.where}, killed by ${f.killer} in round ${f.at}; a stale bout wrote nothing`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  3. RARITY
   * ══════════════════════════════════════════════════════════════════════ */

  check('pits: a stranger with a companion is an EVENT, and it is the same stranger all day', async () => {
    /**
     * §G1: *"definetly a rare thing like having a reliable companion should be
     * a dofficult thing to have … you should see a couple other people with
     * companions of there own here and there at times (rare)."*
     *
     * And the sentence that makes it a place rather than a spawner: *"a
     * handler seen in the Concourse in the morning is the same handler you
     * meet in the pit that night."*
     */
    const { PLACES } = await import('../../src/game/StationPlan.js');
    const { headcount, occupant } = await import('../../src/game/StationLife.js');
    /* THE RATE, over every resident the station can seat rather than over a
     * sample: a rarity that is only rare in the check is not rare. */
    let seen = 0, handlers = 0;
    const ids = new Map();
    for (const p of PLACES) {
      if (p.external || !p.heads) continue;
      for (let i = 0; i < headcount(p, ROSTER_HOUR); i++) {
        const r = occupant(p, i);
        if (!r || r.borz || ids.has(r.seed)) continue;
        ids.set(r.seed, r);
        seen++;
        if (isHandler(r)) handlers++;
      }
    }
    const rate = handlers / seen;
    assert(rate < 0.09, `${pct(rate)} of the station walks with an animal — that is a kennel club`);
    assert(handlers >= 2, `only ${handlers} handlers on the whole station — there is nobody to fight`);
    assert(Math.abs(rate - HANDLER_RARITY) < 0.04,
      `the measured rate ${pct(rate)} is nowhere near the declared ${pct(HANDLER_RARITY)}`);

    /* THE SAME PERSON, AT ANY HOUR. `isHandler` is a function of the resident
     * and of nothing else, so the morning roster and the night roster are the
     * same people wherever the day has moved them. */
    let checked = 0;
    for (const [, r] of ids) {
      if (isHandler(r) !== isHandler({ ...r })) throw new Error('isHandler is not a function of the resident');
      checked++;
    }
    const morning = new Set(handlersOn(9).map((h) => h.id));
    const night = handlersOn(23);
    const carried = night.filter((h) => morning.has(h.id)).length;
    assert(carried > 0, 'not one of the night\'s handlers was anywhere on the station this morning');

    /* AND THE PIT'S CARD IS DRAWN FROM THAT ROSTER, not from the pit's seats. */
    const card = pitCard(under, { day: 3 });
    assert(card.card, `the Underlift could not make a card: ${card.why}`);
    for (const h of card.handlers) {
      assert(morning.has(h.id),
        `${h.who} is fighting tonight and was nowhere on the station this morning`);
    }
    /* A HANDLER'S ANIMAL IS THE SAME ANIMAL TWICE. */
    const twice = handlerOf([...ids.values()].find((r) => isHandler(r)));
    const again = handlerOf([...ids.values()].find((r) => isHandler(r)));
    assert(twice.animal === again.animal && twice.craft === again.craft,
      'a handler read twice walked in with a different animal');
    return `${handlers} handlers among ${seen} residents (${pct(rate)}, declared ${pct(HANDLER_RARITY)}); `
      + `${carried} of the night's ${night.length} were on the station this morning; tonight's card is `
      + `${card.handlers.map((h) => h.animal).join(', ')}`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  4. THE TWO PLACES
   * ══════════════════════════════════════════════════════════════════════ */

  check('pits: two rooms, and the illegal one is not the licensed one with the lights off', async () => {
    const { PLACE } = await import('../../src/game/StationPlan.js');
    const { SHAPES } = await import('../../src/game/StationKit.js');
    assert(PITS.length === 2, `${PITS.length} pits, not the two §G5 names`);
    for (const v of PITS) {
      const p = PLACE.get(v.place);
      assert(p, `#${v.place} ${v.name} is not in the gazetteer`);
      assert(SHAPES[p.shape], `#${p.id} declares shape '${p.shape}' and nothing builds it`);
      assert(pitAtPlace(v.place) === v, 'the place → pit reader disagrees with the table');
    }
    const a = PLACE.get(20), u = PLACE.get(61);
    assert(a.shape !== u.shape, `both pits are built by '${a.shape}' — rule 4 forbids it`);
    assert(SHAPES[a.shape] !== SHAPES[u.shape], 'the two shapes are the same function object');
    assert(a.deck !== u.deck, `both pits are on deck ${a.deck}`);
    /* THE FOUR THINGS THAT MAKE THEM DIFFERENT ROOMS RATHER THAN TWO SKINS. */
    assert(arena.doctor && !under.doctor, 'both pits have the same medical arrangement');
    assert(!arena.mortal && under.mortal, 'both pits stake the same thing');
    assert(under.hazardPurse > arena.purse * 2, 'the illegal pit does not pay for the risk it carries');
    assert(under.rounds !== arena.rounds || under.perRound !== arena.perRound,
      'both pits run the same fight');
    /* AND THE ILLEGAL ONE IS NOT ALWAYS THERE. */
    let on = 0;
    for (let day = 0; day < 200; day++) if (venueOpen(under, 23, { day }).open) on++;
    assert(on > 40 && on < 190, `the Underlift is open ${on} nights in 200 — "not always available or offered"`);
    let day = 0; while (!venueOpen(under, 23, { day }).open) day++;
    assert(!venueOpen(under, 13, { day }).open, 'the Underlift is open at one in the afternoon');
    assert(!venueOpen(under, 23, { day, standing: 0.9 }).open,
      'a player the wrong people trust can still walk into the Underlift');
    assert(venueOpen(arena, 13, { standing: 0.9 }).open, 'the Arena shut on standing — it is licensed');
    return `#20 '${a.shape}' deck ${a.deck}, refereed, purse ${arena.purse}; #61 '${u.shape}' deck ${u.deck}, `
      + `no doctor, purse ${under.hazardPurse}, open ${on}/200 nights and shut above standing ${under.shut}`;
  });

  check('pits: rule 4 on DECK 44 — the Underlift Pit does not read like anything else there', async () => {
    /**
     * `station.mjs` rasterises DECK 40 and prints its worst pair; deck 44 is
     * measured for overlap and for walkways and NOT for silhouette. So a new
     * room on deck 44 that read exactly like the Narn quarter would pass the
     * shipped gate. The instrument is `_raster.mjs` — the same one, at the
     * same 0.85 — pointed one deck down.
     */
    const THREE = await import('three');
    const { world } = await station(44);
    try {
      const { rasterView, iou, W, H } = await import('./_raster.mjs');
      const { DECK_Y } = await import('../../src/game/StationPlan.js');
      const raster = (rec) => {
        const p = rec.place;
        const fx0 = p.x - p.door[0], fz0 = p.z - p.door[1];
        const flen = Math.hypot(fx0, fz0) || 1;
        const dx = fx0 / flen, dz = fz0 / flen;
        const back = Math.max(1.5, p.w / 2 / Math.tan(Math.PI / 4) - p.d / 2);
        return rasterView(THREE, {
          objects: rec.group,
          eye: { x: p.door[0] - dx * back, y: rec.__y + 1.7, z: p.door[1] - dz * back },
          dir: { x: dx, z: dz },
        }).bits;
      };
      const recs = [];
      for (const rec of world._station.places.values()) {
        if (rec.place.band === 'ring') continue;
        rec.__y = DECK_Y[rec.place.deck] ?? 0;
        const bits = raster(rec);
        let on = 0; for (let i = 0; i < bits.length; i++) on += bits[i];
        recs.push({ place: rec.place, bits, on });
      }
      const pit = recs.find((r) => r.place.id === 61);
      assert(pit, 'the Underlift Pit was not built on deck 44');
      assert(pit.on > 40, `#61 fills ${pit.on} of ${W * H} cells from its own door — there is nothing there`);
      let worst = 0, wp = '', mine = 0, mp = '';
      for (let i = 0; i < recs.length; i++) {
        for (let j = i + 1; j < recs.length; j++) {
          const v = iou(recs[i].bits, recs[j].bits);
          const tag = `#${recs[i].place.id} ${recs[i].place.name} × #${recs[j].place.id} ${recs[j].place.name}`;
          if (v > worst) { worst = v; wp = tag; }
          if ((recs[i].place.id === 61 || recs[j].place.id === 61) && v > mine) { mine = v; mp = tag; }
        }
      }
      assert(worst < 0.85, `deck 44's worst pair is ${worst.toFixed(3)} — ${wp}`);
      assert(mine < 0.85, `#61 reads like another room at ${mine.toFixed(3)} — ${mp}`);
      /* §9.1 INSIDE THE NEW ROOM: every material the engine's own, none of
       * them uninked. `station.mjs` runs this on deck 40 only. */
      const bad = [], ink = [], names = new Set();
      world._station.places.get(61).group.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m) continue;
          names.add(m.name || '(unnamed)');
          if (!m.name || !/^(deck|station|prop|kit)-/.test(m.name)) bad.push(m.name || `an unnamed ${m.type}`);
          if (m.userData?.saberNoInk) ink.push(m.name);
        }
      });
      assert(bad.length === 0, `#61 uses ${bad.length} materials that are not the engine's: ${bad.slice(0, 4).join(', ')}`);
      assert(ink.length === 0, `#61 has ${ink.length} uninked materials inside a room (§9.1): ${ink.join(', ')}`);
      assert(names.size >= 5, `#61 uses ${names.size} materials — a room of one colour is a box with the lights on`);
      console.log(`      rule 4: ${recs.length} places on deck 44, worst pair ${worst.toFixed(3)} (${wp})`);
      return `#61 fills ${pit.on}/${W * H} cells, worst pair against it ${mine.toFixed(3)} (${mp}); `
        + `deck 44 worst ${worst.toFixed(3)}; ${names.size} materials, all the engine's, none uninked`;
    } finally { world.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  5. WATCHING IS FREE, AND THE ENGINE IS STILL THE ENGINE
   * ══════════════════════════════════════════════════════════════════════ */

  check('pits: a card runs whether or not you turn up, and betting cannot touch it', async () => {
    /* THE ENGINE'S OWN PROPERTY, USED RATHER THAN REBUILT. Two identical
     * cards, one watched and one bet on, event for event. */
    const quiet = runPitCard(under, { day: 5, bouts: 3 });
    const betOn = runPitCard(under, { day: 5, bouts: 3 });
    assert(quiet.races.length === 3 && betOn.races.length === 3, 'the card did not run');
    for (let i = 0; i < 3; i++) {
      const a = quiet.races[i].result, b = betOn.races[i].result;
      assert(JSON.stringify(a.events) === JSON.stringify(b.events),
        `bout ${i + 1} ran differently for a spectator than for a punter`);
    }
    /* Now bet on the second one, AFTER it has run, which is the only shape a
     * settlement may take. */
    const { board, result } = betOn.races[1];
    const led = (await import('../../src/game/Spectacle.js')).settle(
      [{ entrant: board[0].id, stake: 10 }], result, board);
    assert(led.staked === 10, 'the ledger lost the stake');
    assert(JSON.stringify(betOn.races[1].result.events) === JSON.stringify(quiet.races[1].result.events),
      'settling a bet changed the fight that had already happened');
    /* AND A PLAYER WITH NO ANIMAL CAN STILL WATCH. `pitCard` takes no record. */
    assert(quiet.card.entrants.length >= 2 && quiet.handlers.length >= 2,
      'a card of strangers needs two strangers on it');
    /* AND A WAGER ON YOUR OWN BOUT IS THE SAME SHAPE: handed in at the door,
     * handed back through the engine's ledger, stored nowhere. */
    const rec = grown();
    const mine = fight('read', { venue: arena, rec, handler: roster[0], seed: 515, hour: 12, rng: makeRng(6) });
    mine.stake.wager = 25;
    const own = settleBout(mine);
    assert(own.staked === 25 && own.lines.length === 1, `the wager settled as ${JSON.stringify(own)}`);
    assert(own.returned === (mine.outcome.won ? 25 * own.lines[0].price : 0), 'the ledger paid the wrong thing');
    return `${quiet.races.length} bouts on the Underlift card, ${quiet.card.entrants.length} entrants, `
      + `identical event streams watched and bet on; a 10 stake settled ${led.net >= 0 ? '+' : ''}${led.net}`;
  });

  check('pits: the announcer reads the fight, and the room never talks over the engine', () => {
    const rec = grown();
    const b = fight('read', { venue: under, rec, handler: roster[0], seed: 999, day: openNight(under), rng: makeRng(1) });
    const cut = momentsOf(b.result);
    assert(cut.length > 3, `a whole bout produced ${cut.length} moments worth cutting to`);
    let said = 0;
    for (const ev of b.result.events) {
      const line = pitCall(ev, b.card);
      if (!line) continue;
      said++;
      /* EVERY LINE NAMES A REAL ENTRANT OR NOBODY — the engine's own rule. */
      if (ev.who) {
        const name = b.card.entrants.find((e) => e.id === ev.who)?.name;
        assert(name && line.includes(name), `"${line}" is about ${ev.who} and does not name them`);
      }
    }
    assert(said > 4, `${said} lines over a whole bout — the room is silent`);
    /* THE ROOM MAY NOT SHADOW THE ENGINE. For every event the engine has a
     * line for, both functions must say the same words. */
    const card = b.card;
    for (const type of MOMENTS) {
      const ev = { t: 1, type, who: card.entrants[0].id, by: card.entrants[1].id,
        from: card.entrants[1].id, past: card.entrants[1].id, gate: 2, cause: 'wound', margin: 1 };
      const engine = announce(ev, card);
      if (!engine) continue;
      assert(pitCall(ev, card) === engine,
        `the room says something different from the engine about '${type}'`);
    }
    /* AND THE ROOM'S OWN EVENTS ARE ONES THE ENGINE HAS NO LINE FOR. */
    for (const t of ['bell', 'stake', 'corner', 'stoppage', 'decision']) {
      assert(announce({ type: t, who: null }, card) === null, `the engine already speaks '${t}'`);
      assert(pitCall({ type: t, who: card.entrants[0].id, round: 2, of: 3, did: 'water', mortal: true }, card),
        `the room has no line for its own '${t}'`);
    }
    return `${said} lines over ${b.result.events.length} events and ${cut.length} moments; `
      + `${MOMENTS.length} engine lines unshadowed, 5 room lines added`;
  });

  check('pits: the bout is the engine\'s fight — this file rolls no dice about who hit whom', () => {
    /**
     * THE ONE THING THIS LANE MUST NOT HAVE BUILT: a second simulation. A
     * source scan is not enough on its own, so two things are held.
     *
     * FIRST, structurally: `Pits.js` may not contain a hit roll. Every damage
     * number in a bout has to have come off a `runSpectacle` result row, and
     * the only arithmetic here is the subtraction that reads it.
     *
     * SECOND, by measurement: the same bout, fought identically twice, is the
     * same bout — and fought against a DIFFERENT hidden temperament at the
     * same seed, it is a different one. That is the engine's own "not
     * pre-drawn" clause holding through this file's rounds.
     */
    assert(/runSpectacle\(/.test(code), 'Pits.js does not call the engine at all');
    assert(!/Math\.random/.test(code), 'Pits.js reaches for Math.random');
    for (const w of ['hp', 'damage', 'armour', 'toughness']) {
      assert(!new RegExp(`\\b${w}\\s*[-+*/]?=`, 'i').test(code), `Pits.js writes a ${w} of its own`);
    }
    const rec = grown();
    const twice = [0, 1].map(() => fight('read', {
      venue: arena, rec, handler: roster[2], seed: 20250, hour: 12, rng: makeRng(5),
    }));
    assert(JSON.stringify(twice[0].result.order) === JSON.stringify(twice[1].result.order),
      'the same bout at the same seed came out differently — nothing here is reproducible');
    /* MOVE A HIDDEN TERM THE BOARD NEVER SAW and the bout must be able to
     * change hands. Held over a run of seeds, because one race changing is
     * noise and none of them changing is a narration. */
    let moved = 0;
    for (let i = 0; i < 60; i++) {
      const h = roster[i % roster.length];
      const a = fight('silent', { venue: arena, rec, handler: h, seed: 41000 + i, hour: 12, rng: makeRng(1) });
      const flipped = { ...h, craft: 1 - h.craft };
      const c = fight('silent', { venue: arena, rec, handler: flipped, seed: 41000 + i, hour: 12, rng: makeRng(1) });
      if (a.outcome.won !== c.outcome.won) moved++;
    }
    assert(moved > 3,
      `flipping the other handler's hidden craft changed the result in only ${moved} of 60 bouts at a held `
      + 'seed — a hidden term that cannot change a bout is not in the simulation');
    return `the same seed gives the same bout twice; flipping the opponent's hidden craft changed `
      + `${moved}/60 of them; no hit roll, no Math.random, no stat written in Pits.js`;
  });

  check('pits: the animal that fights is the record that was kept — one adapter, no second ladder', async () => {
    /**
     * `entrantFromCompanion` reads a `bond` a kennel record does not have and
     * a `heft`/`foot` off a kind row that does not carry them, and it says in
     * its own header why it may not go and get them. This file is where they
     * come from — so they had better be derived from the record the player
     * actually grew, and not from a table nobody earns.
     */
    const K = await import('../../src/game/CompanionKinds.js');
    const fresh = Kn.readOne({ id: 'a', kind: 'massiff', xp: 0, runs: 0 });
    const vet = Kn.readOne({ id: 'b', kind: 'massiff', xp: 20, runs: 16, meals: 7, grooms: 7 });
    assert(bondOf(vet) > bondOf(fresh) + 0.3, `bond ${bondOf(fresh)} → ${bondOf(vet)} across a whole life`);
    assert(bondOf(fresh) >= 0 && bondOf(vet) <= 1, 'bond left [0, 1]');
    assert(K.maturityOf(vet) === 1 && K.maturityOf(fresh) === 0, 'the fixtures are not FRESH and VETERAN');
    const a = entrantForRecord(fresh), b = entrantForRecord(vet);
    assert(b.form.rating > a.form.rating,
      `a VETERAN rates ${b.form.rating} against a FRESH ${a.form.rating} — the growth ladder buys nothing in the pit`);
    /* SCARS ARE COURAGE AND CAUTION — the engine's own sentence, and it has to
     * survive this adapter. */
    const scarred = entrantForRecord({ ...vet, scars: ['x', 'y', 'z'] });
    assert(scarred.hidden.vice > b.hidden.vice && scarred.hidden.heart < b.hidden.heart,
      'scars moved both hidden terms the same way');
    /* HEFT AND FOOT ARE READ OFF ROWS THAT ALREADY EXIST. */
    const kinds = K.COMPANION_ORDER;
    const hefts = kinds.map(heftOf), foots = kinds.map(footOf);
    assert(new Set(hefts).size > 3, `${kinds.length} kinds share only ${new Set(hefts).size} hefts`);
    assert(new Set(foots).size > 3, `${kinds.length} kinds share only ${new Set(foots).size} footings`);
    assert(heftOf('pup') > heftOf('tooka'), 'a rancor pup is not built to take more than a tooka kit');
    assert(hefts.every((h) => Math.abs(h) <= 0.8) && foots.every((f) => Math.abs(f) <= 0.9), 'heft or foot left its band');
    /* AND THE OPPONENT IS SCALED TO YOU — "always risk", not always parity. */
    const mine = entrantForRecord(vet);
    let sum = 0, spread = 0, n = 200;
    for (let i = 0; i < n; i++) {
      const r = matchFor(mine, roster[i % roster.length], under, 900 + i).form.rating;
      sum += r; spread += (r - mine.form.rating) ** 2;
    }
    const mean = sum / n, sd = Math.sqrt(spread / n);
    assert(Math.abs(mean - mine.form.rating) < 9, `you rate ${mine.form.rating} and the pit fields ${mean.toFixed(1)}`);
    assert(sd > 4, `the field's spread against you is ${sd.toFixed(1)} — every night is the same fight`);
    return `bond FRESH ${bondOf(fresh)} → VETERAN ${bondOf(vet)}; rating ${a.form.rating} → ${b.form.rating}; `
      + `${new Set(hefts).size} hefts and ${new Set(foots).size} footings over ${kinds.length} kinds; `
      + `the Underlift fields ${mean.toFixed(1)} ± ${sd.toFixed(1)} against your ${mine.form.rating}`;
  });

  check('pits: the file holds no balance and names no mode', () => {
    /* `Kennel.js`:22 — "that silence is a hazard, not a permission". The
     * six-word scan lives in `companions.mjs` and this file is added to it on
     * the commit that creates it; what is held HERE is the other half, which
     * `station.mjs` holds over the station's own files. */
    for (const word of ['points', 'currency', 'purchase', 'upgrade', 'unlock', 'buy']) {
      assert(!new RegExp(`\\b${word}\\b`, 'i').test(code), `Pits.js has grown a "${word}"`);
    }
    const MODES = ['command', 'theline', 'duel', 'training', 'sandbox', 'raid', 'blade', 'trial'];
    for (const m of MODES) {
      const re = new RegExp(`(===?\\s*|!==?\\s*)['"\`]${m}['"\`]`);
      assert(!re.test(code), `Pits.js branches on the mode '${m}'`);
    }
    /* AND THE ONLY DURABLE WRITES ARE THE THREE THE DESIGN NAMES. Every
     * assignment onto the live record inside `foldPit` is read out of the
     * source and held against a list of two. */
    const body = /export function foldPit\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(code)?.[1] || '';
    assert(body, 'foldPit is gone');
    const fields = [...body.matchAll(/rec\.(\w+)\s*=/g)].map((m) => m[1]).sort();
    assert([...new Set(fields)].join(',') === 'scars,story',
      `foldPit writes ${[...new Set(fields)].join(', ') || 'nothing'} onto the record — a pit may write a scar `
      + 'and a line of story and nothing else');
    const kennelWrites = [...code.matchAll(/(?<![\w.])k\.(\w+)\s*=|(?<![\w.])k\.(\w+)\.unshift/g)].map((m) => m[1] || m[2]);
    assert(kennelWrites.every((f) => ['live', 'fallen', 'lost'].includes(f)),
      `Pits.js writes ${[...new Set(kennelWrites)].join(', ')} on the kennel`);
    return `clean of all six words, no mode named; foldPit writes exactly ${[...new Set(fields)].join(', ')} `
      + `and touches ${[...new Set(kennelWrites)].join(', ')} on the kennel`;
  });
}
