/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THREE GAMES — V16 Lane D1, and they are games rather than animations
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"you should be able to play some of the casino games these should be actual
 * games within games really put time in and make sure these alien casino games
 * are innovative and can sink time into them you know, should be new stuff but
 * still stuff you would find in an alien casino, you can bet your real money …
 * in certain games you play against actual npcs like it could be anyone on the
 * ship on any day."*
 *
 * ── WHAT MAKES A GAME A GAME, AND IT IS ONE PROPERTY ──────────────────────
 *
 * A good player must beat a bad one, over time, by more than noise. That is
 * the whole bar and it is the only one that cannot be faked with art. Every
 * game here is driven against two opponents in `tools/checks/games.mjs` — one
 * that plays the rules and one that moves at random — and the first must win.
 * If it does not, the thing is a slot machine with a theme.
 *
 * Two more, because they are what "sink time into" actually needs:
 *
 *   NO DOMINANT LINE. If one move is always right the game is a button, and a
 *     button dressed as a card table is worse than no card table.
 *   IT ENDS. Every game terminates from every legal position, which is not
 *     obvious in a game with a shrinking board and a shifting deck.
 *
 * ── AND THEY ARE PURE ─────────────────────────────────────────────────────
 *
 * No THREE, no world, no DOM, no store, no wallet. A hand is a value in and a
 * result out; who staked what is `Credits.js`'s problem and whose face is
 * across the table is `StationCast`'s. That is what lets a check play ten
 * thousand hands in a second.
 */

import { makeRng, moduleSeed } from '../engine/MathUtil.js';

/** The house's own stream, for a table nobody named a seed for. */
export const gamesRng = makeRng(moduleSeed(0xCA51));
export function seedGames(n) { gamesRng.seed(n); return gamesRng; }
const streamFor = (seed) => (seed == null ? gamesRng : makeRng((seed >>> 0) || 1));

/* ══════════════════════════════════════════════════════════════════════════
 *  1. SABACC
 * ══════════════════════════════════════════════════════════════════════════
 *
 * It is the one the player will expect and it earns its place: the cards SHIFT
 * — at the end of each round every card in every hand may change value — so a
 * made hand is never safe and folding on a good one is sometimes right. That
 * is genuinely unlike any terrestrial card game and it is why it is here
 * rather than poker with a coat of paint.
 *
 *   THE TARGET is 23, or −23. Nearer wins; over is a bomb-out and you lose.
 *   THE DECK is 76: four suits of 1..15 in both signs, plus eight face cards
 *     worth −11 to −17 which is what makes a negative hand playable.
 *   THE SHIFT happens after each betting round: every card has a chance to be
 *     redrawn. A player who knows the shift chance plays a different game to
 *     one who does not, and that difference is the skill.
 */
/**
 * ── AND THE LAST THREE FIELDS ARE THE MONEY, WHICH IS WHY THEY ARE HERE ───
 *
 * *"you can bet your real money."* A sabacc table with no stake is a card
 * animation: the panel printed the purse over three tables and let you wager
 * at exactly one, and a hand you cannot lose anything on has no decision in
 * it — driven all-hold over three hundred days it won 15.3% against a fair
 * share of 25% and that cost nothing and paid nothing.
 *
 * So the shape is a POT, because sabacc is a pot game against three named
 * residents and not a wheel with a payout table:
 *
 *   SEATS  four, which is you and the three §D1 asks for.
 *   ANTE   what each seat puts in the middle before the deal. Everyone antes
 *          the same, which is what makes the pot a number and not a ledger.
 *   RAKE   the house's cut of a decided middle, and it is the ONLY edge in
 *          this game — there is no house seat, so without it four players
 *          would be passing one pot round a table for nothing.
 *
 * The rake is priced against measurement rather than taste. `sabaccEdge` drives
 * four thousand hands with a player who knows the rules at seat 0 and three who
 * do at the rest, and again with a player who does not, and the two numbers are
 * the whole justification for the 0.10:
 *
 *     knows the rules   the house keeps  2.6%   (97.4 back per 100 staked)
 *     stands on every hand             36.5%
 *     draws on every hand              38.8%
 *
 * ── AND THE HOUSE KEEPS LESS THAN IT RAKES, BECAUSE SEAT 0 IS THE BEST SEAT
 *
 * 2.6% and not 10% because the seats are not equal and the player always has
 * the first one. `playSabacc` asks the seats in order and they draw off one
 * deck, so seat 0 sees the earliest cards: four identical bots over 20,000
 * hands take 27.2 / 25.6 / 24.5 / 22.5 per cent. That is a real 2.2-point
 * advantage to the player over a fair share, and the rake is set knowing it —
 * ten per cent of the middle less a two-point seat is a house that keeps about
 * two and a half, which is a card room rather than a grating.
 *
 * WHAT IS NOT HERE IS A BALANCE. This prices a pot; `Credits.js` is still the
 * only file that holds one, and the two lines that move it are in the panel
 * beside the pit's, exactly as this file's header promises.
 */
