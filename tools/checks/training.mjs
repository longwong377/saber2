/**
 * BATTLEFRONT BORZ — can you actually practise anything?
 *
 * The report was "even at the lowest setting there's just way too much blaster
 * fire coming in to practice anything". That is a statement about two numbers
 * the game never let the player touch: how many enemies are in the room, and
 * how often they pull a trigger. Nothing in the wave director exposed either —
 * Padawan opens with a budgeted wave of four and every unit in it firing at its
 * archetype cadence.
 *
 * So these tests are about the numbers themselves. Does the population land on
 * exactly what was asked for, including zero? Does the fire rate reach zero
 * rather than "very slow"? And does the unlimited blade stay inside what the
 * rest of the game can cope with, which is the part that would rot quietly:
 * World.js culls blade-vs-body candidates by distance from the blade's
 * MIDPOINT, so every metre of blade eats half a metre of that budget.
 */

import * as THREE from 'three';
import { WaveDirector, MODES, sandboxConfig, sandboxUnits, holdFire, tuneFireRate,
  SANDBOX_MAX_ENEMIES } from '../../src/game/Waves.js';
import { DojoDirector, LESSONS } from '../../src/game/Dojo.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';
import { DEFAULT_SETTINGS, BLADE_CAP, BLADE_MAX, bladeCeiling, loadSettings, STORE_KEY, LEGACY_KEYS } from '../../src/ui/Menu.js';
import { DIFFICULTY } from '../../src/game/Combat.js';
import { Saber } from '../../src/game/Saber.js';
import { intersectBladeSweep } from '../../src/game/Bolts.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * A world stub with just enough surface for a director: an enemy list that
 * behaves like the real one (dispose removes nothing by itself; the director
 * does the splicing), a terrain that accepts any spot, and a settings object
 * the test can rewrite between frames the way the menu does.
 */
function fakeWorld(settings) {
  let id = 0;
  const w = {
    settings,
    enemies: [],
    locks: [],
    difficulty: DIFFICULTY.knight,
    takenBoons: new Set(),
    player: { position: V(0, 0, 0) },
    bolts: { clear() {} },
    bladeSolver: { clearTarget() {} },
    terrain: { inBounds: () => true, slopeAt: () => 0, height: () => 0 },
    notify() {},
    spawnEnemy(type, pos) {
      const A = ARCHETYPES[type] || ARCHETYPES.b1;
      const e = {
        id: 'e' + (id++), type, A, dead: false, dying: 0,
        position: pos.clone(), attackTimer: 0, burstLeft: 0, burstTimer: 0, aimCharge: 0,
        duel: A.saber ? { formKey: 'makashi', form: null, describe: () => 'Makashi' } : null,
        dispose() { this.disposed = true; },
      };
      w.enemies.push(e);
      return e;
    },
  };
  return w;
}

function ctxFor(w) {
  return {
    enemies: w.enemies, players: [w.player],
    pickSpawn: () => V(30, 0, 0),
    spawnEnemy: (t, p) => w.spawnEnemy(t, p),
  };
}

/** Run the director until the population settles, or give up. */
function settle(d, w, frames = 400) {
  const ctx = ctxFor(w);
  for (let i = 0; i < frames; i++) d.update(1 / 60, ctx);
  return w.enemies.filter(e => !e.dead).length;
}

