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

import { Player, GRIP_BORE } from '../../src/game/Player.js';
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

/**
 * `oneHand` HOLDS THE ONE-HAND KEY, which is the only way to ask for one hand.
 *
 * There used to be an `fpHands` option and every bench in the repo reached for
 * it, so nothing had ever measured the state a PLAYER can reach: the option
 * moved the arms and left the blade on `GRIPS.two`, while the key moves both.
 * See `Player.handsOnHilt`, which is now the whole of the decision.
 */
/**
 * ONE PRESS, NOT A HELD KEY — and the change is in the game, not here.
 *
 * `grip2` used to be read as a LEVEL, so a bench that wanted one hand on the
 * hilt held the key down for the whole run. The stance is a TOGGLE now (the
 * player: "one handed grip doesn't really work because you have to hold the
 * button the entire time for some reason"), so a held key is a key pressed
 * sixty times a second, which lands on whichever parity the frame count
 * happens to end on — measured, these three benches read two hands on the
 * hilt while asking for one, which is a true report about a bench holding a
 * toggle down.
 *
 * So `actHit` fires ONCE, on the first frame that asks, exactly as a player
 * tapping the key does.
 */
function stubInput(oneHand = false) {
  let pressed = false;
  return {
    keys: new Set(), buttons: [false, false, false],
    mouse: { dx: 0, dy: 0, wheel: 0 }, accel: { x: 0, y: 0 }, bindings: null,
    moveAxis: (out) => { out.x = 0; out.y = 0; return out; },
    act: () => false,
    actHit: (id) => {
      if (!oneHand || id !== 'grip2' || pressed) return false;
      pressed = true;
      return true;
    },
  };
}

/**
 * HOW FAR THIS HAND'S BORE IS FROM THE HILT'S AXIS, in mm — the measurement
 * that says whether a hand is ON the weapon, taken off the posed rig and not
 * off the flag that put it there.
 *
 * `GRIP_BORE` is the hole a closed fist makes, in hand space; `handPoseOnHilt`
 * exists to put that hole on the hilt's axis. So push the bore through the
 * hand's own world matrix and drop a perpendicular onto the axis: a hand
 * holding the weapon reads 0-17 mm — inside the 17 mm shaft — and a hand doing
 * anything else reads hundreds.
 */
function boreOnAxis(p, bone) {
  const b = p.rig.get(bone);
  if (!b) return { off: Infinity, along: 0 };
  b.obj.updateMatrixWorld(true);
  const pt = GRIP_BORE.clone().multiplyScalar(p.rig.scale ?? 1).applyMatrix4(b.obj.matrixWorld);
  const root = p.saber.root;
  root.updateMatrixWorld(true);
  const at = root.getWorldPosition(new THREE.Vector3());
  const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
  const d = pt.sub(at);
  const along = d.dot(ax);
  return { off: d.addScaledVector(ax, -along).length() * 1000, along };
}
const boreOffAxis = (p, bone) => boreOnAxis(p, bone).off;

/**
 * A player standing still, looking level, in first person, with the blade lit —
 * stepped long enough for the gait, the eye and the blade solve to settle.
 *
 * `pitch` tilts the view, because the whole point of a viewmodel is that the
 * hands hold their place in the FRAME however the head turns; a framing that is
 * only correct looking level is not a framing.
 */
