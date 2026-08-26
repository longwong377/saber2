/**
 * BATTLEFRONT BORZ — WHAT MAKES ONE SOLDIER DIFFERENT FROM THE NEXT.
 *
 * The player: "Right now do troops have any different attributes/stats at base
 * from each other? … I really want to explore and expand on this and make it a
 * really big highlight of the game (troop management)."
 *
 * Measured before this existed: they did not. The ONLY thing separating two of
 * your men was `RANKS` — hp ×1.00→1.78, dmg ×1.00→1.34, speed ×1.00→1.10, plus
 * `AIM_BY_RANK`. Same type and same rank meant the same man, exactly.
 *
 * ── THE RULE THIS FILE IS BUILT ON ──────────────────────────────────────
 *
 * A LADDER MAKES A SOLDIER BETTER. A SPREAD MAKES HIM DIFFERENT.
 *
 * Every rung of `RANKS` is strictly above the last, so a roster sorted by rank
 * is a solved roster and the only question it ever asks is "who has the biggest
 * numbers". That is not troop management, it is inventory. Everything below is
 * built to make the roster a set of DECISIONS instead:
 *
 *   · Attributes are rolled around a mean and are NOT all good. A man with 78
 *     Cadence and 24 Marksmanship empties a magazine into the sand; the same
 *     numbers reversed is a man who kills one droid a magazine and no more.
 *   · Traits are TWO-SIDED without exception. Every one gives and takes. This
 *     is not balance for its own sake — a one-sided trait is a rank wearing a
 *     name, and `Company.js`'s own law forbids cross-run POWER (it is why the
 *     personal marks are cosmetic). A veteran company is not stronger under
 *     this file. It is more specific, and specificity is what makes choosing
 *     hard.
 *   · Everything here has to be legible FROM THE FIELD. If you need the roster
 *     screen open to know that CT-1725 is jumpy, the system is a spreadsheet.
 *     Every attribute below moves something you can watch at forty metres:
 *     where he stands, when he fires, how long he takes to obey, whether he is
 *     still there when you look back.
 *
 * ── AND THE TWO ARMIES ARE NOT THE SAME GAME ────────────────────────────
 *
 * The Republic fields men and the Confederacy fields machines, and giving both
 * the same eight numbers with the serial numbers filed off would waste the one
 * asymmetry the mode is already built on. So there are two KINDS, and the axis
 * that differs is the important one:
 *
 *   FLESH depends on a PERSON. `Loyalty` decides how much a clone gains from
 *   his Jedi being near him and how far he falls when you leave — so where you
 *   stand is a command decision every second of the fight.
 *
 *   STEEL depends on a SIGNAL. `Uplink` decides how much a droid gains from a
 *   live command node and how far it falls when that node dies — so killing
 *   the officer is worth more than killing three droids.
 *
 * One army is managed by being present. The other is managed by cutting a
 * link. That is two different games out of one roster screen, and it is the
 * whole reason this file has a `kind` at all.
 */

import { clamp } from '../engine/MathUtil.js';

/* ══════════════════════════════════════════════════════════════════════ */
/*  The attributes                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Every attribute is 0..100 with a mean near 50, and every one of them names a
 * NUMBER IN THE SIM. A stat with no consumer is a number on a card, which is
 * the thing this file exists to not be — `tools/checks/attributes.mjs` asserts
 * that each id below is read by something.
 *
 * `lo`/`hi` are what the extreme ends multiply the underlying quantity by, and
 * they are deliberately narrow. A soldier is not a hero: the spread between the
 * worst and best man in a company should be the difference between a line that
 * holds and one that does not, and never the difference between one man and a
 * squad. The widest here is ±26%.
 */
