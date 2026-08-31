/**
 * BATTLEFIELD BORZ — WHAT MOVES A SQUAD'S NERVE, per event or per second.
 *
 *   "Troops perform better when you're winning or aligned with their side.
 *    Heavy losses, Dark-side excess, or abandoning them tanks morale — they
 *    can break, refuse orders, or even turn on you."
 *
 * Every entry is an event the player can SEE happening and can choose to cause
 * or prevent, which is the whole test a morale term has to pass: a number that
 * moves for reasons the player cannot observe is a random number generator
 * wearing a name.
 *
 * The two `_NEAR` terms are what make a commander's PRESENCE worth something
 * mechanically, and they are deliberately the largest per-second terms in the
 * table: standing with your line is the cheapest thing a Jedi can do for it,
 * and it should be worth doing.
 *
 * ── WHY IT IS A LEAF MODULE AND NOT PART OF Command.js ──────────────────
 *
 * It lived there until `MORALE.PRESENCE_CAP` acquired a second reader.
 * `Enemy.aimQuality` anchors its own curve on the point a line actually rests
 * at rather than on the top of the clamp — see the note there — and Command.js
 * imports Enemy.js at its top, so Enemy → Command is a cycle and a constant
 * read through one is `undefined` on whichever side happens to evaluate first.
 *
 * The same argument, the same shape and the same last clause as `POWER_COST`
 * living in Powers.js rather than in Player.js: one table, one owner, and the
 * owner is a leaf. Command.js re-exports it, so nothing that imported
 * `{ MORALE } from './Command.js'` had to change.
 *
 * WHO READS IT: `CommandDirector._morale` owns the arithmetic;
 * `Enemy.aimQuality` and `Enemy._pace` read a record's number; `Waves`,
 * `Reactions` and the HUD read the consequences (`broken`, `REFUSE`).
 */

