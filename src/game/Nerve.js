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
 * to a body that has never met one. Two tables because they are two subjects.
 *
 * ── AND THE VERB CHANGED SHAPE ONCE IT WAS MEASURED ─────────────────────
 *
 * The first cut of this table had four terms and three of them were the same
 * shape: how many bodies are near a point — the blade, the corpse. Driven
 * through real battles that read 0.00% of hostile body-seconds broken, because
 * the horde puts 0.4 bodies inside a blade's reach, 1.1 witnesses beside a
 * death, and ONE of its own side inside `SEE` of any given body. The horde is
 * not a formation. `ANSWERED` is the term that replaced the shape: the bolt is
 * the only thing that reliably connects a Jedi to a body that is standing
 * thirty metres away, and it is the player's to answer or not.
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
   * …AND HIS OWN SHOT CAME BACK OUT OF THE AIR. FLAGSHIP §7's BREAK verb, and
   * it is the term that carries it, because the two below could not.
   *
   * ── WHY THE PROXIMITY TERMS CANNOT REACH, MEASURED ──────────────────────
   *
   * `BLADE` and `COMRADE_FELL` are the same shape: how many bodies are near a
   * point — the blade, or the corpse. Two Geonosis Command battles, 120 game-
   * seconds each, the flagship script holding station in its own line with the
   * blade lit (`tools/_nervewhy.mjs`), 185 hostile bodies between them:
   *
   *     bodies inside BLADE_REACH of the Jedi, at any instant   0.4
   *     of a 32-second life, seconds spent inside it            0.44   (1.4%)
   *     bodies that EVER enter it                               25%
   *     longest single visit by any body in either battle       3.7 s   (4.8 s)
   *     …against the 11.5 s `BLADE` needs to break one
   *     witnesses inside `SEE` of a body going down             1.1
   *     own side seen to fall, per body, over its whole life    0.68
   *
   * So the death channel's whole budget is 0.68 x 0.055 = 0.037 against the
   * 0.76 a break costs — twenty times short WITH THE RALLY TURNED OFF — and
   * the blade channel's is 0.05. Neither is a tuning problem. Widening the
   * radius does not fix it either: at 30 m, which is the whole engagement, the
   * mean body still only accumulates 4.5 seconds of dwell.
   *
   * AND THE UPPER BOUND SAYS THE SAME THING. Put the Jedi bodily on the
   * centroid of the living horde every frame, blade lit, kept alive — nobody
   * could play it, and it is the design sentence with the walking removed —
   * and the share of hostile body-seconds broken is 2.82% and 0.12%. On the
   * second seed the horde stands in a RING at 11-14 m and `BLADE_REACH` sees
   * 0.06 seconds per body in two minutes.
   *
   * ── AND THE REASON IS IN ANOTHER TABLE ──────────────────────────────────
   *
   * `BLADE_REACH` is 6.5 m and it was derived off `MORALE.NEAR` — the radius
   * for "this Jedi is with these men". It was never compared against the
   * number that decides where the OTHER army stands: `ARCHETYPES[*].preferred`,
   * whose inner edge is 7 m for a B1, 6 for a B2, 8 for a commando, 9 for a
   * rocket droid, 12 for a super commando and 22 for a sniper — and `_move`
   * walks a body OUTWARD when it is nearer than that. A ranged body inside
   * 6.5 m of its target is a body its own steering is evacuating. The term is
   * defined on a ring the horde is built to stay out of.
   *
   * ── SO THE VERB CHANGES SHAPE, AND THIS IS THE SHAPE ────────────────────
   *
   * The horde does not stand near you. It SHOOTS at you, from 7 to 42 m, which
   * is exactly where every one of those bands puts it. A bolt answered is
   * therefore the one event that is abundant, is caused by the player, is
   * aimed, and happens where the horde actually is:
   *
   *   IT COSTS THE PLAYER. Every answer is billed on `Combat.GUARD_COST`'s
   *     ladder — 1.2 stamina for a block, 0.4 for a deflect, 0.5 Force for one
   *     the auto-guard cone took off a blade you did not drive — which is the
   *     bar FLAGSHIP §8 says the Vanguard rests on. And the bolt has to be
   *     coming at YOU: to break a formation you have to make it shoot at you,
   *     and `NEXT.md` measures what a Jedi drawing the horde's attention costs
   *     his own line.
   *   IT IS NOT AN AURA. It is not a radius at all. Two bodies shoulder to
   *     shoulder, one firing at the Jedi and one at the line, get completely
   *     different numbers, and a body that stops shooting stops paying — which
   *     is the same body the verb has just persuaded to stop shooting.
   *   IT DOES NOT STOP PAYING WHEN THE PLAYER MOVES, which is what killed the
   *     four local goods before it. It follows the bolts.
   *
   * WHERE THE NUMBER COMES FROM: `ANSWERED_TO_BREAK` below, and the constant
   * is derived off it so a tuning pass cannot move one and leave the other.
   */
  ANSWERED: 0,                                  // …assigned below, off ANSWERED_TO_BREAK
  /**
   * HOW MANY OF A BODY'S OWN BOLTS HAVE TO COME BACK BEFORE IT BREAKS.
   *
   * SIX, and it is two full bursts of the commonest gun on the field — a B1
   * fires `burst: 3` every `fireRate: 1.5` s — so it is about three seconds of
   * an exchange in which nothing the body does works. Not one burst, which
   * would break a rank in a second and a half and make the blade unnecessary;
   * not a magazine, which no body in this game lives long enough to empty.
   *
   * The ordering it has to keep, and the check holds it: an answered bolt is
   * worth MORE than the man beside you falling — it is happening to you, not
   * near you — and LESS than a bolt sent home that kills, which is TURN and is
   * the rarest thing a player can do.
   */
  ANSWERED_TO_BREAK: 6,
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