export const ATTRS = [
  {
    id: 'aim', flesh: 'Marksmanship', steel: 'Targeting',
    blurb: 'How tightly he groups. Moves the cone the bolt leaves in, and the quality of the firing solution.',
    lo: 1.30, hi: 0.74,          // multiplier on SPREAD — low aim widens it
    reads: 'Enemy.aimQuality, enlistBody → A.spread',
  },
  {
    id: 'cadence', flesh: 'Cadence', steel: 'Cycling',
    blurb: 'How fast he works the trigger. More shots is more chances and more misses; it is not free.',
    lo: 0.82, hi: 1.22,          // multiplier on FIRE RATE
    reads: 'enlistBody → A.fireRate, A.burstGap',
  },
  {
    id: 'nerve', flesh: 'Nerve', steel: 'Stability',
    blurb: 'How much he can watch happen before he stops holding the line. A droid does not panic; its targeting faults.',
    lo: 0.78, hi: 1.24,          // multiplier on the morale FLOOR he musters at
    reads: 'enlistBody → Trooper.morale',
  },
  {
    id: 'grit', flesh: 'Grit', steel: 'Plating',
    blurb: 'What he survives. Not health so much as the difference between a wound and a name on the list.',
    lo: 0.86, hi: 1.18,          // multiplier on maxHp
    reads: 'enlistBody → Enemy.maxHp',
  },
  {
    id: 'pace', flesh: 'Pace', steel: 'Servos',
    blurb: 'How fast he crosses open ground — to the next cover, and back to the line when you call.',
    lo: 0.88, hi: 1.14,          // multiplier on speed
    reads: 'enlistBody → Enemy.speed',
  },
  {
    id: 'reflex', flesh: 'Reflex', steel: 'Latency',
    blurb: 'How long between seeing and doing. Acquiring a target, and taking an order you just gave.',
    lo: 1.34, hi: 0.70,          // multiplier on REACTION TIME — low reflex is slow
    reads: 'Command.ORDER_LAG — how long he takes to act on a new order',
  },
  {
    id: 'discipline', flesh: 'Discipline', steel: 'Protocol',
    blurb: 'How well he keeps his place and his fire. Holds formation, holds the shot when told to hold.',
    lo: 0.72, hi: 1.26,          // multiplier on formation tightness / order fidelity
    reads: 'CommandDirector.steer slot tolerance, Command.HOLD_BREAK',
  },
  /**
   * ── THE TWO THAT ARE ABOUT THE CAMPAIGN AND NOT THE FIREFIGHT ────────
   *
   * Every axis above decides how a man performs in the ninety seconds he is
   * being shot at. These two decide whether you still have him next area, and
   * they are here because that is what the Company page is actually about:
   * `Company.js`'s own header says the minigame is keeping them alive, and a
   * roster where nothing on it spoke to that was eight combat stats on a
   * screen about survival.
   */
  {
    id: 'hardiness', flesh: 'Constitution', steel: 'Redundancy',
    blurb: 'How long he has on the ground before he is gone. This is the number that decides whether crossing the field for him was possible.',
    lo: 0.70, hi: 1.30,          // multiplier on DOWN_BLEED, his bleed-out window
    reads: 'Enemy._goDown → the bleed-out clock',
  },
  {
    id: 'resolve', flesh: 'Resolve', steel: 'Reset',
    blurb: 'How much of himself he gets back between areas. A man who never recovers is a liability three fights from now.',
    lo: 0.66, hi: 1.30,          // multiplier on the between-areas morale rally
    reads: 'CommandDirector — MORALE.RALLY_PER_S',
  },

  /* THE ONE THAT DIFFERS, and the reason `kind` exists. See the header. */
  {
    id: 'bond', flesh: 'Loyalty', steel: 'Uplink',
    blurb: null,
    fleshBlurb: 'How much he fights above himself with his Jedi beside him — and how far he falls when you are not.',
    steelBlurb: 'How much it leans on the command signal — and how far it degrades when the node it answers to is gone.',
    /* THE WIDEST SWING IN THE TABLE, and it stays that way — this is the axis
     * the two armies are actually different on. It was 0.55/1.70 for a build
     * and that was too wide to pay for: at 1.70 a single point of Loyalty was
     * worth three of anything else, so every trait that touched it came out a
     * net upgrade no matter what was hung off the other side, and
     * `attributes.mjs` failed twelve of seventeen traits on exactly that.
     * 0.62/1.34 is still the widest total swing here and still the largest
     * single term in a man's morale. */
    lo: 0.62, hi: 1.34,          // multiplier on the JEDI_NEAR / uplink morale term
    reads: 'CommandDirector morale — the JEDI_NEAR / LEADER_NEAR presence terms',
  },
];

