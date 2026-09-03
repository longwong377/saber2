/**
 * ══════════════════════════════════════════════════════════════════════════
 *  BATTLEFRONT BORZ — THE COMPANION
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "I want you to build companions, this is a feature seperate from your troops
 *  this is like a pet/close personal companion/protector that you can choose to
 *  go into battle with … they stay close to you at all times but you can give
 *  them a limited set of orders … obviously they're going to be less mobile
 *  than you so protecting the companions and keeping them safe is another thing
 *  the player can choose to worry about … this relationship between player and
 *  companion should be really cool"
 *
 * ── WHAT A COMPANION IS, IN ONE SENTENCE ─────────────────────────────────
 *
 * One body that is yours in every mode without ever being on the roll.
 *
 * Every clause of that is load-bearing. ONE, so there is nothing to average
 * and nothing to replace — the muster sells you another trooper and there is
 * no muster for this. YOURS IN EVERY MODE, because nine of the eleven give you
 * no troops at all: the order wheel is dark, the roster is hidden, and you
 * fight alone. And NOT ON THE ROLL, because the roll is `Company.keep`, the
 * muster and permadeath, and REVIEW-V12's "what I would not touch" says
 * plainly that a feature must be built around that door rather than through
 * it.
 *
 * ── WHY IT IS A PACK IN `world.props` AND NOT A TROOPER ───────────────────
 *
 * `CommandDirector.steer` — the follow-the-player machinery — returns on its
 * first line if `!e.trooper`, and everything under it reads `e.trooper.*`: the
 * broken flag, the rout, the medic, the leash, the slot index, the squad key.
 * So a companion could only have the follow code by being a Trooper on a
 * CommandRoster, and that would put it in the muster, in the formation, in the
 * squad plan and on the order-of-battle screen — a pet with a rank and a
 * casualty row.
 *
 * The follow point is fifteen lines. So the companion writes them itself and
 * `commandOf` is never set, and with it go every hazard that only exists for a
 * body that has one: `commanderOf` never returning null, `slotFor`'s zero
 * defaults, the `_troops` stamp loop, the `underFire` latch. All of them at
 * once, by not opting in.
 *
 * `world.props` is the seam two shipped subsystems already use — `Riders.js`
 * and `Flight.js` — and its own note says why: the World's update order is
 * enemies (2), blades (3), bolts (4), physics (5), props (6), so a prop's
 * `update` runs after every body has moved and before anything draws, and it
 * costs no line in World.js at all.
 *
 * ── THE ONE THING THAT COULD NOT BE DONE FROM A PROP TICK ─────────────────
 *
 * Targeting. `Enemy._think` opens with
 *
 *     this.target = this.compelled?.target ?? ctx.pickTarget(this);
 *
 * and everything under it — the wish, the cover hunt, `_shoot` — reads that
 * one field. A target written from a prop tick is overwritten on the next
 * frame, and in the frame it survives it is a body walking toward one thing
 * and shooting at another. `Levy.js`'s `installLevyAim` had this exact problem
 * and solved it by wrapping `_think` on the one body and substituting
 * `ctx.pickTarget` for the length of one synchronous call. This is that
 * pattern, pointed the other way.
 *
 * AND THE OTHER WAY IS THE WHOLE PROBLEM. `World.pickTarget` runs two passes:
 * every player this body may fight, and then — `if (this.command)` — every
 * cross-army body. `this.command` is null in every mode without a
 * CommandDirector, which is nine of the eleven. So a friendly body outside
 * Command literally cannot find an enemy: the levy wanted the first pass and
 * not the second, and a companion wants the second and cannot have it.
 *
 * `World._hostilesFor(who)` is the answer and it is already there, gated on
 * nothing: one pass over the enemies and the players returning everything this
 * body is opposed to. It is what `CommandDirector.targetFor` reaches back
 * through when it has no leash. Asking it for ONE body, once a frame, is a
 * single linear pass and costs what a trooper already costs.
 *
 * ── LESS MOBILE THAN YOU, AND THAT IS THE FEATURE ─────────────────────────
 *
 * The brief says it: "obviously they're going to be less mobile than you so
 * protecting the companions and keeping them safe is another thing the player
 * can choose to worry about". You dash at 15.5 m/s; it walks. Every good
 * decision you make with your own body — break left, cross the open, take the
 * high line — leaves it behind in the fire. It is not a power-up you carry, it
 * is a liability you chose, and the tension between your mobility and its
 * loyalty is the whole relationship.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { ARCHETYPES } from './Enemy.js';
import { COMPANION_KINDS, COMPANION_RANKS, holdsCompanion, kindHasDuty, paceOf, rungOf } from './CompanionKinds.js';
import { award, temperSwing } from './Kennel.js';
/* The friendly-fire scaling every ally in the game already gets — see
 * `fieldCompanion`, which is the one place it is installed. */
import { installTeamDamage, TEAM_DAMAGE_DEFAULT } from './Command.js';
/* The move table and the length of the winded window, both read rather than
 * restated — see `CompanionPack.update`. */
import { BEAST_MOVES, WIND_OPEN } from './Enemy.js';
/* The one gate every damage path in the game answers to — see `installCompanionHide`. */
import { canHarm } from './Player.js';
/* THE MEDIC'S OWN MACHINERY, imported rather than rewritten — see the TEND
 * note. `startHeal` puts the body into the reaction `Enemy.update` already
 * steps for every body in the game, so the walk, the kneel, the give-up rule
 * and the flicker all arrive with the one call. */
import { startHeal } from './Reactions.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  The dial                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * How far behind you it tries to stand, and the band it is happy in.
 *
 * `HEEL` is a point rather than a radius because a companion that merely stays
 * within a circle wanders across your line of fire; one that holds a station
 * off your back quarter is somewhere you can predict.
 *
 * 3.4 m BACK AND 0.9 ACROSS, AND THE FIRST TWO NUMBERS I TRIED KILLED IT.
 * At 2.2 m and 0.35 across, the kill test's player — walking a circle with a
 * lit blade — cut his own companion down inside sixty seconds: measured, six
 * hits and 101 damage at a range of 1.5 m, and the animal ended the minute at
 * -311 of 210 hp. A saber is about 1.4 m on a 1.9 m arm and the sweep reaches
 * past three, so a station at 2.2 m is a station inside the swing. The heel
 * has to stand OUTSIDE the arc of the thing it is standing behind.
 */
export const HEEL = { back: 3.4, side: 0.9, slack: 1.1 };

/**
 * How far from its station it will go — to fight or to wander — before the
 * walk home overrides whatever it wanted.
 *
 * ONE NUMBER FOR TWO QUESTIONS, DELIBERATELY. It is both the radius the target
 * search is measured over and the distance that triggers the recall, and they
 * have to be the same number or the animal grabs something at the edge of its
 * sight and is dragged home before it arrives — a dog that starts every charge
 * and finishes none.
 *
 * 8 m was the first value and it made the companion useless in exactly that
 * way: measured over a minute, a target on 13.2% of frames and 508 frames
 * stood still with something shooting at its owner from inside twenty metres.
 * The station sits 3.4 m off your back, so 14 lets it reach about seventeen
 * metres in front of you — a charge at what is shooting at you — and no
 * further. Same minute at 14: see the kill test's own numbers.
 */
export const LEASH = 14;

/** Inside this of its station it stops walking, so it does not jitter on the spot. */
export const SETTLED = 0.55;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE ORDERS                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * "you can give them a limited set of orders such as attacking/killing a
 *  specific enememy that you target, attacking anything that gets within a
 *  certain range of you, etc."
 *
 * SIX SLOTS, AND ONE OF THEM MEANS TWELVE DIFFERENT THINGS.
 *
 * Every field below is READ by the two wraps and by the wheel, and nothing
 * anywhere switches on an order's id to decide what it does. `arg` is what the
 * order needs pointing at, and it is the field the whole design turns on:
 *
 *   'none'  the order is the whole order (HEEL, AWAY)
 *   'body'  a hostile, read from the RETICLE at wheel-close (SEEK, and the
 *           verbs that name a target)
 *   'point' the GROUND under the reticle (HOLD)
 *
 * READ FROM THE RETICLE AND NEVER FROM THE WHEEL. `RadialWheel` has no
 * argument channel and adding one would be a second targeting system; the
 * thing you are looking at is already the thing you mean, and it is strictly
 * better than a target-cycler for the same reason a reticle beats a tab key.
 *
 * `holds` is the RUNG that licenses the slot. Below it the slot is cold and its
 * caption says why — which is the part a bare keybind can never do, and the
 * reason `CompanionWheel` reads live pack state rather than a static table.
 *
 * HEEL AND AWAY ARE UNREFUSABLE AT EVERY RUNG, and that is a rule and not a
 * gap in the ladder: the two orders that make a companion SAFER must never be
 * ones a fresh companion cannot take. Protection that needs a licence is not
 * protection. `FORMATIONS.circle.always` (Command.js:1913) is the shipped
 * precedent that an order which cannot be refused is legal.
 *
 * `standing` is whether the order survives being given — HEEL is a position
 * you are put in and then released from, AWAY is a refusal held until
 * cancelled. That distinction is the whole difference between the two and it
 * is a field rather than a paragraph in each solver.
 */
export const COMPANION_ORDERS = {
  heel: {
    id: 'heel', label: 'HEEL', arg: 'none', standing: false, holds: 'heel',
    caption: 'Come here and stay where I can see you',
  },
  away: {
    id: 'away', label: 'AWAY', arg: 'none', standing: true, holds: 'away',
    caption: 'Break off. Do not fight. Get behind me',
  },
  ward: {
    id: 'ward', label: 'WARD', arg: 'none', standing: true, holds: 'ward',
    caption: 'Meet anything that comes near ME',
  },
  seek: {
    id: 'seek', label: 'SEEK', arg: 'body', standing: true, holds: 'seek',
    caption: 'Kill the one under my reticle',
  },
  hold: {
    id: 'hold', label: 'HOLD', arg: 'point', standing: true, holds: 'hold',
    caption: 'Stand on that ground and meet what comes to it',
  },
  /* ONE SLOT, TWELVE MEANINGS. The label and the caption are read off the live
   * companion's own row (`COMPANION_KINDS[kind].verb`) rather than from here,
   * which is what stops twelve kinds being twelve reskins: the wheel says
   * something different for every companion you own.
   *
   * AND SO IS `arg`, for the same reason and through `argKind`: four of the
   * twelve want a piece of ground, two a hostile, two a man of your own and
   * four nothing at all, so one value written here would be wrong for eight
   * of them. The 'body' below is the DEFAULT a verb with no work row would
   * take, and `refuseOrder` refuses that case out loud rather than letting it
   * happen — see the note on COMPANION_VERBS. */
  verb: {
    id: 'verb', label: null, arg: 'body', standing: true, holds: 'verb',
    caption: null,
  },
};

/**
 * MAY THIS BODY BE GIVEN THIS ORDER, AND IF NOT, WHY NOT — IN A SENTENCE.
 *
 * One reader for both halves, because a wheel slot that is cold and a wheel
 * slot that says why it is cold must never be able to disagree. Returns null
 * when the order is legal, and the refusal otherwise.
 */
/** 'a' or 'an', off the sound the word starts with rather than off the letter
 *  — there are no 'hour'-shaped kind names in the table and there is no reason
 *  to write a pronunciation dictionary for twelve rows. */
const article = (w) => (/^[aeiou]/i.test(w || '') ? 'an' : 'a');

/**
 * `arg` IS THIRD AND OPTIONAL, WHICH IS WHAT KEEPS THE WHEEL UNCHANGED.
 *
 * `CompanionWheel.captionFor` asks this with two arguments while the cursor is
 * over a slot and nothing is aimed at yet, and it must keep getting the answer
 * it gets today — the rung's refusal, or the caption. The verb's own refusal
 * is about a THING (this cover, this man, this door) and can only be answered
 * once there is one, so it is asked only when the order is actually given.
 * Same door, same sentence, two moments.
 */
export function refuseOrder(e, id, arg) {
  const O = COMPANION_ORDERS[id];
  if (!O) return 'no such order';
  const K = COMPANION_KINDS[e?._cmpKind];
  if (!K) return 'nothing of yours is out';
  if (!kindHasDuty(K.id, id === 'ward' ? 'ward' : id)) {
    /* THE ARTICLE IS PART OF THE SENTENCE. "a astromech has nothing to meet
     * them with" is a refusal a player reads as a bug in the game rather than
     * a rule of it, and this string is printed on the wheel under the cursor —
     * the one place the game speaks to the player about their own animal. */
    const n = `${article(K.label)} ${K.label.toLowerCase()}`;
    return id === 'ward' ? `${n} has nothing to meet them with` : `${n} does not do that`;
  }
  /* A VERB THE TABLE HAS NO WORK FOR IS REFUSED AND NEVER SILENT. The join
   * between a kind's `verb.id` and `COMPANION_VERBS` is total today and a
   * check asserts it stays total; this is what a thirteenth kind gets on the
   * commit before its work row lands, and it is a sentence rather than a wheel
   * slot that says a word and does nothing. */
  if (id === 'verb' && !verbWork(e)) {
    return `${article(K.label)} ${K.label.toLowerCase()} cannot do that yet`;
  }
  const rec = e._cmpRec;
  if (!holdsCompanion(rec, O.holds)) {
    const want = COMPANION_RANKS.find((r) => r.orders.includes(O.holds));
    return want ? `not until it is ${want.label.toLowerCase()}` : 'not yet';
  }
  /* AND THE VERB'S OWN PRECONDITION, LAST, because it is the only one that
   * needs the argument. A slice with no door under it, a relay with no army
   * to carry to and a wreck with nothing there to wreck are all REFUSALS with
   * a sentence — never an accepted order that does nothing, which is the exact
   * defect the whole verb table exists to end. Asked when an argument was
   * SUPPLIED — `undefined` is the wheel hovering with nothing aimed at, and a
   * `null` is a verb whose `arg` is 'none', which still has preconditions. */
  if (id === 'verb' && arg !== undefined) {
    const said = verbWork(e)?.refuse?.(e, arg);
    if (said) return said;
  }
  return null;
}

