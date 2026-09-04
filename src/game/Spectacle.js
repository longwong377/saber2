/**
 * ══════════════════════════════════════════════════════════════════════════
 *  BATTLEFRONT BORZ — THE SPECTACLE ENGINE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "these will be real races without pre-determined outcomes … so even the game
 *  doesn't know who will race until the victor is called … in life a good
 *  better will probably make money over time … maybe the scnes you sometimes
 *  see play out on the screens are actually real scenes from that podrace
 *  you're watching."
 *
 * V16 LANE D says a spectacle is five things, and this file is all five and
 * nothing else:
 *
 *   1. A CARD    a field of entrants, each with attributes and a history
 *   2. A GROUND  a track or a pit, with conditions drawn before the odds
 *   3. A SIM     a tick loop with real dice, run FORWARD from the bet
 *   4. A FORM    everything above, readable, so research pays
 *   5. A WINDOW  the sim's own typed event stream, so a room can render it
 *
 * ── THE ONE RULE THE WHOLE FILE IS SHAPED AROUND ──────────────────────────
 *
 * **The winner is never drawn and then narrated backwards.** `runSpectacle`
 * has no line in it that picks a victor. It advances a state, segment by
 * segment, emitting what happened as it happens, and the order falls out of
 * the distances at the end. That is not a style preference — it is the only
 * implementation in which the player's *"even the game doesn't know"* is true,
 * and it is also the only one in which researching form can honestly pay,
 * because a pre-drawn winner makes every form book a decoration.
 *
 * Two consequences that the checks pin rather than trust:
 *   • the same seed and the same card produce a DIFFERENT winner when a hidden
 *     term moves — so the dice are not the whole story and neither is the card;
 *   • the result is not a function of the odds. The favourite wins about a
 *     third of the time and the rest of the field takes the other two.
 *
 * ── WHY A GOOD BETTOR WINS AND A LAZY ONE BLEEDS ──────────────────────────
 *
 * Every number that decides a race lives in ONE table per skin (`terms` and
 * `hazards` below), and every row of it carries a `seen` flag:
 *
 *   `seen: true`   PUBLIC. On the board, in the form book, priced by the house.
 *   `seen: false`  HIDDEN. In the sim, and NOT in the price.
 *
 * `formStrength(e, ground, { hidden })` reads the same table twice. The house
 * calls it with `hidden: false` and prices what it can see; the sim calls it
 * with `hidden: true` and runs what is actually there. One table, two readers,
 * so a hidden term cannot drift out of the price or out of the race — the
 * failure mode where the odds quietly start pricing something the sim stopped
 * using is structurally unavailable.
 *
 * A hidden term is not secret forever, and that is the point. It leaves marks
 * in the PUBLIC log — a pilot who likes the wet finishes better in the wet, and
 * the log records the weather — so `readForm()` recovers it from results
 * anybody can read. That is the reading room being worth the walk, expressed as
 * a function: `bettorForm` in the harness knows nothing it was told and beats
 * the market anyway, on public information, slowly.
 *
 * ── A STAKE IS NOT A SHOP, AND THIS FILE HOLDS NO BALANCE ─────────────────
 *
 * `tools/checks/companions.mjs` greps three named files for the six words a
 * store is made of, and `Kennel.js` says of its own absence from that list:
 * "That silence is a hazard, not a permission." This file is not on the list
 * either, so the rule is restated here and obeyed.
 *
 * A WAGER IS A RUN-SCOPED NUMBER, HANDED IN AND HANDED BACK. `settle()` takes
 * a list of `{ entrant, stake }`, reads a result it did not produce, and
 * returns a ledger. It stores nothing, it reads nothing off a record, and
 * there is no field anywhere below that a session could accumulate into. Who
 * owns the units, where they came from and what they are worth is Lane B's
 * counter — this file cannot tell you and must not learn.
 *
 * The other half of the same rule is the player's: *"you don't have to bet to
 * watch (applies to any casino game)."* `runSpectacle` takes no wagers at all.
 * It cannot: settlement is a separate function reading a finished result, so a
 * card runs identically whether the player turned up, watched, or bet the
 * house down. A check drives that both ways and compares the event streams.
 *
 * ── PURITY, AND WHAT "PURE" MEANS HERE ────────────────────────────────────
 *
 * No THREE object, no World, no DOM, no `Station.js`, no `Waves.js`, and no
 * mode named anywhere (§9.2). The only import is the tree's own generator, so
 * the whole engine runs headless in a check and the renderer — the Holo-theatre
 * feed, the Pit's screens, the Arena's announcer — is somebody else's file
 * reading `result.events`.
 *
 * `makeRng`'s stream is the tree's, and it is used the way the tree uses it:
 * a module-level stream seeded from `moduleSeed` so the browser deals a
 * different card every session, and `seedSpectacle` so the gate can ask for
 * the same one twice. A caller who passes an explicit `seed` gets a private
 * generator and never touches the shared one — which is what makes a race
 * reproducible from a seed AND unpredictable without one.
 */

import { makeRng, moduleSeed, clamp } from '../engine/MathUtil.js';

/**
 * THE HOUSE STREAM. Unseeded in the browser (`moduleSeed` falls through to
 * `Math.random` there), pinned under `tools/register.mjs`, and resettable by
 * name for the same reason `enemyRng`, `duelRng` and `commandRng` are.
 */
export const spectacleRng = makeRng(moduleSeed(0x5EC7));
export function seedSpectacle(n) { spectacleRng.seed(n); return spectacleRng; }

