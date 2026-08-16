/**
 * BATTLEFRONT BORZ — duelling.
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

/* ══════════════════════════════════════════════════════════════════════ */
/*  FOOTWORK — the ground a declared attack has to cover                  */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE ANSWER THAT COST NOTHING, AND BEAT EVERYTHING.
 *
 * This whole file is built on one promise, written at the top of it: every
 * attack is DECLARED, with a wind-up you can read and an answer the colour
 * names — parry it, chamber it, or get out of the way. That is the contract,
 * and the player is meant to pay something for each of those three answers: a
 * parry needs the blade on the line, a chamber needs a swing into the travel
 * inside a window, and evading needs ground and the stamina to cover it.
 *
 * Evading was free, and it was total. Measured, driving a real Player against
 * a real acolyte through all five forms at two difficulties, 30 s each:
 *
 *                            hp/s taken   strikes thrown   stamina spent
 *     standing still            2.3–16.6      9–38             0
 *     holding S (walk back)     0.00          0–7              0
 *
 * Not reduced. ZERO, in nine of the ten form×difficulty cells, and in the
 * tenth every strike thrown whiffed. And it cost nothing whatever: `sprint`
 * is gated on `axis.y > 0.2` in Player._move so it cannot even be spent going
 * backwards, and walking has no drain at all. The single most valuable thing
 * a player could do in a duel was hold one key, forever, for free.
 *
 * WHY, precisely — and it is not the movement speed. A player walks at 4.6 m/s
 * and an acolyte runs at 5.0, so a duellist that simply chased would catch one.
 * It does not chase while it is attacking: `Enemy._move` gives a non-mobile
 * melee body a forward bias of 0.35 against a lateral term of 1.0, so a
 * committed duellist circles at about 1.6 m/s of closing and the player opens
 * the gap at 3 m/s while the arc it declared is still being drawn. Eight of the
 * ten attacks in ATTACKS carry no gap-closing at all; only `thrust` and `lunge`
 * had a `lunge` value, which is why those two are the only attacks that ever
 * landed on a retreating player.
 *
 * So the fix is not "make the attacks faster" or "make the tracking tighter" —
 * both of those take the answer away instead of pricing it. It is FOOTWORK: a
 * fighter who has committed to a cut steps into it. While an attack is declared
 * the duellist closes toward its own form's near spacing, and stops dead the
 * moment it is there.
 *
 *   IT IS A CLOSED LOOP, not a per-attack constant. `_closing` is proportional
 *   to the ground still to cover, so it does not need to know Enemy.js's
 *   `velocity += toTarget * lungeSpeed * dt * 9` or the rate the locomotion
 *   damps that back out — it keeps asking until the gap is shut. A copied
 *   constant on this side of that seam is the defect this codebase keeps
 *   having; a controller cannot drift out of agreement with the thing it
 *   watches.
 *
 *   THE TARGET COMES FROM `form.spacing[0]`, which is already the authored
 *   answer to "how close does this form fight" — Enemy._move reads the same
 *   number as the inner edge of the band it holds. The attack's own `reach`
 *   extends it, because a thrust really does land from further out. One table,
 *   read twice, rather than a second number meaning the same thing.
 *
 *   AND IT IS CAPPED, which is the half that keeps the attack answerable.
 *   CLOSE_CAP is a little over what a walk can outrun and far under what a dash
 *   can: a player who spends the 18 stamina on a dash still leaves the arc
 *   entirely, a player who sidesteps still makes it miss, and a parry and a
 *   chamber are untouched. What no longer works is standing off at walking pace
 *   and letting the wind-up expire — which is exactly the answer that was never
 *   supposed to be one.
 *
 * Measured after, same fixtures: see tools/checks/footwork.mjs, which drives
 * all four answers — still, walk back, dash back, sidestep — through every form
 * and holds the ORDER between them rather than any one number.
 */

/**
 * How hard the duellist presses per metre of ground still to cover, in the
 * same units as an attack's authored `lunge`. Chosen so that the loop shuts a
 * one-metre gap over a wind-up rather than teleporting through it.
 */
const CLOSE_GAIN = 3.4;

