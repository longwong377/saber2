/**
 * BATTLEFRONT BORZ — an attack the game telegraphs has to be one the player can answer.
 *
 * THE BUG. `spin` — the spin cut, drawn by Ataru and by Juyo — shipped with
 * `to` equal to `from`:
 *
 *     spin: { from: D(1.0, 0.1, -0.2), to: D(1.0, 0.1, -0.2), tier: 'heavy', … }
 *
 * `DuelBrain.chambersWith` builds the attack's travel as `to − from`, which is
 * the zero vector; three's `normalize()` leaves a zero vector at zero, the dot
 * product against any swing is 0, and `0 < -0.55` is never true. So the one
 * heavy attack in the game could not be chambered by any swing in any
 * direction — while being telegraphed with everything the game has for
 * "counter this now": `heavy` carries `chamberable: true` and the label
 * "chamber or evade", `chamberOpen` opens for it, the 2100→2600 Hz chamber cue
 * plays, and the telegraph pulses at 1.5× amplitude. The player who did exactly
 * what the colour told them fell through to the guard-break branch, lost
 * 22 × 1.9 stamina and took the hit — and read it as the chamber system being
 * unreliable rather than as one move being broken, which is the worst possible
 * way for it to fail.
 *
 * WHAT THIS FILE HOLDS. Not "spin has a different `to` now" — that is a
 * transcription. The property is that every attack the game invites the player
 * to chamber CAN be chambered, and it is measured by driving the shipped
 * `chambersWith` against thousands of swing directions. A future attack authored
 * with a degenerate arc fails here the day it is written.
 */

import * as THREE from 'three';
import { ATTACKS, ATTACK_KEYS, FORMS, FORM_KEYS, TIER, DuelBrain, guardToWorld,
  duelRng } from '../../src/game/Duel.js';
import { World } from '../../src/game/World.js';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, enemyRng, applyModifier } from '../../src/game/Enemy.js';
import { DIFFICULTY } from '../../src/game/Combat.js';
import { clocked } from './_shared.mjs';

/** A DuelBrain with just enough of an owner to answer `chambersWith`. */
function brainFor(key) {
  const b = Object.create(DuelBrain.prototype);
  b.e = { facing: 0 };
  b.chamberOpen = true;
  b.attack = { ...ATTACKS[key] };
  return b;
}

/** How many of `n` uniformly random unit directions chamber this attack. */
function chamberable(key, n = 4000) {
  const b = brainFor(key);
  const v = new THREE.Vector3();
  let hits = 0;
  // A deterministic low-discrepancy sweep rather than Math.random(): the same
  // directions every run, and no dependence on a shared stream.
  for (let i = 0; i < n; i++) {
    const z = 2 * ((i + 0.5) / n) - 1;
    const a = i * 2.399963229728653;                 // the golden angle
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    v.set(s * Math.cos(a), z, s * Math.sin(a));
    if (b.chambersWith(v)) hits++;
  }
  return hits / n;
}


/* ── the dual-wielder's second blade ─────────────────────────────────── */

const flatGround = () => ({
  height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
  size: 400, half: 200, inBounds: () => true, surfaceAt: () => 'sand',
  crater() {}, flush() {}, slopeAt: () => 0,
});

/* ── the picture, as the player is actually shown it ─────────────────── */

/**
 * THE GHOST OF EVERY ATTACK, READ OFF THE SHIPPED TELEGRAPH'S OWN BUFFER.
 *
 * Not `to.angleTo(from)`, which is the authored arc, and not `to − from`, which
 * is what `chambersWith` normalises away. `Telegraph.shape` is the thing the
 * player looks at: it slerps `from` to `to` across `n` samples and lays a
 * ribbon between the radius the blade starts at and the radius its tip reaches,
 * both read off the real `Saber` by `_drawTelegraph`. So the shape is built
 * here by driving that method on a real posed duellist and reading the vertex
 * positions back.
 *
 * ONE POSE FOR ALL TEN, AND IT IS THE CONSERVATIVE ONE. The hands sit further
 * out for an attack carrying `reach` — `_poseSaber` puts them at
 * `(0.34 + reach) * S` — so a thrust's ghost is really drawn at a LARGER radius
 * than this, and a larger radius is a longer arc for the same angle. Measuring
 * every attack at the guard radius understates exactly the two attacks with
 * reach on them and nothing else, so what comes out is a floor rather than an
 * estimate.
 *
 * Returns, per attack: the polyline the OUTER edge draws, the WIDTH of the
 * ribbon (which is the blade's own length plus its padding), and the length of
 * that polyline. A shape wider than it is long is a spoke.
 */
