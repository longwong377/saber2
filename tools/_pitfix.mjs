/**
 * THROWAWAY — drives a real bout end to end at the module layer, exactly as
 * `main.js`'s pit panel drives it: a board read, credits staked on your own
 * animal, orders played against the telegraph, a corner spent, a settlement,
 * and then a stake on somebody else's bout on tonight's card.
 *
 *   node tools/_pitfix.mjs
 */
import {
  PITS, PIT_ORDERS, pitById, venueOpen, handlersOn, ROSTER_HOUR,
  offerBout, openBout, beginRound, callOrder, runRound, cornerAct, pitState,
  settleBout, foldPit, pitCall, runPitCard, settlePitCard, holdsOrder,
} from '../src/game/Pits.js';
import { announce } from '../src/game/Spectacle.js';
import { holdsCompanion } from '../src/game/CompanionKinds.js';
import * as Kn from '../src/game/Kennel.js';
import { clearCredits, pay, spend, purse } from '../src/game/Credits.js';

const line = (s) => console.log(s);
const rule = (s) => line(`\n── ${s} ${'─'.repeat(Math.max(0, 68 - s.length))}`);

/* ── the animal a player actually starts with: fresh, nothing earned ────── */
const rec = Kn.adopt('massiff', 'Borz');
Kn.save({ ...Kn.load(), live: rec });
const fresh = Kn.load().live;

rule('5. WHAT A FIRST BOUT CAN BE TOLD TO DO');
const wasHeld = PIT_ORDERS.filter((o) => holdsCompanion(fresh, o.holds)).map((o) => o.label);
const nowHeld = PIT_ORDERS.filter((o) => holdsOrder(fresh, o)).map((o) => o.label);
line(`  xp ${fresh.xp} (STRANGE)  before: ${wasHeld.join(', ')}`);
line(`  xp ${fresh.xp} (STRANGE)  after:  ${nowHeld.join(', ')}`);
for (const xp of [6, 16, 20]) {
  const r = { kind: 'massiff', xp };
  line(`  xp ${String(xp).padEnd(2)}            after:  ${PIT_ORDERS.filter((o) => holdsOrder(r, o)).map((o) => o.label).join(', ')}`);
}

/* ── a night the illegal pit is on ─────────────────────────────────────── */
const under = pitById('underlift');
let day = 0;
while (!venueOpen(under, 23, { day }).open) day++;
const handler = handlersOn(ROSTER_HOUR, day)[0];

clearCredits();
pay(500, 'probe');
const opened = purse();

rule('1. THE BOARD ON THE SCREEN WHERE YOU STAKE THE ANIMAL');
const offer = offerBout({ venue: under, rec: fresh, handler, hour: 23, day });
for (const r of offer.board) line(`  ${(r.name || '(no name)').padEnd(22)} ${r.odds || r.price}`);

rule('3. A WAGER ON YOURSELF');
const WAGER = 100;
const took = spend(WAGER, 'pit');
line(`  purse ${opened} → ${purse()} (${WAGER} through the window, ${took.ok ? 'taken' : took.why})`);
const bout = openBout(offer, { accept: offer.stake.token, wager: WAGER });
line(`  bout.stake.wager = ${bout.stake.wager}, mortal ${bout.stake.mortal}, purse ${bout.stake.purse}`);

rule('2. THE CALL — before (Spectacle.announce) and after (Pits.pitCall)');
let guard = 0;
while (!bout.over && guard++ < 20) {
  const read = beginRound(bout);
  /* Read the telegraph and answer it with an order this animal actually
   * holds — which on a fresh animal is now a choice and not a refusal. */
  const answer = PIT_ORDERS.find((o) => o.counters === read.reads && holdsOrder(fresh, o))
    || PIT_ORDERS.find((o) => o.id === 'break');
  const said = callOrder(bout, answer.id, read.commitAt, fresh);
  if (said.refused) line(`  [REFUSED] ${said.refused}`);
  const out = runRound(bout);
  for (const ev of out.events) {
    const now = pitCall(ev, bout.card);
    const was = announce(ev, bout.card);
    if (!now) continue;
    line(`  before: ${was || '(silence — no line reached)'}`);
    line(`  after : ${now}`);
  }
  if (!bout.over) {
    const st = pitState(bout);
    const act = cornerAct(bout, bout.bleed ? 'bind' : 'water');
    if (act.refused) line(`  [CORNER REFUSED] ${act.refused}`);
    else line(`  after : ${pitCall(bout.events[bout.events.length - 1], bout.card)}   (yours ${Math.round(st.condition)}, his ${Math.round(st.theirCondition)})`);
  }
}
line(`  outcome: ${bout.outcome.won ? 'WON' : 'LOST'} in ${bout.outcome.rounds} — ${bout.outcome.how}`);
line(`  event types over the whole bout: ${[...new Set(bout.events.map((e) => e.type))].join(', ')}`);

rule('3b. THE SETTLEMENT');
const fold = foldPit(bout);
const led = settleBout(bout);
const back = Math.round(led.returned);
if (back) pay(back, 'pit');
const won = bout.outcome.purse | 0;
if (won) pay(won, 'pit');
line(`  ledger: staked ${led.staked} at ${led.lines[0]?.price} → back ${led.returned} (net ${led.net})`);
line(`  purse ${opened} → ${purse()}   [wager ${WAGER} out, ${back} back, purse ${won}]`);
if (fold.scar) line(`  scar: ${fold.scar}`);
if (fold.died) line('  it did not come back.');

rule('4. A STAKE ON SOMEBODY ELSE\'S BOUT — tonight\'s card at #20');
const arena = pitById('arena');
const night = runPitCard(arena, { day, bouts: 1 });
if (!night.card) { line(`  ${night.why}`); } else {
  const race = night.races[0];
  const by = new Map(night.handlers.map((h) => [h.id, h]));
  for (const r of race.board) {
    line(`  ${(r.name || '(no name)').padEnd(22)} ${String(r.odds).padEnd(7)} ${by.get(r.id)?.who || 'a stranger'}`);
  }
  const before = purse();
  const on = race.board[1];
  const paidIn = spend(50, 'pit');
  line(`  backing ${on.name} at ${on.odds} for 50 — ${paidIn.ok ? 'taken' : paidIn.why}`);
  const cardLed = settlePitCard(night, [{ entrant: on.id, stake: 50 }], 0);
  const gave = Math.round(cardLed.returned);
  if (gave) pay(gave, 'pit');
  for (const ev of race.result.events.slice(-4)) {
    const now = pitCall(ev, night.card);
    if (now) line(`  after : ${now}`);
  }
  line(`  winner ${race.board.find((r) => r.id === race.result.winner)?.name}`);
  line(`  ledger: staked ${cardLed.staked} → back ${cardLed.returned} (net ${cardLed.net})`);
  line(`  purse ${before} → ${purse()}`);
}
line('');
