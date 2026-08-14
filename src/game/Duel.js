/**
 * SABER — duelling.
 *
 * V1 gave duellists a swing on a timer. You could parry one, but only by luck,
 * because nothing about the attack was legible before it landed. A skill
 * ceiling you cannot see is not a skill ceiling.
 *
 * So every attack here is a declared arc with a wind-up you can read: the blade
 * traces a ghost of where it is about to go, colour-coded by what answers it,
 * and there is a window near the end of the wind-up where a counter-swing
 * chambers. Duellists fight in *forms* with distinct rhythms, so a player
 * learns "that is Djem So, it commits hard, punish the recovery" rather than
 * "something is happening again".
 *
 * The arcs live in the duellist's local frame with −Z forward, matching the
 * guard-sphere the player's own blade uses.
 */

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, makeRng, TAU } from '../engine/MathUtil.js';
import { audio } from '../engine/Audio.js';

/**
 * The duel stream, EXPORTED so a fight can be made reproducible.
 *
 * Every DuelBrain in the process draws from it, which is what stops two
 * acolytes fighting identically — and it is also what makes a measurement of a
 * form depend on how many duels happened before it. `rng.seed(n)` puts it back;
 * tools/checks/duelling.mjs calls it before each form so that "does this form's
 * blade land" is one question asked five times rather than five different
 * questions.
 */
export const duelRng = makeRng(8123);
const rng = duelRng;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const D = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

/* ══════════════════════════════════════════════════════════════════════ */
/*  Guard space → world, and the 180° that made every duel free           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE BUG THIS FUNCTION EXISTS TO KILL.
 *
 * Guard space is −Z forward, +X right, +Y up — the file header says so, and
 * the arcs above are all written in it. A duellist's heading, however, is a
 * yaw where FORWARD IS +Z: Enemy._move sets `facing = atan2(toTarget.x,
 * toTarget.z)` and everything that draws a body reads `(sin f, 0, cos f)` as
 * the way it is looking.
 *
 * Three places converted between the two with a bare
 *
 *     q.setFromAxisAngle(UP, facing)
 *
 * which takes local −Z to `(−sin f, 0, −cos f)` — exactly BEHIND the duellist.
 * So every acolyte in the game held its blade over its own back, telegraphed
 * its arcs behind itself, and swung at the empty air on the far side of its
 * body. Measured on a real Enemy driven at a real Player for 30 s at 1.6 m:
 *
 *     hilt offset · toPlayer   −0.71     (the hands were behind the body)
 *     blade direction · toPlayer −0.84
 *     closest tip → player      2.18 m   (the test needs 0.44 m)
 *     closest blade → blade     1.25 m   (a clash needs 0.10 m)
 *     hits landed               0
 *
 * That is the whole of "enemy lightsabers do no damage" and the whole of
 * "blade-on-blade contact has never been observed": both hit tests were real,
 * both were correct, and neither could ever fire because the weapon was
 * pointing the wrong way. The conversion lives here now, once, so a body, its
 * telegraph and its chamber test cannot disagree about which way is forward.
 *
 * +π is the whole fix: it takes local −Z to `(sin f, 0, cos f)` and local +X
 * to `fwd × up`, which is the duellist's actual right hand.
 */
export function guardQuat(yaw, spin = 0, out = new THREE.Quaternion()) {
  return out.setFromAxisAngle(UP, yaw + spin + Math.PI);
}

/** A guard-space direction, in world space, for a body facing `yaw`. */
export function guardToWorld(dir, yaw, spin = 0, out = new THREE.Vector3()) {
  return out.copy(dir).applyQuaternion(guardQuat(yaw, spin, _qg)).normalize();
}
const _qg = new THREE.Quaternion();

/** How an attack must be answered — and what colour says so. */
export const TIER = {
  light:       { colour: 0x9fd8ff, label: 'parry or chamber', chamberable: true,  parryable: true,  guardBreak: 0.6 },
  heavy:       { colour: 0xffb03a, label: 'chamber or evade', chamberable: true,  parryable: false, guardBreak: 1.9 },
  unblockable: { colour: 0xff3a46, label: 'evade',            chamberable: false, parryable: false, guardBreak: 3.2 },
};

