/**
 * BATTLEFRONT BORZ — THE GUN PIT. FLAGSHIP §7's fourth verb, made into a thing
 * the battle asks of you.
 *
 * §7: "BREACH — the one thing on the field only a Jedi can touch. Twenty
 * seconds of held blade, deflecting nothing, away from your line, both bars
 * draining."
 *
 * ── WHAT ALREADY EXISTED, AND WHY IT WAS NOT THE VERB ─────────────────────
 *
 * The mechanic has been finished for a while: `BlastDoor` (src/world/Props.js)
 * has the kerf texture, the melt rate measured to a median of 18.8 s, the
 * discard-through hole, the slug that falls out and `onBreach`;
 * `magazine()` in Levels.js hangs a rank of three of them on Geonosis at the
 * toe of the stack, 76.7 m from the muster ground, with a wing wall on each
 * flank so the twenty seconds is fought in a defile; and `blast-door.mjs`
 * drives a real Player through all of it.
 *
 * What none of that is, is a VERB. Behind each of those three doors is a cache
 * of ordnance and fourteen points of war support, so the whole rank is an
 * optional errand: nothing on the field changes if you walk past it. A verb is
 * something the battle does to you until you answer it. §7 lists BREAK, TURN
 * and OPEN alongside it and every one of those is a thing you do TO the enemy
 * in the middle of a fight; BREACH was a chest.
 *
 * ── SO: A GUN BEHIND THE MIDDLE DOOR ─────────────────────────────────────
 *
 * The middle cell of the magazine holds an emplaced heavy gun. It fires on your
 * LINE — the named men, not you — from inside a duracrete casemate, through an
 * embrasure over the lintel. Three properties, and each one is the reason the
 * verb is the verb:
 *
 *   NOTHING BUT A BLADE CAN REACH IT. The gun is a prop, not an Enemy: it is
 *     not in `world.enemies`, so no bolt hit test, no Force power, no ally's
 *     rifle and no stratagem has any way to touch it, and `damage()` refuses
 *     anyway. Your ten troopers can shoot at the face all day. FLAGSHIP §4
 *     licences exactly this — "an interior may exist as a feature on an
 *     outdoor field — a bunker you breach, a downed cruiser you fight through,
 *     A GUN EMPLACEMENT" — and §7 asks for "the one thing on the field only a
 *     Jedi can touch". A body the line could kill would be a body the line
 *     kills, because ten rifles beat one gun; the casemate is what makes the
 *     answer a Jedi rather than arithmetic.
 *
 *   THE COST OF IGNORING IT IS NAMES, AND ONLY NAMES. It shoots the roster and
 *     nothing else — a record dies once and is on the fallen list forever, and
 *     that is Command's whole subject. It never shoots the PLAYER, which is a
 *     real emplacement's behaviour (a casemate gun laid on a formation engages
 *     the mass, not the one man running at it) and is also the only way the
 *     cost can be a cost: a gun that shot at you would be a gun you dodge.
 *
 *     THE FIRST CUT TOOK THE PLAYER AS A FALLBACK — "if there is no line left
 *     in the arc, shoot whoever is there" — and it broke five checks in
 *     `blast-door.mjs` on a ground it has no business being armed on. `dress`
 *     runs on every mode, so in the Trial of Waves, a roguelite, a duel or the
 *     sandbox there IS no line, the fallback fired, and an untouchable gun was
 *     putting 30-damage bursts into a lone player from 69 m. Measured: a real
 *     Player walking from the muster ground "never got within 2.4 m of the
 *     door in 45 s — closest 9.8 m", and a 75-second hold burned 41 of the 515
 *     texels a breach needs. It was not the door. It was the gun shooting the
 *     tester.
 *
 *     So the arc is the ARMY, and a gun with no army in front of it is silent
 *     — see `update`, which declines outright on a world that leads no army.
 *     That is the same line `World.loadLevel` already draws with `command`.
 *
 *   THE COST OF ANSWERING IT IS THE TWENTY SECONDS. That price is NOT
 *     re-implemented here and no bar is drained by this file. It is already
 *     what happens: the plate is 76.7 m from where your line forms up, your
 *     blade is on the metal instead of in your guard, and every bolt that
 *     arrives in the auto-guard cone while you are facing a wall costs stamina
 *     to block and Force to leave unanswered (§6's table). "Both bars
 *     draining" is an emergent consequence of standing still with your back
 *     open, and a drain written into this file would be a second, quieter
 *     answer to a question the guard already answers. What this file owes is
 *     the MEASUREMENT, and tools/checks/breach.mjs takes it.
 *
 * ── WHY IT STOPS RATHER THAN DIES ────────────────────────────────────────
 *
 * On breach the gun goes silent and stays silent. It is not destroyed, it is
 * TAKEN: the crew is dead or gone and the position is yours, which is the same
 * sentence the cache's `credit('objective')` already makes about the two doors
 * either side of it. A gun that exploded would need a wreck, a corpse and a
 * kill credit — and a kill credit on the one object in the mode you are not
 * supposed to be able to kill is exactly the accounting §6 spent a whole
 * archetype avoiding.
 *
 * ── THE NUMBERS, AND WHERE EACH ONE COMES FROM ───────────────────────────
 *
 * None of them are taste. See `GUN` below.
 */

import * as THREE from 'three';
import { BOLT_COLORS } from './Bolts.js';
import { propMaterials } from '../world/Props.js';
import { audio } from '../engine/Audio.js';
/**
 * THE SPREAD COMES OFF THE GAME'S OWN STREAM AND NOT OFF `Math.random`.
 *
 * `tools/register.mjs` pins `__SABER_SEED` before a single module is loaded
 * precisely so that two module-level streams — `rand` here and `rng` in
 * World.js — are the same on every run; its own note lists what a
 * `Math.random()` seed cost the project (an escalation check that failed in a
 * sequence and passed alone, a blast-door suite that failed a different check
 * on each of four consecutive runs). A gun that dispersed off the wall clock
 * would put this file straight back on that list, and it would do it in the
 * one check whose subject is how many men a gun takes off a roster.
 */
import { rand, clamp } from '../engine/MathUtil.js';
/* WHERE A BODY IS AIMED AT — one reader for the whole game, in the leaf module
 * that already owned "which point on this thing does a bolt go to". Combat.js
 * imports THREE, Physics, MathUtil, Bolts and Morale and nothing that reaches
 * back here, so this edge cannot be part of a cycle. */
import { aimAt } from './Combat.js';

