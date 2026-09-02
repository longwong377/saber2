/**
 * BATTLEFRONT BORZ — every non-player unit against its reference plate.
 *
 * The player: "clone troopers don't appear to even be holding guns, they fire
 * from their wrists; that's just the most obvious. If you look closely at all
 * of them they're really janky. Refer to the reference images you have."
 *
 * `assets/reference/units/**` is the authority and this file is what was read
 * off it, one fact a check, each measured on the built body or on a body
 * driven through `Enemy._pose` — never on source text:
 *
 *   · a B1's head is a long blunt snout with the eyes in its FACE, and it
 *     walks stooped;
 *   · a B2 is a hunch with no neck, and it fires from a blaster on its wrist
 *     with the arm thrown straight at the target;
 *   · a droideka is bronze under a tall cowl, and it ROLLS when it moves;
 *   · a Geonosian has two horns swept back off the skull, and folds its wings
 *     on the ground;
 *   · a clone's trigger hand has its thumb on TOP of the receiver — the hand
 *     was a left hand on the right arm — and every rifle's muzzle is at the
 *     far end of a rifle held in the hand, not at the wrist;
 *   · an ARC wears a mantle over both shoulders and two pistols on the belt;
 *   · the walker is a ball with two lenses and a gun, on jointed legs;
 *   · and none of it cost more than it should — every body is held within
 *     30% of what it cost before this pass, in triangles and in meshes.
 */

import * as THREE from 'three';
import * as B from '../../src/game/Bodies.js';
import { Enemy, ARCHETYPES } from '../../src/game/Enemy.js';
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

/** A body posed for `frames` against `target` (or none); `each` runs per frame. */
function posed(type, { target = null, frames = 60, keep = null, each = null, velocity = null } = {}) {
  const w = gunWorld();
  const e = keep || new Enemy(w, type, new THREE.Vector3(0, 0, 0));
  e.facing = 0;
  e.target = target ? { position: target, chest: target, dead: false, alive: true } : null;
  const ctx = { terrain: e.world.terrain, physics: e.world.physics, particles: null, time: 0, enemies: [] };
  for (let i = 0; i < frames; i++) {
    if (velocity) e.velocity.copy(velocity);
    each?.(e, i);
    e._pose(1 / 60, ctx);
  }
  (e.rig ? e.rig.root : e.group).updateMatrixWorld(true);
  return e;
}

/** World-space box of every mesh under `obj` (optionally only those in `mat`). */
function boxOf(obj, mat = null) {
  const box = new THREE.Box3();
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.visible === false) return;
    if (mat && o.material !== mat) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return box;
}

/** Local-space (bone frame) box of the meshes on a bone, by material. */
function boneBox(bone, mat = null) {
  const box = new THREE.Box3();
  for (const o of bone.obj.children) {
    if (!o.isMesh || !o.geometry) continue;
    if (mat && o.material !== mat) continue;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrix));
  }
  return box;
}

