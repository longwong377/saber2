/**
 * BATTLEFRONT BORZ — a figure that is not 1.78 m tall.
 *
 * Player note #2: "the yoda species character, the saber floats above their
 * hands, and both arms are in the air. Also their clothes are oversized."
 *
 * Three claims, three systems, one cause. A species `frame` carries FOUR
 * scales, not one — `smallfolk` is `scale: 0.40` with `armLen: 1.06` and
 * `legLen: 0.80`, which puts its torso, its arms, its legs and the height of
 * its chest at four different fractions of a human's — and every length
 * authored in metres anywhere else in the game was multiplied by at most one of
 * them. Four separate constants were wrong and each one alone reproduces the
 * player's report:
 *
 *   GRIP_BORE      a hand-space offset applied to bone Object3Ds that carry no
 *                  scale, so the arm held its wrist 72 mm back from the hilt's
 *                  axis on a fist 40 mm long — 43 mm of hilt outside the hand.
 *   the guard      SaberController's `handExtend`/`guardR`/`offset` are chest-
 *                  to-hand distances in a human's metres. The hand target sat
 *                  1.35 times the arm's whole reach from the shoulder, so the
 *                  two-bone IK could not arrive: it straightened the arm,
 *                  pointed it at the target and stopped short. Under a raised
 *                  guard that target is above the small figure's own head,
 *                  which is why BOTH arms went up.
 *   CHEST_H        multiplied by `stature`, a fraction of total HEIGHT. Short
 *                  legs under an ordinary torso carry the chest lower than
 *                  total height implies, so the whole guard was solved from
 *                  4 cm too high on a figure whose arm is 23 cm long.
 *   garment length scaled by the body, when a hem is measured down a LEG. The
 *                  robe ended 2.9% of the figure's height off the floor.
 *
 * ── WHY EVERY BOUND HERE IS RELATIVE ──────────────────────────────────────
 *
 * A small character is supposed to have small numbers, so a defect is a
 * DIVERGENCE between two frames and never a magnitude. Every quantity below is
 * a ratio of two lengths belonging to the SAME figure — a gap in units of its
 * own hand, a reach in units of its own arm, a hem in units of its own height —
 * so a correct figure reads the same at any size and the human's own reading is
 * the tolerance rather than a wish.
 *
 * The first instrument written for this note did not do that. It measured the
 * hilt's origin against the hand bone's origin and read 0.073 m on a HUMAN,
 * which is not a fault: it is |GRIP_BORE|, the distance from a wrist joint to
 * the hole a closed fist makes. Its zero was not zero, and on one idle frame it
 * acquitted the "both arms in the air" claim outright. Hence two rules kept
 * here: the human is measured beside every subject, and every pose claim is
 * sampled across poses a player can actually be in.
 *
 * These run over `SPECIES` rather than over a list of names, so a species added
 * tomorrow is covered without anyone remembering this file exists.
 */

import * as THREE from 'three';
import { buildJedi, SPECIES } from '../../src/game/Bodies.js';
import { BipedAnimator, limbScale, REF_ARM, REF_LEG, REF_CHEST } from '../../src/game/Rig.js';
import { attachCloak, attachSkirt } from '../../src/game/Cloth.js';
import { Saber } from '../../src/game/Saber.js';
import { GRIP_AT, GRIP_BORE } from '../../src/game/Player.js';
import { bootWorld, idleInput } from './_coop.mjs';

const v = () => new THREE.Vector3();

/** The species this note is about, found by its own frame and not by its id. */
const smallest = () => [...SPECIES].sort(
  (a, b) => (a.frame?.stature ?? 9) - (b.frame?.stature ?? 9))[0];
const humanSpecies = () => SPECIES.find((s) => !s.frame) ?? SPECIES[0];

/* ── the standing bench: a body, dressed, without a World ───────────────── */

