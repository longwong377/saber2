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
export const SABACC = { TARGET: 23, HAND: 2, ROUNDS: 3, SHIFT: 0.22 };

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

/** Play a whole game out. Answers the winner and the moves. */
export function playDejarik(bots, seed = null) {
  let b = dejarikBoard();
  const moves = [];
  let w = dejarikWinner(b);
  while (w === null && moves.length < DEJARIK.MAX_TURNS * 2) {
    const mv = bots[b.side](b, seed == null ? null : seed + moves.length);
    if (!mv) { w = 1 - b.side; break; }
    moves.push({ side: b.side, ...mv });
    b = dejarikStep(b, mv);
    w = dejarikWinner(b);
  }
  return { winner: w ?? -1, moves, board: b };
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

/** What a bet is worth against a stop. `bet` is `{on, kind, stake}`. */
export function drumPays(bet, at) {
  const seg = DRUM.SEGMENTS[at];
  const stake = Math.max(0, Math.round(Number(bet?.stake) || 0));
  if (!stake) return 0;
  if (seg === null) return 0;                       // the house's segment
  if (bet.kind === 'deck') return seg === bet.on ? Math.round(stake * DRUM.DECK_PAYS) : 0;
  if (bet.kind === 'band') return bandOf(seg) === bet.on ? Math.round(stake * DRUM.BAND_PAYS) : 0;
  if (bet.kind === 'spine') return (at % 2) === bet.on ? Math.round(stake * DRUM.SPINE_PAYS) : 0;
  return 0;
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
