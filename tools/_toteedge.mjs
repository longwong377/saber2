/**
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT THE TOTE PAYS A MAN WHO READS THE FORM, AND ONE WHO DOES NOT
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   node tools/_toteedge.mjs [bets-per-window] [venue …]
 *
 * The long run behind the band `tools/checks/tote.mjs` asserts. The suite
 * bounds itself to a few thousand bets a window so the gate stays a gate; this
 * rides the same driver — `tools/checks/_tote-edge.mjs`, one implementation,
 * no twin — for a quarter of a million bets at each of the three, which is
 * where an edge of one or two points stops being a coin.
 *
 * Every bet is struck at the window through `ticketFor`, against a board
 * `boardFor` priced, on a book `bookAt` would have handed the player, and paid
 * by `settleTickets`. Nothing is modelled here.
 *
 *   node tools/_toteedge.mjs 250000            # the full run, ~2 h
 *   node tools/_toteedge.mjs 8000 the-pit      # one window, a minute
 */
import { VENUES, venueById } from '../src/game/Tote.js';
import { SKINS } from '../src/game/Spectacle.js';
import { playWindow, agreesWithBookAt, pct, MARGIN, STAKE } from './checks/_tote-edge.mjs';

const args = process.argv.slice(2);
const bets = Number(args[0]) || 250000;
const only = args.slice(1).filter((a) => venueById(a));
const venues = (only.length ? only : VENUES.map((v) => v.id));

console.log(`the tote, played — ${bets.toLocaleString()} form-reader bets a window, ${STAKE} a ticket, `
  + `overlay ${pct(MARGIN)}\n`);

for (const id of venues) {
  const v = venueById(id);
  const S = SKINS[v.skin];
  /* THE BOOK FIRST. If the bettor is not reading the room's own form book,
   * nothing under this line is about this game. */
  const day = 60;
  if (!agreesWithBookAt(id, day)) {
    console.log(`${id}: the driver's book does not match bookAt(${id}, ${day}) — measured nothing`);
    continue;
  }
  const t0 = Date.now();
  const r = playWindow(id, { bets, yardSeed: 90210 });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const band = (b) => `${pct(b.roi)} ± ${pct(b.se)}`;
  console.log(`${v.name} (${id}) — take ${pct(S.take)}, ${r.days.toLocaleString()} days, `
    + `${r.races.toLocaleString()} races, ${secs}s`);
  console.log(`   form-reader  ${band(r.reader)}  on ${r.reader.bets.toLocaleString()} bets `
    + `(${pct(r.reader.bets / r.races)} of races, strike ${pct(r.reader.strike)})`);
  console.log(`   the pin      ${band(r.pin)}  on ${r.pin.bets.toLocaleString()} cards`);
  console.log(`   the market leader ${band(r.favourite)}`);
  console.log(`   reader over pin ${pct(r.reader.roi - r.pin.roi)}, `
    + `t ${((r.reader.mean - r.pin.mean) / Math.hypot(r.reader.se, r.pin.se)).toFixed(1)}\n`);
}
