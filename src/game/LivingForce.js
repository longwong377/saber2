/**
 * BATTLEFRONT BORZ — the Living Force: a Holocron you spend Insight on.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The run had one reward shape: every second wave the Force offers three cards
 * and you take one of them. That is a good moment and a bad spine. Three
 * things were wrong with it as the whole of a build system, and all three are
 * about AGENCY:
 *
 *   YOU NEVER CHOOSE, YOU ONLY ANSWER. The draft decides what a run can even
 *   be. A player who wants to build a healer cannot go and get one; they can
 *   only hope Suffusion is one of the three, twice.
 *
 *   THE HOLDING HAS NO SHAPE. `takenBoons` is a Set. Fifteen cards in a run and
 *   the only structure between them is the five `axes` strings, which nothing
 *   ever draws. A build you cannot SEE is a build you cannot plan.
 *
 *   NOTHING IS EVER SAVED UP FOR. Every reward is immediate and equal. There is
 *   no small choice you decline in order to make a large one later, which is
 *   the decision a progression system is actually made of.
 *
 * The Living Force answers all three with one object: the boon table, ARRANGED.
 *
 * ── THE THREE WORDS, BECAUSE THEY USED TO BE THREE OTHER ONES ─────────────
 *
 * This was a CONSTELLATION: stars in a sky, joined into figures, and you lit
 * them. The player asked what stars had to do with becoming attuned to the
 * Force, which was a fair question with an embarrassing answer — a node graph
 * happens to look like a star chart, so the picture was chosen first and the
 * fiction was bent around it. The drawing did not change; every word around it
 * did:
 *
 *      the LATTICE   the whole set of facets and the joins between them, which
 *                    the player meets as the Holocron: a crystal you kneel with
 *                    and that teaches you. It is a GRAPH and not a picture —
 *                    see below, where its coordinates used to be.
 *      a CURRENT     one of the six teachings the lattice is grouped into —
 *                    "I feel the currents of the Force", and each one is an
 *                    axis the masteries and the attunements already name.
 *      a FACET       one node: one card, in one place, joined to its
 *                    neighbours. You WAKE a facet; you do not light it.
 *
 * Every card in BOONS and every ATTUNEMENT is a facet with a fixed place in the
 * lattice. Insight — earned by surviving waves — wakes them. Reachability is
 * Skyrim's rule, which is the right rule because it is the one that makes a
 * plan out of a purchase:
 *
 *      A facet may be woken if it is the ROOT of its current, or if a facet it
 *      is joined to is already woken.
 *
 * ── HOW IT SITS ON TOP OF THE DRAFT, RATHER THAN REPLACING IT ─────────────
 *
 * The draft still runs, unchanged, and this is the important part: a DRAFTED
 * card wakes its facet too. So the two halves are one system —
 *
 *    the draft   the Force offers. It can wake a facet anywhere in the lattice,
 *                including one you could never have reached, and that facet is
 *                then a bridgehead the tree can be walked out of.
 *    the tree    you choose. Slower, deliberate, and it goes where you point it.
 *
 * — and a run's holding is the same set of ids it always was. Nothing here
 * needs a second ledger of "which boons": `world.takenBoons` is the truth, and
 * `Communion` only counts the Insight and the purchases made with it.
 *
 * ── WHAT IT DELIBERATELY IS NOT ───────────────────────────────────────────
 *
 * NOT A META-PROGRESSION. Insight is earned inside a run and dies with it.
 * Progress.js says it plainly — "no unlocks, no currency, no cross-run power",
 * and a hundredth run must start exactly where the first did — and a skill tree
 * is the single most common way that promise gets broken. Between runs the
 * meditation shows you the Holocron and your record ON it; it does not sell you
 * a head start. The one thing it hands the next run is a PLAN, which is the
 * thing a player should be carrying between runs anyway.
 *
 * ── THE NAMES MOVE WITH THE ALIGNMENT ─────────────────────────────────────
 *
 * The same facet reads as a Jedi discipline to a Jedi and as a Sith one to a
 * Sith. This is naming and nothing else — the mechanic under it is identical,
 * because a card that is mechanically different by order is a balance problem
 * wearing a costume — and it uses `Order.js`'s existing three-way alignment
 * rather than inventing a second one. A Grey reads the canonical name, which is
 * the one BOONS already carries: they took no temple's vocabulary.
 */

import { BOONS, ATTUNEMENTS, RARITY, maxRank, rankOf, boonById, axisCountOf,
  RAMP_CARDS_EVERY, BOSS_EVERY } from './Waves.js';
/* The offer is dealt from a seeded stream — see `OFFER`. MathUtil is a leaf and
 * this is the only thing this file takes from it. */
import { makeRng } from '../engine/MathUtil.js';
import { UNBOUND, unboundId } from './Powers.js';

/* ══════════════════════════════════════════════════════════════════════ */
/*  Insight — what a run earns and what a facet costs                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHAT A WAVE IS WORTH, and why it is this and not more.
 *
 * The draft hands out one card every DRAFT_EVERY = 2 waves. If the tree woke
 * one facet every two waves as well, the run's reward rate would DOUBLE, and
 * `budgetFor`'s ramp — which is derived from the draft rate, in one constant
 * with its derivation written next to it — would be racing a player growing
 * twice as fast as the curve was fitted for. Wave 20 would stop being a fight.
 *
 * So the economy is deliberately a MINORITY of the reward, and it is bounded by
 * arithmetic rather than by feel:
 *
 *      insight(w)  =  w + BOSS_BONUS · floor(w / 5)
 *      cost(k)     =  base(rarity) + STEP · k        (k = facets already woken)
 *
 * The costs are an arithmetic series, so the number of facets a run of w waves
 * can afford grows like √w while the cards it drafts grow like w/2. Measured
 * against the shipping tables: by wave 20 a run has 28 Insight and has bought
 * FOUR commons (4+6+8+10 = 28) against ten drafted cards, and by wave 40 it has
 * 56 and has bought six (4+6+8+10+12+14 = 54) against twenty. The tree is about
 * a third of the run at wave 20 and a quarter of it at wave 40, and it never
 * overtakes the draft at any depth. tools/checks/living-force.mjs pins exactly
 * that, as a closed form, at every wave out to 60.
 */
