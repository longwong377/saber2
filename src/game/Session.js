/**
 * BATTLEFRONT BORZ — THE SESSION. One sitting, one deployment, one seed.
 *
 * FLAGSHIP.md §5, and it is the one part of the flagship mode that was never
 * built. The rungs under it all exist — a roster with names on it, five ranks,
 * permadeath, the muster's shelf and purse, gunships that put a line down —
 * and none of them is a RUN. A run is three things this file owns and nothing
 * else did:
 *
 *   HOW LONG IT IS       and that is a roll off the seed, not a constant.
 *   WHAT YOU ARE TOLD    before you land, which is the deploy card.
 *   THE QUIET BETWEEN    which is the muster's interlude.
 *
 * ── WHY IT IS A LEAF ────────────────────────────────────────────────────
 *
 * Nothing here imports Command.js. Every function takes the ground, the log or
 * the roll as an argument and returns a plain record, which is what lets
 * `CommandDirector` call `rollSession`/`planStages` from its constructor and
 * lets `Menu` call `deployCard`/`interludeBeats` without either of them
 * reaching through the other. The direction is Command → Session and UI →
 * Session; there is no edge back, and `tools/checks/session.mjs` asserts it,
 * because the day this file imports Command.js is the day the director cannot
 * import it any more.
 *
 * ── AND WHY THE ROLL HAS ITS OWN STREAM ─────────────────────────────────
 *
 * `Command.js` has a module `rng` that `seedCommand` puts on the run's number,
 * and every name in the roster comes off it in order. A length roll drawn from
 * that stream would shift every designation after it by one draw, so the same
 * seed would muster the same men under different names the day this file was
 * added. `rollSession` is a pure hash of the seed instead: it consumes nothing,
 * it can be asked twice, and it can be asked before the roster exists — which
 * is exactly what the deploy card needs, since the card is drawn before the
 * first gunship lifts.
 */

/**
 * THREE LENGTHS, AND THE LENGTH IS PART OF THE SEED.
 *
 * §5: "Length is itself a seed roll: Raid (2 engagements, 10–15 min) · Push
 * (3, 18–25) · Grind (5, 30–45)."
 *
 * The reason a length is rolled rather than chosen is the same reason the
 * ground is: a session you can pick the shape of is a session you will pick
 * the same shape of, and the mode's subject is a roster you did not compose
 * meeting a fight you did not choose. It is also the cheapest honest answer to
 * the "20–40 minutes" promise — a fixed five areas is 30–45 on its own, so the
 * mode as it stood could only ever deliver the top of its own range.
 *
 * `weight` is the share of seeds that draw this plan and the middle is heavier
 * on purpose: the Push is what §1's five lines describe (three engagements,
 * 18–25 min, the centre of the stated 20–40) and the Raid and the Grind are
 * the ends of it. 1:2:1 rather than 1:1:1 so that the shape a player learns
 * the mode on is the shape the mode is about.
 *
 * `minutes` is the DESIGN band from §5, printed on the deploy card as a
 * promise. It is not measured here and must not be: what a fight costs in
 * wall-clock is a fact about how the player fights it, and a card that
 * predicted 22 minutes and delivered 34 would be worse than one that says
 * 18–25 and means "this is a Push".
 */
export const SESSION_PLANS = [
  {
    id: 'raid', name: 'Raid', engagements: 2, minutes: [10, 15], weight: 1,
    blurb: 'In, hold twice, out. The line you land with is very nearly the line you leave with.',
  },
  {
    id: 'push', name: 'Push', engagements: 3, minutes: [18, 25], weight: 2,
    blurb: 'Three engagements across one ground. Long enough that the roll changes; short enough that every name on it is one you will still recognise.',
  },
  {
    id: 'grind', name: 'Grind', engagements: 5, minutes: [30, 45], weight: 1,
    blurb: 'The whole crossing. Nobody who lands with you is guaranteed to be standing at the end of it.',
  },
];

export const PLAN_IDS = SESSION_PLANS.map((p) => p.id);

/** The plan a run with no seed gets. See `rollSession`. */
export const DEFAULT_PLAN = SESSION_PLANS[SESSION_PLANS.length - 1];