export const SABACC = { TARGET: 23, HAND: 2, ROUNDS: 3, SHIFT: 0.22, SEATS: 4, ANTE: 25, RAKE: 0.10 };

function sabaccDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let v = 1; v <= 15; v++) { d.push(v); d.push(-v); }
  for (const f of [-11, -12, -13, -14, -15, -16, -17, -11]) d.push(f);
  return d;
}

/** The value of a hand, and whether it bombed out. */
export function sabaccScore(hand) {
  const sum = hand.reduce((a, c) => a + c, 0);
  const off = Math.abs(Math.abs(sum) - SABACC.TARGET);
  return { sum, off, bomb: Math.abs(sum) > SABACC.TARGET, pure: Math.abs(sum) === SABACC.TARGET };
}

/**
 * Play one hand out. `players` are functions `(view) => 'hold' | 'draw' | 'fold'`.
 *
 * The view is what a player may see: their own hand, how many cards each
 * opponent holds, the round, and the shift chance. NOT the deck and NOT
 * anybody else's cards — a bot that could see those would not be testing the
 * game, it would be testing itself.
 */
export function playSabacc(players, seed = null) {
  const rng = streamFor(seed);
  const deck = sabaccDeck();
  /* Fisher–Yates off the seeded stream. Nothing here touches Math.random. */
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  let top = 0;
  const draw = () => (top < deck.length ? deck[top++] : (top = 0, deck[top++]));
  const hands = players.map(() => [draw(), draw()]);
  const out = players.map(() => false);
  const events = [];

  for (let round = 0; round < SABACC.ROUNDS; round++) {
    for (let i = 0; i < players.length; i++) {
      if (out[i]) continue;
      const view = {
        hand: hands[i].slice(), round, rounds: SABACC.ROUNDS,
        target: SABACC.TARGET, shift: SABACC.SHIFT,
        others: hands.map((h, k) => (k === i ? null : (out[k] ? 0 : h.length))),
      };
      let act = 'hold';
      try { act = players[i](view) || 'hold'; } catch { act = 'hold'; }
      if (act === 'fold') { out[i] = true; events.push({ t: 'fold', who: i }); continue; }
      if (act === 'draw') { hands[i].push(draw()); events.push({ t: 'draw', who: i }); }
    }
    /**
     * THE SHIFT, and it is the whole game. Every card in every live hand may
     * be redrawn. A made 23 is not a won hand until the last shift is past,
     * which is why holding a good hand early is a decision rather than a
     * formality.
     */
    if (round < SABACC.ROUNDS - 1) {
      for (let i = 0; i < hands.length; i++) {
        if (out[i]) continue;
        for (let c = 0; c < hands[i].length; c++) {
          if (rng() < SABACC.SHIFT) { hands[i][c] = draw(); events.push({ t: 'shift', who: i, at: c }); }
        }
      }
    }
  }

  /* THE SHOWDOWN. Nearest to the target on either side of zero; a bomb-out
   * cannot win; everybody folded or bombed is a push. */
  let best = -1, bestOff = Infinity, pure = false;
  for (let i = 0; i < hands.length; i++) {
    if (out[i]) continue;
    const s = sabaccScore(hands[i]);
    if (s.bomb) continue;
    if (s.pure && !pure) { pure = true; best = i; bestOff = 0; continue; }
    if (!pure && s.off < bestOff) { bestOff = s.off; best = i; }
  }
  return { winner: best, hands: hands.map((h) => h.slice()), out: out.slice(), events, pure };
}

