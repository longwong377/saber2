/**
 * BATTLEFRONT BORZ — a hilt on the ground.
 *
 * Note 61: "drop and pick up sabers, including a friend's."
 *
 * Before this there was no such object in the game. A duellist that lost the
 * arm holding its weapon called `saber.retract()` and the hilt ceased to exist
 * — so the most legible thing that can happen in a swordfight, one of you
 * losing your sword, produced nothing you could walk over and take. And the
 * player had no way to put theirs down at all.
 *
 * WHAT A DROPPED HILT IS. An ordinary `Prop`, which is deliberate and buys four
 * things without a line of new code each: it falls and rolls with real physics,
 * it can be picked up by the Force like any other loose object, the blade can
 * knock it across the floor, and it is in `world.props` so the level's own
 * culling and cleanup already know about it. What it adds is an identity —
 * `crystal`, `hiltStyle` and `order` — so that the weapon you pick up is the
 * weapon that was dropped, down to the metal it was machined from.
 *
 * THE FRIEND'S SABER CASE, which is the interesting half of the note and the
 * reason the identity travels rather than just the mesh: in co-op, your
 * partner's hilt is built from THEIR order's tuning with THEIR crystal. Pick it
 * up and you are holding their weapon — a Sith's bled red in a Jedi's hand, or
 * a Consular's gold hilt in yours — until you drop it again. Nothing about the
 * player's own saved identity is touched; `Player._takeSaber` rebuilds the blade
 * from what it was handed and remembers what it put down. (It was written here
 * as `Player.takeSaber`, which is not a method of anything — the sort of small
 * lie that costs the next reader a search.)
 *
 * ── AND THE OTHER END OF IT IS NOT IN THIS FILE, WHICH IS WHY NOTE 39 ────
 *
 * "When you drop your lightsaber you drop it but you still have one like you
 * never actually lose it, therefore you can never really pick one up."
 *
 * Every line above was working. `dropSaber` put a real, identity-carrying,
 * physical hilt on the floor every time it was asked to — and the WIELDER was
 * never told. `Player._dropSaber` called `saber.retract()`, which puts the
 * blade out and does nothing else, so the hilt stayed drawn in the fist, the
 * ignite key lit it again from nothing, and pressing drop a second time made a
 * second hilt. Five presses, five sabers, all pickable.
 *
 * The lesson is worth more than the fix: this file did its whole job and the
 * feature still did not exist, because a dropped weapon is a fact about the
 * PERSON as much as about the object. `Player.disarmed` is that fact, and every
 * reader of it is a place the game used to pretend the weapon was still there.
 */

import * as THREE from 'three';
import { Prop } from '../world/Props.js';
import { SABER_COLORS, BLADE_TUNING, buildHiltGroup } from './Saber.js';
import { TOUGHNESS } from './Combat.js';

const _v = new THREE.Vector3();

/**
 * How far a hilt can be picked up from, and how long it must lie there first.
 *
 * 1.6 m is a long reach for a hand and is deliberately generous — a hilt is a
 * 25 cm object that has just bounced off a wall, and hunting for the exact
 * pixel is not a skill worth testing. The delay is the important one: without
 * it, dropping your saber and walking forward picks it straight back up on the
 * next frame, and the player never sees it leave their hand.
 */
export const PICKUP_REACH = 1.6;
export const PICKUP_DELAY = 0.7;

/**
 * Put a hilt on the ground.
 *
 * @param world
 * @param opts.position   where it leaves the hand
 * @param opts.velocity   how it leaves it — a disarm throws, a drop does not
 * @param opts.colorIndex the crystal it was built with
 * @param opts.hiltStyle
 * @param opts.order      whose tuning machined it, for the metals
 * @param opts.owner      whoever dropped it, so it cannot be re-taken instantly
 */