/** A private stream for an explicit seed; the shared one otherwise. */
const streamFor = (seed) => (seed == null ? spectacleRng : makeRng((seed >>> 0) || 1));

const round2 = (n) => Math.round(n * 100) / 100;

/* ══════════════════════════════════════════════════════════════════════════
 *  THE TWO ADVANCES — this is the "one engine" and there are two of them
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A course is a race to a distance; a bout is a race to the last one standing.
 * Both are the same loop over the same runner records, emitting into the same
 * event stream, ranked by the same tail. What differs is one function, and the
 * SKIN NAMES WHICH — so PIT and ARENA are two rows of data over one advance,
 * and a fourth spectacle is a table, not a file.
 */

/**
 * COURSE — every runner covers ground, the hazards take some of it back.
 *
 * Distance per segment is multiplicative (`s * exp(gauss * vol)`) rather than
 * additive, because additive noise on a strength of ~3 with the spread a real
 * field needs goes negative several times a race and the clamp at zero is then
 * doing the racing. A log-normal segment cannot go backwards and its spread
 * scales with the pace, which is what a pod actually does.
 *
 * `day` is drawn ONCE per runner per race — the pod is off song today — and it
 * is what makes the favourite beatable. Segment noise alone gives a field where
 * the best rating wins nine times in ten, which is not a betting market.
 */
function courseAdvance(st) {
  const { rng, ground, skin } = st;
  for (const r of st.runners) {
    if (r.out) continue;
    r.dist += Math.max(0.02, (r.s + r.day) * Math.exp(rng.gauss() * skin.vol));
  }
}

/**
 * BOUT — everyone still standing leans on somebody who still is.
 *
 * `condition` is the pool and the hit chance is a logistic on the strength
 * gap, so a big edge is a short fight and a small one is a long one. A refusal
 * is not a loss of condition: it is an entrant deciding, on its own nerve, that
 * it is done — which is the event the player named and the one a crowd reacts
 * to hardest.
 */
