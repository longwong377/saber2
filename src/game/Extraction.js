/**
 * BATTLEFRONT BORZ — LEAVING, AND ARRIVING, AS THINGS YOU DO.
 *
 * The player, twice, in their own words:
 *
 *   "in between rounds on command and skirmish and other modes where you're
 *    going between different maps, right now you just teleport and it's really
 *    disorientating, first because it looks terrible and second you spawn with
 *    your allies in front of your saber so you end up killing them, also
 *    teleporting the second you kill the last enemy is insane"
 *
 *   "I already asked that you have to call in transport, walk to the transport,
 *    get transported out (seeing the whole time in the trooper carrier etc.)
 *    and then you fly and go on a journey to your next destination where you
 *    disembark. you should never just teleport."
 *
 * IT WAS ASKED FOR BEFORE AND NOT DELIVERED. What existed was `Arrivals.js`,
 * which solved the identical problem for the ENEMY — a droid used to blink into
 * being at 40 m and now rides a gunship down — and `World._groundPending`,
 * which took the whole player between two planets inside one frame.
 *
 * ── WHAT THIS IS ──────────────────────────────────────────────────────────
 *
 * Nine phases, and eight of them are things you can look at:
 *
 *   aftermath  the last enemy is down and NOTHING happens. You stand in it.
 *   called     you call for the transport. Empty sky; a voice answers.
 *   inbound    it comes in over the ridge, flares, and puts its gear down.
 *   boarding   you WALK to it. It waits. Your line walks with you and files
 *              into the bay around you.
 *   liftoff    the gear leaves the ground and it climbs out.
 *   transit    the journey — and this is the phase the whole file is for. You
 *              are stood in an open troop bay at altitude with your own men
 *              either side of you, and the camera is yours: look down at the
 *              ground going past, look at the men, look back at where you were.
 *   descent    the new ground comes up underneath and it settles onto it.
 *   unload     the ramp, and everybody walks off it, you first.
 *
 * ── THE LEVEL CHANGE HAPPENS INSIDE THE JOURNEY, AND THAT IS THE POINT ─────
 *
 * `World.rotateTo` is measured at a 571 ms median and a 1374 ms worst case —
 * time in which nothing steps and nothing paints. Every previous design had to
 * put that somewhere, and every one of them put it behind a bar.
 *
 * It goes at the top of the climb, 1.2 s after the cloud closes over the bay,
 * and it comes out 1.4 s before the cloud opens again. That is not a fiction
 * wrapped around a loading screen: the flight is REAL — the same ship object,
 * the same continuous transform, the same passengers — and the swap is the
 * moment of it you could not have seen anyway. The ship group is added to
 * `world.scene` DIRECTLY and never to `world.statics`, which is the list
 * `unload()` empties; the veil is parented to `engine.camera`, which is not a
 * level object at all. So the one thing in the frame that does not change when
 * a planet does is the aircraft you are standing in.
 *
 * ── JUDGEMENT CALLS, STATED ───────────────────────────────────────────────
 *
 *   HOW LONG. About 39 s end to end, of which 5 s (the aftermath) and however
 *     long you take to walk 20 m are free play, and the rest is on rails with a
 *     free camera. Timing is in the table below and `beatSheet()` prints it.
 *
 *   SKIPPABLE — ALWAYS, AND ONLY AFTER THE SWAP HAS LANDED. Holding the jump
 *     key during `transit` collapses the cruise to `TRANSIT_MIN`. It is not
 *     gated on "you have seen it once", because a player who wants to get on
 *     with it wants that on the first round too. It IS gated on the rotate
 *     having completed, and that gate is the reason the skip can never be a
 *     bad deal: skipping earlier could only ever put you in front of a stall,
 *     so the one thing the player cannot do is turn the journey back into a
 *     loading screen.
 *
 *   FIXED PATH, FREE CAMERA. The ship flies itself; you cannot steer it. That
 *     is what the reference plate is — a clone and a Jedi standing in an open
 *     bay watching a battlefield go past, not a vehicle mission. Giving the
 *     player the stick would make the journey a thing to be good at, and the
 *     ask was for a thing to be in.
 *
 *   CO-OP: THE SHIP WAITS, AND THEN THE CREW HAULS YOU IN. It will not leave
 *     while any living local commander is still on the ground. After
 *     `LAST_CALL` seconds it stops waiting — but a straggler is not left and is
 *     not teleported either: they are DRAGGED to the ramp over `PULL` seconds,
 *     a visible slide at about walking pace with their feet on the ground.
 *     That is the only anti-stall in the file and it obeys the same rule as
 *     everything else in it, which is that you can watch it happen.
 *
 *   THE MUSTER GOES IN THE FLIGHT. See `_openMuster`. It is strictly better
 *     and it is what the transit phase was missing: twelve seconds of held
 *     camera with nothing to decide is the failure mode the brief warns about,
 *     and the mode already has a decision that belongs exactly there.
 *
 * ── THE OPT-OUT ───────────────────────────────────────────────────────────
 *
 * `settings.instantSpawn` — the same single reader `Waves.instantSpawn` gives
 * "does this player want things to simply appear" — turns the whole sequence
 * off and restores the one-frame rotate. It is what the sandbox, the dojo and
 * a headless check that is measuring something else all already set, and a
 * second setting meaning the same thing is the twin HANDOFF 2.3 is about.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp, lerp, damp, smoothstep, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';
import { spawnClear, bladeClear, nudgeFromSwing } from './Spawn.js';
import { transportModel, capitalModel } from './Arrivals.js';
import { armyForOrder } from './Databank.js';
/* The mode table, for one field: `insertion`. Waves.js imports Arrivals and
 * Databank as this file does and imports nothing from here, so the edge is
 * one-way and costs no cycle — `tools/checks/wiring.mjs` walks the graph. */
import { MODES } from './Waves.js';

const rng = makeRng(48221);
export function seedExtraction(seed) { rng.seed(seed); }

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE TIMING TABLE — one place, exported, and the check reads it         */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * "teleporting the second you kill the last enemy is insane." Five seconds of
 * nothing. No banner for the first two of them, no ship, no timer on the HUD:
 * the field is quiet and you are standing in it with a lit blade. It is the
 * only phase in the file whose content is its own absence.
 */
export const AFTERMATH = 5.0;

/** The call itself. Long enough for an answer to come back, and no longer. */
export const CALL = 1.4;

/** Ridge to gear-down. `Arrivals`' own dropship flies its approach in 3.6 s at
 *  88 m; this one is bigger in the frame because you are about to get into it,
 *  so it comes from further out and takes longer over the flare. */
export const INBOUND = 6.0;

/** How far from the commander the transport sets down. Far enough that walking
 *  to it is a walk — about four and a half seconds at an ordinary pace — and
 *  near enough that it is never a hike across a level. */
export const PAD_RANGE = 20;

/**
 * HOW LONG THE RAMP AND THE DOORS TAKE, and it is one number for both because
 * they run together: the ramp starts down, the doors start aft, and the bay is
 * open when both arrive.
 *
 * The player asked for the sequence by name — "the transports land, you see a
 * large ramp come out, then the side doors slide open, the troops file in…
 * then you land, and can only disembark when the ramp comes back out, then the
 * ramp retracts once the troops are out, the side doors close, then the ships
 * leave" — so the phases exist rather than being an animation played over a
 * teleport. `HATCH` is what all four of those beats cost.
 */
export const HATCH = 1.7;

/**
 * THE BAY, NOT A RADIUS. This was `BOARD_RADIUS = 3.2` and it is the whole of
 * "you don't even walk into the ship you touch it and teleport in I guess?":
 * a sphere 3.2 m across the ramp's foot, and anything inside it was snapped
 * into a seat. You never entered the ship; you brushed a bubble outside it.
 *
 * You are aboard when you are STANDING IN THE BAY, which is a box the ship
 * publishes (`userData.bay`) — and `_seat` no longer moves you when you get
 * there, it converts where you already are into a seat in the ship's own
 * frame. There is no jump at any point.
 *
 * It survives as a name because `_walkTroops` needs a distance at which a
 * trooper stops steering for the ramp foot and starts climbing it.
 */
export const BOARD_RADIUS = 1.9;

/**
 * THE BLADE HAS TO BE DOWN BEFORE THE RAMP COMES UP.
 *
 * The player: "because of the close quarters you would have to press the button
 * to retract your saber, would be a cool time to make you actually use it."
 * It is the one moment in the game with a reason to put the blade away that is
 * not a menu, and the crew simply will not seal the bay with a metre of plasma
 * standing in it. Held here rather than in the phase so a check can read it.
 */
export const SEAL_NEEDS_BLADE_DOWN = true;

/**
 * AND HOW LONG THE CREW ASKS BEFORE DOING IT FOR YOU.
 *
 * Short, and much shorter than `LAST_CALL`. A stalled BOARDING is a player who
 * has not walked to the ship and needs twenty-two seconds of rope; a lit blade
 * in the bay is a player who is standing right there and has been told, in a
 * banner, which key to press. Six seconds is two reads of that banner.
 *
 * The two waits used to be the same number and it made the total hold 47 s,
 * which `tools/checks/extraction.mjs` is right to refuse: a journey that can be
 * held for three quarters of a minute by doing nothing is a stall with a
 * cutscene over it.
 */
export const BLADE_WAIT = 6.0;

/** How long the ship holds the ground before the crew stops asking. */
export const LAST_CALL = 22.0;

/** And how long the haul takes. A slide at walking pace, not a jump cut. */
export const PULL = 1.6;

/**
 * HOW LONG THE EXTRACTION KEY IS HELD BEFORE THE SHIP IS CALLED, in seconds.
 *
 * 1.5 is long enough that no bounce of the key reaches it and short enough
 * that it is not a chore under fire. It is also, deliberately, long enough to
 * be a beat: you stop swinging for a second and a half to ask, and that pause
 * is the decision.
 *
 * IT LIVES HERE AND NOT IN World.js, though `_withdrawTick` is what counts it
 * off. The Codex has to print how long the key is held, and the Codex is in
 * Menu.js, which cannot reach World.js — the world imports the menu's colour
 * tables, not the other way about. Extraction.js is the file the withdrawal
 * belongs to and the one both of them can already see.
 */
export const WITHDRAW_HOLD = 1.5;

/** How long a body takes to walk from where it stepped aboard to its seat.
 *  See `_flyPassengers`: this is the difference between taking a seat and
 *  being snapped into one. */
export const SETTLE = 1.3;

/** …at this pace, in metres a second. A brisk walk across a moving deck. See
 *  `_flyPassengers`: a RATE is what makes the worst frame bounded, where a
 *  fraction-of-what-is-left is not. */
export const SEAT_PACE = 2.2;

/** Gear off the ground to established climb. */
export const LIFT = 3.4;

/**
 * HOW MUCH AIR THE HULL KEEPS UNDER IT.
 *
 * The player: "Also the ships fly straight through mountains a lot." Every
 * flight path in this file is a lerp between two points picked for their
 * ground-level geometry, and nothing ever asked what was between them. See
 * `_clearGround`: this is the margin it holds over the ground under the hull
 * and the ground 34 m ahead of it, whichever is higher. 26 m is a comfortable
 * two hull-heights over the Colosseum's rim and clears every ridge on drifts.
 */
export const CLEARANCE = 26;

/* ── the insertion ───────────────────────────────────────────────────────
 * "You don't start any matches coming in on a transport ship with your troops,
 *  I already told you that you should never just appear, ON ANY MAP, you must
 *  always arrive and leave via transport regardless of if you're with troops or
 *  not… If you're just starting a game or map from scratch maybe you start a
 *  game in a transport ship with your troops if you have any just as you're
 *  leaving the capitol ship in space like you when you start you look behind
 *  the ship flying through space and you see the capitol ship getting smaller
 *  and smaller and the planet getting larger and larger as you enter the
 *  atmosphere and land on your battlefield. Every mode/map should start like
 *  this."
 *
 * The EXTRACTION is a journey between two grounds and already existed. This is
 * the journey onto the FIRST one, which did not: every mode in the game opened
 * with the player simply being at the spawn point.
 */

/** How high the transport leaves the capital ship, in metres over the LZ. */
export const ORBIT_ALT = 2400;

/** Where the capital ship is when the doors open on it, and where it has gone
 *  by the time the atmosphere does. It is the SHRINKING that is the shot. */
/**
 * THE CAPITAL SHIP IS REAL SIZE NOW, and the distance is where the deck's
 * flight left it. `DeckFlight` flies the transport `FLIGHT.outRange` metres out
 * of the hangar with the hull standing round the deck at ×100
 * (`DeckExterior`), so the orbit opens with the same ship the same distance
 * astern and recedes from there. The old numbers — a 1/100 model at 520 m
 * growing to stay "a ship rather than a speck" — were the "large rectangle
 * getting smaller" the player saw: a ten-unit wedge at nine degrees.
 */
export const CAPITAL_NEAR = 1400;
export const CAPITAL_FAR = 14000;
/** The builders are 1/100; the hull is drawn at real scale. */
export const CAPITAL_SCALE = 100;

/** Station-keeping in space, then the burn, then the fire. */
export const ORBIT = 9.0;
export const ENTRY = 6.5;
/** And the fall from the top of the atmosphere to the flare, which is longer
 *  than an extraction's descent because it starts eight times higher. */
export const FALL = 9.0;

/**
 * HOW LONG THE SHIP THAT JUST DROPPED YOU TAKES TO GET OUT OF SIGHT.
 *
 * The inbound leg used to end at `_teardown`, which is `parent.remove(g)` — so
 * the transport you had just walked out of BLINKED OUT OF EXISTENCE behind you,
 * on every level, in every mode. The mid-battle reinforcement dropships have
 * always flown away properly (`Arrivals._updateDropship` lerps them to an exit
 * 70 m out and 46 m up before removing them), which is exactly why this read as
 * a bug rather than as a convention: the same fiction behaved two ways.
 *
 * It cannot be another PHASE, and that is the whole design of it. A phase is a
 * thing the rest of the game waits on — the camera is the director's, the
 * passengers are the director's, and `_finish` is what hands the world back —
 * so five and a half seconds of climb-out spent inside the sequence is five and
 * a half seconds of the player watching a ship leave instead of fighting. (It
 * would no longer hold the HORDE off: `holdsHorde` releases the director at the
 * top of the descent and every beat after it. It would still hold everything
 * else.) So the ship is HANDED OFF instead: ownership of the group moves
 * to `_departing`, `_finish` runs on the same frame it always did, the fight
 * starts on time, and the transport climbs out on its own as set dressing.
 */
export const DEPART = 5.5;

/**
 * How far the camera can see while the ship is outside the atmosphere, and what
 * it sees when there is nothing there.
 *
 * The capital ship recedes to CAPITAL_FAR (5200 m), so the far plane has to
 * clear that with room to spare or the shot the whole sequence exists for is
 * clipped away — see `_setSpace`. Nothing else is drawn out there: the level's
 * geometry is 2400 m below and its own fog is off, so a far plane this large
 * costs depth precision and no fill.
 */
export const SPACE_FAR = 24000;
/** Not black — the darkest the game's own palette goes, so space belongs to it. */
export const SPACE_BG = new THREE.Color(0x05060b);

/** The cruise, and the shortest a skipped cruise can be. */
export const TRANSIT = 11.0;
export const TRANSIT_MIN = 4.6;

