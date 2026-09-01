/**
 * BATTLEFRONT BORZ — a rifle is held with two hands, at the shoulder.
 *
 * The player: "clone troopers don't appear to even be holding guns like they
 * fire from their wrists."
 *
 * Measured on the shipped tree before this file existed, a Clone Trooper
 * aiming at a target twenty metres dead ahead: the DC-15 was 0.45 m long, its
 * butt ended 0.05 m behind the trigger hand and 0.31 m from the shoulder it
 * should have been braced into, and a trooper with no target held exactly the
 * same pose — bore level, dead ahead, at nothing. `characters.mjs` held the
 * BORE to the aim (0.4°) and both hands to the bore line, and every one of
 * those numbers was true of a rifle floating off the end of an arm.
 *
 * So this file measures the HOLD, through the real rig, the real IK and the
 * real weapon attachment, on every rifle-carrying humanoid the roster has:
 *
 *   1. aiming: the stock is at the right shoulder, the muzzle is well ahead of
 *      it and on the aim line, the support hand is on the fore-end, and the
 *      torso is bladed so it can be;
 *   2. every rifle is the reference's length — a DC-15A is a metre long, not
 *      forty-five centimetres — and its muzzle is the far end of its geometry,
 *      so bolts and the flash leave the barrel;
 *   3. with no target the rifle is at LOW READY: both hands on it, bore down
 *      and across the body, and it comes up when a target enters the band the
 *      brain opens fire in and goes back down when it leaves;
 *   4. the B2 fires from its wrist and the droideka from its arms, which is
 *      the source material and not a defect, and nothing here touched them.
 *
 * Every bound below is stated in the task that asked for it and re-measured
 * here; where one is tighter than asked, the comment says what was read.
 */

import * as THREE from 'three';
import { Enemy } from '../../src/game/Enemy.js';
import { BLASTER_LENGTH, buildBlaster } from '../../src/game/Bodies.js';
import { clocked } from './_shared.mjs';

/** The five things an Enemy touches while it is being posed, and nothing else. */
function gunWorld() {
  return {
    scene: new THREE.Scene(), settings: {}, difficulty: null,
    terrain: { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
      inBounds: () => true, half: 200, surfaceAt: () => 'sand' },
    physics: { add() {}, remove() {}, bodies: [], staticBoxes: [], raycast: () => null,
      addJoint() {}, removeJoint() {} },
    particles: null, bolts: null, time: 0, enemies: [], players: [],
    notify() {}, report() {}, addHitstop() {},
  };
}

/** The palm's closing point, from the wrist, on the reference hand — see PALM in Enemy.js. */
const PALM = new THREE.Vector3(0, 0.075, 0.035);

/** A posed body: `frames` of `_pose` against `target` (or none). */
function posed(type, { target = null, frames = 40, keep = null } = {}) {
  const w = gunWorld();
  const e = keep || new Enemy(w, type, new THREE.Vector3(0, 0, 0));
  e.facing = 0;
  e.target = target ? { position: target, chest: target, dead: false, alive: true } : null;
  const ctx = { terrain: e.world.terrain, physics: e.world.physics, particles: null, time: 0, enemies: [] };
  for (let i = 0; i < frames; i++) e._pose(1 / 60, ctx);
  e.rig.root.updateMatrixWorld(true);
  return e;
}

/** World-space points of the held rifle, and both hands' palms. */
function read(e) {
  const W = e.weapon, ud = W.userData;
  W.updateMatrixWorld(true);
  const at = (v) => v.clone().applyMatrix4(W.matrixWorld);
  const S = e.bodyScale ?? 1;
  const palm = (name) => {
    const b = e.rig.get(name);
    const q = b.obj.getWorldQuaternion(new THREE.Quaternion());
    return e.rig.worldPos(name, new THREE.Vector3()).add(PALM.clone().multiplyScalar(S).applyQuaternion(q));
  };
  /* THE BORE IS THE WEAPON'S OWN +Z, which is the axis every barrel is
   * lathed along. `muzzle - stock` is NOT it: the muzzle sits on the barrel
   * line and the stock's butt 5 cm under it, so that chord is 2.7° off the
   * bore on a DC-15A and would have been read as an aiming error. */
  const q = W.getWorldQuaternion(new THREE.Quaternion());
  return {
    muzzle: at(ud.muzzle), stock: at(ud.stock), grip: at(ud.grip), foregrip: at(ud.foregrip),
    bore: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    shR: e.rig.worldPos('armR', new THREE.Vector3()), shL: e.rig.worldPos('armL', new THREE.Vector3()),
    wristL: e.rig.worldPos('handL', new THREE.Vector3()), wristR: e.rig.worldPos('handR', new THREE.Vector3()),
    palmL: palm('handL'), palmR: palm('handR'),
  };
}