/**
 * A player who knows the rules. The reference opponent, and the thing the
 * check measures a random one against.
 *
 * It is not optimal and is not meant to be — it holds when it is close, draws
 * when it is far, and folds when it is both far and late, which is what
 * knowing the game looks like from outside.
 */
export function sabaccBot(view) {
  const s = sabaccScore(view.hand);
  const left = view.rounds - view.round - 1;
  /**
   * ── DRAWING IS A GAMBLE AND STANDING IS SOMETIMES A CERTAINTY ──────────
   *
   * The first bot drew whenever it was more than two off and won 49.8% against
   * a player moving AT RANDOM — which is to say it was not playing. The reason
   * is that a third card in this deck averages about eight in magnitude, so
   * drawing on a hand that is six off usually overshoots into a bomb-out, and
   * a bomb-out cannot win. It was folding by another route.
   *
   * What it does now is what knowing the game looks like from outside:
   *
   *   BOMBED     you cannot win standing, so draw whatever the round — a card
   *              of the other sign is the only thing that saves it.
   *   CLOSE      hold. The shift may still take it, and that is the tension.
   *   FAR        draw only while a draw could plausibly land inside the
   *              target, which is what `NEAR_DRAW` is.
   *   HOPELESS   fold, and only late, because folding early throws away every
   *              shift that might have fixed it.
   */
  /**
   * ── AND FOLDING A SMALL HAND WAS THE SECOND MISTAKE ───────────────────
   *
   * The cut before this one folded whenever the hand was more than thirteen
   * off, which is every hand whose cards happen to cancel — and a hand at four
   * is not a bad hand, it is an EMPTY one, the exact hand a third card fixes.
   * The bot folded 1668 of 3000 and better than half of all hands ended as a
   * push with nobody at the table. A verb the bot reaches for by default is
   * not a decision.
   *
   * There is one position in this game that is genuinely dead, and folding is
   * for that and nothing else: bombed out by more than the biggest card in the
   * deck, so no single card of the other sign can bring the hand back inside
   * the target. Everything else is worth another card.
   */
  if (s.bomb) return (Math.abs(s.sum) - SABACC.TARGET) > BIGGEST ? 'fold' : 'draw';
  if (s.off <= 4) return 'hold';
  /* Short of the target on either side: a card can only help, and the shift
   * will move it again anyway. `left` is here because a hand held into the
   * last round is the one that gets shown. */
  return left >= 0 ? 'draw' : 'hold';
}

/** The largest magnitude in the deck — a face card at seventeen. */
const BIGGEST = 17;

/* ── THE MIDDLE ───────────────────────────────────────────────────────────
 *
 * Two functions, both pure, and between them they are the whole of what a
 * hand is worth. They take the ANTE rather than reading one so a check can
 * price a table at any stake, and they answer in whole credits because that is
 * what a purse is counted in — `drumPays` rounds for the same reason and
 * `drumEdge`'s note records what happens to a measurement that forgets it.
 */

/** What is in the middle: every seat's ante, including yours. */
export function sabaccPot(ante = SABACC.ANTE, seats = SABACC.SEATS) {
  return Math.max(0, Math.round(Number(ante) || 0)) * Math.max(1, seats | 0);
}

/**
 * What seat 0 is owed when the hand is over, and it is three cases.
 *
 *   YOU TOOK IT      the middle, less the house's cut.
 *   NOBODY TOOK IT   everybody folded or bombed out, so the antes come back —
 *                    the house does not rake a hand nobody won, because a cut
 *                    of a pot with no winner is a fee for having been dealt to.
 *   ANYBODY ELSE     nothing. The ante is already gone; it went in at the deal.
 *
 * A hand that has NOT FINISHED pays nothing at all, and the explicit null is
 * why: `winner` is `null` mid-hand and `null !== 0` would otherwise have read
 * as "somebody else took it" — a live hand quietly settled as a loss.
 */
export function sabaccPays(winner, ante = SABACC.ANTE, seats = SABACC.SEATS) {
  const a = Math.max(0, Math.round(Number(ante) || 0));
  if (!a || winner === null || winner === undefined) return 0;
  if (winner < 0) return a;
  if (winner !== 0) return 0;
  return Math.round(sabaccPot(a, seats) * (1 - SABACC.RAKE));
}