export function dropSaber(world, opts = {}) {
  if (!world || !world.scene) return null;
  const colorIndex = opts.colorIndex ?? 0;
  const crystal = SABER_COLORS[colorIndex] || SABER_COLORS[0];
  const built = buildHiltGroup({
    tuning: opts.order ? BLADE_TUNING[opts.order] : null,
    color: new THREE.Color(crystal.hex),
    style: opts.hiltStyle,
  });

  /* The group is built about the EMITTER, which is 15 cm above the middle of
   * the hilt — so dropped as-is it lies with its handle buried and its muzzle
   * in the air. Re-centring it here rather than moving the spec keeps the
   * in-hand geometry exactly where `GRIP_AT` expects it. */
  const box = new THREE.Box3().setFromObject(built.group);
  const mid = box.getCenter(_v).clone();
  built.group.position.sub(mid);
  const mesh = new THREE.Group();
  mesh.add(built.group);

  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const prop = new Prop(world, {
    kind: 'hilt',
    mesh,
    // A lightsaber hilt is a machined metal cylinder: heavy for its size, hard
    // to cut, and it does not shatter. `toughness` is the armour figure because
    // that is what it is — you can cut one in half, but not casually.
    toughness: TOUGHNESS.armour,
    hp: 60,
    mass: 1.6,
    weather: false,
    grippable: true,
    bladeColor: crystal.hex,
    spheres: [{ c: new THREE.Vector3(0, 0, 0), r: Math.max(half.x, half.z, 0.03) },
      { c: new THREE.Vector3(0, half.y * 0.6, 0), r: Math.max(half.x, half.z, 0.03) },
      { c: new THREE.Vector3(0, -half.y * 0.6, 0), r: Math.max(half.x, half.z, 0.03) }],
  });

  /**
   * …AND SOMETIMES IT IS STILL BURNING.
   *
   * The player, on what should happen when a duellist falls: "they should fall
   * to the ground their user is dead, sometimes retracting automatically,
   * sometimes staying on and on the floor." A hilt on the ground was always
   * dark, so the second half of that sentence had nothing behind it.
   *
   * A BLADE AND NOT A `Saber`. The real class carries a trail, a bloom
   * contribution, a dynamic light, a hum voice and a per-frame update, and a
   * cleared duel can leave half a dozen of these lying about — six of that is
   * six of everything, for an object nobody is swinging. What a blade on the
   * floor has to be is BRIGHT AND THE RIGHT COLOUR, so it is one emissive
   * cylinder on the hilt's own group, and it dies with the prop.
   *
   * A physical weapon is never lit, because a vibrosword does not have a blade
   * to leave on.
   */
  /* WHAT IT WOULD TAKE TO LIGHT THIS ONE, kept on the prop rather than closed
   * over here, because the hilt can be lit long after it hits the ground: the
   * player's Force can pick it up and switch it on from across the field. See
   * `igniteHilt`, which is the only other place these three numbers are read. */
  prop.hiltGroup = built.group;
  prop.bladeLength = opts.weaponStyle ? 0 : (opts.bladeLength ?? 1.06);
  prop.bladeOffset = half.y;
  prop.bladeColor = crystal.hex;
  if (opts.lit) igniteHilt(prop, true);

  /* Its five metals are its own — `buildHiltGroup` machines a fresh set per
   * hilt from the weapon's tuning — so this hilt may free them when it goes.
   * See `Prop.destroy`, which will not touch a material without being told. */
  prop.ownsMaterials = true;
  prop.saber = { colorIndex, hiltStyle: opts.hiltStyle, order: opts.order ?? null };
  prop.droppedBy = opts.owner ?? null;
  prop.dropAge = 0;
  if (opts.position) prop.body.position.copy(opts.position);
  if (opts.velocity) prop.body.velocity.copy(opts.velocity);
  // A hilt tumbles. It is a cylinder with a hook on it, not a ball.
  prop.body.angularVelocity.set(
    (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 8);
  /* NOT registered here: `Prop` puts itself in `world.props` from its own
   * constructor now — see the note there — and a second push would put the
   * same hilt on the ground twice. */
  return prop;
}

/**
 * The hilt this actor could pick up, or null.
 *
 * Nearest first, and never one you put down inside the last `PICKUP_DELAY` —
 * see the note over the constant. `world.props` is scanned rather than a
 * separate list being kept, because a dropped hilt that has been cut in half or
 * culled is no longer in it, and one register is one thing to be wrong.
 */
export function hiltWithinReach(world, actor, reach = PICKUP_REACH) {
  if (!world || !world.props) return null;
  let best = null, bestD = reach * reach;
  for (const p of world.props) {
    if (p.dead || !p.saber) continue;
    if (p.droppedBy === actor && p.dropAge < PICKUP_DELAY) continue;
    const d = hiltDistanceSq(p, actor);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/**
 * HOW FAR A HILT IS FROM A BODY — and the body is not a point.
 *
 * The player: *"if you force picked up the saber off the ground and called it
 * back to you even at the closest distance you could not pick it up in the
 * air."* This measured to `actor.position`, which is the FEET, and the Force
 * grip's own floor parks what it holds 1.4 m in front of the CHEST. Measured
 * on that geometry: a hilt reeled all the way in sits about 1.98 m from the
 * feet against a 1.6 m reach, so the closest the Force could bring your own
 * weapon was permanently, and by 38 cm, out of arm's reach — with no message,
 * because nothing had failed.
 *
 * So the reach is to the STANDING AXIS: the segment from the feet to the top
 * of the chest. A hilt at your boots and a hilt at your shoulder are both
 * within arm's reach of you and neither is any longer a special case.
 */
export function hiltDistanceSq(prop, actor) {
  const p = prop.body ? prop.body.position : prop.position;
  const foot = actor.position;
  const top = actor.chest ? actor.chest.y : foot.y + 1.35;
  _v.set(p.x - foot.x, p.y - Math.min(Math.max(p.y, foot.y), top), p.z - foot.z);
  return _v.lengthSq();
}

/**
 * LIGHT A HILT THAT NOBODY IS HOLDING, or put it out.
 *
 * Two callers and one of them is the reason this is a function at all: a hilt
 * dropped by a dying duellist is sometimes lit when it lands, and a hilt the
 * player's Force has picked up off the ground can be lit BY the Force, from
 * anywhere inside the reach — *"it should be possible to pick up the lightsaber
 * with the force, turn it on or off using the force."*
 *
 * A BLADE AND NOT A `Saber`, for the reason the drop note gives: the real class
 * carries a trail, a bloom contribution, a light, a hum voice and a per-frame
 * update, and a cleared duel can leave half a dozen hilts about. What a blade
 * off the hand has to be is bright, the right colour and the right length. It
 * is built once, on the first ignition, and then only shown and hidden — so a
 * hilt switched on and off a dozen times machines one cylinder.
 *
 * A vibrosword has no blade to leave on: `bladeLength` is 0 for a physical
 * weapon and this refuses it rather than growing a plasma edge on a hunk of
 * metal.
 */
export function igniteHilt(prop, on = true) {
  if (!prop || prop.dead) return false;
  if (on && !(prop.bladeLength > 0)) return false;
  if (on && !prop.saberBlade) {
    const len = prop.bladeLength;
    const blade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.022, len, 7, 1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(prop.bladeColor ?? 0xffffff) }));
    /* Up the hilt's own axis from the emitter, which is where `buildHiltGroup`
     * puts the muzzle — the group has been re-centred about its own bounding
     * box, so the emitter is at the top of it. */
    blade.position.y = (prop.bladeOffset ?? 0) + len * 0.5;
    blade.userData.saberNoInk = true;      // see Ink.js: a glow is not an edge
    (prop.hiltGroup ?? prop.mesh).add(blade);
    prop.saberBlade = blade;
  }
  if (prop.saberBlade) prop.saberBlade.visible = !!on;
  prop.saberLit = !!on;
  return true;
}

