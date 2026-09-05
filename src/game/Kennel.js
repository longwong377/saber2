/**
 * ══════════════════════════════════════════════════════════════════════════
 *  BATTLEFRONT BORZ — THE KENNEL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "if they surive they need to persist between runs/games like your troops do"
 *
 * ── WHY THIS IS ITS OWN STORE AND NOT A FIELD ON THE COMPANY ──────────────
 *
 * `Company.js` is keyed by ARMY. `load()` keys on army, and `keep()` refuses a
 * foreign manifest outright (Company.js:683) — the roll belongs to the force
 * you fight for. A companion belongs to the PLAYER: he takes the same animal
 * into a Republic campaign and a Separatist skirmish, and it is the same
 * animal. Hanging it off the army record would mean either twelve records for
 * one dog or reopening the one refusal that keeps the two rolls honest.
 *
 * So: Company.js's SHAPE is copied and Company.js is NOT extended. Same store
 * policy, same clamp-on-the-way-in discipline, same field whitelist on the way
 * out, same fallen list. A different key and a different owner.
 *
 * ── THE TWO SCANS THAT DO NOT SEE THIS FILE, EXTENDED ON THIS COMMIT ──────
 *
 * `tools/checks/company.mjs` runs the six-word currency scan
 * (points|currency|purchase|upgrade|unlock|buy) on Company.js and Muster.js BY
 * PATH; `session.mjs` counts `localStorage.setItem` inside five NAMED files.
 * A new file is invisible to both and therefore legal by default, and
 * COMPANY.md:377 already states the rule for exactly this class of silence:
 * "That silence is a hazard, not a permission."
 *
 * Both scans are extended to this file and to Companions.js on the commit that
 * creates them, or the next person adds a currency here and nothing goes red.
 * This is the single most important sentence in the file.
 *
 * ── AND THERE IS NO ATOMIC MULTI-KEY WRITE ────────────────────────────────
 *
 * Store.js writes one JSON object under one key, so a fold that touches the
 * roll and the Kennel is two independent `setItem` calls, either of which can
 * be refused alone. The mitigation is ordering, stated rather than hoped for:
 * the companion fold runs FIRST and INDEPENDENTLY, so a partial failure costs
 * a companion record and never a man. The Kennel is the only writer of its key,
 * exactly as Company is of its.
 */
import { makeStore } from './Store.js';
import { markById } from './Command.js';
/* THE BODY PALETTE, and it is NOT the squad-mark palette. `PAINTS` is the
 * fifteen colours a chassis is painted in and `paintById` answers null for
 * "leave the chassis its own", which is exactly the default every companion
 * colour slot needs; `MARKS` is the nine squad marks and is right for the one
 * `mark` a companion wears. Two palettes because they are two things, and both
 * are the roll's own rather than a third copy. */
import { paintById } from './Bodies.js';
/* `cleanCallsign` is the roll's own name-cleaner and it already strips the six
 * characters five screens would otherwise have to escape correctly. One
 * cleaner in the tree — HANDOFF §2.4 — so it is imported and never copied,
 * even though this is the only thing this file takes from Company.js. */
import { cleanCallsign } from './Company.js';
import { COMPANION_KINDS, rungOf, stageOf, careOf, GROWTH_STAGES } from './CompanionKinds.js';

const KEY = 'saber.kennel.v1';

/**
 * THE STORE, with the same policy the roll uses and for the same reason: a
 * refused write is REMEMBERED for the life of the page rather than thrown away
 * under a comment saying losing a record is not a crash. It is not a crash and
 * it is worse than one — the animal stays on screen, the player keeps fighting
 * for it, and it is already gone.
 */
const STORE = makeStore(KEY);

/** True when a write has been refused. Every room that shows a companion reads this. */
export const notSaving = () => STORE.broken;

/**
 * HOW MANY LINES OF ITS OWN HISTORY THE RECORD KEEPS — the same cap the roll
 * uses, called rather than restated. Most of the felt growth lives here,
 * because it is the only layer that costs nothing: nothing that fights reads a
 * word of `story`.
 */
export const STORY_KEEP = 8;

/** How many epitaphs are kept. Short on purpose: a wall, not a ledger. */
export const FALLEN_KEEP = 6;

/**
 * HOW MANY TEMPERS ONE ANIMAL MAY WEAR AT ONCE, and it is the size of the
 * table rather than a number under it. It used to be 4 while the table had 4
 * rows, so it read as a cap and was in fact a no-op; the growth ladder's two
 * made it a real cap overnight, silently dropping whichever two the `Set`
 * happened to iterate last. A cap that only bites when somebody adds a row is
 * the worst kind, so it is stated: an animal may wear everything it has
 * genuinely earned, and the two pairs that contradict each other are kept
 * apart by `sheds` and not by a slice.
 */
export const TEMPERS_WORN = 6;

/**
 * ── THE TEMPERS ───────────────────────────────────────────────────────────
 *
 * Four earned, TWO-SIDED, shedding tempers, on the `bonded` precedent
 * (Attributes.js:325 — `earned: true` plus a real `sheds`).
 *
 * THEY LIVE HERE AND NOT IN Attributes.js, for two reasons that were both
 * checked rather than assumed. `attributes.mjs` requires every attribute id to
 * have a real sim consumer inside `enlistBody`, and a companion never enters
 * `enlistBody` at all. And `kindOfArmy` derives kind from an ARMY id a rancor
 * pup does not have, so `traitsFor` would deal a hawk the clone table.
 *
 * EACH SWINGS ONLY THE COMPANION'S OWN BEHAVIOUR NUMBERS — the five metres
 * and seconds `TEMPER_AXES` prices, each of which has a reader in the
 * simulation and is checked to have one. Not one of them is health, damage,
 * armour or pace: see COMPANION_RANKS' note on why no rung row carries a
 * multiplier at all. A temper that raised any of those four would be the
 * ladder's refusal reopened one table across.
 *
 * AND EVERY ONE IS PRICED NET ≤ 0. That is what "two-sided" has to mean to be
 * worth anything: the gain and the cost are both real, both felt, and the sum
 * is not a gift. `priceTemper` is the formula and the check drives it rather
 * than transcribing the numbers.
 */
