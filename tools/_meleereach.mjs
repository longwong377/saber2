/**
 * HOW FAR EACH ATTACK VERB REACHES — a real World, a real Player, a real body
 * pinned at a known distance, and the shipped blade solver's own events.
 *
 *   node --import ./tools/register.mjs tools/_meleereach.mjs <verb> [ranges]
 *   verb ∈ light | over | spin | heavy | heavyhold
 *
 * WHY IT PINS BOTH BODIES. The first three versions of this measured nothing:
 * an acolyte left to walk in chose its own measure and pushed the player back
 * with it, so "actual 3.09 m" came out of a run that asked for 1.0, and every
 * arm read cuts=0. Pinning x/z on both — and letting y settle, because a body
 * held at a chosen height is a body with its feet in the air — is what makes
 * the range on the left of the line the range that was tested.
 *
 * AND IT FACES THE TARGET EVERY FRAME. `p.camera.yaw` is the aim the blade is
 * solved from; without it the player stands where it settled and swings at
 * whatever it happened to be looking at, which is how an early arm read the
 * light cut missing by 5 cm at a body that was 100° off the sightline.
 *
 * Sample readings on the tree that added this (one acolyte, ranges 1.0–2.2 m,
 * `cuts` from the shipped `_applyBladeEvent`):
 *
 *     light   reaches the body at 6 of 7 ranges, out to 2.0 m
 *     spin    all 7, and 2.08 m of forward reach at torso height
 *     heavy   1.0–1.4 m after HEAVY.lift/fall came down; 1.0 m before it
 *     over    1.0 m, and a 1–7 cm miss at every range past it
 *
 * The overhead row is the one to look at again. It is a near-miss and not a
 * shortfall — the same one to seven centimetres at 1.2 m and at 2.0 m, which
 * is not the signature of a reach limit — and `tools/checks/animation.mjs`'s
 * ring reads its forward reach at torso height as 1.64 m, so the two
 * instruments do not agree and neither has been shown wrong.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { segmentSegment } from '../src/physics/Physics.js';

const VERB = process.argv[2] || 'light';
const RANGES = (process.argv[3] || '1.0,1.2,1.4,1.6,1.8,2.0,2.2').split(',').map(Number);
const H = await import('./checks/_coop.mjs');
const { world } = await H.bootWorld({ settings: { mode: 'sandbox', difficulty: 'knight' } });
const p = world.player;
p.saber.lit = true; p.saber.ignition = 1;

let cuts = 0, grinds = 0, work = 0;
const apply = world._applyBladeEvent.bind(world);
world._applyBladeEvent = (pl, ev, dt) => {
  if (ev.type === 'cut') cuts++;
  else if (ev.type === 'grind') { grinds++; work += ev.dWork ?? 0; }
  return apply(pl, ev, dt);
};
const held = new Set(), hit = new Set();
const input = { ...H.idleInput(), act: (id) => held.has(id), actHit: (id) => hit.has(id), actDown: (id) => held.has(id) };
const DT = 1 / 120;
let foe = null, pin = null;
const step = () => {
  if (foe && pin) {
    p.camera.yaw = Math.atan2(-(foe.position.x - p.position.x), -(foe.position.z - p.position.z));
    p.camera.pitch = 0;
    foe.position.x = pin.x; foe.position.z = pin.z;
    foe.velocity.x = 0; foe.velocity.z = 0;
    if (HOME) { p.position.x = HOME.x; p.position.z = HOME.z; p.velocity.x = 0; p.velocity.z = 0; }
  }
  world.update(DT, input);
  hit.clear(); p.hp = p.maxHp; p.stamina = p.maxStamina;
  if (foe) { foe.hp = foe.maxHp; }
};
let HOME = null;
for (let i = 0; i < 120; i++) step();
HOME = p.position.clone();
const press = (a) => { hit.add(a); held.add(a); };
const release = (a) => held.delete(a);
const swinging = () => p.control.slashT >= 0 || p.control.swingT >= 0 || p.control.spinT >= 0;

for (const R of RANGES) {
  p.position.copy(HOME); p.velocity.set(0, 0, 0);
  const at = HOME.clone(); at.z -= R; at.y = world.terrain.height(at.x, at.z);
  if (foe) { foe.dead = true; foe.hp = 0; }
  foe = world.spawnEnemy('acolyte', at);
  pin = { x: at.x, z: at.z };
  for (let i = 0; i < 90; i++) step();
  // reset the combo state between ranges
  p.control.comboStep = 0; p.control.comboTimer = 0; p.control.heavyArmed = false;
  cuts = 0; grinds = 0; work = 0;
  let miss = 1e9, peak = 0, bladeLo = 1e9, reach = 0, reachY = 0, reachFwd = 0;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const sample = () => {
    peak = Math.max(peak, p.saber.tipSpeed);
    bladeLo = Math.min(bladeLo, p.saber.tip.y - p.position.y, p.saber.base.y - p.position.y);
    {
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, p.camera.yaw, 0, 'YXZ'));
      for (let k = 0; k <= 8; k++) {
        const q = p.saber.pointAt(k / 8, new THREE.Vector3());
        const y = q.y - p.position.y;
        if (y < 1.0 || y > 1.8) continue;               // a standing man's torso
        const d = new THREE.Vector3().subVectors(q, p.position).setY(0);
        const f = d.dot(fwd);
        if (f > reachFwd) { reachFwd = f; reachY = y; reach = d.length(); }
      }
    }
    for (const c of foe.capsules() || []) {
      const r = segmentSegment(p.saber.base, p.saber.tip, c.p0, c.p1, _a, _b);
      miss = Math.min(miss, Math.sqrt(r.distSq) - c.r);
    }
  };
  if (VERB === 'light')     { press('thrust'); step(); release('thrust'); for (let i = 0; i < 200 && swinging(); i++) { step(); sample(); } }
  else if (VERB === 'over') { press('attackOver'); step(); release('attackOver'); for (let i = 0; i < 200 && swinging(); i++) { step(); sample(); } }
  else if (VERB === 'spin') { press('attackSpin'); step(); release('attackSpin'); for (let i = 0; i < 200 && swinging(); i++) { step(); sample(); } }
  else if (VERB === 'heavy' || VERB === 'heavyhold') {
    const hold = VERB === 'heavy' ? 2 : 90;
    /* Straight to the third press: the sequence state IS the entry condition,
     * and driving two live cuts first only moves the body we are measuring. */
    p.control.comboStep = 1; p.control.comboTimer = 1;
    press('thrust'); step();
    for (let i = 0; i < hold; i++) step();
    release('thrust'); step(); step();
    for (let i = 0; i < 120 && swinging(); i++) { step(); sample(); }
  }
  const d = Math.hypot(foe.position.x - p.position.x, foe.position.z - p.position.z);
  console.log(`${VERB.padEnd(10)} ${R.toFixed(1)} m (actual ${d.toFixed(2)}): cuts=${cuts} grinds=${grinds} work=${work.toFixed(2)} closest=${miss.toFixed(3)} m  bladeFloor=${bladeLo.toFixed(2)} peak=${peak.toFixed(1)} fwdReach=${reachFwd.toFixed(2)} at y=${reachY.toFixed(2)}`);
  for (let i = 0; i < 60; i++) step();
}
