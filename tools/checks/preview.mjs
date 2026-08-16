/**
 * BATTLEFRONT BORZ — the character creator's preview box.
 *
 * THREE BUGS, ALL REPORTED BY A PLAYER, ALL INVISIBLE TO THIS SUITE.
 *
 * tools/checks/creator.mjs measures the figure to a fifth of a pixel at eight
 * metres. tools/checks/garments.mjs measures six robe cuts through seven
 * seconds of walking. Neither of them could see any of this, because all three
 * faults were in the twenty lines of src/ui/Menu.js that put those things in
 * front of the player, and that file does not import outside a browser.
 *
 *   1. THE FIGURE HUNG BELOW THE FLOOR. `buildJedi` returns a rig whose root is
 *      the PELVIS and the preview never ran the animator, so the body hung off
 *      the origin at y ∈ [-0.959, +0.779] while the camera aimed at
 *      (0, 0.95, 0) — 17 cm above the top of its head. The whole figure
 *      projected to NDC y ∈ [-2.367, -0.119]: head just under the centre line,
 *      everything from the ribs down off the bottom of the frame. 63% of the
 *      character was not on screen.
 *
 *   2. THE SABER WAS HELD BACKWARDS. The hilt was parented to `handR` with
 *      `rotation.set(-π/2, 0, 0)`, which puts the blade's +Y on the hand's -Z.
 *      The figure faces +Z, so the blade left the fist pointing behind the
 *      character and the pommel pointed forward: the tip landed 1.29 m BEHIND
 *      the pommel, 90.0° off the axis Player.js holds a saber on. It is
 *      `handPoseOnHilt` that decides that now, for the preview and for the
 *      game, and this file asks the same function what to expect.
 *
 *   3. THE ROBE CUT DID NOTHING. Measured in Chromium at 292×360, switching
 *      between all six cuts changed at most 1 pixel of 105 120 — and that one
 *      pixel was the blade's own flicker. The row was written with no handler
 *      at all, on the argument that a cut is a cloth sim and a preview is a
 *      still frame. But the preview had no cloth in it to be still: it showed
 *      the RIGID lathe that `attachSkirt` hides the moment a simulated garment
 *      exists. The in-game path was never broken — World.js:301 → Player.js →
 *      attachCloak/attachSkirt — so this was the preview alone, and the same
 *      shots taken again after the fix change 1 916-3 900 of those pixels.
 *
 * WHY THE LOGIC IS A SET OF FUNCTIONS NOW. Same reason src/ui/Screens.js is a
 * module: the question "is the whole character inside the frame?" has an answer
 * that is a number, and there was nowhere to ask it. Everything below drives
 * the menu's own exports with no DOM, no canvas and no GL.
 *
 * Every check here fails on the code it was written against — at the import,
 * because none of these functions existed, and on the numbers if they are ever
 * put back the way they were. The last one is a COST check: the preview now
 * settles cloth, and a control that only changes the weapon may not pay for a
 * body.
 */

import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { buildJedi, SPECIES, speciesOf } from '../../src/game/Bodies.js';
import { Saber } from '../../src/game/Saber.js';
import { ROBE_CUTS, attachSkirt } from '../../src/game/Cloth.js';
// The grip model itself, not a copy of it and not a regex over its source.
import { handPoseOnHilt, GRIP_AT } from '../../src/game/Player.js';
import { functionBody } from './_source.mjs';
import {
  assemblePreview, dressPreviewFigure, standPreviewFigure, framePreviewCamera, previewContent,
  skinRackFor, HAIR_COLORS, PREVIEW_VIEW, PREVIEW_SETTLE, PREVIEW_SEED,
  PREVIEW_ZOOM_MAX, PREVIEW_SHOTS,
  BLADE_CAP,
  DEFAULT_SETTINGS,
} from '../../src/ui/Menu.js';

/* ── the box, at the size it really is ───────────────────────────────── */

// #saber-preview measured in the running page at 1280×720: 290 wide, 357 tall.
// It is `flex: 1` in a narrow column, so the aspect is not fixed and every
// framing claim below is made at three of them.
const W = 290, H = 357;
const ASPECTS = [W / H, 1.15, 0.5];

/* ── one assembled preview, exactly as Menu._refreshPreview assembles it ── */

const _CACHE = new Map();
function bench(over = {}) {
  const key = JSON.stringify(over);
  if (_CACHE.has(key)) return _CACHE.get(key);
  const s = { ...DEFAULT_SETTINGS, coreWidth: 0.7, ...over };
  const pivot = new THREE.Group();
  const rack = skinRackFor(s.species);
  // the same buildJedi call the menu makes
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
  const out = { s, pivot, built, rig: built.rig, saber, ...a };
  _CACHE.set(key, out);
  return out;
}

/** The figure's own box, in the pivot's frame — the garments included. */
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

/**
 * Where a set of points lands in the frame, over a whole turn of the box.
 *
 * The preview spins, so a claim about one yaw is worth nothing: everything is
 * measured over 24 bearings, and `worst` is the furthest any of them reaches
 * from the centre of the frame. 1.0 is the edge.
 */
function project(pts, cam, pitch, yaws = 24) {
  let worstX = 0, worstY = 0, top = -9, bot = 9;
  const v = new THREE.Vector3(), m = new THREE.Matrix4(), e = new THREE.Euler();
  for (let i = 0; i < yaws; i++) {
    m.makeRotationFromEuler(e.set(pitch, (i / yaws) * Math.PI * 2, 0));
    for (const p of pts) {
      v.copy(p).applyMatrix4(m).project(cam);
      worstX = Math.max(worstX, Math.abs(v.x)); worstY = Math.max(worstY, Math.abs(v.y));
      top = Math.max(top, v.y); bot = Math.min(bot, v.y);
    }
  }
  return { worst: Math.max(worstX, worstY), worstX, worstY, top, bot,
    height: (top - bot) / 2, centre: (top + bot) / 2 };
}

