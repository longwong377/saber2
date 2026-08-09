/**
 * SABER — the dojo.
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
import { sandboxConfig, holdFire, tuneFireRate, DOJO_MIX } from './Waves.js';
import { clamp, lerp, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

const rng = makeRng(51515);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

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
    brief: 'Fast tip, contact past the middle of the blade, and something under your reticle. Then the bolt goes home.',
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
    id: 'free', title: 'Free practice', need: Infinity,
    brief: 'Everything at once. Nothing here can kill you.',
    hint: 'Change the sparring form in the pause menu, or go and find a real fight.',
    setup: { remotes: 3, fireRate: 1.4, boltSpeed: 38, dummies: 3, spar: true, sparForm: 'juyo', sparSpeed: 0.85 },
    check: () => false,
  },
  {
    // The lessons above each pin the room to what they are teaching, which is
    // exactly what makes them lessons and exactly why none of them is a place
    // to just mess about. This one hands the room over: it reads the sandbox
    // numbers off the settings every second, so the count and the fire rate
    // are live from the pause screen.
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
    this.totalSpawned = 0;
    this.streak = 0;
    // sandbox bookkeeping — see _sandboxRoom
    this.sandboxUnits = [];
    this._mixCursor = 0;
    this._sandboxFire = null;
    this._sandboxSaid = -1;
  }

  get lesson() { return LESSONS[Math.min(this.index, LESSONS.length - 1)]; }
  get remaining() { return this.lesson.need === Infinity ? 0 : Math.max(0, this.lesson.need - this.progress); }
  get inSandbox() { return !!this.lesson.setup?.sandbox; }

  start() {
    // Picking Sandbox on the Deploy screen and then landing on lesson one
    // would be a lie about what the player asked for.
    if (this.world.settings?.mode === 'sandbox') this.index = LESSONS.length - 1;
    this._applyLesson();
  }

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
    this.sandboxUnits.length = 0;
    this._mixCursor = 0;
    this._sandboxFire = null;
    w.bolts?.clear();

    const anchor = w.player ? w.player.position : _v1.set(0, 0, 0);

    if (s.sandbox) { this._sandboxRoom(anchor); this.onLesson?.(this.state()); return; }

    for (let i = 0; i < (s.remotes || 0); i++) {
      const a = (i / Math.max(1, s.remotes)) * TAU + 0.5;
      const e = w.spawnEnemy('remote', _v2.set(anchor.x + Math.cos(a) * 5.5, 0, anchor.z + Math.sin(a) * 5.5));
      e.trainingFireRate = s.fireRate ?? 2.0;
      e.trainingBoltSpeed = s.boltSpeed ?? 30;
      e.invincible = !!s.invincibleRemotes;
      this.remotes.push(e);
    }
    for (let i = 0; i < (s.dummies || 0); i++) {
      const a = (i / Math.max(1, s.dummies)) * TAU - 0.8;
      const e = w.spawnEnemy('dummy', _v2.set(anchor.x + Math.cos(a) * 3.4, 0, anchor.z + Math.sin(a) * 3.4));
      this.dummies.push(e);
    }
    if (s.spar) {
      const e = w.spawnEnemy('sparring', _v2.set(anchor.x, 0, anchor.z - 3.2));
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

  /* ── the sandbox room ────────────────────────────────────────────── */

  /** Ring radius for a sandbox unit: remotes orbit wide, dummies stand close. */
  _sandboxRadius(type) {
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
    const r = this._sandboxRadius(type) * (1 + 0.06 * (index % 5));
    const a = index * 2.39996 + 0.5;
    const e = w.spawnEnemy(type, _v2.set(anchor.x + Math.cos(a) * r, 0, anchor.z + Math.sin(a) * r));
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
        const idx = w.enemies.indexOf(e);
        if (idx >= 0) w.enemies.splice(idx, 1);
        const j = this.sandboxUnits.indexOf(e);
        if (j >= 0) this.sandboxUnits.splice(j, 1);
        w.bladeSolver?.clearTarget?.(e.id);
        e.dispose();
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

    // dummies and remotes come back so the lesson never stalls
    this._settleTimer -= dt;
    if (this._settleTimer <= 0) {
      this._settleTimer = 1.0;
      const w = this.world;
      const anchor = w.player ? w.player.position : _v1.set(0, 0, 0);
      for (const list of [this.remotes, this.dummies]) {
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (!e.dead) continue;
          if (e.dying < 2.2) continue;
          const isRemote = list === this.remotes;
          const a = rng() * TAU;
          const r = isRemote ? 5.5 : 3.4;
          const fresh = w.spawnEnemy(isRemote ? 'remote' : 'dummy',
            _v2.set(anchor.x + Math.cos(a) * r, 0, anchor.z + Math.sin(a) * r));
          if (isRemote) {
            fresh.trainingFireRate = e.trainingFireRate;
            fresh.trainingBoltSpeed = e.trainingBoltSpeed;
            fresh.invincible = e.invincible;
          }
          list[i] = fresh;
        }
      }
      if (this.spar && this.spar.dead && this.spar.dying > 2.6) {
        const fresh = this.world.spawnEnemy('sparring',
          _v2.set(anchor.x, 0, anchor.z - 3.4));
        if (fresh.duel && this.spar.duel) {
          fresh.duel.formKey = this.spar.duel.formKey;
          fresh.duel.form = this.spar.duel.form;
          fresh.formName = fresh.duel.describe();
        }
        fresh.trainingSpeed = this.spar.trainingSpeed;
        this.spar = fresh;
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
