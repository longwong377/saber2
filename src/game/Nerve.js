/**
 * BATTLEFRONT BORZ — THE HORDE'S NERVE. FLAGSHIP §7's first verb.
 *
 *   "BREAK — morale is fully built and barely used. Walk into the front of a
 *    formation and it comes apart. `unleash`, `dread`, then stand there so
 *    `JEDI_NEAR` holds your nerve while theirs goes."
 *
 * Morale WAS fully built and it was the ROSTER's. `Morale.js` is the table,
 * `CommandDirector._morale` is the arithmetic, and every term in it hangs off a
 * `Trooper` record — a name, a rank, a squad. The horde has none of those. A
 * body composed by `WaveDirector` carries no record at all, so `Enemy.
 * aimQuality`'s own comment had to say "bodies with no morale (the horde) read
 * 1", and the whole of §7's first verb landed on nothing in every mode except a
 * meeting between two human commanders.
 *
 * So: a ledger that every body has.
 *
 * ── ONE LEDGER, TWO PLACES TO KEEP IT ───────────────────────────────────
 *
 * `shakeNerve` and `nerveOf` route. A body with a record writes the record —
 * because a squad broken in the spires must still be broken when it is rebuilt
 * on the next ground, which is exactly why `_morale` keeps the number off the
 * body — and a body without one writes `Enemy.nerve`. Both are read against
 * the SAME thresholds, `MORALE.BREAK` and `MORALE.REFUSE`, because a soldier
 * losing his nerve is one event and two numbers for it is the twin this
 * repository keeps deleting (HANDOFF §2.3).
 *
 * What is NOT shared is the table. `MORALE` is a list of things that happen
 * inside an army — a mate goes down, a wave is cleared, an area is held, your
 * commander is beside you — and every entry is an event the player CAUSES for
 * their own side. `NERVE` below is the other half: what one hostile Jedi does
 * to a body that has never met one. Two tables because they are two subjects,
 * and the four terms here are the four things §7 says the verb is made of.
 *
 * ── WHY IT IS A LEAF MODULE ─────────────────────────────────────────────
 *
 * The same argument `Morale.js`'s own header makes. `Enemy` reads it every
 * frame and `World` writes it on every death; Command.js imports Enemy.js, so
 * anything Enemy imports must not import Command. This file imports `MORALE`
 * (a leaf) and `clamp` and nothing else.
 */

import { clamp } from '../engine/MathUtil.js';
import { MORALE } from './Morale.js';

/**
 * WHAT TAKES A BODY'S NERVE, and every entry is something the player DID.
 *
 * That is the same test `MORALE`'s header sets and it is stricter here, because
 * the horde has no commander, no squad and no ground of its own: if a term in
 * this table can move without the player having done anything, the whole verb
 * degenerates into an enemy that sometimes runs away.
 */
