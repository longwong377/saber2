/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE COBRA BAY, DRAWN — SHARK §3.2 #5, and the stage directions it kept
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── THE DEFECT THIS FILE EXISTS FOR ───────────────────────────────────────
 *
 * `Launch.js` drives five numbers through its sink on every frame of a launch
 * and `Station.sortieSink` writes all five onto the station as `st.bay`:
 *
 *     { canopy, lights, rams, shaft, scroll }
 *
 * After a flown sortie that record reads `{1, 0, 1, 1, 34}` — a canopy sealed,
 * rams at pressure, a well run out to its full 34 m. **Nothing read any of
 * it.** Grepped across `src/game/*.js`, `src/ui/*.js` and `src/main.js`, the
 * four keys `bay.canopy`, `bay.rams`, `bay.shaft` and `bay.scroll` had no
 * reader anywhere in the tree. `sortieSink`'s own comment said the four things
 * a launch moves "are the room's to draw" — and the room did not draw them, so
 * the whole launch sequence was four banner lines over a still photograph.
 *
 * ── AND THE AIRFRAME WAS THE SECOND ORPHAN IN THE SAME ROOM ───────────────
 *
 * `Station.ROOM_FILES` names five imported meshes and `prepareStation()`
 * decodes all five on every visit. `starfury.smesh` — 2 134 vertices, 3 968
 * triangles, sixteen named sections, every one of them covered by
 * `StationMesh.PART_MATERIAL` — is fetched, decoded and cached, and NO row in
 * `StationPlan.PLACES` declares `room: 'starfury'`. It was the same failure
 * `Pilot.js`'s header records against the flight model one file over: finished,
 * covered, and in nobody's frame. This is its caller.
 *
 * So the four numbers are drawn on the thing they describe. The canopy is the
 * fighter's own `cockpit_canopy` / `canopy_frame` / `cockpit_glazing` on a
 * hinge; the rams are two pistons on the rail under it; `lights` is the bay
 * going from working white to launch amber; and `shaft`/`scroll` streams the
 * well past you at the metres-per-second `Launch.js` already computes.
 *
 * ── WHY THE SHIP IS NOT IN THE PLACE'S GROUP ──────────────────────────────
 *
 * Everything else here is: the rams and the strip lights are the ROOM, and a
 * room is culled by its door (§12.3, `stepStation`'s last block). The ship is
 * not — the moment it launches it is three hundred metres away and the bay's
 * group is switched off behind it, which would take the fighter with it. So
 * the airframe is its own top-level node and `undressCobraBay` is what puts it
 * down; that is `DeckBattle`'s arrangement for the fleet outside the glass and
 * it is here for the same reason.
 *
 * ── AND IT MAKES NO MATERIAL ──────────────────────────────────────────────
 *
 * §9.1: every material in a room is one of the engine's own, and `station.mjs`
 * traverses the places asserting it by NAME. Everything below binds
 * `stationMats(12)`'s nine. The one exception is the strip, which is CLONED so
 * the bay can go amber without every strip light on the deck going with it —
 * a clone keeps `station-12-strip` as its name, which is the property that
 * check is actually testing.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { PLACE, floorOf } from './StationPlan.js';

/** The well, in metres — `Launch.WELL`, and #5's own `h`. */
const WELL = PLACE.get(5)?.h ?? 34;

/** How high the cradle stands the fighter off the bay floor. `SHAPES.shaft`
 *  puts the cradle slab at y = 1.4 and it is 0.5 thick, so this is its top
 *  plus the airframe's own half-span. Derived from the kit rather than typed
 *  beside it, so a cradle that moves takes the fighter with it. */
const CRADLE_Y = 1.65;

/** How many strip lights stream past, and over what pitch. Ten, because
 *  `SHAPES.shaft` stands ten up the wall and this is the same well seen
 *  moving. */
const STRIPS = 10;
const STRIP_PITCH = WELL / STRIPS;

/** How far the rams run when they come to pressure, in metres. */
const RAM_TRAVEL = 2.6;

/** How far the canopy stands open, in radians, at `canopy` 0. */
const CANOPY_OPEN = 0.78;

/** Working white and launch amber, as the bay's two states. */
const WHITE = new THREE.Color(0xbfd6e6);
const AMBER = new THREE.Color(0xff8a1e);

/** Which sections of the airframe are the canopy, and therefore hinge. */
const CANOPY_PARTS = new Set(['cockpit_canopy', 'canopy_frame', 'cockpit_glazing']);

/**
 * Merge a bundle of cached geometries into one.
 *
 * IT COPIES AND DOES NOT CONSUME, for `Station.placeRoom`'s reason: the source
 * geometries belong to `prepareStation`'s session-lived cache and are handed
 * out again on the next visit. `Props.mergeGeos` disposes its inputs, which is
 * right for a kit that built them and fatal for a cache that lends them.
 */
function mergeParts(geos) {
  let verts = 0;
  for (const g of geos) verts += g.attributes.position.count;
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** One merged mesh per material, out of a name→geometry map. */
function bindParts(parts, want, M, materialKeyFor, into, tag) {
  const bins = new Map();
  for (const [name, geo] of parts) {
    if (!want(name)) continue;
    const key = materialKeyFor(name);
    /* No fallback: a section with no row is a surface with no material, and
     * `StationMesh`'s own note refuses to guess one. */
    if (!key || !M[key]) continue;
    let b = bins.get(key);
    if (!b) bins.set(key, b = []);
    b.push(geo);
  }
  let draws = 0, tris = 0;
  for (const [key, geos] of bins) {
    const geo = mergeParts(geos);
    const mesh = new THREE.Mesh(geo, M[key]);
    mesh.name = `station-starfury-${tag}-${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    into.add(mesh);
    draws++;
    tris += geo.attributes.position.count / 3;
  }
  return { draws, tris };
}

/**
 * ══ BUILD THE BAY'S MOVING PARTS ══════════════════════════════════════════
 *
 * Called once, on the first frame the bay is stepped, and only on deck 12 —
 * `stepBay`'s own gate. A station nobody launches from still gets the fighter,
 * because a launch bay with no fighter in it is the room the gazetteer does
 * not describe; what it does NOT get is a second copy on the next visit, which
 * is what the `st.bayRig` guard is for.
 *
 * @param roomOf         `Station.roomOf` — the decoded `.smesh` cache
 * @param materialKeyFor `StationMesh.materialKeyFor`
 * @param M              `stationMats(12)`
 */
export function dressCobraBay(world, st, { roomOf, materialKeyFor, M }) {
  if (st.bayRig) return st.bayRig;
  const place = PLACE.get(5);
  const rec = st.places?.get(5);
  if (!place || !rec) return null;
  const y0 = floorOf(place);

  /* ── THE FIGHTER, ON ITS RAIL ────────────────────────────────────────── */
  const ship = new THREE.Group();
  ship.name = 'station-starfury';
  const hull = new THREE.Group();
  const canopy = new THREE.Group();
  ship.add(hull); ship.add(canopy);
  let draws = 0, tris = 0;
  const room = roomOf('starfury');
  if (room) {
    const a = bindParts(room.parts, (n) => !CANOPY_PARTS.has(n), M, materialKeyFor, hull, 'hull');
    const b = bindParts(room.parts, (n) => CANOPY_PARTS.has(n), M, materialKeyFor, canopy, 'canopy');
    draws += a.draws + b.draws; tris += a.tris + b.tris;
    /**
     * THE HINGE IS MEASURED OFF THE CANOPY, NOT TYPED.
     *
     * A canopy lifts at the front and is pinned at the back, so the pivot is
     * the aft-bottom edge of the glazing — `+z` is forward in this airframe's
     * own frame (the manifest says so in its `frame` field), which puts the
     * hinge at the group's minimum z. The children are shifted by it and the
     * group put back where they were, which is the standard way to give a
     * merged mesh a pivot it was not exported with.
     */
    const box = new THREE.Box3();
    for (const m of canopy.children) box.expandByObject(m);
    if (Number.isFinite(box.min.z)) {
      const hz = box.min.z, hy = box.min.y;
      for (const m of canopy.children) m.position.set(0, -hy, -hz);
      canopy.position.set(0, hy, hz);
    }
  }
  /* NOSE UP THE WELL. §3.2 #5 is "a vertical shaft with the Starfury on a
   * rail": body +z is forward and the rail is vertical, so the parked attitude
   * is a quarter turn about x that puts the nose at world +y. */
  const parked = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  ship.position.set(place.x, y0 + CRADLE_Y, place.z);
  ship.quaternion.copy(parked);
  world.scene.add(ship);

  /* ── THE RAMS. Two pistons on the rail, in the room's own group. ─────── */
  const ramGeo = new THREE.BoxGeometry(0.34, 1, 0.34);
  ramGeo.translate(0, 0.5, 0);            // grows upward from its foot
  const rams = new THREE.InstancedMesh(ramGeo, M.wing, 2);
  rams.name = 'station-bay-rams';
  rams.frustumCulled = false;
  rec.group.add(rams);

  /* ── THE WELL. Ten strips that stream past — `DeckLift`'s scroll, with the
   * lid off the top of it. Their material is the bay's own clone, so
   * `lights` can take the whole shaft to launch amber. */
  const stripMat = M.strip.clone();
  stripMat.name = M.strip.name;
  stripMat.userData = { ...M.strip.userData };
  const stripGeo = new THREE.BoxGeometry(0.16, 1.9, 0.1);
  const strips = new THREE.InstancedMesh(stripGeo, stripMat, STRIPS * 2);
  strips.name = 'station-bay-shaft';
  strips.frustumCulled = false;
  rec.group.add(strips);

  st.bayRig = {
    place, y0, ship, hull, canopy, parked, rams, strips, stripMat,
    ramGeo, stripGeo,
    /** What was last drawn, so a still bay is not re-laid sixty times a
     *  second — `DeckLift.st.laid`'s trick, and its reason. */
    laid: null,
    draws, tris,
  };
  drawCobraBay(world, st);
  return st.bayRig;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/**
 * ══ DRAW THE FIVE NUMBERS ═════════════════════════════════════════════════
 *
 * Every key of `st.bay` has exactly one reader and it is here:
 *
 *   canopy  the hinge angle of the fighter's own glazing, 0 open, 1 sealed
 *   rams    how far the two pistons have run out, 0 parked, 1 at pressure
 *   lights  the strip lights, working white at 0 and launch amber at 1
 *   shaft   how much of the well is streaming, 0 still, 1 at full rate
 *   scroll  where the well has got to, in METRES — the strips are laid at it
 *
 * `world._seat` is the sixth thing it draws and is not part of the sink: while
 * a player is at the stick the airframe stands where the craft is rather than
 * on the cradle. That is the same node — you fly the fighter that was in the
 * bay, not a second one.
 */
export function drawCobraBay(world, st) {
  const rig = st.bayRig;
  if (!rig) return false;
  const bay = st.bay || (st.bay = { canopy: 0, lights: 0, rams: 0, shaft: 0, scroll: 0 });
  const seat = world._seat || null;

  /* ── the fighter itself ─────────────────────────────────────────────── */
  if (seat?.craft) {
    const [x, y, z] = seat.craft.position;
    const [qw, qx, qy, qz] = seat.craft.orientation;
    rig.ship.position.set(x, y, z);
    rig.ship.quaternion.set(qx, qy, qz, qw);
  } else {
    rig.ship.position.set(rig.place.x, rig.y0 + CRADLE_Y + bay.scroll * 0.5, rig.place.z);
    rig.ship.quaternion.copy(rig.parked);
  }
  rig.ship.visible = true;
  rig.canopy.rotation.x = -CANOPY_OPEN * (1 - clamp01(bay.canopy));

  /* Nothing below moves unless one of the four numbers did. */
  const key = `${bay.rams.toFixed(3)}|${bay.lights.toFixed(3)}|${bay.shaft.toFixed(2)}|${bay.scroll.toFixed(2)}`;
  if (key === rig.laid) return true;
  rig.laid = key;

  /* ── the rams ───────────────────────────────────────────────────────── */
  const len = 0.5 + RAM_TRAVEL * clamp01(bay.rams);
  for (let i = 0; i < 2; i++) {
    _p.set(rig.place.x + (i ? 2.6 : -2.6), rig.y0 + 1.9, rig.place.z);
    _s.set(1, len, 1);
    rig.rams.setMatrixAt(i, _m.compose(_p, _q.identity(), _s));
  }
  rig.rams.instanceMatrix.needsUpdate = true;

  /* ── the well, streaming ────────────────────────────────────────────── */
  const r = Math.min(rig.place.w, rig.place.d) / 2 - 1.0;
  const scroll = Number.isFinite(bay.scroll) ? bay.scroll : 0;
  for (let i = 0; i < STRIPS; i++) {
    const a = (Math.PI * 2) * (i / STRIPS);
    /* The strip's height is the launch's own metres, wrapped into the well —
     * so a scroll of 34 m has run the whole shaft past exactly once and the
     * rate on screen is `Launch.js`'s rate rather than a guess. */
    const h = ((i * STRIP_PITCH - scroll) % WELL + WELL) % WELL;
    for (let k = 0; k < 2; k++) {
      _p.set(rig.place.x + r * Math.sin(a), rig.y0 + h + k * WELL / 2, rig.place.z + r * Math.cos(a));
      _q.setFromAxisAngle(UP, a);
      _s.set(1, 1, 1);
      rig.strips.setMatrixAt(i * 2 + k, _m.compose(_p, _q, _s));
    }
  }
  rig.strips.instanceMatrix.needsUpdate = true;

  /* ── and the bay's own light ────────────────────────────────────────── */
  const k = clamp01(bay.lights);
  rig.stripMat.emissive.copy(WHITE).lerp(AMBER, k);
  rig.stripMat.emissiveIntensity = 3.0 + 1.4 * k;
  return true;
}

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : (Number.isFinite(v) ? v : 0));

/** Put the bay down. `undressStation` calls it, in the sortie block. */
export function undressCobraBay(world, st) {
  const rig = st?.bayRig;
  if (!rig) return false;
  rig.ship.parent?.remove(rig.ship);
  rig.ship.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  rig.rams.parent?.remove(rig.rams);
  rig.strips.parent?.remove(rig.strips);
  rig.ramGeo.dispose();
  rig.stripGeo.dispose();
  rig.stripMat.dispose();
  st.bayRig = null;
  return true;
}
