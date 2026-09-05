/* THROWAWAY. The Drum's window, swept and Monte-Carlo'd, before and after.
   node tools/_drumfix.mjs                                                   */
import './dom-shim.mjs';
const OLD = '/tmp/claude-0/-home-user-saber2/2c88c71e-8985-5aff-85cf-baa467dd4021/scratchpad/old/Games.js';
const G = await import('../src/game/Games.js');
const O = await import(OLD);
const CAS = await import('../src/game/Casino.js');
const bets = CAS.drumBets();

const pad = (s, n) => String(s).padEnd(n);

/* ── 1. THE SWEEP: 24 hours x 11 rows. Can it pay, and is the bet it pays
 *      the bet that actually won? */
function sweep(label, strike, settle, pays) {
  let canPay = 0, right = 0, wrong = 0, missed = 0, legal = 0;
  const notes = [];
  for (let h = 0; h < 24; h++) for (let i = 0; i < bets.length; i++) {
    const bet = { ...bets[i], stake: 25 };
    const t = strike(bet, h + 0.4, 0);
    const at = settle(t);
    const paid = pays(t, at);
    /* WHAT THE WHEEL SAYS, read off the untouched bet against the same stop. */
    const truth = G.drumPays({ ...bets[i], stake: 25 }, at);
    if (G.drumLegal(t)) legal++;
    if (paid > 0) { canPay++; if (truth > 0) right++; else wrong++; }
    else if (truth > 0) missed++;
    if (paid > 0 && truth <= 0 && notes.length < 3) {
      notes.push(`  hour ${h}: "${bets[i].label}" was paid ${paid} on a turn it lost`);
    }
  }
  console.log(`${pad(label, 22)} a bet at all ${pad(legal + '/264', 9)} paid ${pad(canPay + '/264', 9)} right ${pad(right, 5)} `
    + `WRONG ${pad(wrong, 5)} winners left unpaid ${missed}`);
  notes.forEach((n) => console.log(n));
  return { canPay, right, wrong, missed };
}

console.log('\n── SWEEP: every hour, every row ──────────────────────────────');
/* BEFORE: main.js:2547 verbatim, against HEAD's Games.js. */
sweep('before (shipped)',
  (bet, hour) => ({ ...bet, on: (Math.floor(hour) + 1) % 24, day: 0 }),
  (t) => O.drumAt(t.on, t.day),
  (t, at) => O.drumPays(t, at));
/* AFTER: the panel's path now. */
sweep('after (drumTicket)',
  (bet, hour, day) => G.drumTicket(bet, hour, day),
  (t) => G.drumStop(t),
  (t, at) => G.drumPays(t, at));

/* ── 2. THE OFF-BY-ONE: does a ticket settle on the click that struck it? */
console.log('\n── THE SAME-CLICK SETTLE ─────────────────────────────────────');
{
  const hour = 21.66, day = 0;
  const oldT = { ...bets[0], stake: 25, on: (Math.floor(hour) + 1) % 24, day };
  const oldDue = (0 /* drumTable(hour).hour */ + Math.floor(hour)) !== oldT.on;
  console.log(`  before: struck at ${hour} riding "${oldT.on}:00", settles on this very click: ${oldDue}`);
  const t = G.drumTicket({ ...bets[0], stake: 25 }, hour, day);
  console.log(`  after:  struck at ${hour} riding turn ${t.turn} (${String(G.drumClockOf(t.turn).hour).padStart(2, '0')}:00), `
    + `due now ${G.drumDue(t, hour, day)}, due at 21:59 ${G.drumDue(t, 21.99, day)}, `
    + `due at 22:00 ${G.drumDue(t, 22.0, day)}`);
  const late = G.drumTicket({ ...bets[0], stake: 25 }, 23.7, 0);
  console.log(`  after:  struck at 23:42 rides turn ${late.turn} = day ${G.drumClockOf(late.turn).day} `
    + `${String(G.drumClockOf(late.turn).hour).padStart(2, '0')}:00, due at day 1 00:00 ${G.drumDue(late, 0.1, 1)}`);
}

/* ── 3. THE EDGE, MONTE-CARLO'D over the window's own path. */
console.log('\n── HOUSE EDGE over 240,000 tickets a row ─────────────────────');
const SPINS = 240000;
function edge(strike, settle, pays, bet) {
  const STAKE = 1000;
  let staked = 0, back = 0;
  for (let i = 0; i < SPINS; i++) {
    const t = strike({ ...bet, stake: STAKE }, (i % 24) + 0.5, (i / 24) | 0);
    staked += STAKE; back += pays(t, settle(t));
  }
  return 1 - back / staked;
}
const rows = [['deck', { kind: 'deck', on: 40 }], ['band', { kind: 'band', on: 1 }],
  ['spine 0', { kind: 'spine', on: 0 }], ['spine 1', { kind: 'spine', on: 1 }]];
for (const [name, bet] of rows) {
  const before = edge((b, hour) => ({ ...b, on: (Math.floor(hour) + 1) % 24, day: (hour / 24) | 0 }),
    (t) => O.drumAt(t.on, t.day), (t, at) => O.drumPays(t, at), bet);
  const after = edge((b, hour, day) => G.drumTicket(b, hour, day), (t) => G.drumStop(t),
    (t, at) => G.drumPays(t, at), bet);
  console.log(`  ${pad(name, 9)} before ${pad((before * 100).toFixed(2) + '%', 10)} after ${(after * 100).toFixed(2)}%`);
}
/* And every row on the board, through Games' own measurement. */
console.log('\n── drumTicketEdge over every row the panel offers ────────────');
for (const b of bets) {
  const e = G.drumTicketEdge(b, 24000);
  console.log(`  ${pad(b.label, 18)} ${(e * 100).toFixed(2)}%`);
}