function ghosts() {
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flatGround();
  physics.terrain = terrain;
  const target = { position: new THREE.Vector3(0, 0, 0), velocity: new THREE.Vector3(),
    chest: new THREE.Vector3(0, 1.3, 0), hp: 5000, maxHp: 5000, alive: true, invuln: 0,
    crouch: 0, radius: 0.34, camera: { addShake() {} }, damage() {} };
  const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
    plasma: { spawn() {} }, smoke: { spawn() {} } };
  const w = {
    scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    difficulty: DIFFICULTY.knight,
    players: [target], enemies: [], props: [], doors: [], locks: [],
    particles, bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
  enemyRng.seed(4711); duelRng.seed(8123);
  const e = new Enemy(w, 'acolyte', new THREE.Vector3(0, 0, -2.2));
  e.position.set(0, 0, -2.2);
  w.enemies.push(e);
  const ctx = { enemies: w.enemies, particles, terrain, physics, bolts: w.bolts,
    time: 0, pickTarget: () => target, camera: w.engine.camera };
  // let the animator pose the body, so the chest bone and the blade are where
  // the game puts them rather than where a rest pose does
  for (let i = 0; i < 60; i++) { ctx.time = w.time += 1 / 60; e.update(1 / 60, ctx); }

  const out = {};
  const n = e.telegraphArc.n;
  for (const key of ATTACK_KEYS) {
    e.duel.attack = { ...ATTACKS[key] };
    e.duel.attackKey = key;
    e.lod = 0;                                   // `_drawTelegraph` fades by LOD
    e.duel._drawTelegraph(1, 1, 1);
    const pos = e.telegraphArc.pos;
    const inner = [], outer = [];
    for (let i = 0; i < n; i++) {
      inner.push(new THREE.Vector3(pos[i * 6], pos[i * 6 + 1], pos[i * 6 + 2]));
      outer.push(new THREE.Vector3(pos[i * 6 + 3], pos[i * 6 + 4], pos[i * 6 + 5]));
    }
    let len = 0;
    for (let i = 1; i < n; i++) len += outer[i].distanceTo(outer[i - 1]);
    out[key] = { inner, outer, len, width: outer[0].distanceTo(inner[0]), n,
      tier: ATTACKS[key].tier, label: ATTACKS[key].label };
  }
  for (const x of w.enemies) x.dispose?.();
  return out;
}
let _ghosts = null;
const drawn = () => (_ghosts ??= ghosts());

/**
 * A dual-wielding acolyte against one target for `seconds`, counting each
 * blade's hits separately. `answer` picks what the player does about the second
 * blade: nothing, hold their own blade on it, or stand outside its reach.
 */