/** Distance from `p` to the segment a→b. */
function toSegment(p, a, b) {
  const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** The baked geometry's extent along the weapon's own bore axis. */
function extent(weapon, silhouetteOnly = false) {
  const box = new THREE.Box3();
  weapon.updateMatrixWorld(true);
  weapon.traverse((o) => {
    if (!o.isMesh || (silhouetteOnly && !o.userData.silhouette)) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrix));
  });
  return box;
}

export async function run({ check, assert }) {
  check = await clocked(check);
  /* Levels.js registers the Command units (heavy, jet, arc, officer, rocket)
   * and the Geonosian at module scope; without it the roster this walks is
   * the four rifles Enemy.js declares itself. */
  const { ARCHETYPES } = await import('../../src/game/Enemy.js');
  await import('../../src/game/Levels.js');
  const RIFLES = Object.keys(ARCHETYPES).filter((k) => ARCHETYPES[k].weapon && !ARCHETYPES[k].custom);

  check('rifle-hold: every rifle on the roster is the reference length, and its muzzle is the barrel\'s end', () => {
    const rows = [];
    const kinds = new Set(RIFLES.map((k) => ARCHETYPES[k].weapon));
    /* …AND THE CARBINE, which nothing on the roster carries yet but the
     * builder knows: the rung that should (the jet and the ARC) lives in
     * Command.js, which is another lane's file. */
    kinds.add('dc15s');
    for (const kind of kinds) {
      const spec = BLASTER_LENGTH[kind];
      assert(spec, `buildBlaster builds '${kind}' and BLASTER_LENGTH has no reference length for it`);
      const W = buildBlaster(kind);
      const ud = W.userData;
      for (const f of ['stock', 'grip', 'foregrip', 'muzzle']) {
        assert(ud[f]?.isVector3, `the ${kind} publishes no userData.${f} — the pose cannot know where to hold it`);
      }
      const all = extent(W), outline = extent(W, true);
      const len = all.max.z - all.min.z;
      /* 10% either side of the reference, as asked. The sonic blaster has no
       * rifle in the reference plates to be measured against; its length is
       * its own and is pinned so it cannot drift silently. */
      assert(Math.abs(len - spec) <= spec * 0.10,
        `the ${kind} bakes ${len.toFixed(3)} m nose to tail against a reference ${spec} m`);
      assert(Math.abs(ud.length - spec) < 1e-6, `the ${kind} claims a length of ${ud.length}, not ${spec}`);
      /* THE MUZZLE IS THE END OF THE BARREL — of the OUTLINE, not just of the
       * glow ring, because the glow is culled at thirty metres and a bolt
       * that leaves a point the far side of where the visible barrel stops
       * is a bolt leaving thin air at exactly the range a rifle is read at. */
      assert(Math.abs(all.max.z - ud.muzzle.z) <= 0.015,
        `the ${kind}'s muzzle is at z=${ud.muzzle.z} but its geometry ends at ${all.max.z.toFixed(3)}`);
      assert(outline.max.z >= ud.muzzle.z - 0.02,
        `the ${kind}'s silhouette barrel stops at ${outline.max.z.toFixed(3)}, ${((ud.muzzle.z - outline.max.z) * 100).toFixed(1)} cm short of its muzzle`);
      assert(Math.abs(all.min.z - ud.stock.z) <= 0.015,
        `the ${kind}'s stock point is at z=${ud.stock.z} but its geometry ends at ${all.min.z.toFixed(3)}`);
      /* Two baked silhouette meshes and the glow, which is the draw-call
       * budget the builder's own note commits to. */
      let sil = 0, meshes = 0;
      W.traverse((o) => { if (o.isMesh) { meshes++; if (o.userData.silhouette) sil++; } });
      assert(sil === 2 && meshes === 3, `the ${kind} bakes to ${meshes} meshes (${sil} silhouette), not two and a glow`);
      rows.push(`${kind} ${len.toFixed(2)} m`);
    }
    return rows.join(', ');
  });

  check('rifle-hold: aiming, every rifle archetype has its stock in the shoulder and both hands on the rifle', () => {
    const rows = [];
    for (const type of RIFLES) {
      const at = new THREE.Vector3(0, 1.4, 20);
      const e = posed(type, { target: at });
      assert(e.weapon, `${type} declares weapon '${ARCHETYPES[type].weapon}' and built none`);
      const r = read(e);
      const aimDir = at.clone().sub(r.shR).normalize();
      const ahead = r.muzzle.clone().sub(r.shR).dot(aimDir);
      const offLine = r.muzzle.clone().sub(r.shR).addScaledVector(aimDir, -ahead).length();
      const stockGap = r.stock.distanceTo(r.shR);
      const boreOff = Math.acos(Math.max(-1, Math.min(1, r.bore.dot(aimDir)))) * 180 / Math.PI;
      const foreGap = r.wristL.distanceTo(r.foregrip), palmGap = r.palmL.distanceTo(r.foregrip);
      const gripGap = r.palmR.distanceTo(r.grip);
      /* The four numbers the task states, measured as stated. */
      assert(ahead >= 0.55,
        `a ${type}'s muzzle is only ${ahead.toFixed(2)} m ahead of its right shoulder — that is a pistol, or a rifle held at the hip`);
      assert(offLine <= 0.25,
        `a ${type}'s muzzle sits ${offLine.toFixed(2)} m off the line from its shoulder to the target`);
      assert(stockGap <= 0.22,
        `a ${type}'s stock ends ${stockGap.toFixed(2)} m from its right shoulder — the rifle is not braced against anything`);
      assert(foreGap <= 0.12,
        `a ${type}'s left hand is ${(foreGap * 100).toFixed(0)} cm from the fore-end it is supposed to be holding`);
      /* Tighter than asked, because they are what the IK actually solves to
       * when the arm reaches: the palm CLOSES on the grip. 6 cm is the palm's
       * own half-width; past it the hand is beside the rifle, not round it. */
      assert(palmGap <= 0.06, `a ${type}'s support palm is ${(palmGap * 100).toFixed(0)} cm off the fore-end`);
      assert(gripGap <= 0.06, `a ${type}'s trigger palm is ${(gripGap * 100).toFixed(0)} cm off the pistol grip`);
      /* A degree, against the 12° characters.mjs allows: the bore is set by
       * the hand's FRAME now, not by a point the hand reaches for, so it lands
       * exactly — the residual is the 8 cm between the shoulder joint this
       * measures from and the pocket the rifle aims from, over twenty metres. */
      assert(boreOff < 1.0, `a ${type}'s bore is ${boreOff.toFixed(1)}° off the aim`);
      /* THE STANCE IS BLADED. The support arm cannot reach a metre-long
       * rifle's fore-end from a square torso; the reference plate turns the
       * left shoulder toward the target, and so does the pose. Read off the
       * two shoulder joints, not off a number in Enemy.js. */
      const blade = r.shL.clone().sub(r.shR).dot(aimDir);
      assert(blade >= 0.05,
        `a ${type} aims square-on: its left shoulder is ${(blade * 100).toFixed(0)} cm ahead of its right along the aim`);
      rows.push(`${type} ${ahead.toFixed(2)}m/${boreOff.toFixed(1)}°`);
    }
    assert(rows.length >= 8, `only ${rows.length} rifle archetypes measured — the roster has ${RIFLES.length}`);
    return rows.join(', ');
  });

  check('rifle-hold: with no target the rifle is at low ready, in both hands, and it comes up when one arrives', () => {
    const rows = [];
    for (const type of RIFLES) {
      const e = posed(type, { target: null, frames: 40 });
      const r = read(e);
      /* Both hands ON the weapon: the palm within 15 cm of the bore, which is
       * the rifle's furniture plus the depth of a closed hand. */
      for (const [name, p] of [['right', r.palmR], ['left', r.palmL]]) {
        const d = toSegment(p, r.stock, r.muzzle);
        assert(d <= 0.15, `at rest a ${type}'s ${name} hand is ${(d * 100).toFixed(0)} cm off its rifle — it is dangling`);
      }
      /* AND THE RIFLE IS DOWN AND ACROSS. A trooper with nothing to shoot at
       * used to aim dead ahead at the horizon; low ready has the bore below
       * level and across the chest toward the off side. `facing` is 0, so
       * the body's left is +x. */
      assert(r.bore.y < -0.30, `at rest a ${type}'s bore is ${(Math.asin(r.bore.y) * 180 / Math.PI).toFixed(0)}° from level — it is still aiming`);
      assert(r.bore.x > 0.15, `at rest a ${type}'s rifle is not carried across the body (bore x ${r.bore.x.toFixed(2)})`);
      assert(r.bore.z > 0.3, `at rest a ${type}'s rifle points backwards (bore z ${r.bore.z.toFixed(2)})`);
      /* The stock stays with the body — under the arm, not out in front. */
      assert(r.stock.distanceTo(r.shR) <= 0.30, `at rest a ${type}'s stock is ${r.stock.distanceTo(r.shR).toFixed(2)} m from its shoulder`);
      assert(e.aimBlend < 0.05, `a ${type} with no target has aimBlend ${e.aimBlend.toFixed(2)}`);

      /* UP when a target enters the band the brain opens fire in — the same
       * `engageRange` — and DOWN when it leaves. In and out are asymmetric
       * on purpose: a rifle comes up in a tenth of a second and is lowered. */
      const band = e.engageRange();
      const near = new THREE.Vector3(0, 1.4, Math.min(band * 0.7, band - 2));
      posed(type, { target: near, frames: 30, keep: e });
      assert(e.aimBlend > 0.95, `a ${type} with a target at ${near.z.toFixed(0)} m (band ${band.toFixed(0)}) is at aimBlend ${e.aimBlend.toFixed(2)} after half a second`);
      const far = new THREE.Vector3(0, 1.4, band + 25);
      posed(type, { target: far, frames: 90, keep: e });
      assert(e.aimBlend < 0.05, `a ${type} whose target left the band is still at aimBlend ${e.aimBlend.toFixed(2)} a second and a half later`);
      rows.push(type);
    }
    return `${rows.length} archetypes: ${rows.join(', ')}`;
  });

  check('rifle-hold: raised, the rifle\'s muzzle is what fires and what flashes', () => {
    /* `_muzzleWorld` is the one reader every bolt and every flash goes
     * through, so this is the seam: it has to answer with the end of the
     * barrel of the rifle the hands are holding, not a point on the wrist. */
    const at = new THREE.Vector3(0, 1.4, 20);
    const e = posed('trooper', { target: at });
    const r = read(e);
    const from = e._muzzleWorld(new THREE.Vector3());
    assert(from.distanceTo(r.muzzle) < 1e-3, `_muzzleWorld answers ${from.distanceTo(r.muzzle).toFixed(3)} m from the barrel's end`);
    assert(from.distanceTo(r.wristR) > 0.6, `the shot leaves ${from.distanceTo(r.wristR).toFixed(2)} m from the wrist — that is the complaint`);
    return `bolts leave ${from.distanceTo(r.wristR).toFixed(2)} m ahead of the trigger hand's wrist`;
  });

  check('rifle-hold: the B2 still fires from its wrist and the droideka from its arms — that is canon, not a defect', () => {
    /* `assets/reference/units/droids/B2 super battle droid firing fron
     * wrist.webp`: the B2's blaster IS its right forearm, and `_muzzleWorld`
     * answers with that forearm's tip when a body has no hand weapon. Nothing
     * about the hold may reach it. */
    assert(ARCHETYPES.b2.weapon == null, 'the B2 has been given a hand weapon — it fires from a wrist blaster in every reference plate');
    const b2 = new Enemy(gunWorld(), 'b2', new THREE.Vector3());
    assert(!b2.weapon, 'the B2 built a blaster');
    b2.rig.root.updateMatrixWorld(true);
    const from = b2._muzzleWorld(new THREE.Vector3());
    const wrist = b2.rig.tipPos('foreR', new THREE.Vector3());
    assert(from.distanceTo(wrist) < 1e-6, `the B2 fires from ${from.distanceTo(wrist).toFixed(3)} m off its own wrist`);
    assert(b2.aimBlend === undefined, 'the rifle pose ran on a B2');
    assert(ARCHETYPES.droideka.custom === 'droideka' && ARCHETYPES.droideka.weapon == null, 'the droideka changed');
    return 'B2 wrist blaster and droideka cannons untouched';
  });
}