/** Where in the cruise the ground under you changes. See the header. */
export const VEIL_IN = 1.2;                     // cloud closes
export const SWAP_AT = VEIL_IN + 0.9;           // the rotate is asked for here
export const VEIL_HOLD = 1.4;                   // cloud stays after it lands

/** Down onto the new ground, and the ramp. */
export const DESCENT = 6.0;
export const UNLOAD = 2.0;

/** Seats in the bay, not counting the commander. The reference plate has five
 *  bodies in shot and the hull is 7.4 m long; six is the honest number. */
export const BAY_SEATS = 6;

/**
 * TWELVE PHASES, AND FOUR OF THEM ARE NEW. `opening` and `sealing` are the ramp
 * and the doors, and both legs of the journey run them — out of the old ground
 * and onto the new one — which is why they are named for what they do rather
 * than for where in the flight they happen. `this.leg` says which.
 */
export const PHASES = ['orbit', 'entry', 'aftermath', 'called', 'inbound', 'opening',
  'boarding', 'sealing', 'liftoff', 'transit', 'descent', 'unload', 'done'];

/**
 * The whole sequence as a table of {phase, at, dur}, in seconds, for a run in
 * which the commander walks `PAD_RANGE` metres at an ordinary pace.
 *
 * EXPORTED AND DERIVED, because the alternative is a paragraph in a report that
 * says 39 seconds and a file that says something else six months later. The
 * check prints this and the report quotes it.
 */
export function beatSheet({ walk = PAD_RANGE / 4.6, skip = false } = {}) {
  const cruise = skip ? TRANSIT_MIN : TRANSIT;
  const rows = [
    ['aftermath', AFTERMATH, 'the last enemy is down; nothing happens'],
    ['called', CALL, 'you call for transport'],
    ['inbound', INBOUND, 'it comes in and puts its gear down'],
    ['opening', HATCH, 'the ramp comes out and the side doors slide open'],
    ['boarding', walk, 'you WALK up the ramp; your line files in around you'],
    ['sealing', HATCH, 'blade down, ramp up, doors shut'],
    ['liftoff', LIFT, 'gear up, climb out'],
    ['transit', cruise, 'the journey — free camera, open bay, ground below'],
    ['descent', DESCENT, 'the new ground comes up and it settles'],
    ['opening', HATCH, 'the ramp comes out again — nobody may leave before it does'],
    ['unload', UNLOAD, 'everybody walks off it'],
    ['sealing', HATCH, 'ramp up, doors shut, and it goes'],
  ];
  let at = 0;
  return rows.map(([phase, dur, what]) => {
    const row = { phase, at: +at.toFixed(2), dur: +dur.toFixed(2), until: +(at + dur).toFixed(2), what };
    at += dur;
    return row;
  });
}