/**
 * The two ends of a loose hilt's blade in world space, or null if it is dark.
 *
 * Written out of the prop's own transform rather than from the body's rotation
 * by hand, because the hilt group is re-centred inside the mesh and the blade
 * is offset inside that: one `updateMatrixWorld` gets both without this file
 * carrying a second copy of the offsets `igniteHilt` just applied.
 */
export function hiltBlade(prop, base, tip) {
  if (!prop || prop.dead || !prop.saberLit || !prop.saberBlade) return null;
  const b = prop.saberBlade;
  /* FROM THE PROP'S ROOT DOWN, and not from the blade up. `updateMatrixWorld`
   * recomputes an object's world matrix from its PARENT's, which nothing has
   * refreshed: `Prop._syncMesh` writes `mesh.position` every frame but the
   * matrices behind it are only rebuilt by the renderer's own scene walk, which
   * never happens headless. Called on the blade alone this read the identity
   * and put every loose blade in the game at the world origin — measured, on a
   * hilt seven metres away that cut nothing because its blade was at (0,0,0). */
  (prop.mesh ?? b).updateMatrixWorld(true);
  base.set(0, -prop.bladeLength * 0.5, 0).applyMatrix4(b.matrixWorld);
  tip.set(0, prop.bladeLength * 0.5, 0).applyMatrix4(b.matrixWorld);
  return tip;
}