/* ── the moves ───────────────────────────────────────────────────────── */

/**
 * Exported so a check can drive `chambersWith` against every authored attack
 * rather than a copy of the table. `spin` shipped with `to === from`, which
 * made it unchamberable, and nothing could see that because nothing outside
 * this file could enumerate the attacks.
 */
export const ATTACKS = {
  overhead:   { label: 'overhead',   from: D(0.05, 1.0, -0.35),  to: D(0, -0.55, -0.95), tier: 'heavy', damage: 1.35, reach: 0.06 },
  cleave:     { label: 'cleave',     from: D(0.95, 0.75, -0.4),  to: D(-0.8, -0.5, -0.8), tier: 'heavy', damage: 1.3, reach: 0.05 },
  slashR:     { label: 'slash',      from: D(0.95, 0.3, -0.55),  to: D(-0.85, 0.05, -0.6), tier: 'light', damage: 1.0 },
  slashL:     { label: 'slash',      from: D(-0.95, 0.3, -0.55), to: D(0.85, 0.05, -0.6), tier: 'light', damage: 1.0 },
  riposteCut: { label: 'wrist cut',  from: D(0.5, 0.55, -0.75),  to: D(-0.3, -0.2, -0.95), tier: 'light', damage: 0.85 },
  rising:     { label: 'rising cut', from: D(0.35, -0.8, -0.6),  to: D(-0.25, 0.85, -0.6), tier: 'light', damage: 1.05 },
  thrust:     { label: 'thrust',     from: D(0.1, 0.15, -0.95),  to: D(0, 0.05, -1.0), tier: 'light', damage: 1.15, reach: 0.42, lunge: 3.4 },
  lunge:      { label: 'lunge',      from: D(0, 0.2, -0.9),      to: D(0, 0.0, -1.0), tier: 'unblockable', damage: 1.6, reach: 0.5, lunge: 7.5 },
  /* THE SPIN CUT'S `to` USED TO EQUAL ITS `from`, and that made the one heavy
   * attack in the game impossible to answer. `chambersWith` builds the attack's
   * travel as `to − from`, which was the zero vector; three's `normalize()`
   * leaves that at zero, the dot product is 0, and `0 < -0.55` is never true.
   * Ataru and Juyo both draw it, and it is telegraphed with everything the game
   * has for "counter this now" — an orange arc, a pulsing fill, a rising
   * chamber tone — while the counter could not fire at any swing direction.
   * Sampling 200 000 uniform swing directions against it found zero that
   * chambered. The player who did exactly what the colour told them fell
   * through to the guard-break branch and took the hit.
   *
   * The body really does rotate through the strike (`spin: true` drives
   * `DuelBrain.spin` at 26 rad/s, and `guardQuat` carries the blade with it), so
   * the blade sweeps horizontally across: out to the right, through, and out to
   * the left. A chamber is a swing INTO that travel, which is now what the dot
   * product measures. It also gives Telegraph.shape two distinct endpoints to
   * draw an arc between — with them identical it was drawing a single radial
   * spoke. */
  spin:       { label: 'spin cut',   from: D(1.0, 0.1, -0.2),    to: D(-1.0, 0.1, -0.2), tier: 'heavy', damage: 1.25, spin: true },
  smash:      { label: 'guard break', from: D(0, 1.05, -0.2),    to: D(0, -0.7, -0.75), tier: 'unblockable', damage: 1.5, reach: 0.08 },
};

/* ── the forms ───────────────────────────────────────────────────────── */

