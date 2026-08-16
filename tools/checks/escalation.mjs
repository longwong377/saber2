/**
 * BATTLEFRONT BORZ — escalation: elite modifiers, the boon draft, and the ramp.
 *
 * The complaint these exist for is one sentence: "wave 25 is wave 10 with more
 * bodies". Three things were true and all three were measurable.
 *
 *   ONE NUMBER OF DIFFICULTY. `budgetFor` and a fixed unlock ladder that stops
 *   at wave 12, so past there the ONLY thing depth changed was the count. A
 *   wave-20 trooper was a wave-2 trooper.
 *
 *   TEN CARDS A RUN. Sixteen boons, three at a time, every third wave: a
 *   thirty-wave run took five eighths of the whole system, so two runs ended up
 *   holding nearly the same hand.
 *
 *   A BOSS LADDER THAT RAN OUT. `bossWaves` was a literal Set ending at 30, in
 *   a mode whose menu entry says "endless escalation".
 *
 * Everything below is arithmetic against the shipping tables, not opinion, and
 * every check is written to fail on the code it replaces rather than to fail to
 * load: the module namespaces are imported whole, so a missing export shows up
 * as the one assertion that names it instead of as a suite that never ran.
 *
 * The pricing check is the important one. A modifier that is not paid for out
 * of the wave budget is not a difficulty feature, it is a difficulty bug — an
 * "elite wave" that is quietly three times the intended threat. So the budget
 * accounting is asserted exactly, and the PRESSURE each modifier adds is
 * modelled and compared against what the director charges for it.
 */

import * as THREE from 'three';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import * as Waves from '../../src/game/Waves.js';
import * as Foe from '../../src/game/Enemy.js';
import { Player } from '../../src/game/Player.js';
import { TOUGHNESS } from '../../src/game/Combat.js';
import { TAU } from '../../src/engine/MathUtil.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const { ARCHETYPES } = Foe;

/* ── fixtures ────────────────────────────────────────────────────────── */

const flatGround = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand', crater() {}, flush() {},
});

/** A world wide enough for a real Enemy, its rig, its ragdoll and its elite kit. */
function gameWorld() {
  const physics = new RapierWorld({ gravity: -24 });
  physics.terrain = flatGround();
  return {
    scene: new THREE.Scene(), physics, terrain: physics.terrain,
    difficulty: null, hpScale: 1, dmgScale: 1, players: [], enemies: [],
    settings: {}, engine: { flash() {}, setRadial() {} },
    particles: null, booms: 0,
    addHitstop() {}, report() {}, notify() {}, notifyFloating() {},
    onExplosion() { this.booms++; }, onLimbSevered() {}, onEnemyKilled() {},
    onHitmark() {}, spawnDebrisGroup() {},
  };
}

/** The director's stub world — no bodies, just the tables. */
const tableWorld = () => ({ enemies: [], difficulty: null, takenBoons: new Set(), players: [] });

/**
 * THE FIXTURE POOL IS A SHIPPED ONE, AND IT WAS NOT.
 *
 * This was `['b1','b1','b1','trooper','b2','sniper','droideka','acolyte',
 * 'walker','beast']` — a hand-written roster that **no level in the game
 * fields**: nothing shipped declares both `walker` and `beast`, and the three
 * B1s opened it cheaper than any real pool. So every bound in this file was
 * calibrated against a level that does not exist, and when the same assertions
 * were re-run against the real ten, three of them failed — including
 * `DEFAULT_SETTINGS.level`, the level a new player starts on. HANDOFF §2.3:
 * a hand-maintained table beside its generated twin, with the sibling check
 * three entries down already enumerating the real ten.
 *
 * `FIELD` names one shipped level and `run()` asserts it exists, exactly as
 * `cloth-cost.mjs` had to after the roster cull. The Ember Shelf is the one
 * named because it is `DEFAULT_SETTINGS.level` — the fixture and the game's own
 * default are now the same fight — and the checks that are about the SHAPE of a
 * run enumerate `LEVEL_ORDER` instead of trusting any single pool.
 */
const FIELD = 'scoria';
let FULL_POOL = null;
const director = (opts = {}) => new Waves.WaveDirector(tableWorld(), { mode: 'roguelite', pool: FULL_POOL, ...opts });

/** One update, so the rig is posed exactly as it is in game. */
function settle(e, world, frames = 1) {
  for (let i = 0; i < frames; i++) {
    e.update(1 / 60, {
      time: i / 60, dt: 1 / 60, players: world.players, enemies: world.enemies,
      physics: world.physics, terrain: world.terrain, particles: null, bolts: null,
      camera: { position: V(0, 1.6, 3) }, pickTarget: () => world.players[0] || null,
    });
  }
}

function spawn(world, type, mod) {
  const e = new Foe.Enemy(world, type, V(0, 0, 0));
  world.enemies.push(e);
  if (mod) Foe.applyModifier(e, mod);
  return e;
}

const isElite = (entry) => String(entry).includes('|');

/* ── the pressure model, for pricing ─────────────────────────────────── */

/**
 * What one body costs the player, as offence × endurance.
 *
 * Deliberately crude and deliberately WRITTEN DOWN: it is a yardstick for
 * comparing an elite against the body it was promoted from, not a simulation.
 * tools/balance.mjs is the simulation. What this is for is the one question a
 * yardstick can answer — is the director charging less for a body than the body
 * is worth — and the answer to that only has to be right to within a factor.
 */
function offence(A) {
  if (A.inert) return 0;
  if (A.ranged) {
    const cycle = (A.fireRate ?? 2) + (A.burst ?? 1) * (A.burstGap ?? 0.12) + (A.telegraph ?? 0);
    const acc = 1 / (1 + (A.spread ?? 0.06) * 26);      // a tight group lands far more of them
    return ((A.burst ?? 1) / cycle) * A.damage * acc;
  }
  return A.damage / 2.2;                                 // one authored attack every ~2.2 s
}
function endurance(A, mod) {
  let hp = A.hp;
  // A bubble costs the blade ONE pass — takeCut drops it whole — so only a
  // quarter of the pool counts against a player who is holding a lightsaber.
  if (mod === 'shielded') hp += Math.min(Math.max(A.hp * 1.6, 90), 300) * 0.25;
  if (A.armorPlus) hp *= 1.6;                            // durasteel torso: the fast route is gone
  else if (A.armored) hp *= 1.15;
  return hp;
}
const pressure = (A, mod) => offence(A) * endurance(A, mod);

/** The archetype a promotion produces, without needing a scene to build one. */
function eliteArchetype(type, mod) {
  const base = ARCHETYPES[type];
  const M = Foe.MODIFIERS[mod];
  const A = { ...base };
  for (const [k, v] of Object.entries(M.scale || {})) if (typeof A[k] === 'number') A[k] *= v;
  Object.assign(A, M.set || {});
  A.threat = Foe.modifierThreat(type, mod);
  return A;
}

/* ── a player-shaped thing the technique layer can install on ────────── */

/**
 * NOT `Object.create(Player.prototype)` with the real update called through.
 *
 * The technique layer wraps `update` and `damage`; what has to be tested is
 * what the wrappers DO, and calling the shipping `Player.update` needs a
 * renderer, an input device and a level. So the seams are stubbed and the fact
 * that the real ones still exist is asserted separately — rename either on
 * Player and the seam check below fails, exactly as controls.mjs pins
 * `_updateThrow` for Cleaving Throw.
 */
function driven(over = {}) {
  const p = {
    world: null,
    hp: 100, maxHp: 100, stamina: 100, maxStamina: 100, force: 100, maxForce: 100,
    flow: 0, invuln: 0, riposteTimer: 0, staggerTimer: 0, combo: 0,
    kills: 0, deflects: 0, limbsRemoved: 0, position: V(0, 0, 0),
    boons: new Set(), control: { deadzone: 0.24, sensitivity: 1 },
    saber: { bladeLength: 1.15, coreWidth: 1 },
    boonMods: {
      deflectDamage: 1, cutPower: 1, forceCost: 1, staminaRegen: 1, moveSpeed: 1,
      jumpPower: 1, flowGain: 1, returnCone: 0.42, healOnKill: 0, lightning: false,
      repulse: false, throwPierce: false, doubleJump: false, lifesteal: 0,
    },
    hits: [],
    update() {},
    damage(amount) { this.hits.push(amount); this.hp -= amount; return this.hp <= 0; },
    heal(v) { this.hp = Math.min(this.maxHp, this.hp + v); },
    ...over,
  };
  p.world = p.world || { enemies: [], players: [p], difficulty: null, notify() {}, engine: { flash() {} } };
  return p;
}

const takeBoon = (p, id) => {
  const b = Waves.BOONS.find(x => x.id === id);
  if (!b) throw new Error(`no boon "${id}" in BOONS`);
  p.boons.add(id);
  b.apply(p);
  return b;
};

