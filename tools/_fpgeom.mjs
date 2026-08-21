/**
 * WHERE THE FIRST-PERSON ARMS ARE, IN THE FRAME — as numbers rather than as a
 * picture, so the answer arrives in a second instead of in twenty minutes.
 *
 * `fpview.mjs` renders the view and is the authority on what it looks like.
 * This is the cheap twin that says WHY: it poses a real Player in first person
 * and projects every arm joint into normalised device coordinates, so "the
 * forearms fill the bottom of the screen" becomes a percentage of frame height
 * with a joint's name against it.
 *
 *   node --import ./tools/register.mjs tools/_fpgeom.mjs
 *
 * ── WHAT IT FOUND, and what is still open ──────────────────────────────
 *
 * "The first person hand/hilt still looks like jumbled garbage, idk why you
 * still have not figured it out" — the third report of the same thing. The two
 * rounds before this moved the SHOULDERS (they sat 6.8 cm behind the near
 * plane, so the arms were sliced open by the camera) and raised the blade
 * ANCHOR (the hands were 13 degrees below the bottom of the frame). Both were
 * real, both are fixed, and the complaint survived them — so a third guess at
 * the pose was worth nothing without a number.
 *
 * The number is OCCLUSION, and nothing had ever measured it:
 *
 *     hilt on screen                    27.7% of frame height
 *     of that, behind the player's own fists          91%
 *
 * A hilt that is a quarter of the frame and nine-tenths hidden is not a hilt,
 * it is a pale smudge where the blade begins — which is exactly what the
 * player's screenshot shows, and exactly what the supplied reference does not:
 * there, a fist sits low on the grip with the whole emitter section standing
 * clear above it.
 *
 * The cause is GRIP_AT: the two fists take the hilt at +0.050 and −0.015 on a
 * shaft whose metal spans −0.092 to +0.158, so they straddle the middle and
 * leave a pommel cap at one end and a ring at the other. Correct and invisible
 * in third person; the whole object at 0.5 m from a lens.
 *
 * ── AND THAT IS WHAT IT NOW READS ──────────────────────────────────────
 *
 *     hilt on screen        38.5% of frame height, 31 of 31 samples
 *     behind the fists                                       32%
 *
 * The way out was the one the reference itself shows: ONE HAND on the hilt,
 * with the fist slid down to the pommel. Both halves were needed and the split
 * is worth keeping, because either one alone looks like a failure. Taking the
 * off hand off the hilt and changing nothing else is 91% → 71%: the remaining
 * fist still straddles the middle. Sliding that fist to the pommel takes it to
 * 32%.
 *
 * WHAT IT COST is 1.5 cm of first-person reach — the anchor had to rise 0.26 →
 * 0.32 to bring the pommel back inside the frame, and `armMax` measures the
 * arm from the anchor, so the ratchet in tools/checks/first-person.mjs went
 * 1.276 to 1.293 against its 1.30 bound. The bound was not moved. See the note
 * over HILT in Player.js for the sweep.
 *
 * ── AND ONE HAND IS NOT WHAT FIRST PERSON IS. IT IS WHAT A GRIP IS ─────────
 *
 * The paragraph above used to end "that is a design decision about what a
 * first-person grip IS, so it was the player's call, and the player made it".
 * The player then made a different one, about the question rather than the
 * answer: *"Why the fuck would it be either or, both should be modeled and
 * reflect how many hands you're holding it with"*. So the hand count is
 * `Player.handsOnHilt()` — the one-hand key, a Force power in the off hand, a
 * thrown blade, a dropped one — and this tool reports whichever the body is
 * holding. `FPHANDS=one` holds the key, which is the only way to ask.
 *
 * Measured here at the default two-handed guard: 65% of the hilt behind a
 * glove, against 29% with the key held. Both are checked at three pitches in
 * tools/checks/first-person.mjs, "how many hands are on the hilt is what you
 * SEE", each against a ceiling derived from its own fists.
 *
 * The near plane is no longer part of the argument and the note above is left
 * as it was because it was true when written: two low fists used to push
 * elbowL inside the 100 mm the deltoid needs. Measured on the finished anchor
 * (rise 0.32), the nearest arm joint is `shoulderL` at 115 mm in every
 * condition — idle, walking, looking up, looking down, one hand and two — so
 * the pair that "nothing satisfied" is satisfied by both grips now, and what
 * separates them is occlusion alone.
 */
// The DOM shim FIRST, and before anything that reaches Textures.js: the
// procedural texture foundry bakes onto a canvas, and there is no document
// here. tools/verify.mjs opens with the same line for the same reason.
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import * as THREE from 'three';

const { world } = await bootWorld({
  level: 'drifts',
  settings: { mode: 'sandbox', difficulty: 'knight', firstPerson: true },
});
const p = world.player;
p.camera.firstPerson = true;
p._applyViewMode?.();
p.saber.lit = true;
/* HOW MANY HANDS, ASKED FOR THE WAY A PLAYER ASKS — the one-hand key, which is
 * the whole of `control.grip` and therefore of `handsOnHilt`. */