/*
 * ── AND THE EDGE IS MEASURED IN THE CHECK AND NOT EXPORTED FROM HERE ──────
 *
 * `drumEdge` and `drumTicketEdge` are instruments that live in this file with
 * no caller under `src/` — `reachable.mjs` carries both as residue, which is a
 * debt it says may only fall. Sabacc's edge is measured the same way and by the
 * same argument as those two, so it is driven in `tools/checks/games.mjs`
 * against `sabaccPays` rather than adding a third name here that no room calls.
 * The numbers it produces are the ones written on `SABACC` above.
 */

/* ══════════════════════════════════════════════════════════════════════════
 *  2. THE DEJARIK COLUMN
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The holochess board as a small, fast, PERFECT-INFORMATION game: five pieces
 * a side on a ring of twelve squares, and the ring loses a square every third
 * turn. Three minutes, no hidden state, and deep enough to study — which is
 * the opposite of sabacc on purpose, because a casino with two card games has
 * one card game.
 *
 *   A piece moves 1..`reach` squares round the ring and takes what it lands on.
 *   A square that is removed takes whatever stands on it.
 *   You win by having a piece left when the other side does not.
 *
 * The shrinking ring is what makes it end and what makes it tense: a position
 * that is safe this turn is not safe in three, and there is nowhere to hide
 * that stays.
 */
/**
 * ── SIXTEEN SQUARES AND NOT TWELVE, BECAUSE TWELVE WAS A CORRIDOR ────────
 *
 * Five pieces a side on a ring of twelve is ten pieces in twelve squares, and
 * the opening had SIX LEGAL MOVES in it — almost everything was blocked by its
 * own side. A board with six openings is not a board you can study, which is
 * the whole reason this game is here rather than a second card game.
 *
 * Sixteen leaves six empty squares at the start and thirty-odd openings, and
 * the shrink still closes it inside the turn limit.
 */
/**
 * ── TWENTY SQUARES, AND THE PIECES ARE SPREAD, NOT STACKED ───────────────
 *
 * Twelve squares with five a side gave the opening SIX legal moves: the pieces
 * were contiguous and blocked one another, so a board meant to be studied was
 * a corridor. Sixteen did not fix it — the problem was never the ring's size,
 * it was that a block of five pieces has two ends and eight of them are facing
 * their own side.
 *
 * Spread alternately round twenty, each piece has open ground on both sides
 * and the opening is twelve moves — which is a real branching factor for a
 * five-piece game, and the shrink still closes the board inside the limit.
 */
export const DEJARIK = { RING: 20, PIECES: 5, SHRINK_EVERY: 3, MAX_TURNS: 60 };

/** The five pieces, and their reach is the only thing that differs. */
export const DEJARIK_PIECES = [
  { id: 'monnok', reach: 1 }, { id: 'ghhhk', reach: 2 }, { id: 'strider', reach: 3 },
  { id: 'grimtaash', reach: 2 }, { id: 'houjix', reach: 1 },
];

/** A fresh board: two sides alternating round the ring. */
export function dejarikBoard() {
  const ring = new Array(DEJARIK.RING).fill(null);
  const gone = new Array(DEJARIK.RING).fill(false);
  /* ALTERNATING, not contiguous — see the note on `DEJARIK`. Each side takes
   * every other square of its own half, so every piece has open ground beside
   * it on the first turn. */
  for (let i = 0; i < DEJARIK.PIECES; i++) {
    ring[i * 2] = { side: 0, ...DEJARIK_PIECES[i] };
    ring[i * 2 + DEJARIK.RING / 2] = { side: 1, ...DEJARIK_PIECES[i] };
  }
  return { ring, gone, turn: 0, side: 0 };
}

/** Every legal move for the side to play. */
export function dejarikMoves(b) {
  const out = [];
  for (let from = 0; from < b.ring.length; from++) {
    const p = b.ring[from];
    if (!p || p.side !== b.side || b.gone[from]) continue;
    for (let d = 1; d <= p.reach; d++) {
      for (const dir of [1, -1]) {
        const to = ((from + d * dir) % b.ring.length + b.ring.length) % b.ring.length;
        if (b.gone[to]) continue;
        const t = b.ring[to];
        if (t && t.side === p.side) continue;
        out.push({ from, to, takes: !!t });
      }
    }
  }
  return out;
}

