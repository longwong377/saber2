/**
 * SABER — what a run leaves behind.
 *
 * The design document says "Runs are built, not saved", and that is right: this
 * game should not gate content behind grinding, and nothing here unlocks
 * anything. But there is a difference between refusing to sell progress and
 * refusing to REMEMBER it, and this project was doing the second by accident —
 * `gameOver` reduced a run to a card and threw it away, `takenBoons` was
 * constructed fresh on every World and never serialised, and the only two
 * localStorage keys in the whole tree were settings and keybinds.
 *
 * So you could play for an hour and the game would not know you had ever
 * played. That is the thing being fixed, and only that: a record, not a
 * currency.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   no unlocks           every crystal, cut, species and order is available
 *                        from the first run. A creator you have to earn is a
 *                        creator you cannot use.
 *   no currency          nothing accumulates that buys power.
 *   no cross-run power   a run is still built from its own drafts, so the
 *                        hundredth run starts exactly where the first did.
 *
 * What IS here is the shape of a history: how deep you have been, what you did
 * it with, and whether you have ever reached the top.
 */

const KEY = 'saber.progress.v1';
/** How many runs to keep. A history, not an archive. */
const KEEP = 40;

const blank = () => ({
  runs: 0, wins: 0, kills: 0,
  bestDepth: 0, bestScore: 0, bestTier: 0,
  /** Deepest run achieved with each order/species, so the record says what you
   *  have actually done rather than only how far you got once. */
  byOrder: {}, bySpecies: {},
  /** Boon ids that have appeared in a run that reached the crown. NOT an
   *  unlock — a note about what has worked. */
  crowned: [],
  recent: [],
});

function read() {
  try {
    if (typeof localStorage === 'undefined') return blank();
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const v = JSON.parse(raw);
    // A record is not worth a crash. Anything malformed is a fresh start, and
    // silently — the alternative is a player who cannot open the game because
    // a number they never saw is a string.
    return (v && typeof v === 'object') ? { ...blank(), ...v } : blank();
  } catch { return blank(); }
}

function write(v) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch { /* private browsing, a full quota — losing a record is not an error */ }
}

export function loadProgress() { return read(); }

/** Record one finished run. `summary` is Run.summary(). */
export function recordRun(summary) {
  if (!summary) return read();
  const p = read();
  p.runs++;
  p.kills += summary.kills || 0;
  if (summary.won) p.wins++;
  p.bestDepth = Math.max(p.bestDepth, summary.depth || 0);
  p.bestScore = Math.max(p.bestScore, summary.score || 0);
  p.bestTier = Math.max(p.bestTier, summary.tier || 0);

  const id = summary.identity || {};
  const deeper = (map, k) => {
    if (!k) return;
    map[k] = Math.max(map[k] || 0, summary.depth || 0);
  };
  deeper(p.byOrder, id.order);
  deeper(p.bySpecies, id.species);

  if (summary.won) {
    const set = new Set(p.crowned);
    for (const b of summary.boons || []) set.add(b);
    p.crowned = [...set];
  }

  p.recent.unshift({
    depth: summary.depth || 0, tier: summary.tier || 0, score: summary.score || 0,
    won: !!summary.won, order: id.order || null, species: id.species || null,
    boons: (summary.boons || []).slice(0, 12),
  });
  if (p.recent.length > KEEP) p.recent.length = KEEP;
  write(p);
  return p;
}

/** For the menu: a few lines a player can read without a spreadsheet. */
export function progressLines(p = read()) {
  if (!p.runs) return ['No runs yet.'];
  const out = [
    `${p.runs} run${p.runs === 1 ? '' : 's'}, ${p.kills} felled`,
    `deepest ${p.bestDepth} wave${p.bestDepth === 1 ? '' : 's'}`,
  ];
  if (p.wins) out.push(`${p.wins} ascent${p.wins === 1 ? '' : 's'} of the Spire`);
  const orders = Object.entries(p.byOrder).sort((a, b) => b[1] - a[1]);
  if (orders.length) out.push(orders.map(([k, v]) => `${k} ${v}`).join('  ·  '));
  return out;
}

export function clearProgress() { write(blank()); return read(); }
