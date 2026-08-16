/**
 * DOES THE SMALL SPECIES HOLD ITS OWN SABER? — the measurement behind note #2.
 *
 * "the yoda species character, the saber floats above their hands, and both
 *  arms are in the air. Also their clothes are oversized."
 *
 * Three claims in one sentence and they are three different systems, so this
 * counts them separately rather than eyeballing a screenshot:
 *
 *   FLOAT    — distance from the hilt's grip point to the nearer hand. On a
 *              human this is the thing the two-bone IK solves to, so whatever
 *              it reads for a human IS the tolerance; the question is only
 *              whether the small frame reads the same.
 *   ARMS UP  — the hand's height relative to its own shoulder. "Both arms in
 *              the air" is a POSE claim, and the honest way to state it is as
 *              an angle above the shoulder line, compared against the same
 *              number for a human in the same stance.
 *   GARMENT  — the cloak/skirt's width against the torso's. "Oversized" means
 *              the garment did not take the species scale that the body did,
 *              so the tell is a RATIO that differs between the two frames.
 *
 * Every number is printed beside the human's so the report cannot be read as
 * "small character has small numbers". A defect here is a DIVERGENCE between
 * the two frames, not a magnitude.
 *
 *   node --import ./tools/register.mjs tools/_stature.mjs
 */
import './dom-shim.mjs';
import * as THREE from 'three';
import { bootWorld, idleInput } from './checks/_coop.mjs';
import { SPECIES } from '../src/game/Bodies.js';

/* The small species is found by its own frame rather than by a hard-coded id,
 * because a name-based lookup here is the hand-maintained table beside its
 * generated twin that HANDOFF 2.3 is about. The shortest stature in the table
 * is the one the note is about, by construction. */
const small = [...SPECIES].sort(
  (a, b) => (a.frame?.stature ?? 9) - (b.frame?.stature ?? 9))[0];
const human = SPECIES.find((s) => Math.abs((s.frame?.stature ?? 1.78) - 1.78) < 0.06)
  ?? SPECIES.find((s) => !s.frame?.stature) ?? SPECIES[0];

console.log(`\n  small species: ${small.id ?? small.name}  stature ${small.frame?.stature ?? '—'} m`);
console.log(`  human  species: ${human.id ?? human.name}  stature ${human.frame?.stature ?? '1.78 (default)'} m\n`);

const v = () => new THREE.Vector3();

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
  for (let i = 0; i < 30; i++) world.update(1 / 60, idleInput());
  world.scene.updateMatrixWorld(true);

  /* Bones by their real names off `rig.bones` rather than by a substring walk.
   * The walk matched `handL` for a query of "handr" (lowercased, `includes`)
   * and found nothing at all for the shoulder, because this rig calls it
   * `clavR` — which is how the first run produced a NaN angle and read it as
   * "ok". */
  const rig = p.rig;
  /* `rig.bones` is a Map, not a plain object — `bones.handR` is undefined and
   * `bones.get('handR')` is the bone. That is the third instrument fault in
   * this one probe, and all three had the same shape: a lookup that returns
   * nothing, read as a measurement of zero.
   *
   * A bone here is a RECORD (name, length, offset, restQuat, hp, severed…) and
   * the Object3D is `.obj` — the record itself has no transform at all. */
  const bone = (n) => {
    const rec = rig.bones?.get?.(n) ?? rig.bones?.[n] ?? null;
    return rec?.obj ?? (rec?.getWorldPosition ? rec : null);
  };

  /* THE HILT'S GRIP POINT, not its origin. A hilt is a metre-long object when
   * lit and its origin is at the pommel, so measuring to the origin would
   * report a "float" on every frame that is really just the hilt's length. */
  const hiltObj = p.saber?.hilt ?? p.saber?.root ?? null;
  const handR = bone('handR'), handL = bone('handL');
  const shoulder = bone('clavR');

  const hiltP = hiltObj ? hiltObj.getWorldPosition(v()) : null;
  const handP = handR ? handR.getWorldPosition(v()) : null;
  const handLP = handL ? handL.getWorldPosition(v()) : null;
  const shP = shoulder ? shoulder.getWorldPosition(v()) : null;

  /* To the NEARER hand: the grip may be one- or two-handed and the note is
   * about the hilt not being in a hand at all, either way. */
  const float = hiltP && (handP || handLP)
    ? Math.min(handP ? hiltP.distanceTo(handP) : Infinity,
      handLP ? hiltP.distanceTo(handLP) : Infinity)
    : NaN;

  /* Height of the hand above its own shoulder, as an angle off horizontal.
   * Positive is "in the air". */
  let armAngle = NaN;
  if (handP && shP) {
    const d = handP.clone().sub(shP);
    armAngle = Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180 / Math.PI;
  }

  /* GARMENT vs TORSO. Both as world-space widths so the species scale is
   * already inside both numbers and the RATIO is what is comparable. */
  const box = (o) => (o ? new THREE.Box3().setFromObject(o) : null);
  let garW = 0, torsoW = 0;
  /* Garments are NOT under `rig.root` — cloth is parented on the player's own
   * group — so the first cut found none and printed a dash for every frame. */
  const dressRoot = p.group ?? p.root ?? rig.root;
  dressRoot.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const n = (o.name || '') + ' ' + (o.material?.name || '');
    const b = box(o); if (!b) return;
    const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    if (/cloak|robe|skirt|cape|tunic|tabard|sash/i.test(n)) garW = Math.max(garW, w);
    else if (/torso|chest|body|abdomen|pelvis/i.test(n)) torsoW = Math.max(torsoW, w);
  });

  const whole = box(rig.root);
  const height = whole ? whole.max.y - whole.min.y : NaN;

  world.unload();
  return { float, armAngle, garW, torsoW, ratio: torsoW > 0 ? garW / torsoW : NaN, height };
}

