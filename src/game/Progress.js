/**
 * BATTLEFRONT BORZ — what a run leaves behind.
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

// The ladder itself, so `bestTier` can be shown as the place it names rather
// than as an index — and so there is one list of rung names in the tree.
import { DESCENT, ladderName } from './Run.js';

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
  /**
   * THE SKY YOU HAVE WALKED: boon id → how many runs have ever held it.
   *
   * Read by the meditation opened from the Temple, which is the one place this
   * game has where a player looks at the whole system at once and asks what
   * they have actually tried. Every star is available in every run from the
   * first; this only draws where you have been, in a fainter colour.
   *
   * Emphatically NOT a currency and not an unlock — the file this sits in
   * exists to make that distinction and would be worthless if the first thing
   * added after it were a number that buys something. Nothing in src/ reads
   * this back into a run: `grep -n "\.lit" src/` finds the chart and nothing
   * else.
   */
  lit: {},
  /** Stars lit by communion, all-time. A tally of a thing done, same rule. */
  communed: 0,
  /**
   * Deepest run in each MODE — the field that says a record is about the game
   * and not about one ladder. See RECORDED.
   */
  byMode: {},
  recent: [],
});

/**
 * WHICH MODES A RUN IN IS WORTH REMEMBERING — and the fact that this list has
 * more than one entry in it is the whole point.
 *
 * This file's own header says "you could play for an hour and the game would
 * not know you had ever played. That is the thing being fixed", and it was
 * fixed for exactly one mode. `main.js` builds a Run only for the gauntlet, all
 * three `recordRun` call sites are gated on that Run, and the shipped default
 * in the menu is `roguelite` — so a player who installs the game, presses
 * Ignite and plays for an hour still has nothing in `saber.progress.v1`, the
 * menu's record line still reads "No runs yet", and the star map's history
 * layer is still empty.
 *
 * Half of that fix is here and half of it is at the call sites: this function
 * could not have recorded a roguelite even if it had been handed one, because
 * it read `summary.depth` and only a Run has one — measured, a 23-wave
 * roguelite handed to it verbatim recorded as "deepest 0 waves". It takes
 * either shape now. The wiring in main.js is the other half.
 *
 * TRAINING AND THE SANDBOX ARE NOT IN THE LIST, deliberately: nothing in the
 * dojo can kill you and the sandbox is a room with a slider, so a "deepest 99
 * waves" earned by typing 99 into a box is worse than no record. Deciding it
 * HERE rather than at the call site is what lets the wiring be a blind call.
 */
const RECORDED = new Set(['spire', 'descent', 'gauntlet', 'roguelite', 'waves', 'duel']);

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

/**
 * Record one finished run.
 *
 * `summary` is `Run.summary()` — or, for the four fifths of this game that have
 * no Run, the stats object `World.onGameOver` already hands out, with the mode
 * and the identity main.js has in its hand at that moment:
 *
 *     recordRun({ ...stats, mode: settings.mode, boons: [...world.takenBoons],
 *                 identity: { order: settings.order, species: settings.species } })
 *
 * DEPTH OR WAVE, whichever arrived. A Run counts waves across four rungs and
 * calls it `depth`; every other mode counts waves in one place and `gameOver`
 * calls it `wave`. They are the same quantity — how far you got — and reading
 * only the first is what made a 23-wave roguelite record itself as zero.
 */
