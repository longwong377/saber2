/**
 * THE READING ROOM'S ODDS (V18 hole 10).
 *
 *   EVERY RUNNER ON TODAY'S CARD has a five-result form and a price.
 *   THE BOOK IS OVERROUND — the prices add to more than 100%.
 *   THE PRICE DRIFTS every 30 station-min up to the off and is frozen after.
 *   A WINNING TICKET PAYS AT THE PRINTED ODDS, through the shipped
 *     `ticketFor` → `settleTickets`.
 *   THE BOARD is hung under every feed and repaints when the prices move.
 */

import { readFile } from 'node:fs/promises';
import { clocked } from './_shared.mjs';
import * as Form from '../../src/game/Form.js';
import { racesOn, resultOf, ticketFor, settleTickets, clearTote, VENUES } from '../../src/game/Tote.js';

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

async function station(deck = 40) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation, finishStationBuild } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  finishStationBuild(world);
  return { world, idle: idleInput() };
}

function recorder() {
  const log = [];
  const ctx = { log, measureText: () => ({ width: 0 }) };
  for (const k of ['fillRect', 'strokeRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill'])
    ctx[k] = (...a) => { log.push(k + ':' + a.map((v) => (typeof v === 'number' ? v.toFixed(1) : String(v))).join(',')); };
  ctx.fillText = (s) => { log.push(`fillText:${s}`); };
  for (const k of ['fillStyle', 'font', 'textAlign']) Object.defineProperty(ctx, k, { set(v) { log.push(`${k}=${v}`); }, get() { return ''; } });
  return ctx;
}

/** A day with a card on at every venue. */
function dayWithCards() {
  for (let d = 20; d < 60; d++) if (VENUES.every((v) => racesOn(v.id, d).length)) return d;
  throw new Error('no day with a card at every venue');
}

