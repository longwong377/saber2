/**
 * THE FIGHT COMES HOME — V20 lane 7, driven.
 *
 * *"Sabers on the station: a duel in the arena with a crowd betting, a Sith who
 * drinks in the cantina and follows you out."*
 *
 * Four clauses, in the order a player meets them:
 *
 *   (a) THE ARENA. At a bout hour a named duellist waits in the well; the
 *       interact key at the kerb starts a bout; the blade gate opens in the
 *       sand and closes the moment you step out of it; sixteen or more of the
 *       crowd are in the room; landed blows score three touches and the bout
 *       resolves with the purse, the fold and the crowd's roar; and a ticket
 *       struck on the bout at the tote's window pays at the board's own price.
 *   (b) THE SITH. At 22:30 he is seated at a booth in #14 with a cup in his
 *       hand and a red hilt on the table; at 00:30, walking out, he follows
 *       six to eight metres back for twenty seconds, ignites on the ring's
 *       dark stretch, the guards are on their way inside forty seconds and the
 *       fight ends with a line out of his mouth.
 *   (c) EVERYWHERE ELSE the blade stays down: the ignite key is refused and a
 *       blade lit by any other door is put away on the next frame.
 *   (d) Nothing in the lane rolls a die.
 *
 * ── WHAT A "TOUCH" IS DRIVEN WITH, AND WHY IT IS NOT A KEYPRESS ──────────
 *
 * The bout does not implement hitting: `StationDuel.scoreTouches` watches the
 * two fighters' hit points, which is where the game's own blade, guard, parry
 * and fist already write their answer. So a scripted swing here is the SAME
 * call a landed blade makes — `Enemy.damage(amount, point, world.player,
 * 'saber')`, the one line in `Enemy.js` where hit points are actually lost —
 * and a swing that a parry ate writes nothing and is therefore not a touch.
 * Synthesising a controller input instead would be measuring `SaberController`,
 * which has its own suite (`saberforms.mjs`, `duelling.mjs`), not this one.
 */

import { readFile } from 'node:fs/promises';

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/** The station, through the door the game uses — `seated.mjs`'s own helper. */
async function station(deck = 40) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation, finishStationBuild } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0, quality: 'high' },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  finishStationBuild(world);
  return { world, idle: idleInput() };
}

const ARENA = 20, CANTINA = 14;

/**
 * LOOK AT A POINT — and the camera is the thing that has to be turned.
 *
 * `Player.update` eases `facing` toward `camera.yaw + π` every frame, so a
 * check that writes `facing` alone is writing a field the next frame undoes.
 * That is how "he stops when you turn" came to look broken when it was not.
 */
function look(world, x, z) {
  const p = world.player;
  const f = Math.atan2(x - p.position.x, z - p.position.z);
  p.facing = f;
  p.camera.yaw = f - Math.PI;
}

/**
 * THE STATION ON A NAMED DAY AT A NAMED HOUR.
 *
 * `st.day` is NOT settable by assignment: `Station.tickStationClock` writes it
 * from `StationSave.stationDay()` on every frame, so a check that set the
 * field found itself back on day 0 the moment it stepped — which is how this
 * helper came to exist. The day is moved where the game moves it, through
 * `passStationHours`, before the world is built.
 */
async function stationOn(day = 0, hour = 13, deck = 40) {
  const S = await import('../../src/game/StationSave.js');
  S.clearStation();
  /* AND A FLOAT IN THE POCKET. The kerb takes `StationDuel.STAKE` before it
   * drops you in — `Credits.spend` is the one spend door and it refuses
   * rather than going negative — so a check standing at the kerb with an
   * empty purse is a check measuring the wallet. */
  const C = await import('../../src/game/Credits.js');
  C.clearCredits();
  C.pay(400, 'a float for the kerb and the window');
  if (day > 0) S.passStationHours(24 * day);
  const { world, idle } = await station(deck);
  const st = world._station;
  st.hour = hour; st._savedHour = hour | 0;
  const life = world._stationLife;
  if (life) { life.event = null; life.eventFor = 0; life.eventIn = 1e6; }
  return { world, idle, st, life };
}

/** The first day from `from` on which the acolyte is in the cantina at all. */
function sithNight(D, from = 0) {
  for (let d = from; d < from + 20; d++) if (D.sithFor(d).in) return d;
  return from;
}

