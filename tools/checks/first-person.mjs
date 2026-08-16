/**
 * BATTLEFRONT BORZ — first person, which is mostly a picture of your own hands.
 *
 * The player's verdict was "1/10", and the two faults behind it are both things
 * a number can settle, which is why nothing had ever caught them: there was no
 * check in this project that put the camera in the player's head and asked what
 * was in the frame.
 *
 *   THE HANDS WERE OUTSIDE THE FRUSTUM. Measured in the running game, on the
 *   arena, standing still: the right hand sat 0.34 m below the eye and 0.52 m
 *   in front of it, which is 33.2 degrees below the view axis against a 60
 *   degree vertical field whose half-angle is 30. Three degrees outside. What
 *   reached the screen was the top of the hilt and a sliver of glove along the
 *   bottom edge — NDC y = -0.97 out of -1.0 — and the arms below that were
 *   simply gone. Every first-person game in existence puts the weapon in the
 *   lower third of the frame; this one put it under the floor.
 *
 *   THE HILT WAS INSIDE THE PALM. `_updateBody` solves the arm with
 *   `solveIK('armR', 'foreR', gripR, poleR)` where `gripR` is a point ON THE
 *   HILT'S AXIS, so the wrist joint — the hand bone's own origin — is placed
 *   exactly on the axis of the cylinder it is supposed to be holding. Measured:
 *   the vector from the hand bone to the grip point, in hand space, was
 *   (0, 0, 0) to four decimals. The palm slab is 3 cm thick and centred on that
 *   origin, so the hilt ran through the middle of the hand and out the back,
 *   and the fingers curled around nothing. A hand holds a cylinder by having
 *   its axis sit OFF the wrist, forward of the palm, in the bore the curled
 *   fingers make.
 *
 * Both are measured here against the real Player, the real rig and the real
 * camera, headlessly, so they can be tuned in seconds instead of in
 * two-minute screenshots — which is the other reason they survived.
 */

import { Player } from '../../src/game/Player.js';
import { buildHand } from '../../src/game/Bodies.js';

let THREE = null;

/* ── the bench ───────────────────────────────────────────────────────── */

function stubWorld() {
  return {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0),
      inBounds: () => true, half: 200, crater() {}, surfaceAt: () => 'sand',
    },
    particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [] },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    report() {},
  };
}

function stubInput() {
  return {
    keys: new Set(), buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (out) => { out.x = 0; out.y = 0; return out; },
    act: () => false, actHit: () => false,
  };
}

/**
 * A player standing still, looking level, in first person, with the blade lit —
 * stepped long enough for the gait, the eye and the blade solve to settle.
 *
 * `pitch` tilts the view, because the whole point of a viewmodel is that the
 * hands hold their place in the FRAME however the head turns; a framing that is
 * only correct looking level is not a framing.
 */
function firstPersonFrame({ frames = 90, pitch = 0 } = {}) {
  const world = stubWorld();
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  p.velocity.set(0, 0, 0);
  p.camera.firstPerson = true;
  p._applyViewMode();
  p.saber.ignite();
  p.saber.ignition = 1;
  const input = stubInput();
  const ctx = {
    input, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: [],
  };
  for (let i = 0; i < frames; i++) {
    ctx.time = world.time = i / 60;
    p.camera.pitch = pitch;
    p.update(1 / 60, ctx);
  }
  const cam = world.engine.camera;
  cam.updateMatrixWorld(true);
  return { p, world, cam, ctx };
}

/** Where a world point lands in the frame, and how far off the view axis. */
function frameOf(cam, pt) {
  const ndc = pt.clone().project(cam);
  const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const local = pt.clone().sub(eye).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()).invert());
  // camera space: -Z forward, +Y up
  const fwd = -local.z;
  return {
    ndc: { x: ndc.x, y: ndc.y, z: ndc.z },
    down: Math.atan2(-local.y, Math.max(1e-6, fwd)) * 180 / Math.PI,
    side: Math.atan2(local.x, Math.max(1e-6, fwd)) * 180 / Math.PI,
    dist: local.length(), fwd,
  };
}