/* ── a coverage mask, so "you can see it" is a number ────────────────── */

/**
 * Rasterise a subtree into a silhouette mask at the box's real resolution.
 *
 * No lighting and no depth: the question is which of the 103 530 pixels the
 * character covers, which is the same question the player answered with "the
 * robe cut does nothing".
 */
function mask(root, cam, yaw = 0) {
  const m = new Uint8Array(W * H);
  const R = new THREE.Matrix4().makeRotationY(yaw);
  const VP = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const v = new THREE.Vector4(), M = new THREE.Matrix4();
  const sx = [0, 0, 0], sy = [0, 0, 0];
  root.updateMatrixWorld(true);
  root.traverse((x) => {
    if (!x.isMesh || !x.geometry?.attributes?.position || x.visible === false) return;
    const P = x.geometry.attributes.position, I = x.geometry.index;
    const n = I ? I.count : P.count;
    M.multiplyMatrices(R, x.matrixWorld);
    for (let i = 0; i + 2 < n; i += 3) {
      let ok = true;
      for (let j = 0; j < 3; j++) {
        const k = I ? I.getX(i + j) : i + j;
        v.set(P.getX(k), P.getY(k), P.getZ(k), 1).applyMatrix4(M).applyMatrix4(VP);
        if (v.w <= 0.01) { ok = false; break; }
        sx[j] = (v.x / v.w * 0.5 + 0.5) * W; sy[j] = (0.5 - v.y / v.w * 0.5) * H;
      }
      if (!ok) continue;
      const x0 = Math.max(0, Math.floor(Math.min(...sx))), x1 = Math.min(W - 1, Math.ceil(Math.max(...sx)));
      const y0 = Math.max(0, Math.floor(Math.min(...sy))), y1 = Math.min(H - 1, Math.ceil(Math.max(...sy)));
      const det = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
      if (Math.abs(det) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) for (let px = x0; px <= x1; px++) {
        const cx = px + 0.5, cy = y + 0.5;
        const w0 = ((sx[1] - cx) * (sy[2] - cy) - (sx[2] - cx) * (sy[1] - cy)) / det;
        const w1 = ((sx[2] - cx) * (sy[0] - cy) - (sx[0] - cx) * (sy[2] - cy)) / det;
        if (w0 < -1e-6 || w1 < -1e-6 || 1 - w0 - w1 < -1e-6) continue;
        m[y * W + px] = 1;
      }
    }
  });
  return m;
}
const xor = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
const area = (a) => { let n = 0; for (let i = 0; i < a.length; i++) n += a[i]; return n; };

/** The four bearings every mask comparison is made at. */
const YAWS = [0, 1.6, 3.1, 4.7];