const rows = [];
for (const s of [human, small]) {
  const m = await measure(s);
  rows.push([s.id ?? s.name, m]);
}

console.log('  species        height   hilt→hand   arm above shoulder   garment/torso');
for (const [id, m] of rows) {
  console.log(`  ${String(id).padEnd(13)} ${m.height.toFixed(2).padStart(5)} m`
    + `  ${m.float.toFixed(3).padStart(7)} m`
    + `  ${m.armAngle.toFixed(1).padStart(14)}°`
    + `  ${Number.isFinite(m.ratio) ? m.ratio.toFixed(2).padStart(12) : '           —'}`);
}

const [[, H], [, S]] = rows;
console.log('\n  DIVERGENCE (small vs human — a defect is a difference, not a magnitude):');

/**
 * NORMALISED BY BODY HEIGHT, and that is the whole verdict.
 *
 * In centimetres the gap looks like nothing: 7.3 cm against 10.6 cm, a 3.3 cm
 * difference, and the first cut of this line duly printed "ok". But the small
 * frame is 0.68 m tall against 1.69 m, so the same 3.3 cm is a completely
 * different fraction of the figure — and a fraction of the figure is what the
 * eye actually reads. A gap that is 4% of a human's height is a fist; the same
 * gap at 16% of a 0.68 m body is a hand's-breadth of daylight between the palm
 * and the hilt, which is precisely what was reported.
 *
 * So the test is on the RATIO. This is the same mistake the stature units bug
 * was: a number that is only meaningful relative to the body it belongs to,
 * compared as though it were absolute.
 */
const hRel = H.float / H.height, sRel = S.float / S.height;
console.log(`    hilt→hand           ${(S.float - H.float >= 0 ? '+' : '')}${(S.float - H.float).toFixed(3)} m`
  + `   — as a share of body height ${(hRel * 100).toFixed(1)}% → ${(sRel * 100).toFixed(1)}%`
  + `  ${sRel > hRel * 1.5 ? '← FLOATS' : 'ok'}`);
console.log(`    arm above shoulder  ${(S.armAngle - H.armAngle >= 0 ? '+' : '')}${(S.armAngle - H.armAngle).toFixed(1)}°`
  + `     ${S.armAngle - H.armAngle > 12 ? '← ARMS UP' : 'ok'}`);
if (Number.isFinite(S.ratio) && Number.isFinite(H.ratio)) {
  console.log(`    garment/torso       ${(S.ratio - H.ratio >= 0 ? '+' : '')}${(S.ratio - H.ratio).toFixed(2)}`
    + `        ${S.ratio > H.ratio * 1.18 ? '← OVERSIZED' : 'ok'}`);
}
console.log('');