export const MORALE = {
  /** A squadmate goes down in front of them. */
  COMRADE_FELL: -0.16,
  /** …and their squad leader is worth more than a squadmate. */
  LEADER_FELL: -0.26,
  /** Somebody in the squad kills something. */
  SQUAD_KILL: 0.045,
  /** The wave is cleared. Everyone gets it. */
  WAVE_CLEAR: 0.34,
  /** An area is held. */
  AREA_HELD: 0.5,
  /** Their own health, per second, below `HURT_AT`. */
  WOUNDED: -0.10,
  /**
   * THEY WALKED PAST ONE OF THEIR OWN GRAVES — PLAN.md §4.8's third bullet,
   * whose second half is "with the surviving squad's morale reacting when they
   * walk past it".
   *
   * `src/world/Graves.js` puts a rifle in the ground where each named man fell
   * and keeps it there for the run, so a line that fights back over ground it
   * took an hour ago walks through its own casualty list. This is what that
   * costs the men who are still standing.
   *
   * SMALL, and deliberately a fifth of `COMRADE_FELL`: the death itself is the
   * event and this is the memory of it. Rate-limited per man (see
   * `GRAVE_COOLDOWN`) so a squad ordered to hold a position among six markers
   * is shaken by the ground once rather than six times a second, which would
   * turn a hard-won piece of ground into a rout on its own.
   *
   * MEASURED, two arms of the same ten-man line stepped for twenty-five
   * seconds — one standing on ground where one of their own went down and one
   * on clean ground: 0.729 against 0.740. About a point of nerve, held down
   * for as long as they are standing there, against a recovery that is always
   * pulling the other way. That is the size this is meant to be: a line that
   * fights over its own dead is worse for it and is not doomed by it.
   */
  PASSED_GRAVE: -0.03,
  /** Per second within `NEAR` of a living commander who is on their side. */
  LEADER_NEAR: 0.055,
  /**
   * ── THE VOICE — per second within `NEAR` of a man licensed to RELAY ─────
   *
   * `LEADER_NEAR` is the squad's own leader steadying the squad's own men, and
   * it stops at the squad boundary because that is what a squad leader is for.
   * The top rung of `RANKS` carries a licence that does not: "carries an order
   * onward to men you cannot reach". So a Commander on the roll steadies
   * ANYBODY in the army who is standing near him, in his squad or not — the
   * one presence term in this table that crosses a squad line.
   *
   * SMALLER THAN A SQUAD LEADER'S, deliberately. He is not their sergeant and
   * they are not his men; what he is, is a familiar voice on ground where
   * neither you nor their own leader happens to be. And it stacks with neither
   * for free — the whole presence sum tapers into `PRESENCE_CAP` exactly as it
   * did, so a man beside all three is steady rather than elated.
   *
   * WHAT MAKES IT WORTH HAVING is what happens when he dies: every squad he
   * was standing among loses it on the same frame, and `onDeath` says so. That
   * is the vacancy this ladder was rebuilt to produce — a specific man whose
   * death takes a capability off the field rather than a health bar.
   */
  RELAY_NEAR: 0.035,
  /** …and of the Jedi themselves, which is worth more. */
  JEDI_NEAR: 0.085,
  /**
   * …AND WHERE PRESENCE ALONE STOPS LIFTING THEM.
   *
   * THE DEFECT THIS EXISTS TO FIX, measured across 15 driven Command worlds
   * (5 seeds × 3 arms × 3 engagements, `tools/_flagship.mjs` Step 2): morale
   * read **1.000 in both player arms**, every record, every frame. Nothing in
   * the table pushes down while a Jedi is inside 14 m, so `+0.085/s` against a
   * `clamp(…, 0, 1)` pins every man in the line at the ceiling in twelve
   * seconds and holds him there for the rest of the battle.
   *
   * A saturated channel carries no information. `_pace` reads morale, so does
   * `aimQuality`, so does `broken` — and all three were reading the same 1.000
   * off every man near the player whatever else was happening to him. Worse
   * for the design: FLAGSHIP §7's whole presence argument is that a line
   * fights differently with a Jedi in it, and the number that was supposed to
   * carry that had no room left to move. `NEXT.md` names unsaturating this as
   * the first thing to try before believing the Dead Jedi table at all.
   *
   * SO PRESENCE STEADIES A MAN; IT DOES NOT ELATE HIM. The two `_NEAR` terms
   * taper out over the last band below this ceiling, and what carries a body
   * ABOVE it is the one-shot events — a squad kill, a wave cleared, an area
   * held. Which is the right sentence anyway: standing next to a Jedi keeps
   * you in the fight, and winning is what lifts you.
   *
   * WHERE THE NUMBER COMES FROM, and it is derived rather than chosen: the
   * ceiling is one comrade falling below the top of the scale, so the ordinary
   * worst thing that happens to a man — the mate beside him going down — lands
   * on the steadiest soldier in the line IN FULL rather than being partly
   * eaten by the clamp. At 0.85 it was clipped by 0.012, which is small and is
   * still the same defect in miniature. See the assignment below the table.
   *
   * Below the ceiling nothing changed at all, which is why the rally out of
   * `BREAK` is the same second it always was — see the taper in `_morale` and
   * the check that holds it in tools/checks/nerve.mjs.
   */
  PRESENCE_CAP: 0,                              // …assigned below, off COMRADE_FELL
  /** How far below the cap the presence terms start easing off. */
  PRESENCE_BAND: 0.12,
  /**
   * …AND ELATION WEARS OFF. Per second, above the cap only.
   *
   * CAPPING PRESENCE WAS NECESSARY AND NOT SUFFICIENT, and the measurement
   * that says so is worth writing down: with the taper in and nothing else
   * changed, the Dead Jedi probe still read morale 0.98 / 0.96 / 0.92 across
   * its three arms — INCLUDING the arm with no player in it at all. So the
   * ceiling was never really about the Jedi. Morale is a one-way ratchet in a
   * battle you are winning: `WAVE_CLEAR` is +0.34 and `AREA_HELD` +0.5, three
   * waves is +1.02 on its own, and nothing in the table ever takes any of it
   * back while the line is not being hurt.
   *
   * ABOVE THE CAP ONLY, and that is the whole of why this is safe. Everything
   * below 0.85 behaves exactly as it always did — the rally out of `BREAK` is
   * the same second, `WOUNDED` bites the same, a shaken man recovers at the
   * same rate — so no measurement anybody has taken of the bottom of this
   * range moved. What changes is that the TOP is no longer a place a record
   * can park: a wave cleared still lifts a man to 1.0 and he settles back over
   * three seconds to the level his circumstances support.
   *
   * That is what gives §7's presence loop a channel to pay through. A steady
   * state of 0.85 beside your Jedi against a drift downward alone is a
   * difference the arithmetic can carry; 1.000 against 1.000 is not.
   */
  SETTLE: 0.05,
  /** Per second with no friendly commander and no Jedi inside `NEAR`. */
  ALONE: -0.022,
  /** The Jedi used a Force power ON one of their own. Per use. */
  BETRAYED: -0.20,
  /** …and empowering one instead. Per use. */
  INSPIRED: 0.16,
  /** A commander reached into their nerve through the Force. Per use, and it
   *  is the one entry in this table an ENEMY commander causes. See `castForce`. */
  SHAKEN: -0.22,
  /** How close counts as near, in metres. */
  NEAR: 14,
  /**
   * …AND HOW MUCH OF THAT A MAN AT THE EDGE OF IT GETS.
   *
   * PRESENCE WAS A STEP AND IS A GRADIENT. `NEAR` is a radius, so before this
   * the man at your shoulder and the man 13.9 m away drew the identical
   * `JEDI_NEAR`, and the man at 14.1 m drew `ALONE` instead — a cliff a player
   * cannot see, in the one term the whole presence argument is built on.
   *
   * It also made the two arms of the Dead Jedi test indistinguishable the
   * moment the ceiling came off: both rest at the cap, because both have a
   * Jedi somewhere inside a 14 m circle. A step function has one value; a
   * channel needs a range.
   *
   * `EDGE` is the share the term keeps at the rim, and the falloff between is
   * linear in distance rather than in its square — a soldier judges "how far
   * away is he" in metres, not in area, and a square-law term spends almost all
   * of its range in the last three metres.
   *
   * 0.35 rather than 0: a man at the edge of the circle can still SEE their
   * Jedi, and seeing them is most of it. Dropping to nothing at the rim would
   * put a discontinuity back at exactly the place this exists to remove.
   */
  EDGE: 0.35,
  /** Below this a body breaks: it stops holding formation and falls back. */
  BREAK: 0.24,
  /** Below this it will not take an order at all. */
  REFUSE: 0.10,
  /**
   * HOW OFTEN ONE MAN CAN BE MOVED BY THE GROUND, in seconds. See
   * `PASSED_GRAVE`.
   *
   * Twenty, which is about a third of the time it takes a shaken man to climb
   * back to steady, so walking a line across a battlefield full of its own
   * dead is a real drag on it and standing still in one is not a spiral.
   */
  GRAVE_COOLDOWN: 20,
  /** How close a man has to pass one to feel it, in metres. */
  GRAVE_FELT: 5,
  /** How fast a broken body recovers its nerve once it is out of contact. */
  RALLY_PER_S: 0.05,
  /**
   * WHAT SHARE OF A SQUAD HAS TO BREAK BEFORE THE REST GO WITH THEM.
   *
   * "they should fall back when a position is lost." Breaking is a MAN's
   * decision and the file already had it — below `BREAK` he stops holding
   * formation and runs to you. A position is a SQUAD's, and a squad does not
   * lose one man at a time: the two riflemen still steady when three of their
   * five have broken are not holding a position, they are the last two people
   * standing on a piece of ground nobody else is on.
   *
   * A half rather than a third or a whole, and the reason is that it has to
   * be a number the player can see coming. `census` and the roster feed both
   * show the squad, so "half of them are running" is a state you can read off
   * the screen and answer — which is the test every other number in this
   * table had to pass. At a third a squad withdraws while most of it is still
   * fighting; at a whole the rule never fires, because the last steady man in
   * a squad of five is precisely the one standing next to a commander whose
   * presence is holding him up.
   *
   * Strictly greater, so a two-man squad with one broken man is not a rout.
   */
  ROUT: 0.5,
};

/**
 * THE CEILING IS ONE COMRADE BELOW THE TOP — derived, so it cannot be typed
 * into a lie by a tuning pass that moves `COMRADE_FELL` and forgets this.
 *
 * `MORALE.COMRADE_FELL` is negative, so this reads as "a full knock of the
 * ordinary worst thing fits between the resting point and the clamp".
 */
MORALE.PRESENCE_CAP = 1 + MORALE.COMRADE_FELL;

/**
 * ── WHAT "BADLY HURT" MEANS, ONCE, FOR THE WHOLE GAME ───────────────────
 *
 * A third of a body's own health. It was typed as `0.34` inside `_morale` and
 * described as "below a third" in the table above, and it now has a second
 * reader — the wound a man carries out of a run — so it is a name rather than
 * a number in two places. A scar and the nerve it costs to be that close to
 * dead are the same event, and they must not be able to disagree about when it
 * happened.
 */
export const HURT_AT = 0.34;