export async function run({ check, assert, near }) {
  check = await clocked(check);

  check('form: every runner on today\'s card has a five-result form and a price, and the book is overround', () => {
    clearTote();
    const day = dayWithCards();
    let runners = 0, races = 0, worst = 0;
    const overs = [];
    for (const v of VENUES) {
      for (const race of racesOn(v.id, day)) {
        races++;
        const rows = Form.oddsAt(race, 0);
        assert(rows.length === race.card.entrants.length, `${rows.length} rows for ${race.card.entrants.length} runners`);
        for (const r of rows) {
          runners++;
          assert(r.form.length === Form.FORM_N, `${r.name} has a form of ${r.form.length}`);
          const known = r.form.filter((p) => p != null).length;
          assert(known === Form.FORM_N, `${r.name} at ${v.id} has ${known} of ${Form.FORM_N} results — the book did not run the past`);
          assert(/^\d+(-\d+){4}$/.test(r.line), `form line "${r.line}"`);
          assert(r.odds >= Form.MIN_PRICE && Number.isFinite(r.odds), `price ${r.odds}`);
          worst = Math.max(worst, r.odds);
        }
        const over = Form.overroundOf(rows);
        assert(over > 1.0, `the book at ${v.id} adds to ${(over * 100).toFixed(1)}% — no overround`);
        overs.push(over);
      }
    }
    const lo = Math.min(...overs), hi = Math.max(...overs);
    return `${runners} runners on ${races} races at ${VENUES.length} venues, all 5-result forms; books add to ${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}%; longest ${worst}`;
  });

  check('form: the price drifts every 30 station-min up to the off, is frozen after, and is the same on every machine', () => {
    clearTote();
    const day = dayWithCards();
    const race = racesOn('holo-theatre', day)[0];
    const a = Form.oddsAt(race, 0);
    const b = Form.oddsAt(race, 0.4);
    assert(a.map((r) => r.odds).join() === b.map((r) => r.odds).join(), 'the price moved inside one half-hour slot');
    const c = Form.oddsAt(race, 0.5);
    const moved = c.filter((r, i) => r.odds !== a[i].odds).length;
    assert(moved > 0, 'the price did not move on the half hour');
    /* Later, more drift; after the off, frozen. */
    const atOff = Form.oddsAt(race, race.hour);
    const after = Form.oddsAt(race, race.hour + 3);
    assert(atOff.map((r) => r.odds).join() === after.map((r) => r.odds).join(), 'the price moved after the off');
    /* The overround holds through the drift. */
    near(Form.overroundOf(c), Form.OVERROUND, 0.03, 'the drift broke the overround');
    /* Deterministic: a fresh book gives the same prices. */
    clearTote();
    const again = Form.oddsAt(racesOn('holo-theatre', day)[0], 0.5);
    assert(again.map((r) => r.odds).join() === c.map((r) => r.odds).join(), 'the same race priced differently on a second read');
    return `${moved} of ${a.length} prices moved at 00:30; frozen after ${race.hour}; overround ${(Form.overroundOf(c) * 100).toFixed(1)}% through the drift`;
  });

  check('form: a winning ticket struck at the station\'s window pays at the printed odds', () => {
    clearTote();
    const day = dayWithCards();
    let paid = 0, tried = 0;
    for (const race of racesOn('holo-theatre', day)) {
      const result = resultOf(race);
      const at = Math.max(0, race.hour - 1.2);
      const printed = Form.priceAt(race, result.winner, at);
      const q = Form.printedTicket(race, { on: result.winner, kind: 'win', stake: 100, at });
      assert(q.ok, q.why);
      assert(q.ticket.form === printed, `the ticket carries ${q.ticket.form} and the room printed ${printed}`);
      const led = settleTickets([q.ticket], result);
      tried++;
      assert(led.lines[0].won, 'the winner did not win');
      assert(led.returned === Math.round(100 * printed), `paid ${led.returned} on 100 at ${printed}`);
      paid += led.returned;
      /* And a loser pays nothing, whatever the room printed. */
      const loser = race.card.entrants.find((e) => e.id !== result.winner);
      const lq = Form.printedTicket(race, { on: loser.id, kind: 'win', stake: 100, at });
      /* And the tote's own quote, unstamped, still pays at the house's price. */
      const plain = ticketFor(race, { on: result.winner, kind: 'win', stake: 100, at });
      assert(settleTickets([plain.ticket], result).returned === Math.round(100 * plain.ticket.price), 'an unstamped ticket was paid at the room\'s price');
      assert(settleTickets([lq.ticket], result).returned === 0, 'a loser was paid');
      if (tried >= 3) break;
    }
    return `${tried} winners paid ${paid} on ${tried * 100} staked at the printed prices`;
  });

  check('form: the board hangs under every feed on deck 40, prints a card per race, and repaints when the prices move', async () => {
    clearTote();
    const { world, idle } = await station(40);
    try {
      const st = world._station;
      const B = world._formBoards;
      assert(B && B.boards.length === st.feeds.length && st.feeds.length >= 1,
        `${B?.boards.length ?? 0} boards for ${st.feeds?.length ?? 0} feeds`);
      /* A board whose venue has a card on today — a dark night is a blank
       * board, which is right and proves nothing. Days pass through the fold
       * until one of the three rooms is running. */
      const { setStationHour } = await import('../../src/game/StationSave.js');
      let b = null;
      for (let tries = 0; tries < 8 && !b; tries++) {
        st.hour = 0.2; world.update(1 / 60, idle);
        b = B.boards.find((x) => racesOn(x.feed.venue, st.day | 0).length) || null;
        if (!b) { setStationHour(st.hour + 24); st.hour = 0.2; }
      }
      assert(b, 'no venue had a card on in eight days');
      const rec = recorder();
      b.canvas.getContext = () => rec;
      /* AT THE ROOM'S DOOR, so the door cull has the board drawn. */
      const { PLACE } = await import('../../src/game/StationPlan.js');
      const room = PLACE.get(VENUES.find((v) => v.id === b.feed.venue).place);
      world.player.position.x = room.door[0]; world.player.position.z = room.door[1];
      /* Before the first race, so the prices are still moving. */
      st.hour = 0.2;
      /* Two frames: the door cull runs at the end of the first, the paint on the second. */
      world.update(1 / 60, idle);
      b.key = ''; B.t = 0; rec.log.length = 0;
      world.update(1 / 60, idle);
      assert(b.draws >= 1 && b.cards.length === racesOn(b.feed.venue, st.day | 0).length, `${b.draws} draws, ${b.cards.length} cards`);
      const printed = rec.log.filter((l) => /^fillText:\d+\.\d\d$/.test(l)).length;
      const lines = rec.log.filter((l) => /^fillText:\d(-\d){4}$/.test(l)).length;
      assert(printed >= 4 && lines >= 4, `${printed} prices and ${lines} form lines on the glass`);
      /* Half an hour on, a new key and a repaint. */
      const draws = b.draws;
      st.hour += 0.5; B.t = 0;
      world.update(1 / 60, idle);
      assert(b.draws === draws + 1, `the board did not repaint on the half hour (${b.draws} vs ${draws})`);
      return `${B.boards.length} boards; ${b.cards.length} cards, ${printed} prices and ${lines} form lines painted; repaints on the half hour`;
    } finally {
      world.dispose?.();
    }
  });
}
