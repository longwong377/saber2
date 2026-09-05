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
    for (const kind of ['deck', 'band', 'spine']) {
      assert(G.drumPays({ on: 40, kind, stake: 10 }, houseAt) === 0,
        `a ${kind} bet was paid on the house's own segment`);
    }
    return `${seen.size} segments over a month; edges deck ${(edges.deck * 100).toFixed(1)}%, `
      + `band ${(edges.band * 100).toFixed(1)}%, spine ${(edges.spine * 100).toFixed(1)}%`;
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