function firstPersonFrame({ frames = 90, pitch = 0, oneHand = false, firstPerson = true } = {}) {
  const world = stubWorld();
  const p = new Player(world, { isLocal: true });
  p.position.set(0, 0, 0);
  p.velocity.set(0, 0, 0);
  p.camera.firstPerson = firstPerson;
  p._applyViewMode();
  p.saber.ignite();
  p.saber.ignition = 1;
  const input = stubInput(oneHand);
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

  check('first person: the sword hand is in the frame, and the off hand is where the HAND COUNT says', () => {
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
     * ── THE OFF HAND IS ASSERTED TWO WAYS, AND WHICH ONE IS THE HAND COUNT'S ──
     *
     * This check has now been written three times and each version encoded a
     * DECISION about the grip in its assertion. First it required both hands in
     * frame, which assumed a two-handed first person. Then it required the off
     * hand OUT of frame, which assumed a one-handed one — correct while
     * `fpHands` defaulted to 'one', and an assumption all the same.
     *
     * The grip is not a decision. It is `Player.handsOnHilt()`, and the player
     * changes it with the one-hand key, a Force power, a throw or a drop. So
     * the check asks the body how many hands are on the hilt and holds the pose
     * to THAT: two, and the off fist is on the metal and in the picture; one,
     * and it is out of shot at the player's side, which is what an idle hand
     * does and what the supplied reference shows.
     *
     * Both are run here, because a bench that only ever measures the default is
     * how the one-handed grip went unmeasured for as long as it did.
     */
    const out = [];
    for (const [want, oneHand] of [[2, false], [1, true]]) {
      const { p, cam } = firstPersonFrame({ oneHand });
      const rig = p.rig;
      rig.updateMatrices(); rig.root.updateMatrixWorld(true);
      const half = cam.fov / 2;
      const at = (name) => {
        const b = rig.get(name);
        assert(b, `no ${name} bone`);
        const f = frameOf(cam, new THREE.Vector3().setFromMatrixPosition(b.obj.matrixWorld));
        assert(f.fwd > 0.05, `${name} is ${f.fwd.toFixed(2)} m in front of the lens — it is behind the camera`);
        return f;
      };
      const hands = p.handsOnHilt();
      assert(hands === want,
        `holding the one-hand key ${oneHand ? 'down' : 'up'} left ${hands} hands on the hilt, not ${want} — `
        + 'the bench is measuring a state it did not ask for');

      const r = at('handR');
      assert(r.down < half - 4,
        `${hands} hands: handR sits ${r.down.toFixed(1)} degrees below the view axis against a ${half.toFixed(0)} degree `
        + `half-field — NDC y ${r.ndc.y.toFixed(2)}. It is off the bottom of the screen.`);
      assert(r.ndc.y < -0.05,
        `${hands} hands: handR is at NDC y ${r.ndc.y.toFixed(2)} — a viewmodel belongs in the lower part of the frame, not across it`);
      assert(Math.abs(r.side) < half * 1.6, `${hands} hands: handR is ${r.side.toFixed(1)} degrees off to the side`);
      /* AND THE SWORD HAND IS ON THE SWORD, in both grips. A fist in the right
       * part of the frame with the hilt 30 cm away from it would pass every
       * line above. The shaft is 17 mm in radius, so a bore further off the
       * axis than that is a hand beside the weapon rather than round it. */
      const bR = boreOffAxis(p, 'handR');
      assert(bR < 25, `${hands} hands: the sword hand's bore is ${bR.toFixed(0)} mm off the hilt's axis — `
        + 'it is not holding it');

      const l = at('handL');
      const bL = boreOffAxis(p, 'handL');
      if (hands === 2) {
        assert(bL < 25, `two hands on the hilt, and the off fist's bore is ${bL.toFixed(0)} mm off the axis — `
          + 'the pose has one hand on the weapon and the body says two');
        assert(l.down < half,
          `two hands on the hilt and the off one is ${l.down.toFixed(1)} degrees below a ${half.toFixed(0)} degree `
          + 'half-field — it is holding the weapon from off the bottom of the screen');
        out.push(`two hands: sword ${r.down.toFixed(1)}° down NDC y ${r.ndc.y.toFixed(2)}, off hand `
          + `${l.down.toFixed(1)}° down and ${bL.toFixed(0)} mm off the axis`);
      } else {
        assert(bL > 200, `one hand on the hilt, and the off fist's bore is only ${bL.toFixed(0)} mm off the axis — `
          + 'it is still on the weapon');
        assert(l.down > half,
          `one hand on the hilt and the off one sits ${l.down.toFixed(1)} degrees below the axis, inside a `
          + `${half.toFixed(0)} degree half-field — it is back in the picture holding nothing`);
        out.push(`one hand: sword ${r.down.toFixed(1)}° down NDC y ${r.ndc.y.toFixed(2)}, off hand `
          + `${l.down.toFixed(1)}° down and ${bL.toFixed(0)} mm off the axis, out of shot`);
      }
    }
    return out.join('; ');
  });

  check('first person: how many hands are on the hilt is what you SEE', () => {
    /**
     * THE NUMBER NOBODY HAD EVER MEASURED, and the reason the same complaint
     * survived two rounds of fixing the pose. "The first person hand/hilt looks
     * like jumbled garbage" was reported three times; the first two answers
     * moved the shoulders off the ribcage and raised the blade anchor, both of
     * which were real faults and neither of which was THE fault.
     *
     * It is occlusion. Measured with tools/_fpgeom.mjs on the running game
     * before that pass:
     *
     *     hilt on screen                27.6% of frame height, 23 of 31 samples
     *     of what was on screen, behind the player's own fists          91%
     *
     * ── AND THE ANSWER TO IT IS NOT "ONE HAND", IT IS "WHICHEVER IS TRUE" ───
     *
     * This check used to hold one bound, 35%, because first person was
     * one-handed by construction. It is not: `Player.handsOnHilt()` reads the
     * body, and a player holding the hilt with both hands sees both hands. So
     * the bound is per grip, each derived from what its own geometry can do,
     * and the check runs both:
     *
     *   ONE HAND, UNDER 35%. The floor for a closed fist wholly ON a shaft
     *   wholly ON screen is about 39% — the fist is 108 mm across and the
     *   sampled shaft is 233 — so 35% says the fist is at the pommel end with
     *   part of its width hanging past it, which is the reference's own grip.
     *   Measured with the one-hand key held: 29%.
     *
     *   TWO HANDS, UNDER 70%. Two fists that width sitting FP_HAND_GAP apart
     *   span 173 mm of that 233, so 74% is the ceiling and nothing can be done
     *   about it: it is what two closed hands on a 25 cm hilt at half a metre
     *   from a lens ARE. Measured: 65%. That is the honest price of the grip
     *   the player is holding, and the clear view is one keypress away.
     *
     * WHAT BOTH GRIPS MUST DO IS LEAVE THE EMITTER STANDING CLEAR, which is the
     * complaint underneath all three reports — "a pale smudge where the blade
     * begins". Sampled along the shaft, the two-handed pose is behind a glove
     * continuously up to t = 0.50 of the emitter and clear from 0.55; the
     * one-handed one is clear from 0.30. So the top of the hilt, from t = 0.65
     * up, is asserted to be wholly visible in both — the blade does not come
     * out of the back of your own fist.
     *
     * Read at three pitches, because a framing that is only right looking level
     * is not a framing.
     */
    const geo = buildHand('R', 1, {});
    geo.computeBoundingBox();
    const FIST = geo.boundingBox.max.x - geo.boundingBox.min.x;   // across the shaft
    const rows = [];
    for (const [want, oneHand, bound] of [[2, false, 70], [1, true, 35]]) {
      for (const [name, pitch] of [['level', 0], ['looking up', 1.1], ['looking down', -1.2]]) {
        const { p, cam } = firstPersonFrame({ pitch, oneHand });
        const hands = p.handsOnHilt();
        assert(hands === want, `${name}: the bench asked for ${want} hands on the hilt and the body says ${hands}`);
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
        let n = 0, seen = 0, blocked = 0, lo = 1, hi = -1, topBlocked = -1;
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
          if (rc.intersectObjects(occluders, true).some((h) => h.distance < d - 0.004)) {
            blocked++; topBlocked = Math.max(topBlocked, t);
          }
        }
        const pct = seen ? 100 * blocked / seen : 100;
        /* WHAT THE FISTS COULD HIDE AT WORST, off the posed rig rather than out
         * of the pose's own constants: the two bores' separation ALONG the
         * shaft, plus one fist's width, over the 1.5·emitterY this samples.
         * Two hands 65 mm apart are 108 mm wide each, so they overlap — a
         * ceiling that added both widths would read 121% and mean nothing. */
        const spread = hands === 2
          ? Math.abs(boreOnAxis(p, 'handR').along - boreOnAxis(p, 'handL').along) : 0;
        const ceiling = 100 * (spread + FIST) / (1.5 * S.emitterY);
        assert(seen === n,
          `${hands} hands, ${name}: ${n - seen} of ${n} points along the hilt are off the screen — the pommel is under the bottom edge`);
        assert(pct < bound,
          `${hands} hands, ${name}: ${pct.toFixed(0)}% of the hilt is behind the player's own hand, against a `
          + `${bound}% bound and a ${ceiling.toFixed(0)}% ceiling that ${hands} closed fist(s) cannot beat`);
        assert(topBlocked < 0.65,
          `${hands} hands, ${name}: the hilt is behind a glove as high as t = ${topBlocked.toFixed(2)} of the emitter — `
          + 'the blade is coming out of the back of your own fist');
        // and it is still a hilt you can see, not a speck receded out of the shot
        assert((hi - lo) / 2 > 0.10,
          `${hands} hands, ${name}: the hilt is only ${((hi - lo) / 2 * 100).toFixed(1)}% of the frame height`);
        rows.push(`${hands}h ${name} ${pct.toFixed(0)}% occluded (ceiling ${ceiling.toFixed(0)}%), clear above `
          + `t=${topBlocked.toFixed(2)}, ${((hi - lo) / 2 * 100).toFixed(0)}% of frame`);
      }
    }
    return rows.join('; ');
  });

  check('grip: how many hands are on the hilt is a fact about the BODY, and both views pose it', () => {
    /**
     *   "Why the fuck would it be either or, both should be modeled and reflect
     *    how many hands you're holding it with"
     *
     * The grip used to be half a fact. `_poseArms` composed four true things
     * and then ANDed a fifth onto them that was about neither the hands nor the
     * weapon — which camera you were in, through an `fpHands` card row on the
     * options screen. So the same body in the same state had a different number
     * of hands on its sword depending on where the lens was, and a player who
     * had just taken a hand off the hilt could put it back from the menu.
     *
     * `Player.handsOnHilt()` is the reader now. This check is the binding one
     * for the whole change and it holds two properties at once, over every
     * state that moves a hand:
     *
     *   THE COUNT IS THE SAME IN BOTH VIEWS. Nothing about a camera can change
     *   how many hands you are holding a sword with.
     *
     *   THE POSED RIG AGREES WITH IT. Counted off the SKELETON, not off the
     *   flag: a hand is on the hilt when the bore its closed fingers make lands
     *   on the hilt's axis. Measured, the separation is not marginal — a hand
     *   holding the weapon reads 0-17 mm, inside the 17 mm shaft, and a hand
     *   doing anything else reads 369 mm or more.
     *
     * The states are read from the game rather than invented: the one-hand key
     * (which is also every telekinetic grip, every stasis field and a thrown
     * blade, since `_readInput` folds all of them into `control.grip`), a Force
     * gesture borrowing the off arm, a blade in flight, and a blade on the
     * floor.
     */
    const states = [
      ['idle', 2, () => {}],
      ['one-hand key', 1, () => {}],
      ['a push in the off hand', 1, (p) => p._gesture('push')],
      ['blade thrown', 0, (p, ctx) => { p.force = 1e9; p.cooldowns.throw = 0; p.throwOrRecall(ctx); }],
      ['blade dropped', 0, (p, ctx) => p._dropSaber(ctx)],
    ];
    const rows = [];
    for (const [name, want, enter] of states) {
      const seen = [];
      for (const firstPerson of [true, false]) {
        const { p, ctx, world } = firstPersonFrame({ firstPerson, oneHand: name === 'one-hand key' });
        enter(p, ctx);
        // …and let the pose catch up with the state, the way a frame does.
        for (let i = 90; i < 100; i++) { ctx.time = world.time = i / 60; p.update(1 / 60, ctx); }
        p.rig.updateMatrices(); p.rig.root.updateMatrixWorld(true);
        const hands = p.handsOnHilt();
        const bores = [boreOffAxis(p, 'handR'), boreOffAxis(p, 'handL')];
        const on = bores.filter((mm) => mm < 25).length;
        assert(hands === want,
          `${name}, ${firstPerson ? 'first' : 'third'} person: the body says ${hands} hands on the hilt and this `
          + `state is ${want} — throwState ${p.throwState}, grip ${p.control.grip}, gesture "${p.gesture.kind}"`);
        assert(on === hands,
          `${name}, ${firstPerson ? 'first' : 'third'} person: ${hands} hands on the hilt and ${on} fists posed on `
          + `it — the bores are ${bores.map((b) => b.toFixed(0)).join(' / ')} mm off the shaft's axis`);
        seen.push({ hands, bores });
      }
      assert(seen[0].hands === seen[1].hands,
        `${name}: ${seen[0].hands} hands on the hilt in first person and ${seen[1].hands} in third — the camera `
        + 'is deciding how many hands you are holding your sword with');
      rows.push(`${name} → ${want} (bores ${seen[0].bores.map((b) => b.toFixed(0)).join('/')} mm first, `
        + `${seen[1].bores.map((b) => b.toFixed(0)).join('/')} mm third)`);
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
     * ONE WEAPON, AND THIS IS THE INEQUALITY THAT SAYS SO.
     *
     * `HILT` is where the blade is SOLVED from, not merely where it is drawn, so
     * it moves the weapon in the world. It used to be two places — the chest in
     * third person, 0.32 m above and 0.16 in front of it in first — because to
     * SEE your hands they have to be in front of the lens, the lens is above and
     * behind the chest, so the hands are in front of the chest. What must not
     * differ between the views is how far the blade reaches FROM THE BODY, and
     * the body is `chest`, which every enemy in the game aims at and which is
     * the same point in both views.
     *
     * ── THE 28% THIS CLAUSE USED TO RATCHET WAS THE RESTING POSE ────────────
     *
     * The measurement below drives the guard with `input.mouse`, and the stub
     * above answers `false` to every action — including `blade`. In the shipped
     * `hold` scheme the mouse is the CAMERA until that button is down, so the
     * guard never left READY_GUARD and all this ever compared was where the two
     * views PARK the blade: third 1.49 m from the chest, first 1.91, "28% more
     * sword for changing the camera". The parking spots did differ, by exactly
     * the anchor offset. The sword did not.
     *
     * So the reach is read three ways now, and the third one is the sword:
     *
     *   REST      the old measurement, kept because it is a real property — how
     *             far out the blade sits when you are not steering it.
     *   SWEPT     the guard driven over its travel with the button held, which
     *             is what the old note said it was doing and was not.
     *   STILL     the ENVELOPE: the guard held motionless at each point of a
     *             9x9 grid over its whole travel, the hands and the blade let
     *             settle at each, and the tip read off the chest. No spring
     *             overshoot, no sweep phase — the reachable set.
     *
     * Measured before the anchors were unified: rest 1.49/1.91 (+28%), swept
     * 1.82/1.84 (+1.2%), still 1.81/1.82 (+0.3%). The weapon was already the
     * same length; what was 9% longer in first person was its reach FORWARD, on
     * the ground plane where an enemy stands — 1.59 m against 1.73 — and that
     * is the number a fight feels. It is asserted here as well, because a 3D
     * distance from the chest can be spent going upwards.
     *
     * All three are asserted at a few percent, and NONE of them is a ratchet.
     * One anchor is one weapon or it is not.
     *
     * WHY THE BOUND IS 5% AND NOT ZERO, and it is derived rather than chosen.
     * The first-person anchor hangs off the EYE — it has to, or the hands swim
     * against the view — and `CameraRig.eyePosition` sets the eye 0.07 m forward
     * along the body's own horizontal (see the note there). That 7 cm is a
     * property of a head sitting in front of a spine, not of the weapon, and on
     * a 1.76 m reach it is 4.0%. Everything the two views can still differ by is
     * that, plus the pelvis ride the eye also takes; measured, the remainder
     * comes in at 2.4% of the envelope and 3.1% on the ground plane.
     */
    const bench = ({ firstPerson, hold = false }) => {
      const world = stubWorld();
      const p = new Player(world, { isLocal: true });
      p.position.set(0, 0, 0);
      p.velocity.set(0, 0, 0);
      if (firstPerson) { p.camera.firstPerson = true; p._applyViewMode(); }
      p.saber.ignite(); p.saber.ignition = 1;
      const input = stubInput();
      // `blade` MUST answer for the mouse to reach the guard at all — see the
      // note over stubInput in tools/_anchor.mjs, which has been bitten twice.
      if (hold) input.act = (id) => id === 'blade';
      const ctx = { input, terrain: world.terrain, physics: world.physics, particles: null,
        camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
      return { p, input, ctx, world, step: (i) => { ctx.time = world.time = i / 60; p.update(1 / 60, ctx); } };
    };

    /** The blade parked at READY_GUARD while the camera turns. */
    const rest = (firstPerson) => {
      const b = bench({ firstPerson });
      let far = 0, near = Infinity;
      const tip = new THREE.Vector3();
      for (let i = 0; i < 420; i++) {
        b.input.mouse.dx = Math.cos(i / 19) * -38;
        b.input.mouse.dy = Math.sin(i / 13) * -26;
        b.step(i);
        if (i < 120) continue;
        const d = b.p.saber.pointAt(1, tip).distanceTo(b.p.chest);
        far = Math.max(far, d); near = Math.min(near, d);
      }
      return { far, near };
    };

    /** The guard driven round its travel, the way a fight does. */
    const swept = (firstPerson) => {
      const b = bench({ firstPerson, hold: true });
      let far = 0;
      const tip = new THREE.Vector3();
      for (let i = 0; i < 600; i++) {
        b.input.mouse.dx = Math.cos(i / 19) * 46;
        b.input.mouse.dy = Math.sin(i / 13) * 34;
        b.step(i);
        if (i >= 120) far = Math.max(far, b.p.saber.pointAt(1, tip).distanceTo(b.p.chest));
      }
      return far;
    };

    /** The envelope: every guard, held still, settled. */
    const still = (firstPerson) => {
      const b = bench({ firstPerson, hold: true });
      for (let i = 0; i < 120; i++) b.step(i);
      let far = 0, horiz = 0, i = 120;
      const tip = new THREE.Vector3();
      for (let gx = -1; gx <= 1.001; gx += 0.25) {
        for (let gy = -1; gy <= 1.05; gy += 0.25) {
          for (let k = 0; k < 26; k++) { b.p.control.gx = gx; b.p.control.gy = gy; b.step(i++); }
          b.p.saber.pointAt(1, tip);
          far = Math.max(far, tip.distanceTo(b.p.chest));
          // …and on the ground plane, from the feet, which is the reach an
          // enemy standing in front of you has to close. A tip a metre over
          // your head is 1.8 m from the chest and can touch nothing.
          horiz = Math.max(horiz, Math.hypot(tip.x - b.p.position.x, tip.z - b.p.position.z));
        }
      }
      return { far, horiz };
    };

    const r3 = rest(false), r1 = rest(true);
    const w3 = swept(false), w1 = swept(true);
    const s3 = still(false), s1 = still(true);
    const over = (a, b) => (a / b - 1) * 100;

    // The envelope first: it is the one that is the sword.
    assert(Math.abs(over(s1.far, s3.far)) < 5,
      `the blade reaches ${s1.far.toFixed(2)} m from the chest in first person against ${s3.far.toFixed(2)} in third — `
      + `${over(s1.far, s3.far).toFixed(1)}%, and one anchor is supposed to be one weapon`);
    assert(Math.abs(over(s1.horiz, s3.horiz)) < 5,
      `on the ground plane the tip reaches ${s1.horiz.toFixed(2)} m from the feet in first person against `
      + `${s3.horiz.toFixed(2)} in third — ${over(s1.horiz, s3.horiz).toFixed(1)}% of reach for changing the camera`);
    assert(Math.abs(over(w1, w3)) < 5,
      `swept through its travel the tip reaches ${w1.toFixed(2)} m in first person against ${w3.toFixed(2)} in third — `
      + `${over(w1, w3).toFixed(1)}%`);
    // The resting pose is allowed to differ a little — READY_GUARD is per view
    // by design and the eye carries its own 7 cm forward set — but not by the
    // 28% that used to stand here.
    assert(Math.abs(over(r1.far, r3.far)) < 8,
      `at rest the blade sits ${r1.far.toFixed(2)} m from the chest in first person against ${r3.far.toFixed(2)} in third — `
      + `${over(r1.far, r3.far).toFixed(1)}%; the ready guards differ per view, this much is not a ready guard`);

    return `one anchor: envelope ${s3.far.toFixed(2)}/${s1.far.toFixed(2)} m from the chest `
      + `(${over(s1.far, s3.far).toFixed(1)}%), ${s3.horiz.toFixed(2)}/${s1.horiz.toFixed(2)} m from the feet `
      + `(${over(s1.horiz, s3.horiz).toFixed(1)}%), swept ${w3.toFixed(2)}/${w1.toFixed(2)} `
      + `(${over(w1, w3).toFixed(1)}%), at rest ${r3.far.toFixed(2)}/${r1.far.toFixed(2)} `
      + `(${over(r1.far, r3.far).toFixed(1)}%)`;
  });
}
