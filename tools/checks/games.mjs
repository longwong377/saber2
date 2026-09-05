/**
 * THE THREE GAMES — V16 Lane D1.
 *
 * *"these should be actual games within games really put time in."*
 *
 * "Actual game" is one property and it is the only one art cannot fake: A GOOD
 * PLAYER MUST BEAT A BAD ONE, over time, by more than noise. Every check here
 * exists to hold that, and the two that make it worth holding — no dominant
 * line, and it ends.
 */

export async function run({ check, assert, near }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);

  check('games: sabacc — knowing the rules beats not knowing them', async () => {
    /**
     * Driven over three thousand hands, seeded, against a player that moves at
     * random. If the bot does not win the game is a slot machine with cards on
     * it, and no amount of table dressing changes that.
     */
    const G = await import('../../src/game/Games.js');
    G.seedGames(20260904);
    const coin = (v) => { const r = ['hold', 'draw', 'fold'][Math.floor(Math.random() * 3)]; return r; };
    /* THE RANDOM PLAYER IS SEEDED TOO, or the measurement is a different one
     * every time it runs — `determinism.mjs` refuses that and is right to. */
    let s = 12345;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const random = () => ['hold', 'draw', 'fold'][Math.floor(rnd() * 3)];

    let botWins = 0, rndWins = 0, pushes = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      /* Seats alternate, so a seat advantage cannot be read as skill. */
      const players = i % 2 ? [random, G.sabaccBot] : [G.sabaccBot, random];
      const botSeat = i % 2 ? 1 : 0;
      const r = G.playSabacc(players, 900000 + i);
      if (r.winner < 0) pushes++;
      else if (r.winner === botSeat) botWins++;
      else rndWins++;
    }
    const played = botWins + rndWins;
    const rate = botWins / played;
    assert(rate > 0.58,
      `the bot won ${(rate * 100).toFixed(1)}% of ${played} decided hands — a player who knows the `
      + 'rules has to beat one who does not, or this is a slot machine with cards on it');
    assert(rate < 0.95, `the bot won ${(rate * 100).toFixed(1)}% — a game a bad player never wins is not a game`);
    assert(pushes < N * 0.5, `${pushes} of ${N} hands were pushes`);

    /* THE SHIFT IS REAL AND IT IS THE GAME. A made hand must be able to become
     * an unmade one, or the cards are ordinary cards. */
    let shifts = 0, hands = 0;
    for (let i = 0; i < 300; i++) {
      const r = G.playSabacc([G.sabaccBot, G.sabaccBot], 500 + i);
      shifts += r.events.filter((e) => e.t === 'shift').length;
      hands++;
    }
    assert(shifts / hands > 0.4, `only ${(shifts / hands).toFixed(2)} shifts a hand — the shift is the game`);
    return `bot ${(rate * 100).toFixed(1)}% over ${played} decided hands, ${(shifts / hands).toFixed(2)} shifts a hand`;
  });

  check('games: dejarik — it ends, from anywhere, and thinking wins', async () => {
    /**
     * Perfect information and a shrinking board, which is the opposite of
     * sabacc on purpose: a casino with two card games has one card game.
     *
     * TERMINATION IS NOT OBVIOUS here — a ring that loses squares while pieces
     * move round it could deadlock — so it is measured from a thousand starts
     * rather than argued.
     */
    const G = await import('../../src/game/Games.js');
    let longest = 0, unfinished = 0;
    for (let i = 0; i < 400; i++) {
      const r = G.playDejarik([(b) => G.dejarikBot(b, 7000 + i), (b) => G.dejarikBot(b, 8000 + i)], 7000 + i);
      longest = Math.max(longest, r.moves.length);
      if (r.winner === null) unfinished++;
    }
    assert(!unfinished, `${unfinished} of 400 games never ended`);
    assert(longest <= G.DEJARIK.MAX_TURNS * 2, `a game ran ${longest} moves`);

    /* AND THINKING WINS. The bot looks one ply ahead and counts; the other
     * side moves legally at random. */
    let s = 999;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const randomBot = (b) => { const m = G.dejarikMoves(b); return m.length ? m[Math.floor(rnd() * m.length)] : null; };
    let botWins = 0, decided = 0;
    for (let i = 0; i < 400; i++) {
      const bots = i % 2 ? [randomBot, (b) => G.dejarikBot(b, i)] : [(b) => G.dejarikBot(b, i), randomBot];
      const seat = i % 2 ? 1 : 0;
      const r = G.playDejarik(bots, i);
      if (r.winner < 0) continue;
      decided++;
      if (r.winner === seat) botWins++;
    }
    const rate = botWins / decided;
    assert(rate > 0.60,
      `the thinking bot won ${(rate * 100).toFixed(1)}% of ${decided} decided games — one ply of `
      + 'thought has to beat none, or the board is a coin');

    /* NO DOMINANT LINE. If one move is always right the game is a button. */
    const b = G.dejarikBoard();
    const opening = G.dejarikMoves(b);
    assert(opening.length >= 12, `only ${opening.length} opening moves — that is not a board, it is a corridor`);
    return `400 games all ended (longest ${longest} moves); one ply beat none ${(rate * 100).toFixed(1)}% `
      + `of ${decided}; ${opening.length} opening moves`;
  });

  check('games: the Drum runs on the station clock, and the house edge is real', async () => {
    /**
     * THE WHOLE REASON THIS GAME EXISTS. It is spun against the station clock —
     * the same clock the medbay heals on and the shops reroll on — so it runs
     * once an hour whether anybody is there, everyone in the room watches one
     * spin, and A PLAYER CANNOT RE-TAKE A ROLL BY WALKING OUT AND BACK IN.
     *
     * A casino game a player can re-roll is a save-scum. One that runs on a
     * clock the player does not own is a thing that happens to them.
     */
    const G = await import('../../src/game/Games.js');
    /* THE SAME HOUR IS THE SAME SPIN, always. */
    for (let h = 0; h < 24; h++) {
      assert(G.drumAt(h, 3) === G.drumAt(h, 3), `hour ${h} spun twice and disagreed`);
    }
    /* AND DIFFERENT HOURS ARE DIFFERENT SPINS. */
    const seen = new Set();
    for (let d = 0; d < 30; d++) for (let h = 0; h < 24; h++) seen.add(G.drumAt(h, d));
    assert(seen.size >= G.DRUM.SEGMENTS.length - 1,
      `only ${seen.size} of ${G.DRUM.SEGMENTS.length} segments ever came up in a month`);

    /* THE EDGE IS THE HOUSE'S, AND IT IS SMALL ENOUGH TO PLAY. Measured over
     * twelve thousand spins per bet rather than declared: a payout table is
     * easy to get wrong by a factor of two and impossible to eyeball. */
    const edges = {};
    for (const [kind, on] of [['deck', 40], ['band', 1], ['spine', 0]]) {
      const e = G.drumEdge(kind, on);
      edges[kind] = e;
      assert(e > 0.005,
        `the ${kind} bet has an edge of ${(e * 100).toFixed(2)}% for the HOUSE — at or below zero the `
        + 'player prints money and the room closes');
      assert(e < 0.16,
        `the ${kind} bet takes ${(e * 100).toFixed(1)}% — past about a sixth nobody plays twice`);
    }
    /* THE HOUSE SEGMENT PAYS NOBODY, which is where the edge comes from and
     * is the one rule a player has to be told. */
    const houseAt = G.DRUM.SEGMENTS.indexOf(null);
    assert(houseAt >= 0, 'the wheel has no house segment, so the edge is hidden in the payouts');
    /* WITH A LEGAL `on` FOR EACH KIND. This clause used to ask all three with
     * `on: 40`, which is a deck number and is not a band and is not a side of
     * the spine — so two of the three were malformed bets that could not have
     * been paid on ANY segment, and the clause was green without ever asking
     * the question it is named after. */
    for (const [kind, on] of [['deck', 40], ['band', 1], ['spine', 0]]) {
      assert(G.drumLegal({ kind, on, stake: 10 }), `the check's own ${kind} bet is malformed`);
      assert(G.drumPays({ on, kind, stake: 10 }, houseAt) === 0,
        `a ${kind} bet was paid on the house's own segment`);
    }
    return `${seen.size} segments over a month; edges deck ${(edges.deck * 100).toFixed(1)}%, `
      + `band ${(edges.band * 100).toFixed(1)}%, spine ${(edges.spine * 100).toFixed(1)}%`;
  });

  check('games: the Drum WINDOW pays what the wheel says, over 264,000 tickets', async () => {
    /**
     * ══ THE CHECK THAT WAS GREEN BECAUSE OF THE BUG ══════════════════════
     *
     * The clause above measures `drumEdge`, which builds its own well-formed
     * bet — `{ on: 40, kind, stake }` — and asks the WHEEL what it pays. The
     * wheel was always right. THE WINDOW WAS NOT, and no check had ever asked
     * it: `showCasino`'s stake handler built the ticket by hand and wrote the
     * HOUR it was betting on into `on`, the field that carries WHAT YOU
     * BACKED. `drumPays` then compared an hour against a deck number.
     *
     * Measured on the shipped build, all 24 hours by all 11 rows on the board:
     * 19 of 264 tickets still carried a bet the wheel could recognise, 2 of
     * them paid at all, and ONE OF THOSE TWO PAID THE WRONG BET — at 23:00
     * "the odd spine" collected 49 on a turn it had lost. Every bet kind
     * measured a house edge of 92–100%. A room that takes money and cannot
     * pay it back, behind a green suite.
     *
     * So this check drives the TICKET, not the bet: `drumTicket` is the shape
     * the panel now sends, `drumDue` is when the panel settles it and
     * `drumStop` is the reading it settles against — and the clause at the
     * bottom holds `src/main.js` to calling those three, because a check that
     * measures a path the panel does not walk is what was here before.
     */
    const G = await import('../../src/game/Games.js');
    const C = await import('../../src/game/Casino.js');
    const rows = C.drumBets();

    /* ── 1. THE SWEEP. Every hour, every row: does the bet survive the
     *      window, and is the bet that gets paid the bet that won? */
    let legal = 0, paidCount = 0, wrong = 0, unpaid = 0, tickets = 0;
    const notes = [];
    for (let h = 0; h < 24; h++) {
      for (const row of rows) {
        tickets++;
        /* Struck mid-hour, which is where a player standing at the window is. */
        const t = G.drumTicket({ ...row, stake: 25 }, h + 0.4, 0);
        if (G.drumLegal(t)) legal++;
        const at = G.drumStop(t);
        const got = G.drumPays(t, at);
        /* WHAT THE WHEEL SAYS, read off the untouched row against the same
         * stop. The ticket must agree with it in both directions. */
        const truth = G.drumPays({ ...row, stake: 25 }, at);
        if (got > 0) paidCount++;
        if (got !== truth) {
          (got > 0 ? (wrong++, notes) : (unpaid++, notes)).push(
            `hour ${h} "${row.label}": the window paid ${got}, the wheel says ${truth}`);
        }
      }
    }
    assert(legal === tickets,
      `${tickets - legal} of ${tickets} tickets carry an \`on\` the wheel cannot read — the field that `
      + 'says WHAT YOU BACKED has been overwritten with something else, most likely the hour');
    assert(wrong === 0 && unpaid === 0,
      `${wrong} tickets paid a bet that lost and ${unpaid} winners went unpaid, of ${tickets}:\n      `
      + notes.slice(0, 3).join('\n      '));
    assert(paidCount > tickets * 0.15 && paidCount < tickets * 0.4,
      `${paidCount} of ${tickets} tickets paid — the board's rows win 15% to 45% each, so a sweep `
      + 'landing outside a fifth to two-fifths means the window is not settling against this wheel');

    /* ── 2. THE TURN IT RIDES IS NOT THE TURN IT WAS SOLD ON, and it cannot
     *      settle before the clock gets there. The shipped panel compared
     *      `floor(hour) + 1` against `floor(hour)` and so resolved the bet on
     *      the very click that struck it — against a stop `drumAt` had already
     *      published, which is the one thing this game is written not to be. */
    const t = G.drumTicket({ ...rows[0], stake: 25 }, 21.66, 0);
    assert(!G.drumDue(t, 21.66, 0), 'a ticket settled on the click that struck it');
    assert(!G.drumDue(t, 21.99, 0), 'a ticket struck at 21:40 settled before 22:00');
    assert(G.drumDue(t, 22.0, 0) && G.drumDue(t, 23.5, 0), 'the 22:00 turn came and the ticket did not settle');
    assert(G.drumClockOf(t.turn).hour === 22, `a bet struck at 21:40 rides the ${G.drumClockOf(t.turn).hour}:00 turn`);
    /* AND MIDNIGHT, which is why the turn is counted from the start of time
     * rather than wrapped into a clock face: 23 + 1 must be tomorrow's 00:00
     * and not a number the comparison reads as already gone. */
    const late = G.drumTicket({ ...rows[0], stake: 25 }, 23.7, 4);
    assert(!G.drumDue(late, 23.9, 4), 'a ticket struck at 23:42 settled the same night');
    assert(G.drumDue(late, 0.1, 5) && G.drumClockOf(late.turn).day === 5 && G.drumClockOf(late.turn).hour === 0,
      'a ticket struck at 23:42 does not ride tomorrow morning');

    /* ── 3. THE EDGE ALONG THAT PATH, MONTE-CARLO'D. 24,000 tickets a row
     *      over eleven rows is 264,000, and the band is stated: the payouts
     *      are the fair price times about 0.885, so every row must land near
     *      an eighth and none of them may reach a fifth. */
    let worst = null, best = null, staked = 0, back = 0;
    for (const row of rows) {
      const e = G.drumTicketEdge(row, 24000);
      if (worst === null || e > worst.e) worst = { e, label: row.label };
      if (best === null || e < best.e) best = { e, label: row.label };
      staked += 1; back += 1 - e;
      assert(e > 0.04,
        `"${row.label}" returns ${((1 - e) * 100).toFixed(1)}% through the window — an edge of `
        + `${(e * 100).toFixed(2)}% is not the ${((1 - 0.885) * 100).toFixed(0)}% the payout table was priced at, `
        + 'and at or below zero the player prints money');
      assert(e < 0.20,
        `"${row.label}" takes ${(e * 100).toFixed(1)}% of every credit through the window — `
        + 'past a fifth the room is a coin dropped down a grating');
    }
    /* AND PER KIND, over 240,000 tickets each, which is the number that
     * settles whether a two-point gap is the wheel or the sample. */
    const byKind = {};
    for (const [kind, on] of [['deck', 40], ['band', 1], ['spine', 0]]) {
      const e = G.drumTicketEdge({ kind, on }, 240000);
      byKind[kind] = e;
      assert(e > 0.04 && e < 0.20,
        `the ${kind} bet's window edge is ${(e * 100).toFixed(2)}% over 240,000 tickets`);
      /* AND THE WINDOW MUST AGREE WITH THE WHEEL. `drumEdge` measures the
       * wheel and `drumTicketEdge` the room; they were 90 points apart. */
      const wheel = G.drumEdge(kind, on, 24000);
      assert(Math.abs(e - wheel) < 0.03,
        `the ${kind} bet: the wheel keeps ${(wheel * 100).toFixed(2)}% and the window keeps `
        + `${(e * 100).toFixed(2)}% — the room is not paying what the wheel says`);
    }

    /* ── 4. AND THE PANEL WALKS THIS PATH. `src/main.js` cannot be imported
     *      under Node, so it is read — the same instrument `tote.mjs` uses on
     *      its bell. A measurement of functions the room does not call is
     *      exactly the check this one replaces. */
    const { readFile } = await import('node:fs/promises');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    assert(/from '\.\/game\/Games\.js'/.test(main), 'main.js does not import the rules the room plays by');
    assert(/casino\.ticket = drumTicket\(/.test(main),
      'the Wheelhouse panel still builds the Drum\'s ticket by hand — that is where the bet was destroyed');
    assert(!/on: \(Math\.floor\(hour\)/.test(main),
      'the panel writes the hour into `on`, which is the field that says WHAT YOU BACKED');
    assert(/drumDue\(casino\.ticket/.test(main) && /drumStop\(casino\.ticket\)/.test(main),
      'the panel settles the Drum against something other than the turn the ticket rides');
    /* AND THE WHEEL TURNS WHILE THE ROOM IS OPEN. `Screens.take` pauses the
     * world, so a panel that does not wind `tickStationClock` itself stands on
     * a stopped clock — and a ticket riding the next turn can never be
     * reached. The tote's pane had this and the casino's did not. */
    const bell = (main.match(/function casinoBeat\(\)[\s\S]*?\n}/) || [''])[0];
    assert(/tickStationClock\(/.test(bell),
      'the Wheelhouse panel does not wind the station clock — with the world paused behind the card '
      + 'the hour never moves, so a bet on the next turn is a bet on an hour that never comes');

    return `${tickets} tickets swept, all legal, ${paidCount} paid and every one of them the winning bet; `
      + `window edge ${(best.e * 100).toFixed(1)}% (${best.label}) to ${(worst.e * 100).toFixed(1)}% (${worst.label}), `
      + `deck ${(byKind.deck * 100).toFixed(2)}% band ${(byKind.band * 100).toFixed(2)}% `
      + `spine ${(byKind.spine * 100).toFixed(2)}% over 240,000 each`;
  });

  check('games: they are pure, and a table is not a wallet', async () => {
    /**
     * The engine plays; who staked what is `Credits.js`'s problem and whose
     * face is across the table is `StationCast`'s. That separation is what
     * lets this suite play ten thousand hands in a second, and it is also what
     * keeps the six-word currency scan over the economy short enough to read.
     */
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(new URL('../../src/game/Games.js', import.meta.url), 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const imports = [...raw.matchAll(/^\s*import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    assert(imports.length === 1 && /MathUtil/.test(imports[0]),
      `Games.js imports ${imports.join(', ')} — it is a rule engine and a rule engine reaches nothing`);
    for (const bad of ['THREE', 'document', 'World', 'localStorage', 'Credits', 'purse', 'spend']) {
      assert(!new RegExp(`\\b${bad}\\b`).test(code), `Games.js names ${bad}`);
    }
    /* AND NOTHING TOUCHES `Math.random`, which `determinism.mjs` refuses in
     * src/ and which would make every measurement above a different one each
     * time it ran. */
    assert(!/Math\.random/.test(code),
      'Games.js calls Math.random — a table nobody can seed is a table nobody can measure');
    return `one import (${imports[0]}), no world, no wallet, no Math.random`;
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('games: the three games are IN THE BUILD, and not only in this file', async () => {
    /**
     * ══ THE DEFECT THIS CHECK IS NAMED AFTER ═════════════════════════════
     *
     * Every check above was green for the whole life of `Games.js` while the
     * file was IN NO SHIPPED BUILD. The only occurrence of the string
     * "Games.js" anywhere under `src/` was a sentence inside a comment in
     * `Bars.js`; `tools/pack.mjs` walks the module graph from
     * `index.play.html`'s entry, so the packed manifest held 96 `src/game`
     * modules and this was not one of them. Twenty-one kilobytes of sabacc,
     * holochess and a house wheel that no player could reach, behind four
     * green checks — because a suite that reaches a module with `import()` is
     * making a statement about the file system and not about the game.
     *
     * So this asks the shipping question, on the same walk `pack.mjs` does.
     * It is the ONE check in this file that would have caught it, and if it
     * ever goes red the answer is never to delete it.
     */
    const { assertShipped, shippedGraph } = await import('./_shipped.mjs');
    const by = await assertShipped(assert, 'src/game/Games.js',
      'three finished games nobody can play is the worst defect this tree has had');

    /* AND THE IMPORTER IS A ROOM, not a stray re-export. `#60 The Wheelhouse`
     * is the door: `StationKit.wheelhall` draws one spoke per segment off
     * `DRUM.SEGMENTS`, and `Casino.js` deals the hands the key raises. An
     * importer that named the file and used nothing from it would satisfy the
     * graph and still leave the games unreachable. */
    const { readFile } = await import('node:fs/promises');
    const used = [];
    for (const f of by) {
      const src = await readFile(new URL(`../../${f}`, import.meta.url), 'utf8');
      const m = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/Games\.js'/);
      if (m) used.push(...m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean));
    }
    assert(used.length >= 4,
      `Games.js is imported by ${by.join(', ')} but only ${used.length} names are taken from it — `
      + 'an import that uses nothing is an orphan with a line of paperwork');

    /* AND THE ROOM IT IS PLAYED IN EXISTS. §3.2's rule is that a place not in
     * the gazetteer is not built, and #60 is where §D1 puts the tables. */
    const { PLACE } = await import('../../src/game/StationPlan.js');
    const { SHAPES } = await import('../../src/game/StationKit.js');
    const room = PLACE.get(60);
    assert(!!room, '#60 The Wheelhouse is not in the gazetteer — the games have no room');
    assert(typeof SHAPES[room.shape] === 'function', `#60 declares shape '${room.shape}', which has no builder`);

    const { files } = await shippedGraph();
    return `Games.js ships, imported by ${by.join(' and ')}, ${used.length} names used; `
      + `#60 ${room.name} at ${room.at}° on deck ${room.deck}; ${files.size} modules in the build`;
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('games: the table has a named resident across it, not a bot', async () => {
    /**
     * *"in certain games you play against actual npcs like it could be anyone
     * on the ship on any day."* `Casino.js` draws the opponent out of
     * `StationLife.occupant`, which is the same roster that seats real bodies
     * in the room — so the face across the table is somebody you can also
     * walk up to, with a name and a species out of the fifteen.
     */
    const C = await import('../../src/game/Casino.js');
    const { SPECIES_KEYS } = await import('../../src/game/StationCast.js');

    const seen = new Set(), species = new Set();
    for (let day = 0; day < 30; day++) {
      for (let seat = 1; seat <= 3; seat++) {
        const who = C.opponentAt(C.WHEELHOUSE, day, seat);
        assert(who && who.name && who.name.length > 1, `no opponent at seat ${seat} on day ${day}`);
        assert(SPECIES_KEYS.includes(who.species), `${who.name} is a ${who.species}, which is not a species`);
        seen.add(who.name); species.add(who.species);
      }
    }
    /**
     * ══ AND THE PERSON IN THE SEAT IS THE PERSON IN THE ROOM, ON EVERY DAY ═
     *
     * The paragraph above this check is the claim — *"the face across the
     * table is somebody you can also walk up to"* — and it was FALSE on every
     * day but 0. `opponentAt` chose the slot on `(place, day, seat)` and then
     * read the body out of `occupant(place, slot)` with **no day**, which
     * `occupant` defaults to 0. Its neighbour `Pits.handlersOn` had already
     * been repaired to pass `{ day }`; the same fix landed in one file and not
     * the other. Measured on the shipped build: day 1 seated *Mateo Silva* at
     * sabacc while the body standing in that slot was *Nadia Cole*, day 2
     * *Jeffrey Chowdhury* against *Susan Franklin*.
     *
     * It did not bite only because `StationSave.stationDay` was structurally
     * stuck at 0 for every player, so day 0 was the only day the game ever
     * had. This clause is what makes that impossible to reintroduce: it asks
     * the ROSTER who is in the slot the seat chose, with the same day, and
     * requires the two to be the same person by name, species and seed. It
     * fails on every day but 0 without the `{ day }` argument.
     *
     * The pool hands `occupant` an hour, a headcount and the player's company
     * as well; none of them is passed here because all three are read only by
     * `Bars.barman`, which answers null for every room that is not one of the
     * three bars, and #60 is not one. The clause below proves that by asking
     * with them and without them and requiring the same answer.
     */
    const L = await import('../../src/game/StationLife.js');
    const { PLACE } = await import('../../src/game/StationPlan.js');
    const hall = PLACE.get(C.WHEELHOUSE);
    const strangers = [];
    for (let day = 0; day < 30; day++) {
      for (let seat = 1; seat <= 3; seat++) {
        const w = C.opponentAt(C.WHEELHOUSE, day, seat);
        const body = L.occupant(hall, w.slot, { day });
        if (body.name !== w.name || body.species !== w.species || body.seed !== w.seed) {
          strangers.push(`day ${day} seat ${seat}: the table says ${w.name} (${w.species}) and `
            + `slot ${w.slot} of the room holds ${body.name} (${body.species})`);
        }
        /* The pool's full `opts` on the same slot must not move the answer in
         * this room, or the body you walk up to differs from the one the seat
         * named for a reason nothing in the panel could ever show. */
        const asPool = L.occupant(hall, w.slot,
          { day, hour: hall.peak, heads: L.headcount(hall, hall.peak), company: null });
        if (asPool.name !== body.name) {
          strangers.push(`day ${day} seat ${seat}: the pool seats ${asPool.name} in slot ${w.slot} `
            + `and the table reads ${body.name}`);
        }
      }
    }
    assert(strangers.length === 0,
      `${strangers.length} of 90 seatings put somebody at the table who is not in the room:\n      `
      + strangers.slice(0, 4).join('\n      '));

    /* SEEDED ON (place, day, seat), so the three seats differ TODAY. Now that
     * `occupant` rerolls by the day as well, both halves turn over. A table of
     * one person three times is not a table. */
    const today = [1, 2, 3].map((s) => C.opponentAt(C.WHEELHOUSE, 0, s).slot);
    assert(new Set(today).size >= 2, `all three seats drew slot ${today[0]} — the seat seed is not doing anything`);
    assert(seen.size >= 3, `only ${seen.size} distinct people across 90 seatings`);

    /* AND THEIR PLAY COMES FROM THE SPECIES AND THE TEMPER (§D1), which means
     * the dials genuinely differ across the roster rather than being a
     * flavour string on one bot. */
    let lo = Infinity, hi = -Infinity;
    for (let day = 0; day < 40; day++) {
      for (let seat = 1; seat <= 3; seat++) {
        const w = C.opponentAt(C.WHEELHOUSE, day, seat);
        if (w.push < lo) lo = w.push;
        if (w.push > hi) hi = w.push;
      }
    }
    assert(hi - lo > 1.5, `every opponent plays at push ${lo.toFixed(1)}..${hi.toFixed(1)} — that is one bot in hats`);

    /* AND A HAND IS A REPLAY: the same seed and the same verbs are the same
     * cards, which is what lets the panel hold `{seed, acts}` and nothing. */
    const a = C.sabaccTable(60, 7, 2, ['draw', 'hold', 'hold']);
    const b = C.sabaccTable(60, 7, 2, ['draw', 'hold', 'hold']);
    assert(JSON.stringify(a.hand) === JSON.stringify(b.hand) && a.result.winner === b.result.winner,
      'the same hand played the same way came out differently');
    assert(a.done && a.result, 'three verbs did not finish a three-round hand');
    const half = C.sabaccTable(60, 7, 2, ['draw']);
    assert(!half.done && half.result === null && half.can.length === 3,
      'a hand with one verb in it is showing a showdown it has not played to');
    return `${seen.size} people, ${species.size} species over 90 seatings, every one of them the body `
      + `standing in that slot; push ${lo.toFixed(1)}..${hi.toFixed(1)}`;
  });
}
