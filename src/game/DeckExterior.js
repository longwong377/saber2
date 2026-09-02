/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE SHIP THE DECK IS IN — the capital hull round the hangar, seen from
 *  outside the field
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player, after flying out through the field and turning round:
 *
 *   "when you look back you don't see any detailed capital ship model or
 *    mothership model at all… all I see is a large rectangle getting smaller
 *    and smaller it may as well be a space portal right now, the actual size
 *    of the ship should DWARF the size of the force field entrance like this
 *    ship should be massive and it should be just one hangar of many."
 *
 * The rectangle was the hangar itself: a room with a lit mouth, and nothing
 * round it, because the deck was built as a room and nobody had ever stood
 * outside it. This file stands the faction's capital ship — the same
 * `Vehicles.buildCapitalShip` the insertion flies away from — round the room,
 * at REAL SCALE (the builders are 1/100, so ×100), placed so that one of its
 * published hangar mouths (`userData.hangars[i]`, a point and an outward
 * normal in model units) sits exactly on the deck's aperture. The deck is
 * then one bay in a flank of several, and the hull runs hundreds of metres
 * either side of it.
 *
 * ── WHEN IT IS DRAWN ──────────────────────────────────────────────────────
 *
 * Only while the camera is OUTSIDE the lip. From inside, the flank is not
 * visible through the aperture at any angle (you look out along the mouth's
 * normal), and the hull's own plates cut through the room's walls behind the
 * aperture — so inside, it is hidden, and it costs nothing. `DeckFlight`
 * toggles it on the frame the flying hull crosses the lip, both ways.
 *
 * ── FOG AND THE FAR PLANE ─────────────────────────────────────────────────
 *
 * The room's haze is the wall colour at 250 m; a 750 m hull in it would be
 * gone. Every material is cloned with `fog: false`, and the flight raises
 * the camera's far plane while it is outside (DeckLife only ever RAISES it,
 * so the two do not fight).
 */

import * as THREE from '../../vendor/three/three.module.js';
import { capitalModel } from './Arrivals.js';
/* Read inside functions only — Hangar.js imports the file that imports us. */
import { DECK, deckFaction } from './Hangar.js';

/** Model units per metre in the builders, inverted: the builders are 1/100. */
export const CAPITAL_SCALE = 100;

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * The mouth the deck is: the first published hangar, or a stand-in on the
 * hull's flank when the builder publishes none (older hulls).
 */
function mouthOf(model) {
  const h = model?.userData?.hangars;
  if (Array.isArray(h) && h.length) {
    const m = h[0];
    return { pos: new THREE.Vector3(...m.pos), normal: new THREE.Vector3(...m.normal).normalize() };
  }
  return { pos: new THREE.Vector3(0.9, -0.05, 0.9), normal: new THREE.Vector3(1, 0, 0) };
}

/**
 * Build it and stand it round the room. Returns the group, also on
 * `world._deckExterior`. Hidden until `setExteriorSeen(world, true)`.
 */
export function dressDeckExterior(world) {
  const prev = world._deckExterior;
  if (prev && prev.group?.parent) return prev;
  const side = world._deckFaction || deckFaction(world);
  let model = null;
  try { model = capitalModel(side); } catch { model = null; }
  if (!model) return null;
  const group = new THREE.Group();
  group.name = 'deck-exterior';
  group.frustumCulled = false;
  /* Unfogged, unlit by the room's shadows, never outlined by the ink. */
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map((m) => {
      if (!m) return m;
      const c = m.clone();
      if ('fog' in c) c.fog = false;
      c.userData = { ...(m.userData || {}), saberNoInk: true, deckExterior: true };
      return c;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });
  const mouth = mouthOf(model);
  /* Rotate the hull so the mouth's normal points OUT of the deck (+Z), then
   * shift it so the mouth sits on the aperture's centre. */
  _q.setFromUnitVectors(_n.copy(mouth.normal), new THREE.Vector3(0, 0, 1));
  model.quaternion.copy(_q);
  model.scale.setScalar(CAPITAL_SCALE);
  _p.copy(mouth.pos).multiplyScalar(CAPITAL_SCALE).applyQuaternion(_q);
  const A = DECK.aperture || { top: 86 };
  const mouthY = (A.top ?? 86) * 0.5;
  model.position.set(-_p.x, mouthY - _p.y, DECK.lip - _p.z);
  group.add(model);
  group.visible = false;
  world.scene.add(group);
  world.statics?.push(group);
  const st = { group, model, mouth, side, seen: false, far0: null };
  world._deckExterior = st;
  return st;
}

/**
 * Show or hide it, and hold the far plane while it is shown. Called by the
 * flight each frame with "is the camera past the lip".
 */
export function setExteriorSeen(world, seen) {
  const st = world?._deckExterior;
  if (!st || !st.group) return;
  seen = !!seen;
  if (seen === st.seen) return;
  st.seen = seen;
  st.group.visible = seen;
  const cam = world.engine?.camera;
  if (!cam) return;
  if (seen) {
    if (st.far0 == null) st.far0 = cam.far;
    const want = Math.max(cam.far, EXTERIOR_FAR);
    if (cam.far !== want) { cam.far = want; cam.updateProjectionMatrix?.(); }
  } else if (st.far0 != null) {
    /* Never below what the deck itself asked for (DeckLife raises to 1008). */
    const back = Math.max(st.far0, 1008);
    if (cam.far !== back) { cam.far = back; cam.updateProjectionMatrix?.(); }
    st.far0 = null;
  }
}

/** Far enough to hold a 3 km hull from 1.5 km out. */
export const EXTERIOR_FAR = 6500;

export function undressDeckExterior(world) {
  const st = world?._deckExterior;
  if (!st) return;
  setExteriorSeen(world, false);
  st.group.parent?.remove(st.group);
  world._deckExterior = null;
}