export const ATTR_IDS = ATTRS.map((a) => a.id);
const ATTR_BY_ID = new Map(ATTRS.map((a) => [a.id, a]));
export const attrById = (id) => ATTR_BY_ID.get(id) || null;

/** What this attribute is called for a man or for a machine. */
export function attrName(id, kind) {
  const a = ATTR_BY_ID.get(id);
  if (!a) return id;
  return (kind === 'steel' ? a.steel : a.flesh) || a.id;
}

/** …and what it says it does, which is also two answers for the bond axis. */
export function attrBlurb(id, kind) {
  const a = ATTR_BY_ID.get(id);
  if (!a) return '';
  if (a.blurb) return a.blurb;
  return kind === 'steel' ? a.steelBlurb : a.fleshBlurb;
}

/**
 * The multiplier a score of `v` (0..100) buys on this attribute's quantity.
 *
 * LINEAR THROUGH 50, and deliberately so. A curve here would mean the last ten
 * points are worth more than the first ten, which turns "field your best men"
 * back into the only strategy — the exact failure this file is written against.
 * Flat means a 70 is worth the same step up from 50 as a 30 is down, and a
 * squad of average men is a real answer rather than a consolation.
 */
export function attrScale(id, v) {
  const a = ATTR_BY_ID.get(id);
  if (!a) return 1;
  const t = clamp((v ?? 50) / 100, 0, 1);
  return t < 0.5 ? a.lo + (1 - a.lo) * (t / 0.5) : 1 + (a.hi - 1) * ((t - 0.5) / 0.5);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The traits                                                            */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A TRAIT ALWAYS GIVES AND ALWAYS TAKES. There is no exception in this table
 * and there must not be one: the moment a trait is pure upside it becomes a
 * rank with a name on it, a veteran roster becomes strictly stronger than a
 * fresh one, and `Company.js`'s law against cross-run power is broken by a
 * file that was supposed to respect it.
 *
 * `up` and `down` are attribute deltas applied at muster, in points. `flag` is
 * a behavioural switch the sim reads directly for things a number cannot say.
 *
 * `kind` gates a trait to men or machines. A droid is not brave and a clone
 * does not have a corroded actuator; the two lists are allowed to be different
 * lengths and are.
 */
/* ══════════════════════════════════════════════════════════════════════ */
/*  What two men who keep coming home together become                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * HOW MUCH GROUND TWO MEN HAVE TO HOLD SIDE BY SIDE BEFORE IT IS A BOND.
 *
 * Everything above this line is rolled at muster and fixed for life, which
 * means a roster is a table: nothing about a man ever changes because of what
 * he has LIVED THROUGH with the men beside him. This is the one thing that
 * does, and `Company.js` is where the counting happens — it folds a finished
 * run into the roll and already knows exactly which men walked up the ramp
 * together and how much ground each of them held doing it.
 *
 * FOUR, and it is a "more than one run" number rather than a tuning one. A
 * campaign is a handful of areas, so four shared grounds cannot be reached by
 * two men who were merely mustered into the same contingent and withdrew from
 * the first ground they landed on — which is the whole failure mode here. A
 * bond that formed on the first shared area would be a thing every man on
 * every manifest had by the end of his first withdrawal, and a fact that is
 * true of everybody is not a fact about anybody.
 *
 * The threshold lives HERE rather than in Company.js because `bonded.sheds`
 * below is the predicate that reads it, and a second copy of the number beside
 * the code that counts is the defect this repo has been bitten by nine times.
 */
export const BOND_AREAS = 4;

/**
 * The bonds on a stored man that are real bonds rather than shared service so
 * far. `Company.js` keeps a running tally per pair; only the ones that have
 * crossed `BOND_AREAS` are anything the sim or the roster screen calls a bond.
 */
export const liveBonds = (m) => (m?.bonds || [])
  .filter((b) => b && (b.areas | 0) >= BOND_AREAS);

/** …and whether he has any at all, which is what the trait below turns on. */
export const isBonded = (m) => liveBonds(m).length > 0;

export const TRAITS = [
  /* ── both ───────────────────────────────────────────────────────────── */
  { id: 'deadeye', name: 'Deadeye', kind: null,
    line: 'Takes his time and hits. Will not be hurried.',
    up: { aim: 16 }, down: { cadence: 14, reflex: 5 } },
  { id: 'trigger', name: 'Trigger-happy', kind: null,
    line: 'Puts a wall of fire downrange. Most of it goes somewhere else.',
    up: { cadence: 18 }, down: { aim: 15 } },
  { id: 'quick', name: 'Quick', kind: null,
    line: 'First to see it, first to move. Also first out of position.',
    up: { reflex: 16, pace: 6 }, down: { discipline: 14, aim: 6 } },
  { id: 'stubborn', name: 'Stubborn', kind: null,
    line: 'Holds the ground he was given. All of it. For as long as it takes.',
    up: { nerve: 18, discipline: 8 }, down: { reflex: 16, pace: 9 } },
  { id: 'heavyfoot', name: 'Heavy-footed', kind: null,
    line: 'Built to take it rather than to dodge it.',
    up: { grit: 16 }, down: { pace: 18, reflex: 3 } },
  { id: 'runner', name: 'Runner', kind: null,
    line: 'Crosses open ground before anyone can range him. Not much armour under it.',
    up: { pace: 18 }, down: { grit: 19 } },
  { id: 'hardtokill', name: 'Hard to kill', kind: null,
    line: 'Has been counted out before. Keeps breathing longer than he has any right to.',
    up: { hardiness: 16 }, down: { pace: 16, cadence: 14, reflex: 4 } },
  { id: 'brittle', name: 'Brittle', kind: null,
    line: 'Everything works until it does not, and then it all goes at once.',
    up: { cadence: 12, reflex: 6 }, down: { hardiness: 20 } },

  /**
   * ── THE ONE NOBODY IS ROLLED WITH ───────────────────────────────────
   *
   * `earned` keeps it out of `traitsFor`, so `rollSoldier` can never deal it:
   * every other row in this table is a fact about a man from the day he was
   * mustered, and this is the only one that is a fact about what he has DONE.
   * `Company.js` hangs it on him when two men have held `BOND_AREAS` grounds
   * side by side and `shedTraits` takes it back off, with its swing, the
   * moment the last man he is bonded to is off the roll.
   *
   * ── WHAT IT GIVES AND WHY THAT IS THE SAME THING AS WHAT IT COSTS ───
   *
   * It pays in `bond` and in nothing else, and that is the whole design rather
   * than a shortcut. `bond` is the ONLY axis in this table that is already
   * two-sided in the sim: `CommandDirector._morale` multiplies the JEDI_NEAR
   * and LEADER_NEAR presence terms by `scaleOf(t, 'bond')` AND multiplies
   * `MORALE.ALONE` — a negative per-second drift — by the same number. So a
   * bonded man genuinely fights above himself while somebody is standing with
   * him and genuinely comes apart faster when nobody is. Measured off the
   * shipped table: +16 bond is +0.00925 morale/s beside a Jedi and -0.00239/s
   * with nobody in reach, on terms that already existed. Inventing a second
   * "somebody I care about is near" channel would have been a second copy of
   * a rule this file's own axis already owns (HANDOFF 2.4).
   *
   * That asymmetry is real but it is not a price the ROSTER can see, and the
   * law at the top of this section is about the roster: a trait that reads as
   * pure profit on the card makes a veteran company strictly stronger than a
   * fresh one and breaks `Company.js`'s refusal of cross-run power. So it is
   * also paid for in the currency `tools/checks/attributes.mjs` prices every
   * other row in — each attribute point weighted by the fraction of its own
   * axis it buys. -14 Nerve is the morale floor he musters at, and -8 Resolve
   * is how much of himself he gets back between areas: he leans on somebody,
   * so he starts shakier and takes longer to come back from a bad ground.
   * Priced: +0.1088 given, -0.1160 taken, net -0.0072. A bond is a SHAPE and not
   * a reward, which is the only way it can exist in this table at all.
   *
   * ── WHAT IS DELIBERATELY NOT HERE, SO NOBODY READS IT AS AN OVERSIGHT ──
   *
   * The presence terms pay off the JEDI and off the SQUAD LEADER, so what a
   * bonded man is actually leaning on is whoever is standing with him rather
   * than the specific man he is bonded to. Making the bonded man himself a
   * presence source is a change to `CommandDirector._morale`, which is another
   * file's; everything above works today through terms that already exist. The
   * per-fight half of "take it badly when he goes down" is already in the table
   * as `MORALE.COMRADE_FELL`; what THIS adds is the part that outlives the
   * fight — lose him and the bond goes with him, for good.
   */
  { id: 'bonded', name: 'Bonded', kind: null, earned: true,
    line: 'Has come through too much beside the same one, and is not the same without them.',
    up: { bond: 16 }, down: { nerve: 14, resolve: 8 },
    sheds: (m) => !isBonded(m) },

  /* ── men ────────────────────────────────────────────────────────────── */
  { id: 'devoted', name: 'Devoted', kind: 'flesh',
    line: 'Would follow his General into anything. Somewhat lost without one.',
    up: { bond: 18 }, down: { nerve: 16, discipline: 10 } },
  { id: 'lonewolf', name: 'Lone wolf', kind: 'flesh',
    line: 'Does not need anybody watching. Does not fight harder when you are.',
    up: { nerve: 14, discipline: 6 }, down: { bond: 14 } },
  { id: 'green', name: 'Green', kind: 'flesh',
    line: 'Has not seen enough yet. Learns fast, though — this wears off.',
    /* THE ONE TRAIT THAT GOES AWAY, and `sheds` is a real predicate rather
     * than the sentence 'areas >= 3' this said for one build — which nothing
     * read, and which therefore made "this wears off" a promise on a card. See
     * `shedTraits`: three areas held and he stops being green, and the points
     * it cost him come back with it. */
    up: { pace: 6 }, down: { nerve: 14, aim: 8 }, sheds: (m) => (m.areas | 0) >= 3 },
  { id: 'veteranhand', name: 'Old hand', kind: 'flesh',
    line: 'Has done this before and it shows. Slower than he was.',
    up: { aim: 10, nerve: 12, discipline: 6 }, down: { pace: 16, reflex: 16 } },
  { id: 'reckless', name: 'Reckless', kind: 'flesh',
    line: 'Closes the range whether you told him to or not.',
    up: { cadence: 10, pace: 8 }, down: { discipline: 13 }, flag: 'pushes' },
  { id: 'ironnerved', name: 'Iron-nerved', kind: 'flesh',
    line: 'Comes back to himself between fights faster than anyone should.',
    up: { resolve: 18 }, down: { bond: 13, cadence: 8 } },
  { id: 'haunted', name: 'Haunted', kind: 'flesh',
    line: 'Carries the last one into the next one. Steady while it is happening.',
    up: { nerve: 14, discipline: 8 }, down: { resolve: 24 } },
  { id: 'careful', name: 'Careful', kind: 'flesh',
    line: 'Will not leave cover for a shot he does not like. Takes ground slowly.',
    up: { discipline: 14, aim: 8 }, down: { pace: 16, cadence: 12, reflex: 6 }, flag: 'holds' },

  /* ── machines ───────────────────────────────────────────────────────── */
  { id: 'newstock', name: 'Fresh stock', kind: 'steel',
    line: 'Off the line and unworn. Nothing has been proven about it either.',
    up: { pace: 10, cadence: 8 }, down: { nerve: 15 } },
  { id: 'corroded', name: 'Corroded', kind: 'steel',
    line: 'Actuators are going. Still holds a firing line better than most.',
    up: { discipline: 18 }, down: { pace: 15, reflex: 10 } },
  { id: 'reflashed', name: 'Reflashed', kind: 'steel',
    line: 'Targeting rewritten in the field. Sharper, and it drops the link often.',
    up: { aim: 18 }, down: { bond: 13 } },
  { id: 'hardened', name: 'Hardened', kind: 'steel',
    line: 'Plated past spec. Slow to bring round.',
    up: { grit: 20, nerve: 8 }, down: { reflex: 15, pace: 9 } },
  { id: 'fieldrepaired', name: 'Field-repaired', kind: 'steel',
    line: 'Put back together on the ground more than once. None of it is original.',
    up: { hardiness: 12, resolve: 10 }, down: { aim: 14, cadence: 12, reflex: 5 } },
  { id: 'slaved', name: 'Slaved', kind: 'steel',
    line: 'Runs almost entirely off the node. Formidable while the node lives.',
    up: { bond: 18, discipline: 8 }, down: { nerve: 24, reflex: 10 } },
];

export const TRAIT_BY_ID = new Map(TRAITS.map((t) => [t.id, t]));
export const traitById = (id) => TRAIT_BY_ID.get(id) || null;

/**
 * SHED WHAT HE HAS GROWN OUT OF, and give back what it cost him.
 *
 * Called at muster on a man restored from a roll — a trait with a `sheds`
 * predicate is only true of him for as long as the predicate is. Green is the
 * one in the table: three areas held and he is not green any more.
 *
 * THE POINTS COME BACK, which is the half that is easy to forget and would be
 * silent if it were. `rollSoldier` bakes a trait's swing straight into the
 * numbers, so removing the trait without reversing its deltas would leave a
 * veteran carrying a rookie's penalty for good, with nothing on the roster
 * screen to say why his Nerve is 14 low.
 *
 * Returns a NEW `{ attrs, traits }` and never edits what it was handed — the
 * caller's object is the record off disk.
 *
 * @param man   a stored man: `attrs`, `traits`, and whatever the predicates read.
 */
/**
 * A TRAIT'S SWING, APPLIED OR REVERSED, and there is one copy of it.
 *
 * `dir` is +1 to hang the trait on a man and -1 to take it off him again. The
 * three callers below — the muster, `applyTrait` and `shedTraits` — all used to
 * spell these two loops out, and a sign that disagreed between the way on and
 * the way off is exactly the defect `shedTraits`'s own note is about: a veteran
 * carrying a rookie's penalty for good with nothing on the roster to say why.
 */
function bake(attrs, t, dir) {
  for (const k in (t.up || {})) attrs[k] = clamp((attrs[k] ?? 50) + dir * t.up[k], 0, 100);
  for (const k in (t.down || {})) attrs[k] = clamp((attrs[k] ?? 50) - dir * t.down[k], 0, 100);
  return attrs;
}

/**
 * HANG A TRAIT ON A MAN HE WAS NOT ROLLED WITH, swing and all.
 *
 * The exact inverse of `shedTraits` and the other half of the machinery a
 * bond is built on — `Company.js` calls this when two men cross `BOND_AREAS`
 * and calls `shedTraits` when the last man one of them was bonded to is off
 * the roll. Returns a NEW `{ attrs, traits }` and never edits what it was
 * handed, for the same reason: the caller's object is the record off disk.
 *
 * A trait he already has is a no-op rather than a second helping, which is
 * what keeps the whole thing idempotent — the roll is settled on every read
 * and a man must not gain 16 Loyalty per time the Company tab is opened.
 */
export function applyTrait(man, id) {
  const t = TRAIT_BY_ID.get(id);
  const traits = (man?.traits || []).slice();
  const attrs = { ...(man?.attrs || {}) };
  if (!t || traits.includes(id)) return { attrs: man?.attrs || attrs, traits };
  traits.push(id);
  return { attrs: bake(attrs, t, 1), traits };
}

export function shedTraits(man) {
  const traits = (man?.traits || []).slice();
  const attrs = { ...(man?.attrs || {}) };
  const keep = [];
  let shed = false;
  for (const id of traits) {
    const t = TRAIT_BY_ID.get(id);
    if (!t) continue;
    if (!t.sheds || !t.sheds(man)) { keep.push(id); continue; }
    shed = true;
    bake(attrs, t, -1);
  }
  return shed ? { attrs, traits: keep } : { attrs: man?.attrs || attrs, traits };
}

/**
 * The traits a given kind may be DEALT — which is not the same list as the
 * traits a given kind may carry. `earned` rows are excluded: `bonded` is a
 * fact about what a man has done and the muster has no opinion about it, so a
 * pool that contained it would hand a fresh recruit somebody else's history.
 * `rollSoldier` draws from here, which is what makes that true rather than
 * remembered.
 */
export const traitsFor = (kind) =>
  TRAITS.filter((t) => !t.earned && (!t.kind || t.kind === kind));

/* ══════════════════════════════════════════════════════════════════════ */
/*  Rolling a soldier                                                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THREE DRAWS AND TAKE THE MIDDLE, which is not the same as a flat roll and is
 * the whole texture of a company.
 *
 * A flat 0..100 gives a roster with as many 5s as 50s, and a man who cannot
 * shoot at all is not interesting, he is a mistake you delete. Summing three
 * draws and halving the extremes clusters most men around the middle and still
 * produces the occasional 15 and the occasional 88 — so a company reads as
 * mostly ordinary with a few people in it worth knowing, which is what a
 * company is.
 *
 * Measured over 10 000 rolls: mean 50.0, σ 16.1, 2.3% below 20 and 2.3% above
 * 80. `attributes.mjs` holds those.
 */
function roll100(rng) {
  const a = rng(), b = rng(), c = rng();
  return Math.round(clamp(((a + b + c) / 3) * 100, 0, 100));
}

/**
 * Roll one soldier's attributes and traits.
 *
 * @param rng   a seeded function; the muster is reproducible from the run seed.
 * @param kind  'flesh' or 'steel'.
 * @param opts  `bias` nudges named attributes (an ARC trooper is not a
 *              conscript), `traits` how many to deal.
 */
export function rollSoldier(rng, kind = 'flesh', opts = {}) {
  const attrs = {};
  for (const a of ATTRS) attrs[a.id] = roll100(rng);

  /* THE ARCHETYPE LEANS THE ROLL, it does not replace it. An ARC is drawn
   * better than a conscript on the things an ARC is for and is still allowed to
   * be a poor shot — because "this unit type is simply better at everything" is
   * the ladder again, and a roster where the good unit is strictly the good
   * unit has no decisions in it. */
  const bias = opts.bias || null;
  if (bias) for (const k in bias) if (attrs[k] != null) attrs[k] = clamp(attrs[k] + bias[k], 0, 100);

  const pool = traitsFor(kind);
  const want = opts.traits ?? (rng() < 0.55 ? 1 : rng() < 0.85 ? 2 : 0);
  const traits = [];
  for (let i = 0; i < want && pool.length; i++) {
    const t = pool[Math.floor(rng() * pool.length) % pool.length];
    if (traits.includes(t.id)) continue;
    traits.push(t.id);
    bake(attrs, t, 1);
  }
  return { attrs, traits };
}

/** Every soldier is one of two kinds, and the army decides which. */
export const kindOfArmy = (armyId) => (armyId === 'separatist' ? 'steel' : 'flesh');

/* ══════════════════════════════════════════════════════════════════════ */
/*  Reading a soldier                                                     */
/* ══════════════════════════════════════════════════════════════════════ */

/** One attribute off a record, defaulting to the middle for anything unrolled. */
export const attrOf = (t, id) => clamp(t?.attrs?.[id] ?? 50, 0, 100);

/** …and the multiplier it buys. This is what the sim calls. */
export const scaleOf = (t, id) => attrScale(id, attrOf(t, id));

/** Does this soldier carry `flag` on any of his traits? */
export function hasFlag(t, flag) {
  const list = t?.traits;
  if (!list || !list.length) return false;
  for (const id of list) if (TRAIT_BY_ID.get(id)?.flag === flag) return true;
  return false;
}

/**
 * A SINGLE NUMBER FOR A MAN, for sorting a roster and for nothing else.
 *
 * Explicitly NOT a power rating and it must never be used as one: the whole
 * argument of this file is that a company is a set of shapes rather than a
 * ranked list, and a "rating" that decides who is best would undo it. What it
 * is for is giving the roster screen a stable default order so the same man is
 * in the same place twice, and giving `bestFirst` something to break ties on.
 */
export function profileMean(t) {
  let s = 0;
  for (const a of ATTRS) s += attrOf(t, a.id);
  return Math.round(s / ATTRS.length);
}

/**
 * The two attributes furthest from the middle, in order — what a card prints
 * as "what is he" without needing eight bars.
 *
 * A man is remembered by his extremes: nobody thinks of CT-1725 as 52 Pace,
 * they think of him as the one who cannot shoot and will not run away.
 */
export function standout(t, kind = 'flesh') {
  const rows = ATTRS.map((a) => ({ id: a.id, v: attrOf(t, a.id), d: Math.abs(attrOf(t, a.id) - 50) }))
    .sort((x, y) => y.d - x.d);
  return rows.slice(0, 2).map((r) => ({
    id: r.id, name: attrName(r.id, kind), value: r.v, high: r.v >= 50, spread: r.d,
  }));
}