/**
 * A figure of a given species, dressed the way `Player._makeCloak` dresses one,
 * settled on its feet.
 *
 * The garments are attached through the SHIPPED entry points with the shipped
 * options, so this measures the game's own wardrobe rather than a second one
 * written to agree with it (HANDOFF 2.4). Only `scale` is supplied, exactly as
 * Player supplies it.
 */
function dressed(species) {
  const built = buildJedi({ species: species.id });
  const rig = built.rig;
  const S = rig.scale ?? 1;
  const anim = new BipedAnimator(rig, { scale: S, hipHeight: 0.95 });
  anim.setFacing(0);
  const scene = new THREE.Scene();
  const cloak = attachCloak(scene, rig, {
    scale: S, width: 0.36, length: 0.86, cols: 9, rows: 11, flare: 1.0,
  });
  const skirt = built.robeSkirt
    ? attachSkirt(scene, rig, { scale: S, rigid: built.robeSkirt, seed: 4242 }) : null;
  if (skirt) cloak.outer = skirt;

  const pos = v(), vel = v(), wind = v();
  for (let i = 0; i < 150; i++) {
    anim.update(1 / 60, {
      position: pos, facing: 0, velocity: vel, grounded: true,
      groundAt: () => 0, crouch: 0, accelForward: 0, accelStrafe: 0,
    });
    rig.updateMatrices();
    if (skirt) skirt.update(1 / 60, skirt.refreshColliders(), wind);
    cloak.update(1 / 60, cloak.refreshColliders(), wind);
  }
  rig.root.updateMatrixWorld(true);
  const body = new THREE.Box3().setFromObject(rig.root);
  const height = body.max.y - body.min.y;
  const hem = (g) => {
    if (!g?.mesh) return NaN;
    g.mesh.updateMatrixWorld(true);
    return (new THREE.Box3().setFromObject(g.mesh).min.y - body.min.y) / height;
  };
  const out = { rig, height, cloakHem: hem(cloak), skirtHem: hem(skirt), limbs: limbScale(rig) };
  cloak.dispose(); skirt?.dispose();
  return out;
}

/* ── the live bench: a real World, a real controller, real poses ─────────── */

/**
 * The poses are driven through the input path the engine uses, so the blade
 * goes where the shipped controller puts it. `blade` raises a guard under the
 * shipped 'directional' scheme and the mouse picks which one, so a sustained
 * push up is the HIGH zone — the pose that carries the hands highest, and
 * therefore the one the "both arms in the air" claim is about.
 */
const POSES = {
  idle: {},
  walk: { axis: { x: 0, y: 1 } },
  'guard high': { act: ['blade'], mouse: { dx: 0, dy: -70 } },
  'guard side': { act: ['blade'], mouse: { dx: 70, dy: 0 } },
};

function poseInput(spec) {
  const acts = new Set(spec.act || []);
  return {
    ...idleInput(),
    act: (n) => acts.has(n),
    actHit: () => false,
    actDown: (n) => acts.has(n),
    moveAxis: (o) => {
      const a = spec.axis || { x: 0, y: 0 };
      if (o) { o.x = a.x; o.y = a.y; return o; }
      return { x: a.x, y: a.y };
    },
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false, ...(spec.mouse || {}) },
  };
}