export const FORMS = {
  makashi: {
    name: 'Makashi', numeral: 'II',
    tell: 'economical, blade-tip precise — it will thrust the moment you overcommit',
    windup: 0.34, strike: 0.13, recover: 0.24, chamberWindow: 0.42,
    aggression: 0.9, spacing: [1.7, 2.9], chain: [1, 2],
    moves: ['thrust', 'riposteCut', 'slashR', 'slashL', 'thrust'],
    feint: 0.30, punishRecovery: 0.85, saberColour: 4,
  },
  djemSo: {
    name: 'Djem So', numeral: 'V',
    tell: 'heavy and committed — long wind-ups, longer recoveries',
    windup: 0.68, strike: 0.19, recover: 0.58, chamberWindow: 0.34,
    aggression: 0.7, spacing: [1.5, 3.2], chain: [1, 1],
    moves: ['overhead', 'cleave', 'smash', 'overhead'],
    feint: 0.10, punishRecovery: 0.3, saberColour: 4, strength: 1.8,
  },
  ataru: {
    name: 'Ataru', numeral: 'IV',
    tell: 'acrobatic flurries — it will not stop at one',
    windup: 0.24, strike: 0.11, recover: 0.17, chamberWindow: 0.5,
    aggression: 1.3, spacing: [1.4, 3.6], chain: [2, 4],
    moves: ['slashR', 'slashL', 'rising', 'spin', 'riposteCut'],
    feint: 0.22, punishRecovery: 0.6, saberColour: 4, mobile: true,
  },
  soresu: {
    name: 'Soresu', numeral: 'III',
    tell: 'gives you nothing — it is waiting for you to swing first',
    windup: 0.40, strike: 0.14, recover: 0.26, chamberWindow: 0.45,
    aggression: 0.42, spacing: [1.8, 3.0], chain: [1, 2],
    moves: ['slashR', 'riposteCut', 'thrust'],
    feint: 0.14, punishRecovery: 1.0, saberColour: 4, defensive: 1.7,
  },
  juyo: {
    name: 'Juyo', numeral: 'VII',
    tell: 'erratic — the rhythm is the trap',
    windup: 0.30, strike: 0.13, recover: 0.22, chamberWindow: 0.36,
    aggression: 1.15, spacing: [1.4, 3.2], chain: [1, 3],
    moves: ['cleave', 'slashL', 'lunge', 'rising', 'overhead', 'spin'],
    feint: 0.42, punishRecovery: 0.75, saberColour: 4, erratic: 0.55,
  },
};

export const FORM_KEYS = Object.keys(FORMS);

/* ══════════════════════════════════════════════════════════════════════ */
/*  Telegraph — the ghost of the swing that is coming                     */
/* ══════════════════════════════════════════════════════════════════════ */

const TELE_VERT = /* glsl */`
  attribute float aT;
  attribute float aSide;
  varying float vT; varying float vSide;
  void main(){
    vT = aT; vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const TELE_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColour; uniform float uFill; uniform float uAlpha; uniform float uPulse;
  varying float vT; varying float vSide;
  void main(){
    // the arc fills from its start toward its end as the strike approaches
    float lead = smoothstep(uFill + 0.16, uFill - 0.02, vT);
    float edge = 1.0 - abs(vSide * 2.0 - 1.0);
    float head = smoothstep(uFill - 0.22, uFill, vT) * lead;
    float a = (edge * 0.5 + 0.5) * lead * uAlpha;
    a *= 0.35 + head * 1.5;
    a *= uPulse;
    if(a < 0.004) discard;
    gl_FragColor = vec4(uColour * (1.0 + head * 2.2), a);
  }
`;