/**
 * SIX ANSWERED BOLTS BREAKS A MAN — derived, so it cannot be typed into a lie
 * by a tuning pass that moves one of the two and forgets the other.
 *
 * `1 - MORALE.BREAK` is what a break costs from full nerve; six is the count
 * above. Negative because everything in this table is something taken.
 */
NERVE.ANSWERED = -(1 - MORALE.BREAK) / NERVE.ANSWERED_TO_BREAK;

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
 * A BOLT THIS BODY FIRED CAME BACK OUT OF THE AIR. FLAGSHIP §7's BREAK verb.
 *
 * ON THE MAN WHOSE SHOT IT WAS AND ON NOBODY ELSE, which is the whole reason
 * this term reaches where `BLADE` and `COMRADE_FELL` cannot: it is not a
 * radius, so it does not care where the player is standing, only what the
 * player answered. Two bodies shoulder to shoulder, one shooting at the Jedi
 * and one at the line, are billed completely differently.
 *
 * ONE DOOR: `World._onBoltDeflect`, which is where every bolt any blade in the
 * game turns aside arrives, player or enemy duellist, blade or guard zone or
 * screen. A second call site would be a second answer to how frightened a man
 * is, which is the twin `shakeNerve`'s own note is about.
 *
 * A BOLT PULLED OUT OF THE AIR BY STASIS IS NOT BILLED, and that is a decision
 * rather than an omission: `Player._launchStasisItem` is the Consul's verb and
 * it is priced in Force, not on the guard ladder. BREAK is what the blade does.
 *
 * @returns true if this call wrote the firer's own ledger.
 */
export function boltAnswered(firer) { return shakeNerve(firer, NERVE.ANSWERED); }

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
  /**
   * ── IS ANYBODY RUNNING YET? ─────────────────────────────────────────────
   *
   * The rout pass below is the only O(n²) thing in this file, and this is what
   * keeps it off the frame of every wave in the shipped game: until the player
   * has broken somebody there is nothing to catch, so the census is not taken
   * at all. It is the same property the whole table has — inert until a blade
   * arrives — expressed as a cost rather than as a number.
   */
  let anyBroken = false;
  for (const e of bodies) if (e && !e.dead && !e.trooper && nerveBroken(e)) { anyBroken = true; break; }
  const see2 = NERVE.SEE * NERVE.SEE;
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
    /**
     * ── …UNLESS THE RANK AROUND HIM IS COMING APART ────────────────────────
     *
     * THE CARRIER WHOSE RADIUS IS THE FORMATION, and it is the half of this
     * verb that lets one man the player broke reach men the player never got
     * near. Everything else in this table is billed at a point the player
     * chose — the blade's reach, the corpse, the bolt he answered — and the
     * measurements over that table (see `ANSWERED`) all say the same thing: a
     * mechanism whose payout is proportional to how much of the horde is near
     * the Jedi pays out to about half a body. The rank is not near the Jedi.
     * The rank is near ITSELF.
     *
     * `MORALE.ROUT` AND NOT A THRESHOLD OF ITS OWN. It is the same sentence
     * the roster already makes — "what share of a squad has to break before
     * the rest go with them", a half, chosen so a player can see it coming —
     * asked of the men a horde body can actually see, because a horde has no
     * squads to ask it of. Strictly greater, exactly as `ROUT` is, so one
     * broken man beside one steady one is not a rout.
     *
     * AND THE RATE IS THE RALLY'S OWN, WITH THE SIGN TURNED OVER. No new
     * constant, and the sentence is the exact inverse of the one the rally
     * already makes: out of contact a man's nerve comes back at
     * `RALLY_PER_S`; in a rank that is running it goes the other way at the
     * same rate. From full nerve that is 15.2 s — slower than a lit blade in
     * his face, which is right, because this is what he can see happening to
     * other people.
     *
     * IT CANNOT RUN AWAY FROM ONE BREAK. A body needs MORE THAN HALF of the
     * men it can see to be running already, so the player has to buy the
     * first half at the ordinary price and the rank carries it from there —
     * and the moment the player stops, the broken men rally out of contact,
     * the share falls back under a half and the chain stops. That is a
     * formation coming apart rather than an army evaporating, which is the
     * distinction the whole of this table is written around.
     */
    if (anyBroken) {
      let seen = 0, running = 0;
      for (const o of bodies) {
        /* BODIES WITH A RECORD ARE NOT IN THIS CENSUS, on either end of it.
         * `CommandDirector._morale` runs `MORALE.ROUT` over its own SQUADS —
         * the same sentence, asked of the unit a roster actually has — and two
         * loops answering one rule for one body is the twin this repository
         * keeps deleting. A horde has no squads, so this asks it of the men a
         * body can see; a roster has them, so it asks it of the squad. */
        if (!o || o === e || o.dead || o.trooper || o.team !== e.team) continue;
        const dx = o.position.x - e.position.x, dz = o.position.z - e.position.z;
        if (dx * dx + dz * dz > see2) continue;
        seen++;
        if (nerveBroken(o)) running++;
      }
      if (running > MORALE.ROUT * seen && seen > 0) d = -NERVE.RALLY_PER_S;
    }
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