export async function run({ check, assert }) {
  /**
   * Loaded before the first `check`, because the synchronous ones call
   * `director()` the moment they are declared. Levels.js is where seventeen of
   * the thirty-one archetypes are REGISTERED — a probe that skips it sees a
   * different game (see the note in the stranding check below).
   */
  const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
  if (!LEVELS[FIELD]) {
    throw new Error(`escalation.mjs stands its subjects on "${FIELD}" and no such level exists — `
      + `World.loadLevel would silently substitute ${LEVEL_ORDER[0]} and every bound in this `
      + 'file would be measured against a place it does not name (HANDOFF §2.6)');
  }
  FULL_POOL = LEVELS[FIELD].pool;

  check('escalation: a deeper wave is a harder wave, not just a bigger one', async () => {
    /**
     * WHAT THE OLD CURVE DID, measured on the Colosseum through this director:
     *
     *     wave   bodies   threat/body   heavy   share
     *       5       8        3.25        1/1    12.5%
     *      20      30        4.20        3/3    10.0%
     *      40      76        4.13        5/5     6.6%
     *
     * Threat-per-body never moves — 3.0 to 4.3 at every wave measured — so the
     * whole of the escalation past wave 12 was body count. And `heavyLimit` was
     * `1 + floor(wave / 10)`, linear against a body count that is not, so the
     * SHARE of interesting bodies halved across a run. Wave 40 was wave 12 with
     * four times the crowd: more of the same input rather than a new question.
     *
     * The property asserted is the one that was false — the heavy share must
     * not collapse as the run deepens. It is a RATIO rather than a count, so it
     * survives any retuning of the budget curve, and the bar is deliberately
     * loose: this is a floor under a collapse, not a pin on a tuning number.
     */
    const { LEVELS } = await import('../../src/game/Levels.js');
    const stub = { enemies: [], players: [], settings: {}, takenBoons: new Set(), scene: null };
    const d = new Waves.WaveDirector(stub, { pool: LEVELS.colosseum.pool });
    Waves.seedWaves(99);

    /**
     * OVER MANY ROLLS, NOT ONE — and this is not a loosening.
     *
     * It used to compose exactly one wave per depth and let that single roll
     * decide a RATIO, which was fragile from the day it was written and became
     * wrong the moment wave conditions shipped: `CONDITIONS.fusillade` narrows
     * a wave to the shooters, the Colosseum's four shooters are all light, and
     * one such roll at wave 40 reported a 1.3% heavy share. That is the
     * condition working correctly, and a check that fails on it is measuring
     * the draw rather than the property. The property is about the SHAPE OF THE
     * RUN, so it is measured over a run's worth of waves.
     */
    const rows = [];
    for (const w of [5, 10, 20, 30, 40]) {
      let bodies = 0, heavy = 0, threat = 0;
      const n = 25;
      for (let i = 0; i < n; i++) {
        d.start(w);
        const q = d.spawnQueue.map((e) => String(e).split('|')[0]);
        bodies += q.length;
        heavy += q.filter((t) => Waves.isHeavy(t)).length;
        threat += q.reduce((a, t) => a + (Foe.ARCHETYPES[t]?.threat ?? 0), 0);
      }
      rows.push({ w, bodies: bodies / n, heavy: heavy / n, share: heavy / Math.max(1, bodies),
        perBody: threat / Math.max(1, bodies) });
    }
    const early = rows[0], late = rows[rows.length - 1];
    /**
     * THE GUARD IS ON THE WAVE'S WEIGHT, NOT ON ITS LENGTH.
     *
     * This asked for three times the BODIES, and it was a proxy for "the run is
     * deepening at all" written when the count was the only thing depth bought
     * — which is the defect the rest of this file exists to remove. Once
     * `bodyCap` began to bind (see BODY_COUNT_SHARE), the Colosseum's wave 40
     * became eighteen bodies at 11.7 threat each where it had been seventy-six
     * at 4.1, and the guard failed on a wave that is three times the fight.
     *
     * Total threat is what the budget actually promises and it is strictly
     * stronger: a wave can be longer without being heavier, and it cannot be
     * heavier without having grown. Per-body threat is asserted beside it so
     * "heavier" cannot be satisfied by length alone either.
     */
    const weight = (r) => r.bodies * r.perBody;
    assert(weight(late) > weight(early) * 3,
      `wave ${late.w} weighs ${weight(late).toFixed(0)} threat against wave ${early.w}'s `
      + `${weight(early).toFixed(0)} — the run is not deepening at all and the rest of this `
      + 'check means nothing');
    assert(late.perBody > early.perBody * 1.5,
      `wave ${late.w} fields ${late.perBody.toFixed(1)} threat per body against wave ${early.w}'s `
      + `${early.perBody.toFixed(1)} — the wave got longer and not harder`);
    assert(late.share > early.share * 0.75,
      `the heavy share falls from ${(early.share * 100).toFixed(1)}% at wave ${early.w} to `
      + `${(late.share * 100).toFixed(1)}% at wave ${late.w} — the deep waves are proportionally `
      + 'MORE trash than the shallow ones, so depth buys quantity and nothing else');
    // …and the cap that bounds it is a frame-rate number, not a difficulty one.
    assert(Waves.HEAVY_CAP > 0, 'the heavy ceiling is gone — a deep wave can ask for any number of walkers');
    return rows.map((r) => `w${r.w} ${r.bodies}b ${(r.share * 100).toFixed(0)}% heavy `
      + `${r.perBody.toFixed(1)}/body`).join(' · ');
  });

  check('pools: a level fights with what it declares, and its repeats are weights', async () => {
    /**
     * TWO DEFECTS IN ONE PLACE, both of the shape this codebase keeps finding:
     * a hand-authored table beside a consumer that ignored it.
     *
     * `unlockedAt` opened with a hand-written ladder of seven names. Anything a
     * level's pool declared that was not on it, and did not carry its own
     * `unlockAt`, could never enter an ordinary wave — it was reachable only
     * through `_setPiece`, on a boss wave. That silently killed `beast` on the
     * Colosseum (a level whose whole premise is exotic creatures), `bodyguard`
     * on the Warship and `master` on the Temple. Measured through the shipped
     * method at wave 20: colosseum returned 8 distinct of a 10-entry pool,
     * warship 4 of 9, temple 6 of 9.
     *
     * And a pool's REPEATS did nothing. `_pickType` sums a weight per entry, so
     * a type listed twice is drawn twice as often — the ladder uses exactly
     * that trick itself. But the pool was only ever a membership FILTER, so
     * the Ember Shelf's three `acolyte` entries never reached the array being weighed.
     * Six of the thirteen levels resolved to the same six archetypes and
     * produced byte-identical twenty-wave runs.
     *
     * Both halves are asserted against the SHIPPED `unlockedAt`, never against
     * a restatement of it. That matters here more than usual: the instrument
     * that found this had reimplemented `isDraftWave` instead of calling it,
     * and manufactured a defect that did not exist.
     */
    const { LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const stub = { enemies: [], players: [], settings: {}, takenBoons: new Set(), scene: null };
    const dirFor = (k) => new Waves.WaveDirector(stub, { pool: LEVELS[k].pool });

    const unreachable = [], unweighted = [];
    const sets = new Map();
    for (const k of LEVEL_ORDER) {
      const pool = LEVELS[k].pool ?? [];
      if (!pool.length) continue;
      const d = dirFor(k);
      // Deep enough that every derived depth has come due.
      const got = d.unlockedAt(40);

      // 1. everything the level declares can arrive, unless it says otherwise
      for (const t of new Set(pool)) {
        const A = Foe.ARCHETYPES[t];
        if (!A || A.setPieceOnly) continue;
        if (!got.includes(t)) unreachable.push(`${k}:${t}`);
      }
      // 2. and a repeat is worth more than a single mention
      for (const t of new Set(pool)) {
        const inPool = pool.filter((x) => x === t).length;
        if (inPool < 2 || !got.includes(t)) continue;
        if (got.filter((x) => x === t).length < 2) unweighted.push(`${k}:${t}x${inPool}`);
      }
      sets.set(k, got.slice().sort().join(' '));
    }

    assert(!unreachable.length,
      `a level declares a body it can never field in an ordinary wave: ${unreachable.join(', ')} — `
      + 'reachable only as a boss set-piece, which is not what naming it in the pool means');
    assert(!unweighted.length,
      `a pool repeats a body and the composer draws it once: ${unweighted.join(', ')} — `
      + '_pickType weighs per entry, so a repeat is the level author asking for more of it');

    /* …and the levels are therefore not each other. Compared on the WEIGHTED
     * list, because six of them genuinely name the same six archetypes and it
     * is the weighting that makes them different fights. */
    const byShape = new Map();
    for (const [k, sig] of sets) byShape.set(sig, [...(byShape.get(sig) ?? []), k]);
    const clones = [...byShape.values()].filter((g) => g.length > 1);
    assert(!clones.length,
      `levels compose identically: ${clones.map((g) => g.join('=')).join('; ')} — `
      + 'same bodies at the same weights is one level with several skyboxes');
    return `${sets.size} levels, ${byShape.size} distinct compositions, every pool entry reachable and every repeat weighted`;
  });
  await initPhysics();

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1. The budget still means something                               */
  /* ══════════════════════════════════════════════════════════════════ */

  check('escalation: an elite wave costs exactly what a plain wave costs', () => {
    assert(typeof Waves.spawnCost === 'function' && typeof Waves.spawnMod === 'function',
      'Waves exports no spawnCost/spawnMod — a queue of bare archetype names cannot price an elite, '
      + 'so every modifier on it is threat the director never paid for');
    const d = director();
    let worstOver = 0, worstUnder = 1, elites = 0, checked = 0, conditioned = 0;
    for (let w = 1; w <= 40; w++) {
      const budget = d.budgetFor(w);
      for (let i = 0; i < 25; i++) {
        d.wave = w; d._compose();
        let spent = 0;
        for (const entry of d.spawnQueue) {
          const cost = Waves.spawnCost(entry);
          const mod = Waves.spawnMod(entry);
          if (mod) {
            elites++;
            assert(Math.abs(cost - Foe.modifierThreat(Waves.spawnType(entry), mod)) < 1e-9,
              `"${entry}" is queued at ${cost} and priced at ${Foe.modifierThreat(Waves.spawnType(entry), mod)}`);
          }
          spent += cost;
        }
        /**
         * …AND WHAT THE WAVE'S CONDITIONS COST, which is the same argument the
         * modifiers make one paragraph up. A condition that is not paid for out
         * of the wave budget is not a difficulty feature, it is a difficulty
         * bug: ALL AT ONCE would be a wave of the ordinary size delivered in a
         * fifth of the time, which is not the same wave asked differently, it
         * is a wave that is secretly 30% over the ramp.
         *
         * Charged through the director's own `conditionCost`, so this is the
         * shipped price rather than a second copy of the table (§2.4).
         */
        const conds = d.conditions || [];
        if (conds.length) conditioned++;
        spent += d.conditionCost(w, conds);
        checked++;
        worstOver = Math.max(worstOver, spent - budget);
        worstUnder = Math.min(worstUnder, spent / budget);
      }
    }
    assert(worstOver <= 1e-9,
      `a wave spent ${worstOver.toFixed(1)} threat more than its budget — an elite wave is secretly harder than the ramp says`);
    assert(worstUnder > 0.86,
      `some wave left ${((1 - worstUnder) * 100).toFixed(0)}% of its budget unspent — the ramp stops climbing there`);
    assert(elites > 0, 'no wave in forty ever fielded an elite');
    return `${checked} waves priced, worst overspend ${worstOver.toFixed(2)}, `
      + `worst underspend ${((1 - worstUnder) * 100).toFixed(1)}%, ${elites} elites queued, `
      + `${conditioned} waves conditioned`;
  });

  check('escalation: depth stops buying bodies and starts buying elites', () => {
    /**
     * ON EVERY LEVEL THE GAME SHIPS, AND IT USED TO BE ON ONE THAT IT DOES NOT.
     *
     * This ran against the synthetic pool above (see FIELD) and passed. Re-run
     * against the real ten it failed on THREE — the Ember Shelf (the level a new
     * player starts on), the Colosseum and the Jedi Temple — and one of the two
     * clauses it failed on could not have been satisfied by any tuning at all.
     *
     * `w30.mean > w2.mean × 3.5` is a bound on the ratio between the wave a
     * pool opens with and the wave it converges to, and BOTH ends are the
     * pool's own prices: the Temple has no B1 in it, so its wave 2 is two Jedi
     * at 5.2 threat each, and its heaviest body is the Master at 12. The clause
     * therefore demanded a mean above 18 from a roster whose ceiling is 12. It
     * was not measuring the escalation; it was measuring how cheap the level's
     * chaff is, and the fixture pool's three B1s made that number flattering.
     *
     * ── WHAT IT IS MEASURED AGAINST NOW ──────────────────────────────────────
     *
     * The property in the check's own name, stated where it lives: PAST THE
     * KNEE. Before `BODY_KNEE` the count IS the escalation and is meant to be
     * ("up to there a run is learning to handle a crowd"); after it the extra
     * budget must go on quality. So the two clauses are
     *
     *   the count takes a MINORITY of the budget added since the knee, and
     *   the body cap actually BINDS, which is the mechanism that makes it so,
     *
     * both per level, plus the elite-share ladder that was already here. Those
     * are strictly harder than what they replace and they are not contaminated
     * by the pool's opening price. Measured on the shipped composer before the
     * fix, share of the added budget that went on COUNT:
     *
     *     foundry 67% · kamino 66% · alpine 70% · colosseum 73% · wood 75%
     *     drifts 80% · mustafar 85% · geonosis 85% · scoria 96% · temple 108%
     *
     * and the cap — the thing meant to stop it — was reached on 0-27% of rolls
     * at wave 30, because it sat above the length the budget could pay for at
     * every depth a player reaches. See `BODY_COUNT_SHARE` in Waves.js.
     */
    const K = Waves.BODY_KNEE;
    const rows = [];
    let worstCount = 0, worstCountAt = '', worstBind = 1, worstBindAt = '';
    let worstQuality = Infinity, worstQualityAt = '', worst15 = 1, worst25 = 1;
    for (const key of LEVEL_ORDER) {
      const d = new Waves.WaveDirector(tableWorld(), { mode: 'roguelite', pool: LEVELS[key].pool });
      const at = (w, n = 25) => {
        let bodies = 0, elite = 0, threat = 0, capped = 0;
        for (let i = 0; i < n; i++) {
          d.wave = w; d._compose();
          bodies += d.spawnQueue.length;
          if (d.spawnQueue.length >= d.shape.cap) capped++;
          elite += d.spawnQueue.filter(isElite).length;
          threat += d.spawnQueue.reduce((s, e) => s + Waves.spawnCost(e), 0);
        }
        return { bodies: bodies / n, share: elite / bodies, mean: threat / bodies, bind: capped / n };
      };
      const w2 = at(2), w15 = at(15), w25 = at(25), knee = at(K), deep = at(40);
      assert(w2.share === 0,
        `${key} wave 2 is already ${(w2.share * 100).toFixed(0)}% elite — the first waves must teach the plain bodies`);
      worst15 = Math.min(worst15, w15.share);
      worst25 = Math.min(worst25, w25.share);

      /* The extra bodies priced at what a body cost AT THE KNEE — a lower bound
       * on what the count consumed, because anything the same bodies cost above
       * that price is quality the upgrade pass bought. */
      const spentOnCount = (deep.bodies - knee.bodies) * knee.mean
        / (d.budgetFor(40) - d.budgetFor(K));
      if (spentOnCount > worstCount) { worstCount = spentOnCount; worstCountAt = key; }
      const bind = Math.min(at(30, 15).bind, deep.bind);
      if (bind < worstBind) { worstBind = bind; worstBindAt = key; }
      const quality = deep.mean / knee.mean;
      if (quality < worstQuality) { worstQuality = quality; worstQualityAt = key; }
      rows.push(`${key} ${(spentOnCount * 100).toFixed(0)}%count ×${quality.toFixed(2)}q`);
    }
    assert(worst15 > 0.2, `some level's wave 15 is only ${(worst15 * 100).toFixed(0)}% elite`);
    assert(worst25 > 0.4,
      `some level's wave 25 is only ${(worst25 * 100).toFixed(0)}% elite — it is still wave 10 with more bodies`);
    assert(worstCount < 0.5,
      `on ${worstCountAt}, ${(worstCount * 100).toFixed(0)}% of the budget added since wave ${K} went `
      + 'on MORE bodies rather than better ones — the count is still carrying the escalation, which is '
      + 'the whole of "wave 30 is wave 12 with four times the crowd"');
    assert(worstBind > 0.5,
      `on ${worstBindAt} the body cap was the binding constraint on only ${(worstBind * 100).toFixed(0)}% `
      + 'of deep waves — the fill runs out of BUDGET first, so "past the cap the wave stops growing and '
      + 'starts improving" never happens there and `_upgrade` is handed nothing to spend');
    assert(worstQuality > 1.4,
      `on ${worstQualityAt} threat per body only went ×${worstQuality.toFixed(2)} from wave ${K} to 40`);
    return `${LEVEL_ORDER.length} levels · elite share ≥${(worst15 * 100).toFixed(0)}% (w15) `
      + `≥${(worst25 * 100).toFixed(0)}% (w25) · worst count share ${(worstCount * 100).toFixed(0)}% `
      + `(${worstCountAt}) · worst cap bind ${(worstBind * 100).toFixed(0)}% (${worstBindAt}) · `
      + `worst quality ×${worstQuality.toFixed(2)} (${worstQualityAt})`;
  });

  check('escalation: the set-piece ladder never runs out of rungs', () => {
    const d = director();
    assert(typeof d.isBossWave === 'function',
      'the director has no isBossWave — bossWaves was a literal Set that ended at 30, '
      + 'so an endless mode had no set-piece past wave 30 at all');
    for (const w of [5, 10, 15, 20, 25, 30, 35, 45, 60, 100]) {
      assert(d.isBossWave(w), `wave ${w} is a multiple of ${Waves.BOSS_EVERY} and is not a boss wave`);
    }
    for (const w of [4, 6, 11, 29, 34]) assert(!d.isBossWave(w), `wave ${w} became a boss wave`);

    const lines = [];
    for (const w of [5, 10, 15, 20, 30, 50]) {
      const sp = d._setPiece(w, d.budgetFor(w), d.modifiersAt(w));
      assert(sp.length >= 2, `the wave-${w} set-piece is ${sp.length} body — a set-piece is a fight, not a body`);
      const kinds = sp.map(Waves.spawnType);
      if (new Set(kinds).size < kinds.length) {
        // Only legal while the ladder has a single rung to climb (the earliest
        // boss waves), which is exactly the old two-acolytes branch.
        assert(new Set(kinds).size === 1 && w < 10,
          `the wave-${w} set-piece is ${kinds.join(' + ')} — repeating the heaviest body is not an escalation of it`);
      }
      const heavy = sp.filter(e => Waves.isHeavy(Waves.spawnType(e))).length;
      assert(heavy <= d.heavyLimit(w), `the wave-${w} set-piece fields ${heavy} heavies against a limit of ${d.heavyLimit(w)}`);
      if (w >= Waves.CHAMPION_FROM) {
        assert(sp.some(isElite), `the wave-${w} set-piece has no champion in it`);
      }
      lines.push(`w${w}: ${sp.join(' + ')}`);
    }
    // The old hand-written branch, preserved exactly: two acolytes for 12.
    const five = d._setPiece(5, d.budgetFor(5), d.modifiersAt(5));
    assert(five.join(',') === 'acolyte,acolyte',
      `the wave-5 set-piece is ${five.join(' + ')}, and it has always been two acolytes`);
    return lines.join('; ');
  });

  check('escalation: no wave fields more enormous bodies than it may', () => {
    const d = director();
    let worst = 0, worstAt = 0, mostHeavy = 0;
    for (let w = 1; w <= 45; w++) {
      for (let i = 0; i < 20; i++) {
        d.wave = w; d._compose();
        const heavy = d.spawnQueue.filter(e => Waves.isHeavy(Waves.spawnType(e))).length;
        mostHeavy = Math.max(mostHeavy, heavy);
        /**
         * AGAINST THE WAVE'S OWN STATED CAP, not against a recomputation of it.
         *
         * `heavyLimit(w)` is the DIFFICULTY cap and `CONDITIONS.titans` lifts it
         * on purpose — the Heavy Guard is "few, and enormous", and a wave of
         * five walkers is the whole content of that condition. What may never
         * move is the FRAME-RATE ceiling, which is `HEAVY_CAP` and is asserted
         * separately below. Reading `d.shape.heavy` is calling the shipped rule
         * rather than restating it (§2.4); it is also strictly stronger than
         * the old line, which could not have caught a condition that lifted the
         * cap past the renderer's limit.
         */
        const cap = d.shape?.heavy ?? d.heavyLimit(w);
        if (heavy - cap > worst) { worst = heavy - cap; worstAt = w; }
      }
    }
    assert(worst <= 0, `wave ${worstAt} fielded ${worst} heavies over its limit — a walker is 66 meshes and an acklay more`);
    assert(mostHeavy <= Waves.HEAVY_CAP,
      `some wave fielded ${mostHeavy} enormous bodies against a frame-rate ceiling of ${Waves.HEAVY_CAP} — `
      + 'a condition has lifted the one limit that is not a difficulty number');
    // `big` and `boss` are separate flags and every heavy rule wants both;
    // reading only `big` is what let three acklays through a limit of four.
    assert(Waves.isHeavy('beast') && Waves.isHeavy('walker') && !Waves.isHeavy('trooper'),
      'isHeavy does not count both the big and the boss flag');
    return `45 waves × 20 rolls, never over the limit (${d.heavyLimit(10)} at w10, ${d.heavyLimit(40)} at w40)`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1b. Wave conditions — the ladder that does not stop               */
  /* ══════════════════════════════════════════════════════════════════ */

  check('conditions: the escalation does not flatten once the roster runs out', async () => {
    /**
     * THE MEASUREMENT THAT MOTIVATED THE WHOLE THING, kept as the check.
     *
     * Composed through the shipped director on kamino, eight seeds a wave,
     * BEFORE conditions existed:
     *
     *     wave   bodies   threat/body   distinct entries   budget stranded
     *       20     31.5       5.13            37                 0%
     *       70    125.0      10.65             7                 9%
     *      100    173.0      10.65             7                41%
     *      140    237.0      10.30             7                65%
     *
     * `_upgrade` converges — it trades every light body for the heaviest the
     * level fields and then promotes all of them — so past about wave 70 the
     * wave is one archetype wearing six modifiers, threat-per-body is frozen,
     * and two thirds of the budget is thrown away because nothing in the roster
     * can absorb it. The endless mode stopped escalating at about wave 55 and
     * the climbing body count hid it.
     *
     * Two properties, and both are about the SURPLUS rather than about any one
     * condition: a deep wave must not throw its budget away, and a deep wave
     * must be asked something a shallow one is not.
     *
     * ── AND WHAT THIS DELIBERATELY DOES NOT CLAIM ────────────────────────
     *
     * It does not claim the stranding goes to zero, because it cannot. The
     * budget is `w^1.62 · BOON_POWER^(w/6)`, which is exponential; the roster's
     * ceiling is `bodyCap · (the heaviest elite the level fields)`, which is
     * linear; and CONDITION_MAX conditions can absorb at most the sum of their
     * `worth`, which is a constant share. So there is always a depth past which
     * the ramp outruns everything again — measured, the stranding is 2-6% at
     * wave 70, 12-20% at 100, 17-28% at 140 and 31-36% at 200.
     *
     * The bar is therefore stated as a RATIO against the same wave composed
     * with no conditions at all, which is a property of the mechanism rather
     * than a number fitted to today's tuning: whatever the roster cannot
     * absorb, the conditions must take up most of. Measured 63-84% across
     * three pools and four depths, and it would still hold if the ramp were
     * retuned, because both halves of the ratio move with it. An absolute bar
     * is kept as well, but only over 70-100, which is the depth a player
     * actually reaches.
     *
     * (The first draft of this measured 71% where the truth is 49%, because the
     * probe imported Waves.js and Enemy.js but not Levels.js — which is where
     * seventeen of the thirty-one archetypes are REGISTERED. The Colosseum's
     * pool then resolved to four light droids and the stranding it reported was
     * a different game's. HANDOFF §2.5: the flattering number was the wrong
     * one. This check imports Levels.js, and so must anything measuring a pool.)
     */
    const { LEVELS } = await import('../../src/game/Levels.js');
    const rows = [];
    let worstAbsorbed = 1, worstAt = '', worstDeep = 0, worstDeepAt = '';
    for (const key of ['kamino', 'colosseum']) {
      const d = new Waves.WaveDirector(tableWorld(), { mode: 'roguelite', pool: LEVELS[key].pool });
      for (const w of [20, 40, 70, 100, 140]) {
        let plainLeft = 0, left = 0, conds = 0;
        const n = 12;
        const entries = new Set();
        const shapes = new Set();
        for (let i = 0; i < n; i++) {
          // The SAME seed both ways, so the two numbers are the same wave with
          // and without its conditions rather than two different draws.
          Waves.seedWaves(1000 + i, 0); d.wave = w;
          plainLeft += d._composeUnder(w, []).left / d.budgetFor(w);
          Waves.seedWaves(1000 + i, 0); d.wave = w; d._compose();
          const spent = d.spawnQueue.reduce((a, e) => a + Waves.spawnCost(e), 0)
            + d.conditionCost(w, d.conditions);
          left += 1 - spent / d.budgetFor(w);
          conds += d.conditions.length;
          for (const e of d.spawnQueue) entries.add(e);
          shapes.add(d.conditions.slice().sort().join('+') + '|'
            + [...new Set(d.spawnQueue.map(Waves.spawnType))].sort().join(','));
        }
        plainLeft /= n; left /= n; conds /= n;
        rows.push({ key, w, plainLeft, left, conds, entries: entries.size, shapes: shapes.size });
        // Only where there is something to absorb: below the saturation depth
        // the roster spends its whole budget and the ratio is noise over zero.
        if (plainLeft > 0.10) {
          const absorbed = (plainLeft - left) / plainLeft;
          if (absorbed < worstAbsorbed) { worstAbsorbed = absorbed; worstAt = `${key} w${w}`; }
        }
        if (w >= 70 && w <= 100 && left > worstDeep) { worstDeep = left; worstDeepAt = `${key} w${w}`; }
      }
    }
    assert(worstAbsorbed >= 0.55,
      `at ${worstAt} the conditions took up only ${(worstAbsorbed * 100).toFixed(0)}% of the budget the `
      + 'roster could not absorb — the surplus is still being thrown away and depth has stopped meaning anything');
    assert(worstDeep < 0.25,
      `at ${worstDeepAt} a wave throws away ${(worstDeep * 100).toFixed(0)}% of its budget`);
    /**
     * …AND A DEEP WAVE IS NOT ONE WAVE.
     *
     * Counted as SHAPES — the condition set the wave carries and the archetypes
     * it actually fields — rather than as distinct spawn entries, and the
     * difference matters. A conditioned wave is deliberately NARROW: NOTHING
     * WITHIN REACH fields only shooters, and counting its entries would score
     * that as monotony when it is the condition doing its job. What must not
     * happen is every deep wave being narrow in the SAME way, which is exactly
     * what the composer used to do — kamino composed 7 distinct entries at wave
     * 70 and the same 7 at wave 100, over eight seeds, because `_upgrade`
     * converges on the heaviest body the level fields and then promotes all of
     * them.
     */
    for (const key of ['kamino', 'colosseum']) {
      const shallow = rows.find((r) => r.key === key && r.w === 20);
      for (const w of [70, 100]) {
        const deep = rows.find((r) => r.key === key && r.w === w);
        assert(deep.shapes >= shallow.shapes,
          `${key} wave ${w} composes ${deep.shapes} distinct shapes over 12 seeds against wave 20's `
          + `${shallow.shapes} — every deep wave is asking the same narrow question`);
      }
    }
    return rows.filter((r) => r.key === 'kamino')
      .map((r) => `w${r.w}: ${(r.plainLeft * 100).toFixed(0)}%→${(r.left * 100).toFixed(0)}% stranded, `
        + `${r.conds.toFixed(1)}c, ${r.shapes} shapes, ${r.entries}e`).join(' · ')
      + ` · worst absorbed ${(worstAbsorbed * 100).toFixed(0)}% at ${worstAt}`;
  });

  check('conditions: every condition does on the field what its own card says', () => {
    /**
     * A condition is announced to the player in one line — `tell` — and a line
     * the wave does not honour is worse than no line at all: it teaches a
     * player to do the thing that gets them killed and the mechanic takes the
     * blame. Each is driven through the real composer, under that condition
     * alone, and asserted against what the card claims.
     *
     * Composed at the depth each one unlocks plus ten, ON A THEATRE THAT CAN
     * ACTUALLY FIELD IT — which the fixture pool used to be assumed to be.
     * `needs` is the shipped veto and it is asked here rather than restated, so
     * THE HEAVY GUARD is demonstrated on a level that stations something
     * enormous instead of failing on one that does not. A condition NO level
     * can field is dead content and is asserted against separately.
     */
    const rows = [];
    for (const key of Waves.CONDITION_KEYS) {
      const C = Waves.CONDITIONS[key];
      const homes = LEVEL_ORDER.filter((k) => {
        const t = new Waves.WaveDirector(tableWorld(), { mode: 'roguelite', pool: LEVELS[k].pool });
        return !t.ruleVeto(key);
      });
      assert(homes.length,
        `no level in LEVEL_ORDER can field "${key}" — a condition every theatre vetoes is a `
        + 'card nobody will ever be shown');
      const d = new Waves.WaveDirector(tableWorld(), { mode: 'roguelite', pool: LEVELS[homes[0]].pool });
      assert(C.label && C.tell, `condition "${key}" has no label or no tell — nothing tells the player it is on`);
      assert(C.worth > 0, `condition "${key}" is free — a condition nobody pays for is threat off the books`);
      const w = C.since + 10;
      assert(!C.needs || C.unmet,
        `condition "${key}" can be vetoed by a theatre and has no \`unmet\` line — `
        + 'the Deploy panel would grey the rule out and say nothing about why');
      const shape = d._shapeUnder(w, [key]);
      const plain = d._shapeUnder(w, []);
      const seen = new Set();
      let bodies = 0, leaders = 0, n = 12;
      for (let i = 0; i < n; i++) {
        Waves.seedWaves(500 + i, 0);
        d.wave = w;
        const out = d._composeUnder(w, [key]);
        bodies += out.queue.length;
        for (const e of out.queue) {
          seen.add(Waves.spawnType(e));
          if (Waves.spawnMod(e) === 'leader') leaders++;
        }
      }
      bodies /= n;
      const ranged = [...seen].filter((t) => ARCHETYPES[t].ranged);
      const melee = [...seen].filter((t) => !ARCHETYPES[t].ranged);
      let elite = 0, all = 0;
      for (let i = 0; i < n; i++) {
        Waves.seedWaves(500 + i, 0);
        for (const e of d._composeUnder(w, [key]).queue) { all++; if (isElite(e)) elite++; }
      }
      switch (key) {
        case 'silence':
          assert(!ranged.length, `NO GUNS fielded ${ranged.join(', ')}, which shoot`);
          break;
        case 'fusillade':
          assert(!melee.length, `NOTHING WITHIN REACH fielded ${melee.join(', ')}, which close`);
          break;
        case 'titans': {
          const heavy = [...seen].filter((t) => Waves.isHeavy(t));
          assert(heavy.length, 'THE HEAVY GUARD fielded no enormous body at all');
          assert(shape.heavy > plain.heavy,
            `THE HEAVY GUARD left the heavy limit at ${shape.heavy}, the same as an ordinary wave`);
          break;
        }
        case 'deluge':
          assert(shape.alive > plain.alive * 1.5,
            `ALL AT ONCE stands ${shape.alive} at once against an ordinary ${plain.alive}`);
          assert(shape.pace < 0.5, `ALL AT ONCE feeds the wave in at ${shape.pace}× the ordinary gap`);
          break;
        case 'hammer':
          assert(shape.bearing, 'ONE BEARING does not set a bearing');
          break;
        case 'elites': {
          /**
           * The one condition that reads `eliteScale`, which was a documented
           * hook no condition declared and which therefore multiplied by 1
           * forever. Asserted on the SHAPE (the ceiling it lifts) and on the
           * FIELD (what the fill actually promoted), because the first without
           * the second is how a hook gets declared and still does nothing.
           */
          assert(shape.chance > plain.chance * 1.5,
            `NO RANK AND FILE promotes at ${shape.chance.toFixed(2)} against an ordinary `
            + `${plain.chance.toFixed(2)} — eliteScale is not reaching the shape`);
          assert(shape.chance >= 1,
            `NO RANK AND FILE tops out at ${shape.chance.toFixed(2)} of the fill — `
            + '"every one of them is somebody" has to mean every one');
          const plainShare = (() => {
            let e = 0, a = 0;
            for (let i = 0; i < n; i++) {
              Waves.seedWaves(500 + i, 0);
              for (const x of d._composeUnder(w, []).queue) { a++; if (isElite(x)) e++; }
            }
            return e / Math.max(1, a);
          })();
          assert(elite / Math.max(1, all) > plainShare,
            `NO RANK AND FILE fielded ${(elite / all * 100).toFixed(0)}% elites against an `
            + `ordinary wave's ${(plainShare * 100).toFixed(0)}%`);
          break;
        }
        case 'vanguard':
          assert(shape.head, 'A HEAD TO CUT OFF marks no head');
          // EXACTLY one, or "the leader" is not something a player can find.
          assert(leaders === n, `${n} vanguard waves produced ${leaders} leaders — it must be exactly one each`);
          assert(!shape.allowed.includes('leader'),
            'the fill can still promote its own leaders, so the wave has more than one head');
          break;
        default:
          throw new Error(`condition "${key}" has no behavioural check — add one`);
      }
      rows.push(`${key} ${bodies.toFixed(0)}b on ${homes[0]} (${homes.length} theatres)`);
    }
    return `${Waves.CONDITION_KEYS.length} conditions, each doing what its card says: ${rows.join(', ')}`;
  });

  check('conditions: a level that cannot field one is never given it', () => {
    /**
     * `needs` is how a pool vetoes a condition, and the veto has to be real:
     * kamino's only melee archetype is the acolyte, so NO GUNS on that level
     * would be six identical acolytes — a different question asked so narrowly
     * that it is a monotony. A wave asked differently still has to be a wave.
     */
    const kamino = new Waves.WaveDirector(tableWorld(),
      { mode: 'roguelite', pool: ['trooper', 'b1', 'trooper', 'b2', 'sniper', 'acolyte', 'droideka', 'b1'] });
    const types = kamino.unlockedAt(40);
    assert(!Waves.CONDITIONS.silence.needs(types, kamino),
      'NO GUNS is legal on a pool with one melee archetype in it');
    assert(!Waves.CONDITIONS.titans.needs(types, kamino),
      'THE HEAVY GUARD is legal on a pool with no heavy in it');
    // …and it never leaks through the composer either.
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      Waves.seedWaves(3000 + i, 0);
      kamino.wave = 20 + (i % 60); kamino._compose();
      for (const k of kamino.conditions) seen.add(k);
    }
    assert(!seen.has('silence') && !seen.has('titans'),
      `kamino composed ${[...seen].join(', ')} — a vetoed condition reached the field`);
    return `kamino may field ${[...seen].join(', ')}; NO GUNS and THE HEAVY GUARD correctly vetoed`;
  });

  check('trial: the Trial of Waves is not Path of the Blade with the cards deleted', async () => {
    /**
     * MEASURED BEFORE: with a fresh RNG stream per mode, ten seeds over forty
     * waves, **0 of 400 waves differed**. `_compose` never read the mode
     * outside the duel branch, so the only thing separating the two entries in
     * the menu was `DRAFT_MODES` — which takes content AWAY. A mode whose whole
     * content is another mode's content missing is not a mode.
     *
     * Two properties, both derived rather than declared: a mode that drafts
     * nothing is not charged for the cards it never gets (`budgetFor` reads
     * `drafts`, which is the shipped statement of which modes those are), and
     * the conditions are what it has instead of a build.
     */
    const { LEVELS } = await import('../../src/game/Levels.js');
    const pool = LEVELS.kamino.pool;
    const make = (mode) => new Waves.WaveDirector(tableWorld(), { mode, pool });
    let differ = 0, total = 0;
    for (let w = 1; w <= 40; w++) {
      for (const s of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
        Waves.seedWaves(s, 0); const a = make('roguelite'); a.wave = w; a._compose();
        Waves.seedWaves(s, 0); const b = make('waves'); b.wave = w; b._compose();
        total++;
        if (a.spawnQueue.join(',') !== b.spawnQueue.join(',')) differ++;
      }
    }
    assert(differ > total * 0.5,
      `${differ} of ${total} waves differ between the Trial and Path of the Blade — `
      + 'the two menu entries are still one game');
    const path = make('roguelite'), trial = make('waves');
    assert(trial.budgetFor(30) < path.budgetFor(30),
      `the Trial faces ${trial.budgetFor(30)} threat at wave 30 against Path's ${path.budgetFor(30)} — `
      + 'it is being charged for a build it structurally cannot have');
    assert(trial.budgetFor(1) === path.budgetFor(1),
      'the two modes already differ at wave 1, where neither has drafted anything');
    // …and the ladder starts where the mode has nothing else, not at 13.
    assert(trial.conditionSince('hammer') < path.conditionSince('hammer'),
      'the Trial waits as long as Path of the Blade for its first condition, and it has no cards to wait with');
    let pc = 0, tc = 0;
    for (let w = 1; w <= 60; w++) {
      Waves.seedWaves(9, 0); path.wave = w; path._compose(); pc += path.conditions.length;
      Waves.seedWaves(9, 0); trial.wave = w; trial._compose(); tc += trial.conditions.length;
    }
    assert(tc > pc, `60 waves: the Trial carried ${tc} conditions and Path ${pc}`);
    return `${differ}/${total} waves differ; budget at w30 ${path.budgetFor(30)} → ${trial.budgetFor(30)}; `
      + `conditions in 60 waves ${pc} → ${tc}`;
  });

  check('duel: the ladder is the saber roster, and it ends on a boss', () => {
    /**
     * The mode composed `min(1 + floor(w/2), 6)` acolytes and nothing else:
     * sixty waves over twelve seeds gave FIFTEEN distinct compositions and ONE
     * enemy type, on top of a thousand lines of Duel.js and five authored
     * FORMS. The ladder is derived from ARCHETYPES now, so a duellist added
     * tomorrow joins it on the day it is added.
     */
    const d = new Waves.WaveDirector(tableWorld(), { mode: 'duel' });
    const { rungs, bosses } = d.duelRoster();
    assert(rungs.length >= 4, `the duel ladder has ${rungs.length} rung(s): ${rungs.join(', ')}`);
    assert(bosses.length >= 1, 'the duel ladder has no boss rung');
    for (const t of [...rungs, ...bosses]) {
      assert(ARCHETYPES[t].saber, `${t} stands on the duel ladder without a saber`);
      assert(!ARCHETYPES[t].ranged, `${t} stands on the duel ladder and shoots`);
    }
    // The rungs open one at a time, and they do not all open at once.
    assert(d.duelTier(1) === 1, `wave 1 opens ${d.duelTier(1)} rungs — the first duel is one body's form`);
    assert(d.duelTier(1 + Waves.DUEL_RUNG) === 2, 'the second rung does not open at DUEL_RUNG');
    assert(d.duelTier(1 + Waves.DUEL_RUNG * (rungs.length - 1)) === rungs.length,
      'the last rung never opens');
    // …and a duel stays a duel.
    const comps = new Set(); const seen = new Set(); let most = 0;
    for (let w = 1; w <= 60; w++) {
      for (const s of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]) {
        Waves.seedWaves(s, 0); d.wave = w; d._compose();
        comps.add(d.spawnQueue.slice().sort().join(','));
        most = Math.max(most, d.spawnQueue.length);
        for (const e of d.spawnQueue) seen.add(Waves.spawnType(e));
      }
    }
    assert(most <= Waves.DUEL_MAX, `a duel wave fielded ${most} bodies against DUEL_MAX ${Waves.DUEL_MAX}`);
    assert(seen.size >= 4, `60 waves × 12 seeds fielded ${seen.size} archetype(s) — the ladder is one body again`);
    assert(comps.size >= 60,
      `60 waves × 12 seeds produced ${comps.size} distinct compositions — it was 15 with one acolyte type`);
    return `${rungs.length} rungs + ${bosses.length} bosses; ${comps.size} distinct compositions over `
      + `${seen.size} archetypes in 60 waves, never more than ${most} at once`;
  });

  check('conditions: killing the leader ends the wave, and one bearing has a front', () => {
    /**
     * DRIVEN, not composed — everything above this point reads a queue, and
     * these two conditions do their work in `update`. A rout that only exists
     * in the composer is a banner over a wave that never breaks.
     *
     * The world is a stub with the three things the director asks a world for:
     * somewhere to put a body, a way to make one, and a list to put it in.
     * `arrivals.enabled = false` so the direct spawn path runs — a gunship
     * would need a scene, and `request` returning false is exactly the
     * documented fallback for a level with nothing that could bring anything.
     */
    const bodies = [];
    const stub = {
      enemies: bodies, players: [{ position: V(0, 0, 0), alive: true }],
      takenBoons: new Set(), settings: {}, partyTeam: 0, hpScale: 1, dmgScale: 1,
      scene: new THREE.Group(),
      notify() {}, onEnemyKilled(e) { e._killed = (e._killed || 0) + 1; },
      terrain: flatGround(),
    };
    stub.player = stub.players[0];
    const d = new Waves.WaveDirector(stub, { mode: 'roguelite', pool: FULL_POOL });
    d.arrivals.enabled = false;
    let spawnAt = 0;
    const ctx = {
      enemies: bodies,
      // A ring of candidate points, walked round so a bearing has something to
      // reject: `_spawnPoint` re-asks until the heading is inside the arc.
      pickSpawn: () => { const a = (spawnAt++ * 0.37) * TAU; return V(Math.cos(a) * 40, 0, Math.sin(a) * 40); },
      // Rich enough for the REAL `applyModifier` to run on it, which is what
      // makes `e.mod` the game's own answer to "which body is the leader"
      // rather than a flag this check invented. `install` is the elite's tell
      // and wants a scene graph; it is fed a group that accepts children and
      // nothing more, which is all a headless body needs.
      spawnEnemy: (type, at) => {
        const A = ARCHETYPES[type];
        const e = {
          type, position: at, dead: false, team: 1, mod: null, A,
          world: stub, hp: A.hp, maxHp: A.hp, speed: A.speed, attackDamage: A.damage,
          root: new THREE.Group(), group: new THREE.Group(), rig: null,
          // The tells the elite installers hang on a body. A headless one has
          // no meshes, so they are the smallest shapes each installer touches;
          // what this check is about is `e.mod`, which `applyModifier` sets
          // before any of them runs.
          add(o) { this.group.add(o); },
          shieldCentre: (out) => (out ? out.copy(at) : at),
          dispose() {},
        };
        bodies.push(e);
        return e;
      },
    };

    /* ── A HEAD TO CUT OFF ─────────────────────────────────────────────── */
    /* Searched THROUGH `start`, not through `_compose`: start re-composes, so a
     * wave found one way is not the wave the other way produces. */
    const findWave = (key, base) => {
      for (let w = 13; w < 120; w++) {
        Waves.seedWaves(base + w, 0);
        bodies.length = 0;
        d._paid = 0;
        d.start(w);
        if (d.conditions.includes(key)) return w;
      }
      return null;
    };
    const found = findWave('vanguard', 4000);
    assert(found, 'no wave between 13 and 120 ever drew A HEAD TO CUT OFF');
    const queued = d.spawnQueue.length;
    // Run the wave in until everything is standing.
    for (let i = 0; i < 4000 && d.spawnQueue.length; i++) d.update(1 / 30, ctx);
    const head = bodies.find((e) => e.mod === 'leader')
      || bodies.find((e) => Waves.spawnMod(`${e.type}|${e.mod}`) === 'leader');
    assert(head, `${bodies.length} bodies of ${queued} landed and none of them is the leader`);
    const before = bodies.filter((e) => !e.dead).length;
    assert(before > 3, `only ${before} bodies stood in a vanguard wave — nothing to rout`);
    head.dead = true;
    /* The frame that notices, and then the sweep — ROUT_PER_FRAME at a time —
     * and STOP AT THE WAVE END. Running on past it starts the intermission,
     * and 5.5 s later `start(wave + 1)` composes the next wave into the same
     * stub: the first draft of this check read four of those as survivors of
     * the rout. A driven check has to stop where the thing it is driving does. */
    let frames = 0;
    while (d.active && frames++ < 400) d.update(1 / 30, ctx);
    assert(!d.active, 'the wave never ended after the leader fell');
    const after = bodies.filter((e) => !e.dead).length;
    assert(after === 0,
      `${after} of ${before} bodies were still standing after the leader fell — the wave does not break`);
    assert(!d.spawnQueue.length, 'the rout left bodies queued, so the wave cannot end');
    // …and nobody is credited with a kill they did not make.
    assert(bodies.every((e) => (e._killed || 0) <= 1), 'a routed body was killed twice');

    /* ── ONE BEARING ───────────────────────────────────────────────────── */
    const bw = findWave('hammer', 7000);
    assert(bw, 'no wave between 13 and 120 ever drew ONE BEARING');
    for (let i = 0; i < 4000 && d.spawnQueue.length; i++) d.update(1 / 30, ctx);
    assert(bodies.length > 6, `only ${bodies.length} bodies landed under ONE BEARING`);
    d.active = false;
    const b = d._bearing();
    assert(b !== null, 'a ONE BEARING wave has no bearing');
    let worst = 0;
    for (const e of bodies) {
      const off = Math.abs(((Math.atan2(e.position.z, e.position.x) - b + Math.PI * 3) % TAU) - Math.PI);
      worst = Math.max(worst, off);
    }
    // The arc is a half-width either side, and `_spawnPoint` keeps the best of
    // what it saw rather than failing — so the bound is the arc, not perfection.
    assert(worst <= Waves.BEARING_ARC / 2 + 1e-6,
      `a body arrived ${(worst * 180 / Math.PI).toFixed(0)}° off the wave's bearing, against a `
      + `${(Waves.BEARING_ARC * 90 / Math.PI).toFixed(0)}° half-arc — the field has no front`);
    // …and an ordinary wave still comes from everywhere, or the check above is
    // measuring the spawn stub rather than the condition.
    bodies.length = 0;
    Waves.seedWaves(11, 0);
    d._paid = 0;
    d.start(12);
    assert(!d.conditions.length, 'the control wave drew a condition');
    for (let i = 0; i < 4000 && d.spawnQueue.length; i++) d.update(1 / 30, ctx);
    let spread = 0;
    for (const e of bodies) {
      const off = Math.abs(((Math.atan2(e.position.z, e.position.x) - b + Math.PI * 3) % TAU) - Math.PI);
      spread = Math.max(spread, off);
    }
    assert(spread > Waves.BEARING_ARC / 2,
      'an unconditioned wave arrives inside one quarter too, so ONE BEARING changes nothing');
    return `w${found}: the leader fell and ${before} bodies broke; `
      + `w${bw}: every body inside ${(worst * 180 / Math.PI).toFixed(0)}° of one bearing `
      + `against ${(spread * 180 / Math.PI).toFixed(0)}° unconditioned`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2. The modifiers themselves                                       */
  /* ══════════════════════════════════════════════════════════════════ */

  check('escalation: every modifier is declared, priced, gated and legal on something', () => {
    assert(Foe.MODIFIERS && Object.keys(Foe.MODIFIERS).length >= 6,
      'Enemy exports no MODIFIERS — every enemy in the game is still exactly its archetype');
    const rows = [];
    for (const [key, M] of Object.entries(Foe.MODIFIERS)) {
      assert(typeof M.label === 'string' && M.label.length, `${key} has no label`);
      assert(typeof M.tell === 'string' && M.tell.length > 12,
        `${key} does not say how it reads on the body — a difficulty you cannot see coming is a surprise, not difficulty`);
      assert(Number.isFinite(M.since) && M.since >= 1, `${key} unlocks at ${M.since}`);
      assert(M.threat && Number.isFinite(M.threat.mul) && Number.isFinite(M.threat.flat), `${key} has no price`);
      assert(typeof M.allow === 'function', `${key} has no legality rule`);
      const chassis = Object.keys(ARCHETYPES).filter(t => Foe.modifiersFor(t).includes(key));
      assert(chassis.length, `${key} is legal on nothing at all`);
      // Nothing may promote a training dummy: the dojo promises what it fights.
      const training = chassis.filter(t => ARCHETYPES[t].training);
      assert(!training.length, `${key} can be applied to the dojo's ${training.join(', ')}`);
      rows.push(`${key}@${M.since} (${chassis.length})`);
    }
    // A ladder, not a pile: the modifiers must arrive spread through the run.
    const sinces = Object.values(Foe.MODIFIERS).map(M => M.since).sort((a, b) => a - b);
    assert(sinces[sinces.length - 1] - sinces[0] >= 6,
      `every modifier unlocks between wave ${sinces[0]} and ${sinces[sinces.length - 1]} — there is no ladder`);
    const d = director();
    assert(d.modifiersAt(2).length === 0, 'wave 2 already has elites available');
    assert(d.modifiersAt(30).length === Object.keys(Foe.MODIFIERS).length, 'some modifier is never unlocked');
    return rows.join(', ');
  });

  check('escalation: every modifier is charged for at least the pressure it adds', () => {
    const under = [], rows = [];
    for (const key of Object.keys(Foe.MODIFIERS)) {
      let worst = Infinity, worstAt = '';
      for (const type of Object.keys(ARCHETYPES)) {
        if (!Foe.modifiersFor(type).includes(key)) continue;
        const base = ARCHETYPES[type];
        const A = eliteArchetype(type, key);
        const priceRatio = A.threat / base.threat;
        const pressureRatio = pressure(A, key) / pressure(base, null);
        const ratio = priceRatio / pressureRatio;
        if (ratio < worst) { worst = ratio; worstAt = type; }
      }
      if (worst < 0.9) under.push(`${key} on ${worstAt} (charged ${worst.toFixed(2)}× what it is worth)`);
      rows.push(`${key} ≥${worst.toFixed(2)}×`);
    }
    assert(!under.length,
      `modifiers the director undercharges for: ${under.join(', ')} — an elite wave of these is harder than its budget claims`);

    // And at the WAVE level, which is the number that actually matters: an
    // elite wave and a plain wave of the same budget must weigh the same.
    const d = director();
    const plain = director();
    plain.eliteChance = () => 0;
    plain._promote = () => 0;
    const weigh = (q) => q.reduce((s, e) => {
      const type = Waves.spawnType(e), mod = Waves.spawnMod(e);
      const A = mod ? eliteArchetype(type, mod) : ARCHETYPES[type];
      let p = pressure(A, mod);
      if (mod === 'leader') p *= 1 + (Foe.RALLY.damage / Foe.RALLY.rate - 1) * 3;
      return s + p;
    }, 0);
    let worstRatio = 1, worstWave = 0;
    for (const w of [5, 8, 12, 15, 20, 25, 30]) {
      let pe = 0, pp = 0; const n = 30;
      for (let i = 0; i < n; i++) {
        d.wave = w; d._compose(); pe += weigh(d.spawnQueue);
        plain.wave = w; plain._compose(); pp += weigh(plain.spawnQueue);
      }
      const r = pe / pp;
      if (Math.abs(r - 1) > Math.abs(worstRatio - 1)) { worstRatio = r; worstWave = w; }
    }
    assert(worstRatio > 0.7 && worstRatio < 1.3,
      `at wave ${worstWave} an elite wave weighs ${worstRatio.toFixed(2)}× the plain wave of the same budget`);
    return `${rows.join(', ')}; elite vs plain wave ${worstRatio.toFixed(2)}× at worst (w${worstWave})`;
  });

  check('escalation: every modifier puts a tell on the body that the LOD never hides', () => {
    // The rule that makes an elite fair. Every tell is either a change to a
    // bone's PRIMARY mesh — the limb tubes, which `_applyLod` keeps at every
    // distance because they are the silhouette — or a mesh added after the
    // constructor collected `_lodParts`, which is therefore not in that list
    // and never hidden either. A tell that only exists inside 30 m is not a
    // tell: the spawn ring is 34–56 m out.
    const world = gameWorld();
    const rows = [];
    for (const key of Object.keys(Foe.MODIFIERS)) {
      const chassis = Object.keys(ARCHETYPES).filter(t => Foe.modifiersFor(t).includes(key));
      assert(chassis.length, `${key} has no chassis to test on`);
      const seen = [];
      // EVERY legal chassis, not the first one that happens to work. A droideka
      // is a baked group with no bone rig, so a tell written only against
      // `rig.list` reads on five of the six bodies a modifier is legal on and
      // on none of the sixth — which is exactly the shape of bug this is for.
      for (const type of chassis) {
        // BEFORE AND AFTER ON THE SAME BODY. Comparing a promoted enemy against
        // a separately built plain one proves nothing: Bodies.js mints fresh
        // material instances per build, so every mesh would read as
        // "recoloured" and this would pass for a modifier that did nothing.
        const e = spawn(world, type);
        settle(e, world);
        const mats = new Map();
        const surfaces = [];
        if (e.rig) for (const b of e.rig.list) { if (b.primary) surfaces.push(b.primary); }
        else e.group?.traverse(o => { if (o.isMesh) surfaces.push(o); });
        for (const m of surfaces) mats.set(m, m.material.clone());
        const before = new Set();
        (e.rig?.root || e.group)?.traverse(o => { if (o.isMesh) before.add(o); });
        const sceneBefore = world.scene.children.length;

        assert(Foe.applyModifier(e, key), `${key} refused to go on a ${type}`);
        settle(e, world);

        // (a) a SILHOUETTE surface that looks different — bone primaries, which
        // `_applyLod` keeps at every distance, or a group's own baked meshes
        let tinted = 0;
        for (const m of surfaces) {
          const was = mats.get(m), now = m.material;
          if (!was || !was.color || !now.color) continue;      // shader shells have no colour to move
          if (!now.color.equals(was.color)
            || (now.emissive && was.emissive && !now.emissive.equals(was.emissive))
            || now.emissiveIntensity !== was.emissiveIntensity) tinted++;
        }
        // (b) new geometry on the body that `_lodParts` does not own
        const added = [];
        (e.rig?.root || e.group)?.traverse(o => { if (o.isMesh && !before.has(o)) added.push(o); });
        const lodOwned = new Set(e._lodParts || []);
        const survives = added.filter(o => !lodOwned.has(o));
        assert(!added.length || added.length === survives.length,
          `${key} on a ${type} hung ${added.length - survives.length} of its meshes inside _lodParts — culled past 30 m`);
        // (c) something new in the scene beside the body (bubble, ring, blade)
        const sceneAdded = world.scene.children.length - sceneBefore;

        // and prove it: force the far LOD and the tell has to still be there
        e._applyLod(2);
        const stillOn = survives.filter(o => o.visible).length;
        assert(tinted > 0 || stillOn > 0 || sceneAdded > 0,
          `${key} on a ${type} changes nothing a player can see from the spawn ring — `
          + 'the wave walks in from 34 to 56 m out, and a tell that only reads inside 30 m is not a tell');
        seen.push(`${type}:${tinted}/${stillOn}/${sceneAdded}`);

        e.dispose();
        world.enemies.splice(world.enemies.indexOf(e), 1);
      }
      rows.push(`${key} [${seen.join(' ')}]`);
    }
    return rows.join('; ');
  });

  check('escalation: an elite comes apart like everything else does', () => {
    const world = gameWorld();

    // ── plates ride the limb they are bolted to
    const armoured = spawn(world, 'trooper', 'armoured');
    settle(armoured, world);
    // ── the torso really is harder than the limbs, and the limbs really are not.
    // Read before anything is cut off, or the limb it asks about is gone.
    const caps = new Map(armoured.capsules().map(c => [c.name, c]));
    assert(caps.get('chest').toughness === TOUGHNESS.durasteel,
      `the armoured chest is ${caps.get('chest').toughness}, not durasteel`);
    assert(caps.get('shinL').toughness === ARCHETYPES.trooper.toughness,
      'the armoured elite plated its shins too — then there is no way in at all');

    const thigh = armoured.rig.get('thighR');
    // By identity, not by "the first extra mesh on the bone" — a trooper's thigh
    // already carries authored decoration and picking that would test Bodies.js.
    const plate = (armoured._modMeshes || []).find(m => m.parent === thigh.obj);
    assert(plate, 'the Armoured elite bolted no plate to a thigh');
    // Cut ABOVE the plate: Actor.cut adopts any child sitting past the cut, so
    // the armour on the lower leg has to leave with the lower leg.
    const above = (plate.position.y / thigh.length) * 0.5;
    assert(armoured.actor.cut('thighR', above, V(0, 0, 4), V(0, 0.6, 0), { spin: 1 }),
      'the armoured thigh refused to be cut');
    let onPiece = false;
    for (const piece of armoured.actor.pieces) {
      for (const entry of piece.entries) entry.holder.traverse(o => { if (o === plate) onPiece = true; });
    }
    assert(onPiece, 'the thigh plate stayed behind when the thigh came off');
    assert(plate.visible, 'the severed plate came away invisible');
    // and the other direction, because a plate that ALWAYS detaches is just as
    // wrong: cut below the armour on the far leg and it must stay on the stub.
    const thighL = armoured.rig.get('thighL');
    const plateL = (armoured._modMeshes || []).find(m => m.parent === thighL.obj);
    armoured.actor.cut('thighL', Math.min(0.94, (plateL.position.y / thighL.length) + 0.2),
      V(0, 0, 4), V(0, 0.6, 0), { spin: 1 });
    assert(plateL.parent === thighL.obj, 'a plate below the cut left with the piece anyway');

    // ── the standard falls with the leader, and the aura ring goes out
    const leader = spawn(world, 'b1', 'leader');
    settle(leader, world);
    assert(leader.rallyRing && leader.rallyRing.visible, 'the Leader draws no aura ring while alive');
    assert(Math.abs(leader.rallyRing.geometry.parameters.outerRadius - Foe.RALLY.radius) < 1e-6,
      'the ring is not drawn at the radius the buff actually reaches — it lies about who is being helped');
    const standard = leader.beacon;
    assert(standard, 'the Leader carries no standard');
    leader.actor.goRagdoll(V(0, 0, 0), V(0, 0, 0));
    let homed = false;
    for (const holder of leader.actor.holders.values()) holder.traverse(o => { if (o === standard) homed = true; });
    assert(homed, 'the standard was orphaned when the body fell — it was not parented to a bone');
    assert(standard.visible, 'the standard vanished with the rig root');
    leader.die(V(0, 0, 0), null, 'cut');
    settle(leader, world);
    assert(!leader.rallyRing.visible, 'a corpse is still leading the wave');

    // ── the bubble is in front of the bones and one pass takes it
    const shielded = spawn(world, 'trooper', 'shielded');
    settle(shielded, world);
    const list = shielded.capsules();
    assert(list[0] && list[0].shield, 'the elite bubble is not the first thing the blade meets');
    assert(shielded.shieldMesh && shielded.shieldMesh.visible, 'there is no bubble to see');
    const hpBefore = shielded.hp;
    shielded.damage(40, V(0, 1, 0), null, 'bolt');
    assert(shielded.hp === hpBefore, 'a bolt went straight through the bubble');
    shielded.takeCut({ bone: 'shield', cutT: 0.5, cap: list[0], point: V(0, 1, 0), impulse: V(0, 0, 1) }, null);
    assert(!shielded.shieldUp, 'a clean pass did not drop the bubble');
    assert(shielded.hp === hpBefore, 'dropping the bubble also cost the body health');
    settle(shielded, world);
    assert(!shielded.capsules().some(c => c.shield), 'the bubble is still in the blade solver after it broke');

    // ── the unstable core burns a fuse and then takes the ground with it
    const victim = { position: V(2.2, 0, 0), hp: 100, hurt: 0, velocity: V(0, 0, 0),
      damage(a) { this.hurt += a; this.hp -= a; }, camera: { addShake() {} } };
    world.players.push(victim);
    const bomb = spawn(world, 'b1', 'unstable');
    settle(bomb, world);
    assert(bomb.coreMesh, 'the Unstable elite carries no core to see');
    bomb.die(V(0, 0, 0), null, 'cut');
    assert(bomb.fuse > 0, 'it detonated on the frame it died — there is no window to walk out of');
    assert(victim.hurt === 0, 'the blast landed before the fuse did');
    settle(bomb, world, Math.ceil(Foe.UNSTABLE.fuse * 60) + 2);
    assert(victim.hurt > 0, `the fuse burned out and nothing happened (${Foe.UNSTABLE.fuse}s)`);
    assert(world.booms > 0, 'the blast never reached the destruction system, so it cannot hole a wall');

    const kit = world.scene.children.length;
    for (const e of world.enemies) e.dispose();
    assert(world.scene.children.length < kit,
      'disposing the elites left their bubbles, rings and second blades in the scene');
    return `plate rode the piece, standard re-homed on the ragdoll, bubble dropped in one pass, `
      + `fuse ${Foe.UNSTABLE.fuse}s then ${victim.hurt.toFixed(0)} damage at 2.2 m`;
  });

  check('escalation: a Leader multiplies the wave, and only inside its ring', () => {
    /* SEEDED, because the thing being compared is stochastic and the stream is
     * shared. `enemyRng` is module-scope in Enemy.js, so every body's speed
     * jitter is drawn from wherever the PREVIOUS suite left the generator —
     * and this compares two b1s against a 5% margin on a 15% buff. It passes
     * alone and fails in some orderings, which is the worst way for a check to
     * be wrong: it reads as a defect in the game. See the note over `seed` in
     * MathUtil's makeRng. */
    Foe.enemyRng.seed(41000);
    const world = gameWorld();
    const leader = spawn(world, 'trooper', 'leader');
    const near = spawn(world, 'b1');
    const far = spawn(world, 'b1');
    near.position.set(Foe.RALLY.radius * 0.5, 0, 0);
    far.position.set(Foe.RALLY.radius * 1.6, 0, 0);
    settle(leader, world);
    settle(near, world); settle(far, world);
    assert(near.rallyTimer > 0, 'a body standing inside the ring was not rallied');
    assert(!(far.rallyTimer > 0), 'a body well outside the ring was rallied anyway');

    /**
     * The buff is real, not a field nobody reads: same wish, more ground.
     *
     * THE SAME BODY TWICE, and that is the correction. This drove `near`
     * rallied and `far` plain and its own comment claimed "both are b1s with
     * the same speed jitter seed order, so the ratio is the buff" — which is
     * false. They are spawned one after the other off `enemyRng`, so they take
     * DIFFERENT draws and their base speeds differ by the jitter. Against a 5%
     * bar on a 15% buff, that difference swamps the signal: measured at 1.45 m
     * against 1.44 m, and 1.49 against 1.47 on a pristine tree, i.e. the check
     * failed for a reason that had nothing to do with the aura.
     *
     * Driving one body twice removes the variable rather than trying to
     * cancel it, so the ratio IS the buff and no seeding is required to make
     * the comparison honest. (`enemyRng` is seeded above anyway, because a
     * module-scope stream makes the whole suite order-dependent.)
     */
    const runOnce = (e, rally) => {
      e.wish = V(1, 0, 0); e.toTarget = V(1, 0, 0);
      e.velocity.set(0, 0, 0); e.stunTimer = 0; e.knockTimer = 0;
      const start = e.position.clone();
      const x0 = e.position.x;
      for (let i = 0; i < 30; i++) {
        e.rallyTimer = rally ? Math.max(e.rallyTimer, 0.2) : 0;
        e._move(1 / 60, { terrain: world.terrain, physics: world.physics, particles: null });
      }
      const covered = e.position.x - x0;
      e.position.copy(start);
      return covered;
    };
    const rallied = runOnce(near, true);
    const plainRun = runOnce(near, false);
    assert(rallied > plainRun * 1.05,
      `the SAME body covered ${rallied.toFixed(3)} m rallied and ${plainRun.toFixed(3)} m plain `
      + `(${(rallied / plainRun).toFixed(3)}x) — the aura is a field nobody reads`);

    leader.die(V(0, 0, 0), null, 'cut');
    settle(leader, world);
    near.rallyTimer = 0;
    settle(near, world);
    assert(!(near.rallyTimer > 0), 'the wave is still being led by a corpse');
    for (const e of world.enemies) e.dispose();
    return `inside ${Foe.RALLY.radius} m: ${rallied.toFixed(2)} m vs ${plainRun.toFixed(2)} m in half a second; `
      + `aura dies with the leader`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3. The draft                                                      */
  /* ══════════════════════════════════════════════════════════════════ */

  check('boons: rarity is a probability, and depth moves it', () => {
    assert(Waves.RARITY && Waves.BOONS.every(b => b.rarity),
      'boons carry no rarity — every card is equally likely at every depth, which is the same draft every run');
    const share = (wave, n = 3000) => {
      const seen = { common: 0, rare: 0, epic: 0 };
      let total = 0;
      for (let i = 0; i < n; i++) {
        for (const b of Waves.drawBoons(3, new Set(), wave)) { seen[b.rarity]++; total++; }
      }
      return { common: seen.common / total, rare: seen.rare / total, epic: seen.epic / total };
    };
    const early = share(2), late = share(25);
    assert(early.epic === 0, `wave 2 offered an epic ${(early.epic * 100).toFixed(1)}% of the time`);
    /* 0.045, not 0.06. The table's true wave-25 epic rate is 6.0%, and a bound
     * placed exactly on the true rate is a coin flip: 9000 draws has a standard
     * error of 0.25 points, so a threshold at 6.0 fails about half the time.
     * It did — one run read 5.9% and failed, the next read 6.0% and passed,
     * with nothing in between but the sampler. A check that fails at random is
     * worse than no check, because it teaches everyone to re-run rather than to
     * read. The bound sits three standard errors below the true rate: it still
     * catches epics being removed, halved, or gated out of reach, which is what
     * it is for, and it cannot fire on the sampler alone. */
    assert(late.epic > 0.045, `wave 25 offers an epic only ${(late.epic * 100).toFixed(1)}% of the time`);
    assert(late.rare > early.rare * 1.5,
      `rares are ${(early.rare * 100).toFixed(0)}% of a wave-2 draft and ${(late.rare * 100).toFixed(0)}% of a wave-25 one`);
    assert(early.common > late.common,
      'the commons do not thin out with depth, so a deep draft is the same draft');

    // nothing may appear before the depth it declares
    const violations = [];
    for (let i = 0; i < 2000; i++) {
      const w = 1 + (i % 12);
      for (const b of Waves.drawBoons(3, new Set(), w)) {
        if (w < (b.minWave ?? 1)) violations.push(`${b.id} at wave ${w}`);
      }
    }
    assert(!violations.length, `offered before its depth: ${[...new Set(violations)].slice(0, 4).join(', ')}`);

    // a boss draft is wider and cannot be three commons
    let weakBoss = 0;
    for (let i = 0; i < 800; i++) {
      const offer = Waves.drawBoons(4, new Set(), 20, { floor: 'rare' });
      if (offer.length !== 4) throw new Error(`a boss draft laid out ${offer.length} cards`);
      if (!offer.some(b => b.rarity !== 'common')) weakBoss++;
    }
    assert(weakBoss === 0, `${weakBoss} boss drafts of 800 were four commons`);
    return `w2: ${(early.common * 100).toFixed(0)}/${(early.rare * 100).toFixed(0)}/${(early.epic * 100).toFixed(0)} `
      + `→ w25: ${(late.common * 100).toFixed(0)}/${(late.rare * 100).toFixed(0)}/${(late.epic * 100).toFixed(0)} `
      + '(common/rare/epic)';
  });

  check('boons: a mastery cannot be offered to someone who has not committed', () => {
    const masteries = Waves.BOONS.filter(b => b.requires);
    assert(masteries.length >= 4,
      'no card in the table asks what you already hold — nothing in the draft can make a build recognisable');
    const rows = [];
    for (const m of masteries) {
      const axis = m.axes[0];
      const others = Waves.BOONS.filter(b => b.id !== m.id && b.axes.includes(axis));
      assert(others.length >= Waves.MASTERY_NEEDS,
        `${m.id} needs ${Waves.MASTERY_NEEDS} of "${axis}" and only ${others.length} other cards carry it — it is unreachable`);
      const two = new Set(others.slice(0, Waves.MASTERY_NEEDS - 1).map(b => b.id));
      const enough = new Set(others.slice(0, Waves.MASTERY_NEEDS).map(b => b.id));
      assert(!m.requires(two), `${m.id} is offered on ${Waves.MASTERY_NEEDS - 1} of its axis`);
      assert(m.requires(enough), `${m.id} is not offered even on ${Waves.MASTERY_NEEDS} of its axis`);
      // and the draft really does withhold it
      let offered = 0;
      for (let i = 0; i < 600; i++) {
        if (Waves.drawBoons(3, two, 30).some(b => b.id === m.id)) offered++;
      }
      assert(offered === 0, `${m.id} was offered ${offered} times to a player holding only ${two.size} of its axis`);
      rows.push(`${m.id}←${axis}×${Waves.MASTERY_NEEDS}`);
    }
    // one per axis, so no axis is a dead end
    const axes = new Set(Waves.BOONS.flatMap(b => b.axes));
    const covered = new Set(masteries.flatMap(b => b.axes));
    const bare = [...axes].filter(a => !covered.has(a));
    assert(!bare.length, `axes with no mastery to commit to: ${bare.join(', ')}`);
    return `${masteries.length} masteries, ${axes.size} axes, all reachable: ${rows.join(', ')}`;
  });

  check('boons: a thirty-wave run draws half the table, not five eighths of it', () => {
    const d = director();
    assert(Number.isFinite(Waves.DRAFT_EVERY), 'the draft cadence is not a named number');
    let drafts = 0, cards = 0;
    for (let w = 1; w <= 30; w++) if (d.isDraftWave(w)) { drafts++; cards += d.draftSize(w); }
    assert(drafts >= 14, `a thirty-wave run gets ${drafts} drafts — a build cannot be recognisable by wave 20 on that`);
    assert(drafts <= Waves.BOONS.length * 0.6,
      `${drafts} drafts out of ${Waves.BOONS.length} cards means a run takes most of the table every time`);
    const fraction = drafts / Waves.BOONS.length;
    assert(fraction < 0.56, `a run takes ${(fraction * 100).toFixed(0)}% of the table — two runs will look the same`);

    // A whole run, drawn for real, must end up with a recognisable shape rather
    // than one of everything.
    let recognisable = 0;
    for (let run = 0; run < 200; run++) {
      const taken = new Set();
      for (let w = 1; w <= 20; w++) {
        if (!d.isDraftWave(w)) continue;
        const offer = Waves.drawBoons(d.draftSize(w), taken, w, { floor: d.isBossWave(w) ? 'rare' : null });
        if (offer.length) taken.add(offer[Math.floor(Math.random() * offer.length)].id);
      }
      const counts = {};
      for (const id of taken) for (const a of Waves.BOONS.find(b => b.id === id).axes) counts[a] = (counts[a] || 0) + 1;
      if (Math.max(0, ...Object.values(counts)) >= 3) recognisable++;
    }
    assert(recognisable > 120,
      `only ${recognisable} of 200 runs had 3 cards on any one axis by wave 20 — nothing commits`);
    return `${drafts} drafts / ${cards} cards offered in 30 waves against ${Waves.BOONS.length} boons; `
      + `${recognisable}/200 random-pick runs had an axis of 3+ by wave 20`;
  });

  check('waves: the draft cadence and the budget curve are the same decision', () => {
    const d = director();
    assert(Number.isFinite(Waves.BOON_POWER),
      'the ramp has no stated per-card power — the budget curve cannot be checked against the draft rate');
    // The old curve, verbatim, so the arithmetic is against something real.
    const old = (w) => 4 + w * 2.6 + Math.pow(w, 1.62) * 0.65;
    for (const w of [1, 5, 10, 20, 30, 40]) {
      const want = Math.floor(old(w) * Math.pow(Waves.BOON_POWER, (w - 1) / 6));
      assert(d.budgetFor(w) === want,
        `budgetFor(${w}) is ${d.budgetFor(w)} and the stated derivation gives ${want}`);
    }
    assert(d.budgetFor(1) === Math.floor(old(1)),
      'the opening moved — wave 1 is tuned and the compensation is zero there by construction');
    // and it is a compensation, not a free difficulty raise: the extra budget
    // must be no larger than the extra cards can plausibly answer.
    const extraCards = 30 / Waves.DRAFT_EVERY - 30 / 3;
    const answered = Math.pow(Waves.BOON_POWER, extraCards);
    const asked = d.budgetFor(30) / old(30);
    assert(Math.abs(asked - answered) < 0.02,
      `wave 30 asks ${asked.toFixed(2)}× more and the extra ${extraCards} cards answer ${answered.toFixed(2)}×`);
    return `budget ×${(d.budgetFor(10) / old(10)).toFixed(2)} at w10, ×${asked.toFixed(2)} at w30, `
      + `against ${extraCards} extra cards at ${Waves.BOON_POWER}× each`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  4. The conditional cards                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('boons: the technique layer wraps seams that still exist', () => {
    // Same contract as Cleaving Throw's: rename one of these on Player and this
    // fails, rather than half the boon table quietly going back to being prose.
    assert(typeof Player.prototype.update === 'function', 'Player.update is gone — boonTick has nothing to wrap');
    assert(typeof Player.prototype.damage === 'function', 'Player.damage is gone — boonGuard has nothing to wrap');
    assert(typeof Player.prototype.heal === 'function', 'Player.heal is gone');
    for (const fn of ['boonTick', 'boonFactor', 'boonGuard', 'boonOnSever']) {
      assert(typeof Waves[fn] === 'function', `Waves exports no ${fn} — a conditional card has nowhere to live`);
    }
    // and every one of them declines cleanly on something that is not a player
    assert(Waves.boonTick({}, 'x', () => {}) === false, 'boonTick claimed to install on an object with no update');
    assert(Waves.boonGuard({}, 'x', (a) => a) === false, 'boonGuard claimed to install on an object with no damage');
    assert(Waves.boonOnSever({}, 'x', () => {}) === false, 'boonOnSever claimed to install without a world');
    assert(Waves.boonFactor({}, 'cutPower', 'x', 2) === false, 'boonFactor wrote to a player with no boonMods');
    return 'update / damage / heal all present; all four installers decline on a non-player';
  });

  check('boons: every conditional card moves a real number while the fight runs', () => {
    const tick = (p, n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) p.update(dt, {}); };
    const rows = [];

    // ── Counterstroke: the riposte window is worth something, and only then
    {
      const p = driven();
      takeBoon(p, 'counterstroke');
      tick(p);
      const idle = p.boonMods.cutPower;
      p.riposteTimer = 0.5; tick(p);
      const open = p.boonMods.cutPower;
      p.riposteTimer = 0; tick(p);
      assert(open > idle * 1.5, `a riposte moved cutPower ${idle.toFixed(2)} → ${open.toFixed(2)}`);
      assert(Math.abs(p.boonMods.cutPower - idle) < 1e-6, 'the riposte bonus never went away');
      assert(p.boonMods.riposteWindow > 1, 'the window itself did not lengthen');
      rows.push(`counterstroke ${idle.toFixed(2)}→${open.toFixed(2)}`);
    }
    // ── Juyo: stacks up as you cut, cools down when you stop
    {
      const p = driven();
      takeBoon(p, 'juyo');
      tick(p);
      const cold = p.boonMods.cutPower;
      for (let i = 0; i < 4; i++) { p.limbsRemoved++; tick(p); }
      const hot = p.boonMods.cutPower;
      tick(p, 60 * 12);
      assert(hot > cold * 1.3, `four limbs moved cutPower ${cold.toFixed(2)} → ${hot.toFixed(2)}`);
      assert(Math.abs(p.boonMods.cutPower - cold) < 1e-6,
        `the edge never cooled (${p.boonMods.cutPower.toFixed(3)} after 12 s idle)`);
      rows.push(`juyo ${cold.toFixed(2)}→${hot.toFixed(2)}→cold`);
    }
    // ── Fury: the nearer death, the harder
    {
      const p = driven();
      takeBoon(p, 'fury');
      tick(p);
      const whole = p.boonMods.cutPower, wholeSpeed = p.boonMods.moveSpeed;
      p.hp = 10; tick(p);
      assert(p.boonMods.cutPower > whole * 1.4, `at 10% health cutPower is ${p.boonMods.cutPower.toFixed(2)}`);
      assert(p.boonMods.moveSpeed > wholeSpeed * 1.2, 'Fury does not move you faster when hurt');
      p.hp = 100; tick(p);
      assert(Math.abs(p.boonMods.cutPower - whole) < 1e-6, 'healing did not take the bonus back');
      rows.push(`fury ${whole.toFixed(2)}→${(1 + 0.7).toFixed(2)}`);
    }
    // ── Wellspring: a deeper well that fills faster
    {
      const p = driven();
      const before = p.maxForce;
      takeBoon(p, 'wellspring');
      assert(p.maxForce > before, 'the well is no deeper');
      p.force = 10; p.maxForce = 500;
      tick(p, 60);
      assert(p.force > 10 + 4, `a second of regeneration added ${(p.force - 10).toFixed(1)} Force`);
      rows.push(`wellspring +${(p.force - 10).toFixed(1)}/s`);
    }
    // ── Conduit: a kill hands the Force back
    {
      const p = driven();
      takeBoon(p, 'conduit');
      p.force = 10; tick(p);
      p.kills += 2; tick(p);
      assert(p.force > 10 + p.boonMods.conduit, `two kills returned ${(p.force - 10).toFixed(0)} Force`);
      rows.push(`conduit +${p.boonMods.conduit}/kill`);
    }
    // ── Bastion: the guard pays for itself, and the returns hit harder
    {
      const p = driven();
      const before = p.boonMods.deflectDamage;
      takeBoon(p, 'bastion');
      assert(p.boonMods.deflectDamage > before * 1.5, 'Bastion does not strengthen a return');
      p.stamina = 50; tick(p);
      p.deflects += 3; tick(p);
      assert(p.stamina > 50, `three deflections refunded ${(p.stamina - 50).toFixed(0)} stamina`);
      rows.push(`bastion +${(p.stamina - 50).toFixed(0)} stamina / 3 blocks`);
    }
    // ── Tempest: Flow buys the discount
    {
      const p = driven();
      takeBoon(p, 'tempest');
      p.flow = 0; tick(p);
      const dry = p.boonMods.forceCost;
      p.flow = 1; tick(p);
      assert(p.boonMods.forceCost < dry * 0.3, `at full Flow a power costs ${p.boonMods.forceCost.toFixed(2)}× base`);
      p.flow = 0; tick(p);
      assert(Math.abs(p.boonMods.forceCost - dry) < 1e-6, 'the discount stuck around after the Flow drained');
      rows.push(`tempest ×${dry.toFixed(2)}→×${(1 - 0.85).toFixed(2)}`);
    }
    // ── Undying: mends, but only once nothing has touched you
    {
      const p = driven();
      takeBoon(p, 'undying');
      p.hp = 40;
      tick(p, 60 * 3);
      assert(p.hp === 40, 'Undying healed while the fight was still on it');
      tick(p, 60 * 4);
      assert(p.hp > 40, 'Undying never mended anything');
      const mended = p.hp;
      p.hp = mended - 20;                    // a fresh wound restarts the clock
      tick(p, 60 * 2);
      assert(p.hp === mended - 20, 'a wound did not reset the out-of-combat clock');
      rows.push('undying mends after 5 s, resets on a hit');
    }
    // ── Steadfast: the big hits get halved and nothing staggers you
    {
      const p = driven();
      takeBoon(p, 'steadfast');
      p.damage(40, null, null, 'bolt');
      const heavy = p.hits[0];
      assert(heavy < 40 * 0.6, `a 40-point hit landed as ${heavy}`);
      p.hits.length = 0;
      p.damage(6, null, null, 'bolt');
      assert(p.hits[0] === 6, `a small hit was also reduced (${p.hits[0]}) — this card is about the heavy ones`);
      p.staggerTimer = 1; tick(p);
      assert(p.staggerTimer === 0, 'Steadfast did not clear a stagger');
      rows.push(`steadfast 40→${heavy}, 6→6`);
    }
    // ── Encircled: a crowd is cover
    {
      const p = driven();
      takeBoon(p, 'encircle');
      p.world.enemies = [];
      p.damage(30, null, null, 'bolt');
      const alone = p.hits.pop();
      p.world.enemies = Array.from({ length: 6 }, () => ({ dead: false, position: V(1, 0, 1) }));
      p.damage(30, null, null, 'bolt');
      const mobbed = p.hits.pop();
      assert(mobbed < alone * 0.85, `alone ${alone}, surrounded by six ${mobbed}`);
      rows.push(`encircle ${alone}→${mobbed.toFixed(1)} in a crowd of six`);
    }
    // ── Second Wind: once a wave, and the director hands the charge back
    {
      const p = driven();
      takeBoon(p, 'secondwind');
      p.hp = 30;
      p.damage(500, null, null, 'bolt');
      assert(p.hp > 0 && p.hp <= 40, `a lethal blow left ${p.hp} health`);
      assert(p.invuln > 1, 'Second Wind gave no room to get out');
      p.hp = 30;
      p.damage(500, null, null, 'bolt');
      assert(p.hp <= 0, 'Second Wind fired twice in one wave');
      Waves.refreshWaveBoons({ players: [p] });
      assert(p.boonMods.secondWind === 1, 'the charge did not come back at the top of the next wave');
      rows.push('secondwind: survives once, recharges on the wave');
    }
    return rows.join('; ');
  });

  check('boons: survival has a growth curve, and it is the blade attunement\'s own step', async () => {
    /**
     * OFFENCE COMPOUNDED AND DEFENCE DID NOT. Applied through the real
     * `BOONS[].apply` onto Player's real `defaultBoonMods`, taking every card
     * of its kind a wave-40 run can hold:
     *
     *     committed offence   cutPower  1.00 → 29.62     ×29.6
     *     committed defence   maxHp      100 → 292       ×2.9
     *     the wave itself     threat       7 → 425       ×61
     *
     * and an undirected run moves `maxHp` 0-9% over SIXTY waves. Offence
     * multiplies — Shatterpoint ×1.9, Djem So ×1.4, the blade attunement ×1.12
     * a rank and uncapped — while defence ADDS (Vitality +30, the body
     * attunement +18) or is a flat cap (the Aegis is a 22-point ward,
     * Encircled tops out at 42%). An additive pool against a multiplicative
     * threat curve is not a defensive build, it is a slightly later death, and
     * it left the deep waves with exactly one answer: kill it first.
     *
     * `attune-guard` was already the right shape — offered at every set-piece
     * forever, uncapped, repeatable, the heart of the guard current — and
     * granted `deflectDamage`, which is offence through deflection. This
     * asserts the axis exists and RACES: the same ATTUNE_STEP as the blade's,
     * in the opposite direction, so a rank makes the edge 12% deeper there and
     * a blow 12% shallower here.
     */
    const { defaultBoonMods } = await import('../../src/game/Player.js');
    const stub = () => ({
      maxHp: 100, hp: 100, maxStamina: 100, stamina: 100, maxForce: 100, force: 100,
      boonMods: defaultBoonMods(), control: { sensitivity: 1 }, kills: 0, deflects: 0,
      position: { distanceToSquared: () => 1e9 }, alive: true, world: { enemies: [] },
      heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); },
      damage(a) { this.hp -= a; return a; },
    });
    const build = (list) => {
      const p = stub(); const taken = new Waves.RankSet();
      for (const [id, n] of list) {
        const b = Waves.boonById(id);
        assert(b, `no such boon: ${id}`);
        for (let k = 0; k < n; k++) b.apply(p, Waves.rankScale(b, taken.take(id)));
      }
      return p;
    };
    const lands = (p) => { const before = p.hp; p.damage(50); return before - p.hp; };

    const bare = lands(build([]));
    assert(Math.abs(bare - 50) < 1e-6, `an unbuilt player takes ${bare} of a 50-point blow`);
    const rows = [];
    let prev = bare;
    for (const n of [1, 2, 4, 6, 10]) {
      const took = lands(build([['attune-guard', n]]));
      assert(took < prev,
        `${n} ranks of the Guard attunement takes ${took.toFixed(1)} of a 50-point blow against `
        + `the previous rank's ${prev.toFixed(1)} — the only defensive axis that is allowed to `
        + 'grow forever is not growing');
      prev = took;
      rows.push(`${n}:${took.toFixed(1)}`);
    }
    // The two attunements race on the SAME step, which is the property that
    // stops one of them standing still while the other compounds.
    const one = build([['attune-guard', 1]]);
    const blade = build([['attune-blade', 1]]);
    assert(Math.abs((1 - one.boonMods.ward) - Waves.ATTUNE_STEP) < 1e-9,
      `a rank of the Guard shallows a blow by ${(1 - one.boonMods.ward).toFixed(3)} against `
      + `ATTUNE_STEP ${Waves.ATTUNE_STEP} — the two axes are no longer racing on the same terms`);
    assert(Math.abs((blade.boonMods.cutPower - 1) - Waves.ATTUNE_STEP) < 1e-9,
      'the blade attunement no longer steps by ATTUNE_STEP');
    // …and nothing in this game may become unkillable.
    const deep = build([['attune-guard', 40]]);
    assert(lands(deep) >= 50 * Waves.WARD_FLOOR - 1e-9,
      `forty ranks takes ${lands(deep).toFixed(2)} of a 50-point blow — past the floor, `
      + 'a player who kept choosing one card cannot be hurt at all');
    // The committed build, which is what the complaint was about.
    const held = build([['attune-guard', 4], ['vitality', 4], ['attune-body', 4]]);
    const eff = held.maxHp * 50 / lands(held);
    assert(eff > 350,
      `a wave-40 defensive build is worth ${eff.toFixed(0)} effective hit points against an `
      + 'unbuilt 100 — offence reaches ×29.6 over the same run');
    return `a 50-point blow at guard ranks ${rows.join(' ')}; floor ${Waves.WARD_FLOOR}; `
      + `a committed wave-40 defence is ${eff.toFixed(0)} effective hp (was 292)`;
  });

  check('boons: two cards driving one multiplier compose instead of eating each other', () => {
    // The bug this exists for: a conditional card that remembers a base value
    // and writes `base × want` erases every flat card taken after it. There are
    // now four cards on cutPower alone.
    const p = driven();
    takeBoon(p, 'counterstroke');
    for (let i = 0; i < 5; i++) p.update(1 / 60, {});
    takeBoon(p, 'shatterpoint');          // a flat ×1.9, taken AFTER the tick installed
    takeBoon(p, 'fury');
    takeBoon(p, 'djemso');
    p.riposteTimer = 1; p.hp = 50;
    for (let i = 0; i < 5; i++) p.update(1 / 60, {});
    const want = 1.9 * 1.4 * p.boonMods.riposteCut * (1 + p.boonMods.fury * 0.5);
    assert(Math.abs(p.boonMods.cutPower - want) < 1e-3,
      `four cards on cutPower produced ${p.boonMods.cutPower.toFixed(4)} and should produce ${want.toFixed(4)}`);
    // and it comes all the way back down
    p.riposteTimer = 0; p.hp = 100;
    for (let i = 0; i < 5; i++) p.update(1 / 60, {});
    assert(Math.abs(p.boonMods.cutPower - 1.9 * 1.4) < 1e-6,
      `with both conditions off, cutPower settled at ${p.boonMods.cutPower.toFixed(6)} instead of ${(1.9 * 1.4).toFixed(6)}`);
    // ten thousand frames of driving it must not drift the static part away
    for (let i = 0; i < 4000; i++) {
      p.riposteTimer = i % 2 ? 1 : 0;
      p.update(1 / 60, {});
    }
    p.riposteTimer = 0;
    p.update(1 / 60, {});
    assert(Math.abs(p.boonMods.cutPower - 1.9 * 1.4) < 1e-9,
      `4000 frames of switching drifted the base to ${p.boonMods.cutPower}`);
    return `1.9 × 1.4 × ${p.boonMods.riposteCut} × fury composes exactly, and returns to ${(1.9 * 1.4).toFixed(2)} with no drift`;
  });

  check('boons: Djem So and Shatterpoint are no longer the same card', () => {
    // They both wrote cutPower and nothing else, ×1.55 against ×1.9, at the
    // same rarity out of the same pool: same mechanism, bigger number, so
    // Shatterpoint strictly dominated and one of the sixteen cards was dead.
    const dj = Waves.BOONS.find(b => b.id === 'djemso');
    const sh = Waves.BOONS.find(b => b.id === 'shatterpoint');
    assert(dj && sh, 'one of the two cards is gone');
    const chan = (boon) => {
      const p = driven();
      p.boons.add(boon.id);
      boon.apply(p);
      const keys = Object.keys(p.boonMods).filter(k => {
        const base = driven().boonMods;
        return p.boonMods[k] !== base[k];
      });
      return { keys: keys.sort(), cut: p.boonMods.cutPower };
    };
    const a = chan(dj), b = chan(sh);
    assert(a.keys.join(',') !== b.keys.join(',') || dj.rarity !== sh.rarity,
      `${dj.id} and ${sh.id} still move exactly ${a.keys.join(',')} at the same rarity — one of them dominates`);
    assert(a.cut < b.cut, 'the card with the extra effect also has the bigger number, which is dominance again');
    assert(dj.rarity === 'common' && sh.rarity === 'rare',
      `the bigger number must be the rarer card: ${dj.id} is ${dj.rarity}, ${sh.id} is ${sh.rarity}`);

    // and Form V's promise ("stagger harder") has to actually happen
    const world = gameWorld();
    const foe = spawn(world, 'trooper');
    settle(foe, world);
    const p = driven({ world: Object.assign(world, { players: [] }), position: V(0, 0, -3) });
    takeBoon(p, 'djemso');
    foe.position.set(0, 0, 0);
    foe.knockTimer = 0;
    const v0 = foe.velocity.clone();
    world.onLimbSevered(foe, 'armR', V(0, 1.2, 0), p);
    assert(foe.velocity.distanceTo(v0) > 1,
      'a Djem So cut did not move the body it cut — "stagger harder" is still only a sentence');
    assert(foe.knockTimer > 0 || foe.stunTimer > 0, 'the body was shoved but not staggered');
    foe.dispose();
    return `djemso ×${a.cut} + a ${p.boonMods.sunderShock} m/s shove (${dj.rarity}), `
      + `shatterpoint ×${b.cut} and nothing else (${sh.rarity})`;
  });

  check('boons: Sundering carries the stroke into a second body, once', () => {
    const world = gameWorld();
    const cuts = [];
    world._applyBladeEvent = (player, ev) => {
      cuts.push({ id: ev.target.id, bone: ev.bone });
      // the real World calls takeCut, which calls onLimbSevered again — which
      // is exactly the recursion the technique has to survive
      world.onLimbSevered(ev.target.enemy, ev.bone, ev.point, player);
    };
    const first = spawn(world, 'trooper');
    const second = spawn(world, 'trooper');
    const third = spawn(world, 'trooper');
    second.position.set(1.0, 0, 0);
    third.position.set(1.9, 0, 0);
    for (const e of world.enemies) settle(e, world);

    const p = driven({ world, position: V(0, 0, -2) });
    p.boons = new Set(['sunder']);
    takeBoon(p, 'sunder');
    world.onLimbSevered(first, 'armR', V(0.35, 1.2, 0), p);
    assert(cuts.length >= 1, 'Sundering did not carry into anything at all');
    assert(cuts.length === 1,
      `Sundering unzipped ${cuts.length} bodies from one cut — it must be one generation, not a chain reaction`);
    assert(cuts[0].id === second.id, `it carried into ${cuts[0].id} instead of the body standing next to the first`);

    // and nothing at all when there is nobody behind
    cuts.length = 0;
    third.position.set(40, 0, 40);
    second.position.set(40, 0, 44);
    for (const e of world.enemies) settle(e, world);
    world.onLimbSevered(first, 'armR', V(0, 1.2, 0), p);
    assert(cuts.length === 0, 'Sundering found a second body 40 m away');
    for (const e of world.enemies) e.dispose();
    return `one cut → one extra limb at ${p.boonMods.sunderReach} m, no chain, nothing at range`;
  });
}
