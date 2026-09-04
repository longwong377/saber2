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
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  AMENDMENT — CREDITS, AND WHY THEY DO NOT BREAK THE THREE RULES ABOVE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * V16 asks for a shop. In the player's words: *"extensive shop system that you
 * access through differernt vendors at the zocalo; very very long list of
 * items you can purchase with credits that you get for doing differnt stuff in
 * the game and playing the game."*
 *
 * That is a cross-run currency and the second rule above says there is not
 * one. So it is written down HERE, in the file that states the doctrine,
 * BEFORE any of it is built — because a rule edited in silence is worse than
 * one broken loudly, and `Kennel.js`'s own header is explicit that a new file
 * being invisible to the currency scan is "a hazard, not a permission."
 *
 * ── WHAT THE RULE IS ACTUALLY FOR ─────────────────────────────────────────
 *
 * Read the three refusals again and they are one sentence: **A RUN IS WON BY
 * PLAYING, NOT BY HAVING PLAYED BEFORE.** "No currency" is not the value; it
 * is the enforcement mechanism for that value, chosen when the only thing a
 * currency could plausibly have bought was power.
 *
 * ── SO THE AMENDMENT IS A NARROWING, NOT A REPEAL ─────────────────────────
 *
 * Credits may exist, and exactly two kinds of thing may be bought with them.
 * The player drew this line himself, unprompted, in the same paragraph:
 * *"maybe cosmetic stuff you buy is permanent and you can also buy powerups
 * similar to the stuff you can get in the holocrons but they are temporary and
 * do not persist when you die."*
 *
 *   KEEPSAKES   Cosmetic and permanent. Paint, hilt parts, robes, furniture,
 *               a companion's collar, a trophy on a shelf. They change how
 *               something LOOKS and nothing else — no stat, no capability, no
 *               shortcut. A check measures a bought item's effect on the
 *               player's numbers and fails on ANY movement at all.
 *
 *   PROVISIONS  A run's worth of something, and gone when the run ends —
 *               exactly as the player specified, and exactly the contract the
 *               Holocron already has, which is why he reached for that
 *               comparison without being asked. Food, a stim, a temporary
 *               facet, a stratagem charge.
 *
 * A third category — permanent power — is what the doctrine forbids, is not
 * created by this amendment, and was never asked for.
 *
 * ── AND THE THREE THINGS THAT KEEP IT HONEST ──────────────────────────────
 *
 *   THE ECONOMY IS BOUNDED. Credits earned per run are capped and the
 *     interesting rows cost several runs, so hoarding cannot buy an advantage
 *     that does not exist anyway.
 *   THE SCAN IS EXTENDED, NOT EVADED. Every file that touches credits goes
 *     ONTO the six-word currency scan (`companions.mjs`, `company.mjs`) on the
 *     commit that creates it, with these two categories named as the exemption
 *     and this paragraph as the reason. That is the difference between an
 *     argued change to a rule and a quiet hole in it.
 *   `takenBoons` IS UNTOUCHED. Nothing bought enters the draft, the Holocron
 *     or the run's own ledger. The hundredth run still starts where the first
 *     did, which is the sentence the three refusals above exist to protect.
 */

// The ladder itself, so `bestTier` can be shown as the place it names rather
// than as an index — and so there is one list of rung names in the tree.
/**
 * The name a mode goes by in the record. It used to come from Run.js, which
 * held a two-entry table so The Descent could print as "the Descent" rather
 * than as "gauntlet"; the Descent is deleted and MODES is where a mode's
 * display name has always lived for everything else. One authority.
 */
import { MODES, CONDITIONS } from './Waves.js';
const ladderName = (mode) => MODES[mode]?.name || mode || null;
/**
 * What a stored rule key reads as on screen — `CONDITIONS[k].label`, which is
 * the same string the wave's own banner shouts when the condition lands. One
 * authority: a second table of seven names in this file is the defect the
 * codebase keeps removing, and it would go stale the first time a card was
 * re-worded.
 */
const ruleName = (key) => String(key || '').split('+')
  .map((k) => CONDITIONS[k]?.label || k).join(' + ');

const KEY = 'saber.progress.v1';
/** How many runs to keep. A history, not an archive. */
const KEEP = 40;