function boutAdvance(st) {
  const { rng, skin } = st;
  const live = st.runners.filter((r) => !r.out);
  for (const a of live) {
    if (a.out) continue;
    const foes = st.runners.filter((r) => !r.out && r !== a);
    if (!foes.length) break;
    const f = foes[Math.floor(rng() * foes.length) % foes.length];
    const edge = (a.s + a.day) - (f.s + f.day) + (a.grudge?.[f.e.id] || 0);
    const hit = clamp(0.5 + edge * 0.20, 0.06, 0.94);
    if (rng() >= hit) continue;
    const dmg = skin.bite * (0.55 + rng() * 0.9) * (1 + edge * 0.10);
    f.cond -= dmg;
    a.dist += dmg;                                   // the ranking tail reads `dist`
    if (dmg > skin.bite * 1.15) st.emit('knockdown', f.e.id, { by: a.e.id, left: round2(Math.max(0, f.cond)) });
    if (f.cond <= 0) { f.out = 'beaten'; st.emit('beaten', f.e.id, { by: a.e.id }); continue; }
    /* THE REFUSAL. Low nerve, low condition, and a die — an animal that will
     * not go again. `heart` is hidden, so the price never sees it coming. */
    if (f.cond < skin.pool * 0.38 && rng() < 0.035 * (1 - (f.e.hidden.heart || 0))) {
      f.out = 'refused';
      st.emit('refusal', f.e.id, { by: a.e.id });
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE THREE SKINS, AS DATA
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every term is a row: a key, a label a form book can print, whether the house
 * can SEE it, and what it is worth on this ground for this entrant.
 *
 * The magnitudes are the whole balance of the feature and they were fitted, not
 * guessed — see `tools/_spectacle-lab.mjs`, which runs the field for thousands
 * of races and reads back what a bettor of each kind actually makes. Hidden
 * terms too small and research is a hobby; too large and the market is free
 * money and the house would not offer it.
 */
const POD_TERMS = [
  { key: 'rating', label: 'rating', seen: true, of: (e) => e.form.rating / 22 },
  { key: 'wet', label: 'going', seen: false, of: (e, g) => (e.hidden.wet || 0) * g.conditions.rain * 0.78 },
  { key: 'heat', label: 'cooling', seen: false, of: (e, g) => Math.min(0, (e.hidden.heatLimit ?? 1) - g.conditions.heat) * 0.45 },
  { key: 'gate', label: 'away', seen: false, of: (e) => (e.hidden.gate || 0) * 0.06 },
];

const POD_HAZARDS = [
  {
    key: 'wall', label: 'a wall strike', seen: false, cost: 1.35, retire: 0.08, base: 0.012,
    rate: (e, g) => 0.012 * (1 + g.conditions.rain * 1.1) * (1 - 0.55 * (e.hidden.nerve || 0)),
  },
  {
    key: 'mechanical', label: 'a mechanical', seen: false, cost: 0, retire: 1, base: 0.006,
    rate: (e, g) => 0.006 * (1 + 2.6 * Math.max(0, g.conditions.heat - (e.hidden.heatLimit ?? 1))),
  },
];

const FIGHT_TERMS = [
  { key: 'rating', label: 'rating', seen: true, of: (e) => e.form.rating / 22 },
  { key: 'vice', label: 'temper', seen: false, of: (e, g) => (e.hidden.vice || 0) * (0.30 + g.conditions.crowd * 0.42) },
  { key: 'footing', label: 'footing', seen: false, of: (e, g) => (e.hidden.footing || 0) * g.conditions.sand * 0.55 },
  { key: 'heat', label: 'cooling', seen: false, of: (e, g) => Math.min(0, (e.hidden.heatLimit ?? 1) - g.conditions.heat) * 0.45 },
];

const FIGHT_HAZARDS = [
  {
    key: 'wound', label: 'a wound opened', seen: false, cost: 0.9, retire: 0.05, base: 0.010,
    rate: (e, g) => 0.010 * (1 + g.conditions.sand * 0.6) * (1 - 0.5 * (e.hidden.heart || 0)),
  },
];

export const SKINS = Object.freeze({
  /**
   * PODRACE — `#19 Holo-theatre` shows the feed. Two tracks and a third for
   * the meeting that needs one; weather drawn before the board goes up, so the
   * house prices the RAIN and never the pilot who likes it.
   */
  PODRACE: Object.freeze({
    id: 'PODRACE', word: 'race', entrantWord: 'pod', room: 'holo-theatre',
    advance: courseAdvance, mode: 'course',
    field: 8, vol: 0.20, daySd: 0.60, sigma: { sim: 0.74, board: 0.70, read: 0.70 },
    terms: POD_TERMS, hazards: POD_HAZARDS,
    read: [{ key: 'rain', at: 0.4, k: 0.71 }, { key: 'heat', at: 0.62, k: 0.71 }],
    /* The mean hazard load the market DOES price — every field has wall
     * strikes in it and the board knows that much. */
    take: 0.06,
  }),
  /**
   * PIT — `#18 The Pit`, whose gazetteer verb is already "watch and bet".
   * Sentients, beasts and custom droids, which is every body builder the game
   * already owns, so an entrant is a chassis the tree can already pose.
   */
  PIT: Object.freeze({
    id: 'PIT', word: 'bout', entrantWord: 'fighter', room: 'the-pit',
    advance: boutAdvance, mode: 'bout',
    field: 6, vol: 0.20, daySd: 0.52, sigma: { sim: 0.62, board: 0.60, read: 0.60 }, bite: 7.5, pool: 100,
    terms: FIGHT_TERMS, hazards: FIGHT_HAZARDS,
    read: [{ key: 'crowd', at: 0.7, k: 1.15 }, { key: 'sand', at: 0.55, k: 1.15 }, { key: 'heat', at: 0.6, k: 1.15 }],
    take: 0.08,
  }),
  /**
   * ARENA — `#20 The Arena`, the one where the player's own companion is the
   * entrant (Lane G). Two in the sand, refereed, and a hard round limit, so a
   * bout that goes the distance is decided on condition rather than by a body
   * on the floor. Same table, same odds, and the room bets on you.
   */
  ARENA: Object.freeze({
    id: 'ARENA', word: 'bout', entrantWord: 'companion', room: 'the-arena',
    advance: boutAdvance, mode: 'bout',
    field: 2, vol: 0.20, daySd: 0.46, sigma: { sim: 0.55, board: 0.53, read: 0.53 }, bite: 6.0, pool: 100,
    terms: FIGHT_TERMS, hazards: FIGHT_HAZARDS,
    read: [{ key: 'crowd', at: 0.6, k: 1.15 }, { key: 'sand', at: 0.35, k: 1.15 }, { key: 'heat', at: 0.45, k: 1.15 }],
    take: 0.05,
  }),
});

/* ══════════════════════════════════════════════════════════════════════════
 *  THE GROUNDS
 * ══════════════════════════════════════════════════════════════════════════ */

export const GROUNDS = Object.freeze([
  { id: 'boonta', name: 'The Boonta Reach', skin: 'PODRACE', laps: 3, gates: 6, weather: { rain: 0.45, heat: [0.35, 0.95] } },
  { id: 'vinta', name: 'Vinta Harvest Loop', skin: 'PODRACE', laps: 2, gates: 8, weather: { rain: 0.50, heat: [0.15, 0.60] } },
  { id: 'ord', name: 'Ord Ibanna Spires', skin: 'PODRACE', laps: 4, gates: 4, weather: { rain: 0.40, heat: [0.55, 1.05] } },
  { id: 'pit-floor', name: 'The Pit, floor', skin: 'PIT', rounds: 9, weather: { crowd: [0.4, 1.0], sand: [0.2, 0.9], heat: [0.3, 0.9] } },
  { id: 'underlift', name: 'The Underlift Pit', skin: 'PIT', rounds: 12, weather: { crowd: [0.7, 1.0], sand: [0.5, 1.0], heat: [0.4, 1.0] } },
  { id: 'arena-sand', name: 'The Arena', skin: 'ARENA', rounds: 3, ticksPerRound: 9, weather: { crowd: [0.3, 0.9], sand: [0.1, 0.6], heat: [0.2, 0.7] } },
].map(Object.freeze));

export const groundById = (id) => GROUNDS.find((g) => g.id === id) || null;

/**
 * A GROUND WITH A DAY ON IT.
 *
 * Conditions are PUBLIC and are drawn BEFORE the board goes up — that is what
 * makes the going a fair thing for the house to price and the entrant's
 * temperament on it an unfair one. `segments` is how many times the advance
 * runs and is the unit every hazard rate is per.
 */
export function dressGround(def, seed = null) {
  const rng = streamFor(seed);
  const w = def.weather || {};
  const span = (v, dflt) => (Array.isArray(v) ? rng.range(v[0], v[1]) : (v == null ? dflt : v));
  const conditions = {
    rain: typeof w.rain === 'number' ? (rng() < w.rain ? Math.round(rng.range(0.7, 1) * 100) / 100 : 0) : 0,
    heat: round2(span(w.heat, 0.5)),
    crowd: round2(span(w.crowd, 0.5)),
    sand: round2(span(w.sand, 0.4)),
  };
  const segments = def.skin === 'PODRACE'
    ? def.laps * def.gates
    : (def.ticksPerRound ? def.rounds * def.ticksPerRound : def.rounds * 6);
  return Object.freeze({ ...def, conditions: Object.freeze(conditions), segments });
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE CARD
 * ══════════════════════════════════════════════════════════════════════════ */

const POD_HEAD = ['Sebul', 'Ody', 'Teem', 'Gasg', 'Wan', 'Ratt', 'Aldar', 'Boles', 'Neva', 'Ark', 'Clegg', 'Dud', 'Mars', 'Elan', 'Ben', 'Kaa'];
const POD_TAIL = ['ba', 'nno', 'to', 'ano', 'sabb', 'lar', 'kin', 'roo', 'vek', 'don', 'thas', 'mir'];
const PIT_HEAD = ['Grask', 'Vorn', 'Hulth', 'Kez', 'Ramm', 'Ogrun', 'Sil', 'Tarn', 'Dross', 'Yavk', 'Morr', 'Bex', 'Chal', 'Wrek', 'Zhu', 'Ilk'];
const PIT_TAIL = [' the Red', ' of Nar Shu', ' Ninefingers', '-4', ' the Quiet', ' Ironjaw', '-K7', ' the Elder', ' Blacktooth', ' Unit-9', ' the Long', ' Halfmask'];
const KINDS = { PODRACE: ['pod'], PIT: ['sentient', 'beast', 'droid'], ARENA: ['companion'] };

/**
 * A FIELD OF ENTRANTS, PUBLIC HALF AND HIDDEN HALF.
 *
 * `form` is everything a punter may read and everything the board may price.
 * `hidden` is what the sim actually runs on and no odds function may open —
 * a check permutes it and demands the board does not move.
 *
 * The field PERSISTS: the same entrant objects are handed back to
 * `runSpectacle` day after day, and `recordResult` grows `form.log`, so by the
 * twentieth meeting the log holds enough to recover a hidden term from public
 * results alone. That is the "field that builds a real history you can study".
 */
export function makeCard({ skin = 'PODRACE', size = 0, seed = null, entrants = null } = {}) {
  const S = SKINS[skin];
  if (!S) throw new Error(`no such spectacle skin: ${skin}`);
  if (entrants) return { skin, entrants: entrants.slice() };
  const rng = streamFor(seed);
  const n = size || S.field;
  const out = [];
  for (let i = 0; i < n; i++) {
    const kinds = KINDS[skin];
    const name = skin === 'PODRACE'
      ? rng.pick(POD_HEAD) + rng.pick(POD_TAIL)
      : rng.pick(PIT_HEAD) + rng.pick(PIT_TAIL);
    out.push(makeEntrant({
      id: `${skin.toLowerCase()}-${i}-${(rng() * 1e6) | 0}`,
      name,
      kind: rng.pick(kinds),
      rating: Math.round(rng.range(46, 94)),
      hidden: {
        wet: round2(rng.gauss() * 0.55),
        nerve: round2(rng.gauss() * 0.55),
        gate: round2(rng.gauss() * 0.6),
        heatLimit: round2(rng.range(0.45, 1.05)),
        vice: round2(rng.gauss() * 0.5),
        footing: round2(rng.gauss() * 0.55),
        heart: round2(clamp(rng.gauss() * 0.5, -1, 1)),
      },
    }));
  }
  return { skin, entrants: out };
}

/** One entrant, clamped on the way in the way the roll clamps a trooper. */
export function makeEntrant({ id, name, kind = 'pod', rating = 70, hidden = {}, form = null } = {}) {
  return {
    id: String(id ?? name ?? 'entrant'),
    name: String(name ?? 'unnamed'),
    kind,
    form: form || { rating: clamp(Number(rating) || 70, 20, 100), starts: 0, wins: 0, places: 0, recent: [], log: [] },
    hidden: {
      wet: clamp(Number(hidden.wet) || 0, -1.5, 1.5),
      nerve: clamp(Number(hidden.nerve) || 0, -1.5, 1.5),
      gate: clamp(Number(hidden.gate) || 0, -1.5, 1.5),
      heatLimit: clamp(hidden.heatLimit == null ? 1 : Number(hidden.heatLimit), 0.2, 1.4),
      vice: clamp(Number(hidden.vice) || 0, -1.5, 1.5),
      footing: clamp(Number(hidden.footing) || 0, -1.5, 1.5),
      heart: clamp(Number(hidden.heart) || 0, -1, 1),
    },
  };
}

/**
 * LANE G'S DOOR — the player's own animal as an entrant, without this file
 * ever importing the Kennel.
 *
 * A kennel record is a plain object with plain fields, so the adapter reads
 * the six it needs and nothing else. `Companions.js` and `CompanionKinds.js`
 * import `Bodies.js` and therefore THREE; taking a record instead of a module
 * is what keeps the engine headless and keeps Lane G's wiring in Lane G.
 */
export function entrantFromCompanion(rec = {}, kindRow = {}) {
  const bond = clamp(Number(rec.bond) || 0, 0, 1);
  const scars = Array.isArray(rec.scars) ? rec.scars.length : 0;
  return makeEntrant({
    id: rec.id || 'companion',
    name: rec.name || 'your companion',
    kind: 'companion',
    /* A rating the board can read: the animal's own standing, its bond, and
     * every scar it has ever carried out of a pit. Nothing here is a stat the
     * player set; all of it is history. */
    rating: clamp(48 + bond * 26 + Math.min(scars, 6) * 2.4 + (Number(kindRow.heft) || 0) * 6, 20, 100),
    hidden: {
      /* Scars are courage AND caution, which is why the two hidden terms they
       * feed point in opposite directions. */
      heart: clamp(bond * 0.9 - scars * 0.06, -1, 1),
      vice: clamp(scars * 0.10 - 0.1, -1.5, 1.5),
      footing: clamp((Number(kindRow.foot) || 0), -1.5, 1.5),
      nerve: clamp(bond * 0.7 - 0.2, -1.5, 1.5),
      heatLimit: rec.kind === 'droid' ? 0.7 : 1.2,
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 *  FORM — the same table read twice
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * WHAT AN ENTRANT IS WORTH ON THIS GROUND TODAY.
 *
 * `hidden: false` is the board's reading and `hidden: true` is the truth. The
 * difference between the two numbers IS the edge, and because both come out of
 * one table there is exactly one place to change either.
 *
 * Hazards enter as a DRAG on the strength: a runner who hits walls finishes
 * behind one who does not, and a market that cannot see whose nerve is short
 * prices the field's average wall instead. That is honest bookmaking and it is
 * where most of a researched edge actually comes from.
 */
export function formStrength(e, ground, { hidden = false } = {}) {
  const S = SKINS[ground.skin];
  const parts = [];
  let total = 0;
  for (const t of S.terms) {
    if (!t.seen && !hidden) continue;
    const d = t.of(e, ground) || 0;
    total += d;
    if (d) parts.push({ key: t.key, label: t.label, seen: t.seen, delta: round2(d) });
  }
  let drag = 0;
  for (const h of S.hazards) {
    const rate = (!h.seen && !hidden) ? h.base : h.rate(e, ground);
    /* A retirement costs the whole race, and is charged at its strength cost
     * rather than as a probability the softmax cannot see. */
    const per = h.cost * (1 - h.retire) + (h.retire * 6);
    drag += rate * ground.segments * per * 0.11;
  }
  total -= drag;
  if (drag) parts.push({ key: 'risk', label: 'risk', seen: false, delta: -round2(drag) });
  return { total, parts, drag };
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE MODEL — and it is NOT a softmax, which cost a pass to find out
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The sim is a tick loop, so any probability quoted before it runs is a MODEL
 * of it, and the model has to be right in the same way the sim is or the whole
 * betting argument is decoration.
 *
 * THE FIRST ONE WAS A SOFTMAX AT A FITTED TEMPERATURE AND IT DID NOT SURVIVE
 * BEING MEASURED TWICE. Fitted on one circuit it read favourite-backer −5.4%
 * and insider +54%; the same code on two more circuits of the same shape read
 * −9.9%/+101% and −22.8%/+197%. The temperature that fits a field of eight
 * pods whose ratings happen to be spread is not the one that fits a tight
 * field, because a softmax's spread is a free parameter and the sim's is not.
 * A constant fitted per circuit is a constant fitted to noise, and it would
 * have shipped as three plausible numbers in a table.
 *
 * WHAT THE SIM ACTUALLY DOES is give every runner its strength plus a draw it
 * does not control — the day, the segment noise, the walls — and let the
 * biggest total win. So the honest model is exactly that statement:
 *
 *     P(i wins) = ∫ φ((x − sᵢ)/σ)/σ · Π_{j≠i} Φ((x − sⱼ)/σ) dx
 *
 * the chance i's draw lands at x and every other draw lands under it. It has
 * ONE parameter, σ, and σ means something a reader can argue with: how much of
 * the result this reader cannot see. It needs no refitting when the field
 * tightens, because the integral already knows what a tight field is.
 *
 * AND THAT IS WHERE THE THREE READERS DIFFER, IN ONE NUMBER EACH — `sigma.sim`,
 * `sigma.board`, `sigma.read`, all three fitted by the lab against the same
 * circuit.
 *
 * THE OBVIOUS PARAMETERISATION WAS ALSO WRONG AND THE BENCH SAID SO. The first
 * version derived the board's σ as `hypot(sim, blind)` on the argument that a
 * reader who cannot see a term must be FLATTER. Measured, the board's best σ
 * came back BELOW the sim's — 0.70 against 0.74 — because the public strengths
 * are also COMPRESSED: dropping the hidden terms removes spread from the field
 * as well as knowledge from the reader, and the two effects do not cancel in
 * the direction the argument assumed. A derived σ would have been an imaginary
 * number dressed up as a principle.
 *
 * What is actually true, and what the shipped numbers show, is on the log-loss
 * and not on σ: 1.3710 for the sim's own view, 1.4116 for the reading room,
 * 1.4142 for the board. The market is the worst-informed reader in the room,
 * which is the whole feature, and it is visible in the score rather than in a
 * parameter somebody argued about.
 */

/* Abramowitz & Stegun 7.1.26 — enough for a probability nobody prints past
 * three figures, and it keeps this file free of a dependency. */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592)
    * t * Math.exp(-a * a);
  return sign * y;
}
const CDF = (z) => 0.5 * (1 + erf(z * Math.SQRT1_2));
const PDF = (z) => Math.exp(-0.5 * z * z) * 0.3989422804014327;

/**
 * WHO WINS A FIELD OF STRENGTHS UNDER A COMMON UNSEEN DRAW.
 *
 * Trapezoid over a grid wide enough that the tails are worth nothing — 6σ
 * either side of the field, 240 steps — which for a field of eight is fifteen
 * thousand flops and is called once per board. Normalised at the end, because
 * a quadrature running 0.3% short would make every price on the board 0.3%
 * long and the house would find out before the player did.
 */
export function fieldProbabilities(strengths, sigma) {
  const n = strengths.length;
  if (n <= 1) return n === 1 ? [1] : [];
  const sd = Math.max(sigma, 1e-4);
  const lo = Math.min(...strengths) - 6 * sd, hi = Math.max(...strengths) + 6 * sd;
  const STEPS = 240, dx = (hi - lo) / STEPS;
  const out = new Array(n).fill(0);
  const cdf = new Array(n);
  for (let k = 0; k <= STEPS; k++) {
    const x = lo + k * dx;
    const w = (k === 0 || k === STEPS) ? 0.5 : 1;
    for (let j = 0; j < n; j++) cdf[j] = CDF((x - strengths[j]) / sd);
    for (let i = 0; i < n; i++) {
      let p = PDF((x - strengths[i]) / sd) / sd;
      if (p < 1e-12) continue;
      for (let j = 0; j < n && p > 0; j++) if (j !== i) p *= cdf[j];
      out[i] += w * p * dx;
    }
  }
  const sum = out.reduce((a, b) => a + b, 0) || 1;
  return out.map((v) => v / sum);
}

/** What the sim would say (`hidden`), and what the board is allowed to say. */
export function winProbabilities(card, ground, { hidden = false } = {}) {
  const S = SKINS[ground.skin];
  const s = card.entrants.map((e) => formStrength(e, ground, { hidden }).total);
  const p = fieldProbabilities(s, hidden ? S.sigma.sim : S.sigma.board);
  return card.entrants.map((e, i) => ({ id: e.id, p: p[i] }));
}

/**
 * THE SAME MODEL, WITH THE READING ROOM'S WORK IN IT.
 *
 * Public strength plus whatever `readForm` could recover from the public log,
 * and a σ narrowed by `leftBlind` because a term you have recovered is a term
 * that is no longer hiding. Nothing here is told a hidden field; it is
 * inferred from results, badly at first and better every meeting, which is
 * what makes the walk to the reading room a decision rather than a formality.
 */
export function researchedProbabilities(card, ground) {
  const S = SKINS[ground.skin];
  const s = card.entrants.map((e) => formStrength(e, ground, { hidden: false }).total + readForm(e, ground).bonus);
  const p = fieldProbabilities(s, S.sigma.read);
  return card.entrants.map((e, i) => ({ id: e.id, p: p[i] }));
}

/**
 * THE BOARD.
 *
 * Decimal odds from the PUBLIC reading with the house's own take folded in, so
 * the book is over-round by exactly `take` and a bettor who backs the market
 * leader forever bleeds at about that rate. It never sees `hidden`; a check
 * permutes every hidden field on the card and asserts the board is identical
 * character for character.
 */
export function priceCard(card, ground) {
  const S = SKINS[ground.skin];
  const probs = winProbabilities(card, ground, { hidden: false });
  return probs.map(({ id, p }) => ({
    id,
    /* The board's own opinion, which is what a punter compares against. */
    marketP: round2(p * 1000) / 1000,
    price: round2(Math.max(1.05, (1 / Math.max(p, 1e-4)) * (1 - S.take))),
  }));
}

export const favouriteOf = (board) => board.reduce((a, b) => (b.price < a.price ? b : a), board[0]);

/* ══════════════════════════════════════════════════════════════════════════
 *  THE SIM — forward, from the bet
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * RUN IT.
 *
 * Nothing in here chooses a winner. It builds a runner per entrant, draws each
 * one's day, and then advances `ground.segments` times, letting hazards fire
 * and letting the advance move distance. The order at the end is the order the
 * distances are in, and `retired` runners are ranked below everyone who
 * finished, in the order they went out.
 *
 * NO WAGERS COME IN HERE. Watching is free and betting is a choice, so the
 * simulation cannot be a function of either — `settle()` reads the finished
 * result afterwards, and a check compares two runs of the same seed, one with
 * a stake placed against it and one without, event for event.
 */
export function runSpectacle({ card, ground, seed = null } = {}) {
  const S = SKINS[ground.skin];
  const rng = streamFor(seed);
  const events = [];
  const state = {
    rng, ground, skin: S, t: 0,
    emit(type, who, extra) { events.push({ t: state.t, type, who, ...(extra || {}) }); },
  };
  state.runners = card.entrants.map((e) => ({
    e,
    s: formStrength(e, ground, { hidden: true }).total,
    day: rng.gauss() * S.daySd,
    dist: 0,
    cond: S.pool || 0,
    out: null,
    grudge: e.hidden.grudge || null,
  }));
  const gone = [];

  state.emit('off', null, {
    ground: ground.id,
    field: state.runners.length,
    conditions: ground.conditions,
  });

  let lead = null;
  for (let seg = 1; seg <= ground.segments; seg++) {
    state.t = seg;
    /* HAZARDS FIRST — a runner who goes into the wall on this gate does not
     * also make normal ground on it. */
    for (const r of state.runners) {
      if (r.out) continue;
      for (const h of S.hazards) {
        if (rng() >= h.rate(r.e, ground)) continue;
        r.dist = Math.max(0, r.dist - h.cost);
        r.cond -= h.cost * 6;
        state.emit(h.key, r.e.id, { gate: seg, note: h.label });
        if (rng() < h.retire) {
          r.out = 'retired';
          gone.push(r);
          state.emit('retire', r.e.id, { gate: seg, cause: h.key });
          break;
        }
      }
    }
    for (const r of state.runners) if (r.out && !gone.includes(r)) gone.push(r);

    S.advance(state);

    for (const r of state.runners) {
      if (!r.out || gone.includes(r)) continue;
      gone.push(r);
    }

    /* THE WINDOW. Order the live runners, name a lead change, and name an
     * overtake at this gate — with the entrants in it, because a screen that
     * says "an overtake" is a screensaver and one that says which pod took
     * which is the race you are watching. */
    const live = state.runners.filter((r) => !r.out).sort((a, b) => b.dist - a.dist);
    if (live.length) {
      if (lead && live[0] !== lead) {
        state.emit('lead', live[0].e.id, { gate: seg, from: lead.e.id });
      }
      lead = live[0];
      /* AN OVERTAKE IS A SWAP, and the first version of this line tested for
       * the opposite — `a.wasBehind === b.e.id` is "a was ahead of b and still
       * is", which is every pair that did NOT change and read out as eighty
       * overtakes a race. It is a swap when b had a directly behind it and a is
       * now in front. */
      for (let i = 1; i < live.length; i++) {
        const a = live[i - 1], b = live[i];
        if (b.wasBehind === a.e.id) state.emit('overtake', a.e.id, { gate: seg, past: b.e.id });
      }
      for (let i = 0; i < live.length; i++) live[i].wasBehind = live[i + 1] ? live[i + 1].e.id : null;
    }
    if (S.mode === 'bout' && live.length <= 1) break;
  }

  /* THE ORDER FALLS OUT. Finishers by distance; retirees below them, latest
   * out first, because going out on the last gate beat going out on the
   * first. */
  const finished = state.runners.filter((r) => !r.out).sort((a, b) => b.dist - a.dist);
  const retired = gone.slice().reverse();
  const order = [...finished, ...retired];
  order.forEach((r, i) => state.emit('placed', r.e.id, { position: i + 1, status: r.out || 'finished' }));
  const winner = order[0] || null;
  /* `margin` and not `by`: every other event uses `by` for an ENTRANT, and a
   * number sitting in that field is an event naming a stranger. Caught by the
   * window check, which resolves every id-shaped field against the card. */
  state.emit('result', winner ? winner.e.id : null, { margin: winner && order[1] ? round2(winner.dist - order[1].dist) : 0 });

  return {
    skin: ground.skin,
    ground: ground.id,
    conditions: ground.conditions,
    seed,
    ticks: state.t,
    winner: winner ? winner.e.id : null,
    order: order.map((r, i) => ({
      id: r.e.id, name: r.e.name, position: i + 1,
      status: r.out || 'finished', dist: round2(r.dist), condition: round2(Math.max(0, r.cond)),
    })),
    events,
  };
}

/**
 * A DAY'S CARD. Several spectacles on one ground-family, run whether or not
 * anybody turned up, with the field's history grown after each one.
 */
export function runMeeting({ card, skin = 'PODRACE', races = 1, seed = null, record = true } = {}) {
  const rng = streamFor(seed);
  const pool = GROUNDS.filter((g) => g.skin === skin);
  const field = card || makeCard({ skin, seed: rng.int(1, 1e9) });
  const out = [];
  for (let i = 0; i < races; i++) {
    const ground = dressGround(rng.pick(pool), rng.int(1, 1e9));
    const board = priceCard(field, ground);
    const result = runSpectacle({ card: field, ground, seed: rng.int(1, 1e9) });
    if (record) recordResult(field, ground, result);
    out.push({ ground, board, result });
  }
  return { card: field, races: out };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE FORM BOOK — and the research that pays
 * ══════════════════════════════════════════════════════════════════════════ */

const LOG_KEEP = 60;

/**
 * WRITE THE RESULT INTO THE PUBLIC RECORD.
 *
 * `recent` is the six-figure form line a board prints; `log` is the reading
 * room — every start with the conditions it was run in, which is what makes a
 * hidden term recoverable by anybody willing to read.
 *
 * And a bout writes a GRUDGE, which is the player's own hidden term and the
 * one with the best story: the fighter who was beaten last meeting carries a
 * little extra at the one who beat it, and the board has no idea.
 */
export function recordResult(card, ground, result) {
  const byId = new Map(card.entrants.map((e) => [e.id, e]));
  const field = result.order.length;
  for (const row of result.order) {
    const e = byId.get(row.id);
    if (!e) continue;
    e.form.starts++;
    if (row.position === 1) e.form.wins++;
    if (row.position <= 3) e.form.places++;
    e.form.recent.unshift(row.position);
    if (e.form.recent.length > 6) e.form.recent.length = 6;
    e.form.log.unshift({
      ground: ground.id,
      conditions: { ...ground.conditions },
      position: row.position,
      field,
      status: row.status,
    });
    if (e.form.log.length > LOG_KEEP) e.form.log.length = LOG_KEEP;
  }
  if (SKINS[ground.skin].mode === 'bout' && result.winner) {
    for (const row of result.order) {
      if (row.position === 1) continue;
      const e = byId.get(row.id);
      if (!e) continue;
      e.hidden.grudge = e.hidden.grudge || {};
      e.hidden.grudge[result.winner] = clamp((e.hidden.grudge[result.winner] || 0) + 0.18, 0, 0.55);
    }
  }
  return card;
}

/** The rows a form book prints — public only, by construction. */
export function formBook(e, ground = null) {
  const rows = [
    ['rating', String(e.form.rating)],
    ['record', `${e.form.wins}-${e.form.places}-${e.form.starts}`],
    ['recent', e.form.recent.length ? e.form.recent.join('') : '—'],
  ];
  if (ground) {
    for (const p of formStrength(e, ground, { hidden: false }).parts) {
      if (p.seen) rows.push([p.label, p.delta > 0 ? `+${p.delta}` : String(p.delta)]);
    }
    const read = readForm(e, ground);
    if (read.confidence > 0) rows.push(['on this going', `${read.bonus > 0 ? '+' : ''}${round2(read.bonus)} (${read.starts} starts read)`]);
  }
  return rows;
}

/**
 * RESEARCH — recovering a hidden term from the public log.
 *
 * This is the function the whole "a good better will probably make money"
 * argument stands on, and it is deliberately NOT told anything. It reads
 * `form.log`, which is results and weather and nothing else, splits the starts
 * by whether the going was like today's, and compares how the entrant finished
 * relative to its field in each half.
 *
 * `normalised position` is `(position - 1) / (field - 1)`, so 0 is a win and 1
 * is last, and the difference between the two halves is a signed estimate of a
 * term nobody published. It is noisy — that is what `confidence` is for, and
 * the harness's form-reading bettor shrinks its estimate by it rather than
 * trusting a two-start sample, which is exactly what a real punter does with a
 * horse that has run twice in the wet.
 */
export function readForm(e, ground) {
  const S = SKINS[ground.skin];
  const log = e.form.log || [];
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  let bonus = 0, confidence = 0, starts = 0, dims = 0;
  for (const d of S.read) {
    const hereHigh = (ground.conditions[d.key] || 0) >= d.at;
    const like = [], unlike = [];
    for (const row of log) {
      const rowHigh = (row.conditions?.[d.key] || 0) >= d.at;
      /* 0 is a win and 1 is last, whatever the field size — a fourth of eight
       * and a second of three are not the same run and must not read as one. */
      const score = row.field > 1 ? (row.position - 1) / (row.field - 1) : 0.5;
      (rowHigh === hereHigh ? like : unlike).push(score);
    }
    if (like.length < 2 || unlike.length < 2) continue;
    /* Shrunk toward nothing by the SMALLER of the two samples: two starts is a
     * rumour, twelve is a fact, and a split with nothing on one side of it is
     * not a split at all. */
    const n = Math.min(like.length, unlike.length);
    const shrink = n / (n + 4);
    bonus += (mean(unlike) - mean(like)) * d.k * shrink;
    confidence = Math.max(confidence, shrink);
    starts = Math.max(starts, like.length);
    dims++;
  }
  return { bonus, confidence: round2(confidence), starts, dims };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE WAGER — run-scoped, and this file keeps none of it
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * SETTLE A LIST OF STAKES AGAINST A RESULT THIS FUNCTION DID NOT PRODUCE.
 *
 * In, a list of `{ entrant, stake }` and a board. Out, a ledger. Nothing is
 * stored, nothing is read off a record, and there is no balance anywhere in
 * this file for a session to accumulate into — see the header. A stake on a
 * runner that is not on the card is refused rather than silently lost, because
 * a missing thing answered with a plausible default is how this tree has lost
 * three separate afternoons.
 */
export function settle(wagers = [], result = null, board = []) {
  const price = new Map(board.map((b) => [b.id, b.price]));
  const lines = [];
  let staked = 0, returned = 0;
  for (const w of wagers) {
    const id = w.entrant?.id || w.entrant || w.id;
    const stake = Math.max(0, Number(w.stake) || 0);
    if (!price.has(id)) throw new Error(`a stake was laid on ${id}, who is not on this card`);
    const won = result && result.winner === id;
    const back = won ? stake * price.get(id) : 0;
    staked += stake;
    returned += back;
    lines.push({ id, stake, price: price.get(id), won: !!won, returned: round2(back) });
  }
  return { staked: round2(staked), returned: round2(returned), net: round2(returned - staked), lines };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE WINDOW — the announcer reads the sim, not a script
 * ══════════════════════════════════════════════════════════════════════════ */

const LINES = {
  off: (n, ev) => `They're away — ${ev.field} on the card.`,
  lead: (n, ev, name) => `${n} goes to the front, ${name(ev.from)} loses it at ${ev.gate}.`,
  overtake: (n, ev, name) => `${n} takes ${name(ev.past)} at gate ${ev.gate}.`,
  wall: (n, ev) => `${n} into the wall at ${ev.gate} — still going.`,
  mechanical: (n) => `Something's let go on ${n}.`,
  retire: (n, ev) => `${n} is out — ${ev.cause}.`,
  knockdown: (n, ev, name) => `${name(ev.by)} puts ${n} down.`,
  refusal: (n) => `${n} won't go again. That's a refusal.`,
  wound: (n) => `${n} is cut and the crowd has seen it.`,
  beaten: (n, ev, name) => `${name(ev.by)} finishes ${n}.`,
  result: (n) => `And it's ${n}.`,
};

/**
 * ONE LINE FOR ONE EVENT, WITH THE ACTUAL ENTRANTS IN IT.
 *
 * The announcer is a reader over the sim's stream and holds no script of its
 * own — *"actual announcer, like imagine real event fights"* is only true if
 * the words follow the fight. An event this table has no line for returns null
 * rather than a filler line, so a new event type is silent instead of being
 * announced as the wrong thing.
 */
export function announce(ev, card) {
  const name = (id) => card.entrants.find((e) => e.id === id)?.name || 'the field';
  const fn = LINES[ev.type];
  if (!fn) return null;
  return fn(ev.who ? name(ev.who) : 'the field', ev, name);
}

/** Every moment a screen would be worth cutting to, in order. */
export const MOMENTS = Object.freeze(['lead', 'overtake', 'wall', 'mechanical', 'retire', 'knockdown', 'refusal', 'beaten', 'result']);
export const momentsOf = (result) => result.events.filter((e) => MOMENTS.includes(e.type));