export const TEMPERS = [
  {
    id: 'heeled', label: 'HEELED', earn: 'three runs at your heel',
    /* THE GAIN AND THE COST ARE THE SAME BEHAVIOUR READ FROM THE TWO ENDS,
     * which is the honest shape for this one: an animal that has learned to
     * come back is an animal that has learned not to go. */
    up: { recall: 3.0 }, down: { reach: 3.0 }, sheds: 'ranging',
    gain: 'returns to heel faster and from further',
    cost: 'will no longer range to a target past that tighter leash',
  },
  {
    id: 'scarred', label: 'SCARRED', earn: 'went down twice and lived',
    up: { hold: 1.5 }, down: { reach: 4.0 }, sheds: null,
    gain: 'slower to go down a second time in the same run',
    cost: 'breaks off an attack when it is hit',
  },
  {
    id: 'keen', label: 'KEEN', earn: 'twelve orders landed',
    /* THE ONE WHERE THE GAIN IS LITERALLY THE COST. Four more metres of reach
     * is four more metres from you when it is hurt, and the player's own
     * sentence for it — "which is exactly how it gets killed" — is not a
     * warning printed beside a free upgrade, it is the price. Priced on the
     * same axis at the same magnitude, so it nets to nothing: KEEN does not
     * make a companion better, it makes it braver. */
    up: { reach: 4.0 }, down: { exposure: 4.0 }, sheds: null,
    gain: 'acts sooner and takes a target a quarter further out',
    cost: 'which is exactly how it gets killed',
  },
  /**
   * ── THE TWO THE GROWTH LADDER EARNS, AND THEY ARE THE DRAWBACKS ─────────
   *
   * V15 §4 asks for drawbacks in as many words — "a companion that only ever
   * helps is a stat. A big one is slow and loud; a bonded one panics when it
   * is hurt" — and the shape that request has to take in this file is already
   * written above it. A drawback is not a fourth field and it is not a
   * negative multiplier: it is a TEMPER, two-sided, on the behaviour axes,
   * priced net <= 0 by the same formula, and shed by the same rule. So the
   * growth ladder does not get a penalty column; it earns tempers, exactly as
   * the deeds do, and every clause `companions: every temper costs at least
   * what it buys` already holds is holding these two the day they land.
   *
   * WHY THEY ARE NOT ON THE STAGE ROWS. `GROWTH_STAGES` is a gate table and
   * nothing else — two counts and a label — because a stage that carried its
   * own swing would be a second place that prices behaviour, unpriced against
   * this one and earned on a different clock. `earnedTempers` reads the stage
   * the way it reads `runs` and `downs`: as a fact about the record.
   */
  {
    id: 'heavy', label: 'HEAVY', earn: 'grown to its full size',
    /* THE PLAYER'S OWN SENTENCE — "a big one is slow and loud". A grown animal
     * plants itself and stays planted, which is worth 2 s of hold; what it
     * costs is 5.5 m of recall, because the thing that has stopped being true
     * about it is that it turns round quickly. Priced on two different axes at
     * two magnitudes and it still nets negative: a companion that has finished
     * growing is not a better companion, it is a heavier one. */
    up: { hold: 2.0 }, down: { recall: 5.5 }, sheds: null,
    gain: 'holds a spot longer once you have given it one',
    cost: 'and is slower to come back off it when you call',
  },
  {
    id: 'kept', label: 'KEPT', earn: 'looked after between runs',
    /* THE BONDED ONE. It has been fed and groomed at the habitat and it would
     * rather be near you than out on a ring — 4 m of recall bought with 4.5 m
     * off the ward, which is the honest price for an animal whose attachment
     * has become the thing it does instead of the job. SHEDS RANGING for
     * exactly the reason HEELED does: a record wearing "it has learned to
     * stay" and "it has learned to go" at once describes nothing. */
    up: { recall: 4.0 }, down: { ward: 4.5 }, sheds: 'ranging',
    /**
     * AND IT IS THE ONE THAT PANICS, WHICH IS THE PLAYER'S OWN SENTENCE.
     *
     * V15 §4: "a companion that only ever helps is a stat. A big one is slow
     * and loud; A BONDED ONE PANICS WHEN IT IS HURT." HEAVY had the first half
     * of that from the day it landed and KEPT had none of the second — it was
     * a bond that bought 4 m of recall and sold a ring, which is a trade and
     * not a panic. So the bonded animal breaks off and runs to you when it is
     * hurt, for `SHY.run` seconds, and will not fight while it is doing it.
     *
     * IT IS A FLAG ON THE ROW AND NOT A SIXTH AXIS, and the difference is the
     * pricing. `TEMPER_AXES` prices metres and seconds against each other; a
     * panic is neither, and inventing an axis for it would mean pricing "runs
     * away" against "4 m of recall" with a made-up span. It is a DRAWBACK with
     * no gain beside it, so `priceTemper` — which may not come out positive —
     * cannot be made wrong by it, and `Companions.stepShy` is the one reader.
     */
    shy: true,
    gain: 'comes home from further, and faster, than it used to',
    cost: 'and will not stand a ward as wide as it once did — and it bolts to you when it is hurt',
  },
  {
    id: 'ranging', label: 'RANGING', earn: 'five runs spent beyond twelve metres',
    /* WARD IS PRICED IN METRES AND NOT AS A FRACTION. Half again on the median
     * ward in the table (9 m on the massiff) is 4.5 m of extra ring, and 4.5 m
     * of ring is a thing that can be compared with 6 m of loosened heel. "+50%"
     * cannot be compared with anything, which is how a free temper gets past a
     * price check wearing a percentage. */
    up: { ward: 4.5 }, down: { recall: 6.0 }, sheds: 'heeled',
    gain: 'its ward reaches half again as far',
    cost: 'its heel tolerance loosens, so it drifts',
  },
];

/**
 * ── WHAT "BEYOND" MEANS FOR RANGING, AND WHO GETS TO SAY ──────────────────
 *
 * RANGING is earned off "five runs spent beyond twelve metres", and both
 * halves of that sentence are numbers somebody has to own. They live HERE,
 * beside the temper that is the only thing that reads them, rather than in the
 * pack that does the counting — for `TEMPER_AXES`' reason one block down: a
 * rule stated where it is measured is a rule that drifts from the rule it is
 * measuring, and the pack already imports this file.
 *
 * TWELVE METRES IS NOT AN ARBITRARY RING. The heel station is 3.4 m off your
 * back (`Companions.HEEL`) and the shortest leash on the ladder is 14 m, so a
 * mark at 12 sits between "at your heel" and "at the end of its rope": an
 * animal past it is one you have to go and look for, and one inside it is one
 * you can see without turning round. Ten would have counted an ordinary charge
 * at something shooting at you; sixteen would only ever have counted an animal
 * that was already lost.
 *
 * AND "MOSTLY" IS A MAJORITY OF THE SECONDS, not a peak and not a mean
 * distance. A peak is one bad moment in a whole run — every companion has one
 * — and a mean is dragged past the mark by thirty seconds of a single chase.
 * More of the run beyond the mark than inside it is the only reading of
 * "spent beyond twelve metres" that a player would recognise as a description
 * of how their animal actually behaves.
 */
