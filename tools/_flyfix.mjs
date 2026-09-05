/* THROWAWAY probe for the Starfury lane. Delete when it closes. */
import './dom-shim.mjs';
/* Levels.js first: it imports STATION_LEVEL out of Station.js, so entering the
 * cycle from Station's side is a TDZ. Pre-existing; the suites enter from the
 * World's side and never see it. */
import '../src/game/Levels.js';
import { readFile } from 'node:fs/promises';

function diskFetch() {
  if (globalThis.__stationFetch) return;
  const root = new URL('../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

async function station(deck = 12) {
  const { bootWorld } = await import('./checks/_coop.mjs');
  const { prepareStation } = await import('../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station', settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return world;
}

function stick() {
  const hit = new Set(), held = new Set(), ax = { x: 0, y: 0 };
  return {
    hit, held, ax,
    act: (id) => held.has(id) || hit.has(id),
    actHit: (id) => hit.has(id),
    actDown: (id) => held.has(id) || hit.has(id),
    moveAxis: (o) => { if (o) { o.x = ax.x; o.y = ax.y; return o; } return { x: ax.x, y: ax.y }; },
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 },
    end() { hit.clear(); this.mouse.dx = 0; this.mouse.dy = 0; },
  };
}

const world = await station(12);
const { PLACE, floorOf } = await import('../src/game/StationPlan.js');
const { CERT } = await import('../src/game/FlightOps.js');
const O = await import('../src/game/Outside.js');

const st = world._station;
world._flight = { v: 1, cert: CERT.map((c) => c.id), gantries: [0, 1, 2], boards: 3, bells: [], sorties: 0 };
const bay = PLACE.get(5);
const p = world.player;
p.position.set(bay.door[0], floorOf(bay), bay.door[1]);
p.body?.position?.copy(p.position);

const input = stick();
const said = [];
world.notify = (t, l) => said.push(`${t}: ${l}`);
const dt = 1 / 60;
const step = (n, before) => { for (let i = 0; i < n; i++) { before?.(i); world.update(dt, input); input.end(); } };
const deg = (r) => (r * 180 / Math.PI).toFixed(1);

/* ── 1. BOARD AND LAUNCH ─────────────────────────────────────────────── */
step(6);
input.hit.add('focus');
step(1);
const p0 = p.position.clone();
step(60 * 8);                                     // through the six phases
const seat = world._seat;
console.log('══ BOARDED ══');
console.log(`  seat=${!!seat} player.driving=${p.driving === seat} flying=${world._flying}`);
console.log(`  body has moved ${p.position.distanceTo(p0).toFixed(1)} m from the well`);
console.log(`  craft ${world._seat.craft.position.map(n => n.toFixed(1)).join(', ')} at ${seat.speed.toFixed(1)} m/s`);
console.log(`  bay ${JSON.stringify(st.bay)}  bayRig draws=${st.bayRig?.draws} tris=${st.bayRig?.tris}`);

/* ── 2. SIX AXES, ONE AT A TIME, MEASURED ────────────────────────────── */
console.log('\n══ SIX AXES — each held 1.0 s from a stopped craft ══');
function axisProbe(label, set) {
  const c = seat.craft;
  c.velocity = [0, 0, 0]; c.angularVelocity = [0, 0, 0];
  c.orientation = [1, 0, 0, 0];
  const w0 = [...c.angularVelocity], v0 = [...c.velocity];
  set(true);
  step(60);
  set(false);
  const s = seat.stick;
  const w = c.angularVelocity, v = c.worldToBody(c.velocity);
  console.log(`  ${label.padEnd(26)} stick=${JSON.stringify(Object.fromEntries(
    Object.entries(s).map(([k, n]) => [k, +n.toFixed(2)])))}`);
  console.log(`  ${''.padEnd(26)} bodyRate=[${w.map(n => n.toFixed(3)).join(', ')}] rad/s  `
    + `bodyVel=[${v.map(n => n.toFixed(2)).join(', ')}] m/s`);
}
axisProbe('THROTTLE  moveF (W)', (on) => { input.ax.y = on ? 1 : 0; });
axisProbe('THROTTLE  moveB (S)', (on) => { input.ax.y = on ? -1 : 0; });
axisProbe('SWAY      moveR (D)', (on) => { input.ax.x = on ? 1 : 0; });
axisProbe('HEAVE     jump', (on) => { on ? input.held.add('jump') : input.held.delete('jump'); });
axisProbe('HEAVE     crouch', (on) => { on ? input.held.add('crouch') : input.held.delete('crouch'); });
axisProbe('ROLL      rollR (E)', (on) => { on ? input.held.add('rollR') : input.held.delete('rollR'); });
/* THE MOUSE IS A PER-FRAME DELTA, so it is re-armed before every update — the
 * probe's own `step` does `before(); update(); end()` for exactly this. */
function mouseProbe(label, dx, dy) {
  const c = seat.craft;
  c.velocity = [0, 0, 0]; c.angularVelocity = [0, 0, 0]; c.orientation = [1, 0, 0, 0];
  step(60, () => { input.mouse.dx = dx; input.mouse.dy = dy; });
  const f = c.forward;
  console.log(`  ${label.padEnd(26)} stick={pitch:${seat.stick.pitch.toFixed(2)}, yaw:${seat.stick.yaw.toFixed(2)}}`);
  console.log(`  ${''.padEnd(26)} bodyRate=[${c.angularVelocity.map(n => n.toFixed(3)).join(', ')}] rad/s  `
    + `nose now (${f.map(n => n.toFixed(2)).join(', ')})`);
}
mouseProbe('YAW       mouse dx=+30/fr', 30, 0);
mouseProbe('PITCH     mouse dy=+30/fr', 0, 30);

/* ── 3. THE TWO BRAKES ───────────────────────────────────────────────── */
console.log('\n══ THE BRAKES ══');
{
  const c = seat.craft;
  c.angularVelocity = [0.5, -0.35, 0.22];
  const w0 = Math.hypot(...c.angularVelocity);
  input.held.add('blade');
  step(60 * 6);
  input.held.delete('blade');
  console.log(`  kill-rotation (guard held 6 s): ${w0.toFixed(3)} -> ${Math.hypot(...c.angularVelocity).toFixed(3)} rad/s`);
}
{
  const c = seat.craft;
  c.velocity = [0, 0, 90];
  const s0 = c.speed;
  input.held.add('sprint');
  step(60 * 6);
  input.held.delete('sprint');
  console.log(`  kill-velocity (sprint held 6 s): ${s0.toFixed(1)} -> ${c.speed.toFixed(1)} m/s`);
}

/* ── 4. THE CAMERA ───────────────────────────────────────────────────── */
console.log('\n══ THE CAMERAS ══');
{
  const cam = p.camera;
  seat.craft.orientation = [1, 0, 0, 0];
  step(2);
  const chase = { fp: cam.firstPerson, d: cam.distance, pos: cam.pos.clone(), yaw: cam.yaw, pitch: cam.pitch };
  input.hit.add('view');
  step(2);
  const pit = { fp: cam.firstPerson, d: cam.distance, pos: cam.pos.clone() };
  console.log(`  chase   firstPerson=${chase.fp} boom=${chase.d.toFixed(1)} m  lens ${chase.pos.distanceTo(p.position).toFixed(1)} m off the airframe`);
  console.log(`  cockpit firstPerson=${pit.fp} boom=${pit.d.toFixed(1)} m  lens ${pit.pos.distanceTo(p.position).toFixed(2)} m off the airframe`);
  console.log(`  and the rig is bolted to the nose: cam.yaw=${deg(chase.yaw)}° cam.pitch=${deg(chase.pitch)}° `
    + `for a nose at (${seat.craft.forward.map(n => n.toFixed(2)).join(', ')})`);
  input.hit.add('view'); step(2);   // back to chase
}

/* ── 5. A LAP, FLOWN BY HAND, AND A LANDING ──────────────────────────── */
console.log('\n══ A LAP AT THE STICK ══');
{
  const c = seat.craft;
  /* Put it back at the mouth and fly the circuit with a hand on it: the stick
   * is worked toward the track's own tangent, so every command below is one a
   * player could give and every metre is integrated by Starfury.step. */
  const V = (await import('../src/game/Starfury.js')).V;
  seat.u = 0; seat.travelled = 0; seat.lap = 0; seat.t = 0;
  const m = O.sample(0);
  c.position = [m.x, m.y, m.z];
  c.velocity = [0, 0, 0]; c.angularVelocity = [0, 0, 0];
  let t = 0, tight = Infinity, top = 0, mouseWork = 0, keyFrames = 0, wide = 0;
  /* A HAND ON IT, and it is a real one: the pilot looks at where the track
   * goes, works out which way he wants to be accelerating, PUTS THE NOSE ON
   * THAT and opens the throttle when it is on. Every number below leaves this
   * loop as a mouse delta and a W key — nothing here touches the craft. */
  const LEAD = 90, HOLD = 45, CROSS = 0.5, TAU_V = 0.3, K_P = 300, K_D = 150;
  const aMax = c.maxLinearAccel();
  while (t < 230 && seat.lap < 1 && world._flying) {
    const at = seat.u + LEAD / O.CIRCUIT_LENGTH;
    const aim = O.sample(at);
    const t0 = O.sample(at - 0.001), t1 = O.sample(at + 0.001);
    const T = V.unit([t1.x - t0.x, t1.y - t0.y, t1.z - t0.z]);
    const off = [c.position[0] - aim.x, c.position[1] - aim.y, c.position[2] - aim.z];
    const along = V.dot(off, T);
    const lateral = [off[0] - T[0] * along, off[1] - T[1] * along, off[2] - T[2] * along];
    const want = [T[0] * HOLD - lateral[0] * CROSS, T[1] * HOLD - lateral[1] * CROSS, T[2] * HOLD - lateral[2] * CROSS];
    const acc = [(want[0] - c.velocity[0]) / TAU_V, (want[1] - c.velocity[1]) / TAU_V, (want[2] - c.velocity[2]) / TAU_V];
    const need = V.norm(acc);
    const dir = need > 1e-6 ? V.scale(acc, 1 / need) : T;
    const b = c.worldToBody(dir);
    const w = c.angularVelocity;
    input.mouse.dx = Math.max(-60, Math.min(60, K_P * b[0] - K_D * w[1]));
    input.mouse.dy = Math.max(-60, Math.min(60, -K_P * b[1] - K_D * w[0]));
    mouseWork += Math.abs(input.mouse.dx) + Math.abs(input.mouse.dy);
    input.ax.y = (b[2] > 0.86 && need > 1.5) ? 1 : 0;
    if (input.ax.y) keyFrames++;
    world.update(dt, input); input.end();
    t += dt;
    const [x, y, z] = c.position;
    tight = Math.min(tight, O.clearanceAt({ x, y, z }));
    top = Math.max(top, c.speed);
    const on = O.sample(seat.u);
    wide = Math.max(wide, Math.hypot(on.x - x, on.y - y, on.z - z));
  }
  input.ax.y = 0; input.ax.x = 0; input.mouse.dx = 0; input.mouse.dy = 0;
  console.log(`  lap=${seat.lap} in ${t.toFixed(1)} s — travelled ${(seat.travelled * 100).toFixed(0)}% of a second`);
  console.log(`  the hand did ${Math.round(mouseWork)} px of stick and held the throttle for ${keyFrames} frames`);
  console.log(`  top speed ${top.toFixed(1)} m/s, tightest clearance ${tight.toFixed(1)} m (Outside.CLEAR ${O.CLEAR}), widest of the line ${wide.toFixed(0)} m`);
  console.log(`  after the lap: flying=${world._flying} sortie=${world._sortie?.way}/${world._sortie?.phase}`);
  step(60 * 7);
  console.log(`  recovery done: flying=${world._flying} driving=${!!p.driving} sorties=${world._flight.sorties}`);
  console.log(`  deck ${st.deck}; player is at ${p.position.toArray().map(n => n.toFixed(1)).join(', ')} (bay door is `
    + `${bay.door[0]}, ${floorOf(bay).toFixed(1)}, ${bay.door[1]})`);
  console.log(`  bay parked: ${JSON.stringify(st.bay)}`);
  console.log('  said:', said.slice(-3));
}

/* ── 6. KILLED MID-FLIGHT ────────────────────────────────────────────── */
console.log('\n══ INTERRUPTED SORTIE ══');
{
  said.length = 0;
  world._flight = { ...world._flight, sorties: 0 };
  p.position.set(bay.door[0], floorOf(bay), bay.door[1]);
  step(4);
  input.hit.add('focus');
  step(1);
  step(60 * 10);
  console.log(`  outside: flying=${world._flying} u=${(world._orbitU ?? 0).toFixed(3)} seat=${!!world._seat}`);
  const hour0 = st.hour;
  p.die?.('the probe');
  console.log(`  killed. world.over=${world.over}`);
  console.log(`  same frame: flying=${world._flying} seat=${!!world._seat} sortie=${world._sortie?.way ?? 'none'}`);
  step(60 * 30);
  console.log(`  30 s later: flying=${world._flying} sorties=${world._flight.sorties} mine=${st.mine}`);
  console.log(`  the station clock ran ${hour0.toFixed(4)} -> ${st.hour.toFixed(4)} (+${((st.hour - hour0) * 60).toFixed(1)} min)`);
  console.log(`  the body is at ${p.position.toArray().map(n => n.toFixed(1)).join(', ')}`);
  console.log(`  bay parked: ${JSON.stringify(st.bay)}`);
  console.log('  said:', said.slice(-2));
}
