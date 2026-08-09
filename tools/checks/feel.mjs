/**
 * SABER — feel.
 *
 * Five things a combat designer found by playing, every one of which reads
 * perfectly well as source and is wrong as a number:
 *
 *   1. The blade cursor rested 22 deg above screen centre in third person,
 *      because Player set readyY back to the value a commit had just lowered.
 *   2. The catch gate read the blade's WORLD speed, so walking at 4.6 m/s made
 *      a rigid wrist clear a 3.2 m/s "driven blade" threshold on translation.
 *   3. The auto-guard cone was pinned to the chest position at the moment of
 *      the catch, so the player walked out of their own guard and left it in
 *      the world behind them.
 *   4. And because of 2, the "only a manual catch re-opens the cone" rule —
 *      the one thing keeping the mechanic off hold-to-win — was reachable by
 *      walking in a straight line.
 *   5. Lateral guard and flourish were seeded onto KeyB and KeyN at runtime,
 *      so they were in no table, in no menu, rebindable by nobody, and sharing
 *      their keys with two Force powers and the dojo's lesson navigation.
 *
 * Nothing here trusts a reading. Every check prints the number.
 */

import * as THREE from 'three';
import { Saber } from '../../src/game/Saber.js';
import { SaberController, READY_GUARD } from '../../src/game/SaberController.js';
import { CatchWindow, CATCH, captureSnapshot } from '../../src/game/Combat.js';
import { guardIntercept } from '../../src/game/Bolts.js';
import { Player } from '../../src/game/Player.js';
import { ACTIONS, ACTION_IDS, defaultBindings, findConflict } from '../../src/engine/Bindings.js';

const DEG = 180 / Math.PI;
const scene = new THREE.Scene();

/** Every .js under src/, as [relative path, text]. */
async function sources() {
  const { readdir, readFile } = await import('node:fs/promises');
  const root = new URL('../../src/', import.meta.url);
  const out = [];
  const walk = async (dir, prefix) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) await walk(u, prefix + e.name + '/');
      else if (e.name.endsWith('.js')) out.push([prefix + e.name, await readFile(u, 'utf8')]);
    }
  };
  await walk(root, '');
  return out;
}

/** A controller driven for `frames` on a body moving at `speed` down -Z. */
function drive({ speed = 0, flickAt = -1, frames = 200 } = {}) {
  const c = new SaberController();
  const s = new Saber(scene, { colorIndex: 0, bladeLength: 1.15 });
  s.ignite(); s.ignition = 1;
  const aim = new THREE.Quaternion();
  const chest = new THREE.Vector3(0, 1.35, 0);
  c.reset(chest, aim);
  const carrier = new THREE.Vector3(0, 0, -speed);
  let dx = 0;
  const input = {
    mouse: { get dx() { return dx; }, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 },
    bindings: defaultBindings(),
    act: (id) => flickAt >= 0 && id === 'blade', actHit: () => false,
  };
  const dt = 1 / 60;
  let worst = null;
  for (let i = 0; i < frames; i++) {
    chest.z -= speed * dt;
    // 6 frames of 58 px is the ~350 px sweep bladeGain is tuned for: one
    // comfortable full slash, not an arm's length.
    dx = (flickAt >= 0 && i >= flickAt && i < flickAt + 6) ? 58 : 0;
    c.applyInput(input, dt, { stamina: 1 });
    c.update(dt, chest, aim, { stamina: 1, flow: 0 });
    s.setHiltPose(c.handPos, c.quat);
    s.carrierVel = carrier;
    s.update(dt, i * dt, carrier);
    if (i < 100) continue;                       // let the spring settle first
    const pt = s.pointAt(0.55, new THREE.Vector3());
    // a bolt arriving head-on: flying +Z into a body walking -Z, worst case
    const bolt = { pos: pt.clone(), prev: pt.clone(), vel: new THREE.Vector3(0, 0, 40), speed: 40 };
    const snap = captureSnapshot(bolt, s, { bladeT: 0.55, point: pt });
    if (!worst || snap.bladeSpeed > worst.bladeSpeed) worst = snap;
  }
  return worst;
}

