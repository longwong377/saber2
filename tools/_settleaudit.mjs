/**
 * WHERE EVERYTHING ENDS UP once the level has been left alone.
 *
 * Every level, dressed, stepped for a while with nobody in it, then asked
 * three questions that fail silently in the game:
 *
 *   · is anything at a non-finite position, quaternion or velocity;
 *   · is anything at rest UNDER the ground it is standing on;
 *   · is anything outside the ground at all.
 *
 *   node --import ./tools/register.mjs tools/_settleaudit.mjs [--seconds 30]
 */
import './dom-shim.mjs';
import { bootWorld } from './checks/_coop.mjs';
import { LEVEL_ORDER } from '../src/game/Levels.js';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SECONDS = Number(flag('seconds', '30'));
const ONLY = flag('level', null);
const STEP = 1 / 60;

const f3 = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const f4 = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);

const levels = ONLY ? [ONLY] : LEVEL_ORDER;
for (const key of levels) {
  const { world } = await bootWorld({
    level: key, spawn: false,
    settings: { mode: 'sandbox', level: key, quality: 'high' },
    runSeed: 7,
  });
  const idle = { act: () => false, actHit: () => false, actDown: () => false,
    moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {} };
  for (let i = 0; i < Math.round(SECONDS / STEP); i++) world.update(STEP, idle);

  const T = world.terrain;
  const g = (x, z) => (typeof T?.height === 'function' ? T.height(x, z) : NaN);
  const half = (T?.size ?? 512) / 2;
  const bad = { nan: [], sunk: [], out: [] };
  for (const b of world.physics.bodies) {
    const tag = `${b.userData?.kind || b.shape?.type || 'body'}#${b.id}`;
    if (!f3(b.position) || !f4(b.quaternion) || !f3(b.velocity)) { bad.nan.push(tag); continue; }
    const gh = g(b.position.x, b.position.z);
    const drop = b.extent ? Math.max(0.3, b.extent.y) : 0.3;
    if (Number.isFinite(gh) && b.position.y < gh - drop) bad.sunk.push(`${tag} y=${b.position.y.toFixed(1)} ground=${gh.toFixed(1)}`);
    if (Math.abs(b.position.x) > half || Math.abs(b.position.z) > half) bad.out.push(`${tag} at ${b.position.x.toFixed(0)},${b.position.z.toFixed(0)}`);
  }
  const sbad = { nan: [], sunk: [], out: [] };
  for (const s of world.physics.staticBoxes) {
    if (!f3(s.center) || !f4(s.quat) || !f3(s.halfExtents)) { sbad.nan.push('static'); continue; }
    const gh = g(s.center.x, s.center.z);
    if (Number.isFinite(gh) && s.center.y + s.halfExtents.y < gh - 0.25) {
      sbad.sunk.push(`top=${(s.center.y + s.halfExtents.y).toFixed(1)} ground=${gh.toFixed(1)} at ${s.center.x.toFixed(0)},${s.center.z.toFixed(0)}`);
    }
    if (Math.abs(s.center.x) > half || Math.abs(s.center.z) > half) sbad.out.push(`at ${s.center.x.toFixed(0)},${s.center.z.toFixed(0)}`);
  }
  console.log(`${key.padEnd(10)} bodies=${String(world.physics.bodies.length).padStart(4)} statics=${String(world.physics.staticBoxes.length).padStart(4)}`
    + `  nan=${bad.nan.length + sbad.nan.length} sunkBody=${bad.sunk.length} sunkStatic=${sbad.sunk.length} out=${bad.out.length + sbad.out.length}`);
  for (const k of ['nan', 'sunk', 'out']) {
    for (const s of bad[k].slice(0, 4)) console.log(`    body  ${k}: ${s}`);
    for (const s of sbad[k].slice(0, 4)) console.log(`    static ${k}: ${s}`);
  }
  world.dispose?.();
}
process.exit(0);