/**
 * WHAT THIS ORDER NEEDS POINTING AT — one vocabulary, two tables.
 *
 * Five of the six slots declare it on the order row and the sixth cannot: the
 * verb means twelve things, and two of them want a hostile, four a piece of
 * ground, two a man of YOUR OWN and four nothing at all. So the verb's `arg`
 * is read off its work row and every other order's off the order row, and
 * there is ONE word for each shape rather than a second convention for verbs.
 *
 * 'friend' IS THE ONE NEW WORD AND IT NAMES A REFUSAL THAT WAS ALREADY WRONG.
 * The hostile test below is `arg.team === e.team → nothing under your
 * reticle`, which is right for SEEK and exactly backwards for RELAY (it talks
 * to your men) and TEND (it works on them). A value in the existing field is
 * what stops that becoming two argument systems.
 */
function argKind(e, O) {
  if (O.id !== 'verb') return O.arg;
  return verbWork(e)?.arg ?? 'none';
}

/**
 * WHAT THE RETICLE HAS TO FIND FOR THIS ORDER — the same answer, for the
 * caller that has to go and get it.
 *
 * The wheel reads the reticle at close and hands `orderCompanion` whatever the
 * order takes, so it has to know which of the four shapes to look for. It
 * asks HERE rather than keeping a list, because a list in the HUD is a second
 * copy of this table and the day they disagree is the day a wookiee is handed
 * a hostile and refuses its own verb with "no ground under your reticle".
 */
export function orderArg(e, id) {
  const O = COMPANION_ORDERS[id];
  return O ? argKind(e, O) : 'none';
}

/**
 * GIVE AN ORDER. The argument is whatever the order's `arg` says it takes, and
 * a wrong-shaped argument is a refused order rather than a silent no-op.
 *
 * HEEL IS THE ONE THAT CLEARS. It drops every standing order, the bid and the
 * focus, and it cancels a seek mid-swing — which is why it is also what the
 * game issues implicitly at every lifecycle boundary (deploy, area change,
 * boarding, mounting, dismount). A companion can never be orphaned by a
 * transition, because every transition says HEEL.
 */
export function orderCompanion(e, id, arg = null) {
  if (!e) return 'nothing of yours is out';
  const why = refuseOrder(e, id, id === 'verb' ? arg : undefined);
  if (why) return why;
  const O = COMPANION_ORDERS[id];
  const A = argKind(e, O);
  if (A === 'body' && (!arg || arg.dead || arg.team === e.team)) return 'nothing under your reticle';
  if (A === 'friend' && (!arg || arg === e || arg.dead || arg.team !== e.team)) return 'nobody of yours under your reticle';
  if (A === 'point' && !arg?.isVector3) return 'no ground under your reticle';
  /* EVERY DOOR OUT OF A VERB GOES THROUGH `endVerb`, and this is two of the
   * three: a different order, and a HEEL. Called before the new duty is
   * written, so `stop` reads the verb it is putting back rather than the one
   * that is about to replace it. */
  endVerb(e);
  /**
   * AND THE BODY IT WAS ON GOES WITH THE ORDER IT WAS UNDER.
   *
   * HEEL has always done this — "it cancels a seek mid-swing" — and every
   * other order needs it for the same reason: `dutyAllows` is the ORDER's own
   * filter, so a target picked under the last one has never been asked whether
   * this one allows it. On almost every frame that costs nothing, because
   * `_think` re-picks before anything reads it.
   *
   * THE FRAME IT COSTS SOMETHING IS THE ONE WHERE `_think` DOES NOT RUN.
   * `Enemy.update` skips the brain entirely while `stepReaction` owns the body
   * — a dodge roll away from a bolt is about a third of a second — and a
   * target written before the order then survives into it untouched. Measured
   * after the move wrap learned to defer to a reaction (which is what let
   * rolls run their length at all): a massiff given SEEK while mid-roll spent
   * 10 frames holding the body it had been fighting under HEEL, and the check
   * that says "SEEK takes the named body only" went red on exactly those ten.
   *
   * One line, at the one door every order comes through, and the rule is the
   * one HEEL already stated: a new order is a new question.
   */
  e.target = null;
  if (id === 'heel') {
    e._cmpDuty = null;
    e._cmpBidden = null;
    e._cmpPoint = null;
    return null;
  }
  e._cmpDuty = O;
  e._cmpBidden = A === 'body' ? arg : null;
  e._cmpMate = A === 'friend' ? arg : null;
  e._cmpPoint = A === 'point' ? arg.clone() : null;
  /* AND THE VERB STARTS. A verb whose whole content is instantaneous — CRY is
   * a shout and not a posture — says so by returning 'done', and the duty is
   * over before the frame is. That is why the wheel does not have to know
   * which of the twelve are standing orders and which are not. */
  if (id === 'verb') {
    const W = verbWork(e);
    if (W?.start?.(e, arg) === 'done') { endVerb(e); e._cmpDuty = null; }
  }
  /* AN ORDER THAT LANDED IS A DEED, and it is counted ONCE PER AREA rather
   * than once per press — see `DEEDS.order`. A player who taps the wheel
   * thirty times has not trained anything. */
  if (e._cmpRec && !e._cmpOrderedHere) { e._cmpOrderedHere = true; award(e._cmpRec, 'order'); }
  return null;
}

/**
 * WHERE THE COMPANION IS SUPPOSED TO BE STANDING, WHICH IS THE ONE THING BOTH
 * WRAPS HAVE TO AGREE ABOUT.
 *
 * The move wrap walks it home to this point and the aim wrap measures its
 * leash from this point; two readers with two ideas of the station would be a
 * companion that hunts round one place and walks to another. So it is one
 * function, and the orders that move the station say so here rather than in
 * either wrap.
 *
 * HOLD IS THE ONE THAT DETACHES IT FROM YOU. You gave it a place and then
 * walked away from it, which is exactly why it is the last rung: a green
 * companion physically cannot be abandoned by an order you gave it.
 */
export function stationFor(e, out) {
  const D = e._cmpDuty;
  if (D?.id === 'hold' && e._cmpPoint) return out.copy(e._cmpPoint);
  /**
   * AND FIVE OF THE TWELVE VERBS MOVE IT SOMEWHERE ELSE ENTIRELY — in front of
   * you (BLOCK), at a piece of cover (WRECK, BREACH), at a door (SLICE), at
   * one of your men (RELAY), or a long way off in one direction (BOLT).
   *
   * WRITTEN HERE AND NOT IN THE PACK TICK, for the reason this function exists
   * at all: the aim wrap measures the leash from the station and the move wrap
   * walks to it, and two readers with two ideas of where the animal is
   * supposed to be is a companion that hunts round one place and walks to
   * another. A verb that moves the station moves BOTH by saying so once.
   *
   * A hook that returns false has no opinion and the ordinary heel stands,
   * which is what BLOCK does the moment there is nothing to stand in front of.
   */
  if (D?.id === 'verb') {
    const W = verbWork(e);
    if (W?.station && W.station(e, out)) return out;
  }
  const p = e._cmpOwner;
  if (!p?.position) return out.copy(e._cmpHome || e.position);
  const yaw = p.aimDir ? Math.atan2(p.aimDir.x, p.aimDir.z) : (p.facing || 0);
  /* AWAY PUTS IT BEHIND YOU AND NOT BESIDE YOU. The side offset is what keeps
   * an ordinary heel out from under your feet; a companion told to break off
   * is a companion you want between you and nothing at all. */
  const side = D?.id === 'away' ? 0 : HEEL.side * (e._cmpSide ?? 1);
  const back = HEEL.back * (D?.id === 'away' ? 1.35 : 1);
  return out.set(
    p.position.x - Math.sin(yaw) * back - Math.cos(yaw) * side,
    p.position.y,
    p.position.z - Math.cos(yaw) * back + Math.sin(yaw) * side,
  );
}

/**
 * IS THE OWNER STILL ON HIS FEET? The move wrap's own test, given a name.
 *
 * A player has no downed state in this game — `World._checkWipe` ends the run
 * the frame the last one falls, and `_reviveDowned` is a co-op wave clear — so
 * "you are down" is exactly `alive === false`, and one spelling of that test
 * is what keeps the readers that ask it from disagreeing.
 */
export function ownerUp(e) {
  const p = e?._cmpOwner;
  return !!(p && p.alive !== false && !p.dead && p.position);
}

/**
 * MAY THIS COMPANION TAKE THIS BODY, UNDER THE ORDER IT IS UNDER.
 *
 * The aim wrap's whole filter, in one place, so that adding an order is a row
 * in the table above and a clause here rather than an edit to the wrap.
 *
 * @param home  the station, already computed — passed IN rather than recomputed
 *              because the wrap needs it too and `stationFor` writes a vector.
 */
export function dutyAllows(e, foe, home, leash) {
  const D = e._cmpDuty;
  /* AWAY IS A REFUSAL TO FIGHT, HELD UNTIL CANCELLED. Not a position — the
   * station moves too, but this is the half that makes it different from
   * HEEL, and it is unconditional: there is no hostile close enough to
   * override an order to break off. */
  if (D?.id === 'away') return false;
  if (D?.id === 'seek') return foe === e._cmpBidden;
  /* WARD MEASURES FROM YOU AND NOT FROM ITSELF, and that distinction is the
   * whole order: it makes the companion a tripwire around the PLAYER rather
   * than a second wanderer. It is the brief's "attacking anything that gets
   * within a certain range of you" said precisely. */
  if (D?.id === 'ward') {
    const p = e._cmpOwner;
    const r = COMPANION_KINDS[e._cmpKind]?.ward || 0;
    if (!p?.position || r <= 0) return false;
    return foe.position.distanceToSquared(p.position) <= r * r;
  }
  /* AND A VERB MAY NARROW ITS OWN TARGETING, in the one place an order already
   * does. CHARGE takes only what is inside its jaws' band because a mount does
   * not leave the ground you are standing on; BOLT takes nothing at all
   * because a panic run does not stop to fight. Neither of those is a clause
   * in the wrap and neither is a switch on a kind. */
  if (D?.id === 'verb') {
    const W = verbWork(e);
    if (W?.allows) return W.allows(e, foe, home, leash);
  }
  return foe.position.distanceToSquared(home) <= leash * leash;
}


/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE TWELVE VERBS                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ONE SLOT, TWELVE MEANINGS — AND HERE IS WHERE THE MEANING LIVES.
 *
 * The wheel said SLICE on an astromech and CRY on a tooka from the day the
 * rows landed, and neither one did anything: `COMPANION_ORDERS.verb` existed,
 * `orderCompanion(e, 'verb', t)` accepted it, `_cmpDuty` was written, and not
 * one line anywhere read it. An order that is ACCEPTED and does nothing is
 * worse than one that is refused — `tools/_cmporders.mjs` opens with that
 * sentence — so this table is the twelve answers.
 *
 * ── WHY A TABLE KEYED ON THE VERB AND NOT A HANDLER ON THE KIND'S ROW ─────
 *
 * Both are legal under the one rule this feature is built on: nothing may
 * switch on a KIND's name. `tools/checks/companions.mjs` greps this file, the
 * Kennel and the HUD for all twelve kind ids and goes red on any of them, and
 * a verb id is not a kind id — `block` is not `massiff`, and the astromech's
 * `slice` would still be `slice` if the row were renamed tomorrow.
 *
 * The row was the first shape tried and it is the wrong one for two reasons a
 * reader will otherwise re-derive:
 *
 *   CompanionKinds.js IS A DATA FILE AND HAS TO STAY ONE. Its own header
 *   records the temporal-dead-zone hazard that governs it — it `Object.assign`s
 *   into `ARCHETYPES` and therefore may never be imported by `Enemy.js` or
 *   `Bodies.js` — and the work below needs `Reactions.js` (the medic),
 *   `world.destruction` (the two wreckers) and `Command.js` (the runner).
 *   Hanging that import surface off the twelve rows puts the whole game's
 *   machinery one edge away from the table `spawnEnemy` reads.
 *
 *   AND THE WORK IS PER-FRAME. Ten of the twelve need a tick — a walk to a
 *   door, a clock on a bleed-out, a beat between two slams — and the pack's
 *   own `update` is where a companion's per-frame work already lives. A
 *   handler on a frozen row would be reaching back into the pack anyway.
 *
 * So the row keeps its three PLAYER-FACING fields (`id`, `label`, `caption` —
 * what the wheel says) and this keeps the behaviour, joined on the id. The
 * check asserts the join is total: a kind whose verb has no row here is a
 * wheel slot that says a word and does nothing, which is exactly the defect
 * being fixed.
 *
 * ── THE FIVE HOOKS, AND WHAT EACH ONE IS FOR ──────────────────────────────
 *
 *   arg      what the order needs pointing at, in the same vocabulary
 *            `COMPANION_ORDERS` uses — 'none', 'body' (a hostile, from the
 *            reticle), 'point' (the ground) — plus one this table adds:
 *            'friend', a body on YOUR side. RELAY talks to your men and TEND
 *            works on them, and `orderCompanion`'s hostile test refuses
 *            exactly those two. It is a value in the existing field rather
 *            than a second field, so there is one vocabulary and one reader.
 *   refuse   why this order cannot be given RIGHT NOW, in a sentence, through
 *            `refuseOrder` — which is the door the wheel's caption already
 *            reads. A verb with no cover under the reticle, no army to carry
 *            an order to and no door to turn must SAY so; the alternative is
 *            the silence this whole table exists to end.
 *   start    the whole order, for the ones that are instantaneous. Returning
 *            'done' ends the duty on the spot, which is how CRY is a shout
 *            rather than a standing order.
 *   station  where the animal has to be standing for this verb, written into
 *            `stationFor` so the aim wrap's leash and the move wrap's walk
 *            read the same point. Return false and the ordinary heel stands.
 *   tick     the per-frame work, from the pack's own update. 'done' ends it.
 *   allows   whether it may take a body while this verb stands, through
 *            `dutyAllows`, so a verb can narrow or refuse its own targeting
 *            without the wrap learning about it.
 *   stop     put back anything `start` changed. Called at EVERY door out of a
 *            verb — a new order, a HEEL, the verb finishing itself — because
 *            a grade ceiling raised for a climb and never lowered is a
 *            companion that climbs walls for the rest of the run.
 */