export const RANGED_MARK = 12;
export const rangedRun = (far, near) => far > near;

/**
 * ── THE AXES, AND WHY THIS IS NOT `priceSwing` ────────────────────────────
 *
 * `tools/checks/attributes.mjs` exports `priceSwing`, and the instinct is to
 * call it rather than write a second currency — HANDOFF §2.4 in one line. It
 * does not fit, and the reason is the same one that formula's own note gives:
 * "POINTS ARE NOT COMPARABLE ACROSS AXES." `priceSwing` prices ATTRIBUTE
 * points as a fraction of each attribute's own multiplier range, and a
 * companion's tempers do not move an attribute at all — they move seconds and
 * metres, on a body that never enters `enlistBody`.
 *
 * So this is the same FORMULA in a different currency, written in the same
 * shape (`up`/`down` as positive magnitudes, exactly as a trait declares them,
 * so `traitSwing`'s reader shape carries over) and stated rather than smuggled:
 * each magnitude is priced as the fraction of its own axis's span that it buys.
 *
 *   hold      seconds an order survives you walking away.       span 8 s
 *   reach     metres from station it will break to take a target. span 20 m
 *   recall    metres from which it comes home fast.              span 20 m
 *   ward      metres of standing ring round YOU.                 span 20 m
 *   exposure  metres of extra distance-from-you, as a liability. span 20 m
 *
 * ── AND EVERY ONE OF THEM IS READ BY SOMETHING THAT IS NOT THIS TABLE ─────
 *
 * Three of the five were not, for four rounds, and the check that prices them
 * could not see it: it weighs `TEMPERS` against `TEMPER_AXES`, a table against
 * a table, and never asks whether the simulation reads the axis at all.
 * Measured by mutation — `{ hold: 999, ward: 999, exposure: 999 }` on a
 * fielded massiff moved not one number. So the row is named beside the axis
 * and `companion: every temper axis is read by something that is not the price
 * table` greps `src/` for it rather than trusting this list:
 *
 *   hold      `Companions.holdOf`   — the grace on the leash going taut.
 *   reach     `Companions.leashOf`  — the rope, one half.
 *   recall    `Companions.leashOf`  — the rope, the other half.
 *   ward      `CompanionKinds.wardOf` — the ring `dutyAllows` defends, the
 *                                     ring the gaze watches, the ring the
 *                                     wheel prints.
 *   exposure  `Companions.standoffOf` — metres further off your back it heels.
 *
 * `exposure` IS THE ONE AXIS WHOSE POSITIVE DIRECTION IS BAD, which is what
 * the word "liability" in its row means and is the one thing a reader of it
 * has to get right: `temperSwing` signs a `down` negative, so a temper that
 * COSTS four metres of exposure arrives as −4 and `standoffOf` negates it
 * once, in one place, with the reason written on it.
 *
 * `reach`, `recall`, `ward` and `exposure` share one span because they are all
 * metres on the same ground. That is the point of the table: they are
 * comparable, and a temper cannot buy four metres of one with a percentage of
 * another.
 *
 * NOT ONE OF THEM IS HEALTH, DAMAGE, ARMOUR OR PACE. See COMPANION_RANKS' note
 * on why no rung row carries a multiplier at all: a temper that raised any of
 * those four would be the ladder's refusal reopened one table across, and the
 * check asserts the axis list rather than trusting this sentence.
 */
export const TEMPER_AXES = { hold: 8, reach: 20, recall: 20, ward: 20, exposure: 20 };

function priceSide(side) {
  let net = 0;
  for (const a in (side || {})) {
    const span = TEMPER_AXES[a];
    /* AN UNKNOWN AXIS IS INFINITELY EXPENSIVE, not free. A temper that names
     * an axis this table does not price would otherwise contribute zero and
     * sail through a net-≤-0 check while doing whatever it liked. */
    if (!span) return Infinity;
    net += Math.abs(Number(side[a]) || 0) / span;
  }
  return net;
}

/**
 * WHAT A TEMPER IS WORTH, NET, AND IT MUST NOT BE POSITIVE.
 *
 * The shape is `attributes.mjs:353`'s own — `priceSwing(t.up)` against
 * `priceSwing(traitSwing({ down: t.down }))` — and the check drives this
 * function over the real table rather than transcribing four numbers.
 */
export function priceTemper(t) {
  if (!t) return 0;
  return priceSide(t.up) - priceSide(t.down);
}

const TEMPER_BY_ID = TEMPERS.reduce((o, t) => { o[t.id] = t; return o; }, {});
export const temperById = (id) => TEMPER_BY_ID[id] || null;


/* ── the record ──────────────────────────────────────────────────────── */

/** A blank Kennel. An absent key reads as this and never as a crash. */
export function blank() {
  return { live: null, fallen: [], runs: 0, lost: 0 };
}

const num = (v, d) => (Number.isFinite(v) ? v : d);

/**
 * ONE COMPANION OFF DISK, MADE SAFE.
 *
 * Every field clamped on the way IN, exactly as `readMan` clamps the living
 * (Company.js:366) and for the same stated reason: a hand-edited save is where
 * this has to stop, not where it has to be trusted. Two clamps here are the
 * ones that would actually be FELT rather than merely wrong —
 *
 *   `xp`      a stored 5000 is a companion that starts SWORN, which is the
 *             whole ladder handed over by editing one number.
 *   `scale`   is NOT STORED AT ALL, and that is deliberate. The rancor pup's
 *             size reads off `runs`, so it is derived and a derived field in a
 *             save file is a second source of truth. A stored scale is a pup
 *             filling the screen.
 *
 * An unreadable record is `null` — no companion — rather than a repaired one.
 * A companion is a named thing the player will grieve; inventing one from
 * rubble is worse than saying it is gone.
 */