export async function run({ check, assert }) {

  /* ══════════════════════════════════════════════════════════════════ */
  /*  1. the framing                                                    */
  /* ══════════════════════════════════════════════════════════════════ */

  check('preview: the figure stands on the floor instead of hanging off its own pelvis', () => {
    // The whole of the first bug in one measurement. `buildJedi`'s root is the
    // hips, so an unposed figure hangs BELOW the origin — measured on the
    // shipped preview, y ∈ [-0.959, +0.779], feet nearly a metre underground.
    // standPreviewFigure runs the game's own BipedAnimator to rest, which is
    // what puts the soles on y = 0.
    const rows = [];
    for (const species of SPECIES.map(s => s.id)) for (const build of [0, 0.5, 1]) {
      const rig = buildJedi({ species, build, scale: 1 }).rig;
      standPreviewFigure(rig);
      const box = new THREE.Box3().setFromObject(rig.root);
      assert(Math.abs(box.min.y) < 0.02,
        `${species}/${build}: the feet are ${(box.min.y * 1000).toFixed(0)} mm off the floor`);
      /**
       * A SPECIES MAY BE A DIFFERENT SIZE, and 1.55–1.95 m was written when
       * every body on the shared skeleton was a human's. `frame.stature` is the
       * row's own declaration of how tall it stands — the number a small-folk
       * figure is FOR — so the window travels with it instead of being a
       * constant that only one stature can satisfy.
       *
       * This is not a loosening: the window is the same ±11% it always was, and
       * a species that declares no frame is measured against exactly 1.55–1.95
       * as before. What it stops is the other failure mode, which is worse: a
       * declared 0.66 m species passing a bound it was never measured against.
       */
      const stature = speciesOf(species).frame?.stature ?? 1.75;
      assert(box.max.y > stature * 0.886 && box.max.y < stature * 1.114,
        `${species}/${build}: the crown is at ${box.max.y.toFixed(3)} m against a declared stature of `
        + `${stature.toFixed(2)} m — that is not a standing figure`);
      if (build === 0.5) rows.push(`${species} ${box.max.y.toFixed(3)}`);
    }
    return `feet on y=0 for ${SPECIES.length * 3} figures; crowns ${rows.join(', ')}`;
  });

  check('preview: the whole character is inside the frame, at every angle the box turns through', () => {
    /*
     * THE CHECK THE CROP NEEDED, and note what it is NOT: it is not "the camera
     * is at (1.15, 1.35, 2.55)". Three typed constants are what the bug WAS.
     * This projects the figure's own bounding box — the settled garments
     * included, because a robe is part of the character's outline — through the
     * camera framePreviewCamera actually produces, at 24 bearings of the idle
     * spin, at every pitch the drag can reach, and at three aspect ratios,
     * because #saber-preview is `flex: 1` and has no fixed shape.
     *
     * On the shipped shot the figure projected to NDC y ∈ [-2.367, -0.119] at
     * the default view: `worst` was 2.367 against the 0.995 asserted here, and
     * 63% of the body was off the bottom of the frame.
     */
    const combos = [
      {}, { build: 0 }, { build: 1 },
      { species: SPECIES[SPECIES.length - 1].id }, { robeCut: 'ceremonial' }, { robeCut: 'tabard' },
      { bladeLength: 0.85 }, { bladeLength: BLADE_CAP }, { bladeLength: 4.0 },
    ];
    let worst = 0, worstAt = '', smallest = 1, smallAt = '', offCentre = 0, offAt = '';
    /**
     * THE SHARE, and why the fill bound is now relative to it.
     *
     * `framePreviewCamera` fits the CONTENT — the figure plus its blade — and
     * the figure is then whatever fraction of that it is. A 1.69 m Jedi with
     * the stock 1.15 m blade is 82% of its own content and lands at 67% of the
     * frame, which is where 0.55 came from. A 0.66 m one holding the SAME blade
     * is 45% of its content and cannot reach 55% of the frame without cropping
     * the weapon off, which would be a worse picture and a worse check.
     *
     * So the bound is scaled by the figure's share of its own content, measured
     * rather than typed, against the default figure's share measured the same
     * way. For every figure that existed when 0.55 was written the factor is
     * exactly 1 and the number is unchanged.
     */
    const shareOf = (b) => {
      const fb = figureBox(b);
      return (fb.max.y - fb.min.y) / Math.max(1e-6, b.content.y1 - b.content.y0);
    };
    const baseShare = shareOf(bench({}));
    for (const over of combos) {
      const b = bench(over);
      const pts = corners(figureBox(b));
      const name = JSON.stringify(over) || '{}';
      const fill = 0.55 * Math.min(1, shareOf(b) / baseShare);
      for (const aspect of ASPECTS) {
        const cam = new THREE.PerspectiveCamera(PREVIEW_VIEW.fov, aspect, 0.05, 40);
        for (const pitch of [-1.1, -0.5, 0, 0.1, 0.5, 1.1]) {
          framePreviewCamera(cam, b.content, { pitch, aspect });
          const r = project(pts, cam, pitch);
          if (r.worst > worst) { worst = r.worst; worstAt = `${name} @ pitch ${pitch}, aspect ${aspect.toFixed(2)}`; }
          assert(r.worst < 0.995,
            `${name} at pitch ${pitch}, aspect ${aspect.toFixed(2)}: the figure reaches NDC ${r.worst.toFixed(3)} — it is cropped`);
          // and at the view the player is actually given, it has to be BIG and
          // roughly centred, or "in frame" has been bought with an empty box
          if (pitch === 0.1 && aspect === ASPECTS[0]) {
            if (r.height < smallest) { smallest = r.height; smallAt = name; }
            if (Math.abs(r.centre) > offCentre) { offCentre = Math.abs(r.centre); offAt = name; }
            assert(r.height > fill,
              `${name}: the figure is only ${(r.height * 100).toFixed(0)}% of the frame height, `
              + `against ${(fill * 100).toFixed(0)}% for its share of its own content`);
            assert(Math.abs(r.centre) < 0.32,
              `${name}: the figure's middle sits at NDC ${r.centre.toFixed(3)}, not near the centre of the box`);
          }
        }
      }
    }
    return `${combos.length} figures × 3 aspects × 6 pitches × 24 yaws: worst NDC ${worst.toFixed(3)} (${worstAt}); `
      + `smallest ${(smallest * 100).toFixed(0)}% of frame height (${smallAt}); worst offset ${offCentre.toFixed(3)} (${offAt})`;
  });

  check('preview: the shot is solved from the figure, not from three typed constants', () => {
    // The framing has to RESPOND. A camera that happens to fit the default
    // figure and ignores everything else is the same bug with a different
    // number in it, so: a taller content box has to move the camera, and the
    // margin has to be honoured rather than approached.
    const cam = new THREE.PerspectiveCamera(PREVIEW_VIEW.fov, W / H, 0.05, 40);
    const near = framePreviewCamera(cam, { y0: 0, y1: 1.7, radius: 0.4 }, { pitch: 0, aspect: W / H });
    const far = framePreviewCamera(cam, { y0: 0, y1: 3.4, radius: 0.4 }, { pitch: 0, aspect: W / H });
    assert(far.distance > near.distance * 1.6,
      `doubling the height of the content moved the camera from ${near.distance.toFixed(2)} m to only ${far.distance.toFixed(2)} m`);
    const wide = framePreviewCamera(cam, { y0: 0, y1: 1.7, radius: 1.2 }, { pitch: 0, aspect: W / H });
    assert(wide.distance > near.distance * 1.3,
      `tripling the width of the content moved the camera from ${near.distance.toFixed(2)} m to only ${wide.distance.toFixed(2)} m`);
    for (const r of [near, far, wide]) {
      assert(Math.abs(r.fill - (1 - PREVIEW_VIEW.margin)) < 0.01,
        `the content fills ${r.fill.toFixed(3)} of the frame against a ${(1 - PREVIEW_VIEW.margin).toFixed(2)} target`);
    }
    // and the content itself has to be what is in the box: feet on the floor,
    // the blade's tip above the crown, both inside one cylinder
    const b = bench();
    const box = figureBox(b);
    assert(Math.abs(b.content.y0) < 0.02, `the shot starts ${(b.content.y0 * 1000).toFixed(0)} mm off the floor`);
    assert(b.content.y1 > box.max.y - b.pivot.position.y - 1e-6,
      'the blade is not counted in the shot at all');
    // 4 m of blade must NOT be, or the character is a detail beside a strip light
    const long = bench({ bladeLength: 4.0 });
    assert(Math.abs(long.content.y1 - b.content.y1) < 0.32,
      `an unlimited 4 m blade grew the shot from ${b.content.y1.toFixed(2)} m to ${long.content.y1.toFixed(2)} m`);
    return `content ${b.content.y0.toFixed(3)}→${b.content.y1.toFixed(3)} m, r=${b.content.radius.toFixed(3)}; `
      + `camera ${near.distance.toFixed(2)}/${far.distance.toFixed(2)}/${wide.distance.toFixed(2)} m for tall/wide content`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  2. the saber                                                      */
  /* ══════════════════════════════════════════════════════════════════ */

  check('preview: the blade comes out of the fist the way the game holds it', async () => {
    /*
     * THE BACKWARDS SABER. The old parenting — position (0, 0.04, 0.02),
     * rotation (-π/2, 0, 0) — put the blade's +Y on the hand's -Z, and the
     * figure faces +Z: the tip finished 1.29 m BEHIND the pommel.
     *
     * The relationship is not a matter of taste, because Player.js states it:
     * `handPoseOnHilt` is the game's one answer to "where does the fist go on
     * this hilt", down to the 71 mm from the bore of a closed hand back to the
     * wrist joint. The preview calls that function and so does this check, so
     * the expectation below is COMPUTED from the game rather than copied out of
     * it — an earlier draft matched Player.js's source with a regular
     * expression and went stale inside the hour.
     */
    const b = bench();
    const hand = b.rig.get('handR').obj;
    assert(b.saber.root.parent === hand, 'the saber is not in the right hand at all');
    // The expectation is COMPUTED by the game's own function, not matched
    // against Player.js's source — an earlier draft of this check did the
    // latter and went stale within the hour, which is the note now standing
    // over handPoseOnHilt.
    const hiltQ = new THREE.Quaternion(), wantQ = new THREE.Quaternion(), back = new THREE.Vector3();
    b.saber.root.getWorldQuaternion(hiltQ);
    handPoseOnHilt('R', hiltQ, null, wantQ, back);
    const gotQ = new THREE.Quaternion();
    hand.getWorldQuaternion(gotQ);
    const twist = gotQ.angleTo(wantQ) * 180 / Math.PI;
    assert(twist < 0.01,
      `the fist is ${twist.toFixed(1)}° off the orientation the game grips this hilt at`);

    // ...and then the geometry, which is what the player actually complained
    // about: the blade must leave the fist forwards and upwards, and the hilt
    // must be the end that is in the hand.
    const wq = new THREE.Quaternion();
    b.saber.root.getWorldQuaternion(wq);
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(wq);
    const tip = b.saber.root.localToWorld(new THREE.Vector3(0, b.s.bladeLength, 0));
    const pommel = b.saber.root.localToWorld(new THREE.Vector3(0, -0.16, 0));
    const wrist = new THREE.Vector3();
    hand.getWorldPosition(wrist);
    // The grip point has to land in the BORE of the fist — 71 mm from the wrist
    // joint, and not the same place. `back` is that offset, from the game.
    const gripPt = b.saber.root.localToWorld(new THREE.Vector3(0, GRIP_AT.R, 0));
    assert(gripPt.clone().add(back).distanceTo(wrist) < 0.001,
      `the wrist is ${(gripPt.clone().add(back).distanceTo(wrist) * 1000).toFixed(1)} mm from where the game's own grip puts it`);
    assert(back.length() > 0.05,
      `the game's bore offset is ${(back.length() * 1000).toFixed(1)} mm — this check is no longer testing anything`);
    assert(dir.z > 0.2, `the blade points ${dir.z.toFixed(3)} forward — it is coming out of the wrong side of the hand`);
    assert(dir.y > 0.6, `the blade points ${dir.y.toFixed(3)} up — it is not held, it is being dropped`);
    assert(tip.z - pommel.z > 0.2,
      `the tip is ${((tip.z - pommel.z) * 1000).toFixed(0)} mm forward of the pommel — the saber is back to front`);
    assert(tip.y - wrist.y > 0.8, `the tip is only ${(tip.y - wrist.y).toFixed(2)} m above the fist`);

    // and the fist has to be clear of the robe it is standing in front of
    let clear = 1e9;
    const v = new THREE.Vector3();
    for (const c of [b.cloak, b.skirt]) {
      if (!c) continue;
      for (let i = 0; i < c.pos.length; i += 3) clear = Math.min(clear, pommel.distanceTo(v.set(c.pos[i], c.pos[i + 1], c.pos[i + 2])));
    }
    assert(clear > 0.10, `the pommel is ${(clear * 1000).toFixed(0)} mm from the nearest cloth particle — the hand is inside the robe`);
    return `fist ${twist.toFixed(3)}° off the game's grip, wrist ${(back.length() * 1000).toFixed(0)} mm back from the hilt; `
      + `blade (${dir.toArray().map(n => n.toFixed(2)).join(', ')}), tip ${((tip.z - pommel.z) * 1000).toFixed(0)} mm forward of the pommel, `
      + `${(clear * 1000).toFixed(0)} mm of air at the fist`;
  });

  check('preview: a small character holds its saber the way a big one does', () => {
    /**
     * PLAYER NOTE #2, ON THE SCREEN WHERE YOU PICK THE CHARACTER.
     *
     * "The yoda species character, the saber floats above their hands, and both
     * arms are in the air. Also their clothes are oversized." All three were
     * fixed in the GAME rig, and tools/checks/stature.mjs holds them there —
     * and all three were still true in the creator, because `poseSaberArm`,
     * `dressPreviewFigure` and the shot's blade allowance are a second copy of
     * the model authored against a 1.78 m body. Nothing measured that copy: the
     * framing check above passed throughout, because a figure can be perfectly
     * framed and still be holding its sword a hand-span away from its palm.
     *
     * Every quantity is stature.mjs's, for stature.mjs's reason — a small
     * character is supposed to have small numbers, so a defect is a DIVERGENCE
     * between two frames and never a magnitude. Each is a ratio of two lengths
     * belonging to the same figure, and the HUMAN's own reading is the bar.
     *
     *                      before        after      human
     *      bore (hands)      4.86         0.72       0.72
     *      hilt (hands)      5.99         2.39       2.39
     *      demand (reach)    0.99         0.83       0.84
     *      hem below floor   280 mm       0 mm       0 mm
     *
     * `demand` at 0.99 is the one that explains "both arms in the air": above 1
     * the two-bone IK cannot arrive at all — it straightens the arm, points it
     * at the target and stops short.
     */
    const ref = {};
    const rows = [];
    for (const sp of SPECIES) {
      const b = bench({ species: sp.id });
      const rig = b.rig;
      const hand = rig.get('handR');
      const gs = b.saber.gripScale ?? 1;

      // where the fist closes on the hilt, against where the fist actually is
      const gripPt = b.saber.root.localToWorld(new THREE.Vector3(0, GRIP_AT.R * gs, 0));
      const wrist = new THREE.Vector3();
      hand.obj.getWorldPosition(wrist);
      const bore = gripPt.distanceTo(wrist) / hand.length;

      // the hilt, in the hand that holds it — Saber.setGripScale's own measure
      const hb = new THREE.Box3().setFromObject(b.saber.hilt);
      const hilt = Math.max(hb.max.x - hb.min.x, hb.max.y - hb.min.y, hb.max.z - hb.min.z) / hand.length;

      // how far the arm is asked to reach, in its own whole reach
      const shoulder = new THREE.Vector3();
      rig.get('armR').obj.getWorldPosition(shoulder);
      const demand = shoulder.distanceTo(wrist) / (rig.get('armR').length + rig.get('foreR').length);

      // and the clothes, which is the third claim in the same note
      let hem = 0;
      for (const c of [b.cloak, b.skirt]) {
        if (!c) continue;
        for (let i = 1; i < c.pos.length; i += 3) hem = Math.min(hem, c.pos[i]);
      }

      if (!sp.frame) { ref.bore = bore; ref.hilt = hilt; ref.demand = demand; }
      rows.push(`${sp.id} ${bore.toFixed(2)}/${hilt.toFixed(2)}/${demand.toFixed(2)}`);
      // The bore is a place inside the fist, so a correct grip is the human's
      // number and not zero; a third of a hand of slack is well inside anything
      // a viewer would call held.
      assert(Math.abs(bore - ref.bore) < 0.35,
        `${sp.id} holds its hilt ${bore.toFixed(2)} of its own hands from its wrist against a human's `
        + `${ref.bore.toFixed(2)} — the saber is floating beside the hand, not in it`);
      assert(hilt < ref.hilt * 1.5,
        `${sp.id} carries a hilt ${hilt.toFixed(2)} of its own hands long against a human's `
        + `${ref.hilt.toFixed(2)} — the hilt did not take the species scale`);
      assert(demand < 0.95,
        `${sp.id}'s guard is solved ${demand.toFixed(2)} of its own arm's reach from its shoulder `
        + '— the arm cannot get there and the hilt hangs in the gap');
      assert(hem > -0.02,
        `${sp.id}'s garments settle ${(-hem * 1000).toFixed(0)} mm below the floor it stands on `
        + '— the preview is dressing it in somebody else\'s clothes');
    }
    return `bore/hilt in the figure's own hands, reach in its own arm — ${rows.join(', ')}`;
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  3. the robe cut                                                   */
  /* ══════════════════════════════════════════════════════════════════ */

  check('preview: the six robe cuts are six different garments on screen', () => {
    /*
     * THE DEAD CARD. In the browser, at 292×360, the six cuts differed by at
     * most ONE pixel — and that pixel was the blade flickering.
     *
     * Measured here as the silhouette the box actually rasterises: the whole
     * figure, body and both garments, at the box's real 290×357, at four
     * bearings of the spin, and the score for a pair is the WORST of those four
     * — a cut that only reads from the front does not count.
     *
     *      cut          hem px   width px   hem out of level   folds
     *      temple        282.9     35.9            20 mm         5
     *      cassock       261.3     30.2            21             4
     *      tabard        229.5     31.1            24             4
     *      ceremonial    262.7     47.5            51             6
     *      coat          252.8     31.4            28             3
     *      wrap          254.2     31.2           312             4
     *
     * 53 pixels between the highest hem and the lowest in a 357-line box, and
     * the wrapped robe's hem is 312 mm out of level with itself — the one cut
     * that can ONLY be read standing still, which is what the preview is.
     */
    const cam = new THREE.PerspectiveCamera(PREVIEW_VIEW.fov, W / H, 0.05, 40);
    const shots = {}, rows = [];
    for (const c of ROBE_CUTS) {
      const b = bench({ robeCut: c.id });
      assert(b.skirt, `the ${c.id} preview has no simulated skirt at all`);
      assert(b.cloak, `the ${c.id} preview has no cape at all`);
      // the id really reaches the solver rather than being stored and dropped
      if (c.skirt.length !== undefined) {
        assert(Math.abs(b.skirt.length - c.skirt.length) < 1e-9,
          `the ${c.id} preview skirt is ${b.skirt.length} m long against the cut's ${c.skirt.length}`);
      }
      framePreviewCamera(cam, b.content, { pitch: 0.1, aspect: W / H });
      shots[c.id] = YAWS.map(y => mask(b.pivot, cam, y));
      const hem = [];
      for (let i = 0; i < b.skirt.cols; i++) hem.push(b.skirt.pos[((b.skirt.rows - 1) * b.skirt.cols + i) * 3 + 1]);
      rows.push(`${c.id} ${area(shots[c.id][0])}px`);
      assert(area(shots[c.id][0]) > 4000, `the ${c.id} figure covers only ${area(shots[c.id][0])} pixels`);
      if (c.id === 'wrap') {
        assert((Math.max(...hem) - Math.min(...hem)) > 0.15,
          `the wrapped robe's hem is only ${((Math.max(...hem) - Math.min(...hem)) * 1000).toFixed(0)} mm out of level — the asymmetry is not reaching the preview`);
      }
    }
    // 336 px is the measured worst pair (cassock/wrap). The floor is 250, which
    // is a quarter of a percent of the box — and 250 times what a player was
    // getting, which was one pixel of blade flicker.
    let worst = 1e9, pair = '';
    for (let i = 0; i < ROBE_CUTS.length; i++) for (let j = i + 1; j < ROBE_CUTS.length; j++) {
      const a = ROBE_CUTS[i].id, bb = ROBE_CUTS[j].id;
      const d = Math.min(...shots[a].map((m, k) => xor(m, shots[bb][k])));
      if (d < worst) { worst = d; pair = `${a}/${bb}`; }
    }
    assert(worst > 250, `the closest two cuts, ${pair}, differ by ${worst} pixels of ${W * H} — that is the same robe twice`);
    return `${ROBE_CUTS.length} cuts, ${rows.join(' ')}; closest pair ${pair} ${worst} px of ${W * H}`;
  });

  check('preview: picking a cut is wired to the figure that gets rebuilt', async () => {
    // The row shipped with NO handler — `_cardRow('cut-list', 'h-cut',
    // 'robeCut', ROBE_CUTS)` and nothing else — so the setting was written to
    // disk and the box never redrew. Both ends are pinned: the control must
    // rebuild, and the rebuild must carry the setting into the garment.
    const menu = await readFile(new URL('../../src/ui/Menu.js', import.meta.url), 'utf8');
    assert(/_cardRow\('cut-list',\s*'h-cut',\s*'robeCut',\s*ROBE_CUTS,\s*\(\)\s*=>\s*this\._refreshPreview\(true\)\)/.test(menu),
      'picking a robe cut does not rebuild the preview');
    assert(menu.includes('_refreshPreview(rebuild'), '_refreshPreview is gone');
    assert(/assemblePreview\(p\.pivot, p\.figure, p\.saber, this\.s\)/
      .test(functionBody(menu, '_refreshPreview(rebuild')),
      'the preview no longer assembles the figure from the live settings');
    // The cut is still the third argument and still comes off the live
    // settings; what follows it now is the rest of the wardrobe — the cape,
    // the over-panels and the belt, which are the other pieces the same
    // function attaches. The comma is deliberate: it pins the cut's POSITION
    // without pinning the arity, so a piece added to the wardrobe does not
    // read as the cut coming unwired.
    assert(/dressPreviewFigure\(host, built, s\.robeCut[,)]/.test(menu),
      'the assembled figure is not dressed in the chosen cut');
    // and behaviourally: an unknown id must not throw in a menu
    const odd = dressPreviewFigure(new THREE.Group(), buildJedi({ scale: 1 }), 'no-such-cut');
    assert(odd.cloak && odd.skirt, 'an unknown cut id leaves the figure undressed');
    return 'cut-list → _refreshPreview(true) → assemblePreview(this.s) → dressPreviewFigure(s.robeCut)';
  });

  check('preview: changing the blade re-machines the hilt instead of rebuilding the Jedi', async () => {
    /*
     * A COST CHECK, and a correctness one riding on it.
     *
     * Measured in Chromium on SwiftShader, a full preview rebuild — buildJedi,
     * a Saber, two garments and 120 frames of cloth — costs 73-234 ms. The
     * blade length and core width sliders fire on every pointer move, so
     * rebuilding a whole Jedi for each one is about 8 frames a second of drag
     * for a change that touches nothing but the weapon. The weapon-only path
     * measures 2.7-11.7 ms.
     *
     * The correctness half: Saber.dispose only unhooks its root from the scene
     * it was CONSTRUCTED in, and the preview re-homes that root onto a hand
     * bone afterwards. Disposing without removing it from the hand first leaves
     * the old hilt in the fist and puts the new one in beside it — two hilts,
     * growing by one per drag step. `removeFromParent` has to come first, and
     * it is asserted here in that order.
     *
     * Driven from the source because Menu cannot be constructed without a real
     * DOM: `this.el.build.textContent` alone kills it under the shim.
     */
    const menu = await readFile(new URL('../../src/ui/Menu.js', import.meta.url), 'utf8');
    assert(/if \(rebuild === 'saber' && p\.saber && p\.figure\) return this\._reforgeSaber\(\)/.test(menu),
      'there is no weapon-only path — every blade tweak rebuilds the whole figure');
    const i = menu.indexOf('_reforgeSaber() {');
    assert(i > 0, '_reforgeSaber is gone');
    const body = menu.slice(i, menu.indexOf('_clearPreview()', i));
    const rm = body.indexOf('removeFromParent()'), dis = body.indexOf('.dispose()');
    assert(rm > 0 && dis > rm,
      'the old hilt is disposed without being taken out of the hand first — the next one goes in beside it');
    assert(/poseSaberArm\(p\.figure\.rig, p\.saber\)/.test(body),
      'the new hilt is placed by some other means than the one statement of how a hand holds one');
    assert(/previewContent\(/.test(body), 'a longer blade does not re-measure the shot');
    // and every control that only changes the weapon uses it
    for (const [what, re] of [
      ['the forge length slider', /'opt-bladelen'[^\n]*_refreshPreview\('saber'\)/],
      ['the core width slider', /'opt-bladewidth'[^\n]*_refreshPreview\('saber'\)/],
      ['the hilt cards', /this\.s\.hiltStyle = h;[\s\S]{0,220}_refreshPreview\('saber'\)/],
      ['the training length slider', /'opt-train-bladelen'[\s\S]{0,600}?_refreshPreview\('saber'\)/],
    ]) assert(re.test(menu), `${what} still rebuilds the whole figure`);
    return 'blade length, core width and hilt style re-forge the weapon only (2.7-11.7 ms against 73-234)';
  });

  check('preview: the preview wears the garment the game wears', async () => {
    /*
     * A preview of a different costume is a lie told carefully. Player.js's
     * cape constants are read back out of the source and compared with the
     * cloak this actually builds, so the two cannot drift apart quietly; the
     * skirt is compared against one built with Player's own option set.
     */
    const player = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    const cloakCall = player.slice(player.indexOf('this.cloak = attachCloak('), player.indexOf('this.cloak = attachCloak(') + 400);
    assert(cloakCall.includes('cut: this.robeCut'), 'Player no longer hands the cut to the cape');
    const b = bench();
    for (const [key, prop] of [['width', 'width'], ['length', 'length'], ['cols', 'cols'], ['rows', 'rows'], ['flare', 'flare']]) {
      const m = cloakCall.match(new RegExp(`${key}:\\s*([\\d.]+)`));
      assert(m, `Player's cape no longer states its ${key}`);
      assert(Math.abs(b.cloak[prop] - parseFloat(m[1])) < 1e-9,
        `the game's cape is ${key} ${m[1]} and the preview's is ${b.cloak[prop]}`);
    }
    // the skirt: same options as Player's, bar the seed this pins on purpose
    const other = buildJedi({ scale: 1 });
    standPreviewFigure(other.rig);
    const asPlayer = attachSkirt(new THREE.Group(), other.rig, { rigid: other.robeSkirt, cut: b.s.robeCut });
    for (const k of ['cols', 'rows', 'length', 'pleat', 'shear', 'fullness', 'gravity', 'pinRows', 'hemBias']) {
      assert(asPlayer[k] === b.skirt[k], `the preview skirt's ${k} is ${b.skirt[k]} where the game's is ${asPlayer[k]}`);
    }
    asPlayer.dispose();
    // and the rigid lathe the cloth replaces must be OFF, or the preview shows
    // both garments at once — which is what a cut looked like it was doing
    const shown = b.built.robeSkirt.filter(m => m.visible).length;
    assert(shown === 0, `${shown} of the ${b.built.robeSkirt.length} rigid robe pieces are still visible under the cloth`);
    assert(b.cloak.outer === b.skirt, 'the cape is not collided against the live skirt, so it hangs through it');
    return `cape ${b.cloak.width}×${b.cloak.length} m, ${b.cloak.cols}×${b.cloak.rows}, flare ${b.cloak.flare}; `
      + `${b.built.robeSkirt.length} rigid pieces hidden; cape proxy fed from the skirt`;
  });

  check('preview: the cloth has stopped moving before the shot is taken', () => {
    /*
     * A still of a garment mid-fall is a garment nobody chose. The skirt is
     * settled by frame 15; the CAPE is 860 mm of cloth falling off a pair of
     * shoulders and is still 8-12 mm out at frame 45 — which is what PREVIEW_
     * SETTLE is sized for. Checked by running each garment five times longer
     * and asking how far it moved after the shot was already taken.
     */
    const rows = [];
    let worst = 0, at = '';
    const low = (c) => { let y = 1e9; for (let i = 1; i < c.pos.length; i += 3) y = Math.min(y, c.pos[i]); return y; };
    for (const c of ROBE_CUTS) {
      // a private figure: bench() has already moved its pivot, and re-running
      // a cloth solve after that would re-anchor it to a body that moved
      const built = buildJedi({ scale: 1 });
      const host = new THREE.Group();
      host.add(built.rig.root);
      standPreviewFigure(built.rig);
      const g = dressPreviewFigure(host, built, c.id);
      const before = [low(g.skirt), low(g.cloak)];
      const wind = new THREE.Vector3();
      for (let i = 0; i < PREVIEW_SETTLE * 5; i++) {
        g.skirt.update(1 / 60, g.skirt.refreshColliders(), wind);
        g.cloak.update(1 / 60, g.cloak.refreshColliders(), wind);
      }
      const drift = [Math.abs(low(g.skirt) - before[0]) * 1000, Math.abs(low(g.cloak) - before[1]) * 1000];
      for (const [k, d] of [['skirt', drift[0]], ['cape', drift[1]]]) {
        if (d > worst) { worst = d; at = `${c.id}'s ${k}`; }
        assert(d < 4, `${c.id}'s ${k} hem moves another ${d.toFixed(1)} mm after the preview has already been drawn`);
      }
      rows.push(`${c.id} ${drift[0].toFixed(1)}/${drift[1].toFixed(1)}`);
      g.skirt.dispose(); g.cloak.dispose();
    }
    assert(PREVIEW_SEED.cloak && PREVIEW_SEED.skirt, 'the preview garments draw a free seed — the same figure would crease differently every time');
    return `${PREVIEW_SETTLE} frames then ${PREVIEW_SETTLE * 5} more: worst drift ${worst.toFixed(2)} mm (${at}); skirt/cape mm ${rows.join(', ')}`;
  });

  check('preview: the same character is the same picture twice', () => {
    // With a free per-cloak seed one cut rendered twice differs by 131-268
    // silhouette pixels depending on the bearing — the same order as the 336
    // that separates the two closest CUTS. Pinned, it is exactly 0, and every
    // pixel that moves in the box is a choice the player made.
    const cam = new THREE.PerspectiveCamera(PREVIEW_VIEW.fov, W / H, 0.05, 40);
    const make = () => {
      const pivot = new THREE.Group();
      const built = buildJedi({ robeIndex: 1, build: 0.5, scale: 1 });
      const saber = new Saber(pivot, { colorIndex: 0, bladeLength: 1.15 });
      saber.trail.visible = false;
      const a = assemblePreview(pivot, built, saber, { robeCut: 'temple', bladeLength: 1.15 });
      pivot.position.y = -(a.content.y0 + a.content.y1) / 2;
      pivot.updateMatrixWorld(true);
      framePreviewCamera(cam, a.content, { pitch: 0.1, aspect: W / H });
      return YAWS.map(y => mask(pivot, cam, y));
    };
    const a = make(), b = make();
    const diffs = a.map((m, i) => xor(m, b[i]));
    assert(diffs.every(d => d === 0),
      `two builds of the same character differ by ${diffs.join('/')} pixels — the preview is not reproducible`);
    return `two builds, four bearings, ${area(a[0])} px of figure, 0 pixels of difference`;
  });

  /**
   * THE PREVIEW CAN BE WALKED INTO. Reported as "you should be able to zoom
   * into the preview image to better see the customizations, or even zoom on
   * the saber, it's too far away".
   *
   * Two properties, and the second is the one that is easy to get wrong. The
   * first is that zoom moves the camera closer. The second is that it moves it
   * closer along the SAME axis to the SAME framing — an earlier draft folded
   * the zoom into the fit iteration, and the solver then dutifully converged on
   * "the figure fills the frame at 3x", which is not a zoom, it is a smaller
   * figure. So `fill` must be unchanged by zoom while `distance` falls.
   *
   * And `focus` is in units of the figure's own HALF-HEIGHT, not metres:
   * a fixed offset frames a human's chin and Yoda's species' knees. That is
   * checked by framing the face shot on both and asserting the camera's height
   * lands the same fraction up each figure.
   */
  check('preview: the camera can be walked in, and walking in does not re-frame', () => {
    const content = { y0: 0, y1: 1.78, radius: 0.55 };
    const cam = new THREE.PerspectiveCamera(34, 1.15, 0.05, 40);

    const base = framePreviewCamera(cam, content, { aspect: 1.15 });
    const basePos = cam.position.clone();
    assert(base.zoom === 1, `the default is zoom ${base.zoom}, not 1`);

    let prev = base.distance;
    for (const z of [1.5, 2.6, 3.4, PREVIEW_ZOOM_MAX]) {
      const got = framePreviewCamera(cam, content, { aspect: 1.15, zoom: z });
      assert(got.distance < prev, `zoom ${z} did not move the camera in (${got.distance} vs ${prev})`);
      // the same framing, from closer: the fit is solved before the walk-in
      assert(Math.abs(got.fill - base.fill) < 0.01,
        `zoom ${z} re-framed the shot (fill ${got.fill.toFixed(3)} vs ${base.fill.toFixed(3)}) — `
        + 'the zoom is inside the fit iteration, which makes it a smaller figure rather than a closer camera');
      // …and along the same axis
      const bearing = cam.position.clone().normalize().dot(basePos.clone().normalize());
      assert(bearing > 0.999, `zoom ${z} swung the camera off its own axis (dot ${bearing.toFixed(4)})`);
      prev = got.distance;
    }
    assert(base.distance / prev > 3, `${PREVIEW_ZOOM_MAX}x only bought ${(base.distance / prev).toFixed(2)}x`);

    // The named shots, and FOCUS being proportional rather than absolute.
    const face = PREVIEW_SHOTS.find(s => s.id === 'face');
    assert(face, 'there is no face shot');
    const heights = [];
    for (const h of [1.78, 0.66]) {                       // a human, and Yoda's species
      framePreviewCamera(cam, { y0: 0, y1: h, radius: 0.55 * (h / 1.78) },
        { aspect: 1.15, zoom: face.zoom, focus: face.focus });
      heights.push(cam.position.y / h);                   // as a fraction of the figure
    }
    assert(Math.abs(heights[0] - heights[1]) < 0.02,
      `the face shot sits at ${(heights[0] * 100).toFixed(0)}% of a human and `
      + `${(heights[1] * 100).toFixed(0)}% of a 0.66 m figure — the focus is in metres, not in figures`);

    return `${PREVIEW_ZOOM_MAX}x max, ${(base.distance / prev).toFixed(1)}x closer, fill held at `
      + `${base.fill.toFixed(3)}; ${PREVIEW_SHOTS.length} shots, face at `
      + `${(heights[0] * 100).toFixed(0)}% of the figure on both`;
  });
}
