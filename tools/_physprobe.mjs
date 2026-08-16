/**
 * WHERE THE INTANGIBLE OBJECTS ARE — a histogram over `tools/checks/physicality.mjs`.
 *
 * The check reports a share and the first fourteen offenders. That is the
 * right thing for a gate and the wrong thing for a fix: 784 failures printed
 * fourteen at a time tells you nothing about which MAKER is producing them,
 * and the makers are where the fix goes. This runs the same geometric test and
 * groups by `userData.__maker` (set by `island`) and by mesh/material name.
 *
 *   node --import ./tools/register.mjs tools/_physprobe.mjs [level ...]
 */
import '../tools/dom-shim.mjs';

const NOT_MATTER = /(light|lamp|glow|flame|fire|ember|smoke|steam|haze|dust|mist|fog|water|sea|lava|melt|sky|cloud|star|beam|bolt|spark|halo|aura|shadow|decal|ink|billboard|card|impostor|sprite|banner|flag|cloth|cape|skirt|sash|grass|foliage|leaf|leaves|canopy|reed|weed)/i;
const REACH = 9.0;

const { LEVEL_ORDER } = await import('../src/game/Levels.js');
const { bootWorld } = await import('./checks/_coop.mjs');

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const keys = only.length ? only : LEVEL_ORDER;

const tally = new Map();
let reachable = 0, badTotal = 0;
for (const key of keys) {
  const { world } = await bootWorld({ level: key, settings: { mode: 'waves', quality: 'low' } });
  const terrain = world.terrain;
  const boxes = (world.physics?.staticBoxes || []).filter((b) => !b.disabled);
  const _lp = new (world.player?.position?.constructor ?? Object)();
  const hasCollider = (centre, halfSpan) => {
    for (const b of boxes) {
      if (centre.distanceToSquared(b.center) > (b.radius + halfSpan) ** 2) continue;
      _lp.copy(centre).sub(b.center).applyQuaternion(b.invQuat);
      const h = b.halfExtents;
      if (Math.abs(_lp.x) <= h.x + halfSpan && Math.abs(_lp.y) <= h.y + halfSpan
        && Math.abs(_lp.z) <= h.z + halfSpan) return true;
    }
    for (const b of (world.physics?.bodies || [])) {
      if (!b.position) continue;
      const r = (b.radius ?? 0.6) + halfSpan;
      if (centre.distanceToSquared(b.position) <= r * r) return true;
    }
    return false;
  };
  world.scene.updateMatrixWorld(true);
  let lr = 0, lb = 0;
  world.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const name = `${o.name || ''} ${o.material?.name || ''}`;
    if (NOT_MATTER.test(name)) return;
    if (o.material?.transparent && (o.material.opacity ?? 1) < 0.9) return;
    if (o.isInstancedMesh) return;
    o.geometry?.computeBoundingBox?.();
    const bb = o.geometry?.boundingBox;
    if (!bb) return;
    const size = bb.getSize(new (o.position.constructor)());
    if (Math.max(size.x, size.y, size.z) > 14) return;
    const c = bb.getCenter(new (o.position.constructor)()).applyMatrix4(o.matrixWorld);
    if (!terrain?.inBounds?.(c.x, c.z)) return;
    const gh = terrain.height(c.x, c.z);
    if (c.y - gh > REACH) return;
    reachable++; lr++;
    const halfSpan = Math.min(1.2, Math.max(size.x, size.y, size.z) * 0.5);
    if (hasCollider(c, halfSpan)) return;
    badTotal++; lb++;
    let depth = 0;
    for (let a = o; a && a !== world.scene; a = a.parent) depth++;
    const rig = depth > 1;             // a body/hilt hangs off a Group; a prop does not
    const dim = `${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)}`;
    const tag = rig ? `${key}/CHARACTER-RIG` : `${key}/${o.userData?.__maker || o.name || 'level'} ${dim}`;
    tally.set(tag, (tally.get(tag) || 0) + 1);
  });
  console.log(`${key.padEnd(11)} ${String(lb).padStart(4)} intangible of ${String(lr).padStart(4)} reachable`);
  world.unload();
}
console.log('\nby maker:');
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}
console.log(`\nTOTAL ${badTotal} of ${reachable} = ${(100 * badTotal / reachable).toFixed(1)}%`);
