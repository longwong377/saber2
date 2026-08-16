/**
 * BATTLEFRONT BORZ — the character creator's GRIP, as numbers.
 *
 * `tools/checks/stature.mjs` measures the in-game rig's grip in the wielder's
 * own hands and its own arm-lengths, and the in-game rig passes. The CREATOR
 * runs a second copy of the grip model (`poseSaberArm` in src/ui/Menu.js), and
 * nothing measured that one — so the defect note #2 named is still on the
 * screen where a player picks their character.
 *
 * Every quantity is a RATIO of two lengths belonging to the same figure, for
 * the reason stature.mjs states: a small character is supposed to have small
 * numbers, so a defect is a divergence between two frames and never a
 * magnitude.
 *
 *   bore     grip point → wrist joint, in the figure's own hands. 0 is held.
 *   hilt     the hilt's longest axis, in the figure's own hands.
 *   demand   hand target → shoulder, in the figure's own arm reach. >1 cannot
 *            be solved at all.
 *   centre   where the figure's own box lands vertically in the framed shot.
 *   fill     how much of the frame height the figure covers.
 *   share    the figure's height as a fraction of the whole content box.
 *
 * Run: node --import ./tools/register.mjs tools/_previewgrip.mjs
 */

import './dom-shim.mjs';
import * as THREE from 'three';
import { buildJedi, SPECIES } from '../src/game/Bodies.js';
import { limbScale } from '../src/game/Rig.js';
import { Saber } from '../src/game/Saber.js';
import { GRIP_AT } from '../src/game/Player.js';
import {
  assemblePreview, framePreviewCamera, skinRackFor, HAIR_COLORS,
  PREVIEW_VIEW, DEFAULT_SETTINGS,
} from '../src/ui/Menu.js';

const W = 290, H = 357;

function bench(over = {}) {
  const s = { ...DEFAULT_SETTINGS, coreWidth: 0.7, ...over };
  const pivot = new THREE.Group();
  const rack = skinRackFor(s.species);
  const built = buildJedi({
    robeIndex: s.robeIndex ?? 1,
    skinColor: (rack[s.skinIndex] || rack[0]).hex,
    hairColor: (HAIR_COLORS[s.hairIndex] || HAIR_COLORS[1]).hex,
    build: s.build, species: s.species, face: s.face, scale: 1,
  });
  const saber = new Saber(pivot, {
    colorIndex: s.colorIndex, bladeLength: s.bladeLength, coreWidth: s.coreWidth,
    hiltStyle: s.hiltStyle, order: s.order,
  });
  saber.trail.visible = false;
  const a = assemblePreview(pivot, built, saber, s);
  pivot.position.y = -(a.content.y0 + a.content.y1) / 2;
  pivot.updateMatrixWorld(true);
  return { s, pivot, built, rig: built.rig, saber, ...a };
}

function figureBox(b) {
  const box = new THREE.Box3().setFromObject(b.rig.root);
  for (const c of [b.cloak, b.skirt]) {
    if (!c) continue;
    const p = c.pos, v = new THREE.Vector3();
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(b.pivot.matrixWorld));
  }
  return box;
}
const corners = (box) => {
  const out = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
};
function project(pts, cam, pitch, yaws = 24) {
  let top = -9, bot = 9, worst = 0;
  const v = new THREE.Vector3(), m = new THREE.Matrix4(), e = new THREE.Euler();
  for (let i = 0; i < yaws; i++) {
    m.makeRotationFromEuler(e.set(pitch, (i / yaws) * Math.PI * 2, 0));
    for (const p of pts) {
      v.copy(p).applyMatrix4(m).project(cam);
      worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y));
      top = Math.max(top, v.y); bot = Math.min(bot, v.y);
    }
  }
  return { worst, height: (top - bot) / 2, centre: (top + bot) / 2 };
}

const rows = [];
for (const sp of SPECIES) {
  const b = bench({ species: sp.id });
  const rig = b.rig;
  const L = limbScale(rig);
  const hand = rig.get('handR');
  const handLen = hand.length;

  // bore: the point on the hilt the fist takes, against where the wrist is
  const gs = b.saber.gripScale ?? 1;
  const gripPt = b.saber.root.localToWorld(new THREE.Vector3(0, GRIP_AT.R * gs, 0));
  const wrist = new THREE.Vector3();
  hand.obj.getWorldPosition(wrist);
  // stature.mjs's own measure: distance from the grip point to the BORE of the
  // fist, which sits GRIP_BORE·handScale from the wrist joint. Here we report
  // the raw wrist gap in hands, which is what the preview controls.
  const bore = gripPt.distanceTo(wrist) / handLen;

  const hb = new THREE.Box3().setFromObject(b.saber.hilt);
  const hilt = Math.max(hb.max.x - hb.min.x, hb.max.y - hb.min.y, hb.max.z - hb.min.z) / handLen;

  // demand: how far the wrist target is from the shoulder, in arm reaches
  const sh = new THREE.Vector3();
  rig.get('armR').obj.getWorldPosition(sh);
  const reach = rig.get('armR').length + rig.get('foreR').length;
  const demand = sh.distanceTo(wrist) / reach;

  const fb = figureBox(b);
  const share = (fb.max.y - fb.min.y) / Math.max(1e-6, b.content.y1 - b.content.y0);
  const cam = new THREE.PerspectiveCamera(PREVIEW_VIEW.fov, W / H, 0.05, 40);
  framePreviewCamera(cam, b.content, { pitch: 0.1, aspect: W / H });
  const r = project(corners(fb), cam, 0.1);

  rows.push({ id: sp.id, scale: L.torso, arm: L.arm, bore, hilt, demand,
    share, centre: r.centre, fill: r.height, worst: r.worst,
    content: [b.content.y0, b.content.y1] });
}

const f = (n, d = 3) => (n >= 0 ? ' ' : '') + n.toFixed(d);
console.log('species      torso  arm   | bore  hilt  demand | share  fill   centre  worst | content');
for (const r of rows) {
  console.log(`${r.id.padEnd(12)} ${r.scale.toFixed(2)}  ${r.arm.toFixed(2)}  |${f(r.bore, 2)}  ${f(r.hilt, 2)}  ${f(r.demand, 2)}   |${f(r.share, 2)}  ${f(r.fill, 3)} ${f(r.centre, 3)}  ${f(r.worst, 3)} | ${r.content[0].toFixed(2)}→${r.content[1].toFixed(2)}`);
}
