/* Probe: the crate that will not go through a breached blast door.
 * Runs the SHUT control and the BREACHED case with the same crate, and reports
 * the depth of the centre and of the leading face for both. */
import './dom-shim.mjs';
import * as THREE from 'three';
if ((await import('three')) !== THREE) { console.error('needs --import ./tools/register.mjs'); process.exit(2); }
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const H = await import('./checks/_coop.mjs');
const { makeCrate } = await import('../src/world/Props.js');
const EXACT = !!process.env.EXACT;
const PRE = +(process.env.PRE || 0);

const idle = () => ({
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis: (o) => { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
});

const { world } = await H.bootWorld({ level: 'geonosis', settings: {} });
world.destruction.prepareBudgetMs = Infinity;
const door = world.doors[1];
const out = V(0, 0, 1).applyQuaternion(door.mesh.quaternion);
const inward = out.clone().negate();
const T = world.terrain;
door.kerfData.fill(0); door.cutArea = 0; door.opened = false;

/* burn `PRE` crates' worth of draws off Props.js's module stream, which is
 * what a suite running eight checks ahead of this one does. */
for (let i = 0; i < PRE; i++) makeCrate(world, V(400, 0, 400), 0.8);

const shove = (label) => {
  const from = door.mesh.position.clone().addScaledVector(out, 0.9);
  from.y = process.env.HIGH ? door.mesh.position.y + door.height * 0.25 : T.height(from.x, from.z) + 0.55;
  const crate = makeCrate(world, from, 0.8, EXACT ? { exactSize: true } : {});
  if (process.env.SQUARE) { crate.body.quaternion.copy(door.mesh.quaternion); crate.body.angularVelocity?.set?.(0, 0, 0); }
  crate.body.velocity.copy(inward).multiplyScalar(9);
  const half = crate.body.extent ? Math.max(crate.body.extent.x ?? 0, crate.body.extent.z ?? 0) : 0;
  let centre = -Infinity, face = -Infinity, v0 = 0;
  for (let f = 0; f < 90; f++) {
    world.update(1 / 60, idle());
    if (f === 0) v0 = crate.body.velocity.dot(inward);
    const d = crate.body.position.clone().sub(door.mesh.position).dot(inward);
    centre = Math.max(centre, d);
    face = Math.max(face, d + half);
    if (process.env.TRACE && f < 24) console.log(`   ${label} f${f} d=${d.toFixed(3)} y=${crate.body.position.y.toFixed(2)} v=${crate.body.velocity.toArray().map((n) => n.toFixed(2)).join(',')}`);
  }
  console.log(`${label}: v0=${v0.toFixed(2)} half=${half.toFixed(3)} centre=${centre.toFixed(3)} face=${face.toFixed(3)}`);
  return { centre, face, half };
};

const shut = shove('SHUT   ');
door.breach();
for (let f = 0; f < 90; f++) world.update(1 / 60, idle());
for (const b of world.physics.bodies || []) {
  const r = b.position.clone().sub(door.mesh.position);
  const depth = r.dot(inward), across = r.dot(V(1, 0, 0).applyQuaternion(door.mesh.quaternion));
  if (depth > -3 && depth < 2 && Math.abs(across) < 3) {
    console.log(`  body depth=${depth.toFixed(2)} across=${across.toFixed(2)} y=${r.y.toFixed(2)} `
      + `extent=${b.extent ? [b.extent.x, b.extent.y, b.extent.z].map((n) => (n ?? 0).toFixed(2)).join('/') : '?'} `
      + `r=${(b.boundingRadius ?? 0).toFixed(2)} static=${!!b.static}`);
  }
}
const open = shove('BREACH ');
console.log(`EXACT=${EXACT} PRE=${PRE} → centre ${shut.centre.toFixed(2)} → ${open.centre.toFixed(2)}`
  + ` · face ${shut.face.toFixed(2)} → ${open.face.toFixed(2)}`);
world.unload();