/** Is the owner still on his feet? A player has no downed state — `World.
 *  _checkWipe` ends the run the frame the last one falls — so "you are up" is
 *  exactly these three clauses, and they are the move wrap's own. */
function verbOwnerUp(e) {
  const p = e?._cmpOwner;
  return !!(p && p.alive !== false && !p.dead && p.position);
}

/** The work this animal's verb does, or null. One join, one place. */
export function verbWork(e) {
  return COMPANION_VERBS[COMPANION_KINDS[e?._cmpKind]?.verb?.id] || null;
}

/** Is this body under its own verb right now, and is it THIS verb? */
function onVerb(e, id) {
  return e?._cmpDuty?.id === 'verb' && COMPANION_KINDS[e._cmpKind]?.verb?.id === id;
}

/**
 * EVERY DOOR OUT OF A VERB GOES THROUGH HERE.
 *
 * Three of them exist — a different order, a HEEL, and the verb saying it has
 * finished — and `stop` has to run on all three or the one verb that changes
 * the body (CLIMB, which lifts the grade ceiling) leaks. Written once and
 * called from `orderCompanion` and from the pack tick rather than three times.
 */
function endVerb(e) {
  if (e?._cmpDuty?.id === 'verb') verbWork(e)?.stop?.(e);
  e._cmpVerbT = 0;
  e._cmpCover = null;
  e._cmpMate = null;
}

/** Everything this body is opposed to, inside `r` of a point. `_hostilesFor`
 *  hands back a SHARED array, so it is walked here and never held. */
function eachHostile(e, at, r, fn) {
  const w = e.world;
  if (!w?._hostilesFor || !at) return 0;
  let n = 0;
  const r2 = r * r;
  for (const o of w._hostilesFor(e)) {
    if (!o?.position || o.dead) continue;
    if (o.position.distanceToSquared(at) > r2) continue;
    if (fn(o) !== false) n++;
  }
  return n;
}

/** The nearest thing this body is opposed to, measured from a point. */
function nearestHostile(e, at, r) {
  let best = null, bestD = r * r;
  eachHostile(e, at, r, (o) => {
    const d = o.position.distanceToSquared(at);
    if (d < bestD) { bestD = d; best = o; }
    return false;
  });
  return best;
}

/**
 * THE COVER UNDER THE RETICLE, WHATEVER IT IS MADE OF.
 *
 * "Cover" in this game is two different objects and the verbs that break it
 * must not care which: a revetment, a wall or a pier is a `Destruction`
 * structure with cells and a support graph, and a crate, a drum or a console
 * is a `Prop` with an hp pool. WRECK and BREACH both want one of them and
 * neither wants to learn the difference twice, so the test is here and both
 * doors are the ones already shipped:
 *
 *   a structure  `damageSphere` takes a bite out of it (the same call
 *                `Destruction.explosion` makes) and `collapse` lets the whole
 *                piece go (the same call the support solver makes when what
 *                was holding it up stops holding it up).
 *   a prop       `damage` and `shatter`, which are what the blade and a
 *                thrown body already reach it through.
 *
 * Nothing here re-implements breaking. It picks the nearest of the two and
 * hands back the two verbs a wrecker needs.
 */
function coverAt(world, point, reach = COVER_FIND) {
  if (!point) return null;
  const s = world?.destruction?.structureAt?.(point, reach);
  if (s) {
    return {
      what: 'a piece of the building', centre: s.centre,
      gone: () => s.state === 'gone' || s.state === 'collapsed',
      hit: (amount, dir, at) => world.destruction.damageSphere(at || s.centre, WRECK_BITE_R, amount, dir),
      tear: (dir) => { s.collapse(dir); return true; },
    };
  }
  let best = null, bestD = reach * reach;
  for (const pr of world?.props || []) {
    /**
     * A PACK IS NOT A PIECE OF COVER, and `world.props` is full of them.
     *
     * `RiderPack`, `FlightPack` and this file's own `CompanionPack` are TICKS
     * rather than objects in the world, and every one of them publishes the
     * same duck type a prop does — `damage()`, `shatter()`, a stub `body` at
     * the origin — with `hp: Infinity` and `mesh: null`, because
     * `World._resolveBlades` reads `pr.body.position` before it asks for
     * capsules and a pack without one throws. So a reticle near the origin
     * would have found the companion pack itself, `hit` it forever (its
     * `damage` returns false and it is never `gone`) and left the order
     * standing on a thing that is not there.
     *
     * A REAL PIECE OF COVER HAS A MESH AND A FINITE POOL. Both, because either
     * alone is one of the three packs' own shape.
     */
    if (!pr || pr.dead || !pr.mesh || !Number.isFinite(pr.hp) || pr.hp <= 0) continue;
    if (typeof pr.damage !== 'function' || typeof pr.shatter !== 'function') continue;
    const at = pr.body?.position || pr.mesh?.position;
    if (!at) continue;
    const d = at.distanceToSquared(point);
    if (d < bestD) { bestD = d; best = pr; }
  }
  if (!best) return null;
  const at = best.body?.position || best.mesh.position;
  return {
    what: best.kind || 'it', centre: at,
    gone: () => best.dead || best.hp <= 0,
    hit: (amount, dir, where) => best.damage(amount, where || at, dir),
    tear: (dir, where) => { best.shatter(dir, where || at); return true; },
  };
}

/**
 * HOW FAR FROM THE RETICLE'S POINT A PIECE OF COVER STILL COUNTS AS THE ONE
 * YOU MEANT. `Destruction.structureAt`'s own default is 3 m and it measures
 * from the piece's BOX rather than its centre; a crate is measured from its
 * centre and is about 0.8 m across, so the same number covers both without a
 * player having to put the reticle on a specific texel.
 */
const COVER_FIND = 3;

/** ── BLOCK ──────────────────────────────────────────────────────────────
 *
 * "it puts itself between you and the nearest hostile and takes hits inside a
 *  cone, so the better it does its job the faster you lose it."
 *
 * TWO HALVES, AND ONLY ONE OF THEM IS MOVEMENT. The station is the easy half
 * and it is written where every other station is written. The half that makes
 * it a BLOCK rather than a place to stand is that a blow which would have
 * landed on you lands on the animal instead — and the shipped precedent for
 * that is three lines up the same method:
 *
 *     A MAN INSIDE A TANK IS NOT SHOT AT — THE TANK IS.  (Player.damage)
 *
 * `Player.damage` is the ONE sink every blow that reaches a player passes
 * through — its own note says so and makes the same argument for putting the
 * driving redirect there rather than at each source — so this is an instance
 * wrap of that one method and nothing else in the game learns the word
 * companion. It is a REDIRECT AND NOT AN IMMUNITY, exactly as the tank is: the
 * damage is not discounted, it is billed to a body with 210 hp instead of one
 * with 100, and the animal takes it on its own table with its own `frag` and
 * its own death.
 *
 * THE CONE IS WHY IT IS NOT A SHIELD. A blocker can only be in one direction
 * at a time, and the whole shape of the order is that you point it at the
 * thing in front of you and take everything else on your own guard. 0.62 rad
 * is a 71° arc — wide enough that a shooter drifting sideways does not walk
 * out of it between two bursts, narrow enough that the man on your flank is
 * still your problem. The axis is you → the animal, not you → its target, so
 * what is covered is what the animal is STANDING in front of; a massiff that
 * has been dragged off the line stops blocking on the frame it leaves.
 *
 * MEASURED (`tools/_cmpverbs.mjs`), one hostile at 9 m and six bolts of 9:
 * the dog stands 2.7 m off you and 11° off the line to it, and takes 54 hp
 * while you take 0. Six more from a second hostile BEHIND you put 8 on you
 * and 0 on it. Lift the order and the next six are yours again.
 */
export const BLOCK = { hold: 2.6, cone: 0.62, see: 26 };

/**
 * Wrap the owner's one damage sink, once, for as long as he lives.
 *
 * INSTALLED ON THE OWNER AND GATED ON THE ORDER, rather than installed and
 * removed with the order. A wrap that is added and taken off is a wrap that
 * two orders in one frame can lose, and `Player.damage` may be wrapped by
 * anything else in any order; the guard below reads the LIVE duty every blow,
 * so lifting the order stops the redirect on the same frame with nothing to
 * unwind. `blockerFor` walks the pack rather than closing over one animal, so
 * a companion that dies and is replaced is answered by the list.
 */
function installBlockGuard(e) {
  const p = e._cmpOwner;
  const world = e.world;
  if (!p || typeof p.damage !== 'function' || p._cmpGuard) return;
  p._cmpGuard = true;
  const hurt = p.damage.bind(p);
  p.damage = function (amount, point, source, kind, preResisted) {
    const b = blockerFor(world, p);
    /**
     * A BODY ON THE OTHER SIDE, AND NOTHING ELSE.
     *
     * Two things are excluded and both would be worse than not blocking. A
     * blow with NO source is the environment — a fall, a drowning, the ground
     * — and a dog cannot stand in front of gravity. And a blow from your own
     * side would VANISH rather than move: the animal's own `damage` answers
     * `canHarm`, which refuses a friendly hit whenever friendly fire is off,
     * so redirecting your own trooper's stray bolt onto it would delete the
     * bolt instead of paying for it.
     */
    const hostile = !!source && source.team !== undefined && source.team !== p.team;
    if (b && amount > 0 && hostile && insideBlock(p, b, source, point)) {
      /* HIS OWN DAMAGE PATH, so the animal's `frag`, its friendly-fire scaling
       * and its "that was you" notice all apply to a redirected blow exactly
       * as they apply to one aimed at it. */
      b.damage(amount, point, source, kind);
      b._cmpBlocked = (b._cmpBlocked || 0) + amount;
      return false;
    }
    return hurt(amount, point, source, kind, preResisted);
  };
}

/** The one body of yours that is under BLOCK right now, if there is one. */
function blockerFor(world, p) {
  const pack = world?._companions;
  if (!pack) return null;
  for (const b of pack.list) {
    if (b?._cmpOwner === p && !b.dead && !b.downed && onVerb(b, 'block')) return b;
  }
  return null;
}

/** Did this blow come from inside the arc the animal is standing across? */
function insideBlock(p, b, source, point) {
  const from = source?.position || point;
  if (!from || !p.position) return false;
  /* IT HAS TO BE INTERPOSED, not merely alive. Past `hold × 2` it is somewhere
   * else and the blow is yours. */
  const dx = b.position.x - p.position.x, dz = b.position.z - p.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.2 || d > BLOCK.hold * 2) return false;
  const sx = from.x - p.position.x, sz = from.z - p.position.z;
  const sd = Math.hypot(sx, sz);
  if (sd < 0.2) return false;
  return (dx * sx + dz * sz) / (d * sd) >= Math.cos(BLOCK.cone);
}

/** ── CRY ────────────────────────────────────────────────────────────────
 *
 * "the tooka pulls every hostile within 25 m onto ITSELF for 3 s — the useless
 *  thing's one moment of use is being bait it will probably not survive."
 *
 * A TARGETING OVERRIDE AND NOT AN AGGRO SYSTEM, which is the design's own
 * word for it. `Enemy._think` opens with
 *
 *     this.target = this.compelled?.target ?? ctx.pickTarget(this);
 *
 * and `compelled` is `{ target, t }`, decayed in `Enemy.update` and cleared
 * when the clock runs out or the target dies. Force compel already writes it
 * (Player.js) and this writes the same field with the same shape — so a
 * hostile pulled by a tooka advances, takes cover, leads its shots and calls
 * out exactly as it always did, at a cat. There is no second brain and there
 * is nothing to unwind: the three seconds end themselves.
 *
 * 25 m AND 3 s ARE THE DESIGN'S NUMBERS AND ARE NOT TUNED HERE. What they buy
 * is one exchange: the tooka's 24 hp is under a single B1 burst (3 × 9 = 27),
 * so three seconds of being the only thing anybody is looking at is very
 * often the last three seconds of it.
 *
 * MEASURED, four B1s at 8 m and two at 48: 4 of 4 inside the ring compelled
 * and 0 of 2 outside it, 0 → 4 of them actually targeting the cat on the next
 * frame, every compulsion cleared by itself four seconds later — and the cat
 * did not survive being used, which is the row's own promise kept.
 */
