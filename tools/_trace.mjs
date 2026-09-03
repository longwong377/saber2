/**
 * THE 600-FRAME SINGLE-BLADE TRACE, and the file that records it.
 *
 * SABERFORMS.md's hardest constraint is that a `saberSet: 'single'` player is
 * bit-identical to the build before the three sets existed. This drives a real
 * World for 600 frames on a scripted input and prints the floats that decide
 * it — the blade's own endpoints and velocities, the guard the controller
 * publishes, and the two bars a deflection spends.
 *
 *   node --import ./tools/register.mjs tools/_trace.mjs            print a digest
 *   node --import ./tools/register.mjs tools/_trace.mjs --record   write the baseline
 *
 * The baseline it writes (tools/checks/_singleblade.json) is a RECORD OF THE
 * PRE-CHANGE TREE, taken before one line of the set code existed. That is the
 * only honest way to hold "nothing moved" as an assertion rather than as a
 * claim: a check that recomputed the expected values from the new code would
 * agree with itself whatever it did.
 */
import './dom-shim.mjs';
import { writeFileSync } from 'node:fs';

const STEP = 1 / 60;
export const FRAMES = 600;

/**
 * A SCRIPTED HAND, and every press in it is a function of the frame index
 * alone — no clock, no rng, no wall time. Anything else and the baseline is a
 * record of when it was taken.
 *
 * It has to touch every path the sets reach: the guard (so `guard.half` is
 * published), the light cut and its third press (so the envelope tables are
 * read), the stab/spin, and the one-hand toggle (so `control.grip` moves).
 */
export function scriptedInput() {
  const state = { f: 0 };
  const hit = new Set();
  const held = new Set();
  const api = {
    _frame(f) {
      state.f = f;
      hit.clear(); held.clear();
      // The guard is up for the middle third — that is where `guard.half` and
      // the rose live, and it is the state suppression.mjs measures.
      if (f >= 120 && f < 420) held.add('blade');
      // Light cuts on a fixed cadence: 3 presses inside one chain window opens
      // the heavy, which is the third-press branch.
      if (f % 23 === 0 && f > 40) hit.add('thrust');
      if (f % 23 === 0 && f > 40) held.add('thrust');
      if (f === 180 || f === 300) hit.add('attackOver');
      if (f === 240) hit.add('attackStab');
      if (f === 360) hit.add('attackSpin');
      if (f === 450) hit.add('grip2');
      if (f === 520) hit.add('grip2');
    },
    act: (a) => held.has(a),
    actHit: (a) => hit.has(a),
    actDown: (a) => held.has(a),
    moveAxis: (o) => { const v = { x: 0, y: 0 }; if (o) { o.x = 0; o.y = 0; return o; } return v; },
    // A deterministic sweep of the mouse, so the guard genuinely moves through
    // all four zones rather than sitting in the one it starts in.
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
  };
  const _frame = api._frame;
  api._frame = (f) => {
    _frame(f);
    const dx = Math.sin(f * 0.11) * 26, dy = Math.cos(f * 0.07) * 18;
    api.mouse.dx = dx; api.mouse.dy = dy;
    api.delta.x = dx; api.delta.y = dy;
  };
  return api;
}

export async function trace() {
  const { bootWorld } = await import('./checks/_coop.mjs');
  const { world } = await bootWorld({
    settings: { mode: 'sandbox', sandboxCount: 0, sandboxFire: false, quality: 'low', allies: false },
  });
  const p = world.players[0];
  p.saber.ignite?.();
  const input = scriptedInput();
  const rows = [];
  for (let f = 0; f < FRAMES; f++) {
    input._frame(f);
    world.update(STEP, input);
    const s = p.saber, c = p.control;
    rows.push([
      s.base.x, s.base.y, s.base.z,
      s.tip.x, s.tip.y, s.tip.z,
      s.tipVelocity.x, s.tipVelocity.y, s.tipVelocity.z,
      s.swingSpeed, c.gx, c.gy, c.roll,
      c.guard.half, p.stamina, p.guardSpent,
    ].map((v) => (Number.isFinite(v) ? v : 0)));
  }
  world.unload();
  return rows;
}

export const COLUMNS = ['base.x', 'base.y', 'base.z', 'tip.x', 'tip.y', 'tip.z',
  'tipVel.x', 'tipVel.y', 'tipVel.z', 'swingSpeed', 'gx', 'gy', 'roll',
  'guard.half', 'stamina', 'guardSpent'];

if (process.argv[1] && process.argv[1].endsWith('_trace.mjs')) {
  const rows = await trace();
  if (process.argv.includes('--record')) {
    const out = new URL('./checks/_singleblade.json', import.meta.url);
    writeFileSync(out, JSON.stringify({ frames: rows.length, columns: COLUMNS, rows }));
    console.log(`recorded ${rows.length} frames × ${COLUMNS.length} floats → ${out.pathname}`);
  }
  const last = rows[rows.length - 1];
  console.log(`${rows.length} frames; last: ` + COLUMNS.map((c, i) => `${c} ${last[i].toFixed(6)}`).join(' '));
}
