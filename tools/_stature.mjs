/**
 * DOES THE SMALL SPECIES HOLD ITS OWN SABER? — the measurement behind note #2.
 *
 * "the yoda species character, the saber floats above their hands, and both
 *  arms are in the air. Also their clothes are oversized."
 *
 * Three claims in one sentence and they are three different systems, so this
 * counts them separately rather than eyeballing a screenshot. Every number is
 * printed beside the human's, because a defect here is a DIVERGENCE between the
 * two frames and not a magnitude — a small character is supposed to have small
 * numbers.
 *
 * ── WHAT THE FIRST CUT MEASURED, AND WHY IT WAS THE WRONG QUANTITY ─────────
 *
 * It read the distance from the hilt's origin to the hand BONE's origin, and
 * got 0.073 m for a human. That is not a fault in the human — it is very nearly
 * |GRIP_BORE| (0.072 m), the offset from the wrist joint to the hole a closed
 * fist makes. A correct grip reads it too. So the instrument's zero was not
 * zero, its units were "metres of somebody else's arm", and its verdict had to
 * be rescued afterwards by dividing by body height.
 *
 * Every quantity below is instead **scale-free by construction**: a ratio of two
 * lengths that both belong to the figure being measured. A correct grip reads 0
 * on a 1.78 m human and 0 on a 0.66 m one, and no normalisation is applied
 * anywhere. That matters because the fix has to be verified on BOTH frames and
 * a human-relative yardstick cannot do it.
 *
 *   BORE GAP   distance from the point on the hilt's axis the fist closes on
 *              (`GRIP_AT.R`) to where that figure's fist actually has its hole
 *              (`GRIP_BORE`, scaled to the rig), in units of its own hand.
 *              0 = the hilt is in the hand. 1 = a whole hand's length of
 *              daylight between the palm and the metal.
 *   DEMAND     |hand target − shoulder| / (upper arm + forearm). Above 1.0 the
 *              two-bone IK is being asked for a point outside the arm's own
 *              reach and CANNOT arrive: the arm straightens, points at the
 *              target, and stops short. This separates "the grip model is
 *              wrong" from "the arm cannot get there", which are two different
 *              repairs and the note's first two claims respectively.
 *   ARM UP     the hand's height above its own shoulder, in degrees. Sampled as
 *              a MAX over each pose, not read off an idle frame — "both arms in
 *              the air" is a claim about the game being played.
 *   HILT/HAND  the hilt's own length in units of the hand holding it. A hilt is
 *              a real object and does not shrink to nothing, but a 0.24 m bar
 *              in a 0.04 m fist is a quarterstaff. The reference plate
 *              (assets/reference/units/heroes/yoda.jpg) shows a SHOTO: the
 *              visible metal is about one fist above the hand and half a fist
 *              below it.
 *   GARMENT    the cloak's and skirt's own span against the shoulders that carry
 *              them. Again a ratio, again within one figure.
 *
 *   node --import ./tools/register.mjs tools/_stature.mjs
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { SPECIES } from '../src/game/Bodies.js';
import { GRIP_AT, GRIP_BORE } from '../src/game/Player.js';

/* The small species is found by its own frame rather than by a hard-coded id,
 * because a name-based lookup here is the hand-maintained table beside its
 * generated twin that HANDOFF 2.3 is about. The shortest stature in the table
 * is the one the note is about, by construction. */
const small = [...SPECIES].sort(
  (a, b) => (a.frame?.stature ?? 9) - (b.frame?.stature ?? 9))[0];
const human = SPECIES.find((s) => Math.abs((s.frame?.stature ?? 1.78) - 1.78) < 0.06)
  ?? SPECIES.find((s) => !s.frame?.stature) ?? SPECIES[0];

const v = () => new THREE.Vector3();

/**
 * THE POSES, AS THINGS A PLAYER DOES — driven through the real input path.
 *
 * The first cut of this probe measured one idle frame and reported "arms up:
 * ok", which is not an answer to a claim about a game being played. Each entry
 * writes the same `input` object the engine hands `Player._readInput`, so the
 * blade goes where the shipped controller puts it and nothing here restates a
 * rule (HANDOFF 2.4).
 *
 * `blade` raises a guard under the shipped 'directional' scheme; the mouse
 * picks WHICH guard, so a sustained push up is the HIGH zone and a sustained
 * push sideways is a lateral one. Those are the two poses that carry the hand
 * highest, which is what the "arms in the air" claim is about.
 */
