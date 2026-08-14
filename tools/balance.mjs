/**
 * SABER — the balance instrument.
 *
 *   node tools/balance.mjs                    everything, default settings
 *   node tools/balance.mjs --runs=60          more seeds per difficulty
 *   node tools/balance.mjs --only=boons       one section
 *   node tools/balance.mjs --skill=75         one skill setting instead of three
 *   node tools/balance.mjs --level=arena      a different enemy pool
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHAT THIS IS, AND WHAT IT IS NOT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 596 checks measure whether the game is CORRECT. None of them measures
 * whether it is TUNED. Nobody could answer "is wave 7 a wall", "are the four
 * difficulties actually ordered", "is Shatterpoint strictly better than the
 * other fifteen boons" — not because the answers are hard, but because there
 * was no instrument pointed at the question.
 *
 * This is that instrument. It plays runs headlessly and reports where they die
 * and what wins.
 *
 * READ THIS BEFORE QUOTING A NUMBER OUT OF IT:
 *
 *   Every number printed here is a COMPARISON BETWEEN BUILDS UNDER ONE FIXED
 *   MODEL OF A PLAYER. It is not a prediction of a human. "Median depth 9.4"
 *   means "this model of a player, at this skill setting, gets to wave 9.4" —
 *   it does NOT mean you will. The absolute depth is a function of the skill
 *   dial (--skill) and moves by a factor of three across the three settings
 *   printed. The ORDERINGS — Padawan easier than Grandmaster, boon X worth
 *   more than boon Y — are what this tool is for, and they are checked at all
 *   three skill settings so that a conclusion which only holds at one of them
 *   is visibly not a conclusion.
 *
 * ── WHAT IS REAL (read out of the game, moves when the game moves) ─────────
 *
 *   Wave composition   WaveDirector._compose() itself — the real budgetFor
 *                      curve, the real unlockedAt ladder, the real boss-wave
 *                      set-pieces, the real shuffle, the real spawn cadence
 *                      and the real maxAlive cap.
 *   Archetypes         ARCHETYPES: hp, damage, threat, speed, fireRate, burst,
 *                      burstGap, spread, preferred range, toughness, shield.
 *   Difficulty         DIFFICULTY: damageTaken, fireRate, enemyAggression,
 *                      enemyAccuracy, boltSpeed, staminaDrain, and `assist`
 *                      through Combat's own zoneTolerance().
 *   Boons              BOONS[].apply() is CALLED, on a stub carrying Player's
 *                      real boonMods defaults. No boon's effect is retyped
 *                      here; a boon this harness cannot see the effect of is
 *                      reported as inert, which is itself a finding.
 *   Player offence     The real BladeContactSolver driving a real Saber
 *                      through the real capsule geometry of the real bodies
 *                      (buildB1/buildB2/…), with the real _boneToughness and
 *                      VITAL tables, the real takeCut arithmetic, the real
 *                      GRIND_LETHALITY share, and the real consequences of
 *                      losing a limb (topple, disarm, decapitation).
 *   Blade speed        MEASURED, by driving the real SaberController through a
 *                      real authored attack and reading the real Saber's tip
 *                      velocity. Not typed in.
 *   Melee cadence      MEASURED, by running the real DuelBrain for 400 s per
 *                      form per difficulty and counting strike phases.
 *   Deflection         The real damageMul ladder (1 / 1 / 1.5 / 2.5), the real
 *                      grade gates (driven > 3.2 m/s, RETURN > 7.5 m/s and
 *                      bladeT > 0.42, PERFECT > 15 m/s), the real returned-
 *                      bolt damage formula, the real player hit capsule.
 *
 * ── WHAT IS MODELLED (one fixed player; every constant is named in MODEL) ──
 *
 *   The player attacks at the authored cadence (OVERHEAD.cooldown), lands
 *   MODEL.swingHit of those attacks, fights one target at a time to death,
 *   walks to ranged enemies at Player's own 4.6 m/s against the real
 *   BACKPEDAL, and answers a bolt when their guard-zone error falls inside
 *   Combat's own zoneTolerance() for the tier. That error is one Gaussian with
 *   one standard deviation, MODEL.guardSigma, widened in proportion to the
 *   tier's boltSpeed because a faster bolt is less time to choose. That single
 *   number is the whole of "player skill" in this model.
 *
 * ── WHAT IT CANNOT CAPTURE, AT ALL ────────────────────────────────────────
 *
 *   Skill in any sense richer than one Gaussian. Positioning, cover, kiting,
 *   funnelling a horde through a doorway. Target priority beyond "nearest".
 *   Whether deflecting FEELS good. Line of sight, terrain, elevation. Force
 *   powers (push, pull, grip, stasis, lightning) — so every boon that only
 *   touches them reads as inert here and is reported as UNMODELLED rather
 *   than as WORTHLESS. Grenades. Blade locks. Chambering and ripostes. The
 *   acklay's phase mechanics. Ragdolls falling on people. Sprinting. Dashing.
 *
 * A model that says "wave 12" where a human dies on wave 5 is worse than
 * nothing, because it launders a complaint into a number. So: the depth axis
 * is labelled MODEL-DEPTH everywhere it appears, three skill settings are
 * always printed, and the checks in tools/checks/balance.mjs pin ORDERINGS and
 * SHAPES, never absolute depths.
 */

/* ── boot ──────────────────────────────────────────────────────────────────
 * dom-shim registers the vendored-three resolver behind its own global guard,
 * so importing it first makes `node tools/balance.mjs` work with no flags and
 * does not register a second resolver when verify.mjs has already done it.
 * Everything below is a dynamic import for that reason: static imports are
 * hoisted above the shim and would resolve first.
 */
await import('./dom-shim.mjs');
const THREE = await import('three');

/* Waves.js seeds its module rng from Math.random at import. Pin it, so a
 * standalone run of this file is reproducible end to end. Under verify.mjs the
 * module is already loaded and this does nothing — which is why nothing in
 * tools/checks/balance.mjs may depend on a specific composition. */
const _realRandom = Math.random;
Math.random = () => 0.31830988618;
const Waves = await import('../src/game/Waves.js');
Math.random = _realRandom;

const { WaveDirector, BOONS, ATTUNEMENTS, RankSet, rankScale, maxRank, rankOf, BOSS_EVERY,
  RANK_DIMINISH, refreshWaveBoons } = Waves;
const { defaultBoonMods } = await import('../src/game/Player.js');
const Combat = await import('../src/game/Combat.js');
const { DIFFICULTY, TOUGHNESS, BladeContactSolver, zoneTolerance, SPEED_GRADE } = Combat;
const EnemyMod = await import('../src/game/Enemy.js');
const { ARCHETYPES, Enemy, limitBackpedal } = EnemyMod;

/**
 * The elite-modifier layer, read through the game's own exports and tolerated
 * if it is not there. A live lane added `"trooper|marksman"` spawn entries while
 * this file was being written; a harness that assumed a queue entry was an
 * archetype key crashed on the first composed wave. So every accessor below is
 * asked for, never assumed, and the whole system degrading to "no modifiers"
 * leaves the rest of this file working.
 */
const MODIFIERS = EnemyMod.MODIFIERS ?? {};
const modifierThreat = EnemyMod.modifierThreat ?? ((t) => ARCHETYPES[t]?.threat ?? 0);
const spawnType = Waves.spawnType ?? ((e) => (e.indexOf('|') < 0 ? e : e.slice(0, e.indexOf('|'))));
const spawnMod = Waves.spawnMod ?? ((e) => (e.indexOf('|') < 0 ? null : e.slice(e.indexOf('|') + 1)));
const spawnCost = Waves.spawnCost ?? ((e) => ARCHETYPES[spawnType(e)]?.threat ?? 0);
const { Saber } = await import('../src/game/Saber.js');
const { SaberController, OVERHEAD } = await import('../src/game/SaberController.js');
const { DuelBrain, FORMS, FORM_KEYS } = await import('../src/game/Duel.js');
const { LEVELS, LEVEL_ORDER } = await import('../src/game/Levels.js');
const Bodies = await import('../src/game/Bodies.js');
const { makeRng, clamp, lerp } = await import('../src/engine/MathUtil.js');

const scene = new THREE.Scene();
/**
 * The scene, for the one check that needs it.
 *
 * Exposed rather than exported directly so it reads as an instrument port
 * rather than as something to build in. A Saber ADDS ITSELF here, so the child
 * count is the exact measure of whether anything is being retained — see the
 * note on `workCapsule`, and tools/checks/balance.mjs.
 */
export function reportScene() { return scene; }
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Enemy's BACKPEDAL, measured rather than retyped. The constant itself is
 * module-private; limitBackpedal is exported precisely because it is a numeric
 * law, and a pure retreat of unit speed comes out of it at exactly the share it
 * allows. So this reads 0.5 today and reads whatever Enemy.js says tomorrow.
 */
const BACKPEDAL = limitBackpedal(V(0, 0, -1), V(0, 0, 1)).length();

/* ══════════════════════════════════════════════════════════════════════════
 *  The model's own constants. Everything not read out of the game is here.
 * ══════════════════════════════════════════════════════════════════════════ */

export const MODEL = {
  /**
   * The player's guard-zone error, one standard deviation, in degrees. THE
   * skill dial. A bolt is answered when |error| < zoneTolerance(tier.assist),
   * which is Combat's own function, so retuning GUARD.sector or the assist
   * ladder moves this instrument without anyone editing it.
   *
   * Three settings are printed because the absolute depth is entirely a
   * function of this and it would be dishonest to print one number as if it
   * were the game's.
   */
  guardSigma: 75,
  skillLadder: [{ name: 'careless', sigma: 110 }, { name: 'competent', sigma: 75 }, { name: 'sharp', sigma: 45 }],

  /**
   * A faster bolt is less time to choose a zone, so the same hand is worse
   * against it. The error is scaled by the tier's own boltSpeed against
   * Knight's — the only place in this file a difficulty column is turned into a
   * player property rather than an enemy one.
   *
   * The exponent is 0.5 rather than 1 because the error being modelled is a
   * CHOICE BETWEEN FOUR ZONES, not a continuous aim: halving the time available
   * does not double the chance of picking the wrong quadrant, part of that error
   * is systematic and does not shrink with time at all. 1.0 is the pessimistic
   * reading and 0 is "reaction time is not a factor"; the tier ORDERING holds at
   * every value in that range, which is checked, and only the spacing moves.
   */
  boltSpeedRef: DIFFICULTY.knight.boltSpeed,
  reactionExponent: 0.5,

  /**
   * Share of authored attacks that actually land on the bone the player wanted.
   * A GUESS — the biggest single one in this file, and the reason `--hit=` is a
   * flag. It scales every kill time by 1/swingHit, so it shifts absolute depth
   * a lot and boon ORDER almost not at all (it is a common factor).
   */
  swingHit: 0.72,

  /**
   * Reach is a real geometric test, not a list of bone names: a capsule whose
   * bottom is above the measured top of the blade is not a target. That is what
   * keeps a 2.4-scale walker's hull and a 2.9-scale acklay's head out of a
   * standing player's reach and its legs in — which is also what the acklay's
   * own design note says it is for ("three legs and it goes down, physically,
   * because it has three legs left"). Without it the model decapitates a 900 hp
   * boss in one pass, because VITAL.head is 0.95 and takeCut's lethality gate
   * is >= 0.9.
   *
   * The ceiling itself is measureSwing().reachHeight, and it is measured.
   */

  /**
   * Bolts the player never even contests, because they were never going to
   * hit: only bolts inside the player's own capsule are put to the guard. The
   * rest miss and cost nothing — no damage, no stamina, and no return either,
   * which slightly UNDER-counts returned damage. Stated, not hidden.
   */

  /** Where a returned bolt lands, as a `vital` for _boltHitTest's lerp(0.6,1.9,v). */
  returnVital: 1.0,      // RETURN/PERFECT are aimed at aimPoint(), i.e. the chest
  deflectVital: 0.4,     // an unaimed DEFLECT lands wherever

  /** Ceiling on how deep one pass can cut: you cannot cut deeper than the blade. */
  reachCapsBody: true,

  /** How far past the last wave a run is allowed to go before it is called a survival. */
  maxWave: 25,

  /** Compositions drawn per (level, wave) up front; a run picks one by seed. */
  poolPerWave: 24,

  /**
   * Share of live enemies with a clear shot at any instant.
   *
   * A GUESS, and a large one. Enemy._rangedBrain will not fire without
   * _hasLineOfSight, which raycasts against terrain, props and doors — none of
   * which this harness has. With this at 1 the model puts every body in a wave
   * on overwatch from the moment it spawns, which is a horde no level actually
   * presents. Named here rather than left at an implicit 1, because an implicit
   * 1 is a claim about level design that nobody made.
   */
  lineOfSight: 0.6,

  /**
   * Simulation timestep for the fight. 0.1 s: shorter than Player.damage's own
   * 0.18 s of invulnerability, which is the shortest thing in the loop that
   * matters, and long enough that a thirty-wave run is seconds rather than
   * minutes.
   */
  dt: 0.1,

  /** A wave that will not end is a modelling failure, not a balance result. */
  waveTimeout: 400,
};