/**
 * ONE AT A TIME — and this is not tidiness, it is the only correct order.
 *
 * `tools/_one.mjs` (and `verify.mjs`) start every async check and await them
 * together, so the bodies interleave. Every clause below writes the SAME
 * module singleton: `StationSave` is one fold for the process, and a check
 * that clears it and walks the clock to day 5 moves the day out from under a
 * check that was standing in day 3's bout. Measured, exactly that: three of
 * the eight failed together and all eight passed one at a time, which is the
 * most expensive shape a check can have.
 *
 * So the world-driving clauses are put on one queue. They still run inside the
 * runner's own promise, and a failure is still that clause's failure.
 */
let queue = Promise.resolve();
const serial = (fn) => () => (queue = queue.then(fn, fn));

/** Put the player somewhere, body and all. */
function stand(world, x, z, y = null) {
  const p = world.player;
  const yy = y == null ? (world.floorAt ? world.floorAt(x, z) + 0.1 : 1.7) : y;
  p.position.set(x, yy, z);
  p.body?.setTransform?.(p.position, null);
  p.velocity?.set?.(0, 0, 0);
}

export async function run({ check, assert }) {
  const D = await import('../../src/game/StationDuel.js');
  const T = await import('../../src/game/Tote.js');

  /* ════════════════════════════════════════════════════════════════════════
   *  THE CARD — before any world is built
   * ════════════════════════════════════════════════════════════════════════ */

  check('duel: the card is seeded — two bout hours a day inside the Arena\'s own, a real saber archetype in the sand', async () => {
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    const venue = T.venueAtPlace(ARENA);
    assert(venue && venue.id === 'the-arena', 'nothing at #20 answers `venueAtPlace`');
    const seen = new Set();
    for (let day = 0; day < 40; day++) {
      const hours = D.boutHoursOn(day);
      assert(hours.length === 2, `day ${day} has ${hours.length} bout hours`);
      assert(String(hours) === String(D.boutHoursOn(day)), `day ${day} answers differently on the second ask`);
      for (const h of hours) {
        assert(h >= venue.hours[0] && h <= venue.hours[1], `a bout at ${h}:00 on a room open ${venue.hours[0]}–${venue.hours[1]}`);
        assert(D.boutAt(day, h + 0.5) === h, `${h}.5 is not inside the bout at ${h}`);
        assert(D.boutAt(day, h + 1.5) !== h, `${h + 1}.5 is still inside the bout at ${h}`);
        const who = D.duellistFor(day, h);
        assert(ARCHETYPES[who.type], `day ${day} ${h}:00 puts "${who.type}" in the sand and there is no such archetype`);
        assert(ARCHETYPES[who.type].saber === true, `${who.type} is not a saber body`);
        assert(who.name && who.name.length > 2, `day ${day} ${h}:00 has an unnamed duellist`);
        seen.add(who.type);
      }
    }
    /* Forty days is 80 bouts: a marshal who only ever books one archetype is a
     * marshal with one man, which is what a bad seed reads as. */
    assert(seen.size >= 3, `only ${seen.size} of the four archetypes are ever booked over forty days`);
    return `40 days · 80 bouts · hours inside ${venue.hours[0]}–${venue.hours[1]} · ${seen.size} archetypes booked (${[...seen].join(', ')})`;
  });

  check('duel: the bout is a race the tote can price — a board, a ticket, and it pays at its odds', async () => {
    D.clearDuelCards();
    const race = D.duelRaceFor(3, 12);
    assert(race.kind === T.DUEL_KIND, `the bout is kind "${race.kind}"`);
    assert(race.venue === 'the-arena' && race.word === 'bout', 'the bout is not at the Arena');
    const board = T.boardFor(race);
    assert(board.runners.length === 2, `${board.runners.length} on a card that is two people`);
    const sum = board.runners.reduce((a, r) => a + r.marketP, 0);
    assert(Math.abs(sum - 1) < 0.01, `the book adds to ${sum.toFixed(3)}`);
    assert(!board.field, 'a two-runner bout has a field market, which is backing the other one at a worse price');
    assert(board.places === 0, 'a place market on a two-runner bout pays everybody');
    for (const r of board.runners) assert(r.win > 1.0, `${r.name} is priced at ${r.win}`);

    /* THE WINDOW. Struck before the bout goes off, on the duellist. */
    const him = board.runners.find((r) => r.id === 'duellist');
    const q = T.ticketFor(race, { on: 'duellist', kind: 'win', stake: 10, at: race.hour - 0.2 });
    assert(q.ok, `the window refused a tenner: ${q.why}`);
    assert(Math.abs(q.ticket.price - him.win) < 1e-9, `the ticket is at ${q.ticket.price} and the board says ${him.win}`);
    const shut = T.ticketFor(race, { on: 'duellist', kind: 'win', stake: 10, at: race.hour + 0.1 });
    assert(!shut.ok, 'the window took a bet on a bout that had already started');

    /* HE WINS: the ticket is worth stake × price. YOU win: it is worth nothing. */
    const won = T.duelResult(race, 'duellist');
    assert(won.winner === 'duellist' && won.order[0].id === 'duellist', 'the result does not name the winner first');
    const paid = T.settleTickets([q.ticket], won);
    assert(paid.returned === Math.round(10 * him.win), `${paid.returned} back on a ${him.win} shot for a tenner`);
    const again = T.duelResult(race, 'duellist');
    assert(again === won, 'the result was recomputed on the second ask');
    let rewrote = false;
    try { T.duelResult(race, 'you'); } catch { rewrote = true; }
    assert(rewrote, 'a settled bout could be given to the other one afterwards');

    const other = D.duelRaceFor(4, 12);
    const lost = T.settleTickets([T.ticketFor(other, { on: 'duellist', kind: 'win', stake: 10, at: other.hour - 0.2 }).ticket],
      T.duelResult(other, 'you'));
    assert(lost.returned === 0, `${lost.returned} back on a losing ticket`);
    return `board ${board.runners.map((r) => `${r.name} ${r.win}`).join(' / ')}; 10 on ${him.name} pays ${paid.returned}, and nothing when you take it`;
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (a) THE ARENA, IN THE WORLD
   * ════════════════════════════════════════════════════════════════════════ */

  check('duel: at a bout hour the duellist waits in the well, the key takes the bout, the gate opens in the sand and shuts outside it', serial(async () => {
    const hour = D.boutHoursOn(3)[0];
    const { world, idle, st } = await stationOn(3, hour + 0.3);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { stationKey } = await import('../../src/game/Station.js');
      const well = D.wellOfArena();
      /* At the kerb, on the room's floor, looking at the sand. */
      stand(world, well.x, well.z + 11.5);
      world.player.facing = Math.PI;
      step(world, 4, idle);

      const S0 = D.duelState(world);
      assert(S0.on === hour, `the clock says ${st.hour} and the bout is at ${S0.on}`);
      assert(S0.bout && S0.bout.waiting, 'nobody came down into the well');
      const man = world.enemies.find((e) => e.stationDuel && e.stationRole?.includes('duellist'));
      assert(man, 'the duellist is not a body in the world');
      const rr = Math.hypot(man.position.x - well.x, man.position.z - well.z);
      assert(rr <= D.WELL.sand, `he is standing ${rr.toFixed(1)} m out, and the sand is ${D.WELL.sand} m across`);
      assert(man.position.y < well.y - 1.4, `he is at ${man.position.y.toFixed(2)} and the sand is at ${well.sandY.toFixed(2)} — he is standing on the deck over the well`);
      assert(man.team === (world.player.team ?? 0), 'a man waiting for a bout is already hunting you');

      /* THE GATE IS SHUT AT THE KERB. */
      assert(D.refuseBlade(world), 'the blade is allowed at the kerb before a bout');

      /* THE KEY. The real one: `Station.stationKey` is what `Player._readInput`
       * calls on `focus`, so this drives the branch order as well as the verb. */
      assert(D.atKerb(world), 'the player is not standing at the kerb');
      const took = stationKey(world);
      assert(took, 'the interact key at the kerb did nothing at all');
      const S1 = D.duelState(world);
      assert(S1.bout.live, 'the key did not start the bout');
      assert(D.inWell(world), 'the bout started and left you up on the deck');
      assert(!D.refuseBlade(world) && D.bladeAllowed(world), 'the blade is still refused inside the well during a bout');

      /* AND SHUT AGAIN ON THE WAY OUT. */
      stand(world, well.x, well.z + 12);
      assert(D.refuseBlade(world), 'the gate stayed open when the player stepped out of the well');
      world.player.saber.ignite();
      step(world, 0.2, idle);
      assert(!world.player.saber.lit, 'a blade lit outside the well was left burning');
      /* Back in, so the walk-out does not forfeit the bout under the next clause. */
      stand(world, well.x, well.z - 2.6, well.sandY + 0.1);
      step(world, 0.2, idle);
      return `${S1.bout.who} (${S1.bout.style}) in the well at ${hour}:00, ${rr.toFixed(1)} m from the middle at y ${man.position.y.toFixed(2)}; the key takes it; gate open in the sand, shut on the kerb`;
    } finally { world.dispose?.(); }
  }));

  check('duel: sixteen or more on the tiers, three touches, the purse, the fold, the roar and the arms', serial(async () => {
    const hour = D.boutHoursOn(3)[0];
    const { world, idle, life } = await stationOn(3, hour + 0.3);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { stationKey } = await import('../../src/game/Station.js');
      const { clearCredits, purse, pay } = await import('../../src/game/Credits.js');
      clearCredits();
      pay(200, 'a float for the window');
      const well = D.wellOfArena();
      stand(world, well.x, well.z + 11.5);
      world.player.facing = Math.PI;
      /* The pool trickles a body at a time (`StationLife.reseat`'s cap), so a
       * room fills over a walk rather than on a frame. */
      let crowd = 0;
      for (let t = 0; t < 90; t++) {
        step(world, 1, idle);
        crowd = D.crowdIn(world);
        if (crowd >= D.CROWD.min) break;
      }
      assert(crowd >= D.CROWD.min, `${crowd} in the room at a bout hour, against ${D.CROWD.min}`);
      /* ON THE TIERS: round the well, not scattered through the room's box. */
      const on = [...life.live.values()].filter((b) => b?.stationPlace === ARENA && b.__duelTier);
      assert(on.length >= D.CROWD.min, `${on.length} of ${crowd} were put on the benches`);
      let out = 0;
      for (const b of on) {
        const r = Math.hypot(b.position.x - well.x, b.position.z - well.z);
        if (r < 7 || r > 11) out++;
      }
      assert(out === 0, `${out} of the crowd are standing off the tiers (7–11 m from the middle)`);

      assert(stationKey(world), 'the kerb refused the bout');
      const B = () => D.duelState(world).bout;
      assert(B().live, 'the bout did not start');

      /* THREE TOUCHES, through the door a landed blade uses. */
      const man = world.enemies.find((e) => e.stationDuel);
      const before = D.duelRecord();
      let cheered = 0;
      for (let i = 0; i < 3; i++) {
        /* HIS ONE, first: a bout is not a walkover, and the check should see
         * both sides of the count move. */
        if (i === 1) world.player.damage(9, world.player.position, man, 'saber');
        man.damage(9, man.position, world.player, 'saber');
        step(world, 0.1, idle);
        const arms = (world._duel.cheer || []).length;
        cheered = Math.max(cheered, arms);
      }
      step(world, 0.2, idle);
      const S = D.duelState(world);
      assert(S.bout.over, `the bout is not over at ${S.bout.mine}–${S.bout.theirs}`);
      assert(S.bout.mine === 3, `${S.bout.mine} touches for three landed blows`);
      assert(S.bout.theirs === 1, `${S.bout.theirs} against, and he landed one`);
      assert(S.bout.purse === D.PURSE, `the marshal paid ${S.bout.purse}`);
      assert(world.player.hp > 50, `the bout left you on ${world.player.hp} hit points — a touch is a touch`);
      assert(cheered >= Math.floor(crowd * 0.25), `${cheered} arms went up on a touch out of ${crowd} in the room`);

      const rec = D.duelRecord();
      assert(rec.bouts === before.bouts + 1 && rec.won === before.won + 1, `the fold reads ${rec.won}–${rec.lost} in ${rec.bouts}`);
      assert(rec.touches >= 3, `${rec.touches} touches on the record`);
      assert(rec.last === S.bout.who, `the plaque's last name is ${rec.last}`);
      assert(!world.enemies.some((e) => e.stationDuel), 'the duellist is still standing in the sand after the bout');
      assert(!world.player.saber.lit, 'you walked out of the well with the blade still lit');

      /* AND THE TICKET. A bet struck on yourself before the bout, settled at
       * the window `Station.payAtTote` is — the tote's own money door. */
      const { stakeAtTote, payAtTote } = await import('../../src/game/Station.js');
      const race = D.duelRaceFor(3, hour);
      const board = T.boardFor(race);
      const mine = board.runners.find((r) => r.id === 'you');
      const had = purse();
      const bet = stakeAtTote(race, { on: 'you', kind: 'win', stake: 10, at: race.hour - 0.2 });
      assert(bet.ok, `the window refused: ${bet.why}`);
      const settled = payAtTote([bet.ticket], race._result);
      /* PAID AT THE PRINTED PRICE. `Station.stakeAtTote` strikes through
       * `Form.printedTicket`, which stamps the reading room's drifted odds on
       * a win ticket, and `settleTickets` pays at those when they are there —
       * so the number to check against is the ticket's own, not the board's. */
      const at = Number.isFinite(bet.ticket.form) ? bet.ticket.form : bet.ticket.price;
      assert(settled.returned === Math.round(10 * at), `${settled.returned} back at ${at}`);
      assert(purse() === had - 10 + settled.paid, `the purse is ${purse()} after staking 10 and being paid ${settled.paid}`);
      return `${crowd} in the room, ${on.length} on the tiers, ${cheered} arms up on a touch; 3–1 and ${S.bout.purse} credits; record ${rec.won}–${rec.lost}; 10 on yourself at ${mine.win} paid ${settled.returned}`;
    } finally { world.dispose?.(); }
  }));

  check('duel: losing costs the stake and sits you down for twenty seconds', serial(async () => {
    const hour = D.boutHoursOn(5)[1];
    const { world, idle } = await stationOn(5, hour + 0.2);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { stationKey } = await import('../../src/game/Station.js');
      const well = D.wellOfArena();
      stand(world, well.x, well.z + 11.5);
      world.player.facing = Math.PI;
      step(world, 4, idle);
      assert(stationKey(world), 'the kerb refused the bout');
      const man = world.enemies.find((e) => e.stationDuel);
      /* 0.3 s apart: `Player.damage` sets `invuln` for 0.18 s after a hit, so
       * three blows inside a fifth of a second are two touches and a refusal. */
      for (let i = 0; i < 3; i++) { world.player.damage(9, world.player.position, man, 'saber'); step(world, 0.3, idle); }
      const S = D.duelState(world);
      assert(S.bout.over && S.bout.theirs === 3, `the bout ended ${S.bout.mine}–${S.bout.theirs}`);
      assert(S.bout.purse === 0, `a beaten fighter was paid ${S.bout.purse}`);
      assert(S.sitOut >= D.SIT_OUT - 1, `sat down for ${S.sitOut} s`);
      assert(D.duelRecord().lost === 1, 'the loss is not on the record');
      /* The kerb answers, and what it says is "sit it out". */
      stand(world, well.x, well.z + 11.5);
      assert(stationKey(world), 'the kerb went quiet while you were benched');
      assert(D.duelState(world).bout.over, 'a benched fighter took another bout');
      step(world, 21, idle);
      assert(D.duelState(world).sitOut === 0, 'the bench never let go');
      return `beaten 0–3, no purse, benched ${D.SIT_OUT} s and the kerb refuses for all of it`;
    } finally { world.dispose?.(); }
  }));

  /* ════════════════════════════════════════════════════════════════════════
   *  (b) THE SITH
   * ════════════════════════════════════════════════════════════════════════ */

  check('duel: at 22:30 the acolyte is at a booth in #14 with a cup in his hand and a hilt on the table', serial(async () => {
    /* A night he is in — `sithFor` is dark one night in seven. */
    const { world, idle } = await stationOn(sithNight(D), 22.5);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { PLACE } = await import('../../src/game/StationPlan.js');
      const p = PLACE.get(CANTINA);
      stand(world, p.door[0], p.door[1]);
      step(world, 6, idle);
      const S = D.duelState(world).sith;
      assert(S && S.state === 'sit', `the booth is ${S ? S.state : 'empty'}`);
      const b = world.enemies.find((e) => e.stationDuel && e.stationRole === 'drinking alone');
      assert(b, 'no acolyte in the room');
      assert(b.stationName === S.name, `the plate says ${b.stationName} and the state says ${S.name}`);
      assert(b.seat && b.seat.blend >= 0.99, 'he is standing at the table, not sitting at it');
      const hips = b.rig.hipsBone.obj.position;
      assert(hips.y - b.position.y < 0.75, `his hips are ${(hips.y - b.position.y).toFixed(2)} m up — he is standing`);
      const cup = b.seat.cupObj;
      assert(cup, 'he is drinking alone without a drink');
      const hand = b.rig.tipPos('handR');
      assert(cup.position.distanceTo(hand) < 0.12, `the cup is ${cup.position.distanceTo(hand).toFixed(2)} m from his hand`);
      const hilt = world._duel.sith.hilt;
      assert(hilt && hilt.parent, 'there is no hilt on the table');
      const d = Math.hypot(hilt.position.x - b.position.x, hilt.position.z - b.position.z);
      assert(d < 1.4, `the hilt is ${d.toFixed(2)} m from him`);
      assert(hilt.position.y > b.position.y + 0.6, `the hilt is at ${(hilt.position.y - b.position.y).toFixed(2)} m — it is on the floor, not the table`);
      /* He is not attackable and does not hunt: a man drinking is a resident. */
      assert(b.team === (world.player.team ?? 0) && b.stationResident, 'the man at the booth is hostile before a word is said');
      return `${b.stationName} at a booth, hips ${(hips.y - b.position.y).toFixed(2)} m up, cup ${cup.position.distanceTo(hand).toFixed(2)} m from the hand, hilt ${d.toFixed(2)} m across the table`;
    } finally { world.dispose?.(); }
  }));

  check('duel: after midnight he follows you out — six to eight metres, silent, and he stops when you turn', serial(async () => {
    const { world, idle } = await stationOn(sithNight(D), 0.5);
    try {
      const { PLACE } = await import('../../src/game/StationPlan.js');
      const p = PLACE.get(CANTINA);
      stand(world, p.door[0], p.door[1]);
      for (let i = 0; i < 240; i++) world.update(1 / 60, idle);
      assert(D.duelState(world).sith?.state === 'sit', 'he never sat down at 00:30');

      /* OUT OF THE ROOM, and then along the ring toward the dark stretch. */
      const dark = D.darkStretch(40);
      assert(dark, 'the deck has no dark stretch');
      const b = world.enemies.find((e) => e.stationDuel);
      const P = world.player;
      const from = { x: P.position.x, z: P.position.z };
      const total = Math.hypot(dark.x - from.x, dark.z - from.z);
      const gaps = [];
      let ignited = 0, walked = 0;
      const T0 = 20 * 60;
      for (let i = 0; i < T0 && !ignited; i++) {
        /* A walk, not a teleport: 3 m/s along the line to the dark stretch. */
        const k = Math.min(1, (walked += 3 / 60) / total);
        const x = from.x + (dark.x - from.x) * k, z = from.z + (dark.z - from.z) * k;
        stand(world, x, z);
        look(world, dark.x, dark.z);
        world.update(1 / 60, idle);
        const S = D.duelState(world).sith;
        if (S.state === 'follow' && S.gap != null) gaps.push(S.gap);
        if (S.state === 'fight') ignited = i / 60;
      }
      assert(D.duelState(world).sith.state === 'follow' || ignited, 'he stayed in his chair');
      assert(gaps.length >= 15 * 60, `he only followed for ${(gaps.length / 60).toFixed(1)} s`);
      /* THE GAP HE SETTLES TO, not the one he starts from: he comes out of the
       * cantina behind you and has to close before there is a gap to hold. */
      const late = gaps.slice(Math.max(0, gaps.length - 300));
      const lo = Math.min(...late), hi = Math.max(...late);
      assert(lo >= D.FOLLOW.near - 0.6, `he closed to ${lo.toFixed(1)} m, and the gap is ${D.FOLLOW.near}–${D.FOLLOW.far}`);
      assert(hi <= D.FOLLOW.far + 1.5, `he sat ${hi.toFixed(1)} m back, and the gap is ${D.FOLLOW.near}–${D.FOLLOW.far}`);

      /* HE STOPS WHEN YOU TURN. Face him and hold still. */
      const S1 = D.duelState(world).sith;
      if (S1.state === 'follow') {
        look(world, b.position.x, b.position.z);
        const was = { x: b.position.x, z: b.position.z };
        for (let i = 0; i < 120; i++) world.update(1 / 60, idle);
        const moved = Math.hypot(b.position.x - was.x, b.position.z - was.z);
        assert(D.duelState(world).sith.seen, 'he does not know he is being looked at');
        assert(moved < 0.2, `he walked ${moved.toFixed(2)} m while you were looking straight at him`);
      }
      return `followed ${gaps.length ? (gaps.length / 60).toFixed(0) : 0} s at ${lo.toFixed(1)}–${hi.toFixed(1)} m and stood still when turned on${ignited ? `; lit at ${ignited.toFixed(0)} s` : ''}`;
    } finally { world.dispose?.(); }
  }));

  check('duel: he ignites on the ring, the guards are on the way inside forty seconds, and it ends with a line', serial(async () => {
    const { world, idle } = await stationOn(sithNight(D), 0.5);
    try {
      const { PLACE } = await import('../../src/game/StationPlan.js');
      const p = PLACE.get(CANTINA);
      stand(world, p.door[0], p.door[1]);
      for (let i = 0; i < 240; i++) world.update(1 / 60, idle);
      const dark = D.darkStretch(40);
      const P = world.player;
      const from = { x: P.position.x, z: P.position.z };
      const total = Math.hypot(dark.x - from.x, dark.z - from.z);
      let walked = 0, lit = -1;
      for (let i = 0; i < 60 * 60 && lit < 0; i++) {
        const k = Math.min(1, (walked += 3 / 60) / total);
        stand(world, from.x + (dark.x - from.x) * k, from.z + (dark.z - from.z) * k);
        look(world, dark.x, dark.z);
        world.update(1 / 60, idle);
        if (D.duelState(world).sith.state === 'fight') lit = i / 60;
      }
      assert(lit >= 0, 'he never ignited on the ring');
      const onRing = Math.hypot(P.position.x - dark.x, P.position.z - dark.z);
      assert(onRing < 16, `he lit up ${onRing.toFixed(1)} m from the dark stretch`);
      const him = world.enemies.find((e) => e.stationDuel);
      assert(him.team === 1 && !him.stationResident, 'he ignited and is still a resident on your own side');
      assert(D.bladeAllowed(world), 'the blade is refused during the fight he started');

      /* The guards, and the end. Nobody is touched: this is the timer. */
      let guardsAt = -1, ended = -1;
      for (let i = 0; i < 60 * 60; i++) {
        /* NOBODY SCORES, so what is being measured is the CLOCK and not the
         * fight: he is a real acolyte and would otherwise put two touches on a
         * player nobody is driving, and it would end at his second touch
         * rather than at the patrol. `invuln` is the field `Player.damage`
         * refuses on, so no blow lands at all — the touch accounting is the
         * previous check's clause and this one is "the guards come". */
        world.player.invuln = 5;
        world.update(1 / 60, idle);
        const S = D.duelState(world).sith;
        if (guardsAt < 0 && S.guards >= 2) guardsAt = i / 60;
        if (S.state === 'done') { ended = i / 60; break; }
      }
      assert(guardsAt >= 0, `no patrol was ever called to the ring (state ${JSON.stringify(D.duelState(world).sith)})`);
      assert(guardsAt <= D.GUARDS_BY, `the guards were sent ${guardsAt.toFixed(0)} s into the fight`);
      assert(ended >= 0 && ended <= D.GUARDS_BY + 1, `the fight ran ${ended.toFixed(0)} s`);
      const S = D.duelState(world).sith;
      assert(S.line && S.line.length > 8, 'he went without saying anything');
      assert(!world.enemies.some((e) => e.stationDuel), 'somebody is still standing on the ring with a blade');
      assert(!world.player.saber.lit, 'the fight ended with your blade still lit');
      assert(!D.bladeAllowed(world), 'the gate stayed open after the fight');
      return `lit at ${lit.toFixed(0)} s on the dark stretch, patrol on the way at ${guardsAt.toFixed(0)} s, over at ${ended.toFixed(0)} s — "${S.line}"`;
    } finally { world.dispose?.(); }
  }));

  check('duel: three talks on three days is what he answers to, and the win puts his hilt on your desk', serial(async () => {
    const day = sithNight(D, 3);
    const { world, idle, st } = await stationOn(day, 22.5);
    try {
      const { talkTo } = await import('../../src/game/Station.js');
      const { PLACE } = await import('../../src/game/StationPlan.js');
      const { regularOf } = await import('../../src/game/Regulars.js');
      const { setRegularsState, regularsState } = await import('../../src/game/StationSave.js');
      const p = PLACE.get(CANTINA);
      stand(world, p.door[0], p.door[1]);
      for (let i = 0; i < 300; i++) world.update(1 / 60, idle);
      const b = world.enemies.find((e) => e.stationDuel);
      assert(b, 'nobody at the booth');
      /* Three presses in one evening is three presses, not three days. */
      for (let i = 0; i < 3; i++) assert(talkTo(world, b), 'the talk did nothing');
      assert(D.duelState(world).sith.state === 'sit', 'three presses in one night got you a fight');
      const rec = regularOf(b);
      assert(rec && rec.n === 3, `the ledger counted ${rec ? rec.n : 0} talks`);
      /* Now make it three days: the ledger is the same one `Regulars` writes. */
      setRegularsState({ ...regularsState(), [`human:${b.stationName}`]: { n: 3, firstDay: (st.day | 0) - 2, lastDay: st.day | 0 } });
      assert(talkTo(world, b), 'the fourth talk did nothing');
      assert(D.duelState(world).sith.state === 'follow', 'he did not take up three days of talking');

      /* And the trophy: he yields to you, and the hilt is on the desk. */
      const S = world._duel.sith;
      S.state = 'fight'; S.t = 0; S.mine = D.SITH_TOUCHES; S.hp = S.body.hp; S.myHp = world.player.hp;
      world.update(1 / 60, idle);
      assert(D.duelState(world).sith.state === 'done', 'he did not yield at two touches');
      const cup = D.trophies();
      assert(cup.length === 1 && cup[0].name === b.stationName, `the desk holds ${cup.length} hilts`);
      /* `Home.dressHome`'s one line, driven without a cabin: the mesh is made
       * and put where the desk is. */
      const built = [];
      const fake = { desk: { at: { x: 1, y: 2, z: 3 } }, group: { add: (o) => built.push(o) }, built: [], mine: true };
      const n = D.dressTrophies(world, fake);
      assert(n === 1 && built.length === 1, `${n} hilts went onto the desk`);
      assert(Math.abs(built[0].position.y - 2.79) < 0.01, `the hilt is ${built[0].position.y} — not on the desk top`);
      return `three presses in one night is nothing; three days is a fight; his hilt (${cup[0].what}) is on the desk`;
    } finally { world.dispose?.(); }
  }));

  /* ════════════════════════════════════════════════════════════════════════
   *  (c) AND EVERYWHERE ELSE THE BLADE STAYS DOWN
   * ════════════════════════════════════════════════════════════════════════ */

  check('duel: the drum\'s peace — the ignite key is refused everywhere else, and a lit blade is put away', serial(async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { PLACE } = await import('../../src/game/StationPlan.js');
      const st = world._station;
      st.day = 3; st.hour = 13;
      const rooms = [9, CANTINA, ARENA, 18, 24];
      const said = [];
      for (const id of rooms) {
        const p = PLACE.get(id);
        stand(world, p.x, p.z);
        step(world, 0.2, idle);
        assert(D.refuseBlade(world), `#${id} ${p.name} allows a lit blade at 13:00`);
        assert(!D.bladeAllowed(world), `#${id} ${p.name} says the blade is allowed`);
        world.player.saber.ignite();
        assert(world.player.saber.lit, 'the saber refused to light for the test');
        step(world, 0.1, idle);
        assert(!world.player.saber.lit, `a blade lit in #${id} ${p.name} was left burning`);
        said.push(p.name);
      }
      /* And off the station the rule does not exist at all. */
      assert(!D.refuseBlade({}), 'the drum\'s peace reaches a world that is not the station');
      assert(D.BLADE_REFUSAL.length > 10, 'the refusal says nothing');
      return `refused and doused in ${said.length} rooms (${said.join(', ')}); no rule at all off the station`;
    } finally { world.dispose?.(); }
  }));

  /* ════════════════════════════════════════════════════════════════════════
   *  (d) DETERMINISM
   * ════════════════════════════════════════════════════════════════════════ */

  check('duel: nothing in the lane rolls a die', async () => {
    const files = ['src/game/StationDuel.js'];
    const out = [];
    for (const f of files) {
      const text = await readFile(new URL(`../../${f}`, import.meta.url), 'utf8');
      /* THE CODE, NOT THE PROSE. The file's own header says the words "no
       * Math.random" and a plain grep reads that as a die — so the comments
       * are struck out before the question is asked. */
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      const hits = code.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /Math\.random/.test(l));
      assert(!hits.length, `${f} rolls a die at line ${hits.map(([n]) => n).join(', ')}`);
      out.push(`${f}: ${text.split('\n').length} lines`);
    }
    /* AND THE SAME DAY IS THE SAME EVENING TWICE OVER. */
    D.clearDuelCards();
    const a = D.duelRaceFor(7, D.boutHoursOn(7)[0]);
    const pa = T.boardFor(a).runners.map((r) => `${r.name}:${r.win}`).join('|');
    D.clearDuelCards();
    const b = D.duelRaceFor(7, D.boutHoursOn(7)[0]);
    const pb = T.boardFor(b).runners.map((r) => `${r.name}:${r.win}`).join('|');
    assert(pa === pb, `two reads of day 7's board differ:\n  ${pa}\n  ${pb}`);
    const nights = [];
    for (let d = 0; d < 14; d++) nights.push(D.sithFor(d).in ? D.sithFor(d).name : '—');
    assert(nights.filter((n) => n !== '—').length >= 10, `he is only in ${nights.filter((n) => n !== '—').length} nights in fourteen`);
    return `${out.join('; ')}; day 7 prices ${pa}; fourteen nights ${nights.filter((n) => n !== '—').length} of them his`;
  });
}
