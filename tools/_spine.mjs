/**
 * WHERE AN ANIMAL'S SPINE ACTUALLY POINTS — as one number per body.
 *
 * `_creature.mjs` prints L/H, fill and IoU, which are the forty-metre reads,
 * and every one of them was GREEN on a tauntaun that hung nose-down: a body
 * sloping 30 degrees at the sand has the same bounding box, the same fill and
 * the same silhouette area as one standing like a runner. The defect the
 * player can see is not in any of those, so it needed its own measure.
 *
 *   node --import ./tools/register.mjs tools/_spine.mjs taun,blurrg,brute
 *
 * Per body: the world height of the head, the hip and the tail root off the
 * REAL posed rig, and the angle of the head-over-hip line. Positive is nose
 * up. A quadruped runs about level; a two-legged runner carries its head
 * above its hips and reads positive.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { initPhysics } from '../src/physics/Rapier.js';
import { RapierWorld } from '../src/physics/RapierWorld.js';
import { Enemy, enemyRng, ARCHETYPES } from '../src/game/Enemy.js';
import '../src/game/Levels.js';

await initPhysics();
const world = { rng: enemyRng, physics: new RapierWorld(), scene: new THREE.Group(),
  add() {}, remove() {}, terrain: { height: () => 0, raycast: () => null } };
const ctx = { player: { position: new THREE.Vector3(0, 0, 40) }, dt: 1 / 60 };

/* AN ASCII FLANK, because the render loop is the slow one.
 * `_beastshot.mjs` boots a browser, a level and a deploy for every look, and
 * the tauntaun's stance took four passes to read. This rasterises the same
 * flank the silhouette measures already use — the animal facing +X, seen down
 * -Z, feet on the bottom row — straight to the terminal, so a plan number can
 * be changed and judged in under two seconds. The renders stay: this says
 * WHERE THE MASS IS, and they say whether it looks like anything. */
const AW = 74, AH = 26;
function ascii(root, span) {
  const rows = Array.from({ length: AH }, () => new Array(AW).fill(' '));
  const box = new THREE.Box3().setFromObject(root);
  const u0 = box.min.x - 0.2, u1 = box.max.x + 0.2;
  const sx = (AW - 1) / (u1 - u0), sy = (AH - 1) / span;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry, p = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let i = 0; i < n; i += 3) {
      const q = [0, 1, 2].map((k) => {
        const j = idx ? idx.getX(i + k) : i + k;
        return [a, b, c][k].fromBufferAttribute(p, j).applyMatrix4(o.matrixWorld);
      });
      for (const v of q) {
        const x = Math.round((v.x - u0) * sx), y = Math.round((span - v.y) * sy);
        if (x >= 0 && x < AW && y >= 0 && y < AH) rows[y][x] = '#';
      }
    }
  });
  return rows.map((r) => '  |' + r.join('') + '|').join('\n');
}

const list = (process.argv[2] || 'taun').split(',');
const V = new THREE.Vector3();
for (const type of list) {
  enemyRng.seed(99);
  const e = new Enemy(world, type, new THREE.Vector3(0, 0, 0));
  e.position.set(0, 0, 0);
  e.facing = Math.PI / 2;
  e.walkPhase = 0.12;
  e.state = 'approach';
  e._poseWalker(1 / 60, ctx);
  const root = e.rig.root;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y;                 // feet on the ground line
  root.updateMatrixWorld(true);

  const at = (name) => (e.rig.get(name) ? e.rig.worldPos(name, new THREE.Vector3()) : null);
  const head = at('head') || at('skull'), body = at('body'), tail = at('tail');
  const names = [...e.rig.bones.keys()];
  const bb = new THREE.Box3().setFromObject(root).getSize(V.clone());
  let line = `${type.padEnd(8)} H ${bb.y.toFixed(2)} L ${bb.x.toFixed(2)}`;
  if (head) line += `  head y ${head.y.toFixed(2)} z ${head.z.toFixed(2)}`;
  if (body) line += `  body y ${body.y.toFixed(2)}`;
  if (head && body) {
    const dz = Math.abs(head.z - body.z) || 1e-6;
    line += `  nose ${(Math.atan2(head.y - body.y, dz) * 180 / Math.PI).toFixed(0)}deg`;
    line += `  head/H ${(head.y / bb.y).toFixed(2)}`;
  }
  // The head BONE is not the head: the neck and skull are geometry hung off it
  // with large local offsets, so a plan can put the bone high and the face on
  // the sand. Measure the box of what is actually parented under each bone.
  const boxOf = (name) => {
    const b = e.rig.get(name); if (!b) return null;
    const bx = new THREE.Box3().setFromObject(b.obj);
    return bx.isEmpty() ? null : bx;
  };
  for (const n of ['head', 'body', 'hips']) {
    const bx = boxOf(n); if (!bx) continue;
    const c = bx.getCenter(new THREE.Vector3()), sz = bx.getSize(new THREE.Vector3());
    line += `\n   ${n.padEnd(5)} box y ${bx.min.y.toFixed(2)}..${bx.max.y.toFixed(2)} z ${bx.min.z.toFixed(2)}..${bx.max.z.toFixed(2)} centre y ${c.y.toFixed(2)} size ${sz.x.toFixed(2)}x${sz.y.toFixed(2)}x${sz.z.toFixed(2)}`;
  }
  console.log(line);
  if (process.env.SPINE_ART) console.log(ascii(root, Math.max(bb.y, bb.x) * 1.05));
  if (process.env.SPINE_NAMES) console.log('   nodes:', [...new Set(names)].join(' '));
}
process.exit(0);
