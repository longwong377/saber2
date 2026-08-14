/**
 * SABER — every body in the room makes a sound.
 *
 * Before this file the game's enemies were audible only when they SHOT at you.
 * A hundred-and-thirty-kilo B2 walked across sand in total silence; a 1400 kg
 * acklay arrived without a footfall; a droideka unrolled two metres behind your
 * back and the first thing you heard was the bolt. The one exception was the
 * humanoid rig's footstep hook, and that played the same 80 kg boot for
 * everything that had legs.
 *
 * So: a body is a MASS, a MATERIAL and a GAIT, and each of those makes its own
 * noise. Mass decides how hard the ground answers (Audio.footfall), material
 * decides whether the movement itself is a motor or a chest — a droid's servos
 * sing under load, an organic breathes, and the breathing gets faster as it
 * gets closer to dying — and gait decides when. None of it is a voice line;
 * this is the room, not the script. src/ui/Announcer.js owns what things SAY.
 *
 * ── two ways in, one reason ─────────────────────────────────────────────
 *
 * Rigged humanoids already know exactly when their feet land: BipedAnimator
 * calls `onFootstep` on the frame the sole touches. Wrapping that hook is
 * strictly better than guessing, so it is wrapped — the original is always
 * called, and the weight layer is added under it. Everything else in the game
 * (droideka, walker, acklay, remote) has no rig and no such hook, so its gait
 * is derived from how fast it is actually travelling. That is why there are two
 * paths and not one.
 *
 * ── and it cannot become a swarm ────────────────────────────────────────
 *
 * tools/checks/audio.mjs exists because 94% of every voice the game asked for
 * was a footstep and the pool sat full for nine seconds at a time. This system
 * could trivially do it again — twenty enemies × (steps + servos + breath) is a
 * hundred requests a second — so the budget is enforced HERE, before the pool
 * is even asked: only the `MAX_BODIES` nearest enemies inside `RANGE` are
 * audible at all, and everything it does emit is `PRIO.chatter`, which the
 * bands already cap at a third of the engine.
 */

import * as THREE from 'three';
import { clamp, makeRng } from './MathUtil.js';
import { audio as defaultAudio } from './Audio.js';

/** Nothing further than this has a body worth hearing. */
export const RANGE = 34;
/** …and at most this many of them at once, nearest first. */
export const MAX_BODIES = 6;

/**
 * THE MATERIAL LINE, and the one number this module states instead of importing.
 *
 * `TOUGHNESS.droid` — src/game/Combat.js:267. Everything at or above it is
 * plate (droid 2.0, armour 4.5, heavy 14, durasteel 42); everything under it is
 * a body (flesh 0.9, plastoid armour over a person 1.5). This module is
 * engine-side and nothing in src/engine imports src/game, so the threshold is
 * WRITTEN here — and then pinned: tools/checks/voices.mjs imports the real
 * TOUGHNESS table and asserts PLATE === TOUGHNESS.droid and
 * TOUGHNESS.plastoid < PLATE < TOUGHNESS.armour, so the copy cannot drift in
 * silence the way the key lists it replaced did.
 */
export const PLATE = 2;

/**
 * WHAT KIND OF THING THIS IS — the roster's ONE body classifier.
 *
 * It used to be three regexes over the archetype KEY, and a key list is a copy
 * of a table that has to be remembered:
 *
 *     const DROIDS = /^(b1|b2|droideka|walker|remote|dummy)$/;
 *     const BEASTS = /^(beast)$/;
 *
 * `Object.keys(ARCHETYPES)` is fourteen. Those regexes knew eleven. The three
 * registered outside src/game/Enemy.js — the IG Bodyguard Droid, the Reek and
 * the Nexu, all three added in src/game/Levels.js — fell through every branch
 * and came out as a plain humanoid: measured, `bodyOf` answered droid=0 beast=0
 * for all three, so the 240 kg IG droid BREATHED instead of running its servos
 * and the two large animals breathed at a man's pitch (1.0) rather than an
 * animal's (0.42) and took two footfalls a stride instead of four. The same
 * three key names were missing from src/ui/Announcer.js's own copy of this
 * classification, so the Reek also DIED in the acolyte's throat — f0 97 on the
 * two-syllable human scream — where the Acklay dies at f0 58 on the beast's.
 *
 * So it is derived from the archetype RECORD the body is carrying, and there is
 * now exactly one of it: src/ui/Announcer.js imports this function and picks the
 * voice off the same flags, instead of keeping a second list of key names that
 * agrees with this one only until somebody adds a droid.
 *
 * The fields it reads are the ones the record already has to declare to be that
 * kind of thing at all:
 *
 *   `custom`   the body class. src/game/Enemy.js switches on it for the beast
 *              brain, the six-legged pose, the three-legs-down topple and the
 *              remote's hover — so anything that is a beast MUST carry
 *              `custom: 'beast'` to be a beast, and beast/charger/stalker all do.
 *   `toughness` what the thing is MADE OF, which is the same question as
 *              "motor or lungs" asked from the other side. An earlier note here
 *              said the two were different questions; they are not — plate
 *              sings under load and tissue breathes, and both facts come from
 *              the material. See PLATE above.
 *   `saber`    among bodies, the duellist and the rank-and-file soldier. A
 *              robed acolyte carries one, a clone in a bucket does not.
 *
 * The one thing that is NOT here any more is a `voice` key. It used to exist,
 * read `enemy.voiceKey || …` for a field assigned nowhere in the project, and
 * answered 'droid' for the walker while the Announcer answered with the
 * walker's own hydraulic groan. That was a second, unread, wrong answer; what
 * replaced it is a single answer with two readers.
 */