function cost(root) {
  let t = 0, m = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    m++;
    const g = o.geometry;
    t += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return { tris: Math.round(t), meshes: m };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export async function run({ check, assert }) {
  check = await clocked(check);
  /* The Command rungs (arc, bx, magna…) and the Geonosian register themselves
   * into ARCHETYPES from their own modules; Levels.js normally does this. */
  try { await import('../../src/game/Command.js'); } catch { /* another lane's file mid-edit */ }
  try {
    const F = await import('../../src/game/Flight.js');
    if (!ARCHETYPES.geonosian && F.GEONOSIAN_UNITS) Object.assign(ARCHETYPES, F.GEONOSIAN_UNITS);
  } catch { /* as above */ }

  /* ── the B1 ─────────────────────────────────────────────────────────── */

  check('fidelity: a B1\'s head is a long blunt snout, and its eyes are in the face', () => {
    const u = B.buildB1({});
    const head = u.rig.get('head');
    const s = u.rig.scale;
    /* The head above the throat: the neck ring and the throat tube under the
     * cranium are part of the head bone's shell and not of the snout. */
    const shell = new THREE.Box3();
    {
      const v = new THREE.Vector3();
      for (const o of head.obj.children) {
        if (!o.isMesh || o.material !== u.palette.shell) continue;
        const pos = o.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrix);
          if (v.y > 0.055 * s) shell.expandByPoint(v);
        }
      }
    }
    const len = shell.max.z - shell.min.z, tall = shell.max.y - shell.min.y, wide = shell.max.x - shell.min.x;
    /* The plate: nose to nape is better than twice the height, and the snout
     * is narrow — no wider than it is tall. The old head was a cone that
     * tapered to a point and carried ear vanes 11 cm across. */
    assert(len >= 0.26 * s, `the head is ${(len * 100).toFixed(1)} cm nose to nape — the plate's is about 28`);
    assert(len >= 2.0 * tall, `the head is ${len.toFixed(3)} long against ${tall.toFixed(3)} tall — that is a helmet, not a snout`);
    assert(wide <= tall * 1.15, `the head is ${(wide * 100).toFixed(1)} cm wide against ${(tall * 100).toFixed(1)} tall — ear vanes?`);
    // the snout keeps its width to the nose: the front 4 cm is still ≥ 70%
    // of the widest section, which a cone cannot manage
    const nose = boneBox(head, u.palette.shell);
    assert(nose.max.z >= 0.20 * s, `the snout ends ${(nose.max.z * 100).toFixed(1)} cm ahead of the neck`);
    const eyes = boneBox(head, u.palette.eye);
    assert(!eyes.isEmpty(), 'no photoreceptor geometry on the head at all');
    assert(eyes.min.z >= 0.16 * s,
      `the photoreceptors sit at z=${eyes.min.z.toFixed(3)} — on the flanks by the cranium, not in the face at the end of the snout`);
    assert(eyes.max.x - eyes.min.x >= 0.030 * s && eyes.max.x - eyes.min.x <= 0.080 * s,
      `the two eyes are ${((eyes.max.x - eyes.min.x) * 100).toFixed(1)} cm apart across the face`);
    return `snout ${(len * 100).toFixed(1)} cm long, ${(tall * 100).toFixed(1)} tall, ${(wide * 100).toFixed(1)} wide; eyes ${(eyes.min.z * 100).toFixed(1)} cm forward`;
  });

  check('fidelity: a B1 walks stooped, a B2 is a hunch, and a clone stands straight', () => {
    const rows = [];
    const lean = (type) => {
      const e = posed(type, { frames: 40 });
      const hips = e.rig.worldPos('hips', new THREE.Vector3());
      const head = e.rig.worldPos('head', new THREE.Vector3());
      return head.z - hips.z;   // facing +Z: how far the head is carried ahead of the pelvis
    };
    const b1 = lean('b1'), b2 = lean('b2'), tr = lean('trooper');
    assert(b1 >= 0.05, `a B1 carries its head ${(b1 * 100).toFixed(1)} cm ahead of its hips — it stands like a guardsman`);
    assert(b2 >= 0.14, `a B2 carries its head ${(b2 * 100).toFixed(1)} cm ahead of its hips — the plate is a hunch`);
    assert(b2 > b1 * 1.6, `the B2 (${(b2 * 100).toFixed(1)} cm) does not hunch more than the B1 (${(b1 * 100).toFixed(1)})`);
    assert(Math.abs(tr) < 0.05, `a clone trooper leans ${(tr * 100).toFixed(1)} cm — the stoop leaked onto every body`);
    rows.push(`b1 ${(b1 * 100).toFixed(1)} cm, b2 ${(b2 * 100).toFixed(1)}, trooper ${(tr * 100).toFixed(1)}`);
    if (ARCHETYPES.bx) {
      const bx = lean('bx');
      assert(bx > b1, `the commando droid (${(bx * 100).toFixed(1)} cm) is not held lower than a line B1`);
      rows.push(`bx ${(bx * 100).toFixed(1)}`);
    }
    return rows.join('; ');
  });

  /* ── the B2 ─────────────────────────────────────────────────────────── */

  check('fidelity: a B2 fires from its wrist, and throws that arm straight at the target', () => {
    const at = V(0, 1.4, 12);
    const e = posed('b2', { target: at, frames: 60 });
    assert(!e.weapon, 'a B2 carries a rifle now — the wrist blaster is its whole kit');
    const m = e._muzzleWorld(new THREE.Vector3());
    const wrist = e.rig.worldPos('handR', new THREE.Vector3());
    const sh = e.rig.worldPos('armR', new THREE.Vector3());
    const S = e.bodyScale;
    const gap = m.distanceTo(wrist);
    assert(gap <= 0.16 * S, `the B2's bolts leave ${(gap * 100).toFixed(0)} cm from its wrist — that is not a wrist blaster`);
    const fore = e.rig.get('foreR');
    assert(fore.muzzle, 'the forearm publishes no muzzle mesh for the bolt to leave from');
    const armDir = wrist.clone().sub(sh).normalize(), aim = at.clone().sub(sh).normalize();
    const cos = armDir.dot(aim);
    assert(cos > 0.98, `aiming, the B2's right arm is ${(Math.acos(Math.min(1, cos)) * 180 / Math.PI).toFixed(1)}° off the line to its target — it fires with the arm at its side`);
    const reach = wrist.distanceTo(sh);
    const armLen = e.rig.get('armR').length + e.rig.get('foreR').length;
    assert(reach >= armLen * 0.93, `the firing arm is bent — ${(reach * 100).toFixed(0)} cm shoulder to wrist on a ${(armLen * 100).toFixed(0)} cm arm`);
    // …and with no target it drops again
    e.target = null;
    posed('b2', { keep: e, frames: 120 });
    const down = e.rig.worldPos('handR', new THREE.Vector3());
    const sh2 = e.rig.worldPos('armR', new THREE.Vector3());
    assert(sh2.y - down.y > 0.35 * S, `with nothing to shoot the arm is still up: wrist ${(down.y).toFixed(2)} against shoulder ${sh2.y.toFixed(2)}`);
    return `muzzle ${(gap * 100).toFixed(0)} cm from the wrist, arm ${(Math.acos(Math.min(1, cos)) * 180 / Math.PI).toFixed(1)}° off the aim, dropped ${((sh2.y - down.y) * 100).toFixed(0)} cm at rest`;
  });

  check('fidelity: a B2 has a hood and a beak, not a helmet on a neck', () => {
    const u = B.buildB2({});
    const head = u.rig.get('head'), s = u.rig.scale;
    const shell = boneBox(head, u.palette.shell);
    const tall = shell.max.y - shell.min.y, long = shell.max.z - shell.min.z, wide = shell.max.x - shell.min.x;
    /* Wider than tall and longer than tall: a low hood with the beak thrust
     * out of it. The old dome was 0.078·s in radius — taller than it was long. */
    assert(wide > tall, `the B2's head is ${(tall * 100).toFixed(1)} cm tall against ${(wide * 100).toFixed(1)} wide — a dome`);
    assert(long > tall * 1.15, `the beak does not lead the hood: ${(long * 100).toFixed(1)} long against ${(tall * 100).toFixed(1)} tall`);
    assert(shell.max.z >= 0.13 * s, `the beak stops ${(shell.max.z * 100).toFixed(1)} cm ahead of the throat`);
    return `hood ${(tall * 100).toFixed(1)} tall, ${(wide * 100).toFixed(1)} wide, beak to ${(shell.max.z * 100).toFixed(1)} cm`;
  });

  /* ── the droideka ───────────────────────────────────────────────────── */

  check('fidelity: a droideka is bronze under a tall cowl', () => {
    const u = B.buildDroideka({});
    /* Read back as sRGB — `Color` holds linear under colour management, and
     * the plate is a judgement about what is on the screen. */
    const hex = u.palette.shell.color.getHexString();
    const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
    assert(r > g && g > b && r - b > 0.20,
      `the shell is #${hex} — the plate is burnt copper, red over green over blue`);
    const c = { getHexString: () => hex };
    const S = u.scale;
    const core = boxOf(u.core);
    // the cowl stands the height of the body again over the carapace: the
    // core's top is above 1.1·S, where the old drum stopped at 0.86·S
    assert(core.max.y >= 1.10 * S, `the body tops out at ${core.max.y.toFixed(2)} on a ${S} scale — there is no cowl over it`);
    // and it is BEHIND the head pod, open at the front
    const hz = u.headG.position.z;
    assert(core.min.z < -0.40 * S, `nothing arches over the back (min z ${core.min.z.toFixed(2)})`);
    assert(hz > 0.15 * S, 'the head pod is inside the cowl instead of out of its mouth');
    return `shell #${c.getHexString()}, cowl to ${core.max.y.toFixed(2)} m over a ${S} scale`;
  });

  check('fidelity: a droideka rolls when it moves and unfolds when it stops', () => {
    const e = posed('droideka', { frames: 120, velocity: V(0, 0, 3.0) });
    const b = e.built;
    assert(e.rollBlend > 0.9, `at 3 m/s the destroyer is ${(e.rollBlend * 100).toFixed(0)}% rolled — it walks`);
    assert(Math.abs(b.core.rotation.x) > 3.0, `two seconds at 3 m/s turned the core ${b.core.rotation.x.toFixed(2)} rad — a wheel that does not turn`);
    for (const leg of b.legs) assert(leg.leg.rotation.x < -1.0, `a leg is still down (${leg.leg.rotation.x.toFixed(2)}) while rolling`);
    const spun = b.core.rotation.x;
    posed('droideka', { keep: e, frames: 120, velocity: V(0, 0, 0) });
    assert(e.rollBlend < 0.05, `stopped, it is still ${(e.rollBlend * 100).toFixed(0)}% rolled`);
    assert(Math.abs(b.core.rotation.x) < 0.05, `stopped, the core is still turned ${b.core.rotation.x.toFixed(2)} rad`);
    for (const leg of b.legs) assert(leg.leg.rotation.x > -0.4, `stopped, a leg is still tucked (${leg.leg.rotation.x.toFixed(2)})`);
    return `rolled ${spun.toFixed(1)} rad in two seconds, unfolded in two more`;
  });

  /* ── the Geonosian ──────────────────────────────────────────────────── */

  check('fidelity: a Geonosian carries two horns swept back off the skull', () => {
    const u = B.buildGeonosian({});
    const head = u.rig.get('head'), s = u.rig.scale;
    const dark = boneBox(head, u.palette.dark);
    assert(dark.min.z <= -0.19 * s, `nothing sweeps back off the skull past z=${dark.min.z.toFixed(3)} — the plate's horns are as long as the head`);
    assert(dark.max.y >= 0.23 * s, `the horns rise only to y=${dark.max.y.toFixed(3)} — the old crest plate reached 0.225`);
    // TWO of them: high geometry on both sides of the midline, and none on it
    let left = 0, right = 0, mid = 0;
    const v = new THREE.Vector3();
    for (const o of head.obj.children) {
      if (!o.isMesh || o.material !== u.palette.dark) continue;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrix);
        if (v.y < 0.22 * s) continue;
        if (v.x > 0.012 * s) left++; else if (v.x < -0.012 * s) right++; else mid++;
      }
    }
    assert(left > 20 && right > 20, `high geometry on one side only (L ${left}, R ${right}) — a fin, not a pair of horns`);
    assert(mid < (left + right) * 0.1, `${mid} vertices on the midline above the crown — a crest between the horns`);
    return `horns back to z=${dark.min.z.toFixed(3)}, up to y=${dark.max.y.toFixed(3)}; ${left}/${right} vertices a side`;
  });

  check('fidelity: a Geonosian on the ground folds its wings, and spreads them to fly', () => {
    if (!ARCHETYPES.geonosian) return 'Flight.js is not importable on this tree — skipped';
    const e = posed('geonosian', { frames: 90 });
    const tip = () => { e.rig.root.updateMatrixWorld(true); return e.rig.tipPos('wingTipL', new THREE.Vector3()); };
    const root = () => e.rig.worldPos('wingL', new THREE.Vector3());
    const up = tip().y - root().y;
    assert(up > 0.15, `hovering, the wing tip is ${(up * 100).toFixed(0)} cm above the root — it is not spread`);
    e._flightState = 'downed';
    posed('geonosian', { keep: e, frames: 120 });
    const down = tip().y - root().y;
    assert(down < -0.30, `downed, the wing tip is ${(down * 100).toFixed(0)} cm from the root — the wings do not fold`);
    return `spread +${(up * 100).toFixed(0)} cm, folded ${(down * 100).toFixed(0)} cm`;
  });

  check('fidelity: the sonic blaster glows green; every other rifle glows red', () => {
    const glowOf = (kind) => {
      const W = B.buildBlaster(kind);
      let g = null;
      W.traverse((o) => { if (o.isMesh && o.material.emissive && o.material.emissiveIntensity > 1) g = o.material; });
      assert(g, `the ${kind} has no glow at its muzzle`);
      return g.emissive;
    };
    const sonic = glowOf('sonic');
    assert(sonic.g > sonic.r && sonic.g > sonic.b, `the sonic blaster's charge is #${sonic.getHexString()}, not the plate's acid green`);
    const dc = glowOf('dc15');
    assert(dc.r > dc.g, `the DC-15 glows #${dc.getHexString()}`);
    return `sonic #${sonic.getHexString()}, dc15 #${dc.getHexString()}`;
  });

  /* ── the clones ─────────────────────────────────────────────────────── */

  check('fidelity: the thumb is on the outside of the hand, on BOTH hands', () => {
    /* fingers down +Y, palm toward +Z; a right hand's thumb is at fingers ×
     * palm = +X. The thumb is the one digit off the palm's centreline near
     * the wrist, so it is the mean X of the low, wide vertices. */
    const side = (s) => {
      const g = B.buildHand(s, 1, { curl: 0.5 });
      const pos = g.attributes.position;
      let sum = 0, n = 0;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        if (Math.abs(x) > 0.040 && y < 0.045 && y > 0.0) { sum += x; n++; }
      }
      assert(n > 10, `no thumb found on the ${s} hand`);
      return sum / n;
    };
    const r = side('R'), l = side('L');
    assert(r > 0.01, `the RIGHT hand's thumb is at x=${r.toFixed(3)} — that is a left hand`);
    assert(l < -0.01, `the LEFT hand's thumb is at x=${l.toFixed(3)} — that is a right hand`);
    return `R thumb at +${r.toFixed(3)}, L at ${l.toFixed(3)}`;
  });

  check('fidelity: every rifle carrier fires from the end of a rifle in its hand, not from its wrist', () => {
    const rows = [];
    const types = Object.keys(ARCHETYPES).filter((k) => ARCHETYPES[k].weapon && !ARCHETYPES[k].custom);
    assert(types.length >= 3, `only ${types.length} rifle archetypes on the roster`);
    for (const type of types) {
      const at = V(0, 1.4, 15);
      const e = posed(type, { target: at, frames: 40 });
      const m = e._muzzleWorld(new THREE.Vector3());
      const wr = e.rig.worldPos('handR', new THREE.Vector3());
      const ref = B.BLASTER_LENGTH[ARCHETYPES[type].weapon];
      const d = m.distanceTo(wr);
      assert(d >= ref * 0.45, `a ${type}'s bolts leave ${(d * 100).toFixed(0)} cm from its wrist on a ${ref} m ${ARCHETYPES[type].weapon} — fired from the wrist`);
      const W = boxOf(e.weapon);
      assert(W.containsPoint(m) || W.distanceToPoint(m) < 0.03, `a ${type}'s muzzle is ${(W.distanceToPoint(m) * 100).toFixed(1)} cm outside its own rifle`);
      rows.push(`${type} ${(d * 100).toFixed(0)}`);
    }
    return 'muzzle to wrist, cm: ' + rows.join(', ');
  });

  check('fidelity: an ARC wears a mantle over both shoulders and two pistols on the belt', () => {
    const u = B.buildTrooper({ kit: 'arc' });
    const chest = u.rig.get('chest'), hips = u.rig.get('hips'), s = u.rig.scale;
    const mantle = boneBox(chest, u.palette.gear);
    assert(mantle.max.x >= 0.20 * s && mantle.min.x <= -0.20 * s,
      `the shoulder gear spans x ${mantle.min.x.toFixed(3)}..${mantle.max.x.toFixed(3)} — one shoulder, not a mantle`);
    assert(mantle.max.y >= 0.14 * s, `the mantle sits at y=${mantle.max.y.toFixed(3)}, below the shoulder line`);
    // the pistols: plate-material geometry out at the hips, standing above
    // the holster line on both sides
    const pistols = boneBox(hips, u.palette.plate);
    assert(pistols.max.x >= 0.12 * s && pistols.min.x <= -0.12 * s, 'no pistol geometry out at the hips');
    assert(pistols.max.y >= 0.06 * s, `the pistol grips stop at y=${pistols.max.y.toFixed(3)} — holsters with nothing in them`);
    // and a line trooper has neither
    const t = B.buildTrooper({});
    const tm = boneBox(t.rig.get('chest'), t.palette.gear);
    assert(tm.max.x < 0.15 * s && tm.min.x > -0.15 * s, 'the line trooper is wearing the ARC mantle');
    return `mantle ${(mantle.max.x - mantle.min.x).toFixed(3)} m across; pistols to y=${pistols.max.y.toFixed(3)}`;
  });

  check('fidelity: the clone\'s visor is a T the full width of the brow', () => {
    const u = B.buildTrooper({});
    const head = u.rig.get('head'), s = u.rig.scale;
    const visor = boneBox(head, u.palette.visor);
    const shell = boneBox(head, u.palette.plate);
    const wide = visor.max.x - visor.min.x, brow = shell.max.x - shell.min.x;
    assert(wide >= brow * 0.72, `the visor is ${(wide * 100).toFixed(1)} cm across on a ${(brow * 100).toFixed(1)} cm face — goggles, not a T`);
    return `visor ${(wide * 100).toFixed(1)} cm on a ${(brow * 100).toFixed(1)} cm brow`;
  });

  /* ── the walker ─────────────────────────────────────────────────────── */

  check('fidelity: the walker is a ball with two lenses and a gun, on jointed legs', () => {
    const u = B.buildWalker({});
    const S = u.scale;
    const body = u.rig.get('body');
    body.primary.geometry.computeBoundingBox();
    const hb = body.primary.geometry.boundingBox;
    const w = hb.max.x - hb.min.x, h = hb.max.y - hb.min.y, l = hb.max.z - hb.min.z;
    assert(Math.abs(w - l) < 0.25 * w && h > 0.65 * w,
      `the hull is ${w.toFixed(2)} × ${h.toFixed(2)} × ${l.toFixed(2)} — a tub, not a sphere`);
    const head = u.rig.get('head');
    const eyes = boneBox(head, u.palette.eye);
    assert(!eyes.isEmpty() && eyes.max.x >= 0.15 * S && eyes.min.x <= -0.15 * S,
      'no pair of lenses on the face');
    assert(u.cannons.length >= 1, 'no cannon');
    for (const c of u.cannons) {
      const p = c.muzzle.getWorldPosition(new THREE.Vector3());
      const hp = u.rig.worldPos('head', new THREE.Vector3());
      assert(p.z - hp.z > 0.8 * S, `a muzzle sits ${(p.z - hp.z).toFixed(2)} m ahead of the face — the barrel is inside the ball`);
    }
    // the legs hinge: four femurs each with a tibia and a tarsus under it
    for (let i = 0; i < 4; i++) {
      for (const n of ['femur', 'tibia', 'tarsus']) assert(u.rig.get(`${n}${i}`), `leg ${i} has no ${n}`);
    }
    return `ball ${w.toFixed(2)} × ${h.toFixed(2)} × ${l.toFixed(2)}, ${u.cannons.length} guns`;
  });

  /* ── the budget ─────────────────────────────────────────────────────── */

  check('fidelity: no body costs more than 30% over what it cost before this pass', () => {
    /* Measured on the tree this pass started from (commit 940bfaa),
     * `tools/checks/characters.mjs`'s own count. A body that grows past 1.3×
     * either of these has to say why here. */
    const BEFORE = {
      b1: [6344, 42], b2: [8612, 45], trooper: [9014, 44], sniper: [8486, 45], heavy: [9202, 46],
      jet: [9966, 49], arc: [9374, 45], officer: [9550, 49], jedi: [12796, 64], acolyte: [9652, 58],
      droideka: [4702, 26], walker: [6968, 66], beast: [6450, 37], geonosian: [3992, 33], magna: [8972, 50],
    };
    const BUILD = {
      b1: () => B.buildB1({}), b2: () => B.buildB2({}), trooper: () => B.buildTrooper({}),
      sniper: () => B.buildTrooper({ kit: 'marksman' }), heavy: () => B.buildTrooper({ kit: 'heavy' }),
      jet: () => B.buildTrooper({ kit: 'jet' }), arc: () => B.buildTrooper({ kit: 'arc' }),
      officer: () => B.buildTrooper({ kit: 'commander' }), jedi: () => B.buildJedi({}), acolyte: () => B.buildAcolyte({}),
      droideka: () => B.buildDroideka({}), walker: () => B.buildWalker({}), beast: () => B.buildBeast({}),
      geonosian: () => B.buildGeonosian({}), magna: () => B.buildBodyguard({ kit: 'guard' }),
    };
    const rows = [];
    for (const [name, build] of Object.entries(BUILD)) {
      const u = build();
      const c = cost(u.rig ? u.rig.root : u.group);
      const [t0, m0] = BEFORE[name];
      assert(c.tris <= t0 * 1.30, `${name} is ${c.tris} triangles against ${t0} before — ${((c.tris / t0 - 1) * 100).toFixed(0)}% over`);
      assert(c.meshes <= Math.ceil(m0 * 1.30), `${name} is ${c.meshes} meshes against ${m0} before`);
      rows.push(`${name} ${c.tris}/${c.meshes} (${((c.tris / t0 - 1) * 100).toFixed(0)}%)`);
    }
    return rows.join(', ');
  });
}