/**
 * ══ HOW MANY HILTS THE FLOOR KEEPS ═══════════════════════════════════════
 *
 * Nothing bounded this, and the note over `dropSaber` says what the design
 * wanted: "a field after a duel has a couple of blades still burning on it and
 * the rest gone dark, so walking up to one is a decision rather than a
 * formality." A couple. Measured with `tools/_hiltpile.mjs` — eight acolytes
 * killed five times over, forty-five seconds apart so every corpse has been
 * cleaned up before the next wave:
 *
 *     wave 1   8 hilts    196 meshes    71 rigid bodies
 *     wave 3  24 hilts    590 meshes    87
 *     wave 5  40 hilts    983 meshes   103
 *
 * Exactly one per saber-carrying kill, forever: `Prop` has no lifetime and
 * `ageDropped` only ever added to `dropAge`. A hilt is 24.6 meshes — it is
 * nineteen to thirty-six machined pieces, which is the whole reason it looks
 * like a weapon — so forty of them is 983 draw calls of hardware lying in the
 * sand, against the 520 `world-immersion` holds a whole LEVEL to. That is
 * player note #15's "really really laggy" arriving from the one direction
 * `Corpses` does not cover.
 *
 * ── THE BUDGET, DERIVED FROM THE CORPSE ONE ──────────────────────────────
 *
 * A corpse is 81 meshes (Corpses.js measured it); a hilt is 24.6, so a hilt is
 * a third of a corpse. `CORPSE_BUDGET.high` is 20 bodies ≈ 1620 meshes, and
 * these numbers are a tenth of that spend at every tier — 10 hilts at `high`
 * is 246 meshes, which is a scatter of weapons a player can walk between and
 * not a scrapyard. The tiers rise for the same reason the corpse tiers do and
 * `low` keeps four, because a duel that leaves nothing behind is worse than a
 * duel that leaves too much.
 */
export const HILT_BUDGET = { low: 4, medium: 6, high: 10, ultra: 14 };