async function wield(species) {
  const { world } = await bootWorld({
    level: 'colosseum',
    settings: { mode: 'waves', difficulty: 'knight', species: species.id },
  });
  const p = world.player;
  if (p.saber) p.saber.lit = true;
  const rig = p.rig;
  const bone = (n) => rig.bones.get(n);
  const armLen = bone('armR').length + bone('foreR').length;
  const handLen = bone('handR').length;
  const out = { armLen, handLen, poses: {}, hilt: NaN, species: species.id };

  const g1 = v(), g2 = v();
  for (const [name, spec] of Object.entries(POSES)) {
    const input = poseInput(spec);
    const q = { bore: 0, demand: 0, armR: -180, armL: -180 };
    for (let i = 0; i < 90; i++) {
      world.update(1 / 60, input);
      if (i < 40) continue;
      world.scene.updateMatrixWorld(true);
      const shoulder = bone('armR').obj.getWorldPosition(v());
      const hand = bone('handR').obj.getWorldPosition(v());
      /* WHERE THIS FIGURE'S FIST ACTUALLY HAS ITS HOLE. `Rig` bakes the scale
       * into the bone lengths and leaves every Object3D at 1, so a hand-space
       * constant has to be scaled by hand — which is the whole of defect one. */
      const bore = bone('handR').obj.localToWorld(
        g1.copy(GRIP_BORE).multiplyScalar(rig.scale ?? 1));
      const gs = p.saber.gripScale ?? 1;
      const grip = p.saber.root.localToWorld(g2.set(0, GRIP_AT.R * gs, 0));
      q.bore = Math.max(q.bore, grip.distanceTo(bore) / handLen);
      if (p.control._handTarget) {
        q.demand = Math.max(q.demand, p.control._handTarget.distanceTo(shoulder) / armLen);
      }
      const ang = (h, s) => {
        const d = h.clone().sub(s);
        return Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180 / Math.PI;
      };
      q.armR = Math.max(q.armR, ang(hand, shoulder));
      const hl = bone('handL')?.obj.getWorldPosition(v());
      const sl = bone('armL')?.obj.getWorldPosition(v());
      if (hl && sl) q.armL = Math.max(q.armL, ang(hl, sl));
    }
    out.poses[name] = q;
  }
  const hb = new THREE.Box3().setFromObject(p.saber.hilt);
  out.hilt = Math.max(hb.max.x - hb.min.x, hb.max.y - hb.min.y, hb.max.z - hb.min.z);
  world.unload();
  return out;
}

/** Booted twice at most, and shared by every check that needs it. */
let _live = null;
const live = () => (_live ||= (async () => ({
  human: await wield(humanSpecies()),
  small: await wield(smallest()),
}))());

const worst = (r, k) => Math.max(...Object.values(r.poses).map((q) => q[k]));

/* ══════════════════════════════════════════════════════════════════════ */

