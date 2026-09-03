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
import { award, RANGED_MARK, rangedRun, temperSwing } from './Kennel.js';
/* The friendly-fire scaling every ally in the game already gets — see
 * `fieldCompanion`, which is the one place it is installed. */
import { installTeamDamage, TEAM_DAMAGE_DEFAULT } from './Command.js';
/* The move table and the length of the winded window, both read rather than
 * restated — see `CompanionPack.update`. */
import { BEAST_MOVES, WIND_OPEN } from './Enemy.js';
/* HOW CLOSE "IT REACHED YOU" IS — see `DEEDS.reached` in the pack's ledger.
 * `DOWN_HELP` is the radius the game already uses for one body kneeling over
 * another, and its own note says "inside a body length: this is kneeling next
 * to him, not walking past", which is exactly the sentence the deed is trying
 * to be true of. A private number here would be a second opinion about the
 * same act. */
import { DOWN_HELP } from './Enemy.js';
/* The one gate every damage path in the game answers to — see `installCompanionHide`. */
import { canHarm } from './Player.js';

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
 *
 * ── `lands`: WHAT IT WOULD LOOK LIKE FOR THIS ORDER TO HAVE WORKED ────────
 *
 * `DEEDS.order` pays for "the first time per area that an order you gave it
 * actually lands", and the whole worth of that sentence is in the last two
 * words. `tools/_cmporders.mjs` opens by saying it: an order that is accepted
 * and does nothing is worse than one that is refused. Paying at the moment of
 * the press pays for the press — and that is what the shipped code did before
 * this column existed, so a rung-0 companion standing at your heel earned a
 * deed for being told to heel, from one wheel tap, without moving.
 *
 * Two shapes cover all six, and neither one is an `if (id === …)`:
 *
 *   'target'   the animal has a body in front of it that THIS DUTY allows —
 *              the one you named under SEEK, anything inside your ring under
 *              WARD, the kind's own verb. `dutyAllows` is the reader, so the
 *              order's own filter is what says it landed and there is no
 *              second opinion anywhere about what SEEK means.
 *   'station'  the animal is standing where the order MOVED it to, having not
 *              been there when you gave it. HEEL is the case that forces the
 *              second half: heel is the station it is already on nine frames
 *              in ten, so without "it had to come" the safest order in the
 *              game would land on the frame it was given and the deed would
 *              be paying for a keypress again by another route.
 *
 * AWAY is 'station' rather than "it stopped fighting", because a refusal is
 * not observable — an animal with nothing to fight looks exactly like an
 * animal refusing to. What IS observable is that it came back behind you,
 * which is the half of AWAY `stationFor` implements and the half a player
 * actually watches for.
 */