/**
 * WHICH LENGTH THIS SEED IS.
 *
 * A pure hash — the same avalanche `seedCommand` uses, on a different constant
 * so a run's length and a run's names are not the same draw wearing two hats.
 * Consumes no stream and can be asked as many times as anything likes.
 *
 * A SEEDLESS RUN IS A GRIND, and that is not a fallback, it is the honest
 * answer: `null` means nobody has stated a number, which is every headless
 * check that builds a director by hand and every caller that predates the
 * seed. Those all want the crossing that was there before this file, so they
 * get it — the five areas, unchanged, byte for byte.
 */
export function rollSession(seed) {
  if (seed === null || seed === undefined || !Number.isFinite(Number(seed))) return DEFAULT_PLAN;
  const h = (Math.imul((Number(seed) | 0) ^ 0x1b873593, 0x85ebca6b) >>> 0) ^ 0x2f7c9a11;
  const total = SESSION_PLANS.reduce((n, p) => n + p.weight, 0);
  let t = (h >>> 8) % total;
  for (const p of SESSION_PLANS) { t -= p.weight; if (t < 0) return p; }
  return DEFAULT_PLAN;
}

/**
 * THE GROUND A PLAN CROSSES, out of the ground the mode has.
 *
 * §3's first convergence is ONE GROUND, so a shorter session is not a
 * different place — it is fewer stops across the same one. The rule is two
 * clauses and both of them matter:
 *
 *   THE FIRST STAGE IS ALWAYS THE FIRST. You come down in the open and form up,
 *   whatever the length. That is 0:12 in §5 and it is the same landing every
 *   time.
 *
 *   THE LAST STAGE IS ALWAYS THE LAST. A Raid that stopped at stage two would
 *   end on a brief that says "two kilometres of flat ochre" and call it a
 *   victory. Every plan ends on the ground the campaign's ending was written
 *   for, which is also what keeps `_endCampaign` a single door: `lastArea` is
 *   still "the end of the list", the list is just shorter.
 *
 * Everything between is spread evenly, so a Push is the landing, the middle
 * and the end rather than the first three. Rounded rather than floored: with
 * five stages and three engagements that is indices 0, 2, 4 — floor would give
 * 0, 1, 4 and put two openings in a row.
 *
 * Pure, and it takes the stage list as an argument: this file does not know
 * what an area is, and `tools/checks/session.mjs` drives it against lists of
 * other lengths for exactly that reason.
 */
export function planStages(plan, stages) {
  const all = Array.isArray(stages) ? stages : [];
  const n = Math.max(1, Math.min(plan?.engagements | 0 || 1, all.length));
  if (!all.length) return [];
  if (n === 1) return [all[all.length - 1]];
  const out = [];
  for (let i = 0; i < n; i++) out.push(all[Math.round((i * (all.length - 1)) / (n - 1))]);
  return out;
}

/**
 * THERE IS NO HOST MIGRATION, AND THE CARD SAYS SO.
 *
 * §9: "Host drop still ends the session. There is no host migration and
 * `main.js` says there is not going to be one. **Say so on the card.**"
 *
 * The sentence lives here rather than in the markup because two places say it
 * — the deploy card at 0:00 and `main.js`'s `net.on('closed')` when it
 * actually happens — and a warning whose two halves can drift is a warning
 * that will eventually promise something the code does not do.
 */
/**
 * WHICH GROUND THIS SEED IS — FLAGSHIP §5 and §13.5.
 *
 * §5: "One sitting = one deployment = one seed = one ground." §1: "One planet,
 * one ground, one sitting." And §13.5, which is the one that makes it
 * load-bearing rather than flavour: "**No room's deletion deletes the mode** —
 * every level in `LEVEL_ORDER` is a legal seed. That is exactly what killed the
 * Descent."
 *
 * The Descent was a ladder of four authored rooms, three of which the player
 * named as the worst rooms in the game, so deleting those rooms deleted the
 * mode. A mode that rolls its ground off the seed cannot die that way: it is
 * the roster of grounds that is the content, not any one of them, and a ground
 * removed is a draw that no longer comes up.
 *
 * WHY IT IS A ROLL AND NOT A PICK, which is the same argument `rollSession`
 * makes about the length: a sitting you choose the ground of is a sitting you
 * will choose the same ground of, and the mode's subject is a roster you did
 * not compose meeting a fight you did not choose. It is also what makes the
 * deploy card worth reading — §5's 0:00 beat is "the seed, the ground, and your
 * ten names, readable before you land", and two of those three are only news
 * if nobody typed them.
 *
 * A PURE HASH, on its own constant, for the reason `rollSession`'s note gives
 * at length: a draw taken from `Command.rng` would shift every designation in
 * the roster by one and mint the same seed's men under different names. This
 * consumes nothing and can be asked before anything exists — which the menu
 * needs, because the column is greyed with the answer on it.
 *
 * @param {number|null} seed the run's number
 * @param {string[]} keys the grounds the mode can take, in a stable order
 * @returns {string|null} one of `keys`, or null when there is no seed to roll
 */