export const CRY = { ring: 25, hold: 3 };

/** ── FLUSH ──────────────────────────────────────────────────────────────
 *
 * "it pounces to knock a body flat instead of killing it — a setup for your
 *  blade rather than a substitute for it."
 *
 * `Enemy.knockFlat` IS THE WHOLE OF IT. It is the shipped fall — the one a
 * Force shove uses — and every rule it carries is one this verb wants and
 * would otherwise have had to restate: not a boss, not anything `big` (so a
 * whelp pointed at a spider droid achieves nothing, which is the lesson the
 * design wants that order to teach), not a body already limp or held or being
 * carried, and never from a body on the same side. It RECORDS the fall and
 * `_move` takes it a frame later, which is the fix Enemy.js spent a page
 * arguing for and which nothing here may go round.
 *
 * THE SHOVE IS ADDED TO `velocity` BECAUSE THAT IS WHERE `_takeFall` READS THE
 * LAUNCH FROM: "`addShove` has already put the impulse into `velocity`, so
 * handing the ragdoll the body's own velocity sends it the way it was thrown
 * rather than dropping it where it stood." A `knockFlat` with no impulse in
 * front of it is a body that goes limp on the spot.
 *
 * AND IT DOES NO DAMAGE AT ALL. The whelp still bites, because the bid puts
 * the body in front of it and the brain does what a brain does — but the FLUSH
 * itself takes nothing off, which is the difference between a setup and a
 * substitute. 12 is the shove: `hitTarget` uses 16 for a blow that is meant to
 * hurt, and this is meant to put a man on his back a metre away rather than
 * across the room, because your blade has to be able to reach him.
 *
 * MEASURED, a whelp sent at a B1 seven metres off: on its back at 3.1 s, and
 * the 9 hp it lost over those three seconds is the whelp's own bite and not
 * the flush.
 */
export const FLUSH = { shove: 12, lift: 0.55 };

/** How close the pounce has to be. The animal's OWN footprint — `pounce.reach`
 *  off BEAST_MOVES times its scale, the same arithmetic `hitTarget` does — so
 *  a bigger whelp reaches further and nothing here restates a reach. */
function flushReach(e) {
  const M = BEAST_MOVES.pounce || BEAST_MOVES.lunge;
  return Math.max(1.4, (M.reach || 1) * (e.A?.scale ?? 1) * 1.6);
}

/** ── RELAY ──────────────────────────────────────────────────────────────
 *
 * "send it to a squad and it delivers a standing order to men outside your own
 *  order range, which pays part of the distance cost the command system
 *  already carries."
 *
 * THE RUNNER'S OWN DOOR, USED BY A BODY THAT IS NOT A TROOPER.
 * `CommandDirector._runnerTick` delivers exactly like this and its note is the
 * specification:
 *
 *     `_carrying` makes his own body the mouth for that one call, so the men
 *     around him hear it and men fifty metres past them still do not.
 *
 * `_voices` reads `this._carrying?.position` FIRST, before the player and
 * before the pace anchor, so setting it round one `order()` call is the whole
 * of "the order was given from where the droid is standing". Nothing else is
 * needed and nothing else is written: `t.runner` is a Trooper field on a
 * Trooper record and a companion has neither, which is why the errand lives on
 * the companion's own duty instead.
 *
 * WHAT IT CARRIES IS THE ORDER YOU ALREADY GAVE — `director.formation`, the
 * live one — and not a second order chosen here. The B1 is a mouth, not a
 * commander, and a wheel that could send a DIFFERENT order to a squad you
 * cannot reach would be a way round the reach rule rather than a price for it.
 *
 * MEASURED, a squad of five walked to 87 m of a 34 m `ORDER_REACH`: the same
 * order from the player's own mouth was refused — "Column — 5 men — out of
 * reach" — and the droid crossed in 7 s and they took it. That is the whole
 * claim, driven at both ends.
 */
export const RELAY = { deliver: 6 };

/** ── WRECK and BREACH ───────────────────────────────────────────────────
 *
 * "the only companion whose attacks change the LEVEL rather than the enemy — a
 *  scaled slam that shatters the crate a shooter is behind", and "it rips a
 *  designated cover apart".
 *
 * TWO VERBS, TWO EXISTING DOORS, AND THE DIFFERENCE BETWEEN THEM IS THE POINT.
 * A rancor pup SLAMS: `damageSphere` takes a bite out of a piece where the
 * blow landed and leaves what is still supported standing, which is the same
 * call `Destruction.explosion` makes and the reason a slam beside a revetment
 * opens a hole rather than removing a building. A wookiee BREACHES: `collapse`
 * detaches every cell at once and lets the support solver take whatever was
 * resting on it, which is the difference between chipping cover and there
 * being no cover.
 *
 * THE BITE IS SIZED ON THE PIECE AND NOT ON THE ANIMAL, and that is the one
 * decision here a reader will want to reverse. The pup's `damage` is 12 — the
 * lowest melee number in the table, deliberately, because "the value is the
 * terrain and the lift" — and the cover it is being pointed at holds 40 hp (a
 * crate) to 170 (a plan piece). Twelve points a slam is a verb that does
 * nothing you can see, and raising the pup's damage to make its verb work
 * would arm the one companion the design specifically disarmed. So the slam
 * is priced as ARCHITECTURE DAMAGE, in the units the thing it hits is measured
 * in, and it is deliberately not a number the animal carries into a fight.
 *
 * MEASURED: 190 puts a 0.9 m crate (34 hp) through the floor in ONE slam and
 * takes a bite out of a plan piece (70–170 hp) in one or two, which is the
 * shape wanted — a shooter's cover is gone in a beat and a building is not.
 * A BREACH on the same class of piece measured "intact, 99 hp" → "collapsed"
 * 0.2 s after the wookiee reached it, every cell detached at once. The two
 * verbs are visibly different things and they share no code but the finder.
 */
export const WRECK = { bite: 190, beat: 1.1, reach: 3.4 };
export const BREACH = { reach: 3.4 };
/** The radius of one slam against a structure. `Destruction.explosion` uses
 *  5.5 m for a charge going off; a pup's forearm is a fraction of that, and
 *  the sphere has to sit inside its own `preferred` band ([1.0, 2.2]) or the
 *  animal is standing outside the hole it is making. */
const WRECK_BITE_R = 2.2;

/** ── SPOT ───────────────────────────────────────────────────────────────
 *
 * "its verb SPOT climbs and paints every hostile within 60 m onto your HUD for
 *  8 s — information you trade exposure for."
 *
 * THE HUD'S OWN MARKER PATH, AND NOT A SECOND ONE. `world.notifyFloating` is
 * the one call the game already makes to put a word over a point in the world
 * — PARRY, CHAMBER, GUARD BROKEN, PATCHED UP, and the companion's own "that
 * was you" all go through it — and `HUD.floating` pools the nodes and retires
 * them at 1.05 s. So a paint is a floating mark refreshed on a beat, and the
 * eight seconds are the hawk holding the reading rather than one node with a
 * long life: a mark that lasted eight seconds would sit where the body WAS,
 * and the whole value of the verb is where they are.
 *
 * 0.85 s BETWEEN REFRESHES against a 1.05 s life. The overlap is deliberate —
 * the mark for a body is replaced before the last one expires, so a hostile
 * that stays inside the ring is painted continuously rather than blinking —
 * and the HUD's own 26-mark ring buffer bounds the cost whatever the ring
 * holds.
 *
 * AND IT CLIMBS IF IT HAS WINGS. `Flight.flightStep` reads `_flightState`,
 * which is one of four strings, and drives the body toward the high cruise
 * band when it is 'cruise'. Putting a stooping hawk back into 'cruise' is the
 * one lever that file publishes and it is the whole of "it climbs"; a body
 * with no flight installed has no such field and this is a no-op on it, which
 * is what the verb has to be until the hawk has a body.
 *
 * MEASURED, six hostiles put down between 18 and 85 m: 10 beats over the
 * reading, every one of them painting EXACTLY the hostiles inside 60 m of the
 * owner and none of the eight body-beats outside it, 52 marks through the
 * HUD's own path, and the last one at 7.8 s of an 8 s reading.
 *
 * AND THE CLOCK IS `dt` AND NOT FRAMES, which cost a red line to notice.
 * `World.update` scales its own dt by `timeScale * focus.scale` before
 * anything downstream sees it, so a Force focus is a slow-motion for
 * everything in the frame. Counted in fixture frames the 8 s reading read as
 * 9.6; counted in `world.time` — the second `stateTime`, `bleed` and
 * `compelled.t` are all on — it is 7.8. The verb was right and the ruler was
 * not, and a verb clocked on frames would run long exactly when the game is
 * most crowded.
 */
export const SPOT = { ring: 60, hold: 8, beat: 0.85 };

/** ── SLICE ──────────────────────────────────────────────────────────────
 *
 * "it rolls to a designated door, terminal or console-driven hazard and turns
 *  it — the only companion order that changes the map instead of the fight."
 *
 * THE ONE TURNABLE THING IN THE TREE IS THE BLAST DOOR, and this is honest
 * about that rather than pretending otherwise. `world.doors` holds them,
 * `addDoor` is the one way in, and `BlastDoor.breach()` is the whole of
 * "turned": it drops the collider (and REMOVES the Rapier cuboid, which is the
 * difference between the player walking through and everything else in the
 * game not), drops the slug, and fires the level's own `onBreach` — which on
 * the magazine credits the support pool and prints ORDNANCE TAKEN. An
 * astromech opening that door does exactly what twenty seconds of held blade
 * does, and the level does not learn how it was opened.
 *
 * A CONSOLE AND A DEAD TURRET ARE NOT REFUSED — THEY ARE NOT THERE. There is
 * no console in this game with a state to turn (`makeConsole` builds furniture)
 * and no derelict turret at all, so a SLICE pointed at one gets the refusal
 * sentence rather than a droid that walks over and stands there. When those
 * exist, they are a second branch in `sliceTarget` and nothing else.
 *
 * NINE SECONDS AT THE PANEL, and it is the number that makes the order cost
 * something. The blade opens the same door in a measured 18.8 s of contact
 * while you are stood in front of it and cannot fight; this is half that, and
 * the price is that you are not with the animal while it works — it is the
 * slowest body you own, it cannot defend itself at all, and it is standing
 * still beside a door somebody is holding.
 *
 * MEASURED, an astromech ordered at the magazine's own door from 4.5 m: shut
 * at the order, open at 9.7 s, collider removed — the same breach and the
 * same `onBreach` that twenty seconds of held blade buys.
 */
export const SLICE = { find: 4.5, reach: 3.2, work: 9 };

/** The door under a designated point, or null. */
function sliceTarget(world, point) {
  if (!point) return null;
  let best = null, bestD = SLICE.find * SLICE.find;
  for (const d of world?.doors || []) {
    const at = d?.mesh?.position;
    if (!at || d.opened) continue;
    const dd = at.distanceToSquared(point);
    if (dd < bestD) { bestD = dd; best = d; }
  }
  return best;
}

/** ── TEND ───────────────────────────────────────────────────────────────
 *
 * "sends it to a designated downed body to work the bleed-out clock — turning
 *  'somebody is down' from a timer you race into a position you defend."
 *
 * `Reactions.startHeal` AND NOTHING ELSE. The design says the medical droid
 * "does not heal on a button: it reuses `findPatient` and `startHeal`", and
 * this is the same sentence with the patient named by you instead of found by
 * it. `stepReaction` is driven from `Enemy.update` for every body in the game,
 * a companion included, so the walk, the kneel at `heal.reach`, the give-up
 * rule ("he is no longer getting closer"), the green flicker and the PATCHED
 * UP line all arrive with the one call.
 *
 * THE BLEED-OUT CLOCK IS WORKED BY BEING THERE. `Enemy._tickDown` counts every
 * living body of the same side inside `DOWN_HELP` (2.2 m) as help and needs
 * `DOWN_REVIVE` body-seconds of it; `heal.reach` is 1.7 m, so a droid that has
 * knelt is inside the ring by half a metre. Nothing here touches the clock —
 * it stands where the game already says a man is being helped, and the game
 * does the rest. That is the difference between reusing the machinery and
 * writing a second medicine.
 *
 * IT KEEPS TRYING WHILE THE ORDER STANDS, which is what makes it a position
 * rather than an attempt: `stepHeal` ends a job at `heal.seconds` whether the
 * patient is up or not, and a downed man needs several of those. The order
 * ends when he is on his feet, when he is dead, or when you lift it.
 *
 * MEASURED, a man of yours put on the ground seven metres off with 14 s of
 * bleed left: the droid knelt at 1.39 m — inside `DOWN_HELP`'s 2.2 by three
 * quarters of a metre — and he was on his feet at 4.4 s with the quarter of
 * his health `DOWN_UP_HP` gives back. Not one line of that clock is written
 * here.
 *
 * AND THE MOVE WRAP HAD TO LEARN TO GET OUT OF THE WAY. Its station walk
 * writes `wish` every frame and `stepHeal` writes its own; measured with both
 * running, the droid's closest approach was 2.54 m and the man bled out. See
 * `if (e.reaction) return move(dt, ctx)` in the wrap — which is
 * `CommandDirector.steer`'s own first line, for a body with no Trooper.
 */

