/**
 * BATTLEFRONT BORZ — the dojo.
 *
 * V1 shipped a control scheme deep enough to have a mastery curve and no way to
 * climb it. You cannot learn to return a bolt in the middle of a wave of forty
 * droids, because everything that kills you also stops you experimenting.
 *
 * So: a quiet room, a training remote that fires when you ask it to, dummies
 * that come back, and a sparring partner who will not actually hurt you.
 * Each lesson teaches exactly one verb and tells you *why* your last attempt
 * graded the way it did. Nothing here can kill you.
 */

import * as THREE from 'three';
import { plateGeo } from './Bodies.js';
import { propMaterials, addWall } from '../world/Props.js';
import { FORMS, FORM_KEYS } from './Duel.js';
import { GRADE } from './Combat.js';
import { ARCHETYPES } from './Enemy.js';
import { sandboxConfig, holdFire, tuneFireRate, walkIn, arrived, instantSpawn, DOJO_MIX } from './Waves.js';
import { clamp, lerp, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const _v1 = new THREE.Vector3();

/**
 * The walking pace an inert body is lent so it can cross to its post. `dummy`
 * is authored `speed: 0` and that is a statement about a target standing still,
 * not about a droid that cannot walk; `_post` hands it this for the crossing
 * and takes it back on arrival. Named because `APPROACH` is measured in it.
 */
const CROSS_PACE = 3.2;

/**
 * HOW FAR OUTSIDE ITS OWN POST A LESSON BODY ENTERS THE ROOM.
 *
 * This was a flat 34 m measured from the PLAYER, under a note claiming that was
 * "past the level's own inner spawn ring on every level in the game". Both
 * halves were wrong, and the second one is HANDOFF §2.4 exactly: it restates
 * `level.spawnRadius` instead of reading it, and the restatement is false on
 * two of the seven shipped theatres — `drifts` opens its inner ring at 36 m and
 * `geonosis` at 58 m, so on the Shifting Waste a lesson body was entering from
 * INSIDE the ring the waves use, not past it.
 *
 * The number itself is a wave distance being spent on a room 5.5 m across, and
 * what it cost was measured on a real World on `drifts`:
 *
 *   - 6.1 to 9.6 seconds of crossing PER LESSON, eleven lessons, with `holdFire`
 *     keeping every remote silent for all of it. The first thing a new player
 *     meets after "Feel the weight" is eight seconds of nothing.
 *   - Worse, `walkIn`'s post is a SNAPSHOT of where the player stood when the
 *     lesson opened. Walk while the room is still crossing — an ordinary walk,
 *     3.3 m/s, no sprint — and the `cut` lesson's three dummies finish their
 *     approach 29.5, 36.6 and 31.7 m away from you and STOP THERE FOREVER: an
 *     inert body's speed goes back to zero on arrival and nothing moves it
 *     again. `cut` needs eight severed limbs from three targets you can no
 *     longer reach, so the lesson cannot be completed and cannot be restarted
 *     except by leaving it.
 *
 * So the approach is measured off the POST rather than off the player, it is
 * the same for every ring, and it is a DURATION rather than a taste: a second
 * and a half at `CROSS_PACE`, the slowest thing that ever makes the trip. That
 * is 4.8 m, which each body then covers at its own speed — 1.37 s for a remote
 * (2.6 m/s × 1.35), 1.50 s for a dummy, 1.05 s for the partner (3.4 × 1.35).
 * Long enough to watch a body walk in, which is all player note #17 ever asked
 * for, and short enough that the room is standing before you have taken three
 * paces. `_steerRoom` covers the paces you do take.
 */
const APPROACH = CROSS_PACE * 1.5;

/* ── the training remote ─────────────────────────────────────────────── */

export function buildRemote(opts = {}) {
  // Every other body builder takes an options object and Enemy calls them all
  // the same way — taking a bare number here meant the remote was built at a
  // scale of `{scale:1}`, i.e. NaN, all the way through to the audio panner.
  const scale = typeof opts === 'number' ? opts : (opts.scale ?? 1);
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0xb8bec8, metalness: 0.85, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d23, metalness: 0.5, roughness: 0.6 });
  const lens = new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: 0xff4030, emissiveIntensity: 3, roughness: 0.2 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.11 * scale, 16, 12), shell);
  body.castShadow = true;
  g.add(body);
  // the equatorial band and the little emitters that make it read as a remote
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.112 * scale, 0.012 * scale, 8, 24), dark);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  const muzzles = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.017 * scale, 0.02 * scale, 0.05 * scale, 8), dark);
    m.position.set(Math.sin(a) * 0.105 * scale, 0.02 * scale, Math.cos(a) * 0.105 * scale);
    m.rotation.x = Math.PI / 2;
    m.rotation.y = -a;
    g.add(m);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016 * scale, 8, 6), lens);
    eye.position.set(Math.sin(a) * 0.126 * scale, 0.02 * scale, Math.cos(a) * 0.126 * scale);
    g.add(eye);
    muzzles.push(eye);
  }
  const halo = new THREE.PointLight(0xff5030, 1.4, 3, 2);
  g.add(halo);
  return { group: g, muzzles, halo, scale };
}