export const INSIGHT_PER_WAVE = 1;
export const INSIGHT_BOSS_BONUS = 2;
/** Base price by rarity — an epic is a commitment, a common is a step. */
export const COST = { common: 4, rare: 6, epic: 9 };
/** What each facet already woken adds to the price of the next one. */
export const COST_STEP = 2;
/** …and what each rank already held adds, so a repeat is never the cheap play. */
export const RANK_STEP = 3;

/**
 * THE RATE FOR A MODE WITH NO DRAFT AT ALL — and it is derived, not chosen.
 *
 * The rate above is 1 because the tree has to stay a MINORITY beside the draft;
 * that is this file's own argument and `living-force.mjs` pins it. The Trial of
 * Waves has no draft, so there is no minority to stay under — and the mode's
 * own menu entry says where its build comes from instead: "what you build, you
 * build in the Holocron", with `Waves.js` adding "the tree is the Trial's whole
 * progression".
 *
 * IT WAS NOT. Driven through `living-force.mjs`'s own run harness with the
 * draft flag off, twelve seeds, forty waves:
 *
 *     roguelite   23.3 of 46 facets held (51%)   5.9 bought   42% overlap
 *     Trial        4.9 of 46 facets held (11%)   5.0 bought   14% overlap
 *
 *     (The table was taken when FACETS had 46 entries. It has 52 — the six
 *     rule facets of PLAN §4.6 — so the SHARES above are of the old roster and
 *     the counts bought are the figures that still transfer.)
 *
 * and the cause is arithmetic rather than tuning. All six roots are `epic` at 9
 * against `insightAfter(w) = w + 2·floor(w/5)`, so a Trial player buys their
 * first facet at wave 7, the second at 15, the third at 25 and the fourth at
 * 35: **pick one of six currents and walk four steps down it**, in a forty-wave
 * run, every run.
 *
 * ── THE DERIVATION ────────────────────────────────────────────────────────
 *
 * `RAMP_CARDS_EVERY` is the fact to size against: the base budget polynomial
 * was fitted against a player holding w/3 growth events by wave w, and the
 * Trial is charged that base curve with no multiplier on it. A drafting mode
 * gets those events from cards. A mode that drafts nothing has to buy them
 * here, so the rate is the one that affords w/RAMP_CARDS_EVERY facets by wave
 * w at this file's own price series:
 *
 *     n     = W / RAMP_CARDS_EVERY                       facets to afford
 *     spend = n·COST.common + COST_STEP·n(n−1)/2         the arithmetic series
 *     per   = spend / (W + (BOSS/PER)·floor(W/BOSS_EVERY))
 *
 * evaluated at W = 40, which is the depth every run-shape check in this project
 * measures at and about as far as a run goes. It comes out at 4, and the
 * quadratic price series is why it cannot be 1: a constant rate against a
 * rising price buys facets like √(purse), so tripling the rate does not triple
 * the build — measured, 5.0 purchases become 12.0 and one current becomes three.
 *
 * The boss bonus keeps its RATIO to the per-wave rate rather than being typed
 * again, so a set-piece is worth the same multiple of a wave in both modes.
 */
export const TRIAL_INSIGHT_AT = 40;
export const TRIAL_INSIGHT_PER_WAVE = (() => {
  const n = TRIAL_INSIGHT_AT / RAMP_CARDS_EVERY;
  const spend = n * COST.common + COST_STEP * n * (n - 1) / 2;
  const perWave = TRIAL_INSIGHT_AT
    + (INSIGHT_BOSS_BONUS / INSIGHT_PER_WAVE) * Math.floor(TRIAL_INSIGHT_AT / BOSS_EVERY);
  return Math.max(INSIGHT_PER_WAVE, Math.round(spend / perWave));
})();

/**
 * What one wave and one set-piece are worth, in the mode being played.
 *
 * `drafts` is `WaveDirector.drafts` — the shipped statement of which modes hand
 * out cards — called rather than restated, so a mode added to `DRAFT_MODES`
 * changes both channels at once.
 *
 * `hazard` is `WaveDirector.hazard`, and it is PLAN.md §4.6's player-authored
 * difficulty arriving on the one line that decides what a wave is worth. It
 * multiplies BOTH channels, because a set-piece under a run rule is the same
 * multiple of a wave that a set-piece without one is — see `hazardPay` in
 * Waves.js for why the multiplier is the director's own `worth` and not a
 * second table. Defaulted to 1, so a run under no rules is byte-identical.
 *
 * The product is DELIBERATELY NOT ROUNDED here. A rate of 1.08/wave rounded at
 * this line is 1/wave and A HEAD TO CUT OFF pays nothing at all; the rounding
 * belongs where the purse is credited, and `Communion.earn` carries the
 * fraction across waves so the ledger stays in whole Insight without losing it.
 */
export function insightRate(drafts = true, hazard = 1) {
  const per = (drafts ? INSIGHT_PER_WAVE : TRIAL_INSIGHT_PER_WAVE) * (hazard > 0 ? hazard : 1);
  return { per, boss: per * (INSIGHT_BOSS_BONUS / INSIGHT_PER_WAVE) };
}