export async function run({ check, assert }) {

  /* ── the numbers exist at all ──────────────────────────────────────── */

  check('training: the practice knobs are real settings, not console flags', () => {
    for (const k of ['sandboxCount', 'sandboxFire', 'sandboxType', 'unlimitedBlade']) {
      assert(k in DEFAULT_SETTINGS, `DEFAULT_SETTINGS has no ${k}`);
    }
    assert(MODES.sandbox, 'there is no sandbox mode to select');
    const fresh = loadSettings();
    assert(fresh.sandboxCount === DEFAULT_SETTINGS.sandboxCount,
      'a fresh settings blob does not carry the training defaults');
    return `${Object.keys(DEFAULT_SETTINGS).length} settings, ${Object.keys(MODES).length} modes`;
  });

  check('training: every value the sliders can produce survives the clamp', () => {
    // 0 has to be a legal answer for BOTH numbers, and the reader must not
    // quietly promote it to 1 the way a `|| default` would.
    assert(sandboxConfig({ sandboxCount: 0 }).count === 0, 'zero enemies was rejected');
    assert(sandboxConfig({ sandboxFire: 0 }).fire === 0, 'zero fire was rejected');
    assert(sandboxConfig({ sandboxCount: 9999 }).count === SANDBOX_MAX_ENEMIES,
      'the count is unbounded above');
    assert(sandboxConfig({ sandboxCount: -5 }).count === 0, 'a negative count got through');
    assert(sandboxConfig(undefined).count === sandboxConfig({}).count,
      'a missing settings blob is not the same as an empty one');
    assert(sandboxConfig({ sandboxType: 'nonsense' }).type === 'mixed',
      'an unknown archetype was accepted');
    assert(sandboxConfig({ sandboxType: 'b1' }).type === 'b1', 'a real archetype was rejected');
    return `0…${SANDBOX_MAX_ENEMIES} enemies, 0…2× fire, ${sandboxUnits().length} unit choices`;
  });

  check('training: the archetype list offers one row per droid you can meet', () => {
    const units = sandboxUnits();
    assert(units[0].key === 'mixed', 'the default "mixed" row is missing');
    const keys = new Set(units.map(u => u.key));
    for (const k of ['b1', 'trooper', 'acolyte', 'droideka', 'remote', 'dummy', 'sparring']) {
      assert(keys.has(k), `you cannot practise against a ${k}`);
      assert(units.find(u => u.key === k).name === ARCHETYPES[k].label,
        `${k}'s row is captioned by hand and has drifted`);
    }
    return `${units.length} rows: ${units.map(u => u.key).join(', ')}`;
  });

  /* ── the population lands where you put it ─────────────────────────── */

  check('sandbox: the room holds exactly the number of enemies you asked for', () => {
    const rows = [];
    for (const count of [0, 1, 3, 12, SANDBOX_MAX_ENEMIES]) {
      const s = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: count };
      const w = fakeWorld(s);
      const d = new WaveDirector(w, { mode: 'sandbox', pool: ['b1', 'trooper'] });
      d.start(1);
      const got = settle(d, w);
      assert(got === count, `asked for ${count}, got ${got}`);
      rows.push(`${count}→${got}`);
    }
    return rows.join('  ');
  });

  check('sandbox: an empty arena is reachable from a full one, and back', () => {
    const s = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 14 };
    const w = fakeWorld(s);
    const d = new WaveDirector(w, { mode: 'sandbox', pool: ['b1'] });
    d.start(1);
    const full = settle(d, w);
    assert(full === 14, `never filled: ${full}`);

    // the slider moves mid-session — no restart, no reload
    s.sandboxCount = 0;
    const empty = settle(d, w, 30);
    assert(empty === 0, `dialling to zero left ${empty} enemies standing`);
    assert(w.enemies.length === 0, `${w.enemies.length} corpses left in the world list`);

    s.sandboxCount = 5;
    const back = settle(d, w);
    assert(back === 5, `refilling gave ${back} instead of 5`);
    return `14 → 0 → 5, live, in ${w.enemies.length === 5 ? 'one' : '?'} settings write each`;
  });

  check('sandbox: the far side of the room is culled first, not what you are fighting', () => {
    const s = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 6 };
    const w = fakeWorld(s);
    const d = new WaveDirector(w, { mode: 'sandbox', pool: ['b1'] });
    d.start(1);
    settle(d, w);
    // fan them out at known ranges
    w.enemies.forEach((e, i) => e.position.set(0, 0, (i + 1) * 4));
    s.sandboxCount = 2;
    settle(d, w, 10);
    const left = w.enemies.map(e => e.position.z).sort((a, b) => a - b);
    assert(left.length === 2, `${left.length} left instead of 2`);
    assert(left[1] <= 8.01, `kept the enemies at ${left.join(' and ')} m — the near pair is at 4 and 8`);
    return `kept ${left.join(' m and ')} m, dropped 12–24 m`;
  });

  check('sandbox: only one archetype spawns when you pick one', () => {
    for (const type of ['b1', 'droideka', 'remote']) {
      const s = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 8, sandboxType: type };
      const w = fakeWorld(s);
      const d = new WaveDirector(w, { mode: 'sandbox', pool: ['b1', 'trooper', 'acolyte'] });
      d.start(1);
      settle(d, w);
      const kinds = new Set(w.enemies.map(e => e.type));
      assert(kinds.size === 1 && kinds.has(type),
        `asked for ${type} only, got ${[...kinds].join(', ')} — the level pool leaked in`);
    }
    // and 'mixed' still draws from the theatre
    const s = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 24, sandboxType: 'mixed' };
    const w = fakeWorld(s);
    const d = new WaveDirector(w, { mode: 'sandbox', pool: ['b1', 'trooper', 'acolyte'] });
    d.start(1);
    settle(d, w);
    const kinds = new Set(w.enemies.map(e => e.type));
    assert(kinds.size >= 2, `"mixed" produced only ${[...kinds].join(', ')}`);
    return `single-type rooms are pure; mixed drew ${kinds.size} kinds`;
  });

  check('sandbox: changing the opponent reshapes the room instead of waiting', () => {
    // The failure this guards: pick "B1 only" mid-session and the four troopers
    // already standing there keep shooting at you until you kill them, which is
    // "practise against exactly one droid" in the menu and not in the room.
    const s = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 6, sandboxType: 'trooper' };
    const w = fakeWorld(s);
    const d = new WaveDirector(w, { mode: 'sandbox', pool: ['b1'] });
    d.start(1);
    settle(d, w);
    assert(w.enemies.every(e => e.type === 'trooper'), 'never filled with troopers');
    s.sandboxType = 'b1';
    settle(d, w);
    const kinds = [...new Set(w.enemies.map(e => e.type))];
    assert(w.enemies.length === 6, `${w.enemies.length} bodies after the switch, wanted 6`);
    assert(kinds.length === 1 && kinds[0] === 'b1',
      `the old archetype survived the switch: ${kinds.join(', ')}`);

    // and the same in the dojo
    const s2 = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 4, sandboxType: 'remote' };
    const w2 = fakeWorld(s2);
    const d2 = new DojoDirector(w2);
    d2.start();
    s2.sandboxType = 'dummy';
    for (let i = 0; i < 240; i++) d2.update(1 / 60, {});
    assert(w2.enemies.length === 4 && w2.enemies.every(e => e.type === 'dummy'),
      `the dojo kept ${w2.enemies.map(e => e.type).join(', ')}`);
    return '6 troopers → 6 B1s, 4 remotes → 4 dummies, no kills required';
  });

  check('sandbox: a sandbox never composes a wave or offers a boon', () => {
    const s = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 3 };
    const w = fakeWorld(s);
    const d = new WaveDirector(w, { mode: 'sandbox', pool: ['b1'] });
    let waves = 0, drafts = 0;
    d.onWaveStart = () => waves++;
    d.onWaveClear = () => waves++;
    d.onDraft = () => drafts++;
    d.start(1);
    settle(d, w, 600);
    assert(waves === 0, `${waves} wave banners fired in a sandbox`);
    assert(drafts === 0, `${drafts} boon drafts fired in a sandbox`);
    assert(d.spawnQueue.length === 0, 'a wave queue was composed');
    assert(d.wave === 1, `the wave counter escalated to ${d.wave}`);
    return 'no waves, no banners, no drafts — just the room';
  });

  /* ── the trigger ───────────────────────────────────────────────────── */

  check('training: fire rate reaches zero, not merely "slow"', () => {
    // holdFire is the whole mechanism: every ranged archetype fires by letting
    // attackTimer reach zero, so pushing the fuse back each frame silences a
    // B1, a sniper mid-telegraph and a droideka mid-burst with one rule.
    const e = { attackTimer: 0.001, burstLeft: 4, burstTimer: 0, aimCharge: 0.4,
      _endTelegraph() { this.telegraphOff = true; }, A: ARCHETYPES.droideka };
    holdFire(e);
    assert(e.burstLeft === 0, `${e.burstLeft} rounds still queued after holdFire`);
    assert(e.aimCharge === 0 && e.telegraphOff, 'a telegraph survived holdFire');
    // and it must survive a frame: 0.5 s of fuse against a 1/60 s step
    let t = e.attackTimer;
    for (let i = 0; i < 20; i++) t -= 1 / 60;
    assert(t > 0, `the fuse burnt down to ${t.toFixed(3)} in a third of a second`);
    return `fuse held at ${e.attackTimer.toFixed(2)} s, ${20} frames later ${t.toFixed(2)} s`;
  });

  check('sandbox: the fire slider drives the difficulty divisor every archetype reads', () => {
    const s = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 2, sandboxFire: 1 };
    const w = fakeWorld(s);
    const base = w.difficulty.fireRate;
    const d = new WaveDirector(w, { mode: 'sandbox', pool: ['b1'] });
    d.start(1);
    settle(d, w, 30);
    const rows = [];
    for (const f of [1, 0.5, 0.1, 2]) {
      s.sandboxFire = f;
      settle(d, w, 4);
      const got = w.difficulty.fireRate;
      // Enemy.js: attackTimer = A.fireRate * jitter / (aggression * diff.fireRate)
      const periodMul = base / got;
      assert(Math.abs(got - base * f) < 1e-9,
        `fire ${f}× gave a divisor of ${got}, expected ${base * f}`);
      rows.push(`${f}× → ${periodMul.toFixed(1)}× the gap`);
    }
    // and the shared DIFFICULTY constant must not have been scaled in place
    assert(DIFFICULTY.knight.fireRate === base,
      `DIFFICULTY.knight.fireRate was mutated to ${DIFFICULTY.knight.fireRate}`);
    return rows.join(', ');
  });

  check('sandbox: at zero fire every enemy in the room is held, every frame', () => {
    const s = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 10, sandboxFire: 0 };
    const w = fakeWorld(s);
    const d = new WaveDirector(w, { mode: 'sandbox', pool: ['b1', 'droideka', 'sniper'] });
    d.start(1);
    const ctx = ctxFor(w);
    let fired = 0;
    for (let i = 0; i < 900; i++) {          // fifteen seconds
      for (const e of w.enemies) {
        e.attackTimer -= 1 / 60;
        if (e.attackTimer <= 0) { fired++; e.attackTimer = 1; }
        if (e.burstLeft > 0) fired++;
      }
      d.update(1 / 60, ctx);
    }
    assert(fired === 0, `${fired} shots got away in 15 s with the trigger held`);
    return `10 droids, 900 frames, ${fired} shots`;
  });

  check('training: the remote reads its own period, so it is tuned by hand', () => {
    // _remoteBrain ignores world.difficulty entirely — it uses trainingFireRate.
    // If the sandbox forgets that, the remote is the one unit the fire slider
    // does not touch, which is exactly the unit the dojo is built around.
    const e = { A: ARCHETYPES.remote };
    tuneFireRate(e, 1);
    const at1 = e.trainingFireRate;
    tuneFireRate(e, 0.25);
    const at025 = e.trainingFireRate;
    assert(Math.abs(at1 - ARCHETYPES.remote.fireRate) < 1e-9,
      `1× changed the remote's period to ${at1}`);
    assert(Math.abs(at025 - at1 * 4) < 1e-9,
      `0.25× gave a ${at025.toFixed(2)} s period, expected ${(at1 * 4).toFixed(2)}`);
    const other = { A: ARCHETYPES.b1 };
    tuneFireRate(other, 0.25);
    assert(other.trainingFireRate === undefined,
      'a B1 was given a remote-only override that its brain never reads');
    return `remote ${at1.toFixed(1)} s → ${at025.toFixed(1)} s between bolts at 0.25×`;
  });

  /* ── the dojo ──────────────────────────────────────────────────────── */

  check('dojo: the lessons still run, and the sandbox is a room after them', () => {
    const ids = LESSONS.map(L => L.id);
    for (const id of ['feel', 'block', 'deflect', 'return', 'perfect', 'cut', 'parry', 'chamber', 'lock', 'free']) {
      assert(ids.includes(id), `the ${id} lesson is gone`);
    }
    assert(ids[ids.length - 1] === 'sandbox', `the last lesson is ${ids[ids.length - 1]}`);
    assert(ids.indexOf('free') === ids.length - 2, 'free practice is no longer next to last');
    return `${ids.length} lessons: ${ids.join(' → ')}`;
  });

  check('dojo: picking Sandbox on the Deploy screen lands you in the sandbox', () => {
    const w = fakeWorld({ ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 4 });
    const d = new DojoDirector(w);
    d.start();
    assert(d.lesson.id === 'sandbox', `landed on ${d.lesson.id}`);
    assert(d.inSandbox, 'the director does not know it is in a sandbox');
    assert(w.enemies.length === 4, `the room was built with ${w.enemies.length} units, not 4`);

    // and any other mode still starts at lesson one
    const w2 = fakeWorld({ ...DEFAULT_SETTINGS, mode: 'roguelite' });
    const d2 = new DojoDirector(w2);
    d2.start();
    assert(d2.lesson.id === 'feel', `a normal dojo run started on ${d2.lesson.id}`);
    return 'sandbox → sandbox, everything else → feel the weight';
  });

  check('dojo: the sandbox count is live in the dojo too', () => {
    const s = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 2 };
    const w = fakeWorld(s);
    const d = new DojoDirector(w);
    d.start();
    const run = (n) => { for (let i = 0; i < n; i++) d.update(1 / 60, {}); };
    assert(w.enemies.length === 2, `opened with ${w.enemies.length}`);
    s.sandboxCount = 9;
    run(120);                                  // two seconds
    assert(w.enemies.length === 9, `filling to 9 gave ${w.enemies.length}`);
    s.sandboxCount = 0;
    run(60);
    assert(w.enemies.length === 0, `emptying gave ${w.enemies.length}`);
    return '2 → 9 → 0 without leaving the room';
  });

  check('dojo: walking into a forty-droid room does not build forty rigs on one frame', () => {
    // Each unit is a rig, an actor and a physics proxy. Doing all of them in the
    // single call that enters the lesson is a visible freeze on the doorstep.
    const s = { ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: SANDBOX_MAX_ENEMIES };
    const w = fakeWorld(s);
    const d = new DojoDirector(w);
    d.start();
    const onEntry = w.enemies.length;
    assert(onEntry > 0 && onEntry <= 8, `${onEntry} bodies built on the entry frame`);
    for (let i = 0; i < 60 * 8; i++) d.update(1 / 60, {});
    assert(w.enemies.length === SANDBOX_MAX_ENEMIES,
      `the room only reached ${w.enemies.length} of ${SANDBOX_MAX_ENEMIES} in eight seconds`);
    return `${onEntry} on entry, ${SANDBOX_MAX_ENEMIES} within 8 s`;
  });

  check('dojo: a mixed sandbox rotates through the training kit', () => {
    const w = fakeWorld({ ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 6, sandboxType: 'mixed' });
    const d = new DojoDirector(w);
    d.start();
    const kinds = new Set(w.enemies.map(e => e.type));
    for (const k of ['remote', 'dummy', 'sparring']) {
      assert(kinds.has(k), `a mixed dojo room has no ${k}`);
    }
    // and asking for one kind gives one kind
    const w2 = fakeWorld({ ...DEFAULT_SETTINGS, mode: 'sandbox', sandboxCount: 5, sandboxType: 'b1' });
    const d2 = new DojoDirector(w2);
    d2.start();
    assert(w2.enemies.every(e => e.type === 'b1'),
      `asked for B1s, got ${[...new Set(w2.enemies.map(e => e.type))].join(', ')}`);
    return `mixed = ${[...kinds].join(' + ')}; single = 5 × b1`;
  });

  /* ── the long blade ────────────────────────────────────────────────── */

  check('blade: the training cap is generous and still inside what the world can reach', () => {
    assert(BLADE_MAX > BLADE_CAP * 2, `the "unlimited" cap is only ${BLADE_MAX} m against ${BLADE_CAP}`);
    // World.js:449/453 — blade-vs-body candidates are gathered by distance from
    // the blade's MIDPOINT, so half the blade's length is spent before the tip
    // has reached anything.
    const ENEMY_CULL = 6, PROP_CULL = 5;
    const enemySlack = ENEMY_CULL - BLADE_MAX / 2;
    const propSlack = PROP_CULL - BLADE_MAX / 2;
    assert(enemySlack >= 2,
      `at ${BLADE_MAX} m the tip has ${enemySlack.toFixed(2)} m of slack before World.js stops ` +
      `listing enemies as blade targets — a droid at the tip would not be cut`);
    assert(propSlack >= 2,
      `at ${BLADE_MAX} m props are culled ${propSlack.toFixed(2)} m past the tip`);
    return `${BLADE_CAP} m → ${BLADE_MAX} m, tip slack ${enemySlack.toFixed(1)} m enemy / ${propSlack.toFixed(1)} m prop`;
  });

  check('blade: the ceiling moves only when the leash is off, both ways', () => {
    assert(bladeCeiling({ unlimitedBlade: false }) === BLADE_CAP, 'the leash does not hold');
    assert(bladeCeiling({ unlimitedBlade: true }) === BLADE_MAX, 'the leash does not release');
    assert(DEFAULT_SETTINGS.unlimitedBlade === false, 'the leash defaults to off');
    assert(DEFAULT_SETTINGS.bladeLength <= BLADE_CAP,
      `the default blade is ${DEFAULT_SETTINGS.bladeLength} m, past the stock cap`);
    // a stored blob that says "4 m, leash on" must not survive the leash coming off
    localStorage.setItem('saber.settings.v3', JSON.stringify({ bladeLength: BLADE_MAX, unlimitedBlade: false }));
    const s = loadSettings();
    localStorage.removeItem('saber.settings.v3');
    assert(s.bladeLength === BLADE_CAP,
      `a stored ${BLADE_MAX} m blade loaded as ${s.bladeLength} m with the leash on`);
    return `${BLADE_CAP} m leashed, ${BLADE_MAX} m free, stored blobs re-clamped on load`;
  });

  check('settings: the whole legacy chain is adopted once, minus what was retired', () => {
    // Was 'a v2 blob is adopted once and then retired', pinning a two-key hop.
    // The directional-guard round added a third key, and the old check would
    // have gone GREEN ON THE WRONG THING: its last assertion was
    // `b.level === 'dunes'`, and 'dunes' is also DEFAULT_SETTINGS.level, so once
    // v3 stopped being the store key the assertion could no longer tell a
    // surviving blob from an empty store. It is rewritten here to say what the
    // chain now has to do, which is strictly more:
    //
    //   · every legacy key speaks, oldest last, so tools/smoke.mjs and
    //     tools/motion.mjs can still preset a level by writing v2;
    //   · a blob under the CURRENT key survives adoption;
    //   · each legacy key speaks exactly once and is then gone;
    //   · and a setting named in RETIRED does NOT come across, which is the
    //     whole reason the key was bumped: saveSettings writes the entire
    //     object, so every returning player has `scheme` on disk whether they
    //     chose it or not, and without this the shipped default would reach
    //     nobody who had ever opened the options screen.
    // The key is READ, never named. Hardcoding it meant the v5 bump turned "a
    // blob under the current key survives" into "a blob under a legacy key is
    // drained", and the check failed pointing at the store rather than at the
    // bump. Reading it is strictly stronger: the property holds at every future
    // bump without anyone remembering to come back here.
    const CUR = STORE_KEY;
    for (const k of [CUR, ...LEGACY_KEYS]) localStorage.removeItem(k);
    localStorage.setItem(CUR, JSON.stringify({ level: 'wood', colorIndex: 7 }));
    localStorage.setItem('saber.settings.v3', JSON.stringify({ level: 'foundry', scheme: 'hold', fov: 77 }));
    localStorage.setItem('saber.settings.v2', JSON.stringify({ level: 'alpine' }));

    const a = loadSettings();
    assert(a.level === 'alpine', `the v2 preset was ignored — loaded level "${a.level}"`);
    assert(a.colorIndex === 7, 'adopting the old blobs threw away the current one');
    assert(a.fov === 77, `the v3 blob was dropped whole — fov came back ${a.fov}`);
    assert(a.scheme === DEFAULT_SETTINGS.scheme,
      `a retired setting came across: scheme loaded as "${a.scheme}", `
      + `and the shipped default "${DEFAULT_SETTINGS.scheme}" would reach nobody`);
    for (const k of ['saber.settings.v2', 'saber.settings.v3']) {
      assert(localStorage.getItem(k) === null, `${k} survived the read`);
    }

    // Second read: neither retired key may speak again. Asserted against a
    // value that is NOT a default, so an empty store cannot fake it.
    const b = loadSettings();
    assert(b.level === 'wood', `a retired blob still won on the second read ("${b.level}")`);
    assert(b.fov === DEFAULT_SETTINGS.fov,
      `the retired v3 blob spoke twice — fov ${b.fov} instead of ${DEFAULT_SETTINGS.fov}`);
    assert(b.colorIndex === 7, 'the current blob was lost between reads');

    localStorage.removeItem(CUR);
    const c = loadSettings();
    assert(c.level === DEFAULT_SETTINGS.level, 'a cleared store did not fall back to defaults');
    return `v2 → v3 → v4 once each; fov 77 carried, scheme retired to "${a.scheme}"`;
  });

  check('blade: a long blade widens the capture window instead of breaking it', () => {
    // The whole point of the training blade: the window ALONG the blade is what
    // grows. The window ACROSS it is set by the contact radius and must not
    // move, or a long blade would be quietly easier in a way length cannot
    // explain.
    const scene = new THREE.Scene();
    const measure = (len, axis) => {
      const s = new Saber(scene, { colorIndex: 0, bladeLength: len });
      s.ignite(); s.ignition = 1;
      s.valid = false;
      const pos = V(0, 1.35, 0), q = new THREE.Quaternion();
      s.setHiltPose(pos, q); s.update(1 / 60, 0);
      s.setHiltPose(pos, q); s.update(1 / 60, 1 / 60);
      const mid = s.pointAt(0.5, new THREE.Vector3());
      const fire = (d) => {
        const start = mid.clone();
        if (axis === 'x') start.x += d; else start.y += d;
        start.z += 40;
        const p = start.clone(), prev = start.clone();
        const step = V(0, 0, -1).multiplyScalar(88 / 60);
        for (let f = 0; f < 240; f++) {
          prev.copy(p); p.add(step);
          if (intersectBladeSweep(prev, p, s, null)) return true;
          if (p.z < s.base.z - 6) return false;
        }
        return false;
      };
      if (!fire(0)) { s.dispose(); return 0; }
      let lo = 0, hi = 0.02;
      while (hi < 12 && fire(hi)) { lo = hi; hi *= 1.6; }
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (fire(m)) lo = m; else hi = m; }
      s.dispose();
      return lo;
    };
    const shortAlong = measure(DEFAULT_SETTINGS.bladeLength, 'y');
    const longAlong = measure(BLADE_MAX, 'y');
    const shortAcross = measure(DEFAULT_SETTINGS.bladeLength, 'x');
    const longAcross = measure(BLADE_MAX, 'x');
    assert(longAlong > shortAlong * 2,
      `a ${BLADE_MAX} m blade only reaches ±${(longAlong * 100).toFixed(0)} cm against ` +
      `±${(shortAlong * 100).toFixed(0)} cm — the extra length is not catching bolts`);
    assert(Math.abs(longAcross - shortAcross) < 0.01,
      `the window ACROSS the blade moved from ±${(shortAcross * 100).toFixed(1)} to ` +
      `±${(longAcross * 100).toFixed(1)} cm with length — it is set by the contact radius, not the length`);
    return `along ±${(shortAlong * 100).toFixed(0)}→±${(longAlong * 100).toFixed(0)} cm, ` +
           `across ±${(shortAcross * 100).toFixed(1)} cm at both lengths`;
  });

  check('blade: the trail still draws a continuous smear at training length', () => {
    // The trail fills gaps between samples at 18 cm and caps the fill at 8, so
    // a long blade sweeping fast is where the ribbon would come apart. Measure
    // the largest hole in the smear, not the sample count.
    const scene = new THREE.Scene();
    const swing = (len) => {
      const s = new Saber(scene, { colorIndex: 0, bladeLength: len });
      s.ignite(); s.ignition = 1;
      s.valid = false;
      const pos = V(0, 1.3, 0);
      let t = 0;
      for (let f = 0; f <= 8; f++) {
        const a = (f / 8) * (Math.PI / 2);
        s.setHiltPose(pos, new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), a));
        s.update(1 / 60, t); t += 1 / 60;
      }
      const live = s.trailHistory.filter(x => x.age < 1 && x.punch > 0.001);
      let worst = 0;
      for (let i = 1; i < live.length; i++) worst = Math.max(worst, live[i].t.distanceTo(live[i - 1].t));
      const span = live.length ? live[live.length - 1].age * 0.17 : 0;
      s.dispose();
      return { live: live.length, worst, span, tip: s.tipSpeed };
    };
    const a = swing(DEFAULT_SETTINGS.bladeLength);
    const b = swing(BLADE_MAX);
    assert(b.live > 4, `a ${BLADE_MAX} m blade left only ${b.live} live trail samples`);
    assert(b.worst < 0.35,
      `the smear has a ${(b.worst * 100).toFixed(0)} cm hole in it at ${BLADE_MAX} m ` +
      `(${(a.worst * 100).toFixed(0)} cm at ${DEFAULT_SETTINGS.bladeLength} m)`);
    assert(b.span > 0.06,
      `the trail is only ${(b.span * 1000).toFixed(0)} ms long at ${BLADE_MAX} m against ` +
      `${(a.span * 1000).toFixed(0)} ms at stock — the fill cap has eaten it`);
    return `stock ${a.live} samples / ${(a.worst * 100).toFixed(0)} cm gap / ${(a.span * 1000).toFixed(0)} ms, ` +
           `${BLADE_MAX} m ${b.live} / ${(b.worst * 100).toFixed(0)} cm / ${(b.span * 1000).toFixed(0)} ms`;
  });
}