export function run({ check, assert }) {
  check('stature: a figure is measured off its own bones, and the reference reads exactly 1', () => {
    /* The four scales are DERIVED from `humanoidSkeleton` rather than typed
     * beside it, which is the only thing that keeps a bone-length change from
     * leaving a stale copy behind (HANDOFF 2.3). This asserts the derivation is
     * an identity on the figure it is derived from — if it ever is not, every
     * length in the game silently moves on every species at once. */
    assert(REF_ARM > 0 && REF_LEG > 0 && REF_CHEST > 0,
      `the reference spans are not positive: arm ${REF_ARM}, leg ${REF_LEG}, chest ${REF_CHEST}`);

    const rows = [];
    let anyScaled = false;
    for (const sp of SPECIES) {
      const L = limbScale(buildJedi({ species: sp.id }).rig);
      for (const [k, x] of Object.entries(L)) {
        assert(Number.isFinite(x) && x > 0.05 && x < 20,
          `${sp.id}'s ${k} scale is ${x} — a lookup that returned nothing reads as a measurement of zero`);
      }
      /* A species with no `frame` IS the reference figure, so all four must be
       * exactly 1 — not near 1. This is what says the fix cannot move a human
       * by a bit, and it is the tripwire that lets every other bound below be
       * stated against the human's own reading. */
      if (!sp.frame) {
        for (const [k, x] of Object.entries(L)) {
          assert(x === 1, `${sp.id} declares no frame but its ${k} scale is ${x}, not exactly 1`);
        }
      }
      /* The mechanism is only tested if some species actually exercises it: a
       * table in which every row is 1 would pass everything below while the
       * four scales did nothing at all. */
      if (new Set(Object.values(L).map((x) => x.toFixed(4))).size > 1) anyScaled = true;
      rows.push(`${sp.id} ${L.torso.toFixed(2)}/${L.arm.toFixed(2)}/${L.leg.toFixed(2)}/${L.stand.toFixed(2)}`);
    }
    assert(anyScaled,
      'no species in the table scales its torso, arms and legs differently — '
      + 'the four-scale machinery is untested by its own roster');
    return `torso/arm/leg/stand — ${rows.join(', ')}`;
  });

  check('stature: no species stands in its own robe', () => {
    /* THE HEM IS MEASURED DOWN A LEG, and a species may scale its legs apart
     * from its body — which is exactly what `legLen: 0.80` is. Before this the
     * small frame's skirt ended 2.9% of its own height off the floor against a
     * human's 13.0%: cloth on the ground, which is what "their clothes are
     * oversized" looks like. None of the fourteen reference plates in
     * assets/reference/units/heroes has a hem on the floor — Yoda's robe pools
     * a little and both feet are still clear of it.
     *
     * The bar is 0.6 of the human's rather than an absolute height, because the
     * temple robe IS the garment: the question is never "is 13% right", it is
     * "does this species wear the same robe the same way". */
    const H = dressed(humanSpecies());
    const rows = [];
    for (const sp of SPECIES) {
      const D = sp === humanSpecies() ? H : dressed(sp);
      for (const [name, hem, ref] of [['cloak', D.cloakHem, H.cloakHem],
        ['skirt', D.skirtHem, H.skirtHem]]) {
        if (!Number.isFinite(hem) || !Number.isFinite(ref)) continue;
        assert(hem > ref * 0.6,
          `${sp.id}'s ${name} hem clears its own feet by ${(hem * 100).toFixed(1)}% of its height, `
          + `against ${(ref * 100).toFixed(1)}% for a human — it is standing in its own robe`);
      }
      rows.push(`${sp.id} ${(D.cloakHem * 100).toFixed(0)}/${(D.skirtHem * 100).toFixed(0)}%`);
    }
    return `cloak/skirt hem above the wearer's own feet, as % of its height — ${rows.join(', ')}`;
  });

  check('stature: a hilt is sized by the hand that holds it', () => {
    /* The hilt is the one part of a figure `Bodies.js` does not build, and
     * therefore the one part that never took a species scale: 6.10 hands long
     * on the small frame against 2.44 on a human — a quarterstaff. It is also
     * why the arms sat high after the guard itself was fixed, because GRIP_AT
     * is a HILT-local offset and pushes the fist up a blade that points upward.
     *
     * The bound is against the human's own proportion and not against a length
     * in millimetres, because that is what the reference plates hold constant:
     * Yoda's shoto and Obi-Wan's Graflex are the same size in their own hands. */
    const rows = [];
    let ref = NaN;
    for (const sp of SPECIES) {
      const rig = buildJedi({ species: sp.id }).rig;
      const scene = new THREE.Scene();
      const s = new Saber(scene, { colorIndex: 0, hiltStyle: 'Graflex' });
      s.setGripScale?.(limbScale(rig).torso);
      s.root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(s.hilt);
      const len = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
      const hands = len / rig.get('handR').length;
      s.dispose();
      if (!sp.frame) ref = hands;
      rows.push(`${sp.id} ${hands.toFixed(2)}`);
      assert(hands > 0.5 && hands < 12,
        `${sp.id} carries a hilt ${hands.toFixed(2)} of its own hands long`);
    }
    assert(Number.isFinite(ref), 'no unframed species to measure a human hilt against');
    for (const sp of SPECIES) {
      const rig = buildJedi({ species: sp.id }).rig;
      const scene = new THREE.Scene();
      const s = new Saber(scene, { colorIndex: 0, hiltStyle: 'Graflex' });
      s.setGripScale?.(limbScale(rig).torso);
      s.root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(s.hilt);
      const hands = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z)
        / rig.get('handR').length;
      s.dispose();
      assert(hands < ref * 1.5,
        `${sp.id} holds a hilt ${hands.toFixed(2)} of its own hands long against a human's `
        + `${ref.toFixed(2)} — the hilt did not take the species scale`);
    }
    return `hilt length in the wearer's own hands — ${rows.join(', ')}`;
  });

  check('stature: the fist closes on the hilt, whatever size the fist is', async () => {
    /* BORE GAP: from the point on the hilt's axis the fist closes on to where
     * that figure's fist actually has its hole, in units of its own hand. Zero
     * is a grip; 1 is a whole fist of daylight between the palm and the metal.
     * Measured before the fix: human 0.00, small frame 2.42. The bar is a third
     * of a hand — well inside anything a viewer would call held, and far enough
     * above the human's exact zero that floating-point noise cannot trip it. */
    const { human, small } = await live();
    const rows = [];
    for (const r of [human, small]) {
      const b = worst(r, 'bore');
      rows.push(`${r.species} ${b.toFixed(2)}`);
      assert(b < 0.35,
        `${r.species} holds its hilt ${b.toFixed(2)} of its own hands clear of its palm `
        + '— the saber is floating beside the hand, not in it');
    }
    return `worst bore gap over ${Object.keys(POSES).length} poses, in the figure's own hands — ${rows.join(', ')}`;
  });

  check('stature: nobody is asked to reach past the end of their own arm', async () => {
    /* `demand` is the hand target's distance from the shoulder in units of the
     * arm's own reach. Above 1 the two-bone IK cannot arrive AT ALL — it
     * straightens the arm, points it at the target and stops short — so this is
     * the assertion that separates "the grip model is wrong" from "the arm
     * cannot get there". The small frame read 1.35 before the fix.
     *
     * 0.95 rather than 1.0: an arm locked dead straight is not a pose, and the
     * bar has to fail before the IK starts silently absorbing the error. */
    const { human, small } = await live();
    const rows = [];
    for (const r of [human, small]) {
      const d = worst(r, 'demand');
      rows.push(`${r.species} ${d.toFixed(2)}`);
      assert(d < 0.95,
        `${r.species}'s guard is solved ${d.toFixed(2)} of its own arm's reach from its shoulder `
        + '— the arm cannot get there and the hilt hangs in the gap');
    }
    return `worst hand target, in the figure's own arm-lengths — ${rows.join(', ')}`;
  });

  check('stature: no species holds its arms higher than a human holds theirs', async () => {
    /* "BOTH ARMS IN THE AIR", as an angle, sampled across poses a player can be
     * in and not off one idle frame — measuring the idle pose is what let the
     * first pass at this note report the claim absent. Before the fix the small
     * frame's sword arm reached 68° above its own shoulder under a raised guard
     * and its OFF arm 47°, against a human's 40° and 19°.
     *
     * The human's own reading is the bar because a guard IS carried above the
     * shoulder — the claim was never that an arm goes up, it is that BOTH do
     * and stay there. 12° of headroom is a little under the 15° the two frames'
     * clavicle rest directions can differ by on their own. */
    const { human, small } = await live();
    const rows = [`human ${worst(human, 'armR').toFixed(0)}/${worst(human, 'armL').toFixed(0)}`];
    for (const [side, key] of [['sword', 'armR'], ['off', 'armL']]) {
      const h = worst(human, key), s = worst(small, key);
      assert(s < h + 12,
        `${small.species}'s ${side} arm reaches ${s.toFixed(0)}° above its own shoulder `
        + `against a human's ${h.toFixed(0)}° — its arms are in the air`);
    }
    rows.push(`${small.species} ${worst(small, 'armR').toFixed(0)}/${worst(small, 'armL').toFixed(0)}`);
    return `highest the sword/off hand gets above its own shoulder — ${rows.join(', ')}`;
  });
}
