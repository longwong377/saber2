/**
 * MUTATION RUNNER — run one checks file against a deliberately broken tree.
 *
 * `node --import ./tools/register.mjs tools/_mutate.mjs <suite> <mutant>`
 *
 * A check you have not seen fail is not evidence, and the usual way to see one
 * fail — back the source file up with `cp`, break it, run, restore — is unsafe
 * when other work is live in the same tree: a concurrent write to the file you
 * broke either loses their edit or silently restores yours, and both were
 * observed while this was being written. So the defect is re-introduced on the
 * PROTOTYPE, in this process only, and nothing on disk is touched.
 *
 * Mutants are named below rather than passed as code, so what "red" was proved
 * against stays in the repository next to the check that claims it.
 */
import './dom-shim.mjs';
import * as THREE from 'three';

const MUTANTS = {
  /**
   * Remove the one line tools/checks/coop.mjs's duellist check exists to
   * guard: `Enemy._saberStrike`'s `if (this.netDriven) return false;`. Without
   * it a client's replicated blade bills its own damage while the host is
   * already billing the same blow over `hit`, so every enemy melee strike
   * lands twice on a joining player.
   */
  'saber-guard': async () => {
    const { Enemy } = await import('../src/game/Enemy.js');
    const real = Enemy.prototype._saberStrike;
    Enemy.prototype._saberStrike = function (ctx, target) {
      const was = this.netDriven;
      this.netDriven = false;
      try { return real.call(this, ctx, target); } finally { this.netDriven = was; }
    };
  },
  /**
   * Take the modifier back off the wire — the twelve-field record the protocol
   * carried before elites crossed. Trimmed on ARRIVAL rather than on send,
   * which is the same thing seen from the client and needs no knowledge of how
   * the host got hold of `packSnapshot`. A client then rebuilds every elite in
   * the game as the plain archetype: no bubble, no core, no plates, no
   * standard, no off-hand blade, no tint, and a `maxHp` its grind bills
   * against that the body does not have.
   */
  'no-modifier-wire': async () => {
    const { World } = await import('../src/game/World.js');
    const real = World.prototype.applySnapshot;
    World.prototype.applySnapshot = function (msg) {
      if (msg && msg.e) for (const rec of msg.e) if (rec.length > 12) rec.length = 12;
      return real.call(this, msg);
    };
  },
  /**
   * Put back the restart that left the previous wave in the air: everything
   * `restartWave` does except dropping what the arrival director is still
   * carrying. The swap is scoped to the call so nothing else — a level change,
   * a run ending, `dispose` — loses its clear.
   */
  'restart-keeps-arrivals': async () => {
    const { World } = await import('../src/game/World.js');
    const real = World.prototype.restartWave;
    World.prototype.restartWave = function () {
      const A = this.director?.arrivals;
      const was = A?.clear;
      if (A) A.clear = () => {};
      try { return real.call(this); } finally { if (A) A.clear = was; }
    };
  },
  /**
   * Put back the payout that fired on every clear rather than every wave: the
   * ledger says yes to everything, which is what having no ledger was.
   */
  'wave-pays-every-clear': async () => {
    const { WaveDirector } = await import('../src/game/Waves.js');
    WaveDirector.prototype.payWave = () => true;
  },
  /**
   * Put the forest back to being ONE target: the whole stand keyed on the prop
   * id, so `throwCleaved` retires eighteen hundred trunks after the first one
   * and Cleaving Throw cuts exactly one tree a throw. Done by making the stand
   * present itself as an ordinary prop — `kind` is what `cleaveAlong` reads to
   * tell a stand from a crate.
   */
  'forest-is-one-target': async () => {
    const { World } = await import('../src/game/World.js');
    const real = World.prototype.loadLevel;
    World.prototype.loadLevel = async function (...a) {
      const r = await real.apply(this, a);
      if (this.forest) this.forest.kind = 'prop';
      return r;
    };
  },
  /**
   * Put back the whole-id sweep in `World._applyBladeEvent`: felling one trunk
   * throws away the grind accumulated on every other trunk in the level.
   */
  'forest-clears-whole': async () => {
    const { BladeContactSolver } = await import('../src/game/Combat.js');
    const real = BladeContactSolver.prototype.clearTarget;
    BladeContactSolver.prototype.clearTarget = function (id, capName = null) {
      return real.call(this, id, /^t\d+$/.test(capName || '') ? null : capName);
    };
  },
};

const name = process.argv[2];
const mutant = process.argv[3];
if (!MUTANTS[mutant]) { console.error(`unknown mutant '${mutant}' — have: ${Object.keys(MUTANTS).join(', ')}`); process.exit(2); }
await MUTANTS[mutant]();

const mod = await import(`./checks/${name.replace(/\.mjs$/, '')}.mjs`);
let pass = 0, fail = 0;
const pending = [];
const lines = [];
const ok = (label, d) => { pass++; lines.push(`✓ ${label} — ${d ?? ''}`); };
const bad = (label, e) => { fail++; lines.push(`✗ ${label}\n    ${e && e.message ? e.message : String(e)}`); };
const check = (label, fn) => {
  try {
    const d = fn();
    if (d && typeof d.then === 'function') pending.push(d.then((x) => ok(label, x), (e) => bad(label, e)));
    else ok(label, d);
  } catch (e) { bad(label, e); }
};
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const near = (a, b, tol = 1e-6, m = '') => assert(Math.abs(a - b) <= tol, `${m} ${a} != ${b}`);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (x, y, z, w) => new THREE.Quaternion(x, y, z, w);
const lerpN = (a, b, t) => a + (b - a) * t;
await mod.run({ check, assert, near, V, Q, THREE, lerpN });
await Promise.all(pending);
for (const l of lines) console.log(l);
console.log(`\nmutant '${mutant}': ${pass} passed, ${fail} failed`);
/* Inverted on purpose: this tool exists to watch a check FAIL. A mutant that
 * breaks nothing is a check that guards nothing, and it exits non-zero. */
process.exit(fail ? 0 : 1);