export function bodyOf(enemy) {
  const A = enemy?.A || {};
  const kind = String(A.custom || '');
  const mass = Number.isFinite(A.mass) ? A.mass : 80;
  const scale = Number.isFinite(A.scale) ? A.scale : 1;
  const toughness = Number.isFinite(A.toughness) ? A.toughness : 0;
  const beast = kind === 'beast';
  const walker = kind === 'walker';
  // A hovering remote is plastoid-shelled and still a machine, so it is named
  // beside the material rather than measured by it.
  const droid = !beast && (walker || kind === 'droideka' || kind === 'remote' || toughness >= PLATE);
  return {
    droid,
    beast,
    /** Its own flag rather than a `type === 'walker'` at each reader. */
    walker,
    // A trooper is a person in a bucket: lungs, but heard through a helmet.
    // Among bodies, the ones without a blade — the acolyte and the sparring
    // partner have `saber: true`, the clone and the marksman do not.
    trooper: !droid && !beast && !A.saber,
    mass,
    scale,
    /** Legs on the ground. A walker and every animal plant four; the rest, two. */
    legs: walker || beast ? 4 : 2,
    /** A hovering droid has no gait at all. */
    grounded: !(A.float > 0) && kind !== 'remote',
  };
}

const _v = new THREE.Vector3();
/** Seeded, so a run of the check measures the same room twice. */
const rng = makeRng(90210);

export class Presence {
  constructor(audio = defaultAudio) {
    this.audio = audio;
    /** Per-enemy bookkeeping. Keyed by the enemy itself; pruned every frame. */
    this.state = new Map();
    this.stats = { steps: 0, servos: 0, breaths: 0, culled: 0, bodies: 0 };
    this._seen = new Set();
  }

  /**
   * One frame of the room.
   *
   * `settings.enemyBody` is read HERE, live, on every frame — not captured at
   * construction — so unticking the box in the pause menu silences the next
   * frame rather than the next deploy. Turning it off does not merely stop new
   * sounds: `_wrap` keeps calling the enemy's own footstep hook (that is where
   * the sand puff comes from, and an audio toggle must not take a particle
   * effect with it) and adds nothing.
   */
  update(dt, world) {
    const s = world?.settings || {};
    const enemies = world?.enemies;
    if (!enemies || !enemies.length) { if (this.state.size) this.state.clear(); return; }
    const on = s.enemyBody !== false;
    const ear = this.audio?._listenerPos
      || world.player?.chest || world.player?.position || _v.set(0, 0, 0);

    /* Nearest first, and only MAX_BODIES of them. The budget is spent before
     * the voice pool is asked for anything, which is the whole point. */
    const near = [];
    for (const e of enemies) {
      if (!e || e.dead || e.toppled) continue;
      const p = e.position;
      if (!p || !Number.isFinite(p.x)) continue;
      const d2 = p.distanceToSquared(ear);
      if (d2 > RANGE * RANGE) { this.stats.culled++; continue; }
      near.push({ e, d2 });
    }
    near.sort((a, b) => a.d2 - b.d2);
    if (near.length > MAX_BODIES) { this.stats.culled += near.length - MAX_BODIES; near.length = MAX_BODIES; }
    this.stats.bodies = near.length;

    this._seen.clear();
    for (const { e, d2 } of near) {
      this._seen.add(e);
      let st = this.state.get(e);
      if (!st) {
        st = {
          body: bodyOf(e), last: e.position.clone(), speed: 0,
          stepT: rng() * 0.4, breathT: rng() * 1.4, servoT: rng() * 0.3,
          exhale: true, wrapped: false,
        };
        this.state.set(e, st);
      }
      // Speed from the position we watched, not from a field on the enemy:
      // netDriven bodies, ragdolls and toppled walkers all move without ever
      // touching `velocity`, and a gait derived from a stale number is worse
      // than no gait.
      const moved = _v.subVectors(e.position, st.last).setY(0).length();
      st.last.copy(e.position);
      st.speed += (Math.min(moved / Math.max(1e-4, dt), 14) - st.speed) * Math.min(1, dt * 8);

      this._wrap(e, st, world);
      if (!on) continue;
      const effort = clamp(st.speed / 5, 0, 1);
      if (!st.body.droid) this._breath(dt, e, st, effort);
      if (st.body.droid) this._servo(dt, e, st, effort);
      if (!st.wrapped && st.body.grounded) this._gait(dt, e, st, world);
    }

    // Anything that stopped being audible stops being remembered.
    if (this.state.size > this._seen.size) {
      for (const k of [...this.state.keys()]) if (!this._seen.has(k)) this.state.delete(k);
    }
  }