/**
 * THE GUN, PRICED AGAINST THE LINE IT IS SHOOTING AT.
 *
 * `damage` 30 — a clone trooper is 46 hp (`ARCHETYPES.trooper`), so two hits
 *   kill one and one hit does not. That is the shape a casemate gun should
 *   have: every burst that lands is half a man, so the ledger moves visibly
 *   and never in one step. A one-shot gun would make the cost a coin toss.
 *
 * ── SUPERSEDED IN PART — THE CONTROLLED NUMBER IS AT THE TOP ─────────────
 *
 * Every figure in the note below was taken ACROSS PROCESSES and is therefore
 * not a comparison. `World.js` had no reseeder for its module-level `rng`
 * when they were taken — it has `seedWorld` now — so two runs differing in
 * any earlier draw diverge completely, and `theline` and `command` differ in
 * one because a crossing rolls a session plan and Command does not. The same
 * change read 5.4 and 3.0 of ten on that alone.
 *
 * RE-TAKEN PROPERLY. Both arms from fresh processes, identical module-init
 * phase, `LEVELS.geonosis.battlefield` pinned off in both, the only
 * difference being the two constants this session moved, 20 seeds apiece:
 *
 *     as shipped before this session   1.35 of 10   (sd 1.73)
 *     with both halved                 2.80 of 10   (sd 2.33)
 *                                      +1.45, se 0.65, z 2.24
 *
 * So the lever is real and it is SMALL — and **the target is not met**. The
 * player asked for an engagement fought without the Jedi to cost about half
 * a ten-man line; it costs 7.2 of 10. What the figures below are still good
 * for is the RANKING they establish, which the controlled run does not
 * contradict: the two sources of fire the wave's threat budget never pays
 * for are the two that move this number at all. No single figure in them
 * should be quoted.
 *
 * `every` 34.0 s — the cadence is what turns damage into a RATE, and the rate is
 *   what the choice is made of. IT WAS 3.4, THEN 7.0, THEN 14.0 — AND EVERY ONE
 *   OF THOSE WAS SET AGAINST A GUN THAT WAS SHOOTING INTO THE DIRT.
 *
 *   ── THE DIAL DID NOT MOVE; THE BUG IT WAS TUNED AROUND DID ───────────────
 *
 *   `_fire` read `_v.copy(t.position); _v.y += (t.chestY ?? 1.1)`, and `chestY`
 *   is an ABSOLUTE world height — `position.y + 1.15 * bodyScale` — so it
 *   counted the ground under the man twice. The muster formation on this ground
 *   stands at −0.84 m, so the gun was laying every round 0.80 m under the chest
 *   it was aiming at. The line-of-sight test above traced to the same wrong
 *   point, so it also declined shots it could have taken. Measured on
 *   `tools/_gunpit.mjs` — one gun, a formed-up line, nothing else on the field,
 *   600 s, the same seeds either side of the fix:
 *
 *       aim         0.80 m under the chest        →   0.25 m
 *       rounds      15 and 57 over ten minutes    →   27 and 93
 *       delivered   0.33-0.50 men a minute        →   0.64-0.74
 *       names       2 of 10                       →   5 of 10
 *
 *   So the correct aim roughly DOUBLED what this gun delivers, and 14.0 was the
 *   number chosen for a gun delivering half of that. 34.0 is 14.0 re-paid at
 *   the corrected rate. It is one number and it is a decision, so here is what
 *   it costs both ends:
 *
 *     THE LINE pays about a name and a half to an emplacement it never
 *       answers, over an engagement, instead of the 3.8 the corrected aim was
 *       charging at 14.0. Measured: an engagement fought with no Jedi at all
 *       reads 1.65 of ten survivors with the gun at 14.0 and about 5 of ten
 *       with it at 34.0 and the conscript's round at 2.0 — which is the target
 *       the player set, and it is not met at any setting of this dial alone.
 *     §7 keeps a verb, and MEASURED RATHER THAN ASSUMED, because the obvious
 *       arithmetic is wrong here. Halving the cadence does NOT halve what an
 *       isolated gun delivers: `tools/_gunpit.mjs` reads 0.64 and 0.74 men a
 *       minute at 14.0 and 0.62, 0.86 and 0.12 at 34.0 on the same seeds, and
 *       `tools/checks/breach.mjs`'s own fixed ground reads 1.51 men a minute
 *       and four of ten names in four minutes at 34.0. Two things are in front
 *       of the timer there — see the paragraph below on sight, and the fact
 *       that a man who is being shot at GOES TO GROUND, so a faster gun
 *       suppresses its own targets (93 rounds for 6 hits at 14.0 against 48
 *       rounds for 8 at 34.0 on one seed). What the cadence does set is what a
 *       whole ENGAGEMENT costs, where the line is in the open and the gun has
 *       continuous sight of it; that is where this dial was measured and that
 *       is the only claim it makes. BREACH still removes a gun that is worth a
 *       name every forty seconds of its own fire; what it no longer does is
 *       decide the engagement by itself for a player who never finds it.
 *       `tools/checks/breach.mjs` holds it on a RATE now rather than on
 *       `lost >= 1`, which is the other half of the same decision.
 *
 *   AND THE CADENCE IS NOT THE WHOLE STORY ON THIS GROUND, which is worth
 *   knowing before anybody turns it again: `update` decrements `_timer` every
 *   frame and returns WITHOUT resetting it when the line-of-sight raycasts
 *   refuse, so the gun fires the instant it can see. Measured, it gets 8-9
 *   bursts away in ten minutes at 14.0 against a theoretical 43, so for much of
 *   an engagement LINE OF SIGHT and not `every` is what is limiting it. Turning
 *   this dial past the point where sight is the binding constraint buys nothing.
 *
 *   THE OLD NOTE, kept because its measurements are sound and only their
 *   subject was a gun firing low:
 *
 *   Every earlier tally of this gun stopped on a poll for `director.mustering`,
 *   and that flag is true for less than one frame: `_areaClear` ends with "no
 *   screen wired: muster for the player and press on", so `autoMuster()` and
 *   `closeMuster()` both run inside the same `payWave` call. The window a
 *   number about this gun has to be taken over is ONE ENGAGEMENT — an area, to
 *   its muster — and nothing could see one.
 *
 *   Held open (`tools/_linehold.mjs`), area 1 of the flagship mode on this
 *   ground, no player on the field so the gun is never breached, five seeds:
 *   **silencing this one emplacement takes the survivors from 1.8 of 10 to
 *   4.8 of 10.** Three of the eight names an engagement costs are this gun's,
 *   which is what forty conscripts and the whole Confederate fill cost between
 *   them. The note below states the price it is MEANT to charge — "about one
 *   man to answer it" — and the delivered price was three times that.
 *
 *   AND IT IS THIS NUMBER RATHER THAN THE LINE'S HEALTH, which is the part
 *   worth writing down because the obvious lever was measured and refused.
 *   Billing a body with a roster record 0.65 of every hostile bolt — 54% more
 *   effective health on every man — moved the same five seeds from 1.8 to 2.8
 *   and WIPED two of them, because `CommandDirector.allyScale` prices the wave
 *   against the army that is standing: a line that lives longer meets a wave
 *   composed for a line that lived. Everything on the threat ledger is
 *   self-correcting that way. This gun is not on it — it is a prop and it is
 *   not in `world.enemies` at all — so its output is the same whether you have
 *   ten men or two, and it is one of exactly two sources of fire on this ground
 *   that the wave's budget never paid for. The other is the levy, and the two
 *   of them are five of the eight names.
 *
 *   Halving the cadence does NOT halve what it is: the round trip to breach it
 *   is still the better part of a minute, the plate is still 69 m from where
 *   the line forms up, and a burst that lands is still half a man. What
 *   changes is that ignoring it for a whole engagement costs about a name and
 *   a half instead of three.
 *
 *   The earlier note, kept because the measurement in it is sound and only its
 *   window was short: IT WAS 3.4 AND THAT WAS FAR TOO MUCH, measured
 *   by the mode lane on a full engagement rather than on this file's own bench:
 *   wrapping `Enemy.damage` and tallying every point that lands on a party-team
 *   trooper over two seeds of the flagship mode, **one gun pit was 42.8% of all
 *   damage onto the line** against forty conscripts' 46.0% and the whole
 *   Confederate fill's 11.2% — on runs where it was never breached and the
 *   roster reached 0 of 10 in 62 seconds. One emplacement doing very nearly
 *   what forty bodies do is not a prize for breaching, it is the main cause of
 *   death, and a player who never finds it loses the run to something they
 *   never saw.
 *
 *   Halving the cadence halves that share. What it is sized against now is the
 *   PLAYER'S CLOCK and not the gun's: the plate is 69 m from where the line
 *   forms up, which `blast-door.mjs` measures as about twenty seconds on foot,
 *   and the hold is another twenty-two. So the round trip is the better part of
 *   a minute, and a gun that takes a name every minute of sustained fire costs
 *   the player about one man to answer it and the rest of the area if they do
 *   not. That is a price with an answer, which is what §7 asks a verb to be.
 *
 * `reach` 120 m — the magazine is 76.7 m from the muster ground and the level's
 *   spawn ring is 58-96 m, so a gun that could not reach past 100 m would be a
 *   gun that stops mattering the moment your line steps back. It is a fixed
 *   emplacement; its whole threat is that it covers the ground you have to
 *   fight on.
 *
 * `spread` 0.028 — four times a clone trooper's 0.045? No: HALF of it. A
 *   tripod-mounted gun laid on a fixed arc is the most accurate thing on this
 *   field, and it has to be, because at 76 m the ordinary infantry spread
 *   already misses almost everything (see `Enemy.aimQuality`). A gun that
 *   missed at its own designed range would be scenery with a sound effect.
 *
 * `warmup` 2.2 s — the emplacement does not open fire the instant a body walks
 *   into its arc. It is the tell: a player who has never met one gets one
 *   ranging shot's worth of warning before the line starts losing men.
 *
 * `burst` 3 — AND THE FIRST CUT OF THIS FIRED SINGLE ROUNDS, WHICH MEASURED AS
 *   AN ERRAND. Driven against a formed-up line at 69 m with nothing else on the
 *   field: **26 rounds over 90 seconds took ONE man off a roster of ten.** The
 *   arithmetic says why and it is dispersion, not damage: 0.028 rad is ±0.97 m
 *   of lateral error at 69 m against a body 0.4 m wide, so roughly one round in
 *   five connects and two are needed for a kill. A gun that takes one name a
 *   minute and a half is a thing you walk past.
 *
 *   The fix is what an emplaced automatic weapon actually does — it fires a
 *   BURST — and not a tighter cone, which would have made it a sniper covering
 *   the whole plain with no counter but the one door. Three rounds a burst at
 *   `burstGap` is the same shape every other automatic weapon on the roster
 *   has (`ARCHETYPES.b1` is 3 at 0.11, the clone trooper 3 at 0.11), and it
 *   trebles the rounds without moving what a single round is worth.
 */
