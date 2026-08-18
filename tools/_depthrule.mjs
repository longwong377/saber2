/**
 * WHAT THE DEPTH RULE ACTUALLY BOUGHT, measured rather than asserted.
 *
 * The Temple's own comment states the rule — "an interior stops being a box
 * when there are three more colonnades between the player and the wall" — and a
 * rule with no number against it is a slogan. This walks the built level and
 * asks two things from every square metre of its floor:
 *
 *   HOW FAR CAN YOU SEE     the distance to the first thing that stops the eye,
 *                           over 32 bearings. In a box this is the width of the
 *                           box; in the reference frames it is the third arcade.
 *   CAN YOU FIND THE WALL   the share of bearings on which a ray leaves the room
 *                           without meeting anything at all. That is the number
 *                           the complaint is about: a wall you can find is a
 *                           room you have measured.
 *
 * Run against the foundry too, because that is the other interior in the game
 * and the one the same note names ("you're in a large box").
 *
 *   node --import ./tools/register.mjs tools/_depthrule.mjs [level ...]
 */
import './dom-shim.mjs';

const THREE = await import('three');
const { Terrain } = await import('../src/world/Terrain.js');
const { LEVELS } = await import('../src/game/Levels.js');

function stubWorld(terrain, level) {
  const scene = new THREE.Scene();
  return {
    scene, level, statics: [], levelLights: [], props: [], enemies: [], doors: [], grass: null,
    physics: { addStaticBox(c, h, q) { this.staticBoxes.push({ c, h, q }); return null; },
      staticBoxes: [], add() {}, bodies: [], raycast: () => null },
    addLight(l) { (this.lights ||= []).push(l); scene.add(l); return l; },
    addDoor(d) { this.doors.push(d); return d; },
    particles: { sandPuff() {}, sparkBurst() {}, slag() {} },
    notify() {}, report() {}, spawnEnemy: () => null, time: 0,
    addProp(p) { this.props.push(p); return p; },
    terrain, settings: { quality: 'medium' },
  };
}

const keys = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const key of (keys.length ? keys : ['colosseum', 'geonosis'])) {
  const L = LEVELS[key];
  const terrain = new Terrain(new THREE.Scene(), L.terrain, 0.5);
  const world = stubWorld(terrain, L);
  L.dress(world);

  /* THE OCCLUDERS ARE THE COLLIDERS, which is the honest set: everything the
   * player can walk into is everything that stops the eye, and reading them off
   * `physics.staticBoxes` means this measures what the level BUILT rather than
   * a restatement of the table it built from (HANDOFF §2.4). Anything under
   * 1.7 m tall is stepped over by the eye and does not count. */
  const occ = world.physics.staticBoxes
    .filter((b) => b.h.y * 2 > 1.7)
    .map((b) => ({ x: b.c.x, z: b.c.z, r: Math.max(b.h.x, b.h.z) }));

  const half = terrain.half ?? 150;
  const R = Math.min(100, half - 20);
  const BEAR = 32, STEP = 6;
  const runs = [];
  let openRays = 0, rays = 0, samples = 0;
  for (let z = -R; z <= R; z += STEP) {
    for (let x = -R; x <= R; x += STEP) {
      if (!terrain.inBounds(x, z, 8)) continue;
      if (terrain.slopeAt(x, z) > 0.5) continue;
      samples++;
      for (let b = 0; b < BEAR; b++) {
        const a = (b / BEAR) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        let hit = Infinity;
        for (const o of occ) {
          const ox = o.x - x, oz = o.z - z;
          const t = ox * dx + oz * dz;
          if (t <= 0.5 || t >= hit) continue;
          const px = ox - dx * t, pz = oz - dz * t;
          if (px * px + pz * pz < o.r * o.r) hit = t;
        }
        // …and the room's own wall, found by walking until the ground climbs
        if (hit === Infinity) {
          for (let t = 4; t < 300; t += 4) {
            const wx = x + dx * t, wz = z + dz * t;
            if (!terrain.inBounds(wx, wz, 2) || terrain.height(wx, wz) - terrain.height(x, z) > 4) {
              hit = t; break;
            }
          }
          openRays++;
        }
        rays++;
        runs.push(Math.min(hit, 300));
      }
    }
  }
  runs.sort((p, q) => p - q);
  const pct = (f) => runs[Math.min(runs.length - 1, Math.floor(runs.length * f))];
  console.log(`${key.padEnd(9)} ${samples} floor samples, ${occ.length} occluders over 1.7 m`);
  console.log(`          sight line  p50 ${pct(0.5).toFixed(0)} m   p90 ${pct(0.9).toFixed(0)} m   `
    + `p99 ${pct(0.99).toFixed(0)} m`);
  console.log(`          bearings that meet NOTHING before the wall: `
    + `${(100 * openRays / rays).toFixed(1)}%`);
  terrain.dispose();
}