/** ── BOLT ───────────────────────────────────────────────────────────────
 *
 * "a panic run in a straight line that draws fire off you."
 *
 * TWO CLAIMS AND BOTH ARE MEASURED. The run is a station a long way off in one
 * direction, written into `stationFor`, so the move wrap drives it there with
 * everything `_move` already does — and the direction is chosen ONCE, at the
 * order, which is the whole of "in a straight line". A heading recomputed per
 * frame is a body that curves.
 *
 * THE FIRE IS `compelled` AGAIN — the same shipped override CRY uses, so there
 * is one answer in this file to "something is looking at the wrong thing" —
 * but pointed at a different population: only the hostiles that were ALREADY
 * ON YOU. CRY is a shout at everybody near the cat; this is a bolting animal
 * pulling the eyes that were on its owner, and the difference is exactly what
 * makes one of them bait and the other one an escape.
 *
 * AND IT WRITES NO SPEED OF ITS OWN. The pace cap is the mechanism the whole
 * protection loop rests on, so a panic verb that made the animal quick would
 * be the first thing in the file to sell a way out of it. The run is the move
 * wrap's ORDINARY station walk to a point a long way off — including the
 * catch-up trot every station order gets when the gap is past the leash, which
 * is not this verb's to widen or to invent. A panicking tauntaun is a tauntaun
 * at a tauntaun's speed, going somewhere else.
 *
 * MEASURED, four B1s at 10 m with all four shooting at the player: all four
 * switched to the tauntaun on the frame the order was given, and it covered
 * 23.6 m of ground in 91% of the metres it walked, 0° off the heading it
 * chose — the missing 9% is `_move`'s own wall slide and stuck commit, which
 * is the navigation doing its job rather than the run curving.
 */
export const BOLT = { run: 4.5, far: 70, pull: 30 };

/** ── CHARGE ─────────────────────────────────────────────────────────────
 *
 * "it bites what closes on you while you are riding, so you are not
 *  defenceless at a standstill."
 *
 * WHAT MAKES THIS DIFFERENT FROM WARD, WHICH IS THE QUESTION TO ANSWER FIRST.
 * WARD is a tripwire: anything inside the kind's ring OF YOU is met, and the
 * animal leaves to meet it. CHARGE never leaves. It takes only what is already
 * inside its own jaws' band — the archetype's `preferred` — so a shooter at
 * eight metres is not its problem and one at two metres is. That is the
 * mount's promise said precisely: you are on its back, you are not going
 * anywhere, and it deals with what arrives.
 *
 * `allows` IS THE WHOLE FILTER and it is one line, because `dutyAllows` is
 * already the one place an order narrows its own targeting. Nothing about the
 * brain, the move set or the bite changes: the blurrg's `lunge` comes off
 * BEAST_MOVES through `_beastBrain` exactly as it does when it is wild.
 *
 * AND WHEN SOMEBODY IS DRIVING IT, THE BRAIN DOES NOT RUN AT ALL.
 * `Enemy.update`'s `driven` branch returns before `_think` — "all this has to
 * do is not overwrite them" — so a ridden mount never reaches `_meleeBrain`
 * and a move started for it would never resolve. So the verb steps the beast
 * brain itself for exactly those frames, with the body's own target and its
 * own distance: the SAME function, called from the one tick that still runs,
 * rather than a second copy of a bite. Riding is not reachable today — no
 * companion row declares `crew`, so `Driving.whyNotDrive` refuses every mount
 * — and this is the line that will be right when it is.
 *
 * WHAT IS MEASURED IS THE HALF THAT IS REACHABLE: a blurrg under CHARGE took
 * 35 hp off a hostile that closed to 2.2 m and spent ZERO frames on one
 * standing at 9 m — which under WARD it would have crossed the ground for.
 */

/** ── CLIMB ──────────────────────────────────────────────────────────────
 *
 * "the only body in the game that takes a grade the player's own character
 *  controller refuses. It does not make the map faster, it makes the map a
 *  different shape."
 *
 * `A.grade` IS THE FIELD AND IT ALREADY DOES BOTH HALVES. Enemy.js's `_move`
 * reads it twice — once as a pace term over the top 45% of the limit, and once
 * as the flat refusal that stops a wheeled body stepping up onto a prop at all
 * — and its note says `grade >= 1` is "the one value that means anything". So
 * CLIMB is that value, held for as long as the order stands and PUT BACK when
 * it ends, and the walk itself is the ordinary station walk up a hill.
 *
 * WHAT THE PLAYER CANNOT DO IS THE OTHER HALF OF THE SENTENCE, and it is not
 * this file's to write: `Terrain.blockClimb` is the only thing in the game
 * that refuses a face, it is called from `Player._collide` and from nothing
 * else, and no body in `world.enemies` is subject to it. So the varactyl's
 * route genuinely exists the moment its body does, and the check drives both
 * ends of it — a face the player's own controller pushes him off, and an
 * animal under CLIMB that gains height on it.
 *
 * THE ARCHETYPE IS REWRITTEN AND NOT THE INSTANCE. `A` is shared between every
 * body of a kind, so `e.A.grade = 1` would give every varactyl on the field
 * the order; the clone is what `adopt` already does to hold the pace cap, for
 * the same reason.
 *
 * MEASURED on a face the fixture found by asking `blockClimb` itself — slope
 * 0.77, which it pushes the player back off — with the animal's own ceiling
 * set to 0.30: under CLIMB it reads 1 and the body gained 3.9 m of height on
 * that face, and the ceiling was 0.30 again the moment the order was lifted.
 */
export const CLIMB = { done: 2.5 };

/**
 * IS THIS BODY ALREADY IN ITS TEETH?
 *
 * The archetype's own `preferred` upper edge plus a step, so a bigger animal
 * reaches further and NOTHING here restates a distance — the massiff's jaws
 * band is [1.4, 2.6] and the blurrg's is [1.6, 3.0] because those two rows say
 * so. Two verbs read it, BLOCK and CHARGE, and both mean the same thing by it:
 * this animal holds a place and takes what arrives at the place.
 */
function inJaws(e, foe) {
  const band = (e.A?.preferred?.[1] ?? 2.6) + JAWS_STEP;
  return foe.position.distanceToSquared(e.position) <= band * band;
}

/** The step past the band. A body walking at 4 m/s covers 13 cm a frame, and a
 *  target the animal drops the moment it steps out of a hard edge is a body
 *  that flickers in and out of the brain twice a second. */
const JAWS_STEP = 1.2;

/**
 * WHAT EACH VERB LEAVES BEHIND ON THE BODY, AND WHY IT IS WRITTEN AT ALL.
 *
 * `_cmpBlocked`, `_cmpCried`, `_cmpFlat`, `_cmpRelayed`, `_cmpWrecked`,
 * `_cmpBreached`, `_cmpSpotted`, `_cmpSliced`, `_cmpDrew` — a running tally of
 * what the order actually did, on the animal it did it with. The pack already
 * keeps one of these (`lastKiller`, "for the epitaph") and the argument is the
 * same: a verb that changes the world leaves no trace on the world you can ask
 * a question of afterwards, and "did that order do anything" is the question
 * this whole table was written because nobody could answer.
 *
 * They are what `tools/checks/companions.mjs` and `tools/_cmpverbs.mjs`
 * MEASURE — a check that asserted "the crate is gone" without knowing whether
 * the pup broke it or a grenade did would pass on a build where the verb did
 * nothing, which is the defect wearing a green tick. They are also the fields a
 * companion card or an interlude line would read; nothing in the game reads
 * them yet and none of them is load-bearing for behaviour.
 */

const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();