export const GUN = {
  damage: 30, every: 34.0, reach: 120, spread: 0.028, speed: 118, warmup: 2.2,
  burst: 3, burstGap: 0.14,
};

/**
 * THE BASTION, and every number here is a metre off a man 1.78 m tall.
 *
 * "It needs to be truly menacing and huge and difficult to destroy, perhaps
 * even needing a stratagem to destroy — you had made a couple of boxes with a
 * little satellite dish at the bottom of a mountain."
 *
 * That was fair. The casemate before this was 3.0 m across its face and 2.0 m
 * tall — chest-high on a standing man, with a 2.7 m tube on it. It could not
 * be menacing at that size whatever detail went on it, because the eye reads
 * threat off how much of the sky a thing takes up before it reads anything
 * else.
 *
 * IT GROWS UP RATHER THAN SIDEWAYS, and that is forced rather than chosen. The
 * revetment it stands in is 17.5 m of face carrying three doors on 1.9 m piers
 * (`magazine` in Levels.js), and a bastion wide enough to be huge would swallow
 * the two doors either side of it. So the middle bay becomes a TOWER: 8.4 m
 * across — the bay and its two piers — 11.6 m to the top of the roof slab, and
 * 5.4 m of it standing proud of the 5.0 m deck. Against a man at the foot of it
 * that is six and a half times his height, and he has to walk under the muzzle
 * to reach the door.
 *
 * `trunnionY`/`trunnionZ` are where the gun pivots in the bastion's own frame,
 * measured from the door's centre; the tube is `barrel` long and comes out
 * through an embrasure `slotW` across, which is what the shield has to cover.
 */