/**
 * How long a spent hilt takes to go, and what may never be spent.
 *
 * The failure to avoid is the one `Corpses.worth` names from the other end —
 * "bodies vanishing under your blade". A hilt is worse: it is an object the
 * player may be walking toward in order to pick it up.
 *
 * A DISTANCE FLOOR IS THE WRONG GUARANTEE, and the first draft of this used
 * one (14 m, then 4). Measured with `tools/_hiltpile.mjs`: a fight happens
 * AROUND the player — eight acolytes charge a standing Jedi and die inside two
 * metres of it — so every hilt on the field is inside any floor worth having,
 * and the budget grew by five a wave with the cull refusing every candidate. A
 * floor big enough to be a safeguard is big enough to be an exemption.
 *
 * So the protection is by RELATIONSHIP rather than by radius, which is what a
 * player actually has with a hilt:
 *
 *   · one in a hand or in the Force (`claimed`), including one in flight;
 *   · one a LOCAL PLAYER put down themselves — `dropSaber` records the owner,
 *     and `Player._dropSaber` passes `owner: this`. That is the case the
 *     radius was really for: you drop your weapon to fight bare-handed, walk
 *     eight metres, and it must be where you left it;
 *   · one put down inside `PICKUP_DELAY`, mid-swap.
 *
 * Everything else is ranked, exactly as `Corpses` ranks the dead, and the
 * nearest and freshest are the last to go — so the ones that fade are the ones
 * behind you at thirty metres. And it FADES rather than popping, which is
 * `Corpses`' SINK step doing the same job for the same reason. A hilt's
 * materials are its own (`buildHiltGroup` builds them per hilt), so this
 * cannot reach anything another object is drawing with.
 */
const HILT_SINK = 1.0;

/** Is anybody holding this hilt, or is it a local player's own weapon? */
function claimed(world, prop) {
  for (const p of (world.players || [])) {
    if (!p) continue;
    if (p.gripBody && p.gripBody.userData?.prop === prop) return true;
    for (const h of (p.hurled || [])) if (h && h.thing === prop) return true;
    if (prop.droppedBy === p && p.isLocal !== false && p.alive !== false) return true;
  }
  return false;
}

/** Fade every material a hilt owns. `k` runs 1 → 0. */
function fadeHilt(prop, k) {
  prop.mesh?.traverse?.((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      if (!m.transparent) m.transparent = true;
      m.opacity = k;
    }
  });
}

/**
 * Age every dropped hilt — so the pickup delay means something — and spend the
 * ones past the budget.
 *
 * Ranked as `Corpses.worth` ranks the dead, and for the same reasons: NEARNESS
 * as `1/(1+d)` so there is no radius at which hilts pop, and RECENCY so the
 * weapon of the duellist you just cut down outranks one you walked past two
 * rooms ago. Nearness is to the NEAREST player rather than to the local one,
 * because in co-op a hilt your partner is standing over is one somebody can
 * see.
 */
export function ageDropped(world, dt) {
  if (!world || !world.props) return;
  const hilts = [];
  for (const p of world.props) {
    if (!p.saber || p.dropAge === undefined) continue;
    p.dropAge += dt;
    hilts.push(p);
  }
  if (!hilts.length) return;

  /* Whatever is already going, first — and it may be rescued: a hilt somebody
   * takes hold of stops sinking and comes back to full. */
  const live = [];
  for (const p of hilts) {
    if (!(p._sink > 0)) { live.push(p); continue; }
    if (claimed(world, p)) { p._sink = 0; fadeHilt(p, 1); live.push(p); continue; }
    p._sink -= dt;
    if (p._sink <= 0) { p.destroy(); continue; }
    fadeHilt(p, p._sink / HILT_SINK);
  }

  const budget = HILT_BUDGET[world.settings?.quality] ?? HILT_BUDGET.high;
  if (live.length <= budget) return;

  const eyes = (world.players || []).map((p) => p && p.position).filter(Boolean);
  const rank = [];
  for (const p of live) {
    if (p.dropAge < PICKUP_DELAY || claimed(world, p)) continue;
    const q = p.body?.position || p.mesh?.position;
    if (!q) continue;
    let d = 60;
    for (const e of eyes) d = Math.min(d, Math.hypot(q.x - e.x, q.z - e.z));
    rank.push({ p, worth: (1 / (1 + d * 0.08)) * (1 / (1 + p.dropAge * 0.05)) });
  }
  rank.sort((a, b) => a.worth - b.worth);
  const spend = Math.min(rank.length, live.length - budget);
  for (let i = 0; i < spend; i++) rank[i].p._sink = HILT_SINK;
}