const POSES = {
  idle: () => ({}),
  walk: () => ({ axis: { x: 0, y: 1 } }),
  'guard high': () => ({ act: ['blade'], mouse: { dx: 0, dy: -70 } }),
  'guard side': () => ({ act: ['blade'], mouse: { dx: 70, dy: 0 } }),
  thrust: () => ({ act: ['thrust'] }),
};

function poseInput(spec) {
  const base = idleInput();
  const acts = new Set(spec.act || []);
  return {
    ...base,
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

/* ── one figure, one pose ──────────────────────────────────────────────── */

/**
 * `rig.bones` is a Map of RECORDS — `bones.handR` is undefined, `bones.get`
 * returns a record whose Object3D is `.obj` and whose `.length` is already in
 * world metres (Rig bakes the scale into the bone defs and leaves every
 * Object3D at scale 1, which is exactly why a hand-space constant like
 * GRIP_BORE cannot be applied through `localToWorld` unscaled).
 */
const boneOf = (rig, n) => rig.bones?.get?.(n) ?? null;
const objOf = (rig, n) => boneOf(rig, n)?.obj ?? null;

function sample(p, out) {
  const rig = p.rig;
  const armB = boneOf(rig, 'armR'), foreB = boneOf(rig, 'foreR'), handB = boneOf(rig, 'handR');
  if (!armB || !foreB || !handB) return;
  const armLen = armB.length + foreB.length;
  const handLen = handB.length;

  const shoulder = objOf(rig, 'armR').getWorldPosition(v());
  const hand = handB.obj.getWorldPosition(v());
  const shoulderL = objOf(rig, 'armL')?.getWorldPosition(v());
  const handL = objOf(rig, 'handL')?.getWorldPosition(v());

  /* WHERE THE FIST ACTUALLY HAS ITS HOLE. `GRIP_BORE` is authored in hand space
   * "at the scale buildHand is called with here", i.e. 1 — and the bone objects
   * carry no scale of their own, so on a 0.40 rig the bore is 0.40 of the way
   * out. Reading it unscaled is the same class of instrument fault as the three
   * this probe already carries a note about. */
  const bore = handB.obj.localToWorld(
    _bore.copy(GRIP_BORE).multiplyScalar(rig.scale ?? 1));

  /* THE GRIP POINT, not the hilt's origin: a lit hilt is a metre-long object
   * whose origin is at the pommel, so a distance to the origin reports the
   * hilt's own length as a float on every frame. */
  const gripPt = p.saber.root.localToWorld(_grip.set(0, GRIP_AT.R, 0));

  const boreGap = gripPt.distanceTo(bore);
  out.boreGap = Math.max(out.boreGap, boreGap / handLen);

  /* WHAT THE ARM WAS ASKED FOR. `_handTarget` is SaberController's own answer,
   * published rather than recomputed here. Above 1.0 the arm cannot arrive. */
  const want = p.control?._handTarget;
  if (want) out.demand = Math.max(out.demand, want.distanceTo(shoulder) / armLen);

  const ang = (h, s) => {
    const d = h.clone().sub(s);
    return Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180 / Math.PI;
  };
  out.armR = Math.max(out.armR, ang(hand, shoulder));
  if (handL && shoulderL) out.armL = Math.max(out.armL, ang(handL, shoulderL));

  out.handLen = handLen;
  out.armLen = armLen;
}

const _bore = new THREE.Vector3(), _grip = new THREE.Vector3();

/**
 * EVERYTHING THE FIGURE IS WEARING, and WHERE IT FALLS ON THE BODY.
 *
 * Cloth is NOT under `rig.root` — `attachCloak`/`attachSkirt` do
 * `scene.add(this.mesh)`, which is why the first cut of this probe traversed
 * the rig, then the player's group, and printed a dash for every frame. The
 * garments are fields on the Player, so ask the Player.
 *
 * The quantity is HEM CLEARANCE — how far the lowest cloth vertex sits above
 * the figure's own feet, as a fraction of the figure's own height — and not the
 * garment's authored length. "Oversized" is a claim about proportion, and the
 * authored length can be scaled perfectly and still produce a robe that pools
 * on the floor: a species may scale its LEGS differently from its body
 * (`smallfolk` is `scale: 0.40` with `legLen: 0.80`), and a hem measured from
 * the waist lands wherever those two disagree. Across all fourteen reference
 * plates the hem clears the ground and the boots read beneath it; the one
 * silhouette none of them has is cloth on the floor.
 *
 * `width` is deliberately not reported: for a `closed` garment the Cloak
 * constructor's `width` is never read — the ring is built from `profile` and
 * the waistband — so the 0.62 default it carries is not a measurement of
 * anything, and reporting it as one is the kind of plausible-looking number
 * HANDOFF 2.3 is about.
 */
function garments(p, floorY, height) {
  const out = [];
  for (const [name, g] of [['cloak', p.cloak], ['skirt', p.skirt]]) {
    if (!g?.mesh) continue;
    g.mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g.mesh);
    out.push({
      name,
      length: g.length ?? NaN,
      /* Above the feet, in units of the wearer. */
      hem: (b.min.y - floorY) / height,
      /* The widest the garment gets, against the same body height, so a robe
       * that is scaled short but still cut for a wider torso shows up. */
      girth: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / height,
    });
  }
  return out;
}

async function measure(species) {
  /* SPECIES GOES THROUGH `settings`, and getting that wrong is what the first
   * cut of this probe did: `_coop.mjs` has no `player` option at all, so
   * `{ player: { species } }` was silently dropped and BOTH frames measured
   * 1.69 m and an identical grip. A probe that reports "no difference" where
   * the player reports one is a broken instrument, not an acquittal
   * (HANDOFF 2.5). `World.js:511` reads `species: this.settings.species`. */
  const { world } = await bootWorld({
    level: 'colosseum',
    settings: { mode: 'waves', difficulty: 'knight', species: species.id },
  });
  const p = world.player;
  p.saber && (p.saber.lit = true);

  const poses = {};
  for (const [name, mk] of Object.entries(POSES)) {
    const input = poseInput(mk());
    const out = { boreGap: 0, demand: 0, armR: -180, armL: -180, handLen: NaN, armLen: NaN };
    /* Settle first, then sample. A spring-driven hand needs the pose to arrive
     * before the pose is a measurement of anything; 40 frames of settle against
     * 50 of sampling was chosen by watching `demand` stop moving. */
    for (let i = 0; i < 90; i++) {
      world.update(1 / 60, input);
      if (i >= 40) { world.scene.updateMatrixWorld(true); sample(p, out); }
    }
    poses[name] = out;
  }

  world.scene.updateMatrixWorld(true);
  const rig = p.rig;
  const whole = new THREE.Box3().setFromObject(rig.root);
  const height = whole.max.y - whole.min.y;

  /* THE SHOULDER SPAN, as the body measurement a garment is cut against. Not
   * the torso mesh's bounding box: a robe is hung from the shoulders and the
   * span between the two clavicle tips is the number a tailor would use. */
  const cl = objOf(rig, 'clavL'), cr = objOf(rig, 'clavR');
  const span = cl && cr ? cl.getWorldPosition(v()).distanceTo(cr.getWorldPosition(v())) : NaN;

  const g = garments(p, whole.min.y, height);
  const hiltBox = p.saber?.hilt ? new THREE.Box3().setFromObject(p.saber.hilt) : null;
  const hiltLen = hiltBox ? Math.max(hiltBox.max.y - hiltBox.min.y,
    hiltBox.max.x - hiltBox.min.x, hiltBox.max.z - hiltBox.min.z) : NaN;

  const r = {
    height, span, poses, garments: g, hiltLen,
    handLen: poses.idle.handLen, armLen: poses.idle.armLen,
    rigScale: rig.scale, stature: p.stature,
  };
  world.unload();
  return r;
}

/* ── report ────────────────────────────────────────────────────────────── */

console.log(`\n  small species: ${small.id ?? small.name}  stature ${small.frame?.stature ?? '—'} m`);
console.log(`  human  species: ${human.id ?? human.name}  stature ${human.frame?.stature ?? '1.78 (default)'} m\n`);

const rows = [];
for (const s of [human, small]) rows.push([s.id ?? s.name, await measure(s)]);

const pad = (x, n) => String(x).padStart(n);
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

console.log('  species        height   hand    arm    hilt/hand');
for (const [id, m] of rows) {
  console.log(`  ${String(id).padEnd(13)}${pad(f(m.height), 5)} m`
    + `${pad(f(m.handLen, 3), 8)}${pad(f(m.armLen, 3), 8)}`
    + `${pad(f(m.hiltLen / m.handLen, 2), 10)}`);
}

console.log('\n  PER POSE — bore gap in hands, demand as a fraction of arm reach,');
console.log('  arm/off-arm as the highest either hand got above its own shoulder.\n');
console.log('  pose          ' + rows.map(([id]) => String(id).padEnd(26)).join(''));
console.log('                ' + rows.map(() => 'bore  demand   armR   armL  ').join(''));
for (const name of Object.keys(POSES)) {
  let line = '  ' + name.padEnd(14);
  for (const [, m] of rows) {
    const q = m.poses[name];
    line += pad(f(q.boreGap, 2), 4) + pad(f(q.demand, 2), 8)
      + pad(f(q.armR, 0) + '°', 7) + pad(f(q.armL, 0) + '°', 7) + '  ';
  }
  console.log(line);
}

console.log('\n  GARMENTS — authored length, then where the hem falls and how wide it gets,');
console.log('  both in units of the wearer\'s own height.\n');
console.log('  species        garment   length   hem above feet   girth');
for (const [id, m] of rows) {
  if (!m.garments.length) { console.log(`  ${String(id).padEnd(13)}  — none found —`); continue; }
  for (const g of m.garments) {
    console.log(`  ${String(id).padEnd(13)}  ${g.name.padEnd(8)}${pad(f(g.length, 3), 7)}`
      + `${pad(f(g.hem * 100, 1) + '%', 15)}${pad(f(g.girth * 100, 1) + '%', 10)}`);
  }
}

/* ── the verdicts ─────────────────────────────────────────────────────── */

const [[, H], [, S]] = rows;
console.log('\n  VERDICT (small vs human — every number below is scale-free):');

const worst = (m, k) => Math.max(...Object.values(m.poses).map((q) => q[k]));

/**
 * ONE HAND'S LENGTH OF DAYLIGHT IS THE BAR, and it is not arbitrary: the hand
 * bone is the fist, so a bore gap of 1 means the metal is a whole fist clear of
 * the hole it is supposed to be inside. Anything a viewer would call "held"
 * reads well under half of that. The human is printed beside it so the bar can
 * be read as a tolerance rather than a wish.
 */
const bh = worst(H, 'boreGap'), bs = worst(S, 'boreGap');
console.log(`    bore gap    human ${f(bh, 2)} hands   small ${f(bs, 2)} hands`
  + `   ${bs > bh + 0.35 ? '← FLOATS' : 'ok'}`);

const dh = worst(H, 'demand'), ds = worst(S, 'demand');
console.log(`    reach       human ${f(dh, 2)}×arm     small ${f(ds, 2)}×arm`
  + `     ${ds > 1.0 ? '← OUT OF REACH' : 'ok'}`);

const ah = worst(H, 'armR'), as = worst(S, 'armR');
const alh = worst(H, 'armL'), als = worst(S, 'armL');
console.log(`    arm above shoulder  human ${f(ah, 0)}°/${f(alh, 0)}°`
  + `   small ${f(as, 0)}°/${f(als, 0)}°`
  + `   ${(as > ah + 12 && als > alh + 12) ? '← BOTH ARMS UP' : as > ah + 12 ? '← SWORD ARM UP' : 'ok'}`);

/**
 * A HEM THAT CLEARS THE FOOT BY LESS THAN HALF WHAT THE HUMAN'S DOES is a robe
 * the wearer is standing in. The bar is relative to the shipped human on
 * purpose — the temple robe IS the garment, so the question is never "is 15%
 * right" but "does this species wear the same robe the same way".
 */
const gr = (m, n) => m.garments.find((x) => x.name === n) ?? null;
for (const n of ['cloak', 'skirt']) {
  const a = gr(H, n), b = gr(S, n);
  if (!a || !b) continue;
  console.log(`    ${n.padEnd(11)} hem  human ${f(a.hem * 100, 1)}%  small ${f(b.hem * 100, 1)}%`
    + `   girth  human ${f(a.girth * 100, 1)}%  small ${f(b.girth * 100, 1)}%`
    + `   ${b.hem < a.hem * 0.5 || b.girth > a.girth * 1.2 ? '← OVERSIZED' : 'ok'}`);
}

const hh = H.hiltLen / H.handLen, hs = S.hiltLen / S.handLen;
console.log(`    hilt/hand   human ${f(hh, 1)}×hand    small ${f(hs, 1)}×hand`
  + `    ${hs > hh * 1.5 ? '← A QUARTERSTAFF' : 'ok'}`);
console.log('');