/* ── training dummy ──────────────────────────────────────────────────── */

export function buildDummy() {
  const g = new THREE.Group();
  const M = propMaterials();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.1, 10), M.wood);
  post.position.y = 0.55;
  g.add(post);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.14, 14), M.darkSteel);
  base.position.y = 0.07;
  g.add(base);
  g.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Lessons                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Each lesson names one verb, says how to do it, and counts successes. `check`
 * is fed every event the world produces; it returns true when that event
 * counted toward this lesson.
 */
export const LESSONS = [
  {
    id: 'feel', title: 'Feel the weight', need: 6,
    brief: (s) => s.scheme === 'directional'
      ? 'Flick the mouse and the blade follows into that guard — high, left, right or low. Aim normally and it stays where you put it.'
      : 'HOLD LEFT MOUSE and move. While you hold it the mouse is the blade, not the camera. Let go and the blade returns to guard.',
    hint: 'The blade lags a flick and overshoots a snap. Swing hard enough to hear it cut the air.',
    setup: { remotes: 0, dummies: 0, spar: false },
    check: (ev, s) => ev.type === 'swing' && ev.speed > 13,
  },
  {
    id: 'block', title: 'Meet the bolt', need: 5,
    brief: (s) => s.scheme === 'directional'
      ? 'A remote will fire slowly. Flick into the guard the shot is coming from — your guard covers your centreline plus one quadrant.'
      : 'A remote will fire slowly. Hold left mouse and get the blade in the way — anywhere on it.',
    hint: 'Watch where the bolt is going, not where it is.',
    setup: { remotes: 1, fireRate: 2.4, boltSpeed: 26, dummies: 0, spar: false },
    check: (ev) => ev.type === 'deflect',
  },
  {
    id: 'deflect', title: 'Drive into it', need: 6,
    brief: 'A blade sitting still only scatters a bolt. A blade moving INTO the bolt mirrors it.',
    hint: 'Do not wait for the bolt. Swing through where it will be.',
    setup: { remotes: 1, fireRate: 1.9, boltSpeed: 32, dummies: 0, spar: false },
    check: (ev) => ev.type === 'deflect' && ev.grade >= GRADE.DEFLECT,
  },
  {
    id: 'return', title: 'Send it back', need: 4,
    /* "PAST THE MIDDLE OF THE BLADE" named a fraction the game does not use.
     * `gradeCaught` gates a RETURN on `bladeT > SPEED_GRADE.returnBladeT`, which
     * is 0.42 — the outer FIFTY-EIGHT per cent, not the outer half. A coach line
     * is a claim like any other and this one was teaching a contact point 8% of
     * a blade further out than the game asks for, on the lesson whose whole job
     * is to teach that contact point. It says the direction now and leaves the
     * number to the gate; tools/checks/claims.mjs holds it to that. */
    brief: 'Fast tip, contact well out along the blade rather than near the hilt, and something under your reticle. Then the bolt goes home.',
    hint: 'Look at the remote as you meet the bolt.',
    setup: { remotes: 2, fireRate: 1.7, boltSpeed: 34, dummies: 0, spar: false, invincibleRemotes: true },
    check: (ev) => ev.type === 'deflect' && ev.grade >= GRADE.RETURN,
  },
  {
    id: 'perfect', title: 'Perfect return', need: 2,
    brief: 'The same thing, harder and cleaner. Accelerate the blade into the bolt with the tip.',
    hint: 'Start the swing before the bolt arrives so the blade is at full speed on contact.',
    setup: { remotes: 2, fireRate: 1.5, boltSpeed: 36, dummies: 0, spar: false, invincibleRemotes: true },
    check: (ev) => ev.type === 'deflect' && ev.grade >= GRADE.PERFECT,
  },
  {
    id: 'cut', title: 'Cut with the tip', need: 8,
    brief: 'The end of the blade travels many times faster than the emitter. That is where limbs come off.',
    hint: 'Sever eight limbs. Try the same swing near the hilt and see it fail.',
    setup: { remotes: 0, dummies: 3, spar: false },
    check: (ev) => ev.type === 'sever',
  },
  {
    id: 'parry', title: 'Parry', need: 4,
    brief: 'A duellist declares every attack. The ghost arc shows exactly where the blade is going.',
    hint: 'Blue arcs can be parried — just put your blade on the line.',
    setup: { remotes: 0, dummies: 0, spar: true, sparForm: 'makashi', sparSpeed: 0.65 },
    check: (ev) => ev.type === 'parry',
  },
  {
    id: 'chamber', title: 'Chamber', need: 3,
    brief: 'Near the end of a wind-up the arc pulses. Swing AGAINST the direction of the arc in that window.',
    hint: 'Amber arcs cannot be parried — they must be chambered or dodged.',
    setup: { remotes: 0, dummies: 0, spar: true, sparForm: 'djemSo', sparSpeed: 0.6 },
    check: (ev) => ev.type === 'chamber',
  },
  {
    id: 'lock', title: 'Blade lock', need: 1,
    brief: 'Rest your blade against theirs while neither of you is swinging, and you will bind.',
    hint: (s) => s.scheme === 'directional'
      ? 'In a lock, keep flicking into the bind and drive it hard to overpower them.'
      : 'In a lock, hold left mouse and drive it hard to overpower them.',
    setup: { remotes: 0, dummies: 0, spar: true, sparForm: 'soresu', sparSpeed: 0.7 },
    check: (ev) => ev.type === 'lockWon',
  },
  {
    /**
     * THE LADDER ENDED ON A RUNG NOBODY COULD CLIMB OFF, AND THE ROOM PAST IT
     * WAS ITS OWN HAND-WRITTEN TWIN.
     *
     * There used to be a `free` lesson here — `need: Infinity`,
     * `check: () => false`, `setup: { remotes: 3, dummies: 3, spar: true }` —
     * standing between `lock` and this one. `_advance` fires on `check`
     * returning true `need` times, so it could never fire on that rung:
     * DRIVEN, feeding the dojo every event its own lessons key on, the ladder
     * walks 0→1→2→3→4→5→6→7→9 and STOPS on `free` with progress 0. The
     * eleventh lesson — this room, `inSandbox`, `_sandboxRoom`, the DOJO_MIX
     * rotation and main.js's `sandboxRoomLive` training arm — was reachable
     * only by pressing Skip, and the coach read "10 of 11" forever.
     *
     * And what it was blocking the way to is the SAME ROOM with its numbers
     * exposed: `DOJO_MIX` is `['remote', 'dummy', 'sparring']`, which is
     * exactly the three things free practice hard-coded, at a fixed count and
     * a fixed fire rate. A hand-written table beside its configurable twin
     * (§2.3), and the twin was the unreachable one.
     *
     * So free practice is gone and this is the tenth lesson. The lessons above
     * each pin the room to what they are teaching, which is exactly what makes
     * them lessons and exactly why none of them is a place to just mess about.
     * This one hands the room over: it reads the sandbox numbers off the
     * settings every second, so the count and the fire rate are live from the
     * pause screen — and now a player who finishes the blade lock is standing
     * in it. `tools/checks/training.mjs` walks the whole ladder through
     * `report` and asserts it arrives here.
     */
    id: 'sandbox', title: 'Sandbox', need: Infinity,
    brief: 'Your room. Set how many droids and how fast they shoot in the Training tab — zero of either is allowed.',
    hint: 'Blade length can be taken off its leash in there too. Nothing here can kill you.',
    setup: { sandbox: true },
    check: () => false,
  },
];