export function rollGround(seed, keys) {
  if (!Array.isArray(keys) || !keys.length) return null;
  if (seed === null || seed === undefined || !Number.isFinite(Number(seed))) return null;
  /* The same avalanche the length roll uses, on a THIRD constant — `seedCommand`
   * has its own and `rollSession` has its own, and two of the three sharing one
   * would tie a run's ground to its length: every Raid on the same ground. */
  const h = (Math.imul((Number(seed) | 0) ^ 0x27d4eb2f, 0xc2b2ae35) >>> 0) ^ 0x9e3779b9;
  return keys[(h >>> 9) % keys.length];
}

export const NO_HOST_MIGRATION =
  'The host owns this session. If they drop, the run ends — there is no host migration.';

/**
 * THE DEPLOY CARD — §5's 0:00, and the whole of what it is for.
 *
 * "The seed, the ground, and **your ten names, readable before you land**."
 *
 * The names are the load-bearing half. §3's fourth convergence is that the
 * name list is the mode's second one-way variable — it only shrinks, it is on
 * the HUD always, and it needs no scenery — and a list that only shrinks has
 * to have been READ once at full length or there is nothing for a casualty to
 * be measured against. Everything else on the card (the seed, the plan, the
 * ground) is context for that list.
 *
 * Assembles a record and draws nothing: the same split `musterOffer` /
 * `showMuster` has, and for the same reason — a card that computed its own
 * numbers would be a second authority for what a run is, and §2.3 has cost
 * this repository eight of those.
 *
 * @param {object} io
 * @param {number|null} io.seed     `world.runSeed`.
 * @param {object} io.plan          from `rollSession`.
 * @param {object} io.stages        the stage records `planStages` chose.
 * @param {string} io.ground        the level's name.
 * @param {object} io.roster        `CommandRoster.summary()`, verbatim.
 * @param {boolean} io.networked    is anybody else in this session.
 */
