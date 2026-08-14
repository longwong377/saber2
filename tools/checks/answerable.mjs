/**
 * SABER — an attack the game telegraphs has to be one the player can answer.
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
import { ATTACKS, FORMS, FORM_KEYS, TIER, DuelBrain, guardToWorld } from '../../src/game/Duel.js';
import { World } from '../../src/game/World.js';

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

export async function run({ check, assert }) {
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
}