/**
 * The ceiling on that press, and the reason a dash is still an answer.
 *
 * Enemy.js turns `lungeSpeed` into about 1.1× its value in extra closing speed
 * once its own locomotion damping has had its say, so this is roughly 5 m/s on
 * top of the ~1.6 m/s a circling duellist already makes — comfortably past a
 * 4.6 m/s walk and nowhere near a 15.5 m/s dash. It is deliberately BELOW the
 * 7.5 authored on `lunge`, so the one attack in the game that is supposed to
 * cover a room still out-runs ordinary footwork.
 */
const CLOSE_CAP = 4.4;

/**
 * How far past the hilt's wind-up radius the ghost is drawn, in body scales.
 *
 * The hands do not sit still through a strike — `Enemy._poseSaber` hangs them
 * 0.08·S below the guard line and then sweeps the guard from the attack's
 * `from` to its `to`, so the hilt's distance from the chest moves by up to that
 * offset AFTER the arc has been drawn. The ghost is a promise about where the
 * blade will be, so it has to be a BOUND on that sweep rather than a snapshot
 * of one frame of it. See the measurements in `_drawTelegraph`.
 */
const TELE_PAD = 0.07;

/* ── the forms ───────────────────────────────────────────────────────── */

/**
 * How much of a form's move order survives when nothing is breaking it — see
 * `_pick`. Not 1: a duellist you can recite is a duellist you never have to
 * look at. Not 0: that is where this started, and it is why the five forms
 * were statistically the same fighter wearing different wind-up times.
 */
const RHYTHM = 0.72;

export const FORMS = {
  makashi: {
    name: 'Makashi', numeral: 'II',
    tell: 'economical, blade-tip precise — it will thrust the moment you overcommit',
    windup: 0.34, strike: 0.13, recover: 0.24, chamberWindow: 0.42,
    aggression: 0.9, spacing: [1.7, 2.9], chain: [1, 2],
    moves: ['thrust', 'riposteCut', 'slashR', 'slashL', 'thrust'],
    feint: 0.30, punishRecovery: 0.85,
  },
  djemSo: {
    name: 'Djem So', numeral: 'V',
    tell: 'heavy and committed — long wind-ups, longer recoveries',
    windup: 0.68, strike: 0.19, recover: 0.58, chamberWindow: 0.34,
    aggression: 0.7, spacing: [1.5, 3.2], chain: [1, 1],
    moves: ['overhead', 'cleave', 'smash', 'overhead'],
    feint: 0.10, punishRecovery: 0.3, strength: 1.8,
  },
  ataru: {
    name: 'Ataru', numeral: 'IV',
    tell: 'acrobatic flurries — it will not stop at one',
    windup: 0.24, strike: 0.11, recover: 0.17, chamberWindow: 0.5,
    aggression: 1.3, spacing: [1.4, 3.6], chain: [2, 4],
    moves: ['slashR', 'slashL', 'rising', 'spin', 'riposteCut'],
    feint: 0.22, punishRecovery: 0.6, mobile: true,
  },
  soresu: {
    name: 'Soresu', numeral: 'III',
    tell: 'gives you nothing — it is waiting for you to swing first',
    windup: 0.40, strike: 0.14, recover: 0.26, chamberWindow: 0.45,
    aggression: 0.42, spacing: [1.8, 3.0], chain: [1, 2],
    moves: ['slashR', 'riposteCut', 'thrust'],
    feint: 0.14, punishRecovery: 1.0, defensive: 1.7,
  },
  juyo: {
    name: 'Juyo', numeral: 'VII',
    tell: 'erratic — the rhythm is the trap',
    windup: 0.30, strike: 0.13, recover: 0.22, chamberWindow: 0.36,
    aggression: 1.15, spacing: [1.4, 3.2], chain: [1, 3],
    moves: ['cleave', 'slashL', 'lunge', 'rising', 'overhead', 'spin'],
    feint: 0.42, punishRecovery: 0.75, erratic: 0.55,
  },
};

export const FORM_KEYS = Object.keys(FORMS);

/**
 * THE PHASES, in a stable order, so one can be named by index on the wire.
 *
 * One table, in the module that owns the phases. It was briefly two — one in
 * src/net/Net.js and one in src/game/Enemy.js — which is the copied-table
 * defect this codebase has now been bitten by five times: a HUD price list, a
 * form's spacing, a wave-boundary rule, a check's regex, and this. Two copies
 * of an ORDERING are worse than two copies of a number, because they disagree
 * silently and the symptom is a client drawing the wrong swing.
 */
export const DUEL_PHASES = ['guard', 'windup', 'strike', 'recover', 'feint', 'stagger'];