export const COMPANION_VERBS = {

  block: {
    arg: 'none',
    refuse: (e) => (e._cmpOwner?.position ? null : 'there is nobody for it to stand in front of'),
    start(e) { installBlockGuard(e); },
    /**
     * IT INTERPOSES; IT DOES NOT CHARGE — and this is the clause that makes
     * the order work at all.
     *
     * Measured without it: the massiff was given BLOCK with one hostile at 9 m,
     * the aim wrap handed it that body (its sworn leash is 34 m), the move wrap
     * saw `busy` and stopped walking home, and the animal ended the order 9.2 m
     * from its owner — which is to say nowhere near between him and anything.
     * Ten bolts aimed at the player took 8 hp off the player and 0 off the dog.
     * A blocker that leaves is not a blocker.
     *
     * So BLOCK takes only what has come inside its own jaws, exactly as CHARGE
     * does, and for the same reason: the value of the order is the body being
     * in one particular place. The animal still meets what walks into it —
     * that is what the massiff's `grip` is for — and it stays on the line.
     */
    allows: (e, foe) => inJaws(e, foe),
    /* BETWEEN YOU AND THE NEAREST OF THEM, and back at your heel when there is
     * nothing to stand in front of — returning false is how a station hook
     * says "the ordinary one". */
    station(e, out) {
      const p = e._cmpOwner;
      if (!p?.position) return false;
      const foe = nearestHostile(e, p.position, BLOCK.see);
      if (!foe) return false;
      const dx = foe.position.x - p.position.x, dz = foe.position.z - p.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) return false;
      out.set(p.position.x + (dx / d) * BLOCK.hold, p.position.y, p.position.z + (dz / d) * BLOCK.hold);
      return true;
    },
  },

  cry: {
    arg: 'none',
    start(e) {
      const n = eachHostile(e, e.position, CRY.ring, (o) => {
        o.compelled = { target: e, t: CRY.hold };
      });
      e._cmpCried = n;
      e.world?.notifyFloating?.(e.position, 'HERE', '#ffd88a');
      if (n) {
        e.world?.notify?.(`${(e._cmpRec?.name || COMPANION_KINDS[e._cmpKind]?.label || 'IT').toUpperCase()} — BAIT`,
          `${n} of them are looking at it and not at you`);
      }
      /* A SHOUT, NOT A POSTURE. It is over the moment it is given and the
       * three seconds belong to the bodies it shouted at. */
      return 'done';
    },
  },

  flush: {
    arg: 'body',
    tick(e) {
      const foe = e._cmpBidden;
      if (!foe || foe.dead) return 'done';
      const r = flushReach(e);
      if (e.position.distanceToSquared(foe.position) > r * r) return undefined;
      _v5.subVectors(foe.position, e.position).setY(0);
      if (_v5.lengthSq() < 1e-6) _v5.set(0, 0, 1);
      _v5.setY(FLUSH.lift).normalize().multiplyScalar(FLUSH.shove);
      /* AND A FALL IT CANNOT TAKE ENDS THE ORDER RATHER THAN STANDING FOREVER.
       * `knockFlat` refuses a boss, anything `big`, and a body already limp,
       * held or being carried — every one of those is a reason this whelp is
       * never going to put that thing down, and its own return value is the
       * only reader of them. "Point it at a B2 and you have thrown it away" is
       * the design's line; a whelp standing in front of a spider droid trying
       * forever is not that lesson, it is a stuck order. */
      if (!foe.knockFlat(_v5, e)) {
        e.world?.notifyFloating?.(e.position, 'NO', '#ff9a3a');
        return 'done';
      }
      foe.velocity?.add(_v5);
      e.world?.notifyFloating?.(foe.position, 'FLAT', '#ffd88a');
      e._cmpFlat = (e._cmpFlat || 0) + 1;
      return 'done';
    },
  },

  relay: {
    arg: 'friend',
    refuse(e, arg) {
      const d = e.world?.command;
      if (!d) return 'there is nobody under your command to carry it to';
      if (!d.formation) return 'you have given no order for it to carry';
      if (!arg?.position || arg.dead) return 'nothing of yours under your reticle';
      return null;
    },
    station(e, out) {
      const m = e._cmpMate;
      if (!m?.position || m.dead) return false;
      out.copy(m.position);
      return true;
    },
    tick(e) {
      const m = e._cmpMate, d = e.world?.command;
      if (!m || m.dead || !d) return 'done';
      if (e.position.distanceToSquared(m.position) > RELAY.deliver * RELAY.deliver) return undefined;
      const c = d.commanderOf?.(m) || d.commander;
      const was = d._carrying;
      let ok = false;
      d._carrying = e;
      try { ok = !!d.order(d.formation, c, m.cmdSquad ?? null); } finally { d._carrying = was; }
      e._cmpRelayed = ok;
      e.world?.notify?.(ok ? 'ORDER DELIVERED' : 'IT GOT THERE AND THEY WOULD NOT',
        ok ? 'it carried it further than your voice goes' : (d.orderRefused || 'refused'));
      return 'done';
    },
  },

  wreck: {
    arg: 'point',
    refuse: (e, arg) => (coverAt(e.world, arg) ? null : 'there is nothing there it can put through the floor'),
    start(e, arg) { e._cmpCover = coverAt(e.world, arg); e._cmpVerbT = 0; },
    station(e, out) {
      const c = e._cmpCover;
      if (!c) return false;
      out.copy(c.centre);
      return true;
    },
    tick(e, dt) {
      const c = e._cmpCover;
      if (!c) return 'done';
      if (c.gone()) return 'done';
      if (e.position.distanceToSquared(c.centre) > WRECK.reach * WRECK.reach) return undefined;
      e._cmpVerbT = (e._cmpVerbT || 0) - dt;
      if (e._cmpVerbT > 0) return undefined;
      e._cmpVerbT = WRECK.beat;
      _v5.subVectors(c.centre, e.position).setY(0);
      if (_v5.lengthSq() > 1e-6) _v5.normalize(); else _v5.set(0, 0, 1);
      /* THE BLOW LANDS BETWEEN THE TWO OF THEM and not at the piece's centre,
       * which for a wall is inside the wall: `damageSphere` falls off with
       * distance from the point it is given. */
      _v6.copy(e.position).addScaledVector(_v5, Math.min(WRECK.reach, WRECK_BITE_R));
      c.hit(WRECK.bite, _v5, _v6);
      e._cmpWrecked = (e._cmpWrecked || 0) + 1;
      e.world?.particles?.sandPuff?.(_v6.clone(), 1.8,
        e.world.terrain?.height(_v6.x, _v6.z), e.world.groundColor);
      return c.gone() ? 'done' : undefined;
    },
  },

  breach: {
    arg: 'point',
    refuse: (e, arg) => (coverAt(e.world, arg) ? null : 'there is nothing there for it to take apart'),
    start(e, arg) { e._cmpCover = coverAt(e.world, arg); },
    station(e, out) {
      const c = e._cmpCover;
      if (!c) return false;
      out.copy(c.centre);
      return true;
    },
    tick(e) {
      const c = e._cmpCover;
      if (!c || c.gone()) return 'done';
      if (e.position.distanceToSquared(c.centre) > BREACH.reach * BREACH.reach) return undefined;
      _v5.subVectors(c.centre, e.position).setY(0);
      if (_v5.lengthSq() > 1e-6) _v5.normalize(); else _v5.set(0, 0, 1);
      c.tear(_v5, c.centre);
      e._cmpBreached = true;
      e.world?.notifyFloating?.(c.centre, 'DOWN', '#ffd88a');
      return 'done';
    },
  },

  spot: {
    arg: 'none',
    start(e) {
      e._cmpVerbT = SPOT.hold;
      e._cmpBeat = 0;
      e._cmpSpotted = 0;
      /* IT CLIMBS, if it is a body that flies. See the note above. */
      if (e._flightState === 'stoop') e._flightState = 'cruise';
    },
    tick(e, dt) {
      e._cmpVerbT = (e._cmpVerbT ?? SPOT.hold) - dt;
      e._cmpBeat = (e._cmpBeat || 0) - dt;
      if (e._cmpBeat <= 0) {
        e._cmpBeat = SPOT.beat;
        const from = (verbOwnerUp(e) ? e._cmpOwner.position : e.position);
        e._cmpSpotted = eachHostile(e, from, SPOT.ring, (o) => {
          _v5.copy(o.position).setY(o.position.y + (o.A?.hipHeight ?? 0.95) + 0.9);
          e.world?.notifyFloating?.(_v5, o.A?.label ? o.A.label.toUpperCase() : 'CONTACT', '#a8f0ff');
        });
      }
      return e._cmpVerbT <= 0 ? 'done' : undefined;
    },
  },

  slice: {
    arg: 'point',
    refuse: (e, arg) => (sliceTarget(e.world, arg) ? null : 'there is nothing there it can turn'),
    start(e, arg) { e._cmpCover = sliceTarget(e.world, arg); e._cmpVerbT = SLICE.work; },
    station(e, out) {
      const d = e._cmpCover;
      if (!d?.mesh?.position) return false;
      out.copy(d.mesh.position);
      return true;
    },
    tick(e, dt) {
      const d = e._cmpCover;
      if (!d) return 'done';
      if (d.opened) return 'done';
      if (e.position.distanceToSquared(d.mesh.position) > SLICE.reach * SLICE.reach) return undefined;
      e._cmpVerbT = (e._cmpVerbT ?? SLICE.work) - dt;
      if (e._cmpVerbT > 0) return undefined;
      d.breach();
      e._cmpSliced = true;
      return 'done';
    },
  },

  tend: {
    arg: 'friend',
    refuse(e, arg) {
      if (!arg?.position || arg.dead) return 'nothing of yours under your reticle';
      if (!arg.downed && (arg.hp ?? 0) >= (arg.maxHp ?? 0)) return 'there is nothing wrong with him';
      return null;
    },
    tick(e) {
      const m = e._cmpMate;
      if (!m || m.dead) return 'done';
      if (!m.downed && (m.hp ?? 0) >= (m.maxHp ?? 0)) return 'done';
      if (!e.reaction) startHeal(e, m);
      return undefined;
    },
    /* THE JOB IS DROPPED WHEN THE ORDER IS. `_medicOn` is `startHeal`'s claim
     * on the patient and a claim nobody released is a man no other medic will
     * ever go to. */
    stop(e) {
      if (e.reaction?.kind === 'heal') {
        if (e.reaction.patient?._medicOn === e) e.reaction.patient._medicOn = null;
        e.reaction = null;
        e.crouch = 0;
      }
    },
  },

  bolt: {
    arg: 'none',
    start(e) {
      /* AWAY FROM WHATEVER IS NEAREST, and failing that away from you — a
       * panic run has to go somewhere and "somewhere" is not toward the thing
       * that caused it. Chosen ONCE: that is the straight line. */
      const foe = nearestHostile(e, e.position, BOLT.pull);
      const from = foe?.position || (verbOwnerUp(e) ? e._cmpOwner.position : null);
      _v5.set(0, 0, 0);
      if (from) _v5.subVectors(e.position, from).setY(0);
      if (_v5.lengthSq() < 1e-6) _v5.set(Math.cos(e.facing || 0), 0, Math.sin(e.facing || 0));
      _v5.normalize();
      e._cmpPoint = new THREE.Vector3().copy(e.position).addScaledVector(_v5, BOLT.far);
      e._cmpVerbT = BOLT.run;
      /* AND THEIR EYES COME WITH IT — only the ones that were on YOU. */
      const p = e._cmpOwner;
      e._cmpDrew = p ? eachHostile(e, p.position, BOLT.pull, (o) => {
        if (o.target !== p && o.compelled?.target !== p) return false;
        o.compelled = { target: e, t: BOLT.run };
      }) : 0;
    },
    /* THE RUN POINT IS THE STATION, so the move wrap drives it there with the
     * wall slide, the stuck commit and the grade limit all still applying. */
    station(e, out) {
      if (!e._cmpPoint) return false;
      out.copy(e._cmpPoint);
      return true;
    },
    /* A PANIC RUN DOES NOT STOP TO FIGHT. */
    allows: () => false,
    tick(e, dt) {
      e._cmpVerbT = (e._cmpVerbT ?? BOLT.run) - dt;
      return e._cmpVerbT <= 0 ? 'done' : undefined;
    },
    stop(e) { e._cmpPoint = null; },
  },

  charge: {
    arg: 'none',
    /* ONLY WHAT IS ALREADY IN ITS JAWS' BAND — the archetype's own `preferred`
     * upper edge, so a mount with a longer reach bites further and nothing
     * here restates a distance. */
    allows: (e, foe) => inJaws(e, foe),
    tick(e, dt) {
      const t = e.target;
      if (!t || t.dead) return undefined;
      /* IT DOES NOT WAIT ITS TURN. `attackTimer` is the brain's own pause
       * between blows; a mount that has something in its teeth takes it. */
      if (e.attackTimer > 0 && e.state === 'approach') e.attackTimer = 0;
      /* AND WHEN SOMEBODY IS DRIVING, THE BRAIN NEVER RAN THIS FRAME. See the
       * note above: the same function, called from the one tick that still
       * runs. */
      if (e.driven && typeof e._beastBrain === 'function') {
        const ctx = e.world?._frameCtx;
        if (ctx) e._beastBrain(dt, ctx, e.position.distanceTo(t.position));
      }
      return undefined;
    },
  },

  climb: {
    arg: 'point',
    refuse: (e, arg) => (arg?.isVector3 ? null : 'no ground under your reticle'),
    start(e) {
      /* THE ARCHETYPE IS CLONED, never written through — see the note. */
      if (e.A && e._cmpGrade === undefined) {
        e._cmpGrade = e.A.grade ?? null;
        e.A = { ...e.A, grade: 1 };
      }
    },
    station(e, out) {
      if (!e._cmpPoint) return false;
      out.copy(e._cmpPoint);
      return true;
    },
    /**
     * ARRIVAL IS MEASURED IN THREE DIMENSIONS, and the plan distance is the
     * whole reason why.
     *
     * Written as `hypot(dx, dz)` this called the job done the moment the
     * animal was ABOVE OR BELOW the point rather than at it — which on the one
     * kind of ground this verb exists for is exactly what happens. Measured:
     * a varactyl sent at a 76° face walked into the hollow at its foot, ended
     * 1.7 m from the point in plan and 7.4 m under it, and the order ended
     * having climbed nothing. A verb about HEIGHT cannot measure arrival with
     * the height thrown away.
     */
    tick(e) {
      const at = e._cmpPoint;
      if (!at) return 'done';
      return at.distanceTo(e.position) <= CLIMB.done ? 'done' : undefined;
    },
    stop(e) {
      if (e._cmpGrade === undefined) return;
      if (e.A) e.A = { ...e.A, grade: e._cmpGrade ?? undefined };
      e._cmpGrade = undefined;
    },
  },
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  1. THE TWO WRAPS                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

/**
 * WHO THIS BODY IS ALLOWED TO FIGHT, ASKED OF THE WORLD.
 *
 * `Levy.js`'s note applies here word for word: an instrument that restates a
 * rule eventually disagrees with it. `_hostilesFor` is the shipped answer to
 * "everything one body on this field is opposed to", it already excludes the
 * dead, the downed and its own team, and it is what the director itself falls
 * back to. Nothing here re-implements the question.
 */
function installCompanionAim(e) {
  if (e._companionAim) return;
  e._companionAim = true;
  const think = e._think.bind(e);
  e._think = function (dt, ctx) {
    const pick = ctx.pickTarget;
    /* SUBSTITUTED FOR THE LENGTH OF ONE SYNCHRONOUS CALL and put back in a
     * `finally` — `_think` is a straight line with no awaits, no events and no
     * callbacks, so nothing else can observe the swap. Levy.js:336 argues this
     * at length and this is the same trade. */
    ctx.pickTarget = (b) => {
      if (b !== e) return pick(b);
      const w = e.world;
      if (!w?._hostilesFor) return pick(b);
      let best = null, bestD = Infinity;
      const leash = (e._cmpLeash ?? LEASH);
      /* THE ORDER FIRST, IF THERE IS ONE AND IT IS STILL ALIVE. A companion
       * told to take a body takes THAT body, which is the whole of "attacking
       * a specific enemy that you target". */
      /**
       * THE LEASH IS ON ITS FEET, NOT ON ITS EYES, AND THE OTHER WAY ROUND
       * COST THE ANIMAL ITS WHOLE FIGHT.
       *
       * The first version of this returned null the moment the companion was
       * dragged past the leash, on the reasoning that a body which keeps its
       * target fights its own steering. It does not: the move wrap below
       * overrides the wish outright when `dragged`, so the pull home was never
       * contested. What the null actually did was stop the brain.
       *
       * `Enemy._brain` returns on `if (!target)` before it ever reaches
       * `_meleeBrain`, so a creature with no target is a creature whose state
       * machine is NOT SERVICED — `stateTime` goes on climbing (Enemy.js:6175)
       * and nothing reads it. Measured over one minute of the kill test: the
       * animal froze mid-`lunge` with no target and stayed there, and a
       * `winded` window that is 2.4 seconds long lasted TWELVE — from t=5 s to
       * t=17 s, a fifth of the minute, standing still. It dealt 0 damage in
       * 0 blows while getting to within 0.2 m of something it was hunting.
       *
       * The leash it actually needs is the one below: the search is measured
       * from the STATION, so a hostile out of reach of where the animal is
       * supposed to be is never a target in the first place, and the walk home
       * is the move wrap's job. Nothing here returns null that `_hostilesFor`
       * would not have returned null for.
       */
      /* THE ORDER FIRST, IF IT NAMED A BODY. A companion told to take that one
       * takes THAT one, which is the whole of "attacking a specific enemy that
       * you target" — and `dutyAllows` refuses everything else under SEEK, so
       * a seek is a seek and not a preference. */
      const bid = e._cmpBidden;
      if (bid && !bid.dead && bid.team !== e.team) return bid;
      /* KEPT ON A LEASH ROUND ITS STATION AND NOT ROUND ITSELF. A companion
       * that chased the nearest hostile would walk itself out of the fight one
       * body at a time; measuring from where it is SUPPOSED to be is what
       * keeps it beside you. `stationFor` is that one place — the same
       * function the move wrap walks it home to, so the two can never disagree
       * about where "supposed to be" is. */
      const home = stationFor(e, _v3);
      for (const o of w._hostilesFor(e)) {
        if (!dutyAllows(e, o, home, leash)) continue;
        const d = o.position.distanceToSquared(home);
        if (d < bestD) { bestD = d; best = o; }
      }
      return best;
    };
    try { return think(dt, ctx); } finally { ctx.pickTarget = pick; }
  };
}

