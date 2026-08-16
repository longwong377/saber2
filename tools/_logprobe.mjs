/**
 * DOES A FELLED LOG BECOME SOMETHING YOU CAN PICK UP?
 *
 * Player note #8 at the tree — "can't pick up the trees either, it's like
 * they're not real" — and `Forest._realise` is the answer. This drives a real
 * World: boot the wood, stand a player in it, fell the nearest trunk, and then
 * ask the two questions that matter, in the order the player would.
 *
 *   node --import ./tools/register.mjs tools/_logprobe.mjs
 */
import './dom-shim.mjs';

const THREE = await import('three');
const { World } = await import('../src/game/World.js');
const { DEFAULT_SETTINGS } = await import('../src/ui/Menu.js');
const { initPhysics } = await import('../src/physics/Rapier.js');
const { DOWN } = await import('../src/world/Trees.js');

await initPhysics();

const scene = new THREE.Scene();
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun, new THREE.HemisphereLight(0x88aaff, 0x886644, 1));
const engine = {
  scene, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900),
  sun, hemi: scene.children[1], sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
  renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
  profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
  applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
  setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
  setQuality() {}, setResolutionScale() {}, render() {},
};
const world = new World(engine, { ...DEFAULT_SETTINGS, quality: 'low', mode: 'waves' });
await world.loadLevel('wood');
world.spawnPlayer();
const p = world.player;
const F = world.forest;
console.log(`forest: ${F.count} trees, ${world.scene.children.length} scene children`);

// stand the player next to a tree and fell it away from them
let best = -1, bestD = 1e9;
for (let i = 0; i < F.count; i++) {
  const d = (F.data[i * 15] - p.position.x) ** 2 + (F.data[i * 15 + 1] - p.position.z) ** 2;
  if (d < bestD) { bestD = d; best = i; }
}
const bx = F.data[best * 15], bz = F.data[best * 15 + 1];
console.log(`nearest trunk ${best} at ${bx.toFixed(1)}, ${bz.toFixed(1)} — ${Math.sqrt(bestD).toFixed(1)} m away`);
F.fell(best, bx - p.position.x, bz - p.position.z, 0.6);

const idle = {
  axis: { x: 0, y: 0 }, act: () => false, actHit: () => false, actDown: () => false,
  moveAxis(o) { if (o) { o.x = 0; o.y = 0; return o; } return { x: 0, y: 0 }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
};
for (let f = 0; f < 60 * 12; f++) {
  p.position.set(bx + 3, world.terrain.height(bx + 3, bz), bz);
  world.update(1 / 60, idle);
}
const state = F.data[best * 15 + 6];
const logs = world.props.filter((q) => q.kind === 'log' && !q.dead);
console.log(`tree state ${state} (DOWN=${DOWN}); ${F.real.size} realised, ${logs.length} log prop(s)`);
for (const l of logs) {
  console.log(`  log mass ${l.body.mass.toFixed(0)} kg  grippable ${l.grippable}  `
    + `caps ${l.capsules ? l.capsules().length : '-'}  at (${l.body.position.x.toFixed(1)}, `
    + `${l.body.position.y.toFixed(1)}, ${l.body.position.z.toFixed(1)})`);
}
// and walk away: the log goes back to being an instance
for (let f = 0; f < 60 * 3; f++) {
  p.position.set(bx + 40, world.terrain.height(bx + 40, bz), bz);
  world.update(1 / 60, idle);
}
console.log(`after walking 40 m off: ${F.real.size} realised, `
  + `${world.props.filter((q) => q.kind === 'log' && !q.dead).length} log prop(s)`);
world.unload();
console.log('unloaded cleanly');