export function recordRun(summary) {
  if (!summary) return read();
  // A mode that cannot be lost is not a run. An UNNAMED mode still records, so
  // a caller holding a bare Run.summary() keeps working.
  if (summary.mode && !RECORDED.has(summary.mode)) return read();
  const p = read();
  const depth = Math.max(0, summary.depth ?? summary.wave ?? 0);
  p.runs++;
  p.kills += summary.kills || 0;
  if (summary.won) p.wins++;
  p.bestDepth = Math.max(p.bestDepth, depth);
  p.bestScore = Math.max(p.bestScore, summary.score || 0);
  p.bestTier = Math.max(p.bestTier, summary.tier || 0);

  // `identity` when a Run carried one, the loose pair when the caller is
  // holding settings rather than a run.
  const id = summary.identity || { order: summary.order, species: summary.species };
  const deeper = (map, k) => {
    if (!k) return;
    map[k] = Math.max(map[k] || 0, depth);
  };
  deeper(p.byOrder, id.order);
  deeper(p.bySpecies, id.species);
  deeper(p.byMode, summary.mode);

  if (summary.won) {
    const set = new Set(p.crowned);
    for (const b of summary.boons || []) set.add(b);
    p.crowned = [...set];
  }

  // Once per run, not once per rank: this counts RUNS that held a star, so a
  // four-rank Vitality is one visit to that star and not four.
  p.lit = { ...p.lit };
  for (const id of new Set(summary.boons || [])) p.lit[id] = (p.lit[id] || 0) + 1;
  p.communed += (summary.lit || []).length;

  /**
   * THE SEED AND THE LADDER, which `Run.summary()` has always carried and this
   * function has always dropped.
   *
   * `Run.seed` describes itself as the number that makes a run "a shareable
   * number rather than an unrepeatable accident" — and it was not written down
   * anywhere a player could find it after the run ended, which is the only
   * moment sharing one is worth anything. `mode` was the same: summary carried
   * it, nothing compared it, so a depth of 16 could not say what it was 16 of.
   * Both are on the entry rather than at the top level because both are facts
   * about ONE run, and this file keeps totals at the top and runs in `recent`.
   */
  p.recent.unshift({
    depth, tier: summary.tier || 0, score: summary.score || 0,
    won: !!summary.won, order: id.order || null, species: id.species || null,
    mode: summary.mode || null, seed: summary.seed ?? null,
    stars: (summary.lit || []).length,
    boons: (summary.boons || []).slice(0, 12),
  });
  if (p.recent.length > KEEP) p.recent.length = KEEP;
  write(p);
  return p;
}

/**
 * For the menu: a few lines a player can read without a spreadsheet.
 *
 * AND THE ONLY READER THIS FILE HAS, which is why it now touches all of it.
 * Six of the twelve fields `recordRun` writes had no reader anywhere in the
 * tree — `bestScore`, `bestTier`, `bySpecies`, `communed`, `crowned` and the
 * forty-run `recent` history, which stores each run's first twelve boons —
 * checked by grepping every name across src/ excluding this file. Storage that
 * nothing displays is not a record, it is a write-only log, and the honest
 * choice was either to delete the fields or to show them. They are shown: the
 * header of this file says what is here is "the shape of a history: how deep
 * you have been, what you did it with, and whether you have ever reached the
 * top", and every one of them is part of that sentence.
 *
 * Still a handful of lines and still nothing that buys anything.
 */
export function progressLines(p = read()) {
  if (!p.runs) return ['No runs yet.'];
  const out = [
    `${p.runs} run${p.runs === 1 ? '' : 's'}, ${p.kills} felled`,
    `deepest ${p.bestDepth} wave${p.bestDepth === 1 ? '' : 's'}`
      + (p.bestTier ? ` · ${DESCENT[p.bestTier]?.name || `rung ${p.bestTier + 1}`}` : '')
      + (p.bestScore ? ` · best ${Math.floor(p.bestScore).toLocaleString()}` : ''),
  ];
  if (p.wins) out.push(`${p.wins} descent${p.wins === 1 ? '' : 's'} of the works`);
  const stars = Object.keys(p.lit || {}).length;
  if (stars || p.communed) {
    out.push(`${stars} star${stars === 1 ? '' : 's'} of the sky walked`
      + (p.communed ? `, ${p.communed} lit by communion` : ''));
  }
  // What has ever been carried to the crown. A note about what has worked, and
  // emphatically not a gate: every card is in every draft from the first run.
  if (p.crowned?.length) out.push(`${p.crowned.length} boons have reached the bottom with you`);
  const deepest = (map) => Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
  const orders = deepest(p.byOrder), species = deepest(p.bySpecies), modes = deepest(p.byMode);
  if (orders.length) out.push(orders.map(([k, v]) => `${k} ${v}`).join('  ·  '));
  if (species.length) out.push(species.map(([k, v]) => `${k} ${v}`).join('  ·  '));
  // Which game you have actually been playing. The record was blind to this for
  // the same reason it was blind to four of the five modes — see RECORDED.
  if (modes.length) out.push(modes.map(([k, v]) => `${ladderName(k)} ${v}`).join('  ·  '));
  const last = p.recent?.[0];
  if (last) {
    out.push(`last: ${last.depth} wave${last.depth === 1 ? '' : 's'}`
      + (ladderName(last.mode) ? ` of ${ladderName(last.mode)}` : '')
      + (last.won ? ', crowned' : '')
      + (last.boons?.length ? ` · ${last.boons.length} boon${last.boons.length === 1 ? '' : 's'}` : '')
      + (last.seed != null ? ` · seed ${last.seed}` : ''));
  }
  return out;
}

export function clearProgress() { write(blank()); return read(); }