/**
 * The attacks in a stable order, so one can be named by index on the wire.
 * `Object.keys` of a literal is insertion order in every engine this ships to,
 * and a client that resolves the wrong index draws the wrong arc — so if a new
 * attack is ever added it goes at the END of ATTACKS, not in the middle.
 */
export const ATTACK_KEYS = Object.keys(ATTACKS);

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

  /**
   * Force back to a neutral guard — used by parries, staggers and hitstop.
   *
   * AND IT WILL NOT SHORTEN A STAGGER. `_finish('player')` — winning a blade
   * lock, the single largest opening the game offers — ran
   *
   *     e.stun(1.15);          // → duel.stagger(1.15): phase = 'stagger'
   *     e.duel?.interrupt(1.0) // → phase = 'recover'
   *
   * two lines apart, so the guard it had just thrown wide was put straight
   * back on line and the reward for overpowering a lock was a duellist
   * standing at rest. World's chamber and parry paths happen to interrupt
   * BEFORE they stun and so were unaffected, which is why this never showed
   * up anywhere but the lock. A stagger is strictly stronger than a recover —
   * it has already cleared the attack, the chain and the chamber and hidden
   * the telegraph — so there is never a reason to trade one for the other.
   */
  interrupt(recoverTime = 0.4) {
    if (this.staggered) return;
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

  /**
   * THE BAND THE BODY HOLDS, AND THE BAND THE BRAIN SWINGS IN, IN ONE UNIT.
   *
   * `FORMS[*].spacing` is read in two places. `Enemy._move` holds the body
   * inside `[spacing[0] * scale, spacing[1] * scale]` — scaled, because a big
   * duellist keeps its reach, and there is a whole note there saying so. The
   * duel brain then decided whether to attack at all with a bare
   *
   *     const inRange = dist < F.spacing[1];
   *
   * UNSCALED. So for every melee body in the game whose scale is not exactly 1
   * — which is every one of them; an acolyte is 1.04 and the elite variants go
   * higher — the distance the body chooses to stand at is OUTSIDE the distance
   * its own brain will swing from. Makashi parks at 3.02 m and refuses to
   * attack past 2.90.
   *
   * Standing still it barely shows, because the yield band pulls the duellist
   * well inside `far` and it attacks from in there. It shows completely against
   * a retreating player, which is the case this whole footwork note is about:
   * the duellist chases at 5.0 m/s against a 4.6 m/s walk, gains 0.4 m/s until
   * it reaches the outer edge of its band, and then stops — parked 4% outside
   * its own trigger, forever. Measured, 30 s per form: 0 attacks declared, 0
   * strikes, 0.00 hp/s, in four of the five forms.
   *
   * One number, two readers, two different scalings — the sixth instance of
   * this codebase's oldest defect. It is derived once here now and both call
   * sites in this file read it.
   */
  get reachOut() { return this.form.spacing[1] * (this.e.A?.scale ?? 1); }

  /**
   * How hard this duellist should be pressing forward right now, in the units
   * an attack's `lunge` is authored in. See the FOOTWORK note above.
   *
   * Zero unless an attack has actually been DECLARED — a duellist at guard
   * keeps its form's spacing through `Enemy._move`'s band and must not be
   * shoved into the player's face by this, and a feint that closed ground
   * would be a free approach rather than a bait.
   */
  _closing(dist) {
    const a = this.attack;
    if (!a || !(dist > 0)) return 0;
    if (this.phase !== 'windup' && this.phase !== 'strike') return 0;
    // The form's own near spacing, scaled by the body exactly as Enemy._move
    // scales it, plus whatever this particular attack's reach buys.
    const sc = this.e.A?.scale ?? 1;
    const gap = dist - (this.form.spacing[0] * sc + (a.reach ?? 0));
    if (!(gap > 0)) return 0;
    return clamp(gap * CLOSE_GAIN, 0, CLOSE_CAP);
  }

  update(dt, ctx, dist) {
    const F = this.form;
    const sp = this._speed();
    this.timer -= dt;
    /* The authored lunge still decays exactly as it did — `thrust` and `lunge`
     * are single explosive steps and must stay that shape — but it can never
     * fall below what the footwork loop is asking for while there is still
     * ground between this blade and the body it was declared against. When the
     * gap is shut the floor is 0 and this line is what it always was. */
    this.lungeSpeed = Math.max(this._closing(dist), damp(this.lungeSpeed, 0, 8, dt));
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

        const inRange = dist < this.reachOut;
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
          if (this.chainLeft > 0 && dist < this.reachOut + 0.5) {
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

  /**
   * WHICH ATTACK COMES NEXT — AND WHETHER YOU CAN LEARN IT.
   *
   * What was here:
   *
   *     let key = F.moves[Math.floor(rng() * F.moves.length)];
   *     // Juyo deliberately breaks its own rhythm
   *     if (F.erratic && rng() < F.erratic * 0.4) key = F.moves[Math.floor(rng() * F.moves.length)];
   *
   * — a uniform draw, and then sometimes ANOTHER uniform draw from the same
   * list. The second line is the identity function: re-rolling a uniform
   * variable gives back the same distribution, exactly. `erratic` is authored
   * on one form, Juyo, whose tell reads "erratic — the rhythm is the trap",
   * and it changed nothing whatsoever: Juyo and Soresu chose their attacks in
   * statistically indistinguishable ways, and neither had a rhythm to break
   * because every form drew uniformly and independently every single time.
   *
   * A rhythm is a CONDITIONAL distribution — what comes next given what just
   * came — so it cannot exist in a table of independent draws. A disciplined
   * form now WALKS its own move list, which is what makes Makashi's
   * thrust → riposte → slash → slash → thrust something a player can read
   * three exchanges in, and it is why the lists have repeats in them.
   * `erratic` is the chance of leaving that walk; and when it leaves it goes
   * anywhere EXCEPT the move the rhythm just promised, because a break that
   * might play the expected move is not a break.
   *
   * Measured over 20 000 attacks per form — P(next attack is the one this
   * form's order implies), where the old uniform draw scores exactly 1/len:
   *
   *     makashi  73.9%   (was 20.0%)      soresu  72.4%   (was 33.3%)
   *     djemSo   75.2%   (was 25.0%)      juyo    32.7%   (was 16.7%)
   *     ataru    72.4%   (was 20.0%)
   *
   * Juyo is the only form that will not hold a line, and — this is the part
   * the tell promises — it is still twice as likely as chance to play the
   * move you are braced for. It offers a rhythm; it is not made of one.
   */
  _pick() {
    const F = this.form;
    const moves = F.moves;
    if (moves.length < 2) return (this._lastKey = moves[0]);
    // Where the walk stands. `indexOf` rather than a stored index because the
    // lists repeat deliberately and the first match is as good as any: the
    // point is that the SEQUENCE is stable, not which copy of `thrust` it is.
    const i = this._lastKey != null ? moves.indexOf(this._lastKey) : -1;
    const expected = i >= 0 ? (i + 1) % moves.length : -1;
    // RHYTHM is what is left of a form's discipline once `erratic` is spent.
    if (expected >= 0 && rng() < RHYTHM * (1 - clamp(F.erratic ?? 0, 0, 1))) {
      return (this._lastKey = moves[expected]);
    }
    let j = Math.floor(rng() * (moves.length - (expected >= 0 ? 1 : 0)));
    if (expected >= 0 && j >= expected) j++;
    return (this._lastKey = moves[j]);
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

  /**
   * THE GHOST WAS DRAWN SHORT OF THE BLADE. EVERY ATTACK. ALWAYS.
   *
   * This file's first paragraph is the promise the whole duel rests on: "the
   * blade traces a ghost of where it is about to go". The radii it traced it at
   * were `0.34 * S` and `(0.34 + 1.12) * S` — two constants, the same for every
   * attack in the table, and both of them wrong:
   *
   *   THE ATTACK'S OWN `reach` WAS IGNORED. `Enemy._poseSaber` puts the hands
   *   at `(0.34 + attack.reach) * S`, so a thrust holds its hilt 0.42 further
   *   out than a slash and a lunge 0.5. The ghost drew both at the slash's
   *   radius. Those are precisely the two attacks a player answers by BACKING
   *   OUT OF THE ARC, and the arc they were shown was a half-metre short of the
   *   blade that was coming.
   *
   *   AND THE BLADE'S LENGTH WAS SCALED BY THE BODY, which it is not: an
   *   enemy's saber is a flat 1.12 m whatever size the wielder is. On a big
   *   duellist that drew a longer ghost than the blade; on a small one, shorter.
   *
   * Measured on a real acolyte, an invulnerable target, and the shipped
   * Telegraph — outer radius drawn against the furthest the tip actually
   * reached from the chest during the strike:
   *
   *     attack       ghost    blade    ghost was
   *     slashL       1.518    1.573    0.054 m short
   *     overhead     1.518    1.627    0.108 m short
   *     rising       1.518    1.866    0.347 m short
   *     thrust       1.518    2.058    0.539 m short
   *     lunge        1.518    2.142    0.624 m short
   *
   * Ten attacks out of ten, none of them contained by the shape that claims to
   * contain them. A telegraph you can stand just outside of and still be cut is
   * worse than no telegraph, because it teaches the wrong distance — and it is
   * the distance answer the whole footwork note above is about.
   *
   * IT IS READ OFF THE BLADE NOW, not recomputed beside it. `saber.base` is
   * where the light actually starts this frame and `saber.bladeLength` is how
   * far it goes, both taken about the SAME chest bone `Enemy._poseSaber` poses
   * the weapon about — so the ghost cannot drift from the weapon the way a
   * second copy of `0.34 + 1.12` did, and it picks up `reach` for free because
   * the pose has already spent it. TELE_PAD is the only term that cannot be
   * read off anything, and it is there to keep the shape a BOUND rather than an
   * estimate: the guard sweeps on after the arc is drawn.
   *
   * After, same fixture, at all four difficulties — every attack, every tier,
   * the ghost now CONTAINS the sweep by 0.056 to 0.164 m:
   *
   *     attack       ghost    blade    margin
   *     rising       1.789    1.702    +0.087   (worst case, +0.056 at Knight)
   *     slashL       1.735    1.606    +0.129
   *     thrust       2.170    2.054    +0.116
   *     lunge        2.257    2.141    +0.116
   *     smash        1.850    1.654    +0.195   (widest, on the guard break)
   */
  _drawTelegraph(fill, alpha, pulse) {
    const t = this.telegraph;
    if (!t || !this.attack) return;
    const e = this.e;
    const S = e.A.scale;
    /* THE SAME CHEST THE BLADE IS POSED ABOUT. `Enemy._pose` hands
     * `_poseSaber` the rig's animated chest bone; this drew its arc about
     * `position + 1.34 * S` instead, which is a fixed point on a body that
     * leans, breathes and steps. Two origins for one arc is the same defect as
     * two copies of a table: they agree when the body is standing still and
     * nowhere else. Measured on a mid-strike acolyte the two are up to 0.19 m
     * apart, which is most of the residual the padding below used to have to
     * cover. */
    if (!(e.rig && e.rig.worldPos && e.rig.worldPos('chest', _v3))) {
      _v3.copy(e.position).setY(e.position.y + 1.34 * S);
    }
    const blade = e.saber?.bladeLength ?? 1.12;
    // The emitter, not the hand: the blade starts 0.15 m past the fist and the
    // ghost's inner edge is supposed to be where the light begins.
    const start = Math.max(e.saber?.base ? e.saber.base.distanceTo(_v3) : 0, 0.34 * S);
    t.shape(_v3, e.facing, this.attack.from, this.attack.to, start, start + blade + TELE_PAD * S);
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

  /**
   * SHOVED APART — a Force power big enough to move a body ends the bind.
   *
   * `Enemy._meleeBrain` runs a duellist's kit through a lock now (it used to
   * return before `_forceBrain` and switch the Force off for the 29–41% of a
   * long duel that is spent locked), and the one verb that means anything with
   * two blades crossed is "get off me". This exists so `_castPower` does not
   * have to reach into a private method to say so — and so that a shove ends
   * the bind rather than trying to knock back a body the lock is pinning.
   */
  forceBreak(winner = 'enemy') { this._finish(winner); }

  _finish(winner) {
    if (this.done) return;
    this.done = true;
    this.result = winner;
    const p = this.player, e = this.enemy;
    if (winner === 'player') {
      /* The direction the losing blade was driven, so the guard opens on the
       * side it actually lost. The tip's own travel, not the line between the
       * two bodies: a lock is won by driving ACROSS, and two fighters standing
       * nose to nose have no side between them at all. */
      if (p.saber?.tipVelocity) _v3.copy(p.saber.tipVelocity); else _v3.set(0, 0, 0);
      if (_v3.lengthSq() < 1) _v3.subVectors(e.position, p.position);
      e.stun(1.15, _v3, 1.4);
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
