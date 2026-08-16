/**
 * DOES A HURT BODY LOOK HURT? — the measurement behind player note #42.
 *
 * "haven't been able to notice the player model looking injured or bloody the
 * more damaged they get."
 *
 * `src/game/Injury.js` is a finished system with a budget, a raycast placer
 * and a check suite. So either it is not running, or it is running and cannot
 * be seen — and those want opposite fixes, so this counts rather than guesses:
 * drive a real Player down its health bar through the real damage funnel, and
 * after each hit report how many marks exist, how much of the body's projected
 * silhouette they cover, and how far the worst-case mark is from the camera.
 *
 *   node --import ./tools/register.mjs tools/_hurt.mjs
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { applyInjury } from '../src/game/Injury.js';

const { world, settings } = await bootWorld({
  level: 'colosseum', settings: { mode: 'waves', difficulty: 'knight', injury: true },
});
const p = world.player;

/* THE SAME SEAM THE MENU USES. Injury installs itself onto Player.damage, and
 * `bootWorld` does not go through Menu — so a probe that skipped this would be
 * measuring a game with the feature switched off and would "reproduce" the
 * report for the wrong reason. */
applyInjury(world, settings);

const marksOn = (root) => {
  let n = 0, tris = 0;
  root.traverse((o) => {
    if (o.isMesh && (o.name?.startsWith('wound') || o.userData?.injury)) {
      n++;
      const g = o.geometry;
      if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return { n, tris };
};

/* How much of the figure the marks actually cover, from a third-person camera
 * — the only view the player can see their own body from. Rendered as a
 * silhouette count rather than an area estimate: rays through a grid over the
 * body's projected box, asking what they hit first. */
function coverage() {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 40);
  const box = new THREE.Box3().setFromObject(p.rig.root);
  const c = box.getCenter(new THREE.Vector3());
  cam.position.set(c.x, c.y + 0.35, c.z + 3.05);
  cam.lookAt(c);
  cam.updateMatrixWorld(true);

  const body = [], wounds = [];
  p.rig.root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    (o.name?.startsWith('wound') || o.userData?.injury ? wounds : body).push(o);
  });
  if (!wounds.length) return { hit: 0, tot: 0, pct: 0, wounds: 0 };

  const ray = new THREE.Raycaster();
  ray.near = 0.05; ray.far = 12;
  let onBody = 0, onWound = 0;
  for (let iy = 0; iy < 70; iy++) {
    for (let ix = 0; ix < 40; ix++) {
      const nx = (ix / 39) * 0.5 - 0.25, ny = (iy / 69) * 1.4 - 0.7;
      ray.setFromCamera({ x: nx, y: ny }, cam);
      const b = ray.intersectObjects(body, true)[0];
      const w = ray.intersectObjects(wounds, true)[0];
      if (!b && !w) continue;
      onBody++;
      if (w && (!b || w.distance <= b.distance + 0.004)) onWound++;
    }
  }
  return { hit: onWound, tot: onBody, pct: onBody ? (100 * onWound / onBody) : 0, wounds: wounds.length };
}

console.log('\n   hp      marks   tris   silhouette covered');
const step = () => { for (let i = 0; i < 6; i++) world.update(1 / 60, idleInput()); };
step();
for (let i = 0; i < 20; i++) {
  // Through the real funnel, from a real direction, with a real amount.
  const from = new THREE.Vector3(
    p.position.x + Math.sin(i * 1.9) * 1.4,
    p.position.y + 1.1 + Math.sin(i) * 0.35,
    p.position.z + Math.cos(i * 1.9) * 1.4);
  p.damage(p.maxHp * 0.055, from, null, 'blaster');
  step();
  const m = marksOn(p.rig.root);
  const c = coverage();
  console.log(`  ${String(Math.round(p.hp)).padStart(4)}   ${String(m.n).padStart(6)}`
    + `  ${String(Math.round(m.tris)).padStart(5)}   ${c.pct.toFixed(2)}%`
    + `  (${c.hit}/${c.tot} rays)`);
}
console.log('');
world.unload();