export async function run({ check, assert }) {
  /* ── 1. one owner for the ready guard ───────────────────────────────── */

  check('feel: readyX/readyY are assigned in exactly one file', async () => {
    // Commit 2e23892 lowered readyY from 0.30 to 0.08 to answer "the cursor
    // feels way too high", and Player._applyViewMode set it straight back —
    // the fix shipped and was undone in the same build, one file away. There is
    // now one door onto these two numbers (setViewMode) and this is the check
    // that keeps it that way.
    const files = await sources();
    const offenders = [];
    for (const [path, text] of files) {
      if (path === 'game/SaberController.js') continue;
      // an assignment, not a comparison and not a read
      for (const m of text.matchAll(/\bready([XY])\s*=(?!=)/g)) {
        const line = text.slice(0, m.index).split('\n').length;
        offenders.push(`${path}:${line} sets ready${m[1]}`);
      }
    }
    assert(!offenders.length,
      `ready pose set outside SaberController: ${offenders.join(', ')} — it has one owner, READY_GUARD`);
    const scanned = files.length;
    return `${scanned} source files scanned, 0 outside SaberController.js`;
  });

  check('feel: the blade cursor rests near screen centre in BOTH views', () => {
    // Run Player's real _applyViewMode over a real controller, both ways.
    const rows = [];
    for (const fp of [false, true]) {
      const c = new SaberController();
      const stub = { camera: { firstPerson: fp, targetDistance: 0 }, rig: { get: () => null }, control: c };
      Player.prototype._applyViewMode.call(stub);
      const up = c.readyY * c.maxPitch * DEG, right = c.readyX * c.maxYaw * DEG;
      // 22.0 deg is what 0.30 gave and what the player complained about; 10 is
      // the ceiling movement.mjs already holds the constructor to.
      assert(up < 10, `${fp ? 'first' : 'third'} person rests the cursor ${up.toFixed(1)} deg above centre`);
      const want = fp ? READY_GUARD.first : READY_GUARD.third;
      assert(c.readyX === want.x && c.readyY === want.y,
        `${fp ? 'first' : 'third'} person got (${c.readyX}, ${c.readyY}), READY_GUARD says (${want.x}, ${want.y})`);
      rows.push(`${fp ? '1st' : '3rd'} ${up.toFixed(1)} deg up / ${right.toFixed(1)} deg right`);
    }
    // and it must survive the drift home, which is what the player actually sees
    const c = new SaberController();
    const stub = { camera: { firstPerson: false, targetDistance: 0 }, rig: { get: () => null }, control: c };
    Player.prototype._applyViewMode.call(stub);
    c.gx = 0; c.gy = 0;
    const input = { mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 },
      bindings: defaultBindings(), act: () => false, actHit: () => false };
    for (let i = 0; i < 120; i++) c.applyInput(input, 1 / 60, { stamina: 1 });
    const settled = c.gy * c.maxPitch * DEG;
    assert(settled < 10, `after 2 s of no input the cursor settles ${settled.toFixed(1)} deg high`);

    // ── and READY_GUARD is what NEUTRAL means under the directional scheme.
    //
    // Directional blocking replaced the continuous guard POSITION with four
    // discrete zones, so it would have been easy for the ready pose to quietly
    // stop being anything: it is now where the blade rests with no guard
    // raised, which makes it the pose a player looks at for most of a fight.
    // Same two numbers, same one owner, and the check that keeps it that way is
    // the same check.
    const d = new SaberController({ scheme: 'directional' });
    Player.prototype._applyViewMode.call(
      { camera: { firstPerson: false, targetDistance: 0 }, rig: { get: () => null }, control: d });
    const dInput = { mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 },
      bindings: defaultBindings(), _held: new Set(),
      act(id) { return this._held.has(id); }, actHit: () => false };
    dInput._held.add('blade');
    for (let i = 0; i < 60; i++) d.applyInput(dInput, 1 / 60, { stamina: 1 });
    assert(d.zone !== 'none', 'setup: the directional guard never came up, so nothing was left');
    const raisedUp = d.gy * d.maxPitch * DEG;
    dInput._held.delete('blade');
    for (let i = 0; i < 90; i++) d.applyInput(dInput, 1 / 60, { stamina: 1 });
    assert(Math.abs(d.gx - d.readyX) < 0.02 && Math.abs(d.gy - d.readyY) < 0.02,
      `dropping the guard left the cursor at (${d.gx.toFixed(3)}, ${d.gy.toFixed(3)}) `
      + `instead of the ready guard (${d.readyX}, ${d.readyY})`);
    const neutral = d.gy * d.maxPitch * DEG;
    assert(neutral < 10, `directional neutral rests the cursor ${neutral.toFixed(1)} deg above centre`);
    return `${rows.join(', ')}; settles at ${settled.toFixed(1)} deg; `
      + `directional guard up ${raisedUp.toFixed(1)} deg → released ${neutral.toFixed(1)} deg`;
  });

  /* ── 2. the catch gate is graded in the body's frame ────────────────── */

  check('feel: walking is not a swing — a rigid wrist never reads as driven', () => {
    // Player.js: base 4.6 m/s, x1.62 sprinting, x0.48 crouched. The gate is
    // 3.2 m/s of blade speed or 1.6 m/s of closing, so in the world frame every
    // gait above a crouch cleared it on translation alone.
    const rows = [];
    for (const [name, speed] of [['stand', 0], ['crouch', 4.6 * 0.48], ['walk', 4.6], ['sprint', 4.6 * 1.62]]) {
      const snap = drive({ speed });
      // what the same contact read before, carrier still in the numbers
      const world = snap.bladeVel.clone().add(new THREE.Vector3(0, 0, -speed));
      const worldCaught = world.length() > 3.2 || -world.dot(snap.boltDir) > 1.6;
      assert(!snap.caught && !snap.driven,
        `a rigid wrist at ${speed.toFixed(2)} m/s graded as a driven blade `
        + `(${snap.bladeSpeed.toFixed(2)} m/s, closing ${snap.closing.toFixed(2)})`);
      // …and prove this is catching something real rather than passing because
      // the setup never moved: at walking pace and above, the world frame this
      // replaces really did clear the gate on translation alone.
      if (speed > 3.2) assert(worldCaught,
        `setup: at ${speed.toFixed(2)} m/s the old world-frame reading should have caught, `
        + `it read ${world.length().toFixed(2)} m/s — the check proves nothing`);
      rows.push(`${name} ${speed.toFixed(1)}→body ${snap.bladeSpeed.toFixed(2)} m/s`
        + (worldCaught ? ` (world would say ${world.length().toFixed(2)}, caught)` : ''));
    }
    return rows.join('; ');
  });

  check('feel: a flick still catches, and reads the same standing as at a sprint', () => {
    const still = drive({ flickAt: 120 });
    const running = drive({ speed: 4.6 * 1.62, flickAt: 120 });
    assert(still.caught && still.driven,
      `a real flick graded ${still.bladeSpeed.toFixed(2)} m/s — under the 3.2 m/s gate, so nothing can be caught at all`);
    assert(running.caught && running.driven,
      `the same flick at a sprint graded ${running.bladeSpeed.toFixed(2)} m/s and was not caught`);
    // The whole point of the body frame: your gait must not change the grade.
    const drift = Math.abs(still.bladeSpeed - running.bladeSpeed);
    assert(drift < 0.05,
      `the same wrist graded ${still.bladeSpeed.toFixed(2)} m/s standing and `
      + `${running.bladeSpeed.toFixed(2)} m/s sprinting — a ${drift.toFixed(2)} m/s difference the player did not make`);
    return `flick ${still.bladeSpeed.toFixed(2)} m/s standing, ${running.bladeSpeed.toFixed(2)} m/s sprinting `
      + `(gate 3.2), difference ${drift.toFixed(3)}`;
  });

  /* ── 3. the cone travels with the body ──────────────────────────────── */

  check('feel: the auto-guard cone follows the chest instead of staying behind', () => {
    const dt = 1 / 60, speed = 4.6 * 1.62;
    const inc = new THREE.Vector3(0, 0, 1);        // bolts fly +Z, the player walks -Z
    const trial = (follow) => {
      const chest = new THREE.Vector3(0, 1.35, 0);
      const cw = new CatchWindow();
      cw.add({ b: 1 }, { manual: true, chest, incoming: inc });
      if (!follow) cw.anchor = null;               // reproduce the frozen origin
      let covered = 0, total = 0, drift = 0;
      for (let f = 0; f < 60; f++) {
        chest.z -= speed * dt;
        cw.update(dt, false);
        const g = cw.guard();
        if (!g) break;
        drift = g.origin.distanceTo(chest);
        // a bolt 2 m out in front of the CURRENT chest, arriving now
        const from = chest.clone().addScaledVector(inc, -2.0);
        const to = chest.clone().addScaledVector(inc, -1.2);
        total++;
        if (guardIntercept(from, to, g)) covered++;
      }
      return { covered, total, drift };
    };
    const now = trial(true), then = trial(false);
    assert(now.drift < 1e-6,
      `the cone origin is ${now.drift.toFixed(2)} m from the chest it belongs to`);
    assert(now.covered === now.total,
      `only ${now.covered} of ${now.total} head-on bolts were inside a cone that was open the whole time`);
    // and the failure it replaces really was a failure, so this cannot pass vacuously
    assert(then.drift > CATCH.autoRadius,
      `setup: a frozen origin should drift past the ${CATCH.autoRadius} m radius, it moved ${then.drift.toFixed(2)} m`);
    return `following: 0.00 m drift, ${now.covered}/${now.total} covered; `
      + `frozen: ${then.drift.toFixed(2)} m drift, ${then.covered}/${then.total} covered`;
  });

  /* ── 4. only a driven catch re-arms the cone ────────────────────────── */

  check('feel: a catch the player did not drive cannot re-arm the cone', () => {
    // The rule CATCH.autoGuard's comment leans on is "an AUTO catch does not
    // re-open the cone, only a manual one does", and callers set `manual` from
    // which MECHANISM caught the bolt rather than from whether the blade was
    // driven. Those are different claims, and the gap between them was the
    // hold-to-win chain: measured on the real path, a rigid wrist carried at a
    // crouch-walk answered 19 bolts "by hand" in 10 s and held the cone open
    // for 64% of them. With the snapshot present the window checks it.
    const chest = new THREE.Vector3(0, 1.35, 0);
    const inc = new THREE.Vector3(0, 0, 1);
    const mk = (driven, auto) => ({ bolt: {}, snap: { driven, auto, caught: driven || auto } });

    const carried = new CatchWindow();
    carried.add(mk(false, false), { manual: true, chest, incoming: inc });
    assert(!carried.guard(),
      'a bolt that merely met a blade being carried past it re-opened the auto-guard cone');

    const free = new CatchWindow();
    free.add(mk(false, true), { manual: false, chest, incoming: inc });
    assert(!free.guard(), 'an auto-guard catch re-opened the auto-guard cone — one deflect covers a whole stream');

    const drivenCw = new CatchWindow();
    drivenCw.add(mk(true, false), { manual: true, chest, incoming: inc });
    assert(drivenCw.guard(), 'a genuinely driven catch failed to open the cone at all');
    assert(Math.abs(drivenCw.auto - CATCH.autoGuard) < 1e-9,
      `a driven catch opened the cone for ${drivenCw.auto} s, not ${CATCH.autoGuard} s`);

    // …and it still cannot be pushed past its budget by free catches after it
    let t = 0;
    for (let f = 0; f < 600; f++) {
      if (f % 6 === 0 && drivenCw.guard()) drivenCw.add(mk(false, true), { manual: false, chest, incoming: inc });
      drivenCw.update(1 / 60, false);
      if (drivenCw.guard()) t += 1 / 60;
    }
    assert(t <= CATCH.autoGuard + 1e-6,
      `free catches stretched one cone to ${t.toFixed(2)} s against a ${CATCH.autoGuard} s budget`);
    return `carried→shut, free→shut, driven→${CATCH.autoGuard} s; `
      + `10 s of free catches bought ${(t * 1000).toFixed(0)} ms total`;
  });

  /* ── 5. every control is a real, rebindable action ──────────────────── */

  check('feel: every action the game reads exists in ACTIONS', async () => {
    // `stance` and `flourish` were seeded into input.bindings at runtime and
    // `stasis`/`rend` were read off hardcoded key codes, so four controls never
    // reached the table: no options row, no rebind, and no way for findConflict
    // to warn that something else already wanted the key.
    const files = await sources();
    const used = new Map();
    for (const [path, text] of files) {
      for (const m of text.matchAll(/\.act(?:Hit)?\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
        if (!used.has(m[1])) used.set(m[1], path);
      }
    }
    const missing = [...used].filter(([id]) => !ACTION_IDS.includes(id));
    assert(!missing.length,
      `read but never registered: ${missing.map(([id, p]) => `${id} (${p})`).join(', ')}`);
    // And nothing may quietly install a binding at runtime. Three files are
    // allowed to write one: Bindings.js defines and persists them, Input.js
    // holds the live set, and the options screen rebinds them because the
    // player asked it to. Gameplay never does — that is how `stance` came to
    // exist on a key the player could neither see nor change.
    const OWNERS = ['engine/Bindings.js', 'engine/Input.js', 'ui/Menu.js'];
    const seeded = [];
    for (const [path, text] of files) {
      if (OWNERS.includes(path)) continue;
      if (/\bbindings\s*(\.[A-Za-z0-9_]+|\[[^\]]+\])\s*=(?!=)/.test(text)
          || /\bb\.(stance|flourish|stasis|rend)\s*=(?!=)/.test(text)) seeded.push(path);
    }
    assert(!seeded.length, `bindings written at runtime by gameplay in: ${seeded.join(', ')}`);
    return `${used.size} distinct actions read across ${files.length} files, all registered, none seeded`;
  });

  check('feel: lateral guard, flourish and the attack rose are on keys nothing else claims', async () => {
    const b = defaultBindings();
    // attackOver/attackStab join the list for the same reason the other four
    // are on it: they were the WHEEL, which had never been in a table at all —
    // read raw by the wrist roll and raw again by the Force grip, with the grip
    // having to steal the device frame by frame because neither could see the
    // other. A control that is not in ACTIONS cannot be seen to collide.
    for (const id of ['stance', 'flourish', 'stasis', 'rend', 'attackOver', 'attackStab']) {
      const a = ACTIONS.find(x => x.id === id);
      assert(a, `${id} is not in ACTIONS at all — it cannot be rebound or even found`);
      assert(b[id] && b[id].length, `${id} has no default key`);
    }
    assert(ACTIONS.find(x => x.id === 'stance').hold,
      'a guard stance is something you hold, and it is not marked hold');

    // Nothing else in ACTIONS may want these keys…
    const clashes = [];
    for (const id of ['stance', 'flourish', 'attackOver', 'attackStab']) {
      for (const k of b[id]) {
        const other = findConflict(b, k, id);
        if (other) clashes.push(`${id} shares ${k} with ${other}`);
      }
    }
    assert(!clashes.length, clashes.join(', '));

    // …and neither may the systems that read raw key codes past the bindings
    // table, which is where the old KeyB/KeyN seeding actually hurt: in the
    // dojo, one press stepped the lesson AND fired a Force power AND moved the
    // blade. main.js is scanned rather than trusted so this cannot go stale.
    const { readFile } = await import('node:fs/promises');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const raw = new Set([...main.matchAll(/\.code\s*===\s*['"]([A-Za-z0-9]+)['"]/g)].map(m => m[1]));
    const stolen = [];
    for (const id of ['stance', 'flourish', 'attackOver', 'attackStab']) {
      for (const k of b[id]) if (raw.has(k)) stolen.push(`${id} on ${k}`);
    }
    assert(!stolen.length,
      `${stolen.join(', ')} — main.js reads that code directly, so one press does two things`);
    return `stance ${b.stance.join('+')}, flourish ${b.flourish.join('+')}, `
      + `attacks ${b.attackOver.join('+')}/${b.attackStab.join('+')}; `
      + `main.js claims ${[...raw].join(',') || 'nothing'} raw, no overlap`;
  });
}