const blank = () => ({
  runs: 0, wins: 0, kills: 0,
  bestDepth: 0, bestScore: 0,
  /** Deepest run achieved with each order/species, so the record says what you
   *  have actually done rather than only how far you got once. */
  byOrder: {}, bySpecies: {},
  /** Boon ids that have appeared in a run that reached the crown. NOT an
   *  unlock — a note about what has worked. */
  crowned: [],
  /**
   * THE HOLOCRON YOU HAVE WALKED: boon id → how many runs have ever held it.
   *
   * Read by the meditation opened from the Temple, which is the one place this
   * game has where a player looks at the whole system at once and asks what
   * they have actually tried. Every facet is available in every run from the
   * first; this only draws where you have been, in a fainter colour.
   *
   * Emphatically NOT a currency and not an unlock — the file this sits in
   * exists to make that distinction and would be worthless if the first thing
   * added after it were a number that buys something. Nothing in src/ reads
   * this back into a run: `grep -n "\.woken" src/` finds the chart and nothing
   * else.
   */
  woken: {},
  /** Facets woken by communion, all-time. A tally of a thing done, same rule. */
  communed: 0,
  /**
   * Deepest run in each MODE — the field that says a record is about the game
   * and not about one ladder. See RECORDED.
   */
  byMode: {},
  /**
   * Deepest run under each set of RUN RULES, in the same shape as `byMode`.
   *
   * Keyed on the rules the run was actually fought under, sorted and joined, so
   * "NO GUNS + ONE BEARING" and "ONE BEARING + NO GUNS" are one record rather
   * than two. The empty set is not stored — that is `byMode`.
   *
   * THIS IS NOT THE THING THIS FILE'S HEADER FORBIDS, and the distinction is
   * the whole reason the header is written the way it is. What is refused above
   * is a currency, an unlock, and cross-run POWER. A rule set carries none of
   * those: every rule is available in the first run, choosing one makes the
   * player no stronger — it makes the run harder and is not even charged
   * against the wave's budget — and nothing here is read back into a run. What
   * is kept is exactly what the header says is kept: "how deep you have been,
   * what you did it with". Under what terms is what you did it with.
   */
  byRule: {},
  /**
   * ── THE SYLLABUS BOOKMARK — V16 Lane A2 ───────────────────────────────
   *
   * The rungs of the dojo ladder that have been cleared, by id. It is here and
   * not in a store of its own because `session.mjs` counts the durable writers
   * in this tree and refuses a fourth, and it is right to: a new key is a new
   * thing that crosses a session and whoever adds one has to argue it. This
   * needs no new key, because it is the same KIND of fact the rest of this
   * record holds — a tally of a thing done.
   *
   * AND IT IS NOT A RUN, which is why it does not go through `recordRun`.
   * `RECORDED` refuses training and the sandbox because nothing in a lesson
   * can kill you, so a lesson cleared must not add a run, a kill or a depth to
   * anything. `clearLesson` writes this field and touches no other.
   *
   * NOT A CURRENCY AND NOT AN UNLOCK IN THE SENSE THIS FILE FORBIDS. A rung is
   * a door onto a room that repeats a lesson you have already been taught; it
   * buys no power, enters no draft, and nothing reads it back into a run.
   * `grep -n 'lessons' src/` finds the room and nothing else.
   */
  lessons: [],
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
 * menu's record line still reads "No runs yet", and the Holocron's history
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
 *
 * COMMAND WAS MISSING, AND IT IS THE ONE MODE THAT CAN BE WON.
 *
 * The paragraph above is about a mode that leaves no trace; Command left none
 * either, and it is the mode where that hurts most. A campaign is five areas,
 * two dozen named bodies and a casualty list — the most a run in this game has
 * ever been worth remembering — and none of it reached `saber.progress.v1`.
 *
 * It also makes `wins` and `crowned` REACHABLE. Both fields have been written by
 * this function since it was first added, both are gated on `summary.won`, and
 * NOTHING IN `src/` HAS EVER PASSED THAT FIELD: the Descent was the only mode
 * with a top and it was deleted, so `p.wins` was structurally pinned at 0 and
 * `p.crowned` at empty for every player who has ever run this game. Command's
 * `_endCampaign` is the first and only writer of `won: true`, which is why it
 * had to be admitted here on the same commit.
 */
/* Skirmish and Campaign are runs with an ENDING, which is the property this
 * set is really about: both can be won, both write `won` through
 * `World.runStats`, and `wins`/`crowned` have had a reader waiting since
 * Command's campaign arrived. */
/* The Line is the sixth, and it is the one whose record is worth the most: it
 * is the only mode where `won` can come back FALSE off a crossing that reached
 * the far end — see `CommandDirector._endCampaign`. A mode left out of this
 * set leaves no trace at all, and a mode whose whole subject is a casualty
 * list leaving no trace is the defect the paragraph above is an account of. */
/**
 * THE MODES A RUN IS RECORDED FOR — and the rule is "can this be lost", not
 * "is this a wave ladder".
 *
 * Two were missing and both were missing silently, which is the whole reason
 * `progress.mjs` asks the question mode by mode: a set has no default it can
 * complain about, so a mode added to `MODES` simply falls through to "not
 * recorded" and nobody finds out.
 *
 *   `thefront`  was one of them; the mode was removed in V12 and its record
 *               row with it (a saved run of it is simply an unknown mode).
 *   `versus`    a commander battle is ONE engagement, so its depth is always
 *               1 and that is honest rather than uninformative: what a meeting
 *               produces is a win, a loss and a body count, and `runs`, `wins`
 *               and `kills` are exactly the three fields this record keeps.
 *               Refusing it would mean the one mode you can be BEATEN at by a
 *               person leaves no trace.
 *
 * The two that stay out are the two where there is no run to record at all:
 * nothing in the lessons can kill you, and the sandbox is a room with a slider.
 */
const RECORDED = new Set(['roguelite', 'waves', 'duel', 'command', 'theline', 'skirmish',
  'campaign', 'versus']);

function read() {
  try {
    if (typeof localStorage === 'undefined') return blank();
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const v = JSON.parse(raw);
    // A record is not worth a crash. Anything malformed is a fresh start, and
    // silently — the alternative is a player who cannot open the game because
    // a number they never saw is a string.
    if (!v || typeof v !== 'object') return blank();
    /**
     * `woken` WAS `lit`, and a rename of a stored key is a silent deletion
     * unless somebody carries the old one across. Under the star metaphor this
     * field was "the sky you have walked"; the metaphor is gone and the field
     * is the same fact, so a record written before the rename is read rather
     * than replaced by an empty chart. The spread below would otherwise hand
     * `blank()`'s empty `woken` to a player with fifty runs behind them and
     * nothing anywhere would report it. Kept as long as `saber.progress.v1` is
     * the key — bumping the version is what retires it.
     */
    if (v.lit && !v.woken) { v.woken = v.lit; delete v.lit; }
    return { ...blank(), ...v };
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
 * A RUNG CLEARED. Idempotent — a lesson taken twice is one rung, and the
 * ladder is a set rather than a tally for the reason the field's note gives:
 * counting how many times you were taught something is a statistic about
 * repetition and not about what you know.
 */
export function clearLesson(id) {
  if (typeof id !== 'string' || !id) return read();
  const p = read();
  if (p.lessons.includes(id)) return p;
  p.lessons = [...p.lessons, id];
  write(p);
  return p;
}

/** The rungs cleared, as a plain list. */
export function lessonsCleared() { return read().lessons.slice(); }

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
  /**
   * `bestTier` IS GONE, and it is the second field in this file to have been
   * written on every run and read by nothing.
   *
   * It was the Descent's rung index. The Descent is deleted, `Run.js` with it,
   * and `summary.tier` was passed by nothing in `src/` — `World.onGameOver`
   * does not carry a tier — so the field was pinned at 0 for every player who
   * has ever run this game, and `grep -rn bestTier src/` found the write and no
   * reader. Storage that nothing displays is not a record, it is a write-only
   * log; this file's own note about `progressLines` says the honest choice is
   * to delete the field or show it, and there is nothing left to show. A record
   * written before this reads through `blank()`'s spread and simply drops it.
   */

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
  // Sorted, so the key is the SET and not the order it was picked in.
  const rules = [...new Set(summary.rules || [])].sort();
  deeper(p.byRule, rules.join('+'));

  if (summary.won) {
    const set = new Set(p.crowned);
    for (const b of summary.boons || []) set.add(b);
    p.crowned = [...set];
  }

  // Once per run, not once per rank: this counts RUNS that held a facet, so a
  // four-rank Vitality is one visit to that facet and not four.
  p.woken = { ...p.woken };
  for (const id of new Set(summary.boons || [])) p.woken[id] = (p.woken[id] || 0) + 1;
  p.communed += (summary.woken || []).length;

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
    depth, score: summary.score || 0,
    /**
     * THREE STATES, BECAUSE THERE ARE THREE. `!!summary.won` had two, and the
     * missing one is the commonest: a run the player walked out of. Measured
     * through main.js's own `record()` — quitting a campaign 25 s into mission
     * 2, alive, world not over — the entry written was `won: false`, so the
     * ledger called every abandonment a defeat and `recent[]` is the one
     * history anybody reads. `null` is "nobody decided", and `wins` and
     * `crowned` below are gated on `won` being TRUE, so neither moves for it.
     */
    won: summary.won == null ? null : !!summary.won,
    order: id.order || null, species: id.species || null,
    mode: summary.mode || null, seed: summary.seed ?? null,
    rules,
    facets: (summary.woken || []).length,
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
    `${p.runs} run${p.runs === 1 ? '' : 's'}, ${p.kills} felled`
      // WINS ARE SHOWN NOW THAT THEY CAN HAPPEN. `p.wins` was written by
      // `recordRun` from the day this file was added and could never be
      // anything but 0 — no mode in the game passed `won` — so no reader was
      // ever missed. Command's five-area advance is the first thing here that
      // can be finished, and a record that counts a finished campaign and does
      // not print it is the write-only log this file's header refuses to be.
      + (p.wins ? ` · ${p.wins} won` : ''),
    `deepest ${p.bestDepth} wave${p.bestDepth === 1 ? '' : 's'}`
      + (p.bestScore ? ` · best ${Math.floor(p.bestScore).toLocaleString()}` : ''),
  ];
  const woken = Object.keys(p.woken || {}).length;
  if (woken || p.communed) {
    out.push(`${woken} facet${woken === 1 ? '' : 's'} of the Holocron reached`
      + (p.communed ? `, ${p.communed} woken in communion` : ''));
  }
  // …and what was in your hand when you finished one. Same rule as `woken`: a note
  // about what has worked, not a gate — every card is in every draft from the
  // first run.
  if (p.crowned?.length) {
    out.push(`${p.crowned.length} boon${p.crowned.length === 1 ? '' : 's'} carried to the end of an advance`);
  }
  // What has ever been carried to the crown. A note about what has worked, and
  // emphatically not a gate: every card is in every draft from the first run.
  const deepest = (map) => Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
  const orders = deepest(p.byOrder), species = deepest(p.bySpecies), modes = deepest(p.byMode);
  if (orders.length) out.push(orders.map(([k, v]) => `${k} ${v}`).join('  ·  '));
  if (species.length) out.push(species.map(([k, v]) => `${k} ${v}`).join('  ·  '));
  // Which game you have actually been playing. The record was blind to this for
  // the same reason it was blind to four of the five modes — see RECORDED.
  if (modes.length) out.push(modes.map(([k, v]) => `${ladderName(k)} ${v}`).join('  ·  '));
  /**
   * …AND UNDER WHAT TERMS, which is the line a rule set is chosen FOR.
   *
   * "Deepest run under NO GUNS" is the only thing that makes picking a rule
   * worth anything after the run ends: it turns a handicap into a number to
   * beat, and it is the whole of what run rules add to replayability that a
   * harder wave does not. Deepest first, and capped at three lines — this is a
   * record a player reads without a spreadsheet, and 46 rule sets per theatre
   * is a spreadsheet.
   */
  const rules = deepest(p.byRule).filter(([k]) => k);
  for (const [k, v] of rules.slice(0, 3)) {
    out.push(`under ${ruleName(k)} — ${v} wave${v === 1 ? '' : 's'}`);
  }
  const last = p.recent?.[0];
  if (last) {
    out.push(`last: ${last.depth} wave${last.depth === 1 ? '' : 's'}`
      + (ladderName(last.mode) ? ` of ${ladderName(last.mode)}` : '')
      // Three states, one line: crowned, left, or the plain depth of a defeat.
      + (last.won === null ? ', left' : last.won ? ', crowned' : '')
      + (last.rules?.length ? ` · under ${ruleName(last.rules.join('+'))}` : '')
      + (last.boons?.length ? ` · ${last.boons.length} boon${last.boons.length === 1 ? '' : 's'}` : '')
      /**
       * …AND HOW MANY OF THEM YOU WOKE YOURSELF.
       *
       * `facets` has been on every entry since `recent[]` was written and had
       * no reader anywhere — the write-only log this file's own header refuses
       * to be, in its mildest form. It was also structurally 0: `recordRun`
       * reads `summary.woken` and nothing in `src/` passed it until main.js's
       * `record()` began sending `communion.bought`. Both halves are closed on
       * the same commit, because either one alone is still a field that says
       * nothing.
       *
       * It sits beside `boons` because it is the SHARE of that number the
       * player chose in the Holocron rather than was dealt: `boons` is the
       * whole holding — the order's grants, the draft, and this — and in a mode
       * outside `Waves.DRAFT_MODES`, which holds one of the eight, the
       * difference between the two is the whole of what the run built.
       */
      + (last.facets ? ` · ${last.facets} woken` : '')
      + (last.seed != null ? ` · seed ${last.seed}` : ''));
  }
  return out;
}

export function clearProgress() { write(blank()); return read(); }