export const BASTION = {
  w: 8.4, h: 11.6, d: 4.6,
  trunnionY: 4.30, trunnionZ: 1.15,
  barrel: 9.0, bore: 0.56,
  slotW: 5.6, slotH: 1.70,
  /** Seconds an ion pulse holds the deflector down. Long enough to cross the
   *  76.7 m from the muster ground and still have the twenty seconds of blade
   *  the breach costs, and not much longer. */
  ionDown: 34,
};

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * The emplaced gun, as a prop.
 *
 * `FlightPack`'s shape, for the reason Riders.js gives it and Flight.js repeats:
 * `World.update` steps every entry of `world.props` once a frame, after the
 * bodies have moved, so a prop buys a per-frame tick without a line of World.js
 * changing. The duck-typed collider fields are what the blade solver and the
 * grip both walk the list looking for; every one of them here says "there is
 * nothing on this object you can interact with", which is the point.
 */
export class GunPit {
  /**
   * @param world  the World it stands in
   * @param door   the `BlastDoor` that is the way into it. The gun is silenced
   *               by that door being breached and by nothing else, so the two
   *               objects are one mechanism and are wired at construction
   *               rather than discovered later.
   */
  constructor(world, door, opts = {}) {
    this.id = 'gunpit';
    this.world = world;
    this.door = door;
    this.dead = false;
    this.kind = 'gunpit';
    this.grippable = false;
    this.generation = 0;
    /* `Infinity` is this solver's word for "unbreakable" — the same value
     * `BlastDoor.capsules` used to publish and had to stop publishing, because
     * a blade against an unbreakable capsule raises `clang` and never `grind`.
     * Here that is the wanted answer: the gun is not a thing you cut. */
    this.toughness = Infinity;
    this.hp = Infinity;
    this.body = {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
      boundingRadius: 0, mass: 0, invMass: 0, static: true,
      applyImpulse() {}, wake() {},
    };

    /** Whose side the gun is on. The army that is not the player's. */
    this.team = opts.team ?? 1;
    /** Silenced. Set once, by `door.onBreach`, and never cleared. */
    this.taken = false;
    /** Seconds of fire delivered, and men taken off the roster. The check
     *  reads both; the mode reads neither. */
    this.shots = 0;
    this.hits = 0;
    this._timer = GUN.warmup;
    /** Rounds left in the burst being fired, and the gap between them. */
    this._left = 0;
    this._gap = 0;
    this.target = null;

    /**
     * THE MUZZLE IS OUTSIDE THE DOOR, and that is a fact about casemates
     * rather than a convenience.
     *
     * A gun that fired from behind its own sealed blast door would put every
     * bolt into the inside face of the plate. Real emplaced guns do not fire
     * through their access door; they fire through an embrasure and the door is
     * how the crew gets in. So the barrel comes out of the lintel band over the
     * plate, on the outward normal of the door itself — derived from the door's
     * own quaternion, so the gun cannot end up pointing into the hill if the
     * magazine is ever re-sited.
     *
     * BOTH OFFSETS ARE MEASURED AND THE FIRST ONE WAS WRONG. At 0.55 m proud
     * the muzzle sits INSIDE the 1.4 m lintel slab the magazine's face is made
     * of — the plate stands in the middle of the reveal, so the wall is 0.7 m
     * of duracrete on either side of it — and the line-of-sight raycast below
     * therefore started inside a static box and reported no line of sight to
     * anything, ever. Measured: 60 s of a real Command world with ten troopers
     * formed up 69 m away and a live target acquired every frame, **0 shots
     * fired**. A gun that cannot see out of its own wall is a silent prop, and
     * nothing in the check that only asks whether it EXISTS would have caught
     * it. 0.95 m puts the muzzle 0.2 m clear of the outside face.
     */
    const n = _d.set(0, 0, 1).applyQuaternion(door.mesh.quaternion).normalize();
    this.facing = n.clone();

    /* ── THE BASTION DOES NOT TRAVERSE. ONLY THE GUN DOES. ──────────────
     *
     * `update` used to swing `this.group` — the whole object — to face the
     * target, and the whole object included the casemate. So the concrete
     * rotated: an eleven-metre armoured tower turning on the spot to follow a
     * trooper walking across the plain. Nobody caught it because the pit was
     * three boxes and a cylinder and a box rotating about its own centre reads
     * as a box.
     *
     * Two frames now. `group` is fixed, planted on the door's own face and
     * oriented by the door's own quaternion; `turret` is a child of it holding
     * the mantlet, the tube and the coils, and that is what tracks. `muzzle` is
     * therefore derived from the turret every frame rather than being a
     * constant, because it moves when the gun lays. */
    this.group = new THREE.Group();
    this.group.position.copy(door.mesh.position);
    this.group.quaternion.copy(door.mesh.quaternion);
    this.turret = new THREE.Group();
    /** Where the trunnions are, in the bastion's own frame. */
    /* MEASURED FROM THE DOOR'S SILL, which is the same datum the geometry uses.
     * `+height * 0.5` was the first cut and it put the trunnions 3.4 m — one
     * whole door — above the embrasure they fire through, so the tube came out
     * of a port of its own high on the face while the slot and its shield sat
     * empty underneath. A gun and its own embrasure disagreeing by the height
     * of the doorway is the kind of thing a render catches in a second and a
     * check never would. */
    this.pivot = new THREE.Vector3(0, -door.height * 0.5 + BASTION.trunnionY, BASTION.trunnionZ);
    this.turret.position.copy(this.pivot);
    this.group.add(this.turret);

    /** THE SHIELD, and it is the whole of "difficult to destroy".
     *
     * Up: the plate behind it cannot be burned — `BlastDoor.burn` refuses on
     * `warded` — so a blade on the door does nothing at all and the gun goes on
     * firing. It is not a health bar and it cannot be worn down; there is no
     * amount of blade that opens a warded door.
     *
     * Down: `ionize` collapses it for `BASTION.ionDown` seconds and the breach
     * is live. Nothing else in the game drops it — not the blade, not a bolt,
     * not the Force — so the answer to this position is a CALL, and the call is
     * the ion pulse, which is the one stratagem whose whole subject is
     * machinery. That makes the emplacement the first thing on the field that
     * needs two of the player's systems in the right order rather than one of
     * them for longer. */
    this.warded = true;
    this._down = 0;
    this._shieldT = 0;
    /* AND THE DOOR IS TOLD NOW, not on the first frame of `update`.
     *
     * `_wards` is what keeps the flag in step, and it runs from the world's own
     * tick — so between the level building this pit and the first frame being
     * stepped, the plate was UNWARDED. Anything that reads the position as it
     * is built therefore saw an open door, which is what the gate check caught
     * on its very first assertion. A position is shut from the moment it
     * exists; it does not need a frame to decide. */
    door.warded = true;

    this._build();
    this.turret.updateMatrixWorld(true);
    this.muzzle = new THREE.Vector3();
    this._readMuzzle();
    world.scene?.add(this.group);
    this.mesh = this.group;

    const prev = door.onBreach;
    door.onBreach = (d) => { this.silence(); prev?.(d); };
  }