export const NERVE = {
  /**
   * HOW FAR A BODY BREAKS FOR SOMETHING IT CAN SEE HAPPEN, in metres.
   *
   * A rank comes apart from the FRONT, which is the picture §7 is describing —
   * "walk into the front of a formation and it comes apart" — and a radius is
   * what makes that true without anything having to know what a formation is.
   * The man beside the one you cut sees it; the man forty metres back does not
   * and goes on shooting until you reach him.
   *
   * 11 m rather than a sight line: it is one distance test per death against
   * the bodies already in `world.enemies`, and a line-of-sight raycast per pair
   * would be forty casts on the frame a grenade lands. It is also the honest
   * shape — a body hears the one beside it come apart whether or not it was
   * looking.
   */
  SEE: 11,
  /**
   * A BODY NEXT TO THIS ONE GOES DOWN.
   *
   * `MORALE.COMRADE_FELL` is -0.16 and this is deliberately smaller. A trooper
   * with a record loses a NAME he has fought beside for three areas; a droid in
   * a rank loses the droid next to it.
   *
   * WHAT IT COMES TO, and it is arithmetic off this table rather than a claim:
   * fourteen bodies inside the radius break the man beside them on deaths
   * alone, which is most of a wave and is deliberately more than a player would
   * ever get. The rate §7 asks for is the SUM — a Jedi standing in the rank is
   * already paying `BLADE` at -0.065/s net, so five seconds of presence and
   * eight bodies down is 0.235 and the rank is going. Neither term breaks a
   * formation on its own and together they break one in about the time it takes
   * to cut through its front, which is the sentence the verb is made of.
   */
  COMRADE_FELL: -0.055,
  /**
   * …AND HIS OWN BOLT DID IT. FLAGSHIP §7's SECOND VERB, and it needs the
   * ledger above before it can exist at all:
   *
   *   "TURN — a returned bolt that kills its firer counts on THEIR morale
   *    ledger. Every bolt sent home deletes a rifle and breaks a nerve."
   *
   * On top of `COMRADE_FELL` and not instead of it, because two things happened
   * — a body went down, and it went down to its own fire. Three times the
   * ordinary knock: a rank that is killing itself is the single most
   * demoralising thing that can happen to it, and it is the only term in this
   * table a player earns by SKILL rather than by proximity. Only 5% of
   * deflections are RETURNs and 9% PERFECTs by blade speed alone, so this is
   * the rarest event here and it should be worth the most.
   */
  TURNED: -0.165,
  /**
   * A LIT HOSTILE BLADE, INSIDE `BLADE_REACH`, PER SECOND.
   *
   * §7's "walk into the front of a formation" as a rate. It is the term that
   * makes standing there worth something, which is the whole shape of the verb:
   * `MORALE.JEDI_NEAR` pays your own line +0.085/s for the same act, so a Jedi
   * standing in a line is holding one nerve up and pushing the other down at
   * once, out of one position, and the player can see both bars move.
   *
   * -0.115/s against a rally of `MORALE.RALLY_PER_S` (0.05) is a net -0.065/s,
   * so a full-nerve body eleven seconds from breaking on presence alone. Slower
   * than the roster's own +0.085 on purpose: nobody breaks from a Jedi WALKING
   * at them, and a body that did would make the blade unnecessary.
   */
  BLADE: -0.115,
  /**
   * …and how near. Shorter than `MORALE.NEAR`'s 14 m, and it has to be: that
   * radius is "he is with us", and this one is "he is HERE". A formation
   * fourteen metres deep would break from end to end at once, which is not a
   * front coming apart, it is an army evaporating.
   */
  BLADE_REACH: 6.5,
  /**
   * WHAT COMES BACK, per second, when none of the above is happening.
   *
   * `MORALE.RALLY_PER_S` exactly, and it is imported rather than typed so the
   * two ledgers recover at one rate. A horde that never got its nerve back
   * would mean the first cut of a wave decided the rest of it.
   */
  RALLY_PER_S: MORALE.RALLY_PER_S,
  /**
   * WHERE A BODY WITH NO RECORD STARTS.
   *
   * 1, and not the roster's 0.72. A `Trooper` is a person who has been in this
   * war for a while and is somewhere in the middle of his own range; a droid
   * off a rack has no history at all and nothing has happened to it yet. It
   * also means the ledger is INERT until the player does something — at 1
   * every consequence below is the identity, so nothing in the shipped game
   * moves until a blade arrives.
   */
  START: 1,
};

/** The nerve this body has, wherever it is kept. 1 for anything not in a fight. */
export function nerveOf(e) {
  if (!e) return 1;
  const t = e.trooper;
  if (t && typeof t.morale === 'number') return t.morale;
  return typeof e.nerve === 'number' ? e.nerve : NERVE.START;
}

/** Whether this body has stopped holding its place. One threshold, both ledgers. */
export function nerveBroken(e) { return nerveOf(e) < MORALE.BREAK; }

/** …and whether it has stopped answering at all. */
export function nerveRefusing(e) { return nerveOf(e) < MORALE.REFUSE; }

/**
 * MOVE ONE BODY'S NERVE.
 *
 * A body with a record is left alone: `CommandDirector.shake` owns that number
 * and does three more things with it (the log, the "IS BREAKING" call, the
 * `broken` flag the steering reads), and a second writer would be a second
 * answer. Callers that can reach a director say so by asking it first — see
 * `_castDread`, which does exactly that and falls through to here.
 *
 * @returns true if this call wrote the body's own ledger.
 */
export function shakeNerve(e, amount) {
  if (!e || e.dead || typeof amount !== 'number') return false;
  if (e.trooper) return false;
  e.nerve = clamp((typeof e.nerve === 'number' ? e.nerve : NERVE.START) + amount, 0, 1);
  return true;
}

/**
 * EVERY BODY OF THE FALLEN MAN'S OWN SIDE WITHIN `SEE` OF HIM, SHAKEN.
 *
 * WHOSE loss it was is read off the corpse rather than passed in, so no caller
 * can get it wrong: only his own side loses anything, because the rank opposite
 * has just watched something good happen.
 *
 * @param bodies  the world's enemy list
 * @param fallen  the body that just went down
 * @param amount  which term of NERVE this is
 * @returns how many nerves it moved
 */