/** Play one move. Mutates a copy and answers it. */
export function dejarikStep(b, mv) {
  const n = { ring: b.ring.slice(), gone: b.gone.slice(), turn: b.turn + 1, side: 1 - b.side };
  n.ring[mv.to] = n.ring[mv.from];
  n.ring[mv.from] = null;
  /* THE RING SHRINKS, and whatever is standing there goes with it. The square
   * removed is the one furthest round from the last one removed, so the board
   * closes evenly rather than eating one side. */
  if (n.turn % DEJARIK.SHRINK_EVERY === 0) {
    const live = [];
    for (let i = 0; i < n.gone.length; i++) if (!n.gone[i]) live.push(i);
    if (live.length > 4) {
      const at = live[(n.turn * 5) % live.length];
      n.gone[at] = true;
      n.ring[at] = null;
    }
  }
  return n;
}

/** Who has won, or null. */
export function dejarikWinner(b) {
  let a = 0, c = 0;
  for (let i = 0; i < b.ring.length; i++) {
    const p = b.ring[i];
    if (!p || b.gone[i]) continue;
    if (p.side === 0) a++; else c++;
  }
  if (!a && !c) return -1;
  if (!a) return 1;
  if (!c) return 0;
  if (b.turn >= DEJARIK.MAX_TURNS) return a === c ? -1 : (a > c ? 0 : 1);
  /**
   * ══ AND THE SIDE THAT CANNOT MOVE HAS LOST ══════════════════════════════
   *
   * THE DEFECT. This asked only "has somebody run out of pieces" and "has the
   * clock run out", and never "can the side to play actually play". On a ring
   * a piece is blocked by its own side and by the squares the shrink has taken,
   * so a side can have four pieces on the board and nowhere to put any of them
   * — and this answered `null`, which every caller reads as "the game goes on".
   * Driven 400 games through the panel's own path with legal moves chosen at
   * random: **112 of 400 ended with no winner, no result and no legal move**,
   * 28% of them, and the panel printed `g.line || 'the column is done'` over
   * the hole so it read as an ending. A `||` fallback is how a missing result
   * gets shipped.
   *
   * ── WHY THE STUCK SIDE LOSES, RATHER THAN IT BEING A DRAW ────────────────
   *
   * Chess makes stalemate a draw because its object is the KING, and a king
   * that cannot be taken has not been beaten. Dejarik's object is the BOARD:
   * you win by having a piece left when the other side does not, on a ring that
   * is closing. Being unable to move here is not an accident of geometry, it is
   * what losing looks like one move early — your pieces are packed against your
   * own and the ring, and every square that disappears next takes one of them
   * with it. The side that did that to you played to do it.
   *
   * And the alternative is worse than merely arbitrary: a draw would make
   * SELF-IMMOBILISATION A STRATEGY. A player behind on pieces could shuffle
   * into a block and cash a losing position for half a result, and with the
   * shrink helping them it happened in better than a quarter of driven games —
   * so the dominant line in this game would have been "stop playing it", which
   * is the exact defect `DEJARIK`'s own note about a corridor is about.
   *
   * It is also the rule the rest of the file already assumed: `playDejarik`
   * has answered `1 - b.side` here since it was written, and `Casino`'s turn
   * handler has always given the player the column when the house had no reply.
   * The rule was correct in two places and absent from the one function every
   * path asks. It lives HERE now, so there is one answer to the question.
   */
  if (!dejarikMoves(b).length) return 1 - b.side;
  return null;
}

/**
 * A player who looks one move ahead and counts. The reference opponent.
 *
 * Deliberately shallow: the game is three minutes and the point is that a
 * human who thinks about the shrink beats one who does not. A deep search here
 * would measure the search rather than the game.
 */
