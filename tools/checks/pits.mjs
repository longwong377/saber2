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
  settleBout, foldPit, scarFor, pitCard, runPitCard, settlePitCard, pitCall, orderById,
  holdsOrder,
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
    /**
     * ══ AND THE FIELD IS A FORTNIGHT, NOT ONE MORNING ══════════════════════
     *
     * This measured against `roster` — `handlersOn(9)`, the TEN handlers who
     * happen to be aboard on day 0 — and the bound was tuned to what those ten
     * gave. `occupant` seeds a resident on `p{id}s{i}d{day}` now, which is
     * §C2's whole point (*"the same shop owner doesnt always look the same"*),
     * so every one of those ten became somebody else and the ratio went 2.50 →
     * 2.47 against a bound of 2.5. Nothing about the scorer moved.
     *
     * A BALANCE NUMBER THAT TURNS ON WHICH TEN STRANGERS ARE ABOARD IS NOT A
     * MEASUREMENT OF THE SCORER. Measured per day across a fortnight the ratio
     * runs 2.35 to 2.84 — the handler's hidden `craft` decides how often the
     * telegraph lies, so a day that deals honest handlers pays a reader more —
     * and a bound anywhere inside that spread is a coin toss on the calendar.
     *
     * So the sample is the fortnight: 160 distinct handlers, everybody the
     * station puts at a rail in fourteen days, which measures the SCORER and
     * not the day. It reads 2.65 — §G2 says *"three landed at random"* and the
     * bound stays at 2.5, because the wheel's cost (`LISTEN` off every call)
     * is deliberately real and eats the difference. Day 0 alone, the old
     * sample, is 2.47 of that same scorer.
     */
    const field = [];
    const known = new Set();
    for (let day = 0; day < 14; day++) {
      for (const h of handlersOn(ROSTER_HOUR, day)) {
        if (known.has(h.id)) continue;
        known.add(h.id);
        field.push(h);
      }
    }
    assert(field.length > 60, `only ${field.length} handlers in a fortnight — the sample is one day again`);
    const rec = grown();
    const rng = makeRng(77);
    let perfect = 0, random = 0, wrongTimed = 0, n = 0;
    for (let i = 0; i < 400; i++) {
      const mk = () => openBout(offerBout({
        venue: arena, rec, handler: field[i % field.length], hour: 12, seed: 600 + i,
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
    return `over ${field.length} handlers of a fortnight: landed on the commit ${perfect.toFixed(3)}, `
      + `at random ${random.toFixed(3)} (×${(perfect / Math.abs(random)).toFixed(2)}), right time wrong order `
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

  check('pits: a first bout is playable, and the top of the wheel is still earned', async () => {
    /**
     * ══ THE DEFECT THIS CHECK WAS BLIND TO ═══════════════════════════════
     *
     * It read `holdsCompanion(rec, o.holds)` and asserted only that STRANGE
     * held FEWER orders than SWORN. STRANGE held ONE — BREAK OFF, whose whole
     * effect is *"Takes the round off."* A player's first animal on its first
     * night had a wheel of five buttons, four of which answered *"STRANGE does
     * not hold GUARD yet"*, and the answer to *"there needs to be a certain
     * level of skill, a minigame in here"* was a screen with one button that
     * declines to fight. Fewer-than is true of one, and one is not a game.
     *
     * So the floor is asserted as well as the ceiling, and both in the terms
     * the minigame is actually played in: how many orders the animal will
     * take, and how many of the four intents it can ANSWER. A first bout must
     * be a decision; a SWORN animal must be able to answer all of them.
     */
    const C = await import('../../src/game/Companions.js');
    for (const o of PIT_ORDERS) {
      assert(C.COMPANION_ORDERS[o.holds],
        `the pit order ${o.label} is licensed by '${o.holds}', which is not one of COMPANION_ORDERS`);
      assert(!o.licence || C.COMPANION_ORDERS[o.licence],
        `the pit order ${o.label} is gated on '${o.licence}', which is not one of COMPANION_ORDERS`);
    }
    const K = await import('../../src/game/CompanionKinds.js');
    const fresh = { kind: 'massiff', xp: 0 };
    const sworn = { kind: 'massiff', xp: 20 };
    const held = (rec) => PIT_ORDERS.filter((o) => holdsOrder(rec, o)).map((o) => o.id);
    const answers = (rec) => PIT_ORDERS.filter((o) => holdsOrder(rec, o) && o.counters).length;
    const f = held(fresh), s = held(sworn);
    assert(f.includes('break'),
      'a STRANGE animal cannot be told to break off — "protection that needs a licence is not protection"');
    assert(f.length >= 3,
      `a STRANGE animal — every player's first one — holds ${f.length} of ${PIT_ORDERS.length} orders `
      + `(${f.join(', ')}). A first bout with fewer than three is a refusal with a wheel drawn round it`);
    assert(answers(fresh) >= 2,
      `a STRANGE animal can answer ${answers(fresh)} of the ${INTENTS.length} intents — with one answer `
      + 'there is nothing to read the telegraph FOR');
    assert(f.length < s.length,
      `STRANGE holds ${f.length} pit orders and SWORN holds ${s.length} — the ladder buys nothing in here`);
    assert(answers(sworn) === INTENTS.length,
      `a SWORN animal answers ${answers(sworn)} of ${INTENTS.length} intents — the top of the ladder is `
      + 'supposed to be the animal that can be told anything');
    assert(s.length === PIT_ORDERS.length, `SWORN holds only ${s.length} of ${PIT_ORDERS.length}`);
    /* AND THE ONE READER. A surface that greys a button on a different rule
     * from the one `callOrder` gates on is a wheel that lies both ways. */
    const bad = PIT_ORDERS.filter((o) => holdsOrder(sworn, o) !== K.holdsCompanion(sworn, o.holds));
    assert(bad.length === 0 || bad.every((o) => !o.licence),
      `${bad.map((o) => o.label).join(', ')} is gated on something that is neither its licence nor its duty`);
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
    const covered = PIT_ORDERS.filter((o) => o.counters).map((o) => o.counters);
    assert(new Set(covered).size === covered.length, 'two orders answer the same intent');
    for (const i of INTENTS) {
      assert(covered.includes(i.id), `nothing answers ${i.label} — that round cannot be read`);
    }
    return `${PIT_ORDERS.length} orders over ${INTENTS.length} intents; STRANGE holds ${f.join(', ')} `
      + `and answers ${answers(fresh)} of them, SWORN holds ${s.join(', ')} and answers ${answers(sworn)}`;
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

    /**
     * AND THE PIT'S CARD IS DRAWN FROM THAT ROSTER, not from the pit's seats —
     * ON THE DAY THE CARD IS FOR, which is the half this check used to get
     * wrong.
     *
     * It built `morning` from `handlersOn(9)` — day 0 — and then asked it about
     * `pitCard(under, { day: 3 })`. That passed only while `occupant` ignored
     * the day: the seed is `p{id}s{i}d{day}` now, so day 3's Concourse holds
     * different people from day 0's, exactly as §C2 asks, and the match went to
     * 0 of 6. The property is and always was a WITHIN-A-DAY one — *"a handler
     * seen in the Concourse in the morning is the same handler you meet in the
     * pit that night"* — and a morning three days before the fight was never
     * the morning it names.
     */
    const CARD_DAY = 3;
    const thatMorning = new Set(handlersOn(9, CARD_DAY).map((h) => h.id));
    const card = pitCard(under, { day: CARD_DAY });
    assert(card.card, `the Underlift could not make a card: ${card.why}`);
    for (const h of card.handlers) {
      assert(thatMorning.has(h.id),
        `${h.who} is fighting tonight and was nowhere on the station on the morning of day ${CARD_DAY}`);
    }
    /* …AND IT IS A DIFFERENT MORNING FROM DAY 0's, which is the other half of
     * the same sentence and the clause that fails if the day ever falls out of
     * `occupant`'s seed again. A station where the shelves reroll and the
     * people do not says the day is passing and shows you it is not. */
    const stale = [...thatMorning].filter((id) => morning.has(id)).length;
    assert(stale < thatMorning.size,
      `every one of day ${CARD_DAY}'s ${thatMorning.size} handlers was also aboard on day 0 — `
      + 'the census is not rerolling, and the man across the pit is the same man for ever');
    /* A HANDLER'S ANIMAL IS THE SAME ANIMAL TWICE. */
    const twice = handlerOf([...ids.values()].find((r) => isHandler(r)));
    const again = handlerOf([...ids.values()].find((r) => isHandler(r)));
    assert(twice.animal === again.animal && twice.craft === again.craft,
      'a handler read twice walked in with a different animal');
    return `${handlers} handlers among ${seen} residents (${pct(rate)}, declared ${pct(HANDLER_RARITY)}); `
      + `${carried} of the night's ${night.length} were on the station this morning; day ${CARD_DAY}'s card `
      + `is ${card.handlers.map((h) => h.animal).join(', ')}, all ${card.handlers.length} of them aboard that `
      + `morning, and ${thatMorning.size - stale} of that day's ${thatMorning.size} handlers were not here on day 0`;
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

  check('pits: the announcer calls a fight, and not a lap of a podrace', async () => {
    /**
     * ══ WHAT THIS CHECK USED TO ASSERT ═══════════════════════════════════
     *
     * It asserted `pitCall(ev, card) === announce(ev, card)` for every event
     * type the engine speaks, and called that "the room never talks over the
     * engine". `Spectacle`'s `LINES` is the PODRACE announcer, so what the
     * assertion actually required was that a death match between two animals
     * in a service gap on deck 44 be called in gates and laps. Driven, it was:
     *
     *     They're away — 2 on the card.
     *     Yavk Ninefingers goes to the front, Tooth loses it at 2.
     *     Yavk Ninefingers takes Tooth at gate 2.
     *
     * It also fabricated `{ type: 'bell' }` by hand to prove the room's own
     * six lines existed — a test for a line no caller could reach, because
     * nothing in the game pushed an event of that type. Both halves are
     * inverted below: the room's words must NOT be the course's, and the six
     * room events must turn up in a bout nobody fabricated.
     */
    const rec = grown();
    const b = fight('read', { venue: under, rec, handler: roster[0], seed: 999, day: openNight(under), rng: makeRng(1) });
    const cut = momentsOf(b.result);
    assert(cut.length > 3, `a whole bout produced ${cut.length} moments worth cutting to`);

    let said = 0;
    const lines = [];
    for (const ev of b.result.events) {
      const line = pitCall(ev, b.card);
      if (!line) continue;
      said++;
      lines.push([ev, line]);
      /* EVERY LINE NAMES A REAL ENTRANT OR NOBODY — the engine's own rule. */
      if (ev.who) {
        const name = b.card.entrants.find((e) => e.id === ev.who)?.name;
        assert(name && line.includes(name), `"${line}" is about ${ev.who} and does not name them`);
      }
    }
    assert(said > 4, `${said} lines over a whole bout — the room is silent`);

    /**
     * ── THE COURSE VOCABULARY, READ OUT OF THE ENGINE ─────────────────────
     *
     * Not a list somebody typed here. `Spectacle`'s own `LINES` table is
     * parsed out of its source and every STATIC fragment of it — the words
     * between the interpolations, which is exactly the part that is the
     * announcer's own language rather than the fight's facts — becomes a
     * phrase the pit may not say. Anything of two words or more: "on the
     * card", "goes to the front,", "at gate", "into the wall at". Add a
     * sentence to the race's announcer and this check starts holding the pit
     * to it, which a hard-coded blacklist could never do.
     */
    const spec = await readFile(new URL('../../src/game/Spectacle.js', import.meta.url), 'utf8');
    const table = /const LINES = \{([\s\S]*?)\n\};/.exec(spec)?.[1];
    assert(table, "Spectacle's LINES table cannot be found — this check is reading nothing");
    const course = [...new Set([...table.matchAll(/`([^`]*)`/g)]
      .flatMap((m) => m[1].split(/\$\{[^}]*\}/))
      .map((t) => t.trim())
      .filter((t) => t.length >= 5 && /\S\s+\S/.test(t)))];
    assert(course.length >= 8, `only ${course.length} phrases came out of LINES — the parse is wrong`);
    for (const [ev, line] of lines) {
      for (const frag of course) {
        assert(!line.includes(frag),
          `the pit says "${line}" about a '${ev.type}' — "${frag}" is the podrace announcer's, off `
          + "Spectacle's own LINES table, and this is two animals in a pit");
      }
    }

    /* AND NO PIT LINE IS THE ENGINE'S LINE. For every event in the bout the
     * engine has words for, the room must have said it differently — the
     * translation is the whole point, and an identical string means the
     * fallback fired where a fight line should have been. */
    let translated = 0;
    for (const [ev, line] of lines) {
      const engine = announce(ev, b.card);
      if (!engine) continue;
      translated++;
      assert(line !== engine, `the room quotes the engine word for word on '${ev.type}': "${line}"`);
    }
    assert(translated > 3, `only ${translated} of the sim's own events were re-said in the room's words`);

    /**
     * ── AND THE ROOM'S SIX ARE REACHABLE, WHICH IS THE HALF THAT WAS DEAD ─
     *
     * Read off a bout that was actually fought. `stoppage` and `decision` are
     * the two ways one ends and only one of them can happen, so the pair is
     * held rather than each; the other four happen in every bout there is.
     */
    const types = new Set(b.result.events.map((e) => e.type));
    for (const t of ['stake', 'bell', 'order', 'corner']) {
      assert(types.has(t), `a whole bout emitted no '${t}' event — the room's line for it is unreachable`);
      assert(announce({ type: t, who: null }, b.card) === null, `the engine already speaks '${t}'`);
    }
    assert(types.has('stoppage') || types.has('decision'),
      'the bout ended without the room saying how — no stoppage and no decision in the stream');
    /* THE SIM'S PER-ROUND BOOKENDS ARE NOT THE FIGHT'S. A round is a call of
     * the engine, so it opens with `off` and closes with `result`; a room
     * that forwarded those said "and they're away" and named a winner once
     * per round. Exactly one `result` in a whole bout, and it is the last. */
    assert(b.result.events.filter((e) => e.type === 'result').length === 1,
      `the bout named a winner ${b.result.events.filter((e) => e.type === 'result').length} times`);
    assert(!types.has('off'), "the sim's per-round `off` reached the room — the fight starts five times");

    return `${said} lines over ${b.result.events.length} events and ${cut.length} moments; `
      + `${translated} of the sim's own events re-said in the room's words, none of them quoting any of `
      + `the ${course.length} phrases read out of Spectacle's LINES; room events fired: `
      + `${['stake', 'bell', 'order', 'corner', 'stoppage', 'decision'].filter((t) => types.has(t)).join(', ')}`;
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

  /* ══════════════════════════════════════════════════════════════════════
   *  6. A ROOM WITH TWO DOORS, AND THE ONE THAT ATE THE PRESS
   * ══════════════════════════════════════════════════════════════════════ */

  check('pits: #20 is a pit AND a book, and the pit only keeps a press it took', async () => {
    /**
     * ══ THE DEFECT, DRIVEN ══════════════════════════════════════════════
     *
     * `Station.stationKey` raised the pit before the tote and RETURNED on
     * whatever the pit answered. `#20 The Arena` has both, so on a profile
     * with no animal the room was one line — "you have nothing to put in
     * there" — at every hour of every day, and the Arena's betting card could
     * not be opened by a player at all. Measured before the fix:
     *
     *     #18 at 22:00 → [tote]    #19 at 14:45 → [tote]
     *     #20 at 18:15 → [pit]     "THE ARENA / you have nothing to put in there"
     *
     * The fix is that the pit keeps the press only when it took it — `main.js`
     * `openPit` hands it on when there is no bout for you and a book shares
     * the room. This check stands at #20's door and drives the real key with
     * both answers out of the pit, which is the shape the panel has.
     */
    const { stationKey } = await import('../../src/game/Station.js');
    const { PLACE, floorOf } = await import('../../src/game/StationPlan.js');
    const { world } = await station(40);
    try {
      const arenaPlace = PLACE.get(20);
      world.player.position.set(arenaPlace.x, floorOf(arenaPlace) + 1, arenaPlace.z);
      const raised = [];
      world.notify = () => {};
      world.onTote = (id) => { raised.push(`tote:${id}`); return true; };

      /* THE PLAYER WITH NOTHING TO PUT IN. The pit refuses the press — which
       * is what `openPit` does at a room with a book in it — and the key must
       * reach the card. Without the `Station.js` fall-through this is [pit]
       * and the assert below is the failure the audit reported. */
      world.onPit = () => { raised.push('pit'); return false; };
      assert(stationKey(world) === true, '#20 did not answer the key at all');
      assert(raised.join(',') === 'pit,tote:the-arena',
        `the key at #20 raised [${raised.join(', ')}] — a pit that refuses must hand the press to the book`);

      /* AND THE PLAYER WHO DOES KEEP ONE still gets the sand, first, and the
       * book is not raised behind it. The Arena's own verb is "fight a bout"
       * and that has to keep winning the press when there is a bout. */
      raised.length = 0;
      world.onPit = () => { raised.push('pit'); return true; };
      assert(stationKey(world) === true, '#20 did not answer the key with a bout on');
      assert(raised.join(',') === 'pit',
        `the key raised [${raised.join(', ')}] — a bout you can take must not open a second panel behind it`);

      /* #61 HAS NO BOOK, so nothing about the Underlift moved: its refusal is
       * still the only answer in the room and still spends the press. */
      const under61 = PLACE.get(61);
      world._stationFloor = 44;
      const w44 = (await station(44)).world;
      try {
        w44.player.position.set(under61.x, floorOf(under61) + 1, under61.z);
        const said = [];
        w44.notify = (a, b) => said.push(`${a}: ${b}`);
        w44.onTote = () => { said.push('TOTE RAISED'); return true; };
        w44.onPit = () => { said.push('pit'); return false; };
        assert(stationKey(w44) === true, '#61 did not answer the key');
        assert(!said.includes('TOTE RAISED'),
          'the Underlift raised a betting window — #61 is deliberately not on the tote\'s list');
      } finally { w44.dispose?.(); }
      return 'no animal → [pit, tote:the-arena]; a bout on → [pit] only; #61 raises no book';
    } finally { world.dispose?.(); }
  });

  check('pits: the card of people who live here is on a screen, and every exit cancels the clock', async () => {
    /**
     * ══ WHY A SOURCE READ ══════════════════════════════════════════════
     *
     * `pitCard()` and `runPitCard()` are the two functions that build a card
     * of station residents who are not you — *"you should be able to bet on
     * other people's companion battles too even if you're not involved"* —
     * and both were green in this file with NO CALLER ANYWHERE IN `src/`.
     * Only this suite reached them, so the one thing that sentence asked for
     * was a tested function no player could see. A data check cannot catch
     * that; the thing missing is a caller.
     *
     * The same read holds the tote panel's clock, which is the other half of
     * the same lane: a timer with no cancel on an exit raises its last frame
     * over whatever the player walked into next, and `cancelDeathCard` and
     * `clearPitTimer` are the two precedents for the handle.
     */
    const { readFile } = await import('node:fs/promises');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const code2 = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    assert(/\bpitCard\b/.test(code2), 'nothing in main.js calls pitCard — the residents\' card has no screen');
    assert(/from '\.\/game\/Pits\.js'/.test(main), 'main.js does not import from Pits.js at all');

    /* THE PRESS IS HANDED ON. `openPit` must refuse when a book shares the
     * room and there is no bout for you — without this line `stationKey`'s
     * fall-through never fires and #20 is a refusal again. */
    const openPit = /function openPit\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(code2)?.[1] || '';
    assert(openPit, 'openPit is gone from main.js');
    assert(/venueAtPlace\([^)]*\)\s*&&\s*!\s*pitOffer\([^)]*\)\.offer/.test(openPit),
      'openPit keeps the press at a room that is both a pit and a book — the Arena\'s card is unreachable');

    /* THE CLOCK, AND ITS HANDLE. One timer variable, and every exit clears it. */
    assert(/tickStationClock/.test(code2),
      'the tote panel does not wind the station clock — a race watched with the panel up is a photograph');
    assert(/function clearToteTimer/.test(code2), 'the tote\'s timer has no cancel');
    const cancels = (code2.match(/clearToteTimer\(\)/g) || []).length;
    assert(cancels >= 3,
      `clearToteTimer is called ${cancels} time(s) — the bell, the card's hide and the leave door are three`);
    assert(/screens\.card\('tote',[\s\S]{0,120}?clearToteTimer/.test(code2),
      "the tote's `screens.card` hide does not cancel the timer — it outlives its screen");
    return `pitCard has a caller in main.js; openPit hands the press on; clearToteTimer called ${cancels}×`;
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