/** Insight a run of `waves` waves will have earned, in closed form. */
export function insightAfter(waves, bossEvery = BOSS_EVERY, rate = null) {
  if (!(waves > 0)) return 0;
  const r = rate || insightRate(true);
  return waves * r.per + Math.floor(waves / bossEvery) * r.boss;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The lattice                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/* THE DRAWING'S COORDINATE SPACE USED TO BE HERE, and it is gone.
 *
 * `LATTICE`, `ZONE`, `zoneOf` and `positionOf` fitted each current's shape into
 * one of six rectangles on a 1000x720 canvas, and every facet in the table
 * below carried a `dx`/`dy` to be fitted. All of it existed to place discs on a
 * star chart, which the player has now asked three times to be rid of — "get
 * fucking rid of it and redo the whole thing". `src/ui/SkillTree.js` draws six
 * PLATES of stacked rungs and has no coordinates at all: depth in the join
 * graph is indentation, and rows cannot collide.
 *
 * The coordinates are deleted rather than left unread. An orphaned layout is
 * exactly the thing a later hand re-attaches, and this one has already survived
 * one full renaming of everything around it.
 *
 * WHAT THE TABLE KEEPS IS THE JOINS, which were always the real structure: a
 * facet's `to` list is what makes it reachable, what the rack indents off, and
 * what `tools/checks/living-force.mjs` now walks in place of measuring pixels.
 */

/**
 * THE SIX CURRENTS. Five are the axes the masteries and the attunements
 * already name — so a run's cards, its attunements and its tree all pull in the
 * same direction and a build has one identity rather than three — and the sixth
 * is Communion, which is where the cards that land on somebody else live.
 *
 * `root` is the facet that needs no neighbour, and every one of the six is that
 * axis's ATTUNEMENT. That is exactly right: an attunement is uncapped and
 * repeatable, so the heart of a current can never be exhausted and a current
 * can never close. It was true of five of them for a while — see the note on
 * `attune-bond` in the facet table for the one that had to be built.
 *
 * Where each one SITS is not in this table and no longer is anywhere: the
 * Holocron is a rack of plates and a current is one plate, laid out by the
 * grid. See the note where the coordinate space used to be.
 */
/**
 * WHAT EACH CURRENT IS FOR, in one plain line.
 *
 * The six plates are the whole navigation of the Holocron, and they carried a NAME
 * and a COUNT and nothing else. "THE GUARDIAN 3/8" does not tell a player that
 * this is the column with cutting power in it, and the creed underneath —
 * "The blade is the last argument, and the shortest" — is a mood, not a
 * signpost. A player scanning six columns for somewhere to put four Insight
 * had no way to choose but to open all of them.
 *
 * So `what` is the signpost and the creed stays the mood. Written from what
 * the axis's own cards actually do.
 */
export const CURRENTS = [
  { axis: 'blade', root: 'attune-blade', 
    what: 'Cutting power, swing speed and reach.',
    jedi: 'The Guardian', sith: 'The Executioner', grey: 'The Blade',
    creed: { jedi: 'The blade is the last argument, and the shortest.',
             sith: 'There is no argument. There is the blade.' } },
  { axis: 'guard', root: 'attune-guard', 
    what: 'Deflection, ripostes, and taking less when it lands.',
    jedi: 'The Sentinel', sith: 'The Bulwark', grey: 'The Guard',
    creed: { jedi: 'What is turned aside was never yours to answer for.',
             sith: 'Let it come. Let it come back.' } },
  { axis: 'force', root: 'attune-force', 
    what: 'The size of your Force, what it costs, and how fast it comes back.',
    jedi: 'The Book', sith: 'The Sorcerer', grey: 'The Well',
    creed: { jedi: 'The Force is not a weapon you spend.',
             sith: 'Everything is a weapon, if you are willing to spend it.' } },
  { axis: 'body', root: 'attune-body', 
    what: 'Vitality, speed, stamina — and staying on your feet.',
    jedi: 'The Pilgrim', sith: 'The Juggernaut', grey: 'The Body',
    creed: { jedi: 'The body is the first thing the Force is given.',
             sith: 'Pain is only information.' } },
  { axis: 'bond', root: 'attune-bond',
    what: 'Your troops: what they deal, what they survive, and what heals them.',
    jedi: 'The Unifying Force', sith: 'The Rule of Two', grey: 'Communion',
    creed: { jedi: 'There is no you. There is what stands beside you.',
             sith: 'One to embody the power. One to crave it.' } },
  { axis: 'dark', root: 'attune-dark', 
    what: 'Taking life from what you kill, and the powers that come with it.',
    jedi: 'The Shadow', sith: 'The Abyss', grey: 'The Dark',
    creed: { jedi: 'Name it, so that you can refuse it.',
             sith: 'Take it. It was always going to be taken.' } },
];

export const AXES = CURRENTS.map((c) => c.axis);

/**
 * EVERY FACET IN THE LATTICE.
 *
 * `id` is a BOONS or ATTUNEMENTS id and is the whole of the mechanical link:
 * this table adds a PLACE, a set of LINES and two NAMES, and nothing else. A
 * facet cannot have an effect the boon table does not have, which is the
 * property that stops this file from quietly becoming a second, divergent copy
 * of the game's balance.
 *
 * `to` lists the facets this one is joined to. The lines are undirected — the
 * reachability rule reads them both ways — so each pair is written once, from
 * the facet nearer the root.
 *
 * `jedi` / `sith` are the aligned names. Where the canonical name is already a
 * Form or a technique with a real name in both traditions, both columns say so;
 * where it is a description, the two columns are two vocabularies for the same
 * act. tools/checks/living-force.mjs asserts every facet carries both, that no
 * two facets in one current share a name, and that the aligned name is never
 * simply the canonical one wearing a different hat.
 */
export const FACETS = [
  /* ── The Blade ─────────────────────────────────────────────────────── */
  { id: 'attune-blade', axis: 'blade', to: ['cadence', 'djemso', 'longblade'],
    jedi: 'Attunement of the Blade', sith: 'Hunger of the Blade' },
  { id: 'cadence', axis: 'blade', to: ['makashi'],
    jedi: 'Cadence', sith: 'Relentlessness' },
  { id: 'djemso', axis: 'blade', to: ['shatterpoint'],
    jedi: 'Form V — Shien', sith: 'Form V — Djem So' },
  { id: 'longblade', axis: 'blade', to: ['dualcrystal', 'saberthrow'],
    jedi: 'Reach of the Temple', sith: 'The Long Bleed' },
  { id: 'shatterpoint', axis: 'blade', to: ['sunder'],
    jedi: 'Shatterpoint', sith: 'The Flaw in All Things' },
  { id: 'dualcrystal', axis: 'blade', to: ['sunder'],
    jedi: 'Focusing Crystal', sith: 'Bled Crystal' },
  { id: 'sunder', axis: 'blade', to: [],
    jedi: 'Mastery — The Unbroken Stroke', sith: 'Mastery — Sundering' },

  /* ── The Guard ─────────────────────────────────────────────────────── */
  { id: 'attune-guard', axis: 'guard', to: ['soresu', 'makashi', 'aegis'],
    jedi: 'Attunement of the Guard', sith: 'Attunement of the Wall' },
  { id: 'soresu', axis: 'guard', to: ['vaapad', 'encircle'],
    jedi: 'Form III — Soresu', sith: 'Form III — Resilience' },
  { id: 'makashi', axis: 'guard', to: ['counterstroke'],
    jedi: 'Form II — Makashi', sith: 'Form II — The Duellist' },
  { id: 'aegis', axis: 'guard', to: ['thorns', 'steadfast', 'unbound-shield'],
    jedi: 'Aegis', sith: 'Carapace' },
  { id: 'vaapad', axis: 'guard', to: ['bastion'],
    jedi: 'Form VII — Vaapad', sith: 'Form VII — The Fed Fury' },
  { id: 'counterstroke', axis: 'guard', to: ['bastion'],
    jedi: 'Counterstroke', sith: 'Answer in Kind' },
  { id: 'thorns', axis: 'guard', to: ['steadfast'],
    jedi: 'Reflection', sith: 'Recoil' },
  { id: 'encircle', axis: 'guard', to: [],
    jedi: 'Encircled', sith: 'Surrounded and Fed' },
  { id: 'steadfast', axis: 'guard', to: ['bastion'],
    jedi: 'Steadfast', sith: 'Immovable' },
  { id: 'bastion', axis: 'guard', to: [],
    jedi: 'Mastery — Bastion', sith: 'Mastery — The Iron Wall' },

  /* ── The Force ─────────────────────────────────────────────────────── */
  { id: 'attune-force', axis: 'force', to: ['wellspring', 'ataru', 'tutaminis', 'stormsense'],
    jedi: 'Attunement of the Force', sith: 'Attunement of Power' },
  { id: 'stormsense', axis: 'force', to: [],
    jedi: 'Storm Sense', sith: 'Eyes in the Murk' },
  { id: 'wellspring', axis: 'force', to: ['conduit'],
    jedi: 'Wellspring', sith: 'The Deep Well' },
  { id: 'ataru', axis: 'force', to: ['repulse'],
    jedi: 'Form IV — Ataru', sith: 'Form IV — The Leaping Death' },
  { id: 'tutaminis', axis: 'force', to: ['detonate'],
    jedi: 'Tutaminis', sith: 'Devour the Bolt' },
  { id: 'conduit', axis: 'force', to: ['tempest', 'unbound-pull'],
    jedi: 'Conduit', sith: 'The Taking Channel' },
  { id: 'repulse', axis: 'force', to: ['tempest', 'unbound-push'],
    jedi: 'Force Repulse', sith: 'Shockwave' },
  { id: 'detonate', axis: 'force', to: ['unbound-rend'],
    jedi: 'Dissolution', sith: 'Detonation' },
  { id: 'tempest', axis: 'force', to: ['unbound-stasis'],
    jedi: 'Mastery — Tempest', sith: 'Mastery — The Storm' },

  /* ── The Body ──────────────────────────────────────────────────────── */
  { id: 'attune-body', axis: 'body', to: ['vitality', 'celerity', 'meditation'],
    jedi: 'Attunement of the Body', sith: 'Attunement of the Flesh' },
  { id: 'vitality', axis: 'body', to: ['secondwind'],
    jedi: 'Vitality', sith: 'Spite' },
  { id: 'celerity', axis: 'body', to: ['momentum'],
    jedi: 'Celerity', sith: 'The Quickening' },
  { id: 'meditation', axis: 'body', to: ['undying', 'sapper'],
    jedi: 'Meditation', sith: 'Discipline of Pain' },
  { id: 'sapper', axis: 'body', to: [],
    jedi: 'Field Engineering', sith: 'Labour of the Weak' },
  { id: 'secondwind', axis: 'body', to: ['undying'],
    jedi: 'Second Wind', sith: 'Refusal' },
  { id: 'momentum', axis: 'body', to: [],
    jedi: 'Momentum', sith: 'Bloodrush' },
  { id: 'undying', axis: 'body', to: ['unbound-unleash'],
    jedi: 'Mastery — Undying', sith: 'Mastery — The Unkillable' },

  /* ── Communion ─────────────────────────────────────────────────────── */
  /* Rooted on the attunement like the other five, which it could not be until
   * there WAS one: bond had a mastery and no attunement, so this current was
   * the only one whose heart was a common card capped at three ranks —
   * exactly on the "never runs out" bar rather than comfortably past it. */
  { id: 'attune-bond', axis: 'bond', to: ['communion'],
    jedi: 'Attunement of the Bond', sith: 'Attunement of the Pact' },
  { id: 'communion', axis: 'bond', to: ['suffusion', 'vow', 'skirmish', 'triage'],
    jedi: 'Battle Meditation', sith: 'Dominion' },
  /* ── PLAN.md §4.6's two, and they are here because this is the current
   * about the men beside you. Both change the KEYSTONE — `lineGathered` —
   * which is the whole reason the section asks for at least two: "variance
   * that cannot touch the keystone is variance in a side pocket". */
  { id: 'skirmish', axis: 'bond', to: ['unity'],
    jedi: 'Skirmish Order', sith: 'Loose Rein' },
  { id: 'triage', axis: 'bond', to: ['unity', 'unbound-heal'],
    jedi: 'Triage', sith: 'Blood Debt' },
  { id: 'suffusion', axis: 'bond', to: ['unity'],
    jedi: 'Force Suffusion', sith: 'Siphoned Vitality' },
  { id: 'vow', axis: 'bond', to: ['unity', 'standfast'],
    jedi: "Guardian's Vow", sith: 'Blood Pact' },
  { id: 'standfast', axis: 'bond', to: [],
    jedi: 'Stand Fast', sith: 'None May Leave' },
  { id: 'unity', axis: 'bond', to: [],
    jedi: 'Mastery — The Unifying Force', sith: 'Mastery — The Rule of Two' },

  /* ── The Dark ──────────────────────────────────────────────────────── */
  { id: 'attune-dark', axis: 'dark', to: ['lifesteal', 'juyo', 'lightning', 'salvage'],
    jedi: 'Attunement of the Shadow', sith: 'Attunement of the Dark' },
  { id: 'salvage', axis: 'dark', to: [],
    jedi: 'Salvage', sith: "The Scavenger's Right" },
  { id: 'lifesteal', axis: 'dark', to: ['execute'],
    jedi: 'Sustenance', sith: 'Dark Sustenance' },
  { id: 'juyo', axis: 'dark', to: ['fury'],
    jedi: 'Form VII — Vaapad Unbound', sith: 'Form VII — Juyo' },
  { id: 'lightning', axis: 'dark', to: ['compel', 'unbound-lightning'],
    jedi: 'The Refused Lightning', sith: 'Force Lightning' },
  /* Hung off lightning rather than off the heart, and further out than any
   * other facet on this axis, because it is the deepest thing the dark side
   * offers here: every other card in the game acts on a body, and this one
   * acts on a decision. Reaching it means having already taken the lightning,
   * which is the point — you do not arrive at taking someone's mind by
   * accident. The Jedi name is the honest one for a Jedi who has done it. */
  { id: 'compel', axis: 'dark', to: ['unbound-compel'],
    jedi: 'The Unforgivable Word', sith: 'Domination' },
  { id: 'execute', axis: 'dark', to: ['darkside'],
    jedi: 'Mercy Stroke', sith: 'Cull the Weak' },
  { id: 'fury', axis: 'dark', to: ['darkside'],
    jedi: 'Desperation', sith: 'Fury' },
  { id: 'darkside', axis: 'dark', to: [],
    jedi: 'Mastery — The Long Fall', sith: 'Mastery — The Dark Side' },

  /* ── the two techniques that belong to no discipline ───────────────── */
  // Cleaving Throw and Sundering are both blade, but the throw is the one
  // technique in the game that leaves your hand — it hangs off the outermost
  // facet of the blade current rather than sitting inside the shape.
  { id: 'saberthrow', axis: 'blade', to: ['unbound-throw'],
    jedi: 'Cleaving Throw', sith: 'The Loosed Blade' },

  /* ── the unbound tier: one leaf per power, past its current's mastery ──
   *
   * "…every force ability/power was represented in the holocron (where it fits
   * like make them be on the corresponding path)."
   *
   * Generated off `Powers.UNBOUND`, which is also what `Waves.BOONS` turns into
   * the ten cards and what `Player._recover` reads to decide whether a power
   * has a cooldown at all. Three consumers, one list — see the note in
   * Waves.js, and the one in Powers.js for what the tier costs.
   *
   * The JOINS are written from the OTHER end, above, and not from here: that is
   * this table's own convention — each pair is written once, from the facet
   * nearer the root — and reading them there is also the honest picture of the
   * shape. Eight of the ten hang off their own technique (the unbound throw off
   * Cleaving Throw, the unbound lightning off Force Lightning, the unbound
   * Disassemble off Dissolution), which is where a player would look for them;
   * the two the lattice has no facet for — the barrier's and the cry's — hang
   * off their current's mastery. `to: []` because a leaf is a leaf: the tier
   * does not chain into itself, so taking one is never a step towards
   * another. */
  ...UNBOUND.map((u) => ({
    id: unboundId(u.key), axis: u.axis, to: [], jedi: u.jedi, sith: u.sith,
  })),
];

/* ── derived indexes, built once ─────────────────────────────────────── */

const BY_ID = new Map(FACETS.map((s) => [s.id, s]));
const NEIGHBOURS = (() => {
  const m = new Map(FACETS.map((s) => [s.id, new Set()]));
  for (const s of FACETS) {
    for (const t of s.to) {
      if (!m.has(t)) continue;              // a broken link is caught by the checks
      m.get(s.id).add(t);
      m.get(t).add(s.id);
    }
  }
  return m;
})();

export function neighboursOf(id) { return [...(NEIGHBOURS.get(id) || [])]; }
export function facetsOf(axis) { return FACETS.filter((s) => s.axis === axis); }
export function currentOf(axis) { return CURRENTS.find((c) => c.axis === axis) || null; }
export function isRoot(id) { return CURRENTS.some((c) => c.root === id); }

/**
 * Each current's zone, and the transform that fits its shape into it.
 *
 * Computed once from the table: the current's own bounding box is centred in
 * the zone and scaled down until it fits (never up — the offsets are authored
 * spacing, and blowing a four-facet current up to fill a zone would make it
 * shout). So the table can be edited freely, and a facet moved to the edge of
 * its shape pulls the whole current in rather than escaping the lattice.
 */
/* ══════════════════════════════════════════════════════════════════════ */
/*  Names, and the alignment they are read in                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The name of a facet to a player of this order.
 *
 * 'jedi' and 'sith' read their own tradition's name. Everything else — the
 * Grey, and a player who has chosen no order at all — reads the canonical name
 * off BOONS, which is the vocabulary the draft screen and the HUD use. That is
 * not a fallback: a Grey took no temple's words, and giving them the Jedi
 * column by default would be the one place in the game where "neither code" is
 * quietly resolved into one.
 */
export function nameOf(id, orderId) {
  const s = BY_ID.get(id);
  const b = boonById(id);
  if (!s) return b ? b.name : id;
  if (orderId === 'jedi' && s.jedi) return s.jedi;
  if (orderId === 'sith' && s.sith) return s.sith;
  return b ? b.name : (s.jedi || id);
}

/** The current's own name and creed, in that alignment. */
export function currentName(axis, orderId) {
  const c = currentOf(axis);
  if (!c) return axis;
  return (orderId === 'jedi' && c.jedi) || (orderId === 'sith' && c.sith) || c.grey || c.jedi;
}
export function creedOf(axis, orderId) {
  const c = currentOf(axis);
  if (!c || !c.creed) return '';
  return orderId === 'sith' ? c.creed.sith : c.creed.jedi;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The ledger                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/** Why a facet cannot be woken right now — one of these, or null when it can. */
export const LOCKED = {
  reach: 'nothing you hold is joined to it',
  spent: 'nothing left to give',
  insight: 'not enough Insight',
  gated: 'the discipline is not yet earned',
  depth: 'not this early in a run',
  offer: 'the Force is not showing you this one',
};

/**
 * HOW MANY OF THE LEGAL FACETS THE HOLOCRON IS SHOWING — PLAN.md §4.6's first
 * bullet.
 *
 *     The holocron offers three of the currently-legal facets, not all 46.
 *     Same 46 nodes, same adjacency; only the OFFER changes. A solved build
 *     order becomes a found one.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY AN OFFER AND NOT A SHUFFLE OF THE TREE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The lattice is the same lattice in every run — the same six currents, the
 * same joins, the same prices — because that is what a player LEARNS, and a
 * graph that reshuffled would be a graph nobody could plan in. What changes is
 * which of the legal moves is available this minute. So the second run of a
 * player who has solved "Vitality, then Celerity, then Momentum" is not that
 * run again: the same three cards are still the right ones and the Force is
 * showing him a different three, and the decision becomes what to do with what
 * he is offered rather than what he decided before he landed.
 *
 * THREE, and it is the draft's own number: `drawBoons` offers three cards on an
 * ordinary wave, so a player already knows what three choices look like and the
 * two systems do not disagree about how wide a decision is.
 *
 * ── AND IT RE-ROLLS ON A PURCHASE, NOT ON A CLOCK ──────────────────────────
 *
 * The offer is a pure function of the run's seed and how much has been bought,
 * so it is the same offer every time the Holocron is opened until something is
 * taken — a player who closes the screen to think has not lost the hand. It is
 * also derived rather than stored, which is what keeps it correct across a
 * level change: `snapshot` carries the seed and the count, and the offer falls
 * out of them on the far side.
 */
export const OFFER = 3;

/**
 * The Insight a run holds, and the facets it has woken with it.
 *
 * DELIBERATELY SEPARATE FROM `takenBoons`. The taken-set is the truth about
 * what a player HOLDS — it is fed by the order's grants, by the draft and by
 * this — and it is rebuilt from the Run on every level change. This is the
 * truth about the CURRENCY, which is a different thing with a different
 * lifetime, and keeping the two apart is what stops a landing from silently
 * refunding or double-charging (see Run.js, which carries both across a rung).
 */
export class Communion {
  constructor(o = {}) {
    this.insight = Math.max(0, o.insight ?? 0);
    /**
     * A PURSE THAT DOES NOT EMPTY, AND A DEPTH GATE THAT DOES NOT HOLD.
     *
     * `settings.holocron === 'open'` promises, in the menu card and in
     * `World.spawnPlayer`'s own note, that "everything is REACHABLE". It was
     * not, and the money was never the reason. Driven through this class at
     * wave 1 with an infinite purse, nineteen facets still answer
     * `LOCKED.depth` — `lightning`, `compel`, `darkside`, `sunder`, `bastion`,
     * `tempest`, `undying`, `unity` among them — because a facet inherits its
     * card's `minWave` and the deepest is 16. Those are exactly the powers the
     * setting was added for: "I haven't even been able to force lightning or
     * force compel yet."
     *
     * So `open` lifts BOTH, and only for the player who asked for it. The
     * earned game is untouched: `minWave` is still the one hard gate a draft
     * cannot be argued around, prices still climb, and the shape of the
     * lattice — the joins, the disciplines a mastery is gated on — is still
     * exactly what it draws, because those are rules you can satisfy by
     * buying rather than walls you cannot see past.
     */
    this.open = !!o.open;
    /** Facet ids woken with Insight, in order. Its LENGTH is the price escalator. */
    this.bought = Array.isArray(o.bought) ? o.bought.slice() : [];
    this.earned = Math.max(0, o.earned ?? this.insight);
    /**
     * THE RUN'S OWN NUMBER, and what makes an offer a fact about a sitting
     * rather than about a process. `World` hands it `runSeed`; a ledger built
     * with none takes 0, which is a perfectly good stated seed and is what
     * every check and every headless bench gets unless it says otherwise.
     */
    this.seed = (o.seed | 0) >>> 0;
    /** The fraction of an Insight owed but not yet whole — see `earn`. Carried
     *  on the snapshot so a rejoining peer is not paid the remainder twice. */
    this._carry = Number.isFinite(o.carry) ? o.carry : 0;
  }

  /**
   * Insight for surviving a wave. Boss waves are worth more; see INSIGHT_*.
   *
   * `rate` is `insightRate(director.drafts)` and defaults to the drafting one,
   * so every existing caller is byte-identical. See TRIAL_INSIGHT_PER_WAVE for
   * why a mode with no draft is paid differently.
   */
  earn(wave, boss = false, rate = null) {
    const r = rate || insightRate(true);
    const raw = r.per + (boss ? r.boss : 0);
    /**
     * A WHOLE PURSE OVER A FRACTIONAL RATE.
     *
     * Every rate this ledger was built on is an integer, and every price in
     * `COST` is one, so `insight` has always been a whole number and three
     * screens print it as one. `hazardPay` makes the rate fractional — a run
     * under A HEAD TO CUT OFF is paid 1.08 a wave — and there are only two
     * ways to spend that: round each payout, which pays exactly nothing for
     * any rule worth less than half a wave, or carry the remainder.
     *
     * It carries. `_carry` is the fraction owed, `insight` and `earned` move
     * only in whole units, and over a run the player is paid the exact rate:
     * 40 waves at 1.08 is 43 Insight and not 40. Byte-identical when the rate
     * is an integer, which is every existing caller — the carry stays at 0 and
     * `n === raw`.
     */
    this._carry += raw;
    const n = Math.floor(this._carry + 1e-9);
    this._carry -= n;
    this.insight += n;
    this.earned += n;
    return n;
  }

  /** What the next rank of this facet costs, given what is already held. */
  costOf(id, taken) {
    const b = boonById(id);
    if (!b) return Infinity;
    const base = COST[b.rarity] ?? COST.common;
    return base + COST_STEP * this.bought.length + RANK_STEP * rankOf(taken, id);
  }

  /**
   * Can this facet be woken, and if not, why not.
   *
   * `wave` is the depth asking, because a facet inherits its card's `minWave`:
   * the tree must not be a way around the one hard gate the draft has, or the
   * third facet of a run could be Force Lightning. Same for `requires`, which is
   * how the masteries are gated on having committed to an axis — a mastery you
   * can simply buy is not a mastery.
   */
  reasonLocked(id, taken, wave = 1) {
    const s = BY_ID.get(id);
    const b = boonById(id);
    if (!s || !b) return LOCKED.reach;
    if (rankOf(taken, id) >= maxRank(b)) return LOCKED.spent;
    /* Depth is the draft's one hard gate and the tree must not be a way round
     * it — unless the player has opened the purse, which is a request for
     * exactly that. See the note on `Communion.open`. */
    if (!this.open && wave < (b.minWave ?? 1)) return LOCKED.depth;
    if (b.requires && !b.requires(taken)) return LOCKED.gated;
    if (!this.reachable(id, taken)) return LOCKED.reach;
    /**
     * ── THE THREE-CARD OFFER IS GONE, AND IT WAS THE WHOLE COMPLAINT ────────
     *
     * "the holocron does not unlock in order like you can't just choose to do
     *  one list or path it picks and chooses almost at random"
     *
     * It did. `offerNow` dealt THREE of the legal facets from a seeded stream
     * and everything else answered `LOCKED.offer` — "the Force is not showing
     * you this one" — so the lattice a player was looking at was never the
     * thing they could act on. Simulated on the shipped build, a player who
     * took a blade facet whenever one appeared was offered none for the first
     * four picks and pulled into `force` instead.
     *
     * TWO THINGS MADE IT WORSE THAN THREE-OF-N SOUNDS. The six roots carry
     * `stack: Infinity`, so they are legal forever and sat in the pool
     * competing for those three slots for the whole run — the same simulation
     * bought `attune-force` and `attune-blade` five times between them. And
     * the deal re-rolls on every purchase, so the one facet you were saving
     * for could vanish the moment you bought anything else.
     *
     * What gates a facet now is what the lattice actually draws: the joins
     * (`reachable`), the depth (`minWave`), the disciplines (`requires`) and
     * the price. Those are rules a player can see and plan against. The
     * randomness was not.
     *
     * `offerNow` is kept and now answers with every legal facet, because it is
     * still the honest question "what may I take right now" and the Holocron
     * and the checks both ask it.
     */
    if (!this.open && this.insight < this.costOf(id, taken)) return LOCKED.insight;
    return null;
  }

  /**
   * Skyrim's rule: a root, or joined to something already woken.
   *
   * "Already woken" means held AT ALL — by the draft, by the order's grants, or
   * by an earlier purchase — which is what makes a drafted card a bridgehead
   * into a current the player had not touched. A facet you already hold is
   * trivially reachable, so buying its next rank never needs a neighbour.
   */
  reachable(id, taken) {
    if (isRoot(id)) return true;
    if (rankOf(taken, id) > 0) return true;
    for (const n of NEIGHBOURS.get(id) || []) if (rankOf(taken, n) > 0) return true;
    return false;
  }

  /**
   * WHICH OF THE LEGAL FACETS THE FORCE IS SHOWING — see `OFFER`.
   *
   * "Currently legal" is everything that passes every rule EXCEPT the offer
   * itself and the price: a facet you cannot afford is still one of the three
   * you are being shown, because "save for it" is a decision and "it is not on
   * the table" is not. Sorted before the deal so the answer cannot depend on
   * the order `FACETS` happens to be written in, and dealt from a seeded stream
   * of the run's number and the purchase count — so the same run offers the
   * same hand until something is taken, and closing the screen to think costs
   * nothing.
   *
   * A run with fewer than `OFFER` legal facets is offered all of them, which is
   * the opening of every run: the six attunements are roots and nothing else is
   * reachable until one of them is woken.
   */
  offerNow(taken, wave = 1) {
    const legal = [];
    for (const s of FACETS) {
      const b = boonById(s.id);
      if (!b) continue;
      if (rankOf(taken, s.id) >= maxRank(b)) continue;
      if (wave < (b.minWave ?? 1)) continue;
      if (b.requires && !b.requires(taken)) continue;
      if (!this.reachable(s.id, taken)) continue;
      legal.push(s.id);
    }
    /* EVERY legal facet, sorted so the answer never depends on the order
     * `FACETS` happens to be written in. The seeded three-card deal that used
     * to stand here is gone — see `reasonLocked`. */
    legal.sort();
    return legal;
  }

  canBuy(id, taken, wave = 1) { return this.reasonLocked(id, taken, wave) === null; }

  /**
   * Spend. Returns the BOON to be applied, or null — the caller is expected to
   * put it through `World.applyBoon`, which is the one path that records the
   * rank, tells the Run, applies it to every local player and re-derives
   * anything downstream. This deliberately does not touch the taken-set itself:
   * two places that both add a rank is exactly how a landing used to count a
   * rank-2 card as rank 8.
   */
  buy(id, taken, wave = 1) {
    if (!this.canBuy(id, taken, wave)) return null;
    const cost = this.costOf(id, taken);
    /* An open purse is not spent. The price is still COMPUTED and still shown,
     * because the escalator is the shape of the choice and the card promises it
     * survives — what it does not do is stop you. */
    if (!this.open) this.insight -= cost;
    this.bought.push(id);
    const b = boonById(id);
    return b;
  }

  /** What a save/restore across a level change has to carry. See Run.js. */
  snapshot() {
    return { insight: this.insight, carry: this._carry, bought: this.bought.slice(), earned: this.earned,
             /* Carried, or a level change would quietly shut a purse the player
              * opened in the deploy screen. */
             open: this.open,
             /* The offer is DERIVED from these two, so carrying the seed is
              * what makes the hand on the far side of a ground change the same
              * hand — see `offerNow`. */
             seed: this.seed };
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Reading the lattice                                                   */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Everything the meditation needs to draw one facet. Built here rather than in
 * the UI so that the rules — reachable, affordable, gated, spent — have exactly
 * one implementation, and so a headless check can ask the same questions the
 * screen asks without a DOM.
 */
export function facetView(id, { taken, ledger, wave = 1, order = null }) {
  const s = BY_ID.get(id);
  const b = boonById(id);
  if (!s || !b) return null;
  const rank = rankOf(taken, id);
  const locked = ledger ? ledger.reasonLocked(id, taken, wave) : LOCKED.reach;
  return {
    id, axis: s.axis,
    name: nameOf(id, order),
    canon: b.name,
    icon: b.icon, tag: b.tag, text: b.text,
    rarity: b.rarity || 'common',
    rarityLabel: (RARITY[b.rarity] || RARITY.common).label,
    rank, max: maxRank(b),
    held: rank > 0,
    root: isRoot(id),
    mastery: !!b.requires,
    cost: ledger ? ledger.costOf(id, taken) : Infinity,
    locked,
    can: locked === null,
    to: neighboursOf(id),
    /**
     * THE TWO NUMBERS A REFUSAL NEEDS, carried so the screen can print them.
     *
     * "A mastery. Commit to the discipline first." and "Too early. This one
     * comes later." are the two lock lines that refuse without saying how far
     * away the thing is — the same defect the cards themselves had, one surface
     * out. A player deciding whether to save, or to buy a third blade card, is
     * asking exactly "how many" and "which wave", and both numbers are right
     * here: `needs` is what the card declares (see `UNBOUND_NEEDS` in Waves.js)
     * and `have` is what `axisCountOf` already counts for `requires` itself.
     */
    minWave: b.minWave ?? 1,
    needs: b.needs ?? null,
    have: b.needs ? axisCountOf(taken, s.axis) : null,
  };
}

/** What a current is for — the plate's own subtitle. See CURRENTS. */
export function whatOf(axis) {
  return CURRENTS.find((c) => c.axis === axis)?.what || '';
}

/** The whole lattice, in draw order: lines want every facet's position anyway. */
export function latticeView(opts) {
  return FACETS.map((s) => facetView(s.id, opts)).filter(Boolean);
}

/**
 * How committed a holding is to each current, for the meditation's sidebar and
 * for the scoreboard. Ranks, not distinct cards, for exactly the reason
 * `axisCountOf` counts them: a second rank of Djem So is another commitment to
 * the blade.
 *
 * Counted BY PLACE — the facets standing in this current — and not by the
 * boon's `axes` tags, which are a different question with a different answer.
 * Six cards carry two axes (Makashi is guard and blade, Juyo is blade and
 * dark), and every one of them stands in exactly one current; `axisCountOf` is
 * what the MASTERIES read, and it deliberately counts a two-axis card toward
 * both. `taken.attune` also has no axes at all, so counting by tag would leave
 * the heart of every current out of its own shape.
 */
export function shapeOf(taken) {
  return AXES.map((axis) => {
    const mine = facetsOf(axis);
    let woken = 0, ranks = 0;
    for (const s of mine) {
      const r = rankOf(taken, s.id);
      if (r > 0) woken++;
      ranks += r;
    }
    return { axis, woken, ranks, total: mine.length, mastery: axisCountOf(taken, axis) };
  });
}

/**
 * The current a holding is most committed to — what a run would call itself.
 * Ties go to the earlier current in CURRENTS, which is stable rather than
 * arbitrary.
 */
export function dominantAxis(taken) {
  let best = null;
  for (const row of shapeOf(taken)) if (!best || row.ranks > best.ranks) best = row;
  return best && best.ranks > 0 ? best.axis : null;
}