export function readOne(r) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.kind !== 'string' || !COMPANION_KINDS[r.kind]) return null;
  if (typeof r.id !== 'string' || !r.id) return null;
  return {
    id: r.id,
    kind: r.kind,
    name: cleanCallsign(r.name) || null,
    look: saneLook(r.look),
    xp: Math.max(0, Math.min(999, num(r.xp, 0))),
    runs: Math.max(0, num(r.runs, 0) | 0),
    areas: Math.max(0, num(r.areas, 0) | 0),
    kills: Math.max(0, num(r.kills, 0) | 0),
    saves: Math.max(0, num(r.saves, 0) | 0),
    downs: Math.max(0, num(r.downs, 0) | 0),
    orders: Math.max(0, num(r.orders, 0) | 0),
    ranged: Math.max(0, num(r.ranged, 0) | 0),
    /**
     * WHAT WAS DONE FOR IT AT THE HABITAT — three counts of acts, and NOT a
     * quantity of anything.
     *
     * Clamped to `runs + 1` on the way in as well as on the way out, which is
     * the clamp that matters here: the gate `careFor` enforces is "an animal
     * is fed once a run and groomed once a run", and a hand-edited save is
     * exactly where that has to stop rather than where it has to be trusted.
     * Edit a 5000 in here and it comes back as one more than the runs the
     * animal actually survived — the same discipline `xp` gets, and for the
     * same reason: the whole growth ladder is two numbers, so two numbers are
     * what a save file would forge.
     */
    meals: Math.max(0, Math.min(Math.max(0, num(r.runs, 0) | 0) + 1, num(r.meals, 0) | 0)),
    grooms: Math.max(0, Math.min(Math.max(0, num(r.runs, 0) | 0) + 1, num(r.grooms, 0) | 0)),
    /* AND THE THIRD, ON THE SAME CLAMP AND ON THE SAME LINE OF ARGUMENT. A
     * field a screen can increment is a field a save file can forge, and the
     * ceiling is the one `careFor` enforces. It is read at the bottom of the
     * whitelist rather than defaulted somewhere else, because a care count
     * that `readOne` does not name is a count that survives one save and is
     * gone by the next load — which is a play control that does nothing. */
    plays: Math.max(0, Math.min(Math.max(0, num(r.runs, 0) | 0) + 1, num(r.plays, 0) | 0)),
    since: typeof r.since === 'string' ? r.since : null,
    tempers: Array.isArray(r.tempers)
      ? [...new Set(r.tempers.filter((t) => typeof t === 'string' && TEMPER_BY_ID[t]))].slice(0, TEMPERS_WORN)
      : [],
    story: Array.isArray(r.story)
      ? r.story.filter((s) => typeof s === 'string').slice(-STORY_KEEP) : [],
    /* SCARS ARE NOT CHOSEN. They are what happened to it, on the `scorchUp`
     * precedent (Command.js:10466), and there is no door that removes one. A
     * companion the player designed is a costume; a companion the player named
     * and the game marked is a history. */
    scars: Array.isArray(r.scars)
      ? r.scars.filter((s) => typeof s === 'string').slice(0, 6) : [],
  };
}

/**
 * ITS LOOK, made safe. IDS ONLY — never colours — so a re-tuned palette
 * reaches the companions already wearing it, and an id from an older build
 * that this one does not have is DROPPED rather than silently painting
 * nothing. `markById` is the one validator and it is the roll's own.
 */
/**
 * THE COLOUR SLOTS A KIND'S BUILDER READS — exported so the one other place
 * that writes an animal's look does not have to keep a second copy of them.
 *
 * `Keepsakes.js` validates a shop row against this list before it ever reaches
 * `dressCompanion`, so a collar naming a slot no animal has is refused by the
 * suite rather than dropped in silence at the counter. It was an inline array
 * in `saneLook` and a second one there would be the hand-maintained twin
 * HANDOFF §2.3 calls this project's signature defect — the list is one line
 * long and would have gone stale the first time a kind grew a surface.
 */
export const LOOK_SLOTS = Object.freeze(['hide', 'plate', 'belly', 'eye', 'shell', 'trim',
  'photoreceptor', 'panels', 'pelt', 'braid', 'blanket']);

function saneLook(look) {
  if (!look || typeof look !== 'object') return {};
  const out = {};
  for (const k of LOOK_SLOTS) {
    if (typeof look[k] !== 'string') continue;
    /* `paintById` answers null for an id this build does not have, and a
     * dropped slot is the chassis's own colour — which is the honest failure.
     * A body that silently painted nothing would be a player's choice quietly
     * deleted, which is the sentence `Company.dress` uses for the same case. */
    const p = paintById(look[k]);
    if (p) out[k] = p.id;
  }
  if (typeof look.mark === 'string') {
    const m = markById(look.mark);
    if (m.color != null) out.mark = m.id;
  }
  return out;
}

/**
 * THE WHITELIST ON THE WAY OUT, AND IT KEEPS `false`.
 *
 * `save` drops `null` and `undefined` and nothing else, exactly as Company.js's
 * own field loop does (:563) — a `false` that got dropped because the loop
 * tested truthiness is a stored boolean that silently reverts to its default
 * on every load, and that is a bug this repository has already paid for once.
 *
 * NOTHING DERIVED IS STORED. The rung is derived from xp, the pace from the
 * kind, the scale from runs. A derived field on disk is a second source of
 * truth that goes stale the first time the formula changes.
 */
const COMPANION_FIELDS = ['id', 'kind', 'name', 'look', 'xp', 'runs', 'areas',
  'kills', 'saves', 'downs', 'orders', 'ranged', 'meals', 'grooms', 'plays',
  'since', 'tempers', 'story', 'scars'];