function spread(bodies, fallen, amount) {
  if (!bodies || !fallen || !fallen.position) return 0;
  const r2 = NERVE.SEE * NERVE.SEE;
  let n = 0;
  for (const e of bodies) {
    if (!e || e === fallen || e.dead) continue;
    if (e.team !== fallen.team) continue;
    const dx = e.position.x - fallen.position.x;
    const dz = e.position.z - fallen.position.z;
    if (dx * dx + dz * dz > r2) continue;
    if (shakeNerve(e, amount)) n++;
  }
  return n;
}

/** A body went down and the men around it saw. FLAGSHIP §7's BREAK verb. */
export function witnessDeath(bodies, fallen) { return spread(bodies, fallen, NERVE.COMRADE_FELL); }

/**
 * …AND IT WENT DOWN TO A BOLT SENT HOME. FLAGSHIP §7's TURN verb.
 *
 * ON TOP OF `witnessDeath` AND NOT INSTEAD OF IT, and the two are separate
 * calls rather than a flag on one because they are two facts arriving at two
 * different moments: the death travels through `World.onEnemyKilled`, which is
 * reached from inside `Enemy.damage` and knows nothing about what fired, and
 * the bolt is only in hand at `World._boltHitTest`. A flag stashed on the body
 * to carry one fact to the other would survive a hit that did NOT kill and
 * then be read by whatever killed it later, which is a defect this repository
 * has already found twice wearing other names.
 */
export function turnedHome(bodies, fallen) { return spread(bodies, fallen, NERVE.TURNED); }

/**
 * WHAT A SHAKEN GUN IS WORTH, as a multiplier on its own spread.
 *
 * The curve is `Enemy.aimQuality`'s morale term with one difference that
 * matters: it is ANCHORED AT 1 rather than at `MORALE.PRESENCE_CAP`. A record's
 * curve is anchored where a line beside its own commander actually rests, so
 * 0.84 maps to 0.90; a horde body starts at 1 and has no presence term, so
 * anchoring it the same way would make every droid in every wave in the game
 * 10% more accurate the moment this file shipped — a balance change arriving
 * as a side effect of a feature, which is exactly what unpinning morale nearly
 * did to the clone army (see the note over that term).
 *
 * So: full nerve is the identity, and everything below it is worse. The bottom
 * of the range is `MORALE`'s own 1.65, so a broken droid and a broken trooper
 * shoot equally badly.
 */
export function nerveAim(e) {
  const t = e && e.trooper;
  if (t && typeof t.morale === 'number') return 1;      // the record's own term already ran
  const n = clamp(nerveOf(e), 0, 1);
  return 1 + (1.65 - 1) * (1 - n);
}

/**
 * THE PER-SECOND HALF: a lit hostile blade standing in the rank.
 *
 * Called once a frame for the whole field rather than per body, because the
 * expensive half is the list of blades and there are at most four of them.
 * Bodies with a record are skipped: `CommandDirector._morale` runs its own
 * per-second pass over exactly those, and two drifts on one number is two
 * answers to how frightened a man is.
 *
 * @param bodies   the world's enemy list
 * @param blades   [{ position, team }] — every lit blade on the field
 */
export function nerveTick(bodies, blades, dt) {
  if (!bodies || !(dt > 0)) return 0;
  const r2 = NERVE.BLADE_REACH * NERVE.BLADE_REACH;
  let shaken = 0;
  for (const e of bodies) {
    if (!e || e.dead || e.trooper) continue;
    if (typeof e.nerve !== 'number') e.nerve = NERVE.START;
    /* THE RALLY IS ALWAYS PAID AND THE BLADE IS ADDED TO IT, which is the same
     * shape `CommandDirector._morale` uses (it adds `RALLY_PER_S` and then the
     * presence and wound terms on top). The first version REPLACED the rally
     * while a blade was near, and the difference is not cosmetic: it took the
     * time to break a full-nerve body from the 11.7 s this file's own note
     * claims to 6.6 s, so the comment and the code disagreed about the one
     * number the verb is tuned on. Measured by `tools/checks/break.mjs`, which
     * derives the expected time from the table rather than restating it. */
    let d = NERVE.RALLY_PER_S;
    for (const b of blades) {
      if (!b || b.team === e.team) continue;
      const dx = e.position.x - b.position.x, dz = e.position.z - b.position.z;
      if (dx * dx + dz * dz > r2) continue;
      d += NERVE.BLADE;
      shaken++;
      break;
    }
    e.nerve = clamp(e.nerve + d * dt, 0, 1);
  }
  return shaken;
}
