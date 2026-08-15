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
import { ATTACKS, FORMS, FORM_KEYS, TIER, DuelBrain, guardToWorld, duelRng } from '../../src/game/Duel.js';
import { World } from '../../src/game/World.js';
import { initPhysics } from '../../src/physics/Rapier.js';
import { RapierWorld } from '../../src/physics/RapierWorld.js';
import { Enemy, enemyRng, applyModifier } from '../../src/game/Enemy.js';

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
     * byte-identical. */
    const rows = [];
    for (const [key, a] of Object.entries(ATTACKS)) {
      const d = new THREE.Vector3().copy(a.to).sub(a.from);
      assert(d.lengthSq() > 1e-6,
        `${key} ("${a.label}") has to === from, so it has no travel: chambersWith normalises a zero `
        + 'vector and the telegraph draws a spoke instead of an arc');
      /* …and it has to be a direction a player can read, not a rounding error.
       * The floor is 5 cm rather than something larger because `thrust` is
       * legitimately the shortest at 14.8 cm — a thrust drives forward, it does
       * not sweep — and a bound that failed it would be a bound written from
       * the sweeping attacks and applied to a stab. What is being caught here
       * is zero. */
      assert(d.length() > 0.05,
        `${key} sweeps only ${(d.length() * 100).toFixed(1)} cm of guard space — that is not a direction`);
      rows.push(`${key} ${d.length().toFixed(2)}`);
    }
    return `${rows.length} attacks, arc lengths ${Math.min(...rows.map((r) => +r.split(' ')[1])).toFixed(2)}`
      + `–${Math.max(...rows.map((r) => +r.split(' ')[1])).toFixed(2)} in guard space`;
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