export function dejarikBot(b, seed = null) {
  const rng = streamFor(seed);
  const moves = dejarikMoves(b);
  if (!moves.length) return null;
  let best = null, bestV = -Infinity;
  for (const mv of moves) {
    const n = dejarikStep(b, mv);
    let v = mv.takes ? 10 : 0;
    /* WHAT THE OTHER SIDE CAN TAKE BACK. One ply, and it is enough to make a
     * player who ignores it lose. */
    for (const reply of dejarikMoves(n)) if (reply.takes) v -= 8;
    /* AND STANDING ON A SQUARE THAT IS ABOUT TO GO IS DEATH. */
    if ((n.turn + 1) % DEJARIK.SHRINK_EVERY === 0) v -= 3;
    v += rng() * 0.5;
    if (v > bestV) { bestV = v; best = mv; }
  }
  return best;
}

/**
 * ══ PLAY A COLUMN OUT — and this is the ONE loop, for both callers ════════
 *
 * *"the function that fixes this exists and nothing calls it."* This had the
 * stalemate rule and no caller under `src/`; `Casino.dejarikTurn` had a second,
 * shorter loop that did not. Two implementations of one game, and the defect
 * was in the one a player could reach — which is this tree's recurring shape.
 *
 * So the rule moved into `dejarikWinner`, where every path asks it, and this
 * is now what the ROOM plays through: `Casino.dejarikTable` runs a column from
 * its seed and the moves the player has made, exactly as `sabaccTable` re-runs
 * a hand from `{seed, acts}`. Perfect information made a replay look pointless
 * — Casino's header said so — but a replay of a 60-ply game against a one-ply
 * bot costs microseconds, and what it buys is that the board on the screen and
 * the board this file's checks measure are produced by the same twelve lines.
 *
 * ── TWO WAYS TO STOP, AND THEY ARE NOT THE SAME STOP ─────────────────────
 *
 * A bot answering `null` no longer means "I am beaten". It cannot: this is
 * only ever asked when `dejarikWinner` said the game is live, and a live game
 * has a legal move in it by the rule above. It means THE MOVE IS NOT KNOWN YET
 * — the scripted player has run out of script and the panel is waiting on a
 * person. So the loop breaks and `winner` stays `null`, which is the honest
 * answer to "who won" halfway through a game.
 *
 * AND `winner` IS RETURNED RAW. It used to answer `w ?? -1`, which turned an
 * unfinished game into "the ring closes on both of you" — a `||` fallback in
 * the return of the function whose own check counts unfinished games. That
 * check could not have failed. `waiting` is the same fact said out loud.
 */