function dualist({ answer = 'none', seconds = 45 } = {}) {
  enemyRng.seed(4711);
  duelRng.seed(8123);
  const physics = new RapierWorld({ gravity: -24, iterations: 4, maxBodies: 400 });
  const terrain = flatGround();
  physics.terrain = terrain;
  let main = 0, off = 0, mainDmg = 0, offDmg = 0, swings = 0;
  let inOff = false;
  const at = answer === 'range' ? 4.6 : 0;
  const target = {
    position: new THREE.Vector3(0, 0, at), velocity: new THREE.Vector3(),
    chest: new THREE.Vector3(0, 1.3, at),
    hp: 5000, alive: true, invuln: 0, crouch: 0, radius: 0.34,
    camera: { addShake() {} },
    damage(d) { if (inOff) { off++; offDmg += d; } else { main++; mainDmg += d; } },
  };
  const particles = { sandPuff() {}, muzzle() {}, sparkBurst() {}, cutFlare() {}, slag() {},
    plasma: { spawn() {} }, smoke: { spawn() {} } };
  const w = {
    scene: new THREE.Scene(), physics, terrain, statics: [],
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    players: [target], enemies: [], props: [], doors: [], locks: [],
    particles, bolts: { fire() {}, update() {}, threatsNear: () => [] },
    time: 0, combatIntensity: 0, groundColor: 0xcfae82,
    engine: { addHeat() {}, hurt() {}, flash() {}, setRadial() {},
      camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {}, notify() {}, notifyFloating() {}, addHitstop() {},
    onDeflectFeedback() {}, onEnemyKilled() {}, onLimbSevered() {}, onHitmark() {},
    onExplosion() {}, spawnDebrisGroup() {},
  };
  const e = new Enemy(w, 'acolyte', new THREE.Vector3(0, 0, -3));
  applyModifier(e, 'dualist');
  e.position.set(0, 0, -3);
  w.enemies.push(e);
  const ctx = { enemies: w.enemies, particles, terrain, physics, bolts: w.bolts,
    time: 0, pickTarget: () => target, camera: w.engine.camera };
  const raw = Object.getPrototypeOf(e)._offhandStrike;
  e._offhandStrike = function (dt, c) {
    const was = this._offSwung;
    inOff = true; raw.call(this, dt, c); inOff = false;
    if (!was && this._offSwung) swings++;
  };
  const dt = 1 / 60;
  for (let i = 0; i < seconds / dt; i++) {
    ctx.time = w.time += dt;
    /* THE PARRY, as the code that matters sees it: `bladesTouching(t.saber,
     * this.offSaber)`. A stub saber whose segment lies on the off blade's is
     * exactly the state a player holding their guard against it is in, and it
     * is what the main blade already stands down for. */
    if (answer === 'parry' && e.offSaber) {
      target.saber = { base: e.offSaber.base.clone(), tip: e.offSaber.tip.clone(),
        prevBase: e.offSaber.prevBase.clone(), prevTip: e.offSaber.prevTip.clone(),
        radius: e.offSaber.radius ?? 0.05, on: true, ignition: 1, length: e.offSaber.length ?? 1.1 };
    }
    if (answer === 'range') {
      // hold the line, out of the second blade's reach
      const away = new THREE.Vector3().subVectors(target.position, e.position).setY(0);
      const d = away.length();
      if (d < 4.6) target.position.addScaledVector(away.divideScalar(d || 1), (4.6 - d));
    }
    e.update(dt, ctx);
    target.chest.copy(target.position).setY(1.3);
    target.hp = 5000;
    physics.step(dt);
  }
  for (const x of w.enemies) x.dispose?.();
  return { main, off, mainDmg, offDmg, swings };
}

export async function run({ check, assert }) {
  /* Every check in this file is wrapped, so the shared module state goes back
   * before each body as well as after it. What that state IS lives in
   * tools/checks/_shared.mjs and is deliberately not restated here — a list
   * copied into thirty-three files is a list that drifts from thirty-three.
   */
  check = await clocked(check);
  await initPhysics();
  check('answerable: every attack the game says to chamber, a swing can chamber', () => {
    /**
     * `TIER[tier].chamberable` is what opens the window and prints the prompt,
     * so it is exactly the set that has to be answerable. The bar is 1% of the
     * sphere, which is far below the ~22% a well-formed arc scores and far
     * above the 0% a degenerate one does — the failure being caught is total,
     * not marginal.
     */
    const rows = [];
    for (const [key, a] of Object.entries(ATTACKS)) {
      if (!TIER[a.tier]?.chamberable) continue;
      const frac = chamberable(key);
      assert(frac > 0.01,
        `${key} ("${a.label}") is telegraphed as chamberable and ${frac === 0 ? 'NO' : `only ${(frac * 100).toFixed(2)}% of`} `
        + 'swing directions chamber it — the game opens the window, plays the cue and pulses the '
        + 'arc for an answer the player cannot give');
      rows.push(`${key} ${(frac * 100).toFixed(1)}%`);
    }
    assert(rows.length >= 3, `only ${rows.length} attacks are chamberable at all`);
    return `${rows.length} chamberable attacks, share of the sphere that answers each: ${rows.join(', ')}`;
  });

  check('answerable: no authored attack has a degenerate arc', () => {
    /* The root cause, stated directly, because it is also what makes the
     * TELEGRAPH wrong: `Telegraph.shape` interpolates between the two
     * endpoints, so `to === from` draws a single radial spoke where the player
     * is looking for an arc. Every one of `spin`'s five telegraph samples was
     * byte-identical.
     *
     * This clause is the ZERO. It is kept because it is the cheapest possible
     * statement of the failure and it names the mechanism, but on its own it is
     * not enough and it PASSED for a session while two attacks drew a spoke —
     * see the check below, which measures the picture instead of the algebra. */
    const rows = [];
    for (const [key, a] of Object.entries(ATTACKS)) {
      const d = new THREE.Vector3().copy(a.to).sub(a.from);
      assert(d.lengthSq() > 1e-6,
        `${key} ("${a.label}") has to === from, so it has no travel: chambersWith normalises a zero `
        + 'vector and the telegraph draws a spoke instead of an arc');
      rows.push(`${key} ${d.length().toFixed(2)}`);
    }
    return `${rows.length} attacks, chord ${Math.min(...rows.map((r) => +r.split(' ')[1])).toFixed(2)}`
      + `–${Math.max(...rows.map((r) => +r.split(' ')[1])).toFixed(2)} in guard space`;
  });

  check('answerable: the ghost of every attack is an arc, not a spoke', () => {
    /**
     * THE `spin` DEFECT ONE STEP SHORT OF TOTAL, AND THE CHECK ABOVE COULD NOT
     * SEE IT.
     *
     * `to === from` draws a radial spoke — the `spin` note says so in those
     * words. `to` a few degrees off `from` draws the same picture, and the
     * clause above passes it, and so did this file's pass line: "arc lengths
     * 0.15–1.95" with no floor under it. Two attacks were living down there:
     *
     *     attack      span     drawn arc   ribbon width   arc/width
     *     thrust       8.5°      0.29 m       1.19 m        0.25
     *     lunge       12.5°      0.43 m       1.19 m        0.36
     *
     * `thrust` is `light`, so the game opens the chamber window for it, plays
     * the cue and pulses the arc — and it is 33% of a Jedi Master's declared
     * attacks and 27% of a Sentinel's. A third of everything the two most-
     * fought duellists in the game throw arrived as a line the player could
     * not read, and `chambersWith` never noticed because it normalises the
     * travel: the maths was fine and the picture was not.
     *
     * SO THIS MEASURES THE PICTURE. It drives the shipped `_drawTelegraph` on a
     * real posed acolyte and reads `Telegraph.pos` — the actual vertices the
     * player is shown — then compares the length of the arc against the WIDTH
     * of the ribbon it is drawn as. The width is not a chosen number: it is the
     * blade's own length plus `TELE_PAD`, which is what `_drawTelegraph` lays
     * between its two radii. A shape that is wider than it is long is a spoke.
     * That is the whole bound, and it is a fact about ribbons rather than a
     * taste about arcs.
     */
    const g = drawn();
    const rows = [];
    for (const key of ATTACK_KEYS) {
      const s = g[key];
      assert(s.width > 0.5, `${key}'s ghost is ${s.width.toFixed(2)} m wide — the fixture is not `
        + 'drawing a blade at all');
      assert(s.len > s.width,
        `${key} ("${s.label}") draws a ghost ${s.len.toFixed(2)} m long and ${s.width.toFixed(2)} m `
        + 'wide — that is a radial spoke, which is exactly the picture the `spin` fix names, and the '
        + 'player cannot tell it from any other spoke or from a degenerate arc');
      rows.push(`${key} ${(s.len / s.width).toFixed(2)}`);
    }
    const worst = rows.reduce((a, b) => (+a.split(' ')[1] < +b.split(' ')[1] ? a : b));
    return `${rows.length} ghosts, arc/width ${rows.map((r) => r.split(' ')[1]).sort((a, b) => a - b)[0]}`
      + `–${rows.map((r) => +r.split(' ')[1]).sort((a, b) => b - a)[0].toFixed(2)}; narrowest ${worst}`;
  });

  check('answerable: two attacks that want the same answer do not draw the same picture', () => {
    /**
     * The other half of legibility. An arc's COLOUR says which of the three
     * answers it wants — that is TIER, and it is the contract the file header
     * states — so two attacks in different tiers are already told apart by the
     * one thing the player reads first. Two attacks in the SAME tier have only
     * their shape, and if that shape is the same the player is being asked to
     * distinguish two things that look identical.
     *
     * Measured as the largest separation between the two drawn outer edges,
     * sample for sample, in units of the ribbon's own width — so "these two
     * ghosts never pull apart by half a blade" is the failure. `thrust` and
     * `lunge` sat at 0.13 widths before the arcs were re-authored, which is two
     * spokes four degrees apart.
     */
    const g = drawn();
    const pairs = [];
    for (let i = 0; i < ATTACK_KEYS.length; i++) {
      for (let j = i + 1; j < ATTACK_KEYS.length; j++) {
        const a = ATTACK_KEYS[i], b = ATTACK_KEYS[j];
        const A = g[a], B = g[b];
        let m = 0;
        for (let k = 0; k < A.n; k++) m = Math.max(m, A.outer[k].distanceTo(B.outer[k]));
        pairs.push({ a, b, rel: m / ((A.width + B.width) / 2), sameTier: A.tier === B.tier });
      }
    }
    const same = pairs.filter((p) => p.sameTier);
    assert(same.length >= 3, `only ${same.length} pairs of attacks share a tier at all`);
    const worst = same.reduce((x, y) => (x.rel < y.rel ? x : y));
    assert(worst.rel > 0.5,
      `${worst.a} and ${worst.b} are both ${g[worst.a].tier} — the same colour, the same answer — and `
      + `their ghosts never separate by more than ${worst.rel.toFixed(2)} of a blade's width. The `
      + 'player is being shown one picture for two attacks');
    const closest = pairs.reduce((x, y) => (x.rel < y.rel ? x : y));
    return `${same.length} same-tier pairs, closest ${worst.a}/${worst.b} at ${worst.rel.toFixed(2)} `
      + `blade-widths apart; closest of all ${closest.a}/${closest.b} at ${closest.rel.toFixed(2)}`;
  });

  check('answerable: the chamber window is long enough to hit and the cue arrives before it', () => {
    /**
     * CAN A HUMAN ACTUALLY CHAMBER? Measured, rather than assumed — and the
     * answer on the code this replaces was no, twice over.
     *
     * The window is the tail of the wind-up and the wind-up scales with
     * difficulty, so a form that reads faster got a shorter window twice over.
     * Driven through the shipped brain, wall-clock seconds with `chamberOpen`
     * true, per form, at Knight and at Grandmaster, and again for a CHAINED
     * attack (the follow-up wind-up is 0.72 of a first):
     *
     *                Knight   Grandmaster   chained, Grandmaster
     *     djemSo     0.216 s     0.172 s          0.124 s
     *     soresu     0.168       0.134            0.097
     *     makashi    0.135       0.108            0.077
     *     ataru      0.112       0.089            0.064
     *     juyo       0.078       0.062            0.045
     *
     * Worst of twelve draws of the wind-up jitter, which is the corner a player
     * actually meets. Forty-five milliseconds is under three frames at 60 Hz.
     *
     * AND THE CUE FIRED AT THE START OF THE WINDOW. `audio.tone` at 2100→2600
     * Hz, on the frame `chamberOpen` went true, for a window shorter than a
     * human's reaction to the sound: simple auditory RT is around 160 ms, and a
     * chamber is not a simple reaction — it is a swing, in a chosen direction,
     * that has to arrive with the blade already moving at 5.5 m/s and touching
     * the incoming one. So the cue could only ever mean "you have just missed
     * it", and the only way to chamber anything was to pre-empt off the arc's
     * fill and never off the sound the game plays for it.
     *
     * Two properties, both stated here as requirements on the GAME rather than
     * as transcriptions of the constants that satisfy them:
     *
     *   NOBODY IS ASKED TO HIT A WINDOW THEY CANNOT HOLD. A practised human
     *   timing an event they can see coming lands inside roughly ±90 ms, so a
     *   window under 0.15 s is one nobody can hold.
     *
     *   THE CUE LEADS THE WINDOW. Never after it opens, and by at least a
     *   reaction time wherever the wind-up is long enough to hold one.
     *
     * This is the necessary half and not the sufficient one: the player also
     * has to get their blade onto the incoming blade and swing it into the
     * travel, which `chambersWith` and the check above hold.
     */
    const HUMAN_HOLD = 0.15;         // the shortest window a human can hit
    const HUMAN_REACT = 0.12;        // …and the least warning worth sounding
    /** One declared attack, driven through the shipped brain at 600 Hz. */
    const declare = (key, diff, chained) => {
      const b = Object.create(DuelBrain.prototype);
      const e = {
        saberPhase: 'guard', saberTimer: 0, facing: 0, lod: 0,
        position: new THREE.Vector3(), A: { scale: 1 },
        saber: { base: new THREE.Vector3() },
        world: { difficulty: DIFFICULTY[diff] },
        target: null, toTarget: null,
      };
      Object.assign(b, {
        e, form: FORMS[key], formKey: key, telegraph: null, timeScale: 1,
        guardDir: new THREE.Vector3(0, 0, -1), restDir: new THREE.Vector3(0, 0, -1),
        attack: null, attackKey: null, chainLeft: 0, lungeSpeed: 0, spin: 0,
        chamberOpen: false, readTimer: 1, _cued: false, followUps: 0,
      });
      Object.defineProperty(b, 'phase', { get: () => e.saberPhase, set: (v) => { e.saberPhase = v; } });
      Object.defineProperty(b, 'timer', { get: () => e.saberTimer, set: (v) => { e.saberTimer = v; } });
      // A LIGHT attack, so the tier is chamberable and a window exists at all.
      b._beginAttack(b._speed(), chained);
      b.attackKey = 'slashR';
      b.attack = { ...ATTACKS.slashR };
      const windup = b.timer;
      const dt = 1 / 600;                     // finer than a frame, so the
      let t = 0, open = 0, cueAt = null, openAt = null;   // edges are sharp
      while (b.phase === 'windup' && t < 5) {
        b.update(dt, {}, 2.0);
        t += dt;
        if (b._cued && cueAt === null) cueAt = t;
        if (b.chamberOpen) { open += dt; if (openAt === null) openAt = t; }
      }
      return { windup, open, cueAt, openAt, lead: openAt === null ? null : openAt - cueAt };
    };

    const cells = [];
    for (const key of FORM_KEYS) {
      for (const diff of Object.keys(DIFFICULTY)) {
        for (const chained of [false, true]) {
          duelRng.seed(4242 + FORM_KEYS.indexOf(key) * 7);
          // TWELVE, because the wind-up is jittered — ±8% on a disciplined form
          // and 0.7–1.4 on an erratic one — and a single draw measures one
          // corner of that. The worst of the twelve is what a player meets.
          let worst = null;
          for (let i = 0; i < 12; i++) {
            const r = declare(key, diff, chained);
            assert(r.open > 0, `${key} at ${diff}${chained ? ' (chained)' : ''} never opened the window`);
            assert(r.cueAt !== null, `${key} at ${diff}${chained ? ' (chained)' : ''} never sounded the cue`);
            if (!worst || r.open < worst.open) worst = r;
          }
          cells.push({ key, diff, chained, ...worst });
        }
      }
    }

    for (const c of cells) {
      const tag = `${c.key} at ${c.diff}${c.chained ? ', chained' : ''}`;
      /* THE INVARIANT, AND IT IS THE ONE THAT WOULD CATCH A REGRESSION. The
       * window cannot be longer than the wind-up it is the tail of, so what the
       * game owes the player is EVERYTHING THE WIND-UP HAS, up to the floor. A
       * window re-derived as a share of the wind-up — which is what it was —
       * fails this the moment a form reads fast. */
      assert(c.open >= Math.min(HUMAN_HOLD, c.windup) - 2e-3,
        `${tag} holds the chamber window open for ${(c.open * 1000).toFixed(0)} ms out of a `
        + `${(c.windup * 1000).toFixed(0)} ms wind-up — the window is a share of the wind-up again, so `
        + 'the forms that read fastest have the smallest window twice over');
      /* THE CUE. Never after the window opens, and by a reaction time wherever
       * the wind-up is long enough to hold one — the cue cannot be sounded
       * before the arc goes up, which is all the room there is. */
      const room = c.windup - c.open;
      assert(c.lead >= Math.min(HUMAN_REACT, room) - 2e-3,
        `${tag} sounds the chamber cue ${(c.lead * 1000).toFixed(0)} ms ahead of the window with `
        + `${(room * 1000).toFixed(0)} ms of wind-up available — a cue you cannot react to in time only `
        + 'ever tells the player they have already missed');
    }

    /**
     * AND THE ONE THE GAME IS ACTUALLY PLAYED ON. `Menu.js` ships
     * `difficulty: 'knight'`, so that is the setting the fairness contract has
     * to hold at without qualification: every OPENING attack of every form is
     * chamberable by a human.
     *
     * The residue, stated rather than hidden: a CHAINED attack — the second and
     * later beats of a flurry — runs at 0.72 of a first wind-up, and on the
     * fast forms that is a whole wind-up of 159–160 ms at Knight and 126–128 ms
     * at Grandmaster. The window is the whole of it and the whole of it is
     * still under what a human can hold, so those beats cannot be chambered by
     * anybody and no widening inside this file can change that: the window
     * cannot outlast the arc. That is a deliberate reading of `chain: [2, 4]`
     * and the tell that goes with it ("it will not stop at one") — a flurry is
     * answered by moving, not by countering every beat — and it is named here
     * so that it is a decision rather than an oversight.
     */
    const opening = cells.filter((c) => !c.chained && c.diff === 'knight');
    for (const c of opening) {
      assert(c.open > HUMAN_HOLD,
        `${c.key} opens with a ${(c.open * 1000).toFixed(0)} ms chamber window at the difficulty the `
        + `game ships on — ${(c.open * 60).toFixed(1)} frames at 60 Hz, and nothing human can be asked `
        + 'to land a directional swing inside it');
    }
    const short = cells.filter((c) => c.open <= HUMAN_HOLD);
    assert(short.every((c) => c.chained),
      `${short.filter((c) => !c.chained).map((c) => `${c.key}/${c.diff}`).join(', ')} declare an OPENING `
      + 'attack whose whole wind-up is under what a human can time');
    return `knight, opening: ${opening.map((c) => `${c.key} ${(c.open * 1000).toFixed(0)}ms `
      + `(+${(c.lead * 1000).toFixed(0)}ms cue)`).join(', ')}; `
      + `${short.length} of ${cells.length} cells are under ${(HUMAN_HOLD * 1000) | 0} ms and every one `
      + 'is a chained follow-up whose whole wind-up is shorter than that';
  });

  check('answerable: every form draws only attacks that exist', () => {
    /* Cheap, and it is the guard that stops the fix above being undone by a
     * form naming a key that was renamed. */
    let n = 0;
    for (const k of FORM_KEYS) {
      const f = FORMS[k];
      for (const m of (f.moves || [])) {
        assert(ATTACKS[m], `${f.name} draws "${m}", which is not an attack`);
        n++;
      }
    }
    // and the spin cut is still reachable, or the fix above defends nothing
    const spinners = FORM_KEYS.filter((k) => (FORMS[k].moves || []).includes('spin'));
    assert(spinners.length >= 1, 'no form draws the spin cut any more');
    return `${FORM_KEYS.length} forms, ${n} move slots, all real; spin is drawn by ${spinners.join(', ')}`;
  });

  check('answerable: a successful chamber does not throw out of the frame loop', () => {
    /**
     * THE ONE THE SUITE COULD NOT SEE, and it was total.
     *
     * `World._applyClash`'s chamber branch called `duel.interrupt(0.85)` — whose
     * second line is `this.attack = null` — and then, eleven lines later, read
     * `duel.attack.label` to name the attack in the deflect feedback. So the
     * FIRST successful chamber in a run threw `Cannot read properties of null`
     * straight out of `World.update`.
     *
     * It did not hard-freeze the page, which is why it could hide: main.js
     * re-arms rAF at the TOP of frame(), so the loop kept turning. What it did
     * was abandon the rest of that frame — bolts, `physics.step`, props, doors,
     * debris, particles, `terrain.flush`, the director, the net tick, the HUD,
     * the render, and `input.end()`, which is the call that clears
     * `mouse.dx/dy` and the one-shot `pressed` set. And `profiler.begin()` ran
     * with no matching `end()`.
     *
     * `tools/checks/duelling.mjs` covers chambering — by RE-IMPLEMENTING this
     * branch, and its copy has no label dereference in it. That is the whole
     * lesson: a check that rebuilds the code under test agrees with itself. So
     * this one calls the SHIPPED `World.prototype._applyClash`, with the same
     * `onDeflectFeedback` handler main.js installs, and simply requires that it
     * returns.
     */
    const calls = [];
    const w = Object.create(World.prototype);
    Object.assign(w, {
      time: 10, particles: { cutFlare() {}, sparkBurst() {}, slag() {} },
      engine: { flash() {}, addHeat() {} },
      addHitstop() {}, notifyFloating() {}, report() {},
      onDeflectFeedback: (grade, at, why) => calls.push({ grade, why }),
    });

    const duel = Object.create(DuelBrain.prototype);
    const key = 'overhead';
    Object.assign(duel, {
      e: { facing: 0 }, chamberOpen: true, phase: 'windup',
      attack: { ...ATTACKS[key] }, chainLeft: 0, telegraph: null,
      followUp() {},
    });
    // `interrupt` writes through the `timer` accessor onto its owner
    Object.defineProperty(duel, 'timer', { set(v) { this._t = v; }, get() { return this._t; } });

    // A swing driven straight against the declared arc, fast enough to qualify.
    const travel = guardToWorld(
      new THREE.Vector3().copy(ATTACKS[key].to).sub(ATTACKS[key].from).normalize(), 0, 0,
      new THREE.Vector3());
    const swing = travel.clone().multiplyScalar(-12);

    const at = new THREE.Vector3(0, 1.3, -1);
    const player = {
      saber: { strain() {}, pointAt: (t, o) => o.set(0, 1.2, -1.4),
        baseVelocity: swing.clone(), tipVelocity: swing.clone(),
        color: { getHex: () => 0x4fc3ff } },
      camera: { addShake() {} }, control: { hitImpulse() {} },
      boonMods: {}, score: 0, stamina: 100, riposteTimer: 0, addFlow() {},
      position: new THREE.Vector3(0, 0, 0), velocity: new THREE.Vector3(),
      damage() {}, invuln: 0,
    };
    const enemy = {
      duel, saber: { strain() {}, color: { getHex: () => 0xff5a4a } },
      stun() {}, position: new THREE.Vector3(0, 0, -2), attackDamage: 8,
    };

    let threw = null;
    try {
      w._applyClash(player, enemy, { point: at, power: 0.8, normal: new THREE.Vector3(0, 1, 0) });
    } catch (e) { threw = e; }
    assert(!threw,
      `the shipped chamber branch threw ${threw && threw.message} — every remaining step of that `
      + 'frame is abandoned, including input.end(), which clears the mouse delta and the one-shot '
      + 'press set');
    assert(player.score === 160, `the chamber did not award its score (${player.score})`);
    assert(duel.attack === null, 'the chamber did not interrupt the attack');
    assert(calls.length === 1 && /chambered/.test(calls[0].why),
      `the chamber reported ${JSON.stringify(calls)} to the feedback hook`);
    assert(/overhead|chambered \w/.test(calls[0].why),
      `the feedback lost the attack's name: "${calls[0].why}"`);
    return `the shipped _applyClash chambers, interrupts and reports "${calls[0].why}" without throwing`;
  });

  check("answerable: the dual-wielder's second blade can be answered", () => {
    /**
     * THE BUG. `_offhandStrike` was one line — `if (this.offHand.distanceTo(
     * t.chest) > reach) return;` at 2.10 m for an acolyte — with no arc, no
     * facing, and no stand-down when the player's own blade was on it. The main
     * blade twenty lines away sweeps its real geometry in eight sub-steps and
     * stands down at `bladesTouching`. Measured over 45-second fights: 18
     * main-blade hits from 164 strike phases (11%), and 148 off-hand hits out
     * of 148 windows — a 100% connect rate — for 2628 hp against the answerable
     * blade's 577.
     *
     * The header over that function claims "the telegraph you already read
     * still tells you when to move, and the answer to a dual-wielder is to be
     * gone by the second beat". Both halves of that are asserted here as
     * things a player can actually do, and both were false.
     */
    const plain = dualist({ answer: 'none' });
    assert(plain.swings > 8, `the dualist swung its off blade only ${plain.swings} times in 45 s`);
    assert(plain.off > 0,
      'the second blade never lands at all on a target standing still and doing nothing about it — '
      + 'that is a deletion, not a fix');
    assert(plain.offDmg < plain.mainDmg * 2.5,
      `the second blade did ${(plain.offDmg / plain.mainDmg).toFixed(1)}x the damage of the blade the `
      + 'player can parry — the half of the elite with no answer must not be the half that kills you');

    const parried = dualist({ answer: 'parry' });
    assert(parried.off === 0,
      `holding a blade against the second blade still ate ${parried.off} hits — steel on steel stands `
      + 'the MAIN blade down and did nothing to this one');

    const backed = dualist({ answer: 'range' });
    assert(backed.off === 0,
      `standing outside the second blade's reach still ate ${backed.off} hits — "be gone by the second `
      + 'beat" is what the code says the answer is');

    return `off blade: ${plain.off} hits / ${plain.swings} swings unanswered `
      + `(${(plain.offDmg / plain.mainDmg).toFixed(2)}x the main blade's damage), `
      + `${parried.off} when parried, ${backed.off} at range`;
  });
}