/* ══════════════════════════════════════════════════════════════════════ */
/*  Director                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

export class DojoDirector {
  /** Stands in for the WaveDirector when the mode is `training`. */
  constructor(world) {
    this.world = world;
    this.wave = 1;
    this.active = true;
    this.intermission = 0;
    this.spawnQueue = [];
    this.index = 0;
    this.progress = 0;
    this.remotes = [];
    this.dummies = [];
    this.spar = null;
    this.mode = 'training';
    this._settleTimer = 0;
    this.onLesson = null;
    /** Set by `World`, like every other director's. See `_advance`. */
    this.onWaveClear = null;
    this.totalSpawned = 0;
    this.streak = 0;
    // bodies still walking to their post — see _steerRoom
    this._crossing = [];
    // sandbox bookkeeping — see _sandboxRoom
    this.sandboxUnits = [];
    this._mixCursor = 0;
    this._sandboxFire = null;
    this._sandboxSaid = -1;
  }

  /**
   * THE SYLLABUS HANDS OUT NO CARDS, and `_earnInsight` asks in order to price
   * a clear: `insightRate(director.drafts !== false)` pays the low rate to a
   * mode that also deals boons and the full rate to one that does not. Without
   * this getter `drafts` is `undefined`, which is not `false`, so Training was
   * billed as a draft mode and paid 1 an lesson instead of 4.
   */
  get drafts() { return false; }

  get lesson() { return LESSONS[Math.min(this.index, LESSONS.length - 1)]; }
  get remaining() { return this.lesson.need === Infinity ? 0 : Math.max(0, this.lesson.need - this.progress); }
  get inSandbox() { return !!this.lesson.setup?.sandbox; }

  /**
   * THE BRANCH THAT USED TO BE HERE COULD NOT RUN.
   *
   * It read `if (this.world.settings?.mode === 'sandbox') this.index =
   * LESSONS.length - 1`, and `grep -rn "new DojoDirector" src/` returns ONE
   * line — World.js, inside `if (this.settings.mode === 'training')`. Sandbox
   * mode is a `WaveDirector` on the `_sandboxUpdate` path and never builds one
   * of these, so the test could never be true in a deployed game.
   * `tools/checks/training.mjs` kept it green by constructing a DojoDirector
   * with `{mode:'sandbox'}` BY HAND — a check standing on a path no deploy can
   * produce, which is the shape §2.4 is about. The sandbox room is reached the
   * way every other lesson is now: by finishing the one before it.
   */
  start() { this._applyLesson(); }

  /** Any world event that a lesson might care about. */
  report(ev) {
    const L = this.lesson;
    if (!L) return;
    if (L.check(ev, this)) {
      this.progress++;
      this.streak++;
      if (this.progress >= L.need) this._advance();
      else this.onLesson?.(this.state());
    }
  }

  _advance() {
    audio.ui('good');
    this.world.notify(this.lesson.title.toUpperCase(), 'learned');
    /**
     * A LESSON LEARNED IS THIS MODE'S CLEARED WAVE, and until this line the
     * Holocron was unspendable here.
     *
     * `World._earnInsight` hangs off `director.onWaveClear`, which every other
     * director in the game fires and this one has never had — so Training was
     * the one mode where you could kneel, open the chart, and find 0 Insight
     * for as long as you played. Measured across all ten modes: 4 Insight a
     * clear everywhere, 1 in Path of the Blade (which pays in cards instead),
     * and 0 here.
     *
     * That is the wrong mode to be the exception. Training is where a player
     * goes to find out what a power DOES, and the Holocron is the screen that
     * hands them one; the Options card that grants the whole lattice exists
     * for the same reason and names the same need.
     *
     * `this.wave` is the lesson number (`_applyLesson` sets it), so the income
     * ramps with the syllabus exactly as a wave counter ramps with a run, and
     * the callback is fired with the wave that was just FINISHED rather than
     * the one being set up — the same argument every other caller makes.
     */
    this.onWaveClear?.(this.wave, true);
    this.index = Math.min(this.index + 1, LESSONS.length - 1);
    this.progress = 0;
    this._applyLesson();
  }

  skip() { this.index = Math.min(this.index + 1, LESSONS.length - 1); this.progress = 0; this._applyLesson(); }
  back() { this.index = Math.max(0, this.index - 1); this.progress = 0; this._applyLesson(); }
  repeat() { this.progress = 0; this._applyLesson(); }

  _applyLesson() {
    const L = this.lesson;
    const w = this.world;
    const s = L.setup || {};
    this.wave = this.index + 1;

    // clear the room, then set it up for this lesson only
    for (const e of w.enemies) e.dispose();
    w.enemies.length = 0;
    w.locks.length = 0;
    this.remotes.length = 0; this.dummies.length = 0; this.spar = null;
    this._crossing.length = 0;
    this.sandboxUnits.length = 0;
    this._mixCursor = 0;
    this._sandboxFire = null;
    w.bolts?.clear();

    const anchor = w.player ? w.player.position : _v1.set(0, 0, 0);

    if (s.sandbox) { this._sandboxRoom(anchor); this.onLesson?.(this.state()); return; }

    for (let i = 0; i < (s.remotes || 0); i++) {
      const a = (i / Math.max(1, s.remotes)) * TAU + 0.5;
      const e = this._post('remote', anchor, a);
      e.trainingFireRate = s.fireRate ?? 2.0;
      e.trainingBoltSpeed = s.boltSpeed ?? 30;
      e.invincible = !!s.invincibleRemotes;
      this.remotes.push(e);
    }
    for (let i = 0; i < (s.dummies || 0); i++) {
      const a = (i / Math.max(1, s.dummies)) * TAU - 0.8;
      this.dummies.push(this._post('dummy', anchor, a));
    }
    if (s.spar) {
      const e = this._post('sparring', anchor, Math.PI);
      if (e.duel) {
        e.duel.formKey = s.sparForm || 'makashi';
        e.duel.form = FORMS[e.duel.formKey];
        e.formName = e.duel.describe();
      }
      e.trainingSpeed = s.sparSpeed ?? 0.7;
      this.spar = e;
    }
    this.onLesson?.(this.state());
  }

  /**
   * A LESSON BODY, WHICH WALKS TO ITS POST INSTEAD OF APPEARING ON IT.
   *
   * PLAYER NOTE #17, AND IT NAMES THIS ROOM: "even in TRAINING MODE or in any
   * mode, the enemies should not materialize in front of you they should arrive
   * from somewhere not teleport behind you."
   *
   * `ArrivalDirector` answers that for a wave and it cannot answer it here. A
   * lesson needs its remote at a taught distance — "stand five and a half metres
   * from a remote and return one bolt" IS the lesson — and an arrival that puts
   * the remote wherever the terrain allowed is a different lesson. That is why
   * this room was exempt, and the exemption was the whole of the defect: it is
   * the room a new player meets first, so it is the room that teaches them that
   * things in this game appear out of nothing.
   *
   * So the body is spawned OUTSIDE THE ROOM, on the same bearing, and walks in
   * to the post the lesson chose. The lesson's geometry is byte-identical to
   * what it was — the body ends exactly where it used to start — and what
   * changes is that you watch it come. `Waves.walkIn` is the primitive and it
   * holds the body's fire the whole way, so nothing shoots at you while it is
   * still crossing. How far outside, and why that stopped being 34 m, is
   * `APPROACH`.
   *
   * `settings.instantSpawn` is the same opt-out the wave and sandbox paths take:
   * one setting, one reader, and the default everywhere is that things arrive
   * from somewhere.
   *
   * THE SEAT IS KEPT ON THE BODY. `_dojoSeat` is the room's record of where
   * this body belongs — its type, its bearing and its ring — and it is the one
   * authority three separate places used to write out by hand: `_applyLesson`
   * named 5.5/3.4/3.2 at the call sites, `_sandboxRadius` derived the same
   * three off the archetype, and the respawn in `update()` kept a THIRD copy
   * (5.5/3.4, with the partner at `anchor.z - 3.4`, which is neither the right
   * radius nor a bearing any lesson uses). HANDOFF §2.3, three times over in
   * one file. Everything now reads `_roomRadius`, and a respawn re-posts on the
   * seat the body already had.
   *
   * @param bearing radians about the anchor; `dist` defaults to the body's ring.
   */
  _post(type, anchor, bearing, dist = this._roomRadius(type)) {
    const w = this.world;
    const post = new THREE.Vector3(
      anchor.x + Math.cos(bearing) * dist, 0, anchor.z + Math.sin(bearing) * dist);
    if (w.terrain) post.y = w.terrain.height(post.x, post.z);
    const seat = { type, bearing, dist, post };
    if (instantSpawn(w.settings)) {
      const direct = w.spawnEnemy(type, post);
      if (direct) direct._dojoSeat = seat;
      return direct;
    }
    /* FROM WHERE. `APPROACH` metres further out along the post's own bearing,
     * so the body walks IN along the radius and stops where the lesson wants it
     * rather than crossing the room diagonally through you.
     *
     * Pulled in until it fits, because the dojo runs on every theatre now and
     * some of them are bounded tighter than others — and unlike the version
     * before it, this ends somewhere legal. The old fallback tried 34 m, then
     * 16 m, and if THAT was also outside the world it spawned there anyway. The
     * last resort here is the post itself: a body that has nowhere to walk from
     * stands up on its mark, which is the one case note #17 cannot be honoured
     * in and is strictly better than a body outside the map. */
    const from = new THREE.Vector3();
    let entry = 0;
    for (const reach of [APPROACH, APPROACH * 0.5]) {
      from.set(anchor.x + Math.cos(bearing) * (dist + reach), 0,
        anchor.z + Math.sin(bearing) * (dist + reach));
      if (!w.terrain?.inBounds || w.terrain.inBounds(from.x, from.z, 2)) { entry = reach; break; }
    }
    if (!entry) from.copy(post);
    if (w.terrain) from.y = w.terrain.height(from.x, from.z);
    const e = w.spawnEnemy(type, from);
    if (!e) return e;
    e._dojoSeat = seat;
    /* An inert dummy has speed 0 and would never arrive — `walkIn` writes
     * `wish` and `_move` multiplies it by `this.speed`. It is given a walking
     * pace for the crossing and put back to nothing on arrival, which is what
     * the archetype means by `speed: 0`: a target that does not move once it is
     * standing where it was put. */
    const rest = e.speed;
    if (!(e.speed > 0)) e.speed = CROSS_PACE;
    if (entry) {
      walkIn(e, post, { speed: rest > 0 ? 1.35 : 1.0, tolerance: 1.1, rest });
      this._crossing.push(e);
    }
    return e;
  }

  /**
   * THE ROOM IS WHEREVER YOU ARE, INCLUDING WHILE IT IS STILL ARRIVING.
   *
   * `walkIn` holds the post BY REFERENCE and reads it every frame, so keeping
   * that vector pointed at the live anchor steers a body which is still
   * crossing into the room the player is standing in NOW rather than the one
   * they were standing in when the lesson opened. It is the shipped primitive's
   * own target being kept true, not a second walk written beside it (§2.4).
   *
   * The dependency is on `walkIn` storing the vector rather than copying it,
   * which is worth stating out loud because it lives in another file: if that
   * ever changes this degrades to exactly the old behaviour over a SIX metre
   * approach, so the error goes from thirty metres to about two.
   */
  _steerRoom(anchor) {
    const w = this.world;
    for (let i = this._crossing.length - 1; i >= 0; i--) {
      const e = this._crossing[i];
      const seat = e && e._dojoSeat;
      if (!seat || e.dead || arrived(e)) { this._crossing.splice(i, 1); continue; }
      seat.post.set(anchor.x + Math.cos(seat.bearing) * seat.dist, 0,
        anchor.z + Math.sin(seat.bearing) * seat.dist);
      if (w.terrain) seat.post.y = w.terrain.height(seat.post.x, seat.post.z);
    }
  }

  /**
   * IS THIS SEAT EMPTY? Two ways it can be, and the second is new.
   *
   * Dead and settled — the original rule, with the delay read off the seat
   * because a partner's death is longer than a droid's. That difference is why
   * the two used to be written out as separate blocks.
   *
   * Or STANDING WHERE THE ROOM USED TO BE. Anything with a brain walks back to
   * the player on its own; an inert body is `speed: 0` — "a target that does
   * not move once it is standing where it was put" — so when the player leaves,
   * the dummy does not follow and the lesson that needs it is over. The bar is
   * the body's own seat plus the approach it would have walked to reach it,
   * i.e. the furthest out it has ever legitimately stood, so nothing is
   * reseated for being a step wide of its post.
   */
  _vacated(e, anchor) {
    const seat = e && e._dojoSeat;
    if (!seat) return false;
    if (e.dead) return e.dying > (seat.type === 'sparring' ? 2.6 : 2.2);
    if (!e.A?.inert || !arrived(e)) return false;
    return e.position.distanceTo(anchor) > seat.dist + APPROACH;
  }

  /** Take a body out of the room — off the world's list, off the blade's target
   *  list, and out of its seat so nothing steers it any more. */
  _retire(e) {
    const w = this.world;
    const i = w.enemies.indexOf(e);
    if (i >= 0) w.enemies.splice(i, 1);
    const j = this.sandboxUnits.indexOf(e);
    if (j >= 0) this.sandboxUnits.splice(j, 1);
    w.bladeSolver?.clearTarget?.(e.id);
    e._dojoSeat = null;
    e.dispose();
  }

  /** Put a fresh body on an empty seat — same type, same bearing, same ring —
   *  and let it walk in the way the first one did. A corpse is left to fade on
   *  its own clock; a stray is taken out, because it is still standing there. */
  _reseat(e, anchor) {
    const seat = e && e._dojoSeat;
    if (!seat) return null;
    if (!e.dead) this._retire(e);
    return this._post(seat.type, anchor, seat.bearing, seat.dist);
  }

  /* ── the sandbox room ────────────────────────────────────────────── */

  /**
   * WHERE A BODY OF THIS TYPE STANDS: remotes orbit wide, dummies stand close.
   *
   * Named `_sandboxRadius` while it served one caller, and the lessons kept
   * their own copy of the three numbers it already knew (5.5 / 3.4 / 3.2,
   * written at the `_post` call sites) with the respawn keeping a third. It is
   * the room's single authority now — lessons, sandbox and respawn all read it
   * — and it is derived off the archetype rather than listed, so a body added
   * to `DOJO_MIX` is seated the day it is authored (§2.3).
   */
  _roomRadius(type) {
    const A = ARCHETYPES[type];
    if (!A) return 5.0;
    if (A.inert) return 3.4;                    // walk-up-and-cut range
    if (A.melee) return 3.2;
    return A.custom === 'remote' ? 5.5 : 8.0;   // the hall is 22 m to the wall
  }

  /** One more opponent, placed on its own ring so the room stays readable. */
  _spawnSandboxUnit(anchor, type, index) {
    const w = this.world;
    // Golden-angle spacing, on five nested rings: consecutive spawns never land
    // on top of each other however many there are, which a fixed i/n fan cannot
    // promise when n grows — and forty bodies on ONE circle 8 m out is 1.25 m
    // apart, which the separation steering then spends the whole session
    // untangling. The rings spread that over 8.0 to 9.9 m instead.
    const r = this._roomRadius(type) * (1 + 0.06 * (index % 5));
    const a = index * 2.39996 + 0.5;
    /* …AND THIS ROOM WALKS IN TOO. Note #17 says "in any mode", and the sandbox
     * is where a player spends the longest watching bodies enter the world — it
     * is the room you sit in and dial the count up and down. `_post` is the same
     * primitive the lessons use and it keeps the golden-angle ring exactly:
     * the body ends on the same nested ring it used to start on. */
    const e = this._post(type, anchor, a, r);
    const cfg = sandboxConfig(w.settings);
    // The remotes throw the slow, fat bolts the deflection lessons use — 30 m/s
    // against the 88 m/s a real blaster fires, which is the difference between
    // a bolt you can read and one you can only guess at.
    if (ARCHETYPES[type]?.custom === 'remote') e.trainingBoltSpeed = 30;
    if (e.duel) {
      e.duel.formKey = 'makashi';
      e.duel.form = FORMS.makashi;
      e.formName = e.duel.describe();
      e.trainingSpeed = 0.7;
    }
    tuneFireRate(e, cfg.fire);
    if (cfg.fire <= 0) holdFire(e);
    this.sandboxUnits.push(e);
    this.totalSpawned++;
    return e;
  }

  _sandboxType(cfg) {
    if (cfg.type !== 'mixed') return cfg.type;
    return DOJO_MIX[(this._mixCursor++) % DOJO_MIX.length];
  }

  _sandboxRoom(anchor) {
    const cfg = sandboxConfig(this.world.settings);
    // Only the first handful on this frame. Each unit builds a rig, an actor
    // and a physics proxy; forty of those in one call is a visible freeze the
    // moment you walk in. The 0.12 s reconcile in update() brings the rest in
    // over the next few seconds, which reads as them arriving rather than as a
    // stall — and is the same rate the arena sandbox fills at.
    const now = Math.min(cfg.count, 6);
    for (let i = 0; i < now; i++) this._spawnSandboxUnit(anchor, this._sandboxType(cfg), i);
    this._sandboxFire = cfg.fire;
    if (cfg.type === 'mixed') this.spar = this.sandboxUnits.find(e => e.duel) || null;
  }

  /**
   * Keep the room matching the numbers, every frame the settle timer fires.
   * The player is expected to move these sliders mid-session — that is the
   * whole feature — so the count is reconciled rather than applied once.
   */
  _sandboxTick() {
    const w = this.world;
    const cfg = sandboxConfig(w.settings);
    const anchor = w.player ? w.player.position : _v1.set(0, 0, 0);

    // Drop the corpses out of the ledger first. 2.2 s is the same settle the
    // lessons use, and it always fires: Enemy.update only retires itself from
    // world.enemies at `dying > 40`, so a body is never gone before this sees it.
    for (let i = this.sandboxUnits.length - 1; i >= 0; i--) {
      const e = this.sandboxUnits[i];
      if (e.dead && e.dying > 2.2) this.sandboxUnits.splice(i, 1);
    }

    // Same rule as the arena sandbox: decide what stays. Keep up to `count` of
    // the archetype currently asked for, oldest first, and retire everything
    // else — so changing the opponent picker reshapes the room instead of
    // waiting for you to cut the previous one down.
    const live = this.sandboxUnits.filter(e => !e.dead);
    const right = cfg.type === 'mixed' ? live : live.filter(e => e.type === cfg.type);
    const keep = new Set(right.slice(0, cfg.count));
    if (keep.size < live.length) {
      for (const e of live) {
        if (keep.has(e)) continue;
        this._retire(e);
      }
    } else if (live.length < cfg.count) {
      this._spawnSandboxUnit(anchor, this._sandboxType(cfg), this.totalSpawned);
    }

    if (this._sandboxFire !== cfg.fire) {
      this._sandboxFire = cfg.fire;
      for (const e of this.sandboxUnits) tuneFireRate(e, cfg.fire);
      this.onLesson?.(this.state());          // the coach panel quotes the numbers
    }
    if (this._sandboxSaid !== cfg.count) { this._sandboxSaid = cfg.count; this.onLesson?.(this.state()); }
    if (cfg.type === 'mixed' && (!this.spar || this.spar.dead)) {
      this.spar = this.sandboxUnits.find(e => e.duel && !e.dead) || this.spar;
    }
  }

  setSparForm(key) {
    if (!this.spar || !FORMS[key]) return;
    this.spar.duel.formKey = key;
    this.spar.duel.form = FORMS[key];
    this.spar.formName = this.spar.duel.describe();
    this.onLesson?.(this.state());
  }

  state() {
    const L = this.lesson;
    // A lesson may state its brief as a FUNCTION OF THE LIVE SETTINGS, because
    // the game now ships more than one control scheme and the coach was still
    // teaching the one it used to ship: "HOLD LEFT MOUSE… the mouse is the
    // blade, not the camera" is now false for every player who has not gone
    // looking for Free Blade. A lesson that teaches the wrong controls is worse
    // than no lesson, and the check that forbids typing a key name into a
    // player-facing surface never scanned this file.
    const s = this.world.settings;
    const out = {
      index: this.index, total: LESSONS.length,
      id: L.id, title: L.title,
      brief: typeof L.brief === 'function' ? L.brief(s) : L.brief,
      hint: typeof L.hint === 'function' ? L.hint(s) : L.hint,
      progress: this.progress, need: L.need,
      form: this.spar ? this.spar.formName : null,
      /**
       * …AND HOW TO READ IT, which `FORMS` has authored five times and nothing
       * has ever drawn.
       *
       * "Makashi II" is a label. `tell` is the sentence — "economical,
       * blade-tip precise — it fights at the end of the blade and lunges the
       * moment you overcommit" — and it is the only thing in the game that
       * teaches a player what a form LOOKS like from the other side. It was
       * dead in the one room whose entire job is teaching, which is where a
       * dead field costs the most.
       *
       * Read off the live form rather than off `formName`, because
       * `Dojo.setSparForm` swaps `duel.form` mid-lesson and a copy taken at
       * spawn would describe the last opponent.
       */
      formTell: this.spar?.duel?.form?.tell || null,
    };
    if (L.setup?.sandbox) {
      // The coach panel is the only place the player sees the room described,
      // so in the sandbox it describes the numbers they actually chose.
      const cfg = sandboxConfig(this.world.settings);
      const who = cfg.type === 'mixed' ? 'mixed' : (ARCHETYPES[cfg.type]?.label ?? cfg.type);
      out.brief = cfg.count === 0
        ? 'An empty hall. Move, swing, feel the weight of it — nothing is coming.'
        : `${cfg.count} × ${who}, firing at ${cfg.fire <= 0 ? 'nothing at all' : `${cfg.fire.toFixed(2)}× rate`}.`;
    }
    return out;
  }

  update(dt, ctx) {
    const anchor = this.world.player ? this.world.player.position : _v1.set(0, 0, 0);
    /* Every frame, not on the settle tick. A post refreshed once a second is a
     * post up to a second stale, and at a walking 3.3 m/s that is three metres
     * of a six-metre approach. */
    this._steerRoom(anchor);

    if (this.inSandbox) {
      // The fuse has to be pushed back EVERY frame, not on the settle tick:
      // holdFire only guarantees half a second of silence, and a one-second
      // reconcile would let every droid in the room get a volley away between
      // ticks — which is exactly the "too much fire to practise" complaint.
      const cfg = sandboxConfig(this.world.settings);
      if (cfg.fire <= 0) for (const e of this.sandboxUnits) holdFire(e);
      this._settleTimer -= dt;
      if (this._settleTimer <= 0) {
        // 0.12 s, not the lessons' 1.0 s: dragging the count from 0 to 40 has
        // to fill the room while your hand is still on the slider.
        this._settleTimer = 0.12;
        this._sandboxTick();
      }
      return;
    }

    /* Dummies and remotes come back so the lesson never stalls — and a room
     * the player has walked out of is re-formed around them, which is the same
     * sentence and used not to be true. Both go through `_reseat`, so a
     * replacement walks in on its own seat instead of appearing out of nothing
     * one metre from your shoulder: the old path here spawned directly at the
     * ring with `y = 0`, which is note #17's complaint verbatim, in the path a
     * player hits most (the `cut` lesson wants eight limbs off three dummies)
     * and on any theatre whose ground is not at sea level. */
    this._settleTimer -= dt;
    if (this._settleTimer <= 0) {
      this._settleTimer = 1.0;
      for (const list of [this.remotes, this.dummies]) {
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (!this._vacated(e, anchor)) continue;
          const fresh = this._reseat(e, anchor);
          if (!fresh) continue;
          if (list === this.remotes) {
            fresh.trainingFireRate = e.trainingFireRate;
            fresh.trainingBoltSpeed = e.trainingBoltSpeed;
            fresh.invincible = e.invincible;
          }
          list[i] = fresh;
        }
      }
      if (this._vacated(this.spar, anchor)) {
        const was = this.spar;
        const fresh = this._reseat(was, anchor);
        if (fresh) {
          if (fresh.duel && was.duel) {
            fresh.duel.formKey = was.duel.formKey;
            fresh.duel.form = was.duel.form;
            fresh.formName = fresh.duel.describe();
          }
          fresh.trainingSpeed = was.trainingSpeed;
          this.spar = fresh;
        }
      }
    }
  }

  resumeAfterDraft() {}
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Room                                                                  */
/* ══════════════════════════════════════════════════════════════════════ */