/* ══════════════════════════════════════════════════════════════════════════
 *  Small maths
 * ══════════════════════════════════════════════════════════════════════════ */

/** Abramowitz & Stegun 7.1.26 — good to 1.5e-7, which is far past what matters. */
export function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return s * (1 - p * Math.exp(-x * x));
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const quantile = (a, q) => { const s = a.slice().sort((x, y) => x - y); if (!s.length) return NaN; const i = clamp(Math.round(q * (s.length - 1)), 0, s.length - 1); return s[i]; };

/* ══════════════════════════════════════════════════════════════════════════
 *  MEASURED ANCHOR 1 — how fast does the blade actually move?
 *
 *  The single most load-bearing number in the offence model, so it is measured
 *  off the real controller rather than typed in. One authored overhead attack,
 *  driven through the real SaberController into a real Saber, sampled at
 *  240 Hz. The grade mix falls out of the same trace against the real gates in
 *  Combat.gradeCaught, so a change to OVERHEAD or to the grip springs moves
 *  both the damage and the deflection halves of this file at once.
 * ══════════════════════════════════════════════════════════════════════════ */

let _swing = null;
export function measureSwing() {
  if (_swing) return _swing;
  const CHEST = V(0, 1.35, 0);
  const input = {
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: {},
    _held: new Set(), _hit: new Set(),
    act(id) { return this._held.has(id); },
    actHit(id) { return this._hit.has(id); },
  };
  const c = new SaberController();
  c.reset(CHEST, new THREE.Quaternion());
  const saber = new Saber(scene, { colorIndex: 0, bladeLength: 1.15 });
  saber.ignite(); saber.ignition = 1;
  const dt = 1 / 240, q = new THREE.Quaternion();
  const samples = [];
  let peak = 0, topOfBlade = 0;
  for (let i = 0; i < 240; i++) {
    input._hit.clear();
    if (i === 20) input._hit.add('attackOver');
    c.applyInput(input, dt, { stamina: 1, flow: 0 });
    c.update(dt, CHEST, q, { stamina: 1, flow: 0 });
    saber.setHiltPose(c.handPos, c.quat);
    saber.update(dt, i * dt);
    if (i > 22) {
      const s = saber.tipVelocity.length();
      peak = Math.max(peak, s);
      if (s > 0.2) samples.push(s);
      // The chest anchor sits at 1.35 m, which is where Player carries it, so
      // this is the blade's ceiling above the player's own feet.
      topOfBlade = Math.max(topOfBlade, saber.tip.y, saber.base.y);
    }
  }
  // The grade a contact earns is decided at the blade point that met the bolt;
  // Combat's gates read speedAt(bladeT) with bladeT > 0.42 for a RETURN, so the
  // tip trace is the right trace to grade against.
  //
  // READ FROM THE GAME, NOT RETYPED. These were the literals 3.2 / 7.5 / 15,
  // copied out of Combat.js — which meant this harness could never report that
  // a gate was wrong, because it was grading against the same guess. It is now
  // SPEED_GRADE, and the mix below moves the moment the game's ladder does.
  // That is how the 15 was caught: the gate outran the blade by 37% and the
  // instrument agreed with it.
  const above = (v) => samples.filter(s => s > v).length / Math.max(1, samples.length);
  const driven = above(SPEED_GRADE.driven);
  const canReturn = above(SPEED_GRADE.return);
  const canPerfect = above(SPEED_GRADE.perfect);
  _swing = {
    peak,
    /** What share of a real swing's trace clears an arbitrary speed. Exposed so
     *  a check can ask what a candidate gate would admit without re-driving the
     *  controller, and so the ladder can be calibrated against the blade. */
    shareAbove: above,
    /** What a committed pass is worth, in m/s, for the cut solver. */
    passSpeed: peak,
    /** Shares of ANSWERED bolts by grade, from the same trace, nested and disjoint. */
    grade: {
      block: 1 - driven,
      deflect: Math.max(0, driven - canReturn),
      return: Math.max(0, canReturn - canPerfect),
      perfect: canPerfect,
    },
    attacksPerSec: 1 / OVERHEAD.cooldown,
    /** How high the blade actually gets, above the feet. Measured, not assumed. */
    reachHeight: topOfBlade,
  };
  return _swing;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  MEASURED ANCHOR 2 — how often does a duellist actually strike?
 *
 *  The real DuelBrain, run for 400 s per form per tier against a stub enemy
 *  that gives it nothing but a difficulty and a target in range. The spread
 *  across forms is enormous and it is the game's own, not this file's.
 * ══════════════════════════════════════════════════════════════════════════ */

const ATTACK_DAMAGE_BY_FORM = (() => {
  // The mean `damageScale` a form applies, taken by running its own _pick over
  // its own move list rather than by copying the ATTACKS table into this file.
  const out = {};
  for (const fk of FORM_KEYS) {
    const e = stubDuelEnemy(DIFFICULTY.knight);
    const b = new DuelBrain(e, { form: fk });
    let n = 0, sum = 0;
    for (let i = 0; i < 4000; i++) {
      b.attack = null; b.attackKey = null;
      b._beginAttack(1);
      sum += b.damageScale; n++;
    }
    out[fk] = sum / n;
  }
  return out;
})();

function stubDuelEnemy(diff) {
  const v = new THREE.Vector3();
  return {
    world: { difficulty: diff, notifyFloating: () => {} },
    position: new THREE.Vector3(),
    saber: { base: new THREE.Vector3() },
    aimPoint: (o) => (o || v).set(0, 1, 0),
    target: { control: { angVel: new THREE.Vector3() }, staggerTimer: 0, stamina: 100, maxStamina: 100 },
    saberPhase: 'guard', saberTimer: 0.3,
  };
}

const _duel = new Map();
export function measureDuel(diffKey, formKey) {
  const key = diffKey + ':' + formKey;
  if (_duel.has(key)) return _duel.get(key);
  const e = stubDuelEnemy(DIFFICULTY[diffKey]);
  const b = new DuelBrain(e, { form: formKey });
  const dt = 1 / 120;
  let strikes = 0, wasStrike = false, T = 0;
  for (let i = 0; i < 120 * 240; i++) {
    b.update(dt, {}, (FORMS[formKey].spacing[0] + FORMS[formKey].spacing[1]) / 2);
    T += dt;
    const isStrike = b.phase === 'strike';
    if (isStrike && !wasStrike) strikes++;
    wasStrike = isStrike;
  }
  const r = { strikesPerSec: strikes / T, damageScale: ATTACK_DAMAGE_BY_FORM[formKey] };
  _duel.set(key, r);
  return r;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  The real capsule set of a real body
 * ══════════════════════════════════════════════════════════════════════════ */

const BUILDERS = {
  b1: Bodies.buildB1, b2: Bodies.buildB2, trooper: Bodies.buildTrooper,
  sniper: Bodies.buildTrooper, acolyte: Bodies.buildAcolyte,
  droideka: Bodies.buildDroideka, walker: Bodies.buildWalker, beast: Bodies.buildBeast,
};

/**
 * The archetype a queue entry actually spawns, elite included.
 *
 * Same arithmetic as Enemy.applyModifier — scale the numbers, override the
 * flags, recompute the threat — because that function needs a live Enemy with
 * a scene and a world, and this needs a table. tools/checks/balance.mjs runs
 * both against each other so this cannot drift.
 */
const _arch = new Map();
export function archetypeOf(entry) {
  if (_arch.has(entry)) return _arch.get(entry);
  const type = spawnType(entry), key = spawnMod(entry);
  const base = ARCHETYPES[type];
  if (!base) throw new Error(`balance: no archetype for spawn entry "${entry}"`);
  let A = base;
  if (key && MODIFIERS[key]) {
    const M = MODIFIERS[key];
    A = { ...base };
    for (const [k, v] of Object.entries(M.scale || {})) if (typeof A[k] === 'number') A[k] *= v;
    Object.assign(A, M.set || {});
    A.threat = modifierThreat(type, key);
    A.elite = key;
  }
  const v = { type, mod: key, A };
  _arch.set(entry, v);
  return v;
}

/**
 * The REAL capsules of a REAL body.
 *
 * Enemy.capsules() reads nothing but `this.rig`/`this.group`, `this.A` and a
 * scratch array, so it runs against a stub — which means the vitals, the 1.12
 * radius inflation and _boneToughness (including the Armoured elite's durasteel
 * torso) are the game's own and not a transcription that can rot. `height` is
 * measured off the body's own lowest point, so reach is a real geometric test
 * rather than a list of bone names.
 */
const _caps = new Map();
export function capsulesFor(entry) {
  if (_caps.has(entry)) return _caps.get(entry);
  const { type, A } = archetypeOf(entry);
  const build = BUILDERS[type];
  let out = [];
  if (build) {
    const built = build({ scale: A.scale });
    const rig = built.rig || (built.list ? built : null);
    rig?.root?.updateMatrixWorld?.(true);
    built.group?.updateMatrixWorld?.(true);
    const stub = {
      _caps: [], dead: false, actor: null, shieldUp: false, shieldMesh: null,
      rig, group: built.group || null, built, A,
      position: new THREE.Vector3(),
      _boneToughness: Enemy.prototype._boneToughness,
    };
    const real = Enemy.prototype.capsules.call(stub);
    let floor = Infinity;
    for (const c of real) floor = Math.min(floor, c.p0.y - c.r, c.p1.y - c.r);
    out = real.map(c => ({
      name: c.name, r: c.r, len: c.p0.distanceTo(c.p1),
      toughness: c.toughness, vital: c.vital ?? 0.4, shield: !!c.shield,
      height: (c.p0.y + c.p1.y) / 2 - (isFinite(floor) ? floor : 0),
    }));
  }
  _caps.set(entry, out);
  return out;
}

/** Enemy._loseLimbBehaviour, in the two forms that matter to a fight. */
function limbConsequence(A, bone) {
  if (/thigh|shin|foot|femur|tibia|tarsus/.test(bone)) {
    const need = (A.custom === 'walker' || A.custom === 'beast') ? 3 : 1;
    return { legs: 1, topplesAt: need };
  }
  if (/arm|fore|hand/.test(bone)) return { disarms: !!(A.ranged || A.saber) };
  if (bone === 'head' || bone === 'neck') return { decapitates: true };
  if (/leg\d/.test(bone)) return { legs: 1, topplesAt: 2 };     // droideka
  return {};
}

/* ══════════════════════════════════════════════════════════════════════════
 *  PLAYER OFFENCE — the real solver, the real blade, the real bodies
 *
 *  One "engagement" is simulated frame by frame at 60 Hz: the blade traverses
 *  the capsule at the measured speed, then is parked out of contact for the
 *  rest of the authored cooldown, and the whole thing runs through the real
 *  BladeContactSolver so accumulated work, the coverage term, the softness
 *  term, the grace period and the fade all behave exactly as they do in a
 *  fight. Grind events pay the real GRIND_LETHALITY share; cut events run the
 *  real takeCut arithmetic; a severed limb has its real consequence.
 * ══════════════════════════════════════════════════════════════════════════ */

const GRIND_LETHALITY = 0.55;   // World.js — module-private there
const BLADE_REACH_BASE = 1.15;  // Player's default bladeLength

/**
 * One capsule worked until it parts or the body stops mattering.
 *
 * ── WHY THE `try/finally` ──────────────────────────────────────────────────
 *
 * THIS FUNCTION IS WHY THE HARNESS DIED. `new Saber(scene, …)` ADDS ITSELF TO
 * THE SCENE, and `scene` is a module-level THREE.Scene that nothing ever
 * clears — so every blade this function has ever built stayed reachable, with
 * its blade geometry, its trail buffers and its two lights. One engagement
 * costs one Saber per capsule and a humanoid has about twenty, so the cost is
 * ~20 undisposed blades per cache miss in `engagementFor`.
 *
 * With no boons the memo key is constant and it plateaus, which is why a short
 * run looks fine. The boon section varies `cutPower` per card and per tier, so
 * the key varies, so nearly every call is a miss — tens of thousands of blades,
 * ~460 MB of ArrayBuffers per sixty runs, and `FATAL ERROR: Ineffective
 * mark-compacts near heap limit` at 8 GB. The crash landed after the boon table
 * had printed, which made it look like the survival section's fault; it was
 * neither section's, it was this line's.
 *
 * Found by measuring `process.memoryUsage()` — heap, external and arrayBuffers
 * separately. arrayBuffers tracking the heap one-for-one is what pointed at
 * geometry rather than at bookkeeping, after two wrong guesses at the caches.
 */
function workCapsule(cap, hp, maxHp, speed, power, reach, cadence, budget) {
  const solver = new BladeContactSolver();
  const saber = new Saber(scene, { colorIndex: 0, bladeLength: reach });
  try {
    return _workCapsule(saber, solver, cap, hp, maxHp, speed, power, reach, cadence, budget);
  } finally {
    saber.dispose();
  }
}

function _workCapsule(saber, solver, cap, hp, maxHp, speed, power, reach, cadence, budget) {
  saber.ignite(); saber.ignition = 1;
  const q = new THREE.Quaternion();
  // You cannot cut deeper than the blade is long, so the capsule a pass sees is
  // capped at half the blade. Without this a walker's 1.6 m body radius keeps
  // the blade "in contact" for 3.2 m of travel per pass and a durasteel hull
  // parts in a second.
  const r = MODEL.reachCapsBody ? Math.min(cap.r, reach / 2) : cap.r;
  const half = Math.max(cap.len / 2, 0.02);
  const tgt = { id: 't', dead: false, capsules: [{ ...cap, r, p0: V(0, 1.2, -half), p1: V(0, 1.2, half) }] };
  const dt = 1 / 60, span = Math.max(1.2, 2 * r + 0.6), period = 1 / cadence, travel = span / speed;
  let t = 0, dealt = 0, severed = false;
  for (let f = 0; t < budget; f++, t += dt) {
    const ph = t % period;
    if (ph <= travel) saber.setHiltPose(V(-span / 2 + ph * speed, 0.55, 0), q);
    else { saber.valid = false; saber.setHiltPose(V(-span / 2, 0.55, 0), q); }
    saber.update(dt, t);
    for (const ev of solver.solve(saber, [tgt], dt, { power })) {
      if (ev.type === 'grind' && ev.need > 0) {
        const d = (ev.dWork / ev.need) * maxHp * GRIND_LETHALITY;
        hp -= d; dealt += d;
      } else if (ev.type === 'cut') {
        const vital = ev.cap.vital ?? 0.4;
        const lethal = vital >= 0.9 || (vital >= 0.7 && hp < maxHp * 0.55);
        const d = lethal ? maxHp * 2 : maxHp * vital * 1.15;
        hp -= d; dealt += d; severed = true;
      }
    }
    if (severed || hp <= 0) return { t: t + dt, dealt, severed, hp, dead: hp <= 0 };
  }
  return { t: budget, dealt, severed: false, hp, dead: hp <= 0 };
}

/** Passes ≈ how many authored attacks that engagement was, at the real cadence. */
function passesOf(t, cadence) { return Math.max(1, Math.round(t * cadence + 0.5)); }

/**
 * Wall-clock time to land `passes` attacks, given that only MODEL.swingHit of
 * them go where the player wanted. The blade's cadence is authored
 * (OVERHEAD.cooldown); the hit rate is this model's, and it is the reason a
 * trooper takes two thirds of a second to fall rather than the 0.08 s the
 * solver alone reports for the one pass that kills it.
 */
function timeFor(passes, cadence) { return (passes / MODEL.swingHit) / cadence; }

/**
 * A memo that cannot eat the process.
 *
 * THE BUG THIS EXISTS FOR: three of the caches below are keyed on numbers that
 * MOVE CONTINUOUSLY during a run. `engagementFor` keyed on
 * `cutPower.toFixed(4)`, and Fury scales cutPower by how close to death the
 * player is — so it takes a new value on almost every tick and the key space is
 * effectively unbounded. Measured: ~10 MB retained per simulated run, after an
 * explicit GC. A full report is ~10,500 runs, which is how a balance harness
 * came to die on `FATAL ERROR: Ineffective mark-compacts near heap limit` at
 * 8 GB — after printing the boon table, so the crash looked like it belonged to
 * the survival section rather than to a cache filled by all of them.
 *
 * Bounded, and cleared wholesale rather than evicted one at a time: these are
 * pure functions of their key, so a cold cache costs time and never
 * correctness, and LRU bookkeeping on a hot inner loop would cost more than the
 * misses it saved.
 */
const MEMO_MAX = 60000;
function memoGet(map, key, make) {
  const hit = map.get(key);
  if (hit !== undefined) return hit;
  if (map.size >= MEMO_MAX) map.clear();
  const v = make();
  map.set(key, v);
  return v;
}

/**
 * Rounding for a memo key, and the reason it is coarse.
 *
 * Two decimal places on a multiplier is finer than any conclusion this file
 * draws — the report prints depths to two decimals and rankings, not physics —
 * and it turns a continuous axis into at most a few hundred buckets. The old
 * `toFixed(4)` bought four digits of a number the model does not resolve, and
 * paid for them with the heap.
 */
const q = (v) => (Math.round(v * 100) / 100).toFixed(2);

const _engage = new Map();
/**
 * How long the blade needs to NEUTRALISE a body and how long to KILL it — two
 * different numbers, because severing one leg topples a droid and severing one
 * arm disarms a shooter, and both stop it hurting you long before it is dead.
 * A model that only knows hp would miss the whole of that.
 */
export function engagementFor(entry, mods) {
  const key = `${entry}|${q(mods.cutPower)}|${q(mods.bladeLength)}|${q(mods.attackRate)}`;
  if (_engage.has(key)) return _engage.get(key);
  if (_engage.size >= MEMO_MAX) _engage.clear();

  const { A } = archetypeOf(entry);
  const maxHp = A.hp;
  /**
   * The authored cadence, TIMES WHAT THE RUN HAS DONE TO IT.
   *
   * `attacksPerSec` alone made this model blind to the only offensive axis that
   * is not cut depth. That mattered the moment Cadence existed — the card added
   * precisely because the harness showed cut depth buys nothing against ten of
   * fifteen archetypes — and a harness that reports its own answer as
   * UNMODELLED is worse than one with a known gap, because the gap is invisible
   * in the ranking.
   */
  const cadence = measureSwing().attacksPerSec * (mods.attackRate ?? 1);
  const reach = mods.bladeLength;
  const passSpeed = measureSwing().passSpeed;
  // How high a standing player's blade goes, MEASURED off the real controller
  // driving a real authored attack, plus whatever the boons added to the blade.
  const ceiling = measureSwing().reachHeight + (reach - BLADE_REACH_BASE);
  const caps = capsulesFor(entry).filter(c => !c.shield && c.height - c.r <= ceiling);

  // A shield — a droideka's, or the Shielded elite's bubble — is in front of
  // every bone, and takeCut only DROPS it, so the passes that break it are pure
  // overhead before the body underneath is reachable at all.
  let shieldPasses = 0;
  const shieldCap = capsulesFor(entry).find(c => c.shield)
    || (A.shield ? { name: 'shield', r: 1.15 * A.scale, len: 0.1, toughness: TOUGHNESS.heavy, vital: 0 } : null)
    || (A.elite === 'shielded' ? { name: 'shield', r: (A.big ? 1.9 : 1.05) * A.scale, len: 0.1, toughness: TOUGHNESS.heavy, vital: 0 } : null);
  if (shieldCap) {
    const r = workCapsule(shieldCap, 1e9, 1e9, passSpeed, mods.cutPower, reach, cadence, 40);
    shieldPasses = r.severed ? passesOf(r.t, cadence) : 12;
  }

  // Try every capsule the body offers and keep the best plan, which is what a
  // player learns to do: you do not saw through a B2's chest, you take its arm.
  let best = null;
  for (const cap of caps) {
    const r = workCapsule(cap, maxHp, maxHp, passSpeed, mods.cutPower, reach, cadence, 40);
    if (!isFinite(r.t)) continue;
    const cons = r.severed ? limbConsequence(A, cap.name) : {};
    const neutral = r.dead || cons.decapitates
      || (cons.topplesAt === 1 && cons.legs) || cons.disarms;
    const score = neutral ? r.t : r.t * 2.5;   // a cut that neither kills nor stops it is worth much less
    if (!best || score < best.score) best = { score, cap, r, cons, neutral };
  }
  if (!best) { const v = { passes: 600, tNeutralise: Infinity, tKill: Infinity, via: 'out of reach' }; _engage.set(key, v); return v; }

  // Finish the job: after the first cut the bone is gone, so the rest of the hp
  // comes off the next-best capsule.
  let hp = best.r.hp, passes = passesOf(best.r.t, cadence), guard = 0;
  const neutralPasses = passes;
  const used = new Set([best.cap.name]);
  while (hp > 0 && guard++ < 10) {
    let step = null;
    for (const cap of caps) {
      if (used.has(cap.name)) continue;
      const r = workCapsule(cap, hp, maxHp, passSpeed, mods.cutPower, reach, cadence, 40);
      if (!step || r.t < step.r.t) step = { cap, r };
    }
    if (!step || !isFinite(step.r.t)) break;
    used.add(step.cap.name);
    hp = step.r.hp; passes += passesOf(step.r.t, cadence);
  }
  // A body no sequence of cuts finishes still dies — the grind damage of passes
  // that never sever is real hp. Fall back to that rate against the best bone.
  if (hp > 0) {
    const g = workCapsule(best.cap, maxHp, maxHp, passSpeed, mods.cutPower, reach, cadence, 240);
    passes = g.dead ? passesOf(g.t, cadence) : 600;
  }

  const out = {
    passes: passes + shieldPasses,
    tNeutralise: timeFor((best.neutral ? neutralPasses : passes) + shieldPasses, cadence),
    tKill: timeFor(passes + shieldPasses, cadence),
    via: `${shieldCap ? 'shield→' : ''}${best.cap.name}${best.cons.decapitates ? ' (decap)' : best.cons.disarms ? ' (disarm)' : best.cons.topplesAt === 1 ? ' (topple)' : best.r.dead ? ' (kill)' : ''}`,
    cuts: used.size,
  };
  _engage.set(key, out);
  return out;
}

/** How long it takes to get into blade range of one, in seconds. */
function closeTime(entry, mods) {
  const { A } = archetypeOf(entry);
  const mid = (A.preferred[0] + A.preferred[1]) / 2;
  const gap = Math.max(0, mid - mods.bladeLength - 0.6);
  // 4.6 m/s is Player's own base; the enemy gives ground at Enemy's own
  // BACKPEDAL share of its speed once you are inside its band.
  const close = Math.max(0.5, 4.6 * mods.moveSpeed - BACKPEDAL * A.speed);
  return gap / close;
}

/**
 * How long a freshly spawned body spends walking in before it can do anything.
 *
 * The director drops it on the level's own spawn ring — World.pickSpawn reads
 * `L.spawnRadius || [34, 56]` — and Enemy._rangedBrain will not fire until it is
 * inside `preferred[1] + 12`. A melee body has to reach `preferred[1]`. So the
 * first several seconds of every wave are a walk, and a model that has the
 * whole wave shooting from frame one is describing a fight nobody has.
 */
function armTime(entry, diff, levelKey) {
  const { A } = archetypeOf(entry);
  const ring = (LEVELS[levelKey] || LEVELS[LEVEL_ORDER[0]]).spawnRadius || [34, 56];
  const from = (ring[0] + ring[1]) / 2;
  const need = A.melee ? A.preferred[1] : A.preferred[1] + 12;
  const speed = Math.max(0.2, A.speed * lerp(0.86, 1.12, diff.enemyAggression / 1.25));
  return Math.max(0, from - need) / speed;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  ENEMY OFFENCE
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bolts per second and the chance one is inside the player, both from the real
 * numbers. The hit test is World._boltHitTest's own capsule: 0.36 m radius from
 * y+0.35 to y+1.72. Spread is Enemy._shoot's own — a uniform perturbation of
 * ±spread/2 on the horizontal components of the aim and ±0.35·spread on the
 * vertical, applied at the archetype's own preferred range.
 */
const _bolt = new Map();
function boltPressure(entry, diff, playerSpeed = 4.6) {
  // `playerSpeed` is 4.6 x moveSpeed, and Fury moves moveSpeed with health —
  // so this key is continuous too. Same quantisation, same bound. See memoGet.
  return memoGet(_bolt, `${entry}|${diff.name}|${q(playerSpeed)}`,
    () => _boltPressure(entry, diff, playerSpeed));
}
function _boltPressure(entry, diff, playerSpeed) {
  const { A } = archetypeOf(entry);
  if (!A.ranged || A.inert) return null;
  const rate = A.fireRate / (diff.enemyAggression * (diff.fireRate ?? 1));
  const burst = A.burst ?? 1;
  const cycle = rate + burst * (A.burstGap ?? 0.12) + (A.telegraph ?? 0);
  const boltsPerSec = burst / cycle;
  const dist = (A.preferred[0] + A.preferred[1]) / 2;
  const s = (A.spread ?? 0.06) * (2 - diff.enemyAccuracy);
  const scatter = dist * s;                 // half-width of the horizontal spread band

  /**
   * THE LEAD. Enemy._shoot aims at where you WILL be, but only `enemyAccuracy`
   * of the way there: `aimAt.addScaledVector(target.velocity, tof * acc)`. So a
   * moving player is systematically under-led by (1 - acc)·v·tof, and that is
   * most of what a difficulty's accuracy column actually buys. Ignoring it — as
   * the first version of this model did — makes a stationary statue of the
   * player and kills every Master run on wave one.
   *
   * tof is the real time of flight: Enemy._shoot fires at 88 · diff.boltSpeed
   * (×1.2 for a big frame) over the archetype's own preferred range. Only the
   * component of the player's motion across the shot counts, taken at 0.7 since
   * a player closing on a shooter is partly moving along the line.
   */
  const boltSpeed = 88 * diff.boltSpeed * (A.big ? 1.2 : 1);
  const tof = dist / boltSpeed;
  const lead = (1 - diff.enemyAccuracy) * playerSpeed * 0.7 * tof;

  // Chance the bolt lands inside World._boltHitTest's own 0.36 m capsule, given
  // a uniform scatter band offset by the lead error.
  const band = (off) => {
    if (scatter <= 1e-6) return Math.abs(off) < 0.36 ? 1 : 0;
    const lo = Math.max(-scatter, -0.36 - off), hi = Math.min(scatter, 0.36 - off);
    return clamp((hi - lo) / (2 * scatter), 0, 1);
  };
  const pV = Math.min(1, 1.37 / Math.max(1e-6, dist * s * 0.7));
  return {
    boltsPerSec, damage: A.damage, dist, tof, lead,
    pHitMoving: band(lead) * pV,
    pHitStill: band(0) * pV,
  };
}

const _melee = new Map();
/** Melee pressure, per the real DuelBrain cadence and the real strike test. */
function meleePressure(entry, diffKey, formKey) {
  const memo = `${entry}|${diffKey}|${formKey}`;
  if (_melee.has(memo)) return _melee.get(memo);
  const v = _meleePressure(entry, diffKey, formKey);
  _melee.set(memo, v);
  return v;
}
function _meleePressure(entry, diffKey, formKey) {
  const { A } = archetypeOf(entry);
  if (!A.melee) return null;
  if (A.saber) {
    const d = measureDuel(diffKey, formKey);
    // World only lands the blade when the swept tip passes within 0.44 m of the
    // player's own 1.3 m torso segment. A player who is not standing still eats
    // MODEL.meleeConnect of them; this is the one melee number that is a guess.
    return { strikesPerSec: d.strikesPerSec, damage: A.damage * d.damageScale, connect: 0.55 };
  }
  // The acklay: three attack states off one timer, mean period lerp(2.4,1.15)
  // plus rng()*1.1, mean damage ~1.05x its base across lunge/sweep/charge.
  return { strikesPerSec: 1 / (1.9 + 0.55), damage: A.damage * 1.05, connect: 0.5 };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE PLAYER STUB — Player.js's own defaults, and the real BOONS applied
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * A player stub with a REAL damage() and a REAL update(), so the game's own
 * boon machinery installs on it and runs.
 *
 * This is the difference between measuring a boon and guessing at it. Waves.js
 * grew a whole conditional layer — boonGuard wraps damage(), boonTick wraps
 * update() — and Encircled, Steadfast, Second Wind, Fury, Juyo, Undying and
 * Bastion are all implemented in those wrappers, not in a multiplier this file
 * could read off boonMods. Give the stub the two methods they wrap and every
 * one of them executes here exactly as it executes in a fight: encircleGuard
 * really counts the bodies around you, secondWindGuard really compares the
 * incoming hit to your remaining hp, undyingMend really waits out its clock.
 *
 * damage() is Player.damage's arithmetic and nothing else: scale by the tier's
 * damageTaken, subtract, die at zero. The order matters, because every guard
 * above it re-derives that same scale to decide what it is looking at.
 */
function makePlayer(diffKey = 'knight') {
  const p = {
    maxHp: 100, hp: 100,
    maxStamina: 100, stamina: 100,
    maxForce: 100, force: 100,
    flow: 0, alive: true, invuln: 0, staggerTimer: 0,
    kills: 0, deflects: 0, perfects: 0, limbsRemoved: 0, combo: 0, score: 0,
    isLocal: true,
    position: new THREE.Vector3(),
    boons: new RankSet(),
    // PLAYER'S OWN, not a copy. This was a hand-written duplicate of Player's
    // boonMods and it went stale the moment a card needed a key it did not
    // list — `undefined * 1.33` is NaN, and a NaN in cutPower silently reports
    // a card as worthless rather than crashing, which is the worst possible
    // failure for an instrument whose entire job is ranking cards.
    boonMods: defaultBoonMods(),
    control: { deadzone: 0.22, sensitivity: 1 },
    saber: { bladeLength: BLADE_REACH_BASE, coreWidth: 1 },
    world: {
      difficulty: DIFFICULTY[diffKey], enemies: [],
      notify() {}, notifyFloating() {}, engine: { flash() {}, hurt() {} },
    },
    // cleavingThrow() wraps this; giving it a function is what makes that boon's
    // own apply() report the technique as live rather than silently inert.
    _updateThrow() {},
    throwPos: new THREE.Vector3(), throwVel: new THREE.Vector3(),
    throwTimer: 0, throwState: 'held',
    update() {},
    heal(v) { this.hp = Math.min(this.maxHp, this.hp + v); },
    damage(amount, point, source, kind) {
      if (!this.alive) return false;
      const dmg = amount * (this.world.difficulty ? this.world.difficulty.damageTaken : 1);
      if (!Number.isFinite(dmg)) return false;
      this.hp -= dmg;
      if (this.hp <= 0) { this.hp = 0; this.alive = false; return true; }
      return false;
    },
  };
  return p;
}

/**
 * Apply a card AT ITS RANK, which is what the game does and what this harness
 * did not.
 *
 * `boon.apply(p, s)` takes a rank SCALE — `grow(1.5, s)` shrinks the excess
 * over 1 rather than the multiplier — and every ranked card in the table reads
 * it. Calling `apply(p)` with no second argument gave every rank the default
 * `s = 1`, so a card taken four times applied its full effect four times and
 * the geometric diminishment that BOUNDS a build was never once exercised by
 * the thing that exists to measure builds. That is the whole of task 11's first
 * half: not that ranks were mis-measured, but that they were absent.
 */
function applyBoon(p, boon, rank = 1) {
  boon.apply(p, rankScale(rank));
  p.boons.add(boon.id);
}

/** The subset of a player's state the OFFENCE model reads, sampled now. */
function modsOf(p) {
  return {
    cutPower: p.boonMods.cutPower,
    attackRate: p.boonMods.attackRate,
    bladeLength: p.saber.bladeLength,
    moveSpeed: p.boonMods.moveSpeed,
    deflectDamage: p.boonMods.deflectDamage,
    staminaRegen: p.boonMods.staminaRegen,
    absorb: !!p.boonMods.absorb,
    lifesteal: p.boonMods.lifesteal,
    healOnKill: p.boonMods.healOnKill,
    maxHp: p.maxHp, maxStamina: p.maxStamina,
  };
}

/**
 * Which boons this model can see the effect of at all. Everything else touches
 * Force powers, jump height, camera feel or blade cosmetics, none of which this
 * simulation has. They are reported as UNMODELLED, not as worthless — the
 * distinction is the whole difference between a finding and a libel.
 */
const MODELLED_CHANNELS = {
  cutPower: 'blade damage', bladeLength: 'reach + travel', moveSpeed: 'travel',
  // The cadence the whole offence model divides by. See engagementFor.
  attackRate: 'swing rate',
  deflectDamage: 'returned bolts', absorb: 'damage taken',
  lifesteal: 'healing', healOnKill: 'healing', maxHp: 'health',
  // NOT returnCone. It was listed here as 'return targeting' and NOTHING IN
  // THE SIMULATION EVER READ IT — `modsOf` copied it out and no line consumed
  // it, because this model has no notion of picking a victim for a returned
  // bolt. So Soresu was reported as having a channel, measured at Δ0.000, and
  // therefore printed as a card that does nothing. Claiming to see something
  // and then scoring it zero is the one failure mode an instrument must not
  // have.
};

/**
 * READ, BUT NEVER BINDING — and therefore not a channel.
 *
 * `staminaRegen` and `maxStamina` used to be listed above, and they are
 * genuinely read: `canSwing` gates every cut on stamina/maxStamina > 0.12 and a
 * BLOCK spends 4. But the regen this model now runs (Player._regen's own 16/s,
 * +10/s out of contact) restores that in a quarter of a second, so the gate is
 * never actually reached — you would have to block four bolts a second forever
 * to feel it. Meditation and Soresu therefore measure exactly Δ0.000 with 0%
 * helped, and listing them as MODELLED turned "this instrument cannot tell"
 * into the printed claim "this card does nothing".
 *
 * That is the distinction the whole UNMODELLED column exists to protect, and it
 * is the difference between a finding and a libel. Fixing it properly means
 * giving the model a guard that can actually be broken, which is a bigger piece
 * of work than this file; until then it says it cannot see them.
 *
 * (The regen itself is kept regardless, because without it the model was
 * WRONG rather than merely incomplete: a player who blocked twenty-five bolts
 * could never swing again for the rest of the run.)
 */
const READ_BUT_NEVER_BINDING = ['staminaRegen', 'maxStamina'];

/**
 * The conditional cards do not move any of those fields at install time; they
 * install a wrapper. Since the stub now carries the two methods those wrappers
 * wrap, a boon that sets one of these keys IS exercised by the simulation.
 */
const MODELLED_HOOKS = {
  encircle: 'damage taken', steadfast: 'damage taken', secondWind: 'death save',
  fury: 'blade + travel', ferocity: 'blade damage', mend: 'healing',
  guardRefund: 'guard sustain',
};

export function boonChannels(boon) {
  const a = makePlayer(), b = makePlayer();
  applyBoon(b, boon);
  const ma = modsOf(a), mb = modsOf(b);
  const touched = [];
  for (const k of Object.keys(MODELLED_CHANNELS)) if (ma[k] !== mb[k]) touched.push(k);
  for (const k of Object.keys(MODELLED_HOOKS)) if (a.boonMods[k] !== b.boonMods[k]) touched.push(k);
  return touched;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  WAVE COMPOSITION — the real director
 * ══════════════════════════════════════════════════════════════════════════ */

const _stubWorld = { enemies: [], player: null, terrain: null, settings: {}, takenBoons: new Set() };
const _pool = new Map();
function compositionPool(levelKey, wave, mode = 'roguelite') {
  const key = `${levelKey}|${wave}|${mode}`;
  if (_pool.has(key)) return _pool.get(key);
  const L = LEVELS[levelKey] || LEVELS[LEVEL_ORDER[0]];
  const d = new WaveDirector(_stubWorld, { mode, pool: L.pool });
  const out = [];
  for (let i = 0; i < MODEL.poolPerWave; i++) {
    d.wave = wave;
    d._compose();
    out.push(d.spawnQueue.slice());
  }
  _pool.set(key, out);
  return out;
}

export function budgetFor(wave) {
  return new WaveDirector(_stubWorld, {}).budgetFor(wave);
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE RUN
 * ══════════════════════════════════════════════════════════════════════════ */

/** Share of bolts the player's guard answers, at this tier and this skill. */
function answerRate(diff, sigmaDeg) {
  const tol = zoneTolerance(diff.assist) * 180 / Math.PI;      // Combat's own function
  const sigma = sigmaDeg * Math.pow(diff.boltSpeed / MODEL.boltSpeedRef, MODEL.reactionExponent);
  return clamp(erf(tol / (sigma * Math.SQRT2)), 0, 1);
}

/**
 * One run of Path of the Blade, wave 1 until the player dies.
 *
 * `depth` is continuous — the wave reached plus the share of it cleared — so a
 * paired comparison between two builds has resolution finer than one wave.
 * Runs die, they do not time out: a wave that will not end trips waveTimeout
 * and is reported as a modelling failure rather than as a survival.
 */
export function simulateRun(opts) {
  const {
    difficulty = 'knight', level = LEVEL_ORDER[0], seed = 1,
    sigma = MODEL.guardSigma, boonPolicy = null, maxWave = MODEL.maxWave,
    /**
     * Cards HELD FROM WAVE ONE, as `[boon, ranks]` — the build, rather than the
     * draft that produced it.
     *
     * The draft path cannot answer a question about ranks. A modelled run dies
     * at wave 5.3 (median, knight, twelve seeds), and drafts fall on waves 3, 6
     * and 9 — so the second copy of a card is taken in a small minority of runs
     * and the third almost never. Measured through drafts, every rank past the
     * first reads 0.000 for want of a run that lived to see it, which is a
     * property of the survival model and nothing at all about ranks.
     *
     * Granting is the same experiment with the noise removed: hold k ranks,
     * play, and read the depth. It answers "what is a build with k of these
     * worth" exactly, which is the question the rank curve is about.
     */
    grant = null,
  } = opts;
  const diff = DIFFICULTY[difficulty];
  const rng = makeRng(seed >>> 0 || 1);
  const p = makePlayer(difficulty);
  const answer = answerRate(diff, sigma);
  const swing = measureSwing();
  // A RankSet, not a Set: the game's own, so "taken" means the same thing here
  // as it does in a run. `drawSeeded` filters on `has`, so an unranked card
  // still leaves the pool after one take and a ranked one does not.
  const taken = new RankSet();
  if (grant) {
    for (const [boon, ranks] of grant) {
      for (let k = 0; k < (ranks ?? 1); k++) applyBoon(p, boon, taken.take(boon.id));
    }
  }
  const waveLog = [];
  let modelFailure = null;
  // Damage goes through p.damage() and healing through p.heal(), so every boon
  // wrapper Waves.js installed sees the hit it was written to see.
  const hurt = (raw) => p.damage(raw, null, null, 'bolt');

  for (let wave = 1; wave <= maxWave; wave++) {
    const pool = compositionPool(level, wave);
    const queue = pool[Math.floor(rng() * pool.length)].slice();
    const total = queue.length;
    let mods = modsOf(p);
    /* Second Wind is "once each wave", and the wave boundary is here — but
     * through the GAME's own refresh rather than a hand-written restatement of
     * it. The line this replaces was `p.boonMods.secondWind = 1`, which is a
     * copy of a rule that has since grown a rank: two ranks are worth two
     * saves, and this harness reported the card at 1.00x because it kept
     * handing out one whatever the player had bought. A harness that restates
     * a rule measures its own copy of the game. */
    refreshWaveBoons({ players: [p] });

    const alive = [];
    p.world.enemies = alive;
    let qi = 0, spawnTimer = 0, t = 0, killed = 0;
    const hpAtStart = p.hp;
    let engaged = null, phase = 'travel', phaseT = 0;
    const maxAlive = 26;   // WaveDirector's own default

    while ((qi < total || alive.length) && p.alive) {
      const dt = MODEL.dt;
      t += dt;
      p.invuln = Math.max(0, p.invuln - dt);
      p.update(dt, {});      // every boonTick the run has installed
      /**
       * STAMINA COMES BACK. It did not, and that was a hole in the model rather
       * than a simplification: `canSwing` gates every cut on stamina and a
       * BLOCK spends 4 of it, so a player who blocked twenty-five bolts could
       * never swing again for the rest of the run. Nothing regenerated it, so
       * `staminaRegen` had no reader here at all — which is why Meditation
       * measured Δ0.000 with 0% helped and was reported as a card that does
       * nothing, and why Soresu's +25 reserve read the same way.
       *
       * Player._regen's own arithmetic: 16/s, plus 10/s more out of contact.
       * `combatIntensity` is a world signal this model does not have, so it
       * uses the honest proxy — whether anything is currently engaged.
       */
      p.stamina = Math.min(p.maxStamina,
        p.stamina + (16 + (engaged ? 0 : 10)) * dt * p.boonMods.staminaRegen);
      if (t > MODEL.waveTimeout) { modelFailure = `wave ${wave} never ended`; break; }

      /* ── spawning: the director's own cadence ── */
      spawnTimer -= dt;
      if (qi < total && alive.length < maxAlive && spawnTimer <= 0) {
        const entry = queue[qi++];
        const { A } = archetypeOf(entry);
        const form = A.saber ? FORM_KEYS[Math.floor(rng() * FORM_KEYS.length)] : null;
        alive.push({
          entry, A, form, hp: A.hp,
          // A droideka's own 260, or the Shielded elite's SHIELD_HP share of hp.
          shield: A.shield ? 260 : (A.elite === 'shielded' ? A.hp * 2.2 : 0),
          neutral: false, arm: armTime(entry, diff, level), auto: 0,
          // Encircled counts bodies inside 7 m of `player.position`, so a body
          // has to have one. Its distance is the band it actually holds.
          position: new THREE.Vector3((A.preferred[0] + A.preferred[1]) / 2, 0, 0),
          dead: false,
          eng: engagementFor(entry, mods),
          close: closeTime(entry, mods),
          // Cached on the body rather than looked up per step: the inner loop
          // runs a million times a run and a Map key built from three strings
          // was most of its cost.
          bp: boltPressure(entry, diff, 4.6 * mods.moveSpeed),
          mp: meleePressure(entry, difficulty, form),
        });
        spawnTimer = lerp(0.85, 0.16, clamp(wave / 16, 0, 1)) * (0.6 + rng() * 0.8);
      }

      /* ── the player's own target ── */
      if (!engaged || engaged.hp <= 0) {
        engaged = null;
        // Fury and Juyo move cutPower and moveSpeed as the fight goes; re-read
        // them whenever a new body is picked rather than once at wave start.
        mods = modsOf(p);
        for (const e of alive) { e.eng = engagementFor(e.entry, mods); e.close = closeTime(e.entry, mods); }
        let best = Infinity;
        for (const e of alive) {
          if (e.hp <= 0) continue;
          const cost = e.close + e.eng.tKill;
          if (cost < best) { best = cost; engaged = e; }
        }
        phase = 'travel'; phaseT = 0;
      }

      /* ── blade work ── */
      const canSwing = p.stamina / p.maxStamina > 0.12;
      if (engaged) {
        phaseT += dt;
        if (phase === 'travel') {
          if (phaseT >= engaged.close) { phase = 'cut'; phaseT = 0; }
        } else if (canSwing) {
          if (phaseT >= engaged.eng.tNeutralise) engaged.neutral = true;
          if (phaseT >= engaged.eng.tKill) {
            engaged.hp = 0; engaged.dead = true; killed++; p.kills++;
            // World: healOnKill on a kill, lifesteal per limb severed. `cuts` is
            // how many limbs this engagement actually took off.
            p.limbsRemoved += engaged.eng.cuts ?? 1;
            p.heal(mods.healOnKill + mods.lifesteal * (engaged.eng.cuts ?? 1));
            const i = alive.indexOf(engaged); if (i >= 0) alive.splice(i, 1);
            engaged = null;
          }
        } else phaseT -= dt;    // too tired to swing: the clock does not advance
      }

      /* ── incoming ── */
      for (const e of alive) {
        if (e.neutral || e.hp <= 0) continue;
        e.arm -= dt;
        if (e.arm > 0) continue;                 // still walking in
        e.auto = Math.max(0, e.auto - dt);       // CATCH.autoGuard, per shooter
        const bp = e.bp;
        if (bp) {
          if (rng() >= MODEL.lineOfSight) continue;
          // Standing still to cut is what makes you easy to lead. Walking is
          // what makes you hard to. Both are real states of this fight.
          const arriving = bp.boltsPerSec * (phase === 'cut' ? bp.pHitStill : bp.pHitMoving) * dt;
          // Bernoulli on the expected count, so the histogram has honest spread.
          let n = Math.floor(arriving);
          if (rng() < arriving - n) n++;
          for (let i = 0; i < n; i++) {
            // The auto-guard cone: a MANUAL catch opens 0.40 s during which
            // anything arriving from the same direction is caught for free.
            // That is the whole answer to "what about the second bolt of the
            // burst", and World says an auto catch is aimed and worth 1.0x.
            if (e.auto > 0) {
              const back = bp.damage * 1.0 * mods.deflectDamage * lerp(0.6, 1.9, MODEL.returnVital);
              if (e.shield > 0) e.shield -= back; else e.hp -= back;
              if (e.hp <= 0) {
                killed++; p.kills++; e.dead = true; p.heal(mods.healOnKill);
                const ix = alive.indexOf(e); if (ix >= 0) alive.splice(ix, 1);
                if (e === engaged) engaged = null;
              }
              continue;
            }
            if (rng() < answer) {
              e.auto = 0.40;                     // CATCH.autoGuard
              // Grade the answer off the measured swing trace and pay it back.
              const r = rng(), g = swing.grade;
              let mul = 0, aimed = false;
              if (r < g.perfect) { mul = 2.5; aimed = true; }
              else if (r < g.perfect + g.return) { mul = 1.5; aimed = true; }
              else if (r < g.perfect + g.return + g.deflect) { mul = 1.0; aimed = false; }
              // A BLOCK costs 4 stamina, per World._creditDeflect. Bastion's
              // guardRefund hands some of it back through its own tick.
              else { mul = 0; p.stamina = Math.max(0, p.stamina - 4); }
              p.deflects++;
              if (mul > 0) {
                const back = bp.damage * mul * p.boonMods.deflectDamage
                  * lerp(0.6, 1.9, aimed ? MODEL.returnVital : MODEL.deflectVital);
                const victim = aimed ? e : alive[Math.floor(rng() * alive.length)];
                if (victim && victim.hp > 0) {
                  if (victim.shield > 0) victim.shield -= back;
                  else victim.hp -= back;
                  if (victim.hp <= 0) {
                    killed++; p.kills++; victim.dead = true; p.heal(p.boonMods.healOnKill);
                    const i = alive.indexOf(victim); if (i >= 0) alive.splice(i, 1);
                    if (victim === engaged) engaged = null;
                  }
                }
              }
            } else if (p.invuln <= 0) {
              // Tutaminis: World._boltHitTest turns the bolt into Force and
              // passes on 45% of it. Everything else takes the bolt whole.
              hurt(bp.damage * (p.boonMods.absorb ? 0.45 : 1));
              p.invuln = 0.18;                   // Player.damage's own i-frames
            }
          }
          continue;
        }
        const mp = e.mp;
        if (mp) {
          const swings = mp.strikesPerSec * mp.connect * dt;
          let n = Math.floor(swings);
          if (rng() < swings - n) n++;
          for (let i = 0; i < n; i++) {
            if (p.invuln > 0) break;
            hurt(mp.damage); p.invuln = 0.18;
          }
        }
      }

      /* ── stamina, per Player._regen; combatIntensity is taken as hot ── */
      p.stamina = Math.min(p.maxStamina, p.stamina + 16 * dt * p.boonMods.staminaRegen);
    }

    const cleared = total ? clamp(killed / total, 0, 1) : 1;
    waveLog.push({ wave, n: total, t, killed, hpStart: hpAtStart, hpEnd: Math.max(0, p.hp), cleared });
    if (modelFailure) break;
    if (!p.alive) return { died: wave, depth: (wave - 1) + cleared, waveLog, boons: [...taken], modelFailure };

    p.heal(8);                             // World.onWaveClear
    if (wave % 3 === 0) {
      const offer = drawSeeded(rng, 3, taken);
      const pick = boonPolicy ? boonPolicy(offer, wave, taken) : offer[0];
      if (pick) applyBoon(p, pick, taken.take(pick.id));
    }
  }
  return { died: maxWave + 1, depth: maxWave + 1, waveLog, boons: [...taken], survived: true, modelFailure };
}

/**
 * drawBoons' own policy — uniform without replacement over untaken boons —
 * driven by a seeded rng so a paired comparison can be given the same draft.
 * The real function's rng is module-private and cannot be seeded from outside;
 * tools/checks/balance.mjs asserts this mirror still matches its contract.
 */
export function drawSeeded(rng, n, taken) {
  // A ranked card stays in the pool until its ranks are spent — the property
  // `drawBoons` has and this mirror did not, which is why a paired run could
  // never take the same card twice and the rank sweep below had to force it.
  const copy = BOONS.filter(b => rankOf(taken, b.id) < maxRank(b));
  const out = [];
  for (let i = 0; i < n && copy.length; i++) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  REPORTS
 * ══════════════════════════════════════════════════════════════════════════ */

const DIFF_KEYS = ['padawan', 'knight', 'master', 'grandmaster'];

function table(head, rows, opts = {}) {
  const all = [head, ...rows].map(r => r.map(c => String(c)));
  const w = head.map((_, i) => Math.max(...all.map(r => (r[i] ?? '').length)));
  const line = (r) => r.map((c, i) => (opts.left?.includes(i) ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  const out = [line(all[0]), w.map(n => '─'.repeat(n)).join('  ')];
  for (const r of all.slice(1)) out.push(line(r));
  return out.map(s => '  ' + s).join('\n');
}

function histogram(depths, lo, hi) {
  const bins = new Map();
  for (const d of depths) bins.set(d, (bins.get(d) || 0) + 1);
  const top = Math.max(1, ...bins.values());
  const rows = [];
  for (let w = lo; w <= hi; w++) {
    const n = bins.get(w) || 0;
    if (!n && (w < lo || w > hi)) continue;
    rows.push([w, n, '█'.repeat(Math.round(24 * n / top)) || (n ? '▏' : '')]);
  }
  return rows;
}

export function survivalReport(cfg) {
  const out = [];
  out.push('');
  out.push('══ SURVIVAL — where runs die ═══════════════════════════════════════════');
  out.push('');
  out.push(`  ${cfg.runs} seeded runs per tier, level "${cfg.level}", boons drafted ${_rank ? 'greedily by the ranking above' : 'first-on-offer (no ranking computed: run without --only to get one)'}.`);
  out.push('  MODEL-DEPTH, not a prediction of a human. Read the ORDER, not the number.');
  const ladder = cfg.sigma != null ? [{ name: 'custom', sigma: cfg.sigma }] : MODEL.skillLadder;
  const bySkill = {};
  for (const skill of ladder) {
    out.push('');
    out.push(`  ── skill "${skill.name}" (guard error σ = ${skill.sigma}°) ────────────────────`);
    const rows = [];
    bySkill[skill.name] = {};
    for (const dk of DIFF_KEYS) {
      const depths = [], dies = [];
      for (let s = 0; s < cfg.runs; s++) {
        const r = simulateRun({ difficulty: dk, level: cfg.level, seed: 1000 + s, sigma: skill.sigma, boonPolicy: greedyPolicy });
        depths.push(r.depth); dies.push(r.died);
      }
      bySkill[skill.name][dk] = { depths, dies };
      rows.push([DIFFICULTY[dk].name, (100 * answerRate(DIFFICULTY[dk], skill.sigma)).toFixed(0) + '%',
        median(dies), quantile(dies, 0.1), quantile(dies, 0.9),
        median(depths).toFixed(2), mean(depths).toFixed(2),
        dies.filter(d => d > MODEL.maxWave).length]);
    }
    out.push('');
    out.push(table(['tier', 'bolts answered', 'median wave', 'p10', 'p90', 'median depth', 'mean depth', 'survived 30'], rows, { left: [0] }));
    // one histogram, at the tier the game defaults to
    const d = bySkill[skill.name].knight.dies;
    const lo = Math.max(1, Math.min(...d)), hi = Math.min(MODEL.maxWave + 1, Math.max(...d));
    out.push('');
    out.push('  Knight, wave a run died on:');
    out.push(table(['wave', 'runs', ''], histogram(d, lo, hi), { left: [2] }));
  }
  return { text: out.join('\n'), bySkill };
}

/**
 * Take the highest-ranked boon on offer, by the ranking THIS FILE computed a
 * moment ago. Falls back to first-on-offer when the ranking has not been run,
 * and the survival report says which of the two it used rather than leaving the
 * reader to guess why two invocations disagree.
 */
let _rank = null;
function greedyPolicy(offer) {
  if (!_rank) return offer[0];
  let best = offer[0], bs = -Infinity;
  for (const b of offer) { const s = _rank.get(b.id) ?? 0; if (s > bs) { bs = s; best = b; } }
  return best;
}

/**
 * WHAT A SECOND COPY OF A CARD IS WORTH — and whether the diminishment is real.
 *
 * `RANK_DIMINISH` is a geometric series: rank n is worth `d^(n-1)` of the
 * first, so a stack converges to `1/(1-d)` of one card and a build is bounded
 * by construction. That is the design. Nothing had ever measured it, because
 * `applyBoon` dropped the rank on the floor and `drawSeeded` removed a card
 * from the pool after one take — so the harness could not have taken a card
 * twice even if it had wanted to.
 *
 * The sweep forces it: the same seeded run, granted the same card k times at
 * consecutive drafts, for k = 1..stack. What must be true, and is asserted in
 * tools/checks/balance.mjs:
 *
 *   · MORE IS MORE. Rank k must beat rank k-1. A diminishing return is still a
 *     return, and a card whose second copy is worth nothing is a dead card in
 *     every draft after the first.
 *   · AND LESS THAN LINEAR. Rank k must be worth less than k times rank 1, or
 *     the diminishment is not happening and a single axis runs away — which is
 *     exactly the failure the ranks were introduced to prevent.
 */
export function rankReport(cfg) {
  const out = [];
  out.push('');
  out.push('══ RANKS — the same card taken again, and again ══');
  out.push('');
  out.push('  Same seed, same run. The treatment HOLDS k ranks of this card from wave one');
  out.push('  and nothing else, ever. Δ is paired against a run that holds nothing. Granted');
  out.push('  rather than drafted because a modelled run dies at wave 5.3 and the drafts');
  out.push('  fall on waves 3, 6 and 9 — through drafts, every rank past the first reads');
  out.push('  0.000 for want of a run that lived to see it.');
  const ranked = BOONS.filter((b) => maxRank(b) > 1);
  const rows = [];
  const perCard = new Map();
  for (const boon of ranked) {
    const cap = maxRank(boon);
    const byRank = [];
    for (let k = 1; k <= cap; k++) {
      const ds = [];
      for (const dk of cfg.boonTiers) {
        for (let sd = 0; sd < cfg.boonRuns; sd++) {
          const seed = 7000 + sd * 13;
          const a2 = simulateRun({ difficulty: dk, level: cfg.level, seed, boonPolicy: () => null });
          const b2 = simulateRun({ difficulty: dk, level: cfg.level, seed, boonPolicy: () => null,
            grant: [[boon, k]] });
          ds.push(b2.depth - a2.depth);
        }
      }
      byRank.push(mean(ds));
    }
    perCard.set(boon.id, byRank);
    rows.push([boon.name, boon.id, String(cap),
      ...byRank.map((v) => v.toFixed(3)),
      ...Array(4 - byRank.length).fill(''),
      (byRank[byRank.length - 1] / (byRank[0] || 1e-9)).toFixed(2) + '×']);
  }
  rows.sort((a2, b2) => Number(b2[3]) - Number(a2[3]));
  out.push('');
  out.push(table(['card', 'id', 'cap', 'r1', 'r2', 'r3', 'r4', 'full/r1'], rows, { left: [0, 1] }));

  /* AND THE DIMINISHMENT WHERE IT ACTUALLY LIVES.
   *
   * Depth is a NON-LINEAR function of a stat — thirty more health is worth more
   * than thirty when it carries you into a wave you would not have seen — so a
   * card can diminish perfectly in the stat and still look superlinear in
   * depth, and Communion does exactly that above (3.34× at rank 3 against a
   * geometric 1.96×). Asserting sublinearity on the depth column would
   * therefore be asserting the wrong thing about the right property.
   *
   * So it is also measured where it is exact: apply k ranks to a player, read
   * the field the card moves, and compare the EXCESS over baseline against the
   * geometric series. This has no noise in it at all. */
  const statRows = [];
  const perStat = new Map();
  for (const boon of ranked) {
    const cap = maxRank(boon);
    const base = makePlayer('knight');
    const b0 = modsOf(base);
    const excess = [];
    for (let k = 1; k <= cap; k++) {
      const q = makePlayer('knight');
      for (let i = 1; i <= k; i++) boon.apply(q, rankScale(i));
      const b1 = modsOf(q);
      // the one field this card moved the most, as a fraction over baseline
      let best = 0;
      for (const key of Object.keys(b1)) {
        if (typeof b1[key] !== 'number' || typeof b0[key] !== 'number' || !b0[key]) continue;
        best = Math.max(best, Math.abs(b1[key] / b0[key] - 1));
      }
      excess.push(best);
    }
    if (!excess[0]) continue;                       // nothing modsOf can see
    const norm = excess.map((v) => v / excess[0]);
    const series = norm.map((_, i) => {
      let t = 0;
      for (let j = 0; j <= i; j++) t += Math.pow(RANK_DIMINISH, j);
      return t;
    });
    perStat.set(boon.id, { norm, series });
    statRows.push([boon.name, boon.id,
      ...norm.map((v) => v.toFixed(3)), ...Array(4 - norm.length).fill(''),
      series[series.length - 1].toFixed(3)]);
  }
  out.push('');
  out.push('  …and the same thing measured on the STAT, where it is exact and noiseless:');
  out.push('');
  out.push(table(['card', 'id', 'r1', 'r2', 'r3', 'r4', 'geometric'], statRows, { left: [0, 1] }));
  out.push('');
  out.push(`  A geometric series at d=${RANK_DIMINISH} converges to `
    + `${(1 / (1 - RANK_DIMINISH)).toFixed(2)}× one card, so rank 3 is 1.960× and rank 4 is 2.176×.`);
  return { text: out.join('\n'), perCard, perStat };
}

/**
 * THE RACE THAT HAS NO FINISH LINE.
 *
 * Attunements exist because ranks converge and the wave budget does not: the
 * budget goes 7 → 162 over twenty waves, and nothing that converges can answer
 * that. Each attunement step is small BECAUSE it is unbounded. So the property
 * to measure is not "is an attunement strong" — it is "does taking them every
 * boss wave keep pace, where taking cards eventually cannot".
 *
 * Three runs, same seeds: one takes nothing, one takes cards greedily, one
 * takes an attunement on every boss wave and cards otherwise. Run deep — past
 * the point where the card pool's ranks are spent — and read the depths.
 */
export function attunementReport(cfg) {
  const out = [];
  out.push('');
  out.push('══ ATTUNEMENTS — the growth with no cap, against the budget with no cap ══');
  out.push('');
  out.push('  Held from wave one rather than drafted, for the reason the rank sweep gives:');
  out.push(`  a modelled run dies at wave 5.3 and an attunement is offered on boss waves`);
  out.push(`  (every ${BOSS_EVERY}), so through the draft path it is never taken at all.`);
  out.push('');
  const byAxis = new Map();
  const rows = [];
  for (const att of ATTUNEMENTS) {
    const ds = [];
    for (const dk of cfg.boonTiers) {
      for (let sd = 0; sd < cfg.boonRuns; sd++) {
        const seed = 7000 + sd * 13;
        const a2 = simulateRun({ difficulty: dk, level: cfg.level, seed, boonPolicy: () => null });
        const b2 = simulateRun({ difficulty: dk, level: cfg.level, seed, boonPolicy: () => null,
          grant: [[att, 1]] });
        ds.push(b2.depth - a2.depth);
      }
    }
    byAxis.set(att.id, mean(ds));
    rows.push([att.name, att.id, att.attune, mean(ds).toFixed(3), median(ds).toFixed(2),
      (100 * ds.filter((d) => d > 0.001).length / ds.length).toFixed(0) + '%']);
  }
  rows.sort((a2, b2) => Number(b2[3]) - Number(a2[3]));
  out.push(table(['one step', 'id', 'axis', 'mean Δdepth', 'median Δ', 'helped'], rows, { left: [0, 1, 2] }));

  /* THE RACE ITSELF, which is the claim the design makes and the only thing
   * that says whether attunements answer the problem they were built for.
   *
   * A rank converges: stack one for ever and it is worth 2.50 of itself. The
   * wave budget does not converge. So the question is not "is one attunement
   * strong" — it is whether taking one every boss wave GROWS LIKE THE BUDGET
   * GROWS. Both sides are computed here at the same waves: the budget from
   * `budgetFor`, and the player's own multiplier from applying k steps to a
   * real player and reading the field back. A ranked card is shown beside it
   * at its own cap, which is the comparison that makes the point. */
  out.push('');
  out.push('  THE RACE — one attunement per boss wave, against the PRESSURE it is racing:');
  out.push('');
  /* AGAINST RAW DPS, NOT AGAINST THE BUDGET. The budget is a currency the
   * director spends; what actually kills the player is what the wave puts on
   * them per second, and the two differ by a lot because each extra unit of
   * budget buys less dps than the last (the compositions get tankier, not
   * only bigger). Measured over the first twenty waves: budget 23.1× against
   * dps 15.8×. Racing the budget would overstate the pressure by half. */
  const dpsAt = (w) => compositionPool(cfg.level, w).map((q) => q.reduce((sum, e) => {
    const bp = boltPressure(e, DIFFICULTY.knight);
    if (bp) return sum + bp.boltsPerSec * bp.pHitStill * bp.damage;
    const mp = meleePressure(e, 'knight', 'ataru');
    return sum + (mp ? mp.strikesPerSec * mp.connect * mp.damage : 0);
  }, 0)).reduce((a2, b2) => a2 + b2, 0) / Math.max(1, compositionPool(cfg.level, w).length);
  const raceRows = [];
  const d0 = dpsAt(1);
  for (const w of [5, 10, 20, 40, 60, 100]) {
    const k = Math.floor(w / BOSS_EVERY);
    const q = makePlayer('knight');
    const att = ATTUNEMENTS[0];
    for (let i = 0; i < k; i++) att.apply(q, 1);        // attunements IGNORE the rank scale
    const cut = q.boonMods.cutPower;
    raceRows.push([String(w), String(k), dpsAt(w).toFixed(1), (dpsAt(w) / d0).toFixed(2) + '×',
      cut.toFixed(2) + '×', (cut / (dpsAt(w) / d0)).toFixed(3)]);
  }
  out.push(table(['wave', 'attunements', 'raw dps', 'dps/w1', 'player cut', 'ratio'], raceRows));
  out.push('');
  out.push('  WHAT THIS SAYS, and it corrects a claim the design comment in Waves.js made.');
  out.push('  That comment reads "1.12^20 by wave 100 is 9.6×, which is the same order as');
  out.push('  the ramp it is racing" — but 20 attunements is wave 100 and the ramp figures');
  out.push('  it cites are over 20 WAVES. At wave 100 the pressure is far past 9.6×, so');
  out.push('  attunements alone do NOT keep pace and were never going to: cards, ranks,');
  out.push('  skill and a blade that cuts anything carry most of it. What attunements');
  out.push('  actually provide is growth that is UNBOUNDED and MONOTONE where a rank');
  out.push('  converges at 2.50× — so the reward half of the loop never goes quiet, which');
  out.push('  is a different property and the one worth pinning.');

  /* Only the axes this model can SEE, on the same rule boonReport uses: a
   * declared channel or a measured difference. `attune-force` moves forceCost
   * and forceRegen and this harness has no Force powers in it, so it reads a
   * true 0.000 — dividing by it printed a 643,816,600× spread, which is a
   * harness gap wearing the costume of a balance finding. */
  const seenAxes = [...byAxis.entries()].filter(([, v]) => Math.abs(v) > 1e-9);
  const blind = [...byAxis.entries()].filter(([, v]) => Math.abs(v) <= 1e-9).map(([k]) => k);
  const vals = seenAxes.map(([, v]) => v);
  out.push('');
  if (vals.length) {
    out.push(`  spread across the ${vals.length} axes this model can see: `
      + `${Math.min(...vals).toFixed(3)} … ${Math.max(...vals).toFixed(3)}`
      + `  (${(Math.max(...vals) / Math.min(...vals)).toFixed(1)}× worst to best)`);
  }
  if (blind.length) out.push(`  UNMODELLED here (no Force powers in this harness): ${blind.join(', ')}`);
  return { text: out.join('\n'), byAxis };
}

export function boonReport(cfg) {
  const out = [];
  out.push('');
  out.push('══ BOONS — paired, same seed, same run, one takes it and one does not ══');
  out.push('');
  out.push('  Control: a run that takes NOTHING. Treatment: the identical run, granted');
  out.push('  exactly this boon at the wave-3 draft and nothing else, ever. Δ is the');
  out.push('  paired difference in MODEL-DEPTH, so run-to-run noise cancels.');
  out.push('  Synergy is NOT measured — this is each boon alone.');
  const rows = [];
  const ladder = cfg.sigma != null ? [{ name: 'custom', sigma: cfg.sigma }] : MODEL.skillLadder;
  const perBoon = new Map();

  for (const boon of BOONS) {
    const chans = boonChannels(boon);
    const deltas = [], perSkill = {};
    for (const skill of ladder) {
      const ds = [];
      for (const dk of cfg.boonTiers) {
        for (let s = 0; s < cfg.boonRuns; s++) {
          const seed = 7000 + s * 13;
          const a = simulateRun({ difficulty: dk, level: cfg.level, seed, sigma: skill.sigma, boonPolicy: () => null });
          const b = simulateRun({ difficulty: dk, level: cfg.level, seed, sigma: skill.sigma, boonPolicy: (o, w) => (w === 3 ? boon : null) });
          ds.push(b.depth - a.depth);
        }
      }
      perSkill[skill.name] = mean(ds);
      deltas.push(...ds);
    }
    const m = mean(deltas);
    /**
     * A THIRD STATE, because two was a lie.
     *
     * `boonChannels` decides "modelled" by DECLARATION — it diffs the keys in
     * MODELLED_CHANNELS and MODELLED_HOOKS and reports what moved. A card that
     * works some other way therefore printed UNMODELLED, "this harness has no
     * Force powers / jumps / cosmetics", even when the paired runs beside it
     * had just measured a real effect. Aegis came out at Δ1.008, fourth of
     * thirty-nine, 50% helped and 0% hurt, and was filed under "cannot see it"
     * — and excluded from the median and from the dominant/weakest line with it.
     *
     * The paired runs are same-seed and differ in exactly one thing, so they
     * are deterministic: if ANY of them differed, the simulation saw the card.
     * That is evidence, and evidence outranks the declaration. Such a card is
     * MEASURED, and the fact that no declared channel names it is a gap in the
     * channel list — reported as one rather than as a property of the card.
     */
    const seen = deltas.some((d) => d !== 0);
    const label = chans.length ? chans.join('+') : (seen ? 'measured, unnamed' : 'UNMODELLED');
    perBoon.set(boon.id, { mean: m, deltas, chans, perSkill, seen, named: !!chans.length });
    rows.push([boon.name, boon.id, label,
      m.toFixed(3), median(deltas).toFixed(2),
      (100 * deltas.filter(d => d > 0.001).length / deltas.length).toFixed(0) + '%',
      (100 * deltas.filter(d => d < -0.001).length / deltas.length).toFixed(0) + '%']);
  }
  rows.sort((a, b) => Number(b[3]) - Number(a[3]));
  out.push('');
  out.push(table(['boon', 'id', 'channel in this model', 'mean Δdepth', 'median Δ', 'helped', 'hurt'], rows, { left: [0, 1, 2] }));

  // Everything the simulation actually SAW, named or not — see the note above.
  const modelled = [...perBoon.entries()].filter(([, v]) => v.chans.length || v.seen);
  const med = median(modelled.map(([, v]) => v.mean));
  const top = modelled.slice().sort((a, b) => b[1].mean - a[1].mean)[0];
  const bottom = modelled.slice().sort((a, b) => a[1].mean - b[1].mean)[0];
  out.push('');
  out.push(`  median modelled boon: Δ${med.toFixed(3)}   dominant: ${top[0]} (Δ${top[1].mean.toFixed(3)}, ${(top[1].mean / (med || 1e-9)).toFixed(1)}× median)`);
  out.push(`  weakest modelled:     ${bottom[0]} (Δ${bottom[1].mean.toFixed(3)})`);
  const unmodelled = [...perBoon.entries()].filter(([, v]) => !v.chans.length && !v.seen).map(([k]) => k);
  out.push(`  UNMODELLED (this harness has no Force powers / jumps / cosmetics): ${unmodelled.join(', ')}`);
  // The gap, stated as a gap. These moved the run and no declared channel
  // names them, which is a hole in MODELLED_CHANNELS/MODELLED_HOOKS rather
  // than anything about the cards.
  const unnamed = [...perBoon.entries()].filter(([, v]) => !v.chans.length && v.seen);
  if (unnamed.length) {
    out.push(`  MEASURED BUT UNNAMED (a gap in this file's channel list, not in the card): `
      + unnamed.map(([k, v]) => `${k} Δ${v.mean.toFixed(3)}`).join(', '));
  }
  _rank = new Map([...perBoon].map(([k, v]) => [k, v.mean]));
  return { text: out.join('\n'), perBoon, median: med };
}

export function rampReport(cfg) {
  const out = [];
  out.push('');
  out.push('══ THE RAMP — where the budget outruns the player ══════════════════════');
  out.push('');
  const rows = [];
  let prev = 0, prevD = null;
  for (let w = 1; w <= 20; w++) {
    const b = budgetFor(w);
    const pool = compositionPool(cfg.level, w);
    const counts = pool.map(q => q.length);
    const threat = pool.map(q => q.reduce((s, e) => s + spawnCost(e), 0));
    const hpSum = pool.map(q => q.reduce((s, e) => s + archetypeOf(e).A.hp, 0));
    const elites = pool.map(q => q.filter(e => spawnMod(e)).length);
    const dps = pool.map(q => q.reduce((s, e) => {
      const bp = boltPressure(e, DIFFICULTY.knight);
      if (bp) return s + bp.boltsPerSec * bp.pHitStill * bp.damage;
      const mp = meleePressure(e, 'knight', 'ataru');
      return s + (mp ? mp.strikesPerSec * mp.connect * mp.damage : 0);
    }, 0));
    const d = b - prev;
    rows.push([w, b, d, prevD === null ? '' : (d - prevD).toFixed(0),
      mean(counts).toFixed(1), mean(elites).toFixed(1), mean(threat).toFixed(1),
      mean(hpSum).toFixed(0), mean(dps).toFixed(1),
      new WaveDirector(_stubWorld, { pool: (LEVELS[cfg.level] || LEVELS[LEVEL_ORDER[0]]).pool })
        .unlockedAt(w).filter((x, i, a) => a.indexOf(x) === i).join(' ')]);
    prevD = d; prev = b;
  }
  out.push(table(['wave', 'budget', 'Δ', 'Δ²', 'enemies', 'elites', 'threat', 'total hp', 'raw dps @Knight', 'unlocked'], rows, { left: [9] }));
  out.push('');
  out.push('  "raw dps" is what the whole wave puts on an undefended player at Knight:');
  out.push('  bolts/s × chance-of-hitting × damage, before any deflection at all.');
  out.push('  The player does NOT grow with it — hp is a flat 100 and the blade a flat');
  out.push('  11.2 m/s, so every column here is the ramp and none of it is answered by');
  out.push('  anything except the guard and at most ten boons in thirty waves.');
  return { text: out.join('\n'), rows };
}

export function offenceReport() {
  const out = [];
  out.push('');
  out.push('══ THE BLADE — measured against real bodies ════════════════════════════');
  out.push('');
  const s = measureSwing();
  out.push(`  MEASURED off the real controller: one authored overhead attack peaks the`);
  out.push(`  tip at ${s.peak.toFixed(2)} m/s, tops out ${s.reachHeight.toFixed(2)} m above the feet, and may be repeated at`);
  out.push(`  most ${s.attacksPerSec.toFixed(2)} times a second (OVERHEAD.cooldown). Graded against Combat's own`);
  out.push(`  gates, that trace answers ${(100 * s.grade.block).toFixed(0)}% BLOCK, ${(100 * s.grade.deflect).toFixed(0)}% DEFLECT, ${(100 * s.grade.return).toFixed(0)}% RETURN, ${(100 * s.grade.perfect).toFixed(0)}% PERFECT`);
  out.push(`  BY SPEED ALONE, against SPEED_GRADE (${SPEED_GRADE.driven}/${SPEED_GRADE.return}/${SPEED_GRADE.perfect} m/s).`);
  out.push('');
  out.push(`  READ THAT LAST COLUMN CAREFULLY. It is the share of the swing fast enough`);
  out.push(`  for a PERFECT, not the share that earns one: gradeCaught also demands`);
  out.push(`  closing > ${SPEED_GRADE.perfectClosing} and bladeT > ${SPEED_GRADE.perfectBladeT}, and this trace has no bolt to close on. The`);
  out.push(`  bladeT term is the sharp one — bladeSpeed is speedAt(bladeT), a lerp from a`);
  out.push(`  near-still base out to the tip, so ${SPEED_GRADE.perfect} m/s at bladeT ${SPEED_GRADE.perfectBladeT} needs a tip well`);
  out.push(`  past the ${s.peak.toFixed(1)} m/s this swing can reach. In practice a PERFECT means the top`);
  out.push(`  ~15% of the blade, at the top of the swing, driving into the bolt.`);
  out.push('');
  out.push(`  That PERFECT can read HIGHER than RETURN here is real and not a bug: the`);
  out.push(`  swing plateaus near its peak, so the [${SPEED_GRADE.return}, ${SPEED_GRADE.perfect}) band is genuinely narrower`);
  out.push(`  in time than the band above it. Speed is not what separates the top two`);
  out.push(`  rungs — aim is. Speed only decides whether the rung exists, and until`);
  out.push(`  SPEED_GRADE.perfect came down off 15 (1.37x a speed the blade cannot`);
  out.push(`  reach) it did not.`);
  out.push('');
  out.push('  Reach is tested against the body\'s REST POSE, so it is an approximation of');
  out.push('  a moving fight; the bones it admits and refuses are the game\'s own.');
  out.push('');
  const mods = modsOf(makePlayer());
  const rows = [];
  for (const [type, A] of Object.entries(ARCHETYPES)) {
    if (A.training || !BUILDERS[type]) continue;
    const e = engagementFor(type, mods);
    rows.push([type, A.hp, A.threat, e.via, e.passes,
      isFinite(e.tNeutralise) ? e.tNeutralise.toFixed(2) : '—',
      isFinite(e.tKill) ? e.tKill.toFixed(2) : '—',
      closeTime(type, mods).toFixed(1)]);
  }
  // …and every elite the director can actually field, because an elite is a
  // different thing to fight and the threat surcharge is a claim about that.
  for (const key of Object.keys(MODIFIERS)) {
    for (const type of Object.keys(ARCHETYPES)) {
      const A = ARCHETYPES[type];
      if (A.training || !BUILDERS[type] || !MODIFIERS[key].allow(A)) continue;
      const entry = `${type}|${key}`;
      const e = engagementFor(entry, mods);
      const EA = archetypeOf(entry).A;
      rows.push([entry, Math.round(EA.hp), EA.threat.toFixed(1), e.via, e.passes,
        isFinite(e.tNeutralise) ? e.tNeutralise.toFixed(2) : '—',
        isFinite(e.tKill) ? e.tKill.toFixed(2) : '—',
        closeTime(entry, mods).toFixed(1)]);
      break;   // one representative per modifier keeps the table readable
    }
  }
  out.push(table(['archetype', 'hp', 'threat', 'blade opens on', 'passes', 'stop (s)', 'kill (s)', 'walk (s)'], rows, { left: [0, 3] }));
  out.push('');
  out.push('  "stop" is when it can no longer hurt you — dead, toppled by a severed leg,');
  out.push('  or disarmed by a severed arm. Those are real Enemy behaviours and they are');
  out.push('  most of what the blade is for; a model that only knew hp would miss them.');
  out.push('');
  const drows = [];
  for (const dk of DIFF_KEYS) {
    const d = DIFFICULTY[dk];
    drows.push([d.name, (zoneTolerance(d.assist) * 180 / Math.PI).toFixed(1) + '°',
      ...MODEL.skillLadder.map(sk => (100 * answerRate(d, sk.sigma)).toFixed(0) + '%'),
      d.damageTaken, d.fireRate, d.enemyAggression, d.enemyAccuracy]);
  }
  out.push(table(['tier', 'guard zone', ...MODEL.skillLadder.map(s => s.name), 'dmg taken', 'fire', 'aggr', 'acc'], drows, { left: [0] }));
  return out.join('\n');
}

export function deadKnobReport() {
  const out = [];
  const cols = Object.keys(DIFFICULTY.knight).filter(k => typeof DIFFICULTY.knight[k] === 'number');
  out.push('');
  out.push('══ DIFFICULTY COLUMNS THAT NOTHING READS ══════════════════════════════');
  out.push('');
  out.push(`  ${cols.length} numeric columns. ${DEAD_DIFFICULTY_COLUMNS.length} of them have no reader anywhere in src/:`);
  out.push(`    ${DEAD_DIFFICULTY_COLUMNS.join(', ')}`);
  out.push('  A tier is a promise about the fight. A column of that promise with no');
  out.push('  reader is the same lie as a checkbox with no onChange: the four tiers');
  out.push('  differ on paper and are identical in the code for that column.');
  return out.join('\n');
}

/**
 * Known-dead columns of DIFFICULTY, as a ratchet. Both were verified by
 * grepping src/ for `.deflectWindow` and `.chamberWindow` — the only hit for
 * the latter is `F.chamberWindow` off a Duel FORM, not off a tier. This list is
 * meant to SHRINK. tools/checks/balance.mjs fails if it grows.
 */
export const DEAD_DIFFICULTY_COLUMNS = ['deflectWindow', 'chamberWindow'];

/* ══════════════════════════════════════════════════════════════════════════
 *  CLI
 * ══════════════════════════════════════════════════════════════════════════ */

function parseArgs(argv) {
  const cfg = {
    runs: 40, boonRuns: 14, level: LEVEL_ORDER[0], sigma: null,
    boonTiers: ['knight', 'master'],
    only: null,
  };
  for (const a of argv) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'runs') cfg.runs = Math.max(1, parseInt(v, 10));
    else if (k === 'boonruns') cfg.boonRuns = Math.max(1, parseInt(v, 10));
    else if (k === 'level') cfg.level = v;
    else if (k === 'skill') cfg.sigma = parseFloat(v);
    else if (k === 'waves') MODEL.maxWave = Math.max(1, parseInt(v, 10));
    else if (k === 'only') cfg.only = v.split(',');
    else if (k === 'hit') MODEL.swingHit = clamp(parseFloat(v), 0.05, 1);
    else if (k === 'los') MODEL.lineOfSight = clamp(parseFloat(v), 0.05, 1);
    else if (k === 'reaction') MODEL.reactionExponent = clamp(parseFloat(v), 0, 2);
    else if (k === 'tiers') cfg.boonTiers = v.split(',');
  }
  return cfg;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const want = (s) => !cfg.only || cfg.only.includes(s);
  const t0 = Date.now();

  console.log('');
  console.log('  SABER — BALANCE. Every depth below is MODEL-DEPTH under one fixed');
  console.log('  model of a player (see the header of tools/balance.mjs). Compare the');
  console.log('  rows to each other; do not read a row as a prediction about a human.');

  if (want('blade')) console.log(offenceReport());
  if (want('ramp')) console.log(rampReport(cfg).text);
  // The boon ranking runs first when survival is also wanted, so the survival
  // runs can draft greedily by a ranking this file computed rather than by
  // "whatever was first in the array".
  if (want('boons')) console.log(boonReport(cfg).text);
  if (want('ranks')) console.log(rankReport(cfg).text);
  if (want('attune')) console.log(attunementReport(cfg).text);
  if (want('survival')) console.log(survivalReport(cfg).text);
  if (want('knobs')) console.log(deadKnobReport());

  console.log('');
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('');
}

const isMain = process.argv[1] && (await import('node:url')).pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await main();