/**
 * WHERE IT WANTS TO BE, WRITTEN AFTER THE BRAIN AND BEFORE THE MOVE.
 *
 * The only slot between `_think` and `_move` is an instance wrap of `_move`
 * itself, and two shipped subsystems already take it — `Flight.js:440` and
 * `Command.js:4809`, whose note says why it is the right one: the wrapper
 * steers FIRST and calls the original SECOND, so everything `_move` already
 * does — the wall slide, the stuck commit, the backpedal limit, the
 * acceleration ramp, the grade limit, the support query — applies to a
 * companion exactly as it applies to a charge. A formation is not a different
 * movement model; it is a different destination for the same one.
 *
 * `_think` returning a null wish is harmless, because this runs after it and
 * base `_move` consumes the wish after that.
 */
function installCompanionMove(e) {
  if (e._companionMove) return;
  e._companionMove = true;
  const move = e._move.bind(e);
  e._move = function (dt, ctx) {
    /**
     * ITS JAWS TRACK WHAT THEY ARE BITING, BECAUSE WHAT IT BITES CANNOT READ
     * THE TELEGRAPH — and this is the fourth thing a companion is the first
     * body in the game to need.
     *
     * `hitTarget` resolves a creature's blow against `swingAt`: the point the
     * target stood on when the wind-up began, tested against a footprint of
     * `M.reach × A.scale`. Enemy.js argues that at length and the argument is
     * right — it is what makes a telegraphed attack DODGEABLE, and it was
     * measured against a real player breaking sideways. Every word of it is
     * about a player.
     *
     * A B1 is not dodging. It is walking, at about 4 m/s, and a massiff's
     * lunge remembers its point half a second before the claw arrives — so the
     * droid is 2 m away from a 0.71 m footprint through no decision of its
     * own. Measured on the kill test: sixty seconds, a target for 46% of them,
     * closest approach 0.2 m, and ZERO blows landed. Wild creatures never hit
     * this because a wild creature fights the player from the frame it spawns;
     * a companion is the first beast in the game whose whole job is fighting
     * NPCs.
     *
     * So the remembered point is refreshed while the blow is still in flight,
     * for a target that is not a player. A player keeps the dodge exactly as
     * Enemy.js designed it — in co-op and versus, where a companion's hostile
     * CAN be a player, footwork still beats the animal. `_swiped` is the
     * engine's own "the blow has landed" latch, so nothing is re-aimed after
     * the fact, and the moves that aim at the animal itself (`aim: 'self'`)
     * never read this field at all.
     *
     * The player test is `isLocal !== undefined`, which is `Extraction.js`'s
     * own — one idiom for "this body is somebody playing".
     */
    {
      const t = e.target;
      if (e.swingAt && t && !t.dead && !e._swiped && t.isLocal === undefined) {
        e.swingAt.copy(t.position);
      }
    }
    /**
     * A COMPANION WORKING ON SOMEBODY IS NOT ALSO WALKING HOME.
     *
     * `CommandDirector.steer` opens with `if (e.reaction) return;` and its note
     * is the whole argument: "everything below writes `wish`, `speed` and
     * `crouch` from the slot he is supposed to be standing in, and a body that
     * has just thrown itself flat would be walked back into the line while it
     * lay there." This wrap is that same code for a body with no Trooper, so
     * it owes the same deference — and it owes it to its own verb as well:
     * TEND is `Reactions.startHeal`, which walks the droid to the patient and
     * kneels it at 1.7 m, and a station walk written over the top of that is a
     * medic sliding away from the man he is working on.
     *
     * `_move` and `_pose` still run, which is what makes the body travel and
     * animate while the reaction owns it.
     */
    if (e.reaction) return move(dt, ctx);
    let was = null;
    const p = e._cmpOwner;
    const owned = !!(p && p.alive !== false && !p.dead && p.position);
    /**
     * AN OWNER WHO IS DOWN LEAVES IT STANDING WHERE HE FELL, AND THIS IS THE
     * ONE BRANCH THE KILL TEST FOUND BY DYING.
     *
     * Written as `if (owner) … ` and nothing else, the station is simply not
     * updated on a frame where the owner is gone — so `_cmpHome` keeps the
     * last point it was written at, forever. Everything downstream then reads
     * a ghost: the wish is never rewritten, the leash in the aim wrap measures
     * hostiles from a spot nobody is standing on, and the animal stands still
     * with its own speed decaying to zero while the fight goes on around it.
     * Measured on the kill test's own minute — the player died at 24.5 s and
     * the remaining 35 s recorded an animal 33.7 m from a station it thought
     * was 8.5 m away, at 0.000 m of movement a frame.
     *
     * Standing its ground is the answer and it is also the right one to read
     * on the field: the station becomes WHERE IT IS, so the leash still binds
     * — around itself now instead of around you — and it goes on taking
     * anything that comes inside it. A dog over a body, not a statue.
     */
    if (!owned) {
      e._cmpHome = (e._cmpHome || new THREE.Vector3()).copy(e.position);
    }
    /* HOLD IS THE ONE ORDER WITH NO OWNER IN IT. A companion standing on
     * ground you gave it keeps its station whether you are alive, dead, or
     * three hundred metres away — which is exactly what makes it the last
     * rung, and it is why this is tested before `owned` rather than inside it.
     * The branch above (an owner who is down) must not overwrite a held
     * point with wherever the animal happens to be standing. */
    const held = e._cmpDuty?.id === 'hold' && e._cmpPoint;
    if (owned || held) {
      /* THE STATION, from the one function both wraps read — see
       * `stationFor`. Two readers with two ideas of where it is supposed to be
       * would be a companion that hunts round one place and walks to another. */
      stationFor(e, _v1);
      e._cmpHome = (e._cmpHome || new THREE.Vector3()).copy(_v1);
      const dx = _v1.x - e.position.x, dz = _v1.z - e.position.z;
      const d = Math.hypot(dx, dz);
      /* IT ONLY WALKS HOME WHEN IT HAS NOTHING BETTER TO DO, or when it has
       * been dragged past the leash. A companion that abandoned a body it was
       * biting because you took a step would never finish anything. */
      const busy = !!e.target && !e.target.dead;
      /* HOW LOOSELY THIS KIND HOLDS ITS STATION. A tuk'ata ranges and a tooka
       * clings, and `heel` is the row that says which — a multiple of the
       * shared slack rather than a second distance, so the two cannot drift
       * apart. Read here because this is the one place a station becomes a
       * decision to walk. */
      const slack = HEEL.slack * (COMPANION_KINDS[e._cmpKind]?.heel ?? 1);
      /* THE TEMPERS MOVE THIS AND NOTHING ELSE. `reach` is metres it will
       * break from station to take a body; `recall` is how much sooner it
       * gives up and comes home. Both are read off the record through the one
       * summing function rather than added up here — see `temperSwing`. */
      const sw = e._cmpSwing;
      const leashNow = Math.max(2, (e._cmpLeash ?? LEASH) + (sw ? sw.reach - sw.recall : 0));
      const dragged = d > leashNow;
      if (dragged || !busy) {
        if (d > SETTLED * slack) {
          e.wish = (e.wish || new THREE.Vector3()).set(dx / d, 0, dz / d);
          if (!e.toTarget) e.toTarget = new THREE.Vector3();
          e.toTarget.copy(e.wish);
          /* A TROT HOME, NOT A SPRINT. It is meant to be slower than you —
           * this only lets it close a gap you opened at a walk, and it is the
           * archetype's own speed rather than a second number. */
          const want = (e.A?.speed ?? 4) * (dragged ? 1.25 : 1);
          if (want > e.speed) { was = e.speed; e.speed = want; }
        } else if (!busy) {
          e.wish = null;
        }
      }
    }
    /**
     * AND THE PACE GOES BACK, which `CommandDirector.steer` also does and for
     * the reason its note gives: a catch-up speed written and not restored
     * compounds with everything else that scales speed. Measured before this,
     * over one minute of the kill test, the companion's `speed` climbed 5.8 →
     * 6.3 → 6.5 and never came down — a dog that gets permanently faster every
     * time you walk away from it.
     */
    try { return move(dt, ctx); } finally { if (was !== null) e.speed = was; }
  };
}

/**
 * YOUR OWN BLADE DOES NOT TAKE YOUR OWN ANIMAL APART.
 *
 * `World._resolveBlades` hands the solver every living enemy near the blade —
 * with one guard, for a stick riding down with you — and nothing on that path
 * asks `canHarm`. That is right for what it was written for: your blade IS
 * dangerous to the men around you, and `installTeamDamage` scales what lands
 * so a brush costs a trooper a slice rather than his life.
 *
 * `takeCut` is the hole. It subtracts from `hp` DIRECTLY — the note on its own
 * line says why, so that a sever can open the winded window — so the
 * friendly-fire scaling every ally has never sees it, and a cut the solver
 * calls vital is `maxHp * 2`. Measured on the kill test with friendly fire OFF
 * and `canHarm(player, dog)` answering FALSE: the animal lost 420 hp in a
 * single frame at t=12.53 s, from 144 to -276, killed by a player who was not
 * attacking — walking a circle with a lit blade while the dog crossed behind
 * him to reach a droid.
 *
 * So the companion answers the gate the rest of the game answers. Friendly
 * fire off — the default, and every mode where the roster exists — and your
 * blade passes through it. Friendly fire on, which the player turned on
 * deliberately, and it cuts exactly as it cuts anything else. One rule, read
 * rather than restated, and the slider already in the menu is its switch.
 *
 * A WRAP AND NOT A LINE IN `_resolveBlades`, for the reason the header gives:
 * the whole feature is built so that World.js does not learn the word
 * companion. The guard belongs to the body that needs it.
 */
function installCompanionHide(e) {
  if (e._companionHide) return;
  e._companionHide = true;
  /**
   * BOTH PATHS, BECAUSE THE BLADE HAS TWO AND ONLY ONE OF THEM SEVERS.
   *
   * Stopping `takeCut` alone left the grind — `_applyBladeEvent`'s ordinary
   * contact damage, which goes through `damage()` — and that path is not
   * gated either. Measured with the sever blocked and nothing else changed:
   * the same idle circuit put 249 damage into the animal over 17 contacts and
   * still killed it inside the minute.
   *
   * `canHarm` in `damage` is a no-op for everything else that can reach this
   * body — bolts, powers and explosions all consult it before they call —
   * so what this actually gates is the one path that does not.
   */
  const cut = e.takeCut.bind(e);
  e.takeCut = function (ev, source) {
    if (source && source !== e && !canHarm(source, e, e.world?.rules)) return null;
    return cut(ev, source);
  };
  const hurt = e.damage.bind(e);
  e.damage = function (amount, point, source, kind) {
    if (source && source !== e && !canHarm(source, e, e.world?.rules)) return false;
    /**
     * THE FRAGILE KINDS ARE FRAGILE LEGIBLY.
     *
     * `frag` multiplies incoming damage from AREA sources ONLY — a grenade, a
     * quake, a blast, a fall — and NEVER from aimed fire. That asymmetry is
     * the whole design of the field: a tooka dies to a thermal you did not
     * see; it does not die to the bolt you were supposed to have blocked.
     *
     * It keeps every death explicable, which is SCOPE warning 1's actual
     * requirement — a death the player cannot account for is a death they
     * blame on the AI. A flat fragility multiplier would make the tooka die to
     * things you WERE watching, and then losing it reads as the game cheating
     * rather than as a thermal you did not see.
     */
    const K = COMPANION_KINDS[e._cmpKind];
    let amt = amount;
    if (K && K.frag !== 1 && AREA_KINDS.has(kind)) amt = amount * K.frag;
    /**
     * AND IT IS NOT SILENT WHEN YOU ARE THE ONE WHO DID IT.
     *
     * `installTeamDamage` catches blade, bolt, blast, fall and lightning at
     * the one door and scales what lands — but it only SHOUTS through
     * `this.commandOf`, which a companion deliberately does not have, and
     * `onFriendlyHit` opens `if (!e.trooper) return;` anyway. So cutting your
     * own dog was completely silent, in both directions.
     *
     * This is the single most memorable thing the whole feature can produce
     * and it must not happen without the game saying so — by the NAME you gave
     * it, which is the entire reason a companion has one.
     *
     * THROTTLED, because a blade in contact is a damage call a frame and a
     * notice a frame is a scrolling wall rather than a fact.
     */
    if (amt > 0 && source && source !== e && source.team === e.team) {
      const now = e.world?.elapsed ?? 0;
      if (now - (e._cmpYelp || -9) > YELP_GAP) {
        e._cmpYelp = now;
        const who = e._cmpRec?.name || K?.label || 'your companion';
        e.world?.notifyFloating?.(e.position, who.toUpperCase(), '#ffd88a');
        e.world?.notify?.(`${who.toUpperCase()} — THAT WAS YOU`,
          'it is on your side, and it does not know to get out of the way');
      }
    }
    /* WHO GOT IT, FOR THE EPITAPH. Written on every hit rather than on the
     * fatal one, because the fatal one often has no source at all — a bleed-out
     * on the ground is nobody's, and "killed by nothing" is not a line worth
     * keeping on a wall. */
    if (amt > 0 && source && source !== e && source.team !== e.team) {
      const pack = e.world?._companions;
      if (pack) pack.lastKiller = source.A?.label || source.name || null;
    }
    return hurt(amt, point, source, kind);
  };
}

/**
 * WHAT COUNTS AS AN AREA WEAPON, for `frag`. The four `kind` strings the
 * damage paths already pass for something that went off rather than something
 * that was aimed — read rather than restated, so a fifth added to the game is
 * a line here and not a silent hole in every fragile companion's one rule.
 */