export function playDejarik(bots, seed = null) {
  let b = dejarikBoard();
  const moves = [];
  let w = dejarikWinner(b);
  while (w === null && moves.length < DEJARIK.MAX_TURNS * 2) {
    const mv = bots[b.side](b, seed == null ? null : seed + moves.length);
    if (!mv) break;
    moves.push({ side: b.side, ...mv });
    b = dejarikStep(b, mv);
    w = dejarikWinner(b);
  }
  return { winner: w, moves, board: b, waiting: w === null };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  3. THE DRUM — the house game, and it is mine rather than canon
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A wheel the size of the room whose segments are the station's own decks. It
 * is spun against the STATION CLOCK — the same clock the medbay heals on and
 * the shops reroll on — so it runs once an hour whether anybody is there or
 * not, everyone in the room watches the same spin, and you cannot re-take a
 * roll by walking out and back in.
 *
 * That last property is the entire reason it exists. A casino game a player
 * can re-roll is a save-scum; one that runs on a clock the player does not own
 * is a thing that happens to them.
 *
 *   You back a DECK (a number), a BAND (a third of the wheel), or the SPINE
 *   (odd/even). The house edge is in the one segment that pays nobody.
 */
/**
 * ── THE WHEEL, AND THE FIRST ONE PAID THE PLAYER 63% ─────────────────────
 *
 * The first cut was twelve segments with the six decks scattered unevenly
 * across them and a payout of 10 on a deck. Deck 40 appeared TWICE in twelve,
 * so it came up one spin in six and paid ten — an expected 1.67 back on every
 * 1 staked. `drumEdge` measured −63.6% and said so, which is the difference
 * between a payout table and a payout table somebody checked.
 *
 * A payout is easy to get wrong by a factor of two and impossible to eyeball,
 * so the wheel is now built to make the arithmetic legible: EACH OF THE SIX
 * DECKS APPEARS EXACTLY THREE TIMES, and two segments belong to the house —
 * one odd, one even, so the house's cut falls on both sides of the spine bet
 * rather than only one.
 *
 *   twenty segments · a deck is 3 in 20 · a band is 5 in 20 · the spine is
 *   9 winning in 20, because one of the two house segments is on each side
 *
 * Every payout below is the fair price times about 0.885, and `drumEdge`
 * measures what actually comes back rather than trusting that sentence.
 */
export const DRUM = {
  SEGMENTS: [
    12, 32, 40, 44, 48, 60,
    null,
    12, 32, 40, 44, 48, 60,
    12, 32, 40, 44, 48, 60,
    null,
  ],
  /** Fair is 20/3 = 6.67. */
  DECK_PAYS: 5.9,
  /**
   * A BAND IS A PART OF THE STATION, NOT A SLICE OF THE WHEEL. The first cut
   * defined a band as five adjacent segments, which made it a bet on where the
   * pointer lands rather than on the station — and because a house segment sat
   * inside two of the four slices, the four bands were not even the same size.
   * A band is now the low decks, the living decks, or the high decks; each is
   * two decks, so six segments in twenty, and all three are identical in size.
   * Fair is 20/6 = 3.33.
   */
  BAND_PAYS: 2.95,
  /** Nine of twenty win. Fair is 2.22. */
  SPINE_PAYS: 1.95,
  /** The three parts of the station, low to high. Every deck is in exactly one. */
  BANDS: [[12, 32], [40, 44], [48, 60]],
};

/**
 * WHICH PART OF THE STATION A DECK IS ON, or -1 for the house's own segments,
 * which belong to no band and are the whole of the wheel's edge on this bet.
 */
export function bandOf(deck) {
  for (let i = 0; i < DRUM.BANDS.length; i++) if (DRUM.BANDS[i].includes(deck)) return i;
  return -1;
}

/**
 * Where the wheel stops for a given hour. A pure function of the clock, so
 * every reader agrees and nobody can ask twice.
 */
export function drumAt(hour, day = 0) {
  const rng = makeRng((((day | 0) * 24 + (hour | 0)) * 2654435761) >>> 0 || 1);
  rng(); rng();
  return Math.floor(rng() * DRUM.SEGMENTS.length) % DRUM.SEGMENTS.length;
}

/**
 * IS THIS A THING THE WHEEL CAN LAND ON? `on` is WHAT YOU BACKED, and the
 * three kinds count it in three different alphabets — a deck is one of the six
 * numbers painted on the drum, a band is 0..2, the spine is 0 or 1. A bet
 * carrying anything else is not a losing bet, it is a MALFORMED one, and the
 * difference matters because `drumPays` cannot tell them apart by looking: an
 * hour written into `on` reads as deck 14 (never wins, silently) or as spine 1
 * (wins half the time, for the wrong reason). See `drumTicket`.
 */
export function drumLegal(bet) {
  if (!bet) return false;
  if (bet.kind === 'deck') return bet.on !== null && DRUM.SEGMENTS.includes(bet.on);
  if (bet.kind === 'band') return Number.isInteger(bet.on) && bet.on >= 0 && bet.on < DRUM.BANDS.length;
  if (bet.kind === 'spine') return bet.on === 0 || bet.on === 1;
  return false;
}

/** What a bet is worth against a stop. `bet` is `{on, kind, stake}`. */
export function drumPays(bet, at) {
  const seg = DRUM.SEGMENTS[at];
  const stake = Math.max(0, Math.round(Number(bet?.stake) || 0));
  if (!stake) return 0;
  /* A BET ON NOTHING PAYS NOTHING, LOUDLY RATHER THAN BY ACCIDENT. Without
   * this line a deck bet whose `on` had been overwritten by something that is
   * not a deck simply never won, and the window kept selling it. */
  if (!drumLegal(bet)) return 0;
  if (seg === null) return 0;                       // the house's segment
  if (bet.kind === 'deck') return seg === bet.on ? Math.round(stake * DRUM.DECK_PAYS) : 0;
  if (bet.kind === 'band') return bandOf(seg) === bet.on ? Math.round(stake * DRUM.BAND_PAYS) : 0;
  if (bet.kind === 'spine') return (at % 2) === bet.on ? Math.round(stake * DRUM.SPINE_PAYS) : 0;
  return 0;
}

/* ── A TICKET IS TWO NUMBERS AND THEY ARE NOT THE SAME NUMBER ─────────────
 *
 * `on`   — WHAT YOU BACKED: a deck, a band, a side of the spine.
 * `turn` — WHICH SPIN IT RIDES: an absolute hour count, `day * 24 + hour`.
 *
 * THE DEFECT THIS EXISTS TO MAKE IMPOSSIBLE. The Wheelhouse panel wrote the
 * hour it was betting into `on` — `{ ...bet, on: (floor(hour) + 1) % 24 }` —
 * so the thing the player backed was destroyed on the way to the wallet and
 * `drumPays` compared an hour against a deck number. Swept over all 24 hours
 * and all 11 rows on the board: 10 of 264 tickets could pay at all, and every
 * one of those ten paid the WRONG BET — at hour 0 "the even spine" collected
 * while the wheel said it had lost, and deck 48, which had actually won, was
 * paid nothing. A hundred per cent house edge, dressed as a payout table.
 *
 * The turn is ABSOLUTE and not an hour of the day for the second half of the
 * same defect: the ticket carried `floor(hour) + 1` while the room compared it
 * against `floor(hour)`, so it settled on the click that struck it — against a
 * stop `drumAt` had already published. Counting from the start of time means
 * "has the clock reached it yet" is `>=` on two integers, with no wrap to get
 * backwards, and a ticket struck at 23:40 rides tomorrow's 00:00 turn.
 */

/** The absolute turn the clock is standing on. */
export function drumTurnOf(hour, day = 0) {
  return (day | 0) * 24 + Math.floor(Number(hour) || 0);
}

/** The clock face of an absolute turn — what `drumAt` wants back. */
export function drumClockOf(turn) {
  const t = Math.floor(Number(turn) || 0);
  return { hour: ((t % 24) + 24) % 24, day: Math.floor(t / 24) };
}

/**
 * Strike a ticket. It rides the NEXT turn, never this one: the wheel this hour
 * has already stopped and `drumAt` will tell anybody who asks where.
 */
export function drumTicket(bet, hour, day = 0) {
  return {
    kind: bet?.kind, on: bet?.on,
    label: bet?.label ?? '', pays: bet?.pays ?? 0,
    stake: Math.max(0, Math.round(Number(bet?.stake) || 0)),
    turn: drumTurnOf(hour, day) + 1,
  };
}

/** Has the clock reached the turn this ticket rides? */
export function drumDue(ticket, hour, day = 0) {
  const t = Number(ticket?.turn);
  return Number.isFinite(t) && drumTurnOf(hour, day) >= t;
}

/** Where the wheel stops for a ticket — the one reading that settles it. */
export function drumStop(ticket) {
  const when = drumClockOf(ticket?.turn);
  return drumAt(when.hour, when.day);
}

/**
 * THE EDGE ALONG THE PATH THE ROOM ACTUALLY WALKS: strike a ticket at an hour,
 * let the clock reach it, settle it. `drumEdge` below measures the WHEEL;
 * this measures the WINDOW, and the two were 90 points apart for the whole
 * life of the panel because only one of them was ever run.
 */
export function drumTicketEdge(bet, spins = 12000) {
  const STAKE = 1000;
  let staked = 0, back = 0;
  for (let i = 0; i < spins; i++) {
    /* Struck mid-hour, exactly as a player standing at the window is. */
    const t = drumTicket({ ...bet, stake: STAKE }, (i % 24) + 0.5, (i / 24) | 0);
    staked += STAKE;
    back += drumPays(t, drumStop(t));
  }
  return 1 - back / staked;
}

/** The house's edge on one kind of bet, measured rather than declared. */
export function drumEdge(kind, on = 0, spins = 12000) {
  /* MEASURED AT A REAL PRICE. `drumPays` rounds to whole credits, so at a stake
   * of 1 a payout of 2.95 and a payout of 3.4 are both 3 — the rounding IS the
   * edge, and every price change measures as no change at all. A thousand is
   * above the point where rounding matters and below where it overflows. */
  const STAKE = 1000;
  let staked = 0, back = 0;
  for (let i = 0; i < spins; i++) {
    staked += STAKE;
    back += drumPays({ on, kind, stake: STAKE }, drumAt(i % 24, (i / 24) | 0));
  }
  return 1 - back / staked;
}
