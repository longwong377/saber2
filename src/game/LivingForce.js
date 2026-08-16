/**
 * BATTLEFRONT BORZ — the Force livingForce: a sky you spend Insight on.
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
 * The livingForce answers all three with one object: the boon table, ARRANGED.
 * Every card in BOONS and every ATTUNEMENT is a current with a fixed place in the
 * sky, joined to its neighbours by lines. Insight — earned by surviving waves —
 * buys currents. Reachability is Skyrim's rule, which is the right rule because it
 * is the one that makes a plan out of a purchase:
 *
 *      A current may be lit if it is its livingForce's ROOT, or if a current it is
 *      joined to is already lit.
 *
 * ── HOW IT SITS ON TOP OF THE DRAFT, RATHER THAN REPLACING IT ─────────────
 *
 * The draft still runs, unchanged, and this is the important part: a DRAFTED
 * card lights its current too. So the two halves are one system —
 *
 *    the draft   the Force offers. It can light a current anywhere in the sky,
 *                including one you could never have reached, and that current is
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
 * meditation shows you the sky and your record ON it; it does not sell you a
 * head start. The one thing it hands the next run is a PLAN, which is the thing
 * a player should be carrying between runs anyway.
 *
 * ── THE NAMES MOVE WITH THE ALIGNMENT ─────────────────────────────────────
 *
 * The same current reads as a Jedi discipline to a Jedi and as a Sith one to a
 * Sith. This is naming and nothing else — the mechanic under it is identical,
 * because a card that is mechanically different by order is a balance problem
 * wearing a costume — and it uses `Order.js`'s existing three-way alignment
 * rather than inventing a second one. A Grey reads the canonical name, which is
 * the one BOONS already carries: they took no temple's vocabulary.
 */

import { BOONS, ATTUNEMENTS, RARITY, maxRank, rankOf, boonById, axisCountOf } from './Waves.js';

/* ══════════════════════════════════════════════════════════════════════ */
/*  Insight — what a run earns and what a current costs                      */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHAT A WAVE IS WORTH, and why it is this and not more.
 *
 * The draft hands out one card every DRAFT_EVERY = 2 waves. If the tree handed
 * out one current every two waves as well, the run's reward rate would DOUBLE, and
 * `budgetFor`'s ramp — which is derived from the draft rate, in one constant
 * with its derivation written next to it — would be racing a player growing
 * twice as fast as the curve was fitted for. Wave 20 would stop being a fight.
 *
 * So the economy is deliberately a MINORITY of the reward, and it is bounded by
 * arithmetic rather than by feel:
 *
 *      insight(w)  =  w + BOSS_BONUS · floor(w / 5)
 *      cost(k)     =  base(rarity) + STEP · k        (k = currents already bought)
 *
 * The costs are an arithmetic series, so the number of currents a run of w waves
 * can afford grows like √w while the cards it drafts grow like w/2. Measured
 * against the shipping tables: by wave 20 a run has 28 Insight and has bought
 * FOUR commons (4+6+8+10 = 28) against ten drafted cards, and by wave 40 it has
 * 56 and has bought six (4+6+8+10+12+14 = 54) against twenty. The tree is about
 * a third of the run at wave 20 and a quarter of it at wave 40, and it never
 * overtakes the draft at any depth. tools/checks/livingForce.mjs pins exactly
 * that, as a closed form, at every wave out to 60.
 */
export const INSIGHT_PER_WAVE = 1;
export const INSIGHT_BOSS_BONUS = 2;
/** Base price by rarity — an epic is a commitment, a common is a step. */
export const COST = { common: 4, rare: 6, epic: 9 };
/** What each current already bought adds to the price of the next one. */
export const COST_STEP = 2;
/** …and what each rank already held adds, so a repeat is never the cheap play. */
export const RANK_STEP = 3;