/** One epitaph off disk, made safe — the `saneFallen` pattern (Company.js:317). */
function saneEpitaph(f) {
  if (!f || typeof f.kind !== 'string') return null;
  return {
    kind: f.kind,
    name: cleanCallsign(f.name) || null,
    where: typeof f.where === 'string' ? f.where : null,
    killer: typeof f.killer === 'string'
      ? f.killer.replace(/[<>&`\\]/g, '').slice(0, 40) : null,
    at: Number.isFinite(f.at) ? Math.max(0, Math.min(999, f.at | 0)) : null,
    runs: Math.max(0, num(f.runs, 0) | 0),
    /* HOW IT STOPPED BEING YOURS. `kia` is a death; `left` is the ramp sealing
     * with it standing on the ground. Those are different things to have done
     * to something, and a list that cannot tell them apart teaches neither.
     * The same two words the roll uses, for the same reason. */
    fate: f.fate === 'left' ? 'left' : 'kia',
  };
}

export function load() {
  const raw = STORE.read();
  const b = blank();
  return {
    live: readOne(raw?.live),
    fallen: Array.isArray(raw?.fallen)
      ? raw.fallen.map(saneEpitaph).filter(Boolean).slice(0, FALLEN_KEEP) : b.fallen,
    runs: Math.max(0, num(raw?.runs, 0) | 0),
    lost: Math.max(0, num(raw?.lost, 0) | 0),
  };
}

export function save(k) {
  const live = k?.live ? (() => {
    const out = {};
    for (const f of COMPANION_FIELDS) if (k.live[f] !== undefined && k.live[f] !== null) out[f] = k.live[f];
    return out;
  })() : null;
  STORE.write({
    live,
    fallen: (k?.fallen || []).slice(0, FALLEN_KEEP),
    runs: k?.runs | 0,
    lost: k?.lost | 0,
  });
  return k;
}

/**
 * A DELETE DOOR WITH A REAL CALLER, WHICH NOTHING DURABLE IN THIS TREE HAS.
 *
 * `Company.clear`, `Muster.clear` and `clearProgress` are all exported with
 * ZERO callers anywhere in `src/` — three delete doors nobody can open. A
 * companion is the first durable record a player will genuinely want to
 * destroy: one they regret naming, one they want to start over with. This
 * ships with a hold-to-confirm control on the Kennel page, and the check
 * asserts the caller exists rather than the export.
 *
 * `drop()` clears the mirror as well as the disk, so a player's own delete is
 * not undone by a memory of what used to be there.
 */
export function clear() {
  STORE.drop();
  return blank();
}

/* ── growth ──────────────────────────────────────────────────────────── */

/**
 * WHAT A DEED IS WORTH, on `Trooper.award()`'s shape (Command.js:3282).
 *
 * The gates are 0 / 6 / 16 / 20. Two clauses are copied from
 * `tools/checks/command.mjs:845` and DRIVEN rather than transcribed: the top
 * rung must be reachable inside one run, and not before 40% of it. That
 * satisfies Company.js:28's own amendment exactly — a thing may cross runs if
 * a single run could have produced it unaided; persistence is a shortcut to a
 * ceiling and never a new ceiling.
 *
 * THE DESIGN WROTE 30 AND THE DRIVEN NUMBER IS 20. The argument, with the
 * measurement that forced it, is on COMPANION_RANKS in CompanionKinds.js —
 * beside the row it moved — rather than here, because the gate is the rank
 * table's number and a second account of it is a second place to disagree.
 * The short version: a long crossing is five areas, only three of the four
 * deeds pay into a record a run can bank, and 5 × (1 + 1 + 2) is 20.
 *
 * ── AND EVERY ONE OF THEM IS FIRED FROM THE PACK'S OWN TICK ───────────────
 *
 * `CompanionPack.update` is the only caller of `award` in the tree, and that
 * is deliberate rather than convenient. Three of the four deeds are about a
 * moment nothing raises an event for — an area boundary, a body arriving
 * somewhere, an animal getting back up — and the alternative was a line in
 * `CommandDirector._areaClear`, a line in `Enemy._getUpFromDown` and a line in
 * `World._checkWipe`: three files learning the word companion, for a feature
 * whose whole architecture is that none of them do. The pack already polls for
 * `aboard` and already decays `underFire`, and its own note says why a poll
 * beats a subscription here — the thing being watched is the BODY, and the
 * body is what the pack is holding.
 *
 * NOTHING IS WRITTEN TO DISK MID-RUN. The deeds land on the record in memory
 * and the FOLD banks them, for `keepCompanion`'s stated reason: there is one
 * door, and a run that ended badly must not already have been paid out through
 * a side door halfway through it.
 *
 * ── AND "AN AREA" IS THE CAMPAIGN'S NAME FOR A BOUNDARY, NOT THE ONLY ONE ──
 *
 * The design wrote these four against a crossing, and for four rounds a
 * crossing was the only thing that could pay them: the count came off
 * `areasTaken`, which is zero in every mode without a campaign, so eight of the
 * eleven modes paid a companion at most one xp for a whole run. What a boundary
 * IS — an area where there is ground to take, a cleared wave everywhere else —
 * is `Companions.boundariesTaken`, and the weights below did not move for it.
 */
export const DEEDS = {
  /** A boundary crossed with it alive and inside the leash at the transition. */
  crossed: 1,
  /** The first time per boundary that an order you gave it actually lands. */
  order: 1,
  /** It reached you while you were down. */
  reached: 2,
  /** It survived a boundary in which it went down and you picked it up. */
  recovered: 2,
};

export function award(rec, deed, n = 1) {
  if (!rec) return rec;
  const w = DEEDS[deed];
  if (!w) return rec;
  rec.xp = Math.max(0, Math.min(999, (Number(rec.xp) || 0) + w * n));
  return rec;
}

/** Which tempers this record has earned but is not yet wearing. */
export function earnedTempers(rec) {
  if (!rec) return [];
  const has = new Set(rec.tempers || []);
  const out = [];
  const want = {
    heeled: (r) => (r.runs || 0) >= 3 && (r.ranged || 0) < 3,
    scarred: (r) => (r.downs || 0) >= 2,
    keen: (r) => (r.orders || 0) >= 12,
    ranging: (r) => (r.ranged || 0) >= 5,
    /* THE TWO OFF THE GROWTH LADDER. `stageOf` and `careOf` are asked rather
     * than restated, so a gate that moves in `GROWTH_STAGES` moves here in the
     * same commit — HANDOFF §2.4, call the rule rather than copy it. HEAVY is
     * the last stage, so an animal that is fully grown is a heavy one; KEPT is
     * the care half of the middle stage on its own, so a player who feeds and
     * grooms gets the bond whether or not the runs have caught up yet. */
    heavy: (r) => stageOf(r) >= GROWTH_STAGES.length - 1,
    kept: (r) => careOf(r) >= GROWTH_STAGES[2].care,
  };
  for (const t of TEMPERS) {
    if (has.has(t.id)) continue;
    if (want[t.id]?.(rec)) out.push(t);
  }
  return out;
}

/**
 * HANG WHAT IT HAS EARNED AND SHED WHAT THAT CONTRADICTS.
 *
 * `sheds` is the `bonded` precedent's own field and it is the reason two
 * tempers that mean opposite things cannot both be worn: HEELED is an animal
 * that has learned to stay, RANGING is one that has learned to go, and a
 * record wearing both would be describing nothing.
 */
export function applyTempers(rec) {
  if (!rec) return rec;
  const set = new Set(rec.tempers || []);
  for (const t of earnedTempers(rec)) {
    set.add(t.id);
    if (t.sheds) set.delete(t.sheds);
  }
  rec.tempers = [...set].slice(0, TEMPERS_WORN);
  return rec;
}

/**
 * THE FIVE BEHAVIOUR NUMBERS, AFTER EVERY TEMPER IT WEARS.
 *
 * One reader, so nothing anywhere adds up a temper's swing itself. Returns the
 * DELTAS; the pack adds them to the kind's own numbers, which is where the
 * base belongs. Every key that comes back is read by something on the field —
 * see the note on `TEMPER_AXES` for which reader owns which, and the check
 * that greps for them rather than believing the list.
 */
export function temperSwing(rec) {
  const out = { hold: 0, reach: 0, recall: 0, ward: 0, exposure: 0 };
  for (const id of rec?.tempers || []) {
    const t = TEMPER_BY_ID[id];
    if (!t) continue;
    for (const a in (t.up || {})) out[a] = (out[a] || 0) + Math.abs(t.up[a]);
    for (const a in (t.down || {})) out[a] = (out[a] || 0) - Math.abs(t.down[a]);
  }
  return out;
}

/**
 * IS ONE OF THE TEMPERS IT WEARS THE ONE THAT PANICS?
 *
 * One reader, off the row's own `shy` field, so the pack tests a FLAG on a
 * table rather than a temper id spelled out in the middle of a sim file. A
 * second temper that panics is a second `shy: true` and not a second `if`.
 */
export function shyTemper(rec) {
  for (const id of rec?.tempers || []) if (TEMPER_BY_ID[id]?.shy) return true;
  return false;
}

/* ── the write door for cosmetics ────────────────────────────────────── */

/**
 * THE ONE DOOR THE SCREENS CHANGE A LOOK THROUGH — its own, and separate from
 * `Company.dress` on purpose.
 *
 * `tools/checks/company.mjs:1102` greps the BODY of `export function dress` and
 * pins its fields to exactly `band,callsign,kit,mark,paint`; a sixth goes red.
 * That pin is the cosmetics-only line for the roll, and routing a companion
 * through `dress` would either break it or force it open. So this is a
 * separate exported function with ITS OWN equivalent grep-pin, written on the
 * same commit — or the cosmetics-only line has a hole in it exactly the width
 * of this feature.
 *
 * WHAT IT MAY WRITE: a name, a mark, and the colour slots the kind's own
 * builder actually reads. Nothing else on the record — xp, runs, kills, downs,
 * tempers, scars — is reachable from a screen, for `dress`'s stated reason:
 * those are written by the game, from a run, and a screen that could edit them
 * would make the page a cheat panel.
 */
export function dressCompanion(id, look = {}) {
  const k = load();
  if (!k.live || k.live.id !== id) return k;
  const K = COMPANION_KINDS[k.live.kind];
  if (!K) return k;
  if ('name' in look) {
    const nm = cleanCallsign(look.name);
    if (nm) k.live.name = nm; else k.live.name = null;
  }
  /* WHOLE-OBJECT, like `dress`'s kit: the screen sends what it wears now and
   * this writes it, so clearing a slot is the same call as choosing one. And
   * `saneLook` drops any slot this kind's builder would not read, so a control
   * that cannot be offered cannot be stored either. */
  if ('look' in look) k.live.look = saneLook(look.look);
  return save(k);
}

/* ── the write door for care ─────────────────────────────────────────── */

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  LOOKING AFTER IT — AND WHY THIS IS NOT A SHOP
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "care, feeding, grooming, play, at the habitat, ON the station, between
 *  runs — and for some rungs to need BOTH."
 *
 * THREE ACTS, THREE COUNTS, AND NOTHING IN BETWEEN THEM. There is no stock, no
 * shelf, no counter, no thing to choose between and no number that goes DOWN.
 * `meals`, `grooms` and `plays` only ever increment, by one, at a door the
 * player walks to. That is the whole of it, and it is deliberate: V16 §2 B5 wants food
 * bought at a market and V16 §4 is the argument that has to be settled in
 * `Progress.js`'s header before any market exists. This lane does not settle
 * it and does not lean on it — the habitat's trough and charging post are free
 * and always have been, so nothing here is waiting on that decision, and
 * nothing here would have to be unwound if it went the other way.
 *
 * ── THE ONE RULE THAT KEEPS IT FROM BEING A GRIND ─────────────────────────
 *
 * An animal may be fed once per run it has been out on, groomed once per run
 * and played with once per run, with one of each in hand before it has ever
 * deployed. So care can never
 * outrun runs, the whole ladder is bounded by the thing that is bounded by
 * playing, and standing in the habitat pressing a control a hundred times does
 * exactly nothing after the second press. The alternative — a cooldown in
 * seconds — would have made the growth curve a function of how long the game
 * was left running, which is the worst version of this feature.
 *
 * ── ITS OWN DOOR AND ITS OWN PIN, FOR `dressCompanion`'S REASON ───────────
 *
 * `companions: neither new file has grown a currency` greps the BODY of
 * `dressCompanion` and fixes what it may write at exactly `name` and `look`,
 * so a screen cannot become a cheat panel. Care is a SECOND write from a
 * screen and it may not ride that door — widening a pin to fit a new feature
 * is how a pin stops meaning anything. So: a separate exported function, whose
 * whitelist is a frozen array this file exports, with its own equivalent
 * grep-pin written on the same commit. It may increment two counters and it
 * may do nothing else — xp, runs, kills, downs, tempers and scars are written
 * by the game, from a run, and are not reachable from a room.
 *
 * ── AND THE THIRD ACT, WHICH THE ROOM HAD BEEN PROMISING FOR FOUR ROUNDS ──
 *
 * V15 §4 asks for "care, feeding, grooming, PLAY" and `StationPlan.js:452`
 * gives #28 the gazetteer verb `'feed, play, groom'`, which the room prints
 * verbatim on the wall. `CARE_ACTS` was `['meals','grooms']` and the panel
 * offered exactly two controls, so one third of a sentence the player can
 * read in the room was a thing the room could not do. That is the same shape
 * of lie as a card describing a mechanic that does not exist, and it is
 * closed the only way it can be: by building the act, not by editing the sign.
 *
 * IT IS NOT A FOURTH KIND OF THING. Same door, same once-per-run rule, same
 * whitelist, same counter, counted by `careOf` exactly as the other two are —
 * so it feeds the growth ladder and it is the third way to earn KEPT. WHAT
 * MAKES IT ITS OWN ACT rather than a third button that does what the first two
 * do is `playLine`: play is the only one of the three that ANSWERS, with a
 * sentence about what the animal actually did, drawn deterministically off the
 * record's own id and the count. Nothing about that sentence is stored — see
 * the note on it — so `careFor` still writes exactly one field, and the pin
 * that says so is unchanged in shape.
 */
export const CARE_ACTS = Object.freeze(['meals', 'grooms', 'plays']);

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT IT DID WHEN YOU PLAYED WITH IT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The one act of the three that answers. Feeding and grooming are things you
 * do TO an animal and the record is the whole of what they leave behind; play
 * is a thing you do WITH one, and a control that reported nothing back would
 * have been the third button doing what the first two do.
 *
 * DERIVED AND NEVER STORED, which is the whole reason this can exist without
 * touching the write door. The sentence is a pure function of the record's own
 * id and how many times it has been played with, so it is the same sentence on
 * every machine and after every reload, and `careFor` still writes exactly one
 * field — the pin on its body is unchanged and did not have to be widened.
 *
 * SEEDED, NOT RANDOM. `Math.random` is refused across `src/` by
 * `tools/checks/determinism.mjs` and it would be wrong here anyway: a line
 * that changed every time the panel re-rendered would be noise rather than a
 * memory. The hash is the same 32-bit mix `CompanionLife.seedOf` uses, over
 * `id` and the count, so consecutive plays walk the table instead of sticking.
 *
 * THE VOCABULARY IS THE KIND'S OWN. A droid runs a drill where a massiff
 * chases a rope, and that is `CARE_WORDS` one file across rather than a switch
 * on a kind's name here — the same rule feeding and grooming already follow.
 */
const PLAY_GAMES = Object.freeze({
  creature: [
    'chased a knotted rope the length of the pen and would not give it back',
    'shouldered you into the rail twice and thought that was the game',
    'went flat on its forelegs, tail up, and waited for you to move first',
    'carried the rope to the far corner and dared you to come and get it',
  ],
  mount: [
    'took two laps of the pen at a canter and came back blowing',
    'shied at nothing, wheeled, and stood there pleased with itself',
    'let you work its head round both ways and leaned into it',
    'stamped a slow circle round you until you gave in and moved',
  ],
  wookiee: [
    'took your arm, mimed breaking it, and laughed at the noise you made',
    'hid your kit behind the crates and watched you look for it',
    'wrestled you off your feet twice and let you up both times',
    'drummed on the bulkhead until half the deck looked over',
  ],
  droid: [
    'ran the obstacle drill twice and shaved a second off the second pass',
    'projected a target grid on the deck and scored you on it',
    'chirped through a whole call-and-answer sequence without a fault',
    'chased a thrown spanner and filed a complaint about the throw',
  ],
});

/** The 32-bit mix `CompanionLife.seedOf` uses, over a string and a counter. */
function playSeed(id, n) {
  let h = 2166136261 ^ (n | 0);
  const str = String(id || '');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return (h >>> 0);
}

/**
 * WHAT HAPPENED THE LAST TIME YOU PLAYED WITH THIS ANIMAL, or null if you
 * never have. Read by the habitat panel; read by nothing that fights.
 */
export function playLine(rec) {
  const n = Math.max(0, (Number(rec?.plays) || 0) | 0);
  if (!rec || n <= 0) return null;
  const rows = PLAY_GAMES[COMPANION_KINDS[rec.kind]?.look] || PLAY_GAMES.creature;
  return rows[playSeed(rec.id, n) % rows.length];
}

/**
 * MAY THIS ANIMAL BE LOOKED AFTER AGAIN YET? One reader, so the habitat's
 * control and the write door cannot disagree about whether the control is
 * live — a button that is offered and then silently does nothing is the dead
 * control `WEARS` was written to prevent, one room across.
 */
export function canCare(rec, act) {
  if (!rec || !CARE_ACTS.includes(act)) return false;
  return ((Number(rec[act]) || 0) | 0) < ((Number(rec.runs) || 0) | 0) + 1;
}

/** The care door. It increments one of two counters by one, or does nothing. */
export function careFor(id, act) {
  const k = load();
  if (!k.live || k.live.id !== id) return k;
  if (!CARE_ACTS.includes(act)) return k;
  if (!canCare(k.live, act)) return k;
  k.live[act] = ((Number(k.live[act]) || 0) | 0) + 1;
  /* AND WHAT THAT MAY HAVE EARNED. Care is one of the two inputs to the stage
   * ladder and the stage ladder earns tempers, so the record is offered them
   * here for the same reason the fold offers them there: a temper the player
   * has earned and is not wearing is a growth curve that stopped halfway. */
  applyTempers(k.live);
  return save(k);
}

/* ── the fold ────────────────────────────────────────────────────────── */

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  DID IT GET OUT?
 * ══════════════════════════════════════════════════════════════════════════
 *
 * THE TEST IS WRITTEN OUT IN FULL BECAUSE THE DEFAULT IS SILENT IMMORTALITY.
 *
 * `Company.keep` strikes off every DEPLOYED name not on the manifest
 * (Company.js:774) — but a companion is on no roster, so it is invisible to
 * that rule and would simply never die. That is precisely the defect
 * `company.mjs:430` names about bonds: a mechanism with its price quietly
 * removed and nothing on any screen to say so.
 *
 * SO THE RULE IS:
 *
 *     it persists IF AND ONLY IF it is ALIVE
 *     AND (the run was WON  OR  the pack's own `aboard` flag is set)
 *
 * Dead, downed at the fold, or standing on the ground when the ramp sealed —
 * gone, live record cleared, one epitaph kept. THERE IS NO BRANCH FOR A RUN
 * THAT WENT BADLY, because a run that went badly is exactly when a player
 * would want one.
 *
 * WHY THE `aboard` FLAG AND NOT THE MANIFEST. Verified: `Extraction.manifest`
 * is `this._seated.map((b) => b.trooper).filter(Boolean)` (Extraction.js:956),
 * so a companion boards the ship and then does not exist on the list that
 * decides who survived. That one `filter(Boolean)` is the whole gap between
 * "the companion got on the ship" and "the companion is there next run" — and
 * `keep()` reads exactly that array and may not be reopened. So the manifest
 * is left BYTE-IDENTICAL and the pack keeps its own flag.
 *
 * WHY IT CANNOT RIDE `bank()`. `bank()` returns early on
 * `!d || d.deck || d.versus || session` (main.js:1774), so it never fires in a
 * duel, the dojo, the sandbox, a roguelite with no contingent, the hangar or
 * co-op. The brief says the companion is with you the whole time; that sentence
 * and this guard cannot both be true through `bank()`. `record()`'s call site
 * is the right shape and is what this copies: it fires everywhere, once per
 * world, from BOTH endings.
 *
 * AND `quitToMenu` MUST FOLD. On the same terms `bank()` is called there with
 * no stats: if quitting is the safe way to keep a companion alive, the
 * withdrawal has been reopened by the back door, and REVIEW-V12.md:114 forbids
 * that in as many words. `leaveHangar` must NOT — walking off the deck is not
 * a run, exactly as it already skips `record()` and `bank()`.
 */
export function keepCompanion(world, stats = null) {
  /* `_companions` IS THE PACK'S NAME, and reading `_companion` was a silent
   * false: the guard passed on a truthy marker, `pack.body0` came back
   * undefined, and every surviving companion was folded as dead. The check
   * caught it as "alive and won: kept=false". One name. */
  const pack = world?._companions;
  if (!pack) return null;
  /**
   * CO-OP FOLDS, AND THE LINE THAT SAID IT DID NOT IS GONE.
   *
   * `if (world.netMode) return null` was the honest answer while the host's
   * animal was the only one on the field: a client had nothing out there, so
   * folding its record would have been filing a run it never played, and
   * folding the HOST's against a body four people shared was worse. Now every
   * commander brings one, every one of them is a real host-spawned body, and
   * `pack.mine` is the local player's out of that list — so the two questions
   * the fold asks ("is it alive", "did it get out") have the same answers on a
   * client as they have on any other machine. They are the host's answers,
   * which is the point: `dead` and `hp` are on the snapshot, so a client folds
   * what the authority says happened rather than what its own screen guessed.
   *
   * WHAT REPLACES IT IS THE GUARD THE OLD LINE WAS REALLY MAKING — a fold must
   * never turn a record the player still has into an epitaph because of
   * something the NETWORK did. `pack.mine` is null when nothing of yours was
   * fielded this run, and null is not the same fact as "it did not come back":
   * a joining player whose animal was never put down (a host that fields none,
   * a session that dropped before the body arrived, a mode that takes nothing
   * in with you) leaves here with the kennel untouched, exactly as before.
   * `undefined` is not `null`, which is what keeps the hand-built pack literals
   * in the check suite folding on the terms they always did: they carry a
   * `body0` and no `mine` at all, and this asks only about a real pack that has
   * been given the chance to claim one and has not.
   *
   * WHAT IS STILL NOT FOLDED IN A SESSION IS THE XP. `CompanionPack._ledger`
   * refuses to award anything off a net-driven body and says at length why, so
   * a client's animal comes home with its run counted and its rung where it
   * started. That is a hole with a floor under it; the alternative was a rung
   * invented out of fields nothing writes.
   */
  if (pack.mine === null) return null;
  const k = load();
  if (!k.live) return null;
  /**
   * THE ANIMAL THE RUN HAPPENED TO, AND NOT A FRESH READ OF THE DISK — and
   * this one line is why nothing ever climbed a rung.
   *
   * `load()` builds a NEW object out of the store every time it is called.
   * `main.fieldFromKennel` calls it at deploy and hands `k.live` to the pack,
   * which hangs it on the body as `_cmpRec`; every deed of the run is then
   * awarded onto THAT object. This function called `load()` a second time and
   * folded the object it got back — a record identical to the one the run
   * started with, because it had just been re-read from a store nothing had
   * written since. Measured before this, on a driven five-area crossing with
   * every deed firing: the record on the field ended at xp 20, SWORN was two
   * rungs up from where it started, and the fold wrote xp 0 and rung STRANGE.
   * The whole ladder existed and banked nothing.
   *
   * `pack.rec` is what the run was actually played with. The id has to match
   * what is on disk or the disk wins: a player who deleted the companion from
   * the Kennel page mid-run, or adopted a different one, must not have the
   * animal they got rid of written back over the top by a body still standing
   * on the field. That is `keep()`'s own foreign-manifest refusal, in the shape
   * this file's owner is keyed in.
   */
  const rec = (pack.rec && pack.rec.id === k.live.id) ? pack.rec : k.live;
  k.live = rec;

  const body = pack.body0 || null;
  const alive = !!body && !body.dead && !body.downed;
  const won = !!stats?.won;
  const out = alive && (won || !!pack.aboard);

  k.runs = (k.runs | 0) + 1;
  if (out) {
    rec.runs = (rec.runs | 0) + 1;
    /* AND WHETHER THIS WAS A RUN SPENT AWAY FROM YOU — the RANGING tally,
     * asked of the pack rather than counted here. The pack holds the seconds
     * because the pack is the only thing that sees every frame; the RULE for
     * what those seconds mean is `rangedRun`, up beside the temper that is the
     * only thing that reads them. On a KEPT run only, exactly as `runs` is: a
     * run the animal did not come home from is not a run it spent anywhere. */
    if (pack.rangedRun) rec.ranged = (rec.ranged | 0) + 1;
    const worn = new Set(rec.tempers || []);
    applyTempers(rec);
    save(k);
    /* WHAT THE RUN CHANGED, for the one screen that says so. `Trooper.award`
     * returns the promotion it caused and every caller in Command.js reads
     * that answer; the companion's deeds arrive a frame at a time from the
     * pack's ledger, so the comparison is made here, once, against the rung it
     * deployed on. A ladder nobody is told they climbed is a ladder that only
     * exists in a list, which is the thing this repository keeps deleting. */
    const rose = pack.rung0 && rungOf(rec).id !== pack.rung0 ? rungOf(rec) : null;
    const learned = (rec.tempers || []).filter((t) => !worn.has(t));
    return { kept: true, rec, rose, learned };
  }

  k.lost = (k.lost | 0) + 1;
  k.fallen.unshift(saneEpitaph({
    kind: rec.kind,
    name: rec.name,
    where: world?.settings?.level || null,
    killer: pack.lastKiller || null,
    at: Math.round((world?.elapsed || 0) / 60),
    runs: rec.runs,
    /* THE RAMP SEALED WITH IT STANDING THERE is `left`, and being killed is
     * `kia`. `alive` decides, because a companion that is alive and did not
     * get out was abandoned rather than lost. */
    fate: alive ? 'left' : 'kia',
  }));
  k.fallen = k.fallen.filter(Boolean).slice(0, FALLEN_KEEP);
  k.live = null;
  save(k);
  return { kept: false, rec };
}

/**
 * PUT A FRESH ANIMAL IN THE KENNEL. One live record, ever — there is no second
 * slot and there never will be, earned or bought: a companion that adds a body
 * to the line is `company.mjs`'s "rank, not headcount" defect with fur on it.
 */
export function adopt(kind, name = null, look = {}) {
  if (!COMPANION_KINDS[kind]) return null;
  const k = load();
  k.live = readOne({
    id: `c${Math.random().toString(36).slice(2, 10)}`,
    kind, name, look, xp: 0, runs: 0, since: new Date().toISOString().slice(0, 10),
  });
  save(k);
  return k.live;
}

/** The rung a live record stands on. Re-exported so no screen imports two files. */
export { rungOf };
