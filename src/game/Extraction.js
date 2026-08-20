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

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';
import { spawnClear, bladeClear, nudgeFromSwing } from './Spawn.js';
import { dropshipModel } from './Arrivals.js';

const rng = makeRng(48221);
export function seedExtraction(seed) { rng.seed(seed); }

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

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

/** Within this of the ramp and you are aboard. A door's width. */
export const BOARD_RADIUS = 3.2;

/** How long the ship holds the ground before the crew stops asking. */
export const LAST_CALL = 22.0;

/** And how long the haul takes. A slide at walking pace, not a jump cut. */
export const PULL = 1.6;

/** Gear off the ground to established climb. */
export const LIFT = 3.4;

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

export const PHASES = ['aftermath', 'called', 'inbound', 'boarding', 'liftoff',
  'transit', 'descent', 'unload', 'done'];

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
    ['boarding', walk, 'you walk to it; your line files in around you'],
    ['liftoff', LIFT, 'gear up, climb out'],
    ['transit', cruise, 'the journey — free camera, open bay, ground below'],
    ['descent', DESCENT, 'the new ground comes up and it settles'],
    ['unload', UNLOAD, 'the ramp; everybody walks off it'],
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
  G.wash = new THREE.ConeGeometry(5.2, 9, 14, 1, true);
  /* The cloud. An inverted sphere 40 cm from the eye, so it is the whole frame
   * whatever the fov and whatever the camera is doing — a plane would show its
   * edges the moment the player looked up, which is the one thing they are
   * being invited to do in this phase. */
  G.veil = new THREE.SphereGeometry(0.4, 12, 8);
  M.hull = new THREE.MeshStandardMaterial({ color: 0x8d8b83, roughness: 0.82, metalness: 0.18 });
  M.trim = new THREE.MeshStandardMaterial({ color: 0x6a6862, roughness: 0.9, metalness: 0.1 });
  M.engine = new THREE.MeshBasicMaterial({ color: 0xffd39a, transparent: true, opacity: 0.85, depthWrite: false });
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
    this._seated = [];
    this._pull = null;
    this._log = [];
    this.onPhase = null;
  }

  get active() { return this.phase !== 'done'; }
  /** True while the ship is holding people off the ground. */
  get aboard() { return this.phase === 'liftoff' || this.phase === 'transit' || this.phase === 'descent'; }
  /** What the sequence did, beat by beat, in seconds. The check reads it. */
  get log() { return this._log; }

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
    this._seated.length = 0;
    this._log.length = 0;
    this._enter('aftermath');
    return true;
  }

  _enter(phase) {
    this._log.push({ phase, at: +this.total.toFixed(3) });
    this.phase = phase;
    this.t = 0;
    this.onPhase?.(phase, this);
  }

  /* ── the frame ────────────────────────────────────────────────────── */

  update(dt, ctx) {
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
      case 'aftermath': this._aftermath(dt); break;
      case 'called': this._called(dt); break;
      case 'inbound': this._inbound(dt, ctx); break;
      case 'boarding': this._boarding(dt, ctx); break;
      case 'liftoff': this._liftoff(dt, ctx); break;
      case 'transit': this._transit(dt, ctx); break;
      case 'descent': this._descent(dt, ctx); break;
      case 'unload': this._unload(dt, ctx); break;
    }
    if (this.group) this._flyPassengers(dt);
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
    let model = dropshipModel();
    if (model) {
      g.add(model);
      this._model = model;
      const anchors = model.userData?.engines || [];
      for (let i = 0; i < 2; i++) {
        const fire = new THREE.Mesh(G.glow, M.engine);
        fire.frustumCulled = false;
        fire.scale.set(0.8, 0.8, 1.5);
        if (anchors[i]) anchors[i].add(fire);
        else { fire.position.set((i ? 1 : -1) * 4.5, -0.22, 2.6); g.add(fire); }
        this[i ? '_fireR' : '_fireL'] = fire;
      }
    } else {
      const hull = new THREE.Mesh(G.hull, M.hull); g.add(hull);
      const nose = new THREE.Mesh(G.nose, M.hull); nose.position.z = -4.9; g.add(nose);
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(G.wing, M.trim);
        wing.position.set(s * 3.2, -0.14, 0.95); g.add(wing);
        const fire = new THREE.Mesh(G.glow, M.engine);
        fire.position.set(s * 4.5, -0.22, 2.6);
        fire.scale.set(0.8, 0.8, 1.5); g.add(fire);
        this[s > 0 ? '_fireR' : '_fireL'] = fire;
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
    this.group = g;
    w.scene?.add(g);
    audio.noise?.({ dur: 3.0, gain: 0.11, type: 'bandpass', freq: 240, q: 0.9, pos: this.approach });
  }

  _inbound(dt, ctx) {
    const g = this.group;
    if (!g) { this._enter('boarding'); return; }
    const k = clamp(this.t / INBOUND, 0, 1);
    const e = smoothstep(0, 1, k);
    g.position.lerpVectors(this.approach, this.down, e * e * (3 - 2 * e));
    g.position.y = lerp(this.approach.y, this.down.y, smoothstep(0, 1, Math.pow(k, 0.62)));
    g.rotation.set(clamp(1 - k * 1.6, 0, 1) * 0.22, this.padYaw + Math.PI / 2 + Math.PI, 0);
    this._wake(dt, ctx, 1 - k);
    if (k >= 1) {
      this._enter('boarding');
      this.world.notify?.('BOARD THE TRANSPORT', 'Walk to the ramp');
      audio.thud?.(this.down, 0.8);
    }
  }

  /* ── 4. the walk ──────────────────────────────────────────────────── */

  /** Where the door is: at the ship's port side, on the ground. */
  _ramp(out = _v2) {
    const g = this.group;
    out.set(-2.4, -1.15, 0.6);
    g.localToWorld(out);
    if (this.world.terrain) out.y = this.world.terrain.height(out.x, out.z);
    return out;
  }

  _boarding(dt, ctx) {
    const w = this.world;
    const g = this.group;
    /* NO WASH WITH THE GEAR ON THE GROUND. `_wake`'s cone is 9 m of it and
     * `low` is "how close to the deck am I", so a landed ship passing 1 filled
     * a fifth of the frame with dust it was no longer making — visible in
     * tools/shot.mjs's boarding plate as a brown cone twice the size of the
     * aircraft. A ship that is DOWN is not blowing sand about; the approach
     * ramps it to zero at touchdown and it stays there. */
    this._wake(dt, ctx, 0);
    const ramp = this._ramp(_v2).clone();
    // your line walks to the ramp and files in, whether or not you do
    this._walkTroops(dt, ramp);
    const waiting = [];
    for (const p of w.players) {
      if (!p || !p.isLocal || !p.alive) continue;
      if (p.riding) continue;
      if (p.position.distanceTo(ramp) <= BOARD_RADIUS) { this._seat(p); continue; }
      waiting.push(p);
    }
    if (this._pull) {
      this._pull.t += dt;
      const k = clamp(this._pull.t / PULL, 0, 1);
      for (const p of this._pull.who) {
        if (!p.alive || p.riding) continue;
        p.position.lerpVectors(this._pull.from.get(p), ramp, smoothstep(0, 1, k));
        if (w.terrain) p.position.y = w.terrain.height(p.position.x, p.position.z);
        p.velocity?.set?.(0, 0, 0);
        if (k >= 1) this._seat(p);
      }
      if (k >= 1) this._pull = null;
      return;
    }
    if (!waiting.length) { this._enter('liftoff'); this._closeUp(); return; }
    if (this.t >= LAST_CALL) {
      /* LAST CALL, and it is a HAUL and not a placement. See the co-op note in
       * the header: the only way this file is allowed to end a stall is with
       * something the player watches happen to them. */
      w.notify?.('LAST CALL', 'The crew is pulling you aboard');
      const from = new Map();
      for (const p of waiting) from.set(p, p.position.clone());
      this._pull = { t: 0, who: waiting.slice(), from };
    }
  }

  /**
   * YOUR LINE WALKS TO THE RAMP.
   *
   * Steered rather than placed, and steered the same way `CommandDirector`
   * steers everything else it owns — `wish` and `toTarget` are the two fields
   * `Enemy._move` reads, so writing them makes the legs cycle and the body face
   * where it is going instead of sliding. The positional advance beside it is
   * `_clearBlade`'s own device and it is here for the same reason: a trooper
   * that is stunned, braced or knocked down has no `wish` at all, and a squad
   * that only MOSTLY boards would hold the ship at last call every single time.
   *
   * `CommandDirector.update` is gated off for the whole extraction (see
   * `World.update`), so nothing is fighting this for the same two fields.
   */
  _walkTroops(dt, ramp) {
    const w = this.world;
    const team = w.player?.team;
    if (team === undefined || !w.enemies) return;
    for (let i = w.enemies.length - 1; i >= 0; i--) {
      const e = w.enemies[i];
      if (e.dead || e.team !== team || e._extracting) continue;
      const dx = ramp.x - e.position.x, dz = ramp.z - e.position.z;
      const d = Math.hypot(dx, dz);
      if (d <= 2.4) {
        if (this._seated.length < BAY_SEATS) this._seat(e);
        else { e._extracting = 'left'; }
        continue;
      }
      const nx = dx / (d || 1), nz = dz / (d || 1);
      if (!e.wish) e.wish = new THREE.Vector3();
      e.wish.set(nx, 0, nz);
      if (!e.toTarget) e.toTarget = new THREE.Vector3();
      e.toTarget.set(nx, 0, nz);
      const push = Math.min(d, 4.2 * dt);
      e.position.x += nx * push; e.position.z += nz * push;
      if (w.terrain) e.position.y = w.terrain.height(e.position.x, e.position.z);
      e._syncBody?.();
    }
  }

  /**
   * A SEAT IN THE BAY.
   *
   * The commander gets the port door — the exact shot the player pointed at,
   * which is a body stood at an open side door with the ground going past — and
   * everybody else gets a bench either side of them. `riding` is the one field
   * `Player._move` and `Enemy` read to know that their position is not theirs
   * this frame; it is written here and cleared in `_release`, and nothing else
   * in the tree sets it.
   */
  _seat(body) {
    if (!body || body.riding) return;
    /**
     * AT THE DOOR, NOT IN THE MIDDLE OF THE HULL — and the first draft got this
     * wrong in a way only a screenshot could show.
     *
     * The seats were at x = ±1.05, y = −0.55: inside the troop bay, which is
     * the right place to be in a real aircraft and the wrong place to be in
     * this one. `buildGunship`'s bay is a recessed slot between rails at
     * y = +0.54 and y = −0.60, about 1.1 m of aperture; a body's feet at −0.55
     * puts its eye at +1.05, above the roof rail and inside solid hull. Driven
     * through tools/shot.mjs, the first-person frame was a wall of cream
     * fuselage with the battlefield entirely behind it.
     *
     * So a passenger stands ON THE SILL at x = ±1.45 — the door line, half a
     * body outboard of the belly — with the feet at −1.05 and therefore the eye
     * at +0.55, dead level with the aperture. That is the reference plate
     * exactly: a clone stood at the lip of an open side door with nothing
     * between him and the ground going past.
     *
     * The commander gets the port door and everybody else files aft of them.
     */
    const isPlayer = body.isLocal !== undefined;
    let local;
    if (isPlayer && !this._doorTaken) {
      this._doorTaken = true;
      local = new THREE.Vector3(-1.45, -1.05, 0.35);
    } else {
      const n = this._seated.length;
      const side = n % 2 ? 1 : -1;
      const row = Math.floor(n / 2);
      local = new THREE.Vector3(side * 1.45, -1.05, -0.55 + row * 1.15);
    }
    body.riding = { local, yaw: local.x < 0 ? -Math.PI / 2 : Math.PI / 2 };
    body._extracting = 'aboard';
    body.velocity?.set?.(0, 0, 0);
    body.grounded = true;
    if (!isPlayer) {
      body._footSpeed = body.speed;
      body.speed = 0;
      this._seated.push(body);
    } else {
      audio.thud?.(body.position, 0.35);
    }
  }

  /** Everybody who is riding, put where the ship says they are. */
  _flyPassengers(dt) {
    const w = this.world;
    const g = this.group;
    const yaw = g.rotation.y;
    const move = (b) => {
      if (!b || !b.riding) return;
      _v3.copy(b.riding.local);
      g.localToWorld(_v3);
      const dx = _v3.x - b.position.x, dy = _v3.y - b.position.y, dz = _v3.z - b.position.z;
      b.position.copy(_v3);
      b.velocity?.set?.(0, 0, 0);
      b.grounded = true;
      /* The rig was posed from `position` earlier in the frame, so moving the
       * body without carrying the same delta into the root leaves the mesh a
       * frame behind — Riders.js's note, and the same 10 cm of slide. */
      if (b.rig?.root) b.rig.root.position.set(
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
    const k = clamp(this.t / LIFT, 0, 1);
    const climb = lerp(0, 52, k * k);
    const fwd = _v1.set(Math.cos(this.padYaw), 0, Math.sin(this.padYaw)).multiplyScalar(-lerp(0, 46, k * k));
    g.position.set(this.down.x + fwd.x, this.down.y + climb, this.down.z + fwd.z);
    g.rotation.x = -0.14 * k;
    this._wake(dt, ctx, 1 - k);
    if (k >= 1) { this._enter('transit'); this._cruise0 = g.position.clone(); }
  }

  /* ── 6. the journey ───────────────────────────────────────────────── */

  _transit(dt, ctx) {
    const w = this.world;
    const g = this.group;
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
    g.rotation.x = -0.06 + Math.sin(this.t * 0.7) * 0.02;
    g.rotation.z = Math.sin(this.t * 0.5) * 0.03;

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
    for (const p of w.players) if (p?.isLocal && p.alive) this._seat(p);
    const team = w.player?.team;
    if (team === undefined || !w.enemies) return;
    for (const e of w.enemies) {
      if (e.dead || e.team !== team) continue;
      if (this._seated.length >= BAY_SEATS) break;
      this._seat(e);
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
  }

  _descent(dt, ctx) {
    const g = this.group;
    const k = clamp(this.t / DESCENT, 0, 1);
    const e = smoothstep(0, 1, k);
    g.position.lerpVectors(this._high, this.down, e * e * (3 - 2 * e));
    g.position.y = lerp(this._high.y, this.down.y, smoothstep(0, 1, Math.pow(k, 0.55)));
    g.rotation.set(clamp(1 - k * 1.6, 0, 1) * 0.2, this.padYaw + Math.PI / 2 + Math.PI, 0);
    this._setVeil(0);
    this._wake(dt, ctx, 1 - k);
    if (k >= 1) {
      this._enter('unload');
      audio.thud?.(this.down, 0.9);
      this.world.notify?.(this.world.level?.name?.toUpperCase() || 'GROUND', 'Off the ramp');
      this._closeMuster();
    }
  }

  _closeMuster() {
    const d = this.world.command;
    if (d && d.mustering && !d._netShell) { d.autoMuster?.(); d.closeMuster?.(); }
  }

  /* ── 8. the ramp ──────────────────────────────────────────────────── */

  _unload(dt, ctx) {
    const w = this.world;
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
    if (k >= 1) this._finish();
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
    if (b.speed === 0 && b._footSpeed) b.speed = b._footSpeed;
    if (i === 0) {
      _v3.copy(ramp);
    } else {
      const a = this.group.rotation.y + Math.PI / 2 + ((i % 2 ? 1 : -1) * (0.45 + Math.floor(i / 2) * 0.5));
      const r = 2.2 + (i % 3) * 1.1;
      _v3.set(ramp.x + Math.sin(a) * r, 0, ramp.z + Math.cos(a) * r);
    }
    nudgeFromSwing(w, _v3);
    if (w.terrain) {
      if (!w.terrain.inBounds(_v3.x, _v3.z, 6)) _v3.set(ramp.x, 0, ramp.z);
      _v3.y = w.terrain.height(_v3.x, _v3.z);
    }
    b.position.copy(_v3);
    b.velocity?.set?.(0, 0, 0);
    b.grounded = true;
    b._syncBody?.();
  }

  /* ── the end ──────────────────────────────────────────────────────── */

  _finish() {
    this._log.push({ phase: 'done', at: +this.total.toFixed(3) });
    this.phase = 'done';
    this._setVeil(0);
    this._teardown();
    this.onPhase?.('done', this);
  }

  _teardown() {
    const g = this.group;
    if (g) {
      g.parent?.remove(g);
      this._wash?.material.dispose();
    }
    this.group = null;
    this._wash = null;
    this._model = null;
    this._doorTaken = false;
    this._offloaded = false;
    this._seated.length = 0;
  }

  /** A level change or a run ending under a flight: put everybody down. */
  clear() {
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
    if (this.veil) { this.veil.parent?.remove(this.veil); this.veil = null; }
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
    const flare = 0.8 + Math.sin(this.total * 31) * 0.12;
    if (this._fireL) this._fireL.scale.set(0.8 * flare, 0.8 * flare, 1.5 * flare);
    if (this._fireR) this._fireR.scale.set(0.8 * flare, 0.8 * flare, 1.5 * flare);
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