  /**
   * THE BASTION, THE DEFLECTOR AND THE GUN.
   *
   * All of it off `propMaterials()` — duracrete, dark steel and the two glows
   * the revetment already pays for — so an eleven-metre tower costs no new
   * material and no new draw-call bin on a level whose dressing budget
   * `world-immersion` bounds.
   *
   * Everything is added to `group` EXCEPT the tube and what moves with it,
   * which go on `turret`. See the note in the constructor: the concrete used to
   * rotate.
   */
  _build() {
    const M = propMaterials();
    const B = BASTION;
    const g = this.group;
    const CRETE = M.duracrete || M.hull;
    const STEEL = M.darkSteel || M.steel || M.hull;
    const GLOW = M.glowRed || M.emissive;
    const LAMP = M.glowAmber || M.emissive;
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = g, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = shadow;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    // y is measured from the DOOR's centre, so the sill of the door is at
    // -h/2 and the deck of the revetment is 3.3 m above it.
    const sill = -this.door.height * 0.5;

    /* ── THE MASS ───────────────────────────────────────────────────────
     * One block from the sill to the roof, standing proud of the deck, plus
     * two buttresses that carry it back into the hill. A tower with no
     * buttress reads as a slab someone stood up; the batter on them is what
     * says the load goes somewhere. */
    add(box(B.w, B.h, B.d), CRETE, 0, sill + B.h * 0.5, B.d * 0.5 - 0.5);
    for (const sx of [-1, 1]) {
      add(box(1.5, B.h * 0.74, 3.4), CRETE, sx * (B.w * 0.5 - 0.2), sill + B.h * 0.36, -1.1, 0, 0, sx * 0.075);
      // the shoulder each buttress throws forward at deck height
      add(box(1.9, 1.5, 2.6), CRETE, sx * (B.w * 0.5 - 0.5), sill + 4.0, B.d * 0.5 + 0.6, 0.10, 0, sx * 0.04);
    }

    /* ── THE GLACIS ─────────────────────────────────────────────────────
     * Two plates raked back to meet at the embrasure, which is the whole of
     * why a casemate reads as armour and not as a wall: a sloped face throws a
     * shot up and over instead of taking it square. The lower one is the
     * steeper of the two, as it is on anything built to be shot at from the
     * ground. */
    const slotY = sill + B.trunnionY;
    add(box(B.w - 0.5, 4.2, 1.1), CRETE, 0, slotY + 2.30, B.d - 0.35, -0.40);
    add(box(B.w - 0.5, 3.6, 1.1), CRETE, 0, slotY - 2.05, B.d - 0.20, 0.52);

    /* ── THE EMBRASURE ──────────────────────────────────────────────────
     * Lintel, sill and two jambs, and the slot between them set BACK 0.9 m
     * into the face so the gun looks out of a shadow. A slot flush with the
     * armour is a letterbox; a recessed one is a firing port, and the reveal
     * is what makes the difference at any distance. */
    add(box(B.slotW + 2.2, 1.05, 1.5), CRETE, 0, slotY + B.slotH * 0.5 + 0.5, B.d + 0.15, -0.13);
    add(box(B.slotW + 2.2, 0.85, 1.5), CRETE, 0, slotY - B.slotH * 0.5 - 0.42, B.d + 0.20, 0.16);
    for (const sx of [-1, 1]) {
      add(box(1.35, B.slotH + 1.9, 1.5), CRETE, sx * (B.slotW * 0.5 + 0.65), slotY, B.d + 0.15);
      // the rebate inside the reveal, which is what gives the slot a depth
      add(box(0.35, B.slotH, 1.0), STEEL, sx * (B.slotW * 0.5 - 0.1), slotY, B.d - 0.55);
    }
    add(box(B.slotW, B.slotH, 0.5), STEEL, 0, slotY, B.d - 0.95, 0, 0, 0, g, false);

    /* ── THE ROOF ───────────────────────────────────────────────────────
     * A slab with an overhanging lip. The lip is 40 cm and it is the single
     * cheapest thing on this model: a top edge with a shadow under it reads as
     * a finished building and a bare corner reads as a box. */
    add(box(B.w + 0.9, 0.75, B.d + 1.1), CRETE, 0, sill + B.h + 0.3, B.d * 0.5 - 0.4);
    add(box(B.w + 1.5, 0.30, B.d + 1.7), CRETE, 0, sill + B.h + 0.78, B.d * 0.5 - 0.4);
    // the rangefinder mast and its head, off the roof at one shoulder
    add(new THREE.CylinderGeometry(0.11, 0.14, 2.6, 8), STEEL, -B.w * 0.34, sill + B.h + 2.2, 0.4);
    add(box(1.15, 0.42, 0.5), STEEL, -B.w * 0.34, sill + B.h + 3.4, 0.4, 0.18);
    add(box(0.26, 0.14, 0.10), LAMP, -B.w * 0.34, sill + B.h + 3.4, 0.68, 0.18, 0, 0, g, false);

    /* ── THE RELIEF ─────────────────────────────────────────────────────
     * Bolt courses, cable runs, heat louvres and two hazard strobes. None of
     * it changes the silhouette; all of it gives eleven metres of flat cast
     * concrete a scale to be read against, which is what a face this size
     * needs more than a small one does. */
    const bolt = new THREE.CylinderGeometry(0.085, 0.085, 0.10, 8);
    for (let i = 0; i < 11; i++) {
      const x = -B.w * 0.42 + i * (B.w * 0.84 / 10);
      add(bolt, STEEL, x, slotY + B.slotH * 0.5 + 0.5, B.d + 0.9, Math.PI / 2, 0, 0, g, false);
      add(bolt, STEEL, x, sill + B.h - 0.55, B.d + 0.02, Math.PI / 2, 0, 0, g, false);
    }
    for (const sx of [-1, 1]) {
      // the cable run up the flank into the roof
      add(box(0.24, B.h * 0.62, 0.24), STEEL, sx * (B.w * 0.5 + 0.06), sill + B.h * 0.44, B.d * 0.5 + 0.5);
      // heat louvres over the chamber, six a side
      for (let i = 0; i < 6; i++) {
        add(box(1.5, 0.13, 0.26), STEEL, sx * 2.1, slotY + 3.2 + i * 0.30, B.d + 0.34, -0.34, 0, 0, g, false);
      }
      // and the hazard strobe on the shoulder
      add(new THREE.CylinderGeometry(0.17, 0.2, 0.34, 8), STEEL, sx * (B.w * 0.5 - 0.55), sill + B.h + 0.9, B.d * 0.5);
      add(new THREE.SphereGeometry(0.15, 8, 6), GLOW, sx * (B.w * 0.5 - 0.55), sill + B.h + 1.12, B.d * 0.5, 0, 0, 0, g, false);
    }

    /* ── THE DEFLECTOR ──────────────────────────────────────────────────
     * A shell of energy across the whole face, not a pane over the slot: the
     * player has to be able to see at a glance that the position is shut, from
     * the muster ground, and a 5 m pane on an 8 m tower cannot say that.
     *
     * Two surfaces on purpose — an outer skin and an inner one at 94% — because
     * a single transparent sheet in a cel render is a flat wash. Two of them
     * give the edge a rim where the shell turns away, which is the one place a
     * field reads as curved rather than as a decal. `_shieldT` drives both.
     */
    /* A SHALLOW CAP AND NOT A BUBBLE. The first cut was a hemisphere of 5.5 m
     * standing off the face, which enclosed the tower, the ground in front of
     * it and the man walking up to it — and at 26% opacity it tinted all three
     * a flat blue-grey, so the whole emplacement read as a concrete slab
     * behind a shower screen. A field is a SURFACE the shot stops on: a
     * shallow curve, bright at the edge where it turns away, and thin enough
     * that the armour behind it is still armour.
     *
     * AND IT IS IN THE EMBRASURE, not across the whole tower. Face-wide was
     * tried next and washed eleven metres of armour to a flat pale grey — the
     * thing the player is supposed to find menacing, behind a screen. A field
     * across the SLOT says the same thing about the position being shut, in
     * the one place the eye is already going, and leaves the armour reading as
     * armour. */
    const shellGeo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42);
    this.shield = new THREE.Group();
    this.shield.position.set(0, slotY, B.d - 0.55);
    this.shield.rotation.x = Math.PI / 2;
    this.shield.scale.set(B.slotW * 0.62, 1.15, B.slotH * 0.82);
    g.add(this.shield);
    /* NOT ADDITIVE. Additive over a sunlit concrete face, through the tone
     * curve, is white — the field came out as a pale letterbox in the slot and
     * read as frosted glass. A transparent standard material keeps its own
     * colour and stays inside the cel model with everything else, which is the
     * house rule for anything that is not a hand-written effect shader. */
    const skin = (r, op) => new THREE.MeshStandardMaterial({
      color: 0x04121c, emissive: 0x2ea8ff, emissiveIntensity: r, roughness: 1, metalness: 0,
      transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false,
    });
    this._shieldMats = [skin(1.4, 0.46), skin(2.4, 0.30)];
    this.shield.add(new THREE.Mesh(shellGeo, this._shieldMats[0]));
    const inner = new THREE.Mesh(shellGeo, this._shieldMats[1]);
    inner.scale.setScalar(0.94);
    this.shield.add(inner);
    for (const m of this.shield.children) { m.castShadow = false; m.receiveShadow = false; }
    // the two projector horns it is thrown from, which are what tell the
    // player where the field comes from and therefore that it has a source
    for (const sx of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.20, 0.34, 1.5, 8), STEEL, sx * (B.w * 0.5 - 0.7), slotY - 1.5, B.d + 0.7, 0.5, 0, sx * 0.3);
      add(new THREE.SphereGeometry(0.24, 8, 6), GLOW, sx * (B.w * 0.5 - 0.86), slotY - 0.9, B.d + 1.15, 0, 0, 0, g, false);
    }

    /* ── THE GUN ────────────────────────────────────────────────────────
     * Nine metres of tube on trunnions, and what makes it read as a gun rather
     * than as a pipe is that its diameter CHANGES along its length and that
     * something is visibly holding it: a mantlet that moves with it, a jacket
     * over the chamber, a brake at the business end and two recuperators over
     * the top. All on `turret`, so they lay and the building does not.
     */
    const t = this.turret;
    this.mantlet = add(new THREE.SphereGeometry(1.55, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
      STEEL, 0, 0, 0.20, -Math.PI / 2, 0, 0, t);
    this.barrel = add(new THREE.CylinderGeometry(B.bore * 0.78, B.bore, B.barrel, 12),
      STEEL, 0, 0, B.barrel * 0.5, Math.PI / 2, 0, 0, t);
    add(new THREE.CylinderGeometry(B.bore * 1.5, B.bore * 1.5, 2.3, 12), STEEL, 0, 0, 1.25, Math.PI / 2, 0, 0, t);
    add(new THREE.CylinderGeometry(B.bore * 1.35, B.bore * 1.05, 1.15, 12), STEEL, 0, 0, B.barrel - 0.5, Math.PI / 2, 0, 0, t);
    // the brake's own vents, which is the detail that says muzzle
    for (const sx of [-1, 1]) {
      add(box(0.16, 0.5, 0.7), STEEL, sx * B.bore * 1.3, 0, B.barrel - 0.75, 0, 0, 0, t, false);
    }
    for (const sx of [-1, 1]) {
      // recuperator over the tube, and the trunnion it all pivots on
      add(new THREE.CylinderGeometry(0.19, 0.19, 2.2, 8), STEEL, sx * 0.62, 0.62, 1.5, Math.PI / 2, 0, 0, t);
      add(new THREE.CylinderGeometry(0.26, 0.26, 0.7, 10), STEEL, sx * 1.45, 0, 0.1, 0, 0, Math.PI / 2, t);
      /* THE CHARGE COILS, and they are the tell. `_fire` brightens them and
       * `update` lets them fall back, so the gun visibly loads before it
       * speaks — a fixed gun with no wind-up is a gun that kills your line
       * out of a clear sky. */
      const coil = add(new THREE.TorusGeometry(B.bore * 1.62, 0.09, 6, 14), GLOW,
        0, 0, 0.9 + sx * 0.55 + 0.55, 0, 0, 0, t, false);
      (this._coils ||= []).push(coil);
    }
  }

  /** Where the tube ends, in the world, as of this frame's lay. */
  _readMuzzle() {
    this.turret.updateMatrixWorld(true);
    this.muzzle.set(0, 0, BASTION.barrel + 0.35).applyMatrix4(this.turret.matrixWorld);
  }

  /* Nothing on this object is a target. Every one of these is the answer the
   * blade solver, the grip and the bolt sweep need to leave it alone. */
  capsules(out = []) { out.length = 0; return out; }
  cut() { return []; }
  shatter() {}
  damage() { return false; }

  /** The door is open. The position is taken and the gun never speaks again. */
  silence() {
    if (this.taken) return;
    this.taken = true;
    this.warded = false;
    this._down = 0;
    if (this.door) this.door.warded = false;
    if (this.shield) this.shield.visible = false;
    this.target = null;
    this.world?.notify?.('THE GUN IS OURS', 'the emplacement is silent');
  }

  /**
   * WHO IT SHOOTS AT — the line, and the player only if the line is not there.
   *
   * The roster's LIVING BODIES first, by distance, because the whole content of
   * the emplacement is that leaving it standing costs you names. `world.enemies`
   * is the list every body on the field is in — in this mode your own troopers
   * are Enemy instances too, which is what makes one loop enough.
   */
  _acquire() {
    const w = this.world;
    const mine = w?.partyTeam ?? 0;
    let best = null, bestD = GUN.reach * GUN.reach;
    for (const e of w.enemies) {
      if (!e || e.dead || (e.team ?? 1) !== mine) continue;
      const d = e.position.distanceToSquared(this.muzzle);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /**
   * AN ION PULSE COLLAPSES THE DEFLECTOR. Nothing else does.
   *
   * Called by `Stratagems.ionPulse`, which sweeps the prop list for anything
   * that answers to this — the same call that stops every machine inside
   * twenty-two metres, on the one position where stopping the machine is the
   * point. A blade cannot do it, a bolt cannot, and neither can the Force: a
   * shield that anything could take down would make the second stage optional,
   * and an optional stage is the errand this whole emplacement exists to stop
   * being.
   */
  ionize(seconds = BASTION.ionDown) {
    if (this.taken || this.dead) return false;
    const was = this.warded;
    this._down = Math.max(this._down, seconds);
    this.warded = false;
    /* AND THE DOOR IS TOLD HERE TOO, for the constructor's reason at the other
     * end of the same flag: `_wards` syncs it from the world's tick, so between
     * the pulse landing and the next frame the plate still read as warded. A
     * player who called the strike and ran does not notice a sixteenth of a
     * second; anything that asks the question in the same breath as the call
     * does, and the gate check is one of those. The flag is written wherever
     * the state changes, and `_wards` is the thing that keeps it true rather
     * than the thing that makes it so. */
    if (this.door) this.door.warded = false;
    if (was) {
      this.world?.notify?.('THE SHIELD IS DOWN', `${Math.round(seconds)} seconds — get a blade on that door`);
      audio.explosion?.(this.muzzle, 1.4);
    }
    return true;
  }

  /** The deflector, the coils, and the one flag the door reads. */
  _wards(dt) {
    if (this._down > 0) {
      this._down -= dt;
      if (this._down <= 0) {
        this._down = 0;
        if (!this.taken) {
          this.warded = true;
          this.world?.notify?.('THE SHIELD IS BACK', 'the emplacement is sealed again', 'threat');
        }
      }
    }
    /* THE DOOR READS ONE FLAG AND IT IS THIS ONE. `BlastDoor.burn` refuses
     * while `warded`, so the twenty seconds of blade cannot even begin until
     * the field is down — which is what makes the ion pulse the first stage of
     * a two-stage answer rather than a convenience. */
    const shut = this.warded && !this.taken;
    if (this.door) this.door.warded = shut;
    this._shieldT += dt;
    if (this.shield) {
      this.shield.visible = shut;
      if (shut) {
        /* A field that sat at one brightness would be a painted dome. It
         * breathes, and it breathes SLOWLY — a fast flicker reads as damage
         * and this thing is not damaged, it is holding. */
        const b = 1 + Math.sin(this._shieldT * 1.7) * 0.22;
        this._shieldMats[0].emissiveIntensity = 1.4 * b;
        this._shieldMats[1].emissiveIntensity = 2.4 * b;
      }
    }
    // the charge coils fall back between rounds; `_fire` puts them up
    if (this._coils) {
      this._glow = Math.max(0, (this._glow ?? 0) - dt * 1.6);
      for (const c of this._coils) c.material.emissiveIntensity = 1.2 + this._glow * 5.0;
    }
  }

  update(dt) {
    if (!(dt > 0) || this.dead) return;
    this._wards(dt);
    if (this.taken) return;
    /* NO ARMY, NO GUN. `world.command` is the director when the mode leads one
     * — Command, a skirmish, a campaign or a contingent — and it is null in
     * every other mode. The emplacement is FLAGSHIP §7's verb and §7's verb
     * belongs to the mode with a line in it; on a ground being fought over by
     * a lone Jedi there is nothing here for a gun to be laid on. See the note
     * at the head of this file for the five checks that taught it. */
    if (!this.world?.command) return;
    if (this.door?.opened) { this.silence(); return; }
    const t = (this.target && !this.target.dead && (this.target.alive ?? true)
      && this.target.position.distanceToSquared(this.muzzle) < GUN.reach * GUN.reach)
      ? this.target : this._acquire();
    this.target = t;
    if (!t) return;

    /* The barrel tracks whether or not it is about to fire. A gun that only
     * moved on the frame it shot would read as a decal three seconds out of
     * every four.
     *
     * THE TURRET LAYS AND THE BUILDING DOES NOT — see the constructor. The aim
     * is a WORLD direction and the turret is a child of a rotated group, so it
     * is taken into the bastion's own frame first; rotating a child by a world
     * vector is the bug where a gun on a wall facing south tracks correctly
     * only when the wall faces north. */
    _d.subVectors(t.position, this.muzzle);
    if (_d.lengthSq() > 1e-4) {
      _d.normalize().applyQuaternion(_q.copy(this.group.quaternion).invert());
      /* Clamped to the arc the embrasure actually gives it. A casemate gun has
       * about 30 degrees of traverse and it is why a casemate has flanks worth
       * walking round to; one that could swing 180 degrees would be a turret
       * with a wall in front of it. */
      _d.y = clamp(_d.y, -0.42, 0.42);
      if (_d.z < 0.30) { _d.z = 0.30; }
      _d.normalize();
      this.turret.quaternion.setFromUnitVectors(_v.set(0, 0, 1), _d);
    }
    this._readMuzzle();

    /* MID-BURST, and the burst finishes on the target it was laid on. A gun
     * that re-acquired between rounds would walk its own three across two
     * different men and hit neither — the whole value of a burst is that the
     * second and third rounds arrive where the first one was aimed. */
    if (this._left > 0) {
      this._gap -= dt;
      if (this._gap <= 0) { this._gap = GUN.burstGap; this._left--; this._fire(t); }
      return;
    }
    this._timer -= dt;
    if (this._timer > 0) return;
    /**
     * …AND ONLY IF IT CAN SEE. The gun stands over a lintel with a wing wall on
     * each flank, a butte behind it and a plain in front, and a fixed
     * emplacement firing every 3.4 seconds into the inside of its own defile
     * would be spending the mode's whole cost budget on the terrain.
     *
     * Both raycasts are the ones `Enemy._hasLineOfSight` uses, in the same
     * order and for the same reason — the static boxes first because they are
     * the cheap test, the heightfield second — and the 0.6 m short of the
     * target is that method's own margin: a ray that ran the whole way would
     * be stopped by the body's own physics proxy.
     */
    const w = this.world;
    aimAt(t, _v);
    _d.subVectors(_v, this.muzzle);
    const range = _d.length();
    _d.multiplyScalar(1 / range);
    if (w.physics?.raycast?.(this.muzzle, _d, range - 0.6, (b) => b.static)) return;
    if (w.terrain && w.terrain.raycast(this.muzzle, _d, range - 0.6) !== null) return;
    this._timer = GUN.every;
    this._left = Math.max(1, GUN.burst) - 1;
    this._gap = GUN.burstGap;
    this._fire(t);
  }

  _fire(t) {
    const bolts = this.world?.bolts;
    if (!bolts) return;
    /**
     * ── THE TELL IS EVERY MACHINE'S; THE ROUND IS THE HOST'S ────────────────
     *
     * This gun is built by the LEVEL, so every machine in a session has one and
     * every machine was firing it. That is the same defect `World._boltHurt` is
     * about, one layer further out: the host's rounds already cross as events
     * in the snapshot and are spawned into the client's own pool, so a client
     * that also fired its own copy put TWO guns on one embrasure — a second
     * burst nobody on the host had fired, laid on a target its own copy of the
     * line had chosen, and then billed back to the host as damage by
     * `_reconcileClaims`. Measured on a co-op Command pair with the joining
     * player idle: a 30.5 hp claim against a named trooper, from a gun the
     * host's own copy had already fired at somebody else.
     *
     * The BARREL still tracks off-host — that is in `update` and it is what the
     * gun looks like — and the tell still fires, because a gun the player never
     * finds is a gun the player loses the run to without ever seeing it (the
     * mode lane's tally had this emplacement at 42.8% of everything that killed
     * the line on runs where nobody went near it) and a joining player is a
     * player. What stops here is the round, the noise and the flash, all three
     * of which arrive from the host as a replicated bolt.
     *
     * ONCE, off `_told` rather than off `shots`: a line of HUD text every seven
     * seconds is not a tell, it is a nag, and `shots` has to stay the count of
     * rounds this gun actually fired — `tools/checks/breach.mjs` reads it.
     */
    if (!this._told) {
      this._told = true;
      this.world?.notify?.('EMPLACED GUN', 'the revetment is firing on your line', 'threat');
    }
    if (this.world.netMode === 'client') return;
    /* Aim at the chest and lead the target, exactly as `Enemy._shoot` does:
     * a fixed gun that fired at a man's feet where he was standing last frame
     * would never hit a line that is walking.
     *
     * ── AND IT WAS FIRING OVER THEIR HEADS BY THE HEIGHT OF THE GROUND ──────
     *
     * This read `_v.copy(t.position); _v.y += (t.chestY ?? 1.1)`. `chestY` is
     * `position.y + 1.15 * bodyScale` — an ABSOLUTE world height, not an offset
     * — so adding it to `position.y` counted the terrain under the man TWICE.
     * On a flat floor at y = 0 that is exactly right and on nothing else is it
     * right at all: the mode generates a heightfield per seed
     * (`Battlefield.js`), and a line standing 3 m up was being shot at 3 m over
     * its own heads. That is one half of why an isolated arm of `breach.mjs`
     * scored 1 of 10 names in 90 s and flaked on the next run.
     *
     * `aimAt` is the reader, called and not restated (HANDOFF §2.4); the same
     * arithmetic written out a second time here is what got it wrong.
     */
    aimAt(t, _v);
    const range = _v.distanceTo(this.muzzle);
    if (t.velocity) _v.addScaledVector(t.velocity, range / GUN.speed);
    _d.subVectors(_v, this.muzzle).normalize();
    _d.x += (rand() - 0.5) * GUN.spread;
    _d.y += (rand() - 0.5) * GUN.spread * 0.7;
    _d.z += (rand() - 0.5) * GUN.spread;
    _d.normalize();
    bolts.fire(this.muzzle, _d, {
      speed: GUN.speed, damage: GUN.damage, color: BOLT_COLORS.red,
      /* THE OWNER IS THIS OBJECT, and that is what makes the shot legal.
       * `World._boltHitTest` asks `canHarm(bolt.owner, victim, rules)`, which
       * reads a `team` — so a bolt with no owner would be sorted by team alone
       * and could not be aimed at an ally of the firer, and a bolt owned by
       * nothing at all would be refused. The gun is its own shooter. */
      owner: this, team: this.team, big: true, length: 2.4, radius: 0.1,
    });
    this.shots++;
    this._glow = 1;                 // the charge coils, read down by `_wards`
    audio.blaster?.(this.muzzle, true);
    this.world.particles?.plasma?.spawn(this.muzzle, _v.set(0, 0, 0), {
      life: 0.09, size: 0.9, drag: 1, gravity: 0, color: 0xff3020, alpha: 1 });
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.group.parent?.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
    const i = this.world.props.indexOf(this);
    if (i >= 0) this.world.props.splice(i, 1);
  }
  dispose() { this.destroy(); }
}

/**
 * Put a gun behind this door.
 *
 * Returns the pit, or null if there is no door to put one behind — a level that
 * hangs no blast doors gets no emplacement and pays nothing for the fact.
 */
export function emplaceGun(world, door, opts = {}) {
  if (!world || !door || !door.mesh) return null;
  const pit = new GunPit(world, door, opts);
  if (world.addProp) world.addProp(pit);
  else if (world.props) world.props.push(pit);
  /* THE DEAD ONES GO. `World.unload` destroys every prop and a `GunPit`
   * splices itself out of `world.props`, but this second list is the level's
   * own and nothing was clearing it — so a World that loaded geonosis twice
   * would report two emplacements, one of them a disposed object, and the
   * check that counts them would read the reload rather than the ground. */
  world.gunPits = (world.gunPits || []).filter((g) => g && !g.dead);
  world.gunPits.push(pit);
  return pit;
}