/** Insight a run of `waves` waves will have earned, in closed form. */
export function insightAfter(waves, bossEvery = 5) {
  if (!(waves > 0)) return 0;
  return waves * INSIGHT_PER_WAVE + Math.floor(waves / bossEvery) * INSIGHT_BOSS_BONUS;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The sky                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Six livingForces. Five are the axes the masteries and the attunements
 * already name — so a run's cards, its attunements and its tree all pull in the
 * same direction and a build has one identity rather than three — and the sixth
 * is Communion, which is where the cards that land on somebody else live.
 *
 * `root` is the current that needs no neighbour. For the five old axes it is that
 * axis's ATTUNEMENT, which is exactly right: an attunement is uncapped and
 * repeatable, so the heart of a livingForce can never be exhausted and a
 * livingForce can never close. Communion has no attunement (a sixth one would
 * make the boss draft six cards wide, which is a layout, not a design), so its
 * root is Communion itself.
 *
 * Where each one SITS is not in this table: it owns a zone of the sky, and the
 * shape its currents declare is fitted into that zone. See ZONE and positionOf.
 */
export const SKY = { w: 1000, h: 720 };

/**
 * THE SKY IS DIVIDED BEFORE IT IS DRAWN.
 *
 * A current's `dx`/`dy` below are its place in ITS OWN CURRENT and nothing
 * else — a shape, not a coordinate. `positionOf` fits each livingForce's
 * whole shape into its own zone of the sky, so two livingForces can never
 * grow into each other and a current added to one cannot land on top of a current in
 * another. The first hand-placed version of this table did exactly that: four
 * pairs from different livingForces ended up within 40 px of one another and
 * one current fell 60 px off the bottom of the viewBox.
 *
 * Six zones, three across and two down, in the order CURRENTS declares.
 * `pad` leaves room for the label under each current and the livingForce's own
 * name above the group.
 */
const ZONE = { cols: 3, rows: 2, halfW: 138, halfH: 120, top: 200, bottom: 520, x: [182, 500, 818] };

export const CURRENTS = [
  { axis: 'blade', root: 'attune-blade', 
    jedi: 'The Guardian', sith: 'The Executioner', grey: 'The Blade',
    creed: { jedi: 'The blade is the last argument, and the shortest.',
             sith: 'There is no argument. There is the blade.' } },
  { axis: 'guard', root: 'attune-guard', 
    jedi: 'The Sentinel', sith: 'The Bulwark', grey: 'The Guard',
    creed: { jedi: 'What is turned aside was never yours to answer for.',
             sith: 'Let it come. Let it come back.' } },
  { axis: 'force', root: 'attune-force', 
    jedi: 'The Consular', sith: 'The Sorcerer', grey: 'The Well',
    creed: { jedi: 'The Force is not a weapon you spend.',
             sith: 'Everything is a weapon, if you are willing to spend it.' } },
  { axis: 'body', root: 'attune-body', 
    jedi: 'The Pilgrim', sith: 'The Juggernaut', grey: 'The Body',
    creed: { jedi: 'The body is the first thing the Force is given.',
             sith: 'Pain is only information.' } },
  { axis: 'bond', root: 'attune-bond',
    jedi: 'The Unifying Force', sith: 'The Rule of Two', grey: 'Communion',
    creed: { jedi: 'There is no you. There is what stands beside you.',
             sith: 'One to embody the power. One to crave it.' } },
  { axis: 'dark', root: 'attune-dark', 
    jedi: 'The Shadow', sith: 'The Abyss', grey: 'The Dark',
    creed: { jedi: 'Name it, so that you can refuse it.',
             sith: 'Take it. It was always going to be taken.' } },
];

export const AXES = CURRENTS.map((c) => c.axis);

/**
 * EVERY STAR IN THE SKY.
 *
 * `id` is a BOONS or ATTUNEMENTS id and is the whole of the mechanical link:
 * this table adds a PLACE, a set of LINES and two NAMES, and nothing else. A
 * current cannot have an effect the boon table does not have, which is the
 * property that stops this file from quietly becoming a second, divergent copy
 * of the game's balance.
 *
 * `to` lists the currents this one is joined to. The lines are undirected — the
 * reachability rule reads them both ways — so each pair is written once, from
 * the current nearer the root.
 *
 * `jedi` / `sith` are the aligned names. Where the canonical name is already a
 * Form or a technique with a real name in both traditions, both columns say so;
 * where it is a description, the two columns are two vocabularies for the same
 * act. tools/checks/livingForce.mjs asserts every current carries both, that no
 * two currents in one livingForce share a name, and that the aligned name is
 * never simply the canonical one wearing a different hat.
 */
export const STARS = [
  /* ── The Blade ─────────────────────────────────────────────────────── */
  { id: 'attune-blade', axis: 'blade', dx: 0, dy: 0, to: ['cadence', 'djemso', 'longblade'],
    jedi: 'Attunement of the Blade', sith: 'Hunger of the Blade' },
  { id: 'cadence', axis: 'blade', dx: -104, dy: -66, to: ['makashi'],
    jedi: 'Cadence', sith: 'Relentlessness' },
  { id: 'djemso', axis: 'blade', dx: 96, dy: -54, to: ['shatterpoint'],
    jedi: 'Form V — Shien', sith: 'Form V — Djem So' },
  { id: 'longblade', axis: 'blade', dx: -18, dy: 96, to: ['dualcrystal', 'saberthrow'],
    jedi: 'Reach of the Temple', sith: 'The Long Bleed' },
  { id: 'shatterpoint', axis: 'blade', dx: 152, dy: 36, to: ['sunder'],
    jedi: 'Shatterpoint', sith: 'The Flaw in All Things' },
  { id: 'dualcrystal', axis: 'blade', dx: 74, dy: 146, to: ['sunder'],
    jedi: 'Focusing Crystal', sith: 'Bled Crystal' },
  { id: 'sunder', axis: 'blade', dx: 186, dy: 148, to: [],
    jedi: 'Mastery — The Unbroken Stroke', sith: 'Mastery — Sundering' },

  /* ── The Guard ─────────────────────────────────────────────────────── */
  { id: 'attune-guard', axis: 'guard', dx: 0, dy: 0, to: ['soresu', 'makashi', 'aegis'],
    jedi: 'Attunement of the Guard', sith: 'Attunement of the Wall' },
  { id: 'soresu', axis: 'guard', dx: -96, dy: 62, to: ['vaapad', 'encircle'],
    jedi: 'Form III — Soresu', sith: 'Form III — Resilience' },
  { id: 'makashi', axis: 'guard', dx: 6, dy: 96, to: ['counterstroke'],
    jedi: 'Form II — Makashi', sith: 'Form II — The Duellist' },
  { id: 'aegis', axis: 'guard', dx: 104, dy: 54, to: ['thorns', 'steadfast'],
    jedi: 'Aegis', sith: 'Carapace' },
  { id: 'vaapad', axis: 'guard', dx: -164, dy: 152, to: ['bastion'],
    jedi: 'Form VII — Vaapad', sith: 'Form VII — The Fed Fury' },
  { id: 'counterstroke', axis: 'guard', dx: -46, dy: 186, to: ['bastion'],
    jedi: 'Counterstroke', sith: 'Answer in Kind' },
  { id: 'thorns', axis: 'guard', dx: 176, dy: 128, to: ['steadfast'],
    jedi: 'Reflection', sith: 'Recoil' },
  { id: 'encircle', axis: 'guard', dx: -196, dy: 44, to: [],
    jedi: 'Encircled', sith: 'Surrounded and Fed' },
  { id: 'steadfast', axis: 'guard', dx: 122, dy: 196, to: ['bastion'],
    jedi: 'Steadfast', sith: 'Immovable' },
  { id: 'bastion', axis: 'guard', dx: 26, dy: 256, to: [],
    jedi: 'Mastery — Bastion', sith: 'Mastery — The Iron Wall' },

  /* ── The Force ─────────────────────────────────────────────────────── */
  { id: 'attune-force', axis: 'force', dx: 0, dy: 0, to: ['wellspring', 'ataru', 'tutaminis'],
    jedi: 'Attunement of the Force', sith: 'Attunement of Power' },
  { id: 'wellspring', axis: 'force', dx: 92, dy: 62, to: ['conduit'],
    jedi: 'Wellspring', sith: 'The Deep Well' },
  { id: 'ataru', axis: 'force', dx: -84, dy: 74, to: ['repulse'],
    jedi: 'Form IV — Ataru', sith: 'Form IV — The Leaping Death' },
  { id: 'tutaminis', axis: 'force', dx: 26, dy: -84, to: ['detonate'],
    jedi: 'Tutaminis', sith: 'Devour the Bolt' },
  { id: 'conduit', axis: 'force', dx: 142, dy: 152, to: ['tempest'],
    jedi: 'Conduit', sith: 'The Taking Channel' },
  { id: 'repulse', axis: 'force', dx: -128, dy: 168, to: ['tempest'],
    jedi: 'Force Repulse', sith: 'Shockwave' },
  { id: 'detonate', axis: 'force', dx: 116, dy: -110, to: [],
    jedi: 'Dissolution', sith: 'Detonation' },
  { id: 'tempest', axis: 'force', dx: 8, dy: 232, to: [],
    jedi: 'Mastery — Tempest', sith: 'Mastery — The Storm' },

  /* ── The Body ──────────────────────────────────────────────────────── */
  { id: 'attune-body', axis: 'body', dx: 0, dy: 0, to: ['vitality', 'celerity', 'meditation'],
    jedi: 'Attunement of the Body', sith: 'Attunement of the Flesh' },
  { id: 'vitality', axis: 'body', dx: -108, dy: -58, to: ['secondwind'],
    jedi: 'Vitality', sith: 'Spite' },
  { id: 'celerity', axis: 'body', dx: 96, dy: -66, to: ['momentum'],
    jedi: 'Celerity', sith: 'The Quickening' },
  { id: 'meditation', axis: 'body', dx: -22, dy: 96, to: ['undying'],
    jedi: 'Meditation', sith: 'Discipline of Pain' },
  { id: 'secondwind', axis: 'body', dx: -156, dy: 58, to: ['undying'],
    jedi: 'Second Wind', sith: 'Refusal' },
  { id: 'momentum', axis: 'body', dx: 168, dy: 22, to: [],
    jedi: 'Momentum', sith: 'Bloodrush' },
  { id: 'undying', axis: 'body', dx: -66, dy: 168, to: [],
    jedi: 'Mastery — Undying', sith: 'Mastery — The Unkillable' },

  /* ── Communion ─────────────────────────────────────────────────────── */
  /* Rooted on the attunement like the other five, which it could not be until
   * there WAS one: bond had a mastery and no attunement, so this livingForce
   * was the only one whose heart was a common card capped at three ranks —
   * exactly on the "never runs out" bar rather than comfortably past it. */
  { id: 'attune-bond', axis: 'bond', dx: 0, dy: -92, to: ['communion'],
    jedi: 'Attunement of the Bond', sith: 'Attunement of the Pact' },
  { id: 'communion', axis: 'bond', dx: 0, dy: 0, to: ['suffusion', 'vow'],
    jedi: 'Battle Meditation', sith: 'Dominion' },
  { id: 'suffusion', axis: 'bond', dx: -102, dy: 74, to: ['unity'],
    jedi: 'Force Suffusion', sith: 'Siphoned Vitality' },
  { id: 'vow', axis: 'bond', dx: 104, dy: 74, to: ['unity'],
    jedi: "Guardian's Vow", sith: 'Blood Pact' },
  { id: 'unity', axis: 'bond', dx: 0, dy: 154, to: [],
    jedi: 'Mastery — The Unifying Force', sith: 'Mastery — The Rule of Two' },

  /* ── The Dark ──────────────────────────────────────────────────────── */
  { id: 'attune-dark', axis: 'dark', dx: 0, dy: 0, to: ['lifesteal', 'juyo', 'lightning'],
    jedi: 'Attunement of the Shadow', sith: 'Attunement of the Dark' },
  { id: 'lifesteal', axis: 'dark', dx: -104, dy: 52, to: ['execute'],
    jedi: 'Sustenance', sith: 'Dark Sustenance' },
  { id: 'juyo', axis: 'dark', dx: 100, dy: 48, to: ['fury'],
    jedi: 'Form VII — Vaapad Unbound', sith: 'Form VII — Juyo' },
  { id: 'lightning', axis: 'dark', dx: 6, dy: -92, to: ['compel'],
    jedi: 'The Refused Lightning', sith: 'Force Lightning' },
  /* Hung off lightning rather than off the heart, and further out than any
   * other current on this axis, because it is the deepest thing the dark side
   * offers here: every other card in the game acts on a body, and this one
   * acts on a decision. Reaching it means having already taken the lightning,
   * which is the point — you do not arrive at taking someone's mind by
   * accident. The Jedi name is the honest one for a Jedi who has done it. */
  { id: 'compel', axis: 'dark', dx: 12, dy: -186, to: [],
    jedi: 'The Unforgivable Word', sith: 'Domination' },
  { id: 'execute', axis: 'dark', dx: -142, dy: 148, to: ['darkside'],
    jedi: 'Mercy Stroke', sith: 'Cull the Weak' },
  { id: 'fury', axis: 'dark', dx: 146, dy: 142, to: ['darkside'],
    jedi: 'Desperation', sith: 'Fury' },
  { id: 'darkside', axis: 'dark', dx: 0, dy: 214, to: [],
    jedi: 'Mastery — The Long Fall', sith: 'Mastery — The Dark Side' },

  /* ── the two techniques that belong to no discipline ───────────────── */
  // Cleaving Throw and Sundering are both blade, but the throw is the one
  // technique in the game that leaves your hand — it hangs off the blade
  // livingForce's outermost current rather than sitting inside the shape.
  { id: 'saberthrow', axis: 'blade', dx: -142, dy: 150, to: [],
    jedi: 'Cleaving Throw', sith: 'The Loosed Blade' },
];

/* ── derived indexes, built once ─────────────────────────────────────── */

const BY_ID = new Map(STARS.map((s) => [s.id, s]));
const NEIGHBOURS = (() => {
  const m = new Map(STARS.map((s) => [s.id, new Set()]));
  for (const s of STARS) {
    for (const t of s.to) {
      if (!m.has(t)) continue;              // a broken link is caught by the checks
      m.get(s.id).add(t);
      m.get(t).add(s.id);
    }
  }
  return m;
})();

export function neighboursOf(id) { return [...(NEIGHBOURS.get(id) || [])]; }
export function starsOf(axis) { return STARS.filter((s) => s.axis === axis); }
export function livingForceOf(axis) { return CURRENTS.find((c) => c.axis === axis) || null; }
export function isRoot(id) { return CURRENTS.some((c) => c.root === id); }

/**
 * Each livingForce's zone, and the transform that fits its shape into it.
 *
 * Computed once from the table: the group's own bounding box is centred in the
 * zone and scaled down until it fits (never up — the offsets are authored
 * spacing and blowing a four-current livingForce up to fill a zone would make it
 * shout). So the table can be edited freely, and a current moved to the edge of
 * its shape pulls the whole group in rather than escaping the sky.
 */
const LAYOUT = (() => {
  const out = new Map();
  CURRENTS.forEach((c, i) => {
    const zone = { x: ZONE.x[i % ZONE.cols], y: i < ZONE.cols ? ZONE.top : ZONE.bottom,
      halfW: ZONE.halfW, halfH: ZONE.halfH };
    const mine = STARS.filter((s) => s.axis === c.axis);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of mine) {
      x0 = Math.min(x0, s.dx); x1 = Math.max(x1, s.dx);
      y0 = Math.min(y0, s.dy); y1 = Math.max(y1, s.dy);
    }
    if (!mine.length) { x0 = x1 = y0 = y1 = 0; }
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const scale = Math.min(1, (zone.halfW * 2) / w, (zone.halfH * 2) / h);
    out.set(c.axis, { zone, scale, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  });
  return out;
})();

/** The rectangle a livingForce owns, for its name and its own breathing room. */
export function zoneOf(axis) { return LAYOUT.get(axis)?.zone || null; }

/** Where a current sits in SKY coordinates. */
export function positionOf(current) {
  const L = LAYOUT.get(current.axis);
  if (!L) return { x: SKY.w / 2, y: SKY.h / 2 };
  return {
    x: L.zone.x + (current.dx - L.cx) * L.scale,
    y: L.zone.y + (current.dy - L.cy) * L.scale,
  };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Names, and the alignment they are read in                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The name of a current to a player of this order.
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

/** The livingForce's own name and creed, in that alignment. */
export function livingForceName(axis, orderId) {
  const c = livingForceOf(axis);
  if (!c) return axis;
  return (orderId === 'jedi' && c.jedi) || (orderId === 'sith' && c.sith) || c.grey || c.jedi;
}
export function creedOf(axis, orderId) {
  const c = livingForceOf(axis);
  if (!c || !c.creed) return '';
  return orderId === 'sith' ? c.creed.sith : c.creed.jedi;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The ledger                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/** Why a current cannot be lit right now — one of these, or null when it can. */
export const LOCKED = {
  reach: 'no lit current is joined to it',
  spent: 'nothing left to give',
  insight: 'not enough Insight',
  gated: 'the discipline is not yet earned',
  depth: 'not this early in a run',
};

/**
 * The Insight a run holds, and the currents it has bought with it.
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
    /** Current ids bought with Insight, in order. Its LENGTH is the price escalator. */
    this.bought = Array.isArray(o.bought) ? o.bought.slice() : [];
    this.earned = Math.max(0, o.earned ?? this.insight);
  }

  /** Insight for surviving a wave. Boss waves are worth more; see INSIGHT_*. */
  earn(wave, boss = false) {
    const n = INSIGHT_PER_WAVE + (boss ? INSIGHT_BOSS_BONUS : 0);
    this.insight += n;
    this.earned += n;
    return n;
  }

  /** What the next rank of this current costs, given what is already held. */
  costOf(id, taken) {
    const b = boonById(id);
    if (!b) return Infinity;
    const base = COST[b.rarity] ?? COST.common;
    return base + COST_STEP * this.bought.length + RANK_STEP * rankOf(taken, id);
  }

  /**
   * Can this current be lit, and if not, why not.
   *
   * `wave` is the depth asking, because a current inherits its card's `minWave`:
   * the tree must not be a way around the one hard gate the draft has, or the
   * third current of a run could be Force Lightning. Same for `requires`, which is
   * how the masteries are gated on having committed to an axis — a mastery you
   * can simply buy is not a mastery.
   */
  reasonLocked(id, taken, wave = 1) {
    const s = BY_ID.get(id);
    const b = boonById(id);
    if (!s || !b) return LOCKED.reach;
    if (rankOf(taken, id) >= maxRank(b)) return LOCKED.spent;
    if (wave < (b.minWave ?? 1)) return LOCKED.depth;
    if (b.requires && !b.requires(taken)) return LOCKED.gated;
    if (!this.reachable(id, taken)) return LOCKED.reach;
    if (this.insight < this.costOf(id, taken)) return LOCKED.insight;
    return null;
  }

  /**
   * Skyrim's rule: a root, or joined to something already lit.
   *
   * "Already lit" means held AT ALL — by the draft, by the order's grants, or
   * by an earlier purchase — which is what makes a drafted card a bridgehead
   * into a livingForce the player had not touched. A current you already hold is
   * trivially reachable, so buying its next rank never needs a neighbour.
   */
  reachable(id, taken) {
    if (isRoot(id)) return true;
    if (rankOf(taken, id) > 0) return true;
    for (const n of NEIGHBOURS.get(id) || []) if (rankOf(taken, n) > 0) return true;
    return false;
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
    this.insight -= cost;
    this.bought.push(id);
    const b = boonById(id);
    return b;
  }

  /** What a save/restore across a level change has to carry. See Run.js. */
  snapshot() { return { insight: this.insight, bought: this.bought.slice(), earned: this.earned }; }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Reading the sky                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Everything the meditation needs to draw one current. Built here rather than in
 * the UI so that the rules — reachable, affordable, gated, spent — have exactly
 * one implementation, and so a headless check can ask the same questions the
 * screen asks without a DOM.
 */
export function starView(id, { taken, ledger, wave = 1, order = null }) {
  const s = BY_ID.get(id);
  const b = boonById(id);
  if (!s || !b) return null;
  const rank = rankOf(taken, id);
  const locked = ledger ? ledger.reasonLocked(id, taken, wave) : LOCKED.reach;
  const pos = positionOf(s);
  return {
    id, axis: s.axis, x: pos.x, y: pos.y,
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
  };
}

/** The whole sky, in draw order: lines want every current's position anyway. */
export function skyView(opts) {
  return STARS.map((s) => starView(s.id, opts)).filter(Boolean);
}

/**
 * How committed a holding is to each livingForce, for the meditation's
 * sidebar and for the scoreboard. Ranks, not distinct cards, for exactly the
 * reason `axisCountOf` counts them: a second rank of Djem So is another
 * commitment to the blade.
 *
 * Counted BY PLACE — the currents of this livingForce — and not by the boon's
 * `axes` tags, which are a different question with a different answer. Six
 * cards carry two axes (Makashi is guard and blade, Juyo is blade and dark),
 * and every one of them stands in exactly one livingForce; `axisCountOf` is
 * what the MASTERIES read, and it deliberately counts a two-axis card toward
 * both. `taken.attune` also has no axes at all, so counting by tag would leave
 * the heart of every livingForce out of its own shape.
 */
export function shapeOf(taken) {
  return AXES.map((axis) => {
    const currents = starsOf(axis);
    let lit = 0, ranks = 0;
    for (const s of currents) {
      const r = rankOf(taken, s.id);
      if (r > 0) lit++;
      ranks += r;
    }
    return { axis, lit, ranks, total: currents.length, mastery: axisCountOf(taken, axis) };
  });
}

/**
 * The livingForce a holding is most committed to — what a run would call
 * itself. Ties go to the earlier livingForce in CURRENTS, which is
 * stable rather than arbitrary.
 */
export function dominantAxis(taken) {
  let best = null;
  for (const row of shapeOf(taken)) if (!best || row.ranks > best.ranks) best = row;
  return best && best.ranks > 0 ? best.axis : null;
}