const input = idleInput();
if (process.env.FPHANDS === 'one') input.act = (id) => id === 'grip2';
for (let i = 0; i < 120; i++) world.update(1 / 60, input);
console.log(`\n  ${p.handsOnHilt()} hand(s) on the hilt`);

const cam = world.engine.camera;
cam.fov = Number(process.env.FPFOV || 60);
cam.aspect = 16 / 9;
cam.updateProjectionMatrix();
cam.updateMatrixWorld(true);

const eye = cam.getWorldPosition(new THREE.Vector3());
const v = new THREE.Vector3();
const rows = [];
const at = (label, w) => {
  v.copy(w).project(cam);
  const d = w.distanceTo(eye);
  rows.push([label, v.x, v.y, d]);
};

for (const b of ['clavR', 'armR', 'foreR', 'handR', 'clavL', 'armL', 'foreL', 'handL']) {
  const bone = p.rig.get(b);
  if (!bone) continue;
  at(b, bone.obj.getWorldPosition(new THREE.Vector3()));
}
at('hilt', p.saber.root.getWorldPosition(new THREE.Vector3()));
if (p.saber.bladeGroup) at('emitter', p.saber.bladeGroup.getWorldPosition(new THREE.Vector3()));

console.log('\n  joint      ndc.x    ndc.y   on screen   metres from eye');
for (const [n, x, y, d] of rows) {
  const on = Math.abs(x) <= 1 && Math.abs(y) <= 1;
  console.log(`  ${n.padEnd(9)} ${x.toFixed(3).padStart(7)} ${y.toFixed(3).padStart(7)}   `
    + `${(on ? 'yes' : 'NO').padEnd(9)} ${d.toFixed(3)}`);
}

/* THE HILT, WHICH IS THE THING THE PLAYER SAYS IS GARBAGE.
 *
 * Two numbers. How much of it is on screen at all (its projected length as a
 * share of frame height), and how much of THAT the fist is standing in front
 * of. A hilt that is 4% of the frame and 70% occluded is not a hilt, it is a
 * pale smudge where the blade begins — which is a fair description of the
 * screenshot. */
{
  const S = p.saber;
  // Where the metal actually is, so a grip shift cannot put a fist on air.
  {
    const box = new THREE.Box3();
    S.root.updateMatrixWorld(true);
    S.root.traverse((o) => {
      if (o.isMesh && o !== S.bladeGroup && !S.bladeGroup?.getObjectById(o.id)) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrix);
        box.union(b);
      }
    });
    console.log(`\n  hilt metal spans y ${box.min.y.toFixed(3)} … ${box.max.y.toFixed(3)} `
      + `(emitterY ${S.emitterY.toFixed(3)})`);
  }
  const hiltPts = [];
  S.root.updateMatrixWorld(true);
  for (let t = -0.5; t <= 1.001; t += 0.05) {
    hiltPts.push(S.root.localToWorld(new THREE.Vector3(0, t * S.emitterY, 0)));
  }
  let lo = 1e9, hi = -1e9, seen = 0, blocked = 0;
  const hands = [];
  for (const b of ['handR', 'handL', 'foreR', 'foreL']) {
    const bone = p.rig.get(b);
    if (bone) bone.obj.traverse((o) => { if (o.isMesh && o.visible) hands.push(o); });
  }
  const r2 = new THREE.Raycaster(); r2.near = 0.02; r2.far = 3;
  for (const w of hiltPts) {
    const n = w.clone().project(cam);
    if (Math.abs(n.x) > 1 || Math.abs(n.y) > 1) continue;
    lo = Math.min(lo, n.y); hi = Math.max(hi, n.y); seen++;
    r2.setFromCamera({ x: n.x, y: n.y }, cam);
    const d = w.distanceTo(eye);
    if (r2.intersectObjects(hands, true).some((h) => h.distance < d - 0.004)) blocked++;
  }
  const span = seen ? (hi - lo) / 2 : 0;
  console.log(`\n  hilt: ${(span * 100).toFixed(1)}% of frame height, `
    + `${seen}/${hiltPts.length} samples on screen, `
    + `${seen ? (100 * blocked / seen).toFixed(0) : '—'}% of those behind the hands`);
}

/* How much of the frame the arms actually cover, measured rather than argued:
 * sample a grid over the lower half of the view and ask what a ray through it
 * hits first among the arm meshes. */
const armMeshes = [];
for (const b of ['armR', 'foreR', 'handR', 'armL', 'foreL', 'handL']) {
  const bone = p.rig.get(b);
  if (bone) bone.obj.traverse((o) => { if (o.isMesh && o.visible) armMeshes.push(o); });
}
const ray = new THREE.Raycaster();
ray.near = 0.045; ray.far = 3;
let hit = 0, tot = 0;
for (let iy = 0; iy < 60; iy++) {
  for (let ix = 0; ix < 100; ix++) {
    const nx = (ix / 99) * 2 - 1, ny = (iy / 59) * 2 - 1;
    ray.setFromCamera({ x: nx, y: ny }, cam);
    tot++;
    if (ray.intersectObjects(armMeshes, true).length) hit++;
  }
}
console.log(`\n  arms cover ${(100 * hit / tot).toFixed(1)}% of the frame `
  + `(${armMeshes.length} meshes)\n`);
world.unload();
