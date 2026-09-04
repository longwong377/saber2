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
}