export function deployCard(io = {}) {
  const plan = io.plan || DEFAULT_PLAN;
  const stages = Array.isArray(io.stages) ? io.stages : [];
  const roll = (io.roster?.roll || []).filter((t) => t.alive);
  return {
    /** The number, as the record prints it and the seed box takes it back. */
    seed: Number.isFinite(Number(io.seed)) ? (Number(io.seed) | 0) >>> 0 : null,
    plan: plan.id,
    planName: plan.name,
    /* The promise, from §5's own table. See SESSION_PLANS.minutes. */
    length: `${plan.engagements} engagement${plan.engagements === 1 ? '' : 's'} · ${plan.minutes[0]}–${plan.minutes[1]} min`,
    blurb: plan.blurb,
    ground: io.ground || '',
    /* Where you land, and it is the first stage's own brief — the same string
     * the muster prints when it hands you the next one, so the card and the
     * muster cannot describe the same ground differently. */
    stage: stages[0]?.name || '',
    stageBrief: stages[0]?.brief || '',
    stages: stages.map((s) => s.name),
    army: io.roster?.army ?? null,
    /** The names, living only — nobody has fallen yet and the card is a roll,
     *  not a memorial. Order is the roster's, which is the order they enlisted
     *  in and therefore the order they will stand in. */
    roll: roll.map((t) => ({ name: t.name, unit: t.unit, rank: t.rankTitle })),
    strength: roll.length,
    /* Said always, not only in a session: a player who is about to invite
     * somebody has to know it before they invite them, and a player alone has
     * to know why the option is not offered. */
    hostNote: io.networked ? NO_HOST_MIGRATION : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The interlude                                                         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE QUIET BETWEEN ENGAGEMENTS — §5, and it is a quotation:
 *
 *   "Between engagements: the muster. 60–90 s. Points in, bodies out, the roll
 *   of who lived, who was promoted, and who is on the fallen list. **This quiet
 *   is where the run becomes a story. It must be real and it must have no
 *   input.**"
 *
 * The muster screen has existed for a while and it is a SHOP: a shelf, a purse
 * and the roll, all four numbers on screen at once, the instant the area ends.
 * That is the right screen for the decision and it is the wrong screen for the
 * sentence above, because everything that happened in the engagement you have
 * just fought arrives already summed. Six men held; two did not; one of them
 * was the sergeant you had been protecting for three areas — and all of that
 * is one number changing from 9 to 7 in a corner.
 *
 * So the interlude is the same screen, opened SLOWLY, one fact at a time,
 * before the shelf is live. It is a reveal and not an animation: every beat is
 * read off `director.log`, which is the ledger the mode has always written —
 * `fell`, `promote`, `steps-up`, `broke`, `area` — so there is nothing here to
 * disagree with the roster, and a beat cannot be shown for something that did
 * not happen.
 *
 * ── "IT MUST HAVE NO INPUT", AND WHAT THAT DOES NOT MEAN ────────────────
 *
 * It means the muster takes none: the shelf is inert, Advance is disabled, and
 * a click buys nothing until the last beat has landed. It does NOT mean the
 * player is locked in a room. `Screens` rule 1 is that Escape is never a dead
 * key, and it holds here unchanged — the interlude is an ordinary overlay
 * state and Escape still raises the pause card over it. A quiet you cannot
 * leave is not a quiet, it is a freeze, and this repository has a whole module
 * (`src/ui/Screens.js`) that exists because of one.
 *
 * ── HOW LONG ───────────────────────────────────────────────────────────
 *
 * §5 says the muster is 60–90 s. That is the WHOLE muster — the reveal plus
 * the decision it exists to inform — and the split is deliberate: the reveal
 * is bounded and the shopping is not, because "should this be my third heavy
 * or my first ARC" is the one thing in the mode that is allowed to take as
 * long as it takes.
 *
 * The reveal's own length is derived rather than fixed, because a quiet
 * engagement and a massacre are not the same story and should not take the
 * same time to tell: the header, then a beat per casualty, per promotion and
 * per battlefield commission, then the tally. `INTERLUDE.window` clamps the
 * total, so a wipe that puts nine names on the fallen list does not hold the
 * screen for a minute and a half.
 */
export const INTERLUDE = Object.freeze({
  /** The area's own name, and the pause before anything is said about it. */
  head: 2.2,
  /** One casualty. The longest beat there is, because it is the one that matters. */
  fell: 1.5,
  /** A promotion, and the man who took a dead sergeant's squad. */
  promote: 1.15,
  stepsUp: 1.15,
  /**
   * A SQUAD THE GENERAL HANDED TO SOMEBODY AND WALKED AWAY FROM.
   *
   * Shorter than a promotion because there may be several in one engagement and
   * because it is a thing the player DID rather than a thing that happened to
   * him — the report's job here is to say it back, not to dwell on it.
   */
  delegate: 0.95,
  /**
   * AN ORDER FROM ABOVE, AND WHAT THE PLAYER DID WITH IT.
   *
   * As long as a casualty when it caught your own men and as short as a
   * delegation when it did not — the beat is written once and the LENGTH is
   * what says which, because a report that spends the same second and a half
   * on "you cleared a grid with nobody in it" as on "you cleared a grid with
   * three of yours in it" is a report that has no opinion.
   */
  mission: 1.5,
  /** Points in, bodies standing. The last two beats before the shelf lights. */
  tally: 1.4,
  /** Total seconds, clamped. See the note above. */
  window: [6, 26],
});

/**
 * THE BEATS OF ONE INTERLUDE, in the order they are told.
 *
 * Reads the director's own log and nothing else. `since` is the index the log
 * had reached when the engagement began, so the slice is exactly this
 * engagement — `CommandDirector` records it at the top of every area, which is
 * one integer and is the only state this whole feature adds to the director.
 *
 * The order is not chronological and that is the point: the DEAD FIRST, then
 * who came up behind them, then what the ground paid. Chronological order
 * would interleave a promotion at wave two with a death at wave four and read
 * as a feed. This reads as a report, which is what a muster is.
 *
 * @param {Array} log      `director.log`.
 * @param {number} since   the log length when the engagement started.
 * @param {object} area    the stage record just held.
 * @param {object} tally   `{ points, got, strength, max }`.
 */
/**
 * A BEARING IN DEGREES, AS A THING A PLAYER CAN PICTURE.
 *
 * Eight points and not sixteen: the report is read once, at speed, and the
 * difference between "east" and "east-north-east" is not a difference anybody
 * acts on. See the `fell` beat.
 */
const POINTS = ['north', 'north-east', 'east', 'south-east',
                'south', 'south-west', 'west', 'north-west'];
export function compass(deg) { return POINTS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }

/**
 * ONE MAN'S LINE ON THE AFTER-ACTION REPORT — PLAN.md §4.9.
 *
 * "Who killed whom, from what direction, at what minute. No death is
 * mysterious, so no death is the AI's fault."
 *
 * EXPORTED AND SHARED, because the same sentence is now said twice: once
 * between engagements by `interludeBeats`'s `fell` beat, and once at the end of
 * the run by the death card's roll. Two renderings of one record would
 * eventually disagree about a man — one saying "by a B2" and the other "by a
 * super battle droid", or one rounding a minute the other floors — and a report
 * that contradicts itself is worse than no report, because the player cannot
 * tell which half to argue with.
 *
 * EVERY CLAUSE IS CONDITIONAL ON THE LOG ACTUALLY KNOWING IT. A death with no
 * source — a fall, a bleed-out with nothing near — says only when, which is the
 * honest answer; inventing a killer would be exactly the mystery this removes,
 * and it is the same defect as the "Areas taken 5" that `World.runStats` was
 * written to end.
 */
export function fellLine(e) {
  const bits = [];
  if (e?.rank) bits.push(e.rank);
  if (e?.unit) bits.push(e.unit);
  if (e?.killer) bits.push(`by ${e.killer}`);
  if (e?.bearing != null) bits.push(`from the ${compass(e.bearing)}`);
  if (e?.at != null) bits.push(`at ${Math.floor(e.at / 60)}:${String(Math.floor(e.at % 60)).padStart(2, '0')}`);
  return bits.join(' · ');
}

/** 0 -> "1st", 1 -> "2nd" — a squad's name when nobody is left to name it after. */
function ordinal(i) {
  const n = (i | 0) + 1;
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

export function interludeBeats(log, since, area, tally = {}) {
  const slice = (Array.isArray(log) ? log : []).slice(Math.max(0, since | 0));
  const beats = [];
  const at = (kind, text, sub, hold, own) => beats.push({ kind, text, sub: sub || '', hold, own: !!own });

  at('head', `${(area?.name || 'The ground').toUpperCase()} — HELD`, area?.brief || '', INTERLUDE.head);

  const fell = slice.filter((e) => e.t === 'fell');
  for (const e of fell) {
    /* His own words off the ledger — the rank he died holding, what he cost
     * them, and the area. `_deathOf` wrote all three when it happened. */
    /* THE SAME SENTENCE THE DEATH CARD'S ROLL SAYS — see `fellLine`. */
    at('fell', e.name, fellLine(e), INTERLUDE.fell);
  }
  /* A CLEAN ENGAGEMENT IS STILL A BEAT, AND IT IS NOT A CASUALTY. Its own kind
   * rather than an empty `fell`: the fallen beat is the only red on the screen
   * and the only one that makes a noise, and "everybody lived" wearing that
   * costume would sound like a death every time nobody died. */
  if (!fell.length) at('none', 'No names on the list', 'Everyone who landed is still standing', INTERLUDE.fell);

  for (const e of slice.filter((x) => x.t === 'steps-up')) {
    at('steps-up', e.name, `takes the squad after ${e.after}`, INTERLUDE.stepsUp);
  }
  for (const e of slice.filter((x) => x.t === 'promote')) {
    at('promote', e.name, `promoted — ${e.rank}`, INTERLUDE.promote);
  }
  /**
   * WHAT YOU GAVE AWAY, said back to you.
   *
   * A standing order is the one thing in this mode that happens while the
   * player is looking somewhere else, so it is the one thing the report can
   * tell him he did not see. Deduplicated by squad and only the LAST order each
   * squad was given: a player who moves 2nd Squad three times gave 2nd Squad
   * one job, and three beats about it would read as three squads.
   */
  /**
   * WHAT HIGH COMMAND ASKED FOR AND WHAT YOU SAID — PLAN.md §1.
   *
   * ABOVE the delegations and below the dead, deliberately: the names come
   * first because they are what the report is for, and this beat is the line
   * that JOINS them to a decision. A player reading "CT-4460 — by your own fire
   * mission" three beats above "GRID F42 — CLEARED, unverified" has been told
   * exactly what happened and by whom, which is §4.9's whole claim ("no death
   * is mysterious, so no death is the AI's fault") applied to the one death in
   * this game that is nobody's fault but the player's.
   *
   * The sub-line never editorialises. It says what was in the mark and whether
   * the player had looked, and the two together are the judgement.
   */
  for (const e of slice.filter((x) => x.t === 'mission')) {
    if (e.lapsed) {
      at('mission', `GRID ${e.grid} — WAVED OFF`,
        `${e.told} hostile${e.told === 1 ? '' : 's'} estimated · you let the window close`,
        INTERLUDE.mission);
      continue;
    }
    const bits = [e.verified ? 'you read it first' : 'fired on their estimate'];
    if (e.friendlies > 0) {
      bits.push(`${e.friendlies} of yours ${e.friendlies === 1 ? 'was' : 'were'} inside it`);
      if (e.names?.length) bits.push(e.names.join(', '));
    } else bits.push(`${e.hostiles | 0} hostile${(e.hostiles | 0) === 1 ? '' : 's'}, none of yours`);
    at('mission', `GRID ${e.grid} — CLEARED`, bits.join(' · '), INTERLUDE.mission,
      e.friendlies > 0);
  }
  const held = new Map();
  for (const e of slice.filter((x) => x.t === 'delegate')) held.set(e.squad | 0, e);
  for (const e of held.values()) {
    at('delegate', e.name || `${ordinal(e.squad | 0)} Squad`,
      `held the ground on their own — ${e.n} ${e.n === 1 ? 'man' : 'men'}`, INTERLUDE.delegate);
  }

  at('tally', `+${tally.got | 0} reinforcement points`, `${tally.points | 0} in hand`, INTERLUDE.tally);
  at('tally', `${tally.strength | 0} standing`, tally.max ? `of ${tally.max | 0} you may field` : '', INTERLUDE.tally);

  /* THE CLAMP IS A SCALE, NOT A TRUNCATION. A wipe with nine casualties has
   * nine beats and every one of them is a name the player is owed; dropping
   * the tail would hide exactly the run that most needs telling. So the beats
   * all stay and their holds are scaled together to fit the window, which
   * makes a long report faster rather than shorter. */
  const raw = beats.reduce((n, b) => n + b.hold, 0);
  const [lo, hi] = INTERLUDE.window;
  const scale = raw > hi ? hi / raw : raw < lo ? lo / raw : 1;
  let t = 0;
  for (const b of beats) { b.hold = Math.round(b.hold * scale * 1000) / 1000; b.at = Math.round(t * 1000) / 1000; t += b.hold; }
  return { beats, seconds: Math.round(t * 1000) / 1000 };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The after-action report — PLAN.md §4.9                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE THING §4.9 ASKED FOR AND THE ONE PART OF IT NOTHING DREW.
 *
 * "The after-action report — who killed whom, from what direction, at what
 * minute. No death is mysterious, so no death is the AI's fault."
 *
 * The RECORD has been complete for a while: `_deathOf` writes a killer, a
 * bearing and a minute at the moment it happens, `fellLine` renders one man,
 * and two screens already say some of it. Neither says the run.
 *
 *   THE INTERLUDE says ONE ENGAGEMENT, at the muster, once. It is a reveal —
 *   it holds each beat for a second and a half and then it is gone, and by
 *   area four the three men you lost in area one are not on any screen in the
 *   game.
 *   THE DEATH CARD says the NAMES, over the whole run, and only the names: a
 *   flat roll with no ground under it, drawn at the one moment the player is
 *   least able to use it, because the run is over.
 *
 * So what is missing is not a renderer, it is the WHOLE: the run in areas, the
 * areas with their dead in them, and — the part no other screen in this game
 * can say at all — WHAT HAS BEEN KILLING THEM.
 *
 * ── WHY THE CENSUS IS THE HEAD OF IT ────────────────────────────────────
 *
 * §7 says an element earns its place by changing a decision. A list of the
 * dead does not; it is owed to the player and it is already paid twice over.
 * The census does, and it is the reason this is a screen rather than a longer
 * roll:
 *
 *   "Eleven of your men are dead. Seven of them to B2s, and three to your own
 *   fire missions."
 *
 * That is the muster's next purchase and the next order both, in one line, and
 * it is not derivable from anything else on screen — the interlude never
 * aggregates, the roll never counts, and the man who reads "by a B2" six times
 * across four musters twenty minutes apart does not add them up. Reading it is
 * what makes a player buy the heavy he has been skipping, or stop calling
 * artillery onto ground his own line is walking into.
 *
 * ── AND YOUR OWN SIDE IS COUNTED SEPARATELY ─────────────────────────────
 *
 * §4.9's sentence is about the AI's fault. Its sharp end is the deaths that are
 * NOT the AI's: `killerName` already returns "you" for the player, "your own
 * fire mission" for High Command's shells, and a trooper's own name for the
 * man who shot his mate. Those are the entries a report exists to make
 * unmissable, so they are split out rather than sorted in among the droids
 * where a long list would bury them.
 *
 * A trooper is recognised by being ON THIS RUN'S ROLL — every name the log has
 * ever mentioned as one of yours — and not by a name pattern. Designations come
 * off the army table and a match on "CT-" would be a rule about one army.
 *
 * ── IT READS THE LOG AND NOTHING ELSE ───────────────────────────────────
 *
 * The same discipline `interludeBeats` is written under, for the same reason: a
 * report that consults the live roster would disagree with itself the moment a
 * man is bought after the area he is being reported on. Everything below is a
 * projection of entries the director already wrote, so a beat cannot be shown
 * for something that did not happen, and a run with an empty log reports an
 * empty run rather than throwing.
 *
 * @param {Array} log `director.log`.
 */
export function runReport(log) {
  const entries = Array.isArray(log) ? log : [];

  /**
   * WHOSE MEN THIS REPORT IS ABOUT.
   *
   * `CommandDirector.onDeath` routes EVERY commander's dead into one log, and
   * `formUp` builds a second commander for the other army — so in a meeting the
   * ledger holds both rolls. Entries written by the local commander carry
   * `mine: true`; anything from before that field existed carries nothing and
   * is read as ours, which is right for every mode with one army in it.
   */
  const mineEntry = (e) => e?.mine !== false;

  /**
   * WHO IS ONE OF YOURS, over the whole run and before any area is read.
   *
   * TWO REASONS IT IS A WHOLE-LOG PASS. A man can be killed in area two by a
   * trooper who is not enlisted until area three's muster, so a single forward
   * pass would call his killer a droid — and `muster` names the roll a campaign
   * is HANDED, which is written once at the top and would otherwise not be
   * consulted until somebody on it died.
   */
  const ours = new Set();
  for (const e of entries) {
    if (!mineEntry(e)) continue;
    if (e?.name && (e.t === 'enlist' || e.t === 'fell' || e.t === 'promote'
                    || e.t === 'commend' || e.t === 'steps-up' || e.t === 'broke')) ours.add(e.name);
    if (e?.t === 'steps-up' && e.after) ours.add(e.after);
    /* THE OPENING TEN, AND A JOINING PLAYER'S SQUAD. `recruit` logs an `enlist`
     * and is the only thing that did, so the men a campaign is handed were on
     * nobody's list until one of them died — and the first friendly-fire death
     * of a run was therefore filed among the droids. See `_logRoll`. */
    if (e?.t === 'muster' && Array.isArray(e.names)) for (const n of e.names) ours.add(n);
    if (e?.t === 'mission' && Array.isArray(e.names)) for (const n of e.names) ours.add(n);
  }
  /** Did your own side do this? `killerName`'s two constants, or a man on the roll. */
  const mine = (killer) => !!killer && (killer === 'you' || killer === 'your own fire mission' || ours.has(killer));

  /**
   * THE AREAS, CUT ON THE LOG'S OWN TERMINATORS rather than on the `area`
   * field. `mission` is the one entry in the ledger with no area number on it —
   * `FireMission._log` writes what was in the mark and nothing about where the
   * run had got to — and grouping on the field would drop every fire mission
   * out of the report, which is precisely the entry §4.9 is sharpest about.
   * `_areaClear` and `_checkLine` both close an area with one entry, so cutting
   * on those two puts every entry in the engagement it happened in, numbered or
   * not.
   */
  const areas = [];
  let cur = null;
  const open = () => (cur = { n: null, name: '', held: null, strength: null, fallen: null,
                              fell: [], up: [], missions: [], why: '', saw: false });
  open();
  for (const e of entries) {
    if (!e || !e.t) continue;
    /* AN ENTRY IS AN ENGAGEMENT HAPPENING, whether or not this report draws it.
     * `saw` is what lets an area the player is standing in — orders given, a
     * position dug, nobody dead yet — be reported as in progress instead of
     * silently dropped, which is the state the pause card is opened in most. */
    cur.saw = true;
    if (cur.n == null && Number.isFinite(e.area)) cur.n = e.area | 0;
    if (e.t === 'fell') { if (mineEntry(e)) cur.fell.push(e); }
    else if (e.t === 'steps-up' || e.t === 'promote' || e.t === 'commend') {
      if (mineEntry(e)) cur.up.push(e);
    } else if (e.t === 'mission') cur.missions.push(e);
    else if (e.t === 'area' || e.t === 'lost' || e.t === 'won') {
      cur.n = Number.isFinite(e.area) ? e.area | 0 : cur.n;
      cur.name = e.name || cur.name;
      /* `won` and `lost` from `_endCampaign` close the RUN, and it pushes one
       * the instant after `_areaClear` has already pushed the area's own entry
       * — so the bucket they close is usually empty and unnamed, and pushing it
       * would put a nameless row on the end of every finished campaign. A
       * bucket earns a row by having a name or something in it. */
      cur.held = e.t !== 'lost';
      cur.strength = Number.isFinite(e.strength) ? e.strength | 0 : null;
      cur.fallen = Number.isFinite(e.fallen) ? e.fallen | 0 : null;
      cur.why = e.why || '';
      if (cur.name || cur.fell.length || cur.up.length || cur.missions.length) areas.push(cur);
      open();
    }
  }
  /* THE ENGAGEMENT THE PLAYER IS STANDING IN counts, and is not closed. A
   * report raised from the pause card mid-area is the case this exists for:
   * `held` stays null, which is a third state and not a lost area, and the
   * screen says "in progress" rather than inventing an outcome. */
  if (cur.saw) areas.push(cur);

  const fell = [];
  for (const a of areas) for (const e of a.fell) fell.push({ ...e, areaName: a.name });

  /**
   * THE CENSUS. Sorted by count and then by name, so the same run always
   * reports the same order — a table that reshuffles between two openings of
   * the same screen is a table the player stops trusting.
   */
  const by = new Map();
  let unknown = 0;
  for (const e of fell) {
    const k = e.killer;
    if (!k) { unknown++; continue; }
    const row = by.get(k) || { killer: k, n: 0, own: mine(k) };
    row.n++;
    by.set(k, row);
  }
  const census = [...by.values()].sort((a, b) => b.n - a.n || (a.killer < b.killer ? -1 : 1));

  return {
    areas,
    fell,
    census,
    /** Deaths with no source at all — a fall, a bleed-out with nothing near. */
    unknown,
    /** How many of your own you killed, all three ways, added up. */
    own: census.reduce((n, r) => n + (r.own ? r.n : 0), 0),
    lost: fell.length,
    held: areas.filter((a) => a.held === true).length,
    /** Null while the run is still being fought — see the open area above. */
    ended: areas.length ? (areas[areas.length - 1].held === false ? 'lost'
                          : areas[areas.length - 1].held === true ? 'held' : null) : null,
  };
}