export class Telegraph {
  constructor(scene, segments = 18) {
    this.n = segments;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 2 * 3);
    const aT = new Float32Array(this.n * 2);
    const aSide = new Float32Array(this.n * 2);
    const idx = [];
    for (let i = 0; i < this.n; i++) {
      aT[i * 2] = aT[i * 2 + 1] = i / (this.n - 1);
      aSide[i * 2] = 0; aSide[i * 2 + 1] = 1;
      if (i < this.n - 1) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColour: { value: new THREE.Color(0x9fd8ff) },
        uFill: { value: 0 },
        uAlpha: { value: 0 },
        uPulse: { value: 1 },
      },
      vertexShader: TELE_VERT, fragmentShader: TELE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.scene = scene;
  }

  /**
   * @param origin  chest position in world space
   * @param yaw     duellist facing
   * @param from,to arc endpoints in local guard space
   * @param inner   distance from chest to the hands
   * @param outer   distance from chest to the blade tip
   */
  shape(origin, yaw, from, to, inner, outer) {
    // guardQuat, not a bare yaw: the ghost has to be drawn where the blade will
    // actually go, and for four months it was drawn behind the duellist.
    guardQuat(yaw, 0, _q1);
    for (let i = 0; i < this.n; i++) {
      const t = i / (this.n - 1);
      // slerp-ish: normalise the lerp so the arc bows the way a swing does
      _v1.copy(from).lerp(to, t).normalize().applyQuaternion(_q1);
      const i6 = i * 6;
      this.pos[i6] = origin.x + _v1.x * inner;
      this.pos[i6 + 1] = origin.y + _v1.y * inner;
      this.pos[i6 + 2] = origin.z + _v1.z * inner;
      this.pos[i6 + 3] = origin.x + _v1.x * outer;
      this.pos[i6 + 4] = origin.y + _v1.y * outer;
      this.pos[i6 + 5] = origin.z + _v1.z * outer;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  set(colour, fill, alpha, pulse = 1) {
    this.mat.uniforms.uColour.value.setHex(colour);
    this.mat.uniforms.uFill.value = fill;
    this.mat.uniforms.uAlpha.value = alpha;
    this.mat.uniforms.uPulse.value = pulse;
    this.mesh.visible = alpha > 0.005;
  }

  hide() { this.mesh.visible = false; this.mat.uniforms.uAlpha.value = 0; }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  The duellist brain                                                    */
/* ══════════════════════════════════════════════════════════════════════ */

export class DuelBrain {
  /**
   * Phases: guard → windup → strike → recover → guard.
   * `feint` sits between guard and windup and aborts back to guard.
   *
   * Phase and timer live on the enemy so the rest of the game can interrupt a
   * duellist simply by writing to them — a parry does exactly that.
   */
  constructor(enemy, opts = {}) {
    this.e = enemy;
    this.formKey = opts.form || FORM_KEYS[Math.floor(rng() * FORM_KEYS.length)];
    this.form = FORMS[this.formKey];
    this.telegraph = opts.telegraph ?? null;

    this.guardDir = new THREE.Vector3(0.4, 0.35, -0.85).normalize();
    this.restDir = this.guardDir.clone();
    this.attack = null;
    this.attackKey = null;
    this.chainLeft = 0;
    this.trackSpeed = 7;
    this.lungeSpeed = 0;
    this.chamberOpen = false;
    this.readTimer = 0.4 + rng() * 0.5;
    this.spin = 0;
    this._cued = false;
    this.lastPhase = 'guard';
    this.timeScale = 1;      // < 1 slows the whole form down, for sparring
    /** Where the guard was driven when the blade was beaten aside. */
    this.staggerDir = null;
    /** How many follow-ups this duellist has taken off one connected hit. */
    this.followUps = 0;

    enemy.saberPhase = 'guard';
    enemy.saberTimer = 0.35 + rng() * 0.5;
  }

  get phase() { return this.e.saberPhase; }
  set phase(v) { this.e.saberPhase = v; }
  get timer() { return this.e.saberTimer; }
  set timer(v) { this.e.saberTimer = v; }

  /** Force back to a neutral guard — used by parries, staggers and hitstop. */
  interrupt(recoverTime = 0.4) {
    this.attack = null;
    this.chainLeft = 0;
    this.chamberOpen = false;
    this.phase = 'recover';
    this.timer = recoverTime;
    this.telegraph?.hide();
  }

  /** True while the blade is out of line and nothing can be thrown from it. */
  get staggered() { return this.phase === 'stagger'; }

  /**
   * THE BLADE BEATEN ASIDE.
   *
   * `interrupt` was the only thing a parry could do to a duellist, and all it
   * does is start the recovery early — the guard slides back to rest, the body
   * keeps circling, and 0.45 s later the same attack comes again. There was no
   * way to SEE that you had won the exchange, so beating a blade aside felt
   * like nothing and the fight had no rhythm above "swing until it dies".
   *
   * A stagger is a phase of its own because it has to be three things at once:
   *   • legible   — the guard is driven wide and low, off the body's line, and
   *                 held there. You can see the opening from across the room.
   *   • punishing — no attack, no chamber, no telegraph, for `seconds`.
   *   • directional — beaten from the left, it opens to the right.
   *
   * `power` scales how far the guard is thrown and how long it stays there, so
   * a light parry is a beat and a won blade-lock is an invitation.
   *
   * @param seconds  how long the duellist is out of line
   * @param worldDir the direction the blade was driven, in WORLD space
   * @param power    0..1+, how hard
   */
  stagger(seconds = 0.55, worldDir = null, power = 1) {
    // A FLOOR, and it is the whole reason this reads on screen. World's parry
    // path stuns for 0.18 s — three frames at 60 Hz, which is a body twitching,
    // not a body beaten. Being unable to MOVE and having your guard OUT OF LINE
    // are different lengths of time; this is the second one, and it is long
    // enough to be an invitation. Capped at 2.2 s so `stun(9999)` on a toppled
    // body does not leave a permanent stagger behind.
    const t = clamp(Math.max(seconds, 0.42) * clamp(power, 0.6, 1.4), 0.32, 2.2);
    // Never shorten an existing stagger: two parries in a row must not read as
    // one, and `Math.max` is the same rule Enemy.stun already follows.
    if (this.staggered && this.timer > t) return;
    this.attack = null;
    this.attackKey = null;
    this.chainLeft = 0;
    this.followUps = 0;
    this.chamberOpen = false;
    this.telegraph?.hide();
    this.phase = 'stagger';
    this.timer = t;
    this._staggerLen = t;

    // Which side the guard is thrown to, in the duellist's own frame. The
    // world direction is taken back into guard space so the opening is on the
    // side the blade was actually driven, whatever way the body happens to be
    // pointing.
    let side = this.guardDir.x >= 0 ? -1 : 1;
    if (worldDir) {
      _v1.copy(worldDir).applyQuaternion(guardQuat(this.e.facing, 0, _q1).invert());
      if (Math.abs(_v1.x) > 1e-4) side = Math.sign(_v1.x);
    }
    this.staggerDir = (this.staggerDir || new THREE.Vector3())
      .set(side * lerp(0.9, 1.5, clamp(power, 0, 1)), -0.45, -0.3).normalize();
  }

  /**
   * A LANDED HIT IS PRESSURE, NOT A FULL STOP.
   *
   * The one thing World did after an enemy blade connected was
   * `e.duel.interrupt(0.45)` — the duellist landed a cut and then politely
   * stepped back and reset. So the only thing that ever punished a mistake was
   * the mistake itself; there was no reason to disengage after being hit,
   * because being hit bought you half a second of quiet.
   *
   * Now a connected hit shortens the recovery and chambers exactly one chained
   * attack, so the answer to taking a cut is to MOVE. Capped at one — a hit
   * must not be able to loop into a stunlock, and `followUps` resets the
   * moment the duellist returns to guard.
   */
  followUp(max = 1) {
    if (this.followUps >= max) { this.interrupt(0.45); return false; }
    this.followUps++;
    const sp = this._speed();
    this.attack = null;
    this.chamberOpen = false;
    this.telegraph?.hide();
    this.chainLeft = Math.max(this.chainLeft, 1);
    this.phase = 'recover';
    this.timer = this.form.recover * sp * 0.5;
    this._recoverLen = this.timer;
    return true;
  }

  /** Speeds scale with difficulty so Grandmaster genuinely reads faster. */
  _speed() {
    const diff = this.e.world.difficulty;
    const base = diff ? lerp(1.35, 0.78, clamp(diff.enemyAggression / 1.3, 0, 1)) : 1;
    return base / clamp(this.timeScale, 0.2, 3);
  }

  update(dt, ctx, dist) {
    const F = this.form;
    const sp = this._speed();
    this.timer -= dt;
    this.lungeSpeed = damp(this.lungeSpeed, 0, 8, dt);
    this.spin = this.phase === 'strike' && this.attack?.spin ? this.spin + dt * 26 : 0;

    const target = this.e.target;
    // Soresu and friends watch what you are doing and answer it
    const playerCommitted = target && target.control
      ? target.control.angVel.length() > 7.5 : false;
    const playerRecovering = target && target.control
      ? (target.staggerTimer > 0 || target.stamina < target.maxStamina * 0.22) : false;

    switch (this.phase) {
      case 'guard': {
        this.trackSpeed = 7;
        this.chamberOpen = false;
        this.readTimer -= dt;
        if (this.readTimer <= 0) {
          this.readTimer = 0.35 + rng() * 0.55;
          // drift the guard so the duellist never reads as idle
          this.restDir.set((rng() - 0.5) * 1.25, rng() * 0.75 - 0.05, -0.85).normalize();
        }
        this.guardTargetDir = this.restDir;

        const inRange = dist < F.spacing[1];
        const want = F.aggression * (playerRecovering ? 1 + F.punishRecovery : 1)
                   * (F.defensive && !playerCommitted ? 0.35 : 1);
        // The decision happens when the pause between attacks runs out — once,
        // not every frame. Rolling per-frame made aggression depend on the
        // player's framerate and left duellists idling for seconds at a time.
        if (this.timer <= 0) {
          if (inRange && rng() < clamp(want * 0.62, 0.1, 0.94)) {
            if (rng() < F.feint) this._beginFeint(sp);
            else this._beginAttack(sp);
          } else {
            this.timer = (0.2 + rng() * 0.45) / clamp(F.aggression, 0.45, 1.6);
          }
        }
        break;
      }

      case 'feint': {
        // show the arc, then abandon it — the whole point is to bait a chamber
        this.trackSpeed = 16;
        const k = 1 - clamp(this.timer / this._feintLen, 0, 1);
        this.guardTargetDir = this.attack.from;
        this._drawTelegraph(k * 0.45, 0.5, 1);
        if (this.timer <= 0) {
          this.telegraph?.hide();
          this.phase = 'guard';
          this.timer = 0.16 + rng() * 0.2;
          this.attack = null;
          this.e.world.notifyFloating?.(this.e.aimPoint(_v2), 'FEINT', '#c8b0ff');
        }
        break;
      }

      case 'windup': {
        this.trackSpeed = 13;
        this.guardTargetDir = this.attack.from;
        const k = 1 - clamp(this.timer / this._windupLen, 0, 1);
        // the chamber window is the tail of the wind-up
        const tier = TIER[this.attack.tier];
        this.chamberOpen = tier.chamberable && k > (1 - F.chamberWindow);
        if (this.chamberOpen && !this._cued) {
          this._cued = true;
          audio.tone({ freq: 2100, freqEnd: 2600, dur: 0.07, gain: 0.05, type: 'sine', pos: this.e.position });
        }
        this._drawTelegraph(k, 0.28 + k * 0.72, this.chamberOpen ? 1.5 + Math.sin(k * 60) * 0.4 : 1);
        if (this.timer <= 0) {
          this.phase = 'strike';
          this.timer = this.attack.strike ?? (F.strike * sp);
          this._strikeLen = this.timer;
          this.lungeSpeed = this.attack.lunge ?? 0;
          audio.swing(this.attack.tier === 'light' ? 16 : 26, this.e.saber.base);
          this.telegraph?.hide();
        }
        break;
      }

      case 'strike': {
        this.trackSpeed = this.attack.tier === 'light' ? 30 : 22;
        const k = 1 - clamp(this.timer / this._strikeLen, 0, 1);
        this.guardTargetDir = _v1.copy(this.attack.from).lerp(this.attack.to, k).normalize();
        this.chamberOpen = false;
        if (this.timer <= 0) {
          this.phase = 'recover';
          this.timer = (this.attack.recover ?? F.recover) * sp;
          this._recoverLen = this.timer;
        }
        break;
      }

      case 'recover': {
        this.trackSpeed = 6;
        this.chamberOpen = false;
        this.guardTargetDir = this.attack
          ? _v1.copy(this.attack.to).lerp(this.restDir, 0.45).normalize()
          : this.restDir;
        if (this.timer <= 0) {
          if (this.chainLeft > 0 && dist < F.spacing[1] + 0.5) {
            this.chainLeft--;
            this._beginAttack(sp, true);
          } else {
            this.phase = 'guard';
            this.attack = null;
            this.followUps = 0;
            this.timer = 0.16 + rng() * 0.34;
          }
        }
        break;
      }

      case 'stagger': {
        // Out of line and staying there. The guard is DRIVEN to the opening
        // rather than eased to it — a beaten blade travels, it does not drift —
        // and it comes back on the last third so the window has a visible end.
        const k = 1 - clamp(this.timer / (this._staggerLen || 0.5), 0, 1);
        this.trackSpeed = k < 0.66 ? 22 : 7;
        this.chamberOpen = false;
        this.guardTargetDir = k < 0.66
          ? (this.staggerDir || this.restDir)
          : _v1.copy(this.staggerDir || this.restDir).lerp(this.restDir, (k - 0.66) * 3).normalize();
        if (this.timer <= 0) {
          this.phase = 'guard';
          this.attack = null;
          this.followUps = 0;
          // `staggerDir` is deliberately kept rather than nulled: the next
          // parry writes into the same vector instead of allocating one.
          // A beaten duellist does not attack on the frame it recovers.
          this.timer = 0.18 + rng() * 0.26;
        }
        break;
      }

      default:
        this.phase = 'guard';
        this.timer = 0.3;
    }

    this.lastPhase = this.phase;
    // move the actual guard toward wherever the phase wants it
    if (this.guardTargetDir) {
      this.guardDir.lerp(this.guardTargetDir, clamp(dt * this.trackSpeed, 0, 1)).normalize();
    }
  }

  _pick() {
    const F = this.form;
    let key = F.moves[Math.floor(rng() * F.moves.length)];
    // Juyo deliberately breaks its own rhythm
    if (F.erratic && rng() < F.erratic * 0.4) key = F.moves[Math.floor(rng() * F.moves.length)];
    return key;
  }

  _beginAttack(sp, chained = false) {
    const F = this.form;
    this.attackKey = this._pick();
    this.attack = { ...ATTACKS[this.attackKey] };
    if (!chained) this.chainLeft = Math.floor(lerp(F.chain[0], F.chain[1] + 0.99, rng())) - 1;
    // erratic forms vary the wind-up so you cannot metronome them
    const jitter = F.erratic ? lerp(0.7, 1.4, rng()) : lerp(0.92, 1.08, rng());
    this.phase = 'windup';
    this.timer = F.windup * sp * jitter * (chained ? 0.72 : 1);
    this._windupLen = this.timer;
    this._cued = false;
  }

  _beginFeint(sp) {
    this.attackKey = this._pick();
    this.attack = { ...ATTACKS[this.attackKey] };
    this.phase = 'feint';
    this.timer = this.form.windup * sp * 0.55;
    this._feintLen = this.timer;
    this._cued = false;
  }

  _drawTelegraph(fill, alpha, pulse) {
    const t = this.telegraph;
    if (!t || !this.attack) return;
    const e = this.e;
    const S = e.A.scale;
    _v3.copy(e.position).setY(e.position.y + 1.34 * S);
    t.shape(_v3, e.facing, this.attack.from, this.attack.to, 0.34 * S, (0.34 + 1.12) * S);
    t.set(TIER[this.attack.tier].colour, fill, alpha * (this.e.lod > 1 ? 0 : 1), pulse);
  }

  /** Does a swing in this direction chamber the current attack? */
  chambersWith(worldSwingDir) {
    if (!this.chamberOpen || !this.attack) return false;
    guardQuat(this.e.facing, 0, _q1);
    _v1.copy(this.attack.to).sub(this.attack.from).applyQuaternion(_q1).normalize();
    return _v1.dot(_v2.copy(worldSwingDir).normalize()) < -0.55;
  }

  get damageScale() { return this.attack ? this.attack.damage : 1; }
  get tier() { return this.attack ? TIER[this.attack.tier] : TIER.light; }

  describe() {
    return `${this.form.name} ${this.form.numeral}`;
  }
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Blade lock — the contest when two blades meet slowly                  */
/* ══════════════════════════════════════════════════════════════════════ */

export class BladeLock {
  /**
   * A held bind. Both fighters push; the player pushes by driving the mouse,
   * which is the same verb that moves the blade — so winning a lock is still
   * about the wrist, not a button.
   */
  constructor(player, enemy, point) {
    this.player = player;
    this.enemy = enemy;
    this.point = point.clone();
    this.pressure = 0;          // −1 = player losing, +1 = player winning
    this.time = 0;
    this.done = false;
    this.result = null;
    this.strength = (enemy.duel?.form.strength ?? 1) * (enemy.A.scale);
    audio.clash(point, 0.7);
    audio.noise({ dur: 1.4, gain: 0.16, type: 'bandpass', freq: 900, q: 1.2, pos: point });
  }

  update(dt, ctx) {
    this.time += dt;
    const p = this.player, e = this.enemy;
    if (!p.alive || e.dead) { this._finish(e.dead ? 'player' : 'enemy'); return; }

    // hold the two blades together at the contact point
    const mid = _v1.lerpVectors(p.chest, e.aimPoint(_v2), 0.5).setY(
      lerp(p.chest.y, e.chestY, 0.5) + 0.25);
    this.point.lerp(mid, clamp(dt * 6, 0, 1));

    // the player's push is how hard they are actually driving the blade
    const drive = p.control.angVel.length() * 0.055 + p.control.handVel.length() * 0.22;
    const stam = clamp(p.stamina / p.maxStamina, 0, 1);
    const push = drive * lerp(0.45, 1.25, stam) * (p.boonMods.cutPower ?? 1);

    // the duellist leans in on a curve, so a lock has a rhythm to fight
    const lean = (0.55 + Math.sin(this.time * 3.1 + this.strength) * 0.4) * this.strength;

    this.pressure = clamp(this.pressure + (push - lean) * dt * 0.85, -1.2, 1.2);
    p.stamina = Math.max(0, p.stamina - 13 * dt);

    if (ctx.particles && Math.random() < 0.6) {
      ctx.particles.sparkBurst(this.point, null, 3, { speed: 5, embers: false });
    }
    p.saber.strain(0.55);
    e.saber?.strain(0.55);
    p.camera.addShake(0.02);

    if (this.pressure >= 1) this._finish('player');
    else if (this.pressure <= -1 || this.time > 4.5) this._finish('enemy');
  }

  _finish(winner) {
    if (this.done) return;
    this.done = true;
    this.result = winner;
    const p = this.player, e = this.enemy;
    if (winner === 'player') {
      e.stun(1.15);
      e.duel?.interrupt(1.0);
      _v1.subVectors(e.position, p.position).setY(0.35).normalize().multiplyScalar(13);
      e.applyKnockback(_v1, 6, p);
      p.riposteTimer = Math.max(p.riposteTimer, 0.75);
      p.addFlow(0.26);
      p.score += 180;
      audio.ui('good');
    } else {
      p.staggerTimer = 0.75;
      p.stamina = Math.max(0, p.stamina - 26);
      _v1.subVectors(p.position, e.position).setY(0.25).normalize().multiplyScalar(9);
      p.velocity.add(_v1);
      p.camera.addShake(0.5);
      p.damage(6, this.point, e, 'lock');
      audio.ui('bad');
    }
  }
}