  /**
   * Put the body's weight under the rig's own footstep.
   *
   * The rig knows the frame; it does not know the mass. `Enemy` installs a hook
   * that plays an 80 kg boot and puffs sand, and both of those are still what
   * happens — this only adds the layer that says how heavy the thing on the
   * other end of that boot is. Wrapped once, and marked, because a hook wrapped
   * every frame is a stack of closures that grows until the enemy dies.
   */
  _wrap(enemy, st, world) {
    const an = enemy.animator;
    if (!an || st.wrapped || an._presenceWrapped) { if (an?._presenceWrapped) st.wrapped = true; return; }
    const inner = an.onFootstep;
    const self = this;
    an._presenceWrapped = true;
    st.wrapped = true;
    an.onFootstep = (p) => {
      try { inner?.(p); } catch {}
      if (world?.settings?.enemyBody === false) return;
      if (enemy.lod > 1 || enemy.dead) return;
      self._weight(p, st, world);
    };
  }

  /** The mass layer: what the ground does about a body this heavy. */
  _weight(p, st, world) {
    const m = st.body.mass;
    // A trooper is the reference weight and already has a boot; anything
    // meaningfully heavier gets the low end of its own footfall on top.
    if (m < 95) return;
    const surface = world?.terrain ? world.terrain.surfaceAt(p.x, p.z) : 'sand';
    this.audio.footfall(p, { surface, run: st.speed > 4, mass: m });
    this.stats.steps++;
  }

  /**
   * A gait for the things with no rig.
   *
   * Stride length scales with the body: an acklay covers three metres a step
   * and a droideka half of one, so the cadence is distance-driven rather than
   * a fixed tick — which also means a stopped body stops making footsteps
   * instead of marching on the spot.
   */
  _gait(dt, enemy, st, world) {
    if (st.speed < 0.35) { st.stepT = Math.min(st.stepT, 0.12); return; }
    st.stepT -= dt;
    if (st.stepT > 0) return;
    const stride = clamp(0.85 * st.body.scale, 0.5, 3.2);
    st.stepT = clamp(stride / Math.max(0.5, st.speed) / (st.body.legs / 2), 0.16, 1.4);
    const p = enemy.position;
    const surface = world?.terrain ? world.terrain.surfaceAt(p.x, p.z) : 'sand';
    this.audio.footfall(p, { surface, run: st.speed > 4, mass: st.body.mass });
    this.stats.steps++;
  }

  /** Motors. Faster when the thing is working, and pitched by its size. */
  _servo(dt, enemy, st, effort) {
    st.servoT -= dt;
    if (st.servoT > 0) return;
    // Idle droids tick slowly; a charging one is nearly continuous. The floor
    // is deliberately not zero — a servo per frame is a saw wave, not a servo.
    st.servoT = clamp(0.62 - effort * 0.42, 0.16, 0.8) * (0.85 + rng() * 0.3);
    this.audio.servo(enemy.position, effort, st.body.scale);
    this.stats.servos++;
  }

  /**
   * Lungs.
   *
   * Rate rises with exertion and again as the thing runs out of health, which
   * is the one piece of enemy state a player can hear before they can see it: a
   * wounded acolyte behind you is breathing twice as fast as a fresh one.
   */
  _breath(dt, enemy, st, effort) {
    st.breathT -= dt;
    if (st.breathT > 0) return;
    const hurt = enemy.maxHp > 0 ? clamp(1 - enemy.hp / enemy.maxHp, 0, 1) : 0;
    const drive = clamp(effort * 0.7 + hurt * 0.6, 0, 1);
    st.exhale = !st.exhale;
    st.breathT = clamp(1.9 - drive * 1.15, 0.55, 2.2) * (st.exhale ? 0.62 : 1) * (0.9 + rng() * 0.2);
    this.audio.breath(enemy.position, {
      out: st.exhale, effort: drive,
      // A beast's airway is huge and a trooper's is inside a helmet.
      pitch: st.body.beast ? 0.42 : st.body.trooper ? 1.15 : 1,
    });
    this.stats.breaths++;
  }
}