export const COMPANION_ORDERS = {
  heel: {
    id: 'heel', label: 'HEEL', arg: 'none', standing: false, holds: 'heel', lands: 'station',
    caption: 'Come here and stay where I can see you',
  },
  away: {
    id: 'away', label: 'AWAY', arg: 'none', standing: true, holds: 'away', lands: 'station',
    caption: 'Break off. Do not fight. Get behind me',
  },
  ward: {
    id: 'ward', label: 'WARD', arg: 'none', standing: true, holds: 'ward', lands: 'target',
    caption: 'Meet anything that comes near ME',
  },
  seek: {
    id: 'seek', label: 'SEEK', arg: 'body', standing: true, holds: 'seek', lands: 'target',
    caption: 'Kill the one under my reticle',
  },
  hold: {
    id: 'hold', label: 'HOLD', arg: 'point', standing: true, holds: 'hold', lands: 'station',
    caption: 'Stand on that ground and meet what comes to it',
  },
  /* ONE SLOT, TWELVE MEANINGS. The label and the caption are read off the live
   * companion's own row (`COMPANION_KINDS[kind].verb`) rather than from here,
   * which is what stops twelve kinds being twelve reskins: the wheel says
   * something different for every companion you own. */
  verb: {
    id: 'verb', label: null, arg: 'body', standing: true, holds: 'verb', lands: 'target',
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

export function refuseOrder(e, id) {
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
  const rec = e._cmpRec;
  if (!holdsCompanion(rec, O.holds)) {
    const want = COMPANION_RANKS.find((r) => r.orders.includes(O.holds));
    return want ? `not until it is ${want.label.toLowerCase()}` : 'not yet';
  }
  return null;
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
  const why = refuseOrder(e, id);
  if (why) return why;
  const O = COMPANION_ORDERS[id];
  if (O.arg === 'body' && (!arg || arg.dead || arg.team === e.team)) return 'nothing under your reticle';
  if (O.arg === 'point' && !arg?.isVector3) return 'no ground under your reticle';
  if (id === 'heel') {
    e._cmpDuty = null;
    e._cmpBidden = null;
    e._cmpPoint = null;
    e.target = null;
    ask(e, O);
    return null;
  }
  e._cmpDuty = O;
  e._cmpBidden = O.arg === 'body' ? arg : null;
  e._cmpPoint = O.arg === 'point' ? arg.clone() : null;
  ask(e, O);
  return null;
}

/**
 * WHAT WE ARE NOW WAITING TO SEE LAND — two fields, written at the one door
 * every order comes through.
 *
 * `_cmpAsked` is the ORDER ROW and not its id, so `orderLanded` reads the
 * row's own `lands` and nothing anywhere compares a string. `_cmpAskedFrom` is
 * how far from its station the animal was standing WHEN YOU GAVE IT, and it is
 * the whole of "an order that did something": a station order needs the gap to
 * have been real and then to have closed. Recorded AFTER the duty is written,
 * because HOLD's station is the order and HEEL's is the station the order goes
 * back to — asking first would measure the station of the order the animal was
 * under a moment ago.
 */
function ask(e, O) {
  e._cmpAsked = O;
  e._cmpAskedFrom = O.lands === 'station' ? stationGap(e) : 0;
}

/**
 * HAS THE LAST ORDER YOU GAVE ACTUALLY LANDED?
 *
 * One reader, off the order's own `lands` row — see COMPANION_ORDERS. The pack
 * asks it once a frame and it is the ONLY thing that decides `DEEDS.order` and
 * the KEEN tally, so a wheel tap that changed nothing is worth nothing in both
 * currencies at once rather than in one of them.
 */
export function orderLanded(e) {
  const O = e?._cmpAsked;
  if (!O || !e.position || e.dead || e.downed) return false;
  if (O.lands === 'target') {
    const t = e.target;
    if (!t || t.dead) return false;
    /* THE ORDER'S OWN FILTER DECIDES. Under SEEK `dutyAllows` answers true for
     * exactly one body in the world; under WARD, for anything inside your
     * ring. So "it landed" cannot come to mean something the order does not. */
    return dutyAllows(e, t, stationFor(e, _v4), leashOf(e));
  }
  const band = settledBand(e);
  return e._cmpAskedFrom > band && stationGap(e) <= band;
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
  const p = e._cmpOwner;
  if (!p?.position) return out.copy(e._cmpHome || e.position);
  /**
   * A MAN ON THE GROUND HAS NO BACK QUARTER, so the station is HIM.
   *
   * Every other line of this function is about standing off the shoulder of
   * somebody who is walking, turning and shooting — the whole reason the heel
   * is a point rather than a radius. None of it is true of a body. Behind the
   * back quarter of a corpse is 3.4 m of open ground chosen by whichever way
   * he happened to be facing when he fell, and an animal that went to it would
   * be standing three metres from the one thing on the field it is there for.
   *
   * This is what `DEEDS.reached` and the SWORN rung are both measured against
   * — see the move wrap, which is the half that actually walks it there.
   */
  if (p.alive === false || p.dead) return out.copy(p.position);
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
 * ── THE FOUR THINGS EVERYBODY ASKS ABOUT A COMPANION ──────────────────────
 *
 * Four one-line readers, and they exist because four callers were about to ask
 * the same four questions in four spellings. The move wrap owns the animal's
 * steering, the aim wrap owns its targeting, the pack owns its ledger and the
 * checks own the measurement — and every one of them has to know how far the
 * leash reaches, how close counts as arrived, how far from its station it is
 * standing, and whether the owner is still on his feet.
 *
 * HANDOFF §2.4 in four functions: the second spelling of a rule is the one
 * that goes wrong. `leashOf` is the proof — it was already written twice
 * before the ledger needed it a third time, once in the aim wrap as
 * `_cmpLeash ?? LEASH` and once in the move wrap with the temper swing added,
 * and the two DISAGREED. An animal wearing KEEN searched a 14 m radius and was
 * recalled at 18, so four of the metres that temper is priced for did not
 * exist on the half of the loop that finds something to bite.
 */

/** How far it may go from its station, after every temper it wears. */
export function leashOf(e) {
  const sw = e?._cmpSwing;
  return Math.max(2, (e?._cmpLeash ?? LEASH) + (sw ? sw.reach - sw.recall : 0));
}

/** Inside this of its station it is home. A multiple of the kind's own `heel`,
 *  because a tuk'ata ranges and a tooka clings — one slack, one row. */
export function settledBand(e) {
  return SETTLED * HEEL.slack * (COMPANION_KINDS[e?._cmpKind]?.heel ?? 1);
}

/** How far it is standing from where it is supposed to be, on the ground. */
export function stationGap(e) {
  if (!e?.position) return 0;
  stationFor(e, _v4);
  return Math.hypot(_v4.x - e.position.x, _v4.z - e.position.z);
}

/**
 * IS THE OWNER STILL ON HIS FEET? The move wrap's own test, given a name.
 *
 * A player has no downed state in this game — `World._checkWipe` ends the run
 * on the frame the last one falls, and `_reviveDowned` is a co-op wave clear —
 * so "you are down" is exactly `alive === false`, and the same three clauses
 * decide where the animal stands (the move wrap), whether it is running to
 * your body (`DEEDS.reached`) and whether the seconds it is spending away from
 * you are seconds it spent away from anybody at all (the RANGING tally).
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
  return foe.position.distanceToSquared(home) <= leash * leash;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  1. THE TWO WRAPS                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();

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
    let was = null;
    /* `ownerUp` and not a fourth spelling of the same three clauses — see the
     * four readers above `dutyAllows`. */
    const owned = ownerUp(e);
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
    /**
     * …UNLESS IT IS SWORN, IN WHICH CASE IT COMES TO YOU, WITH NOTHING SAID.
     *
     * The last rung's second half, and the only thing on the whole ladder that
     * happens without an order: "+ HOLD. And it comes to you unbidden when YOU
     * go down." Standing its ground (below) is the right answer for an animal
     * that does not know you yet; an animal that has crossed a campaign at
     * your heel comes and stands over you, and it is the difference the player
     * is meant to feel at the moment they can least do anything about it.
     *
     * `holdsCompanion` and not a rung index — one table, one reader, and the
     * licence that buys HOLD is the licence that buys this, so there is no
     * second thing to keep in step with the rank rows.
     *
     * AND A HELD ANIMAL STAYS ON ITS GROUND. HOLD is the one order with no
     * owner in it — the note below says so and the check drives it — so an
     * order you gave about a piece of dirt is not quietly cancelled by your
     * own death. That falls out of `stationFor` rather than out of a clause
     * here: it answers `_cmpPoint` before it looks at the owner at all, so a
     * sworn animal under HOLD walks to the ground you gave it and nowhere.
     *
     * THIS IS ALSO THE ONLY WAY `DEEDS.reached` CAN EVER FIRE. It pays for the
     * animal arriving within `DOWN_HELP` (2.2 m) of you, and the heel station
     * is 3.4 m off your back — so a companion doing nothing but heeling is,
     * by construction, always too far away to earn it. A deed no rung can
     * reach is a deed that is not in the game.
     */
    const sworn = !owned && !!e._cmpOwner?.position && holdsCompanion(e._cmpRec, 'hold');
    if (!owned && !sworn) {
      e._cmpHome = (e._cmpHome || new THREE.Vector3()).copy(e.position);
    }
    /* HOLD IS THE ONE ORDER WITH NO OWNER IN IT. A companion standing on
     * ground you gave it keeps its station whether you are alive, dead, or
     * three hundred metres away — which is exactly what makes it the last
     * rung, and it is why this is tested before `owned` rather than inside it.
     * The branch above (an owner who is down) must not overwrite a held
     * point with wherever the animal happens to be standing. */
    const held = e._cmpDuty?.id === 'hold' && e._cmpPoint;
    if (owned || held || sworn) {
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
      /* HOW LOOSELY THIS KIND HOLDS ITS STATION, and HOW FAR IT MAY GO — one
       * reader each, for the reason those readers give. The tempers move
       * `reach` and `recall` and `temperSwing` is the one place they are added
       * up; the wrap that walks the animal home and the ledger that decides it
       * crossed an area "inside the leash" must be reading the same rope. */
      const leashNow = leashOf(e);
      const dragged = d > leashNow;
      if (dragged || !busy) {
        if (d > settledBand(e)) {
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
     * THE RECORD THE RUN IS HAPPENING TO, held by the pack as well as by the
     * body — and it is the SAME OBJECT, never a copy.
     *
     * `keepCompanion` needs it after the body is gone: a dead animal is
     * spliced out of `this.list` by the loop below, so `body0` is null at
     * exactly the fold that has to write the epitaph. The fold reads this and
     * checks its id against the disk before it trusts it — see the note there,
     * which is also the note about why nothing ever climbed a rung.
     */
    this.rec = null;
    /** The rung it deployed on. See `adopt`. */
    this.rung0 = null;
    /**
     * HOW MUCH OF THE RUN IT SPENT AWAY FROM YOU, in seconds, for RANGING.
     *
     * Two clocks rather than one ratio, because a ratio has to be recomputed
     * every frame and neither number is interesting until the fold asks. What
     * counts as "away" and what counts as "mostly" are BOTH the temper's own:
     * `RANGED_MARK` and `rangedRun` live beside RANGING in Kennel.js and this
     * only holds the stopwatch.
     */
    this.farT = 0;
    this.nearT = 0;
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
    if (opts.rec) this.rec = opts.rec;
    /* THE RUNG IT WENT OUT ON, so the fold can say whether it came back a
     * different animal. `Trooper.award` returns the promotion it caused and
     * every caller in Command.js reads that answer; a companion's deeds are
     * awarded a frame at a time from the ledger below, so the comparison has
     * to be held from one end of the run to the other instead. Kept here
     * rather than on the record because it is derived from xp and a derived
     * field on a record is a second source of truth that goes stale. */
    if (opts.rec) this.rung0 = rungOf(opts.rec).id;
    /* HOW MUCH GROUND WAS ALREADY BEHIND YOU WHEN IT ARRIVED. A companion
     * fielded in area three has not crossed areas one and two, and a counter
     * that opened at zero would pay it for both on the next boundary. */
    e._cmpAreas = this.world?.command?.areasTaken ?? 0;
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

  /**
   * WAS THIS A RUN SPENT AWAY FROM YOU? The RANGING verdict — the seconds are
   * this pack's, the rule for what they mean is the temper's.
   */
  get rangedRun() { return rangedRun(this.farT, this.nearT); }

  /** Give it a body to take, or clear the order. */
  bid(e, target) { if (e) e._cmpBidden = target || null; }

  /**
   * ═════════════════════════════════════════════════════════════════════════
   *  WHAT IT DID, AND WHAT THAT IS WORTH
   * ═════════════════════════════════════════════════════════════════════════
   *
   * THE FOUR DEEDS AND THE FOUR TALLIES, IN ONE PLACE, ON A BODY THIS METHOD
   * IS ALREADY HOLDING.
   *
   * `Kennel.DEEDS` and `Kennel.earnedTempers` were both written, both checked,
   * and both fed by NOTHING. `award` had one caller in the whole tree and it
   * fired on the wheel press rather than on anything landing; `downs`,
   * `orders` and `ranged` — the three counters `earnedTempers` reads — had no
   * writer at all. So the ladder existed, the tempers existed, and a companion
   * you played with for a hundred runs stayed STRANGE with an empty collar.
   *
   * ── WHY ALL SIX LIVE HERE AND NOT AT SIX EVENT SITES ─────────────────────
   *
   * Every one of them is a fact about a BODY over TIME — it arrived, it got
   * up, it stayed inside the rope, it spent the afternoon forty metres away —
   * and the pack's tick is the only thing in the tree that sees the body every
   * frame. The alternative was a line in `_areaClear`, a line in
   * `_getUpFromDown`, a line in `orderCompanion` and a line in `_checkWipe`:
   * four files learning the word companion, for a feature built so that none
   * of them do. The `aboard` note above already argues the poll-versus-
   * subscription trade and this is the same trade for the same reason — what
   * is being watched is the BODY, and the body is what the pack has.
   *
   * ── AND EVERY ONE IS LATCHED, BECAUSE A FRAME IS NOT AN EVENT ────────────
   *
   * A companion is inside its leash for thirty frames a second and down for
   * six hundred of them. So every deed below fires on an EDGE rather than on a
   * state, and the latch is per-area where the design says per area
   * (`_cmpOrderedHere`), per-fall where the act is a fall (`_cmpWasDown`,
   * `_cmpReached`) and per-boundary where the ground says so (`_cmpAreas`).
   * Unlatched, `crossed` would pay a point a frame and the ladder would be
   * over in four seconds.
   */
  _ledger(e, dt, taken) {
    const rec = e._cmpRec;
    /* NO RECORD, NO LEDGER — the sandbox's companion, the dojo's, a check's.
     * The animal is real and behaves identically; nothing about it is being
     * remembered, which is what having no record MEANS. */
    if (!rec) return;
    const p = e._cmpOwner;
    const up = ownerUp(e);

    /**
     * AN ORDER YOU GAVE HAS LANDED.
     *
     * Two currencies off one event, counted deliberately differently.
     * `DEEDS.order` is the design's "the first time PER AREA", so it is
     * latched to the area: a player who taps the wheel thirty times has
     * trained nothing. KEEN's tally is the design's "twelve orders landed",
     * which counts ORDERS and not areas, so it takes every one — twelve landed
     * orders is then two or three crossings of ordinary play rather than
     * twelve areas, which is what the temper's own sentence asks for.
     *
     * `_cmpAsked` is cleared on the landing, so one order lands once however
     * long the animal then holds it.
     */
    if (orderLanded(e)) {
      e._cmpAsked = null;
      rec.orders = (rec.orders | 0) + 1;
      if (!e._cmpOrderedHere) { e._cmpOrderedHere = true; award(rec, 'order'); }
    }

    /**
     * IT WENT DOWN — SCARRED's tally, and the flag `recovered` reads.
     *
     * On the EDGE into `downed`, so one fall is one fall however long it lies
     * there, and it counts the FALL and not the death: a companion that bled
     * out is a companion whose record is about to become an epitaph anyway.
     * "…and lived" is enforced by the fold rather than restated here —
     * `applyTempers` runs only on a run it came home from.
     */
    if (e.downed && !e._cmpWasDown) {
      e._cmpWasDown = true;
      e._cmpFellHere = true;
      rec.downs = (rec.downs | 0) + 1;
    } else if (!e.downed) e._cmpWasDown = false;

    /**
     * IT REACHED YOU WHILE YOU WERE DOWN.
     *
     * `DOWN_HELP` is the radius, imported rather than chosen — see the note on
     * the import. Latched on the FALL and cleared the moment you are back on
     * your feet, so one fall pays once and an animal cannot earn it twice by
     * stepping over your body.
     *
     * AND THIS IS THE ONE DEED THE GAME AS SHIPPED MAKES ALMOST UNCLAIMABLE,
     * which is recorded here rather than left to be discovered. A player has
     * no revivable downed state: `World._checkWipe` ends the run on the frame
     * the last one falls and `main.gameOver` folds the companion in that same
     * frame, so in a solo run the animal is running towards a record that has
     * already been closed. The one mode with a real down-and-get-up —
     * co-op's `_reviveDowned` on a wave clear — is the one mode
     * `keepCompanion` deliberately does not fold at all. It is written, it
     * fires, and the check measures what it is worth rather than this file
     * claiming it is worth two.
     */
    if (!up) {
      if (!e._cmpReached && !e.downed && p?.position
          && e.position.distanceTo(p.position) <= DOWN_HELP) {
        e._cmpReached = true;
        rec.saves = (rec.saves | 0) + 1;
        award(rec, 'reached');
      }
    } else e._cmpReached = false;

    /**
     * HOW FAR AWAY IT IS SPENDING THE RUN — RANGING's tally.
     *
     * Measured from YOU and not from its station, because the temper's own
     * sentence is "runs spent beyond twelve metres" and what a player means by
     * that is twelve metres from themselves. The station is 3.4 m behind you
     * and swings when you turn round; a ring measured off it would report an
     * animal at your heel as three metres further out every time you looked
     * over your shoulder.
     *
     * ONLY WHILE YOU ARE UP. Seconds spent standing over your body are not
     * seconds it spent away from you, and a long death sequence would
     * otherwise file the run as one at the end of its rope.
     */
    if (up) {
      if (e.position.distanceTo(p.position) > RANGED_MARK) this.farT += dt;
      else this.nearT += dt;
    }

    /**
     * AND AN AREA IS BEHIND YOU — the two deeds only a boundary can pay.
     *
     * `crossed` wants it ALIVE and INSIDE THE LEASH at the transition, and the
     * leash is measured from the station through `leashOf` and `stationGap` —
     * the same two readers the move wrap steers on, so the rope the ledger
     * pays for is the rope the animal is actually on.
     *
     * `recovered` wants an area it went down in, was picked up in, and then
     * SURVIVED, and all three are in the one test: `_cmpFellHere` says it
     * fell, standing here not-downed says somebody stood over it, and being at
     * the boundary at all says it lived to the end of the area.
     *
     * `areas` is the free layer and is credited on a wider rule than the xp:
     * every boundary it was alive for, in the rope or not. The history is what
     * happened; the deed is what it was worth. COMPANIONS.md is explicit that
     * most of the felt growth should live in the layer that costs nothing.
     */
    if (taken > (e._cmpAreas | 0)) {
      e._cmpAreas = taken;
      if (!e.dead && !e.downed) {
        rec.areas = (rec.areas | 0) + 1;
        if (stationGap(e) <= leashOf(e)) award(rec, 'crossed');
        if (e._cmpFellHere) award(rec, 'recovered');
      }
      e._cmpFellHere = false;
      e._cmpOrderedHere = false;
    }
  }

  update(dt = 1 / 60) {
    /**
     * HOW MUCH GROUND IS BEHIND YOU, ASKED ONCE A FRAME.
     *
     * `areasTaken` is the director's own reader — "a derived count rather than
     * a second tally kept beside the first", counted off the ledger
     * `_areaClear` writes as it crosses — and it is the right one of the three
     * on offer. `areaNumber` is where you ARE and is one ahead of what you
     * have taken. `areaIndex` never advances on the LAST area at all, because
     * `_areaClear` returns into `_endCampaign` before it increments: an animal
     * that fought a whole crossing would have been paid for four of the five
     * areas it crossed, and the one it was missing the point for is the one it
     * won.
     *
     * ZERO IN EVERY MODE WITHOUT A CAMPAIGN, and that is the honest answer
     * rather than a hole. Nine of the eleven modes have no areas to cross, so
     * there is no boundary to be alive at and this deed does not exist there.
     * The other three do, and they carry those modes on their own.
     */
    const taken = this.world?.command?.areasTaken ?? 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e || e.dead || e.disposed) { this.list.splice(i, 1); continue; }
      this._ledger(e, dt, taken);
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