const AREA_KINDS = new Set(['blast', 'grenade', 'quake', 'fall']);

/** How long between two "that was you" notices about the same animal. */
const YELP_GAP = 4;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  2. THE PACK                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * A `world.props` entry, in the shape `RiderPack` and `FlightPack` already use.
 *
 * It adopts on a scan of `world.enemies` rather than at a spawn call site, for
 * the reason `Riders.js` gives: there are several doors a body can come into
 * the world through, and a pack that hooked one of them would miss the rest.
 * `capsules()` returns nothing so the blade solver is never offered a contact
 * on the pack itself — the companion is already in the target list on its own
 * account.
 */
export class CompanionPack {
  constructor(world) {
    this.world = world;
    this.id = 'companions';
    this.dead = false;
    this.grippable = false;
    this.kind = 'companions';
    this.toughness = Infinity;
    this.hp = Infinity;
    this.seen = new WeakSet();
    this.list = [];
    /** Did it get on the ship? See the note in `update`. */
    this.aboard = false;
    /** Who last hurt it, for the epitaph. Written by the damage wrap. */
    this.lastKiller = null;
    /**
     * THE STUB BODY, AND IT IS NOT OPTIONAL. `World._resolveBlades` walks
     * `this.props` and reads `pr.body.position` BEFORE it asks for capsules,
     * so a pack without one throws on the first frame a blade is out. Copied
     * from `RiderPack`, which pays for the same contract for the same reason —
     * a pack is a tick, not an object in the world, and this is what says so.
     */
    this.body = {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
      boundingRadius: 0, mass: 0, invMass: 0, static: true,
      applyImpulse() {}, wake() {},
    };
    this.mesh = null;
  }

  /* Nothing is offered to the blade solver: the companion is already in the
   * target list on its own account, as an Enemy. */
  capsules(out = []) { out.length = 0; return out; }
  cut() { return []; }
  shatter() {}
  damage() { return false; }

  /** Take a body into the pack: it belongs to `owner` from now on. */
  adopt(e, owner, opts = {}) {
    if (!e || this.seen.has(e)) return e;
    this.seen.add(e);
    e._cmpOwner = owner;
    e._cmpSide = opts.side ?? 1;
    /**
     * THE RECORD IS WHAT MAKES IT THIS ANIMAL AND NOT ONE OF ITS KIND.
     *
     * `_cmpKind` is the row (what it can do), `_cmpRec` is the Kennel record
     * (what it has done). Both are hung on the body rather than looked up
     * through the pack, because the two wraps run inside `_think` and `_move`
     * on a hot path and neither should have to search a list to answer a
     * question about the body it is already holding.
     *
     * THE LEASH COMES OFF THE RUNG, and the rung comes off the record's xp. A
     * companion with no record — the sandbox's, the dojo's, a check's — reads
     * the bottom rung, which is the honest default: nothing it has not earned.
     */
    const K = COMPANION_KINDS[opts.kind || e.A?.companionKind || ''] || null;
    e._cmpKind = K?.id || null;
    e._cmpRec = opts.rec || null;
    e._cmpSwing = temperSwing(opts.rec);
    e._cmpLeash = opts.leash ?? rungOf(opts.rec).leash;
    /* THE PACE CAP, APPLIED HERE AND NOWHERE ELSE. `paceOf` clamps a row to
     * 0.85 of the player's sprint on the way out, so no rung, temper, phase or
     * setting can produce a companion that outruns you — which is the whole
     * mechanism the protection loop rests on. Written over the archetype's own
     * `speed` because `Enemy` rolls a ±10% spread into `this.speed` at :3146
     * and a spread on top of a cap is a cap that is exceeded one body in two. */
    if (K) {
      const cap = paceOf(K.id);
      e.speed = Math.min(e.speed ?? cap, cap);
      if (e.A) e.A = { ...e.A, speed: Math.min(e.A.speed ?? cap, cap) };
    }
    e.companion = true;
    installCompanionAim(e);
    installCompanionMove(e);
    installCompanionHide(e);
    this.list.push(e);
    return e;
  }

  /** Give it a body to take, or clear the order. */
  bid(e, target) { if (e) e._cmpBidden = target || null; }

  update(dt = 1 / 60) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e || e.dead || e.disposed) { this.list.splice(i, 1); continue; }
      /* A BID ON A BODY THAT IS GONE IS NOT AN ORDER ANY MORE. Cleared here
       * rather than in the aim wrap so the wrap stays a pure reader. */
      if (e._cmpBidden && (e._cmpBidden.dead || e._cmpBidden.disposed)) e._cmpBidden = null;
      /**
       * DID IT GET ON THE SHIP — the flag the whole fold turns on.
       *
       * `Extraction.manifest` is `this._seated.map((b) => b.trooper).filter
       * (Boolean)`, so a companion boards the transport and then does not
       * exist on the list that decides who survived. That one `filter(Boolean)`
       * is the entire gap between "the companion got on the ship" and "the
       * companion is there next run", and `Company.keep` reads exactly that
       * array and may not be reopened. So the manifest is left BYTE-IDENTICAL
       * and the pack keeps its own flag.
       *
       * A POLL AND NOT AN `onPhase` SUBSCRIPTION, which the design proposed.
       * Two things make the poll better rather than merely easier: the
       * extraction is built long after the pack is, so a subscription needs a
       * hook that fires on an object that does not exist yet; and `onPhase`
       * fires on the SHIP's lifecycle while what the fold needs to know is
       * about the BODY — a companion that is put ashore again, or that never
       * queued, is answered here by reading it, and would need a second
       * handler there to unset what the first one set.
       *
       * `_extracting` is Extraction's own field and is one of three strings —
       * 'boarding', 'aboard', 'left' — read rather than restated. It survives
       * the ship leaving, which is exactly what the fold reads it for.
       */
      if (e._extracting === 'aboard' || e.riding) this.aboard = true;
      else if (e._extracting === 'left') this.aboard = false;
      /**
       * AND `underFire` COMES BACK DOWN, which for a body outside a squad it
       * never does.
       *
       * `installTeamDamage` WRITES it — every injury goes through that one
       * door, which is why the companion gets it for free — and it is DECAYED
       * in exactly one place: `CommandDirector._troops`' walk over
       * `squadsOf(c)`. A companion is deliberately in no squad, so the flag
       * latches at UNDER_FIRE and stays there for the rest of the level.
       *
       * What that costs, on a body that reads it: `_coverSite` puts a body
       * that is under fire into cover-seeking with a lean, off a `_fireEpoch`
       * that only advances when the spell ENDS. A companion whose spell never
       * ends is a companion permanently hunting cover from a shot it took two
       * minutes ago, and one whose epoch never advances hunts the same crate
       * for the whole run.
       *
       * Two lines, in the pack's own tick, and ZERO lines in Command.js — the
       * decay is the director's for a trooper and the pack's for its own body,
       * which is the same split the whole feature is built on.
       */
      if (e.underFire > 0) e.underFire = Math.max(0, e.underFire - dt);
      /**
       * AND THE CLOCK KEEPS RUNNING ON AN ANIMAL WITH NOTHING TO FIGHT.
       *
       * `Enemy._brain` returns at `if (!target)` before `_meleeBrain`, so a
       * creature whose target has just died — or walked out of the leash —
       * never reaches `_beastBrain` and never reaches `_windTick`. Neither one
       * is wrong for a wild acklay, which has a player in front of it from the
       * moment it spawns to the moment it dies. A companion is the first body
       * in the game that is a beast AND is routinely idle, and it is the only
       * one that can be caught by this.
       *
       * What it looks like on the field: the animal stops mid-attack in the
       * pose it stopped in and holds it until something else wanders into
       * range. Measured on the kill test — frozen in `lunge` for five seconds
       * at a time, and a `winded` window of 2.4 s that ran for twelve.
       *
       * `stateTime` is advanced unconditionally in `Enemy.update`, so the
       * clock is already correct; this only reads it and lets the state end.
       * The two lengths come from the two tables that own them rather than
       * from numbers written here.
       */
      /**
       * AND THE KIND'S OWN VERB GETS ITS FRAME.
       *
       * Ten of the twelve need one — a walk to a door with nine seconds of
       * work at the end of it, a beat between two slams, a clock on a bleed-out,
       * eight seconds of paint — and this is the tick they get. It is here
       * rather than in either wrap for the reason the pack exists: `world.props`
       * runs after every body has moved and before anything draws, so a verb
       * reads a settled frame instead of a half-stepped one.
       *
       * 'done' IS THE ONE RETURN VALUE, and it is the third door out of a verb:
       * the animal has finished and goes back to your heel with no wheel press.
       * That is what makes FLUSH a pounce rather than a posture and SLICE a job
       * rather than a place to stand.
       */
      if (e._cmpDuty?.id === 'verb') {
        const W = verbWork(e);
        if (W?.tick?.(e, dt) === 'done') { endVerb(e); e._cmpDuty = null; }
      }
      if (!e.target || e.target.dead) {
        const st = e.stateTime || 0;
        if (e.state === 'winded') { if (st > WIND_OPEN) e.state = 'approach'; }
        else {
          const M = BEAST_MOVES[e.state];
          if (M && st >= M.done) { e.state = 'approach'; e._swiped = false; e.swingAt = null; }
        }
      }
    }
  }

  /**
   * `destroy` AND NOT ONLY `dispose`, and the difference is a crash.
   *
   * `World.unload` walks `this.props` and calls `destroy()` on every entry —
   * not `dispose()`. A pack with only the second is a pack that throws
   * `p.destroy is not a function` on the frame a level is torn down, which is
   * every level change, every quit and every check that unloads its fixture.
   * Found by the check suite doing exactly that nine times in a row.
   */
  destroy() { this.dispose(); }

  dispose() { this.list.length = 0; }

  /**
   * THE ONE BODY, for the fold to ask about. A getter rather than a field so
   * there is no second place that can be stale: the list is the truth and this
   * is a reading of it.
   */
  get body0() { return this.list[0] || null; }
}

/** Hang a pack on the world, once. */
export function attachCompanions(world) {
  if (!world || world._companions) return world?._companions || null;
  const pack = new CompanionPack(world);
  world._companions = pack;
  (world.props ||= []).push(pack);
  return pack;
}

/**
 * Put one on the field beside its owner.
 *
 * `spawnEnemy` is the one door every other body comes through, so a companion
 * is built, rigged, LOD'd, cohorted and physically real by exactly the same
 * path as everything else — and then `team` and the two wraps are the whole of
 * what makes it yours.
 */
/* NO DEFAULT KIND. `kind = 'massiff'` was the one place this file knew a kind
 * by name, and `companions: every kind is a row` caught it: a file with a
 * favourite kind is a file that will grow an `else if` for the next one. The
 * caller names what it wants or gets nothing. */
export function fieldCompanion(world, owner, kind, opts = {}) {
  if (!world?.spawnEnemy || !owner?.position) return null;
  /* THE KIND IS A ROW AND THE ARCHETYPE IS A BODY, and they are two lookups
   * because one kind deliberately borrows another's body: the reprogrammed B1
   * is `buildB1` verbatim, which is the cheapest droid in the set by a wide
   * margin and the reason it is the kind to prototype the ranged path on. */
  const K = COMPANION_KINDS[kind];
  if (!K || !ARCHETYPES[K.archetype]) return null;
  const pack = attachCompanions(world);
  const yaw = owner.aimDir ? Math.atan2(owner.aimDir.x, owner.aimDir.z) : 0;
  _v2.set(
    owner.position.x - Math.sin(yaw) * HEEL.back,
    owner.position.y,
    owner.position.z - Math.cos(yaw) * HEEL.back,
  );
  _v2.y = world.terrain?.height ? world.terrain.height(_v2.x, _v2.z) : owner.position.y;
  /* THE LOOK RIDES THE SPAWN, because the builder reads it and the builder
   * runs inside the constructor — see `Enemy._cmpLook`. Everything else about
   * the animal is hung on afterwards by `adopt`; its colours cannot be. */
  const e = world.spawnEnemy(K.archetype, _v2, { companionLook: opts.rec?.look || null });
  if (!e) return null;
  /* THE TEAM IS THE WHOLE OF "IT IS ON YOUR SIDE" — Command.js's own header
   * says so: the only things that make a body yours are a team number and the
   * fields hung off it. Set before the pack adopts, so the first frame's
   * targeting already reads it. */
  e.team = owner.team ?? 0;
  /**
   * AND IT TAKES THE SAME FRIENDLY-FIRE DISCOUNT EVERY OTHER ALLY TAKES, which
   * is not a nicety — it is the difference between a companion and a target.
   *
   * `canHarm` lets a blade through onto your own side whenever the world's
   * `friendlyFire` rule is on, and `installTeamDamage` is the wrapper that
   * then scales what lands: every trooper gets it inside `enlistBody`, and a
   * companion is not enlisted, so nothing was scaling anything. Measured
   * without it, on the kill test: the player cut his own animal to -311 of 210
   * hp in one minute of ordinary walking.
   *
   * `TEAM_DAMAGE_DEFAULT` and not a private number, because the player has a
   * slider for this and asked for it by name; one table, one owner.
   */
  installTeamDamage(e, world.settings?.teamDamage ?? TEAM_DAMAGE_DEFAULT);
  return pack.adopt(e, owner, { ...opts, kind });
}
