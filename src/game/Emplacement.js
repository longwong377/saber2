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
 *   THE COST OF IGNORING IT IS NAMES. It shoots the roster, and the roster is
 *     Command's whole subject: a record dies once and is on the fallen list
 *     forever. It does NOT shoot the player unless there is nobody else in
 *     reach, which is a real emplacement's behaviour — a casemate gun engages
 *     the mass, not the one man running at it — and it is also the only way
 *     the cost can be a cost. A gun that shot at you would be a gun you dodge.
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
 * THE GUN, PRICED AGAINST THE LINE IT IS SHOOTING AT.
 *
 * `damage` 30 — a clone trooper is 46 hp (`ARCHETYPES.trooper`), so two hits
 *   kill one and one hit does not. That is the shape a casemate gun should
 *   have: every burst that lands is half a man, so the ledger moves visibly
 *   and never in one step. A one-shot gun would make the cost a coin toss.
 *
 * `every` 3.4 s — the cadence is what turns damage into a RATE, and the rate is
 *   what the choice is made of. Measured on the shipped magazine against a real
 *   Command line formed up on the muster ground at 76.7 m (tools/checks/
 *   breach.mjs): at this cadence the gun takes a name off the roster about
 *   every fifteen seconds of sustained fire. An area is four waves; left
 *   standing for one it is most of a ten-man force.
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
 */
export const GUN = {
  damage: 30, every: 3.4, reach: 120, spread: 0.028, speed: 118, warmup: 2.2,
};

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
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
    this.target = null;

    /**
     * THE MUZZLE IS OUTSIDE THE DOOR, and that is a fact about casemates
     * rather than a convenience.
     *
     * A gun that fired from behind its own sealed blast door would put every
     * bolt into the inside face of the plate. Real emplaced guns do not fire
     * through their access door; they fire through an embrasure and the door is
     * how the crew gets in. So the barrel sits over the lintel, 1.35 m above
     * the top of the plate and 0.55 m proud of it, on the outward normal of
     * the door itself — derived from the door's own quaternion, so the gun
     * cannot end up pointing into the hill if the magazine is ever re-sited.
     */
    const n = _d.set(0, 0, 1).applyQuaternion(door.mesh.quaternion).normalize();
    this.muzzle = door.mesh.position.clone()
      .addScaledVector(n, 0.55)
      .add(_v.set(0, door.height * 0.5 + 1.35, 0));
    this.facing = n.clone();

    this.group = new THREE.Group();
    this._build();
    world.scene?.add(this.group);
    this.mesh = this.group;

    const prev = door.onBreach;
    door.onBreach = (d) => { this.silence(); prev?.(d); };
  }

  /**
   * The mantlet and the barrel. Two boxes and a cylinder, three meshes, off the
   * shared prop materials so it bins with the rest of the revetment — a gun
   * that cost a new material would cost a draw call on a level whose dressing
   * budget is already the thing `world-immersion` bounds.
   */
  _build() {
    const M = propMaterials();
    const g = this.group;
    g.position.copy(this.muzzle);
    g.quaternion.setFromUnitVectors(_v.set(0, 0, 1), this.facing);

    const mantlet = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 0.45), M.hull);
    mantlet.position.set(0, 0, -0.2);
    mantlet.castShadow = true;
    g.add(mantlet);

    const cheek = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.28, 0.7), M.duracreteDark || M.hull);
    cheek.position.set(0, 0.68, -0.15);
    g.add(cheek);

    this.barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 2.6, 8), M.darkSteel || M.hull);
    this.barrel.rotation.x = Math.PI / 2;
    this.barrel.position.set(0, 0, 0.9);
    this.barrel.castShadow = true;
    g.add(this.barrel);
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
    if (best) return best;
    /* Nobody's line left standing in the arc. A gun with no line to shoot at
     * does not stop being a gun — but a player who has killed or outlived
     * their whole roster is already in the failure state this mode is about,
     * and the emplacement should not be what finishes them off from 80 m
     * through a wall. It takes the shot only if they are inside its own
     * designed band. */
    for (const p of (w.players || [])) {
      if (p?.alive && p.position.distanceToSquared(this.muzzle) < bestD) return p;
    }
    return null;
  }

  update(dt) {
    if (!(dt > 0) || this.taken || this.dead) return;
    if (this.door?.opened) { this.silence(); return; }
    const t = (this.target && !this.target.dead && (this.target.alive ?? true)
      && this.target.position.distanceToSquared(this.muzzle) < GUN.reach * GUN.reach)
      ? this.target : this._acquire();
    this.target = t;
    if (!t) return;

    /* The barrel tracks whether or not it is about to fire. A gun that only
     * moved on the frame it shot would read as a decal three seconds out of
     * every four. */
    _d.subVectors(t.position, this.muzzle);
    if (_d.lengthSq() > 1e-4) {
      _d.normalize();
      this.group.quaternion.setFromUnitVectors(_v.set(0, 0, 1), _d);
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
    _v.copy(t.position); _v.y += (t.chestY ?? 1.1);
    _d.subVectors(_v, this.muzzle);
    const range = _d.length();
    _d.multiplyScalar(1 / range);
    if (w.physics?.raycast?.(this.muzzle, _d, range - 0.6, (b) => b.static)) return;
    if (w.terrain && w.terrain.raycast(this.muzzle, _d, range - 0.6) !== null) return;
    this._timer = GUN.every;
    this._fire(t);
  }

  _fire(t) {
    const bolts = this.world?.bolts;
    if (!bolts) return;
    /* Aim at the chest and lead the target, exactly as `Enemy._shoot` does:
     * a fixed gun that fired at a man's feet where he was standing last frame
     * would never hit a line that is walking. */
    _v.copy(t.position);
    _v.y += (t.chestY ?? 1.1);
    const range = _v.distanceTo(this.muzzle);
    if (t.velocity) _v.addScaledVector(t.velocity, range / GUN.speed);
    _d.subVectors(_v, this.muzzle).normalize();
    _d.x += (Math.random() - 0.5) * GUN.spread;
    _d.y += (Math.random() - 0.5) * GUN.spread * 0.7;
    _d.z += (Math.random() - 0.5) * GUN.spread;
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
  world.gunPits = world.gunPits || [];
  world.gunPits.push(pit);
  return pit;
}