export function dressDojo(world) {
  const M = propMaterials();
  const H = 9;
  const R = 22;

  // an octagonal hall
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const cx = Math.cos(a) * R, cz = Math.sin(a) * R;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    addWall(world, new THREE.Vector3(cx, H / 2, cz), new THREE.Vector3(R * 0.86, H, 1.4), q, M.duracrete);
    // a column at each corner
    const ca = a + Math.PI / 8;
    addWall(world, new THREE.Vector3(Math.cos(ca) * (R - 1.2), H / 2, Math.sin(ca) * (R - 1.2)),
      new THREE.Vector3(1.0, H, 1.0), new THREE.Quaternion(), M.stone);
  }
  // ceiling ring and lights
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    const lamp = new THREE.PointLight(0xffdcb0, 52, 40, 2);
    lamp.position.set(Math.cos(a) * (R - 5), H - 1.4, Math.sin(a) * (R - 5));
    world.scene.add(lamp);
    world.levelLights.push(lamp);
    const fixture = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x14100c, emissive: 0xffc880, emissiveIntensity: 3.2, roughness: 0.5 }));
    fixture.position.copy(lamp.position);
    world.scene.add(fixture);
    world.statics.push(fixture);
  }
  // a cool skylight so the room has a direction
  const sky = new THREE.PointLight(0xbcd8ff, 90, 60, 2);
  sky.position.set(0, H + 2, 0);
  world.scene.add(sky);
  world.levelLights.push(sky);

  // the meditation ring in the floor
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b2530, emissive: 0x2b6d96, emissiveIntensity: 0.85,
      roughness: 0.5, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  world.scene.add(ring);
  world.statics.push(ring);

  const inner = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.22, 32), ring.material);
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.02;
  world.scene.add(inner);
  world.statics.push(inner);

  world.notify('THE DOJO', 'nothing here can kill you');
}

export const DOJO_LEVEL = {
  name: 'The Dojo',
  blurb: 'A quiet room, a training remote, and all the time in the world. Start here.',
  terrain: 'hangar',
  pool: [],
  groundColor: 0x6a7078,
  spawnRadius: [5, 8],
  training: true,
  atmosphere: {
    sky: false, bgColor: 0x0c1119, fog: true, fogColor: 0x161d28, fogDensity: 0.009,
    sunColor: 0xcfe0ff, sunIntensity: 4.5, ambient: 0.5,
    skyColor: 0x6e88b8, groundColor: 0x2a2e36, elevation: 70, azimuth: 30,
    fillColor: 0xffb070, fillIntensity: 0.5,
    exposure: 1.25, bloom: 0.55, saturation: 1.0,
    lift: [0.006, 0.008, 0.013], gain: [0.99, 1.0, 1.05],
  },
  ambience: { wind: 0.02, windFreq: 150, drone: 0.13 },
  dust: { count: 420, color: 0xc0cadd, opacity: 0.13, size: 14 },
  grass: 0,
  dress: dressDojo,
};