export async function run({ check, assert, THREE: T }) {
  THREE = T;

  check('first person: the SWORD hand is in the frame, and the off hand is out of it', () => {
    /**
     * The bound is the frustum's own half-angle, not a taste. At 60 degrees
     * vertical the half-angle is 30, so a hand at 33.2 degrees below the axis
     * is off the bottom of the screen — arithmetic, not an opinion.
     *
     * 26 rather than 22, and the four degrees are the whole of the argument in
     * the check below. Raising the hands means moving the anchor the blade is
     * SOLVED from, and every centimetre of that is a centimetre of real reach
     * the third-person player does not get. What was done instead costs
     * nothing: the anchor's offset from the chest was ROTATED — 0.13 m up and
     * 0.28 forward became 0.26 up and 0.16 forward, the same 0.30 m away from
     * the body — which lifts the hands without lengthening the sword. That buys
     * 33.2 degrees down to 24.4, NDC y -1.04 to -0.79.
     *
     * ── THIS CHECK USED TO REQUIRE BOTH HANDS IN THE FRAME, AND THAT WAS AN
     *    ASSUMPTION ABOUT A TWO-HANDED FIRST-PERSON GRIP ────────────────────
     *
     * First person is one-handed now (Player._updateBody, and the note over
     * GRIP_AT), because the fault behind three separate reports of "the first
     * person hand/hilt looks like jumbled garbage" was measured at last and it
     * was OCCLUSION: two fists on a 25 cm shaft at 0.5 m from the lens hid 91%
     * of the hilt. Requiring the OFF hand to sit in the lower third of the
     * frame is requiring the second occluder back.
     *
     * So the sword hand keeps every bound it had, unweakened — in front of the
     * lens, inside the half-field with the same 4 degrees of margin, in the
     * lower part of the frame, not off to the side — and the off hand is
     * asserted the other way round: it must be BELOW the frame, deliberately
     * out of shot, which is what the reference the player supplied shows and
     * what an idle hand at your side does. It must still be in front of the
     * lens, because an arm folded behind the camera is sliced open by it; the
     * MARGIN on that (the deltoid's 55 mm against a 45 mm near plane, at every
     * pitch) is measured in tools/checks/viewmodel.mjs and is not restated here.
     */
    const { p, cam } = firstPersonFrame();
    const rig = p.rig;
    rig.updateMatrices(); rig.root.updateMatrixWorld(true);
    const half = cam.fov / 2;
    const out = [];
    const at = (name) => {
      const b = rig.get(name);
      assert(b, `no ${name} bone`);
      const f = frameOf(cam, new THREE.Vector3().setFromMatrixPosition(b.obj.matrixWorld));
      assert(f.fwd > 0.05, `${name} is ${f.fwd.toFixed(2)} m in front of the lens — it is behind the camera`);
      return f;
    };

    const r = at('handR');
    assert(r.down < half - 4,
      `handR sits ${r.down.toFixed(1)} degrees below the view axis against a ${half.toFixed(0)} degree `
      + `half-field — NDC y ${r.ndc.y.toFixed(2)}. It is off the bottom of the screen.`);
    assert(r.ndc.y < -0.05,
      `handR is at NDC y ${r.ndc.y.toFixed(2)} — a viewmodel belongs in the lower part of the frame, not across it`);
    assert(Math.abs(r.side) < half * 1.6, `handR is ${r.side.toFixed(1)} degrees off to the side`);
    out.push(`sword hand ${r.down.toFixed(1)}° down, NDC y ${r.ndc.y.toFixed(2)}`);

    const l = at('handL');
    assert(l.down > half,
      `handL sits ${l.down.toFixed(1)} degrees below the axis, inside a ${half.toFixed(0)} degree half-field — `
      + 'the off hand is back in the picture, and it is the second occluder this view was one-handed to remove');
    out.push(`off hand ${l.down.toFixed(1)}° down, out of shot`);
    return out.join('; ');
  });

  check('first person: the hilt is ON SCREEN and not behind your own fist', () => {
    /**
     * THE NUMBER NOBODY HAD EVER MEASURED, and the reason the same complaint
     * survived two rounds of fixing the pose. "The first person hand/hilt looks
     * like jumbled garbage" was reported three times; the first two answers
     * moved the shoulders off the ribcage and raised the blade anchor, both of
     * which were real faults and neither of which was THE fault.
     *
     * It is occlusion. Measured with tools/_fpgeom.mjs on the running game
     * before this pass:
     *
     *     hilt on screen                27.6% of frame height, 23 of 31 samples
     *     of what was on screen, behind the player's own fists          91%
     *
     * A hilt that is a quarter of the frame and nine tenths hidden is not a
     * hilt, it is a pale smudge where the blade begins. The supplied reference
     * (assets/reference/first-person/) shows the target: ONE fist low on the
     * grip with the whole emitter section standing clear above it.
     *
     * Both bounds are derived, not chosen:
     *
     *   ALL OF IT ON SCREEN. 31 samples along the shaft, the same span
     *   _fpgeom uses (−0.5 … 1.0 of emitterY, which brackets metal that runs
     *   −0.092 … +0.158). A hilt whose pommel is under the bottom edge is the
     *   thing the screenshot shows.
     *
     *   UNDER 35% BEHIND THE HAND. The floor for a closed fist that is wholly
     *   ON a shaft that is wholly ON screen is about 39% — the fist is 90 mm
     *   across and the sampled shaft is 233 — so 35% says the fist is at the
     *   pommel end with part of its width hanging past it, which is the
     *   reference's own grip. Shipped measures 32%.
     *
     * Read at three pitches, because a framing that is only right looking level
     * is not a framing. The three are IDENTICAL to the sample, which is the
     * viewmodel weld doing its job rather than a coincidence.
     */
    const rows = [];
    for (const [name, pitch] of [['level', 0], ['looking up', 1.1], ['looking down', -1.2]]) {
      const { p, cam } = firstPersonFrame({ pitch });
      const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      const S = p.saber;
      S.root.updateMatrixWorld(true);
      // What can stand in front of the hilt: the player's own hands and forearms.
      const occluders = [];
      for (const b of ['handR', 'handL', 'foreR', 'foreL']) {
        const bone = p.rig.get(b);
        if (bone) bone.obj.traverse((o) => { if (o.isMesh && o.visible) occluders.push(o); });
      }
      const rc = new THREE.Raycaster(); rc.near = 0.02; rc.far = 3;
      let n = 0, seen = 0, blocked = 0, lo = 1, hi = -1;
      for (let t = -0.5; t <= 1.001; t += 0.05) {
        n++;
        const w = S.root.localToWorld(new THREE.Vector3(0, t * S.emitterY, 0));
        const ndc = w.clone().project(cam);
        if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;
        lo = Math.min(lo, ndc.y); hi = Math.max(hi, ndc.y); seen++;
        rc.setFromCamera({ x: ndc.x, y: ndc.y }, cam);
        // 4 mm of slack so a sample sitting ON the glove's surface is not
        // counted as being behind it.
        const d = w.distanceTo(eye);
        if (rc.intersectObjects(occluders, true).some((h) => h.distance < d - 0.004)) blocked++;
      }
      const pct = seen ? 100 * blocked / seen : 100;
      assert(seen === n,
        `${name}: ${n - seen} of ${n} points along the hilt are off the screen — the pommel is under the bottom edge`);
      assert(pct < 35,
        `${name}: ${pct.toFixed(0)}% of the hilt is behind the player's own hand, against 91% before this and a 35% bound`);
      // and it is still a hilt you can see, not a speck receded out of the shot
      assert((hi - lo) / 2 > 0.10,
        `${name}: the hilt is only ${((hi - lo) / 2 * 100).toFixed(1)}% of the frame height`);
      rows.push(`${name} ${seen}/${n} on screen, ${pct.toFixed(0)}% occluded, ${((hi - lo) / 2 * 100).toFixed(0)}% of frame`);
    }
    return rows.join('; ');
  });

  check('first person: the hands hold their place in the frame at every pitch', () => {
    // What makes a viewmodel a viewmodel. _anchorViewArms puts the shoulders at
    // a fixed point in the AIM frame precisely so this holds; if the framing is
    // only right looking level then something downstream is still solving in
    // world space and the hands will swim when the player looks up.
    const spread = { down: [], side: [] };
    let fov = 60;
    for (const pitch of [-0.9, -0.45, 0, 0.45, 0.9]) {
      const { p, cam: c } = firstPersonFrame({ pitch });
      p.rig.updateMatrices(); p.rig.root.updateMatrixWorld(true);
      const pt = new THREE.Vector3().setFromMatrixPosition(p.rig.get('handR').obj.matrixWorld);
      const f = frameOf(c, pt);
      spread.down.push(f.down); spread.side.push(f.side);
      fov = c.fov;
    }
    const range = (a) => Math.max(...a) - Math.min(...a);
    assert(range(spread.down) < 12,
      `looking from -0.9 to +0.9 rad moves the hand ${range(spread.down).toFixed(1)} degrees up and down the frame `
      + `(${spread.down.map((v) => v.toFixed(0)).join(', ')}) — the arms are swimming against the view`);
    assert(Math.max(...spread.down) < fov / 2 - 4,
      `at some pitch the hand reaches ${Math.max(...spread.down).toFixed(1)} degrees down and leaves the frame`);
    return `pitch -0.9→0.9: ${spread.down.map((v) => v.toFixed(1) + '°').join(' ')}`;
  });

  check('first person: the hilt is HELD, not buried in the middle of the palm', () => {
    /**
     * `solveIK('armR','foreR', gripR, poleR)` places the wrist joint on the
     * grip point, and the grip point is on the hilt's own axis, so the hilt ran
     * through the centre of the hand. Measured before this: the grip point in
     * hand space was (0.0000, 0.0000, 0.0000).
     *
     * A hand holds a cylinder with the cylinder's axis forward of the palm, in
     * the bore the curled fingers make. buildHand's own frame says where that
     * is: +Y wrist → knuckles, +Z the way the palm faces, palm slab `palmT`
     * thick centred on the origin and running `palmL` up +Y. So the axis has to
     * clear +Z by at least half the palm's thickness plus the hilt's radius,
     * and sit up the hand near the middle of the grip rather than at the wrist
     * crease. Both are measured off the real geometry here rather than named.
     */
    const { p } = firstPersonFrame();
    const rig = p.rig;
    rig.updateMatrices(); rig.root.updateMatrixWorld(true);
    const hand = rig.get('handR');
    hand.obj.updateMatrixWorld(true);
    const hw = new THREE.Vector3().setFromMatrixPosition(hand.obj.matrixWorld);
    const hq = hand.obj.getWorldQuaternion(new THREE.Quaternion());
    const grip = p.saber.root.localToWorld(new THREE.Vector3(0, 0.03, 0));
    const local = grip.clone().sub(hw).applyQuaternion(hq.clone().invert());

    // what the hand actually is, from the same builder the body uses
    const geo = buildHand('R', 1, {});
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const palmT = 0.030, hiltR = 0.017;    // buildHand's default, and the hilt's

    assert(local.length() > 1e-4,
      'the grip point is exactly the wrist joint — the hilt runs through the middle of the palm and out the back');
    assert(local.z > palmT * 0.5,
      `the hilt's axis sits ${(local.z * 1000).toFixed(1)} mm along the palm normal, inside a palm ${(palmT * 1000).toFixed(0)} mm thick — `
      + 'it is buried in the hand rather than lying in the fingers');
    assert(local.z > palmT * 0.5 + hiltR * 0.4,
      `the hilt's surface is inside the palm: axis at ${(local.z * 1000).toFixed(1)} mm with a ${(hiltR * 1000).toFixed(0)} mm radius`);
    assert(local.y > 0.015 && local.y < bb.max.y * 0.9,
      `the hilt crosses the hand at y ${(local.y * 1000).toFixed(1)} mm — a grip is held across the middle of the palm, `
      + `not at the wrist crease (0) or past the fingertips (${(bb.max.y * 1000).toFixed(0)} mm)`);
    return `hilt axis at (${local.toArray().map((v) => (v * 1000).toFixed(1)).join(', ')}) mm in hand space, `
      + `palm ${(palmT * 1000).toFixed(0)} mm thick`;
  });

  check('first person: switching view cannot be half-done', () => {
    /**
     * `camera.firstPerson` is a plain boolean and everything that has to happen
     * WITH it — hiding the head, the neck, the ribcage, the clavicles, putting
     * the clavicle rest pose back on the way out — lives in `_applyViewMode`,
     * which only two call sites call. Setting the flag on its own leaves the
     * player looking at the inside of their own skull, and there is nothing in
     * the type to stop anyone doing it. (Written after doing exactly that while
     * investigating this bug, and spending a shot chasing a black wedge across
     * the bottom of the frame that was the player's own jaw.)
     */
    const { p } = firstPersonFrame();
    const hidden = (bone) => {
      const b = p.rig.get(bone);
      if (!b) return null;
      let any = false;
      b.obj.traverse((o) => { if (o.isMesh && o.visible) any = true; });
      return !any;
    };
    for (const bone of ['neck', 'head']) {
      assert(hidden(bone), `the ${bone} is still drawn in first person — that is the inside of your own skull`);
    }
    // and it comes back
    p.camera.firstPerson = false;
    p._applyViewMode();
    for (const bone of ['neck', 'head']) {
      assert(hidden(bone) === false, `leaving first person left the ${bone} invisible on the third-person figure`);
    }
    return 'head and neck hidden in first person, restored on the way out';
  });

  check('first person: a view, not a longer sword', () => {
    /**
     * THE REASON THE HANDS COULD NOT SIMPLY BE RAISED.
     *
     * `FP_HILT_DROP` is where the blade is SOLVED from, not merely where it is
     * drawn, so moving it moves the weapon in the world. The note above the
     * constant stops at 11 cm for exactly that reason and says the rest "wants
     * the blade's own framing checked, and that is a picture, not an
     * inequality." It is an inequality — this one. What must not change is how
     * far the blade reaches FROM THE BODY, and the body is `chest`, which every
     * enemy in the game aims at and which is the same point in both views.
     *
     * So: sweep the blade through its whole guard range in each view and
     * compare the envelopes. If first person reaches further from the chest
     * than third does, it is a different weapon and the framing has to be
     * bought some other way. If it does not, the anchor is free to move.
     */
    const reach = (firstPerson) => {
      const world = stubWorld();
      const p = new Player(world, { isLocal: true });
      p.position.set(0, 0, 0);
      if (firstPerson) { p.camera.firstPerson = true; p._applyViewMode(); }
      p.saber.ignite(); p.saber.ignition = 1;
      const input = stubInput();
      const ctx = { input, terrain: world.terrain, physics: world.physics, particles: null,
        camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
      let far = 0, near = Infinity;
      const tip = new THREE.Vector3();
      for (let i = 0; i < 420; i++) {
        ctx.time = world.time = i / 60;
        // drive the guard right round its travel, the way a fight does
        input.mouse.dx = Math.cos(i / 19) * -38;
        input.mouse.dy = Math.sin(i / 13) * -26;
        input.buttons[0] = (i % 130) < 80;
        p.update(1 / 60, ctx);
        if (i < 120) continue;
        p.saber.pointAt(1, tip);
        const d = tip.distanceTo(p.chest);
        if (d > far) far = d;
        if (d < near) near = d;
      }
      return { far, near };
    };
    const third = reach(false), first = reach(true);
    /*
     * A RATCHET ON A KNOWN FAULT, not a pass mark — the same shape as the wrist
     * check in viewmodel.mjs.
     *
     * First person reaches 1.89 m from the chest and third person 1.49: 27%
     * more sword for changing the camera. It is not a rounding error and it is
     * not new — it is what the note over FP_HILT_DROP predicted ("0.45 looked
     * best but handed first person a third more range, which is not a view
     * option, it is a different weapon") and it was 1.99 before this pass.
     *
     * It cannot be tuned away, and that is worth writing down so nobody spends
     * another afternoon on it. To SEE your hands they have to be in front of
     * the lens; the lens is above and behind the chest; so the hands are in
     * front of the chest; so the blade reaches further from it. Every value of
     * the anchor that frames the hands lengthens the sword, and every value
     * that matches third person's reach puts the hands under the floor. There
     * is no third option while one rigid blade is solved from one anchor.
     *
     * THE FIX IS TO UNIFY THE ANCHOR, not to move it: give third person the
     * same forward-and-up offset from the chest, so there is one weapon and the
     * third-person figure holds its sword in front of itself, which is where a
     * held sword goes. That moves guard geometry SaberController has tuned
     * against the sternum and wants the balance harness run over it, so it is
     * its own piece of work. Until then this bound holds the line at what it is
     * today and fails if it grows.
     */
    assert(first.far < third.far * 1.30,
      `first person reaches ${first.far.toFixed(2)} m from the chest against third person's ${third.far.toFixed(2)} — `
      + `${((first.far / third.far - 1) * 100).toFixed(0)}% more sword for changing the camera, and it was 27% before`);
    assert(first.far > third.far * 0.88,
      `first person reaches only ${first.far.toFixed(2)} m against third person's ${third.far.toFixed(2)} — `
      + 'the view is costing the player their sword');
    return `blade tip from the chest: third ${third.near.toFixed(2)}–${third.far.toFixed(2)} m, `
      + `first ${first.near.toFixed(2)}–${first.far.toFixed(2)} m — `
      + `${((first.far / third.far - 1) * 100).toFixed(0)}% over, UNFIXED, the anchors have to be unified`;
  });
}