/** Total seconds for one extraction, walk included. */
export function extractionSeconds(opts) {
  const s = beatSheet(opts);
  return +s[s.length - 1].until.toFixed(2);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Shared geometry — one set, for every extraction ever flown             */
/* ══════════════════════════════════════════════════════════════════════ */

const G = {};
const M = {};
let _built = false;

function build() {
  if (_built) return;
  _built = true;
  G.hull = new THREE.BoxGeometry(2.7, 1.55, 7.6);
  G.nose = new THREE.ConeGeometry(1.45, 3.0, 4);
  G.wing = new THREE.BoxGeometry(6.4, 0.24, 2.2);
  G.glow = new THREE.SphereGeometry(0.5, 8, 6);
  /* THRUST, as a cone rooted in the nozzle. Two of them per engine — a wide
   * soft envelope and a narrow bright core — because one translucent shape at
   * one colour is a glow and two at two is a flame. */
  G.flame = new THREE.ConeGeometry(0.24, 1.0, 10, 1, true);
  G.flameCore = new THREE.ConeGeometry(0.12, 1.0, 8, 1, true);
  G.wash = new THREE.ConeGeometry(5.2, 9, 14, 1, true);
  /* The cloud. An inverted sphere 40 cm from the eye, so it is the whole frame
   * whatever the fov and whatever the camera is doing — a plane would show its
   * edges the moment the player looked up, which is the one thing they are
   * being invited to do in this phase. */
  G.veil = new THREE.SphereGeometry(0.4, 12, 8);
  M.hull = new THREE.MeshStandardMaterial({ color: 0x8d8b83, roughness: 0.82, metalness: 0.18 });
  M.trim = new THREE.MeshStandardMaterial({ color: 0x6a6862, roughness: 0.9, metalness: 0.1 });
  M.engine = new THREE.MeshBasicMaterial({ color: 0xff9a4a, transparent: true, opacity: 0.55,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  M.engineCore = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.9,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  M.wash = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  M.veil = new THREE.MeshBasicMaterial({ color: 0xd8d2c6, transparent: true, opacity: 0, depthWrite: false, side: THREE.BackSide, fog: false });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The director                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

export class ExtractionDirector {
  constructor(world) {
    this.world = world;
    this.phase = 'done';
    this.t = 0;
    this.total = 0;
    this.nextKey = null;
    this.group = null;
    this.veil = null;
    this._rotated = false;
    this._rotateAsked = false;
    this._skip = false;
    /** True while this sequence is a player-called withdrawal — see `withdraw`. */
    this.withdrawing = false;
    this._seated = [];
    this._pull = null;
    this._log = [];
    this.onPhase = null;
  }

  get active() { return this.phase !== 'done'; }

  /**
   * IS THIS FLIGHT THE ONE CARRYING THE PARTY BETWEEN TWO GROUNDS?
   *
   * `World.unload` cannot reach the ship — it is parented to `scene` rather
   * than to `statics` precisely so a ground swap cannot delete the transport
   * the player is riding IN. That is right for exactly one case and was applied
   * to all of them, so any OTHER reason a level changed left the whole ship in
   * the scene for the rest of the session: hull, capital, both pilots, both
   * doors and the ramp. Measured across one rotate — 44 meshes, no physics, no
   * owner, drawn over every level loaded afterwards. That is the report about
   * geometry from one map being superimposed on the next.
   *
   * The discriminator is the LEG. An extraction (leg 'out') genuinely spans the
   * swap: it lifts off one ground, the world changes underneath it during
   * `transit`, and it descends onto another. An INSERTION (leg 'in') never
   * does — it starts in orbit over the ground it is going to land on — so a
   * level change under one is a stranded flight by definition. The airborne
   * phases are named rather than inferred, because a ship on the pad with its
   * ramp down is not carrying anybody anywhere whatever leg it is on.
   */
  get carryingBetweenGrounds() {
    return this.active && this.leg === 'out'
      && (this.phase === 'liftoff' || this.phase === 'transit' || this.phase === 'descent');
  }
  /** True while the ship is holding people off the ground. */
  get aboard() { return this.phase === 'liftoff' || this.phase === 'transit' || this.phase === 'descent'; }
  /** What the sequence did, beat by beat, in seconds. The check reads it. */
  get log() { return this._log; }

  /**
   * IS A TRANSPORT COMING DOWN ON THE GROUND THE FIGHT IS ON — or already on it?
   *
   * `descent` is the fall onto the ground the NEXT fight happens on, whichever
   * leg it belongs to: an insertion falls out of the burn onto the only ground
   * it ever had, and an extraction's descent is on the far side of the swap, so
   * by the time it starts the level under the hull is the new one. Everything
   * after it — `opening`, `unload`, `sealing` — is the ramp, and `leg` is 'in'
   * for all of it (`_descent` sets it on touchdown), which is what separates
   * those from the identically-named beats on the pad you are LEAVING.
   */
  get landing() {
    if (!this.active) return false;
    return this.phase === 'descent'
      || (this.leg === 'in' && this.phase !== 'orbit' && this.phase !== 'entry');
  }

  /**
   * MUST THE HORDE WAIT FOR THIS FLIGHT? `World.update`'s wave-director gate.
   *
   * It used to be `!extraction.active`, and `active` is `phase !== 'done'` —
   * so the director was held for the WHOLE sequence, and `beginInsertion` is
   * the last line of deploy. Measured on a geonosis skirmish: phases ran
   * orbit@0 entry@7.0 descent@13.5 opening@22.5 unload@24.3 sealing@26.3
   * done@28.0, and there were ZERO hostiles on the field for all 28 of those
   * seconds while the HUD printed "50 HOSTILES LEFT". The player, across many
   * sessions: "When I spawn onto geonosis I still have no enemies spawn in."
   *
   * WHAT THE OLD GATE WAS PROTECTING, all of which this keeps:
   *
   *   the ground you are LEAVING. An extraction is up to forty seconds and
   *     `WaveDirector.intermission` is 5.5, so an ungated director opens the
   *     next engagement's first wave on the pad you are walking away from with
   *     the commander sat in an aircraft. Every phase from `aftermath` to
   *     `transit` still holds — that is the whole outbound leg.
   *   `CommandDirector._troops` fighting `Extraction._walkTroops` for the same
   *     `wish` field. `_walkTroops` is what files your line up the ramp and it
   *     runs in `boarding` and the outbound `opening`/`sealing` — all held.
   *     The inbound tail never calls it: `_unload` puts the line off the ramp
   *     with `_release`, which clears `_extracting` on the body it frees.
   *   ORBIT AND ENTRY, which are new and are held for their own reason: the
   *     ground is 2400 m down and a smudge, the commander cannot see it, and
   *     everything that sites a body — `World.pickSpawn`, `Arrivals._anchor` —
   *     is anchored on the commander, who is in space.
   *
   * What is released is the LANDING: the ship is over the ground the fight is
   * on, closing on the pad, and the enemy has the rest of the descent to walk
   * in. You land INTO a battle. Nothing may be PLACED on the pad while it does
   * — that is `clearOfLZ`, asked at `World.spawnEnemy`.
   *
   * ── AND NOT UNTIL THE SHIP IS ACTUALLY OVER THAT GROUND ────────────────
   *
   * `ring` is the level's own `spawnRadius[1]` — how far out it puts things —
   * handed in because this file has no business knowing a level's numbers, and
   * it is a TOLERANCE on the anchor. Everything that sites a body measures from
   * the commander (`World.pickSpawn`, `Arrivals._anchor`, and so `marchBand`),
   * and for the first half of the fall the commander is a seat 150 m downrange
   * of the pad — measured, geonosis: 150 m out at the top of the descent, 39 m
   * with two seconds to go. `marchBand` caps a placement at the distance a body
   * stops drawing itself (137.8 m, `Cohorts.L3_AT`) for the reason its own note
   * gives, and that cap is measured from the anchor: released at the top of the
   * fall, 13 of the first 25 bodies stood more than 137.8 m FROM THE PAD — half
   * the opening wave arriving as cohort silhouettes on ground the player was
   * about to be standing on, which is the exact defect that note says cost
   * geonosis its opening minute. One ring is the tolerance, so a tight arena
   * waits longer and a wide plain waits less, and with no ring stated at all
   * the horde waits for the wheels.
   */
  holdsHorde(ring = 0) {
    if (!this.active) return false;
    if (!this.landing) return true;
    /**
     * …AND THE RING TOLERANCE IS NO LONGER NEEDED, because the thing it was
     * protecting has moved.
     *
     * It waited until the ship's ground track was inside the level's own spawn
     * ring, and the reason was `Arrivals._anchor`: every distance in that file
     * was measured from the PLAYER, who during the fall is a seat in a bay
     * 150 m downrange of the pad. Released at the top of the descent, the ring
     * was drawn around a moving aeroplane and 13 of the first 25 bodies stood
     * past `Cohorts.L3_AT` — born outline-less, the exact defect `marchBand`
     * exists to have ended. The tolerance bought that back and cost about four
     * of the nine seconds of the fall.
     *
     * `_anchor` reads `lzPoint` while the commander is riding now, so the ring
     * is drawn around the place the ship is AIMED at and does not move. The
     * whole descent is available and the wave is that much further in when the
     * ramp comes down.
     *
     * The parameter stays, and answering it is still honest: a caller that has
     * a ring and an anchor that cannot use one is exactly the state this was
     * written for, and re-deriving that from scratch the next time is how a
     * fix gets lost.
     */
    if (this.world?.arrivals?.anchorsOnLz) return false;
    return this.lzOffset > (ring || 0);
  }

  /**
   * HOW FAR THE SHIP STILL IS FROM THE PAD, ACROSS THE GROUND, in metres.
   *
   * Horizontal and not slant, because every reader of it is asking about where
   * a BODY may stand. Zero when there is no ship or no pad: an absent aircraft
   * is not a thing anything has to keep clear of, and answering `Infinity`
   * would hold the horde off for a flight that has already lost its transport.
   */
  get lzOffset() {
    const at = this.lzPoint, g = this.group;
    if (!at || !g) return 0;
    return Math.hypot(g.position.x - at.x, g.position.z - at.z);
  }

  /**
   * HOW MUCH GROUND THE SHIP KEEPS TO ITSELF, in metres.
   *
   * DERIVED, and from the one number in this file that is already an answer to
   * "how far apart are a man on the ground and this transport": `PAD_RANGE` is
   * where an extraction sets the ship down relative to the commander who called
   * it — far enough that walking to it is a walk. A body standing closer to the
   * pad than the length of that walk is a body under the hull.
   *
   * IT REJECTS NOTHING THAT SHIPS TODAY, and that is not an argument against
   * it. Every fighting level draws its wave from a ring starting well outside
   * the pad — 26 m on the tightest, 58 on geonosis — so on those levels this is
   * a guard with nothing to do. The Dojo's ring is [5, 8]; the levels that
   * exist are not the ones a placement law is for. Driven at [6, 14],
   * `tools/checks/landing.mjs` measures 9 of 24 placements asked for inside the
   * pad and none left there.
   */
  get lzRadius() { return PAD_RANGE; }

  /**
   * WHERE THE SHIP IS COMING DOWN — and null unless one actually is.
   *
   * Scoped to `landing` and NOT to `active`, and that is not tidiness. `down`
   * is the pad of the flight in progress only from the descent onward: before
   * it, on an extraction, it is still the pad on the ground you LEFT, and the
   * level changes under the aircraft in the middle of the cruise. A keep-out
   * taken from it during `transit` would be a twenty-metre circle drawn on the
   * NEW level at the OLD level's coordinates — and `_afterRotate` deploys both
   * armies inside that phase, ten bodies every time, so they are exactly what
   * would have been pushed out of a place nothing was ever landing on.
   */
  get lzPoint() { return this.landing ? (this.down || this.pad || null) : null; }

  /**
   * KEEP A PLACEMENT OFF THE PAD.
   *
   * `World.spawnEnemy` is the one door every body in the game comes through —
   * the director's direct path, every gunship's `_deliver`, and the sandbox —
   * so the rule is stated once, here, in the file that owns where the pad is,
   * and asked once, there. It PUSHES rather than rejects: a delivery has
   * already been flown and animated by the time it reaches that door, and
   * refusing it would lose the body rather than move it.
   *
   * The push is radial and keeps the bearing, so a squad that came in from the
   * east is still to the east — just off the pad — and the ground under the new
   * point is re-read, because the pad is flat and 20 m of Geonosis is not.
   */
  clearOfLZ(pos) {
    const at = this.lzPoint;
    if (!pos || !at) return pos;
    const r = this.lzRadius;
    const dx = pos.x - at.x, dz = pos.z - at.z;
    const d = Math.hypot(dx, dz);
    if (d >= r) return pos;
    /* Straight on top of the pad has no bearing to keep, so it is given one
     * rather than dividing by zero — the ship's own heading, which puts the
     * body off the nose instead of in a corner the pad picker never uses. */
    const a = d > 1e-3 ? Math.atan2(dz, dx) : this.padYaw;
    const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
    const out = pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z);
    out.set(x, this.world?.terrain ? this.world.terrain.height(x, z) : pos.y, z);
    return out;
  }

  /**
   * TAKE THE GROUND CHANGE, or decline it.
   *
   * Declining is a real answer and there are four of them: the player asked for
   * instant spawns, there is nobody to put on a ship, the world is a client
   * (the host owns the rotation and a client is TOLD where it is — see
   * `_skirmishCleared`), or one is already running. In every one of those cases
   * `World.update` falls through to the rotate it has always done, which is the
   * same shape `ArrivalDirector.request` uses: a caller that cannot be
   * choreographed still has to work.
   *
   * @returns true when this director now owns the change.
   */
  /**
   * THE OPENING — you arrive, you do not appear.
   *
   * The player, twice now: "I already told you that you should never just
   * appear, ON ANY MAP, you must always arrive and leave via transport
   * regardless of if you're with troops or not." The extraction answered the
   * journey BETWEEN two grounds; every mode still opened with the commander
   * standing on the spawn point with the level already built around them.
   *
   * This runs the other half, and it reuses everything: the same transport, the
   * same bay, the same seats, the same ramp, and the same `descent → opening →
   * unload → sealing` tail the inbound leg of an extraction uses. What it adds
   * in front of that is two phases that only exist here —
   *
   *   orbit   the bay is open on space. The capital ship is astern and
   *           receding, the planet is under the floor, and you can look at
   *           either. Nothing is asked of the player.
   *   entry   the burn. Stars go, the hull glows, the frame shakes, and the
   *           ground stops being a texture and starts being a place.
   *
   * IT DECLINES for the same four reasons `begin` does, and one more: a mode
   * with no player yet cannot fly one anywhere. Every decline leaves the world
   * exactly as it was, which is a commander standing on a spawn point — the old
   * behaviour, kept as the fallback rather than as the default.
   */
  beginInsertion(opts = {}) {
    const w = this.world;
    if (this.active) return false;
    if (!w || w.settings?.instantSpawn) return false;
    /* THE MODE GETS A SAY, and the mode table is where it says it. A room you
     * are practising in is not a place you are flown to — `MODES.training` and
     * `MODES.sandbox` set `insertion: false` and carry the argument. Absent
     * means true, so every fighting mode keeps the flight without listing it. */
    if (MODES[w.settings?.mode]?.insertion === false) return false;
    if (w.netMode === 'client') return false;
    if (!w.player || !w.player.alive) return false;
    if (!w.terrain) return false;
    this.nextKey = null;
    this.t = 0;
    this.total = 0;
    /* THE ROTATE IS ALREADY DONE. An insertion lands on the ground it started
     * on, so the swap machinery is marked complete before it begins and the
     * cruise's veil logic has nothing to wait for. */
    this._rotated = true;
    this._rotateAsked = true;
    this._skip = false;
    this._pull = null;
    this._said = false;
    this._seated.length = 0;
    this._takenSlots = new Set();
    this._log.length = 0;
    this._offloaded = false;
    this._doorTaken = false;
    this.leg = 'in';
    this._insertion = true;
    this.withdrawing = false;

    /* THE LZ IS WHERE THE LEVEL PUTS YOU. `_lzPoint` is read by `_approach`,
     * and taking it now — before anybody is lifted into a bay two kilometres up
     * — is the same discipline `_reboard` records for the same field. */
    this._lzPoint = w.player.position.clone();
    const at = this._lzPoint.clone();
    at.y = w.terrain.height(at.x, at.z);
    this.pad = at.clone();
    this.down = at.clone().setY(at.y + 1.15);
    this.padYaw = rng() * TAU;

    this._makeShip();
    /* Straight up, and pointing at the planet rather than at the pad: the first
     * thing the player sees is the bay, the stars and the capital ship, and the
     * ship noses over during the burn. */
    const away = _v1.set(Math.cos(this.padYaw), 0, Math.sin(this.padYaw));
    this.group.position.copy(at).addScaledVector(away, 320).setY(at.y + ORBIT_ALT);
    this._prevPos = null;
    this._yaw = this.padYaw + Math.PI / 2;
    this.group.rotation.set(0, this._yaw, 0);
    this._makeSpace();
    this._hatch(1);
    this._thrust = 0.25;

    /* Everybody aboard, instantly, because nobody has anywhere to have walked
     * from: the run has not started. This is the ONE place a seat may be taken
     * without a walk, and it is not a teleport — it is where the game begins. */
    for (const p of w.players) if (p?.isLocal && p.alive) this._seat(p, true);
    /* THE VIEW CARRIES OVER FROM THE DECK. main.js hands the player's look
     * relative to the hull he flew out in; the same relative look in this
     * hull is the same view — the ship astern is where he left it. */
    const hand = w._deckHandoff;
    if (hand && w.player?.camera) {
      const cam = w.player.camera;
      if (Number.isFinite(hand.lookRel)) cam.yaw = this._yaw + hand.lookRel;
      if (Number.isFinite(hand.pitch)) cam.pitch = hand.pitch;
      w._deckHandoff = null;
    }
    const team = w.player.team;
    const room = this._model?.userData?.seats?.length ?? BAY_SEATS;
    if (team !== undefined && w.enemies) {
      for (const e of w.enemies) {
        if (e.dead || e.team !== team) continue;
        if (this._seated.length >= room) break;
        this._seat(e, true);
      }
    }
    this._enter('orbit');
    w.notify?.('MAKING PLANETFALL', opts.name || w.level?.name || '');
    audio.noise?.({ dur: 4.0, gain: 0.10, type: 'lowpass', freq: 180, q: 0.7, pos: this.group.position });
    return true;
  }

  /**
   * SPACE, AS TWO OBJECTS AND NOT AS A SCENE.
   *
   * There is no second scene and no sky swap. A starfield goes in as a `Points`
   * cloud on a 900-unit shell around the transport — carried WITH it, so it can
   * never be flown out of — and the capital ship goes in astern. Both are
   * removed by `_teardown` with the rest of the flight.
   *
   * The stars are `Points` rather than a textured sphere for one reason worth
   * writing down: this file is imported by headless checks that have no canvas,
   * and `Textures.js` builds every one of its maps by drawing on one.
   */
  _makeSpace() {
    const g = this.group;
    if (!g) return;
    const N = 900;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      /* On a shell, biased AWAY from straight down: half a sky of stars under a
       * planet is the one thing that would give the trick away. */
      const u = rng() * 2 - 1, a = rng() * TAU;
      const r = 900, s = Math.sqrt(Math.max(0, 1 - u * u));
      pos[i * 3] = Math.cos(a) * s * r;
      pos[i * 3 + 1] = Math.abs(u) * r * (u < 0 ? 0.25 : 1);
      pos[i * 3 + 2] = Math.sin(a) * s * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xdfe6ff, size: 4.2, sizeAttenuation: false,
      transparent: true, opacity: 1, depthWrite: false, fog: false });
    this._stars = new THREE.Points(geo, mat);
    this._stars.frustumCulled = false;
    this._stars.renderOrder = -2;
    g.add(this._stars);

    const cap = capitalModel(this._side());
    if (cap) {
      this._capital = cap;
      cap.frustumCulled = false;
      cap.renderOrder = -1;
      g.add(cap);
    }
  }

  /** Where the capital ship is this frame. See CAPITAL_NEAR. */
  _placeCapital(k) {
    const c = this._capital;
    if (!c) return;
    const d = lerp(CAPITAL_NEAR, CAPITAL_FAR, k * k);
    /* ASTERN and a little above, in the SHIP'S OWN FRAME — so "look behind you"
     * is literally true whatever the transport is doing, which is the whole
     * instruction. +Z is aft. The hull is stood so the hangar mouth the deck
     * IS faces the transport: `userData.hangars[0]` (a point and an outward
     * normal in model units), the same mouth `DeckExterior` put on the
     * aperture, so the bay you just flew out of is the lit mouth you are
     * looking back at. */
    c.scale.setScalar(CAPITAL_SCALE);
    const h = c.userData?.hangars?.[0];
    const nx = h ? h.normal[0] : 1, ny = h ? h.normal[1] : 0, nz = h ? h.normal[2] : 0;
    _v2.set(nx, ny, nz).normalize();
    _q1.setFromUnitVectors(_v2, _v3.set(0, 0, -1));
    c.quaternion.copy(_q1);
    const px = h ? h.pos[0] : 0.9, py = h ? h.pos[1] : -0.05, pz = h ? h.pos[2] : 0.9;
    _v2.set(px, py, pz).multiplyScalar(CAPITAL_SCALE).applyQuaternion(_q1);
    c.position.set(-_v2.x, d * 0.02 - _v2.y, d - _v2.z);
    c.visible = k < 0.995;
  }

  begin(key) {
    const w = this.world;
    if (this.active) return true;
    if (!key || !w) return false;
    if (w.settings?.instantSpawn) return false;
    if (w.netMode === 'client') return false;
    if (!w.player || !w.player.alive) return false;
    if (!w.terrain) return false;
    this.nextKey = key;
    this.t = 0;
    this.total = 0;
    this._rotated = false;
    this._rotateAsked = false;
    this._skip = false;
    this._pull = null;
    this._said = false;
    this._lzPoint = null;
    this._seated.length = 0;
    this._log.length = 0;
    this.withdrawing = false;
    this._takenSlots = new Set();
    this._walkSlots = new Set();
    this._doorTaken = false;
    this._enter('aftermath');
    return true;
  }

  /**
   * ══ THE WITHDRAWAL — you call it, and the fight does not stop ═══════════
   *
   * Everything above answers "the ground is clear, take us to the next one".
   * This answers the other question, and until now the game had no way to ask
   * it: **get us out, now, with whoever can reach the ramp.**
   *
   * It is the same nine phases and the same ship. Three things differ, and each
   * of them is the point:
   *
   *   THERE IS NO AFTERMATH. `AFTERMATH` is five seconds of standing in a quiet
   *     field working out that you won. A withdrawal is called while people are
   *     shooting at you, so the sequence opens on `called` — the marker goes
   *     down the instant you ask for it.
   *
   *   THERE IS NO NEXT GROUND. `nextKey` is null, so `transit` and the rotate
   *     it carries are not reached: the run ENDS on the climb. That is what
   *     makes the call a decision rather than a convenience — you are not
   *     moving to the next area, you are going home with what you have.
   *
   *   WHO IS ABOARD IS THE OUTCOME. `_seated` is the men who walked up the ramp
   *     in the `LAST_CALL` seconds the ship holds it. Everybody else is left on
   *     the ground, and with the company persisting between runs that is the
   *     whole cost of calling late — or of calling at all with the line still
   *     out at the far end of the field.
   *
   * THE PRICE IS TIME, AND IT IS ALREADY IN THE TABLE ABOVE. `CALL` + `INBOUND`
   * is 7.4 seconds before the gear is down and `LAST_CALL` is 22 more on the
   * ramp — half a minute of holding one patch of ground, in a fight you were
   * losing badly enough to call. Nothing here needed a new number.
   *
   * @returns true when the withdrawal is now running.
   */
  withdraw() {
    const w = this.world;
    if (this.active) return false;
    if (!w || !w.terrain) return false;
    if (w.over) return false;
    if (w.netMode === 'client') return false;
    if (!w.player || !w.player.alive) return false;
    this.nextKey = null;
    this.withdrawing = true;
    this.t = 0;
    this.total = 0;
    this._rotated = false;
    this._rotateAsked = false;
    this._skip = false;
    this._pull = null;
    this._said = false;
    this._lzPoint = null;
    this._seated.length = 0;
    this._takenSlots = new Set();
    this._walkSlots = new Set();
    this._doorTaken = false;
    this._log.length = 0;
    this._enter('called');
    this._call();
    return true;
  }

  /** The roster records of the men who are on the ship — the passenger list. */
  get manifest() {
    return this._seated.map((b) => b.trooper).filter(Boolean);
  }

  _enter(phase) {
    this._log.push({ phase, at: +this.total.toFixed(3) });
    this.phase = phase;
    this.t = 0;
    this.onPhase?.(phase, this);
  }

  /* ── the frame ────────────────────────────────────────────────────── */

  update(dt, ctx) {
    /* The ship you have already left, still climbing. It is deliberately
     * OUTSIDE the `active` guard below: `_departing` only ever exists once the
     * phase is `done`, which is the point — see DEPART. */
    if (this._departing && dt > 0) this._flyAwayStep(dt);
    if (!this.active) return;
    /* THE RUN ENDED UNDER THE FLIGHT. `over` is the one flag that stops the
     * wave director, releases the pointer and raises the card, and a commander
     * killed by the last bolt in the air while the ship is on final would
     * otherwise be flown to another planet behind their own death screen.
     * `clear()` puts every passenger down where they are and takes the ship
     * out of the scene. */
    if (this.world.over) { this.clear(); return; }
    if (!(dt > 0)) return;
    this.t += dt;
    this.total += dt;
    const w = this.world;
    switch (this.phase) {
      case 'orbit': this._orbit(dt, ctx); break;
      case 'entry': this._entry(dt, ctx); break;
      case 'aftermath': this._aftermath(dt); break;
      case 'called': this._called(dt); break;
      case 'inbound': this._inbound(dt, ctx); break;
      case 'opening': this._opening(dt, ctx); break;
      case 'boarding': this._boarding(dt, ctx); break;
      case 'sealing': this._sealing(dt, ctx); break;
      case 'liftoff': this._liftoff(dt, ctx); break;
      case 'transit': this._transit(dt, ctx); break;
      case 'descent': this._descent(dt, ctx); break;
      case 'unload': this._unload(dt, ctx); break;
    }
    if (this.group) this._flyPassengers(dt);
  }

  /* ── 0. the opening ───────────────────────────────────────────────── */

  /**
   * IN SPACE, WITH THE DOORS OPEN AND THE CAPITAL SHIP ASTERN.
   *
   * Nothing is asked of the player for seven seconds. The transport holds its
   * heading, the capital ship falls away behind it, and the planet is the
   * ground the level has already built, two and a half kilometres down through
   * an open ramp. That last part is why this works at all without a second
   * scene: the world under the ship IS the battlefield, so "the planet getting
   * larger and larger" is the descent, not an effect.
   */
  /**
   * ══ MAKE ORBIT LOOK LIKE ORBIT ═════════════════════════════════════════
   *
   * The whole sequence has existed and been correct for a while — 2400 m up,
   * the capital receding from 520 m to 5200, stars on, an atmosphere entry with
   * a heat glow — and none of it could be SEEN. Reported as "you start in the
   * atmosphere and never are in space or see your capital ship getting smaller
   * in the distance", and a screenshot of the real game at 2400 m shows exactly
   * that: a bright daytime sky with cloud decks, no stars readable against it,
   * no capital ship and no planet.
   *
   * Three things were in the way, none of them the flight:
   *
   *   THE FAR PLANE is the quality tier's `viewDist` — 380/520/700/900 m — and
   *     nothing ever raised it. The capital ship spends its whole recession
   *     between 520 m and 5200 m, so it was clipped for all but the first
   *     instant of the shot that is the entire point of the sequence.
   *
   *   THE FOG is the level's own, and at geonosis' 0.0060 (0.0097 with the
   *     weather gain on it) the air is opaque long before 700 m. Space has no
   *     air in it.
   *
   *   THE SKY is the level's Preetham dome with a two-layer cloud deck, drawn
   *     at full brightness whatever altitude the camera is at. 900 stars behind
   *     a lit daytime sky are 900 invisible stars.
   *
   * So the three are taken for the two phases that are supposed to be outside
   * the atmosphere, and handed back on the way down. `k` is 0 in vacuum and 1
   * in air, so `_entry` can simply pour it back in as the ship falls and the
   * sky, the haze and the range all arrive together.
   */
  _setSpace(k) {
    const eng = this.world?.engine;
    if (!eng) return;
    const cam = eng.camera;
    const scene = eng.scene;
    if (this._sky0 === undefined) {
      // Taken once, on the way out, so a rotate or a skip cannot restore a
      // value this method wrote to itself.
      this._sky0 = {
        far: cam?.far ?? 700,
        fog: scene?.fog ? scene.fog.density : null,
        sky: eng.sky?.visible ?? true,
        dome: eng.skyDome?.mesh?.visible ?? eng.skyDome?.visible ?? true,
        bg: scene?.background ?? null,
      };
    }
    const S = this._sky0;
    const air = clamp(k, 0, 1);
    if (cam) {
      // Far enough to hold the capital at its 5200 m station, with room over it.
      const far = lerp(SPACE_FAR, S.far, air * air);
      if (Math.abs(cam.far - far) > 1) { cam.far = far; cam.updateProjectionMatrix(); }
    }
    /* Through `Atmosphere.fogScale`, not by writing `fog.density` here: that
     * class rewrites the density from its own base every frame and runs after
     * this one, so a direct write was overwritten before it was ever rendered.
     * Scaling the base leaves the weather's own arithmetic intact on the way
     * down. */
    const atmo = this.world?.atmosphere;
    if (atmo) atmo.fogScale = air * air;
    if (scene?.fog && S.fog !== null && !atmo) scene.fog.density = S.fog * air * air;
    // The sky and its clouds come back in the second half of the entry, which
    // is where the atmosphere is thick enough to be a sky at all.
    const lit = air > 0.45;
    if (eng.sky) eng.sky.visible = S.sky && lit;
    const dome = eng.skyDome?.mesh || eng.skyDome;
    if (dome && 'visible' in dome) dome.visible = S.dome && lit;
    if (scene) scene.background = lit ? S.bg : SPACE_BG;
  }

  /** Give the level its own air back, whatever happened to the flight. */
  _restoreSpace() {
    if (this._sky0 === undefined) return;
    this._setSpace(1);
    this._sky0 = undefined;
  }

  _orbit(dt, ctx) {
    const g = this.group;
    if (!g) { this._enter('entry'); return; }
    this._thrust = 0.22;
    const k = clamp(this.t / ORBIT, 0, 1);
    // Vacuum: no air, no sky, and far enough to hold the capital ship.
    this._setSpace(0);
    /* THE RAMP IS UP AND THE SIDE DOORS ARE OPEN — for the look back. The
     * deck's flight left the hangar with the bay open and the ship it left
     * filling the view; this is the same view, the same distance astern,
     * with the field's own containment shimmer in the doorway. The doors
     * shut over the last two seconds of the orbit, so the burn and the
     * descent are still flown sealed ("why would the side doors be open in
     * space?" — for as long as there is something to see, and no longer). */
    this._hatch(0);
    this._bay(1 - smoothstep(ORBIT - 2.0, ORBIT, this.t));

    /* A slow drift and a slow roll — a ship under way, not a ship parked. The
     * numbers are small because the frame of reference is the bay the player is
     * standing in, and a bay that pitches is a bay you fall out of. */
    const away = _v1.set(Math.cos(this.padYaw), 0, Math.sin(this.padYaw));
    g.position.copy(this.pad).addScaledVector(away, 320 - k * 90)
      .setY(this.pad.y + ORBIT_ALT + Math.sin(this.t * 0.4) * 6);
    g.rotation.x = Math.sin(this.t * 0.31) * 0.012;
    g.rotation.z = Math.sin(this.t * 0.23) * 0.02;
    this._placeCapital(k * 0.55);
    if (this._stars) this._stars.material.opacity = 1;
    this._wake(dt, ctx, 0);
    /* AND YOU CAN SKIP IT. The player asked for this opening on every map, and
     * meaning it costs 34 s of every deploy — so the same key that skips the
     * cruise skips the orbit, after a second and a half so it cannot be eaten
     * by a keypress left over from the menu. The sequence still HAPPENS; you
     * arrive on a ramp either way, which is the part that was asked for. */
    if (this.t > 1.5 && ctx?.input?.act?.('jump')) { this._toFall(); return; }
    if (this.t >= ORBIT) {
      this._enter('entry');
      this.world.notify?.('ATMOSPHERIC ENTRY', 'Hold on');
      audio.noise?.({ dur: 5.0, gain: 0.16, type: 'bandpass', freq: 320, q: 0.5, pos: g.position });
    }
  }

  /**
   * THE BURN — and this is the phase that has to look like something.
   *
   * Four things move together and none of them is a post-effect: the stars go
   * out as the air thickens, the hull's own thrust goes to full, the frame
   * shakes, and the ship noses over from station-keeping onto the descent. The
   * capital ship keeps receding through all of it and is gone by the end, which
   * is the "smaller and smaller" the note asks for spent across two phases
   * rather than one.
   *
   * The SHAKE is `world.addHitstop`'s sibling — `feelOn` is the game's own
   * camera-shake door and it is used rather than a private one, so a player who
   * has turned shake down in the options gets an entry they can watch.
   */
  _entry(dt, ctx) {
    const g = this.group;
    if (!g) { this._toFall(); return; }
    const k = clamp(this.t / ENTRY, 0, 1);
    /* THE AIR ARRIVES, and it is the same `k` the stars fade and the heat
     * shield lights on — so the sky, the haze and the view distance all come
     * back together as one event rather than as three switches. */
    this._setSpace(k);
    /* AND THE SHIP IS SEALED. `_hatch` was driven by `_opening`, `_unload` and
     * `_sealing` — the three phases that happen on the ground — and by nothing
     * on the way down, so the ramp and both side doors sat at whatever state
     * the model was built in for the whole descent. "Why would the side doors
     * be open in space?" They would not. A transport crosses vacuum shut. */
    this._hatch(0);

    this._thrust = 0.35 + k * 0.55;
    const away = _v1.set(Math.cos(this.padYaw), 0, Math.sin(this.padYaw));
    /* Down and forward: the altitude comes off fast and the ship closes on the
     * pad at the same time, which is what a de-orbit burn is. */
    const alt = lerp(ORBIT_ALT, ORBIT_ALT * 0.42, k * k);
    g.position.copy(this.pad).addScaledVector(away, lerp(230, 150, k)).setY(this.pad.y + alt);
    g.rotation.x = lerp(0, -0.10, smoothstep(0, 1, k)) + Math.sin(this.t * 9) * 0.006 * k;
    g.rotation.z = Math.sin(this.t * 7.3) * 0.010 * k;
    /* The stars are the first thing the air takes. */
    if (this._stars) this._stars.material.opacity = 1 - smoothstep(0, 1, clamp(k / 0.55, 0, 1));
    this._placeCapital(0.55 + k * 0.45);
    /* THE FIRE. The wash cone is already a shared, per-flight mesh with an
     * animated opacity, and re-tinted it is the heat shield: a wide envelope
     * around the hull rather than a cone under it. One mesh, two jobs, and the
     * second one lasts six seconds. */
    if (this._wash) {
      const heat = Math.sin(clamp(k * 1.35, 0, 1) * Math.PI);
      this._wash.material.opacity = heat * 0.30;
      this._wash.material.color.setHex(0xff9a4a);
      this._wash.position.set(0, 0.4, 1.2);
      this._wash.rotation.x = Math.PI;
      this._wash.scale.setScalar(0.7 + heat * 0.5);
    }
    this.world.feelOn?.('entry');
    if (this.t > 0.8 && ctx?.input?.act?.('jump')) { this._toFall(); return; }
    if (this.t >= ENTRY) this._toFall();
  }

  /** Hand the burn over to the ordinary descent, from wherever it ended. */
  _toFall() {
    /* Whichever way we left orbit — the clock, a skip, or a lost ship — the
     * level gets its own sky, haze and view distance back here. `_setSpace`
     * took them; nothing else may be left holding them. */
    this._restoreSpace();
    const g = this.group;
    if (this._stars) { this._stars.visible = false; }
    if (this._capital) { this._capital.visible = false; }
    if (this._wash) {
      this._wash.material.opacity = 0;
      this._wash.material.color.setHex(0xffffff);
      this._wash.position.set(0, -0.8, 0);
      this._wash.rotation.x = 0;
      this._wash.scale.setScalar(1);
    }
    /* `_high` is where the ship IS, so the descent picks up exactly where the
     * burn left off rather than cutting to a stock approach altitude — which
     * would be a teleport in the middle of the one sequence written to remove
     * them. `_descentDur` is FALL because this fall is eight times an
     * extraction's and at DESCENT it would be a drop. */
    this._high = g ? g.position.clone() : this.pad.clone();
    this._descentDur = FALL;
    this._hatch(0);
    this._enter('descent');
  }

  /* ── 1. the beat ──────────────────────────────────────────────────── */

  _aftermath(dt) {
    /* Deliberately silent for the first 2.2 s. The banner is the game telling
     * you the fight is over; the two seconds before it are you working that
     * out for yourself, which is the thing the player said was missing. */
    if (this.t >= 2.2 && !this._said) {
      this._said = true;
      this.world.notify?.('AREA CLEAR', 'Stand by — calling in transport');
    }
    if (this.t >= AFTERMATH) { this._said = false; this._enter('called'); this._call(); }
  }

  /* ── 2. the call ──────────────────────────────────────────────────── */

  _call() {
    const w = this.world;
    const at = this._pad();
    this.pad = at;
    audio.noise?.({ dur: 0.7, gain: 0.10, type: 'bandpass', freq: 1400, q: 4, pos: w.player?.position });
    w.notify?.('TRANSPORT INBOUND', 'Marker down — hold the LZ');
  }

  _called(dt) {
    if (this.t >= CALL) { this._enter('inbound'); this._makeShip(); }
  }

  /**
   * WHERE THE TRANSPORT SETS DOWN.
   *
   * `PAD_RANGE` out on a bearing the level allows, tested with the level's own
   * `spawnClear` so it never lands inside a column or on a lava sheet, and with
   * `bladeClear` so the RAMP is never in the commander's swing — a ship whose
   * door opens 3 m in front of a lit blade would pour six of your own men
   * through it. Twenty tries and then a straight give-up onto the commander's
   * own bearing, which is the same shape `Arrivals._sitePoint` uses.
   */
  _pad() {
    const w = this.world;
    const p = w.player;
    const a0 = p?.facing ?? 0;
    for (let i = 0; i < 20; i++) {
      const a = rng() * TAU;
      const x = p.position.x + Math.cos(a) * PAD_RANGE;
      const z = p.position.z + Math.sin(a) * PAD_RANGE;
      if (w.terrain && !w.terrain.inBounds(x, z, 12)) continue;
      if (w.terrain?.slopeAt && w.terrain.slopeAt(x, z) > 0.4) continue;
      const y = w.terrain ? w.terrain.height(x, z) : 0;
      if (!spawnClear(w, x, y, z, 3.0)) continue;
      if (!bladeClear(w, x, z)) continue;
      this.padYaw = a;
      return new THREE.Vector3(x, y, z);
    }
    const x = p.position.x + Math.sin(a0) * PAD_RANGE;
    const z = p.position.z + Math.cos(a0) * PAD_RANGE;
    this.padYaw = a0;
    return new THREE.Vector3(x, w.terrain ? w.terrain.height(x, z) : 0, z);
  }

  /* ── 3. the ship ──────────────────────────────────────────────────── */

  /**
   * WHOSE SHIP COMES — AND THIS IS THE ONLY PLACE THAT ASKS.
   *
   * The player, having played the dark side: "Ive noticed that sith side still
   * gets picked up by the same transports that belong to the republic
   * canonically". Two things had to happen for that: a Confederacy hull had to
   * exist, which is `Vehicles.js`'s business, and something had to know which
   * army the commander is leading, which is this.
   *
   * There are exactly two consumers — `_makeShip` picks the transport and
   * `_makeSpace` picks the warship it falls away from — and both call this,
   * because a side resolved twice is a side that can be resolved two different
   * ways. The other end of the decision is one table in one file; see
   * `TRANSPORT_BY_SIDE` there for why the branch is not written here.
   *
   * ── WHERE THE ANSWER COMES FROM, IN PRIORITY ORDER
   *
   * A LIVE COMMANDER'S OWN ARMY FIRST. `CommandDirector` derives it from the
   * order at construction, but a mirror match and a two-commander session
   * ASSIGN armies (`c.army = armies[i]`), so a player can legitimately be
   * leading the army their order does not imply. Reading the order in that
   * case would fly the wrong hull into a mode that had already decided.
   *
   * THEN THE ORDER, through `Databank.armyForOrder`. That is not a second
   * statement of the mapping standing beside `Command.sideForOrder` — it is
   * the SAME CALL: `sideForOrder` is `ARMIES[armyForOrder(orderId) ||
   * 'republic']`, the army record wrapped around this answer, and the record
   * is the half this file has no use for. Asking Command for it directly is
   * not available anyway: `Command.js` imports `Waves.js`, which reaches
   * `Arrivals.js`, and the cycle that closes is the one
   * `Arrivals.setDropshipModel`'s own note records being sprung — the whole
   * suite failing to load, not a warning. `Databank.js` imports nothing at
   * all, which is why both callers can reach it.
   *
   * AND A GREY GETS THE REPUBLIC, which is not a default invented here —
   * `sideForOrder` documents the identical fallback for the identical reason:
   * "somebody has to be at the head of the column".
   */
  _side() {
    const w = this.world;
    const led = w?.command?.commander?.army?.id;
    if (led) return led;
    return armyForOrder(w?.settings?.order ?? w?.player?.order) || 'republic';
  }

  /**
   * ONE SHIP, ADDED TO THE SCENE AND NOT TO `statics`.
   *
   * That single line is what makes the journey continuous across a planet
   * change. `World.unload` walks `statics` and removes every entry from the
   * scene — which is exactly right for an `ArrivalDirector` whose gunship
   * belongs to the level it is delivering onto, and exactly wrong for this one,
   * which is the only object in the frame that must NOT change when the ground
   * does. It is removed by `_finish` and by `dispose`, both of which are this
   * file's own business.
   */
  _makeShip() {
    build();
    const w = this.world;
    const g = new THREE.Group();
    g.name = 'extraction';
    g.frustumCulled = false;
    let model = transportModel(this._side());
    if (model) {
      g.add(model);
      this._model = model;
      /**
       * EVERY NOZZLE GETS A FLAME, and each one is a CONE rather than a ball.
       *
       * The player: "I don't see any engines working." Two reasons, and this
       * fixes both. There were two flares against four nozzles, so half the
       * engines were visibly dead; and each was a sphere at a fixed scale,
       * which is a glow floating near a hull rather than thrust coming out of
       * a hole. A cone rooted in the nozzle and stretched along −Z reads as
       * exhaust, and `_thrust` drives its length off what the ship is actually
       * doing — long on the climb, short on the flare, nothing on the ground.
       */
      const anchors = (model.userData?.engines || []).filter(Boolean);
      this._fires = [];
      for (const a of anchors) {
        const fire = new THREE.Mesh(G.flame, M.engine);
        fire.frustumCulled = false;
        fire.rotation.x = -Math.PI / 2;
        fire.position.z = 0.28;
        a.add(fire);
        this._fires.push(fire);
        const core = new THREE.Mesh(G.flameCore, M.engineCore);
        core.frustumCulled = false;
        core.rotation.x = -Math.PI / 2;
        core.position.z = 0.16;
        a.add(core);
        this._fires.push(core);
      }
      if (!this._fires.length) {
        const fire = new THREE.Mesh(G.flame, M.engine);
        fire.position.set(0, -0.2, 3.0); g.add(fire); this._fires.push(fire);
      }
    } else {
      const hull = new THREE.Mesh(G.hull, M.hull); g.add(hull);
      const nose = new THREE.Mesh(G.nose, M.hull); nose.position.z = -4.9; g.add(nose);
      this._fires = [];
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(G.wing, M.trim);
        wing.position.set(s * 3.2, -0.14, 0.95); g.add(wing);
        const fire = new THREE.Mesh(G.flame, M.engine);
        fire.position.set(s * 4.5, -0.22, 2.9);
        fire.rotation.x = -Math.PI / 2;
        g.add(fire);
        this._fires.push(fire);
      }
    }
    this._wash = new THREE.Mesh(G.wash, M.wash.clone());
    this._wash.frustumCulled = false;
    this._wash.renderOrder = 6;
    g.add(this._wash);

    const away = _v1.set(Math.cos(this.padYaw), 0, Math.sin(this.padYaw));
    this.approach = this.pad.clone().addScaledVector(away, 108).setY(this.pad.y + 44);
    this.down = this.pad.clone().setY(this.pad.y + 1.15);
    g.position.copy(this.approach);
    /* THE HEADING'S HISTORY IS RESET WITH THE HULL. `_face` derives the nose
     * from where the ship moved since last frame, so a hull that was just
     * placed has no history and must not be handed the previous flight's. */
    this._prevPos = null; this._yaw = undefined; this._roll = 0;
    this.group = g;
    w.scene?.add(g);
    audio.noise?.({ dur: 3.0, gain: 0.11, type: 'bandpass', freq: 240, q: 0.9, pos: this.approach });
  }

  _inbound(dt, ctx) {
    const g = this.group;
    this._thrust = 0.75;
    if (!g) { this._enter('boarding'); return; }
    const k = clamp(this.t / INBOUND, 0, 1);
    const e = smoothstep(0, 1, k);
    g.position.lerpVectors(this.approach, this.down, e * e * (3 - 2 * e));
    g.position.y = lerp(this.approach.y, this.down.y, smoothstep(0, 1, Math.pow(k, 0.62)));
    /* Nose-first and clear of the ridge — see `_face` and `_clearGround`. The
      * approach still noses UP as it flares, which is the pitch this line
      * always set; only the heading is taken away from it. */
    if (k < 0.86) this._clearGround(dt);
    this._face(dt);
    g.rotation.x = clamp(1 - k * 1.6, 0, 1) * 0.22;
    this._wake(dt, ctx, 1 - k);
    if (k >= 1) {
      this.leg = 'out';
      this._enter('opening');
      audio.thud?.(this.down, 0.8);
    }
  }

  /* ── 3b. the ramp and the doors ───────────────────────────────────── */

  /**
   * HOW OPEN THE SHIP IS, 0 TO 1, AND THE ONLY PLACE THAT DECIDES IT.
   *
   * `k` drives the ramp's hinge and both doors' travel together. The numbers
   * come off the ship — `userData.bay.back` is where the ramp is hinged and
   * how far the doors have to slide to clear the aperture — because a hatch
   * animation with its own constants is a hatch that stops matching the hull
   * the first time the hull changes.
   *
   * A model that publishes no ramp (the primitive fallback, and every headless
   * check that has not imported Levels.js) simply has nothing to move, and the
   * phases still run at their stated length so the beat sheet stays true.
   */
  _hatch(k) {
    const u = this._model?.userData;
    if (!u) return;
    const e = smoothstep(0, 1, clamp(k, 0, 1));
    /* THE RAMP TOUCHES THE GROUND. Its hinge is at the bay floor, about a
     * metre above the pad, and the leaf is 2.6 m long — so the angle that puts
     * its lip on the sand is asin(drop / length), computed rather than typed,
     * and clamped so a ship hovering high does not swing the ramp past
     * vertical. */
    if (u.ramp) {
      const drop = Math.max(0, (this.group?.position.y ?? 0) - (this.down?.y ?? 0) + 1.05);
      const angle = clamp(Math.asin(clamp(drop / 2.6, 0, 0.98)), 0.35, 1.15);
      u.ramp.rotation.x = e * angle;
    }
    const slide = 2.0;
    if (u.doorL) u.doorL.position.z = e * slide;
    if (u.doorR) u.doorR.position.z = e * slide;
    this._open = e;
  }

  /** The side doors alone, 0 shut … 1 open — the ramp is `_hatch`'s. */
  _bay(k) {
    const u = this._model?.userData;
    if (!u) return;
    const e = smoothstep(0, 1, clamp(k, 0, 1));
    if (u.doorL) u.doorL.position.z = e * 2.0;
    if (u.doorR) u.doorR.position.z = e * 2.0;
  }

  _opening(dt, ctx) {
    this._thrust = 0.10;
    this._wake(dt, ctx, 0);
    this._hatch(this.t / HATCH);
    if (this.t === dt || !this._saidOpen) {
      this._saidOpen = true;
      audio.noise?.({ dur: 1.4, gain: 0.09, type: 'bandpass', freq: 420, q: 1.4, pos: this.group?.position });
    }
    if (this.t < HATCH) return;
    this._hatch(1);
    this._saidOpen = false;
    if (this.leg === 'in') { this._enter('unload'); return; }
    this._enter('boarding');
    this.world.notify?.('BOARD THE TRANSPORT', 'Walk up the ramp');
  }

  /**
   * THE BAY IS SHUT, AND IT WILL NOT SHUT ON A LIT BLADE.
   *
   * The player asked for this by name: "because of the close quarters you would
   * have to press the button to retract your saber, would be a cool time to
   * make you actually use it." The crew simply waits, and says so — which makes
   * the retract key a thing you use in the world rather than a binding you
   * discover in a menu. It cannot strand anybody: `LAST_CALL` seconds of
   * waiting and the ship's own systems drop the blade for you, with a line
   * about it, because a mode that can be locked by a control the player has not
   * found is a mode that is broken.
   */
  _sealing(dt, ctx) {
    const w = this.world;
    const p = w.player;
    this._thrust = 0.14;
    /* ── AND IT IS ASKED ON THE WAY OUT ONLY ──────────────────────────
     *
     * `_sealing` runs on BOTH legs, and on the way IN it is the beat that
     * closes the ramp AFTER the player has already walked off it. The gate
     * below never asked which leg it was on — only "is the blade lit" — so
     * every insertion in the game ended the same way: you step off the ramp
     * onto the battlefield, ignite, and the ship you have just left demands
     * you put it away, holds the phase for BLADE_WAIT seconds, then retracts
     * your blade for you and says THE CREW DID IT FOR YOU. On a battlefield.
     * With the enemy already shooting.
     *
     * The rule this implements is about close quarters INSIDE the bay — ten
     * bodies in 2.4 m of hull with a live plasma blade among them — which is
     * a fact about boarding and nothing whatever about disembarking. So it is
     * asked on the outbound leg, where the player is actually aboard. */
    const lit = SEAL_NEEDS_BLADE_DOWN && this.leg === 'out'
      && !!p?.alive && !!p?.saber?.lit && !p.saber.physical;
    /* THE WAIT HAS ITS OWN CLOCK, and that is not a detail. The first version
     * held the phase by winding `this.t` back a frame at a time — which meant
     * `t` never grew, so the `t < LAST_CALL` that was supposed to end the wait
     * could never be reached and a player who never put the blade away held the
     * ship for ever. Measured: still on the first ground after 120 s of driven
     * play. `_sealWait` counts the standing-about; `this.t` counts the travel,
     * so the seal always takes HATCH seconds of actual movement however long
     * anybody stood there. */
    if (lit && (this._sealWait || 0) < BLADE_WAIT) {
      this._sealWait = (this._sealWait || 0) + dt;
      this._hatch(1);
      if (!this._askedBlade) {
        this._askedBlade = true;
        w.notify?.('BLADE DOWN', 'Not in the bay — put it away');
      }
      this.t -= dt;
      return;
    }
    if (lit) { p.saber.retract?.(); p.hum?.retract?.(); w.notify?.('BLADE DOWN', 'The crew did it for you'); }
    this._askedBlade = false;
    this._sealWait = 0;
    this._wake(dt, ctx, 0);
    this._hatch(1 - this.t / HATCH);
    if (this.t < HATCH) return;
    this._hatch(0);
    if (this.leg === 'in') { this._handOffDeparture(); this._finish(); return; }
    this._enter('liftoff');
    this._closeUp();
  }

  /* ── 4. the walk ──────────────────────────────────────────────────── */

  /**
   * WHERE THE RAMP'S FOOT IS — on the ground, behind the ship.
   *
   * It was the PORT SIDE DOOR at (−2.4, −1.15, 0.6), because the old hull had
   * no ramp and the only way in was a sill. The ship has a ramp now and it is
   * at the back, which is also what makes filing in read as filing in: a queue
   * up a centreline rather than eight bodies converging on one hip.
   */
  _ramp(out = _v2) {
    const g = this.group;
    const bay = this._model?.userData?.bay;
    const back = bay ? bay.back : 3.3;
    out.set(0, -1.15, back + 2.4);
    g.localToWorld(out);
    if (this.world.terrain) out.y = this.world.terrain.height(out.x, out.z);
    return out;
  }

  /** The middle of the bay floor, in world space — where a walk-in ends. */
  _bayPoint(out = _v2) {
    const bay = this._model?.userData?.bay;
    out.set(0, (bay ? bay.floor : -0.95) + 0.1, bay ? (bay.front + bay.back) / 2 : 0.85);
    this.group.localToWorld(out);
    return out;
  }

  /**
   * IS THIS BODY STANDING IN THE BAY?
   *
   * The test is the ship's own published box, in the ship's own frame, with a
   * little slack on the aperture so a body half through the door counts as in.
   * That is the whole replacement for `BOARD_RADIUS`: you are aboard when you
   * are inside the ship, not when you are near a point beside it.
   */
  _inBay(pos) {
    const bay = this._model?.userData?.bay;
    if (!bay || !this.group) return false;
    _v3.copy(pos);
    this.group.worldToLocal(_v3);
    return Math.abs(_v3.x) <= bay.halfW + 0.55
      && _v3.z >= bay.front - 0.2 && _v3.z <= bay.back + 0.9
      && _v3.y >= bay.floor - 1.4 && _v3.y <= bay.roof + 0.6;
  }

  _boarding(dt, ctx) {
    const w = this.world;
    this._thrust = 0.08;
    /* NO WASH WITH THE GEAR ON THE GROUND. `_wake`'s cone is 9 m of it and a
     * landed ship passing 1 filled a fifth of the frame with dust it was no
     * longer making. */
    this._wake(dt, ctx, 0);
    this._hatch(1);
    const ramp = this._ramp(_v2).clone();
    // your line walks to the ramp and files in, whether or not you do
    this._walkTroops(dt, ramp);
    const waiting = [];
    for (const p of w.players) {
      if (!p || !p.isLocal || !p.alive) continue;
      if (p.riding) continue;
      /* STANDING IN THE BAY, not "within 3.2 m of a point". See `_inBay`, and
       * see the player's own words on the version this replaces: "you don't
       * even walk into the ship you touch it and teleport in I guess?" */
      if (this._inBay(p.position)) { this._seat(p); continue; }
      waiting.push(p);
    }
    if (this._pull) {
      this._pull.t += dt;
      const k = clamp(this._pull.t / PULL, 0, 1);
      for (const p of this._pull.who) {
        if (!p.alive || p.riding) continue;
        p.position.lerpVectors(this._pull.from.get(p), this._bayPoint(_v1), smoothstep(0, 1, k));
        p.velocity?.set?.(0, 0, 0);
        if (k >= 1) this._seat(p);
      }
      if (k >= 1) this._pull = null;
      return;
    }
    /* ══ THE SHIP WAITS FOR THE LINE, and until a withdrawal existed nothing
     * noticed that it did not.
     *
     * `waiting` above is COMMANDERS only, so the seal fired the moment the
     * player was in the bay. On an area transition that is invisible: the men
     * left standing on the sand are rebuilt on the far side by the rotate, so
     * they arrive whatever the ship did. The one existing check that walks the
     * line aboard passes because its commander is IDLE and gets hauled at
     * `LAST_CALL`, which happens to give the queue twenty-two seconds.
     *
     * A withdrawal has no far side. Measured the first time one was driven with
     * a commander who walked briskly to his own ramp: **0 aboard, 10 left** at
     * 23 s — the ship sealed nine seconds after it landed, with the whole line
     * still walking. The feature is "take home whoever reached the ramp" and it
     * was taking home nobody, every time, unless you dawdled.
     *
     * So on a withdrawal the ramp is held for its own `LAST_CALL` while any of
     * your men are still coming, and they are LEFT rather than hauled — the
     * haul is an anti-stall for the commander, and hauling a trooper from the
     * far end of the field would make the whole decision free. Gated on
     * `withdrawing` so the transition's timing, which four checks measure, does
     * not move. */
    if (this.withdrawing && this.t < LAST_CALL && this._strandedCount() > 0) return;
    if (this.withdrawing && this.t >= LAST_CALL) this._leaveTheRest();
    if (!waiting.length) { this._enter('sealing'); return; }
    if (this.t >= LAST_CALL) {
      /* LAST CALL, and it is a HAUL and not a placement. The only way this file
       * is allowed to end a stall is with something the player watches happen
       * to them — and it hauls them UP THE RAMP INTO THE BAY now, rather than
       * onto a sill. */
      w.notify?.('LAST CALL', 'The crew is pulling you aboard');
      const from = new Map();
      for (const p of waiting) from.set(p, p.position.clone());
      this._pull = { t: 0, who: waiting.slice(), from };
    }
  }

  /** How many of your men are still on the ground and still trying to board. */
  _strandedCount() {
    const w = this.world;
    const team = w.player?.team;
    if (team === undefined || !w.enemies) return 0;
    let n = 0;
    for (const e of w.enemies) {
      if (e.dead || e.team !== team) continue;
      if (e._extracting === 'aboard' || e._extracting === 'left') continue;
      n++;
    }
    return n;
  }

  /** Last call is over: whoever is not on the ship is not coming. */
  _leaveTheRest() {
    const w = this.world;
    const team = w.player?.team;
    if (team === undefined || !w.enemies) return;
    let n = 0;
    for (const e of w.enemies) {
      if (e.dead || e.team !== team) continue;
      if (e._extracting === 'aboard' || e._extracting === 'left') continue;
      e._extracting = 'left';
      n++;
    }
    if (n) w.notify?.('THE RAMP IS UP', n === 1 ? 'One man left on the ground' : `${n} men left on the ground`);
  }

  /**
   * YOUR LINE WALKS UP THE RAMP — and it is a QUEUE now, not a convergence.
   *
   * The player: "a lot of troops have trouble getting inside". They did, and
   * the reason was geometry rather than steering. Every trooper was sent at one
   * point beside the hull and admitted within 2.4 m of it, so ten bodies
   * converged on one spot, arrived as a scrum, and shoved each other out of the
   * admission radius — the ones on the outside of the pile never got in and the
   * ship held its last call every time.
   *
   * Three waypoints instead, which is what a queue is:
   *
   *   1. the MUSTER POINT, six metres behind the ramp on the ship's centreline,
   *      offset by the trooper's own index so a line forms rather than a heap;
   *   2. the RAMP FOOT, once they are behind the ship and it is their turn;
   *   3. their SEAT, up the ramp and into the bay.
   *
   * Steered rather than placed, the way `CommandDirector` steers everything it
   * owns: `wish` and `toTarget` are the two fields `Enemy._move` reads, so
   * writing them makes the legs cycle and the body face where it is going. The
   * positional advance beside it is `_clearBlade`'s own device and is here for
   * the same reason — a trooper that is stunned or knocked down has no `wish`
   * at all, and a squad that only MOSTLY boards holds the ship every time.
   */
  _walkTroops(dt, ramp) {
    const w = this.world;
    const team = w.player?.team;
    if (team === undefined || !w.enemies) return;
    const g = this.group;
    const seats = this._model?.userData?.seats;
    const mine = [];
    for (const e of w.enemies) {
      if (e.dead || e.team !== team) continue;
      if (e._extracting === 'aboard' || e._extracting === 'left') continue;
      /* ══ A MAN WALKING TO A RAMP IS NOT FIGHTING, and until a withdrawal
       * existed nothing had to say so.
       *
       * `Enemy._think` writes `wish` every frame off `ctx.pickTarget`. This
       * method writes `wish` too, one frame earlier — `extraction.update` runs
       * at the top of `World.update` — so on any ground with a live enemy on it
       * the brain simply overwrote the walk. On an area transition the field is
       * clear by definition and there is no target to overwrite it with, which
       * is why ten men board there and why this was invisible for as long as
       * the only extraction was the one after a win.
       *
       * Measured on the first driven withdrawal: the queue closed 20.2 m to
       * 12.1 m in twenty seconds — 0.4 m/s out of a 4.2 m/s walk — and 2 of 10
       * made the ramp before the ship sealed. The other eight were walking on
       * the spot against their own brains.
       *
       * `'boarding'` is the claim, and `Enemy.update` reads it the way it reads
       * a reaction: no `_think`, no firing, and `_move` left to carry whatever
       * `wish` this method put there. */
      e._extracting = 'boarding';
      mine.push(e);
    }
    /* THE QUEUE'S ORDER IS BY DISTANCE, once, and then it is kept — a queue
     * that re-sorts every frame is a queue whose members swap places and walk
     * into each other, which is a good half of what "trouble getting inside"
     * looked like. */
    for (const e of mine) if (e._queue === undefined) e._queue = e.position.distanceToSquared(ramp);
    mine.sort((a, b) => a._queue - b._queue);

    for (let i = 0; i < mine.length; i++) {
      const e = mine[i];
      const seated = this._seated.length;
      const room = seats ? seats.length : BAY_SEATS;
      /* Inside the bay: take a place. Nobody is moved to get there — `_seat`
       * converts where they already stand into a slot. */
      if (this._inBay(e.position)) {
        if (seated < room) this._seat(e);
        else e._extracting = 'left';
        continue;
      }
      /* ══ HIS OWN SEAT, NOT THE MIDDLE OF THE BAY ═══════════════════════
       *
       * Every man in the queue was steered at `_bayPoint()` — one point, the
       * centre of the hold — so ten bodies converged on one square metre and the
       * character controller resolved them into a jam. Measured on the drifts,
       * open ground, no wall to blame: the queue closed from 11.2 m to 4.4 m
       * across the whole twenty-two seconds the ramp was held, a rate of 0.34
       * m/s out of a 4.2 m/s walk, and NOBODY BOARDED. It reads as men shuffling
       * politely into each other, because that is exactly what it is.
       *
       * `_seat` already knows how to hand out distinct slots. Reserving one per
       * man on the way in and walking him to HIS slot turns one heap into ten
       * destinations that happen to be inside the same hull — which is what a
       * stick filing aboard actually looks like. */
      /* ══ A MAN'S PLACE IN THE QUEUE IS DECIDED ONCE ════════════════════
       *
       * The role below was recomputed every frame from `i`, the man's index in
       * a list that SHRINKS as the men ahead of him board — so his target
       * flipped between "stand in line behind the ship" and "climb the ramp"
       * several times a second, and the queue spot itself moved every time the
       * index did. Measured on the drifts with everything else correct — speed
       * 4.08, no stun, no knock, grounded, a clean unit wish — the man's own
       * wish wandered (0.68,0.73) → (0.99,−0.17) → (0.37,0.93) and his net
       * travel was 0.008–0.037 m a frame against a 4.2 m/s walk. He was not
       * blocked and he was not jammed. He was turning round.
       *
       * So the role is decided once and only ever upgraded. `_boardPos` is his
       * queue place, taken from the index he had when he joined and kept, and
       * `climb` is a one-way door: a man who has been told to board is never
       * told to go and stand in line again. */
      if (e._boardPos === undefined) e._boardPos = i;
      let target;
      const dRamp = Math.hypot(ramp.x - e.position.x, ramp.z - e.position.z);
      if (e._boardRole !== 'climb'
          && (i < 4 || dRamp < BOARD_RADIUS * 2.2)) e._boardRole = 'climb';
      /* FOUR ABREAST, NOT TWO. The queue was two-wide against a bay that seats
       * ten and a ramp the ship holds for `LAST_CALL` — which is fine when the
       * field is clear and the men are already standing on the pad, and is the
       * difference between eight men and none when they are twenty metres out
       * with a wave still on the ground. Measured on a driven withdrawal from
       * 20 m: 2 of 10 aboard at two abreast. The seats are the real cap and
       * they are checked above. */
      if (e._boardRole === 'climb') {
        /* At the front of the queue, or already at the foot: climb — to his own
         * place, so ten men do not walk at one point. `_reserve` hands out the
         * same slots `_seat` does and remembers them, so the walk and the sit
         * agree about where he is going. */
        target = this._reserve(e, seats, _v1) || this._bayPoint(_v1);
      } else {
        /* Further back: stand in line behind the ramp, on the centreline. */
        _v1.set(0, -1.15, (this._model?.userData?.bay?.back ?? 3.3) + 4.0 + e._boardPos * 1.5);
        g.localToWorld(_v1);
        if (w.terrain) _v1.y = w.terrain.height(_v1.x, _v1.z);
        target = _v1;
      }
      const dx = target.x - e.position.x, dz = target.z - e.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) continue;
      const nx = dx / d, nz = dz / d;
      if (!e.wish) e.wish = new THREE.Vector3();
      e.wish.set(nx, 0, nz);
      if (!e.toTarget) e.toTarget = new THREE.Vector3();
      e.toTarget.set(nx, 0, nz);
      /* ══ THE WALK IS KINEMATIC, AND THE CONTROLLER IS TOLD TO STOP ═════
       *
       * This wrote `wish` for `Enemy._move` to walk on AND advanced the position
       * itself. The two fought and the controller won: measured on the drifts
       * with every other cause ruled out — speed 4.08, no stun, no knock,
       * grounded, a clean unit wish, the role frozen and a seat reserved per man
       * — the queue closed 11.2 m to 4.4 m over the whole twenty-two seconds the
       * ramp was held, three separate fixes changing the figures by nothing at
       * all. A push of 0.07 m a frame was arriving as 0.008.
       *
       * A body walking up a ramp into a hull is the one case in this game where
       * a character controller has nothing to contribute: there is no terrain to
       * slide on, no separation worth solving, and a queue of ten men whose
       * mutual avoidance is exactly what stops them boarding. So the boarding
       * walk is kinematic — this method owns the position, `velocity` is zeroed
       * so `_move` has nothing to integrate, and `wish` is cleared so its
       * steering has nothing to steer. The legs still cycle: `toTarget` is what
       * the animator reads for heading, and it is still written above. */
      const push = Math.min(d, 4.2 * dt);
      e.position.x += nx * push; e.position.z += nz * push;
      e.wish = null;
      e.velocity?.set?.(0, 0, 0);
      /* ON THE RAMP THE FLOOR IS THE RAMP. Clamping to terrain height all the
       * way in is what made a trooper walk THROUGH the ramp and pop up inside
       * the hull — the ship's floor is a metre off the sand. Inside the ship's
       * own footprint the body rises to meet the deck instead. */
      /* THE FLOOR IS DAMPED WHICHEVER FLOOR IT IS, and that second clause is
       * the one that mattered. The deck branch was damped and the terrain
       * branch SNAPPED, so a body that drifted a hand's width off the side of
       * the ramp fell a metre in one frame — 0.36 m of it measured, which is
       * 21 m/s and reads as exactly the pop this rewrite is here to remove.
       * One damp, one rate, both surfaces. */
      const deck = this._deckHeight(e.position);
      const floor = deck !== null ? deck
        : (w.terrain ? w.terrain.height(e.position.x, e.position.z) : e.position.y);
      e.position.y = damp(e.position.y, floor, 8, dt);
      e._syncBody?.();
    }
  }

  /**
   * THE SLOT THIS MAN IS WALKING TO, in world space, reserved once and kept.
   *
   * `_seat` picks a slot at the moment a body arrives; this picks the same kind
   * of slot at the moment it sets off, so the queue has ten destinations rather
   * than one. Reserved rather than recomputed because a target that moves
   * between frames is a body that oscillates — the same reason `_walkTroops`
   * sorts its queue once and then keeps the order.
   *
   * Falls back to null when the ship has no published seats, which is the case
   * `_seat`'s own else-branch already covers by laying bodies out in rows.
   */
  _reserve(body, seats, out) {
    if (!seats || !seats.length || !this.group) return null;
    if (body._seatSlot === undefined) {
      const taken = this._walkSlots || (this._walkSlots = new Set());
      /* Benches first and standing places after, which is the order a real
       * stick fills and the same order `_seat` uses for everybody who is not
       * the commander. */
      const order = [...seats.filter((x) => x.sit), ...seats.filter((x) => !x.sit)];
      const free = order.find((x) => !taken.has(x));
      if (!free) return null;
      taken.add(free);
      body._seatSlot = free;
    }
    const slot = body._seatSlot;
    out.set(slot.x, slot.y, slot.z);
    this.group.localToWorld(out);
    return out;
  }

  /**
   * HOW HIGH THE FLOOR IS WHERE THIS BODY IS STANDING, or null for "the ground".
   *
   * Three surfaces, and the ramp is the one that matters: it is a plane hinged
   * at the bay floor running down to the sand, so a body on it should be at the
   * height of the ramp under its feet and not at the height of the terrain
   * two metres below. Without this a trooper walking up sinks through the leaf
   * and arrives inside the belly, which reads exactly like the teleport this
   * whole rewrite exists to remove.
   */
  _deckHeight(pos) {
    const bay = this._model?.userData?.bay;
    const g = this.group;
    if (!bay || !g) return null;
    _v3.copy(pos);
    g.worldToLocal(_v3);
    if (Math.abs(_v3.x) > bay.halfW + 0.5) return null;
    if (_v3.z >= bay.front - 0.2 && _v3.z <= bay.back + 0.2) {
      _v1.set(_v3.x, bay.floor, _v3.z);
      g.localToWorld(_v1);
      return _v1.y;
    }
    const u = this._model.userData;
    const rampLen = 2.6;
    if (u.ramp && _v3.z > bay.back && _v3.z <= bay.back + rampLen * Math.cos(u.ramp.rotation.x) + 0.4) {
      const along = clamp((_v3.z - bay.back) / Math.max(0.2, rampLen * Math.cos(u.ramp.rotation.x)), 0, 1);
      _v1.set(_v3.x, bay.floor - Math.sin(u.ramp.rotation.x) * rampLen * along, _v3.z);
      g.localToWorld(_v1);
      return _v1.y;
    }
    return null;
  }

  /**
   * A PLACE IN THE BAY — AND NOTHING IS MOVED TO GET THERE.
   *
   * This is the second half of "you touch it and teleport in". The old version
   * assigned a fixed local offset on the SILL — x = ±1.45, half a body outboard
   * of the belly — and the body snapped to it from wherever it was standing.
   * Two defects in one line: a jump, and a passenger hanging off the outside of
   * an aircraft.
   *
   * Now the seat is taken from the ship's own `userData.seats` table, and the
   * body EASES to it from where it already is: `riding.local` starts as the
   * body's current position expressed in the ship's frame, and `_flyPassengers`
   * walks it to the seat over `SETTLE` seconds. A player who walked up the ramp
   * sees themselves take a step to the bench; a player hauled aboard at last
   * call sees the same step. There is no frame in which anybody is somewhere
   * they were not a moment ago.
   */
  _seat(body, instant = false) {
    if (!body || body.riding) return;
    const isPlayer = body.isLocal !== undefined;
    const seats = this._model?.userData?.seats;
    let slot;
    if (seats && seats.length) {
      /* THE COMMANDER GETS A DOOR. `_doorTaken` used to mean the port sill; it
       * means the first STANDING place now — the one on the centreline with the
       * ground going past the open door beside it, which is the shot the player
       * pointed at. Everybody else fills the benches first and stands when the
       * benches are gone, which is the order a real stick fills in. */
      const stand = seats.filter((x) => !x.sit);
      const bench = seats.filter((x) => x.sit);
      if (isPlayer && !this._doorTaken && stand.length) { this._doorTaken = true; slot = stand[0]; }
      else {
        const taken = this._takenSlots || (this._takenSlots = new Set());
        const order = isPlayer ? [...stand, ...bench] : [...bench, ...stand];
        slot = order.find((x) => !taken.has(x)) || order[0];
        taken.add(slot);
      }
    } else {
      const n = this._seated.length;
      slot = { x: (n % 2 ? 1 : -1) * 0.86, y: -0.4, z: -0.55 + Math.floor(n / 2) * 1.15,
        yaw: n % 2 ? -Math.PI / 2 : Math.PI / 2, sit: true };
    }
    /* Where they ARE, in the ship's frame — the start of the ease.
     *
     * `instant` IS `_reboard`'S CASE AND ONLY ITS CASE. On the far side of the
     * swap the world has just been rebuilt: `_afterRotate` spawned the
     * commander on the NEW ground's spawn point, which is ninety-odd metres
     * below a ship at cruise. Easing from there is a body falling out of the
     * bay for a second — measured at 148.8 m from the hull on 25 frames — so
     * the reboard puts them straight in the seat. Everybody who actually walked
     * aboard eases, which is the whole point of the ease. */
    const to = new THREE.Vector3(slot.x, slot.y, slot.z);
    if (instant) {
      body.riding = { local: to.clone(), to, yaw: slot.yaw, sit: !!slot.sit, t: 1 };
    } else {
      _v3.copy(body.position);
      this.group.worldToLocal(_v3);
      body.riding = { local: _v3.clone(), to, yaw: slot.yaw, sit: !!slot.sit, t: 0 };
    }
    body._extracting = 'aboard';
    body.velocity?.set?.(0, 0, 0);
    body.grounded = true;
    if (!isPlayer) {
      body._footSpeed = body.speed;
      body.speed = 0;
      this._seated.push(body);
    } else {
      audio.thud?.(body.position, 0.35);
      this.world.notify?.('ABOARD', slot.sit ? 'Take a seat' : 'Hold the rail');
    }
  }

  /** Everybody who is riding, put where the ship says they are. */
  _flyPassengers(dt) {
    const w = this.world;
    const g = this.group;
    const yaw = g.rotation.y;
    const move = (b) => {
      if (!b || !b.riding) return;
      /* THE EASE. `local` is where the body was when it stepped aboard and `to`
       * is its seat; over SETTLE seconds it walks the difference, in the ship's
       * own frame, so the bay moving underneath it costs nothing. Once it has
       * arrived the two are identical and this is a copy.
       *
       * This is what makes boarding continuous. The old code pinned the body to
       * a fixed offset the instant it was seated, which is a teleport of up to
       * three metres — the visible half of "you touch it and teleport in". */
      const r = b.riding;
      if (r.to && r.t < 1) {
        r.t = Math.min(1, r.t + dt / SETTLE);
        /**
         * A CONSTANT PACE, AND NOT A DAMP.
         *
         * Two attempts got this wrong in the same direction and the second is
         * the instructive one. `lerpVectors` with an alpha built out of
         * `smoothstep + dt` can exceed 1 on a long frame and overshoot; a damp
         * cannot overshoot, but it moves a FRACTION of what is left, so a body
         * that stepped aboard at the aperture with 3.9 m of bay to cross moved
         * 35 cm on its first frame — 21 m/s, which is a jump wearing an ease.
         * The distance is not known in advance and a rate that depends on it
         * cannot be bounded.
         *
         * A body crossing a bay WALKS across it. `SEAT_PACE` is metres per
         * second and the step is clamped to what is left, so the worst frame is
         * the same however far the seat is: the thing the player would call a
         * teleport is impossible by construction rather than by tuning.
         */
        _v1.subVectors(r.to, r.local);
        const left = _v1.length();
        if (left <= SEAT_PACE * dt) { r.local.copy(r.to); r.t = 1; }
        else r.local.addScaledVector(_v1.multiplyScalar(1 / left), SEAT_PACE * dt);
      }
      _v3.copy(r.local);
      g.localToWorld(_v3);
      const dx = _v3.x - b.position.x, dy = _v3.y - b.position.y, dz = _v3.z - b.position.z;
      b.position.copy(_v3);
      b.velocity?.set?.(0, 0, 0);
      b.grounded = true;
      /* The rig was posed from `position` earlier in the frame, so moving the
       * body without carrying the same delta into the root leaves the mesh a
       * frame behind — Riders.js's note, and the same 10 cm of slide. */
      /**
       * ── AND NOT FOR A PLAYER, WHOSE ROOT IS NOT WHERE THE BODY IS ────────
       *
       * This is right for an Enemy: `Enemy` writes `root.position.copy(this.position)`
       * every frame, so its root IS the body and carrying the ride's delta into
       * it keeps the mesh with the seat.
       *
       * A Player's root is the opposite. It is permanently an identity at the
       * origin, because the animator writes the pelvis in WORLD coordinates
       * onto a bone beneath it — the same convention that put the merged skin's
       * frustum bound at the origin. So this line added the ride's delta to a
       * transform that was already carrying the whole body, applying it TWICE
       * to the drawn figure while the saber, posed straight into world space
       * from `control.handPos`, stayed at 1x. Measured on a geonosis insertion:
       * hands at exactly double the body's world position, and a root that
       * never returned to zero — landed at (0.9, 0.2, 0.2). Hand-to-hilt gap at
       * rest: 0.087 m with no insertion, 0.463 m after one.
       *
       * That is the whole of "when I get off a transport my lightsaber won't be
       * connected to my hands". And the reason a dash or a jump fixes it
       * PERMANENTLY is that `Player._spinBody`'s terminal branch is the only
       * code in the game that writes `root.position.set(0,0,0)` — it runs when
       * an airborne flip completes, and one flip zeroes the root for good.
       *
       * `rootCarries` is the test, not `isLocal` or a class check: any body
       * whose animator owns its root is excluded, so a remote player and a
       * mounted rider answer the same way. Riders.js carries a byte-identical
       * copy of these three lines and the same fix.
       */
      /* MEASURED: NOBODY'S ROOT TAKES THE DELTA IN A SEAT.
       *
       * The first cut of this fix excluded only the Player, on the reasoning
       * that an Enemy's root carries its body. In a SEAT it does not: with ten
       * allies aboard a geonosis insertion, every one of their pelvises was
       * drawn at (-519, 4799, -357) against a body at (-261, 2399, -176) —
       * exactly double, the same signature the player had. While a body is
       * riding, its bones are written in world space by the animator and the
       * root is not re-copied from `position` underneath them, so adding the
       * delta here is a second full copy of the position for everyone.
       *
       * That is the whole of "you and your troops are all invisible other than
       * my lightsaber": at 2400 m the doubled figures are drawn two and a half
       * kilometres above the bay, off every screen, while the saber — posed
       * straight into world space from `control.handPos` — stays exactly where
       * it should and is the one thing left in shot.
       *
       * The `b.group` fallback below still runs: a baked group with no rig has
       * no bones writing world positions, so it genuinely does need carrying. */
      const rootCarries = false;
      if (rootCarries) b.rig.root.position.set(
        b.rig.root.position.x + dx, b.rig.root.position.y + dy, b.rig.root.position.z + dz);
      else if (b.group) b.group.position.set(
        b.group.position.x + dx, b.group.position.y + dy, b.group.position.z + dz);
      if (b.facing !== undefined && b.isLocal === undefined) b.facing = yaw + b.riding.yaw;
      b.wish = null;
      b._syncBody?.();
    };
    for (const p of w.players) move(p);
    for (const e of this._seated) if (!e.dead) move(e);
  }

  _closeUp() {
    this.world.notify?.('LIFTING', 'Hold on');
    audio.noise?.({ dur: 2.2, gain: 0.13, type: 'bandpass', freq: 190, q: 0.8, pos: this.group.position });
  }

  /* ── 5. out ───────────────────────────────────────────────────────── */

  _liftoff(dt, ctx) {
    const g = this.group;
    this._thrust = 1;
    const k = clamp(this.t / LIFT, 0, 1);
    const climb = lerp(0, 52, k * k);
    const fwd = _v1.set(Math.cos(this.padYaw), 0, Math.sin(this.padYaw)).multiplyScalar(-lerp(0, 46, k * k));
    g.position.set(this.down.x + fwd.x, this.down.y + climb, this.down.z + fwd.z);
    this._clearGround(dt);
    this._face(dt);
    g.rotation.x = -0.14 * k;
    this._wake(dt, ctx, 1 - k);
    if (k >= 1) {
      /* A WITHDRAWAL HAS NOWHERE TO CRUISE TO. `transit` exists to carry the
       * party from one ground to another and its whole content is the rotate;
       * a run that is ending has no next ground, so the climb IS the ending.
       * The ship is handed to `_departing` first so it keeps climbing behind
       * the card rather than vanishing at the moment the run closes. */
      if (this.withdrawing) { this._withdrew(); return; }
      this._enter('transit'); this._cruise0 = g.position.clone();
    }
  }

  /**
   * THE RUN ENDS ON THE CLIMB, and the manifest is the outcome.
   *
   * Read the passenger list BEFORE `_finish`, which tears the ship down and
   * with it every seat on it. `World._endWithdrawal` owns what the list means —
   * this file's job is to say who was on board when the gear came up.
   */
  _withdrew() {
    const kept = this.manifest;
    this._handOffDeparture();
    this._finish();
    this.world?._endWithdrawal?.(kept);
  }

  /* ── 6. the journey ───────────────────────────────────────────────── */

  _transit(dt, ctx) {
    const w = this.world;
    const g = this.group;
    this._thrust = 0.45;
    const dur = this._skip ? TRANSIT_MIN : TRANSIT;
    /* THE SKIP, and its one gate. `_rotated` is the rotate having COMPLETED,
     * so the cruise can never be collapsed into a stall. */
    if (!this._skip && this._rotated && ctx?.input?.act?.('jump')) {
      this._skip = true;
      this._log.push({ phase: 'skip', at: +this.total.toFixed(3) });
    }
    const span = Math.max(dur, SWAP_AT + VEIL_HOLD + 0.4);
    const k = clamp(this.t / span, 0, 1);
    const fwd = _v1.set(Math.cos(this.padYaw), 0, Math.sin(this.padYaw)).multiplyScalar(-lerp(0, 620, k));
    g.position.set(this._cruise0.x + fwd.x, this._cruise0.y + Math.sin(k * 3.1) * 6, this._cruise0.z + fwd.z);
    this._clearGround(dt);
    this._face(dt, Math.sin(this.t * 0.5) * 0.03);
    g.rotation.x = -0.06 + Math.sin(this.t * 0.7) * 0.02;

    // the cloud closes, the ground changes, the cloud opens
    const closed = smoothstep(0, 1, clamp((this.t - VEIL_IN + 0.9) / 0.9, 0, 1));
    const opened = this._rotated
      ? smoothstep(0, 1, clamp((this.t - this._rotatedAt - VEIL_HOLD) / 1.2, 0, 1)) : 0;
    this._setVeil(closed * (1 - opened));

    if (!this._rotateAsked && this.t >= SWAP_AT) { this._rotateAsked = true; this._rotate(); }
    if (k >= 1 && this._rotated) { this._enter('descent'); this._approach(); }
  }

  /**
   * THE GROUND CHANGES, INSIDE THE FLIGHT.
   *
   * `onRotate` gets first refusal exactly as `World.update` gives it — a front
   * end that wants the async door answers and returns a promise, and this waits
   * on `world.rotating` going false rather than on the promise, because the
   * synchronous door has no promise to wait on and the flag is the one signal
   * both doors raise. Everything about the player is then re-established from
   * scratch: `_afterRotate` disposed the commander that was standing in this
   * bay and spawned a new one on the new ground's spawn point, and the very
   * next thing that happens in the frame order is this director putting them
   * back in the seat — BEFORE `World.update` steps a player, which is why this
   * runs at the top of the frame and not with the props.
   */
  _rotate() {
    const w = this.world;
    const key = this.nextKey;
    const land = () => {
      this._rotated = true;
      this._rotatedAt = this.t;
      this._log.push({ phase: 'swap', at: +this.total.toFixed(3), level: w.levelKey });
      this._reboard();
      this._openMuster();
    };
    let taken = null;
    try { taken = w.onRotate?.(key); } catch (e) { taken = null; }
    if (taken && typeof taken.then === 'function') { taken.then(land, land); return; }
    if (taken) { land(); return; }
    try { w.rotateTo(key); } catch (e) { /* the world reports; the flight lands */ }
    land();
  }

  /**
   * PUT THE NEW BODIES IN THE BAY.
   *
   * The commander first, into the door seat they were already standing in. Then
   * the line: `_afterRotate` runs `CommandDirector.start`, which deploys the
   * roster around wherever the new player spawned, so on the far side of the
   * swap there is an army standing on the ground and a transport in the air
   * above it with the commander aboard. Those are the bodies the player asked
   * about — "your reinforcements still teleport in next to you" — and this is
   * where they stop doing it: they are lifted into the bay they would have
   * ridden in on and they come off the ramp with you.
   */
  _reboard() {
    const w = this.world;
    /* THE LZ IS READ HERE AND NOWHERE ELSE, because this is the one frame on
     * which `world.player.position` is the new ground's own spawn point. One
     * line later it is a seat in a bay at 96 m, written by `_flyPassengers`,
     * and `_approach` reading it then would have flown the ship to the sky it
     * was already in. */
    this._lzPoint = w.player?.position?.clone() || null;
    this._doorTaken = false;
    this._seated.length = 0;
    /* THE SLOT LEDGER IS RESET WITH THE BODIES IT TRACKS. Without this every
     * reboarded trooper found every bench already claimed by a body that no
     * longer exists and fell through to the same fallback seat. */
    this._takenSlots = new Set();
    for (const p of w.players) if (p?.isLocal && p.alive) this._seat(p, true);
    const team = w.player?.team;
    if (team === undefined || !w.enemies) return;
    const room = this._model?.userData?.seats?.length ?? BAY_SEATS;
    for (const e of w.enemies) {
      if (e.dead || e.team !== team) continue;
      if (this._seated.length >= room) break;
      this._seat(e, true);
    }
  }

  /**
   * THE MUSTER, DURING THE FLIGHT — and the brief asked whether this is
   * strictly better. It is, on three counts, and none of them is fiction:
   *
   *   the flight is 11 s of held camera with nothing to decide, which is the
   *     exact failure mode a journey has to avoid;
   *   the muster is a screen the player was ALREADY going to be shown, and it
   *     stopped the world dead to show it;
   *   picking your reinforcements on the way to the ground you will use them on
   *     is the only place in the sequence where that decision means anything.
   *
   * `_areaClear` already opened it — it sets `mustering`, recalls the army and
   * raises the card — and it did so on the frame the area was won, which is
   * before this director had even called for a ship. So there is nothing to
   * open: what this does is make sure the card is up during the cruise on the
   * far side of the swap, where `_afterRotate` may have closed it, and let
   * `CommandDirector` do exactly what it already does. The card comes down when
   * the player presses Done or when the ramp goes down, whichever is first.
   */
  _openMuster() {
    const d = this.world.command;
    if (!d || d.done || !d.mustering) return;
    const offer = d.musterOffer?.();
    if (offer) d.onMuster?.(offer);
  }

  /* ── 7. down ──────────────────────────────────────────────────────── */

  _approach() {
    const w = this.world;
    const p = w.player;
    const g = this.group;
    /* The LZ is where the new ground put the commander, which is the level's
     * own player spawn — so the ship lands you exactly where a teleport used to
     * put you, and the difference is entirely that you watched it happen. */
    const at = this._lz = this._lzPoint ? this._lzPoint.clone()
      : (p ? p.position.clone() : new THREE.Vector3());
    if (w.terrain) at.y = w.terrain.height(at.x, at.z);
    this.padYaw = rng() * TAU;
    const away = _v1.set(Math.cos(this.padYaw), 0, Math.sin(this.padYaw));
    this._high = at.clone().addScaledVector(away, 150).setY(at.y + 96);
    this.down = at.clone().setY(at.y + 1.15);
    g.position.copy(this._high);
    /* Same reset as `_makeShip`: the descent starts 150 m from where the cruise
     * ended, and a heading derived from that jump points at nothing. */
    this._prevPos = null;
  }

  _descent(dt, ctx) {
    const g = this.group;
    this._thrust = 0.55;
    /* Still shut. `_opening` is the phase that opens her, on the pad, and the
     * fall is not it — see the note in `_orbit`. */
    this._hatch(0);
    /* `_descentDur` is the insertion's, and it is longer: that fall starts at
     * a thousand metres where an extraction's starts at ninety-six. Unset for
     * every other flight, which is what `?? DESCENT` says. */
    const k = clamp(this.t / (this._descentDur ?? DESCENT), 0, 1);
    const e = smoothstep(0, 1, k);
    g.position.lerpVectors(this._high, this.down, e * e * (3 - 2 * e));
    g.position.y = lerp(this._high.y, this.down.y, smoothstep(0, 1, Math.pow(k, 0.55)));
    if (k < 0.86) this._clearGround(dt);
    this._face(dt);
    g.rotation.x = clamp(1 - k * 1.6, 0, 1) * 0.2;
    this._setVeil(0);
    this._wake(dt, ctx, 1 - k);
    if (k >= 1) {
      /* NOBODY LEAVES BEFORE THE RAMP DOES. The player asked for exactly this —
       * "you can only disembark when the ramp comes back out" — so the descent
       * lands in `opening` and `_unload` is not reachable until the leaf is
       * down. `leg` is what tells `_opening` which side of the journey it is
       * on and therefore what to hand over to. */
      this.leg = 'in';
      this._enter('opening');
      audio.thud?.(this.down, 0.9);
      this.world.notify?.(this.world.level?.name?.toUpperCase() || 'GROUND', 'Stand by — ramp coming down');
      if (!this._insertion) this._closeMuster();
    }
  }

  _closeMuster() {
    const d = this.world.command;
    if (d && d.mustering && !d._netShell) { d.autoMuster?.(); d.closeMuster?.(); }
  }

  /* ── 8. the ramp ──────────────────────────────────────────────────── */

  _unload(dt, ctx) {
    const w = this.world;
    this._thrust = 0.08;
    const k = clamp(this.t / UNLOAD, 0, 1);
    this._wake(dt, ctx, 0);
    if (!this._offloaded) {
      this._offloaded = true;
      const ramp = this._ramp(_v2).clone();
      for (const p of w.players) if (p?.riding) this._release(p, ramp, 0);
      let i = 1;
      for (const e of this._seated.slice()) if (!e.dead && e.riding) this._release(e, ramp, i++);
      this._seated.length = 0;
    }
    /* AND THE RAMP COMES BACK UP BEHIND THEM. "then the ramp retracts once the
     * troops are out, the side doors close, then the ships leave." `_sealing`
     * on the inbound leg finishes the flight instead of lifting off. */
    if (k >= 1) this._enter('sealing');
  }

  /**
   * OFF THE RAMP, AND NOT INTO THE COMMANDER'S BLADE.
   *
   * `nudgeFromSwing` is the whole of the player's second complaint — "you spawn
   * with your allies in front of your saber so you end up killing them" — and it
   * is applied at the one moment the mode puts eight bodies within four metres
   * of a lit lightsaber. The fan itself is built BEHIND the ramp rather than
   * around it, so in the ordinary case the nudge has nothing to do; it is there
   * for the case where the commander turns round on the ramp.
   */
  _release(b, ramp, i) {
    const w = this.world;
    b.riding = null;
    b._extracting = null;
    /* AND THE ROOT GOES BACK TO ZERO ON THE WAY OUT.
     *
     * `_flyPassengers` no longer writes a player's root at all, so in the
     * ordinary case there is nothing here to undo. This is the belt: any
     * residue from a mid-flight rotate, a mount handoff or a future rider path
     * is cleared at the one door every passenger leaves by, rather than waiting
     * for the airborne flip in `Player._spinBody` — which is the only other
     * code in the game that zeroes it, and which a player who never dashes
     * never reaches. A body whose root DOES carry it is left alone; its root is
     * re-copied from `position` on its own next frame. */
    if (b.rig?.root && b.isLocal !== undefined) {
      b.rig.root.position.set(0, 0, 0);
      b.rig.root.quaternion.identity();
    }
    if (b.speed === 0 && b._footSpeed) b.speed = b._footSpeed;
    if (i === 0) {
      _v3.copy(ramp);
    } else {
      const a = this.group.rotation.y + Math.PI / 2 + ((i % 2 ? 1 : -1) * (0.45 + Math.floor(i / 2) * 0.5));
      const r = 2.2 + (i % 3) * 1.1;
      _v3.set(ramp.x + Math.sin(a) * r, 0, ramp.z + Math.cos(a) * r);
    }
    /* THE NUDGE GOES LAST, AND THAT ORDER IS THE WHOLE FIX.
     *
     * It used to run first, and the out-of-bounds fallback below then reset
     * the body to the ramp — unnudged — putting it back in front of a lit
     * blade. Measured: 1 of 10 of your own men standing in the commander's
     * swing arc the moment they came off the ramp, which is exactly the
     * complaint this whole path exists to answer ("you spawn with your allies
     * in front of your saber so you end up killing them").
     *
     * So: place, clamp to the ground, and only then push clear of the swing.
     * Nothing after this line may move the body laterally again. */
    if (w.terrain && !w.terrain.inBounds(_v3.x, _v3.z, 6)) _v3.set(ramp.x, 0, ramp.z);
    nudgeFromSwing(w, _v3);
    if (w.terrain) _v3.y = w.terrain.height(_v3.x, _v3.z);
    b.position.copy(_v3);
    b.velocity?.set?.(0, 0, 0);
    b.grounded = true;
    b._syncBody?.();
  }

  /* ── the end ──────────────────────────────────────────────────────── */

  _finish() {
    this._restoreSpace();
    this._log.push({ phase: 'done', at: +this.total.toFixed(3) });
    this.phase = 'done';
    this._setVeil(0);
    this._teardown();
    this.onPhase?.('done', this);
  }

  /**
   * GIVE THE SHIP AWAY BEFORE `_finish` CAN DELETE IT.
   *
   * `_teardown` removes and disposes whatever is still hanging off `this`, so
   * everything the climb needs has to be off `this` before it runs — the group,
   * the downwash quad and the engine flares. After this call the director owns
   * no ship at all, which is what lets `active` go false on schedule.
   */
  _handOffDeparture() {
    const g = this.group;
    if (!g) return;
    this._departing = {
      group: g,
      wash: this._wash,
      fires: this._fires || [],
      t: 0,
      from: g.position.clone(),
      yaw: this.padYaw ?? 0,
      pitch: g.rotation.x,
    };
    this.group = null;
    this._wash = null;
    this._fires = null;
    this._model = null;
  }

  /** One frame of that climb. Pure set dressing — it touches nothing but itself. */
  _flyAwayStep(dt) {
    const d = this._departing;
    d.t += dt;
    const k = clamp(d.t / DEPART, 0, 1);
    // Quadratic, like `_liftoff`: a transport does not leave at a constant rate,
    // it leans on the throttle and goes. 210 m out and 240 m up is past both the
    // 130 m ink range and every level's fog, so it is gone rather than shrinking.
    const e = k * k;
    const fwd = _v1.set(Math.cos(d.yaw), 0, Math.sin(d.yaw)).multiplyScalar(-lerp(0, 210, e));
    d.group.position.set(d.from.x + fwd.x, d.from.y + lerp(0, 240, e), d.from.z + fwd.z);
    // Nose up into the climb and level off again as it goes.
    d.group.rotation.x = d.pitch - 0.18 * Math.sin(k * Math.PI);
    const flare = (1 - k * 0.3) * (1 + Math.sin(d.t * 31) * 0.14);
    for (const f of d.fires) {
      f.visible = true;
      f.scale.set(0.9 + flare * 0.3, 0.6 + flare * 2.6, 0.9 + flare * 0.3);
    }
    if (d.wash) d.wash.material.opacity = (1 - k) * 0.11;
    if (k >= 1) this._endDeparture();
  }

  /** Take the departed ship out of the scene, whenever that is decided. */
  _endDeparture() {
    const d = this._departing;
    if (!d) return;
    d.group.parent?.remove(d.group);
    d.wash?.material.dispose();
    this._departing = null;
  }

  _teardown() {
    const g = this.group;
    if (g) {
      g.parent?.remove(g);
      this._wash?.material.dispose();
    }
    if (this._stars) { this._stars.geometry.dispose(); this._stars.material.dispose(); }
    this._stars = null;
    this._capital = null;
    this._insertion = false;
    this._descentDur = null;
    this.group = null;
    this._wash = null;
    this._model = null;
    this._doorTaken = false;
    this._offloaded = false;
    this._seated.length = 0;
  }

  /** A level change or a run ending under a flight: put everybody down. */
  clear() {
    this._restoreSpace();
    /* ABOVE the `active` guard, because a departing ship is BY DEFINITION not
     * active — that is the whole trick in `_handOffDeparture`. A level change
     * under a climb-out would otherwise leave the transport parented to a scene
     * nobody disposes. */
    this._endDeparture();
    if (!this.active) return;
    const w = this.world;
    for (const p of w.players || []) if (p?.riding) { p.riding = null; p._extracting = null; }
    for (const e of this._seated) if (e && e.riding) {
      e.riding = null; e._extracting = null;
      if (e.speed === 0 && e._footSpeed) e.speed = e._footSpeed;
    }
    this.phase = 'done';
    this._setVeil(0);
    this._teardown();
  }

  dispose() {
    this.clear();
    if (this.veil) {
      this.veil.parent?.remove(this.veil);
      /* The one per-director allocation in the file, for the same reason the
       * wash cone is one per flight: its opacity is animated, so it cannot be
       * the shared material. `G.veil` is shared and stays. */
      this.veil.material.dispose();
      this.veil = null;
    }
  }

  /* ── flying it ────────────────────────────────────────────────────── */

  /**
   * POINT THE NOSE WHERE IT IS GOING.
   *
   * The player: "they fly backwards a lot." They did, and it was one sign. Every
   * phase set the heading to `padYaw + PI/2 + PI` — a constant derived from the
   * BEARING THE PAD WAS PICKED ON — and then moved the hull along a vector that
   * had nothing to do with it. Outbound, `_liftoff` and `_transit` both travel
   * along `-(cos padYaw, sin padYaw)`, which is 180° from the heading: the ship
   * climbed out and cruised the whole way to the next planet tail first.
   *
   * The heading is DERIVED from the movement now, once, in one place, from the
   * only thing that can be right about it — where the hull actually went since
   * the last frame. Below a floor speed it holds its last heading rather than
   * spinning on noise, and it turns at a rate rather than snapping, so a change
   * of course is a bank and not a cut.
   *
   * `-Z is forward` for every craft in this file, hence the +PI.
   */
  _face(dt, roll = 0) {
    const g = this.group;
    if (!g) return;
    if (!this._prevPos) { this._prevPos = g.position.clone(); return; }
    const dx = g.position.x - this._prevPos.x, dz = g.position.z - this._prevPos.z;
    this._prevPos.copy(g.position);
    const sp = Math.hypot(dx, dz);
    if (sp > 0.02) {
      const want = Math.atan2(dx, dz) + Math.PI;
      if (this._yaw === undefined) this._yaw = want;
      /* Shortest way round, so a heading that crosses ±PI does not unwind the
       * long way and put the hull broadside for half a second. */
      let d = want - this._yaw;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      this._yaw += d * Math.min(1, dt * 3.4);
      /* And it BANKS into the turn, which is the other half of reading as
       * flight rather than as a model being dragged along a spline. */
      this._roll = damp(this._roll ?? 0, clamp(-d * 2.2, -0.5, 0.5), 4, dt);
    }
    g.rotation.y = this._yaw ?? g.rotation.y;
    g.rotation.z = (this._roll ?? 0) + roll;
  }

  /**
   * AND IT DOES NOT FLY THROUGH THE MOUNTAIN.
   *
   * The player: "Also the ships fly straight through mountains a lot." The
   * flight paths are lerps between two points chosen for their ground-level
   * geometry, and the terrain between them was never consulted — so a cruise
   * that started and ended in a valley went through whatever was in the middle.
   *
   * This is a floor and not a path-finder, deliberately. It samples the ground
   * a little AHEAD of the hull as well as under it — a ship that only checks
   * where it already is has already hit the ridge — and lifts the ship to clear
   * the higher of the two by `CLEARANCE`. It only ever pushes UP: a phase that
   * wants to descend still descends, it simply cannot descend into rock.
   */
  _clearGround(dt) {
    const g = this.group;
    const t = this.world.terrain;
    if (!g || !t) return;
    _v1.set(0, 0, -1).applyEuler(g.rotation).multiplyScalar(34).add(g.position);
    const here = t.height(g.position.x, g.position.z);
    const ahead = t.inBounds?.(_v1.x, _v1.z, 0) === false ? here : t.height(_v1.x, _v1.z);
    const floor = Math.max(here, ahead) + CLEARANCE;
    if (g.position.y < floor) {
      /* Damped rather than clamped: a hard clamp against a jagged ridge makes
       * the hull stutter frame to frame, which reads worse than the collision
       * it is preventing. 9 is fast enough to clear a cliff face at cruise. */
      g.position.y = damp(g.position.y, floor, 9, dt);
      if (g.position.y < floor - CLEARANCE * 0.5) g.position.y = floor - CLEARANCE * 0.5;
    }
  }

  /* ── the two effects ──────────────────────────────────────────────── */

  _wake(dt, ctx, low) {
    const g = this.group;
    if (!g) return;
    const w = this._wash;
    const k = clamp(low, 0, 1);
    if (w) {
      w.position.set(0, -0.8, 0);
      w.material.opacity = k * 0.11;
      w.scale.setScalar(lerp(0.55, 1, k));
    }
    /**
     * THE THRUST IS DRIVEN BY WHAT THE SHIP IS DOING, which is the difference
     * between an engine and a lamp. `_thrust` is set by each phase — 1 on the
     * climb, 0.35 on the cruise, 0 with the gear on the ground — and the flicker
     * is on top of it rather than instead of it. A landed transport with four
     * jets still burning is what "I don't see any engines working" looks like
     * from the other side: they were always on, so they never read as ON.
     */
    const t = this._thrust ?? 0;
    const flare = t * (1 + Math.sin(this.total * 31) * 0.14);
    for (const f of this._fires || []) {
      f.visible = flare > 0.02;
      f.scale.set(0.9 + flare * 0.3, 0.6 + flare * 2.6, 0.9 + flare * 0.3);
    }
    if (k > 0.5 && ctx?.particles && this.pad && rng() < 0.5) {
      const a = rng() * TAU, r = 1.2 + rng() * 3.2;
      const at = this.down || this.pad;
      _v3.set(at.x + Math.cos(a) * r, at.y, at.z + Math.sin(a) * r);
      ctx.particles.sandPuff?.(_v3.clone(), 0.5 + rng() * 0.5, at.y, this.world.groundColor);
    }
  }

  /**
   * THE CLOUD, ON THE CAMERA AND NOT IN THE LEVEL.
   *
   * `engine.camera` is not a level object — `World.unload` never touches it and
   * `spawnPlayer` builds a fresh `CameraRig` around the same camera — so a mesh
   * parented to it is the one piece of geometry in this game that survives a
   * planet change without being rebuilt. Which is exactly what a mask for that
   * change has to be.
   */
  _setVeil(a) {
    const cam = this.world.engine?.camera;
    if (!cam) return;
    if (a <= 0 && !this.veil) return;
    if (!this.veil) {
      build();
      this.veil = new THREE.Mesh(G.veil, M.veil.clone());
      this.veil.frustumCulled = false;
      this.veil.renderOrder = 999;
      cam.add(this.veil);
    }
    if (this.veil.parent !== cam) { this.veil.parent?.remove(this.veil); cam.add(this.veil); }
    this.veil.material.opacity = clamp(a, 0, 1);
    this.veil.visible = a > 0.001;
  }
}
